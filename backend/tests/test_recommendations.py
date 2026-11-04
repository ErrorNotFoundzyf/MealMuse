from collections import Counter
from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.season import time_context


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(f"sqlite:///{(tmp_path / 'rules.db').as_posix()}", api_token='')) as client:
        yield client


def generate(client, **overrides):
    return client.post('/api/v1/recommendations', json={'request_key': str(uuid4()), 'people_count': 4, 'category_counts': {'meat': 1, 'vegetable': 2, 'soup': 1}, **overrides})


def confirm(client, plan, **overrides):
    return client.post('/api/v1/meal-records', json={'meal_date': time_context()['as_of_date'], 'people_count': plan['people_count'], 'recipe_ids': [d['recipe_id'] for d in plan['dishes']], 'request_key': str(uuid4()), 'plan_id': plan['id'], 'plan_revision': plan['revision'], **overrides})


def test_exact_counts_profile_overrides_and_no_confirmation_on_generate(client):
    assert client.post('/api/v1/recommendations', json={'request_key': str(uuid4())}).status_code == 422
    client.put('/api/v1/profile', json={'people_count': 3, 'category_counts': {'meat': 1, 'vegetable': 1, 'soup': 1}})
    plan = client.post('/api/v1/recommendations', json={'request_key': str(uuid4()), 'allow_nonseasonal': True}).json()
    assert plan['people_count'] == 3
    assert Counter(d['category_id'] for d in plan['dishes']) == {'meat': 1, 'vegetable': 1, 'soup': 1}
    changed = generate(client, people_count=2, category_counts={'vegetable': 2}, allow_nonseasonal=True)
    assert changed.status_code == 200 and changed.json()['people_count'] == 2
    assert client.get('/api/v1/profile').json()['profile']['people_count'] == 3
    assert client.get('/api/v1/meal-records', params={'month': time_context()['as_of_date'][:7]}).json()['items'] == []


def test_season_strict_and_explicit_expansion(client):
    recipes = client.get('/api/v1/recipes?category_id=vegetable').json()['items']
    for r in recipes:
        for i in r['ingredients']:
            client.patch('/api/v1/ingredients/' + i['ingredient_id'], json={'seasons': []})
    strict = generate(client, category_counts={'vegetable': 1})
    assert strict.status_code == 409
    expanded = generate(client, category_counts={'vegetable': 1}, allow_nonseasonal=True)
    assert expanded.status_code == 200
    assert expanded.json()['dishes'][0]['season_warnings']
    assert expanded.json()['shopping_list'][0]['season_status'] == 'season_unknown'


def test_three_calendar_dates_are_hard_excluded_not_scored(client):
    today = date.fromisoformat(time_context()['as_of_date'])
    for days, recipe in [(0, 'r_broccoli'), (1, 'r_cucumber'), (2, 'r_potato'), (3, 'r_spinach')]:
        response = client.post('/api/v1/meal-records', json={'meal_date': (today-timedelta(days=days)).isoformat(), 'people_count': 2, 'recipe_ids': [recipe], 'request_key': str(uuid4())})
        assert response.status_code == 201
    result = generate(client, category_counts={'vegetable': 2}, allow_nonseasonal=True)
    assert result.status_code == 200
    ids = {d['recipe_id'] for d in result.json()['dishes']}
    assert not ids & {'r_broccoli', 'r_cucumber', 'r_potato'}
    assert 'r_spinach' in ids
    assert generate(client, category_counts={'vegetable': 3}, allow_nonseasonal=True).status_code == 409


def test_replacement_preserves_other_snapshots_revision_and_rejections(client):
    plan = generate(client, allow_nonseasonal=True).json()
    target = next(d for d in plan['dishes'] if d['category_id'] == 'meat')
    action = {'request_key': str(uuid4()), 'expected_revision': 1, 'recipe_id': target['recipe_id']}
    response = client.post(f"/api/v1/recommendations/{plan['id']}/replace", json=action)
    assert response.status_code == 200
    updated = response.json()
    assert updated['revision'] == 2
    assert [d for d in plan['dishes'] if d != target] == [d for d in updated['dishes'] if d['category_id'] != 'meat']
    assert target['recipe_id'] not in {d['recipe_id'] for d in updated['dishes']}
    assert client.post(f"/api/v1/recommendations/{plan['id']}/replace", json=action).json() == updated
    assert confirm(client, plan).status_code == 409
    assert confirm(client, updated).status_code == 201
    assert client.post(f"/api/v1/recommendations/{plan['id']}/replace", json={**action, 'request_key': str(uuid4())}).status_code == 409


def test_confirm_rechecks_recent_records_and_idempotent_success(client):
    plan = generate(client, allow_nonseasonal=True).json()
    manual = client.post('/api/v1/meal-records', json={'meal_date': time_context()['as_of_date'], 'people_count': 4, 'recipe_ids': [plan['dishes'][0]['recipe_id']], 'request_key': str(uuid4())})
    assert manual.status_code == 201
    assert confirm(client, plan).status_code == 409
    client.delete('/api/v1/meal-records/' + manual.json()['id'] + '?revision=1')
    key = str(uuid4())
    saved = confirm(client, plan, request_key=key)
    assert saved.status_code == 201
    assert confirm(client, plan, request_key=key).json() == saved.json()
    assert confirm(client, plan).status_code == 409


def test_deleted_edited_hidden_and_duplicate_identity(client):
    plan = generate(client, allow_nonseasonal=True).json()
    recipe_id = plan['dishes'][0]['recipe_id']
    client.patch('/api/v1/recipes/' + recipe_id, json={'notes': '刚修改'})
    assert confirm(client, plan).status_code == 409
    client.patch('/api/v1/recipes/r_broccoli', json={'is_hidden': True})
    result = generate(client, category_counts={'vegetable': 4}, allow_nonseasonal=True)
    assert result.status_code == 200
    assert 'r_broccoli' not in {d['recipe_id'] for d in result.json()['dishes']}
    client.post('/api/v1/meal-records', json={'meal_date': time_context()['as_of_date'], 'people_count': 2, 'recipe_ids': ['r_potato'], 'request_key': str(uuid4())})
    copy = client.post('/api/v1/recipes', json={'name': ' 清炒土豆丝 ', 'category_id': 'vegetable', 'ingredients': [{'ingredient_id': 'i_potato'}]}).json()
    result = generate(client, category_counts={'vegetable': 3}, allow_nonseasonal=True)
    assert copy['id'] not in {d['recipe_id'] for d in result.json()['dishes']}


def test_shopping_decimal_units_missing_and_dedup(client):
    first = client.post('/api/v1/recipes', json={'name': '鸡蛋一', 'category_id': 'vegetable', 'ingredients': [{'ingredient_id': 'i_egg', 'quantity': '0.1', 'unit': '千克'}]}).json()
    second = client.post('/api/v1/recipes', json={'name': '鸡蛋二', 'category_id': 'vegetable', 'ingredients': [{'ingredient_id': 'i_egg', 'quantity': '0.2', 'unit': '千克'}]}).json()
    def shopping(ids): return client.post('/api/v1/shopping-list', json={'recipe_ids': ids}).json()['items']
    items = shopping([first['id'], second['id']])
    assert len(items) == 1 and items[0]['quantity'] == '0.3'
    assert len(items[0]['recipe_names']) == 2
    client.patch('/api/v1/recipes/' + second['id'], json={'ingredients': [{'ingredient_id': 'i_egg'}]})
    assert shopping([first['id'], second['id']])[0]['quantity'] is None
    client.patch('/api/v1/recipes/' + second['id'], json={'ingredients': [{'ingredient_id': 'i_egg', 'quantity': '2', 'unit': '个'}]})
    assert shopping([first['id'], second['id']])[0]['note'] == '单位不同，未合并用量'


def test_full_regeneration_and_invalid_counts(client):
    plan = generate(client, allow_nonseasonal=True).json()
    new = client.post(f"/api/v1/recommendations/{plan['id']}/regenerate", json={'request_key': str(uuid4()), 'expected_revision': 1})
    assert new.status_code == 200
    assert {d['recipe_id'] for d in new.json()['dishes']} != {d['recipe_id'] for d in plan['dishes']}
    for counts in [{'hearty': 1}, {'meat': True}, {'soup': -1}, {'soup': 21}, {}]:
        assert generate(client, category_counts=counts).status_code == 422


def test_failed_swap_keeps_plan_and_does_not_reuse_previously_rejected(client):
    plan = generate(client, category_counts={'soup': 1}, allow_nonseasonal=True).json()
    rejected = []
    for _ in range(2):
        rejected.append(plan['dishes'][0]['recipe_id'])
        plan = client.post(f"/api/v1/recommendations/{plan['id']}/replace", json={'request_key': str(uuid4()), 'expected_revision': plan['revision'], 'recipe_id': rejected[-1]}).json()
        assert plan['dishes'][0]['recipe_id'] not in rejected
    failure = client.post(f"/api/v1/recommendations/{plan['id']}/replace", json={'request_key': str(uuid4()), 'expected_revision': plan['revision'], 'recipe_id': plan['dishes'][0]['recipe_id']})
    assert failure.status_code == 409
    assert client.get('/api/v1/recommendations/' + plan['id']).json() == plan


def test_date_advance_and_hidden_main_ingredient_invalidates_proposal(client, monkeypatch):
    plan = generate(client, allow_nonseasonal=True).json()
    original = time_context()
    advanced = {**original, 'as_of_date': (date.fromisoformat(original['as_of_date']) + timedelta(days=1)).isoformat()}
    monkeypatch.setattr('app.recommendations.time_context', lambda: advanced)
    assert confirm(client, plan).status_code == 409
    monkeypatch.setattr('app.recommendations.time_context', lambda: original)
    ingredient = next(i for i in plan['dishes'][0]['ingredients'] if i['is_main'])
    client.patch('/api/v1/ingredients/' + ingredient['ingredient_id'], json={'is_hidden': True})
    assert confirm(client, plan).status_code == 409


def test_recommendation_keys_manual_repeat_and_shopping_auth(client):
    key = str(uuid4())
    first = generate(client, request_key=key, allow_nonseasonal=True)
    assert generate(client, request_key=key, allow_nonseasonal=True).json() == first.json()
    assert generate(client, request_key=key, people_count=2, allow_nonseasonal=True).status_code == 409
    recipe = first.json()['dishes'][0]['recipe_id']
    for _ in range(2):
        assert client.post('/api/v1/meal-records', json={'meal_date': time_context()['as_of_date'], 'people_count': 2, 'recipe_ids': [recipe], 'request_key': str(uuid4())}).status_code == 201
    assert client.post('/api/v1/shopping-list', json={'recipe_ids': [recipe, recipe]}).status_code == 422
