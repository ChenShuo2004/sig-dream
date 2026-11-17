from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.security import bearer_scheme, decode_access_token, extract_bearer_token
from app.models.feedback import Feedback, FeedbackReaction, FeedbackReply
from app.schemas.feedback import (
    FeedbackCreateRequest,
    FeedbackDetailRead,
    FeedbackItemRead,
    FeedbackListResponse,
    FeedbackReactRequest,
    FeedbackReplyCreateRequest,
    FeedbackReplyRead,
)

router = APIRouter(prefix="/feedbacks", tags=["feedbacks"])


def _must_user(credentials: HTTPAuthorizationCredentials | None):
    token = extract_bearer_token(credentials)
    return decode_access_token(token)


def _get_feedback_or_404(db: Session, feedback_id: str) -> Feedback:
    try:
        feedback_uuid = UUID(feedback_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid feedback id") from exc
    row = db.get(Feedback, feedback_uuid)
    if row is None:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return row


def _refresh_reaction_counts(db: Session, feedback_id: str) -> tuple[int, int]:
    like_count = int(
        db.scalar(
            select(func.count())
            .select_from(FeedbackReaction)
            .where(FeedbackReaction.feedback_id == feedback_id)
            .where(FeedbackReaction.reaction == "like")
        )
        or 0
    )
    dislike_count = int(
        db.scalar(
            select(func.count())
            .select_from(FeedbackReaction)
            .where(FeedbackReaction.feedback_id == feedback_id)
            .where(FeedbackReaction.reaction == "dislike")
        )
        or 0
    )
    return like_count, dislike_count


@router.get("", response_model=FeedbackListResponse)
def list_feedbacks(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> FeedbackListResponse:
    _ = _must_user(credentials)
    total = int(db.scalar(select(func.count()).select_from(Feedback)) or 0)
    rows = list(
        db.scalars(
            select(Feedback)
            .order_by(Feedback.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return FeedbackListResponse(
        total=total,
        items=[
            FeedbackItemRead(
                id=str(row.id),
                title=row.title,
                created_at=row.created_at,
                like_count=row.like_count,
                dislike_count=row.dislike_count,
                reply_count=row.reply_count,
            )
            for row in rows
        ],
    )


@router.post("", response_model=FeedbackDetailRead)
def create_feedback(
    payload: FeedbackCreateRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> FeedbackDetailRead:
    _ = _must_user(credentials)
    row = Feedback(title=payload.title.strip(), content=payload.content.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return FeedbackDetailRead(
        id=str(row.id),
        title=row.title,
        content=row.content,
        created_at=row.created_at,
        like_count=row.like_count,
        dislike_count=row.dislike_count,
        reply_count=row.reply_count,
        replies=[],
    )


@router.get("/{feedback_id}", response_model=FeedbackDetailRead)
def get_feedback_detail(
    feedback_id: str,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> FeedbackDetailRead:
    _ = _must_user(credentials)
    row = _get_feedback_or_404(db, feedback_id)
    replies = list(
        db.scalars(
            select(FeedbackReply)
            .where(FeedbackReply.feedback_id == row.id)
            .order_by(FeedbackReply.created_at.asc())
        ).all()
    )
    return FeedbackDetailRead(
        id=str(row.id),
        title=row.title,
        content=row.content,
        created_at=row.created_at,
        like_count=row.like_count,
        dislike_count=row.dislike_count,
        reply_count=row.reply_count,
        replies=[
            FeedbackReplyRead(id=str(reply.id), content=reply.content, created_at=reply.created_at)
            for reply in replies
        ],
    )


@router.post("/{feedback_id}/replies", response_model=FeedbackReplyRead)
def create_feedback_reply(
    feedback_id: str,
    payload: FeedbackReplyCreateRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> FeedbackReplyRead:
    _ = _must_user(credentials)
    row = _get_feedback_or_404(db, feedback_id)
    reply = FeedbackReply(feedback_id=row.id, content=payload.content.strip())
    db.add(reply)
    row.reply_count = int(row.reply_count or 0) + 1
    db.add(row)
    db.commit()
    db.refresh(reply)
    return FeedbackReplyRead(id=str(reply.id), content=reply.content, created_at=reply.created_at)


@router.post("/{feedback_id}/react")
def react_feedback(
    feedback_id: str,
    payload: FeedbackReactRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict[str, int | str]:
    user = _must_user(credentials)
    row = _get_feedback_or_404(db, feedback_id)
    current = db.scalar(
        select(FeedbackReaction)
        .where(FeedbackReaction.feedback_id == row.id)
        .where(FeedbackReaction.username == user.username)
    )
    action = payload.action
    if action == "clear":
        if current is not None:
            db.delete(current)
    else:
        if current is None:
            db.add(FeedbackReaction(feedback_id=row.id, username=user.username, reaction=action))
        else:
            current.reaction = action
            db.add(current)
    db.flush()
    like_count, dislike_count = _refresh_reaction_counts(db, row.id)
    row.like_count = like_count
    row.dislike_count = dislike_count
    db.add(row)
    db.commit()
    return {
        "status": "ok",
        "like_count": like_count,
        "dislike_count": dislike_count,
        "reply_count": row.reply_count,
    }
