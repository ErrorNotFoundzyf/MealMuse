import { RecipeTags } from '../src/tags';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { errorText, useApi } from '../src/api';
import { chinaToday, requestKey, useMenu } from '../src/menu-draft';
import { Button, colors, Field, Loading, Notice, Page, s, Stepper } from '../src/ui';
import { ShoppingList } from '../src/shopping-list';
import { l } from '../src/library-ui';
import type { MealRecord } from '../src/types';
import { mealItemSummary } from '../src/types';

export default function MenuReview() {
  const menu = useMenu(); const api = useApi();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState<MealRecord>();
  const draft = menu.draft;
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [draft.requestKey]);
  const unknown = draft.rulePlan?.ai?.constraints?.map(c => c.text) || [];
  function changeDate(value: string) { menu.setDraft(old => ({ ...old, mealDate: value, requestKey: requestKey() })); }
  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.mealDate) || draft.mealDate > chinaToday()) { setError('请填写今天或过去的日期，格式如 2026-11-04'); return; }
    setBusy(true); setError('');
    try {
      const record = await api.request<MealRecord>(draft.recordId ? `/meal-records/${draft.recordId}` : '/meal-records', { method: draft.recordId ? 'PUT' : 'POST', body: JSON.stringify({ meal_date: draft.mealDate, people_count: draft.people, recipe_ids: draft.recipeIds, request_key: draft.requestKey, ...(draft.rulePlan ? { plan_id: draft.rulePlan.id, plan_revision: draft.rulePlan.revision, manual_adjustment: !!draft.manualAdjustment, acknowledge_unknown: acknowledged } : {}), ...(draft.recordId ? { revision: draft.revision } : {}) }) });
      setSaved(record); menu.resetIfKey(draft.requestKey); api.changed();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  if (saved) return <Page belowHeader title="已记入食记" subtitle={`${saved.meal_date} · ${saved.people_count}人 · ${mealItemSummary(saved.dishes)}`}><Notice text="菜单已经保存，可以在食记日历中查看和更正。" /><Button label="查看食记" onPress={() => router.replace({ pathname: '/journal', params: { date: saved.meal_date } })} /><Button label="再选一餐" secondary onPress={() => router.replace({ pathname: '/', params: { pick: '1' } })} /></Page>;
  return <Page belowHeader title={draft.recordId ? '更正这份菜单' : '本餐菜单'} subtitle="确认后记入食记；日常配饭不计入菜数。">
    {!menu.ready ? <Loading /> : <>
      {!!error && <Notice text={error} error />}{!!menu.error && <Notice text={menu.error} error />}
      <View style={[s.card, { gap: 10 }]}><Field label="记录日期" value={draft.mealDate} onChange={changeDate} placeholder="YYYY-MM-DD" /><Text style={s.caption}>可以补记过去的菜单，不记录未来计划。</Text><Stepper label="用餐人数" value={draft.people} min={1} max={30} onChange={people => menu.setDraft(old => ({ ...old, people, requestKey: requestKey() }))} /></View>
      <View style={[s.card, { gap: 8 }]}><View style={s.between}><Text style={[s.section, { flexShrink: 1 }]}>已选 {mealItemSummary(draft.dishes.filter(d => draft.recipeIds.includes(d.recipe_id)))}</Text><Pressable accessibilityRole="button" disabled={busy} style={l.filterButton} onPress={() => router.navigate({ pathname: '/', params: { pick: '1' } })}><Text style={{ color: colors.green, fontSize: 14 }}>继续挑菜</Text></Pressable></View>
        {!draft.recipeIds.length && <Text style={s.caption}>还没有选菜，返回后从菜谱中挑几道。</Text>}
        {draft.dishes.filter(d => draft.recipeIds.includes(d.recipe_id)).map(d => <View key={d.recipe_id} style={[s.between, { borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 }]}><View style={{ flex: 1 }}><Text style={l.name}>{d.name}</Text><Text style={l.detail}>{d.ingredients.filter(i => i.is_main).map(i => i.name).join(' · ')}</Text></View><RecipeTags recipe={d} /><Pressable accessibilityRole="button" accessibilityLabel={`移除${d.name}`} disabled={busy || !!draft.outgoing} style={l.iconButton} onPress={() => menu.setDraft(old => ({ ...old, rulePlan: old.rulePlan?.mode === 'chat' ? old.rulePlan : undefined, manualAdjustment: old.rulePlan?.mode === 'chat', requestKey: requestKey(), recipeIds: old.recipeIds.filter(id => id !== d.recipe_id), dishes: old.dishes.filter(i => i.recipe_id !== d.recipe_id) }))}><Ionicons name="remove-circle-outline" size={23} color={colors.muted} /></Pressable></View>)}
      </View>
      {!!draft.recipeIds.length && <ShoppingList recipeIds={draft.recipeIds} recordId={draft.recordId} revision={draft.revision} planId={draft.rulePlan?.id} planRevision={draft.rulePlan?.revision} />}
      {!draft.rulePlan && <Text style={s.caption}>按自己挑方式确认，允许主动选择近期吃过的菜。</Text>}
      {draft.rulePlan?.ai?.hearty_count != null && <Text style={s.caption}>本餐要求：{draft.rulePlan.ai.hearty_count}道带硬菜标签的菜品。</Text>}
      {!!unknown.length && <View style={s.card}><Text style={s.section}>确认前请核对</Text><Text style={s.caption}>{unknown.join('、')}：菜谱可能未完整记录调料或做法，不能据此保证满足限制。</Text><View style={s.between}><Text style={[s.body, { flex: 1 }]}>我会核对配料与做法</Text><Switch accessibilityLabel="我会核对配料与做法" value={acknowledged} onValueChange={setAcknowledged} /></View></View>}
      {draft.rulePlan?.ai?.blocked && <Notice text="本轮要求还未处理完成，请返回对话继续说明或重试。" error />}
      <Button label={draft.recordId ? '保存更正' : '确认菜单并记入食记'} busy={busy} disabled={!draft.recipeIds.length || !!draft.outgoing || !!draft.rulePlan?.ai?.blocked || (!!unknown.length && !acknowledged)} onPress={save} />
      {draft.recordId && <Text style={s.caption}>已有菜品使用当时保存的名称与食材，更正不会随菜谱库更新而改变历史。</Text>}
    </>}
  </Page>;
}
