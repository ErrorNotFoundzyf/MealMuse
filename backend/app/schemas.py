from decimal import Decimal
from typing import Annotated, Literal
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator

Season = Literal["spring", "summer", "autumn", "winter", "all_year"]
IngredientCategory = Literal["vegetable", "meat", "seafood", "mushroom", "egg", "soy", "staple", "seasoning", "fruit", "other"]


def normalize(value: str):
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class IngredientCreate(Input):
    name: str = Field(min_length=1, max_length=80)
    ingredient_category: IngredientCategory | None = None
    seasons: list[Season] = Field(default_factory=list, max_length=4)

    @field_validator("seasons")
    @classmethod
    def valid_seasons(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("季节不能重复")
        if "all_year" in value and len(value) != 1:
            raise ValueError("全年不能与其他季节同时选择")
        return value


class IngredientPatch(IngredientCreate):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    is_hidden: bool | None = None

    @model_validator(mode="after")
    def non_nullable(self):
        for key in ("name", "seasons", "is_hidden"):
            if key in self.model_fields_set and getattr(self, key) is None:
                raise ValueError(f"{key}不能为null")
        return self


class ProfileInput(Input):
    people_count: Annotated[StrictInt, Field(ge=1, le=30)]
    category_counts: dict[str, Annotated[StrictInt, Field(ge=0, le=20)]]

    @field_validator("category_counts")
    @classmethod
    def valid_counts(cls, value):
        # Accept older clients while excluding staple dishes from household defaults.
        value = {key: count for key, count in value.items() if key != "staple"}
        if not 1 <= sum(value.values()) <= 20:
            raise ValueError("总菜数必须在1到20之间")
        return value


class RecipeIngredientInput(Input):
    ingredient_id: str = Field(min_length=1)
    is_main: bool = True
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=3)
    unit: str | None = Field(default=None, min_length=1, max_length=20)

    @model_validator(mode="after")
    def paired(self):
        if (self.quantity is None) != (self.unit is None):
            raise ValueError("用量和单位需要一起填写或一起留空")
        return self


class RecipeCreate(Input):
    name: str = Field(min_length=1, max_length=100)
    category_id: str = Field(min_length=1, max_length=40)
    is_hearty: StrictBool = False
    ingredients: list[RecipeIngredientInput] = Field(min_length=1, max_length=50)
    steps: str | None = Field(default=None, max_length=10000)
    notes: str | None = Field(default=None, max_length=2000)
    cook_time_minutes: Annotated[StrictInt, Field(gt=0, le=1440)] | None = None
    flavor_tags: list[str] = Field(default_factory=list, max_length=20)
    scene_tags: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("ingredients")
    @classmethod
    def valid_ingredients(cls, value):
        if len({item.ingredient_id for item in value}) != len(value):
            raise ValueError("同一道菜的食材不能重复")
        if not any(item.is_main for item in value):
            raise ValueError("至少选择一项主要食材")
        return value


class RecipePatch(Input):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    category_id: str | None = None
    is_hearty: StrictBool | None = None
    ingredients: list[RecipeIngredientInput] | None = None
    steps: str | None = Field(default=None, max_length=10000)
    notes: str | None = Field(default=None, max_length=2000)
    cook_time_minutes: Annotated[StrictInt, Field(gt=0, le=1440)] | None = None
    flavor_tags: list[str] | None = Field(default=None, max_length=20)
    scene_tags: list[str] | None = Field(default=None, max_length=20)
    is_hidden: bool | None = None

    @model_validator(mode="after")
    def non_nullable(self):
        for key in ("name", "category_id", "is_hearty", "ingredients", "flavor_tags", "scene_tags", "is_hidden"):
            if key in self.model_fields_set and getattr(self, key) is None:
                raise ValueError(f"{key}不能为null")
        return self
