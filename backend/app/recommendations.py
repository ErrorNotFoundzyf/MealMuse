from collections import Counter
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal
import hashlib
import json
from random import SystemRandom

from fastapi import Depends
from pydantic import Field, StrictBool, StrictInt, field_validator
from sqlalchemy import select

from .errors import DomainError
from .meal_routes import snapshots
from .models import DishCategory, Ingredient, MealRecord, Profile, Recipe, RulePlan, now
from .schemas import Input, normalize
from .season import season_status, time_context

CATEGORIES = {"meat", "vegetable", "soup"}
EXTRA_CATEGORIES = {"dessert", "fruit"}


class GenerateInput(Input):
    request_key: str = Field(min_length=16, max_length=80)
    people_count: StrictInt | None = Field(default=None, ge=1, le=30)
    category_counts: dict[str, StrictInt] | None = None
    allow_nonseasonal: StrictBool = False

    @field_validator("category_counts")
    @classmethod
    def validate_counts(cls, counts):
        if counts is not None and (set(counts) - CATEGORIES or any(v < 0 or v > 20 for v in counts.values()) or not 1 <= sum(counts.values()) <= 20):
            raise ValueError("请选择荤菜、素菜、汤的数量，总数为1到20道")
        return counts


class PlanAction(Input):
    request_key: str = Field(min_length=16, max_length=80)
    expected_revision: StrictInt = Field(ge=1)
    recipe_id: str | None = None
    use_current_menu: StrictBool = False


class ManualSwapInput(GenerateInput):
    selected_recipe_ids: list[str] = Field(min_length=1, max_length=20)
    action: str = Field(pattern='^(replace|regenerate)$')
    recipe_id: str | None = None
    plan_id: str | None = None
    expected_revision: StrictInt | None = Field(default=None, ge=1)

    @field_validator('selected_recipe_ids')
    @classmethod
    def unique_selection(cls, value):
        if len(value) != len(set(value)):
            raise ValueError('所选菜品不能重复')
        return value


class ShoppingInput(Input):
    recipe_ids: list[str] = Field(min_length=1, max_length=20)
    record_id: str | None = None
    revision: StrictInt | None = None
    plan_id: str | None = None
    plan_revision: StrictInt | None = None

    @field_validator("recipe_ids")
    @classmethod
    def no_duplicates(cls, ids):
        if len(ids) != len(set(ids)):
            raise ValueError("同一份清单不能重复选择同一道菜")
        return ids


def digest(data):
    return hashlib.sha256(json.dumps(data.model_dump(mode="json", exclude={"request_key"}), sort_keys=True).encode()).hexdigest()


def signature(dish):
    return normalize(dish["name"]) + "|" + ",".join(sorted(i["ingredient_id"] for i in dish["ingredients"] if i["is_main"]))


def recent_exclusions(session, today):
    start = (date.fromisoformat(today) - timedelta(days=2)).isoformat()
    records = session.scalars(select(MealRecord).where(MealRecord.deleted_at.is_(None), MealRecord.meal_date >= start, MealRecord.meal_date <= today))
    dishes = [d for record in records for d in record.dishes]
    return {d["recipe_id"] for d in dishes}, {signature(d) for d in dishes}


def season_info(session, dish, season):
    states = []
    for row in dish["ingredients"]:
        item = session.get(Ingredient, row["ingredient_id"])
        if not item or item.deleted_at or (row["is_main"] and item.is_hidden):
            return None
        if row["is_main"]:
            states.append({"name": row["name"], "status": season_status(item.seasons, season)})
    return states or None


def candidates(session, allow_nonseasonal, rejected_ids=(), rejected_signatures=()):
    clock = time_context()
    recent_ids, recent_signatures = recent_exclusions(session, clock["as_of_date"])
    blocked_ids, blocked_signatures = recent_ids | set(rejected_ids), recent_signatures | set(rejected_signatures)
    pool = []
    recipes = session.scalars(select(Recipe).where(Recipe.deleted_at.is_(None), Recipe.is_hidden.is_(False), Recipe.category_id.in_(CATEGORIES | EXTRA_CATEGORIES)))
    for recipe in recipes:
        if recipe.id in blocked_ids:
            continue
        dish = snapshots(session, [recipe.id])[0]
        if signature(dish) in blocked_signatures:
            continue
        states = season_info(session, dish, clock["current_season"])
        if not states or (not allow_nonseasonal and any(s["status"] != "in_season" for s in states)):
            continue
        dish["season_warnings"] = [s["name"] + ("（季节未设置）" if s["status"] == "season_unknown" else "（非当季）") for s in states if s["status"] != "in_season"]
        dish["season_coverage"] = sum(s["status"] == "in_season" for s in states) / len(states)
        pool.append(dish)
    return pool


def mains(dish):
    return {i["ingredient_id"] for i in dish["ingredients"] if i["is_main"]}


def is_hearty(dish):
    return dish.get("is_hearty", False) or dish["category_id"] == "hearty"


def meets_hearty_count(dishes, required):
    return required is None or sum(bool(is_hearty(d)) for d in dishes) == required


def select_menu(pool, counts, avoid_ids=(), allow_nonseasonal=False, hearty_count=None):
    names = {"meat": "荤菜", "vegetable": "素菜", "soup": "汤", "dessert": "甜点", "fruit": "水果"}
    shortage = []
    for category, count in counts.items():
        available = {signature(d) for d in pool if d["category_id"] == category}
        if len(available) < count:
            shortage.append(f"{names[category]}还缺{count - len(available)}道")
    if shortage:
        advice = "。请补充菜谱或调整本次菜数；已包含非当季与季节未设置食材，最近三天的菜仍不会放宽。" if allow_nonseasonal else "。可补充菜谱、调整本次菜数，或明确允许非当季及季节未设置食材后重试；最近三天的菜不会放宽。"
        raise DomainError(409, "INSUFFICIENT_CANDIDATES", "、".join(shortage) + advice)
    rng = SystemRandom()
    ranked = [(dish, rng.random() * 0.4) for dish in pool]
    slots = [category for category, count in counts.items() for _ in range(count)]
    slots.sort(key=lambda category: sum(d["category_id"] == category for d in pool))
    beam = [(0.0, [])]
    for slot_index, category in enumerate(slots):
        next_beam = {}
        for score, chosen in beam:
            used = {signature(d) for d in chosen}
            ingredients = Counter(i for d in chosen for i in mains(d))
            for dish, jitter in ranked:
                if dish["category_id"] != category or signature(dish) in used:
                    continue
                value = dish["season_coverage"] * 10 - sum(ingredients[i] for i in mains(dish)) * 0.7 + jitter
                value -= 1.5 if dish["recipe_id"] in avoid_ids else 0
                selection = chosen + [dish]
                if hearty_count is not None:
                    hearty = sum(bool(is_hearty(d)) for d in selection)
                    if hearty > hearty_count or hearty + len(slots) - slot_index - 1 < hearty_count:
                        continue
                key = tuple(sorted(signature(d) for d in selection))
                if key not in next_beam or score + value > next_beam[key][0]:
                    next_beam[key] = (score + value, selection)
        beam = sorted(next_beam.values(), key=lambda row: row[0], reverse=True)[:40]
    if not beam:
        raise DomainError(409, "INSUFFICIENT_COMBINATIONS", "没有满足数量且不重复的菜单，请补充菜谱")
    # Prefer an actually different table when another valid combination exists.
    changed = [row for row in beam if {d["recipe_id"] for d in row[1]} != set(avoid_ids)] if avoid_ids else beam
    if avoid_ids and not changed:
        raise DomainError(409, "NO_OTHER_MENU", "目前没有其他完整搭配，可以试试只换一道或补充菜谱")
    chosen = (changed or beam)[0][1]
    return sorted(chosen, key=lambda d: list(counts).index(d["category_id"]))


def shopping_list(session, dishes):
    grouped = {}
    season = time_context()["current_season"]
    for dish in dishes:
        for item in dish["ingredients"]:
            if not item["is_main"]:
                continue
            row = grouped.setdefault(item["ingredient_id"], {"ingredient_id": item["ingredient_id"], "name": item["name"], "recipe_names": [], "amounts": []})
            row["recipe_names"].append(dish["name"])
            row["amounts"].append((item.get("quantity"), item.get("unit")))
    for row in grouped.values():
        amounts = row.pop("amounts")
        units = {unit for _, unit in amounts}
        complete = all(quantity is not None and unit for quantity, unit in amounts)
        row["quantity"] = format(sum(Decimal(quantity) for quantity, _ in amounts).normalize(), "f") if complete and len(units) == 1 else None
        row["unit"] = next(iter(units)) if row["quantity"] is not None else None
        row["note"] = "" if row["quantity"] is not None else "用量未完整记录" if not complete else "单位不同，未合并用量"
        ingredient = session.get(Ingredient, row["ingredient_id"])
        row["season_status"] = season_status(ingredient.seasons if ingredient else [], season)
    return list(grouped.values())


def plan_data(session, plan):
    from .ai_planning import clean_reply
    memory = plan.ai_memory or {}
    visible_messages = [{**m, 'content': clean_reply(m['content']) if m['role'] == 'assistant' else m['content']} for m in memory.get('messages', [])]
    return {"id": plan.id, "revision": plan.revision, "people_count": plan.people_count, "category_counts": plan.category_counts,
            "as_of_date": plan.as_of_date, "dishes": plan.dishes, "allow_nonseasonal": plan.allow_nonseasonal,
            "confirmed_record_id": plan.confirmed_record_id, "shopping_list": shopping_list(session, plan.dishes), "mode": "chat" if plan.ai_memory else "rules",
            "ai": {**{key: plan.ai_memory.get(key) for key in ("messages", "blocked", "unknown", "pending", "constraints", "pool_version", "last_action", "last_usage", "hearty_count")},
                   "messages": visible_messages,
                   "can_use_current_menu": bool(plan.dishes),
                   "has_candidate_pool": "candidate_pool" in plan.ai_memory,
                   "candidate_counts": dict(Counter(d["category_id"] for d in plan.ai_memory.get("candidate_pool", [])))} if plan.ai_memory else None}


def validate_plan_confirmation(session, plan_id, revision, recipe_ids, people, meal_date, acknowledge_unknown=False, manual_adjustment=False, use_current_menu=False):
    plan = session.get(RulePlan, plan_id)
    if not plan or plan.confirmed_record_id or plan.revision != revision:
        raise DomainError(409, "STALE_PLAN", "推荐菜单已更新或确认，请重新读取后再确认")
    if meal_date != time_context()["as_of_date"] or (not manual_adjustment and recipe_ids != [d["recipe_id"] for d in plan.dishes]):
        raise DomainError(409, "PLAN_CHANGED", "推荐内容或日期已变化，请重新搭配；手动调整请使用自己挑")
    if plan.ai_memory:
        from .ai_planning import conflicts
        if use_current_menu:
            from .ai_planning import use_last_valid_menu
            use_last_valid_menu(plan, session)
        if plan.ai_memory.get("blocked"):
            raise DomainError(409, "AI_PENDING", "本轮要求尚未处理完成，请先继续对话或重试")
        conditions = plan.ai_memory.get("constraints", [])
        if conditions and not acknowledge_unknown:
            raise DomainError(422, "CHECK_CONSTRAINTS", "存在明确饮食限制，确认前请核对配料与做法并勾选提示")
        recent_ids, recent_sigs = recent_exclusions(session, time_context()["as_of_date"])
        dishes = snapshots(session, recipe_ids, plan.dishes) if manual_adjustment else plan.dishes
        if not meets_hearty_count(dishes, plan.ai_memory.get("hearty_count")):
            raise DomainError(409, "HEARTY_COUNT_MISMATCH", "菜单不满足本餐硬菜数量要求，请调整或通过对话修改要求")
        fresh = {d["recipe_id"]: d for d in candidates(session, plan.allow_nonseasonal)}
        for dish in dishes:
            states = season_info(session, dish, time_context()["current_season"])
            if conflicts(dish, conditions) or not states:
                raise DomainError(409, "AI_CONSTRAINT_CONFLICT", "菜单中存在已知禁忌或食材变化，请调整后确认")
            if not manual_adjustment:
                if dish["recipe_id"] in recent_ids or signature(dish) in recent_sigs or (not plan.allow_nonseasonal and any(s["status"] != "in_season" for s in states)):
                    raise DomainError(409, "PLAN_NO_LONGER_VALID", "近期记录或季节已变化，请重新搭配")
                if not dish["recipe_id"].startswith("tmp_") and (dish["recipe_id"] not in fresh or any(fresh[dish["recipe_id"]].get(k) != dish.get(k) for k in ("name", "category_id", "ingredients", "steps", "notes", "is_hearty"))):
                    raise DomainError(409, "PLAN_NO_LONGER_VALID", "菜谱已变化，请重新搭配")
        return plan
    available = {d["recipe_id"]: d for d in candidates(session, plan.allow_nonseasonal, plan.rejected_ids, plan.rejected_signatures)}
    for dish in plan.dishes:
        current = available.get(dish["recipe_id"])
        # Recipe edits, deletion, a season boundary or a newly confirmed meal invalidate stale proposals.
        if not current or current != dish:
            raise DomainError(409, "PLAN_NO_LONGER_VALID", "菜谱、季节或近期记录已变化，请重新搭配后确认")
    return plan


def register_recommendation_routes(api, db):
    def get_plan(session, plan_id):
        plan = session.get(RulePlan, plan_id)
        if not plan:
            raise DomainError(404, "PLAN_NOT_FOUND", "推荐菜单不存在")
        return plan

    @api.post("/recommendations")
    def generate(data: GenerateInput, session=Depends(db)):
        existing = session.scalar(select(RulePlan).where(RulePlan.creation_key == data.request_key))
        if existing:
            if existing.creation_hash != digest(data):
                raise DomainError(409, "REQUEST_CHANGED", "这次请求的内容已变化，请重新生成")
            return plan_data(session, existing)
        profile = session.get(Profile, 1)
        if (data.category_counts is None or data.people_count is None) and not profile:
            raise DomainError(422, "PROFILE_REQUIRED", "请先在家庭中设置人数和菜品构成")
        counts = data.category_counts if data.category_counts is not None else {k: v for k, v in profile.category_counts.items() if k in CATEGORIES}
        if not 1 <= sum(counts.values()) <= 20:
            raise DomainError(422, "PROFILE_REQUIRED", "请先完善家庭菜品构成")
        dishes = select_menu(candidates(session, data.allow_nonseasonal), counts, allow_nonseasonal=data.allow_nonseasonal)
        plan = RulePlan(creation_key=data.request_key, creation_hash=digest(data), last_request_key=data.request_key,
                        last_payload_hash=digest(data), people_count=data.people_count or profile.people_count,
                        category_counts=counts, dishes=dishes, allow_nonseasonal=data.allow_nonseasonal,
                        as_of_date=time_context()["as_of_date"])
        session.add(plan); session.commit()
        return plan_data(session, plan)

    @api.get("/recommendations/{plan_id}")
    def read_plan(plan_id: str, session=Depends(db)):
        return plan_data(session, get_plan(session, plan_id))

    @api.post('/recommendations/manual-swap')
    def manual_swap(data: ManualSwapInput, session=Depends(db)):
        existing = session.scalar(select(RulePlan).where(RulePlan.creation_key == data.request_key))
        if existing:
            if existing.creation_hash != digest(data):
                raise DomainError(409, 'REQUEST_CHANGED', '这次换菜内容已变化，请重新操作')
            return plan_data(session, existing)
        source = get_plan(session, data.plan_id) if data.plan_id else None
        if source and (source.revision != data.expected_revision or source.confirmed_record_id):
            raise DomainError(409, 'STALE_PLAN', '菜单已变化，请重新读取')
        if not data.people_count:
            raise DomainError(422, 'PROFILE_REQUIRED', '请设置本次用餐人数')
        selected = snapshots(session, data.selected_recipe_ids, source.dishes if source else None)
        actual_counts = dict(Counter(d['category_id'] for d in selected))
        if set(actual_counts) - (CATEGORIES | EXTRA_CATEGORIES):
            raise DomainError(422, 'UNSUPPORTED_SWAP', '暂时支持荤菜、素菜、汤、甜品和水果换菜，其他类型可以自己挑选。')
        fresh = {d['recipe_id']: d for d in candidates(session, data.allow_nonseasonal)}
        dishes = [deepcopy(fresh.get(d['recipe_id'], d)) for d in selected]
        memory = deepcopy(source.ai_memory) if source and source.ai_memory else None
        if memory:
            from .ai_planning import pool_context
            conditions = memory.get('constraints', [])
            memory = deepcopy(memory.get('last_valid_state', {}).get('memory', memory))
            memory['constraints'], memory['blocked'], memory['pending'] = conditions, False, []
            memory['extra_counts'] = {k: v for k, v in actual_counts.items() if k in EXTRA_CATEGORIES}
            base = {k: v for k, v in actual_counts.items() if k in CATEGORIES}
            memory['pool_context'] = pool_context(data.people_count, base, data.allow_nonseasonal, memory)
        else:
            base = actual_counts
        plan = RulePlan(creation_key=data.request_key, creation_hash=digest(data), last_request_key='', last_payload_hash='', people_count=data.people_count,
                        category_counts=base, dishes=dishes, allow_nonseasonal=data.allow_nonseasonal, as_of_date=time_context()['as_of_date'], ai_memory=memory,
                        rejected_ids=deepcopy(source.rejected_ids) if source else [], rejected_signatures=deepcopy(source.rejected_signatures) if source else [])
        session.add(plan); session.flush()
        return change_plan(plan.id, PlanAction(request_key=data.request_key, expected_revision=plan.revision, recipe_id=data.recipe_id), session, regenerate=data.action == 'regenerate')

    def change_plan(plan_id, data, session, regenerate=False):
        plan = get_plan(session, plan_id)
        if plan.ai_memory:
            from .ai_planning import change_cached_plan
            return change_cached_plan(session, plan, data, regenerate)
        if plan.last_request_key == data.request_key:
            if plan.last_payload_hash != digest(data):
                raise DomainError(409, "REQUEST_CHANGED", "请求内容已变化，请重新操作")
            return plan_data(session, plan)
        if plan.confirmed_record_id or plan.revision != data.expected_revision:
            raise DomainError(409, "STALE_PLAN", "菜单已更新，请重新读取")
        pool = candidates(session, plan.allow_nonseasonal, plan.rejected_ids, plan.rejected_signatures)
        available = {d["recipe_id"]: d for d in pool}
        if regenerate:
            new = select_menu(pool, plan.category_counts, [d["recipe_id"] for d in plan.dishes], allow_nonseasonal=plan.allow_nonseasonal)
        else:
            target = next((d for d in plan.dishes if d["recipe_id"] == data.recipe_id), None)
            if target is None:
                raise DomainError(422, "INVALID_TARGET", "请选择当前菜单中的一道菜")
            others = [d for d in plan.dishes if d["recipe_id"] != data.recipe_id]
            if any(d["recipe_id"] not in available or available[d["recipe_id"]] != d for d in others):
                raise DomainError(409, "PLAN_NO_LONGER_VALID", "保留菜品的条件已变化，请重新搭配")
            blocked = {signature(d) for d in plan.dishes}
            replacements = [d for d in pool if d["category_id"] == target["category_id"] and signature(d) not in blocked]
            if not replacements:
                raise DomainError(409, "NO_REPLACEMENT", "这一类暂时没有其他合适的菜，当前菜单已保留")
            other_mains = Counter(i for d in others for i in mains(d))
            rng = SystemRandom()
            replacements.sort(key=lambda d: d["season_coverage"] * 10 - sum(other_mains[i] for i in mains(d)) * 0.7 + rng.random() * 0.4, reverse=True)
            new = [replacements[0] if d["recipe_id"] == data.recipe_id else d for d in plan.dishes]
            plan.rejected_ids = [*plan.rejected_ids, target["recipe_id"]]
            plan.rejected_signatures = [*plan.rejected_signatures, signature(target)]
        plan.dishes = new; plan.revision += 1
        plan.as_of_date, plan.updated_at = time_context()["as_of_date"], now()
        plan.last_request_key, plan.last_payload_hash = data.request_key, digest(data)
        session.commit()
        return plan_data(session, plan)

    @api.post("/recommendations/{plan_id}/replace")
    def replace(plan_id: str, data: PlanAction, session=Depends(db)):
        return change_plan(plan_id, data, session)

    @api.post("/recommendations/{plan_id}/regenerate")
    def regenerate(plan_id: str, data: PlanAction, session=Depends(db)):
        return change_plan(plan_id, data, session, regenerate=True)

    @api.post("/shopping-list")
    def shopping(data: ShoppingInput, session=Depends(db)):
        previous = None
        if data.record_id:
            record = session.get(MealRecord, data.record_id)
            if not record or record.deleted_at or record.revision != data.revision:
                raise DomainError(409, "STALE_MEAL", "食记已更新，请重新打开")
            previous = record.dishes
        elif data.plan_id:
            plan = get_plan(session, data.plan_id)
            if plan.revision != data.plan_revision:
                raise DomainError(409, "STALE_PLAN", "菜单已更新，请重新打开")
            previous = plan.dishes
        return {"items": shopping_list(session, snapshots(session, data.recipe_ids, previous))}
