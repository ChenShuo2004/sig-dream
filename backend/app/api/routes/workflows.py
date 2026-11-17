from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.workflow import WorkflowCreate, WorkflowRead, WorkflowUpdate
from app.services.workflow_service import create_workflow, get_workflow_by_id, list_workflows, update_workflow

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.post("", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
def create_workflow_route(payload: WorkflowCreate, db: Session = Depends(get_db)) -> WorkflowRead:
    workflow = create_workflow(db, payload)
    return WorkflowRead.model_validate(workflow)


@router.get("", response_model=list[WorkflowRead])
def list_workflows_route(db: Session = Depends(get_db)) -> list[WorkflowRead]:
    workflows = list_workflows(db)
    return [WorkflowRead.model_validate(item) for item in workflows]


@router.get("/{workflow_id}", response_model=WorkflowRead)
def get_workflow_route(workflow_id: UUID, db: Session = Depends(get_db)) -> WorkflowRead:
    workflow = get_workflow_by_id(db, workflow_id)
    if workflow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return WorkflowRead.model_validate(workflow)


@router.put("/{workflow_id}", response_model=WorkflowRead)
def update_workflow_route(
    workflow_id: UUID, payload: WorkflowUpdate, db: Session = Depends(get_db)
) -> WorkflowRead:
    workflow = get_workflow_by_id(db, workflow_id)
    if workflow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    updated = update_workflow(db, workflow, payload)
    return WorkflowRead.model_validate(updated)
