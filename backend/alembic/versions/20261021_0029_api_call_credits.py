"""Store RunningHub credit consumption on API call logs.

Revision ID: 20261021_0029
Revises: 20261021_0028
Create Date: 2026-10-21
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261021_0029"
down_revision = "20261021_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("api_call_logs", sa.Column("credits", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("api_call_logs", "credits")
