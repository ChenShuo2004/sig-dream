"""create tags and materials tables

Revision ID: 20260427_0002
Revises: 20260425_0001
Create Date: 2026-04-27 16:45:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260427_0002"
down_revision = "20260425_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'active'")),
        sa.Column("synonyms", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_tags_category", "tags", ["category"], unique=False)

    op.create_table(
        "materials",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'available'")),
        sa.Column("download_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("uploader", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_materials_status", "materials", ["status"], unique=False)

    op.create_table(
        "material_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("material_id", "tag_id", name="uq_material_tag"),
    )
    op.create_index("ix_material_tags_material_id", "material_tags", ["material_id"], unique=False)
    op.create_index("ix_material_tags_tag_id", "material_tags", ["tag_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_material_tags_tag_id", table_name="material_tags")
    op.drop_index("ix_material_tags_material_id", table_name="material_tags")
    op.drop_table("material_tags")
    op.drop_index("ix_materials_status", table_name="materials")
    op.drop_table("materials")
    op.drop_index("ix_tags_category", table_name="tags")
    op.drop_table("tags")
