import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { errorText, useApi } from '../src/api';
import { Button, Chip, Field, Loading, Notice, Page, s } from '../src/ui';
import { Ingredient, IngredientCategory, ingredientCategories, Season, seasonNames } from '../src/types';
import { useUnsaved } from '../src/useUnsaved';

export default function IngredientEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const api = useApi();
  const [original, setOriginal] = useState<Ingredient>();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<IngredientCategory | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [retry, setRetry] = useState(0);
  useUnsaved(dirty && !busy, () => setDirty(false));
  useEffect(() => {
    if (!id || !api.ready) return;
    let current = true;
    setLoading(true); setError('');
    api.request<Ingredient>(`/ingredients/${id}`).then(value => {
      if (!current) return;
      setOriginal(value); setName(value.name); setCategory(value.ingredient_category); setSeasons(value.seasons); setHidden(value.is_hidden);
    }).catch(e => { if (current) setError(errorText(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [id, api.ready, api.request, retry]);
  function toggleSeason(value: Season) {
    setDirty(true);
    setSeasons(old => value === 'all_year' ? old.includes('all_year') ? [] : ['all_year'] : old.includes(value) ? old.filter(v => v !== value) : [...old.filter(v => v !== 'all_year'), value]);
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const data = { name, ingredient_category: category, seasons, ...(id ? { is_hidden: hidden } : {}) };
      await api.request(id ? `/ingredients/${id}` : '/ingredients', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
      setDirty(false); api.changed(); router.back();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function remove() {
    Alert.alert('删除食材？', '若有菜谱正在使用，系统会列出引用并阻止删除。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: async () => {
      setBusy(true); setError('');
      try { await api.request(`/ingredients/${id}`, { method: 'DELETE' }); setDirty(false); api.changed(); router.back(); }
      catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    } }]);
  }
  return <Page belowHeader title={id ? '这份食材的小档案' : '添一种食材'} subtitle="季节记录一次，推荐时自动参考。">
    {loading ? <Loading /> : id && !original ? <Notice text={error || '未能读取食材'} error onRetry={() => setRetry(v => v + 1)} /> : <>
      {!!error && <Notice text={error} error />}
      <View style={s.card}><Field label="食材名称 *" value={name} onChange={v => { setName(v); setDirty(true); }} placeholder="例如：八角" /><Text style={s.label}>食材分类（选填）</Text><View style={s.wrap}>{Object.entries(ingredientCategories).map(([key, label]) => <Chip key={key} label={label} selected={category === key} onPress={() => { setCategory(category === key ? null : key as IngredientCategory); setDirty(true); }} />)}</View></View>
      <View style={s.card}><Text style={s.section}>常见季节</Text><Text style={s.caption}>可选多个季节；全年与其他选项互斥。不选代表尚未设置，不会当作全年供应。</Text><View style={s.wrap}>{(Object.keys(seasonNames) as Season[]).map(key => <Chip key={key} label={seasonNames[key]} selected={seasons.includes(key)} onPress={() => toggleSeason(key)} />)}</View></View>
      {id && <Chip label={hidden ? '已隐藏 · 点击恢复' : '正常显示 · 点击隐藏'} selected={hidden} onPress={() => { setHidden(v => !v); setDirty(true); }} />}
      <Button label="保存食材" busy={busy} disabled={!name.trim()} onPress={save} />
      {id && <Button label="删除食材" danger disabled={busy} onPress={remove} />}
    </>}
  </Page>;
}
