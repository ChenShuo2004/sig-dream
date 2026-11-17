"""canvas projects and canvas-only assets

Revision ID: 20260928_0024
Revises: 20260923_0023
Create Date: 2026-09-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260928_0024"
down_revision = "20260923_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "canvas_documents",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=False), nullable=True),
        sa.PrimaryKeyConstraint("id", "owner"),
    )
    op.create_index("ix_canvas_documents_owner", "canvas_documents", ["owner"])
    op.create_table(
        "canvas_assets",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("nas_rel_path", sa.String(length=500), nullable=True),
        sa.Column("source_path", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_canvas_assets_owner", "canvas_assets", ["owner"])


def downgrade() -> None:
    op.drop_index("ix_canvas_assets_owner", table_name="canvas_assets")
    op.drop_table("canvas_assets")
    op.drop_index("ix_canvas_documents_owner", table_name="canvas_documents")
    op.drop_table("canvas_documents")
