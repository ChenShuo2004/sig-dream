"""asset collections tables

Revision ID: 20260504_0015
Revises: 20260501_0014
Create Date: 2026-05-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql


revision = "20260504_0015"
down_revision = "20260501_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_collection_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("group_type", sa.String(length=32), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_group_name", sa.String(length=128), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["parent_id"], ["asset_collection_groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_acg_group_type", "asset_collection_groups", ["group_type"], unique=False)
    op.create_index("ix_acg_owner_user_id", "asset_collection_groups", ["owner_user_id"], unique=False)
    op.create_index("ix_acg_parent_id", "asset_collection_groups", ["parent_id"], unique=False)

    op.create_table(
        "asset_collections",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("collection_type", sa.String(length=32), nullable=False),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("visibility", sa.String(length=32), nullable=False, server_default="private"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["group_id"], ["asset_collection_groups.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ac_collections_group_id", "asset_collections", ["group_id"], unique=False)
    op.create_index("ix_ac_collections_owner_user_id", "asset_collections", ["owner_user_id"], unique=False)
    op.create_index("ix_ac_collections_type_status", "asset_collections", ["collection_type", "status"], unique=False)

    op.create_table(
        "asset_collection_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("collection_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("material_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("material_file_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("added_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["added_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["collection_id"], ["asset_collections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["material_file_id"], ["material_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_aci_collection_id", "asset_collection_items", ["collection_id"], unique=False)
    op.create_index("ix_aci_material_id", "asset_collection_items", ["material_id"], unique=False)
    op.execute(
        text(
            "CREATE UNIQUE INDEX uq_aci_collection_material_whole "
            "ON asset_collection_items (collection_id, material_id) "
            "WHERE material_file_id IS NULL"
        )
    )
    op.execute(
        text(
            "CREATE UNIQUE INDEX uq_aci_collection_material_file "
            "ON asset_collection_items (collection_id, material_id, material_file_id) "
            "WHERE material_file_id IS NOT NULL"
        )
    )

    op.create_table(
        "project_collection_permissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("collection_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_group_name", sa.String(length=128), nullable=False),
        sa.Column("permission_level", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["asset_collections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("collection_id", "user_group_name", name="uq_pcp_collection_group"),
    )


def downgrade() -> None:
    op.drop_table("project_collection_permissions")
    op.execute(text("DROP INDEX IF EXISTS uq_aci_collection_material_file"))
    op.execute(text("DROP INDEX IF EXISTS uq_aci_collection_material_whole"))
    op.drop_index("ix_aci_material_id", table_name="asset_collection_items")
    op.drop_index("ix_aci_collection_id", table_name="asset_collection_items")
    op.drop_table("asset_collection_items")
    op.drop_index("ix_ac_collections_type_status", table_name="asset_collections")
    op.drop_index("ix_ac_collections_owner_user_id", table_name="asset_collections")
    op.drop_index("ix_ac_collections_group_id", table_name="asset_collections")
    op.drop_table("asset_collections")
    op.drop_index("ix_acg_parent_id", table_name="asset_collection_groups")
    op.drop_index("ix_acg_owner_user_id", table_name="asset_collection_groups")
    op.drop_index("ix_acg_group_type", table_name="asset_collection_groups")
    op.drop_table("asset_collection_groups")
