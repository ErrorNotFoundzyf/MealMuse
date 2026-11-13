import type { SQLiteDatabase } from 'expo-sqlite';
import type { MealDish, Season } from '../types';
import { LocalCatalog } from './catalog.ts';
import { filterCandidates, recentDayStart } from './candidates.ts';
import { seasonForMonth } from './season.ts';

export type LocalCandidate = MealDish & { is_hidden:boolean; deleted_at:null; season_coverage:number; season_warnings:string[]; ingredients:(MealDish['ingredients'][number] & {seasons:Season[];is_hidden:boolean;deleted_at:null})[] };

/** Read fresh catalogue and confirmed meals before every automatic recommendation. */
export async function loadCandidatePool(db:SQLiteDatabase, options:{today:string;allowNonseasonal:boolean;rejectedIds?:string[];rejectedSignatures?:string[]}):Promise<LocalCandidate[]> {
  const season=seasonForMonth(Number(options.today.slice(5,7)));
  const start=recentDayStart(options.today);
  const records=await db.getAllAsync<{meal_date:string;deleted_at:string|null;dishes:string}>('SELECT meal_date,deleted_at,dishes FROM meal_records WHERE deleted_at IS NULL AND meal_date>=? AND meal_date<=?',start,options.today);
  const categories=await db.getAllAsync<{id:string;name:string}>('SELECT id,name FROM dish_categories WHERE is_active=1');
  const categoryNames=new Map(categories.map(c=>[c.id,c.name]));
  const catalog=new LocalCatalog(db,()=>{throw new Error('读取菜谱不应创建记录');});
  const all:Awaited<ReturnType<LocalCatalog['getRecipe']>>[]=[];
  for (let offset=0;;offset+=100) {
    const page=await catalog.listRecipes({limit:100,offset});
    all.push(...page.items);
    if (offset+page.items.length>=page.total || !page.items.length) break;
  }
  const dishes:LocalCandidate[]=all.map(recipe=>({
    recipe_id:recipe.id,name:recipe.name,category_id:recipe.category_id,is_hearty:recipe.is_hearty,
    category_name:(categoryNames.get(recipe.category_id)||'未分类')+(recipe.is_hearty&&recipe.category_id!=='hearty'?' · 硬菜':''),
    is_hidden:recipe.is_hidden,deleted_at:null,steps:recipe.steps,notes:recipe.notes,cook_time_minutes:recipe.cook_time_minutes,
    season_coverage:0,season_warnings:[],ingredients:recipe.ingredients.map(i=>({ingredient_id:i.ingredient_id,name:i.name,is_main:i.is_main,quantity:i.quantity,unit:i.unit,seasons:i.seasons,is_hidden:i.is_hidden,deleted_at:null})),
  }));
  const parsed=records.map(record=>({...record,dishes:JSON.parse(record.dishes) as MealDish[]}));
  return filterCandidates(dishes,parsed,{...options,season}) as LocalCandidate[];
}

export function publicDish(candidate:LocalCandidate):MealDish {
  return {recipe_id:candidate.recipe_id,name:candidate.name,category_id:candidate.category_id,category_name:candidate.category_name,is_hearty:candidate.is_hearty,
    ingredients:candidate.ingredients.map(i=>({ingredient_id:i.ingredient_id,name:i.name,is_main:i.is_main,quantity:i.quantity,unit:i.unit})),
    steps:candidate.steps,notes:candidate.notes,cook_time_minutes:candidate.cook_time_minutes,season_warnings:candidate.season_warnings};
}
