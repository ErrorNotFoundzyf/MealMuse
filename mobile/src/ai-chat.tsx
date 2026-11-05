import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { errorText, useApi, useResource } from './api';
import { requestKey, useMenu } from './menu-draft';
import type { OutgoingChat } from './menu-draft';
import { colors, s } from './ui';
import { l } from './library-ui';
import type { PlanningSettings, RulePlan } from './types';

export function useAiChat(planning: PlanningSettings) {
  const api = useApi(); const menu = useMenu();
  const status = useResource<{ configured: boolean; provider: string; model: string }>('/ai/status');
  const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const latest = useRef(menu.draft); latest.current = menu.draft;
  const inFlight = useRef(false);
  async function submit(outgoing: OutgoingChat, beforeKey: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    menu.setDraft(old => old.requestKey !== beforeKey ? old : { ...old, outgoing: { ...outgoing, status: 'sending', error: undefined } });
    try {
      const plan = await api.request<RulePlan>('/ai/chat', { method: 'POST', body: JSON.stringify({ ...outgoing.body, request_key: outgoing.requestKey }) }, 95000);
      if (latest.current.requestKey !== beforeKey) { setError('选菜已变化，对话结果未覆盖当前菜单'); return; }
      menu.setDraft(old => old.requestKey !== beforeKey ? old : { people: plan.people_count, mealDate: plan.as_of_date,
        recipeIds: plan.dishes.map(d => d.recipe_id), dishes: plan.dishes, rulePlan: plan, requestKey: requestKey(),
        planning: { people_count: plan.people_count, category_counts: plan.category_counts, allow_nonseasonal: plan.allow_nonseasonal } });
    } catch (e) {
      const message = errorText(e);
      menu.setDraft(old => old.requestKey !== beforeKey ? old : { ...old, outgoing: { ...outgoing, status: 'failed', error: message } });
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function send(message = input, retry = false, override?: PlanningSettings) {
    if (busy || inFlight.current || menu.draft.outgoing || (!message.trim() && !retry)) return;
    const before = menu.draft;
    const body = { message: retry ? '' : message.trim(), retry, ...(override || planning), ...(override ? { settings_change: true } : {}),
      ...(before.rulePlan ? { plan_id: before.rulePlan.id, expected_revision: before.rulePlan.revision } : {}),
      selected_recipe_ids: before.recipeIds, replace_selection: !!before.manualAdjustment && (!override || before.recipeIds.length > 0) };
    const outgoing: OutgoingChat = { message: retry ? '' : message.trim(), body, requestKey: requestKey(), status: 'sending' };
    if (!override && !retry) setInput('');
    await submit(outgoing, before.requestKey);
  }
  function retryOutgoing() { if (menu.draft.outgoing?.status === 'failed') void submit(menu.draft.outgoing, menu.draft.requestKey); }
  function editOutgoing() {
    const outgoing = menu.draft.outgoing;
    if (!outgoing || outgoing.status !== 'failed') return;
    menu.setDraft(old => old.outgoing?.requestKey === outgoing.requestKey ? { ...old, outgoing: undefined } : old);
    if (outgoing.message) setInput(current => current ? `${outgoing.message}\n${current}` : outgoing.message);
  }
  async function saveTemporary(recipeId: string) {
    const before = menu.draft;
    if (!before.rulePlan || busy || before.outgoing) return;
    setBusy(true); setError('');
    try {
      const plan = await api.request<RulePlan>(`/ai/plans/${before.rulePlan.id}/save-temporary`, { method: 'POST', body: JSON.stringify({ recipe_id: recipeId, expected_revision: before.rulePlan.revision }) });
      menu.setDraft(old => old.requestKey !== before.requestKey ? old : { ...old, rulePlan: plan, dishes: plan.dishes, recipeIds: plan.dishes.map(d => d.recipe_id), requestKey: requestKey() });
      api.changed();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function requestSave(recipeId: string) {
    Alert.alert('保存到菜谱库？', '将保存菜名、分类和主要食材；不会自动补全步骤或用量。', [{ text: '取消', style: 'cancel' }, { text: '保存', onPress: () => saveTemporary(recipeId) }]);
  }
  function reset() { setInput(''); setError(''); }
  return { input, setInput, busy, error, status, send, requestSave, reset, outgoing: menu.draft.outgoing, retryOutgoing, editOutgoing };
}

export function ChatMessages({ plan, outgoing, onRetry, onEdit }: { plan?: RulePlan; outgoing?: OutgoingChat; onRetry: () => void; onEdit: () => void }) {
  const messages = [...(plan?.ai?.messages || []), ...(outgoing?.message ? [{ role: 'user' as const, content: outgoing.message }] : [])];
  return <View style={{ gap: 10 }}>{messages.map((message, i) => <View key={i} style={{ maxWidth: '92%', alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start', backgroundColor: message.role === 'user' ? colors.pale : colors.paper, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.line }}><Text style={{ fontSize: 15, lineHeight: 23, color: colors.ink }}>{message.content}</Text></View>)}
    {outgoing?.status === 'sending' && <View accessibilityLiveRegion="polite" style={[s.row, { alignSelf: 'flex-start', backgroundColor: colors.paper, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12 }]}><ActivityIndicator size="small" color={colors.green} /><Text style={l.detail}>正在理解和搭配，请稍候…</Text></View>}
    {outgoing?.status === 'failed' && <View accessibilityLiveRegion="polite" style={{ alignSelf: 'flex-end', alignItems: 'flex-end', gap: 4 }}><Text style={[l.detail, { color: colors.red }]}>{outgoing.error || '发送失败，请重试。'}</Text><View style={s.row}><Pressable accessibilityRole="button" onPress={onEdit} style={l.filterButton}><Text style={{ color: colors.muted, fontSize: 13 }}>编辑消息</Text></Pressable><Pressable accessibilityRole="button" onPress={onRetry} style={l.filterButton}><Text style={{ color: colors.green, fontSize: 13 }}>重试发送</Text></Pressable></View></View>}
  </View>;
}

export function ChatComposer({ chat, disabled }: { chat: ReturnType<typeof useAiChat>; disabled: boolean }) {
  const canSend = !disabled && !chat.busy && !chat.outgoing && !!chat.input.trim() && !!chat.status.data?.configured;
  return <View style={{ gap: 6 }}><View style={[s.row, { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 14, paddingLeft: 12 }]}><TextInput accessibilityLabel="本餐对话要求" placeholder="想吃什么？或说说想换哪道…" placeholderTextColor={colors.muted} value={chat.input} onChangeText={chat.setInput} editable={!disabled && !chat.busy} multiline maxLength={1200} style={{ flex: 1, color: colors.ink, fontSize: 15, maxHeight: 110, minHeight: 48, paddingVertical: 10 }} /><Pressable accessibilityRole="button" accessibilityLabel="发送本餐要求" disabled={!canSend} onPress={() => chat.send()} style={[l.iconButton, { opacity: canSend ? 1 : 0.35 }]}><Ionicons name="arrow-up-circle" size={32} color={colors.green} /></Pressable></View><Text style={l.detail}>{chat.outgoing?.status === 'failed' ? '请先重试未完成的消息。' : '可说“换掉第一道和汤，另外两道保留”。'}</Text></View>;
}
