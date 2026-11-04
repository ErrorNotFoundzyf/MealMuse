import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { errorText, useApi, useResource } from './api';
import { requestKey, useMenu } from './menu-draft';
import { FilterSheet, l } from './library-ui';
import { Button, colors, Loading, Notice, s, Stepper } from './ui';
import type { PlanningSettings, Profile, RulePlan } from './types';

export function RulePanel({ onManual }: { onManual: () => void }) {
  const api = useApi(); const menu = useMenu();
  const profile = useResource<{ profile: Profile | null }>('/profile');
  const [info, setInfo] = useState('');
  const [sheet, setSheet] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [people, setPeople] = useState<number | undefined>(menu.draft.planning?.people_count ?? menu.draft.rulePlan?.people_count); const [counts, setCounts] = useState<Record<string, number> | undefined>(menu.draft.planning?.category_counts ?? menu.draft.rulePlan?.category_counts);
  const [allow, setAllow] = useState(menu.draft.planning?.allow_nonseasonal ?? menu.draft.rulePlan?.allow_nonseasonal ?? false);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const draftRef = useRef(menu.draft); draftRef.current = menu.draft;
  const plan = menu.draft.rulePlan;
  const effective: PlanningSettings = menu.draft.planning ?? (plan ? { people_count: plan.people_count, category_counts: plan.category_counts, allow_nonseasonal: plan.allow_nonseasonal } : { people_count: profile.data?.profile?.people_count ?? menu.draft.people, category_counts: profile.data?.profile?.category_counts ?? { meat: 1, vegetable: 2, soup: 1 }, allow_nonseasonal: false });
  const effectivePeople = effective.people_count;
  const effectiveCounts = effective.category_counts;
  const editingPeople = people ?? effectivePeople;
  const editingCounts = counts ?? effectiveCounts;
  const total = Object.values(editingCounts).reduce((a, b) => a + b, 0);
  const complete = !!profile.data?.profile || !!menu.draft.planning || !!plan;
  function openSettings() {
    setPeople(effective.people_count); setCounts({ ...effective.category_counts }); setAllow(effective.allow_nonseasonal); setSheet(true);
  }
  function applySettings() {
    if (total < 1 || total > 20) return;
    const planning = { people_count: editingPeople, category_counts: { ...editingCounts }, allow_nonseasonal: allow };
    const changed = planning.people_count !== effective.people_count || planning.allow_nonseasonal !== effective.allow_nonseasonal || ['meat', 'vegetable', 'soup'].some(id => (planning.category_counts[id] || 0) !== (effective.category_counts[id] || 0));
    menu.setDraft(old => changed ? { ...old, planning, people: planning.people_count, rulePlan: undefined, recipeIds: [], dishes: [], recordId: undefined, revision: undefined, requestKey: requestKey() } : { ...old, planning });
    pending.current = null; setError(''); setInfo(changed ? '本次配置已更新，旧菜单已清空，请重新搭配。' : ''); setSheet(false);
  }
  async function perform(action: 'new' | 'replace' | 'regenerate', recipeId?: string) {
    if (busy) return;
    const current = menu.draft;
    const currentPlan = current.rulePlan;
    if (action !== 'new' && !currentPlan) return;
    const path = action === 'new' ? '/recommendations' : `/recommendations/${currentPlan!.id}/${action}`;
    const body = action === 'new' ? { people_count: effectivePeople, category_counts: effectiveCounts, allow_nonseasonal: effective.allow_nonseasonal } : { expected_revision: currentPlan!.revision, ...(recipeId ? { recipe_id: recipeId } : {}) };
    const signature = JSON.stringify({ path, body });
    if (pending.current?.signature !== signature) pending.current = { signature, key: requestKey() };
    const key = pending.current!.key;
    setBusy(true); setError(''); setInfo('');
    try {
      const result = await api.request<RulePlan>(path, { method: 'POST', body: JSON.stringify({ ...body, request_key: key }) });
      if (draftRef.current.requestKey !== current.requestKey) { setError('选菜已发生变化，本次结果未覆盖当前菜单'); return; }
      menu.setDraft(old => old.requestKey !== current.requestKey ? old : { people: result.people_count, mealDate: result.as_of_date, recipeIds: result.dishes.map(d => d.recipe_id), dishes: result.dishes, requestKey: requestKey(), rulePlan: result, planning: { people_count: result.people_count, category_counts: result.category_counts, allow_nonseasonal: result.allow_nonseasonal } });
      pending.current = null;
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function generate() {
    if (!complete) { openSettings(); return; }
    if (menu.draft.recipeIds.length) Alert.alert('重新搭配今天的菜单？', '将替换当前未确认的选菜，已保存的食记不会改变。', [{ text: '取消', style: 'cancel' }, { text: '开始搭配', onPress: () => perform('new') }]);
    else void perform('new');
  }
  return <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
    <View style={s.between}><Text style={[l.detail, { flex: 1 }]}>本次 {effectivePeople}人 · {effectiveCounts.meat || 0}荤 {effectiveCounts.vegetable || 0}素 {effectiveCounts.soup || 0}汤</Text><Pressable accessibilityRole="button" disabled={busy} onPress={openSettings} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : pressed ? 0.7 : 1 })}><Text style={{ color: colors.green, fontSize: 13, fontWeight: '700' }}>人数与菜数</Text></Pressable></View>
    <Text style={l.detail}>当前为规则搭配，自然语言对话将在下一阶段接入。</Text>
    {profile.error && <Notice text={profile.error} error onRetry={profile.reload} />}
    {!!error && <Notice text={error} error />}
    {!!info && <Notice text={info} />}
    {!complete && !profile.loading && <Notice text="请先设置家庭默认，或点击「人数与菜数」设置本次配置。" />}
    {!plan && <Button label={busy ? '正在搭配' : complete ? '按当前习惯搭配' : '设置本次搭配'} busy={busy} disabled={profile.loading} onPress={generate} />}
    {plan && <View style={[s.card, { padding: 14, gap: 8 }]}><View style={s.between}><Text style={[s.section, { fontSize: 20 }]}>本餐菜单</Text><Text style={l.detail}>{plan.people_count}人 · {plan.dishes.length}道菜</Text></View>{plan.dishes.map(dish => <View key={dish.recipe_id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 }}><View style={s.between}><View style={{ flex: 1, gap: 2 }}><Text style={[l.name, { fontSize: 17 }]}>{dish.name}</Text><Text style={l.detail}>{dish.category_name}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`换掉${dish.name}`} disabled={busy || !!plan.confirmed_record_id} style={l.filterButton} onPress={() => perform('replace', dish.recipe_id)}><Text style={{ color: colors.green, fontSize: 14 }}>换一道</Text></Pressable></View>{!!dish.season_warnings?.length && <Text style={[l.detail, { color: colors.accent }]}>{dish.season_warnings.join('、')}</Text>}</View>)}<Text style={l.detail}>{plan.allow_nonseasonal ? '已允许非当季及季节未设置食材，采购前请核对。' : '主要食材匹配当前季节或全年，季节仅作采购参考。'}</Text><View style={s.row}><View style={{ flex: 1 }}><Button label="自己调整" secondary disabled={busy} onPress={onManual} /></View><View style={{ flex: 1 }}><Button label="确认菜单" disabled={busy || !!plan.confirmed_record_id} onPress={() => router.push('/menu')} /></View></View><Button label="整桌换一套" secondary busy={busy} disabled={!!plan.confirmed_record_id} onPress={() => perform('regenerate')} /><Pressable accessibilityRole="button" disabled={busy} style={l.filterButton} onPress={generate}><Text style={{ color: colors.green, fontSize: 14 }}>按新的设置重新搭配</Text></Pressable></View>}
    {!plan && !!menu.draft.recipeIds.length && <Text style={l.detail}>当前已有手选菜单，可以继续自己挑，或重新搭配。</Text>}
    <FilterSheet visible={sheet} title="本次人数与菜数" onClose={() => setSheet(false)} onApply={applySettings} applyDisabled={total < 1 || total > 20 || profile.loading} resetLabel="家庭默认" onReset={() => { setPeople(profile.data?.profile?.people_count ?? menu.draft.people); setCounts({ ...(profile.data?.profile?.category_counts ?? { meat: 1, vegetable: 2, soup: 1 }) }); setAllow(false); }}>
      {profile.loading ? <Loading /> : <><Stepper label="用餐人数" value={editingPeople} min={1} max={30} onChange={setPeople} />{[{ id: 'meat', name: '荤菜' }, { id: 'vegetable', name: '素菜' }, { id: 'soup', name: '汤' }].map(c => <Stepper key={c.id} label={c.name} value={editingCounts[c.id] || 0} onChange={v => setCounts({ ...editingCounts, [c.id]: v })} />)}<Text style={s.caption}>本次共 {total} 道菜（1—20道），不会更改家庭默认。修改后会清空旧菜单，需重新搭配。</Text><View style={s.between}><Text style={[s.body, { flex: 1 }]}>允许非当季及季节未设置食材</Text><Switch accessibilityLabel="允许非当季及季节未设置食材" value={allow} onValueChange={setAllow} trackColor={{ true: colors.green }} /></View><Text style={s.caption}>默认仅从当季与全年食材搭配。开启后仍严格排除最近三天的菜。</Text></>}
    </FilterSheet>
  </ScrollView>;
}
