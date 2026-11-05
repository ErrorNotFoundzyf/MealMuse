import { StyleSheet, Text, View } from 'react-native';
import { recipeCategoryIds } from './types';
import type { Category } from './types';

const neutral = { background: '#E9E9E6', text: '#62645D', border: '#D7D8D1' };

// One palette shared by menu cards, recipe lists and ingredient season badges.
export const tagColors: Record<string, { background: string; text: string; border: string }> = {
  meat: { background: '#F7E7E4', text: '#83514D', border: '#EAD1CC' },
  hearty: { background: '#F6EBCD', text: '#806126', border: '#E7D6A8' },
  vegetable: { background: '#E8EEDC', text: '#52623D', border: '#D6DFBF' },
  soup: { background: '#E4EEF4', text: '#48667A', border: '#CCDEE9' },
  staple: { background: '#EAE6F3', text: '#665779', border: '#D9D0E7' },
  fruit: { background: '#F8E9DA', text: '#8A5D36', border: '#EBD5BE' },
  dessert: { background: '#F5E3EC', text: '#83536B', border: '#E7CDDB' },
  in_season: { background: '#E3EEE6', text: '#476552', border: '#CBDFD1' },
  all_year: { background: '#E5EDF7', text: '#4D6480', border: '#CFDBEB' },
  out_of_season: { background: '#F0E9DD', text: '#756246', border: '#E1D6C2' },
  season_unknown: { background: '#ECE7EE', text: '#716279', border: '#DCD3E0' },
  hidden: neutral,
};

const recipeLabels: Record<string, string> = {
  meat: '荤菜', vegetable: '素菜', soup: '汤', staple: '主食', hearty: '硬菜', fruit: '水果', dessert: '甜点',
};

export function TagBadge({ tag, label, small = false }: { tag: string; label: string; small?: boolean }) {
  const palette = tagColors[tag] || neutral;
  return <Text style={[t.badge, small && t.small, { backgroundColor: palette.background, color: palette.text, borderColor: palette.border }]}>{label}</Text>;
}

export function RecipeTags({ recipe, categories = [], small = false }: { recipe: { category_id: string; is_hearty?: boolean }; categories?: Category[]; small?: boolean }) {
  return <View style={t.group}>{recipeCategoryIds(recipe).map(id => <TagBadge key={id} tag={id} small={small} label={categories.find(c => c.id === id)?.name || recipeLabels[id] || '未分类'} />)}</View>;
}

const t = StyleSheet.create({
  group: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, maxWidth: 130 },
  badge: { fontSize: 12, lineHeight: 18, fontWeight: '500', paddingHorizontal: 8, paddingVertical: 1, borderWidth: 1, borderRadius: 7, overflow: 'hidden', includeFontPadding: false },
  small: { fontSize: 11, lineHeight: 16, paddingHorizontal: 5 },
});
