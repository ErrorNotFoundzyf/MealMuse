import type { SQLiteDatabase } from 'expo-sqlite';
import { createLocalCatalogApi } from './catalog-api.ts';
import { createLocalMealApi } from './meal-api.ts';
import { createLocalPlanApi } from './plan-api.ts';
import { createLocalShoppingApi } from './shopping-api.ts';
import { createLocalAiApi } from './ai-api.ts';
import { createDiscoveryApi } from './discovery-api.ts';

type AiOptions={ask:(messages:{role:'system'|'user'|'assistant';content:string}[])=>Promise<unknown>;hasKey:()=>Promise<boolean>};

/** Local request router. Not switched on in the existing app until all routes are ready. */
export function createLocalApi(db:SQLiteDatabase,newId:()=>string,aiOptions?:AiOptions) {
  const catalog=createLocalCatalogApi(db,newId),meals=createLocalMealApi(db,newId),plans=createLocalPlanApi(db,newId),shopping=createLocalShoppingApi(db);
  const ai=aiOptions?createLocalAiApi(db,newId,aiOptions.ask,aiOptions.hasKey):undefined;
  const discovery=createDiscoveryApi(db);
  return async<T>(path:string,options:RequestInit={}):Promise<T>=>{
    const pathname=new URL(path,'https://local.invalid').pathname;
    let result:unknown;
    if(pathname==='/shopping-list'&&(options.method||'GET').toUpperCase()==='POST') result=await shopping(JSON.parse(String(options.body||'{}')));
    else if(pathname==='/meal-records'||pathname.startsWith('/meal-records/'))result=await meals(path,options);
    else if(['/recommendations/discover','/recommendations/pantry'].includes(pathname) && options.method?.toUpperCase()==='POST')result=await discovery(pathname,options);
    else if(pathname==='/recommendations'||pathname.startsWith('/recommendations/'))result=await plans(path,options);
    else if(pathname==='/ai/status'||pathname.startsWith('/ai/')){if(!ai)throw new Error('请先配置 AI 设置');result=await ai(path,options);}
    else result=await catalog(path,options);
    return result as T;
  };
}
