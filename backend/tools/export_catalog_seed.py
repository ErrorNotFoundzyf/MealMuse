"""Prepare a catalogue-only seed for a new phone; never include family records or keys."""
import argparse
import json
import sqlite3
from pathlib import Path

try:
    from .export_phone_backup import TABLES
except ImportError:  # Direct script execution.
    from export_phone_backup import TABLES


def export_catalog_seed(source: Path, destination: Path) -> dict:
    source = source.resolve(strict=True)
    if not source.is_file() or source == destination.resolve():
        raise ValueError('Choose an existing database and a different output file')
    names = ('dish_categories', 'ingredients', 'ingredient_names', 'recipes', 'recipe_ingredients')
    tables = []
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchone() is not None:
            raise ValueError('Source database failed integrity checks')
        for name in names:
            columns = TABLES[name]
            rows = [dict(row) for row in db.execute(f"SELECT {','.join(columns)} FROM {name}")]
            tables.append({'name': name, 'columns': columns, 'rows': rows})
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(tables, output, ensure_ascii=False, separators=(',', ':'))
    return {table['name']: len(table['rows']) for table in tables}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print('Seed row counts:', export_catalog_seed(args.source, args.destination))
