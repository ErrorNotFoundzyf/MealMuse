// This schema belongs to the new local app; the current development API remains untouched.
// Upgrade migrations must preserve all rows and advance user_version transactionally.
export const LOCAL_SCHEMA_VERSION = 1;
export const LOCAL_SCHEMA_V1 = `
CREATE TABLE local_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE dish_categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE ingredients (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, ingredient_category TEXT, seasons_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'family' CHECK(source IN ('default','family')), is_hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE ingredient_names (normalized_name TEXT PRIMARY KEY NOT NULL, ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT, display_name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('canonical','alias')));
CREATE INDEX ix_ingredient_names_ingredient_id ON ingredient_names(ingredient_id);
CREATE UNIQUE INDEX uq_ingredient_canonical ON ingredient_names(ingredient_id) WHERE kind='canonical';
CREATE TABLE family_meal_profile (id INTEGER PRIMARY KEY CHECK(id=1), people_count INTEGER NOT NULL CHECK(people_count BETWEEN 1 AND 30), category_counts_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE recipes (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES dish_categories(id) ON DELETE RESTRICT, is_hearty INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'family' CHECK(source IN ('default','family')), steps TEXT, notes TEXT, cook_time_minutes INTEGER CHECK(cook_time_minutes IS NULL OR cook_time_minutes > 0), flavor_tags TEXT NOT NULL DEFAULT '[]', scene_tags TEXT NOT NULL DEFAULT '[]', constraint_facts TEXT NOT NULL DEFAULT '[]', is_hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX ix_recipes_normalized_name ON recipes(normalized_name);
CREATE INDEX ix_recipe_visible ON recipes(category_id,is_hidden,deleted_at);
CREATE TABLE recipe_ingredients (recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE RESTRICT, ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT, is_main INTEGER NOT NULL DEFAULT 1, quantity TEXT, unit TEXT, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(recipe_id,ingredient_id), CHECK((quantity IS NULL AND unit IS NULL) OR (quantity IS NOT NULL AND unit IS NOT NULL)));
CREATE INDEX ix_recipe_ingredients_ingredient_id ON recipe_ingredients(ingredient_id);
CREATE TABLE meal_records (id TEXT PRIMARY KEY NOT NULL, meal_date TEXT NOT NULL, people_count INTEGER NOT NULL CHECK(people_count BETWEEN 1 AND 30), dishes TEXT NOT NULL, creation_key TEXT NOT NULL UNIQUE, last_request_key TEXT NOT NULL, payload_hash TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), confirmed_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX ix_meal_records_meal_date ON meal_records(meal_date);
CREATE TABLE rule_plans (id TEXT PRIMARY KEY NOT NULL, creation_key TEXT NOT NULL UNIQUE, creation_hash TEXT NOT NULL, last_request_key TEXT NOT NULL, last_payload_hash TEXT NOT NULL, people_count INTEGER NOT NULL, category_counts TEXT NOT NULL, dishes TEXT NOT NULL, rejected_ids TEXT NOT NULL DEFAULT '[]', rejected_signatures TEXT NOT NULL DEFAULT '[]', allow_nonseasonal INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL, as_of_date TEXT NOT NULL, confirmed_record_id TEXT REFERENCES meal_records(id) ON DELETE RESTRICT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ai_memory TEXT);
`;
