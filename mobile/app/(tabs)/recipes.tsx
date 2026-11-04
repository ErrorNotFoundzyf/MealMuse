import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { FlatList, Pressable, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useResource } from '../../src/api';
import { Button, Chip, colors, Field, Loading, Notice, s } from '../../src/ui';
import { CategoryTabs, FilterButton, FilterSheet, LibraryPage, RecipeBadges, SearchBox, l } from '../../src/library-ui';
import { Category, Ingredient, Page as PageResult, Recipe } from '../../src/types';

export default function Recipes() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [visibility, setVisibility] = useState('visible');
  const [sheet, setSheet] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [ingredient, setIngredient] = useState<Ingredient>();
  const [page, setPage] = useState(0);
  const categories = useResource<Category[]>('/dish-categories');
  const matches = useResource<PageResult<Ingredient>>(`/ingredients?q=${encodeURIComponent(ingredientSearch)}&limit=8`);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(0); }, 300); return () => clearTimeout(timer); }, [search]);
  const result = useResource<PageResult<Recipe>>(`/recipes?q=${encodeURIComponent(query)}${category ? `&category_id=${category}` : ''}${ingredient ? `&ingredient_id=${ingredient.id}` : ''}&visibility=${visibility}&limit=20&offset=${page * 20}`);
  function filter(set: (v: string) => void, value: string) { set(value); setPage(0); }
  return <LibraryPage title="菜谱库" action="录菜" onAdd={() => router.push('/recipe')}>
    <SearchBox value={search} onChange={setSearch} placeholder="搜索菜名" />
    <CategoryTabs options={[{ value: '', label: '全部' }, ...(categories.data || []).map(c => ({ value: c.id, label: c.name }))]} selected={category} onSelect={v => filter(setCategory, v)} />
    {categories.error && <Notice text={categories.error} error onRetry={categories.reload} />}
    <View style={l.controls}><Text style={[l.detail, { flex: 1 }]} numberOfLines={1}>{ingredient ? '食材：' + ingredient.name : '按食材查找你想做的菜'}</Text><FilterButton active={!!ingredient || visibility === 'all'} onPress={() => setSheet(true)} /></View>
    <Text style={l.count}>{result.loading ? '正在查找菜谱…' : `共 ${result.data?.total || 0} 道菜${visibility === 'all' ? ' · 含已隐藏' : ''}`}</Text>
    <FlatList style={{ flex: 1 }} data={result.loading || result.error ? [] : result.data?.items || []} keyExtractor={item => item.id} contentContainerStyle={l.list} keyboardShouldPersistTaps="handled" refreshing={result.loading} onRefresh={result.reload}
      ListEmptyComponent={result.error ? <Notice text={result.error} error onRetry={result.reload} /> : result.loading ? <Loading /> : <Notice text="没有符合条件的菜谱，可以换个筛选，或录入一道菜。" />}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`查看菜谱${item.name}`} onPress={() => router.push({ pathname: '/recipe', params: { id: item.id } })} style={({ pressed }) => [l.card, { opacity: pressed ? 0.65 : 1 }]}><View style={{ flex: 1, gap: 4 }}><View style={s.between}><Text style={[l.name, { flex: 1 }]} numberOfLines={1}>{item.name}</Text><RecipeBadges recipe={item} categories={categories.data || []} /></View><Text style={l.detail} numberOfLines={1}>{item.ingredients.filter(i => i.is_main).map(i => i.name).join(' · ') || '主要食材未填写'}</Text><View style={[s.row, { gap: 4 }]}><Ionicons name="time-outline" size={14} color={colors.muted} /><Text style={l.detail}>{item.cook_time_minutes == null ? '用时未设置' : `${item.cook_time_minutes} 分钟`}{item.is_hidden ? ' · 已隐藏' : ''}</Text></View></View><Ionicons name="chevron-forward" size={16} color={colors.muted} /></Pressable>}
      ListFooterComponent={!result.loading && !result.error && (result.data?.total || 0) > 20 ? <View style={s.between}><Button label="上一页" secondary disabled={!page} onPress={() => setPage(v => v - 1)} /><Text style={s.caption}>第 {page + 1} 页</Text><Button label="下一页" secondary disabled={(page + 1) * 20 >= (result.data?.total || 0)} onPress={() => setPage(v => v + 1)} /></View> : undefined} />
    <FilterSheet visible={sheet} title="筛选菜谱" onClose={() => setSheet(false)} onReset={() => { setCategory(''); setVisibility('visible'); setIngredient(undefined); setIngredientSearch(''); setPage(0); }}>
      <View><Field label="按食材查找" value={ingredientSearch} onChange={setIngredientSearch} placeholder="输入食材名或别名" />{ingredient && <View style={{ marginTop: 8 }}><Chip label={`已选 ${ingredient.name} · 点击取消`} selected onPress={() => { setIngredient(undefined); setPage(0); }} /></View>}{!!ingredientSearch && <View style={{ marginTop: 8 }}>{matches.error ? <Notice text={matches.error} error onRetry={matches.reload} /> : matches.loading ? <Loading /> : <View style={s.wrap}>{matches.data?.items.length ? matches.data.items.map(i => <Chip key={i.id} label={i.name} onPress={() => { setIngredient(i); setIngredientSearch(''); setPage(0); }} />) : <Text style={s.caption}>未找到食材，试试其他名称。</Text>}</View>}</View>}</View>
      <View style={s.between}><Text style={s.body}>包含已隐藏菜谱</Text><Switch accessibilityLabel="包含已隐藏菜谱" value={visibility === 'all'} onValueChange={v => filter(setVisibility, v ? 'all' : 'visible')} trackColor={{ true: colors.green }} /></View>
    </FilterSheet>
  </LibraryPage>;
}
