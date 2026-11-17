from datetime import datetime

from pydantic import BaseModel, Field


class FeedbackCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=5000)


class FeedbackReplyCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


class FeedbackReactRequest(BaseModel):
    action: str = Field(pattern="^(like|dislike|clear)$")


class FeedbackReplyRead(BaseModel):
    id: str
    content: str
    created_at: datetime


class FeedbackItemRead(BaseModel):
    id: str
    title: str
    created_at: datetime
    like_count: int
    dislike_count: int
    reply_count: int


class FeedbackListResponse(BaseModel):
    total: int
    items: list[FeedbackItemRead]


class FeedbackDetailRead(BaseModel):
    id: str
    title: str
    content: str
    created_at: datetime
    like_count: int
    dislike_count: int
    reply_count: int
    replies: list[FeedbackReplyRead]
