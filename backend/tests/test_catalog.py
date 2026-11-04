from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select, text

from app.main import create_app
from app.models import Ingredient, IngredientName
from app.season import season_status, time_context


@pytest.mark.parametrize(('month', 'expected'), [(1, 'winter'), (2, 'winter'), (3, 'spring'), (4, 'spring'), (5, 'spring'), (6, 'summer'), (7, 'summer'), (8, 'summer'), (9, 'autumn'), (10, 'autumn'), (11, 'autumn'), (12, 'winter')])
def test_season_for_every_month(month, expected):
    assert time_context(datetime(2026, month, 15, tzinfo=timezone.utc))['current_season'] == expected


@pytest.fixture
def client(tmp_path):
    app = create_app(f"sqlite:///{(tmp_path / 'test.db').as_posix()}", api_token="")
    with TestClient(app) as client:
        yield client


def create_ingredient(client, name="家庭青菜"):
    response = client.post("/api/v1/ingredients", json={"name": name, "ingredient_category": "vegetable", "seasons": ["summer", "autumn"]})
    assert response.status_code == 201, response.text
    return response.json()


def create_recipe(client, ingredient_id="i_egg", **extra):
    response = client.post("/api/v1/recipes", json={"name": "家庭试做汤", "category_id": "soup", "ingredients": [{"ingredient_id": ingredient_id}], **extra})
    assert response.status_code == 201, response.text
    return response.json()


def test_profile_persistence_across_restart(tmp_path):
    url = f"sqlite:///{(tmp_path / 'persistent.db').as_posix()}"
    with TestClient(create_app(url, api_token="")) as client:
        assert client.get("/api/v1/profile").json() == {"profile": None}
        assert client.put("/api/v1/profile", json={"people_count": 2, "category_counts": {"vegetable": 1, "soup": 1}}).status_code == 200
        ingredient = create_ingredient(client)
        recipe = create_recipe(client, ingredient["id"])
        client.patch("/api/v1/ingredients/i_tomato", json={"seasons": ["all_year"]})
        count = client.get("/api/v1/recipes").json()["total"]
    with TestClient(create_app(url, api_token="")) as client:
        assert client.get("/api/v1/profile").json()["profile"]["total_dishes"] == 2
        assert client.get(f"/api/v1/recipes/{recipe['id']}").json()["ingredients"][0]["name"] == "家庭青菜"
        assert client.get("/api/v1/recipes").json()["total"] == count  # idempotent seed
        assert client.get("/api/v1/ingredients?q=番茄").json()["items"][0]["seasons"] == ["all_year"]


@pytest.mark.parametrize("people,counts", [(True, {"soup": 1}), (0, {"soup": 1}), (31, {"soup": 1}), (2, {"soup": 0}), (2, {"soup": True}), (2, {"soup": -1}), (2, {"soup": 1.2}), (2, {"soup": 21}), (2, {"missing": 1})])
def test_invalid_profile(client, people, counts):
    assert client.put("/api/v1/profile", json={"people_count": people, "category_counts": counts}).status_code == 422
    assert client.get("/api/v1/profile").json()["profile"] is None


def test_alias_collision_and_rename(client):
    response = client.post("/api/v1/ingredients", json={"name": " 番茄 "})
    assert response.status_code == 409
    assert response.json()["error"]["details"]["ingredient_id"] == "i_tomato"
    assert client.get("/api/v1/ingredients?q=番茄").json()["total"] == 1
    item = create_ingredient(client)
    key = item["id"]
    assert client.patch(f"/api/v1/ingredients/{key}", json={"name": "家乡青菜"}).status_code == 200
    assert client.get("/api/v1/ingredients?q=家庭青菜").json()["items"][0]["id"] == key
    assert client.patch(f"/api/v1/ingredients/{key}", json={"name": "家庭青菜"}).status_code == 200
    assert client.patch(f"/api/v1/ingredients/{key}", json={"name": "番茄"}).status_code == 409
    assert client.get("/api/v1/ingredients?q=家乡青菜").json()["items"][0]["name"] == "家庭青菜"


@pytest.mark.parametrize("seasons", [["all_year", "summer"], ["summer", "summer"], ["invalid"]])
def test_invalid_seasons(client, seasons):
    assert client.post("/api/v1/ingredients", json={"name": "新食材", "seasons": seasons}).status_code == 422


def test_seeded_entries_are_editable_and_hideable(client):
    assert client.patch("/api/v1/ingredients/i_tomato", json={"name": "改名"}).status_code == 200
    assert client.delete("/api/v1/ingredients/i_tomato").status_code == 409
    assert client.patch("/api/v1/ingredients/i_tomato", json={"seasons": ["all_year"], "is_hidden": True}).status_code == 200
    assert client.get("/api/v1/ingredients?q=番茄").json()["total"] == 0
    assert client.get("/api/v1/ingredients?q=番茄&visibility=hidden").json()["total"] == 1
    assert client.patch("/api/v1/recipes/r_broccoli", json={"steps": "改动"}).status_code == 200
    assert client.patch("/api/v1/recipes/r_broccoli", json={"is_hidden": True}).status_code == 200
    assert client.get("/api/v1/recipes?visibility=hidden").json()["total"] == 1


def test_minimal_recipe_edit_and_references(client):
    ingredient = create_ingredient(client)
    recipe = create_recipe(client, ingredient["id"])
    assert recipe["steps"] is None and recipe["ingredients"][0]["quantity"] is None
    assert "source" not in recipe
    response = client.delete(f"/api/v1/ingredients/{ingredient['id']}")
    assert response.status_code == 409
    assert response.json()["error"]["details"]["recipes"][0]["id"] == recipe["id"]
    response = client.patch(f"/api/v1/recipes/{recipe['id']}", json={"ingredients": [{"ingredient_id": "i_egg"}], "notes": "这是备注"})
    assert response.status_code == 200
    assert client.delete(f"/api/v1/ingredients/{ingredient['id']}").status_code == 204
    assert client.get(f"/api/v1/recipes/{recipe['id']}").json()["ingredients"][0]["ingredient_id"] == "i_egg"
    assert client.delete(f"/api/v1/recipes/{recipe['id']}").status_code == 204
    assert client.get(f"/api/v1/recipes/{recipe['id']}").status_code == 404


@pytest.mark.parametrize("rows", [[], [{"ingredient_id": "i_egg", "is_main": False}], [{"ingredient_id": "i_egg"}, {"ingredient_id": "i_egg"}], [{"ingredient_id": "i_egg", "quantity": "2"}], [{"ingredient_id": "i_egg", "quantity": "0", "unit": "个"}]])
def test_bad_recipe_atomic(client, rows):
    before = client.get("/api/v1/recipes").json()["total"]
    assert client.post("/api/v1/recipes", json={"name": "无效菜", "category_id": "soup", "ingredients": rows}).status_code == 422
    assert client.get("/api/v1/recipes").json()["total"] == before


def test_patch_rejects_no_main_and_deleted_reference(client):
    recipe = create_recipe(client)
    response = client.patch(f"/api/v1/recipes/{recipe['id']}", json={"ingredients": [{"ingredient_id": "i_egg", "is_main": False}]})
    assert response.status_code == 422
    assert client.get(f"/api/v1/recipes/{recipe['id']}").json()["ingredients"][0]["is_main"] is True
    item = create_ingredient(client)
    client.delete(f"/api/v1/ingredients/{item['id']}")
    assert client.post("/api/v1/recipes", json={"name": "无效引用", "category_id": "soup", "ingredients": [{"ingredient_id": item["id"]}]}).status_code == 404


def test_filter_pagination_and_unknown(client):
    create_recipe(client, name="可搜索汤")
    assert client.get("/api/v1/recipes?q=可搜索&ingredient_id=i_egg").json()["total"] == 1
    page = client.get("/api/v1/ingredients?limit=2&offset=2").json()
    assert len(page["items"]) == 2 and page["total"] > 2
    assert client.get("/api/v1/ingredients?season=unknown").json()["items"][0]["seasons"] == []
    assert client.get("/api/v1/ingredients?season=summer&ingredient_category=vegetable").json()["total"] > 0
    assert client.get("/api/v1/ingredients?season=invalid").status_code == 422


def test_no_unconfirmed_scope_and_database_constraints(client):
    assert client.post("/api/v1/ingredients", json={"name": "不该有图片", "image_url": "x"}).status_code == 422
    assert client.get("/api/v1/market-ingredients").status_code == 404
    tables = inspect(client.app.state.engine).get_table_names()
    assert "market_ingredients" not in tables
    assert "recommendation_sessions" not in tables  # M2, not a fake M1 implementation
    with client.app.state.engine.connect() as conn:
        assert conn.scalar(text("PRAGMA foreign_keys")) == 1
    assert client.get("/api/v1/recipes?limit=101").status_code == 422


def test_optional_bearer_auth(tmp_path):
    with TestClient(create_app(f"sqlite:///{(tmp_path / 'auth.db').as_posix()}", api_token="test-secret")) as client:
        assert client.get("/api/v1/health").status_code == 200
        assert client.get("/api/v1/profile").status_code == 401
        assert client.get("/api/v1/meal-records?month=2026-11").status_code == 401
        assert client.get("/api/v1/recommendations/missing").status_code == 401
        assert client.post("/api/v1/shopping-list", json={"recipe_ids": ["r_broccoli"]}).status_code == 401
        assert client.get("/api/v1/profile", headers={"Authorization": "Bearer test-secret"}).status_code == 200


def test_timezone_and_season_boundaries():
    assert time_context(datetime(2026, 11, 30, 16, tzinfo=timezone.utc))["current_season"] == "winter"
    assert time_context(datetime(2026, 11, 30, 15, 59, tzinfo=timezone.utc))["current_season"] == "autumn"
    assert season_status([], "summer") == "season_unknown"
    assert season_status(["all_year"], "winter") == "in_season"
    assert season_status(["summer"], "winter") == "out_of_season"


def test_detail_and_migration_schema(client):
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from app.database import Base

    detail = client.get("/api/v1/ingredients/i_tomato")
    assert detail.status_code == 200 and detail.json()["name"] == "西红柿"
    assert client.get("/api/v1/ingredients/missing").status_code == 404
    with client.app.state.engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0004_rule_plans"
        assert compare_metadata(MigrationContext.configure(conn), Base.metadata) == []


def test_exact_and_current_season_filters(client):
    current = client.get('/api/v1/time-context').json()['current_season']
    other = next(s for s in ['spring', 'summer', 'autumn', 'winter'] if s != current)
    samples = {}
    for key, seasons in [('current', [current]), ('other', [other]), ('all', ['all_year']), ('unknown', [])]:
        response = client.post('/api/v1/ingredients', json={'name': '季节筛选验证' + key, 'seasons': seasons})
        assert response.status_code == 201
        samples[key] = response.json()['id']

    def ids(season, include=False):
        response = client.get('/api/v1/ingredients', params={'q': '季节筛选验证', 'season': season, 'include_all_year': include})
        assert response.status_code == 200
        assert response.json()['total'] == len(response.json()['items'])
        return {i['id'] for i in response.json()['items']}

    assert ids('current') == {samples['current']}
    assert ids('current', True) == {samples['current'], samples['all']}
    assert ids('all_year') == {samples['all']}
    assert ids('unknown') == {samples['unknown']}
    for season in ['spring', 'summer', 'autumn', 'winter']:
        expected = {samples['current']} if season == current else {samples['other']} if season == other else set()
        assert ids(season) == expected


def test_family_defaults_exclude_staple_and_keep_recipe_category(client):
    response = client.put('/api/v1/profile', json={'people_count': 4, 'category_counts': {'meat': 1, 'vegetable': 2, 'soup': 1, 'staple': 1}})
    assert response.status_code == 200
    assert response.json()['profile']['category_counts'] == {'meat': 1, 'vegetable': 2, 'soup': 1}
    assert response.json()['profile']['total_dishes'] == 4
    assert any(c['id'] == 'staple' for c in client.get('/api/v1/dish-categories').json())
    assert create_recipe(client, category_id='staple')['category_id'] == 'staple'
    assert client.put('/api/v1/profile', json={'people_count': 4, 'category_counts': {'staple': 1}}).status_code == 422


def test_legacy_family_profile_does_not_count_staple(client):
    from sqlalchemy.orm import Session
    from app.models import Profile
    with Session(client.app.state.engine) as session:
        session.add(Profile(id=1, people_count=4, category_counts={'meat': 1, 'vegetable': 2, 'soup': 1, 'staple': 2}))
        session.commit()
    profile = client.get('/api/v1/profile').json()['profile']
    assert profile['total_dishes'] == 4
    assert 'staple' not in profile['category_counts']


def test_seasoning_crud_and_seeded_delete_survive_restart(tmp_path):
    url = f"sqlite:///{(tmp_path / 'unified.db').as_posix()}"
    with TestClient(create_app(url, api_token='')) as client:
        spices = client.get('/api/v1/ingredients?ingredient_category=seasoning').json()['items']
        assert {i['name'] for i in spices} == {'八角', '桂皮'}
        assert all('source' not in i for i in spices)
        assert client.patch('/api/v1/ingredients/i_star_anise', json={'name': '大料', 'seasons': ['all_year']}).status_code == 200
        assert client.delete('/api/v1/ingredients/i_cinnamon').status_code == 204
        assert client.delete('/api/v1/recipes/r_broccoli').status_code == 204
        response = client.post('/api/v1/ingredients', json={'name': '花椒', 'ingredient_category': 'seasoning', 'seasons': ['all_year']})
        assert response.status_code == 201
        assert client.delete('/api/v1/ingredients/' + response.json()['id']).status_code == 204
    with TestClient(create_app(url, api_token='')) as client:
        assert client.get('/api/v1/ingredients/i_star_anise').json()['name'] == '大料'
        assert client.get('/api/v1/ingredients/i_cinnamon').status_code == 404
        assert client.get('/api/v1/recipes/r_broccoli').status_code == 404
        assert client.get('/api/v1/ingredients?q=花椒').json()['total'] == 0
