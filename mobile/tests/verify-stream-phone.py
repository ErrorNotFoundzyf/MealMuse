import json,sqlite3,subprocess,tempfile,os
adb=r'E:\AndroidSdk\platform-tools\adb.exe'
names=subprocess.check_output([adb,'shell','run-as','com.family.todayeat.localtest','ls','files/SQLite'],text=True).splitlines()
paths=[n.strip() for n in names if n.startswith('stream-diagnostic-') and n.endswith('.db')]
if len(paths)!=1:raise RuntimeError('诊断数据库数量不符合预期')
data=subprocess.check_output([adb,'exec-out','run-as','com.family.todayeat.localtest','cat','files/SQLite/'+paths[0]])
with tempfile.NamedTemporaryFile(delete=False) as f:f.write(data);path=f.name
try:
    db=sqlite3.connect(path)
    memory,dishes=db.execute('SELECT ai_memory,dishes FROM rule_plans ORDER BY updated_at DESC LIMIT 1').fetchone()
    messages=json.loads(memory)['messages'];dishes=json.loads(dishes)
    assert messages[-1]['role']=='assistant' and messages[-1]['content'] and len(dishes)==4
    assert messages[-1]['content']!='已按本次要求调整，请查看本餐菜单。'
    print(json.dumps({'saved_streamed_explanation':True,'dish_count':len(dishes),'last_role':messages[-1]['role']},ensure_ascii=True))
    db.close()
finally:os.unlink(path)
