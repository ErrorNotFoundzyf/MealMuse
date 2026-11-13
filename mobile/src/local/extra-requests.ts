type Extra='dessert'|'fruit';
const labels:Record<Extra,string>={dessert:'甜点|甜品',fruit:'水果|果盘'};
const numbers:Record<string,number>={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};

/** Explicit additions override uncertain model interpretation. */
export function extraAdditions(messages:string[]):{add:Partial<Record<Extra,number>>;cancelled:Extra[]} {
  const add:Partial<Record<Extra,number>>={},cancelled=new Set<Extra>();
  for(const message of messages)for(const category of ['dessert','fruit'] as const)for(const clause of message.split(/[，,。；;！!\n]/)){
    const label=labels[category];
    if(!new RegExp(label).test(clause))continue;
    if(new RegExp(`(?:不要|不加|不用|别加|不需要|不想吃|不想要|不吃).{0,6}(?:${label})`).test(clause)){delete add[category];cancelled.add(category);continue;}
    if(new RegExp(`(?:换成|换为|替换成|换作).{0,6}(?:${label})`).test(clause))continue;
    const match=new RegExp(`(?:添加|增加|加|来|推荐|想吃|想要|要|和|再)(?:上|点|一些)?\\s*(\\d+|[一二两三四五六七八九十])?\\s*(?:个|份|道|盘|碗|款)?\\s*(?:${label})`).exec(clause);
    if(match){const value=match[1];add[category]=value ? (/^\d+$/.test(value)?Number(value):numbers[value]??1) : 1;cancelled.delete(category);}
  }
  return {add,cancelled:[...cancelled]};
}
