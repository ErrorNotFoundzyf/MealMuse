import type { LocalCandidate } from './recommendation-data.ts';
import { dishSignature } from './candidates.ts';

type Selection={eligible_ids:unknown;choices:unknown;reply:unknown};
type Choice={slot:unknown;candidate_id:unknown;suitability:unknown;reason:unknown};

export function cleanAssistantReply(input:unknown):string {
  if(typeof input!=='string'||!input.trim()||input.length>400) return '请查看本餐菜单，也可以继续告诉我想调整哪些菜。';
  if (/[a-z]+_[a-z_]+|\b(?:slots|schema|json)\b|槽位|冻结|候选池/i.test(input)) return '请查看本餐菜单，也可以点击换菜或继续告诉我想调整哪些菜。';
  if (/治愈|治疗|保证|绝对安全|无过敏原|降火功效/.test(input)) return '已按本次要求调整；配料和做法不完整时，请在确认前核对。';
  return input.trim();
}

/** Model output is untrusted: every selected and cached ID must pass local validation. */
export function validateModelSelection(raw:unknown,options:{pool:LocalCandidate[];slots:string[];kept:LocalCandidate[];excludedIngredientIds:string[];heartyCount:number|null}) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('AI 返回内容不完整，请重试');
  const data=raw as Selection;
  if(!Array.isArray(data.eligible_ids)||data.eligible_ids.length>options.pool.length||data.eligible_ids.some(x=>typeof x!=='string')||new Set(data.eligible_ids).size!==data.eligible_ids.length)throw new Error('AI 未能可靠筛选菜谱，请重试');
  const lookup=new Map(options.pool.map(d=>[d.recipe_id,d]));
  const eligible:LocalCandidate[]=[];
  for(const id of data.eligible_ids){
    const dish=lookup.get(id);
    if(!dish||dish.ingredients.some(i=>options.excludedIngredientIds.includes(i.ingredient_id)))throw new Error('AI 备选存在不符合要求的菜谱，请重试');
    eligible.push(dish);
  }
  if(!Array.isArray(data.choices)||data.choices.length!==options.slots.length)throw new Error('AI 未能配齐菜品，请重试');
  const usedIds=new Set(options.kept.map(d=>d.recipe_id)),usedSignatures=new Set(options.kept.map(dishSignature));
  const slots=new Map<number,LocalCandidate>();
  for(const rawChoice of data.choices){
    if(!rawChoice||typeof rawChoice!=='object'||Array.isArray(rawChoice))throw new Error('AI 返回菜品不完整，请重试');
    const choice=rawChoice as Choice;
    if(!Number.isInteger(choice.slot)||typeof choice.slot!=='number'||choice.slot<0||choice.slot>=options.slots.length||slots.has(choice.slot)||typeof choice.candidate_id!=='string'||!['match','unknown'].includes(String(choice.suitability))||typeof choice.reason!=='string')throw new Error('AI 返回菜品不完整，请重试');
    const dish=eligible.find(d=>d.recipe_id===choice.candidate_id);
    if(!dish||dish.category_id!==options.slots[choice.slot]||usedIds.has(dish.recipe_id)||usedSignatures.has(dishSignature(dish)))throw new Error('AI 返回的菜品不符合分类或重复，请重试');
    usedIds.add(dish.recipe_id);usedSignatures.add(dishSignature(dish));slots.set(choice.slot,dish);
  }
  const selected=options.slots.map((_,i)=>slots.get(i)!);
  const all=[...options.kept,...selected];
  if(options.heartyCount!==null&&all.filter(d=>d.is_hearty||d.category_id==='hearty').length!==options.heartyCount)throw new Error('本轮菜单未满足硬菜数量，当前菜单已保留');
  return {eligible,selected,reply:cleanAssistantReply(data.reply)};
}

/** Repair incomplete slot assignments using only model-approved, locally validated candidates. */
export function selectFromApproved(raw:unknown,options:{pool:LocalCandidate[];slots:string[];kept:LocalCandidate[];excludedIngredientIds:string[];heartyCount:number|null}) {
  try{return validateModelSelection(raw,options);}catch(original){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw original;
    const data=raw as Selection;
    const approved=validateModelSelection({eligible_ids:data.eligible_ids,choices:[],reply:data.reply},{...options,slots:[],kept:[],heartyCount:null}).eligible;
    const used=new Set(options.kept.map(dishSignature));const choices:LocalCandidate[]=[];let attempts=0;
    const search=(index:number):boolean=>{
      if(++attempts>20000)return false;
      if(index===options.slots.length)return options.heartyCount===null||[...options.kept,...choices].filter(d=>d.is_hearty||d.category_id==='hearty').length===options.heartyCount;
      for(const dish of approved){const key=dishSignature(dish);if(dish.category_id!==options.slots[index]||used.has(key))continue;
        choices.push(dish);used.add(key);
        if(search(index+1))return true;
        choices.pop();used.delete(key);
      }return false;
    };
    if(!search(0))throw original;
    return validateModelSelection({eligible_ids:data.eligible_ids,choices:choices.map((d,slot)=>({slot,candidate_id:d.recipe_id,suitability:'unknown',reason:'本地搭配'})),reply:'已根据本次人数和菜数调整菜单，请查看。'},options);
  }
}
