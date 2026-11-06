from datetime import date
import hashlib
import json

from fastapi import Depends, Query, Response
from pydantic import Field, StrictBool, StrictInt, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import DomainError
from .models import DishCategory, Ingredient, MealRecord, Recipe, RecipeIngredient, now
from .schemas import Input
from .season import time_context


class MealInput(Input):
    meal_date: date
    people_count: StrictInt = Field(ge=1, le=30)
    recipe_ids: list[str] = Field(min_length=1, max_length=20)
    request_key: str = Field(min_length=16, max_length=80)
    revision: StrictInt | None = Field(default=None, ge=1)
    plan_id: str | None = None
    plan_revision: StrictInt | None = Field(default=None, ge=1)
    acknowledge_unknown: StrictBool = False
    manual_adjustment: StrictBool = False
    use_current_menu: StrictBool = False

    @model_validator(mode="after")
    def complete_plan(self):
        if (self.plan_id is None) != (self.plan_revision is None):
            raise ValueError("推荐菜单ID和版本需要一起提供")
        return self

    @field_validator("recipe_ids")
    @classmethod
    def unique_ids(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("同一份菜单不能重复选择同一道菜")
        return value


def record_data(item):
    return {"id": item.id, "meal_date": item.meal_date, "people_count": item.people_count,
            "dishes": item.dishes, "revision": item.revision, "confirmed_at": item.confirmed_at, "updated_at": item.updated_at}


def fingerprint(data):
    return hashlib.sha256(json.dumps(data.model_dump(mode="json", exclude={"request_key", "revision"}), sort_keys=True).encode()).hexdigest()


def snapshots(session, ids, previous=None):
    old = {d["recipe_id"]: d for d in (previous or [])}
    result = []
    for recipe_id in ids:
        # Preserve unchanged historical dishes even if the library has since changed.
        if recipe_id in old:
            result.append(old[recipe_id])
            continue
        recipe = session.get(Recipe, recipe_id)
        if not recipe or recipe.deleted_at or recipe.is_hidden:
            raise DomainError(409, "RECIPE_UNAVAILABLE", "所选菜谱已删除或隐藏，请重新选择")
        category = session.get(DishCategory, recipe.category_id)
        rows = session.execute(select(RecipeIngredient, Ingredient).join(Ingredient, Ingredient.id == RecipeIngredient.ingredient_id)
                               .where(RecipeIngredient.recipe_id == recipe_id).order_by(RecipeIngredient.position)).all()
        if any(ingredient.deleted_at for _, ingredient in rows):
            raise DomainError(409, "INGREDIENT_UNAVAILABLE", "菜谱食材已变化，请重新选择")
        result.append({"recipe_id": recipe.id, "name": recipe.name, "category_id": recipe.category_id,
            "is_hearty": recipe.is_hearty,
            "category_name": category.name + (" · 硬菜" if recipe.is_hearty and recipe.category_id != "hearty" else ""), "ingredients": [{"ingredient_id": i.id, "name": i.name,
                "is_main": link.is_main, "quantity": link.quantity, "unit": link.unit} for link, i in rows],
            "steps": recipe.steps, "notes": recipe.notes, "cook_time_minutes": recipe.cook_time_minutes})
    return result


def register_meal_routes(api, db):
    def get_active(session, record_id):
        item = session.get(MealRecord, record_id)
        if not item or item.deleted_at:
            raise DomainError(404, "MEAL_NOT_FOUND", "这份食记不存在或已删除")
        return item

    def valid_date(data):
        if data.meal_date.isoformat() > time_context()["as_of_date"]:
            raise DomainError(422, "FUTURE_MEAL", "食记只记录今天和过去的菜单")

    @api.get("/meal-records")
    def list_meals(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), session: Session = Depends(db)):
        items = session.scalars(select(MealRecord).where(MealRecord.deleted_at.is_(None), MealRecord.meal_date.startswith(month + "-"))
                               .order_by(MealRecord.meal_date, MealRecord.confirmed_at, MealRecord.id))
        return {"items": [record_data(item) for item in items]}

    @api.get("/meal-records/{record_id}")
    def get_meal(record_id: str, session: Session = Depends(db)):
        return record_data(get_active(session, record_id))

    @api.post("/meal-records", status_code=201)
    def confirm_meal(data: MealInput, session: Session = Depends(db)):
        valid_date(data)
        digest = fingerprint(data)
        existing = session.scalar(select(MealRecord).where(MealRecord.creation_key == data.request_key))
        if existing:
            if existing.deleted_at or existing.payload_hash != digest or existing.revision != 1:
                raise DomainError(409, "CONFIRMATION_CHANGED", "这次确认已处理，请查看食记后再操作")
            return record_data(existing)
        if data.revision is not None:
            raise DomainError(422, "INVALID_REVISION", "新建菜单不需要版本号")
        plan = None
        if data.plan_id:
            from .recommendations import validate_plan_confirmation
            plan = validate_plan_confirmation(session, data.plan_id, data.plan_revision, data.recipe_ids, data.people_count, data.meal_date.isoformat(), data.acknowledge_unknown, data.manual_adjustment, data.use_current_menu)
        item = MealRecord(meal_date=data.meal_date.isoformat(), people_count=data.people_count,
                          dishes=snapshots(session, data.recipe_ids, plan.dishes) if plan else snapshots(session, data.recipe_ids), creation_key=data.request_key,
                          last_request_key=data.request_key, payload_hash=digest, revision=1)
        session.add(item)
        session.flush()
        if plan:
            plan.confirmed_record_id = item.id
        session.commit()
        return record_data(item)

    @api.put("/meal-records/{record_id}")
    def update_meal(record_id: str, data: MealInput, session: Session = Depends(db)):
        valid_date(data)
        if data.plan_id:
            raise DomainError(422, "NEW_PLAN_RECORD", "推荐菜单请新建食记，历史更正使用自己挑")
        item = get_active(session, record_id)
        digest = fingerprint(data)
        if item.last_request_key == data.request_key:
            if item.payload_hash != digest:
                raise DomainError(409, "REQUEST_CHANGED", "保存请求内容已变化，请重新打开食记")
            return record_data(item)
        if item.revision != data.revision:
            raise DomainError(409, "STALE_MEAL", "食记已更新，请重新打开后再修改")
        item.dishes = snapshots(session, data.recipe_ids, item.dishes)
        item.meal_date, item.people_count = data.meal_date.isoformat(), data.people_count
        item.last_request_key, item.payload_hash = data.request_key, digest
        item.revision += 1
        item.updated_at = now()
        session.commit()
        return record_data(item)

    @api.delete("/meal-records/{record_id}", status_code=204)
    def delete_meal(record_id: str, revision: int = Query(ge=1), session: Session = Depends(db)):
        item = session.get(MealRecord, record_id)
        if not item:
            raise DomainError(404, "MEAL_NOT_FOUND", "食记不存在")
        if not item.deleted_at:
            if item.revision != revision:
                raise DomainError(409, "STALE_MEAL", "食记已更新，请刷新后再删除")
            item.deleted_at = now()
            session.commit()
        return Response(status_code=204)
