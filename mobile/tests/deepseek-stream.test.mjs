import test from 'node:test';
import assert from 'node:assert/strict';
import {createSseDecoder,streamDeepSeekExplanation} from '../src/local/deepseek-stream.ts';

test('SSE decoder handles keep-alives, CRLF splits and multiple events',()=>{
  const events=[];const parser=createSseDecoder(x=>events.push(x));
  for(const part of [': keep-alive\r','\n\r','\ndata: {"a":','1}\r\n\r','\ndata: [DONE]\n\n'])parser.push(part);
  parser.finish();assert.deepEqual(events,['{"a":1}','[DONE]']);
});

class FakeRequest {
  status=200;responseText='';headers={};timeout=0;
  open(method,url){assert.equal(method,'POST');assert.match(url,/deepseek/);}
  setRequestHeader(k,v){this.headers[k]=v;}
  send(body){this.body=JSON.parse(body);queueMicrotask(()=>this.run());}
  abort(){this.onabort?.();}
  run(){for(const part of this.parts){this.responseText+=part;this.onprogress?.();}this.onload?.();}
}
const frame=content=>`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:null}]})}\n\n`;
const stop=`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`;

test('genuine response chunks update UI incrementally and finish only after DONE',async()=>{
  const req=new FakeRequest();req.parts=[frame('这餐'),frame('很丰富。'),stop];const received=[];
  const result=await streamDeepSeekExplanation('test-key',[{name:'番茄蛋汤',category_name:'汤'}],x=>received.push(x),{createRequest:()=>req});
  assert.deepEqual(received,['这餐','这餐很丰富。']);assert.equal(result,'这餐很丰富。');assert.equal(req.body.stream,true);
});

test('interrupted stream keeps partial output but rejects incomplete result',async()=>{
  const req=new FakeRequest();req.parts=[frame('已收到')];const received=[];
  await assert.rejects(()=>streamDeepSeekExplanation('test-key',[{name:'炒菜',category_name:'素菜'}],x=>received.push(x),{createRequest:()=>req}),/未完整接收/);
  assert.deepEqual(received,['已收到']);
});
