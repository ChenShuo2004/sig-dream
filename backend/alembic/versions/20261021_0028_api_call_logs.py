"""API call logs for generation requests.

Revision ID: 20261021_0028
Revises: 20261021_0027
Create Date: 2026-10-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261021_0028"
down_revision = "20261021_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_call_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("capability", sa.String(length=16), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("provider", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("model", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("endpoint", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("task_id", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prompt_excerpt", sa.Text(), nullable=False, server_default=""),
        sa.Column("parameters", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("ip_address", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_api_call_logs_username", "api_call_logs", ["username"])
    op.create_index("ix_api_call_logs_capability", "api_call_logs", ["capability"])
    op.create_index("ix_api_call_logs_provider", "api_call_logs", ["provider"])
    op.create_index("ix_api_call_logs_status", "api_call_logs", ["status"])
    op.create_index("ix_api_call_logs_task_id", "api_call_logs", ["task_id"])
    op.create_index("ix_api_call_logs_created_at", "api_call_logs", ["created_at"])
    op.create_index("ix_api_call_logs_model", "api_call_logs", ["model"])


def downgrade() -> None:
    op.drop_index("ix_api_call_logs_model", table_name="api_call_logs")
    op.drop_index("ix_api_call_logs_created_at", table_name="api_call_logs")
    op.drop_index("ix_api_call_logs_task_id", table_name="api_call_logs")
    op.drop_index("ix_api_call_logs_status", table_name="api_call_logs")
    op.drop_index("ix_api_call_logs_provider", table_name="api_call_logs")
    op.drop_index("ix_api_call_logs_capability", table_name="api_call_logs")
    op.drop_index("ix_api_call_logs_username", table_name="api_call_logs")
    op.drop_table("api_call_logs")
