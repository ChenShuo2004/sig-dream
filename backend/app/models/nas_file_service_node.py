import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class NasFileServiceNode(Base):
    """文件机（边缘 HTTP 服务）注册表：多机、多池时由 ECS 解析 LAN 根地址。"""

    __tablename__ = "nas_file_service_nodes"
    __table_args__ = (UniqueConstraint("pool_id", "node_id", name="uq_nas_file_service_node_pool_node"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pool_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    node_id: Mapped[str] = mapped_column(String(128), nullable=False)
    lan_upload_base_url: Mapped[str] = mapped_column(Text, nullable=False)
    lan_download_base_url: Mapped[str] = mapped_column(Text, nullable=False)
    public_upload_base_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    public_download_base_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="online")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), server_default=func.now(), nullable=False)
