import type { SQLiteDatabase } from 'expo-sqlite';
import { seasonForMonth, seasonStatus } from './season.ts';
import type { IngredientCategory, Season } from '../types';

type DB = Pick<SQLiteDatabase, 'getFirstAsync' | 'getAllAsync' | 'runAsync'>;
type IngredientRow = {id:string; name:string; ingredient_category:IngredientCategory|null; seasons_json:string; is_hidden:number; updated_at:string; deleted_at:string|null};
type RecipeRow = {id:string; name:string; category_id:string; is_hearty:number; is_hidden:number; steps:string|null; notes:string|null; cook_time_minutes:number|null; flavor_tags:string; scene_tags:string; updated_at:string; deleted_at:string|null};
export type IngredientInput = {name:string; ingredient_category:IngredientCategory|null; seasons:Season[]; is_hidden?:boolean};
type RecipeLink = {ingredient_id:string; is_main:boolean; quantity:string|null; unit:string|null};
export type RecipeInput = {name:string; category_id:string; is_hearty:boolean; ingredients:RecipeLink[]; steps:string|null; notes:string|null; cook_time_minutes:number|null; is_hidden?:boolean; flavor_tags?:string[]; scene_tags?:string[]};
const seasonValues = new Set(['spring','summer','autumn','winter','all_year']);
const ingredientCategories = new Set(['vegetable','meat','seafood','mushroom','egg','soy','staple','seasoning','fruit','other']);
export const normalizeName = (s:string) => s.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
const todayMonth = () => Number(new Date(Date.now()+8*3600000).toISOString().slice(5,7));

function validateIngredient(input:IngredientInput) {
  if (!input.name.trim() || input.name.trim().length > 80) throw new Error('请填写食材名称');
  if (input.ingredient_category !== null && !ingredientCategories.has(input.ingredient_category)) throw new Error('请选择有效的食材分类');
  if (!Array.isArray(input.seasons) || input.seasons.some(s=>!seasonValues.has(s)) || new Set(input.seasons).size !== input.seasons.length || input.seasons.includes('all_year') && input.seasons.length > 1) throw new Error('请选择有效季节；全年不能与其他季节同时选择');
}

export class LocalCatalog {
  private db:SQLiteDatabase;
  private newId:()=>string;
  private now:()=>string;
  constructor(db:SQLiteDatabase, newId:()=>string, now:()=>string = () => new Date().toISOString()) { this.db=db; this.newId=newId; this.now=now; }
  private async ingredient(db:DB,id:string) {
    const item=await db.getFirstAsync<IngredientRow>('SELECT * FROM ingredients WHERE id=? AND deleted_at IS NULL',id);
    if (!item) throw new Error('食材不存在或已删除');
    const seasons=JSON.parse(item.seasons_json) as Season[];
    return {id:item.id,name:item.name,ingredient_category:item.ingredient_category,seasons,is_hidden:!!item.is_hidden,season_status:seasonStatus(seasons,seasonForMonth(todayMonth())),updated_at:item.updated_at};
  }
  async getIngredient(id:string) { return this.ingredient(this.db,id); }
  async listIngredients(options:{q?:string; category?:string; season?:string; includeAllYear?:boolean; visibility?:string; limit?:number; offset?:number}={}) {
    const all=await this.db.getAllAsync<IngredientRow>('SELECT * FROM ingredients WHERE deleted_at IS NULL ORDER BY name');
    const query=normalizeName(options.q||'');
    const names=query ? await this.db.getAllAsync<{ingredient_id:string;normalized_name:string}>('SELECT ingredient_id,normalized_name FROM ingredient_names') : [];
    const matched=new Set(names.filter(n=>n.normalized_name.includes(query)).map(n=>n.ingredient_id));
    const current=seasonForMonth(todayMonth());
    const desired=options.season==='current' ? current : options.season;
    const filtered=all.filter(i=>{
      const seasons=JSON.parse(i.seasons_json) as Season[];
      if (options.visibility !== 'all' && !!i.is_hidden !== (options.visibility==='hidden')) return false;
      if (query && !matched.has(i.id)) return false;
      if (options.category && i.ingredient_category!==options.category) return false;
      if (desired && !(desired==='unknown' ? !seasons.length : seasons.includes(desired as Season) || !!options.includeAllYear && seasons.includes('all_year'))) return false;
      return true;
    });
    const items=await Promise.all(filtered.slice(options.offset||0,(options.offset||0)+(options.limit||30)).map(i=>this.ingredient(this.db,i.id)));
    return {items,total:filtered.length};
  }
  async saveIngredient(input:IngredientInput,id?:string) {
    validateIngredient(input);
    const ingredientId=id||this.newId(), name=input.name.trim(), now=this.now();
    await this.db.withExclusiveTransactionAsync(async tx=>{
      const existing=id ? await this.ingredient(tx,id) : null;
      const key=normalizeName(name);
      const match=await tx.getFirstAsync<{ingredient_id:string}>('SELECT ingredient_id FROM ingredient_names WHERE normalized_name=?',key);
      if (match && match.ingredient_id!==ingredientId) throw new Error('食材名称或别名已存在，请使用已有食材');
      if (existing) {
        const old=await tx.getFirstAsync<{normalized_name:string}>('SELECT normalized_name FROM ingredient_names WHERE ingredient_id=? AND kind=?',ingredientId,'canonical');
        if (!old) throw new Error('食材名称数据不完整，请先备份');
        if (old.normalized_name!==key) {
          await tx.runAsync("UPDATE ingredient_names SET kind='alias' WHERE normalized_name=?",old.normalized_name);
          if (match) await tx.runAsync("UPDATE ingredient_names SET kind='canonical',display_name=? WHERE normalized_name=?",name,key);
          else await tx.runAsync("INSERT INTO ingredient_names VALUES (?,?,?,'canonical')",key,ingredientId,name);
        } else await tx.runAsync('UPDATE ingredient_names SET display_name=? WHERE normalized_name=?',name,key);
        await tx.runAsync('UPDATE ingredients SET name=?,ingredient_category=?,seasons_json=?,is_hidden=?,updated_at=? WHERE id=?',name,input.ingredient_category,JSON.stringify(input.seasons),Number(input.is_hidden??existing.is_hidden),now,ingredientId);
      } else {
        await tx.runAsync('INSERT INTO ingredients(id,name,ingredient_category,seasons_json,source,is_hidden,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',ingredientId,name,input.ingredient_category,JSON.stringify(input.seasons),'family',0,now,now);
        await tx.runAsync("INSERT INTO ingredient_names VALUES (?,?,?,'canonical')",key,ingredientId,name);
      }
    });
    return this.ingredient(this.db,ingredientId);
  }
  async deleteIngredient(id:string) {
    await this.db.withExclusiveTransactionAsync(async tx=>{
      await this.ingredient(tx,id);
      const refs=await tx.getAllAsync<{name:string}>('SELECT r.name FROM recipes r JOIN recipe_ingredients ri ON ri.recipe_id=r.id WHERE ri.ingredient_id=? AND r.deleted_at IS NULL',id);
      if (refs.length) throw new Error(`该食材仍被菜谱引用，请先修改相关菜谱：${refs.map(r=>r.name).join('、')}`);
      await tx.runAsync('UPDATE ingredients SET deleted_at=?,updated_at=? WHERE id=?',this.now(),this.now(),id);
    });
  }
  private async recipe(db:DB,id:string) {
    const item=await db.getFirstAsync<RecipeRow>('SELECT * FROM recipes WHERE id=? AND deleted_at IS NULL',id);
    if (!item) throw new Error('菜谱不存在或已删除');
    const links=await db.getAllAsync<{ingredient_id:string;is_main:number;quantity:string|null;unit:string|null}>('SELECT ingredient_id,is_main,quantity,unit FROM recipe_ingredients WHERE recipe_id=? ORDER BY position',id);
    const ingredients=await Promise.all(links.map(async link=>({...await this.ingredient(db,link.ingredient_id),ingredient_id:link.ingredient_id,is_main:!!link.is_main,quantity:link.quantity,unit:link.unit})));
    return {id:item.id,name:item.name,category_id:item.category_id,is_hearty:!!item.is_hearty,is_hidden:!!item.is_hidden,steps:item.steps,notes:item.notes,cook_time_minutes:item.cook_time_minutes,flavor_tags:JSON.parse(item.flavor_tags),scene_tags:JSON.parse(item.scene_tags),updated_at:item.updated_at,ingredients};
  }
  async getRecipe(id:string) { return this.recipe(this.db,id); }
  async listRecipes(options:{q?:string; category?:string; ingredientId?:string; visibility?:string;limit?:number;offset?:number}={}) {
    const all=await this.db.getAllAsync<RecipeRow>('SELECT * FROM recipes WHERE deleted_at IS NULL ORDER BY created_at DESC,id');
    const query=normalizeName(options.q||'');
    const refs=options.ingredientId ? await this.db.getAllAsync<{recipe_id:string}>('SELECT recipe_id FROM recipe_ingredients WHERE ingredient_id=?',options.ingredientId) : [];
    const ids=new Set(refs.map(r=>r.recipe_id));
    const rows=all.filter(r=>(options.visibility==='all'||!!r.is_hidden===(options.visibility==='hidden')) && (!query||normalizeName(r.name).includes(query)) && (!options.category||(options.category==='hearty' ? r.category_id==='hearty'||!!r.is_hearty : r.category_id===options.category)) && (!options.ingredientId||ids.has(r.id)));
    return {items:await Promise.all(rows.slice(options.offset||0,(options.offset||0)+(options.limit||30)).map(r=>this.recipe(this.db,r.id))),total:rows.length};
  }
  async saveRecipe(input:RecipeInput,id?:string) {
    const name=input.name.trim();
    if (!name || name.length>100 || !input.category_id) throw new Error('请填写菜名和分类');
    if (!Array.isArray(input.ingredients)||!input.ingredients.length||input.ingredients.length>50||!input.ingredients.some(i=>i.is_main)||new Set(input.ingredients.map(i=>i.ingredient_id)).size!==input.ingredients.length) throw new Error('菜谱至少需要一项主要食材，且不能重复');
    if (input.ingredients.some(i=>(i.quantity==null)!==(i.unit==null) || i.quantity!=null && (!Number.isFinite(Number(i.quantity)) || Number(i.quantity)<=0 || !i.unit?.trim()))) throw new Error('用量和单位需要一起填写');
    if (input.cook_time_minutes!==null && (!Number.isInteger(input.cook_time_minutes)||input.cook_time_minutes<1||input.cook_time_minutes>1440)) throw new Error('烹饪时间需为1到1440的整数');
    const recipeId=id||this.newId(), now=this.now();
    await this.db.withExclusiveTransactionAsync(async tx=>{
      const existing=id ? await this.recipe(tx,id) : null;
      const category=await tx.getFirstAsync('SELECT id FROM dish_categories WHERE id=? AND is_active=1',input.category_id);
      if (!category) throw new Error('请选择有效的菜品分类');
      for (const link of input.ingredients) await this.ingredient(tx,link.ingredient_id);
      if (existing) {
        await tx.runAsync('UPDATE recipes SET name=?,normalized_name=?,category_id=?,is_hearty=?,steps=?,notes=?,cook_time_minutes=?,is_hidden=?,constraint_facts=?,updated_at=? WHERE id=?',name,normalizeName(name),input.category_id,Number(input.is_hearty),input.steps,input.notes,input.cook_time_minutes,Number(input.is_hidden??existing.is_hidden),'[]',now,recipeId);
        await tx.runAsync('DELETE FROM recipe_ingredients WHERE recipe_id=?',recipeId);
      } else {
        await tx.runAsync('INSERT INTO recipes(id,name,normalized_name,category_id,is_hearty,source,steps,notes,cook_time_minutes,flavor_tags,scene_tags,constraint_facts,is_hidden,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',recipeId,name,normalizeName(name),input.category_id,Number(input.is_hearty),'family',input.steps,input.notes,input.cook_time_minutes,JSON.stringify(input.flavor_tags||[]),JSON.stringify(input.scene_tags||[]),'[]',0,now,now);
      }
      for (const [position,link] of input.ingredients.entries()) await tx.runAsync('INSERT INTO recipe_ingredients(recipe_id,ingredient_id,is_main,quantity,unit,position) VALUES (?,?,?,?,?,?)',recipeId,link.ingredient_id,Number(link.is_main),link.quantity,link.unit,position);
    });
    return this.recipe(this.db,recipeId);
  }
  async deleteRecipe(id:string) { await this.recipe(this.db,id); await this.db.runAsync('UPDATE recipes SET deleted_at=?,updated_at=? WHERE id=?',this.now(),this.now(),id); }
}
