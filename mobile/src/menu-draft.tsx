import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorText, useApi } from './api';
import type { MealDish, MealRecord, PlanningSettings, Profile, RulePlan } from './types';

export const chinaToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const requestKey = () => `menu-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
type Draft = { recipeIds: string[]; people: number; mealDate: string; requestKey: string; recordId?: string; revision?: number; dishes: MealDish[]; rulePlan?: RulePlan; planning?: PlanningSettings };
const empty = (people = 4, mealDate = chinaToday()): Draft => ({ recipeIds: [], people, mealDate, requestKey: requestKey(), dishes: [] });
type MenuContextValue = { draft: Draft; ready: boolean; error: string; setDraft: React.Dispatch<React.SetStateAction<Draft>>; start: (date?: string, record?: MealRecord) => void; resetIfKey: (key: string) => void };
const MenuContext = createContext<MenuContextValue | null>(null);

export function MenuProvider({ children }: React.PropsWithChildren) {
  const api = useApi();
  const [draft, setDraft] = useState<Draft>(() => empty());
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const defaultPeople = useRef(4);
  const writes = useRef(Promise.resolve());
  const key = `menu-draft-v1:${api.baseUrl}`;
  useEffect(() => {
    if (!api.ready) return;
    let current = true;
    api.request<{ profile: Profile | null }>('/profile').then(value => { if (current && value.profile) defaultPeople.current = value.profile.people_count; }).catch(() => {});
    return () => { current = false; };
  }, [api.ready, api.request, api.revision]);
  useEffect(() => {
    if (!api.ready) return;
    let current = true;
    setLoadedKey(''); setError('');
    Promise.all([AsyncStorage.getItem(key), api.request<{ profile: Profile | null }>('/profile').catch(() => ({ profile: null }))]).then(([stored, profile]) => {
      if (!current) return;
      defaultPeople.current = profile.profile?.people_count || 4;
      let next = empty(defaultPeople.current);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Draft;
          if (Array.isArray(parsed.recipeIds) && parsed.recipeIds.every(id => typeof id === 'string') && parsed.recipeIds.length <= 20 && typeof parsed.requestKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.mealDate) && Number.isInteger(parsed.people) && parsed.people >= 1 && parsed.people <= 30 && Array.isArray(parsed.dishes)) next = parsed;
        } catch { /* An invalid local draft does not affect confirmed records. */ }
      }
      setDraft(next); setLoadedKey(key);
    }).catch(e => { if (current) { setError(`草稿读取失败：${errorText(e)}`); setDraft(empty()); setLoadedKey(key); } });
    return () => { current = false; };
  }, [api.ready, api.request, key]);
  useEffect(() => {
    if (loadedKey !== key) return;
    const payload = JSON.stringify(draft);
    writes.current = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(key, payload)).catch(e => setError(`草稿暂未保存到手机：${errorText(e)}`));
  }, [draft, loadedKey, key]);
  function start(date = chinaToday(), record?: MealRecord) {
    setDraft(record ? { recipeIds: record.dishes.map(d => d.recipe_id), people: record.people_count, mealDate: record.meal_date, requestKey: requestKey(), recordId: record.id, revision: record.revision, dishes: record.dishes } : empty(defaultPeople.current, date));
  }
  return <MenuContext.Provider value={{ draft, setDraft, ready: api.ready && loadedKey === key, error, start, resetIfKey: confirmedKey => setDraft(old => old.requestKey === confirmedKey ? empty(defaultPeople.current) : old) }}>{children}</MenuContext.Provider>;
}
export function useMenu() { const value = useContext(MenuContext); if (!value) throw new Error('MenuProvider missing'); return value; }
