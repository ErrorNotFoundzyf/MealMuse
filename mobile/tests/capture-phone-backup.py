import subprocess,sqlite3,hashlib,json,sys
from pathlib import Path
tag=sys.argv[1]
folder=Path('outputs/acceptance')/tag
folder.mkdir(parents=True,exist_ok=False)
for source,name in [('files/SQLite/meal-muse-local.db','phone.db'),('databases/RKStorage','drafts.db')]:
    data=subprocess.check_output([r'E:\AndroidSdk\platform-tools\adb.exe','exec-out','run-as','com.family.todayeat.localtest','cat',source])
    target=folder/name;target.write_bytes(data)
    with sqlite3.connect(target) as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
with sqlite3.connect(folder/'phone.db') as db:
    tables={name:db.execute(f'SELECT count(*) FROM {name}').fetchone()[0] for name in ['ingredients','recipes','family_meal_profile','meal_records']}
    print(json.dumps({'backup':str(folder),'counts':tables}))
