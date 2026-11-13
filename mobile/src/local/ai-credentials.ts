import * as SecureStore from 'expo-secure-store';

const KEY = 'meal-muse-deepseek-key-v1';

export async function hasDeepSeekKey(): Promise<boolean> { return !!(await SecureStore.getItemAsync(KEY)); }
export async function getDeepSeekKey(): Promise<string | null> { return SecureStore.getItemAsync(KEY); }
export async function saveDeepSeekKey(value: string): Promise<void> {
  const key = value.trim();
  if (!key || /\s/.test(key)) throw new Error('请填写有效的 DeepSeek API 密钥');
  await SecureStore.setItemAsync(KEY, key);
}
export async function clearDeepSeekKey(): Promise<void> { await SecureStore.deleteItemAsync(KEY); }
