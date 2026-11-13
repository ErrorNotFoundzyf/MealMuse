import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {LOCAL_SCHEMA_V1} from '../src/local/schema.ts';
import {installInitialCatalog} from '../src/local/catalog-seed.ts';
import {loadCandidatePool} from '../src/local/recommendation-data.ts';
import {runLocalAiTurn} from '../src/local/ai-turn.ts';
import {askDeepSeekJson} from '../src/local/deepseek.ts';

const config=JSON.parse(await readFile(new URL('../../backend/llm.local.json',import.meta.url),'utf8'));
if(!config.api_key)throw new Error('未配置本机 DeepSeek 密钥');
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(LOCAL_SCHEMA_V1);
const tx={getFirstAsync:async(q,...a)=>sql.prepare(q).get(...a)??null,getAllAsync:async(q,...a)=>sql.prepare(q).all(...a),runAsync:async(q,...a)=>sql.prepare(q).run(...(Array.isArray(a[0])?a[0]:a))};
const db={...tx,withExclusiveTransactionAsync:async fn=>{sql.exec('BEGIN');try{await fn(tx);sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
const seed=JSON.parse(await readFile(new URL('../assets/catalog-seed.json',import.meta.url),'utf8'));await installInitialCatalog(db,seed);
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),pool=await loadCandidatePool(db,{today,allowNonseasonal:false});
const ingredients=await db.getAllAsync('SELECT id,name FROM ingredients WHERE deleted_at IS NULL');
const aliases=await db.getAllAsync("SELECT ingredient_id,display_name FROM ingredient_names WHERE kind='alias'");
const ask=messages=>askDeepSeekJson(config.api_key,messages);
let current=[],memory,counts={meat:1,vegetable:0,soup:1};
for(const message of ['按配置搭配一荤一汤','再加一个硬菜，变成三道菜','再加一个甜点']){
  const result=await runLocalAiTurn({message,people:4,counts,current,candidates:pool,manualSelection:false,settingsChange:false,ingredientIds:ingredients.map(x=>x.id),ingredientCatalog:ingredients.map(i=>({...i,aliases:aliases.filter(a=>a.ingredient_id===i.id).map(a=>a.display_name)})),memory},ask);
  if(result.memory.blocked)throw new Error('真实对话未完成：'+result.memory.messages.at(-1)?.content);
  counts=result.counts;memory=result.memory;current=result.dishes.map(d=>pool.find(p=>p.recipe_id===d.recipe_id));
  if(current.some(d=>!d))throw new Error('菜谱未匹配');
  console.log(JSON.stringify({message,counts,dishes:result.dishes.map(d=>({name:d.name,category:d.category_id,hearty:d.is_hearty})),reply:memory.messages.at(-1)?.content}));
}
if(current.length!==4||current.filter(d=>d.is_hearty).length!==1||current.filter(d=>d.category_id==='dessert').length!==1)throw new Error('连续对话结果不符合要求');
const before=current.map(d=>d.recipe_id),message=`把${current[0].name}换一道，其他保留`;
const replaced=await runLocalAiTurn({message,people:4,counts,current,candidates:pool,manualSelection:false,settingsChange:false,ingredientIds:ingredients.map(x=>x.id),ingredientCatalog:ingredients.map(i=>({...i,aliases:aliases.filter(a=>a.ingredient_id===i.id).map(a=>a.display_name)})),memory},ask);
if(replaced.memory.blocked||replaced.dishes.length!==4||replaced.dishes[0].recipe_id===before[0]||replaced.dishes.slice(1).some((d,i)=>d.recipe_id!==before[i+1]))throw new Error('真实换菜未按要求保留其他菜');
console.log(JSON.stringify({message,dishes:replaced.dishes.map(d=>d.name),reply:replaced.memory.messages.at(-1)?.content}));
const noLiver=await runLocalAiTurn({message:'不想吃猪肝',people:4,counts:replaced.counts,current:replaced.dishes.map(d=>pool.find(p=>p.recipe_id===d.recipe_id)),candidates:pool,manualSelection:false,settingsChange:false,ingredientIds:ingredients.map(x=>x.id),ingredientCatalog:ingredients.map(i=>({...i,aliases:aliases.filter(a=>a.ingredient_id===i.id).map(a=>a.display_name)})),memory:replaced.memory},ask);
if(noLiver.memory.blocked||noLiver.dishes.some(d=>d.ingredients.some(i=>i.name==='猪肝')))throw new Error('猪肝忌口未满足');
console.log(JSON.stringify({message:'不想吃猪肝',dishes:noLiver.dishes.map(d=>d.name),reply:noLiver.memory.messages.at(-1)?.content}));
const liver=pool.find(d=>d.ingredients.some(i=>i.name==='猪肝')&&d.category_id==='meat'&&!d.is_hearty);
if(liver){
  const currentWithLiver=[liver,...current.slice(1)];
  const result=await runLocalAiTurn({message:'不想吃猪肝',people:4,counts,current:currentWithLiver,candidates:pool,manualSelection:false,settingsChange:false,ingredientIds:ingredients.map(x=>x.id),ingredientCatalog:ingredients.map(i=>({...i,aliases:aliases.filter(a=>a.ingredient_id===i.id).map(a=>a.display_name)})),memory},ask);
  if(result.memory.blocked||result.dishes.some(d=>d.ingredients.some(i=>i.name==='猪肝'))||result.dishes[1].recipe_id!==current[1].recipe_id)throw new Error('实际有猪肝时未正确替换并保留汤');
  console.log(JSON.stringify({scenario:'当前菜单含猪肝',dishes:result.dishes.map(d=>d.name),reply:result.memory.messages.at(-1)?.content}));
}
sql.close();
