from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class MaterialCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    tag_ids: list[str] = Field(default_factory=list)
    uploader: str | None = None


class MaterialRead(BaseModel):
    id: str
    library_id: str | None = None
    library_code: str | None = None
    title: str
    description: str | None = None
    copy_fit: str | None = None
    keywords: list[str] = Field(default_factory=list)
    primary_taxonomy_id: str | None = None
    secondary_taxonomy_id: str | None = None
    primary_taxonomy_name: str | None = None
    secondary_taxonomy_name: str | None = None
    tag_ids: list[str]
    original_filename: str | None = None
    primary_file_id: str | None = None
    primary_extension: str | None = None
    file_size: int | None = Field(default=None, description="Primary (first) material file size in bytes")
    primary_media_width: int | None = Field(default=None, description="主文件像素宽（派生任务 ffprobe 写入 extra_metadata）")
    primary_media_height: int | None = Field(default=None, description="主文件像素高")
    preview_thumbnail_path: str | None = None
    storage_pool_id: str = Field(default="default", description="LAN 根地址解析用存储池，默认 default")
    status: str
    download_count: int
    uploader: str | None = None
    created_at: datetime


class MaterialFileRead(BaseModel):
    id: str
    file_role: str
    storage_type: str
    original_filename: str
    stored_filename: str
    file_path: str
    file_relative_path: str | None = Field(default=None, description="相对 material_assets_root，与 file_path 相同")
    extension: str | None = None
    file_size: int | None = None
    sha256: str | None = None
    extra_metadata: dict | None = None
    created_at: datetime


class MaterialDetailRead(MaterialRead):
    files: list[MaterialFileRead] = Field(default_factory=list)


class MaterialListResponse(BaseModel):
    items: list[MaterialRead]
    total: int
    page: int
    page_size: int


class MaterialFacetTagIdsResponse(BaseModel):
    """与素材列表同源筛选下，至少出现在一条匹配素材上的「启用」标签 id（去重）。"""

    tag_ids: list[str] = Field(default_factory=list)


class MaterialIngestFromNasRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    tag_ids: list[str] = Field(default_factory=list)
    uploader: str | None = None
    original_filename: str = Field(min_length=1, max_length=255)
    stored_filename: str = Field(min_length=1, max_length=255)
    nas_file_path: str = Field(min_length=1, max_length=1000)
    file_size: int = Field(gt=0)
    sha256: str = Field(min_length=64, max_length=64)
    storage_pool_id: str | None = Field(
        default=None,
        max_length=64,
        description="可选；LAN 入库时绑定存储池，用于多文件机按池解析 LAN 根地址；缺省使用 ECS 的 DEFAULT_STORAGE_POOL_ID",
    )
    library: str | None = Field(default=None, description="素材库域 code：auto | personal_video")


class MaterialStoragePoolPatchRequest(BaseModel):
    storage_pool_id: str = Field(min_length=1, max_length=64)


class MaterialPatchRequest(BaseModel):
    """部分更新：至少提供一项；`tag_ids` 传入列表（可为空）时表示替换素材的全部标签。"""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    tag_ids: list[str] | None = None
    primary_original_filename: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="主文件（按创建时间第一条）在库中的展示用原始文件名；不含路径。可与 title 同时提交。",
    )
    keywords: list[str] | None = None
    copy_fit: str | None = None
    primary_taxonomy_id: str | None = None
    secondary_taxonomy_id: str | None = None

    @model_validator(mode="after")
    def require_one_field(self) -> "MaterialPatchRequest":
        if (
            self.title is None
            and self.description is None
            and self.tag_ids is None
            and self.primary_original_filename is None
            and self.keywords is None
            and self.copy_fit is None
            and self.primary_taxonomy_id is None
            and self.secondary_taxonomy_id is None
        ):
            raise ValueError("至少需要提供 title、description、tag_ids、primary_original_filename 或个人视频库字段中的一项")
        return self


class MaterialIngestFromNasResponse(BaseModel):
    material_id: str
    material_file_id: str
    nas_job_id: str
    status: str


class MaterialDownloadTicketResponse(BaseModel):
    material_id: str
    file_id: str
    ticket: str
    expires_at: datetime
    download_url: str | None = None


class MaterialDownloadRouteResponse(BaseModel):
    """一次性票据 + 文件机地址候选；浏览器探测 LAN/WAN 可达后直连下载，失败再回退 prepare_download。"""

    material_id: str
    file_id: str
    ticket: str
    expires_at: datetime
    lan_download_base_url: str | None = Field(default=None, description="局域网文件机 HTTPS/HTTP 根（多网段时取第一个）")
    lan_download_base_urls: list[str] = Field(
        default_factory=list,
        description="局域网文件机根地址候选（192.168.1 / 192.168.2 等，浏览器按序探测）",
    )
    public_download_base_url: str | None = Field(default=None, description="公网可达文件机 HTTP 根（无则 null）")
    recommended_order: list[str] = Field(
        default_factory=lambda: ["lan", "wan", "ecs_fallback"],
        description="与《文件直传与自动选路》一致：先 LAN 再 WAN 再 ECS 缓存兜底",
    )


class MaterialThumbnailUrlResponse(BaseModel):
    material_id: str
    file_id: str
    status: str
    source: str
    expires_at: datetime | None = None
    url: str | None = None
    alternate_urls: list[str] = Field(default_factory=list, description="同票据的其它网段直连地址")
    message: str | None = None


class MaterialPreviewVideoUrlResponse(BaseModel):
    """侧栏/抽屉浏览器兼容预览（H.264 MP4 派生物），非原始主文件。"""

    material_id: str
    file_id: str
    status: Literal["ready", "pending", "failed"]
    url: str | None = None
    alternate_urls: list[str] = Field(default_factory=list, description="同票据的其它网段直连地址")
    mime_type: str | None = Field(default=None, description="ready 时通常为 video/mp4")
    message: str | None = None
    source: str | None = Field(default=None, description="ready：lan 或 ecs-cache；pending/failed 可为 null")
    expires_at: datetime | None = None


class MaterialDownloadTicketVerifyResponse(BaseModel):
    material_id: str
    file_id: str
    original_filename: str
    storage_type: str
    file_path: str
    expires_at: datetime
    inline_disposition: bool = Field(
        default=False,
        description="True 时允许内联展示（缩略图/预览）；正式素材下载应为 False，由文件机设置 Content-Disposition。",
    )


class MaterialDownloadPrepareResponse(BaseModel):
    job_id: str
    status: str


class MaterialDownloadPrepareStatusResponse(BaseModel):
    job_id: str
    status: str
    error_message: str | None = None
    expires_at: datetime | None = None
    download_url: str | None = None
    started_at: datetime | None = Field(
        default=None,
        description="NAS worker 领取该作业的时间；null 且 status=pending 表示仍在排队未被 worker 拉取",
    )


class MaterialDownloadTicketReportRequest(BaseModel):
    ticket: str = Field(min_length=10)
    success: bool = True
    bytes_sent: int | None = Field(default=None, ge=0)


class MaterialLanUploadTicketCreateRequest(BaseModel):
    original_filename: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    tag_ids: list[str] = Field(default_factory=list)
    mime_type: str | None = None
    # 强烈建议上传页传入；NAS 写入后必须与之一致，否则拒绝入库，避免「前端显示完成但 NAS 只有 0 字节/截断」
    file_size: int | None = Field(default=None, gt=0)
    sha256: str = Field(min_length=64, max_length=64)
    library: str | None = Field(default=None, description="素材库域 code：auto | personal_video")


class MaterialLanUploadTicketResponse(BaseModel):
    ticket: str
    expires_at: datetime
    upload_url: str | None = Field(default=None, description="兼容旧客户端：优先 LAN 基址，无 LAN 时有公网则指向公网")
    lan_upload_base_url: str | None = Field(default=None, description="文件机局域网 HTTP 根，无则 null")
    public_upload_base_url: str | None = Field(default=None, description="文件机公网 HTTP 根，无则 null")


class MaterialLanUploadTicketVerifyResponse(BaseModel):
    original_filename: str
    title: str
    description: str | None = None
    tag_ids: list[str] = Field(default_factory=list)
    uploader: str
    mime_type: str | None = None
    file_size: int | None = None
    sha256: str | None = Field(default=None, description="签票时写入的内容 SHA256；旧票据可能为 null")
    library: str | None = Field(default=None, description="素材库域 code：auto | personal_video")
    expires_at: datetime


class MaterialLanUploadTicketReportRequest(BaseModel):
    ticket: str = Field(min_length=10)
    success: bool = True
    bytes_received: int | None = Field(default=None, ge=0)
    message: str | None = None


class MaterialPermanentDeleteResponse(BaseModel):
    material_id: str
    status: str


class MaterialUsageRead(BaseModel):
    id: str
    material_id: str
    material_file_id: str | None = None
    username: str | None = None
    usage_type: str
    source: str | None = None
    created_at: datetime


class MaterialUsageListResponse(BaseModel):
    items: list[MaterialUsageRead]
    total: int


class UnorganizedMaterialRead(BaseModel):
    id: str
    library_id: str | None = None
    library_code: str | None = None
    title: str
    description: str | None = None
    copy_fit: str | None = None
    keywords: list[str] = Field(default_factory=list)
    primary_taxonomy_id: str | None = None
    secondary_taxonomy_id: str | None = None
    primary_taxonomy_name: str | None = None
    secondary_taxonomy_name: str | None = None
    original_filename: str | None = None
    primary_file_id: str | None = None
    file_size: int | None = Field(default=None, description="Primary file size in bytes")
    asset_type: str | None = None
    primary_media_width: int | None = None
    primary_media_height: int | None = None
    thumbnail_url: str | None = None
    uploader_name: str | None = None
    created_at: datetime
    tags: list[str] = Field(default_factory=list)
    ai_analysis: dict | None = Field(
        default=None,
        description="内容分析建议（文件机视觉模型产出）；pending/ready/failed/applied，采纳前不写入正式字段",
    )


class UnorganizedMaterialListResponse(BaseModel):
    items: list[UnorganizedMaterialRead]
    total: int
    page: int
    page_size: int


class UnorganizedBatchTagRequest(BaseModel):
    asset_ids: list[str] = Field(default_factory=list)
    tag_ids: list[str] = Field(default_factory=list)
    primary_taxonomy_id: str | None = None
    secondary_taxonomy_id: str | None = None
    keywords: list[str] | None = None
    copy_fit: str | None = None
    description: str | None = None


class UnorganizedBatchAnalyzeRequest(BaseModel):
    """排队内容分析：读缩略图/预览抽帧给视觉模型；auto_apply 时识别完成后自动新增并整理入库。"""

    asset_ids: list[str] = Field(default_factory=list)
    auto_apply: bool = False


class UnorganizedApplySuggestionsRequest(BaseModel):
    """逐素材采纳各自的内容分析建议（替换标签、写描述等）。"""

    asset_ids: list[str] = Field(default_factory=list)
    auto_create: bool = False


class UnorganizedBatchMarkRequest(BaseModel):
    asset_ids: list[str] = Field(default_factory=list)


class UnorganizedBatchTrashRequest(BaseModel):
    asset_ids: list[str] = Field(default_factory=list)
    reason: str | None = None


class UnorganizedBatchActionResponse(BaseModel):
    success_count: int
    failed_count: int
    failed_items: list[dict] = Field(default_factory=list)


class DesktopMetadataSyncTag(BaseModel):
    id: str
    name: str
    category: str
    status: str
    sort_order: int = 0


class DesktopMetadataSyncMaterial(BaseModel):
    id: str
    title: str
    status: str
    tag_ids: list[str] = Field(default_factory=list)
    primary_file_id: str | None = None
    storage_pool_id: str = "default"
    created_at: datetime


class DesktopMetadataSyncFile(BaseModel):
    id: str
    material_id: str
    file_role: str
    storage_type: str
    original_filename: str
    file_path: str
    file_relative_path: str
    extension: str | None = None
    file_size: int | None = None


class DesktopMetadataSyncResponse(BaseModel):
    """桌面端分页拉取素材元数据（含 NAS file_path），第 1 页附带全部启用标签。"""

    tags: list[DesktopMetadataSyncTag] = Field(default_factory=list)
    materials: list[DesktopMetadataSyncMaterial] = Field(default_factory=list)
    files: list[DesktopMetadataSyncFile] = Field(default_factory=list)
    page: int
    page_size: int
    total_materials: int
    synced_at: datetime


class MaterialDownloadClientReportRequest(BaseModel):
    """浏览器端下载完成/失败后上报，写入 operation_logs。"""

    material_id: str = Field(min_length=1, max_length=64)
    file_id: str = Field(min_length=1, max_length=64)
    download_mode: Literal["browser_default", "choose_directory", "nas_smb_open", "nas_smb_drag"]
    transport_route: Literal["lan_direct", "wan_direct", "ecs_fallback", "nas_smb"]
    success: bool
    file_size_bytes: int | None = Field(default=None, ge=0)
    error_message: str | None = Field(default=None, max_length=2000)


class MaterialDownloadClientReportResponse(BaseModel):
    status: str = "ok"
