"""create sync_operations and nas retry fields

Revision ID: 20260429_0010
Revises: 20260428_0009
Create Date: 2026-04-29 18:35:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260429_0010"
down_revision = "20260428_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_operations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operation_id", sa.String(length=128), nullable=False),
        sa.Column("operation_type", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=False),
        sa.Column("target_id", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="sync_pending"),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("next_retry_at", sa.DateTime(timezone=False), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("operation_id", name="uq_sync_operations_operation_id"),
    )
    op.create_index("ix_sync_operations_operation_id", "sync_operations", ["operation_id"], unique=False)
    op.create_index("ix_sync_operations_operation_type", "sync_operations", ["operation_type"], unique=False)
    op.create_index("ix_sync_operations_target_type", "sync_operations", ["target_type"], unique=False)
    op.create_index("ix_sync_operations_target_id", "sync_operations", ["target_id"], unique=False)
    op.create_index("ix_sync_operations_status", "sync_operations", ["status"], unique=False)
    op.create_index("ix_sync_operations_next_retry_at", "sync_operations", ["next_retry_at"], unique=False)

    op.add_column("nas_jobs", sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("nas_jobs", sa.Column("max_retries", sa.Integer(), nullable=False, server_default="8"))
    op.add_column("nas_jobs", sa.Column("next_retry_at", sa.DateTime(timezone=False), nullable=True))
    op.add_column("nas_jobs", sa.Column("is_deadletter", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("nas_jobs", sa.Column("sync_operation_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_nas_jobs_sync_operation_id",
        "nas_jobs",
        "sync_operations",
        ["sync_operation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_nas_jobs_next_retry_at", "nas_jobs", ["next_retry_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_nas_jobs_next_retry_at", table_name="nas_jobs")
    op.drop_constraint("fk_nas_jobs_sync_operation_id", "nas_jobs", type_="foreignkey")
    op.drop_column("nas_jobs", "sync_operation_id")
    op.drop_column("nas_jobs", "is_deadletter")
    op.drop_column("nas_jobs", "next_retry_at")
    op.drop_column("nas_jobs", "max_retries")
    op.drop_column("nas_jobs", "retry_count")

    op.drop_index("ix_sync_operations_next_retry_at", table_name="sync_operations")
    op.drop_index("ix_sync_operations_status", table_name="sync_operations")
    op.drop_index("ix_sync_operations_target_id", table_name="sync_operations")
    op.drop_index("ix_sync_operations_target_type", table_name="sync_operations")
    op.drop_index("ix_sync_operations_operation_type", table_name="sync_operations")
    op.drop_index("ix_sync_operations_operation_id", table_name="sync_operations")
    op.drop_table("sync_operations")
