import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthUser:
    username: str
    role: str


ACCESS_CONTEXT_PUBLIC = "public"
ACCESS_CONTEXT_INTERNAL = "internal"
ROLE_SUPER_ADMIN = "super_admin"
ROLE_MATERIAL_ADMIN = "material_admin"
ROLE_MEMBER = "member"

# Prefer TOKEN_SECRET / JWT_SECRET from env (ECS backend/.env).
# Fallback kept for existing deployments that never set TOKEN_SECRET; rotate via env for production.
_TOKEN_SECRET = (
    os.getenv("TOKEN_SECRET")
    or os.getenv("JWT_SECRET")
    or "light-content-workflow-secret"
).strip()


def _b64_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64_decode(data: str) -> bytes:
    padded = data + "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))


def _sign(payload_b64: str) -> str:
    digest = hmac.new(_TOKEN_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    return _b64_encode(digest)


TOKEN_TTL_SECONDS = 7 * 24 * 3600


def create_access_token(username: str, role: str, expire_seconds: int = TOKEN_TTL_SECONDS) -> str:
    payload = {
        "username": username,
        "role": role,
        "exp": int(time.time()) + expire_seconds,
    }
    payload_b64 = _b64_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _sign(payload_b64)
    return f"{payload_b64}.{signature}"


def decode_access_token(token: str, *, allow_expired: bool = False) -> AuthUser:
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token format") from exc

    expected = _sign(payload_b64)
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token signature")

    try:
        payload = json.loads(_b64_decode(payload_b64))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload") from exc

    expires_at = int(payload.get("exp", 0))
    now = int(time.time())
    if expires_at < now and not (allow_expired and now - expires_at <= TOKEN_TTL_SECONDS):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")

    username = payload.get("username")
    role = payload.get("role")
    if not isinstance(username, str) or not isinstance(role, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token claims")
    return AuthUser(username=username, role=role)


def resolve_access_context(x_access_context: str | None = Header(default=ACCESS_CONTEXT_PUBLIC)) -> str:
    normalized = (x_access_context or ACCESS_CONTEXT_PUBLIC).strip().lower()
    if normalized not in {ACCESS_CONTEXT_PUBLIC, ACCESS_CONTEXT_INTERNAL}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid access context")
    return normalized


def ensure_internal_access(context: str) -> None:
    if context != ACCESS_CONTEXT_INTERNAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Delete operations are forbidden in public context",
        )


def ensure_roles(user: AuthUser, allowed_roles: set[str]) -> None:
    if user.role not in allowed_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role permissions")


def extract_bearer_token(credentials: HTTPAuthorizationCredentials | None) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return credentials.credentials
