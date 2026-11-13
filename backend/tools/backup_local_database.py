"""Create a consistent, non-overwriting backup of an existing SQLite database.

Usage: python tools/backup_local_database.py SOURCE DESTINATION
Both paths are explicit to avoid guessing which database contains family data.
"""
import argparse
import os
import sqlite3
from pathlib import Path


def backup_database(source: Path, destination: Path) -> None:
    source = source.resolve(strict=True)
    destination = destination.absolute()
    if not source.is_file():
        raise ValueError('Source must be an existing database file')
    if source == destination.resolve():
        raise ValueError('Source and destination must be different')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents accidental replacement of an existing backup.
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src:
            with sqlite3.connect(destination) as dst:
                src.backup(dst)
                result = dst.execute('PRAGMA integrity_check').fetchone()
                if result != ('ok',):
                    raise RuntimeError('Backup failed integrity check')
    except Exception:
        # Leave the newly created file in place for inspection; never touch the source.
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    backup_database(args.source, args.destination)
    print('Backup created and integrity verified:', args.destination)


if __name__ == '__main__':
    main()
