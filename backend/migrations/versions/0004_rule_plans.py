"""Versioned rule recommendations, separate from confirmed meals."""
from alembic import op
import sqlalchemy as sa

revision = "0004_rule_plans"
down_revision = "0003_hearty_tag"


def upgrade():
    op.create_table("rule_plans",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("creation_key", sa.String(80), nullable=False, unique=True),
        sa.Column("creation_hash", sa.String(64), nullable=False),
        sa.Column("last_request_key", sa.String(80), nullable=False),
        sa.Column("last_payload_hash", sa.String(64), nullable=False),
        sa.Column("people_count", sa.Integer(), nullable=False),
        sa.Column("category_counts", sa.JSON(), nullable=False),
        sa.Column("dishes", sa.JSON(), nullable=False),
        sa.Column("rejected_ids", sa.JSON(), nullable=False),
        sa.Column("rejected_signatures", sa.JSON(), nullable=False),
        sa.Column("allow_nonseasonal", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("as_of_date", sa.String(10), nullable=False),
        sa.Column("confirmed_record_id", sa.String(), sa.ForeignKey("meal_records.id", ondelete="RESTRICT")),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False))


def downgrade():
    op.drop_table("rule_plans")
