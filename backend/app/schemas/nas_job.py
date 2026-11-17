from datetime import datetime
from pydantic import BaseModel, Field


class NasJobPollResponse(BaseModel):
    id: str
    job_type: str
    payload: dict
    status: str
    created_at: datetime


class NasJobResultRequest(BaseModel):
    result: dict | None = None
    error_message: str | None = None


class NasJobProgressRequest(BaseModel):
    step: str
    label: str | None = None
    percent: int | None = None
    # lan_yue2 等长任务：运行中回写 yue2_job_id / stage / progress，避免「已认领但结果空白」假卡死
    result_patch: dict | None = None


class NasJobStatusResponse(BaseModel):
    id: str
    job_type: str
    status: str
    result: dict | None = None
    error_message: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class SyncOperationRead(BaseModel):
    id: str
    operation_id: str
    operation_type: str
    target_type: str
    target_id: str | None = None
    status: str
    retry_count: int
    max_retries: int
    next_retry_at: datetime | None = None
    last_error: str | None = None
    resolution_note: str | None = None
    created_at: datetime
    updated_at: datetime


class SyncOperationListResponse(BaseModel):
    items: list[SyncOperationRead]
    total: int


class NasJobDeadletterActionRequest(BaseModel):
    action: str  # requeue | resolved | ignore
    note: str | None = None


class FileServiceHeartbeatRequest(BaseModel):
    """文件机向 ECS 上报当前可访问的 LAN HTTP 根地址（多机多池）。"""

    pool_id: str | None = None
    node_id: str = Field(min_length=1, max_length=128)
    lan_upload_base_url: str
    lan_download_base_url: str
    public_upload_base_url: str | None = None
    public_download_base_url: str | None = None
    status: str | None = "online"


class FileServiceHeartbeatResponse(BaseModel):
    pool_id: str
    node_id: str
    status: str


class FileServiceNodeRead(BaseModel):
    id: str
    pool_id: str
    node_id: str
    lan_upload_base_url: str
    lan_download_base_url: str
    public_upload_base_url: str = ""
    public_download_base_url: str = ""
    status: str
    last_seen_at: datetime
    created_at: datetime
    updated_at: datetime


class FileServiceNodeListResponse(BaseModel):
    items: list[FileServiceNodeRead]


class NasQueueFileNode(BaseModel):
    node_id: str
    pool_id: str
    status: str
    healthy: bool
    last_seen_at: str | None = None
    age_seconds: int | None = None


class NasQueueCount(BaseModel):
    job_type: str
    pending: int = 0
    running: int = 0
    success_today: int = 0
    failed_today: int = 0


class NasQueueJob(BaseModel):
    id: str
    job_type: str
    status: str
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    retry_count: int = 0
    error_message: str | None = None


class NasQueueBoardResponse(BaseModel):
    server_time: str
    overall: str
    worker_polling: bool
    worker_last_poll_at: str | None = None
    worker_age_seconds: int | None = None
    worker_online_window_seconds: int
    file_stale_seconds: int
    file_nodes: list[NasQueueFileNode]
    pending_total: int
    running_total: int
    queues: list[NasQueueCount]
    active_jobs: list[NasQueueJob]
    recent_jobs: list[NasQueueJob]
