"""tags.sort_order 按分类号段回填 + 全局唯一约束

Revision ID: 20260508_0020
Revises: 20260211_0021
Create Date: 2026-05-08

号段与 app.services.tag_service._TAG_CATEGORY_SORT_BANDS 一致。
"""

from alembic import op
from sqlalchemy import text

revision = "20260508_0020"
down_revision = "20260211_0021"
branch_labels = None
depends_on = None

_BANDS: dict[str, tuple[int, int]] = {
    "品牌": (1, 999),
    "车型": (1001, 9999),
    "版本": (10001, 19999),
    "外观": (20001, 29999),
    "内饰": (30001, 39999),
    "功能": (40001, 49999),
    "场景": (50001, 59999),
    "情绪": (60001, 69999),
    "B-roll": (70001, 79999),
    "系统状态": (80001, 89999),
}

_ORPHAN_BASE = 900_000


def upgrade() -> None:
    bind = op.get_bind()
    for cat, (lo, hi) in _BANDS.items():
        rows = bind.execute(
            text("SELECT id FROM tags WHERE category = :cat ORDER BY sort_order ASC, name ASC"),
            {"cat": cat},
        ).fetchall()
        for i, (rid,) in enumerate(rows):
            so = lo + i
            if so > hi:
                raise RuntimeError(f"tags.sort_order band overflow for category={cat!r} count={len(rows)}")
            bind.execute(text("UPDATE tags SET sort_order = :so WHERE id = :id"), {"so": so, "id": rid})

    known_sql = ", ".join(f"'{k}'" for k in _BANDS.keys())
    orphans = bind.execute(
        text(f"SELECT id FROM tags WHERE category NOT IN ({known_sql}) ORDER BY name ASC"),
    ).fetchall()
    for i, (rid,) in enumerate(orphans):
        bind.execute(
            text("UPDATE tags SET sort_order = :so WHERE id = :id"),
            {"so": _ORPHAN_BASE + i, "id": rid},
        )

    op.create_unique_constraint("uq_tags_sort_order", "tags", ["sort_order"])


def downgrade() -> None:
    op.drop_constraint("uq_tags_sort_order", "tags", type_="unique")
