import sqlite3

import pytest

from tools.backup_local_database import backup_database


def test_backup_preserves_data_and_never_overwrites(tmp_path):
    source = tmp_path / 'source.db'
    target = tmp_path / 'backup.db'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE family_data (name TEXT)')
        db.execute('INSERT INTO family_data VALUES (?)', ('existing',))
    backup_database(source, target)
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT name FROM family_data').fetchall() == [('existing',)]
    with pytest.raises(FileExistsError):
        backup_database(source, target)
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT name FROM family_data').fetchall() == [('existing',)]


def test_missing_source_is_not_created(tmp_path):
    source = tmp_path / 'missing.db'
    with pytest.raises(FileNotFoundError):
        backup_database(source, tmp_path / 'backup.db')
    assert not source.exists()
