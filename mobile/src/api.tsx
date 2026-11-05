import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useFocusEffect } from 'expo-router';
import type { Page } from './types';

type Api = {
  ready: boolean; baseUrl: string; hasToken: boolean; revision: number;
  authState: 'checking' | 'signedIn' | 'signedOut' | 'offline' | 'legacy'; username: string;
  login: (username: string, password: string) => Promise<void>; logout: () => Promise<void>; retryAuth: () => void;
  saveConnection: (url: string, token: string, replaceToken?: boolean) => Promise<void>;
  request: <T>(path: string, options?: RequestInit, timeoutMs?: number) => Promise<T>;
  changed: () => void;
};
const ApiContext = createContext<Api | null>(null);
export const errorText = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

export function ApiProvider({ children }: React.PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [baseUrl, setBaseUrl] = useState(process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:8000');
  const [token, setToken] = useState('');
  const [session, setSession] = useState(''); const [sessionUrl, setSessionUrl] = useState('');
  const [authState, setAuthState] = useState<Api['authState']>('checking'); const [username, setUsername] = useState('');
  const [authRetry, setAuthRetry] = useState(0);
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    Promise.all([AsyncStorage.getItem('api-url'), SecureStore.getItemAsync('family-access-token'), SecureStore.getItemAsync('family-session'), SecureStore.getItemAsync('family-session-url')])
      .then(([url, secret, savedSession, savedUrl]) => { if (url) setBaseUrl(url); setToken(secret || ''); setSession(savedSession || ''); setSessionUrl(savedUrl || ''); })
      .catch(() => { /* Connection can be re-entered if device storage is unavailable. */ })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    setAuthState('checking');
    (async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/status`, { signal: controller.signal });
      if (!response.ok) throw new Error('连接失败');
      const state = await response.json();
      if (!state.configured) { if (active) setAuthState('legacy'); return; }
      if (!session || sessionUrl !== baseUrl) { if (active) setAuthState('signedOut'); return; }
      const check = await fetch(`${baseUrl}/api/v1/auth/session`, { signal: controller.signal, headers: { Authorization: `Bearer ${session}` } });
      if (check.status === 401) { if (active) setAuthState('signedOut'); return; }
      if (!check.ok) throw new Error('连接失败');
      const data = await check.json();
      if (active) { setUsername(data.username || ''); setAuthState('signedIn'); }
    })().catch(() => { if (active) setAuthState('offline'); }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [ready, baseUrl, session, sessionUrl, authRetry]);
  const retryAuth = useCallback(() => setAuthRetry(v => v + 1), []);
  const login = useCallback(async (name: string, password: string) => {
    if (!__DEV__ && !baseUrl.startsWith('https://')) throw new Error('正式版本需要使用 HTTPS 家庭服务地址');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name.trim(), password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '登录失败，请重试');
      await SecureStore.setItemAsync('family-session', data.token);
      await SecureStore.setItemAsync('family-session-url', baseUrl);
      setUsername(data.username); setSessionUrl(baseUrl); setSession(data.token); setAuthState('signedIn');
    } catch (e) {
      if (controller.signal.aborted || e instanceof TypeError) throw new Error('连接不到家庭服务，请检查网络和服务地址');
      throw e;
    } finally { clearTimeout(timer); }
  }, [baseUrl]);
  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync('family-session'); await SecureStore.deleteItemAsync('family-session-url');
    setSession(''); setSessionUrl(''); setUsername(''); setAuthState('signedOut');
  }, []);
  const saveConnection = useCallback(async (url: string, secret: string, replaceToken = false) => {
    const trimmed = url.trim().replace(/\/+$/, '');
    let parsed: URL;
    try { parsed = new URL(trimmed); } catch { throw new Error('请填写完整服务地址，例如 https://example.com'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('请仅填写服务地址，不含账号密码、查询参数或 /api 路径');
    if (trimmed.startsWith('http:') && !__DEV__ && process.env.EXPO_PUBLIC_ALLOW_HTTP !== '1') throw new Error('正式安装包请使用 HTTPS 地址');
    await AsyncStorage.setItem('api-url', trimmed);
    if (replaceToken) {
      if (secret.trim()) await SecureStore.setItemAsync('family-access-token', secret.trim());
      else await SecureStore.deleteItemAsync('family-access-token');
      setToken(secret.trim());
    }
    setBaseUrl(trimmed); changed();
  }, [changed]);
  const request = useCallback(async <T,>(path: string, options: RequestInit = {}, timeoutMs = 12000): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/api/v1${path}`, {
        ...options, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...((session && sessionUrl === baseUrl ? session : token) ? { Authorization: `Bearer ${session && sessionUrl === baseUrl ? session : token}` } : {}), ...options.headers },
      });
      if (response.status === 204) return undefined as T;
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401 && session && sessionUrl === baseUrl) setAuthState('signedOut');
        const details = data.error?.details;
        const duplicate = details?.ingredient_id ? `（已有：${details.name}）` : '';
        const refs = details?.recipes?.map((r: { name: string }) => r.name).join('、');
        throw new Error(`${data.error?.message || '请求未成功'}${duplicate}${refs ? `：${refs}` : ''}${details?.fields?.[0] ? `：${details.fields[0].message}` : ''}`);
      }
      return data as T;
    } catch (error) {
      // Android may wrap an aborted fetch as a generic Error instead of AbortError.
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new Error(timeoutMs > 12000 ? '本轮响应较慢，请重试；菜单不会自动确认' : '连接超时，请检查服务是否启动；USB 调试时请检查数据线连接');
      if (error instanceof TypeError) throw new Error('连接不到家庭服务，请到设置检查地址、网络和服务是否启动');
      throw error;
    } finally { clearTimeout(timeout); }
  }, [baseUrl, token, session, sessionUrl]);
  const value = useMemo(() => ({ ready, baseUrl, hasToken: !!token, authState, username, login, logout, retryAuth, saveConnection, request, revision, changed }), [ready, baseUrl, token, authState, username, login, logout, retryAuth, saveConnection, request, revision, changed]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi() {
  const value = useContext(ApiContext);
  if (!value) throw new Error('ApiProvider missing');
  return value;
}

export function useResource<T>(path: string) {
  const { request, ready, revision } = useApi();
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(v => v + 1), []);
  useFocusEffect(useCallback(() => {
    if (!ready) return;
    let current = true;
    setLoading(true); setError('');
    request<T>(path).then(value => { if (current) setData(value); })
      .catch(e => { if (current) { setData(undefined); setError(errorText(e)); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [request, ready, path, revision, reloadKey]));
  return { data, loading, error, reload };
}

export async function allPages<T>(request: Api['request'], path: string): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await request<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
    items.push(...page.items); offset += page.items.length;
    if (offset >= page.total || !page.items.length) return items;
  }
}
