import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useApi, errorText } from './api';
import { Button, Field, Loading, Notice, Page, s } from './ui';

export function FamilyGate({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [address, setAddress] = useState(api.baseUrl); const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => setAddress(api.baseUrl), [api.baseUrl]);
  if (!api.ready || api.authState === 'checking') return <Page title="吃饭灵感" subtitle="正在连接家庭空间"><Loading /></Page>;
  if (api.authState === 'signedIn' || api.authState === 'legacy') return <>{children}</>;
  async function signIn() {
    setBusy(true); setError('');
    try { await api.login(name, password); setPassword(''); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function saveAddress() {
    setBusy(true); setError('');
    try { await api.saveConnection(address, '', false); setEditing(false); api.retryAuth(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <Page title="吃饭灵感" subtitle="登录家庭账号，和家人共享菜谱与食记。">
    {!!error && <Notice text={error} error />}
    {api.authState === 'offline' ? <View style={s.card}><Text style={s.section}>暂时连接不到家庭服务</Text><Text style={s.caption}>请检查网络和服务是否启动，然后重试。</Text><Button label="重新连接" busy={busy} onPress={api.retryAuth} /></View> : <View style={s.card}><Text style={s.section}>家庭账号</Text><Field label="账号" value={name} onChange={setName} placeholder="输入家庭账号" /><Field label="密码" value={password} onChange={setPassword} placeholder="输入密码" secret /><Button label="登录" busy={busy} disabled={!name.trim() || !password} onPress={signIn} /></View>}
    {editing ? <View style={s.card}><Field label="家庭服务地址" value={address} onChange={setAddress} placeholder="https://..." /><Button label="保存地址" secondary busy={busy} onPress={saveAddress} /><Button label="取消" secondary disabled={busy} onPress={() => setEditing(false)} /></View> : <Button label="更改服务地址" secondary onPress={() => setEditing(true)} />}
  </Page>;
}
