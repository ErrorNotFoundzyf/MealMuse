import subprocess,json,sqlite3,sys
from pathlib import Path
sys.path.insert(0,str(Path('backend/tools').resolve()))
from export_phone_backup import TABLES
adb=r'E:\AndroidSdk\platform-tools\adb.exe'
folder='/sdcard/20618'
names=subprocess.check_output([adb,'shell','ls',folder],text=True).splitlines()
name=next(n.strip() for n in names if n.startswith('meal-muse-backup-') and n.endswith('.json'))
raw=subprocess.check_output([adb,'exec-out','cat',folder+'/'+name])
backup=json.loads(raw)
assert backup['format']=='meal-muse-backup' and backup['version']==1
assert set(backup['tables'])==set(TABLES)
db=sqlite3.connect('outputs/acceptance/before-restore-20261108/phone.db');db.row_factory=sqlite3.Row
canonical=lambda rows: sorted(json.dumps(dict(row),sort_keys=True,ensure_ascii=False) for row in rows)
for table,columns in TABLES.items():
    rows=db.execute(f"SELECT {','.join(columns)} FROM {table}").fetchall()
    assert canonical(rows)==canonical(backup['tables'][table]),table
db.close()
target=Path('outputs/acceptance/phone-export-20261108.json');target.write_bytes(raw)
print(json.dumps({'verified':True,'counts':{k:len(v) for k,v in backup['tables'].items()},'phone_path':folder+'/'+name}))
