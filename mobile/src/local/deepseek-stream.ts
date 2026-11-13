type StreamOptions={signal?:AbortSignal;timeoutMs?:number;createRequest?:()=>XMLHttpRequest};

/** Decode SSE frames across arbitrary UTF-16 chunk and newline boundaries. */
export function createSseDecoder(onEvent:(data:string)=>void) {
  let pending='';
  function consume(final:boolean){
    // Normalize only complete CRLF pairs; leave a trailing CR for the next chunk.
    pending=pending.replace(/\r\n/g,'\n');
    let end:number;
    while((end=pending.indexOf('\n\n'))>=0){
      const frame=pending.slice(0,end);pending=pending.slice(end+2);
      const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,''));
      if(data.length)onEvent(data.join('\n'));
    }
    if(final&&pending.trim())throw new Error('AI 回复连接中断，请重试说明');
  }
  return {push(chunk:string){pending+=chunk;consume(false);},finish(){consume(true);}};
}

/** React Native Android XHR supports incremental responseText via onprogress. */
export function streamDeepSeekExplanation(key:string,menu:{name:string;category_name:string}[],onText:(text:string)=>void,options:StreamOptions={}):Promise<string> {
  if(!key.trim())return Promise.reject(new Error('请先配置 DeepSeek 密钥'));
  if(!menu.length)return Promise.reject(new Error('当前没有可说明的菜单'));
  return new Promise((resolve,reject)=>{
    const xhr=(options.createRequest??(()=>new XMLHttpRequest()))();let offset=0,text='',done=false,finishReason='',settled=false;
    const cleanup=()=>{options.signal?.removeEventListener('abort',abort);};
    const fail=(error:Error)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const abort=()=>{xhr.abort();fail(new Error('说明已中断，可以重试'));};
    const decoder=createSseDecoder(data=>{
      if(data==='[DONE]'){done=true;return;}
      let chunk:any;try{chunk=JSON.parse(data);}catch{throw new Error('AI 回复格式异常，请重试说明');}
      if(chunk.error)throw new Error('AI 说明暂时不可用，请重试');
      const choice=chunk.choices?.[0];if(!choice)return;
      if(typeof choice.finish_reason==='string')finishReason=choice.finish_reason;
      const content=choice.delta?.content;
      if(typeof content==='string'&&content){text+=content;if(text.length>1500)throw new Error('AI 说明过长，请重试');onText(text);}
    });
    const read=()=>{const value=xhr.responseText||'';if(value.length>offset){decoder.push(value.slice(offset));offset=value.length;}};
    xhr.open('POST','https://api.deepseek.com/chat/completions',true);
    xhr.setRequestHeader('Content-Type','application/json');xhr.setRequestHeader('Authorization',`Bearer ${key.trim()}`);
    xhr.timeout=options.timeoutMs??45000;
    xhr.onprogress=()=>{try{read();}catch(e){fail(e instanceof Error?e:new Error('AI 回复异常'));xhr.abort();}};
    xhr.onload=()=>{try{if(xhr.status<200||xhr.status>=300)throw new Error(xhr.status===401||xhr.status===403?'DeepSeek 密钥无效，请检查 AI 设置':'AI 说明暂时不可用，请重试');read();decoder.finish();if(!done||finishReason!=='stop'||!text.trim())throw new Error('AI 说明未完整接收，请重试');if(!settled){settled=true;cleanup();resolve(text);}}catch(e){fail(e instanceof Error?e:new Error('AI 回复异常'));}};
    xhr.onerror=()=>fail(new Error('连接 DeepSeek 失败，请检查网络后重试'));
    xhr.ontimeout=()=>fail(new Error('AI 说明超时，请重试'));
    xhr.onabort=()=>fail(new Error('说明已中断，可以重试'));
    if(options.signal?.aborted){abort();return;}options.signal?.addEventListener('abort',abort,{once:true});
    xhr.send(JSON.stringify({model:'deepseek-flash',stream:true,thinking:{type:'disabled'},temperature:0.3,max_tokens:240,messages:[{role:'system',content:'你是家庭饮食助手。菜单已确定并经程序校验。请用两三句自然中文简短介绍这份菜单，只能提及给定菜名和分类；不要改变、增加或推断菜品、配料、烹饪方式，不要作健康功效或过敏安全保证，不要提及代码、字段或内部规则。'},{role:'user',content:JSON.stringify({menu})}]}));
  });
}
