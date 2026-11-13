import type { SQLiteDatabase } from 'expo-sqlite';
import { loadCandidatePool, publicDish } from './recommendation-data.ts';
import { matchPantry } from './discovery.ts';

export function createDiscoveryApi(db: SQLiteDatabase) {
  return async (path: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body || '{}'));
    const ids = body.selected_recipe_ids ?? [];
    if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string')) throw new Error('所选菜品无效');
    const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const pool = (await loadCandidatePool(db, { today: date, allowNonseasonal: !!body.allow_nonseasonal })).filter(d => !ids.includes(d.recipe_id));
    if (path === '/recommendations/discover') {
      const allowed = ['', 'meat', 'vegetable', 'soup', 'dessert', 'fruit', 'staple', 'hearty'];
      const category = body.category_id || '';
      if (!allowed.includes(category)) throw new Error('请选择有效分类');
      const eligible = pool.filter(d => !category || (category === 'hearty' ? d.is_hearty : d.category_id === category));
      const fresh = eligible.filter(d => d.recipe_id !== body.previous_id);
      const choices = fresh.length ? fresh : eligible;
      if (!choices.length) throw new Error('当前条件下没有可选菜谱，请换个分类、调整季节设置或补充菜谱。');
      return publicDish(choices[Math.floor(Math.random() * choices.length)]!);
    }
    const ingredients = body.ingredient_ids;
    if (!Array.isArray(ingredients) || !ingredients.length || ingredients.length > 100 || ingredients.some(id => typeof id !== 'string')) throw new Error('请先选择家里有的食材（最多100种）');
    // Condiments are assumed to be checked by the cook, never treated as missing main ingredients.
    const seasoning = new Set((await db.getAllAsync<{id:string}>("SELECT id FROM ingredients WHERE ingredient_category='seasoning'")).map(i => i.id));
    const dishes = pool.map(d => ({ ...publicDish(d), ingredients: d.ingredients.filter(i => !seasoning.has(i.ingredient_id)) }));
    const matched = matchPantry(dishes, ingredients);
    const originals = new Map(pool.map(d => [d.recipe_id, publicDish(d)]));
    return { ready: matched.ready.map(m => ({...m,dish:originals.get(m.dish.recipe_id)!})), missingOne: matched.missingOne.map(m => ({...m,dish:originals.get(m.dish.recipe_id)!})) };
  };
}
