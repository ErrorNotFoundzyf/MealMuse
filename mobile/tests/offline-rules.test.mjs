import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LOCAL_SCHEMA_V1 } from '../src/local/schema.ts';
import { LocalCatalog } from '../src/local/catalog.ts';
import { createLocalApi } from '../src/local/local-api.ts';
import { recentDayStart } from '../src/local/candidates.ts';
import { matchPantry } from '../src/local/discovery.ts';
import { orderMenuDishes } from '../src/menu-order.ts';

const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const daysAgo=n=>{const d=new Date(`${today()}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);};
function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(LOCAL_SCHEMA_V1);
  const tx={getFirstAsync:async(q,...a)=>sql.prepare(q).get(...a)??null,getAllAsync:async(q,...a)=>sql.prepare(q).all(...a),runAsync:async(q,...a)=>sql.prepare(q).run(...(Array.isArray(a[0])?a[0]:a))};
  const db={...tx,withExclusiveTransactionAsync:async fn=>{sql.exec('BEGIN');try{await fn(tx);sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
  for(const [id,name]of [['meat','荤菜'],['vegetable','素菜'],['soup','汤'],['dessert','甜点'],['fruit','水果']])sql.prepare('INSERT INTO dish_categories VALUES (?,?,?,?)').run(id,name,1,1);
  let n=0;const id=()=>`test-${++n}`,catalog=new LocalCatalog(db,id),api=createLocalApi(db,id);
  const post=(path,body)=>api(path,{method:'POST',body:JSON.stringify(body)});
  const ingredient=(name,category='vegetable',seasons=['all_year'])=>catalog.saveIngredient({name,ingredient_category:category,seasons});
  const recipe=(name,category_id,ingredients)=>catalog.saveRecipe({name,category_id,is_hearty:false,ingredients:ingredients.map(i=>({ingredient_id:i.id,is_main:true,quantity:null,unit:null})),steps:null,notes:null,cook_time_minutes:null});
  return {sql,catalog,api,post,ingredient,recipe};
}

test('four natural days include today through day minus three, including leap/year boundaries',()=>{
  assert.equal(recentDayStart('2027-01-01'),'2026-12-29');
  assert.equal(recentDayStart('2028-03-01'),'2028-02-27');
  assert.equal(recentDayStart('2026-03-01'),'2026-02-26');
});

test('pantry matching requires overlap, deduplicates ingredients, and separates missing-one recipes',()=>{
  const dish=(id,ids)=>({recipe_id:id,category_id:'vegetable',ingredients:ids.map(i=>({ingredient_id:i,name:i,is_main:true}))});
  const result=matchPantry([dish('ready',['a','a']),dish('one',['a','b']),dish('two',['a','b','c']),dish('unrelated',['d']),dish('empty',[])],['a']);
  assert.deepEqual(result.ready.map(x=>x.dish.recipe_id),['ready']);
  assert.deepEqual(result.missingOne.map(x=>[x.dish.recipe_id,x.missing]),[['one',['b']]]);
});

test('discovery and pantry use live seasonal and four-day rules without an AI client',async()=>{
  const f=fixture();try{
    const tomato=await f.ingredient('番茄'),egg=await f.ingredient('鸡蛋','egg'),salt=await f.ingredient('盐','seasoning');
    const ready=await f.recipe('番茄炒蛋','vegetable',[tomato,egg,salt]);
    const day3=await f.recipe('前三天吃过','vegetable',[tomato]);
    const day4=await f.recipe('前四天吃过','vegetable',[egg]);
    await f.post('/meal-records',{meal_date:daysAgo(3),people_count:2,recipe_ids:[day3.id],request_key:'confirmed-minus-three-001'});
    await f.post('/meal-records',{meal_date:daysAgo(4),people_count:2,recipe_ids:[day4.id],request_key:'confirmed-minus-four-0001'});
    const result=await f.post('/recommendations/pantry',{ingredient_ids:[tomato.id,egg.id]});
    assert.deepEqual(new Set(result.ready.map(m=>m.dish.recipe_id)),new Set([ready.id,day4.id]));
    assert.ok(result.ready.find(m=>m.dish.recipe_id===ready.id).dish.ingredients.some(i=>i.ingredient_id===salt.id),'full recipe still contains the condiment');
    const selected=await f.post('/recommendations/discover',{category_id:'vegetable',selected_recipe_ids:[ready.id]});
    assert.equal(selected.recipe_id,day4.id);
    await f.catalog.saveRecipe({...day4,is_hidden:true},day4.id);
    await assert.rejects(()=>f.post('/recommendations/discover',{selected_recipe_ids:[ready.id]}),/没有可选/);
    await assert.rejects(()=>f.post('/recommendations/pantry',{ingredient_ids:[]}),/先选择/);
    const month=Number(today().slice(5,7));const opposite=month>=6&&month<=8?'winter':'summer';
    const seasonal=await f.ingredient('非当季食材','vegetable',[opposite]);const off=await f.recipe('非当季菜','vegetable',[seasonal]);
    await assert.rejects(()=>f.post('/recommendations/discover',{selected_recipe_ids:[ready.id]}),/没有可选/);
    assert.equal((await f.post('/recommendations/discover',{selected_recipe_ids:[ready.id],allow_nonseasonal:true})).recipe_id,off.id);
  }finally{f.sql.close();}
});

test('rules preserve manual recent choices, fill exact deficits, keep extras and confirm edited menus',async()=>{
  const f=fixture();try{
    const a=await f.ingredient('白菜'),b=await f.ingredient('豆腐'),c=await f.ingredient('牛肉','meat'),s=await f.ingredient('梨','fruit');
    const veg1=await f.recipe('炒白菜','vegetable',[a]),veg2=await f.recipe('煎豆腐','vegetable',[b]),meat=await f.recipe('炖牛肉','meat',[c]),sweet=await f.recipe('蒸梨','dessert',[s]);
    await f.post('/meal-records',{meal_date:today(),people_count:2,recipe_ids:[veg1.id],request_key:'already-eaten-manual-001'});
    const base={people_count:2,category_counts:{meat:1,vegetable:2,soup:0},selected_recipe_ids:[veg1.id,sweet.id],request_key:'complete-with-extras-001'};
    const plan=await f.post('/recommendations',base);
    assert.deepEqual(new Set(plan.dishes.map(d=>d.recipe_id)),new Set([veg1.id,veg2.id,meat.id,sweet.id]));
    assert.equal((await f.post('/recommendations',base)).id,plan.id);
    const updated=await f.post('/recommendations',{...base,people_count:3,category_counts:{meat:1,vegetable:0,soup:0},selected_recipe_ids:[sweet.id],request_key:'changed-settings-00001'});
    assert.deepEqual(new Set(updated.dishes.map(d=>d.recipe_id)),new Set([meat.id,sweet.id]));
    const record=await f.post('/meal-records',{meal_date:today(),people_count:3,recipe_ids:[meat.id],plan_id:updated.id,plan_revision:updated.revision,manual_adjustment:true,request_key:'confirmed-after-remove-001'});
    assert.deepEqual(record.dishes.map(d=>d.recipe_id),[meat.id]);
    await assert.rejects(()=>f.post('/recommendations',{...base,category_counts:{meat:2},selected_recipe_ids:[],request_key:'shortage-does-not-relax-01'}),/还缺/);
  }finally{f.sql.close();}
});

test('visible numbering is stable across categories without mutating source dishes',()=>{
  const dishes=[{category_id:'dessert',id:'d'},{category_id:'meat',id:'m1'},{category_id:'soup',id:'s'},{category_id:'vegetable',id:'v'},{category_id:'meat',id:'m2'}];
  assert.deepEqual(orderMenuDishes(dishes).map(d=>d.id),['s','m1','m2','v','d']);assert.equal(dishes[0].id,'d');
});
