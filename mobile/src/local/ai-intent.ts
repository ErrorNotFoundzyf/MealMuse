import { cleanAssistantReply } from './ai-contract.ts';
import { extraAdditions } from './extra-requests.ts';

export type LocalConstraint={kind:'ingredient'|'dietary';ingredient_id:string|null;text:string;evidence:string};
export type LocalIntent={action:'generate'|'replace'|'add'|'clarify'|'chat';target_recipe_ids:string[];keep_recipe_ids:string[];people_count:number|null;category_counts:Record<string,number>|null;constraints:LocalConstraint[];preferences:string[];hearty_count:number|null;extra_add:Record<string,number>;reply:string};
type Context={messages:string[];currentRecipeIds:string[];ingredientIds:string[]};
const categories=new Set(['meat','vegetable','soup']);
const asStrings=(value:unknown,max:number):string[]=>{
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value)||value.length>max||value.some(x=>typeof x!=='string'||x.length>200))throw new Error('AI 未能可靠理解要求，请换种说法');
  return value;
};
const integer=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max;

/** Validate model interpretation. Never accept a fabricated dietary restriction or recipe ID. */
export function validateIntent(value:unknown,context:Context):LocalIntent {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('AI 未能可靠理解要求，请换种说法');
  const raw=value as Record<string,unknown>;
  if(!['generate','replace','add','clarify','chat'].includes(String(raw.action)))throw new Error('AI 未能可靠理解要求，请换种说法');
  const targets=asStrings(raw.target_recipe_ids,20),kept=asStrings(raw.keep_recipe_ids,20);
  if(new Set(targets).size!==targets.length||new Set(kept).size!==kept.length||[...targets,...kept].some(id=>!context.currentRecipeIds.includes(id))||targets.some(id=>kept.includes(id)))throw new Error('请用菜名或序号明确需要替换的菜');
  const people=raw.people_count??null;
  if(people!==null&&!integer(people,1,30))throw new Error('请明确用餐人数');
  let counts:Record<string,number>|null=null;
  if(raw.category_counts!==undefined&&raw.category_counts!==null){
    if(typeof raw.category_counts!=='object'||Array.isArray(raw.category_counts))throw new Error('请明确荤菜、素菜和汤各几道');
    const entries=Object.entries(raw.category_counts);
    if(entries.some(([k,v])=>!categories.has(k)||!integer(v,0,20))||entries.reduce((n,[,v])=>n+Number(v),0)<1||entries.reduce((n,[,v])=>n+Number(v),0)>20)throw new Error('请明确荤菜、素菜和汤各几道');
    counts=Object.fromEntries(entries) as Record<string,number>;
  }
  const restrictionValues=raw.constraints??[];
  if(!Array.isArray(restrictionValues)||restrictionValues.length>12)throw new Error('请明确本餐忌口');
  const combined=context.messages.join('\n');
  const constraints=restrictionValues.map((item:unknown)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('请明确本餐忌口');
    const c=item as Record<string,unknown>, ingredient=c.ingredient_id??null;
    if(!['ingredient','dietary'].includes(String(c.kind))||typeof c.text!=='string'||!c.text.trim()||c.text.length>100||typeof c.evidence!=='string'||!c.evidence.trim()||c.evidence.length>200||!combined.includes(c.evidence)||ingredient!==null&&(typeof ingredient!=='string'||!context.ingredientIds.includes(ingredient))||c.kind==='ingredient'&&!ingredient)throw new Error('请明确本餐忌口');
    return {kind:c.kind,ingredient_id:ingredient,text:c.text.trim(),evidence:c.evidence} as LocalConstraint;
  });
  const hearty=raw.hearty_count??null;
  if(hearty!==null&&(!integer(hearty,0,20)||typeof raw.hearty_evidence!=='string'||!combined.includes(raw.hearty_evidence)||!raw.hearty_evidence.includes('硬菜')))throw new Error('请明确需要几道硬菜');
  const extras=extraAdditions(context.messages);
  if(Object.values(extras.add).some(n=>!integer(n,1,20)))throw new Error('请明确需要增加几份甜点或水果');
  return {action:raw.action as LocalIntent['action'],target_recipe_ids:targets,keep_recipe_ids:kept,people_count:people as number|null,category_counts:counts,constraints,preferences:asStrings(raw.preferences,12),hearty_count:hearty as number|null,extra_add:extras.add,reply:cleanAssistantReply(raw.reply)};
}
