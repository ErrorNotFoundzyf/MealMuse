import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createLocalPlanApi} from '../src/local/plan-api.ts';
const sql=new DatabaseSync(fileURLToPath(new URL('../../outputs/acceptance/phone-swap-copy.db',import.meta.url)));
const tx={getFirstAsync:async(q,...a)=>sql.prepare(q).get(...a)??null,getAllAsync:async(q,...a)=>sql.prepare(q).all(...a),runAsync:async(q,...a)=>sql.prepare(q).run(...(Array.isArray(a[0])?a[0]:a))};
const db={...tx,withExclusiveTransactionAsync:async fn=>{sql.exec('BEGIN');try{await fn(tx);sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
const api=createLocalPlanApi(db,randomUUID);
const latest=sql.prepare('SELECT * FROM rule_plans WHERE confirmed_record_id IS NULL ORDER BY updated_at DESC LIMIT 1').get();
if(!latest)throw new Error('没有未确认菜单');
const memory=latest.ai_memory?JSON.parse(latest.ai_memory):null;
const count={};for(const d of memory?.candidate_pool||[])count[d.category_id]=(count[d.category_id]||0)+1;
console.log(JSON.stringify({revision:latest.revision,hearty:memory?.hearty_count,blocked:memory?.blocked,candidates:count}));
for(const target of JSON.parse(latest.dishes)){
 const row=sql.prepare('SELECT revision FROM rule_plans WHERE id=?').get(latest.id);
 try{const next=await api(`/recommendations/${latest.id}/replace`,{method:'POST',body:JSON.stringify({request_key:randomUUID(),expected_revision:row.revision,recipe_id:target.recipe_id})});console.log(JSON.stringify({target:target.name,success:true,changed:next.dishes.find(d=>d.category_id===target.category_id)?.name}));}
 catch(e){console.log(JSON.stringify({target:target.name,success:false,error:e.message}));}
}
sql.close();
