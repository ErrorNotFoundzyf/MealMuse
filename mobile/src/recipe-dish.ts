import type { MealDish, Recipe } from './types';

export function recipeToDish(recipe: Recipe): MealDish {
  return { recipe_id: recipe.id, name: recipe.name, category_id: recipe.category_id,
    category_name: ({meat:'荤菜',vegetable:'素菜',soup:'汤',staple:'主食',dessert:'甜点',fruit:'水果'} as Record<string,string>)[recipe.category_id] || '其他',
    is_hearty: recipe.is_hearty, ingredients: recipe.ingredients.map(i => ({ ingredient_id:i.ingredient_id,name:i.name,is_main:i.is_main,quantity:i.quantity,unit:i.unit })),
    steps:recipe.steps,notes:recipe.notes,cook_time_minutes:recipe.cook_time_minutes };
}
