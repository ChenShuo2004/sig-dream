from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import bearer_scheme, decode_access_token, extract_bearer_token
from app.models.user import User
from app.models.user_tutorial_progress import UserTutorialProgress
from app.schemas.tutorials import (
    TutorialKeyRequest,
    TutorialProgressItem,
    TutorialStartRequest,
    TutorialUpdateRequest,
)
from app.services.auth_service import resolve_user

router = APIRouter(prefix="/tutorials", tags=["tutorials"])

ALLOWED_TUTORIAL_KEYS = frozenset(
    {
        "materials",
        "collections",
        "upload",
        "unorganized",
        "trash",
        "tags",
        "tag_requests",
        "operation_logs",
    }
)


def _token_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    token = extract_bearer_token(credentials)
    return decode_access_token(token)


def _db_user_id(db: Session, username: str) -> User:
    user = db.query(User).filter(User.username == username).one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def _validate_key(key: str) -> None:
    if key not in ALLOWED_TUTORIAL_KEYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tutorial_key")


def _get_or_create_row(db: Session, user_id, tutorial_key: str) -> UserTutorialProgress:
    row = db.scalar(
        select(UserTutorialProgress).where(
            UserTutorialProgress.user_id == user_id,
            UserTutorialProgress.tutorial_key == tutorial_key,
        )
    )
    if row:
        return row
    row = UserTutorialProgress(
        user_id=user_id,
        tutorial_key=tutorial_key,
        status="not_started",
        last_step=0,
        completed_at=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/progress", response_model=list[TutorialProgressItem])
def list_progress(
    db: Session = Depends(get_db),
    token_user=Depends(_token_user),
) -> list[TutorialProgressItem]:
    resolve_user(db, token_user.username)
    user = _db_user_id(db, token_user.username)
    rows = list(
        db.scalars(select(UserTutorialProgress).where(UserTutorialProgress.user_id == user.id)).all()
    )
    by_key = {r.tutorial_key: r for r in rows}
    out: list[TutorialProgressItem] = []
    for key in sorted(ALLOWED_TUTORIAL_KEYS):
        r = by_key.get(key)
        if r:
            out.append(
                TutorialProgressItem(
                    tutorial_key=r.tutorial_key,
                    status=r.status,
                    last_step=int(r.last_step or 0),
                    completed_at=r.completed_at,
                )
            )
        else:
            out.append(
                TutorialProgressItem(
                    tutorial_key=key,
                    status="not_started",
                    last_step=0,
                    completed_at=None,
                )
            )
    return out


@router.post("/progress/start", response_model=TutorialProgressItem)
def start_progress(
    payload: TutorialStartRequest,
    db: Session = Depends(get_db),
    token_user=Depends(_token_user),
) -> TutorialProgressItem:
    resolve_user(db, token_user.username)
    _validate_key(payload.tutorial_key)
    user = _db_user_id(db, token_user.username)
    row = _get_or_create_row(db, user.id, payload.tutorial_key)
    if row.status == "completed":
        return TutorialProgressItem(
            tutorial_key=row.tutorial_key,
            status=row.status,
            last_step=int(row.last_step or 0),
            completed_at=row.completed_at,
        )
    row.status = "in_progress"
    row.last_step = max(int(row.last_step or 0), 0)
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return TutorialProgressItem(
        tutorial_key=row.tutorial_key,
        status=row.status,
        last_step=int(row.last_step or 0),
        completed_at=row.completed_at,
    )


@router.post("/progress/update", response_model=TutorialProgressItem)
def update_progress(
    payload: TutorialUpdateRequest,
    db: Session = Depends(get_db),
    token_user=Depends(_token_user),
) -> TutorialProgressItem:
    resolve_user(db, token_user.username)
    _validate_key(payload.tutorial_key)
    user = _db_user_id(db, token_user.username)
    row = _get_or_create_row(db, user.id, payload.tutorial_key)
    if row.status == "completed":
        return TutorialProgressItem(
            tutorial_key=row.tutorial_key,
            status=row.status,
            last_step=int(row.last_step or 0),
            completed_at=row.completed_at,
        )
    row.status = "in_progress"
    row.last_step = max(int(row.last_step or 0), int(payload.last_step))
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return TutorialProgressItem(
        tutorial_key=row.tutorial_key,
        status=row.status,
        last_step=int(row.last_step or 0),
        completed_at=row.completed_at,
    )


@router.post("/progress/complete", response_model=TutorialProgressItem)
def complete_progress(
    payload: TutorialKeyRequest,
    db: Session = Depends(get_db),
    token_user=Depends(_token_user),
) -> TutorialProgressItem:
    resolve_user(db, token_user.username)
    _validate_key(payload.tutorial_key)
    user = _db_user_id(db, token_user.username)
    row = _get_or_create_row(db, user.id, payload.tutorial_key)
    now = datetime.utcnow()
    row.status = "completed"
    row.completed_at = now
    row.updated_at = now
    db.add(row)
    db.commit()
    db.refresh(row)
    return TutorialProgressItem(
        tutorial_key=row.tutorial_key,
        status=row.status,
        last_step=int(row.last_step or 0),
        completed_at=row.completed_at,
    )


@router.post("/progress/reset", response_model=TutorialProgressItem)
def reset_progress(
    payload: TutorialKeyRequest,
    db: Session = Depends(get_db),
    token_user=Depends(_token_user),
) -> TutorialProgressItem:
    resolve_user(db, token_user.username)
    _validate_key(payload.tutorial_key)
    user = _db_user_id(db, token_user.username)
    row = _get_or_create_row(db, user.id, payload.tutorial_key)
    row.status = "not_started"
    row.last_step = 0
    row.completed_at = None
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    db.refresh(row)
    return TutorialProgressItem(
        tutorial_key=row.tutorial_key,
        status=row.status,
        last_step=0,
        completed_at=None,
    )
