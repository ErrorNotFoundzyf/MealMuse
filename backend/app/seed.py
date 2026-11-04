"""Small editable starting catalogue; season data is a household reference, not live supply."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import DishCategory, Ingredient, IngredientName, Recipe, RecipeIngredient
from .schemas import normalize

INGREDIENTS = [
    ("tomato", "西红柿", "vegetable", ["summer", "autumn"], ["番茄"]),
    ("egg", "鸡蛋", "egg", ["all_year"], []),
    ("tofu", "豆腐", "soy", ["all_year"], []),
    ("broccoli", "西兰花", "vegetable", ["autumn", "winter", "spring"], []),
    ("carrot", "胡萝卜", "vegetable", ["autumn", "winter"], []),
    ("potato", "土豆", "vegetable", ["all_year"], ["马铃薯"]),
    ("cabbage", "大白菜", "vegetable", ["autumn", "winter"], []),
    ("spinach", "菠菜", "vegetable", ["spring", "autumn", "winter"], []),
    ("water_spinach", "空心菜", "vegetable", ["summer"], []),
    ("cucumber", "黄瓜", "vegetable", ["summer", "autumn"], []),
    ("winter_melon", "冬瓜", "vegetable", ["summer", "autumn"], []),
    ("radish", "白萝卜", "vegetable", ["autumn", "winter"], []),
    ("enoki", "金针菇", "mushroom", ["all_year"], []),
    ("shiitake", "香菇", "mushroom", ["all_year"], []),
    ("pork", "猪肉", "meat", ["all_year"], []),
    ("ribs", "排骨", "meat", ["all_year"], []),
    ("chicken", "鸡肉", "meat", ["all_year"], []),
    ("beef", "牛肉", "meat", ["all_year"], []),
    ("shrimp", "虾", "seafood", [], []),
    ("shrimp_paste", "虾滑", "seafood", ["all_year"], []),
    ("rice", "大米", "staple", ["all_year"], []),
    ("star_anise", "八角", "seasoning", ["all_year"], []),
    ("cinnamon", "桂皮", "seasoning", ["all_year"], []),
    ("seaweed", "紫菜", "other", ["all_year"], []),
]
RECIPES = [
    ("tomato_egg", "西红柿炒鸡蛋", "meat", ["tomato", "egg"]),
    ("shiitake_chicken", "香菇炖鸡", "meat", ["shiitake", "chicken"]),
    ("potato_beef", "土豆炖牛肉", "meat", ["potato", "beef"]),
    ("radish_ribs", "萝卜炖排骨", "meat", ["radish", "ribs"]),
    ("broccoli", "清炒西兰花", "vegetable", ["broccoli"]),
    ("cabbage_tofu", "白菜炖豆腐", "vegetable", ["cabbage", "tofu"]),
    ("spinach", "清炒菠菜", "vegetable", ["spinach"]),
    ("potato", "清炒土豆丝", "vegetable", ["potato"]),
    ("cucumber", "清炒黄瓜", "vegetable", ["cucumber"]),
    ("seaweed_egg_soup", "紫菜蛋花汤", "soup", ["seaweed", "egg"]),
    ("melon_ribs_soup", "冬瓜排骨汤", "soup", ["winter_melon", "ribs"]),
    ("enoki_tofu_soup", "金针菇豆腐汤", "soup", ["enoki", "tofu"]),
]


def seed(session: Session):
    for index, (key, name) in enumerate([("meat", "荤菜"), ("vegetable", "素菜"), ("soup", "汤"), ("staple", "主食"), ("hearty", "硬菜"), ("fruit", "水果"), ("dessert", "甜点")]):
        if not session.get(DishCategory, key):
            session.add(DishCategory(id=key, name=name, sort_order=index))
    session.flush()
    for key, name, category, seasons, aliases in INGREDIENTS:
        ingredient_id = f"i_{key}"
        if session.get(Ingredient, ingredient_id):
            continue  # Never overwrite household edits or restore hidden/deleted entries.
        if session.get(IngredientName, normalize(name)):
            continue  # An existing user entry already owns this name.
        session.add(Ingredient(id=ingredient_id, name=name, ingredient_category=category, seasons=seasons, source="default"))
        session.flush()
        for value, kind in [(name, "canonical"), *[(alias, "alias") for alias in aliases]]:
            session.add(IngredientName(normalized_name=normalize(value), ingredient_id=ingredient_id, display_name=value, kind=kind))
    session.flush()
    for key, name, category, ingredients in RECIPES:
        recipe_id = f"r_{key}"
        if session.get(Recipe, recipe_id):
            continue
        session.add(Recipe(id=recipe_id, name=name, normalized_name=normalize(name), category_id=category, source="default"))
        session.flush()
        for position, ingredient in enumerate(ingredients):
            session.add(RecipeIngredient(recipe_id=recipe_id, ingredient_id=f"i_{ingredient}", is_main=True, position=position))
    session.commit()
