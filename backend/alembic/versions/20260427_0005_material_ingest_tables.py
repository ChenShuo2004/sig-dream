"""create material ingest support tables

Revision ID: 20260427_0005
Revises: 20260427_0004
Create Date: 2026-04-27 21:45:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260427_0005"
down_revision = "20260427_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "material_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_role", sa.String(length=32), nullable=False, server_default=sa.text("'original'")),
        sa.Column("storage_type", sa.String(length=32), nullable=False, server_default=sa.text("'local'")),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.String(length=500), nullable=False),
        sa.Column("extension", sa.String(length=20), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_path"),
    )
    op.create_index("ix_material_files_material_id", "material_files", ["material_id"], unique=False)
    op.create_index("ix_material_files_sha256", "material_files", ["sha256"], unique=False)

    op.create_table(
        "nas_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_type", sa.String(length=64), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_nas_jobs_status", "nas_jobs", ["status"], unique=False)

    op.create_table(
        "asset_operations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("operation_type", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("access_context", sa.String(length=32), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_asset_operations_created_at", "asset_operations", ["created_at"], unique=False)
    op.create_index("ix_asset_operations_target", "asset_operations", ["target_type", "target_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_asset_operations_target", table_name="asset_operations")
    op.drop_index("ix_asset_operations_created_at", table_name="asset_operations")
    op.drop_table("asset_operations")
    op.drop_index("ix_nas_jobs_status", table_name="nas_jobs")
    op.drop_table("nas_jobs")
    op.drop_index("ix_material_files_sha256", table_name="material_files")
    op.drop_index("ix_material_files_material_id", table_name="material_files")
    op.drop_table("material_files")
