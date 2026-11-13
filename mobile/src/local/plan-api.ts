import type { SQLiteDatabase } from 'expo-sqlite';
import { loadCandidatePool, publicDish } from './recommendation-data.ts';
import { dishSignature } from './candidates.ts';
import { selectMenu } from './select-menu.ts';
import { LocalCatalog } from './catalog.ts';
import type { LocalCandidate } from './recommendation-data.ts';
import type { MealDish } from '../types';
import type { LocalAiMemory } from './ai-turn.ts';
import {needsSemanticReview} from './candidate-review.ts';
import { recipeToDish } from '../recipe-dish.ts';

export type PlanRow={id:string;creation_key:string;creation_hash:string;last_request_key:string;last_payload_hash:string;people_count:number;category_counts:string;dishes:string;rejected_ids:string;rejected_signatures:string;allow_nonseasonal:number;revision:number;as_of_date:string;confirmed_record_id:string|null;ai_memory:string|null};
type Request={request_key:string;people_count?:number;category_counts?:Record<string,number>;allow_nonseasonal?:boolean;expected_revision?:number;recipe_id?:string;action?:string;selected_recipe_ids?:string[];plan_id?:string};
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const fingerprint=(body:Request)=>JSON.stringify(Object.fromEntries(Object.entries(body).filter(([k])=>k!=='request_key').sort(([a],[b])=>a.localeCompare(b))));
export const planSnapshot=(row:PlanRow)=>{
  const memory=row.ai_memory ? JSON.parse(row.ai_memory) : null;
  const counts:Record<string,number>={};for(const dish of memory?.candidate_pool||[])counts[dish.category_id]=(counts[dish.category_id]||0)+1;
  return {id:row.id,revision:row.revision,people_count:row.people_count,category_counts:JSON.parse(row.category_counts),as_of_date:row.as_of_date,dishes:JSON.parse(row.dishes) as MealDish[],allow_nonseasonal:!!row.allow_nonseasonal,confirmed_record_id:row.confirmed_record_id,shopping_list:[],mode:memory?'chat':'rules',ai:memory?{messages:memory.messages||[],constraints:memory.constraints||[],blocked:!!memory.blocked,can_use_current_menu:!!JSON.parse(row.dishes).length,unknown:memory.unknown||[],pending:memory.pending||[],hearty_count:memory.hearty_count??null,has_candidate_pool:Array.isArray(memory.candidate_pool),candidate_counts:counts,pool_version:memory.pool_version||0,last_action:memory.last_action||'chat'}:null};
};
const snapshot=planSnapshot;
function selectCombination(pool:LocalCandidate[],counts:Record<string,number>,avoidIds:string[],heartyCount:number|null=null):MealDish[] {
  const base=Object.fromEntries(Object.entries(counts).filter(([k])=>['meat','vegetable','soup'].includes(k)));
  const extras:LocalCandidate[]=[];
  for(const category of ['staple','fruit','dessert']) {
    const amount=counts[category]||0;
    const available=pool.filter(d=>d.category_id===category).map(d=>({dish:d,rank:Math.random()+(avoidIds.includes(d.recipe_id)?-2:0)})).sort((a,b)=>b.rank-a.rank);
    const distinct=available.filter((item,index)=>available.findIndex(x=>dishSignature(x.dish)===dishSignature(item.dish))===index);
    if(distinct.length<amount)throw new Error(`${category==='fruit'?'水果':category==='staple'?'主食':'甜点'}菜谱不足，当前菜单已保留`);
    extras.push(...distinct.slice(0,amount).map(x=>x.dish));
  }
  const mainHearty=heartyCount===null?null:heartyCount-extras.filter(d=>d.is_hearty).length;
  const selected=Object.values(base).some(v=>v>0)?selectMenu(pool,base,{avoidIds,heartyCount:mainHearty}).map(d=>publicDish(d as LocalCandidate)):[];
  if(!Object.values(base).some(v=>v>0)&&mainHearty!==null&&mainHearty!==0)throw new Error('暂时无法满足硬菜数量，当前菜单已保留');
  selected.push(...extras.map(publicDish));
  if(!selected.length)throw new Error('请至少选择一道菜');
  return selected;
}

export function createLocalPlanApi(db:SQLiteDatabase,newId:()=>string) {
  async function get(tx:Pick<SQLiteDatabase,'getFirstAsync'>,id:string):Promise<PlanRow> {
    const row=await tx.getFirstAsync<PlanRow>('SELECT * FROM rule_plans WHERE id=?',id);
    if (!row) throw new Error('推荐菜单不存在'); return row;
  }
  async function create(body:Request) {
    if (!body.request_key || body.request_key.length<16 || body.request_key.length>80) throw new Error('请求无效，请重试');
    const digest=fingerprint(body); let result:ReturnType<typeof snapshot>|undefined;
    await db.withExclusiveTransactionAsync(async tx=>{
      const old=await tx.getFirstAsync<PlanRow>('SELECT * FROM rule_plans WHERE creation_key=?',body.request_key);
      if (old) { if (old.creation_hash!==digest) throw new Error('这次请求的内容已变化，请重新生成'); result=snapshot(old); return; }
      const profile=await tx.getFirstAsync<{people_count:number;category_counts_json:string}>('SELECT people_count,category_counts_json FROM family_meal_profile WHERE id=1');
      const people=body.people_count??profile?.people_count;
      const counts=(body.category_counts??(profile ? JSON.parse(profile.category_counts_json) : undefined)) as Record<string,number>|undefined;
      if (!people||!Number.isInteger(people)||people<1||people>30||!counts) throw new Error('请先设置人数和菜品构成');
      const date=today();
      const pool=await loadCandidatePool(tx as SQLiteDatabase,{today:date,allowNonseasonal:!!body.allow_nonseasonal});
      const selected=body.selected_recipe_ids??[];
      if(!Array.isArray(selected)||selected.length>20||new Set(selected).size!==selected.length||selected.some(id=>typeof id!=='string'))throw new Error('已选菜品无效');
      const retained:MealDish[]=[];
      const catalog=new LocalCatalog(tx as SQLiteDatabase,newId);
      for(const id of selected){const recipe=await catalog.getRecipe(id);if(recipe.is_hidden)throw new Error('已选菜谱已隐藏，请重新选择');retained.push(recipeToDish(recipe));}
      // Validate the requested base composition even if the existing selection fills every slot.
      if(Object.entries(counts).some(([k,v])=>!['meat','vegetable','soup'].includes(k)||!Number.isInteger(v)||Number(v)<0)||Object.values(counts).reduce((n,v)=>n+Number(v),0)<1||Object.values(counts).reduce((n,v)=>n+Number(v),0)>20)throw new Error('请设置1到20道荤菜、素菜和汤');
      const remaining:Record<string,number>={};for(const [category,count] of Object.entries(counts))remaining[category]=Math.max(0,Number(count)-retained.filter(d=>d.category_id===category).length);
      const used=new Set(retained.map(dishSignature));
      const additions=Object.values(remaining).some(n=>n>0)?selectMenu(pool.filter(d=>!used.has(dishSignature(d))),remaining).map(d=>publicDish(d as typeof pool[number])):[];
      const dishes=[...retained,...additions];if(dishes.length>20)throw new Error('本餐最多20道菜，请减少已选菜品或菜数');
      const actualCounts=retained.length?Object.fromEntries(['meat','vegetable','soup'].map(c=>[c,dishes.filter(d=>d.category_id===c).length])):counts;
      const id=newId(),now=new Date().toISOString();
      await tx.runAsync('INSERT INTO rule_plans(id,creation_key,creation_hash,last_request_key,last_payload_hash,people_count,category_counts,dishes,rejected_ids,rejected_signatures,allow_nonseasonal,revision,as_of_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,body.request_key,digest,body.request_key,digest,people,JSON.stringify(counts),JSON.stringify(dishes),'[]','[]',Number(!!body.allow_nonseasonal),1,date,now,now);
      if(retained.length){await tx.runAsync('UPDATE rule_plans SET category_counts=? WHERE id=?',JSON.stringify(actualCounts),id);await tx.runAsync('INSERT INTO local_metadata(key,value) VALUES (?,?)',`manual_plan:${id}`,JSON.stringify(retained.map(d=>d.recipe_id)));}
      result=snapshot(await get(tx,id));
    });
    if (!result) throw new Error('菜单生成未完成'); return result;
  }
  async function change(id:string,body:Request,regenerate:boolean) {
    if (!body.request_key || body.request_key.length<16 || body.request_key.length>80) throw new Error('请求无效，请重试');
    const digest=fingerprint(body);let result:ReturnType<typeof snapshot>|undefined;
    await db.withExclusiveTransactionAsync(async tx=>{
      const row=await get(tx,id);
      if (row.last_request_key===body.request_key) { if(row.last_payload_hash!==digest) throw new Error('请求内容已变化，请重新操作'); result=snapshot(row); return; }
      if(row.confirmed_record_id||row.revision!==body.expected_revision) throw new Error('菜单已更新，请重新读取');
      const dishes=JSON.parse(row.dishes) as MealDish[],rejectedIds=JSON.parse(row.rejected_ids) as string[],rejectedSigs=JSON.parse(row.rejected_signatures) as string[];
      let pool=await loadCandidatePool(tx as SQLiteDatabase,{today:today(),allowNonseasonal:!!row.allow_nonseasonal});
      const memory:LocalAiMemory|null=row.ai_memory?JSON.parse(row.ai_memory):null;
      if(memory){
        const blocked=new Set(memory.constraints.flatMap(c=>c.ingredient_id?[c.ingredient_id]:[]));
        const approved=new Map(memory.candidate_pool.map(d=>[d.recipe_id,d]));
        const comparable=(d:MealDish)=>JSON.stringify({name:d.name,category_id:d.category_id,is_hearty:d.is_hearty,ingredients:d.ingredients,steps:d.steps,notes:d.notes,cook_time_minutes:d.cook_time_minutes});
        pool=pool.filter(d=>{const previous=approved.get(d.recipe_id);return (!needsSemanticReview(memory)||previous&&comparable(publicDish(previous))===comparable(publicDish(d)))&&!d.ingredients.some(i=>blocked.has(i.ingredient_id));});
      }
      let updated:MealDish[];
      if (regenerate) {
        const counts:Record<string,number>=JSON.parse(row.category_counts);
        for(const dish of dishes)if(['staple','fruit','dessert'].includes(dish.category_id))counts[dish.category_id]=(counts[dish.category_id]||0)+1;
        updated=selectCombination(pool,counts,dishes.map(d=>d.recipe_id),memory?.hearty_count??null);
      }
      else {
        const target=dishes.find(d=>d.recipe_id===body.recipe_id);
        if (!target) throw new Error('请选择当前菜单中的一道菜');
        const used=new Set(dishes.map(dishSignature));
        const heartyNeeded=memory?.hearty_count;
        const otherHearty=dishes.filter(d=>d.recipe_id!==target.recipe_id&&d.is_hearty).length;
        const candidates=pool.filter(d=>d.category_id===target.category_id&&!used.has(dishSignature(d))&&(heartyNeeded==null||otherHearty+Number(d.is_hearty)===heartyNeeded));
        if (!candidates.length) throw new Error('这一类暂时没有其他合适的菜，当前菜单已保留');
        const others=dishes.filter(d=>d.recipe_id!==target.recipe_id);
        const random=Math.random;
        const ranked=candidates.map(d=>({dish:d,score:d.season_coverage*10-d.ingredients.filter(i=>i.is_main).reduce((n,i)=>n+others.reduce((k,o)=>k+o.ingredients.filter(j=>j.is_main&&j.ingredient_id===i.ingredient_id).length,0),0)*0.7+random()*0.4-(rejectedIds.includes(d.recipe_id)?1:0)})).sort((a,b)=>b.score-a.score);
        updated=dishes.map(d=>d.recipe_id===target.recipe_id?publicDish(ranked[0]!.dish):d);
        rejectedIds.push(target.recipe_id);rejectedSigs.push(dishSignature(target));
      }
      await tx.runAsync('UPDATE rule_plans SET dishes=?,rejected_ids=?,rejected_signatures=?,revision=revision+1,as_of_date=?,updated_at=?,last_request_key=?,last_payload_hash=? WHERE id=?',JSON.stringify(updated),JSON.stringify(rejectedIds),JSON.stringify(rejectedSigs),today(),new Date().toISOString(),body.request_key,digest,id);
      const manual=await tx.getFirstAsync<{value:string}>('SELECT value FROM local_metadata WHERE key=?',`manual_plan:${id}`);
      if (manual) {
        const retained=regenerate ? [] : (JSON.parse(manual.value) as string[]).filter(key=>key!==body.recipe_id);
        await tx.runAsync('UPDATE local_metadata SET value=? WHERE key=?',JSON.stringify(retained),`manual_plan:${id}`);
      }
      result=snapshot(await get(tx,id));
    });
    if (!result) throw new Error('菜单调整未完成');return result;
  }
  async function manualSwap(body:Request) {
    if (!body.request_key || body.request_key.length<16 || body.request_key.length>80 || !body.selected_recipe_ids?.length || body.selected_recipe_ids.length>20 || new Set(body.selected_recipe_ids).size!==body.selected_recipe_ids.length || !['replace','regenerate'].includes(body.action||'') || !body.people_count || body.people_count<1 || body.people_count>30) throw new Error('请选择本餐菜品和人数');
    const digest=fingerprint(body);let result:ReturnType<typeof snapshot>|undefined;
    await db.withExclusiveTransactionAsync(async tx=>{
      const existing=await tx.getFirstAsync<PlanRow>('SELECT * FROM rule_plans WHERE creation_key=?',body.request_key);
      if(existing){if(existing.creation_hash!==digest)throw new Error('换菜内容已变化，请重新操作');result=snapshot(existing);return;}
      const source=body.plan_id ? await get(tx,body.plan_id) : null;
      if(source&&(source.confirmed_record_id||source.revision!==body.expected_revision))throw new Error('菜单已变化，请重新读取');
      const memory:LocalAiMemory|null=source?.ai_memory?JSON.parse(source.ai_memory):null;
      const catalog=new LocalCatalog(tx as SQLiteDatabase,newId),dishes:MealDish[]=[];
      const cats=await tx.getAllAsync<{id:string;name:string}>('SELECT id,name FROM dish_categories WHERE is_active=1');
      for (const id of body.selected_recipe_ids!) {
        const previous=source ? (JSON.parse(source.dishes) as MealDish[]).find(d=>d.recipe_id===id) : undefined;
        if (previous) { dishes.push(previous);continue; }
        const item=await catalog.getRecipe(id);
        if(item.is_hidden)throw new Error('所选菜谱已隐藏，请重新选择');
        const category=cats.find(c=>c.id===item.category_id);
        if(!category||!['meat','vegetable','soup','staple','fruit','dessert'].includes(item.category_id))throw new Error('暂时支持荤菜、素菜、汤、主食、甜点和水果换菜');
        dishes.push({recipe_id:item.id,name:item.name,category_id:item.category_id,is_hearty:item.is_hearty,category_name:category.name+(item.is_hearty&&item.category_id!=='hearty'?' · 硬菜':''),ingredients:item.ingredients.map(i=>({ingredient_id:i.ingredient_id,name:i.name,is_main:i.is_main,quantity:i.quantity,unit:i.unit})),steps:item.steps,notes:item.notes,cook_time_minutes:item.cook_time_minutes});
      }
      const rejectedIds=source ? JSON.parse(source.rejected_ids) as string[] : [],rejectedSignatures=source ? JSON.parse(source.rejected_signatures) as string[] : [];
      let pool=await loadCandidatePool(tx as SQLiteDatabase,{today:today(),allowNonseasonal:!!body.allow_nonseasonal});
      if(memory){
        const approved=new Map(memory.candidate_pool.map(d=>[d.recipe_id,d]));
        const blocked=new Set(memory.constraints.flatMap(c=>c.ingredient_id?[c.ingredient_id]:[]));
        const comparable=(d:MealDish)=>JSON.stringify({name:d.name,category_id:d.category_id,is_hearty:d.is_hearty,ingredients:d.ingredients,steps:d.steps,notes:d.notes,cook_time_minutes:d.cook_time_minutes});
        pool=pool.filter(d=>{const old=approved.get(d.recipe_id);return (!needsSemanticReview(memory)||old&&comparable(publicDish(old))===comparable(publicDish(d)))&&!d.ingredients.some(i=>blocked.has(i.ingredient_id));});
        if(dishes.some(d=>d.ingredients.some(i=>blocked.has(i.ingredient_id))))throw new Error('已选菜含本餐忌口食材，请先调整');
      }
      const used=new Set(dishes.map(dishSignature));let updated:MealDish[];
      if(body.action==='replace'){
        const target=dishes.find(d=>d.recipe_id===body.recipe_id);if(!target)throw new Error('请选择当前菜单中的一道菜');
        const otherHearty=dishes.filter(d=>d.recipe_id!==target.recipe_id&&d.is_hearty).length;
        const candidates=pool.filter(d=>d.category_id===target.category_id&&!used.has(dishSignature(d))&&(memory?.hearty_count==null||otherHearty+Number(d.is_hearty)===memory.hearty_count));
        if(!candidates.length)throw new Error('这一类暂时没有其他合适的菜，当前菜单已保留');
        const replacement=candidates[Math.floor(Math.random()*candidates.length)]!;
        updated=dishes.map(d=>d.recipe_id===target.recipe_id?publicDish(replacement):d);
        rejectedIds.push(target.recipe_id);rejectedSignatures.push(dishSignature(target));
      } else {
        const counts:Record<string,number>={};for(const dish of dishes)counts[dish.category_id]=(counts[dish.category_id]||0)+1;
        updated=selectCombination(pool,counts,dishes.map(d=>d.recipe_id),memory?.hearty_count??null);
      }
      const actual:Record<string,number>={};for(const d of updated)actual[d.category_id]=(actual[d.category_id]||0)+1;
      const id=newId(),now=new Date().toISOString();
      const mainCounts=Object.fromEntries(Object.entries(actual).filter(([key])=>['meat','vegetable','soup'].includes(key)));
      await tx.runAsync('INSERT INTO rule_plans(id,creation_key,creation_hash,last_request_key,last_payload_hash,people_count,category_counts,dishes,rejected_ids,rejected_signatures,allow_nonseasonal,revision,as_of_date,created_at,updated_at,ai_memory) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,body.request_key,digest,body.request_key,digest,body.people_count!,JSON.stringify(mainCounts),JSON.stringify(updated),JSON.stringify(rejectedIds),JSON.stringify(rejectedSignatures),Number(!!body.allow_nonseasonal),1,today(),now,now,memory?JSON.stringify(memory):null);
      const retained=body.action==='replace' ? dishes.filter(d=>d.recipe_id!==body.recipe_id).map(d=>d.recipe_id) : [];
      await tx.runAsync('INSERT INTO local_metadata(key,value) VALUES (?,?)',`manual_plan:${id}`,JSON.stringify(retained));
      result=snapshot(await get(tx,id));
    });
    if(!result)throw new Error('换菜未完成');return result;
  }
  return async(path:string,options:RequestInit={}):Promise<unknown>=>{
    const url=new URL(path,'https://local.invalid'),parts=url.pathname.split('/'),method=(options.method||'GET').toUpperCase();
    if (url.pathname==='/recommendations'&&method==='POST') return create(JSON.parse(String(options.body||'{}')));
    if (url.pathname==='/recommendations/manual-swap'&&method==='POST') return manualSwap(JSON.parse(String(options.body||'{}')));
    if(parts[1]==='recommendations'&&parts[2]&&parts.length===3&&method==='GET') return snapshot(await get(db,parts[2]));
    if(parts[1]==='recommendations'&&parts[2]&&parts.length===4&&method==='POST'&&['replace','regenerate'].includes(parts[3]||'')) return change(parts[2],JSON.parse(String(options.body||'{}')),parts[3]==='regenerate');
    throw new Error('本地菜单操作尚未实现');
  };
}
