from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.season import time_context


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(f"sqlite:///{(tmp_path / 'labels.db').as_posix()}", api_token='')) as client:
        yield client


def test_added_recipe_and_ingredient_categories(client):
    categories = client.get('/api/v1/dish-categories').json()
    assert [c['name'] for c in categories] == ['荤菜', '素菜', '汤', '主食', '硬菜', '水果', '甜点']
    for category in ['fruit', 'dessert', 'hearty']:
        response = client.post('/api/v1/recipes', json={'name': category, 'category_id': category, 'ingredients': [{'ingredient_id': 'i_tomato'}]})
        assert response.status_code == 201
        assert not response.json()['is_hearty']
    fruit = client.post('/api/v1/ingredients', json={'name': '苹果', 'ingredient_category': 'fruit', 'seasons': ['autumn']})
    assert fruit.status_code == 201
    assert client.get('/api/v1/ingredients?ingredient_category=fruit').json()['items'][0]['id'] == fruit.json()['id']


def test_hearty_tag_in_both_filters_and_one_menu_dish(client):
    item = client.post('/api/v1/recipes', json={'name': '糖醋排骨', 'category_id': 'meat', 'is_hearty': True, 'ingredients': [{'ingredient_id': 'i_ribs'}]}).json()
    for category in ['meat', 'hearty']:
        matches = client.get(f'/api/v1/recipes?category_id={category}&q=糖醋排骨').json()
        assert matches['total'] == 1
        assert matches['items'][0]['is_hearty']
    meal = client.post('/api/v1/meal-records', json={'meal_date': time_context()['as_of_date'], 'people_count': 4, 'recipe_ids': [item['id']], 'request_key': str(uuid4())}).json()
    assert len(meal['dishes']) == 1
    assert meal['dishes'][0]['category_name'] == '荤菜 · 硬菜'
    assert client.patch('/api/v1/recipes/' + item['id'], json={'is_hearty': False}).status_code == 200
    assert client.get('/api/v1/recipes?category_id=hearty&q=糖醋排骨').json()['total'] == 0
    assert client.get('/api/v1/meal-records/' + meal['id']).json()['dishes'][0]['is_hearty']


@pytest.mark.parametrize('category', ['meat', 'vegetable', 'soup', 'staple', 'fruit', 'dessert'])
def test_only_hearty_can_be_added_to_one_category(client, category):
    data = {'name': '组合验证', 'category_id': category, 'is_hearty': True, 'ingredients': [{'ingredient_id': 'i_egg'}]}
    assert client.post('/api/v1/recipes', json=data).status_code == 201
    assert client.post('/api/v1/recipes', json={**data, 'category_id': ['meat', 'vegetable']}).status_code == 422
    assert client.post('/api/v1/recipes', json={**data, 'is_hearty': 'true'}).status_code == 422
    assert client.patch('/api/v1/recipes/r_broccoli', json={'is_hearty': None}).status_code == 422


def test_additional_recipe_labels_do_not_enter_family_defaults(client):
    assert client.put('/api/v1/profile', json={'people_count': 4, 'category_counts': {'meat': 1, 'vegetable': 2, 'soup': 1}}).json()['profile']['total_dishes'] == 4
    assert client.put('/api/v1/profile', json={'people_count': 4, 'category_counts': {'hearty': 1}}).status_code == 422


def test_hearty_flag_survives_restart(tmp_path):
    url = f"sqlite:///{(tmp_path / 'restart.db').as_posix()}"
    with TestClient(create_app(url, api_token='')) as client:
        assert client.patch('/api/v1/recipes/r_radish_ribs', json={'is_hearty': True}).status_code == 200
    with TestClient(create_app(url, api_token='')) as client:
        assert client.get('/api/v1/recipes/r_radish_ribs').json()['is_hearty']
        assert len([c for c in client.get('/api/v1/dish-categories').json() if c['id'] == 'hearty']) == 1
