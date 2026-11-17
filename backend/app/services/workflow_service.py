from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.workflow import Workflow
from app.schemas.workflow import WorkflowCreate, WorkflowUpdate


def create_workflow(db: Session, payload: WorkflowCreate) -> Workflow:
    workflow = Workflow(
        name=payload.name,
        description=payload.description,
        definition=payload.definition.model_dump(),
        created_by=payload.created_by,
        status="active",
    )
    db.add(workflow)
    db.commit()
    db.refresh(workflow)
    return workflow


def list_workflows(db: Session) -> list[Workflow]:
    return list(db.scalars(select(Workflow).order_by(Workflow.created_at.desc())).all())


def get_workflow_by_id(db: Session, workflow_id: UUID) -> Workflow | None:
    return db.get(Workflow, workflow_id)


def update_workflow(db: Session, workflow: Workflow, payload: WorkflowUpdate) -> Workflow:
    if payload.name is not None:
        workflow.name = payload.name
    if payload.description is not None:
        workflow.description = payload.description
    if payload.definition is not None:
        workflow.definition = payload.definition.model_dump()
    if payload.status is not None:
        workflow.status = payload.status
    db.commit()
    db.refresh(workflow)
    return workflow
