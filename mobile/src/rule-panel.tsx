import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Modal, Pressable, ScrollView, Switch, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { errorText, useApi, useResource } from './api';
import { requestKey, useMenu } from './menu-draft';
import { FilterSheet, l } from './library-ui';
import { Button, colors, Loading, Notice, s, Stepper } from './ui';
import { ChatComposer, ChatMessages, useAiChat } from './ai-chat';
import { RecipeTags } from './tags';
import type { PlanningSettings, Profile, RulePlan } from './types';

export function RulePanel({ onManual }: { onManual: () => void }) {
  const api = useApi(); const menu = useMenu();
  const profile = useResource<{ profile: Profile | null }>('/profile');
  const [info, setInfo] = useState('');
  const [sheet, setSheet] = useState(false); const [ruleBusy, setBusy] = useState(false); const [error, setError] = useState('');
  const [people, setPeople] = useState<number | undefined>(menu.draft.planning?.people_count ?? menu.draft.rulePlan?.people_count); const [counts, setCounts] = useState<Record<string, number> | undefined>(menu.draft.planning?.category_counts ?? menu.draft.rulePlan?.category_counts);
  const [allow, setAllow] = useState(menu.draft.planning?.allow_nonseasonal ?? menu.draft.rulePlan?.allow_nonseasonal ?? false);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const draftRef = useRef(menu.draft); draftRef.current = menu.draft;
  const plan = menu.draft.rulePlan;
  const [collapsed, setCollapsed] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [nameLines, setNameLines] = useState<Record<string, number>>({});
  const [keyboardShown, setKeyboardShown] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const dishCardWidth = Math.max(94, Math.min(120, (width - 72) / 3)) * Math.min(fontScale, 1.4);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const conversationScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { if (plan?.ai?.messages?.length) { const frame = requestAnimationFrame(() => conversationScroll.current?.scrollToEnd({ animated: true })); return () => cancelAnimationFrame(frame); } }, [plan?.ai?.messages?.length]);
  const effective: PlanningSettings = menu.draft.planning ?? (plan ? { people_count: plan.people_count, category_counts: plan.category_counts, allow_nonseasonal: plan.allow_nonseasonal } : { people_count: profile.data?.profile?.people_count ?? menu.draft.people, category_counts: profile.data?.profile?.category_counts ?? { meat: 1, vegetable: 2, soup: 1 }, allow_nonseasonal: false });
  const effectivePeople = effective.people_count;
  const effectiveCounts = effective.category_counts;
  const editingPeople = people ?? effectivePeople;
  const editingCounts = counts ?? effectiveCounts;
  const total = Object.values(editingCounts).reduce((a, b) => a + b, 0);
  const chat = useAiChat(effective);
  const busy = ruleBusy || chat.busy || chat.outgoing?.status === 'sending';
  const displayDishes = menu.draft.dishes;
  const maxNameLines = Math.max(1, ...displayDishes.map(d => nameLines[d.recipe_id] || 1));
  const dishCardHeight = 102 + (maxNameLines - 1) * 19 * fontScale + Math.max(0, fontScale - 1) * 60 + (displayDishes.some(d => d.source === 'ai_temporary') ? 64 : 0) + (displayDishes.some(d => d.season_warnings?.length) ? 34 : 0);
  const complete = !!profile.data?.profile || !!menu.draft.planning || !!plan;
  function openSettings() {
    setPeople(effective.people_count); setCounts({ ...effective.category_counts }); setAllow(effective.allow_nonseasonal); setSheet(true);
  }
  function applySettings() {
    if (total < 1 || total > 20) return;
    const planning = { people_count: editingPeople, category_counts: { ...editingCounts }, allow_nonseasonal: allow };
    const changed = planning.people_count !== effective.people_count || planning.allow_nonseasonal !== effective.allow_nonseasonal || ['meat', 'vegetable', 'soup'].some(id => (planning.category_counts[id] || 0) !== (effective.category_counts[id] || 0));
    pending.current = null; setError(''); setSheet(false);
    const needsRecovery = !!menu.draft.rulePlan && !!menu.draft.rulePlan.ai?.blocked && !menu.draft.dishes.length;
    if (!changed && !needsRecovery) return;
    if (menu.draft.rulePlan) {
      setInfo('');
      void chat.send(`请按本次新配置重新搭配：${planning.people_count}人，${planning.category_counts.meat || 0}荤${planning.category_counts.vegetable || 0}素${planning.category_counts.soup || 0}汤，保留已有忌口和硬菜要求。`, false, planning);
    } else {
      menu.setDraft(old => ({ ...old, planning, people: planning.people_count, requestKey: requestKey() }));
      setInfo('本次人数和菜数已更新。');
    }
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
      if (result.mode === 'chat') setInfo(action === 'replace' ? '已从本餐备选换好一道，其他菜保持不变。' : '已从本餐备选换好整桌菜单。');
      pending.current = null;
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function generate() {
    if (!complete) { openSettings(); return; }
    if (menu.draft.recipeIds.length) Alert.alert('重新搭配今天的菜单？', '将替换当前未确认的选菜，已保存的食记不会改变。', [{ text: '取消', style: 'cancel' }, { text: '开始搭配', onPress: () => perform('new') }]);
    else void perform('new');
  }
  const folded = collapsed || keyboardShown;
  const disableSwap = busy || !!chat.outgoing || !!plan?.confirmed_record_id || !!plan?.ai?.blocked || !!menu.draft.manualAdjustment;
  function resetConversation() { Keyboard.dismiss(); setClearOpen(true); }
  function clearCurrentMeal() {
    if (busy) return;
    menu.setDraft(old => ({ ...old, people: effectivePeople, planning: { ...effective, category_counts: { ...effectiveCounts } }, rulePlan: undefined, manualAdjustment: false, outgoing: undefined, recipeIds: [], dishes: [], recordId: undefined, revision: undefined, requestKey: requestKey() }));
    chat.reset(); pending.current = null; setInfo(''); setError(''); setCollapsed(false); setNameLines({}); setClearOpen(false);
  }
  return <View style={{ flex: 1, gap: 6 }}>
    <View style={s.between}><Text style={[l.detail, { flex: 1 }]}>本次 {effectivePeople}人 · {effectiveCounts.meat || 0}荤 {effectiveCounts.vegetable || 0}素 {effectiveCounts.soup || 0}汤</Text><Pressable accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }} disabled={busy || !!chat.outgoing} onPress={openSettings} style={{ minHeight: 36, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center', opacity: busy || chat.outgoing ? 0.4 : 1 }}><Text style={{ color: colors.green, fontSize: 13, fontWeight: '700' }}>人数与菜数</Text></Pressable></View>
    {plan && !!displayDishes.length && <View style={[s.card, { paddingHorizontal: 10, paddingVertical: 4, gap: 0, borderRadius: 16 }]}>
      <View style={s.between}><Text style={[s.section, { fontSize: 16 }]}>本餐菜单</Text><Text numberOfLines={1} style={{ flex: 1, color: colors.muted, fontSize: 10, lineHeight: 14, textAlign: 'left' }}>{displayDishes.length > 3 && !folded ? '左右滑动查看菜品' : ''}</Text><Pressable accessibilityRole="button" accessibilityLabel="清空本餐菜单与对话" disabled={busy} style={[l.iconButton, { opacity: busy ? 0.4 : 1 }]} onPress={resetConversation}><View style={{ borderWidth: 1, borderColor: '#C9D1C3', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}><Text style={{ color: colors.muted, fontSize: 13 }}>清空</Text></View></Pressable><Pressable accessibilityRole="button" accessibilityLabel={folded ? '展开本餐菜单' : '收起本餐菜单'} style={l.iconButton} onPress={() => { if (keyboardShown) Keyboard.dismiss(); setCollapsed(!folded); }}><Ionicons name={folded ? 'chevron-down' : 'chevron-up'} size={18} color={colors.green} /></Pressable></View>
      {!folded && <>
        <ScrollView horizontal style={{ height: dishCardHeight, flexGrow: 0 }} showsHorizontalScrollIndicator={displayDishes.length > 3} keyboardShouldPersistTaps="handled" accessibilityLabel="本餐菜品，左右滑动查看" contentContainerStyle={{ gap: 8, paddingTop: 2, paddingBottom: 5, alignItems: 'stretch' }}>
          {displayDishes.map(dish => <View key={dish.recipe_id} style={{ width: dishCardWidth, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: '#FCFBF7', paddingHorizontal: 8, paddingTop: 6, gap: 3 }}>
            <Text numberOfLines={2} onTextLayout={event => { const lines = Math.min(2, Math.max(1, event.nativeEvent.lines.length)); setNameLines(old => old[dish.recipe_id] === lines ? old : { ...old, [dish.recipe_id]: lines }); }} style={{ fontSize: 14, fontWeight: '600', color: colors.ink, lineHeight: 19 }}>{dish.name}</Text>
            <View style={{ marginTop: 4 }}><RecipeTags recipe={dish} small /></View>
            {!!dish.season_warnings?.length && <Text numberOfLines={2} style={{ color: colors.accent, fontSize: 10, lineHeight: 14 }}>{dish.season_warnings.join('、')}</Text>}
            {dish.source === 'ai_temporary' && <><Text style={{ color: colors.accent, fontSize: 10, lineHeight: 14 }}>AI 临时菜</Text><Pressable accessibilityRole="button" accessibilityLabel={`将${dish.name}保存到菜谱库`} disabled={busy || !!chat.outgoing} style={{ minHeight: 32, justifyContent: 'center' }} onPress={() => chat.requestSave(dish.recipe_id)}><Text style={{ color: colors.green, fontSize: 11 }}>存入菜谱</Text></Pressable></>}
            <View style={{ flex: 1 }} />
            <Pressable accessibilityRole="button" accessibilityLabel={`换掉${dish.name}`} hitSlop={{ top: 6, bottom: 6 }} disabled={disableSwap} style={{ minHeight: 32, borderTopWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', opacity: disableSwap ? 0.4 : 1 }} onPress={() => perform('replace', dish.recipe_id)}><Text style={{ color: colors.green, fontSize: 12 }}>换一道</Text></Pressable>
          </View>)}
        </ScrollView>
        <View style={[s.row, { paddingVertical: 6 }]}><Pressable accessibilityRole="button" accessibilityLabel="从本轮备选换整桌菜单" hitSlop={{ top: 4, bottom: 4 }} disabled={disableSwap} onPress={() => perform('regenerate')} style={{ flex: 1, minHeight: 36, borderRadius: 10, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center', opacity: disableSwap ? 0.4 : 1 }}><Text style={{ color: colors.green, fontSize: 13, fontWeight: '700' }}>换整桌</Text></Pressable><Pressable accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }} disabled={busy} onPress={onManual} style={{ flex: 1, minHeight: 36, borderRadius: 10, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : 1 }}><Text style={{ color: colors.green, fontSize: 13, fontWeight: '700' }}>自己调整</Text></Pressable><Pressable accessibilityRole="button" hitSlop={{ top: 4, bottom: 4 }} disabled={busy || !!chat.outgoing || !!plan.confirmed_record_id || !!plan.ai?.blocked} onPress={() => router.push('/menu')} style={{ flex: 1, minHeight: 36, borderRadius: 10, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', opacity: busy || chat.outgoing || plan.confirmed_record_id || plan.ai?.blocked ? 0.4 : 1 }}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>确认菜单</Text></Pressable></View>
      </>}
    </View>}
    {plan?.ai?.hearty_count != null && <Text style={l.detail}>本餐要求：{plan.ai.hearty_count}道硬菜（按菜谱标签）</Text>}
    <ScrollView ref={conversationScroll} style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingTop: 4, paddingBottom: 10 }} keyboardShouldPersistTaps="handled" onContentSizeChange={() => { if (plan?.ai?.messages?.length || chat.outgoing) conversationScroll.current?.scrollToEnd({ animated: true }); }}>
      {!!chat.error && <Notice text={chat.error} error />}
      {chat.status.error && <Notice text={chat.status.error} error onRetry={chat.status.reload} />}
      {!!error && <Notice text={error} error />}
      {!!info && <Text accessibilityLiveRegion="polite" style={[l.detail, { color: colors.green }]}>{info}</Text>}
      {!!menu.draft.manualAdjustment && <Text style={l.detail}>选菜或配置已调整，请发送要求更新本餐备选后再用按钮换菜。</Text>}
      <ChatMessages plan={plan} outgoing={chat.outgoing} onRetry={chat.retryOutgoing} onEdit={chat.editOutgoing} />
      {!!plan?.ai?.blocked && <Notice text="本轮要求尚未完成，请继续说明或重试。当前菜单暂不能确认。" />}
      {profile.error && <Notice text={profile.error} error onRetry={profile.reload} />}
      {!complete && !profile.loading && <Notice text="请先设置家庭默认，或点击「人数与菜数」设置本次配置。" />}
      {!plan && <><Text style={l.detail}>{chat.status.data?.configured ? '直接描述想吃什么，AI 会按要求筛选并搭配。也可按本次配置快速搭配。' : 'AI 正在等待后端配置，可先按本次配置搭配，或自己挑菜。'}</Text><Button label={complete ? '按本次配置快速搭配' : '设置本次搭配'} busy={busy} disabled={profile.loading || !!chat.outgoing} onPress={generate} /></>}
      {plan?.mode === 'chat' && !displayDishes.length && <Text style={l.detail}>请在下方发送本餐要求，重新筛选并搭配菜单。</Text>}
      {!!plan?.ai?.pending?.length && !chat.outgoing && <Button label="重试未完成的要求" secondary busy={chat.busy} disabled={ruleBusy} onPress={() => chat.send('', true)} />}
      {plan?.mode === 'chat' && !displayDishes.length && <Pressable accessibilityRole="button" disabled={busy} style={l.filterButton} onPress={resetConversation}><Text style={l.detail}>清空本餐</Text></Pressable>}
    </ScrollView>
    <View style={{ paddingVertical: 6 }}><ChatComposer chat={chat} disabled={ruleBusy} /></View>
    <Modal visible={clearOpen} transparent animationType="fade" onRequestClose={() => setClearOpen(false)}>
      <View style={l.overlay}><Pressable accessibilityRole="button" accessibilityLabel="取消清空本餐" onPress={() => setClearOpen(false)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <SafeAreaView edges={['bottom', 'left', 'right']} accessibilityViewIsModal style={[l.sheet, { gap: 12, paddingBottom: 26 }]}><Text style={[s.section, { fontSize: 18 }]}>清空本餐？</Text><Text style={s.caption}>将清空本餐菜单、对话、备选菜和临时要求。人数与菜数会保留，已保存的食记不会改变。</Text><View style={[s.row, { marginTop: 4 }]}><View style={{ flex: 1 }}><Button label="取消" secondary onPress={() => setClearOpen(false)} /></View><View style={{ flex: 1 }}><Button label="确认清空" danger disabled={busy} onPress={clearCurrentMeal} /></View></View></SafeAreaView>
      </View>
    </Modal>
    <FilterSheet visible={sheet} title="本次人数与菜数" onClose={() => setSheet(false)} onApply={applySettings} applyDisabled={total < 1 || total > 20 || profile.loading} resetLabel="家庭默认" onReset={() => { setPeople(profile.data?.profile?.people_count ?? menu.draft.people); setCounts({ ...(profile.data?.profile?.category_counts ?? { meat: 1, vegetable: 2, soup: 1 }) }); setAllow(false); }}>
      {profile.loading ? <Loading /> : <><Stepper label="用餐人数" value={editingPeople} min={1} max={30} onChange={setPeople} />{[{ id: 'meat', name: '荤菜' }, { id: 'vegetable', name: '素菜' }, { id: 'soup', name: '汤' }].map(c => <Stepper key={c.id} label={c.name} value={editingCounts[c.id] || 0} onChange={v => setCounts({ ...editingCounts, [c.id]: v })} />)}<Text style={s.caption}>本次共 {total} 道菜（1—20道），不会更改家庭默认。修改后会按新配置重新搭配，保留本餐要求。</Text><View style={s.between}><Text style={[s.body, { flex: 1 }]}>允许非当季及季节未设置食材</Text><Switch accessibilityLabel="允许非当季及季节未设置食材" value={allow} onValueChange={setAllow} trackColor={{ true: colors.green }} /></View><Text style={s.caption}>默认仅从当季与全年食材搭配。开启后仍严格排除最近三天的菜。</Text></>}
    </FilterSheet>
  </View>;
}
