import errno
import json
import os
import ssl
import shutil
import tempfile
import threading
import traceback
import hashlib
import cgi
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from datetime import datetime

import requests


API_BASE_URL = os.getenv("NAS_API_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
def _read_client_token() -> str:
    raw = os.getenv("NAS_CLIENT_TOKEN", "") or ""
    return raw.strip().lstrip("\ufeff").strip()


CLIENT_TOKEN = _read_client_token()
MOUNT_ROOT = os.getenv("NAS_MOUNT_ROOT", "Z:\\material-assets")
HOST = os.getenv("NAS_DOWNLOAD_HOST", "0.0.0.0")
PORT = int(os.getenv("NAS_DOWNLOAD_PORT", "9001"))
TLS_PORT = int(os.getenv("NAS_DOWNLOAD_TLS_PORT", "0") or "0")
TLS_CERT = (os.getenv("NAS_DOWNLOAD_TLS_CERT", "") or "").strip()
TLS_KEY = (os.getenv("NAS_DOWNLOAD_TLS_KEY", "") or "").strip()
CHUNK_SIZE = int(os.getenv("NAS_DOWNLOAD_STREAM_CHUNK_BYTES", str(1024 * 1024)))
# Optional: bind LAN-ingested materials to a storage pool (multi file-machine routing on ECS)
NAS_STORAGE_POOL_ID = os.getenv("NAS_STORAGE_POOL_ID", "").strip()
# When 1/true: prefer first X-Forwarded-For hop as client IP (use behind a reverse proxy).
_TRUST_XFF = os.getenv("NAS_DOWNLOAD_TRUST_X_FORWARDED_FOR", "").strip().lower() in ("1", "true", "yes")
YUE2_ORIGIN = (os.getenv("LAN_YUE2_URL") or "http://192.168.1.88:8190").rstrip("/")
YUE2_PROXY_PREFIX = "/yue2-proxy"
YUE2_PROXY_TIMEOUT = max(30, int(os.getenv("LAN_YUE2_PROXY_TIMEOUT", "180")))
YUE2_PROXY_MAX_BODY = max(1, int(os.getenv("LAN_YUE2_PROXY_MAX_BODY", str(80 * 1024 * 1024))))
# Keep aligned with ECS canvas_lan._yue2_proxy_timeout ladder.
YUE2_PROXY_UPLOAD_TIMEOUT_LADDER = (
    (1 * 1024 * 1024, 60),
    (5 * 1024 * 1024, 120),
    (20 * 1024 * 1024, 300),
    (50 * 1024 * 1024, 600),
    (YUE2_PROXY_MAX_BODY, 900),
)


def _yue2_proxy_timeout(path_suffix: str, body_len: int) -> int:
    safe = (path_suffix or "").lower()
    is_upload = "uploads" in safe or body_len > 256 * 1024
    if not is_upload:
        return YUE2_PROXY_TIMEOUT
    size = max(0, int(body_len or 0))
    for limit, seconds in YUE2_PROXY_UPLOAD_TIMEOUT_LADDER:
        if size <= limit:
            return max(YUE2_PROXY_TIMEOUT, seconds)
    return max(YUE2_PROXY_TIMEOUT, YUE2_PROXY_UPLOAD_TIMEOUT_LADDER[-1][1])


def _is_client_disconnect(exc: BaseException) -> bool:
    """Browser/video often closes Range streams early; not a server bug."""
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
        return True
    if isinstance(exc, OSError):
        we = getattr(exc, "winerror", None)
        if we in (10053, 10054):  # WSAECONNABORTED / WSAECONNRESET (Windows)
            return True
        if exc.errno in (errno.EPIPE, errno.ECONNRESET):
            return True
    return False


def _remote_client_ip(handler: "DownloadHandler") -> str:
    if _TRUST_XFF:
        raw = (handler.headers.get("X-Forwarded-For") or "").strip()
        if raw:
            return raw.split(",")[0].strip() or handler.client_address[0]
    return handler.client_address[0]


def _sha256_file(file_path: Path) -> str:
    hasher = hashlib.sha256()
    with file_path.open("rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _expected_file_size_from_ticket(ticket_payload: dict) -> int | None:
    fs = ticket_payload.get("file_size")
    if isinstance(fs, int) and fs > 0:
        return fs
    if isinstance(fs, float):
        iv = int(fs)
        return iv if iv > 0 else None
    if isinstance(fs, str):
        try:
            iv = int(float(fs.strip()))
            return iv if iv > 0 else None
        except (TypeError, ValueError):
            return None
    return None


def _build_nas_target_path(original_filename: str, digest: str, library_code: str = "auto") -> Path:
    now = datetime.utcnow()
    ext = Path(original_filename).suffix or ".bin"
    lib = (library_code or "auto").strip() or "auto"
    if lib not in ("auto", "personal_video"):
        lib = "auto"
    stored_filename = f"mat_{now.strftime('%Y%m%d_%H%M%S')}_{lib}_{digest[:8]}{ext.lower()}"
    rel_path = Path("originals") / lib / now.strftime("%Y") / now.strftime("%m") / stored_filename
    return Path(MOUNT_ROOT) / rel_path


def _parse_single_bytes_range(range_header: str | None, file_size: int) -> tuple[int, int] | None:
    """Return (start, end) inclusive for one Range: bytes=a-b / bytes=a- / bytes=-suffix. None = ignore Range (send full)."""
    if not range_header or file_size <= 0:
        return None
    h = range_header.strip()
    if not h.lower().startswith("bytes="):
        return None
    spec = h.split("=", 1)[1].strip()
    if "," in spec:
        return None
    start_s, _, end_s = spec.partition("-")
    start_s = start_s.strip()
    end_s = end_s.strip()
    try:
        if start_s == "" and end_s == "":
            return None
        if start_s == "":
            # suffix bytes
            suffix = int(end_s)
            if suffix <= 0:
                return None
            start = max(0, file_size - suffix)
            end = file_size - 1
        elif end_s == "":
            start = int(start_s)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s)
    except ValueError:
        return None
    if start < 0 or start >= file_size:
        return None
    if end < start:
        return None
    end = min(end, file_size - 1)
    return start, end


def _resolve_local_path(file_path: str) -> Path:
    raw = (file_path or "").strip()
    if not raw:
        raise FileNotFoundError("Empty file_path")
    candidate = Path(raw)
    if candidate.is_absolute():
        return candidate
    return Path(MOUNT_ROOT) / raw.replace("/", "\\")


class DownloadHandler(BaseHTTPRequestHandler):
    server_version = "NasDownloadServer/1.0"

    def _print_upload_path_hint(self, client_ip: str) -> None:
        clen = self.headers.get("Content-Length", "?")
        te = (self.headers.get("Transfer-Encoding") or "").strip() or "(none)"
        ua = (self.headers.get("User-Agent") or "")[:160]
        print(
            f"[nas-transfer] UPLOAD start client_ip={client_ip} peer_port={self.client_address[1]} "
            f"Content-Length={clen} Transfer-Encoding={te!r} User-Agent={ua!r}"
        )
        print(
            f"[nas-transfer] Data path: browser/frontend -> this host HTTP :{PORT} -> write under {MOUNT_ROOT} "
            f"(usually the NAS mount on this PC; not browser-direct SMB/NFS/Web to the NAS)"
        )
        print(
            "[nas-transfer] Chunking: one multipart POST at app layer (unlike ECS multipart upload API); "
            f"this service uses copyfileobj with about {max(CHUNK_SIZE, 8 * 1024 * 1024) // (1024 * 1024)}MiB reads from socket to disk."
        )

    def _print_download_path_hint(self, client_ip: str, filename: str, file_size: int, local_path: Path) -> None:
        print(
            f"[nas-download] DOWNLOAD start client_ip={client_ip} peer_port={self.client_address[1]} "
            f"bytes={file_size} file={filename!r} path={local_path}"
        )
        print(
            f"[nas-download] Data path: browser/frontend -> this host HTTP :{PORT} -> stream file under {MOUNT_ROOT} "
            f"(typically NAS mount; not browser-direct NAS storage protocol)"
        )
        print(
            f"[nas-download] Chunking: single GET + Content-Length; response body read from disk in {CHUNK_SIZE // (1024 * 1024)}MiB "
            "chunks to the socket (not multi-range segmented download)."
        )

    def _write_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Asset-Library")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, X-Asset-Library, X-NAS-Client-Token",
        )
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def _is_yue2_proxy(self, path: str) -> bool:
        return path == YUE2_PROXY_PREFIX or path.startswith(YUE2_PROXY_PREFIX + "/")

    def _yue2_proxy(self, method: str) -> None:
        """Authenticated reverse proxy to YuE2 on the office GPU machine."""
        if not CLIENT_TOKEN:
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"detail": "NAS_CLIENT_TOKEN is not configured"})
            return
        token = (self.headers.get("X-NAS-Client-Token") or "").strip()
        if token != CLIENT_TOKEN:
            self._write_json(HTTPStatus.UNAUTHORIZED, {"detail": "Invalid NAS client token"})
            return
        parsed = urlparse(self.path)
        suffix = parsed.path[len(YUE2_PROXY_PREFIX) :] or "/"
        if ".." in suffix or "\\" in suffix:
            self._write_json(HTTPStatus.BAD_REQUEST, {"detail": "invalid path"})
            return
        target = f"{YUE2_ORIGIN}{suffix}"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        length = int(self.headers.get("Content-Length") or "0")
        if length > YUE2_PROXY_MAX_BODY:
            self._write_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"detail": "body too large"})
            return
        body = self.rfile.read(length) if length > 0 else None
        headers = {}
        content_type = self.headers.get("Content-Type")
        if content_type:
            headers["Content-Type"] = content_type
        proxy_timeout = _yue2_proxy_timeout(suffix, length)
        try:
            upstream = requests.request(
                method.upper(),
                target,
                data=body,
                headers=headers,
                timeout=proxy_timeout,
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            self._write_json(HTTPStatus.BAD_GATEWAY, {"detail": f"YuE2 proxy failed: {exc}"})
            return
        self.send_response(upstream.status_code)
        self.send_header("Access-Control-Allow-Origin", "*")
        excluded = {"content-encoding", "transfer-encoding", "connection", "content-length"}
        for key, value in upstream.headers.items():
            if key.lower() in excluded:
                continue
            self.send_header(key, value)
        payload = upstream.content or b""
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if method.upper() != "HEAD" and payload:
            self.wfile.write(payload)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if self._is_yue2_proxy(parsed.path):
            self._yue2_proxy("POST")
            return
        if parsed.path != "/upload":
            self._write_json(HTTPStatus.NOT_FOUND, {"detail": "Not Found"})
            return
        if not CLIENT_TOKEN:
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"detail": "NAS_CLIENT_TOKEN is not configured"})
            return
        ticket = parse_qs(parsed.query).get("ticket", [""])[0].strip()
        if not ticket:
            self._write_json(HTTPStatus.BAD_REQUEST, {"detail": "ticket is required"})
            return

        client_ip = _remote_client_ip(self)
        try:
            verify_resp = requests.get(
                f"{API_BASE_URL}/materials/lan-upload-ticket/verify",
                params={"ticket": ticket},
                headers={"X-NAS-Client-Token": CLIENT_TOKEN},
                timeout=15,
            )
            verify_resp.raise_for_status()
            ticket_payload = verify_resp.json()
            self._print_upload_path_hint(client_ip)

            content_type = self.headers.get("Content-Type", "")
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type},
            )
            if "upload_file" not in form:
                self._write_json(HTTPStatus.BAD_REQUEST, {"detail": "upload_file is required"})
                return
            file_item = form["upload_file"]
            if not getattr(file_item, "file", None):
                self._write_json(HTTPStatus.BAD_REQUEST, {"detail": "invalid upload_file"})
                return

            original_filename = str(ticket_payload.get("original_filename") or file_item.filename or "upload.bin")
            expected_size = _expected_file_size_from_ticket(ticket_payload)
            if expected_size is None:
                print("[nas-transfer] lan_upload ticket has no file_size; size mismatch will not be rejected")

            staging_root = Path(MOUNT_ROOT) / "originals" / "_staging"
            staging_root.mkdir(parents=True, exist_ok=True)
            fd, tmp_name = tempfile.mkstemp(prefix="lan_up_", suffix=".part", dir=str(staging_root))
            tmp_path = Path(tmp_name)
            try:
                stream_chunk = max(CHUNK_SIZE, 8 * 1024 * 1024)
                with os.fdopen(fd, "wb") as out:
                    shutil.copyfileobj(file_item.file, out, length=stream_chunk)
            except Exception:
                try:
                    tmp_path.unlink(missing_ok=True)
                except OSError:
                    pass
                raise

            file_size = tmp_path.stat().st_size
            if file_size <= 0:
                tmp_path.unlink(missing_ok=True)
                self._write_json(HTTPStatus.BAD_REQUEST, {"detail": "empty file"})
                return
            if expected_size is not None and file_size != expected_size:
                try:
                    tmp_path.unlink(missing_ok=True)
                except OSError:
                    pass
                self._write_json(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "detail": f"size mismatch: received {file_size} bytes, expected {expected_size}",
                        "file_size": file_size,
                        "expected_file_size": expected_size,
                    },
                )
                return

            digest = _sha256_file(tmp_path)
            ticket_sha = str(ticket_payload.get("sha256") or "").strip().lower()
            if len(ticket_sha) == 64 and all(c in "0123456789abcdef" for c in ticket_sha):
                if digest != ticket_sha:
                    try:
                        tmp_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                    self._write_json(
                        HTTPStatus.BAD_REQUEST,
                        {
                            "detail": f"sha256 mismatch: file digest {digest} != ticket {ticket_sha}",
                            "file_size": file_size,
                        },
                    )
                    return
            target_path = _build_nas_target_path(
                original_filename,
                digest,
                str(ticket_payload.get("library") or "auto"),
            )
            target_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                tmp_path.replace(target_path)
            except OSError:
                shutil.move(str(tmp_path), str(target_path))
            if _sha256_file(target_path) != digest:
                raise RuntimeError("sha256 verification failed after write")

            ingest_payload = {
                "title": str(ticket_payload.get("title") or Path(original_filename).stem),
                "description": ticket_payload.get("description"),
                "tag_ids": ticket_payload.get("tag_ids") or [],
                "uploader": str(ticket_payload.get("uploader") or "lan-uploader"),
                "original_filename": original_filename,
                "stored_filename": target_path.name,
                "nas_file_path": str(target_path),
                "file_size": file_size,
                "sha256": digest,
                "library": str(ticket_payload.get("library") or "auto").strip() or "auto",
            }
            if NAS_STORAGE_POOL_ID:
                ingest_payload["storage_pool_id"] = NAS_STORAGE_POOL_ID
            ingest_resp = requests.post(
                f"{API_BASE_URL}/materials/ingest-from-nas",
                headers={"X-NAS-Client-Token": CLIENT_TOKEN, "Content-Type": "application/json"},
                json=ingest_payload,
                timeout=120,
            )
            ingest_resp.raise_for_status()
            ingest_data = ingest_resp.json()
            try:
                requests.post(
                    f"{API_BASE_URL}/materials/lan-upload-ticket/report",
                    headers={"X-NAS-Client-Token": CLIENT_TOKEN, "Content-Type": "application/json"},
                    json={"ticket": ticket, "success": True, "bytes_received": file_size, "message": "ingested"},
                    timeout=10,
                ).raise_for_status()
            except Exception as report_exc:
                print(f"[nas-transfer] upload report failed: {report_exc}")

            self._write_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "file_size": file_size,
                    "sha256": digest,
                    "nas_file_path": str(target_path),
                    "ingest": ingest_data,
                },
            )
            print(
                f"[nas-transfer] UPLOAD ok client_ip={client_ip} bytes={file_size} "
                f"original_filename={original_filename!r} stored={target_path.name}"
            )
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            detail = ""
            payload = None
            if exc.response is not None:
                detail = exc.response.text
                try:
                    payload = exc.response.json()
                except Exception:
                    payload = None
            # Idempotent: file already on NAS but ECS says duplicate; treat as success for the UI.
            if status_code == 409 and isinstance(payload, dict):
                detail_text = str(payload.get("detail") or "")
                # 与 ECS `ingest_material_from_nas` / 签票 409 文案对齐（旧版仅匹配 "Material already ingested" 会漏判）
                if "Material already ingested" in detail_text or "Material with same sha256 already exists" in detail_text:
                    try:
                        if 'target_path' in locals() and target_path.exists():
                            target_path.unlink()
                    except Exception:
                        pass
                    self._write_json(
                        HTTPStatus.OK,
                        {
                            "status": "exists",
                            "duplicate": True,
                            "detail": detail_text,
                        },
                    )
                    print(f"[nas-transfer] UPLOAD duplicate client_ip={client_ip} detail={detail_text!r}")
                    return
            print(f"[nas-transfer] UPLOAD failed client_ip={client_ip} http_error status={status_code}")
            self._write_json(HTTPStatus.BAD_GATEWAY, {"detail": f"upload verify/ingest failed: {detail}"})
        except Exception as exc:
            print(f"[nas-transfer] UPLOAD failed client_ip={client_ip} error={exc!r}")
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"detail": str(exc)})

    def do_GET(self) -> None:  # noqa: N802
        response_started = False
        parsed = urlparse(self.path)
        if self._is_yue2_proxy(parsed.path):
            self._yue2_proxy("GET")
            return
        if parsed.path == "/health":
            node_id = os.getenv("NAS_FILE_SERVICE_NODE_ID", "").strip() or os.getenv("COMPUTERNAME", "file-machine")
            pool = NAS_STORAGE_POOL_ID or "default"
            self._write_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "node_id": node_id,
                    "storage_pool_id": pool,
                    "version": "1.0.0",
                    "time": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                },
            )
            return
        if parsed.path != "/download":
            self._write_json(HTTPStatus.NOT_FOUND, {"detail": "Not Found"})
            return
        if not CLIENT_TOKEN:
            self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"detail": "NAS_CLIENT_TOKEN is not configured"})
            return

        ticket = parse_qs(parsed.query).get("ticket", [""])[0].strip()
        if not ticket:
            self._write_json(HTTPStatus.BAD_REQUEST, {"detail": "ticket is required"})
            return

        client_ip = "?"
        try:
            client_ip = _remote_client_ip(self)
            bytes_sent = 0
            verify_resp = requests.get(
                f"{API_BASE_URL}/materials/download-ticket/verify",
                params={"ticket": ticket},
                headers={"X-NAS-Client-Token": CLIENT_TOKEN},
                timeout=15,
            )
            verify_resp.raise_for_status()
            payload = verify_resp.json()
            local_path = _resolve_local_path(str(payload.get("file_path", "")))
            if not local_path.exists() or not local_path.is_file():
                self._write_json(
                    HTTPStatus.NOT_FOUND,
                    {"detail": f"File not found on LAN server: {local_path}"},
                )
                return

            filename = str(payload.get("original_filename") or local_path.name)
            file_size = local_path.stat().st_size
            self._print_download_path_hint(client_ip, filename, file_size, local_path)
            rng = _parse_single_bytes_range(self.headers.get("Range"), file_size)
            if rng is None:
                self.send_response(HTTPStatus.OK)
                start, end = 0, max(0, file_size - 1)
                content_length = file_size
            else:
                start, end = rng
                content_length = end - start + 1
                self.send_response(HTTPStatus.PARTIAL_CONTENT)
            response_started = True
            suffix = local_path.suffix.lower()
            if suffix == ".mp4":
                ctype = "video/mp4"
            elif suffix == ".webm":
                ctype = "video/webm"
            elif suffix in (".mov", ".m4v"):
                ctype = "video/quicktime"
            elif suffix == ".mkv":
                ctype = "video/x-matroska"
            elif suffix in (".jpg", ".jpeg"):
                ctype = "image/jpeg"
            elif suffix == ".png":
                ctype = "image/png"
            elif suffix == ".webp":
                ctype = "image/webp"
            elif suffix == ".gif":
                ctype = "image/gif"
            else:
                ctype = "application/octet-stream"
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(content_length))
            if rng is not None:
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            safe_ascii_name = "".join(ch if ord(ch) < 128 else "_" for ch in filename) or "download.bin"
            utf8_name = quote(filename)
            fn_lower = filename.lower()
            # ECS verify 返回 inline_disposition：正式下载 False（attachment）；缩略图/预览 True（inline）。
            # 旧版 ECS 无该字段时回退按扩展名推断，避免仅升级 NAS 时破坏内联预览。
            if "inline_disposition" in payload:
                use_inline = bool(payload.get("inline_disposition"))
            else:
                use_inline = fn_lower.endswith(
                    (".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi", ".ogv")
                )
            disp = "inline" if use_inline else "attachment"
            self.send_header(
                "Content-Disposition",
                f"{disp}; filename=\"{safe_ascii_name}\"; filename*=UTF-8''{utf8_name}",
            )
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()
            with local_path.open("rb") as f:
                if start > 0:
                    f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = f.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    bytes_sent += len(chunk)
                    remaining -= len(chunk)

            print(f"[nas-download] DOWNLOAD ok client_ip={client_ip} bytes_sent={bytes_sent}")
            try:
                requests.post(
                    f"{API_BASE_URL}/materials/download-ticket/report",
                    json={"ticket": ticket, "success": True, "bytes_sent": bytes_sent},
                    headers={"X-NAS-Client-Token": CLIENT_TOKEN},
                    timeout=10,
                ).raise_for_status()
            except Exception as report_exc:
                print(f"[nas-download] report usage failed: {report_exc}")
        except requests.HTTPError as exc:
            detail = ""
            if exc.response is not None:
                try:
                    detail = exc.response.text
                except Exception:
                    detail = str(exc)
            print(f"[nas-download] verify error client_ip={client_ip}: {detail}")
            if not response_started:
                self._write_json(HTTPStatus.BAD_GATEWAY, {"detail": f"verify failed: {detail}"})
        except Exception as exc:
            if _is_client_disconnect(exc):
                print(f"[nas-download] client closed connection (normal for video Range/cancel) client_ip={client_ip} bytes_sent={bytes_sent}: {exc!r}")
                return
            print(f"[nas-download] unhandled error client_ip={client_ip}: {exc}\n{traceback.format_exc()}")
            if not response_started:
                self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"detail": str(exc)})

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if self._is_yue2_proxy(parsed.path):
            self._yue2_proxy("PUT")
            return
        self._write_json(HTTPStatus.NOT_FOUND, {"detail": "Not Found"})

    def do_PATCH(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if self._is_yue2_proxy(parsed.path):
            self._yue2_proxy("PATCH")
            return
        self._write_json(HTTPStatus.NOT_FOUND, {"detail": "Not Found"})

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if self._is_yue2_proxy(parsed.path):
            self._yue2_proxy("DELETE")
            return
        self._write_json(HTTPStatus.NOT_FOUND, {"detail": "Not Found"})

    def do_HEAD(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if self._is_yue2_proxy(parsed.path):
            self._yue2_proxy("HEAD")
            return
        self._write_json(HTTPStatus.NOT_FOUND, {"detail": "Not Found"})

    def log_message(self, fmt: str, *args) -> None:
        print(f"[nas-download] {self.address_string()} - {fmt % args}")


def main() -> None:
    print(
        f"[nas-download] start server host={HOST} port={PORT} api={API_BASE_URL} mount_root={MOUNT_ROOT}"
    )
    print(
        "[nas-download] Client IP for upload/download is the TCP peer of this process; "
        "behind a reverse proxy, forward X-Forwarded-For and set NAS_DOWNLOAD_TRUST_X_FORWARDED_FOR=1."
    )
    print(
        "[nas-download] Browsers do not speak NAS storage protocols; this process reads/writes NAS_MOUNT_ROOT "
        f"(often an SMB drive letter). LAN upload is one multipart POST (not ECS multipart API); stream chunk size is configurable."
    )
    print(f"[nas-download] YuE2 proxy {YUE2_PROXY_PREFIX}/* → {YUE2_ORIGIN} (requires X-NAS-Client-Token)")
    httpd = ThreadingHTTPServer((HOST, PORT), DownloadHandler)
    workers: list[threading.Thread] = [
        threading.Thread(target=httpd.serve_forever, name="lan-http", daemon=True)
    ]
    if TLS_PORT > 0 and TLS_CERT and TLS_KEY and Path(TLS_CERT).is_file() and Path(TLS_KEY).is_file():
        httpsd = ThreadingHTTPServer((HOST, TLS_PORT), DownloadHandler)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(TLS_CERT, TLS_KEY)
        httpsd.socket = ctx.wrap_socket(httpsd.socket, server_side=True)
        workers.append(threading.Thread(target=httpsd.serve_forever, name="lan-https", daemon=True))
        print(f"[nas-download] TLS also listening on {HOST}:{TLS_PORT} (HTTPS, for public HTTPS site mixed-content bypass)")
    elif TLS_PORT > 0:
        print(f"[nas-download] TLS port {TLS_PORT} set but cert/key missing; HTTPS not started")
    for worker in workers:
        worker.start()
    workers[0].join()


if __name__ == "__main__":
    main()
