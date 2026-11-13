import type { SQLiteDatabase } from 'expo-sqlite';
import { LocalCatalog } from './catalog.ts';
import { loadCandidatePool, publicDish } from './recommendation-data.ts';
import type { LocalAiMemory } from './ai-turn.ts';

type MealRow = {id:string;meal_date:string;people_count:number;dishes:string;creation_key:string;last_request_key:string;payload_hash:string;revision:number;confirmed_at:string;updated_at:string;deleted_at:string|null};
type MealDish = {recipe_id:string;name:string;category_id:string;category_name:string;is_hearty:boolean;ingredients:{ingredient_id:string;name:string;is_main:boolean;quantity:string|null;unit:string|null}[];steps:string|null;notes:string|null;cook_time_minutes:number|null};
type MealInput = {meal_date:string;people_count:number;recipe_ids:string[];request_key:string;revision?:number;plan_id?:string;plan_revision?:number;manual_adjustment?:boolean;use_current_menu?:boolean;acknowledge_unknown?:boolean};
type DB = Pick<SQLiteDatabase,'getFirstAsync'|'getAllAsync'|'runAsync'>;
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const data=(row:MealRow)=>({id:row.id,meal_date:row.meal_date,people_count:row.people_count,dishes:JSON.parse(row.dishes) as MealDish[],revision:row.revision,confirmed_at:row.confirmed_at,updated_at:row.updated_at});
const dishIdentity=(dish:MealDish)=>JSON.stringify({recipe_id:dish.recipe_id,name:dish.name,category_id:dish.category_id,category_name:dish.category_name,is_hearty:dish.is_hearty,ingredients:dish.ingredients,steps:dish.steps,notes:dish.notes,cook_time_minutes:dish.cook_time_minutes});
const hash=(body:MealInput)=>JSON.stringify({meal_date:body.meal_date,people_count:body.people_count,recipe_ids:body.recipe_ids,plan_id:body.plan_id??null,plan_revision:body.plan_revision??null,manual_adjustment:!!body.manual_adjustment,use_current_menu:!!body.use_current_menu,acknowledge_unknown:!!body.acknowledge_unknown});

function validate(body:MealInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.meal_date)||Number.isNaN(Date.parse(body.meal_date))||new Date(`${body.meal_date}T00:00:00Z`).toISOString().slice(0,10)!==body.meal_date||body.meal_date>today()) throw new Error('食记只记录今天和过去的有效日期');
  if (!Number.isInteger(body.people_count)||body.people_count<1||body.people_count>30) throw new Error('请选择有效的用餐人数');
  if (!Array.isArray(body.recipe_ids)||body.recipe_ids.length<1||body.recipe_ids.length>20||body.recipe_ids.some(i=>typeof i!=='string'||!i)||new Set(body.recipe_ids).size!==body.recipe_ids.length) throw new Error('菜单至少需要一道菜，同一份菜单不能重复选择');
  if (typeof body.request_key!=='string'||body.request_key.length<16||body.request_key.length>80) throw new Error('保存请求无效，请重试');
  if (!!body.plan_id !== (body.plan_revision !== undefined)) throw new Error('推荐菜单版本不完整，请重新搭配');
}

export function createLocalMealApi(db:SQLiteDatabase,newId:()=>string) {
  async function active(tx:DB,id:string) {
    const row=await tx.getFirstAsync<MealRow>('SELECT * FROM meal_records WHERE id=? AND deleted_at IS NULL',id);
    if (!row) throw new Error('这份食记不存在或已删除');
    return row;
  }
  async function snapshots(tx:DB,ids:string[],previous:MealDish[]=[]):Promise<MealDish[]> {
    const catalog=new LocalCatalog(tx as SQLiteDatabase,newId);
    const result:MealDish[]=[];
    for (const id of ids) {
      const old=previous.find(d=>d.recipe_id===id);
      if (old) { result.push(old); continue; }
      const recipe=await catalog.getRecipe(id);
      if (recipe.is_hidden) throw new Error('所选菜谱已隐藏，请重新选择');
      const category=await tx.getFirstAsync<{name:string}>('SELECT name FROM dish_categories WHERE id=?',recipe.category_id);
      if (!category) throw new Error('菜品分类不存在，请重新选择');
      result.push({recipe_id:id,name:recipe.name,category_id:recipe.category_id,category_name:category.name+(recipe.is_hearty&&recipe.category_id!=='hearty'?' · 硬菜':''),is_hearty:recipe.is_hearty,ingredients:recipe.ingredients.map(i=>({ingredient_id:i.ingredient_id,name:i.name,is_main:i.is_main,quantity:i.quantity,unit:i.unit})),steps:recipe.steps,notes:recipe.notes,cook_time_minutes:recipe.cook_time_minutes});
    }
    return result;
  }
  return async (path:string,options:RequestInit={}):Promise<unknown>=>{
    const url=new URL(path,'https://local.invalid'),method=(options.method||'GET').toUpperCase();
    const id=url.pathname.split('/')[2];
    if (url.pathname==='/meal-records'&&method==='GET') {
      const month=url.searchParams.get('month')||'';
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('请选择有效月份');
      const rows=await db.getAllAsync<MealRow>('SELECT * FROM meal_records WHERE deleted_at IS NULL AND meal_date LIKE ? ORDER BY meal_date,confirmed_at,id',`${month}-%`);
      return {items:rows.map(data)};
    }
    if (id && url.pathname===`/meal-records/${id}`&&method==='GET') return data(await active(db,id));
    if (id && url.pathname===`/meal-records/${id}`&&method==='DELETE') {
      const revision=Number(url.searchParams.get('revision'));
      await db.withExclusiveTransactionAsync(async tx=>{
        const row=await tx.getFirstAsync<MealRow>('SELECT * FROM meal_records WHERE id=?',id);
        if (!row) throw new Error('食记不存在');
        if (row.deleted_at) return;
        if (row.revision!==revision) throw new Error('食记已更新，请刷新后再删除');
        const now=new Date().toISOString(); await tx.runAsync('UPDATE meal_records SET deleted_at=?,updated_at=? WHERE id=?',now,now,id);
      });
      return;
    }
    if ((url.pathname==='/meal-records'&&method==='POST')||(id&&url.pathname===`/meal-records/${id}`&&method==='PUT')) {
      const body=JSON.parse(String(options.body||'{}')) as MealInput; validate(body);
      let result:ReturnType<typeof data>|undefined;
      await db.withExclusiveTransactionAsync(async tx=>{
        const fingerprint=hash(body),now=new Date().toISOString();
        if (method==='POST') {
          const existing=await tx.getFirstAsync<MealRow>('SELECT * FROM meal_records WHERE creation_key=?',body.request_key);
          if (existing) { if(existing.deleted_at||existing.payload_hash!==fingerprint||existing.revision!==1) throw new Error('这次确认已处理，请查看食记后再操作'); result=data(existing); return; }
          if (body.revision!==undefined) throw new Error('新建菜单不需要版本号');
          let plannedDishes:MealDish[]|undefined;
          if (body.plan_id) {
            const plan=await tx.getFirstAsync<{revision:number;dishes:string;allow_nonseasonal:number;confirmed_record_id:string|null;ai_memory:string|null}>('SELECT revision,dishes,allow_nonseasonal,confirmed_record_id,ai_memory FROM rule_plans WHERE id=?',body.plan_id);
            if (!plan||plan.confirmed_record_id||plan.revision!==body.plan_revision) throw new Error('推荐菜单已更新或确认，请重新读取');
            const memory:LocalAiMemory|null=plan.ai_memory?JSON.parse(plan.ai_memory):null;
            if(memory?.blocked&&!body.use_current_menu)throw new Error('本轮要求尚未完成，请先选择是否使用当前菜单');
            if(memory?.constraints.length&&!body.acknowledge_unknown)throw new Error('请先核对配料和做法');
            plannedDishes=JSON.parse(plan.dishes) as MealDish[];
            if (body.meal_date!==today() || !body.manual_adjustment && JSON.stringify(body.recipe_ids)!==JSON.stringify(plannedDishes.map(d=>d.recipe_id))) throw new Error('推荐内容或日期已变化，请重新搭配');
            if(memory){
              const actual=await snapshots(tx,body.recipe_ids);
              const excluded=new Set(memory.constraints.flatMap(c=>c.ingredient_id?[c.ingredient_id]:[]));
              if(actual.some(d=>d.ingredients.some(i=>excluded.has(i.ingredient_id))))throw new Error('菜单包含本餐忌口食材，请调整后确认');
              if(!body.manual_adjustment&&!memory.blocked&&memory.hearty_count!==null&&actual.filter(d=>d.is_hearty).length!==memory.hearty_count)throw new Error('菜单中的硬菜数量已变化，请重新搭配');
            }
            if (!body.manual_adjustment) {
              const pool=await loadCandidatePool(tx as SQLiteDatabase,{today:today(),allowNonseasonal:!!plan.allow_nonseasonal});
              const manual=await tx.getFirstAsync<{value:string}>('SELECT value FROM local_metadata WHERE key=?',`manual_plan:${body.plan_id}`);
              const retained=new Set<string>(manual ? JSON.parse(manual.value) : []);
              for (const dish of plannedDishes) {
                if (retained.has(dish.recipe_id)) {
                  const fresh=await snapshots(tx,[dish.recipe_id]);
                  if (!fresh[0]||dishIdentity(fresh[0])!==dishIdentity(dish)) throw new Error('手动选择的菜谱已变化，请重新选择');
                  continue;
                }
                const fresh=pool.find(d=>d.recipe_id===dish.recipe_id);
                if (!fresh||dishIdentity({...publicDish(fresh),is_hearty:!!fresh.is_hearty,steps:fresh.steps??null,notes:fresh.notes??null,cook_time_minutes:fresh.cook_time_minutes??null})!==dishIdentity(dish)) throw new Error('菜谱、季节或近期记录已变化，请重新搭配后确认');
              }
            }
          }
          const recordId=newId(),dishes=await snapshots(tx,body.recipe_ids,plannedDishes);
          await tx.runAsync('INSERT INTO meal_records(id,meal_date,people_count,dishes,creation_key,last_request_key,payload_hash,revision,confirmed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',recordId,body.meal_date,body.people_count,JSON.stringify(dishes),body.request_key,body.request_key,fingerprint,1,now,now);
          if (body.plan_id) await tx.runAsync('UPDATE rule_plans SET confirmed_record_id=? WHERE id=?',recordId,body.plan_id);
          result=data(await active(tx,recordId)); return;
        }
        if (!id) throw new Error('食记不存在');
        const row=await active(tx,id);
        if (row.last_request_key===body.request_key) { if(row.payload_hash!==fingerprint) throw new Error('保存请求内容已变化'); result=data(row); return; }
        if (row.revision!==body.revision) throw new Error('食记已更新，请重新打开后再修改');
        const dishes=await snapshots(tx,body.recipe_ids,JSON.parse(row.dishes));
        await tx.runAsync('UPDATE meal_records SET meal_date=?,people_count=?,dishes=?,last_request_key=?,payload_hash=?,revision=revision+1,updated_at=? WHERE id=?',body.meal_date,body.people_count,JSON.stringify(dishes),body.request_key,fingerprint,now,id);
        result=data(await active(tx,id));
      });
      if (!result) throw new Error('食记保存未完成');
      return result;
    }
    throw new Error(`本地食记接口尚未实现：${method} ${url.pathname}`);
  };
}
