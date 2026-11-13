import { useState } from 'react';
import { Alert,Text,View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Button,Notice,s } from '../ui';
import { pickLocalBackup,restoreWithSafetyCopy,saveLocalBackup } from './backup-files';

export function LocalBackupSettings({db,onRestored}:{db:SQLiteDatabase;onRestored:()=>void|Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function share(){
    setBusy(true);setError('');setMessage('');
    try{await saveLocalBackup(db);setMessage('备份已保存到你选择的文件夹，并通过校验；不包含 AI 密钥。');}catch(e){setError(e instanceof Error?e.message:'备份失败');}finally{setBusy(false);}
  }
  async function select(){
    setBusy(true);setError('');setMessage('');
    try{
      const backup=await pickLocalBackup();if(!backup)return;
      const ingredientCount=backup.tables.ingredients?.length||0,recipeCount=backup.tables.recipes?.length||0,mealCount=backup.tables.meal_records?.length||0;
      Alert.alert('恢复这份备份？',`备份含 ${ingredientCount} 种食材、${recipeCount} 道菜谱和 ${mealCount} 条食记。恢复会替换本机数据，当前数据会先在本机留一份安全副本。请确保你已另行导出当前备份。`,[
        {text:'取消',style:'cancel'},
        {text:'确认恢复',style:'destructive',onPress:()=>{void restore(backup);}},
      ]);
    }catch(e){setError(e instanceof Error?e.message:'读取备份失败');}finally{setBusy(false);}
  }
  async function restore(backup:NonNullable<Awaited<ReturnType<typeof pickLocalBackup>>>){
    setBusy(true);setError('');setMessage('');
    try{await restoreWithSafetyCopy(db,backup);await onRestored();setMessage('备份已恢复，本机 AI 密钥保持不变。');}catch(e){setError(e instanceof Error?e.message:'恢复失败，请检查数据');}finally{setBusy(false);}
  }
  return <View style={s.card}><Text style={s.section}>数据备份</Text><Text style={s.caption}>备份食材、菜谱、家庭设置和食记。请保存到云盘或另一台设备；卸载 App 前务必导出。AI 密钥不会被备份。</Text>
    {!!error&&<Notice text={error} error />}{!!message&&<Notice text={message} />}
    <Button label="导出备份" secondary disabled={busy} onPress={share} /><Button label="导入备份" secondary disabled={busy} onPress={select} />
  </View>;
}
