import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi import APIRouter, Depends, FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import default_database_url, make_engine, session_factory
from .models import DishCategory, Ingredient, IngredientName, Profile, Recipe, RecipeIngredient, now
from .schemas import IngredientCreate, IngredientPatch, ProfileInput, RecipeCreate, RecipePatch, normalize
from .season import season_status, time_context
from .seed import seed
from .errors import DomainError
from .meal_routes import register_meal_routes
from .recommendations import register_recommendation_routes
from .ai_planning import register_ai_routes


def migrate(engine):
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "migrations"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def create_app(database_url: str | None = None, api_token: str | None = None):
    engine = make_engine(database_url or default_database_url())
    sessions = session_factory(engine)
    token = api_token if api_token is not None else os.getenv("EATING_API_TOKEN", "")

    @asynccontextmanager
    async def lifespan(_):
        migrate(engine)
        with sessions() as session:
            seed(session)
        yield
        engine.dispose()

    app = FastAPI(title="吃饭灵感 · 家庭数据 API", version="0.4.0", lifespan=lifespan)
    app.state.engine = engine

    @app.middleware("http")
    async def request_id(request, call_next):
        request.state.request_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    def error_response(request, status, code, message, details=None):
        return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, "details": details or {}}, "request_id": request.state.request_id})

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return error_response(request, exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        fields = [{"field": ".".join(map(str, e["loc"])), "message": e["msg"]} for e in exc.errors()]
        return error_response(request, 422, "VALIDATION_ERROR", "请检查输入内容", {"fields": fields})

    @app.exception_handler(IntegrityError)
    async def integrity_error(request, _):
        return error_response(request, 409, "DATA_CONFLICT", "数据已变化或名称重复，请刷新后重试")

    def db(request: Request):
        with sessions() as session:
            try:
                # M1 catalogue writes are short and have no external calls. Serialize
                # validation + mutation to protect logical-delete references as well as FKs.
                # Future LLM routes must use their own short transactions, never this lock.
                if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
                    session.execute(text("BEGIN IMMEDIATE"))
                yield session
            except Exception:
                session.rollback()
                raise

    def authorize(request: Request):
        if token and not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
            raise DomainError(401, "UNAUTHORIZED", "家庭接入凭证不正确，请到设置中检查")

    api = APIRouter(prefix="/api/v1", dependencies=[Depends(authorize)])

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok", "stage": "M3", "version": "0.4.0"}

    @api.get("/time-context")
    def current_time():
        return time_context()

    @api.get("/dish-categories")
    def categories(session: Session = Depends(db)):
        return [{"id": c.id, "name": c.name} for c in session.scalars(select(DishCategory).where(DishCategory.is_active.is_(True)).order_by(DishCategory.sort_order))]

    @api.get("/profile")
    def get_profile(session: Session = Depends(db)):
        return {"profile": profile_data(session.get(Profile, 1))}

    @api.put("/profile")
    def put_profile(data: ProfileInput, session: Session = Depends(db)):
        validate_categories(session, data.category_counts.keys())
        if set(data.category_counts) - {"meat", "vegetable", "soup"}:
            raise DomainError(422, "INVALID_PROFILE_CATEGORY", "家庭默认只设置荤菜、素菜和汤")
        profile = session.get(Profile, 1)
        if profile is None:
            profile = Profile(id=1)
            session.add(profile)
        profile.people_count, profile.category_counts = data.people_count, data.category_counts
        profile.updated_at = now()
        session.commit()
        return {"profile": profile_data(profile)}

    @api.get("/ingredients")
    def ingredients(q: str = Query("", max_length=100), ingredient_category: str | None = None,
                    season: str | None = None, include_all_year: bool = True,
                    visibility: str = Query("visible", pattern="^(visible|hidden|all)$"),
                    limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0), session: Session = Depends(db)):
        statement = select(Ingredient).where(Ingredient.deleted_at.is_(None))
        if visibility != "all":
            statement = statement.where(Ingredient.is_hidden.is_(visibility == "hidden"))
        if q.strip():
            matches = select(IngredientName.ingredient_id).where(IngredientName.normalized_name.contains(normalize(q), autoescape=True))
            statement = statement.where(Ingredient.id.in_(matches))
        if ingredient_category:
            statement = statement.where(Ingredient.ingredient_category == ingredient_category)
        if season:
            if season == "current":
                season = time_context()["current_season"]
            if season not in {"spring", "summer", "autumn", "winter", "all_year", "unknown"}:
                raise DomainError(422, "INVALID_SEASON", "季节参数不正确")
            # Small household catalogue; filtering JSON in Python is portable and bounded by catalogue size.
            rows = list(session.scalars(statement.order_by(Ingredient.name)))
            rows = [r for r in rows if (not r.seasons if season == "unknown" else season in r.seasons or (include_all_year and "all_year" in r.seasons))]
            return {"items": [ingredient_data(r) for r in rows[offset:offset + limit]], "total": len(rows)}
        total = session.scalar(select(func.count()).select_from(statement.subquery()))
        rows = session.scalars(statement.order_by(Ingredient.name).offset(offset).limit(limit))
        return {"items": [ingredient_data(r) for r in rows], "total": total}

    @api.get("/ingredients/{ingredient_id}")
    def get_ingredient(ingredient_id: str, session: Session = Depends(db)):
        return ingredient_data(active(session, Ingredient, ingredient_id))

    @api.post("/ingredients", status_code=201)
    def add_ingredient(data: IngredientCreate, session: Session = Depends(db)):
        check_name(session, data.name)
        item = Ingredient(**data.model_dump(), source="family")
        session.add(item)
        session.flush()
        session.add(IngredientName(normalized_name=normalize(item.name), ingredient_id=item.id, display_name=item.name, kind="canonical"))
        session.commit()
        return ingredient_data(item)

    @api.patch("/ingredients/{ingredient_id}")
    def edit_ingredient(ingredient_id: str, data: IngredientPatch, session: Session = Depends(db)):
        item = active(session, Ingredient, ingredient_id)
        changes = data.model_dump(exclude_unset=True)
        if "name" in changes:
            check_name(session, changes["name"], item.id)
            old = session.scalar(select(IngredientName).where(IngredientName.ingredient_id == item.id, IngredientName.kind == "canonical"))
            key = normalize(changes["name"])
            if old.normalized_name != key:
                old.kind = "alias"
                session.flush()
                target = session.get(IngredientName, key)
                if target:
                    target.kind, target.display_name = "canonical", changes["name"]
                else:
                    session.add(IngredientName(normalized_name=key, ingredient_id=item.id, display_name=changes["name"], kind="canonical"))
            else:
                old.display_name = changes["name"]
        for key, value in changes.items():
            setattr(item, key, value)
        item.updated_at = now()
        session.commit()
        return ingredient_data(item)

    @api.delete("/ingredients/{ingredient_id}", status_code=204)
    def remove_ingredient(ingredient_id: str, session: Session = Depends(db)):
        item = active(session, Ingredient, ingredient_id)
        refs = list(session.scalars(select(Recipe).join(RecipeIngredient).where(RecipeIngredient.ingredient_id == item.id, Recipe.deleted_at.is_(None))))
        if refs:
            raise DomainError(409, "INGREDIENT_IN_USE", "该食材仍被菜谱引用，请先修改相关菜谱", recipes=[{"id": r.id, "name": r.name} for r in refs])
        item.deleted_at = now()
        session.commit()
        return Response(status_code=204)

    @api.get("/recipes")
    def recipes(q: str = Query("", max_length=100), category_id: str | None = None, ingredient_id: str | None = None,
                visibility: str = Query("visible", pattern="^(visible|hidden|all)$"),
                limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0), session: Session = Depends(db)):
        statement = select(Recipe).where(Recipe.deleted_at.is_(None))
        if visibility != "all":
            statement = statement.where(Recipe.is_hidden.is_(visibility == "hidden"))
        if q.strip():
            statement = statement.where(Recipe.normalized_name.contains(normalize(q), autoescape=True))
        if category_id:
            statement = statement.where((Recipe.category_id == category_id) | Recipe.is_hearty.is_(True) if category_id == "hearty" else Recipe.category_id == category_id)
        if ingredient_id:
            statement = statement.where(Recipe.id.in_(select(RecipeIngredient.recipe_id).where(RecipeIngredient.ingredient_id == ingredient_id)))
        total = session.scalar(select(func.count()).select_from(statement.subquery()))
        return {"items": [recipe_data(session, r) for r in session.scalars(statement.order_by(Recipe.created_at.desc(), Recipe.id).offset(offset).limit(limit))], "total": total}

    @api.get("/recipes/{recipe_id}")
    def get_recipe(recipe_id: str, session: Session = Depends(db)):
        return recipe_data(session, active(session, Recipe, recipe_id))

    @api.post("/recipes", status_code=201)
    def add_recipe(data: RecipeCreate, session: Session = Depends(db)):
        validate_recipe(session, data)
        item = Recipe(**data.model_dump(exclude={"ingredients"}), normalized_name=normalize(data.name), source="family")
        session.add(item)
        session.flush()
        replace_ingredients(session, item.id, data.ingredients)
        session.commit()
        return recipe_data(session, item)

    @api.patch("/recipes/{recipe_id}")
    def edit_recipe(recipe_id: str, data: RecipePatch, session: Session = Depends(db)):
        item = active(session, Recipe, recipe_id)
        changes = data.model_dump(exclude_unset=True)
        current = recipe_data(session, item)
        combined = {key: current[key] for key in RecipeCreate.model_fields}
        combined["ingredients"] = [{key: value for key, value in row.items() if key in {"ingredient_id", "is_main", "quantity", "unit"}} for row in current["ingredients"]]
        combined.update({k: v for k, v in changes.items() if k != "is_hidden"})
        try:
            validated = RecipeCreate.model_validate(combined)
        except ValueError as exc:
            raise DomainError(422, "INVALID_RECIPE", "菜谱至少需要一项主要食材，且不能重复") from exc
        validate_recipe(session, validated)
        if "ingredients" in changes:
            replace_ingredients(session, item.id, validated.ingredients)
        for key, value in changes.items():
            if key != "ingredients":
                setattr(item, key, value)
        if "name" in changes:
            item.normalized_name = normalize(item.name)
        if {"steps", "ingredients"} & changes.keys():
            item.constraint_facts = []
        item.updated_at = now()
        session.commit()
        return recipe_data(session, item)

    @api.delete("/recipes/{recipe_id}", status_code=204)
    def remove_recipe(recipe_id: str, session: Session = Depends(db)):
        item = active(session, Recipe, recipe_id)
        item.deleted_at = now()
        session.commit()
        return Response(status_code=204)

    register_meal_routes(api, db)
    register_recommendation_routes(api, db)
    register_ai_routes(api, sessions, app)
    app.include_router(api)
    return app


def active(session, model, key):
    item = session.get(model, key)
    if not item or item.deleted_at:
        raise DomainError(404, "NOT_FOUND", "记录不存在或已删除")
    return item


def check_name(session, name, own_id=None):
    match = session.get(IngredientName, normalize(name))
    if match and match.ingredient_id != own_id:
        item = session.get(Ingredient, match.ingredient_id)
        raise DomainError(409, "INGREDIENT_EXISTS", "食材名称或别名已存在，请使用已有食材", ingredient_id=item.id, name=item.name, deleted=bool(item.deleted_at))


def validate_categories(session, ids):
    allowed = set(session.scalars(select(DishCategory.id).where(DishCategory.is_active.is_(True))))
    if not set(ids) <= allowed:
        raise DomainError(422, "INVALID_CATEGORY", "请选择有效的菜品分类")


def validate_recipe(session, data):
    validate_categories(session, [data.category_id])
    for row in data.ingredients:
        active(session, Ingredient, row.ingredient_id)


def replace_ingredients(session, recipe_id, ingredients):
    session.execute(delete(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id))
    for position, row in enumerate(ingredients):
        session.add(RecipeIngredient(recipe_id=recipe_id, ingredient_id=row.ingredient_id, is_main=row.is_main,
                                     quantity=str(row.quantity) if row.quantity is not None else None, unit=row.unit, position=position))


def ingredient_data(item):
    return {"id": item.id, "name": item.name, "ingredient_category": item.ingredient_category, "seasons": item.seasons,
            "is_hidden": item.is_hidden, "season_status": season_status(item.seasons, time_context()["current_season"]), "updated_at": item.updated_at}


def profile_data(item):
    if item is None:
        return None
    # Existing profiles may still contain the old staple quota until their next save.
    counts = {key: count for key, count in item.category_counts.items() if key in {"meat", "vegetable", "soup"}}
    return {"people_count": item.people_count, "category_counts": counts,
            "total_dishes": sum(counts.values()), "updated_at": item.updated_at}


def recipe_data(session, item):
    rows = session.execute(select(RecipeIngredient, Ingredient).join(Ingredient, RecipeIngredient.ingredient_id == Ingredient.id)
                           .where(RecipeIngredient.recipe_id == item.id).order_by(RecipeIngredient.position)).all()
    return {"id": item.id, "name": item.name, "category_id": item.category_id, "is_hearty": item.is_hearty, "is_hidden": item.is_hidden,
            "steps": item.steps, "notes": item.notes, "cook_time_minutes": item.cook_time_minutes,
            "flavor_tags": item.flavor_tags, "scene_tags": item.scene_tags, "updated_at": item.updated_at,
            "ingredients": [{**ingredient_data(ingredient), "ingredient_id": ingredient.id, "is_main": link.is_main,
                             "quantity": link.quantity, "unit": link.unit} for link, ingredient in rows]}


app = create_app()
