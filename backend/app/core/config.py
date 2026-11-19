from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "light-content-workflow-platform"
    app_build_version: str = ""
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/light_content"
    token_secret: str = ""
    jwt_secret: str = ""
    nas_client_token: str = "change-this-nas-client-token"
    nas_base_url: str = "http://127.0.0.1:8000"
    nas_mount_root: str = ""
    lan_download_base_url: str = ""
    lan_upload_base_url: str = ""
    # 可选：浏览器经公网直连文件机时使用的根地址（与 LAN 分离；心跳可覆盖注册表）
    public_download_base_url: str = ""
    public_upload_base_url: str = ""
    # 多文件机：默认存储池 ID（与 materials.storage_pool_id / 节点上报 pool_id 对齐）
    default_storage_pool_id: str = "default"
    # 超过该秒数未心跳的节点不参与 LAN 根地址解析
    file_service_node_stale_seconds: int = 120
    # 单文件机：心跳 / poll / 票据校验等 NAS 入站请求上，若未显式配置 public_*，用入站公网 IP + LAN 端口推断公网直连根（不经 ECS 传文件体）
    file_service_infer_public_from_ingress: bool = True
    # worker 轮询时：若无健康注册节点，用 .env 的 LAN_* + 入站公网 IP 自动 upsert（免单独跑 heartbeat）；多机请关并依赖显式心跳
    file_service_poll_bootstrap_registry: bool = True
    # 仅当库中尚无节点时 poll 自注册使用的 node_id（与 report-file-service-heartbeat.ps1 的 NodeId 对齐可避免重复行）
    file_service_bootstrap_node_id: str = "default-file-machine"
    download_ticket_secret: str = "change-this-download-ticket-secret"
    download_ticket_ttl_seconds: int = 600
    upload_ticket_ttl_seconds: int = 900
    download_cache_ttl_seconds: int = 1800
    postgres_tools_container_name: str = ""

    @field_validator("nas_client_token", mode="before")
    @classmethod
    def _strip_nas_client_token(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip().lstrip("\ufeff")
        return v

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
