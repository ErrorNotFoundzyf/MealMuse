import { seasonStatus } from './season.ts';
import type { Season } from '../types';

type Ingredient = { ingredient_id: string; name: string; is_main: boolean; seasons: Season[]; is_hidden: boolean; deleted_at: string | null };
export type CandidateDish = { recipe_id: string; name: string; category_id: string; is_hidden: boolean; deleted_at: string | null; ingredients: Ingredient[] };
type EatenDish = { recipe_id: string; name: string; ingredients: { ingredient_id: string; is_main: boolean }[] };
type Meal = { meal_date: string; deleted_at: string | null; dishes: EatenDish[] };

const categories = new Set(['meat', 'vegetable', 'soup', 'dessert', 'fruit', 'staple']);
// Names are normalized as in the backend for common Chinese and ASCII names.
const normalize = (name: string) => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
export const dishSignature = (dish: EatenDish): string => `${normalize(dish.name)}|${dish.ingredients.filter(i => i.is_main).map(i => i.ingredient_id).sort().join(',')}`;

export function recentDayStart(today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('日期格式不正确');
  const value = new Date(`${today}T00:00:00.000Z`);
  if (Number.isNaN(value.valueOf()) || value.toISOString().slice(0, 10) !== today) throw new Error('日期格式不正确');
  value.setUTCDate(value.getUTCDate() - 3);
  return value.toISOString().slice(0, 10);
}

/** Candidate filtering happens before scoring; recent dishes can never score their way back in. */
export function filterCandidates(dishes: CandidateDish[], records: Meal[], options: {
  today: string; season: Exclude<Season, 'all_year'>; allowNonseasonal: boolean;
  rejectedIds?: string[]; rejectedSignatures?: string[];
}): (CandidateDish & { season_coverage: number; season_warnings: string[] })[] {
  const start = recentDayStart(options.today);
  const recent = records.filter(r => !r.deleted_at && r.meal_date >= start && r.meal_date <= options.today).flatMap(r => r.dishes);
  const blockedIds = new Set([...recent.map(d => d.recipe_id), ...(options.rejectedIds ?? [])]);
  const blockedSignatures = new Set([...recent.map(dishSignature), ...(options.rejectedSignatures ?? [])]);
  return dishes.flatMap(dish => {
    if (dish.deleted_at || dish.is_hidden || !categories.has(dish.category_id) || blockedIds.has(dish.recipe_id) || blockedSignatures.has(dishSignature(dish))) return [];
    if (dish.ingredients.some(i => !!i.deleted_at || i.is_main && i.is_hidden)) return [];
    const main = dish.ingredients.filter(i => i.is_main);
    if (!main.length) return [];
    const states = main.map(i => ({ name: i.name, status: seasonStatus(i.seasons, options.season) }));
    if (!options.allowNonseasonal && states.some(s => s.status !== 'in_season')) return [];
    return [{ ...dish, season_coverage: states.filter(s => s.status === 'in_season').length / states.length,
      season_warnings: states.filter(s => s.status !== 'in_season').map(s => `${s.name}${s.status === 'season_unknown' ? '（季节未设置）' : '（非当季）'}`) }];
  });
}
