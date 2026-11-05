import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { errorText, useApi, useResource } from '../../src/api';
import { Button, Field, Loading, Notice, Page, s, Stepper } from '../../src/ui';
import { Category, Profile } from '../../src/types';

export default function Settings() {
  const api = useApi();
  const categories = useResource<Category[]>('/dish-categories');
  const profile = useResource<{ profile: Profile | null }>('/profile');
  const [people, setPeople] = useState(4);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [url, setUrl] = useState(api.baseUrl);
  const [token, setToken] = useState('');
  const [replaceToken, setReplaceToken] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setUrl(api.baseUrl); }, [api.baseUrl]);
  useEffect(() => {
    if (dirty) return;
    if (profile.data?.profile) { setPeople(profile.data.profile.people_count); setCounts(profile.data.profile.category_counts); }
    else if (profile.data && categories.data) { setCounts(Object.fromEntries(categories.data.filter(c => ['meat', 'vegetable', 'soup'].includes(c.id)).map(c => [c.id, c.id === 'meat' || c.id === 'soup' ? 1 : c.id === 'vegetable' ? 2 : 0]))); }
  }, [profile.data, categories.data, dirty]);
  const dishCounts = Object.fromEntries(Object.entries(counts).filter(([id]) => ['meat', 'vegetable', 'soup'].includes(id)));
  const total = Object.values(dishCounts).reduce((a, b) => a + b, 0);
  async function saveProfile() {
    setError(''); setMessage(''); setBusy('profile');
    try { await api.request('/profile', { method: 'PUT', body: JSON.stringify({ people_count: people, category_counts: dishCounts }) }); setDirty(false); api.changed(); setMessage('家庭默认已保存，下次打开仍会保留。'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  async function saveConnection() {
    setError(''); setMessage(''); setBusy('connection');
    try { await api.saveConnection(url, token, replaceToken); setToken(''); setReplaceToken(false); setDirty(false); setMessage('连接设置已保存，正在重新读取家庭数据。'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  return <Page title="我们家的餐桌" subtitle="设置一次，日常少操一点心。">
    {!!error && <Notice text={error} error />}{!!message && <Notice text={message} />}
    <View style={s.card}><Text style={s.section}>家庭默认</Text><Text style={s.caption}>这里只保存长期配置；以后推荐时的临时调整不会改动这里。</Text>
      {profile.loading || categories.loading ? <Loading /> : profile.error || categories.error ? <Notice text={profile.error || categories.error} error onRetry={() => { profile.reload(); categories.reload(); }} /> : <>
        <Stepper label="用餐人数" value={people} min={1} max={30} onChange={v => { setPeople(v); setDirty(true); }} />
        {categories.data?.filter(c => ['meat', 'vegetable', 'soup'].includes(c.id)).map(c => <Stepper key={c.id} label={c.name} value={counts[c.id] || 0} onChange={v => { setCounts(old => ({ ...old, [c.id]: v })); setDirty(true); }} />)}
        <Text style={s.body}>共 {total} 道菜</Text><Text style={s.caption}>只统计荤菜、素菜和汤，配饭的米饭不计入菜数。至少一道，最多二十道。</Text>
        <Button label="保存家庭默认" busy={busy === 'profile'} disabled={!!busy || total < 1 || total > 20} onPress={saveProfile} />
      </>}
    </View>
    <View style={s.card}><Text style={s.section}>家庭服务连接</Text><Text style={s.caption}>真机需要填写手机可访问的后端地址。10.0.2.2 仅适用于 Android 模拟器。</Text><Field label="服务地址" value={url} onChange={setUrl} placeholder="https://your-family-api.example" />
      {api.hasToken && !replaceToken ? <><Text style={s.caption}>已保存家庭接入凭证，不在此显示。</Text><Button label="更换或清除凭证" secondary onPress={() => setReplaceToken(true)} /></> : <Field label="家庭接入凭证（本地开发可留空）" value={token} onChange={v => { setToken(v); setReplaceToken(true); }} secret />}
      <Button label="保存连接设置" secondary busy={busy === 'connection'} disabled={!!busy} onPress={() => dirty ? Alert.alert('更换连接', '未保存的家庭配置将被重新加载。', [{ text: '取消' }, { text: '继续', onPress: saveConnection }]) : saveConnection()} />
    </View>
    <Text style={s.caption}>吃饭灵感 · 0.4.0 / 对话搭配{ '\n' }无图片，无市场状态维护。食材季节可按家庭经验调整。</Text>
  </Page>;
}
