import json, sqlite3, sys
from pathlib import Path
from openpyxl import load_workbook

excel=Path(sys.argv[1]); database=Path(sys.argv[2]); baseline=Path(sys.argv[3]); output=Path(sys.argv[4])
wb=load_workbook(excel,read_only=True,data_only=True)
if '食材' not in wb.sheetnames: raise ValueError('缺少食材表')
rows=wb['食材'].values
header=next(rows)
required=['食材名称','季节','食材编号']
if any(header.count(c)!=1 for c in required): raise ValueError('食材表缺少必要表头或表头重复')
name_ix,season_ix,id_ix=(header.index(c) for c in required)
old=json.loads(baseline.read_text(encoding='utf-8'))['tables']['ingredients']
original={x['id']:x for x in old}
mapping={'春季':'spring','春':'spring','夏季':'summer','夏':'summer','秋季':'autumn','秋':'autumn','冬季':'winter','冬':'winter','全年':'all_year','四季':'all_year'}
order=['spring','summer','autumn','winter','all_year']
changes=[]; seen=set(); errors=[]
with sqlite3.connect(database) as db:
    current={r[0]:(r[1],json.loads(r[2])) for r in db.execute('SELECT id,name,seasons_json FROM ingredients')}
    for line,row in enumerate(rows,2):
        if not any(v is not None for v in row): continue
        ident=row[id_ix]; name=row[name_ix]; raw=row[season_ix]
        if not isinstance(ident,str) or ident not in original or ident not in current or ident in seen:
            errors.append(f'第{line}行编号缺失、重复或不存在'); continue
        seen.add(ident)
        if name!=original[ident]['name'] or name!=current[ident][0]: errors.append(f'第{line}行名称与编号不一致'); continue
        raw=str(raw).strip() if raw is not None else ''
        parts=[p.strip() for p in raw.replace('，','、').replace(',','、').replace('/','、').split('、') if p.strip()]
        if raw in ('','未设置'): parts=[]
        if any(p not in mapping for p in parts): errors.append(f'第{line}行 {name} 季节无法识别：{raw}'); continue
        values=[mapping[p] for p in parts]
        if len(values)!=len(set(values)) or 'all_year' in values and len(values)>1: errors.append(f'第{line}行 {name} 季节重复或全年与其他季节并存'); continue
        values=sorted(values,key=order.index)
        previous=json.loads(original[ident]['seasons_json'])
        if set(values)!=set(previous):
            live=current[ident][1]
            if set(live)!=set(previous) and set(live)!=set(values): errors.append(f'第{line}行 {name} 数据库季节已变化'); continue
            changes.append({'id':ident,'name':name,'before':previous,'after':values})
    missing=set(original)-seen
    if missing: errors.append(f'表格缺少 {len(missing)} 条原有食材')
    if errors: raise ValueError('\n'.join(errors))
    if len(sys.argv)>5 and sys.argv[5]=='apply':
        db.execute('BEGIN IMMEDIATE')
        for change in changes:
            current_value=db.execute('SELECT seasons_json FROM ingredients WHERE id=?',(change['id'],)).fetchone()
            if not current_value or set(json.loads(current_value[0])) not in (set(change['before']),set(change['after'])): raise ValueError('数据在导入时发生变化，已回滚')
            db.execute('UPDATE ingredients SET seasons_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',(json.dumps(change['after'],ensure_ascii=False,separators=(',',':')),change['id']))
        db.commit()
output.write_text(json.dumps(changes,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'changed':len(changes),'changes':changes},ensure_ascii=True))
