"""rename six tag categories to new display-oriented names

Revision ID: 20260506_0018
Revises: 20260505_0017
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa


revision = "20260506_0018"
down_revision = "20260505_0017"
branch_labels = None
depends_on = None


_RENAMES: tuple[tuple[str, str], ...] = (
    ("内容对象标签", "外观"),
    ("素材形态标签", "内饰"),
    ("用途标签", "功能"),
    ("场景标签", "场景"),
    ("内容主题标签", "情绪"),
    ("状态标签", "B-roll"),
)


def upgrade() -> None:
    bind = op.get_bind()
    stmt = sa.text("UPDATE tags SET category = :new WHERE category = :old")
    for old, new in _RENAMES:
        bind.execute(stmt, {"old": old, "new": new})


def downgrade() -> None:
    bind = op.get_bind()
    stmt = sa.text("UPDATE tags SET category = :old WHERE category = :new")
    for old, new in _RENAMES:
        bind.execute(stmt, {"old": old, "new": new})
