import { dishSignature, type CandidateDish } from './candidates.ts';

type Dish = CandidateDish & { is_hearty?: boolean; season_coverage: number };
type Beam = { score: number; dishes: Dish[] };
const isHearty = (dish: Dish) => !!dish.is_hearty || dish.category_id === 'hearty';

/** Combine an already validated candidate pool. Never relax the candidate filters. */
export function selectMenu(pool: Dish[], counts: Record<string, number>, options: {
  avoidIds?: string[]; heartyCount?: number | null; random?: () => number;
} = {}): Dish[] {
  const valid = new Set(['meat', 'vegetable', 'soup']);
  const entries = Object.entries(counts);
  if (entries.some(([k,v]) => !valid.has(k) || !Number.isInteger(v) || v < 0 || v > 20) || entries.reduce((n,[,v]) => n+v,0) < 1 || entries.reduce((n,[,v]) => n+v,0) > 20) throw new Error('请选择荤菜、素菜、汤的数量，总数为1到20道');
  const required = options.heartyCount ?? null;
  const total = entries.reduce((n,[,v]) => n+v,0);
  if (required !== null && (!Number.isInteger(required) || required < 0 || required > total)) throw new Error('硬菜数量不符合本餐菜数');
  const labels: Record<string,string> = {meat:'荤菜',vegetable:'素菜',soup:'汤'};
  const shortage = entries.flatMap(([category,count]) => {
    const n = new Set(pool.filter(d => d.category_id === category).map(dishSignature)).size;
    return n < count ? [`${labels[category]}还缺${count - n}道`] : [];
  });
  if (shortage.length) throw new Error(`${shortage.join('、')}。请补充菜谱或调整本次菜数；今天及前三天已确认的菜不会放宽。`);
  const avoid = new Set(options.avoidIds ?? []);
  const ranked = pool.map(dish => ({dish, jitter:(options.random ?? Math.random)() * 0.4}));
  const slots = entries.flatMap(([category,count]) => Array<string>(count).fill(category));
  slots.sort((a,b) => pool.filter(d=>d.category_id===a).length - pool.filter(d=>d.category_id===b).length);
  let beam: Beam[] = [{score:0,dishes:[]}];
  for (let index=0; index<slots.length; index++) {
    const next = new Map<string,Beam>();
    for (const row of beam) {
      const used = new Set(row.dishes.map(dishSignature));
      const ingredients = new Map<string,number>();
      for (const d of row.dishes) for (const i of d.ingredients) if (i.is_main) ingredients.set(i.ingredient_id,(ingredients.get(i.ingredient_id) ?? 0)+1);
      for (const {dish,jitter} of ranked) {
        if (dish.category_id !== slots[index] || used.has(dishSignature(dish))) continue;
        const selected = [...row.dishes,dish];
        const hearty = selected.filter(isHearty).length;
        if (required !== null && (hearty > required || hearty + slots.length-index-1 < required)) continue;
        const overlap = dish.ingredients.filter(i=>i.is_main).reduce((n,i)=>n+(ingredients.get(i.ingredient_id) ?? 0),0);
        const score = row.score + dish.season_coverage*10 - overlap*0.7 + jitter - (avoid.has(dish.recipe_id) ? 1.5 : 0);
        const key = JSON.stringify(selected.map(dishSignature).sort());
        if (!next.has(key) || score > next.get(key)!.score) next.set(key,{score,dishes:selected});
      }
    }
    beam=[...next.values()].sort((a,b)=>b.score-a.score).slice(0,40);
  }
  if (!beam.length) throw new Error('没有满足数量且不重复的菜单，请补充菜谱');
  const changed = avoid.size ? beam.filter(row => row.dishes.length !== avoid.size || row.dishes.some(d=>!avoid.has(d.recipe_id))) : beam;
  return (changed[0] ?? beam[0])!.dishes;
}
