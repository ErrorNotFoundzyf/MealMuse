"""Optional hearty tag in addition to one recipe category."""
from alembic import op
import sqlalchemy as sa

revision = "0003_hearty_tag"
down_revision = "0002_meal_records"


def upgrade():
    op.add_column("recipes", sa.Column("is_hearty", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("recipes", "is_hearty")
