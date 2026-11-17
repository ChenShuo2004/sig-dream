"""asset libraries, library-scoped tags/materials, personal video schema

Revision ID: 20260918_0022
Revises: 20260508_0020
Create Date: 2026-09-18
"""

from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision = "20260918_0022"
down_revision = "20260508_0020"
branch_labels = None
depends_on = None

AUTO_LIBRARY_ID = uuid.uuid5(uuid.NAMESPACE_URL, "lcp.asset-library.auto")
PERSONAL_VIDEO_LIBRARY_ID = uuid.uuid5(uuid.NAMESPACE_URL, "lcp.asset-library.personal_video")


def upgrade() -> None:
    op.create_table(
        "asset_libraries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("schema_profile", sa.String(length=64), nullable=False),
        sa.Column("extra_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_asset_libraries_code"),
    )

    bind = op.get_bind()
    bind.execute(
        text(
            """
            INSERT INTO asset_libraries (id, code, name, schema_profile)
            VALUES
              (:auto_id, 'auto', '汽车素材库', 'auto_tags'),
              (:pv_id, 'personal_video', '个人视频素材库', 'personal_video')
            """
        ),
        {"auto_id": str(AUTO_LIBRARY_ID), "pv_id": str(PERSONAL_VIDEO_LIBRARY_ID)},
    )

    op.create_table(
        "library_taxonomy_nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("library_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["library_id"], ["asset_libraries.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["parent_id"], ["library_taxonomy_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_library_taxonomy_nodes_library_id", "library_taxonomy_nodes", ["library_id"])
    op.create_index("ix_library_taxonomy_nodes_parent_id", "library_taxonomy_nodes", ["parent_id"])
    op.create_index(
        "uq_library_taxonomy_root_name",
        "library_taxonomy_nodes",
        ["library_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
    )
    op.create_index(
        "uq_library_taxonomy_child_name",
        "library_taxonomy_nodes",
        ["library_id", "parent_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NOT NULL"),
    )

    op.add_column(
        "materials",
        sa.Column("library_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("materials", sa.Column("copy_fit", sa.Text(), nullable=True))
    op.add_column(
        "materials",
        sa.Column("keywords", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
    )
    op.add_column("materials", sa.Column("primary_taxonomy_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("materials", sa.Column("secondary_taxonomy_id", postgresql.UUID(as_uuid=True), nullable=True))

    op.add_column("tags", sa.Column("library_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("upload_sessions", sa.Column("library_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("asset_collection_groups", sa.Column("library_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("asset_collections", sa.Column("library_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("user_tag_preferences", sa.Column("library_id", postgresql.UUID(as_uuid=True), nullable=True))

    bind.execute(text("UPDATE materials SET library_id = :lid WHERE library_id IS NULL"), {"lid": str(AUTO_LIBRARY_ID)})
    bind.execute(text("UPDATE tags SET library_id = :lid WHERE library_id IS NULL"), {"lid": str(AUTO_LIBRARY_ID)})
    bind.execute(text("UPDATE upload_sessions SET library_id = :lid WHERE library_id IS NULL"), {"lid": str(AUTO_LIBRARY_ID)})
    bind.execute(
        text("UPDATE asset_collection_groups SET library_id = :lid WHERE library_id IS NULL"),
        {"lid": str(AUTO_LIBRARY_ID)},
    )
    bind.execute(text("UPDATE asset_collections SET library_id = :lid WHERE library_id IS NULL"), {"lid": str(AUTO_LIBRARY_ID)})
    bind.execute(
        text("UPDATE user_tag_preferences SET library_id = :lid WHERE library_id IS NULL"),
        {"lid": str(AUTO_LIBRARY_ID)},
    )

    op.alter_column("materials", "library_id", nullable=False)
    op.alter_column("tags", "library_id", nullable=False)
    op.alter_column("upload_sessions", "library_id", nullable=False)
    op.alter_column("asset_collection_groups", "library_id", nullable=False)
    op.alter_column("asset_collections", "library_id", nullable=False)
    op.alter_column("user_tag_preferences", "library_id", nullable=False)

    op.create_foreign_key("fk_materials_library_id", "materials", "asset_libraries", ["library_id"], ["id"], ondelete="RESTRICT")
    op.create_foreign_key(
        "fk_materials_primary_taxonomy_id",
        "materials",
        "library_taxonomy_nodes",
        ["primary_taxonomy_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_materials_secondary_taxonomy_id",
        "materials",
        "library_taxonomy_nodes",
        ["secondary_taxonomy_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_materials_library_id", "materials", ["library_id"])
    op.create_index("ix_materials_primary_taxonomy_id", "materials", ["primary_taxonomy_id"])
    op.create_index("ix_materials_secondary_taxonomy_id", "materials", ["secondary_taxonomy_id"])

    op.create_foreign_key("fk_tags_library_id", "tags", "asset_libraries", ["library_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_tags_library_id", "tags", ["library_id"])
    op.drop_constraint("tags_name_key", "tags", type_="unique")
    op.drop_constraint("uq_tags_sort_order", "tags", type_="unique")
    op.create_unique_constraint("uq_tags_library_name", "tags", ["library_id", "name"])
    op.create_unique_constraint("uq_tags_library_sort_order", "tags", ["library_id", "sort_order"])

    op.create_foreign_key(
        "fk_upload_sessions_library_id",
        "upload_sessions",
        "asset_libraries",
        ["library_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_upload_sessions_library_id", "upload_sessions", ["library_id"])

    op.create_foreign_key(
        "fk_asset_collection_groups_library_id",
        "asset_collection_groups",
        "asset_libraries",
        ["library_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_asset_collection_groups_library_id", "asset_collection_groups", ["library_id"])
    op.create_foreign_key(
        "fk_asset_collections_library_id",
        "asset_collections",
        "asset_libraries",
        ["library_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_asset_collections_library_id", "asset_collections", ["library_id"])

    op.drop_constraint("uq_user_tag_preferences_user_id", "user_tag_preferences", type_="unique")
    op.create_foreign_key(
        "fk_user_tag_preferences_library_id",
        "user_tag_preferences",
        "asset_libraries",
        ["library_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_user_tag_preferences_library_id", "user_tag_preferences", ["library_id"])
    op.create_unique_constraint(
        "uq_user_tag_preferences_user_library",
        "user_tag_preferences",
        ["user_id", "library_id"],
    )

    pv_unorganized_id = str(uuid.uuid4())
    bind.execute(
        text(
            """
            INSERT INTO tags (id, name, category, status, synonyms, sort_order, library_id, description)
            VALUES (
              CAST(:id AS uuid),
              '未整理',
              '系统状态',
              'active',
              '{}',
              10001,
              CAST(:lid AS uuid),
              '个人视频库系统保留：未整理'
            )
            """
        ),
        {"id": pv_unorganized_id, "lid": str(PERSONAL_VIDEO_LIBRARY_ID)},
    )

    theme_names = ["表达抑制", "讨好", "情绪压抑", "人际边界", "委屈"]
    for idx, name in enumerate(theme_names):
        bind.execute(
            text(
                """
                INSERT INTO tags (id, name, category, status, synonyms, sort_order, library_id, description)
                VALUES (
                  CAST(:id AS uuid),
                  :name,
                  '适用主题',
                  'active',
                  '{}',
                  :sort_order,
                  CAST(:lid AS uuid),
                  :description
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "name": name,
                "sort_order": idx + 1,
                "lid": str(PERSONAL_VIDEO_LIBRARY_ID),
                "description": "个人视频库适用主题",
            },
        )

    l1_id = str(uuid.uuid4())
    l2_id = str(uuid.uuid4())
    l1b_id = str(uuid.uuid4())
    l2b_id = str(uuid.uuid4())
    bind.execute(
        text(
            """
            INSERT INTO library_taxonomy_nodes (id, library_id, parent_id, name, sort_order, description)
            VALUES
              (CAST(:l1 AS uuid), CAST(:lid AS uuid), NULL, '防御机制', 10, '这张图属于哪一种大的心理过程'),
              (CAST(:l2 AS uuid), CAST(:lid AS uuid), CAST(:l1 AS uuid), '假装没事', 10, '这张图具体表达哪一种心理状态/行为'),
              (CAST(:l1b AS uuid), CAST(:lid AS uuid), NULL, '讨好与边界', 20, '人际讨好、委曲求全与边界相关过程'),
              (CAST(:l2b AS uuid), CAST(:lid AS uuid), CAST(:l1b AS uuid), '委曲求全', 10, '为维持关系压抑自我需求')
            """
        ),
        {
            "l1": l1_id,
            "l2": l2_id,
            "l1b": l1b_id,
            "l2b": l2b_id,
            "lid": str(PERSONAL_VIDEO_LIBRARY_ID),
        },
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        text("DELETE FROM tags WHERE library_id = CAST(:lid AS uuid)"),
        {"lid": str(PERSONAL_VIDEO_LIBRARY_ID)},
    )
    bind.execute(
        text("DELETE FROM library_taxonomy_nodes WHERE library_id = CAST(:lid AS uuid)"),
        {"lid": str(PERSONAL_VIDEO_LIBRARY_ID)},
    )

    op.drop_constraint("uq_user_tag_preferences_user_library", "user_tag_preferences", type_="unique")
    op.drop_constraint("fk_user_tag_preferences_library_id", "user_tag_preferences", type_="foreignkey")
    op.drop_index("ix_user_tag_preferences_library_id", table_name="user_tag_preferences")
    op.drop_column("user_tag_preferences", "library_id")
    op.create_unique_constraint("uq_user_tag_preferences_user_id", "user_tag_preferences", ["user_id"])

    op.drop_constraint("fk_asset_collections_library_id", "asset_collections", type_="foreignkey")
    op.drop_index("ix_asset_collections_library_id", table_name="asset_collections")
    op.drop_column("asset_collections", "library_id")
    op.drop_constraint("fk_asset_collection_groups_library_id", "asset_collection_groups", type_="foreignkey")
    op.drop_index("ix_asset_collection_groups_library_id", table_name="asset_collection_groups")
    op.drop_column("asset_collection_groups", "library_id")

    op.drop_constraint("fk_upload_sessions_library_id", "upload_sessions", type_="foreignkey")
    op.drop_index("ix_upload_sessions_library_id", table_name="upload_sessions")
    op.drop_column("upload_sessions", "library_id")

    op.drop_constraint("uq_tags_library_sort_order", "tags", type_="unique")
    op.drop_constraint("uq_tags_library_name", "tags", type_="unique")
    op.drop_constraint("fk_tags_library_id", "tags", type_="foreignkey")
    op.drop_index("ix_tags_library_id", table_name="tags")
    op.drop_column("tags", "library_id")
    op.create_unique_constraint("tags_name_key", "tags", ["name"])
    op.create_unique_constraint("uq_tags_sort_order", "tags", ["sort_order"])

    op.drop_constraint("fk_materials_secondary_taxonomy_id", "materials", type_="foreignkey")
    op.drop_constraint("fk_materials_primary_taxonomy_id", "materials", type_="foreignkey")
    op.drop_constraint("fk_materials_library_id", "materials", type_="foreignkey")
    op.drop_index("ix_materials_secondary_taxonomy_id", table_name="materials")
    op.drop_index("ix_materials_primary_taxonomy_id", table_name="materials")
    op.drop_index("ix_materials_library_id", table_name="materials")
    op.drop_column("materials", "secondary_taxonomy_id")
    op.drop_column("materials", "primary_taxonomy_id")
    op.drop_column("materials", "keywords")
    op.drop_column("materials", "copy_fit")
    op.drop_column("materials", "library_id")

    op.drop_index("uq_library_taxonomy_child_name", table_name="library_taxonomy_nodes")
    op.drop_index("uq_library_taxonomy_root_name", table_name="library_taxonomy_nodes")
    op.drop_index("ix_library_taxonomy_nodes_parent_id", table_name="library_taxonomy_nodes")
    op.drop_index("ix_library_taxonomy_nodes_library_id", table_name="library_taxonomy_nodes")
    op.drop_table("library_taxonomy_nodes")
    op.drop_table("asset_libraries")
