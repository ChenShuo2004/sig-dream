"""asset_collection_groups status for archive / soft delete

Revision ID: 20260504_0016
Revises: 20260504_0015
Create Date: 2026-05-04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260504_0016"
down_revision = "20260504_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset_collection_groups",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
    )


def downgrade() -> None:
    op.drop_column("asset_collection_groups", "status")
