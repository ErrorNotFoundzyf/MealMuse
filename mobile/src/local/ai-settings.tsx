import { useEffect,useState } from 'react';
import { Alert,Text,View } from 'react-native';
import { Button,Field,Notice,s } from '../ui';
import { clearDeepSeekKey,getDeepSeekKey,hasDeepSeekKey,saveDeepSeekKey } from './ai-credentials';
import { testDeepSeekConnection } from './deepseek';

/** Used by the local-only app once migration is enabled; never show a stored key. */
export function LocalAiSettings() {
  const [configured,setConfigured]=useState(false),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(()=>{hasDeepSeekKey().then(setConfigured).catch(()=>setError('无法读取本机 AI 设置'));},[]);
  async function save(){
    setBusy(true);setError('');setMessage('');
    try{await saveDeepSeekKey(input);setInput('');setConfigured(true);setMessage('密钥已保存在本机。');}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
  }
  async function test(){
    setBusy(true);setError('');setMessage('');
    try{const key=await getDeepSeekKey();if(!key)throw new Error('请先保存 DeepSeek 密钥');await testDeepSeekConnection(key);setMessage('DeepSeek 连接成功。');}catch(e){setError(e instanceof Error?e.message:'连接失败');}finally{setBusy(false);}
  }
  async function clear(){
    setBusy(true);setError('');setMessage('');
    try{await clearDeepSeekKey();setConfigured(false);setInput('');setMessage('本机密钥已清除。');}catch{setError('清除失败，请重试');}finally{setBusy(false);}
  }
  return <View style={s.card}><Text style={s.section}>AI 设置</Text><Text style={s.caption}>密钥仅保存在本机，不随备份导出；使用 AI 对话会产生 DeepSeek API 费用。</Text>
    <Text style={s.body}>{configured?'已配置密钥':'尚未配置密钥'}</Text>
    <Field label={configured?'更换密钥':'DeepSeek API 密钥'} value={input} onChange={setInput} secret placeholder="在此输入 API 密钥" />
    {!!error&&<Notice text={error} error />}{!!message&&<Notice text={message} />}
    <Button label={configured?'保存新密钥':'保存密钥'} disabled={busy||!input.trim()} busy={busy} onPress={save} />
    {configured&&<><Button label="测试连接" secondary disabled={busy} onPress={test} /><Button label="清除本机密钥" secondary disabled={busy} onPress={()=>Alert.alert('清除本机密钥？','清除后仍可使用本地功能，AI 对话需要重新配置。',[{text:'取消'},{text:'清除',style:'destructive',onPress:()=>{void clear();}}])} /></>}
  </View>;
}
