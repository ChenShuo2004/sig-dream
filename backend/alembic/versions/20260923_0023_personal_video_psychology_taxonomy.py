"""personal_video 一二级心理分类树（触发～修复与成长）

Revision ID: 20260923_0023
Revises: 20260918_0022
Create Date: 2026-09-23
"""

from __future__ import annotations

import uuid

from alembic import op
from sqlalchemy import text

from app.data.personal_video_taxonomy_seed import iter_personal_video_taxonomy

revision = "20260923_0023"
down_revision = "20260918_0022"
branch_labels = None
depends_on = None

PERSONAL_VIDEO_LIBRARY_ID = uuid.uuid5(uuid.NAMESPACE_URL, "lcp.asset-library.personal_video")
DEMO_ROOTS_TO_DROP_IF_UNUSED = ("讨好与边界",)


def upgrade() -> None:
    bind = op.get_bind()
    lid = str(PERSONAL_VIDEO_LIBRARY_ID)

    for idx, (primary, english, children) in enumerate(iter_personal_video_taxonomy()):
        root_sort = (idx + 1) * 10
        existing = bind.execute(
            text(
                """
                SELECT id::text
                FROM library_taxonomy_nodes
                WHERE library_id = CAST(:lid AS uuid)
                  AND parent_id IS NULL
                  AND name = :name
                """
            ),
            {"lid": lid, "name": primary},
        ).scalar()
        if existing:
            root_id = str(existing)
            bind.execute(
                text(
                    """
                    UPDATE library_taxonomy_nodes
                    SET sort_order = :sort_order,
                        description = :description
                    WHERE id = CAST(:id AS uuid)
                    """
                ),
                {
                    "id": root_id,
                    "sort_order": root_sort,
                    "description": english,
                },
            )
        else:
            root_id = str(uuid.uuid4())
            bind.execute(
                text(
                    """
                    INSERT INTO library_taxonomy_nodes
                      (id, library_id, parent_id, name, sort_order, description)
                    VALUES
                      (CAST(:id AS uuid), CAST(:lid AS uuid), NULL, :name, :sort_order, :description)
                    """
                ),
                {
                    "id": root_id,
                    "lid": lid,
                    "name": primary,
                    "sort_order": root_sort,
                    "description": english,
                },
            )

        for cidx, child in enumerate(children):
            child_sort = (cidx + 1) * 10
            child_id = bind.execute(
                text(
                    """
                    SELECT id::text
                    FROM library_taxonomy_nodes
                    WHERE library_id = CAST(:lid AS uuid)
                      AND parent_id = CAST(:pid AS uuid)
                      AND name = :name
                    """
                ),
                {"lid": lid, "pid": root_id, "name": child},
            ).scalar()
            if child_id:
                bind.execute(
                    text(
                        """
                        UPDATE library_taxonomy_nodes
                        SET sort_order = :sort_order
                        WHERE id = CAST(:id AS uuid)
                        """
                    ),
                    {"id": str(child_id), "sort_order": child_sort},
                )
                continue
            bind.execute(
                text(
                    """
                    INSERT INTO library_taxonomy_nodes
                      (id, library_id, parent_id, name, sort_order, description)
                    VALUES
                      (CAST(:id AS uuid), CAST(:lid AS uuid), CAST(:pid AS uuid), :name, :sort_order, '')
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "lid": lid,
                    "pid": root_id,
                    "name": child,
                    "sort_order": child_sort,
                },
            )

    for root_name in DEMO_ROOTS_TO_DROP_IF_UNUSED:
        root_id = bind.execute(
            text(
                """
                SELECT id::text
                FROM library_taxonomy_nodes
                WHERE library_id = CAST(:lid AS uuid)
                  AND parent_id IS NULL
                  AND name = :name
                """
            ),
            {"lid": lid, "name": root_name},
        ).scalar()
        if not root_id:
            continue
        child_ids = list(
            bind.execute(
                text(
                    """
                    SELECT id::text
                    FROM library_taxonomy_nodes
                    WHERE parent_id = CAST(:pid AS uuid)
                    """
                ),
                {"pid": str(root_id)},
            ).scalars()
        )
        for cid in child_ids:
            used = bind.execute(
                text(
                    """
                    SELECT 1 FROM materials
                    WHERE primary_taxonomy_id = CAST(:id AS uuid)
                       OR secondary_taxonomy_id = CAST(:id AS uuid)
                    LIMIT 1
                    """
                ),
                {"id": cid},
            ).scalar()
            if used:
                continue
            bind.execute(
                text("DELETE FROM library_taxonomy_nodes WHERE id = CAST(:id AS uuid)"),
                {"id": cid},
            )
        leftover = bind.execute(
            text(
                """
                SELECT 1 FROM library_taxonomy_nodes WHERE parent_id = CAST(:pid AS uuid) LIMIT 1
                """
            ),
            {"pid": str(root_id)},
        ).scalar()
        root_used = bind.execute(
            text(
                """
                SELECT 1 FROM materials
                WHERE primary_taxonomy_id = CAST(:id AS uuid)
                   OR secondary_taxonomy_id = CAST(:id AS uuid)
                LIMIT 1
                """
            ),
            {"id": str(root_id)},
        ).scalar()
        if leftover or root_used:
            continue
        bind.execute(
            text("DELETE FROM library_taxonomy_nodes WHERE id = CAST(:id AS uuid)"),
            {"id": str(root_id)},
        )


def downgrade() -> None:
    bind = op.get_bind()
    lid = str(PERSONAL_VIDEO_LIBRARY_ID)
    names = []
    for primary, _english, children in iter_personal_video_taxonomy():
        names.append(primary)
        names.extend(children)
    bind.execute(
        text(
            """
            DELETE FROM library_taxonomy_nodes n
            WHERE n.library_id = CAST(:lid AS uuid)
              AND n.name = ANY(:names)
              AND NOT EXISTS (
                SELECT 1 FROM materials m
                WHERE m.primary_taxonomy_id = n.id OR m.secondary_taxonomy_id = n.id
              )
            """
        ),
        {"lid": lid, "names": names},
    )
