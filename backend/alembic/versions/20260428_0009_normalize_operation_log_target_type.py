"""normalize operation log target type values

Revision ID: 20260428_0009
Revises: 20260428_0008
Create Date: 2026-04-28 18:24:00
"""

from collections.abc import Sequence

from alembic import op


revision: str = "20260428_0009"
down_revision: str | Sequence[str] | None = "20260428_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE operation_logs
        SET target_type = CASE target_type
            WHEN '系统设置' THEN 'system_settings'
            WHEN '素材' THEN 'material'
            WHEN '标签' THEN 'tag'
            WHEN '上传' THEN 'upload'
            WHEN '文件' THEN 'upload'
            WHEN '错误信息' THEN 'error'
            WHEN '用户' THEN 'auth'
            ELSE target_type
        END
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE operation_logs
        SET target_type = CASE target_type
            WHEN 'system_settings' THEN '系统设置'
            WHEN 'material' THEN '素材'
            WHEN 'tag' THEN '标签'
            WHEN 'upload' THEN '上传'
            WHEN 'error' THEN '错误信息'
            WHEN 'auth' THEN '用户'
            ELSE target_type
        END
        """
    )
