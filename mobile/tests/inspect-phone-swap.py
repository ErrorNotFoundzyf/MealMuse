import subprocess,sqlite3
from pathlib import Path
path=Path('outputs/acceptance/phone-swap-copy.db')
if path.exists():raise ValueError('检查副本已存在，请换一个文件名')
path.parent.mkdir(parents=True,exist_ok=True)
data=subprocess.check_output([r'E:\AndroidSdk\platform-tools\adb.exe','exec-out','run-as','com.family.todayeat.localtest','cat','files/SQLite/meal-muse-local.db'])
path.write_bytes(data)
db=sqlite3.connect(path)
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
print('Verified phone database copy')
db.close()
