from datetime import datetime

from pydantic import BaseModel, Field


class TutorialProgressItem(BaseModel):
    tutorial_key: str
    status: str
    last_step: int
    completed_at: datetime | None


class TutorialStartRequest(BaseModel):
    tutorial_key: str = Field(min_length=1, max_length=64)


class TutorialUpdateRequest(BaseModel):
    tutorial_key: str = Field(min_length=1, max_length=64)
    last_step: int = Field(ge=0, le=500)


class TutorialKeyRequest(BaseModel):
    tutorial_key: str = Field(min_length=1, max_length=64)
