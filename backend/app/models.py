from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, JSON, String, Text, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return str(uuid4())


class Ingredient(Base):
    __tablename__ = "ingredients"
    __table_args__ = (CheckConstraint("source IN ('default','family')"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(80))
    ingredient_category: Mapped[str | None] = mapped_column(String, nullable=True)
    seasons: Mapped[list] = mapped_column("seasons_json", JSON, default=list)
    source: Mapped[str] = mapped_column(String, default="family")
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now, onupdate=now)
    deleted_at: Mapped[str | None] = mapped_column(String, nullable=True)


class IngredientName(Base):
    __tablename__ = "ingredient_names"
    __table_args__ = (
        CheckConstraint("kind IN ('canonical','alias')"),
        Index("uq_ingredient_canonical", "ingredient_id", unique=True,
              sqlite_where=text("kind = 'canonical'")),
    )
    normalized_name: Mapped[str] = mapped_column(String, primary_key=True)
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id", ondelete="RESTRICT"), index=True)
    display_name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)


class DishCategory(Base):
    __tablename__ = "dish_categories"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    sort_order: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Profile(Base):
    __tablename__ = "family_meal_profile"
    __table_args__ = (CheckConstraint("id = 1"), CheckConstraint("people_count BETWEEN 1 AND 30"))
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    people_count: Mapped[int] = mapped_column(Integer)
    category_counts: Mapped[dict] = mapped_column("category_counts_json", JSON)
    updated_at: Mapped[str] = mapped_column(String, default=now, onupdate=now)


class Recipe(Base):
    __tablename__ = "recipes"
    __table_args__ = (
        CheckConstraint("source IN ('default','family')"),
        CheckConstraint("cook_time_minutes IS NULL OR cook_time_minutes > 0"),
        Index("ix_recipe_visible", "category_id", "is_hidden", "deleted_at"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100))
    normalized_name: Mapped[str] = mapped_column(String, index=True)
    category_id: Mapped[str] = mapped_column(ForeignKey("dish_categories.id", ondelete="RESTRICT"))
    is_hearty: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String, default="family")
    steps: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    cook_time_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    flavor_tags: Mapped[list] = mapped_column(JSON, default=list)
    scene_tags: Mapped[list] = mapped_column(JSON, default=list)
    constraint_facts: Mapped[list] = mapped_column(JSON, default=list)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now, onupdate=now)
    deleted_at: Mapped[str | None] = mapped_column(String, nullable=True)


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"
    __table_args__ = (CheckConstraint(
        "(quantity IS NULL AND unit IS NULL) OR (quantity IS NOT NULL AND unit IS NOT NULL)"
    ),)
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id", ondelete="RESTRICT"), primary_key=True)
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id", ondelete="RESTRICT"), primary_key=True, index=True)
    is_main: Mapped[bool] = mapped_column(Boolean, default=True)
    quantity: Mapped[str | None] = mapped_column(String, nullable=True)
    unit: Mapped[str | None] = mapped_column(String, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class MealRecord(Base):
    __tablename__ = "meal_records"
    __table_args__ = (CheckConstraint("people_count BETWEEN 1 AND 30"), CheckConstraint("revision > 0"))
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    meal_date: Mapped[str] = mapped_column(String(10), index=True)
    people_count: Mapped[int] = mapped_column(Integer)
    dishes: Mapped[list] = mapped_column(JSON)
    creation_key: Mapped[str] = mapped_column(String(80), unique=True)
    last_request_key: Mapped[str] = mapped_column(String(80))
    payload_hash: Mapped[str] = mapped_column(String(64))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    confirmed_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)
    deleted_at: Mapped[str | None] = mapped_column(String, nullable=True)


class RulePlan(Base):
    __tablename__ = "rule_plans"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    creation_key: Mapped[str] = mapped_column(String(80), unique=True)
    creation_hash: Mapped[str] = mapped_column(String(64))
    last_request_key: Mapped[str] = mapped_column(String(80))
    last_payload_hash: Mapped[str] = mapped_column(String(64))
    people_count: Mapped[int] = mapped_column(Integer)
    category_counts: Mapped[dict] = mapped_column(JSON)
    dishes: Mapped[list] = mapped_column(JSON)
    rejected_ids: Mapped[list] = mapped_column(JSON, default=list)
    rejected_signatures: Mapped[list] = mapped_column(JSON, default=list)
    allow_nonseasonal: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    as_of_date: Mapped[str] = mapped_column(String(10))
    confirmed_record_id: Mapped[str | None] = mapped_column(ForeignKey("meal_records.id", ondelete="RESTRICT"), nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)
