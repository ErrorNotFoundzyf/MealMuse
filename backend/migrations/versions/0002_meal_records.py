"""Confirmed menu snapshots; preserve history independently of catalogue edits."""
from alembic import op
import sqlalchemy as sa

revision = "0002_meal_records"
down_revision = "0001_catalog"


def upgrade():
    op.create_table("meal_records",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("meal_date", sa.String(10), nullable=False),
        sa.Column("people_count", sa.Integer(), nullable=False),
        sa.Column("dishes", sa.JSON(), nullable=False),
        sa.Column("creation_key", sa.String(80), nullable=False, unique=True),
        sa.Column("last_request_key", sa.String(80), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("confirmed_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("deleted_at", sa.String()),
        sa.CheckConstraint("people_count BETWEEN 1 AND 30"), sa.CheckConstraint("revision > 0"))
    op.create_index("ix_meal_records_meal_date", "meal_records", ["meal_date"])


def downgrade():
    op.drop_table("meal_records")
