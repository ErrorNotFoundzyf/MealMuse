type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function testDeepSeekConnection(key:string, fetcher:typeof fetch=fetch):Promise<void> {
  if (!key.trim()) throw new Error('请先填写 DeepSeek 密钥');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetcher('https://api.deepseek.com/models',{headers:{Authorization:`Bearer ${key.trim()}`},signal:controller.signal});
    if(response.status===401||response.status===403)throw new Error('DeepSeek 密钥无效，请检查后重试');
    if(!response.ok)throw new Error('DeepSeek 暂时无法连接，请稍后重试');
  } catch(error) {
    if(controller.signal.aborted || error instanceof Error && error.name==='AbortError')throw new Error('连接超时，请检查网络');
    if(error instanceof TypeError)throw new Error('连接不到 DeepSeek，请检查网络');
    throw error;
  } finally {clearTimeout(timer);}
}

/** The model response is untrusted and must be checked against local menu rules. */
export async function askDeepSeekJson(
  key: string,
  messages: ChatMessage[],
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<unknown> {
  if (!key.trim()) throw new Error('请先在 AI 设置中填写 DeepSeek 密钥');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 38000);
  try {
    const response = await (options.fetcher ?? fetch)('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
      body: JSON.stringify({ model: 'deepseek-flash', messages, stream: false, thinking: { type: 'disabled' }, temperature: 0.3, response_format: { type: 'json_object' }, max_tokens: 3000 }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('DeepSeek 密钥无效，请检查 AI 设置');
      if (response.status === 402) throw new Error('DeepSeek 余额不足，请检查账户');
      if (response.status === 429) throw new Error('DeepSeek 请求较多，请稍后重试');
      throw new Error('DeepSeek 暂时不可用，请稍后重试');
    }
    const result = await response.json();
    const choice = result?.choices?.[0];
    const content = choice?.message?.content;
    if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || !content.trim()) throw new Error('AI 返回内容不完整，请重试');
    try { return JSON.parse(content); } catch { throw new Error('AI 返回内容格式不正确，请重试'); }
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new Error('连接 DeepSeek 超时，请检查网络后重试');
    if (error instanceof TypeError) throw new Error('连接不到 DeepSeek，请检查网络后重试');
    throw error;
  } finally { clearTimeout(timer); }
}
