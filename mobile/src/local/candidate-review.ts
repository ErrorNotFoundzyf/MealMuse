import type {LocalConstraint} from './ai-intent.ts';
import type {LocalCandidate} from './recommendation-data.ts';
type Requirements={constraints:LocalConstraint[];preferences:string[]};
type Ask=(messages:{role:'system'|'user'|'assistant';content:string}[])=>Promise<unknown>;
export const needsSemanticReview=(r:Requirements)=>r.preferences.length>0||r.constraints.some(c=>c.kind!=='ingredient');

/** Review the whole rule-filtered pool. Batch size limits request size, not eligibility. */
export async function reviewCandidates(pool:LocalCandidate[],requirements:Requirements,ask:Ask):Promise<LocalCandidate[]> {
  const excluded=new Set(requirements.constraints.flatMap(c=>c.ingredient_id?[c.ingredient_id]:[]));
  const safe=pool.filter(d=>!d.ingredients.some(i=>excluded.has(i.ingredient_id)));
  if(!needsSemanticReview(requirements))return safe;
  const approved:LocalCandidate[]=[];
  for(let offset=0;offset<safe.length;offset+=40){
    const batch=safe.slice(offset,offset+40);
    const result=await ask([{role:'system',content:'评估家庭菜谱是否符合用户的个性化饮食要求。只返回 JSON {"eligible_indexes":[0,1]}。逐一评估输入的全部菜谱，列出所有合适菜谱的 index 整数，不是ID或菜名。只按 constraints 和 preferences 判断，不按本餐数量、是否已选、分类配额或硬菜总数量过滤。不得返回输入中不存在的序号。'},{role:'user',content:JSON.stringify({...requirements,candidate_recipes:batch.map((d,index)=>({index,name:d.name,category:d.category_id,ingredients:d.ingredients.map(i=>({name:i.name,is_main:i.is_main})),steps:d.steps,notes:d.notes}))})}]);
    const indexes=result&&typeof result==='object'&&!Array.isArray(result)?(result as Record<string,unknown>).eligible_indexes:null;
    if(!Array.isArray(indexes)||indexes.some(index=>typeof index!=='number'||!Number.isInteger(index)||index<0||index>=batch.length)||new Set(indexes).size!==indexes.length)throw new Error('AI 未能完整评估本餐备选，请重试');
    approved.push(...batch.filter((_,index)=>indexes.includes(index)));
  }
  return approved;
}
