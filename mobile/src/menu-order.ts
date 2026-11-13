const categoryOrder: Record<string, number> = {
  soup: 0, meat: 1, vegetable: 2, staple: 3, fruit: 4, dessert: 5,
};

/** Keep the visible menu and conversational dish numbers in the same order. */
export function orderMenuDishes<T extends { category_id: string }>(dishes: readonly T[]): T[] {
  return [...dishes].sort((a, b) => (categoryOrder[a.category_id] ?? 3) - (categoryOrder[b.category_id] ?? 3));
}
