from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str


class MeResponse(BaseModel):
    username: str
    role: str
    access_context: str
    permissions: list[str]


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ChangePasswordResponse(BaseModel):
    status: str = "ok"
    message: str


class LogoutResponse(BaseModel):
    status: str = "ok"
    message: str
