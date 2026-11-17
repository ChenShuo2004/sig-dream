"""create users table

Revision ID: 20260427_0003
Revises: 20260427_0002
Create Date: 2026-04-27 18:05:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260427_0003"
down_revision = "20260427_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=128), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default=sa.text("'member'")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    # Seed default users for phase-2 migration landing.
    op.execute(
        """
        INSERT INTO users (id, username, password_hash, role, is_active)
        VALUES
            ('00000000-0000-0000-0000-000000000001', 'admin', md5('admin123'), 'super_admin', true),
            ('00000000-0000-0000-0000-000000000002', 'manager', md5('manager123'), 'material_admin', true),
            ('00000000-0000-0000-0000-000000000003', 'member', md5('member123'), 'member', true)
        ON CONFLICT (username) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
