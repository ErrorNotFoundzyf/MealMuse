import type { MealDish } from '../types';

export type PantryMatch = { dish: MealDish; missing: string[] };
export function matchPantry<T extends MealDish>(pool: T[], ingredientIds: string[]): { ready: PantryMatch[]; missingOne: PantryMatch[] } {
  const have = new Set(ingredientIds), ready: PantryMatch[] = [], missingOne: PantryMatch[] = [];
  for (const dish of pool) {
    const main = [...new Map(dish.ingredients.filter(i => i.is_main).map(i => [i.ingredient_id, i])).values()];
    if (!main.length || !main.some(i => have.has(i.ingredient_id))) continue;
    const missing = main.filter(i => !have.has(i.ingredient_id)).map(i => i.name);
    if (!missing.length) ready.push({ dish, missing });
    else if (missing.length === 1) missingOne.push({ dish, missing });
  }
  return { ready, missingOne };
}
