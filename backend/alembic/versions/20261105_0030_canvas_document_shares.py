"""Add canvas_document_shares for shared infinite canvases.

Revision ID: 20261105_0030
Revises: 20261021_0029
Create Date: 2026-11-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261105_0030"
down_revision = "20261021_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "canvas_document_shares",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("document_id", sa.String(length=64), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )
    op.create_index("ix_canvas_document_shares_document_id", "canvas_document_shares", ["document_id"])
    op.create_index("ix_canvas_document_shares_owner", "canvas_document_shares", ["owner"])
    op.create_index(
        "uq_canvas_document_shares_document_owner",
        "canvas_document_shares",
        ["document_id", "owner"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_canvas_document_shares_document_owner", table_name="canvas_document_shares")
    op.drop_index("ix_canvas_document_shares_owner", table_name="canvas_document_shares")
    op.drop_index("ix_canvas_document_shares_document_id", table_name="canvas_document_shares")
    op.drop_table("canvas_document_shares")
