import type { SQLiteDatabase } from 'expo-sqlite';
import { LocalCatalog } from './catalog.ts';
import { seasonForMonth,seasonStatus } from './season.ts';
import type { MealDish,Season } from '../types';

type Input={recipe_ids:string[];record_id?:string;revision?:number;plan_id?:string;plan_revision?:number};
type Row={ingredient_id:string;name:string;recipe_names:string[];amounts:{quantity:string|null;unit:string|null}[]};
function sumAmounts(values:string[]):string|null {
  let total=0n;
  for(const value of values){
    const match=/^(\d+)(?:\.(\d{1,3}))?$/.exec(value);
    if(!match)return null;
    total+=BigInt(match[1]!)*1000n+BigInt((match[2]||'').padEnd(3,'0'));
  }
  const whole=total/1000n,decimal=String(total%1000n).padStart(3,'0').replace(/0+$/,'');
  return decimal?`${whole}.${decimal}`:String(whole);
}
export function createLocalShoppingApi(db:SQLiteDatabase) {
  return async (body:Input)=>{
    if(!Array.isArray(body.recipe_ids)||body.recipe_ids.length<1||body.recipe_ids.length>20||new Set(body.recipe_ids).size!==body.recipe_ids.length)throw new Error('请选择不重复的菜品');
    let previous:MealDish[]=[];
    if(body.record_id){
      const row=await db.getFirstAsync<{revision:number;deleted_at:string|null;dishes:string}>('SELECT revision,deleted_at,dishes FROM meal_records WHERE id=?',body.record_id);
      if(!row||row.deleted_at||row.revision!==body.revision)throw new Error('食记已更新，请重新打开');previous=JSON.parse(row.dishes);
    }else if(body.plan_id){
      const row=await db.getFirstAsync<{revision:number;dishes:string}>('SELECT revision,dishes FROM rule_plans WHERE id=?',body.plan_id);
      if(!row||row.revision!==body.plan_revision)throw new Error('菜单已更新，请重新打开');previous=JSON.parse(row.dishes);
    }
    const catalog=new LocalCatalog(db,()=>{throw new Error('读取菜谱不应创建记录');});
    const grouped=new Map<string,Row>();
    for(const id of body.recipe_ids){
      const saved=previous.find(d=>d.recipe_id===id);
      const recipe=saved||await catalog.getRecipe(id);
      if(!saved && 'is_hidden' in recipe && recipe.is_hidden)throw new Error('所选菜谱已隐藏，请重新选择');
      for(const item of recipe.ingredients){
        if(!item.is_main)continue;
        const row=grouped.get(item.ingredient_id)||{ingredient_id:item.ingredient_id,name:item.name,recipe_names:[],amounts:[]};
        row.recipe_names.push(recipe.name);row.amounts.push({quantity:item.quantity,unit:item.unit});grouped.set(item.ingredient_id,row);
      }
    }
    const season=seasonForMonth(Number(new Date(Date.now()+8*3600000).toISOString().slice(5,7)));
    const items=[];
    for(const row of grouped.values()){
      const complete=row.amounts.every(a=>a.quantity!==null&&!!a.unit),units=new Set(row.amounts.map(a=>a.unit));
      const quantity=complete&&units.size===1?sumAmounts(row.amounts.map(a=>a.quantity!)):null;
      const ingredient=await db.getFirstAsync<{seasons_json:string}>('SELECT seasons_json FROM ingredients WHERE id=?',row.ingredient_id);
      items.push({ingredient_id:row.ingredient_id,name:row.name,recipe_names:row.recipe_names,quantity,unit:quantity!==null?row.amounts[0]?.unit:null,note:quantity!==null?'':!complete?'用量未完整记录':'单位不同或用量无效，未合并',season_status:seasonStatus(ingredient?JSON.parse(ingredient.seasons_json) as Season[]:[],season)});
    }
    return {items};
  };
}
