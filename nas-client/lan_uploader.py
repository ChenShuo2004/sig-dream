import argparse
import hashlib
import shutil
from datetime import datetime
from pathlib import Path

import requests


def sha256_file(file_path: Path) -> str:
    hasher = hashlib.sha256()
    with file_path.open("rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="LAN direct uploader to NAS + ECS ingest registration")
    parser.add_argument("--api-base-url", required=True)
    parser.add_argument("--nas-client-token", required=True)
    parser.add_argument("--nas-mount-root", required=True)
    parser.add_argument("--file", required=True, help="Local file path to upload")
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--uploader", default="lan-uploader")
    parser.add_argument("--tag-ids", default="", help="Comma separated tag ids")
    parser.add_argument("--storage-pool-id", default="", help="Optional ECS storage pool id (default pool if empty)")
    parser.add_argument("--library", default="auto", help="Asset library code: auto | personal_video")
    args = parser.parse_args()

    local_file = Path(args.file)
    if not local_file.exists() or not local_file.is_file():
        raise RuntimeError(f"File not found: {local_file}")

    digest = sha256_file(local_file)
    ext = local_file.suffix or ".bin"
    now = datetime.utcnow()
    lib = (args.library or "").strip() or "auto"
    if lib not in ("auto", "personal_video"):
        lib = "auto"
    stored_filename = f"mat_{now.strftime('%Y%m%d_%H%M%S')}_{lib}_{digest[:8]}{ext.lower()}"
    rel_path = Path("originals") / lib / now.strftime("%Y") / now.strftime("%m") / stored_filename
    target_path = Path(args.nas_mount_root) / rel_path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(local_file, target_path)

    payload = {
        "title": args.title,
        "description": args.description or None,
        "tag_ids": [item.strip() for item in args.tag_ids.split(",") if item.strip()],
        "uploader": args.uploader,
        "original_filename": local_file.name,
        "stored_filename": stored_filename,
        "nas_file_path": str(target_path),
        "file_size": local_file.stat().st_size,
        "sha256": digest,
    }
    sp = (args.storage_pool_id or "").strip()
    if sp:
        payload["storage_pool_id"] = sp
    payload["library"] = lib

    resp = requests.post(
        f"{args.api_base_url.rstrip('/')}/materials/ingest-from-nas",
        headers={"X-NAS-Client-Token": args.nas_client_token, "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    try:
        data = resp.json()
    except Exception:
        data = {"raw": resp.text}
    if not resp.ok:
        raise RuntimeError(f"Ingest failed: status={resp.status_code}, body={data}")
    print("LAN ingest success:")
    print(data)
    print(f"NAS file: {target_path}")


if __name__ == "__main__":
    main()
