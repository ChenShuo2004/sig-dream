"""nas_file_service_nodes: optional public (WAN) upload/download base URLs

Revision ID: 20260501_0014
Revises: 20260501_0013
Create Date: 2026-05-01
"""

import sqlalchemy as sa
from alembic import op

revision = "20260501_0014"
down_revision = "20260501_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "nas_file_service_nodes",
        sa.Column("public_upload_base_url", sa.Text(), nullable=False, server_default=""),
    )
    op.add_column(
        "nas_file_service_nodes",
        sa.Column("public_download_base_url", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("nas_file_service_nodes", "public_download_base_url")
    op.drop_column("nas_file_service_nodes", "public_upload_base_url")
