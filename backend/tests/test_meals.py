from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.season import time_context


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(f"sqlite:///{(tmp_path / 'meals.db').as_posix()}", api_token='')) as client:
        yield client


def payload(**extra):
    return {'meal_date': time_context()['as_of_date'], 'people_count': 4, 'recipe_ids': ['r_broccoli', 'r_potato'], 'request_key': str(uuid4()), **extra}


def test_confirm_is_idempotent_and_same_day_keeps_multiple(client):
    data = payload()
    first = client.post('/api/v1/meal-records', json=data)
    assert first.status_code == 201
    again = client.post('/api/v1/meal-records', json=data)
    assert first.json() == again.json()
    assert client.post('/api/v1/meal-records', json=payload()).status_code == 201
    items = client.get('/api/v1/meal-records', params={'month': data['meal_date'][:7]}).json()['items']
    assert len(items) == 2
    assert client.post('/api/v1/meal-records', json={**data, 'people_count': 2}).status_code == 409


def test_snapshot_survives_library_edits_and_deletes_and_restart(tmp_path):
    url = f"sqlite:///{(tmp_path / 'snapshots.db').as_posix()}"
    with TestClient(create_app(url, api_token='')) as client:
        record = client.post('/api/v1/meal-records', json=payload()).json()
        assert client.patch('/api/v1/recipes/r_broccoli', json={'name': '改名后西兰花'}).status_code == 200
        assert client.delete('/api/v1/recipes/r_potato').status_code == 204
    with TestClient(create_app(url, api_token='')) as client:
        loaded = client.get('/api/v1/meal-records/' + record['id']).json()
        assert loaded == record
        assert loaded['dishes'][0]['name'] == '清炒西兰花'
        response = client.put('/api/v1/meal-records/' + record['id'], json=payload(revision=1, people_count=2))
        assert response.status_code == 200
        assert response.json()['dishes'] == record['dishes']


def test_update_conflicts_retries_delete_and_tombstone(client):
    original = payload()
    record = client.post('/api/v1/meal-records', json=original).json()
    path = '/api/v1/meal-records/' + record['id']
    update = payload(revision=1, people_count=2)
    changed = client.put(path, json=update)
    assert changed.status_code == 200 and changed.json()['revision'] == 2
    assert client.put(path, json=update).json() == changed.json()
    assert client.put(path, json=payload(revision=1)).status_code == 409
    assert client.delete(path + '?revision=1').status_code == 409
    assert client.delete(path + '?revision=2').status_code == 204
    assert client.delete(path + '?revision=2').status_code == 204
    assert client.get(path).status_code == 404
    assert client.post('/api/v1/meal-records', json=original).status_code == 409
    assert client.get('/api/v1/meal-records', params={'month': original['meal_date'][:7]}).json()['items'] == []


@pytest.mark.parametrize('changes', [
    {'recipe_ids': []}, {'recipe_ids': ['r_broccoli', 'r_broccoli']},
    {'recipe_ids': ['missing']}, {'people_count': True}, {'people_count': 0},
    {'meal_date': '2026-02-30'}, {'request_key': 'short'},
])
def test_invalid_confirmation(client, changes):
    assert client.post('/api/v1/meal-records', json=payload(**changes)).status_code in (409, 422)


def test_future_hidden_and_month_validation(client):
    tomorrow = (date.fromisoformat(time_context()['as_of_date']) + timedelta(days=1)).isoformat()
    assert client.post('/api/v1/meal-records', json=payload(meal_date=tomorrow)).status_code == 422
    client.patch('/api/v1/recipes/r_broccoli', json={'is_hidden': True})
    assert client.post('/api/v1/meal-records', json=payload()).status_code == 409
    assert client.get('/api/v1/meal-records?month=2026-13').status_code == 422
    assert client.get('/api/v1/meal-records?month=2026-11').status_code == 200


def test_backfill_does_not_change_today_or_require_profile(client):
    old = '2026-01-01'
    assert client.post('/api/v1/meal-records', json=payload(meal_date=old)).status_code == 201
    assert len(client.get('/api/v1/meal-records?month=2026-01').json()['items']) == 1
    assert client.get('/api/v1/profile').json()['profile'] is None
