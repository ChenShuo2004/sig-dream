"""tags.description + 系统状态分类 + V1 标签目录种子（对齐仓库《标签说明.md》）

Revision ID: 20260507_0019
Revises: 20260506_0018
Create Date: 2026-05-07
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

from app.data.tag_catalog_seed import iter_tag_catalog_seed_rows

revision = "20260507_0019"
down_revision = "20260506_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tags",
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.alter_column("tags", "description", server_default=None)

    bind = op.get_bind()
    for name, category, desc in iter_tag_catalog_seed_rows():
        bind.execute(
            text(
                """
                INSERT INTO tags (id, name, category, status, synonyms, created_at, description)
                VALUES (gen_random_uuid(), :name, :category, 'active', ARRAY[]::text[], NOW(), :description)
                ON CONFLICT (name) DO UPDATE SET
                    category = EXCLUDED.category,
                    description = EXCLUDED.description
                """
            ),
            {"name": name, "category": category, "description": desc},
        )

    bind.execute(
        text(
            """
            UPDATE tags
            SET category = '系统状态',
                description = :desc
            WHERE name = '未整理'
            """
        ),
        {"desc": "团员暂无法判断业务分类时可选用；完成整理后应替换为具体业务标签。"},
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(text("UPDATE tags SET category = 'B-roll' WHERE name = '未整理'"))
    op.drop_column("tags", "description")
