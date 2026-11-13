"""Export a consistent, portable phone backup without credentials or transient plans."""
import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

TABLES = {
    'dish_categories': ('id', 'name', 'sort_order', 'is_active'),
    'ingredients': ('id', 'name', 'ingredient_category', 'seasons_json', 'source', 'is_hidden', 'created_at', 'updated_at', 'deleted_at'),
    'ingredient_names': ('normalized_name', 'ingredient_id', 'display_name', 'kind'),
    'recipes': ('id', 'name', 'normalized_name', 'category_id', 'is_hearty', 'source', 'steps', 'notes', 'cook_time_minutes', 'flavor_tags', 'scene_tags', 'constraint_facts', 'is_hidden', 'created_at', 'updated_at', 'deleted_at'),
    'recipe_ingredients': ('recipe_id', 'ingredient_id', 'is_main', 'quantity', 'unit', 'position'),
    'family_meal_profile': ('id', 'people_count', 'category_counts_json', 'updated_at'),
    'meal_records': ('id', 'meal_date', 'people_count', 'dishes', 'creation_key', 'last_request_key', 'payload_hash', 'revision', 'confirmed_at', 'updated_at', 'deleted_at'),
}


def export_phone_backup(source: Path, destination: Path) -> dict:
    source = source.resolve(strict=True)
    if not source.is_file():
        raise ValueError('Source must be an existing database file')
    if source == destination.resolve():
        raise ValueError('Source and destination must be different')
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute('BEGIN')  # All tables are read from the same SQLite snapshot.
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Database integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
            raise ValueError('Database has broken references')
        tables = {name: [dict(row) for row in db.execute(f"SELECT {','.join(columns)} FROM {name}")] for name, columns in TABLES.items()}
    backup = {'format': 'meal-muse-backup', 'version': 1, 'created_at': datetime.now(timezone.utc).isoformat(), 'tables': tables}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(backup, output, ensure_ascii=False, separators=(',', ':'))
    return {name: len(rows) for name, rows in tables.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print('Exported row counts:', export_phone_backup(args.source, args.destination))


if __name__ == '__main__':
    main()
