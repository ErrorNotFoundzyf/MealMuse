import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { errorText, useApi } from './api';
import { colors, Notice, s } from './ui';
import { l } from './library-ui';
import type { ShoppingItem } from './types';

export function ShoppingList({ recipeIds, recordId, revision, planId, planRevision }: { recipeIds: string[]; recordId?: string; revision?: number; planId?: string; planRevision?: number }) {
  const api = useApi(); const [items, setItems] = useState<ShoppingItem[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [retry, setRetry] = useState(0);
  const body = JSON.stringify({ recipe_ids: recipeIds, ...(recordId ? { record_id: recordId, revision } : planId ? { plan_id: planId, plan_revision: planRevision } : {}) });
  useEffect(() => {
    if (!api.ready || !JSON.parse(body).recipe_ids.length) { setItems([]); return; }
    let current = true; setLoading(true); setError('');
    api.request<{ items: ShoppingItem[] }>('/shopping-list', { method: 'POST', body }).then(data => { if (current) setItems(data.items); }).catch(e => { if (current) setError(errorText(e)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api.ready, api.request, body, retry]);
  return <View style={[s.card, { gap: 8 }]}><View style={s.between}><Text style={s.section}>采购清单</Text>{loading && <ActivityIndicator color={colors.green} />}</View><Text style={s.caption}>主要食材已去重；用量未填时只列名称，不按人数推算。</Text>{error ? <Notice text={error} error onRetry={() => setRetry(v => v + 1)} /> : !loading && items.map(item => <View key={item.ingredient_id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 }}><View style={s.between}><Text style={s.body}>{item.name}</Text><Text style={l.detail}>{item.quantity !== null ? `${item.quantity}${item.unit}` : item.note}</Text></View><Text style={l.detail}>{item.recipe_names.join('、')}{item.season_status === 'out_of_season' ? ' · 非当季' : item.season_status === 'season_unknown' ? ' · 季节未设置' : ''}</Text></View>)}</View>;
}
