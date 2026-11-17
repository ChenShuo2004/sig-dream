"""OpenAI-compatible listener on :23333 for analyze_content.

If vLLM is not installed, forward /v1/* to a local Qwen backend
(default: already-running qwen2.5vl:7b on 127.0.0.1:11434) and rewrite
the served model name to Qwen2.5-VL-7B-Instruct so the worker default works.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

LISTEN_HOST = os.getenv("NAS_VLM_LISTEN_HOST", "127.0.0.1")
LISTEN_PORT = int(os.getenv("NAS_VLM_PORT", "23333"))
UPSTREAM = os.getenv("NAS_VLM_UPSTREAM", "http://127.0.0.1:11434").rstrip("/")
SERVED_NAME = os.getenv("NAS_VLM_MODEL", "Qwen2.5-VL-7B-Instruct")
UPSTREAM_MODEL = os.getenv("NAS_VLM_UPSTREAM_MODEL", "qwen2.5vl:7b")
ALIASES = {
    SERVED_NAME.lower(),
    "qwen2.5-vl-7b-instruct",
    "qwen2.5vl:7b",
    "qwen2.5vl",
}


def _upstream_root() -> str:
    root = UPSTREAM
    if root.endswith("/v1"):
        return root
    return f"{root}/v1"


def _forward(method: str, path: str, body: bytes | None, content_type: str) -> tuple[int, bytes, str]:
    url = f"{_upstream_root()}{path}"
    headers = {"Content-Type": content_type or "application/json"}
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=300) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "application/json")
    except HTTPError as exc:
        return exc.code, exc.read(), exc.headers.get("Content-Type", "application/json")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stdout.write("[qwen-bridge] " + (fmt % args) + "\n")
        sys.stdout.flush()

    def _send(self, status: int, payload: bytes, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/", "/health"}:
            self._send(200, json.dumps({"ok": True, "model": SERVED_NAME, "upstream": UPSTREAM}).encode("utf-8"))
            return
        if self.path.startswith("/v1/models"):
            self._send(
                200,
                json.dumps(
                    {
                        "object": "list",
                        "data": [{"id": SERVED_NAME, "object": "model", "owned_by": "local-qwen"}],
                    }
                ).encode("utf-8"),
            )
            return
        path = self.path[3:] if self.path.startswith("/v1") else self.path
        status, payload, ctype = _forward("GET", path, None, "application/json")
        self._send(status, payload, ctype)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        path = self.path[3:] if self.path.startswith("/v1") else self.path
        content_type = self.headers.get("Content-Type", "application/json")
        if path.startswith("/chat/completions") and raw:
            try:
                body = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                body = None
            if isinstance(body, dict):
                model = str(body.get("model") or "").strip()
                if not model or model.lower() in ALIASES:
                    body["model"] = UPSTREAM_MODEL
                raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        try:
            status, payload, ctype = _forward("POST", path, raw or None, content_type)
        except URLError as exc:
            self._send(
                502,
                json.dumps({"error": {"message": f"upstream unavailable ({UPSTREAM}): {exc}"}}).encode("utf-8"),
            )
            return
        self._send(status, payload, ctype)


def main() -> int:
    print(f"Qwen OpenAI-compatible bridge  http://{LISTEN_HOST}:{LISTEN_PORT}/v1")
    print(f"  served model : {SERVED_NAME}")
    print(f"  upstream     : {_upstream_root()}  model={UPSTREAM_MODEL}")
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
