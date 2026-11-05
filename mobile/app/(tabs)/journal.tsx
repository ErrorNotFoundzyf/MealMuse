import { RecipeTags } from '../../src/tags';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { errorText, useApi, useResource } from '../../src/api';
import { chinaToday, useMenu } from '../../src/menu-draft';
import { LibraryPage, l } from '../../src/library-ui';
import { Button, colors, Loading, Notice, s } from '../../src/ui';
import type { MealRecord, TimeContext } from '../../src/types';
import { mealItemSummary } from '../../src/types';

export default function Journal() {
  const api = useApi(); const menu = useMenu();
  const params = useLocalSearchParams<{ date?: string }>();
  const time = useResource<TimeContext>('/time-context');
  const today = time.data?.as_of_date || chinaToday();
  const [selected, setSelected] = useState(chinaToday());
  const [month, setMonth] = useState(chinaToday().slice(0, 7));
  useEffect(() => { if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) { setSelected(params.date); setMonth(params.date.slice(0, 7)); router.setParams({ date: undefined }); } }, [params.date]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const records = useResource<{ items: MealRecord[] }>(`/meal-records?month=${month}`);
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const offset = (new Date(year, mon - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, mon, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => i >= offset && i < offset + days ? `${month}-${String(i - offset + 1).padStart(2, '0')}` : '');
  function changeMonth(delta: number) {
    const date = new Date(year, mon - 1 + delta, 1);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setMonth(next); setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
  }
  function begin(record?: MealRecord) {
    if (!menu.ready) return;
    if (selected > today) { Alert.alert('食记只记录今天和过去的菜单'); return; }
    const go = () => { menu.start(selected, record); if (record) router.push('/menu'); else router.navigate({ pathname: '/', params: { pick: '1' } }); };
    if (menu.draft.recipeIds.length) Alert.alert('已有未确认菜单', '开始记录这一餐会替换手机上当前的选菜草稿。', [{ text: '取消', style: 'cancel' }, { text: '继续', onPress: go }]); else go();
  }
  function remove(record: MealRecord) {
    Alert.alert('删除这份食记？', '删除后，这些菜不再作为本次记录参与近期避重复。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: async () => {
      setBusy(true); setError('');
      try { await api.request(`/meal-records/${record.id}?revision=${record.revision}`, { method: 'DELETE' }); api.changed(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    } }]);
  }
  const onDay = records.data?.items.filter(r => r.meal_date === selected) || [];
  return <LibraryPage title="食记" action="记录" onAdd={() => begin()}><ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 25 }}>
    <View style={[s.card, { padding: 10, gap: 3 }]}><View style={s.between}><Pressable accessibilityRole="button" accessibilityLabel="上个月" style={l.iconButton} onPress={() => changeMonth(-1)}><Ionicons name="chevron-back" size={20} color={colors.ink} /></Pressable><Text style={s.section}>{year}年{mon}月</Text><Pressable accessibilityRole="button" accessibilityLabel="下个月" style={l.iconButton} onPress={() => changeMonth(1)}><Ionicons name="chevron-forward" size={20} color={colors.ink} /></Pressable></View>
      <View style={j.grid}>{['一', '二', '三', '四', '五', '六', '日'].map(d => <View key={d} style={j.cell}><Text style={l.detail}>{d}</Text></View>)}</View>
      <View style={j.grid}>{cells.map((date, i) => <Pressable key={date || `blank-${i}`} disabled={!date || date > today} accessibilityRole="button" accessibilityLabel={date ? `${date}${records.data?.items.some(r => r.meal_date === date) ? ' 有记录' : ''}` : undefined} accessibilityState={{ selected: selected === date, disabled: !date || date > today }} onPress={() => setSelected(date)} style={j.cell}><View style={[j.day, selected === date && { backgroundColor: colors.green }]}><Text style={{ fontSize: 14, color: date > today ? '#ADB3A9' : selected === date ? '#fff' : colors.ink }}>{date ? Number(date.slice(-2)) : ''}</Text>{!!date && records.data?.items.some(r => r.meal_date === date) && <View style={[j.dot, { backgroundColor: selected === date ? '#fff' : colors.green }]} />}</View></Pressable>)}</View>
    </View>
    <View style={s.between}><Text style={s.section}>{Number(selected.slice(5, 7))}月{Number(selected.slice(8))}日</Text><Text style={l.detail}>{records.loading ? '读取中…' : `${onDay.length}份菜单`}</Text></View>
    {!!error && <Notice text={error} error />}
    {records.error ? <Notice text={records.error} error onRetry={records.reload} /> : records.loading ? <Loading /> : !onDay.length ? <Notice text="这一天还没有记录。点击右上角「记录」，选好菜后确认即可。" /> : onDay.map(record => <View key={record.id} style={[s.card, { padding: 14, gap: 10 }]}><View style={s.between}><Text style={s.section}>{record.people_count}人 · {mealItemSummary(record.dishes)}</Text><Text style={l.status}>已确认</Text></View>{record.dishes.map(dish => <View key={dish.recipe_id} style={[s.between, { borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 }]}><Text style={[s.body, { flex: 1 }]}>{dish.name}</Text><RecipeTags recipe={dish} /></View>)}<View style={s.between}><Pressable accessibilityRole="button" disabled={busy || !menu.ready} style={l.filterButton} onPress={() => begin(record)}><Text style={{ color: colors.green, fontSize: 14, fontWeight: '700' }}>查看与更正</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} style={l.filterButton} onPress={() => remove(record)}><Text style={{ color: colors.red, fontSize: 14 }}>删除记录</Text></Pressable></View></View>)}
  </ScrollView></LibraryPage>;
}
const j = StyleSheet.create({ grid: { flexDirection: 'row', flexWrap: 'wrap' }, cell: { width: '14.2857%', minHeight: 44, alignItems: 'center', justifyContent: 'center' }, day: { minWidth: 36, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, dot: { width: 4, height: 4, borderRadius: 2, position: 'absolute', bottom: 3 } });
