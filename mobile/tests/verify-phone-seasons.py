import subprocess,sqlite3,tempfile,os,json
from pathlib import Path
data=subprocess.check_output([r'E:\AndroidSdk\platform-tools\adb.exe','exec-out','run-as','com.family.todayeat.localtest','cat','files/SQLite/meal-muse-local.db'])
with tempfile.NamedTemporaryFile(delete=False,suffix='.db') as f:
    f.write(data); path=f.name
try:
    db=sqlite3.connect(path)
    corrections=json.loads(Path('mobile/assets/season-corrections-20261108.json').read_text(encoding='utf-8'))
    matched=sum(set(json.loads(db.execute('SELECT seasons_json FROM ingredients WHERE id=?',(item['id'],)).fetchone()[0]))==set(item['after']) for item in corrections)
    print('Season corrections matching:',matched,'/',len(corrections))
    print('Migration marker:',db.execute('SELECT value FROM local_metadata WHERE key=?',('season_correction_20261108',)).fetchone())
    db.close()
finally: os.unlink(path)
