import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { FlatList, Pressable, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TagBadge } from '../../src/tags';
import { useResource } from '../../src/api';
import { Button, Chip, colors, Loading, Notice, s } from '../../src/ui';
import { CategoryTabs, FilterButton, FilterSheet, LibraryPage, SearchBox, l } from '../../src/library-ui';
import { Ingredient, ingredientCategories, Page as PageResult, seasonNames, TimeContext } from '../../src/types';

export default function Ingredients() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [visibility, setVisibility] = useState('visible');
  const [season, setSeason] = useState('');
  const [sheet, setSheet] = useState(false);
  const [page, setPage] = useState(0);
  const time = useResource<TimeContext>('/time-context');
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(0); }, 300); return () => clearTimeout(timer); }, [search]);
  const seasonOptions = [{ value: '', label: '所有季节' }, { value: 'current', label: '当季' }, { value: 'all_year', label: '全年' }, { value: 'current_all', label: '当季与全年' }, { value: 'unknown', label: '季节未设置' }, { value: 'spring', label: '春' }, { value: 'summer', label: '夏' }, { value: 'autumn', label: '秋' }, { value: 'winter', label: '冬' }];
  const seasonQuery = season ? `&season=${season === 'current_all' ? 'current' : season}&include_all_year=${season === 'current_all'}` : '';
  const result = useResource<PageResult<Ingredient>>(`/ingredients?q=${encodeURIComponent(query)}&ingredient_category=${category}&visibility=${visibility}${seasonQuery}&limit=30&offset=${page * 30}`);
  function filter(set: (value: string) => void, value: string) { set(value); setPage(0); }
  const seasonal = season === 'current_all';
  return <LibraryPage title="食材库" context={time.data ? `当前${seasonNames[time.data.current_season]} · 采购参考` : '家庭采购参考'} action="添加" onAdd={() => router.push('/ingredient')}>
    <SearchBox value={search} onChange={setSearch} placeholder="搜索食材或别名" />
    <CategoryTabs options={[{ value: '', label: '全部' }, ...Object.entries(ingredientCategories).map(([value, label]) => ({ value, label }))]} selected={category} onSelect={v => filter(setCategory, v)} />
    <View style={l.controls}><View style={[s.row, { gap: 6 }]}><Text style={l.filterText}>当季与全年</Text><Switch accessibilityLabel="只看当季与全年食材" value={seasonal} onValueChange={v => filter(setSeason, v ? 'current_all' : '')} trackColor={{ false: '#CED3C9', true: colors.green }} thumbColor="#fff" /></View><FilterButton active={visibility === 'all' || (!!season && !seasonal)} label={season && !seasonal ? seasonOptions.find(o => o.value === season)!.label : visibility === 'all' ? '含已隐藏' : '筛选'} onPress={() => setSheet(true)} /></View>
    <Text style={l.count}>{result.loading ? '正在查找食材…' : `共 ${result.data?.total || 0} 种食材`}</Text>
    <FlatList style={{ flex: 1 }} data={result.loading || result.error ? [] : result.data?.items || []} keyExtractor={item => item.id} contentContainerStyle={l.list} keyboardShouldPersistTaps="handled" refreshing={result.loading} onRefresh={result.reload}
      ListEmptyComponent={result.error ? <Notice text={result.error} error onRetry={result.reload} /> : result.loading ? <Loading /> : <Notice text="没有符合条件的食材，可以换个筛选，或添加食材。" />}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`查看与编辑${item.name}`} onPress={() => router.push({ pathname: '/ingredient', params: { id: item.id } })} style={({ pressed }) => [l.card, { opacity: pressed ? 0.65 : 1 }]}>
        <Ionicons name={item.ingredient_category === 'seafood' ? 'fish-outline' : item.ingredient_category === 'egg' ? 'egg-outline' : item.ingredient_category === 'seasoning' ? 'flask-outline' : item.ingredient_category === 'meat' ? 'restaurant-outline' : 'leaf-outline'} size={27} color={colors.green} />
        <View style={{ flex: 1, gap: 3 }}><View style={[s.row, { gap: 6 }]}><Text style={l.name} numberOfLines={1}>{item.name}</Text></View><Text style={l.detail} numberOfLines={1}>{item.ingredient_category ? ingredientCategories[item.ingredient_category] : '未分类'} · {item.seasons.length ? item.seasons.map(k => seasonNames[k].replace('季', '')).join('、') : '季节未设置'}</Text></View>
        <TagBadge tag={item.is_hidden ? 'hidden' : item.seasons.includes('all_year') ? 'all_year' : item.season_status} label={item.is_hidden ? '已隐藏' : item.seasons.includes('all_year') ? '全年' : item.season_status === 'in_season' ? '当季' : item.season_status === 'out_of_season' ? '非当季' : '待设置'} /><Ionicons name="chevron-forward" size={16} color={colors.muted} />
      </Pressable>}
      ListFooterComponent={!result.loading && !result.error && (result.data?.total || 0) > 30 ? <View style={s.between}><Button label="上一页" secondary disabled={page === 0} onPress={() => setPage(v => v - 1)} /><Text style={s.caption}>第 {page + 1} 页</Text><Button label="下一页" secondary disabled={(page + 1) * 30 >= (result.data?.total || 0)} onPress={() => setPage(v => v + 1)} /></View> : undefined} />
    <FilterSheet visible={sheet} title="筛选食材" onClose={() => setSheet(false)} onReset={() => { setCategory(''); setSeason(''); setVisibility('visible'); setPage(0); }}>
      <View><Text style={s.label}>季节</Text><View style={s.wrap}>{seasonOptions.map(o => <Chip key={o.value} label={o.label} selected={season === o.value} onPress={() => filter(setSeason, o.value)} />)}</View></View>
      <View style={s.between}><Text style={s.body}>包含已隐藏食材</Text><Switch accessibilityLabel="包含已隐藏食材" value={visibility === 'all'} onValueChange={v => filter(setVisibility, v ? 'all' : 'visible')} trackColor={{ true: colors.green }} /></View><Text style={s.caption}>当季、春夏秋冬仅匹配对应季节；当季与全年同时包含全年食材。季节仅作采购参考。</Text>
    </FilterSheet>
  </LibraryPage>;
}
