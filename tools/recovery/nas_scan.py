#!/usr/bin/env python3
"""
Scan NAS originals folder and export inventory CSV.
Usage:
  python tools/recovery/nas_scan.py --nas-root "Z:\\material-assets\\originals" --out "nas_inventory.csv"
"""

import argparse
import csv
import hashlib
from datetime import datetime
from pathlib import Path


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan NAS files and export inventory CSV")
    parser.add_argument("--nas-root", required=True, help="NAS originals root, e.g. Z:\\material-assets\\originals")
    parser.add_argument("--out", default="nas_inventory.csv", help="Output CSV path")
    args = parser.parse_args()

    nas_root = Path(args.nas_root)
    out_csv = Path(args.out)
    if not nas_root.exists() or not nas_root.is_dir():
        raise SystemExit(f"Invalid NAS root: {nas_root}")

    rows = []
    for p in nas_root.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(nas_root).as_posix()
        ext = p.suffix.lower().lstrip(".") or ""
        stat = p.stat()
        rows.append(
            {
                "nas_abs_path": str(p),
                "nas_rel_path": f"originals/{rel}",
                "stored_filename": p.name,
                "extension": ext,
                "file_size": stat.st_size,
                "sha256": sha256_file(p),
                "scanned_at": datetime.utcnow().isoformat(),
            }
        )

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "nas_abs_path",
                "nas_rel_path",
                "stored_filename",
                "extension",
                "file_size",
                "sha256",
                "scanned_at",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"done rows={len(rows)} out={out_csv}")


if __name__ == "__main__":
    main()
