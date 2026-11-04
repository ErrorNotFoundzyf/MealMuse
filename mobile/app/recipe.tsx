import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { allPages, errorText, useApi } from '../src/api';
import { Button, Chip, Field, Loading, Notice, Page, s } from '../src/ui';
import { Category, Ingredient, IngredientCategory, ingredientCategories, Recipe, Season, seasonNames } from '../src/types';
import { useUnsaved } from '../src/useUnsaved';

export default function RecipeEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const api = useApi();
  const [original, setOriginal] = useState<Recipe>();
  const [catalog, setCatalog] = useState<Ingredient[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [hearty, setHearty] = useState(false);
  const [mainIds, setMainIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [steps, setSteps] = useState('');
  const [notes, setNotes] = useState('');
  const [minutes, setMinutes] = useState('');
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [retry, setRetry] = useState(0);
  const [searchMatches, setSearchMatches] = useState<Ingredient[]>([]);
  const [adding, setAdding] = useState(false);
  const [newIngredient, setNewIngredient] = useState('');
  const [newIngredientCategory, setNewIngredientCategory] = useState<IngredientCategory | null>(null);
  const [newIngredientSeasons, setNewIngredientSeasons] = useState<Season[]>([]);
  useUnsaved(dirty && !busy, () => setDirty(false));
  useEffect(() => {
    if (!api.ready) return;
    let current = true;
    setLoading(true); setError('');
    Promise.all([allPages<Ingredient>(api.request, '/ingredients?visibility=all'), api.request<Category[]>('/dish-categories'), id ? api.request<Recipe>(`/recipes/${id}`) : Promise.resolve(undefined)])
      .then(([ingredients, types, recipe]) => {
        if (!current) return;
        setCatalog(ingredients); setCategories(types); setLoaded(true);
        if (recipe) { setOriginal(recipe); setName(recipe.name); setCategory(recipe.category_id); setHearty(recipe.is_hearty && recipe.category_id !== 'hearty'); setMainIds(recipe.ingredients.filter(i => i.is_main).map(i => i.ingredient_id)); setSteps(recipe.steps || ''); setNotes(recipe.notes || ''); setMinutes(recipe.cook_time_minutes?.toString() || ''); setHidden(recipe.is_hidden); }
      }).catch(e => { if (current) setError(errorText(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [id, api.ready, api.request, retry]);
  useEffect(() => {
    if (!search.trim() || !api.ready) return;
    let current = true;
    const timer = setTimeout(() => api.request<{ items: Ingredient[] }>(`/ingredients?q=${encodeURIComponent(search)}&limit=40`)
      .then(data => { if (current) setSearchMatches(data.items); })
      .catch(e => { if (current) setError(errorText(e)); }), 300);
    return () => { current = false; clearTimeout(timer); };
  }, [search, api.ready, api.request]);
  const matches = useMemo(() => search.trim() ? searchMatches : catalog.filter(i => !i.is_hidden || mainIds.includes(i.id)).slice(0, 12), [catalog, search, mainIds, searchMatches]);
  async function addIngredient() {
    if (!newIngredient.trim() || !newIngredientCategory || !newIngredientSeasons.length) {
      setError('请填写新食材名称，并选择分类和季节');
      return;
    }
    setBusy(true); setError('');
    try {
      const item = await api.request<Ingredient>('/ingredients', { method: 'POST', body: JSON.stringify({ name: newIngredient.trim(), ingredient_category: newIngredientCategory, seasons: newIngredientSeasons }) });
      setCatalog(old => [...old, item]); setMainIds(old => [...old, item.id]); setDirty(true); setAdding(false); setNewIngredient(''); setNewIngredientCategory(null); setNewIngredientSeasons([]); setSearch(''); api.changed();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function save() {
    if (minutes && (!/^\d+$/.test(minutes) || +minutes < 1 || +minutes > 1440)) { setError('烹饪时间需为1到1440的整数，也可以不填'); return; }
    setBusy(true); setError('');
    try {
      const known = original?.ingredients || [];
      // Preserve optional recorded quantities and auxiliary ingredients when editing.
      const main = mainIds.map(ingredient_id => {
        const before = known.find(i => i.ingredient_id === ingredient_id);
        return { ingredient_id, is_main: true, quantity: before?.quantity ?? null, unit: before?.unit ?? null };
      });
      const auxiliary = known.filter(i => !i.is_main && !mainIds.includes(i.ingredient_id)).map(i => ({ ingredient_id: i.ingredient_id, is_main: false, quantity: i.quantity, unit: i.unit }));
      const data = { name, category_id: category, is_hearty: hearty, ingredients: [...main, ...auxiliary], steps: steps.trim() || null, notes: notes.trim() || null, cook_time_minutes: minutes ? +minutes : null, ...(id ? { is_hidden: hidden } : {}) };
      await api.request(id ? `/recipes/${id}` : '/recipes', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
      setDirty(false); api.changed(); router.back();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function remove() {
    Alert.alert('删除这道菜谱？', '删除后不再参与后续推荐。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: async () => {
      setBusy(true); setError('');
      try { await api.request(`/recipes/${id}`, { method: 'DELETE' }); setDirty(false); api.changed(); router.back(); }
      catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    } }]);
  }
  return <Page belowHeader title={id ? '编辑菜谱' : '添加菜谱'} subtitle="菜名、主要食材、分类，就够了。">
    {loading ? <Loading /> : !loaded ? <Notice text={error || '未能读取菜谱数据'} error onRetry={() => setRetry(v => v + 1)} /> : <>
      {!!error && <Notice text={error} error />}
      <>
        <Field label="菜名 *" value={name} onChange={v => { setName(v); setDirty(true); }} placeholder="例如：妈妈的豆腐汤" />
        <View><Text style={s.label}>菜品分类 *</Text><View style={s.wrap}>{categories.map(c => <Chip key={c.id} label={c.name} selected={category === c.id || (c.id === 'hearty' && hearty)} onPress={() => {
            setDirty(true);
            if (c.id === 'hearty') { if (category === 'hearty') setCategory(''); else if (!category) setCategory('hearty'); else setHearty(v => !v); }
            else if (category === 'hearty') { setCategory(c.id); setHearty(true); }
            else if (category === c.id && hearty) { setCategory('hearty'); setHearty(false); }
            else { setCategory(c.id); }
          }} />)}</View><Text style={[s.caption, { marginTop: 6 }]}>普通分类单选；选中硬菜时，可再选一个分类。</Text></View>
        <View style={[s.card, { gap: 8 }]}><View style={{ gap: 4 }}><Text style={[s.section, { includeFontPadding: false }]}>主要食材 *</Text><Text style={[s.caption, { includeFontPadding: false }]}>至少选一种食材，用量可不填。</Text></View>
          {!!mainIds.length && <View style={s.wrap}>{mainIds.map(key => <Chip key={key} label={`${catalog.find(i => i.id === key)?.name || key} ×`} selected onPress={() => { setMainIds(old => old.filter(v => v !== key)); setDirty(true); }} />)}</View>}
          <Field label="查找食材" value={search} onChange={setSearch} placeholder="输入食材名称" />
          <View style={s.wrap}>{matches.map(i => <Chip key={i.id} label={i.name} selected={mainIds.includes(i.id)} onPress={() => { setMainIds(old => old.includes(i.id) ? old.filter(v => v !== i.id) : [...old, i.id]); setDirty(true); }} />)}</View>
          <Text style={s.caption}>{!search ? '先显示部分食材，输入名称或别名可查找更多。' : !matches.length ? '没有找到，可在下方明确添加新食材。' : ''}</Text>
          <Button label={adding ? '取消添加食材' : '找不到？添加新食材'} secondary disabled={busy} onPress={() => { setAdding(v => !v); setNewIngredient(search); setNewIngredientCategory(null); setNewIngredientSeasons([]); }} />
          {adding && <View style={{ gap: 10 }}>
            <Field label="新食材名称 *" value={newIngredient} onChange={v => { setNewIngredient(v); setDirty(true); }} />
            <View><Text style={s.label}>所属分类 *</Text><View style={s.wrap}>{Object.entries(ingredientCategories).map(([key, label]) => <Chip key={key} label={label} selected={newIngredientCategory === key} onPress={() => { setNewIngredientCategory(key as IngredientCategory); setDirty(true); }} />)}</View></View>
            <View><Text style={s.label}>适用季节 *</Text><View style={s.wrap}>{(Object.keys(seasonNames) as Season[]).map(key => <Chip key={key} label={seasonNames[key]} selected={newIngredientSeasons.includes(key)} onPress={() => {
              setDirty(true);
              setNewIngredientSeasons(old => key === 'all_year' ? old.includes('all_year') ? [] : ['all_year'] : old.includes(key) ? old.filter(v => v !== key) : [...old.filter(v => v !== 'all_year'), key]);
            }} />)}</View></View>
            <Text style={s.caption}>分类必选，季节至少选一项；全年与其他季节互斥。创建后会保存到食材库并自动选中。</Text>
            <Button label="创建并选中" busy={busy} disabled={!newIngredient.trim() || !newIngredientCategory || !newIngredientSeasons.length} onPress={addIngredient} />
          </View>}
        </View>
        <Button label={expanded ? '收起选填信息' : '展开选填信息'} secondary onPress={() => setExpanded(v => !v)} />
        {expanded && <View style={s.card}><Field label="做法（选填）" value={steps} onChange={v => { setSteps(v); setDirty(true); }} multiline /><Field label="烹饪分钟（选填）" value={minutes} onChange={v => { setMinutes(v); setDirty(true); }} numeric /><Field label="备注（选填）" value={notes} onChange={v => { setNotes(v); setDirty(true); }} multiline /></View>}
      </>
      {id && <Chip label={hidden ? '已隐藏 · 点击恢复' : '正常显示 · 点击隐藏'} selected={hidden} onPress={() => { setHidden(v => !v); setDirty(true); }} />}
      <Button label="保存菜谱" busy={busy} disabled={!name.trim() || !category || !mainIds.length} onPress={save} />
      {id && <Button label="删除菜谱" danger disabled={busy} onPress={remove} />}
    </>}
  </Page>;
}
