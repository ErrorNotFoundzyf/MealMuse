import type { SQLiteDatabase } from 'expo-sqlite';
import { LocalCatalog, type IngredientInput, type RecipeInput } from './catalog.ts';
import { seasonForMonth } from './season.ts';

type ProfileRow = {people_count:number;category_counts_json:string;updated_at:string};
const mainCategories = new Set(['meat','vegetable','soup']);

/** Implement the existing catalogue API contract locally. Recommendation routes are handled separately. */
export function createLocalCatalogApi(db:SQLiteDatabase, newId:()=>string) {
  const catalog = new LocalCatalog(db,newId);
  return async (path:string, options:RequestInit = {}):Promise<unknown> => {
    const url=new URL(path,'https://local.invalid');
    const method=(options.method||'GET').toUpperCase();
    const params=url.searchParams;
    const body=options.body ? JSON.parse(String(options.body)) : {};
    const visibility=params.get('visibility')||'visible';
    const limit=Math.min(100,Math.max(1,Number(params.get('limit'))||30));
    const offset=Math.max(0,Number(params.get('offset'))||0);
    const id=url.pathname.split('/')[2];
    if (url.pathname==='/time-context' && method==='GET') {
      const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
      return {as_of_date:date,current_season:seasonForMonth(Number(date.slice(5,7))),timezone:'Asia/Shanghai',calendar_id:'month_based_v1'};
    }
    if (url.pathname==='/dish-categories' && method==='GET') return db.getAllAsync('SELECT id,name FROM dish_categories WHERE is_active=1 ORDER BY sort_order');
    if (url.pathname==='/profile' && method==='GET') {
      const row=await db.getFirstAsync<ProfileRow>('SELECT people_count,category_counts_json,updated_at FROM family_meal_profile WHERE id=1');
      if (!row) return {profile:null};
      const counts=Object.fromEntries(Object.entries(JSON.parse(row.category_counts_json) as Record<string,number>).filter(([key])=>mainCategories.has(key)));
      return {profile:{people_count:row.people_count,category_counts:counts,total_dishes:Object.values(counts).reduce((a,b)=>a+b,0),updated_at:row.updated_at}};
    }
    if (url.pathname==='/profile' && method==='PUT') {
      const counts=body.category_counts as Record<string,unknown>;
      if (!Number.isInteger(body.people_count)||body.people_count<1||body.people_count>30||!counts||typeof counts!=='object'||Array.isArray(counts)||Object.entries(counts).some(([k,v])=>!mainCategories.has(k)||!Number.isInteger(v)||Number(v)<0||Number(v)>20)) throw new Error('请检查用餐人数和菜数');
      const total=Object.values(counts).reduce<number>((a,b)=>a+Number(b),0);
      if (total<1||total>20) throw new Error('总菜数必须在1到20之间');
      await db.runAsync('INSERT INTO family_meal_profile(id,people_count,category_counts_json,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET people_count=excluded.people_count, category_counts_json=excluded.category_counts_json, updated_at=excluded.updated_at',body.people_count,JSON.stringify(counts),new Date().toISOString());
      return {profile:{people_count:body.people_count,category_counts:counts,total_dishes:total}};
    }
    if (url.pathname==='/ingredients' && method==='GET') return catalog.listIngredients({q:params.get('q')||'',category:params.get('ingredient_category')||'',season:params.get('season')||'',includeAllYear:params.get('include_all_year')!=='false',visibility,limit,offset});
    if (url.pathname==='/ingredients' && method==='POST') return catalog.saveIngredient(body as IngredientInput);
    if (id && url.pathname===`/ingredients/${id}`) {
      if (method==='GET') return catalog.getIngredient(id);
      if (method==='PATCH') return catalog.saveIngredient(body as IngredientInput,id);
      if (method==='DELETE') return catalog.deleteIngredient(id);
    }
    if (url.pathname==='/recipes' && method==='GET') return catalog.listRecipes({q:params.get('q')||'',category:params.get('category_id')||'',ingredientId:params.get('ingredient_id')||'',visibility,limit,offset});
    if (url.pathname==='/recipes' && method==='POST') return catalog.saveRecipe(body as RecipeInput);
    if (id && url.pathname===`/recipes/${id}`) {
      if (method==='GET') return catalog.getRecipe(id);
      if (method==='PATCH') return catalog.saveRecipe(body as RecipeInput,id);
      if (method==='DELETE') return catalog.deleteRecipe(id);
    }
    throw new Error(`本地接口尚未实现：${method} ${url.pathname}`);
  };
}
