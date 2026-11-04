import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useFocusEffect } from 'expo-router';
import type { Page } from './types';

type Api = {
  ready: boolean; baseUrl: string; hasToken: boolean; revision: number;
  saveConnection: (url: string, token: string, replaceToken?: boolean) => Promise<void>;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  changed: () => void;
};
const ApiContext = createContext<Api | null>(null);
export const errorText = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';

export function ApiProvider({ children }: React.PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [baseUrl, setBaseUrl] = useState(process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:8000');
  const [token, setToken] = useState('');
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    Promise.all([AsyncStorage.getItem('api-url'), SecureStore.getItemAsync('family-access-token')])
      .then(([url, secret]) => { if (url) setBaseUrl(url); setToken(secret || ''); })
      .catch(() => { /* Connection can be re-entered if device storage is unavailable. */ })
      .finally(() => setReady(true));
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
  const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${baseUrl}/api/v1${path}`, {
        ...options, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
      });
      if (response.status === 204) return undefined as T;
      const data = await response.json();
      if (!response.ok) {
        const details = data.error?.details;
        const duplicate = details?.ingredient_id ? `（已有：${details.name}）` : '';
        const refs = details?.recipes?.map((r: { name: string }) => r.name).join('、');
        throw new Error(`${data.error?.message || '请求未成功'}${duplicate}${refs ? `：${refs}` : ''}${details?.fields?.[0] ? `：${details.fields[0].message}` : ''}`);
      }
      return data as T;
    } catch (error) {
      // Android may wrap an aborted fetch as a generic Error instead of AbortError.
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new Error('连接超时，请检查服务是否启动；USB 调试时请检查数据线连接');
      if (error instanceof TypeError) throw new Error('连接不到家庭服务，请到设置检查地址、网络和服务是否启动');
      throw error;
    } finally { clearTimeout(timeout); }
  }, [baseUrl, token]);
  const value = useMemo(() => ({ ready, baseUrl, hasToken: !!token, saveConnection, request, revision, changed }), [ready, baseUrl, token, saveConnection, request, revision, changed]);
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
