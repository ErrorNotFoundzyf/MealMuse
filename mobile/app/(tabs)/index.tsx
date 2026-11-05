import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { allPages, errorText, useApi, useResource } from '../../src/api';
import { RulePanel } from '../../src/rule-panel';
import { chinaToday, requestKey, useMenu } from '../../src/menu-draft';
import { CategoryTabs, LibraryPage, RecipeBadges, SearchBox, l } from '../../src/library-ui';
import { Button, colors, Loading, Notice, s } from '../../src/ui';
import { recipeCategoryIds, recipeCategoryLabel } from '../../src/types';
import type { Category, Recipe } from '../../src/types';

export default function Inspiration() {
  const api = useApi(); const menu = useMenu(); const params = useLocalSearchParams<{ pick?: string }>();
  const [mode, setMode] = useState('pick'); const [search, setSearch] = useState(''); const [category, setCategory] = useState('');
  const [catalog, setCatalog] = useState<Recipe[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const categories = useResource<Category[]>('/dish-categories');
  useEffect(() => { if (params.pick) { setMode('pick'); router.setParams({ pick: undefined }); } }, [params.pick]);
  useFocusEffect(useCallback(() => {
    if (!api.ready) return;
    let current = true; setLoading(true); setError('');
    allPages<Recipe>(api.request, '/recipes').then(value => { if (current) setCatalog(value); }).catch(e => { if (current) setError(errorText(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api.ready, api.request, api.revision, retry]));
  function toggle(recipe: Recipe) {
    if (!menu.ready) return;
    const chosen = menu.draft.recipeIds.includes(recipe.id);
    if (!chosen && menu.draft.recipeIds.length >= 20) { Alert.alert('最多选择20道菜'); return; }
    menu.setDraft(old => ({ ...old, rulePlan: old.rulePlan?.mode === 'chat' ? old.rulePlan : undefined, manualAdjustment: old.rulePlan?.mode === 'chat', requestKey: requestKey(), recipeIds: chosen ? old.recipeIds.filter(id => id !== recipe.id) : [...old.recipeIds, recipe.id], dishes: chosen ? old.dishes.filter(d => d.recipe_id !== recipe.id) : [...old.dishes, { recipe_id: recipe.id, name: recipe.name, category_id: recipe.category_id, category_name: recipeCategoryLabel(recipe, categories.data || []), is_hearty: recipe.is_hearty, ingredients: recipe.ingredients.map(i => ({ ingredient_id: i.ingredient_id, name: i.name, is_main: i.is_main, quantity: i.quantity, unit: i.unit })), steps: recipe.steps, notes: recipe.notes, cook_time_minutes: recipe.cook_time_minutes }] }));
  }
  const query = search.trim().toLocaleLowerCase();
  const filtered = catalog.filter(r => (!category || recipeCategoryIds(r).includes(category)) && (!query || r.name.toLocaleLowerCase().includes(query) || r.ingredients.some(i => i.name.toLocaleLowerCase().includes(query))));
  function clearSelection() {
    if (!menu.ready || !menu.draft.recipeIds.length) return;
    Alert.alert('清空已选菜品？', '当前日期和人数会保留，已保存的食记不会改变。', [{ text: '取消', style: 'cancel' }, { text: '清空已选', style: 'destructive', onPress: () => menu.setDraft(old => ({ ...old, rulePlan: old.rulePlan?.mode === 'chat' ? { ...old.rulePlan, ai: { ...old.rulePlan.ai!, blocked: true } } : undefined, manualAdjustment: old.rulePlan?.mode === 'chat', recipeIds: [], dishes: [], requestKey: requestKey() })) }]);
  }
  return <LibraryPage title="吃饭灵感">
    <View style={{ flexDirection: 'row', padding: 3, borderWidth: 1, borderColor: colors.line, borderRadius: 12, marginBottom: 10 }}>{[{ key: 'ai', label: '帮我搭配' }, { key: 'pick', label: '自己挑' }].map(o => <Pressable key={o.key} accessibilityRole="button" accessibilityState={{ selected: mode === o.key }} onPress={() => setMode(o.key)} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: mode === o.key ? colors.green : 'transparent' }}><Text style={{ fontSize: 16, fontWeight: '700', color: mode === o.key ? '#fff' : colors.muted }}>{o.label}</Text></Pressable>)}</View>
    {!!menu.error && <Notice text={menu.error} error />}
    {!menu.ready ? <Loading /> : mode === 'ai' ? <RulePanel onManual={() => setMode('pick')} /> : <>
      <SearchBox value={search} onChange={setSearch} placeholder="搜索菜名、食材" />
      <CategoryTabs options={[{ value: '', label: '全部' }, ...(categories.data || []).map(c => ({ value: c.id, label: c.name }))]} selected={category} onSelect={setCategory} />
      <View style={[s.between, { minHeight: 44, paddingVertical: 4 }]}><Text style={{ flex: 1, fontSize: 14.5, lineHeight: 21, color: colors.muted }} numberOfLines={1}>{menu.draft.recordId ? `正在更正 ${menu.draft.mealDate} 的菜单` : menu.draft.mealDate === chinaToday() ? '手动选菜，可自由搭配' : `正在补记 ${menu.draft.mealDate} 的菜单`}</Text><Pressable accessibilityRole="button" accessibilityLabel="清空已选菜品" accessibilityState={{ disabled: !menu.ready || !menu.draft.recipeIds.length }} disabled={!menu.ready || !menu.draft.recipeIds.length} onPress={clearSelection} style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, opacity: !menu.draft.recipeIds.length ? 0.4 : pressed ? 0.6 : 1 })}><Ionicons name="trash-outline" size={16} color={colors.muted} /><Text style={{ color: colors.muted, fontSize: 13 }}>清空已选</Text></Pressable></View>
      <FlatList style={{ flex: 1 }} data={loading || error ? [] : filtered} keyExtractor={r => r.id} contentContainerStyle={l.list} keyboardShouldPersistTaps="handled" refreshing={loading} onRefresh={() => setRetry(v => v + 1)} ListEmptyComponent={error ? <Notice text={error} error onRetry={() => setRetry(v => v + 1)} /> : loading ? <Loading /> : <Notice text="没有找到菜谱，可以换个分类或搜索词。" />} renderItem={({ item }) => {
        const selected = menu.draft.recipeIds.includes(item.id);
        return <View style={[l.card, { paddingVertical: 9 }]}><View style={{ flex: 1, gap: 3 }}><Text style={l.name} numberOfLines={1}>{item.name}</Text><Text style={l.detail} numberOfLines={1}>{item.ingredients.filter(i => i.is_main).map(i => i.name).join(' · ')}</Text></View><RecipeBadges recipe={item} categories={categories.data || []} /><Pressable accessibilityRole="button" accessibilityLabel={`${selected ? '移除' : '加入'}${item.name}`} accessibilityState={{ selected }} style={l.iconButton} onPress={() => toggle(item)}><Ionicons name={selected ? 'checkmark-circle' : 'add-circle-outline'} size={28} color={colors.green} /></Pressable></View>;
      }} />
    </>}
    {mode === 'pick' && <View style={[s.between, { paddingVertical: 10, borderTopWidth: 1, borderColor: colors.line }]}><View style={s.row}><Ionicons name="basket-outline" size={22} color={colors.green} /><Text style={s.body}>已选{menu.draft.recipeIds.length}道</Text></View><Pressable accessibilityRole="button" disabled={!menu.ready || !menu.draft.recipeIds.length} onPress={() => router.push('/menu')} style={[l.add, { opacity: menu.draft.recipeIds.length ? 1 : 0.4 }]}><Text style={l.addText}>查看菜单</Text><Ionicons name="chevron-forward" size={16} color="#fff" /></Pressable></View>}
  </LibraryPage>;
}
