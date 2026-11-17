from pydantic import BaseModel, Field


class UploadInitRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    file_size: int = Field(gt=0)
    chunk_size: int = Field(gt=0, le=32 * 1024 * 1024)
    sha256: str = Field(min_length=64, max_length=64)
    library: str | None = Field(default=None, description="素材库域 code：auto | personal_video")


class UploadInitResponse(BaseModel):
    upload_session_id: str
    total_chunks: int
    uploaded_chunks: list[int]


class UploadChunksResponse(BaseModel):
    upload_session_id: str
    total_chunks: int
    uploaded_chunks: list[int]
    status: str


class UploadCompleteResponse(BaseModel):
    upload_session_id: str
    status: str
    merged_path: str
    sha256: str


class UploadDedupResponse(BaseModel):
    sha256: str
    exists: bool
    upload_session_id: str | None = None
    material_id: str | None = None
    material_file_id: str | None = None


class UploadIngestRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    tag_ids: list[str] = Field(default_factory=list)


class UploadIngestResponse(BaseModel):
    upload_session_id: str
    material_id: str
    material_file_id: str
    nas_job_id: str
    status: str
