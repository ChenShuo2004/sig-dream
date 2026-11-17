"""user tutorial progress

Revision ID: 20260505_0017
Revises: 20260504_0016
Create Date: 2026-05-05
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260505_0017"
down_revision = "20260504_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_tutorial_progress",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tutorial_key", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="not_started"),
        sa.Column("last_step", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "tutorial_key", name="uq_user_tutorial_progress_user_key"),
    )
    op.create_index("ix_user_tutorial_progress_user_id", "user_tutorial_progress", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_tutorial_progress_user_id", table_name="user_tutorial_progress")
    op.drop_table("user_tutorial_progress")
