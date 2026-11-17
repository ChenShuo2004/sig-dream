from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SettingsUserRead(BaseModel):
    id: str
    username: str
    group_name: str
    role: str
    status: str
    last_login_at: datetime | None = None
    created_at: datetime


class SettingsUserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    group_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    role: str
    status: str = "active"


class SettingsUserUpdate(BaseModel):
    group_name: str | None = Field(default=None, min_length=1, max_length=64)
    role: str | None = None
    status: str | None = None


class SettingsResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class SettingsRoleRead(BaseModel):
    id: str
    name: str
    level: int
    is_system: bool = True
    permissions: list[str]


class SettingsRolePermissionUpdate(BaseModel):
    permissions: list[str]


class PermissionPointRead(BaseModel):
    module: str
    code: str
    name: str
    description: str


class SystemSettingsRead(BaseModel):
    security_policy: dict[str, Any]
    storage_upload_policy: dict[str, Any]
    trash_download_policy: dict[str, Any]


class SystemSettingsUpdate(BaseModel):
    security_policy: dict[str, Any] | None = None
    storage_upload_policy: dict[str, Any] | None = None
    trash_download_policy: dict[str, Any] | None = None
