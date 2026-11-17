import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ApiCallLog(Base):
    """One generation API call: account, endpoint, parameters, and token usage."""

    __tablename__ = "api_call_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default="")
    capability: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False, default="", server_default="")
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default="", index=True)
    model: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    endpoint: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    task_id: Mapped[str] = mapped_column(String(128), nullable=False, default="", server_default="", index=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    prompt_excerpt: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    parameters: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now(), nullable=False, index=True)
