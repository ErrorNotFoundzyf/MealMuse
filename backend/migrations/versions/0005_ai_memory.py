"""Lightweight per-meal conversational state on the existing plan."""
from alembic import op
import sqlalchemy as sa

revision = "0005_ai_memory"
down_revision = "0004_rule_plans"


def upgrade():
    op.add_column("rule_plans", sa.Column("ai_memory", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("rule_plans", "ai_memory")
