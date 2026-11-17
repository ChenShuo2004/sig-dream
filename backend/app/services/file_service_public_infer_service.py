"""单文件机场景：根据 NAS/文件机访问 ECS 时的入站公网 IP，推断 public_* 根地址（不经 ECS 中转传文件）。"""

from __future__ import annotations

import ipaddress
import logging
from urllib.parse import urlparse

from fastapi import Request

logger = logging.getLogger(__name__)


def _normalize(s: str) -> str:
    return (s or "").strip()


def best_ingress_client_ip(request: Request) -> str | None:
    """
    取「对 ECS 发起请求的客户端」在公网上的标识。
    - 直连：request.client.host 多为出口公网 IP。
    - 经本机 Nginx 反代：peer 常为 127.0.0.1，此时尝试 X-Forwarded-For 首跳（须为公网，防伪造）。
    """
    peer = ""
    if request.client:
        peer = (request.client.host or "").strip()
    if not peer:
        return None

    def _is_private_or_loopback(host: str) -> bool:
        try:
            ip = ipaddress.ip_address(host)
            return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved)
        except ValueError:
            return False

    if _is_private_or_loopback(peer):
        xff = _normalize(request.headers.get("x-forwarded-for") or "")
        if not xff:
            return None
        first = xff.split(",")[0].strip()
        if not first:
            return None
        try:
            ip = ipaddress.ip_address(first)
            if ip.is_global:
                return str(ip)
        except ValueError:
            return None
        return None

    try:
        ip = ipaddress.ip_address(peer)
        if ip.is_global:
            return str(ip)
    except ValueError:
        return None
    return None


def _host_for_url(ingress_ip: str) -> str:
    try:
        ip = ipaddress.ip_address(ingress_ip.strip())
        if ip.version == 6:
            return f"[{ip}]"
    except ValueError:
        pass
    return ingress_ip.strip()


def infer_public_base_pair(lan_upload_base_url: str, lan_download_base_url: str, ingress_ip: str) -> tuple[str, str] | None:
    """
    用 LAN 根地址的 scheme + 端口，替换 host 为入站公网 IP，得到浏览器可尝试的公网直连根（单文件机上传/下载同根）。
    """
    from app.services.file_service_registry_service import first_base_url

    ld = first_base_url(lan_download_base_url) or _normalize(lan_download_base_url)
    lu = first_base_url(lan_upload_base_url) or _normalize(lan_upload_base_url)
    base_lan = ld or lu
    if not base_lan or not ingress_ip:
        return None
    parsed = urlparse(base_lan if "://" in base_lan else f"http://{base_lan}")
    scheme = (parsed.scheme or "http").lower()
    if scheme not in ("http", "https"):
        scheme = "http"
    port = parsed.port
    if port is None:
        port = 443 if scheme == "https" else 80
    host = _host_for_url(ingress_ip)
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        netloc = host
    else:
        netloc = f"{host}:{port}"
    base = f"{scheme}://{netloc}".rstrip("/")
    return (base, base)


def merge_public_bases_from_ingress(
    *,
    lan_upload_base_url: str,
    lan_download_base_url: str,
    public_upload_base_url: str | None,
    public_download_base_url: str | None,
    request: Request,
    infer_enabled: bool,
) -> tuple[str, str]:
    """心跳入参：未显式填写 public_* 时，用入站公网 IP 补全（显式非空则不改）。"""
    pu = _normalize(public_upload_base_url or "")
    pd = _normalize(public_download_base_url or "")
    if not infer_enabled:
        return pu, pd
    if pu and pd:
        return pu, pd
    ip = best_ingress_client_ip(request)
    if not ip:
        return pu, pd
    pair = infer_public_base_pair(lan_upload_base_url, lan_download_base_url, ip)
    if not pair:
        return pu, pd
    bu, bd = pair
    base = bu or bd
    if not pu:
        pu = base
    if not pd:
        pd = base
    return pu, pd
