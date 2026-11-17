#!/usr/bin/env bash
# Run on ECS only: pg_dump to a fixed directory as light-content-latest.sql (atomic replace).
# File machine pulls this path with scp (same SSH key as deploy), no OpenSSH Server on file PC required.
#
# Optional env:
#   REMOTE_APP_DIR   default /root/apps/light_content_workflow_platform
#   BACKUP_DIR       default /root/light-content-db-backups

set -euo pipefail

REMOTE_APP_DIR="${REMOTE_APP_DIR:-/root/apps/light_content_workflow_platform}"
BACKUP_DIR="${BACKUP_DIR:-/root/light-content-db-backups}"
BACKEND_DIR="${REMOTE_APP_DIR%/}/backend"
OUT="${BACKUP_DIR}/light-content-latest.sql"
TMP="${BACKUP_DIR}/light-content-latest.sql.tmp"

if [[ ! -f "${BACKEND_DIR}/.env" ]]; then
  echo "[ecs-backup-local] ERROR: missing ${BACKEND_DIR}/.env" >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[ecs-backup-local] ERROR: pg_dump not in PATH (apt install postgresql-client)" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[ecs-backup-local] ERROR: python3 required" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}" 2>/dev/null || true

PGURL="$(cd "${BACKEND_DIR}" && python3 - <<'PY'
from pathlib import Path

text = Path(".env").read_text(encoding="utf-8")
for line in text.splitlines():
    s = line.strip()
    if not s or s.startswith("#"):
        continue
    if s.startswith("DATABASE_URL="):
        v = s.split("=", 1)[1].strip().strip('"').strip("'")
        v = (
            v.replace("postgresql+psycopg://", "postgresql://")
            .replace("postgresql+psycopg2://", "postgresql://")
            .replace("postgresql+asyncpg://", "postgresql://")
        )
        print(v)
        break
else:
    raise SystemExit("DATABASE_URL not found in .env")
PY
)"

echo "[ecs-backup-local] dumping -> ${TMP} ..."
pg_dump "${PGURL}" -Fp --no-owner --no-acl -f "${TMP}"
chmod 600 "${TMP}" 2>/dev/null || true
mv -f "${TMP}" "${OUT}"
ls -la "${OUT}"
echo "[ecs-backup-local] ok ${OUT}"
