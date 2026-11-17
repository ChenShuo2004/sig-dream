"""多文件机：LAN / 公网 上传、下载根地址从 DB 注册表解析，回退到环境变量配置。"""

import logging
import re
from datetime import datetime, timedelta

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.nas_file_service_node import NasFileServiceNode

logger = logging.getLogger(__name__)


_BASE_SPLIT_RE = re.compile(r"[,;\s]+")


def split_base_urls(raw: str) -> list[str]:
    """心跳/环境变量可写逗号分隔的多网段根地址，例如 https://192.168.1.2:9443,https://192.168.2.88:9443。"""
    out: list[str] = []
    seen: set[str] = set()
    for token in _BASE_SPLIT_RE.split((raw or "").strip()):
        u = token.strip().rstrip("/")
        if not u:
            continue
        key = u.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
    return out


def join_base_urls(raw: str) -> str:
    return ",".join(split_base_urls(raw))


def first_base_url(raw: str) -> str:
    items = split_base_urls(raw)
    return items[0] if items else ""


def _normalize_base(url: str) -> str:
    return (url or "").strip().rstrip("/")


def _pool_key(pool_id: str | None) -> str:
    return (pool_id or "").strip() or (settings.default_storage_pool_id.strip() or "default")


def _stale_cutoff() -> datetime:
    return datetime.utcnow() - timedelta(seconds=max(15, int(settings.file_service_node_stale_seconds)))


def pick_healthy_file_service_node(db: Session, pool_id: str | None) -> NasFileServiceNode | None:
    pool = _pool_key(pool_id)
    stale_before = _stale_cutoff()
    return db.scalar(
        select(NasFileServiceNode)
        .where(
            NasFileServiceNode.pool_id == pool,
            NasFileServiceNode.status == "online",
            NasFileServiceNode.last_seen_at >= stale_before,
        )
        .order_by(NasFileServiceNode.last_seen_at.desc(), NasFileServiceNode.node_id.asc())
        .limit(1)
    )


def upsert_file_service_node(
    db: Session,
    *,
    pool_id: str,
    node_id: str,
    lan_upload_base_url: str,
    lan_download_base_url: str,
    status: str = "online",
    public_upload_base_url: str | None = None,
    public_download_base_url: str | None = None,
) -> NasFileServiceNode:
    pool = _pool_key(pool_id)
    nid = (node_id or "").strip()
    if not nid:
        raise ValueError("node_id is required")
    up = join_base_urls(lan_upload_base_url) or _normalize_base(lan_upload_base_url)
    down = join_base_urls(lan_download_base_url) or _normalize_base(lan_download_base_url)
    if not up or not down:
        raise ValueError("lan_upload_base_url and lan_download_base_url are required")
    pub_up = _normalize_base(public_upload_base_url or "")
    pub_down = _normalize_base(public_download_base_url or "")
    st = (status or "online").strip().lower()
    if st not in {"online", "draining", "offline"}:
        st = "online"
    now = datetime.utcnow()
    row = db.scalar(select(NasFileServiceNode).where(NasFileServiceNode.pool_id == pool, NasFileServiceNode.node_id == nid))
    if row is None:
        row = NasFileServiceNode(
            pool_id=pool,
            node_id=nid,
            lan_upload_base_url=up,
            lan_download_base_url=down,
            public_upload_base_url=pub_up,
            public_download_base_url=pub_down,
            status=st,
            last_seen_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.lan_upload_base_url = up
        row.lan_download_base_url = down
        row.public_upload_base_url = pub_up
        row.public_download_base_url = pub_down
        row.status = st
        row.last_seen_at = now
        row.updated_at = now
    db.commit()
    db.refresh(row)
    return row


def resolve_lan_base_urls(db: Session, pool_id: str | None) -> tuple[str, str]:
    """返回 (upload_base, download_base)，无注册或未过期命中时回退 settings。

    多网段时字段可能是逗号分隔列表；这里仍返回原始串，调用方用 split_base_urls / first_base_url。
    """
    row = pick_healthy_file_service_node(db, pool_id)
    if row is not None:
        return join_base_urls(row.lan_upload_base_url), join_base_urls(row.lan_download_base_url)
    return join_base_urls(settings.lan_upload_base_url), join_base_urls(settings.lan_download_base_url)


def resolve_lan_download_bases(db: Session, pool_id: str | None) -> list[str]:
    _, down = resolve_lan_base_urls(db, pool_id)
    return split_base_urls(down)


def resolve_public_base_urls(db: Session, pool_id: str | None) -> tuple[str, str]:
    """返回 (public_upload_base, public_download_base)；无注册时回退 settings。"""
    row = pick_healthy_file_service_node(db, pool_id)
    if row is not None:
        return _normalize_base(row.public_upload_base_url), _normalize_base(row.public_download_base_url)
    return _normalize_base(settings.public_upload_base_url), _normalize_base(settings.public_download_base_url)


def count_healthy_nodes(db: Session, pool_id: str | None) -> int:
    pool = _pool_key(pool_id)
    stale_before = _stale_cutoff()
    return int(
        db.scalar(
            select(func.count())
            .select_from(NasFileServiceNode)
            .where(
                NasFileServiceNode.pool_id == pool,
                NasFileServiceNode.status == "online",
                NasFileServiceNode.last_seen_at >= stale_before,
            )
        )
        or 0
    )


def list_nodes_for_admin(db: Session, *, limit: int = 50) -> list[NasFileServiceNode]:
    return list(
        db.scalars(
            select(NasFileServiceNode).order_by(NasFileServiceNode.pool_id.asc(), NasFileServiceNode.node_id.asc()).limit(min(200, max(1, limit)))
        ).all()
    )


def refresh_single_node_public_from_nas_ingress(db: Session, request: Request) -> None:
    """
    在已有健康节点且 public_* 未配全时，用本次 NAS 请求的入站公网 IP 补写 public_*（单文件机）。
    多节点时仅更新当前 pick_healthy 命中的节点；显式已配置的非空 public_* 不会被覆盖。
    """
    if not settings.file_service_infer_public_from_ingress:
        return
    from app.services.file_service_public_infer_service import best_ingress_client_ip, infer_public_base_pair

    ip = best_ingress_client_ip(request)
    if not ip:
        return
    row = pick_healthy_file_service_node(db, None)
    if row is None:
        return
    pu = (row.public_upload_base_url or "").strip()
    pd = (row.public_download_base_url or "").strip()
    if pu and pd:
        return
    pair = infer_public_base_pair(row.lan_upload_base_url, row.lan_download_base_url, ip)
    if not pair:
        return
    bu, _bd = pair
    base = bu.strip()
    if not base:
        return
    new_pu = pu or base
    new_pd = pd or base
    if new_pu == pu and new_pd == pd:
        return
    try:
        upsert_file_service_node(
            db,
            pool_id=row.pool_id,
            node_id=row.node_id,
            lan_upload_base_url=row.lan_upload_base_url,
            lan_download_base_url=row.lan_download_base_url,
            status=row.status or "online",
            public_upload_base_url=new_pu,
            public_download_base_url=new_pd,
        )
    except Exception as exc:
        logger.warning("refresh_single_node_public_from_nas_ingress failed: %s", exc, exc_info=True)


def revive_or_bootstrap_file_service_registry_on_poll(
    db: Session,
    request: Request,
    *,
    pool: str,
    fallback_lan_up: str,
    fallback_lan_down: str,
) -> None:
    """
    单文件机：worker `GET /nas-jobs/poll` 在无健康节点时，用 ECS 已配置的 LAN_*（resolve 回退）+ 本次入站公网 IP
    写入/刷新 `nas_file_service_nodes`，使「健康节点」>0；已存在但过期的节点按原 node_id 复活 last_seen。
    """
    if not settings.file_service_poll_bootstrap_registry:
        return
    pool_key = _pool_key(pool)
    if count_healthy_nodes(db, pool_key) > 0:
        return
    fb_up = _normalize_base(fallback_lan_up) or _normalize_base(settings.lan_upload_base_url)
    fb_down = _normalize_base(fallback_lan_down) or _normalize_base(settings.lan_download_base_url)
    if not fb_up or not fb_down:
        return
    from app.services.file_service_public_infer_service import best_ingress_client_ip, infer_public_base_pair

    ip = best_ingress_client_ip(request) if settings.file_service_infer_public_from_ingress else None
    stale_row = db.scalar(
        select(NasFileServiceNode)
        .where(NasFileServiceNode.pool_id == pool_key)
        .order_by(NasFileServiceNode.last_seen_at.desc())
        .limit(1)
    )
    try:
        if stale_row is not None:
            lan_u = _normalize_base(stale_row.lan_upload_base_url) or fb_up
            lan_d = _normalize_base(stale_row.lan_download_base_url) or fb_down
            pu = _normalize_base(stale_row.public_upload_base_url)
            pd = _normalize_base(stale_row.public_download_base_url)
            if ip and settings.file_service_infer_public_from_ingress and (not pu or not pd):
                pair = infer_public_base_pair(lan_u, lan_d, ip)
                if pair:
                    bu, bd = pair
                    if not pu:
                        pu = bu
                    if not pd:
                        pd = bd
            upsert_file_service_node(
                db,
                pool_id=stale_row.pool_id,
                node_id=stale_row.node_id,
                lan_upload_base_url=lan_u,
                lan_download_base_url=lan_d,
                status="online",
                public_upload_base_url=pu or None,
                public_download_base_url=pd or None,
            )
            return
        pu2, pd2 = "", ""
        if ip and settings.file_service_infer_public_from_ingress:
            pair2 = infer_public_base_pair(fb_up, fb_down, ip)
            if pair2:
                pu2, pd2 = pair2
        nid = (settings.file_service_bootstrap_node_id or "default-file-machine").strip() or "default-file-machine"
        upsert_file_service_node(
            db,
            pool_id=pool_key,
            node_id=nid,
            lan_upload_base_url=fb_up,
            lan_download_base_url=fb_down,
            status="online",
            public_upload_base_url=pu2 or None,
            public_download_base_url=pd2 or None,
        )
    except Exception as exc:
        logger.warning("revive_or_bootstrap_file_service_registry_on_poll failed: %s", exc, exc_info=True)
