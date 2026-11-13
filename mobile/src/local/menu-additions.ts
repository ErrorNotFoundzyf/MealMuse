export type AdditionCategory='meat'|'vegetable'|'soup'|'hearty'|'dessert'|'fruit';
const categories:Record<string,AdditionCategory>={'荤菜':'meat','素菜':'vegetable','汤':'soup','硬菜':'hearty','甜点':'dessert','甜品':'dessert','水果':'fruit','果盘':'fruit'};
const numbers:Record<string,number>={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};

/** A category addition is a delta, never a replacement or a total menu count. */
export function parseMenuAdditions(message:string):{counts:Partial<Record<AdditionCategory,number>>;standalone:boolean} {
  const counts:Partial<Record<AdditionCategory,number>>={};
  const command=/(?:再来|添加|增加|加上|再加|加|来)(?:上|点|一些)?\s*(\d+|[一二两三四五六七八九十])?\s*(?:个|份|道|盘|碗|款)?\s*(荤菜|素菜|硬菜|甜点|甜品|水果|果盘|汤)/g;
  let remaining=message;
  for(const clause of message.split(/[，,。；;！!\n]/)){
    if(/不要|不加|不用|别加|不需要|不想|换成|换为|替换/.test(clause))continue;
    for(const match of clause.matchAll(command)){
      const category=categories[match[2]!]!,amount=match[1]?numbers[match[1]]??Number(match[1]):1;
      if(!Number.isInteger(amount)||amount<1||amount>20)throw new Error('每次请增加1到20份菜品');
      counts[category]=(counts[category]||0)+amount;remaining=remaining.replace(match[0],'');
    }
  }
  remaining=remaining.replace(/(?:变成|共|总共)\s*(?:\d+|[一二两三四五六七八九十])\s*道菜/g,'').replace(/其他(?:的菜)?(?:保持)?不变|其他保留|保留其他菜|请|帮我|再|也|我|再给我|给我|一下|[,，。；;！!\s]/g,'');
  return {counts,standalone:Object.keys(counts).length>0&&!remaining};
}
