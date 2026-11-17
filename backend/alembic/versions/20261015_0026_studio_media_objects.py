"""studio media objects mirrored to NAS

Revision ID: 20261015_0026
Revises: 20261013_0025
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261015_0026"
down_revision = "20261013_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "studio_media_objects",
        sa.Column("media_key", sa.String(length=96), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("nas_rel_path", sa.String(length=500), nullable=True),
        sa.Column("source_path", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("media_key"),
    )
    op.create_index("ix_studio_media_objects_owner", "studio_media_objects", ["owner"])


def downgrade() -> None:
    op.drop_index("ix_studio_media_objects_owner", table_name="studio_media_objects")
    op.drop_table("studio_media_objects")
