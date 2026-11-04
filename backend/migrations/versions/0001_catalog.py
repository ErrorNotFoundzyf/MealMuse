"""M1 household catalogue and profile. No recommendation tables before M2."""
from alembic import op
import sqlalchemy as sa

revision = "0001_catalog"
down_revision = None


def upgrade():
    op.create_table("dish_categories", sa.Column("id", sa.String(), primary_key=True), sa.Column("name", sa.String(), nullable=False),
                    sa.Column("sort_order", sa.Integer(), nullable=False), sa.Column("is_active", sa.Boolean(), nullable=False))
    op.create_table("ingredients", sa.Column("id", sa.String(), primary_key=True), sa.Column("name", sa.String(80), nullable=False),
                    sa.Column("ingredient_category", sa.String()), sa.Column("seasons_json", sa.JSON(), nullable=False),
                    sa.Column("source", sa.String(), nullable=False), sa.Column("is_hidden", sa.Boolean(), nullable=False),
                    sa.Column("created_at", sa.String(), nullable=False), sa.Column("updated_at", sa.String(), nullable=False),
                    sa.Column("deleted_at", sa.String()), sa.CheckConstraint("source IN ('default','family')"))
    op.create_table("ingredient_names", sa.Column("normalized_name", sa.String(), primary_key=True),
                    sa.Column("ingredient_id", sa.String(), sa.ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False),
                    sa.Column("display_name", sa.String(), nullable=False), sa.Column("kind", sa.String(), nullable=False),
                    sa.CheckConstraint("kind IN ('canonical','alias')"))
    op.create_index("ix_ingredient_names_ingredient_id", "ingredient_names", ["ingredient_id"])
    op.create_index("uq_ingredient_canonical", "ingredient_names", ["ingredient_id"], unique=True, sqlite_where=sa.text("kind = 'canonical'"))
    op.create_table("family_meal_profile", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("people_count", sa.Integer(), nullable=False),
                    sa.Column("category_counts_json", sa.JSON(), nullable=False), sa.Column("updated_at", sa.String(), nullable=False),
                    sa.CheckConstraint("id = 1"), sa.CheckConstraint("people_count BETWEEN 1 AND 30"))
    op.create_table("recipes", sa.Column("id", sa.String(), primary_key=True), sa.Column("name", sa.String(100), nullable=False),
                    sa.Column("normalized_name", sa.String(), nullable=False), sa.Column("category_id", sa.String(), sa.ForeignKey("dish_categories.id", ondelete="RESTRICT"), nullable=False),
                    sa.Column("source", sa.String(), nullable=False), sa.Column("steps", sa.Text()), sa.Column("notes", sa.Text()),
                    sa.Column("cook_time_minutes", sa.Integer()), sa.Column("flavor_tags", sa.JSON(), nullable=False),
                    sa.Column("scene_tags", sa.JSON(), nullable=False), sa.Column("constraint_facts", sa.JSON(), nullable=False),
                    sa.Column("is_hidden", sa.Boolean(), nullable=False), sa.Column("created_at", sa.String(), nullable=False),
                    sa.Column("updated_at", sa.String(), nullable=False), sa.Column("deleted_at", sa.String()),
                    sa.CheckConstraint("source IN ('default','family')"), sa.CheckConstraint("cook_time_minutes IS NULL OR cook_time_minutes > 0"))
    op.create_index("ix_recipes_normalized_name", "recipes", ["normalized_name"])
    op.create_index("ix_recipe_visible", "recipes", ["category_id", "is_hidden", "deleted_at"])
    op.create_table("recipe_ingredients", sa.Column("recipe_id", sa.String(), sa.ForeignKey("recipes.id", ondelete="RESTRICT"), primary_key=True),
                    sa.Column("ingredient_id", sa.String(), sa.ForeignKey("ingredients.id", ondelete="RESTRICT"), primary_key=True),
                    sa.Column("is_main", sa.Boolean(), nullable=False), sa.Column("quantity", sa.String()), sa.Column("unit", sa.String()),
                    sa.Column("position", sa.Integer(), nullable=False),
                    sa.CheckConstraint("(quantity IS NULL AND unit IS NULL) OR (quantity IS NOT NULL AND unit IS NOT NULL)"))
    op.create_index("ix_recipe_ingredients_ingredient_id", "recipe_ingredients", ["ingredient_id"])


def downgrade():
    for table in ["recipe_ingredients", "recipes", "family_meal_profile", "ingredient_names", "ingredients", "dish_categories"]:
        op.drop_table(table)
