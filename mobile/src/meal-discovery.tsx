import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorText, useApi, useResource } from './api';
import { requestKey, useMenu } from './menu-draft';
import { CategoryTabs, SearchBox, l } from './library-ui';
import { Button, Chip, colors, Loading, Notice, s } from './ui';
import { RecipeTags } from './tags';
import type { Ingredient, MealDish, Page, PlanningSettings } from './types';
import type { PantryMatch } from './local/discovery';

export function MealDiscovery({ kind, planning, onClose }: { kind:'random'|'pantry'; planning:PlanningSettings; onClose:()=>void }) {
  const api=useApi(),menu=useMenu();
  const [category,setCategory]=useState(''),[query,setQuery]=useState(''),[debounced,setDebounced]=useState('');
  const [chosen,setChosen]=useState<Ingredient[]>([]),[loaded,setLoaded]=useState(false);
  const [random,setRandom]=useState<MealDish>(),[matches,setMatches]=useState<{ready:PantryMatch[];missingOne:PantryMatch[]}>();
  const [tab,setTab]=useState('ready'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[info,setInfo]=useState('');
  const [details,setDetails]=useState(false);const alive=useRef(true),seq=useRef(0);
  const ingredients=useResource<Page<Ingredient>>(`/ingredients?limit=100&q=${encodeURIComponent(debounced)}`);
  useEffect(()=>{const timer=setTimeout(()=>setDebounced(query.trim()),200);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;seq.current++;};},[]);
  useEffect(()=>{if(kind!=='pantry')return;let active=true;(async()=>{
    const stored=JSON.parse(await AsyncStorage.getItem('pantry-ingredient-ids-v1')||'[]');
    const ids=Array.isArray(stored)?stored.filter((id:unknown)=>typeof id==='string').slice(0,100):[];
    const values=await Promise.all(ids.map((id:string)=>api.request<Ingredient>(`/ingredients/${encodeURIComponent(id)}`).catch(()=>null)));
    if(active)setChosen(values.filter((i):i is Ingredient=>!!i&&!i.is_hidden));
  })().catch(()=>{if(active)setInfo('上次食材选择未能读取，请重新选择。');}).finally(()=>{if(active)setLoaded(true);});return()=>{active=false;};},[kind,api.request]);
  useEffect(()=>{if(kind==='pantry'&&loaded)AsyncStorage.setItem('pantry-ingredient-ids-v1',JSON.stringify(chosen.map(i=>i.id))).catch(()=>setInfo('本次食材选择暂未保存，下次可能需要重新选择。'));},[chosen,loaded,kind]);
  async function searchRandom(previous?:string) {
    const turn=++seq.current;setBusy(true);setError('');setRandom(undefined);setDetails(false);
    try{const dish=await api.request<MealDish>('/recommendations/discover',{method:'POST',body:JSON.stringify({category_id:category,previous_id:previous,selected_recipe_ids:menu.draft.recipeIds,allow_nonseasonal:planning.allow_nonseasonal})});if(alive.current&&seq.current===turn)setRandom(dish);}
    catch(e){if(alive.current&&seq.current===turn)setError(errorText(e));}finally{if(alive.current&&seq.current===turn)setBusy(false);}
  }
  useEffect(()=>{if(kind==='random')void searchRandom();},[kind,category]);
  function toggle(item:Ingredient){if(busy||!loaded)return;setMatches(undefined);setChosen(old=>old.some(i=>i.id===item.id)?old.filter(i=>i.id!==item.id):old.length<100?[...old,item]:old);}
  async function match(){if(busy)return;setBusy(true);setError('');setMatches(undefined);try{const value=await api.request<{ready:PantryMatch[];missingOne:PantryMatch[]}>('/recommendations/pantry',{method:'POST',body:JSON.stringify({ingredient_ids:chosen.map(i=>i.id),selected_recipe_ids:menu.draft.recipeIds,allow_nonseasonal:planning.allow_nonseasonal})});if(alive.current){setMatches(value);setTab(value.ready.length?'ready':'missingOne');}}catch(e){if(alive.current)setError(errorText(e));}finally{if(alive.current)setBusy(false);}}
  function add(dish:MealDish){if(menu.draft.recipeIds.includes(dish.recipe_id))return;if(menu.draft.recipeIds.length>=20){Alert.alert('本餐最多20道菜');return;}
    menu.setDraft(old=>old.recipeIds.includes(dish.recipe_id)||old.recipeIds.length>=20?old:{...old,planning,people:planning.people_count,manualAdjustment:true,outgoing:undefined,requestKey:requestKey(),recipeIds:[...old.recipeIds,dish.recipe_id],dishes:[...old.dishes,dish]});setInfo(`已加入：${dish.name}`);
  }
  const list=matches?(tab==='ready'?matches.ready:matches.missingOne):[];
  return <Modal visible animationType="slide" transparent onRequestClose={onClose}><View style={l.overlay}><Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} style={{position:'absolute',top:0,bottom:0,left:0,right:0}}/><SafeAreaView edges={['bottom','left','right']} style={[l.sheet,{height:kind==='pantry'?'92%':undefined,maxHeight:'92%',gap:10}]}>
    <View style={s.between}><Text style={s.section}>{kind==='random'?'脑洞一道菜':'家里有啥'}</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} style={l.iconButton}><Text style={s.body}>✕</Text></Pressable></View>
    <Text style={s.caption}>{kind==='random'?'从菜谱库，随机发现一道菜':'选出家里有的食材，看看能做什么'}</Text>
    <Text style={[s.caption,{fontSize:12}]}>遵循本次季节设置，避开今天及前三天已确认的菜。</Text>
    {!!error&&<Notice text={error} error/>}{!!info&&<Text accessibilityLiveRegion="polite" style={[s.caption,{color:colors.green}]}>{info}</Text>}
    {kind==='random'?<>
      <CategoryTabs selected={category} onSelect={v=>{if(!busy)setCategory(v);}} options={[{value:'',label:'不限'},{value:'meat',label:'荤菜'},{value:'vegetable',label:'素菜'},{value:'soup',label:'汤'},{value:'dessert',label:'甜点'},{value:'fruit',label:'水果'}]}/>
      <ScrollView contentContainerStyle={{gap:12,paddingVertical:8}}>
        {busy&&<Loading/>}{random&&<View style={[s.card,{gap:12}]}><Text style={s.caption}>今天试试这道？</Text><Text style={s.section}>{random.name}</Text><RecipeTags recipe={random}/><Text style={s.body}>主要食材</Text><Text style={s.caption}>{random.ingredients.filter(i=>i.is_main).map(i=>i.name).join(' · ')}</Text><Text style={s.caption}>换个搭配，给今天添点新鲜感。</Text><Pressable accessibilityRole="button" onPress={()=>setDetails(v=>!v)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:colors.green}}>{details?'收起菜谱':'查看菜谱 ›'}</Text></Pressable>{details&&<><Text style={s.body}>{random.steps||'这道菜暂未填写做法。'}</Text>{!!random.notes&&<Text style={s.caption}>{random.notes}</Text>}</>}</View>}
      </ScrollView><View style={s.row}><View style={{flex:1}}><Button label="再来一道" secondary busy={busy} onPress={()=>searchRandom(random?.recipe_id)}/></View><View style={{flex:1}}><Button label={random&&menu.draft.recipeIds.includes(random.recipe_id)?'已加入':'加入本餐'} disabled={!random||busy||!!random&&menu.draft.recipeIds.includes(random.recipe_id)} onPress={()=>random&&add(random)}/></View></View>
    </>:<>
      <SearchBox value={query} onChange={setQuery} placeholder="搜索食材，例如番茄、鸡蛋"/>
      {!loaded?<Loading/>:<ScrollView horizontal style={{maxHeight:58,flexGrow:0}} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:6}}>{chosen.length?chosen.map(i=><Chip key={i.id} label={`${i.name} ×`} selected onPress={()=>toggle(i)}/>):<Text style={s.caption}>还未选择食材</Text>}</ScrollView>}
      {ingredients.error?<Notice text={ingredients.error} error onRetry={ingredients.reload}/>:ingredients.loading?<Loading/>:<ScrollView horizontal style={{maxHeight:58,flexGrow:0}} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:6}}>{(ingredients.data?.items||[]).map(i=><Chip key={i.id} label={i.name} selected={chosen.some(c=>c.id===i.id)} onPress={()=>toggle(i)}/>)}{!ingredients.data?.items.length&&<Text style={s.caption}>没有找到食材，请换个名称或在食材库中维护。</Text>}</ScrollView>}
      <Button label="看看能做什么" busy={busy} disabled={!chosen.length||!loaded} onPress={match}/><Text style={[s.caption,{fontSize:12}]}>按主要食材匹配，请自行核对调料。</Text>
      {matches&&<CategoryTabs selected={tab} onSelect={setTab} options={[{value:'ready',label:`可直接做（${matches.ready.length}）`},{value:'missingOne',label:`还差一样（${matches.missingOne.length}）`}]}/>}
      <ScrollView style={{flex:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={{gap:8,paddingBottom:8}}>{list.map(({dish,missing})=><View key={dish.recipe_id} style={l.card}><View style={{flex:1,gap:4}}><Text style={[l.name,{fontSize:16}]}>{dish.name}</Text><Text style={l.detail}>{missing.length?`缺：${missing.join('、')}`:dish.ingredients.filter(i=>i.is_main).map(i=>i.name).join(' · ')}</Text><RecipeTags recipe={dish} small/></View><Pressable accessibilityRole="button" accessibilityLabel={`加入${dish.name}`} disabled={menu.draft.recipeIds.includes(dish.recipe_id)} onPress={()=>add(dish)} style={{minWidth:56,minHeight:44,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:10}}><Text style={{color:colors.green}}>{menu.draft.recipeIds.includes(dish.recipe_id)?'已加入':'加入'}</Text></Pressable></View>)}{matches&&!list.length&&<Notice text="当前条件下没有匹配的菜谱，可以增加已有食材、切换结果分类或调整季节设置。"/>}</ScrollView>
      <Button label="返回本餐菜单" secondary onPress={onClose}/>
    </>}
  </SafeAreaView></View></Modal>;
}
