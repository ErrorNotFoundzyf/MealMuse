export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'all_year';
export const seasonNames: Record<Season, string> = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季', all_year: '全年' };
export const ingredientCategories = { vegetable: '蔬菜', meat: '肉类', seafood: '水产', mushroom: '菌菇', egg: '蛋类', soy: '豆制品', staple: '谷物主食', seasoning: '调料', fruit: '水果', other: '其他' };
export function mealItemSummary(dishes: { category_id: string }[]): string {
  const dessert = dishes.filter(d => d.category_id === 'dessert').length;
  const fruit = dishes.filter(d => d.category_id === 'fruit').length;
  const ordinary = dishes.length - dessert - fruit;
  return [`${ordinary}道菜`, ...(dessert ? [`${dessert}份甜点`] : []), ...(fruit ? [`${fruit}份水果`] : [])].join(' · ');
}
export type IngredientCategory = keyof typeof ingredientCategories;
export type Ingredient = {
  id: string; name: string; ingredient_category: IngredientCategory | null; seasons: Season[];
  is_hidden: boolean; season_status: 'in_season' | 'out_of_season' | 'season_unknown';
};
export type RecipeIngredient = Ingredient & { ingredient_id: string; is_main: boolean; quantity: string | null; unit: string | null };
export type Recipe = {
  id: string; name: string; category_id: string; is_hearty: boolean; is_hidden: boolean;
  ingredients: RecipeIngredient[]; steps: string | null; notes: string | null; cook_time_minutes: number | null;
};
export type Category = { id: string; name: string };
export function recipeCategoryIds(recipe: { category_id: string; is_hearty?: boolean }): string[] {
  return recipe.is_hearty && recipe.category_id !== 'hearty' ? [recipe.category_id, 'hearty'] : [recipe.category_id];
}
export function recipeCategoryLabel(recipe: { category_id: string; is_hearty?: boolean }, categories: Category[]): string {
  return recipeCategoryIds(recipe).map(id => categories.find(c => c.id === id)?.name || (id === 'hearty' ? '硬菜' : '未分类')).join(' · ');
}
export type Profile = { people_count: number; category_counts: Record<string, number>; total_dishes: number };
export type TimeContext = { as_of_date: string; current_season: Exclude<Season, 'all_year'>; timezone: string };
export type Page<T> = { items: T[]; total: number };

export type MealDish = { recipe_id: string; name: string; category_id: string; category_name: string; is_hearty?: boolean; source?: 'ai_temporary' | 'ai_saved'; constraint_status?: string; constraint_reason?: string; season_warnings?: string[]; ingredients: { ingredient_id: string; name: string; is_main: boolean; quantity: string | null; unit: string | null }[]; steps?: string | null; notes?: string | null; cook_time_minutes?: number | null };
export type MealRecord = { id: string; meal_date: string; people_count: number; dishes: MealDish[]; revision: number; confirmed_at: string; updated_at: string };
export type ShoppingItem = { ingredient_id: string; name: string; recipe_names: string[]; quantity: string | null; unit: string | null; note: string; season_status: string };
export type RulePlan = { id: string; revision: number; people_count: number; category_counts: Record<string, number>; as_of_date: string; dishes: MealDish[]; allow_nonseasonal: boolean; confirmed_record_id: string | null; shopping_list: ShoppingItem[]; mode: 'rules' | 'chat'; ai?: { messages: {role: 'user' | 'assistant'; content: string}[]; blocked: boolean; unknown: string[] | null; pending: string[]; constraints: {text: string}[]; has_candidate_pool?: boolean; candidate_counts?: Record<string, number>; pool_version?: number; last_action?: string; hearty_count?: number | null } | null };
export type PlanningSettings = { people_count: number; category_counts: Record<string, number>; allow_nonseasonal: boolean };
