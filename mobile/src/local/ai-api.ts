import type { SQLiteDatabase } from 'expo-sqlite';
import { LocalCatalog } from './catalog.ts';
import { loadCandidatePool,publicDish,type LocalCandidate } from './recommendation-data.ts';
import { runLocalAiTurn,type LocalAiMemory } from './ai-turn.ts';
import { planSnapshot,type PlanRow } from './plan-api.ts';
import { cleanAssistantReply } from './ai-contract.ts';
import type { MealDish } from '../types';

type Input={request_key:string;message:string;retry?:boolean;people_count:number;category_counts:Record<string,number>;allow_nonseasonal?:boolean;plan_id?:string;expected_revision?:number;selected_recipe_ids?:string[];replace_selection?:boolean;settings_change?:boolean};
type Ask=(messages:{role:'system'|'user'|'assistant';content:string}[])=>Promise<unknown>;
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const signature=(body:Input)=>JSON.stringify(Object.fromEntries(Object.entries(body).filter(([k])=>k!=='request_key').sort(([a],[b])=>a.localeCompare(b))));
const comparable=(dish:MealDish)=>JSON.stringify({recipe_id:dish.recipe_id,name:dish.name,category_id:dish.category_id,is_hearty:dish.is_hearty,ingredients:dish.ingredients,steps:dish.steps,notes:dish.notes,cook_time_minutes:dish.cook_time_minutes});

export function createLocalAiApi(db:SQLiteDatabase,newId:()=>string,ask:Ask,hasKey:()=>Promise<boolean>) {
  async function currentCandidates(ids:string[],source:SQLiteDatabase=db):Promise<LocalCandidate[]> {
    const catalog=new LocalCatalog(source,newId),categories=await source.getAllAsync<{id:string;name:string}>('SELECT id,name FROM dish_categories WHERE is_active=1');
    const output:LocalCandidate[]=[];
    for(const id of ids){
      const recipe=await catalog.getRecipe(id);if(recipe.is_hidden)throw new Error('当前菜谱已隐藏，请重新选择');
      const name=categories.find(c=>c.id===recipe.category_id)?.name||'未分类';
      output.push({recipe_id:id,name:recipe.name,category_id:recipe.category_id,category_name:name+(recipe.is_hearty&&recipe.category_id!=='hearty'?' · 硬菜':''),is_hearty:recipe.is_hearty,is_hidden:false,deleted_at:null,season_coverage:0,season_warnings:[],steps:recipe.steps,notes:recipe.notes,cook_time_minutes:recipe.cook_time_minutes,ingredients:recipe.ingredients.map(i=>({ingredient_id:i.ingredient_id,name:i.name,is_main:i.is_main,quantity:i.quantity,unit:i.unit,seasons:i.seasons,is_hidden:i.is_hidden,deleted_at:null}))});
    }
    return output;
  }
  async function chat(body:Input) {
    if(!await hasKey())throw new Error('请先在 AI 设置中填写 DeepSeek 密钥');
    if(typeof body.request_key!=='string'||body.request_key.length<16||body.request_key.length>80||!Number.isInteger(body.people_count)||body.people_count<1||body.people_count>30||!body.category_counts||typeof body.category_counts!=='object'||Array.isArray(body.category_counts)||Object.entries(body.category_counts).some(([k,v])=>!['meat','vegetable','soup'].includes(k)||!Number.isInteger(v)||v<0||v>20)||Object.values(body.category_counts).reduce((a,b)=>a+b,0)<1||Object.values(body.category_counts).reduce((a,b)=>a+b,0)>20)throw new Error('本餐设置不完整，请检查人数与菜数');
    if((!!body.plan_id)!==(body.expected_revision!==undefined))throw new Error('菜单版本不完整，请重新打开');
    const old=body.plan_id?await db.getFirstAsync<PlanRow>('SELECT * FROM rule_plans WHERE id=?',body.plan_id):null;
    const digest=signature(body);
    if(old?.last_request_key===body.request_key){if(old.last_payload_hash!==digest)throw new Error('本次请求内容已变化');return planSnapshot(old);}
    if(body.plan_id&&(!old||old.confirmed_record_id||old.revision!==body.expected_revision))throw new Error('菜单已更新，请重新读取');
    if(!old){const existing=await db.getFirstAsync<PlanRow>('SELECT * FROM rule_plans WHERE creation_key=?',body.request_key);if(existing){if(existing.creation_hash!==digest)throw new Error('本次请求内容已变化');return planSnapshot(existing);}}
    const memory=old?.ai_memory?JSON.parse(old.ai_memory) as LocalAiMemory:undefined;
    const message=body.retry?(memory?.pending?.at(-1)||''):body.message;
    if(typeof message!=='string'||!message.trim())throw new Error('请输入本次要求');
    const oldDishes=old?JSON.parse(old.dishes) as MealDish[]:[];
    const ids=body.selected_recipe_ids??oldDishes.map(d=>d.recipe_id);
    if(!Array.isArray(ids)||ids.length>20||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw new Error('本餐菜品不能重复');
    const current=await currentCandidates(ids),date=today();
    const pool=await loadCandidatePool(db,{today:date,allowNonseasonal:!!body.allow_nonseasonal});
    const ingredients=await db.getAllAsync<{id:string;name:string}>('SELECT id,name FROM ingredients WHERE deleted_at IS NULL');
    const aliases=await db.getAllAsync<{ingredient_id:string;display_name:string}>('SELECT ingredient_id,display_name FROM ingredient_names WHERE kind=?','alias');
    const result=await runLocalAiTurn({message,people:body.people_count,counts:body.category_counts,candidates:pool,current,manualSelection:!old&&ids.length>0||!!body.replace_selection,settingsChange:!!body.settings_change,ingredientIds:ingredients.map(i=>i.id),ingredientCatalog:ingredients.map(i=>({...i,aliases:aliases.filter(a=>a.ingredient_id===i.id).map(a=>a.display_name)})),memory},ask);
    let committed:ReturnType<typeof planSnapshot>|undefined;
    await db.withExclusiveTransactionAsync(async tx=>{
      const live=old?await tx.getFirstAsync<PlanRow>('SELECT * FROM rule_plans WHERE id=?',old.id):null;
      if(old&&(!live||live.confirmed_record_id||live.revision!==old.revision))throw new Error('菜单已变化，本次对话没有覆盖当前菜单');
      if(!old&&await tx.getFirstAsync('SELECT id FROM rule_plans WHERE creation_key=?',body.request_key))throw new Error('本次请求已处理，请重新打开菜单');
      if(date!==today())throw new Error('日期已变化，请重新搭配');
      if(!result.memory.blocked){
        const fresh=await loadCandidatePool(tx as SQLiteDatabase,{today:date,allowNonseasonal:!!body.allow_nonseasonal});
        const previousManual=old?await tx.getFirstAsync<{value:string}>('SELECT value FROM local_metadata WHERE key=?',`manual_plan:${old.id}`):null;
        const manualKept=new Set<string>(!old&&ids.length||body.replace_selection ? ids : previousManual?JSON.parse(previousManual.value):[]);
        for(const dish of result.dishes){
          if(manualKept.has(dish.recipe_id)){
            const current=(await currentCandidates([dish.recipe_id],tx as SQLiteDatabase))[0];
            if(!current||comparable(publicDish(current))!==comparable(dish))throw new Error('手动选择的菜谱已变化，请重新选择');
            continue;
          }
          const item=fresh.find(d=>d.recipe_id===dish.recipe_id);
          if(!item||comparable(publicDish(item))!==comparable(dish))throw new Error('菜谱、季节或近期记录已变化，请重新搭配');
        }
      }
      const id=old?.id??newId(),now=new Date().toISOString();
      if(old) await tx.runAsync('UPDATE rule_plans SET people_count=?,category_counts=?,dishes=?,allow_nonseasonal=?,revision=revision+1,as_of_date=?,updated_at=?,last_request_key=?,last_payload_hash=?,ai_memory=? WHERE id=?',result.people,JSON.stringify(result.counts),JSON.stringify(result.dishes),Number(!!body.allow_nonseasonal),date,now,body.request_key,digest,JSON.stringify(result.memory),id);
      else await tx.runAsync('INSERT INTO rule_plans(id,creation_key,creation_hash,last_request_key,last_payload_hash,people_count,category_counts,dishes,rejected_ids,rejected_signatures,allow_nonseasonal,revision,as_of_date,created_at,updated_at,ai_memory) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,body.request_key,digest,body.request_key,digest,result.people,JSON.stringify(result.counts),JSON.stringify(result.dishes),'[]','[]',Number(!!body.allow_nonseasonal),1,date,now,now,JSON.stringify(result.memory));
      if(!old&&ids.length||body.replace_selection){const selected=new Set(ids);await tx.runAsync('INSERT OR REPLACE INTO local_metadata(key,value) VALUES (?,?)',`manual_plan:${id}`,JSON.stringify(result.dishes.filter(d=>selected.has(d.recipe_id)).map(d=>d.recipe_id)));}
      const saved=await tx.getFirstAsync<PlanRow>('SELECT * FROM rule_plans WHERE id=?',id);if(!saved)throw new Error('菜单保存未完成');committed=planSnapshot(saved);
    });
    if(!committed)throw new Error('菜单保存未完成');return committed;
  }
  return async(path:string,options:RequestInit={}):Promise<unknown>=>{
    if(path==='/ai/status'&&(options.method||'GET').toUpperCase()==='GET')return {configured:await hasKey(),provider:'DeepSeek',model:'deepseek-flash'};
    if(path==='/ai/chat'&&(options.method||'GET').toUpperCase()==='POST')return chat(JSON.parse(String(options.body||'{}')));
    const match=/^\/ai\/plans\/([^/]+)\/explanation$/.exec(path);
    if(match&&(options.method||'GET').toUpperCase()==='POST'){
      const body=JSON.parse(String(options.body||'{}')) as {revision:number;text:string};
      if(!Number.isInteger(body.revision)||typeof body.text!=='string'||!body.text.trim()||body.text.length>1500)throw new Error('说明内容不完整');
      let saved:ReturnType<typeof planSnapshot>|undefined;
      await db.withExclusiveTransactionAsync(async tx=>{
        const row=await tx.getFirstAsync<PlanRow>('SELECT * FROM rule_plans WHERE id=?',match[1]!);
        if(!row||row.confirmed_record_id||row.revision!==body.revision||!row.ai_memory)throw new Error('菜单已变化，未保存这段说明');
        const memory=JSON.parse(row.ai_memory) as LocalAiMemory;
        if(memory.messages.at(-1)?.role!=='assistant')throw new Error('本次说明无法保存');
        memory.messages[memory.messages.length-1]={role:'assistant',content:cleanAssistantReply(body.text)};
        await tx.runAsync('UPDATE rule_plans SET ai_memory=? WHERE id=?',JSON.stringify(memory),row.id);
        const updated=await tx.getFirstAsync<PlanRow>('SELECT * FROM rule_plans WHERE id=?',row.id);if(updated)saved=planSnapshot(updated);
      });
      if(!saved)throw new Error('说明保存未完成');return saved;
    }
    throw new Error('该 AI 操作尚未完成');
  };
}
