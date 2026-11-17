from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.user_tag_preference import UserTagPreference


def _normalize_tag_ids(tag_ids: list[str], *, max_count: int) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in tag_ids:
        value = str(raw).strip()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)
        if len(normalized) >= max_count:
            break
    return normalized


def get_or_create_user_tag_preferences(db: Session, username: str, *, library_id) -> UserTagPreference:
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    pref = db.scalar(
        select(UserTagPreference).where(
            UserTagPreference.user_id == user.id,
            UserTagPreference.library_id == library_id,
        )
    )
    if pref is None:
        pref = UserTagPreference(user_id=user.id, library_id=library_id, favorite_tag_ids=[], recent_tag_ids=[])
        db.add(pref)
        db.commit()
        db.refresh(pref)
    return pref


def save_user_tag_preferences(
    db: Session,
    *,
    username: str,
    library_id,
    favorite_tag_ids: list[str] | None,
    recent_tag_ids: list[str] | None,
) -> UserTagPreference:
    pref = get_or_create_user_tag_preferences(db, username, library_id=library_id)
    if favorite_tag_ids is not None:
        pref.favorite_tag_ids = _normalize_tag_ids(favorite_tag_ids, max_count=200)
    if recent_tag_ids is not None:
        pref.recent_tag_ids = _normalize_tag_ids(recent_tag_ids, max_count=50)
    db.add(pref)
    db.commit()
    db.refresh(pref)
    return pref
