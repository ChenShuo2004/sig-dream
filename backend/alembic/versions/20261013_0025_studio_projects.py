"""studio projects for script / replication / replacement studios

Revision ID: 20261013_0025
Revises: 20260928_0024
Create Date: 2026-10-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261013_0025"
down_revision = "20260928_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "studio_projects",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=False), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_studio_projects_owner", "studio_projects", ["owner"])
    op.create_index("ix_studio_projects_owner_kind", "studio_projects", ["owner", "kind"])


def downgrade() -> None:
    op.drop_index("ix_studio_projects_owner_kind", table_name="studio_projects")
    op.drop_index("ix_studio_projects_owner", table_name="studio_projects")
    op.drop_table("studio_projects")
