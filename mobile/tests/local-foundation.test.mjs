import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LOCAL_SCHEMA_V1 } from '../src/local/schema.ts';
import { seasonForMonth, seasonStatus } from '../src/local/season.ts';
import { CATALOG_COLUMNS, installInitialCatalog, applySeasonCorrections } from '../src/local/catalog-seed.ts';
import { askDeepSeekJson } from '../src/local/deepseek.ts';
import { createLocalBackup, restoreLocalBackup } from '../src/local/backup.ts';
import { filterCandidates, recentDayStart } from '../src/local/candidates.ts';
import { selectMenu } from '../src/local/select-menu.ts';
import { LocalCatalog } from '../src/local/catalog.ts';
import { createLocalCatalogApi } from '../src/local/catalog-api.ts';
import { createLocalMealApi } from '../src/local/meal-api.ts';
import { createLocalPlanApi } from '../src/local/plan-api.ts';
import { cleanAssistantReply, validateModelSelection, selectFromApproved } from '../src/local/ai-contract.ts';
import { createLocalShoppingApi } from '../src/local/shopping-api.ts';
import { extraAdditions } from '../src/local/extra-requests.ts';
import { createLocalApi } from '../src/local/local-api.ts';
import { validateIntent } from '../src/local/ai-intent.ts';
import { runLocalAiTurn } from '../src/local/ai-turn.ts';
import { createLocalAiApi } from '../src/local/ai-api.ts';
import {parseMenuAdditions} from '../src/local/menu-additions.ts';
import {reviewCandidates} from '../src/local/candidate-review.ts';

test('semantic review covers the full candidate pool across batches without category truncation',async()=>{
  const pool=Array.from({length:95},(_,i)=>({recipe_id:`r-${i}`,category_id:i%2?'meat':'vegetable',ingredients:[{ingredient_id:`i-${i}`}]}));
  const seen=[];
  const result=await reviewCandidates(pool,{constraints:[],preferences:['清淡']},async messages=>{const context=JSON.parse(messages[1].content);const offset=seen.length;seen.push(...context.candidate_recipes.map(d=>offset+d.index));return {eligible_indexes:context.candidate_recipes.filter(d=>(offset+d.index)%3!==0).map(d=>d.index)};});
  assert.equal(new Set(seen).size,95);assert.equal(seen.length,95);
  assert.equal(result.length,pool.filter(d=>Number(d.recipe_id.slice(2))%3!==0).length);
  let calls=0;
  const ruled=await reviewCandidates(pool,{constraints:[{kind:'ingredient',ingredient_id:'i-1',text:'忌口',evidence:'忌口'}],preferences:[]},async()=>{calls++;throw new Error('unexpected model call');});
  assert.equal(calls,0);assert.equal(ruled.length,94);assert.ok(!ruled.some(d=>d.recipe_id==='r-1'));
});

test('category additions distinguish deltas from totals, replacements and negatives',()=>{
  for(const [text,expected] of [['加一个硬菜',{hearty:1}],['加一个荤菜',{meat:1}],['再加两道素菜',{vegetable:2}],['增加一份汤',{soup:1}],['再加一个甜点',{dessert:1}],['来两份水果',{fruit:2}],['加一个荤菜，再加一个甜点',{meat:1,dessert:1}],['不要加一个硬菜',{}],['把汤换成甜点',{}],['想吃一道硬菜',{}]])assert.deepEqual(parseMenuAdditions(text).counts,expected);
});

test('all category additions preserve previous dishes and adjust only the relevant quantities',async()=>{
  const d=(id,cat,hearty=false)=>({recipe_id:id,name:id,category_id:cat,category_name:cat,is_hearty:hearty,is_hidden:false,deleted_at:null,season_coverage:1,season_warnings:[],steps:null,notes:null,cook_time_minutes:null,ingredients:[{ingredient_id:id,name:id,is_main:true,quantity:null,unit:null,seasons:['all_year'],is_hidden:false,deleted_at:null}]});
  const initial=[d('旧肉','meat'),d('旧汤','soup')];
  const pool=[...initial,d('新肉','meat'),d('新素','vegetable'),d('新汤','soup'),d('硬菜','meat',true),d('甜点','dessert'),d('水果','fruit')];
  for(const [message,category] of [['加一个荤菜','meat'],['加一个素菜','vegetable'],['加一个汤','soup'],['加一个硬菜','meat'],['加一个甜点','dessert'],['加一个水果','fruit']]){
    const ask=async messages=>{const ctx=JSON.parse(messages[1].content);assert.ok(ctx.slots,'explicit addition should not need semantic reinterpretation');return {eligible_ids:ctx.candidate_recipes.map(d=>d.recipe_id),choices:[],reply:'已调整'};};
    const result=await runLocalAiTurn({message,people:4,counts:{meat:1,vegetable:0,soup:1},current:initial,candidates:pool,manualSelection:false,settingsChange:false,ingredientIds:pool.map(d=>d.recipe_id)},ask);
    assert.equal(result.memory.blocked,false);assert.deepEqual(result.dishes.slice(0,2).map(d=>d.recipe_id),['旧肉','旧汤']);assert.equal(result.dishes.length,3);assert.equal(result.dishes[2].category_id,category);
    assert.equal(Object.values(result.counts).reduce((a,b)=>a+b,0),['dessert','fruit'].includes(category)?2:3);
    if(message.includes('硬菜'))assert.equal(result.dishes[2].is_hearty,true);
  }
});

test('the supplied real catalogue installs in a new local database without overwriting changes',async()=>{
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args)??null,runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...(Array.isArray(args[0])?args[0]:args))};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const seed=JSON.parse(await readFile(new URL('../assets/catalog-seed.json',import.meta.url),'utf8'));
  assert.equal(await installInitialCatalog(db,seed),true);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM ingredients').get().n,130);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM recipes').get().n,170);
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(await installInitialCatalog(db,seed),false);
  sqlite.close();
});

test('season migration updates matching old values once and keeps later phone edits',async()=>{
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args)??null,runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...args)};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const insert=sqlite.prepare('INSERT INTO ingredients(id,name,seasons_json,source,created_at,updated_at) VALUES (?,?,?,?,?,?)');
  insert.run('a','甲','["summer"]','family','now','now');insert.run('b','乙','["winter"]','family','now','now');
  const changes=[{id:'a',before:['summer'],after:['all_year']},{id:'b',before:['summer'],after:['all_year']}];
  assert.equal(await applySeasonCorrections(db,changes),1);
  assert.equal(sqlite.prepare('SELECT seasons_json FROM ingredients WHERE id=?').get('a').seasons_json,'["all_year"]');
  assert.equal(sqlite.prepare('SELECT seasons_json FROM ingredients WHERE id=?').get('b').seasons_json,'["winter"]');
  assert.equal(await applySeasonCorrections(db,changes),0);sqlite.close();
});

test('season month boundaries and unknown/year-round status', () => {
  assert.deepEqual(Array.from({length: 12}, (_, i) => seasonForMonth(i + 1)), [
    'winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
  ]);
  assert.equal(seasonStatus([], 'spring'), 'season_unknown');
  assert.equal(seasonStatus(['all_year'], 'winter'), 'in_season');
  assert.equal(seasonStatus(['summer'], 'winter'), 'out_of_season');
  assert.throws(() => seasonForMonth(13), RangeError);
});

test('four-day avoidance and seasons are hard filters, including year boundaries', () => {
  assert.equal(recentDayStart('2027-01-01'), '2026-12-29');
  assert.throws(() => recentDayStart('2026-02-30'));
  const ingredient = (id, seasons) => ({ ingredient_id:id, name:id, is_main:true, seasons, is_hidden:false, deleted_at:null });
  const dish = (id, seasons) => ({recipe_id:id,name:id,category_id:'vegetable',is_hidden:false,deleted_at:null,ingredients:[ingredient(id,seasons)]});
  const dishes = [dish('today',['all_year']), dish('past',['all_year']), dish('older',['all_year']), dish('summer',['summer']), dish('unknown',[])];
  const records = [
    {meal_date:'2027-01-01',deleted_at:null,dishes:[dishes[0]]},
    {meal_date:'2026-12-30',deleted_at:null,dishes:[dishes[1]]},
    {meal_date:'2026-12-28',deleted_at:null,dishes:[dishes[2]]},
  ];
  const options = {today:'2027-01-01',season:'winter',allowNonseasonal:false};
  assert.deepEqual(filterCandidates(dishes, records, options).map(d => d.recipe_id), ['older']);
  assert.deepEqual(filterCandidates(dishes, records, {...options,allowNonseasonal:true}).map(d => d.recipe_id), ['older','summer','unknown']);
});

test('menu combination respects counts without requiring a hearty dish by default', () => {
  const d = (id,category_id,is_hearty=false) => ({recipe_id:id,name:id,category_id,is_hearty,is_hidden:false,deleted_at:null,ingredients:[{ingredient_id:id,name:id,is_main:true,seasons:['all_year'],is_hidden:false,deleted_at:null}],season_coverage:1});
  const pool=[d('m','meat'),d('v','vegetable'),d('s','soup'),d('h','meat',true)];
  assert.deepEqual(selectMenu(pool,{meat:1,vegetable:1,soup:1},{random:()=>0,avoidIds:['h']}).map(x=>x.recipe_id).sort(),['m','s','v']);
  assert.ok(selectMenu(pool,{meat:1,vegetable:1,soup:1},{random:()=>0,heartyCount:1}).some(x=>x.recipe_id==='h'));
  assert.throws(() => selectMenu(pool,{meat:3},{random:()=>0}),/还缺1道/);
});

test('local schema enforces foreign keys and validates ingredient quantities', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(LOCAL_SCHEMA_V1);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('meat', '荤菜', 1, 1);
  db.prepare('INSERT INTO recipes (id,name,normalized_name,category_id,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('r1','菜','菜','meat','now','now');
  assert.throws(() => db.prepare('INSERT INTO recipe_ingredients (recipe_id,ingredient_id) VALUES (?,?)').run('r1','missing'));
  db.prepare('INSERT INTO ingredients (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('i1','食材','now','now');
  assert.throws(() => db.prepare('INSERT INTO recipe_ingredients (recipe_id,ingredient_id,quantity) VALUES (?,?,?)').run('r1','i1','1'));
  db.prepare('INSERT INTO recipe_ingredients (recipe_id,ingredient_id) VALUES (?,?)').run('r1','i1');
  assert.equal(db.prepare('SELECT count(*) AS n FROM recipe_ingredients').get().n, 1);
  db.close();
});

test('catalog seed installs once without overwriting edits', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(LOCAL_SCHEMA_V1);
  const tx = {
    getFirstAsync: async (sql, ...args) => sqlite.prepare(sql).get(...args) ?? null,
    runAsync: async (sql, ...args) => sqlite.prepare(sql).run(...(Array.isArray(args[0]) ? args[0] : args)),
  };
  const db = { withExclusiveTransactionAsync: async fn => {
    sqlite.exec('BEGIN');
    try { await fn(tx); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  const tables = Object.entries(CATALOG_COLUMNS).map(([name, columns]) => ({name, columns, rows: []}));
  tables[0].rows.push({id:'meat',name:'荤菜',sort_order:0,is_active:1});
  tables[1].rows.push({id:'i',name:'豆腐',ingredient_category:'soy',seasons_json:'["all_year"]',source:'family',is_hidden:0,created_at:'now',updated_at:'now',deleted_at:null});
  assert.equal(await installInitialCatalog(db, tables), true);
  sqlite.prepare('UPDATE ingredients SET name=? WHERE id=?').run('家里的豆腐','i');
  assert.equal(await installInitialCatalog(db, tables), false);
  assert.equal(sqlite.prepare('SELECT name FROM ingredients').get().name, '家里的豆腐');
  sqlite.exec("DELETE FROM local_metadata WHERE key='catalog_seed_installed'");
  await assert.rejects(() => installInitialCatalog(db, tables), /不能覆盖/);
  assert.equal(sqlite.prepare('SELECT name FROM ingredients').get().name, '家里的豆腐');
  sqlite.close();
});

test('AI client uses direct HTTPS, returns parsed JSON, and hides upstream errors', async () => {
  let seen;
  const fetcher = async (url, options) => {
    seen = {url, options};
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}), {status:200});
  };
  assert.deepEqual(await askDeepSeekJson('test-key', [{role:'user',content:'返回 JSON'}], {fetcher}), {ok:true});
  assert.equal(seen.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(seen.options.headers.Authorization, 'Bearer test-key');
  await assert.rejects(() => askDeepSeekJson('test-key', [], {fetcher: async () => new Response('private error', {status:401})}), /密钥无效/);
  await assert.rejects(() => askDeepSeekJson('test-key', [], {fetcher: async () => new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}))}), /不完整/);
});

test('AI output cannot invent candidates, violate tags or expose internal fields', () => {
  const dish={recipe_id:'r',name:'炒白菜',category_id:'vegetable',is_hearty:false,is_hidden:false,deleted_at:null,season_coverage:1,season_warnings:[],ingredients:[{ingredient_id:'i',name:'白菜',is_main:true,quantity:null,unit:null,seasons:['all_year'],is_hidden:false,deleted_at:null}]};
  const options={pool:[dish],slots:['vegetable'],kept:[],excludedIngredientIds:[],heartyCount:null};
  const result=validateModelSelection({eligible_ids:['r'],choices:[{slot:0,candidate_id:'r',suitability:'match',reason:'合适'}],reply:'请从eligible_ids选菜'},options);
  assert.equal(result.selected[0].recipe_id,'r');assert.equal(result.reply.includes('eligible_ids'),false);
  assert.throws(()=>validateModelSelection({eligible_ids:['missing'],choices:[],reply:'好'},options),/备选/);
  assert.throws(()=>validateModelSelection({eligible_ids:['r'],choices:[{slot:0,candidate_id:'r',suitability:'match',reason:'好'}],reply:'好'},{...options,excludedIngredientIds:['i']}),/不符合/);
  assert.throws(()=>validateModelSelection({eligible_ids:['r'],choices:[{slot:0,candidate_id:'r',suitability:'match',reason:'好'}],reply:'好'},{...options,heartyCount:1}),/硬菜/);
  assert.match(cleanAssistantReply('保证没有过敏原'),/核对/);
});

test('explicit dessert and fruit requests do not lose quantities or become replacement', () => {
  for (const [messages,expected] of [
    [['加一份甜品和两份水果'],{dessert:1,fruit:2}],
    [['加一个甜点','加一份甜品'],{dessert:1}],
    [['加一份甜品','不加甜品'],{}],
    [['不要水果，再加一份甜品'],{dessert:1}],
    [['把素菜换成甜品'],{}],
    [['把甜点换成水果'],{}],
    [['我不想吃甜品'],{}],
    [['不需要加一份水果'],{}],
    [['想吃两份甜点'],{dessert:2}],
    [['再来一些水果'],{fruit:1}],
  ]) assert.deepEqual(extraAdditions(messages).add,expected);
});

test('AI intent rejects invented targets and restrictions and preserves explicit dessert count', () => {
  const context={messages:['加一份甜品'],currentRecipeIds:['r'],ingredientIds:['i']};
  const basic={action:'add',target_recipe_ids:[],keep_recipe_ids:['r'],constraints:[],preferences:[],reply:'好的'};
  assert.deepEqual(validateIntent(basic,context).extra_add,{dessert:1});
  assert.throws(()=>validateIntent({...basic,target_recipe_ids:['fake']},context),/明确/);
  assert.throws(()=>validateIntent({...basic,constraints:[{kind:'ingredient',ingredient_id:'i',text:'不吃',evidence:'用户从未说过'}]},context),/忌口/);
  assert.throws(()=>validateIntent({...basic,hearty_count:1,hearty_evidence:'加一份甜品'},context),/硬菜/);
});

test('AI turn adds dessert while retaining base menu and replaces only requested dish', async () => {
  const d=(id,cat)=>({recipe_id:id,name:id,category_id:cat,category_name:cat,is_hearty:false,is_hidden:false,deleted_at:null,season_coverage:1,season_warnings:[],steps:null,notes:null,cook_time_minutes:null,ingredients:[{ingredient_id:`i-${id}`,name:id,is_main:true,quantity:null,unit:null,seasons:['all_year'],is_hidden:false,deleted_at:null}]});
  const meat=d('肉','meat'),veg=d('菜','vegetable'),dessert=d('甜','dessert'),replacement=d('新肉','meat');
  const makeAsk=(action,target,selected)=>async messages=>!JSON.parse(messages[1].content).slots?{action,target_recipe_ids:target,keep_recipe_ids:[],constraints:[],preferences:[],reply:'好的'}:{eligible_ids:[selected.recipe_id],choices:[{slot:0,candidate_id:selected.recipe_id,suitability:'match',reason:'合适'}],reply:'已调整'};
  const base={people:2,counts:{meat:1,vegetable:1,soup:0},current:[meat,veg],candidates:[meat,veg,dessert,replacement],manualSelection:false,settingsChange:false,ingredientIds:['i-肉','i-菜','i-甜','i-新肉']};
  const add=await runLocalAiTurn({...base,message:'加一份甜品'},makeAsk('generate',[],dessert));
  assert.deepEqual(add.dishes.map(x=>x.recipe_id),['肉','菜','甜']);
  assert.deepEqual(add.counts,{meat:1,vegetable:1,soup:0});
  for (const action of ['chat','clarify']) {
    const result=await runLocalAiTurn({...base,message:'加一份甜品'},makeAsk(action,[],dessert));
    assert.deepEqual(result.dishes.map(x=>x.recipe_id),['肉','菜','甜']);
  }
  const replaced=await runLocalAiTurn({...base,message:'换掉第一道'},makeAsk('replace',['肉'],replacement));
  assert.deepEqual(replaced.dishes.map(x=>x.recipe_id),['新肉','菜']);
});

test('settings change uses exact new counts even if model assigns invalid slots',async()=>{
  const dish=(id,category)=>({recipe_id:id,name:id,category_id:category,category_name:category,is_hearty:false,is_hidden:false,deleted_at:null,season_coverage:1,season_warnings:[],steps:null,notes:null,cook_time_minutes:null,ingredients:[{ingredient_id:`i-${id}`,name:id,is_main:true,quantity:null,unit:null,seasons:['all_year'],is_hidden:false,deleted_at:null}]});
  const pool=[dish('m1','meat'),dish('m2','meat'),dish('v1','vegetable'),dish('v2','vegetable'),dish('s1','soup')];
  let calls=0;const ask=async()=>++calls===1?{action:'chat',target_recipe_ids:[],keep_recipe_ids:[],constraints:[],preferences:[],reply:'好'}:{eligible_ids:pool.map(d=>d.recipe_id),choices:[{slot:'meat'}],reply:'完成'};
  const result=await runLocalAiTurn({message:'按新的配置重新搭配',people:4,counts:{meat:2,vegetable:1,soup:1},current:[pool[0],pool[2],pool[3],pool[4]],candidates:pool,manualSelection:false,settingsChange:true,ingredientIds:pool.map(d=>`i-${d.recipe_id}`)},ask);
  assert.deepEqual(result.counts,{meat:2,vegetable:1,soup:1});assert.equal(result.dishes.length,4);
  assert.equal(result.dishes.filter(d=>d.category_id==='meat').length,2);
  assert.equal(result.dishes.filter(d=>d.category_id==='vegetable').length,1);
  assert.equal(result.dishes.filter(d=>d.category_id==='soup').length,1);
  assert.throws(()=>selectFromApproved({eligible_ids:['invented'],choices:[],reply:'好'},{pool,slots:['meat'],kept:[],excludedIngredientIds:[],heartyCount:null}),/不符合/);
});

test('excluding pork liver does not treat an omitted tomato soup ID as a conflict',async()=>{
  const d=(id,cat,ingredient)=>({recipe_id:id,name:id,category_id:cat,category_name:cat,is_hearty:false,is_hidden:false,deleted_at:null,season_coverage:1,season_warnings:[],steps:null,notes:null,cook_time_minutes:null,ingredients:[{ingredient_id:ingredient,name:ingredient,is_main:true,quantity:null,unit:null,seasons:['all_year'],is_hidden:false,deleted_at:null}]});
  const soup=d('西红柿鸡蛋汤','soup','tomato'),liver=d('炒猪肝','meat','liver'),chicken=d('鸡肉','meat','chicken');
  const ask=async messages=>JSON.parse(messages[1].content).slots?{eligible_ids:['鸡肉'],choices:[{slot:0,candidate_id:'鸡肉',suitability:'match',reason:'不含猪肝'}],reply:'已换好'}:{action:'replace',target_recipe_ids:['炒猪肝'],keep_recipe_ids:['西红柿鸡蛋汤'],constraints:[{kind:'ingredient',ingredient_id:'liver',text:'不吃猪肝',evidence:'不想吃猪肝'}],preferences:[],reply:'好'};
  const result=await runLocalAiTurn({message:'不想吃猪肝',people:4,counts:{meat:1,soup:1},candidates:[soup,liver,chicken],current:[liver,soup],manualSelection:false,settingsChange:false,ingredientIds:['tomato','liver','chicken']},ask);
  assert.equal(result.memory.blocked,false);assert.deepEqual(result.dishes.map(d=>d.recipe_id),['鸡肉','西红柿鸡蛋汤']);
});

test('adding one hearty dish keeps the menu and increments its category, then dessert stays extra',async()=>{
  const dish=(id,category,hearty=false)=>({recipe_id:id,name:id,category_id:category,category_name:category,is_hearty:hearty,is_hidden:false,deleted_at:null,season_coverage:1,season_warnings:[],steps:null,notes:null,cook_time_minutes:null,ingredients:[{ingredient_id:`i-${id}`,name:id,is_main:true,quantity:null,unit:null,seasons:['all_year'],is_hidden:false,deleted_at:null}]});
  const fish=dish('鱼','meat'),soup=dish('汤','soup'),hearty=dish('排骨','meat',true),dessert=dish('甜品','dessert'),replacement=dish('鸡肉','meat');
  const pool=[fish,soup,hearty,dessert,replacement];let call=0;
  const ask=async messages=>{const ctx=JSON.parse(messages[1].content);if(!ctx.slots)return {action:'add',target_recipe_ids:[],keep_recipe_ids:[],constraints:[],preferences:[],reply:'好'};const selected=ctx.slots.map((cat,slot)=>({slot,candidate_id:ctx.candidate_recipes.find(d=>d.category_id===cat&&!ctx.kept.some(k=>k.recipe_id===d.recipe_id)).recipe_id,suitability:'match',reason:'合适'}));return {eligible_ids:ctx.candidate_recipes.map(d=>d.recipe_id),choices:selected,reply:'已搭配'};};
  const base={people:4,counts:{meat:1,vegetable:0,soup:1},current:[fish,soup],candidates:pool,manualSelection:false,settingsChange:false,ingredientIds:pool.map(d=>`i-${d.recipe_id}`)};
  const first=await runLocalAiTurn({...base,message:'再加一个硬菜，变成三道菜'},ask);
  assert.deepEqual(first.counts,{meat:2,vegetable:0,soup:1});assert.deepEqual(first.dishes.map(d=>d.recipe_id),['鱼','汤','排骨']);
  const second=await runLocalAiTurn({...base,counts:first.counts,current:[fish,soup,hearty],memory:first.memory,message:'加一个甜点'},ask);
  assert.deepEqual(second.dishes.map(d=>d.recipe_id),['鱼','汤','排骨','甜品']);assert.deepEqual(second.counts,first.counts);
  let step=0;const replaceAsk=async()=>++step===1?{action:'replace',target_recipe_ids:['鱼'],keep_recipe_ids:[],constraints:[],preferences:[],reply:'好'}:{eligible_ids:['汤','排骨','甜品','鸡肉'],choices:[{slot:0,candidate_id:'鸡肉',suitability:'match',reason:'合适'}],reply:'换好了'};
  const third=await runLocalAiTurn({...base,counts:second.counts,current:[fish,soup,hearty,dessert],memory:second.memory,message:'把鱼换一道'},replaceAsk);
  assert.deepEqual(third.dishes.map(d=>d.recipe_id),['鸡肉','汤','排骨','甜品']);assert.equal(third.memory.hearty_count,1);
});

test('backup restores catalogue and records atomically and excludes keys', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON'); sqlite.exec(LOCAL_SCHEMA_V1);
  const tx = {
    getFirstAsync: async (sql, ...args) => sqlite.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql, ...args) => sqlite.prepare(sql).all(...args),
    runAsync: async (sql, ...args) => sqlite.prepare(sql).run(...(Array.isArray(args[0]) ? args[0] : args)),
  };
  const db = { withExclusiveTransactionAsync: async fn => {
    sqlite.exec('BEGIN');
    try { await fn(tx); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('meat','荤菜',0,1);
  sqlite.prepare('INSERT INTO ingredients (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('i','原食材','now','now');
  const backup = await createLocalBackup(db);
  assert.equal(JSON.stringify(backup).includes('deepseek'), false);
  sqlite.prepare('UPDATE ingredients SET name=? WHERE id=?').run('新食材','i');
  const invalid = structuredClone(backup);
  invalid.tables.recipe_ingredients.push({recipe_id:'missing',ingredient_id:'i',is_main:1,quantity:null,unit:null,position:0});
  await assert.rejects(() => restoreLocalBackup(db, invalid));
  assert.equal(sqlite.prepare('SELECT name FROM ingredients').get().name,'新食材');
  await restoreLocalBackup(db, backup);
  assert.equal(sqlite.prepare('SELECT name FROM ingredients').get().name,'原食材');
  sqlite.close();
});

test('local catalogue edits, aliases, recipes and deletion guard', async () => {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON'); sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={
    getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args) ?? null,
    getAllAsync:async(sql,...args)=>sqlite.prepare(sql).all(...args),
    runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...(Array.isArray(args[0])?args[0]:args)),
  };
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('vegetable','素菜',1,1);
  let counter=0; const catalog=new LocalCatalog(db,()=>`id-${++counter}`,()=> '2026-01-01T00:00:00Z');
  const ingredient=await catalog.saveIngredient({name:'番茄',ingredient_category:'vegetable',seasons:['summer']});
  await catalog.saveIngredient({name:'西红柿',ingredient_category:'vegetable',seasons:['summer']},ingredient.id);
  assert.equal((await catalog.listIngredients({q:'番茄'})).items[0].name,'西红柿');
  await assert.rejects(()=>catalog.saveIngredient({name:'番茄',ingredient_category:'vegetable',seasons:[]}),/已存在/);
  const recipe=await catalog.saveRecipe({name:'炒番茄',category_id:'vegetable',is_hearty:false,ingredients:[{ingredient_id:ingredient.id,is_main:true,quantity:null,unit:null}],steps:null,notes:null,cook_time_minutes:null});
  assert.equal((await catalog.listRecipes({ingredientId:ingredient.id})).total,1);
  await assert.rejects(()=>catalog.deleteIngredient(ingredient.id),/仍被菜谱引用/);
  await catalog.deleteRecipe(recipe.id); await catalog.deleteIngredient(ingredient.id);
  assert.equal((await catalog.listIngredients()).total,0);
  sqlite.close();
});

test('local catalogue API returns existing page contracts and validates profile', async () => {
  const sqlite=new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON'); sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>sqlite.prepare(sql).all(...args),runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...(Array.isArray(args[0])?args[0]:args))};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('vegetable','素菜',1,1);
  let next=0; const request=createLocalCatalogApi(db,()=>`id-${++next}`);
  await request('/ingredients',{method:'POST',body:JSON.stringify({name:'南瓜',ingredient_category:'vegetable',seasons:['autumn']})});
  assert.equal((await request('/ingredients?q=%E5%8D%97%E7%93%9C&limit=20')).total,1);
  await assert.rejects(()=>request('/profile',{method:'PUT',body:JSON.stringify({people_count:3,category_counts:{meat:0}})}),/总菜数/);
  await request('/profile',{method:'PUT',body:JSON.stringify({people_count:3,category_counts:{meat:1,vegetable:2}})});
  assert.equal((await request('/profile')).profile.total_dishes,3);
  sqlite.close();
});

test('meal records are idempotent, preserve snapshots and reject stale updates', async () => {
  const sqlite=new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON'); sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>sqlite.prepare(sql).all(...args),runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...(Array.isArray(args[0])?args[0]:args))};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('vegetable','素菜',1,1);
  let n=0;const makeId=()=>`id-${++n}`;const catalog=new LocalCatalog(db,makeId);
  const ingredient=await catalog.saveIngredient({name:'白菜',ingredient_category:'vegetable',seasons:['all_year']});
  const recipe=await catalog.saveRecipe({name:'炒白菜',category_id:'vegetable',is_hearty:false,ingredients:[{ingredient_id:ingredient.id,is_main:true,quantity:null,unit:null}],steps:null,notes:null,cook_time_minutes:null});
  const request=createLocalMealApi(db,makeId), body={meal_date:'2020-01-01',people_count:2,recipe_ids:[recipe.id],request_key:'unique-request-key-001'};
  const record=await request('/meal-records',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await request('/meal-records',{method:'POST',body:JSON.stringify(body)})).id,record.id);
  assert.equal((await request('/meal-records?month=2020-01')).items.length,1);
  await catalog.deleteRecipe(recipe.id);
  const updated=await request(`/meal-records/${record.id}`,{method:'PUT',body:JSON.stringify({...body,people_count:3,revision:1,request_key:'unique-request-key-002'})});
  assert.equal(updated.dishes[0].name,'炒白菜'); assert.equal(updated.revision,2);
  await assert.rejects(()=>request(`/meal-records/${record.id}`,{method:'PUT',body:JSON.stringify({...body,revision:1,request_key:'unique-request-key-003'})}),/已更新/);
  await assert.rejects(()=>request(`/meal-records/${record.id}?revision=1`,{method:'DELETE'}),/已更新/);
  await request(`/meal-records/${record.id}?revision=2`,{method:'DELETE'});
  assert.equal((await request('/meal-records?month=2020-01')).items.length,0);
  sqlite.close();
});

test('local plans generate, replace and reject stale changes', async () => {
  const sqlite=new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON'); sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>sqlite.prepare(sql).all(...args),runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...(Array.isArray(args[0])?args[0]:args))};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('vegetable','素菜',1,1);
  let n=0;const id=()=>`id-${++n}`,catalog=new LocalCatalog(db,id);
  for(const name of ['南瓜','白菜','茄子']) {
    const i=await catalog.saveIngredient({name,ingredient_category:'vegetable',seasons:['all_year']});
    await catalog.saveRecipe({name:`炒${name}`,category_id:'vegetable',is_hearty:false,ingredients:[{ingredient_id:i.id,is_main:true,quantity:null,unit:null}],steps:null,notes:null,cook_time_minutes:null});
  }
  const request=createLocalPlanApi(db,id),body={request_key:'plan-request-key-001',people_count:2,category_counts:{vegetable:1},allow_nonseasonal:false};
  const plan=await request('/recommendations',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await request('/recommendations',{method:'POST',body:JSON.stringify(body)})).id,plan.id);
  const changed=await request(`/recommendations/${plan.id}/replace`,{method:'POST',body:JSON.stringify({request_key:'plan-request-key-002',expected_revision:1,recipe_id:plan.dishes[0].recipe_id})});
  assert.notEqual(changed.dishes[0].recipe_id,plan.dishes[0].recipe_id);assert.equal(changed.revision,2);
  await assert.rejects(()=>request(`/recommendations/${plan.id}/regenerate`,{method:'POST',body:JSON.stringify({request_key:'plan-request-key-003',expected_revision:1})}),/已更新/);
  const meals=createLocalMealApi(db,id), mealBody={meal_date:changed.as_of_date,people_count:2,recipe_ids:changed.dishes.map(d=>d.recipe_id),request_key:'confirmation-key-001',plan_id:changed.id,plan_revision:2};
  const confirmed=await meals('/meal-records',{method:'POST',body:JSON.stringify(mealBody)});
  assert.equal(confirmed.dishes[0].recipe_id,changed.dishes[0].recipe_id);
  await assert.rejects(()=>request(`/recommendations/${plan.id}/regenerate`,{method:'POST',body:JSON.stringify({request_key:'plan-request-key-004',expected_revision:2})}),/已更新/);
  sqlite.close();
});

test('manual swap keeps a recently eaten manual dish while excluding it from replacements', async () => {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>sqlite.prepare(sql).all(...args),runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...(Array.isArray(args[0])?args[0]:args))};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('vegetable','素菜',1,1);
  let n=0;const id=()=>`id-${++n}`,catalog=new LocalCatalog(db,id),recipes=[];
  for(const name of ['南瓜','白菜','茄子']){
    const i=await catalog.saveIngredient({name,ingredient_category:'vegetable',seasons:['all_year']});
    recipes.push(await catalog.saveRecipe({name:`炒${name}`,category_id:'vegetable',is_hearty:false,ingredients:[{ingredient_id:i.id,is_main:true,quantity:null,unit:null}],steps:null,notes:null,cook_time_minutes:null}));
  }
  const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10),meals=createLocalMealApi(db,id),plans=createLocalPlanApi(db,id);
  await meals('/meal-records',{method:'POST',body:JSON.stringify({meal_date:day,people_count:2,recipe_ids:[recipes[0].id],request_key:'manual-confirm-key-001'})});
  const plan=await plans('/recommendations/manual-swap',{method:'POST',body:JSON.stringify({request_key:'manual-swap-request-001',action:'replace',selected_recipe_ids:[recipes[0].id,recipes[1].id],recipe_id:recipes[1].id,people_count:2,allow_nonseasonal:false})});
  assert.deepEqual(plan.dishes.map(x=>x.recipe_id),[recipes[0].id,recipes[2].id]);
  const record=await meals('/meal-records',{method:'POST',body:JSON.stringify({meal_date:day,people_count:2,recipe_ids:plan.dishes.map(x=>x.recipe_id),request_key:'manual-confirm-key-002',plan_id:plan.id,plan_revision:plan.revision})});
  assert.equal(record.dishes[0].recipe_id,recipes[0].id);
  sqlite.close();
});

test('shopping list combines quantities and detects mixed units', async () => {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>sqlite.prepare(sql).all(...args),runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...(Array.isArray(args[0])?args[0]:args))};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('vegetable','素菜',1,1);
  let n=0;const id=()=>`id-${++n}`,catalog=new LocalCatalog(db,id);
  const i=await catalog.saveIngredient({name:'豆腐',ingredient_category:'soy',seasons:['all_year']});
  const make=async(name,quantity,unit)=>catalog.saveRecipe({name,category_id:'vegetable',is_hearty:false,ingredients:[{ingredient_id:i.id,is_main:true,quantity,unit}],steps:null,notes:null,cook_time_minutes:null});
  const r1=await make('一号','0.1','克'),r2=await make('二号','0.2','克'),r3=await make('三号','1','份');
  const shopping=createLocalShoppingApi(db);
  const combined=await shopping({recipe_ids:[r1.id,r2.id]});assert.equal(combined.items[0].quantity,'0.3');
  const mixed=await shopping({recipe_ids:[r1.id,r3.id]});assert.equal(mixed.items[0].quantity,null);assert.match(mixed.items[0].note,/单位不同/);
  sqlite.close();
});

test('local route flow creates recipes, recommends, confirms and avoids recently confirmed dish', async () => {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>sqlite.prepare(sql).all(...args),runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...(Array.isArray(args[0])?args[0]:args))};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('vegetable','素菜',1,1);
  let n=0;const api=createLocalApi(db,()=>`id-${++n}`);
  const ingredient=await api('/ingredients',{method:'POST',body:JSON.stringify({name:'豆腐',ingredient_category:'soy',seasons:['all_year']})});
  const recipe=await api('/recipes',{method:'POST',body:JSON.stringify({name:'蒸豆腐',category_id:'vegetable',is_hearty:false,ingredients:[{ingredient_id:ingredient.id,is_main:true,quantity:null,unit:null}],steps:null,notes:null,cook_time_minutes:null})});
  const plan=await api('/recommendations',{method:'POST',body:JSON.stringify({request_key:'integration-key-0001',people_count:2,category_counts:{vegetable:1}})});
  assert.equal(plan.dishes[0].recipe_id,recipe.id);
  await api('/meal-records',{method:'POST',body:JSON.stringify({request_key:'integration-key-0002',meal_date:plan.as_of_date,people_count:2,recipe_ids:[recipe.id],plan_id:plan.id,plan_revision:plan.revision})});
  await assert.rejects(()=>api('/recommendations',{method:'POST',body:JSON.stringify({request_key:'integration-key-0003',people_count:2,category_counts:{vegetable:1}})}),/还缺1道/);
  sqlite.close();
});

test('local AI dialogue generates and adds dessert to the actual menu', async () => {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(sql,...args)=>sqlite.prepare(sql).get(...args)??null,getAllAsync:async(sql,...args)=>sqlite.prepare(sql).all(...args),runAsync:async(sql,...args)=>sqlite.prepare(sql).run(...(Array.isArray(args[0])?args[0]:args))};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sqlite.exec('BEGIN');try{await fn(tx);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('vegetable','素菜',1,1);sqlite.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run('dessert','甜点',2,1);
  let n=0;const id=()=>`id-${++n}`,catalog=new LocalCatalog(db,id);
  for(const [name,category] of [['南瓜','vegetable'],['青菜','vegetable'],['白菜','vegetable'],['红豆','dessert']]){
    const i=await catalog.saveIngredient({name,ingredient_category:'other',seasons:['all_year']});
    await catalog.saveRecipe({name:`${name}菜`,category_id:category,is_hearty:false,ingredients:[{ingredient_id:i.id,is_main:true,quantity:null,unit:null}],steps:null,notes:null,cook_time_minutes:null});
  }
  const ask=async(messages)=>{
    const context=JSON.parse(messages[1].content);
    if(context.pending_user_messages)return {action:context.pending_user_messages.at(-1).includes('甜品')?'add':'generate',target_recipe_ids:[],keep_recipe_ids:[],constraints:[],preferences:[],reply:'好的'};
    const selected=context.slots.map((category,slot)=>({slot,candidate_id:context.candidate_recipes.find(d=>d.category_id===category&&!context.kept.some(k=>k.recipe_id===d.recipe_id)).recipe_id,suitability:'match',reason:'合适'}));
    const eligible=context.slots.length===1&&context.slots[0]==='dessert'?context.candidate_recipes.filter(d=>d.category_id==='dessert'):context.candidate_recipes;
    return {eligible_ids:eligible.map(d=>d.recipe_id),choices:selected,reply:'已搭配'};
  };
  const api=createLocalAiApi(db,id,ask,async()=>true),base={people_count:2,category_counts:{vegetable:1},allow_nonseasonal:false};
  const first=await api('/ai/chat',{method:'POST',body:JSON.stringify({...base,request_key:'ai-integration-key-001',message:'来一道素菜',selected_recipe_ids:[]})});
  assert.equal(first.mode,'chat');assert.equal(first.dishes.length,1);
  const explained=await api(`/ai/plans/${first.id}/explanation`,{method:'POST',body:JSON.stringify({revision:first.revision,text:'这餐选择了南瓜菜。'})});
  assert.equal(explained.ai.messages.at(-1).content,'这餐选择了南瓜菜。');assert.equal(explained.revision,first.revision);
  const second=await api('/ai/chat',{method:'POST',body:JSON.stringify({...base,request_key:'ai-integration-key-002',message:'加一份甜品',plan_id:first.id,expected_revision:first.revision,selected_recipe_ids:first.dishes.map(d=>d.recipe_id)})});
  assert.equal(second.dishes.length,2);assert.equal(second.dishes[0].recipe_id,first.dishes[0].recipe_id);assert.equal(second.dishes[1].category_id,'dessert');
  await assert.rejects(()=>api(`/ai/plans/${first.id}/explanation`,{method:'POST',body:JSON.stringify({revision:first.revision,text:'过期的说明'})}),/菜单已变化/);
  assert.equal(second.ai.candidate_counts.vegetable,3,'adding dessert must preserve approved vegetable replacements');
  const retry=await api('/ai/chat',{method:'POST',body:JSON.stringify({...base,request_key:'ai-integration-key-002',message:'加一份甜品',plan_id:first.id,expected_revision:first.revision,selected_recipe_ids:first.dishes.map(d=>d.recipe_id)})});
  assert.equal(retry.revision,second.revision);assert.equal(retry.dishes.length,2);
  const plans=createLocalPlanApi(db,id);
  const manualSwap=await plans('/recommendations/manual-swap',{method:'POST',body:JSON.stringify({request_key:'ai-manual-swap-key-001',action:'replace',selected_recipe_ids:second.dishes.map(d=>d.recipe_id),people_count:2,allow_nonseasonal:false,plan_id:second.id,expected_revision:second.revision,recipe_id:second.dishes[0].recipe_id})});
  assert.equal(manualSwap.mode,'chat');assert.notEqual(manualSwap.dishes[0].recipe_id,second.dishes[0].recipe_id);assert.equal(manualSwap.dishes[1].recipe_id,second.dishes[1].recipe_id);
  let swapped=await plans(`/recommendations/${second.id}/replace`,{method:'POST',body:JSON.stringify({request_key:'ai-swap-request-key-001',expected_revision:second.revision,recipe_id:second.dishes[0].recipe_id})});
  assert.notEqual(swapped.dishes[0].recipe_id,second.dishes[0].recipe_id);
  assert.equal(swapped.dishes[1].recipe_id,second.dishes[1].recipe_id);
  const limitedMemory=JSON.parse(sqlite.prepare('SELECT ai_memory FROM rule_plans WHERE id=?').get(swapped.id).ai_memory);
  limitedMemory.hearty_count=0;
  sqlite.prepare('UPDATE rule_plans SET ai_memory=? WHERE id=?').run(JSON.stringify(limitedMemory),swapped.id);
  swapped=await plans(`/recommendations/${second.id}/regenerate`,{method:'POST',body:JSON.stringify({request_key:'ai-regenerate-key-0001',expected_revision:swapped.revision})});
  assert.equal(swapped.dishes.filter(d=>d.is_hearty).length,0);
  assert.equal(swapped.dishes.filter(d=>d.category_id==='dessert').length,1);
  const meals=createLocalMealApi(db,id);
  const storedMemory=sqlite.prepare('SELECT ai_memory FROM rule_plans WHERE id=?').get(swapped.id).ai_memory;
  const blocked=JSON.parse(storedMemory);blocked.blocked=true;
  sqlite.prepare('UPDATE rule_plans SET ai_memory=? WHERE id=?').run(JSON.stringify(blocked),swapped.id);
  const confirmBody={request_key:'ai-confirm-key-0001',meal_date:swapped.as_of_date,people_count:2,recipe_ids:swapped.dishes.map(d=>d.recipe_id),plan_id:swapped.id,plan_revision:swapped.revision};
  await assert.rejects(()=>meals('/meal-records',{method:'POST',body:JSON.stringify(confirmBody)}),/尚未完成/);
  blocked.constraints=[{kind:'ingredient',ingredient_id:swapped.dishes[0].ingredients[0].ingredient_id,text:'忌口',evidence:'忌口'}];
  sqlite.prepare('UPDATE rule_plans SET ai_memory=? WHERE id=?').run(JSON.stringify(blocked),swapped.id);
  await assert.rejects(()=>meals('/meal-records',{method:'POST',body:JSON.stringify({...confirmBody,use_current_menu:true,acknowledge_unknown:true})}),/忌口食材/);
  sqlite.prepare('UPDATE rule_plans SET ai_memory=? WHERE id=?').run(storedMemory,swapped.id);
  const confirmed=await meals('/meal-records',{method:'POST',body:JSON.stringify({request_key:'ai-confirm-key-0001',meal_date:swapped.as_of_date,people_count:2,recipe_ids:swapped.dishes.map(d=>d.recipe_id),plan_id:swapped.id,plan_revision:swapped.revision})});
  assert.deepEqual(confirmed.dishes.map(d=>d.recipe_id),swapped.dishes.map(d=>d.recipe_id));
  sqlite.close();
});
