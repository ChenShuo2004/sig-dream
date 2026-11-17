from datetime import datetime

from pydantic import BaseModel


class OperationLogRead(BaseModel):
    id: str
    user_id: str | None = None
    username: str | None = None
    operation_type: str
    target_type: str
    target_name: str | None = None
    before_data: dict | None = None
    after_data: dict | None = None
    success: bool
    error_message: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: datetime


class OperationLogListResponse(BaseModel):
    items: list[OperationLogRead]
    total: int
    page: int
    page_size: int
