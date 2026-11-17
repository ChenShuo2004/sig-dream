"""add tags.sort_order for global manual ordering

Revision ID: 20260211_0021
Revises: 20260507_0019
Create Date: 2026-02-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "20260211_0021"
down_revision = "20260507_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tags",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("tags", "sort_order", server_default=None)
    bind = op.get_bind()
    bind.execute(
        text(
            """
            WITH numbered AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY category ASC, name ASC) AS rn
                FROM tags
            )
            UPDATE tags AS t
            SET sort_order = numbered.rn * 10
            FROM numbered
            WHERE t.id = numbered.id
            """
        )
    )


def downgrade() -> None:
    op.drop_column("tags", "sort_order")
