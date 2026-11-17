"""create asset usages table

Revision ID: 20260428_0006
Revises: 20260427_0005
Create Date: 2026-04-28 02:00:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260428_0006"
down_revision: str | Sequence[str] | None = "20260427_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "asset_usages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("material_file_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("usage_type", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["material_file_id"], ["material_files.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_asset_usages_material_id", "asset_usages", ["material_id"], unique=False)
    op.create_index("ix_asset_usages_created_at", "asset_usages", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_asset_usages_created_at", table_name="asset_usages")
    op.drop_index("ix_asset_usages_material_id", table_name="asset_usages")
    op.drop_table("asset_usages")
