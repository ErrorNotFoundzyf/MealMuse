import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SQLiteDatabase } from 'expo-sqlite';
import { ApiContext } from '../api';
import { Button, Page, s } from '../ui';
import { openLocalDatabase } from './database';
import { installInitialCatalog,applySeasonCorrections } from './catalog-seed';
import { createLocalApi } from './local-api';
import seed from '../../assets/catalog-seed.json';
import seasonCorrections from '../../assets/season-corrections-20261108.json';

const DatabaseContext=createContext<{db:SQLiteDatabase;restored:()=>Promise<void>}|null>(null);
export const useLocalDatabase=()=>useContext(DatabaseContext);

export function LocalApiProvider({children}:React.PropsWithChildren) {
  const [db,setDb]=useState<SQLiteDatabase|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[revision,setRevision]=useState(0),[generation,setGeneration]=useState('initial');
  useEffect(()=>{let active=true;setError('');(async()=>{const database=await openLocalDatabase();await installInitialCatalog(database,seed);await applySeasonCorrections(database,seasonCorrections);const savedGeneration=await AsyncStorage.getItem('local-draft-generation');if(active){setGeneration(savedGeneration||'initial');setDb(database);}})().catch(e=>{if(active)setError(e instanceof Error?e.message:'本地数据打开失败');});return()=>{active=false;};},[attempt]);
  const changed=useCallback(()=>setRevision(n=>n+1),[]);
  const restored=useCallback(async()=>{const next=Crypto.randomUUID();await AsyncStorage.setItem('local-draft-generation',next);setGeneration(next);changed();},[changed]);
  const localRequest=useMemo(()=>db?createLocalApi(db,()=>Crypto.randomUUID()):null,[db]);
  const request=useCallback(async<T,>(path:string,options:RequestInit={}):Promise<T>=>{if(!localRequest)throw new Error('本地数据正在准备');return localRequest<T>(path,options);},[localRequest]);
  const noConnection=useCallback(async()=>{throw new Error('本地模式无需家庭服务');},[]);
  const value=useMemo(()=>({ready:!!db,baseUrl:`local://phone/${generation}`,hasToken:false,revision,authState:'legacy' as const,username:'',login:noConnection,logout:async()=>{},retryAuth:()=>{},saveConnection:noConnection,request,changed}),[db,generation,revision,noConnection,request,changed]);
  if(error)return <Page title="本地数据暂时无法打开"><View style={s.card}><Text style={s.body}>{error}</Text><Button label="重试" onPress={()=>setAttempt(n=>n+1)} /></View></Page>;
  return <ApiContext.Provider value={value}>{db?<DatabaseContext.Provider value={{db,restored}}>{children}</DatabaseContext.Provider>:children}</ApiContext.Provider>;
}
