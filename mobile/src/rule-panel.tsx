import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { errorText, useApi, useResource } from './api';
import { requestKey, useMenu } from './menu-draft';
import { FilterSheet, l } from './library-ui';
import { Button, colors, Notice, s, Stepper } from './ui';
import { RecipeTags } from './tags';
import { orderMenuDishes } from './menu-order';
import { MealDiscovery } from './meal-discovery';
import type { PlanningSettings, Profile, RulePlan } from './types';

export function RulePanel({ onManual }: { onManual: () => void }) {
  const api=useApi(),menu=useMenu(),profile=useResource<{profile:Profile|null}>('/profile');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[info,setInfo]=useState('');
  const [sheet,setSheet]=useState(false),[collapsed,setCollapsed]=useState(false),[discovery,setDiscovery]=useState<'random'|'pantry'>();
  const [editing,setEditing]=useState<PlanningSettings>({people_count:4,category_counts:{meat:2,vegetable:1,soup:1},allow_nonseasonal:false});
  const latest=useRef(menu.draft);latest.current=menu.draft;const inFlight=useRef(false),plan=menu.draft.rulePlan;
  const effective:PlanningSettings=menu.draft.planning??(plan?{people_count:plan.people_count,category_counts:plan.category_counts,allow_nonseasonal:plan.allow_nonseasonal}:{people_count:profile.data?.profile?.people_count??menu.draft.people,category_counts:profile.data?.profile?.category_counts??{meat:2,vegetable:1,soup:1},allow_nonseasonal:false});
  const dishes=orderMenuDishes(menu.draft.dishes),total=Object.values(editing.category_counts).reduce((n,v)=>n+v,0);
  async function run(action:'new'|'complete'|'replace'|'regenerate',planning=effective,recipeId?:string,settingsChange=false){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setInfo('');const before=menu.draft;
    const isSwap=action==='replace'||action==='regenerate';
    const selected=action==='complete'?before.recipeIds:settingsChange?before.dishes.filter(d=>['fruit','dessert'].includes(d.category_id)).map(d=>d.recipe_id):[];
    const body=isSwap?{...planning,action,selected_recipe_ids:before.recipeIds,...(recipeId?{recipe_id:recipeId}:{})}:{...planning,selected_recipe_ids:selected};
    try{
      const result=await api.request<RulePlan>(isSwap?'/recommendations/manual-swap':'/recommendations',{method:'POST',body:JSON.stringify({...body,request_key:requestKey()})});
      if(latest.current.requestKey!==before.requestKey){setError('选菜已发生变化，本次结果未覆盖菜单。');return;}
      menu.setDraft(old=>old.requestKey!==before.requestKey?old:{people:result.people_count,mealDate:result.as_of_date,recipeIds:result.dishes.map(d=>d.recipe_id),dishes:result.dishes,requestKey:requestKey(),rulePlan:result,planning:{...planning,category_counts:{...planning.category_counts}}});
      setInfo(action==='replace'?'已换好一道，其他菜保留。':action==='complete'?'已保留选菜并补齐菜单。':'菜单搭配好了，可以继续调整。');
    }catch(e){setError(`${errorText(e)}${before.dishes.length?' 当前菜单已保留。':''}`);}finally{inFlight.current=false;setBusy(false);}
  }
  function openSettings(){setEditing({...effective,category_counts:{...effective.category_counts}});setSheet(true);}
  function applySettings(){if(total<1||total>20||busy)return;setSheet(false);if(JSON.stringify(editing)===JSON.stringify(effective))return;if(dishes.length)void run('new',editing,undefined,true);else menu.setDraft(old=>({...old,planning:editing,people:editing.people_count,requestKey:requestKey()}));}
  function remove(recipeId:string){if(busy)return;menu.setDraft(old=>({...old,manualAdjustment:true,outgoing:undefined,requestKey:requestKey(),recipeIds:old.recipeIds.filter(id=>id!==recipeId),dishes:old.dishes.filter(d=>d.recipe_id!==recipeId)}));setError('');setInfo('已从本餐移除，菜谱库仍保留这道菜。');}
  function clear(){Alert.alert('清空本餐？','清空当前选菜，保留人数与菜数；已保存的食记不会改变。',[{text:'取消',style:'cancel'},{text:'清空',style:'destructive',onPress:()=>{menu.setDraft(old=>({...old,people:effective.people_count,planning:effective,rulePlan:undefined,manualAdjustment:false,outgoing:undefined,recipeIds:[],dishes:[],recordId:undefined,revision:undefined,requestKey:requestKey()}));setError('');setInfo('');}}]);}
  const incomplete=dishes.length>0&&['meat','vegetable','soup'].some(c=>dishes.filter(d=>d.category_id===c).length<(effective.category_counts[c]||0));
  return <View style={{flex:1}}><ScrollView contentContainerStyle={{gap:12,paddingBottom:20}} keyboardShouldPersistTaps="handled">
    <View style={s.between}><Text style={[l.detail,{flex:1}]}>本次{effective.people_count}人 · {effective.category_counts.meat||0}荤{effective.category_counts.vegetable||0}素{effective.category_counts.soup||0}汤</Text><Pressable accessibilityRole="button" disabled={busy} onPress={openSettings} style={{minHeight:40,paddingHorizontal:12,borderRadius:10,backgroundColor:colors.pale,justifyContent:'center'}}><Text style={{color:colors.green,fontWeight:'700'}}>人数与菜数</Text></Pressable></View>
    {!!error&&<Notice text={error} error/>}{profile.error&&<Notice text={profile.error} error onRetry={profile.reload}/>}
    {(!dishes.length||incomplete)&&<Button label={dishes.length?'保留已选，补齐菜单':'帮我搭一桌'} busy={busy} disabled={profile.loading} onPress={()=>run(dishes.length?'complete':'new')}/>}
    <View style={s.row}><View style={{flex:1}}><Button label="脑洞一道菜" secondary disabled={busy} onPress={()=>setDiscovery('random')}/></View><View style={{flex:1}}><Button label="家里有啥" secondary disabled={busy} onPress={()=>setDiscovery('pantry')}/></View></View>
    {!!dishes.length?<View style={[s.card,{gap:0,paddingHorizontal:10,paddingVertical:4,borderRadius:16}]}>
      <View style={s.between}><Text style={[s.section,{fontSize:16,flex:1}]}>本餐菜单</Text><Pressable accessibilityRole="button" disabled={busy} onPress={clear} style={{minWidth:52,minHeight:36,borderWidth:1,borderColor:colors.line,borderRadius:8,alignItems:'center',justifyContent:'center'}}><Text style={l.detail}>清空</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={collapsed?'展开本餐菜单':'收起本餐菜单'} style={l.iconButton} onPress={()=>setCollapsed(v=>!v)}><Text style={{color:colors.green}}>{collapsed?'⌄':'⌃'}</Text></Pressable></View>
      {!collapsed&&<>{dishes.map((dish,index)=><View key={dish.recipe_id} style={{borderBottomWidth:1,borderColor:colors.line,paddingVertical:4}}><View style={{flexDirection:'row',alignItems:'center',gap:6,minHeight:44}}><Text style={{width:20,textAlign:'center',color:colors.muted,fontSize:13}}>{index+1}</Text><View style={{flex:1,flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:5}}><Text style={{fontSize:15,fontWeight:'600',color:colors.ink,lineHeight:21}}>{dish.name}</Text><RecipeTags recipe={dish} small/></View><Pressable accessibilityRole="button" accessibilityLabel={`换掉${dish.name}`} disabled={busy} onPress={()=>run('replace',effective,dish.recipe_id)} style={{minWidth:56,minHeight:44,justifyContent:'center',alignItems:'center',opacity:busy?0.4:1}}><Text style={{fontSize:13,color:colors.green}}>换一道</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`删除${dish.name}`} disabled={busy} onPress={()=>remove(dish.recipe_id)} style={{minWidth:44,minHeight:44,justifyContent:'center',alignItems:'center',opacity:busy?0.4:1}}><Text style={{fontSize:13,color:colors.muted}}>删除</Text></Pressable></View>{!!dish.season_warnings?.length&&<Text style={s.caption}>{dish.season_warnings.join('、')}</Text>}</View>)}
      <Pressable accessibilityRole="button" disabled={busy} onPress={onManual} style={{minHeight:44,justifyContent:'center',alignItems:'center'}}><Text style={{color:colors.green}}>＋ 加菜</Text></Pressable>
      <View style={[s.row,{paddingVertical:6}]}>{[{label:'换整桌',primary:false,fn:()=>run('regenerate')},{label:'自己调整',primary:false,fn:onManual},{label:'确认菜单',primary:true,fn:()=>router.push('/menu')}].map(a=><Pressable key={a.label} accessibilityRole="button" disabled={busy} onPress={a.fn} style={{flex:1,minHeight:40,borderRadius:10,backgroundColor:a.primary?colors.green:colors.pale,alignItems:'center',justifyContent:'center',opacity:busy?0.4:1}}><Text style={{color:a.primary?'#fff':colors.green,fontSize:13,fontWeight:'700'}}>{a.label}</Text></Pressable>)}</View></>}
    </View>:<Text style={s.caption}>按人数和菜数，搭配今天这一餐。也可以自己挑选喜欢的菜。</Text>}
    {!!info&&<Text accessibilityLiveRegion="polite" style={[s.caption,{color:colors.green}]}>{info}</Text>}
    <Text style={s.caption}>按本次设置搭配，确认后记入食记。自动推荐避开今天及前三天已确认的菜。</Text>
  </ScrollView>
  {discovery&&<MealDiscovery kind={discovery} planning={effective} onClose={()=>setDiscovery(undefined)}/>}
  <FilterSheet visible={sheet} title="本次人数与菜数" onClose={()=>setSheet(false)} onApply={applySettings} applyDisabled={total<1||total>20||busy} resetLabel="家庭默认" onReset={()=>setEditing({people_count:profile.data?.profile?.people_count??4,category_counts:{...(profile.data?.profile?.category_counts??{meat:2,vegetable:1,soup:1})},allow_nonseasonal:false})}>
    <Stepper label="用餐人数" min={1} max={30} value={editing.people_count} onChange={v=>setEditing(old=>({...old,people_count:v}))}/>
    {[{id:'meat',name:'荤菜'},{id:'vegetable',name:'素菜'},{id:'soup',name:'汤'}].map(c=><Stepper key={c.id} label={c.name} value={editing.category_counts[c.id]||0} onChange={v=>setEditing(old=>({...old,category_counts:{...old.category_counts,[c.id]:v}}))}/>)}
    <Text style={s.caption}>本次共{total}道菜（1—20道）。已有菜单时，保存新设置会重新搭配；甜点和水果保留。</Text>
    <View style={s.between}><Text style={[s.body,{flex:1}]}>允许非当季及季节未设置食材</Text><Switch accessibilityLabel="允许非当季及季节未设置食材" value={editing.allow_nonseasonal} onValueChange={v=>setEditing(old=>({...old,allow_nonseasonal:v}))}/></View><Text style={s.caption}>默认仅用当季与全年食材；开启后仍排除今天及前三天已确认的菜。</Text>
  </FilterSheet></View>;
}
