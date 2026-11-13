import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tools.export_phone_backup import TABLES, export_phone_backup
from tools.export_catalog_seed import export_catalog_seed


def test_export_has_catalog_and_no_credentials_and_cannot_overwrite(tmp_path):
    source = tmp_path / 'family.db'
    target = tmp_path / 'phone.json'
    with TestClient(create_app(f'sqlite:///{source.as_posix()}', api_token='')):
        counts = export_phone_backup(source, target)
    backup = json.loads(target.read_text(encoding='utf-8'))
    assert backup['format'] == 'meal-muse-backup'
    assert backup['version'] == 1
    assert set(backup['tables']) == set(TABLES)
    assert counts['ingredients'] > 0 and counts['recipes'] > 0
    assert 'api_key' not in target.read_text(encoding='utf-8')
    with pytest.raises(FileExistsError):
        export_phone_backup(source, target)


def test_seed_contains_catalog_only_and_never_overwrites(tmp_path):
    source = tmp_path / 'family.db'
    target = tmp_path / 'catalog.json'
    with TestClient(create_app(f'sqlite:///{source.as_posix()}', api_token='')):
        counts = export_catalog_seed(source, target)
    tables = json.loads(target.read_text(encoding='utf-8'))
    assert [t['name'] for t in tables] == ['dish_categories', 'ingredients', 'ingredient_names', 'recipes', 'recipe_ingredients']
    assert counts['recipes'] > 0
    assert 'meal_records' not in target.read_text(encoding='utf-8')
    with pytest.raises(FileExistsError):
        export_catalog_seed(source, target)
