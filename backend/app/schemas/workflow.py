from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class WorkflowDefinition(BaseModel):
    nodes: list[dict] = Field(default_factory=list)
    edges: list[dict] = Field(default_factory=list)


class WorkflowCreate(BaseModel):
    name: str
    description: str | None = None
    definition: WorkflowDefinition = Field(default_factory=WorkflowDefinition)
    created_by: str | None = None


class WorkflowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    definition: WorkflowDefinition | None = None
    status: str | None = None


class WorkflowRead(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    definition: dict
    created_by: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
