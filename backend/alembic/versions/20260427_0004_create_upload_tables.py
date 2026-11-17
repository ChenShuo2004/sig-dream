"""create upload session and chunk tables

Revision ID: 20260427_0004
Revises: 20260427_0003
Create Date: 2026-04-27 20:45:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260427_0004"
down_revision = "20260427_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "upload_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("chunk_size", sa.Integer(), nullable=False),
        sa.Column("total_chunks", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("uploader", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default=sa.text("'initialized'")),
        sa.Column("merged_path", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_upload_sessions_sha256", "upload_sessions", ["sha256"], unique=False)

    op.create_table(
        "upload_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("upload_session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("chunk_size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["upload_session_id"], ["upload_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("upload_session_id", "chunk_index", name="uq_upload_chunk"),
    )
    op.create_index("ix_upload_chunks_session_id", "upload_chunks", ["upload_session_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_upload_chunks_session_id", table_name="upload_chunks")
    op.drop_table("upload_chunks")
    op.drop_index("ix_upload_sessions_sha256", table_name="upload_sessions")
    op.drop_table("upload_sessions")
