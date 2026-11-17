"""create operation logs table

Revision ID: 20260428_0008
Revises: 20260428_0007
Create Date: 2026-04-28 17:10:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260428_0008"
down_revision: str | Sequence[str] | None = "20260428_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "operation_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("operation_type", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=False),
        sa.Column("target_name", sa.String(length=255), nullable=True),
        sa.Column("before_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_operation_logs_username", "operation_logs", ["username"], unique=False)
    op.create_index("ix_operation_logs_operation_type", "operation_logs", ["operation_type"], unique=False)
    op.create_index("ix_operation_logs_target_type", "operation_logs", ["target_type"], unique=False)
    op.create_index("ix_operation_logs_target_name", "operation_logs", ["target_name"], unique=False)
    op.create_index("ix_operation_logs_created_at", "operation_logs", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_operation_logs_created_at", table_name="operation_logs")
    op.drop_index("ix_operation_logs_target_name", table_name="operation_logs")
    op.drop_index("ix_operation_logs_target_type", table_name="operation_logs")
    op.drop_index("ix_operation_logs_operation_type", table_name="operation_logs")
    op.drop_index("ix_operation_logs_username", table_name="operation_logs")
    op.drop_table("operation_logs")
