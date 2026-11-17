"""create user_tag_preferences

Revision ID: 20260430_0011
Revises: 20260429_0010
Create Date: 2026-04-30 01:45:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260430_0011"
down_revision = "20260429_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_tag_preferences",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("favorite_tag_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("recent_tag_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_user_tag_preferences_user_id"),
    )
    op.create_index("ix_user_tag_preferences_user_id", "user_tag_preferences", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_tag_preferences_user_id", table_name="user_tag_preferences")
    op.drop_table("user_tag_preferences")
