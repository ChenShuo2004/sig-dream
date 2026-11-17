"""Canvas, workbench, and voice records, plus NAS-backed canvas media.

Revision ID: 20261021_0027
Revises: 20261015_0026
Create Date: 2026-10-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261021_0027"
down_revision = "20261015_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "canvas_media_objects",
        sa.Column("media_key", sa.String(length=96), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("nas_rel_path", sa.String(length=500), nullable=True),
        sa.Column("source_path", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("media_key"),
    )
    op.create_index("ix_canvas_media_objects_owner", "canvas_media_objects", ["owner"])
    op.create_table(
        "workbench_records",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=False), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workbench_records_owner", "workbench_records", ["owner"])
    op.create_table(
        "voice_records",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=False), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_voice_records_owner", "voice_records", ["owner"])


def downgrade() -> None:
    op.drop_index("ix_voice_records_owner", table_name="voice_records")
    op.drop_table("voice_records")
    op.drop_index("ix_workbench_records_owner", table_name="workbench_records")
    op.drop_table("workbench_records")
    op.drop_index("ix_canvas_media_objects_owner", table_name="canvas_media_objects")
    op.drop_table("canvas_media_objects")
