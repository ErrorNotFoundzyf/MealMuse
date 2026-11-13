import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {LOCAL_SCHEMA_V1} from '../src/local/schema.ts';
import {installInitialCatalog} from '../src/local/catalog-seed.ts';
import {createLocalApi} from '../src/local/local-api.ts';
import {askDeepSeekJson} from '../src/local/deepseek.ts';

const config=JSON.parse(await readFile(new URL('../../backend/llm.local.json',import.meta.url),'utf8'));
if(!config.api_key)throw new Error('请在本机配置密钥');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(LOCAL_SCHEMA_V1);
const tx={getFirstAsync:async(q,...a)=>sql.prepare(q).get(...a)??null,getAllAsync:async(q,...a)=>sql.prepare(q).all(...a),runAsync:async(q,...a)=>sql.prepare(q).run(...(Array.isArray(a[0])?a[0]:a))};
const db={...tx,withExclusiveTransactionAsync:async fn=>{sql.exec('BEGIN');try{await fn(tx);sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
await installInitialCatalog(db,JSON.parse(await readFile(new URL('../assets/catalog-seed.json',import.meta.url),'utf8')));
let modelCalls=0;const semantic=process.env.MEAL_TEST_SEMANTIC==='1';
const api=createLocalApi(db,randomUUID,{hasKey:async()=>true,ask:messages=>{modelCalls++;return askDeepSeekJson(config.api_key,messages);}});
const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify({request_key:randomUUID(),...body})});
let plan=await post('/recommendations',{people_count:4,category_counts:{meat:1,vegetable:semantic?1:0,soup:1},allow_nonseasonal:false});
if(semantic){
  const before=plan;
  plan=await post('/ai/chat',{message:'今天想清淡一点，别太油腻，按当前菜数重新搭配',people_count:4,category_counts:plan.category_counts,allow_nonseasonal:false,plan_id:plan.id,expected_revision:plan.revision,selected_recipe_ids:plan.dishes.map(d=>d.recipe_id)});
  assert.equal(plan.ai.blocked,false,plan.ai.messages.at(-1)?.content);console.log(JSON.stringify({semantic:true,candidate_counts:plan.ai.candidate_counts,modelCalls}));
}
const results=[];
for(const [message,category] of semantic?[['再加一个甜点','dessert']]:[['加一个硬菜','meat'],['加一个荤菜','meat'],['再加一道素菜','vegetable'],['再加一份汤','soup'],['再加一个甜点','dessert'],['加一份水果','fruit']]){
  const before=plan,oldIds=before.dishes.map(d=>d.recipe_id);
  plan=await post('/ai/chat',{message,people_count:before.people_count,category_counts:before.category_counts,allow_nonseasonal:false,plan_id:before.id,expected_revision:before.revision,selected_recipe_ids:oldIds});
  assert.equal(plan.ai.blocked,false,plan.ai.messages.at(-1)?.content);
  assert.equal(plan.dishes.length,before.dishes.length+1);
  assert.deepEqual(plan.dishes.slice(0,oldIds.length).map(d=>d.recipe_id),oldIds);
  assert.equal(plan.dishes.at(-1).category_id,category);
  if(message.includes('硬菜'))assert.equal(plan.dishes.at(-1).is_hearty,true);
  if(['dessert','fruit'].includes(category))assert.deepEqual(plan.category_counts,before.category_counts);
  else assert.equal(plan.category_counts[category],(before.category_counts[category]||0)+1);
  const persisted=await api(`/recommendations/${plan.id}`);assert.deepEqual(persisted.dishes,plan.dishes);
  results.push({message,counts:plan.category_counts,dishes:plan.dishes.map(d=>({name:d.name,category:d.category_id,hearty:d.is_hearty})),reply:plan.ai.messages.at(-1)?.content});
  console.log(JSON.stringify(results.at(-1)));
}
const swapResults=[];
const callsBeforeSwap=modelCalls;
for(const category of ['meat','vegetable','soup']){
  const target=plan.dishes.find(d=>d.category_id===category&&!d.is_hearty);assert.ok(target);
  const before=plan;
  plan=await post(`/recommendations/${plan.id}/replace`,{expected_revision:plan.revision,recipe_id:target.recipe_id});
  assert.ok(!plan.dishes.some(d=>d.recipe_id===target.recipe_id));
  assert.deepEqual(plan.dishes.filter(d=>d.recipe_id!==plan.dishes[before.dishes.findIndex(x=>x.recipe_id===target.recipe_id)].recipe_id).map(d=>d.recipe_id),before.dishes.filter(d=>d.recipe_id!==target.recipe_id).map(d=>d.recipe_id));
  swapResults.push({category,changed:true});console.log(JSON.stringify({button_swap:category,passed:true}));
}
assert.equal(modelCalls,callsBeforeSwap,'button swaps must not invoke a model');
const saved=await post('/meal-records',{meal_date:plan.as_of_date,people_count:4,recipe_ids:plan.dishes.map(d=>d.recipe_id),plan_id:plan.id,plan_revision:plan.revision,acknowledge_unknown:true});
assert.equal(saved.dishes.length,plan.dishes.length);
await mkdir(new URL('../../outputs/acceptance/',import.meta.url),{recursive:true});
await writeFile(new URL(`../../outputs/acceptance/${semantic?'real-semantic-swaps':'real-additions'}-latest.json`,import.meta.url),JSON.stringify({at:new Date().toISOString(),passed:true,results,swapResults,modelCalls,confirmed_dishes:saved.dishes.length},null,2));
console.log('REAL API FLOW PASSED, INCLUDING CONFIRMATION');sql.close();
