"""nas_file_service_nodes + materials.storage_pool_id

Revision ID: 20260501_0013
Revises: 20260430_0012
Create Date: 2026-05-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260501_0013"
down_revision = "20260430_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nas_file_service_nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pool_id", sa.String(length=64), nullable=False, server_default="default"),
        sa.Column("node_id", sa.String(length=128), nullable=False),
        sa.Column("lan_upload_base_url", sa.Text(), nullable=False),
        sa.Column("lan_download_base_url", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="online"),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pool_id", "node_id", name="uq_nas_file_service_node_pool_node"),
    )
    op.create_index("ix_nas_file_service_nodes_pool_last_seen", "nas_file_service_nodes", ["pool_id", "last_seen_at"])

    op.add_column(
        "materials",
        sa.Column("storage_pool_id", sa.String(length=64), nullable=False, server_default="default"),
    )


def downgrade() -> None:
    op.drop_column("materials", "storage_pool_id")
    op.drop_index("ix_nas_file_service_nodes_pool_last_seen", table_name="nas_file_service_nodes")
    op.drop_table("nas_file_service_nodes")
