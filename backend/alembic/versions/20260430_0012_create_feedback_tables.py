"""create feedback tables

Revision ID: 20260430_0012
Revises: 20260430_0011
Create Date: 2026-04-30 21:10:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260430_0012"
down_revision = "20260430_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feedbacks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dislike_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reply_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "feedback_replies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("feedback_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["feedback_id"], ["feedbacks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "feedback_reactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("feedback_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("reaction", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=False), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["feedback_id"], ["feedbacks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("feedback_id", "username", name="uq_feedback_reaction_feedback_user"),
    )
    op.create_index("ix_feedbacks_created_at", "feedbacks", ["created_at"], unique=False)
    op.create_index("ix_feedback_replies_feedback_id", "feedback_replies", ["feedback_id"], unique=False)
    op.create_index("ix_feedback_reactions_feedback_id", "feedback_reactions", ["feedback_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_feedback_reactions_feedback_id", table_name="feedback_reactions")
    op.drop_index("ix_feedback_replies_feedback_id", table_name="feedback_replies")
    op.drop_index("ix_feedbacks_created_at", table_name="feedbacks")
    op.drop_table("feedback_reactions")
    op.drop_table("feedback_replies")
    op.drop_table("feedbacks")
