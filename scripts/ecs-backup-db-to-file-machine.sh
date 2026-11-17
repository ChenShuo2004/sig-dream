#!/usr/bin/env bash
# Run on ECS: read backend/.env DATABASE_URL, pg_dump plain SQL to /tmp, scp to file machine, remove temp.
# Prereqs: postgresql-client (pg_dump), openssh-client (scp), python3; passwordless SSH from ECS to file machine.
#
# Required env:
#   BACKUP_FILE_MACHINE_SCP_DEST   SCP target directory, form user@host:/path (no trailing filename).
#                                  Windows OpenSSH examples: backups@192.168.1.10:D:/db-backups
# Optional env:
#   REMOTE_APP_DIR                 default /root/apps/light_content_workflow_platform
#   BACKUP_FILE_MACHINE_SSH_IDENTITY  Path on ECS to private key for file machine (otherwise default ssh keys)
#   BACKUP_PREFIX                  default light-content-db

set -euo pipefail

REMOTE_APP_DIR="${REMOTE_APP_DIR:-/root/apps/light_content_workflow_platform}"
BACKUP_FILE_MACHINE_SCP_DEST="${BACKUP_FILE_MACHINE_SCP_DEST:-}"
BACKUP_FILE_MACHINE_SSH_IDENTITY="${BACKUP_FILE_MACHINE_SSH_IDENTITY:-}"
BACKUP_PREFIX="${BACKUP_PREFIX:-light-content-db}"

if [[ -z "${BACKUP_FILE_MACHINE_SCP_DEST}" ]]; then
  echo "[ecs-backup] ERROR: set BACKUP_FILE_MACHINE_SCP_DEST, e.g. backups@192.168.1.10:D:/db-backups" >&2
  exit 1
fi

if [[ "${BACKUP_FILE_MACHINE_SCP_DEST}" != *"@"* || "${BACKUP_FILE_MACHINE_SCP_DEST}" != *":"* ]]; then
  echo "[ecs-backup] ERROR: BACKUP_FILE_MACHINE_SCP_DEST must look like user@host:/path" >&2
  exit 1
fi

BACKEND_DIR="${REMOTE_APP_DIR%/}/backend"
if [[ ! -f "${BACKEND_DIR}/.env" ]]; then
  echo "[ecs-backup] ERROR: missing ${BACKEND_DIR}/.env" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[ecs-backup] ERROR: pg_dump not in PATH (install postgresql-client)" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[ecs-backup] ERROR: python3 required to parse DATABASE_URL" >&2
  exit 1
fi
if ! command -v scp >/dev/null 2>&1; then
  echo "[ecs-backup] ERROR: scp not in PATH (install openssh-client)" >&2
  exit 1
fi

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

if [[ -z "${PGURL}" ]]; then
  echo "[ecs-backup] ERROR: empty DATABASE_URL" >&2
  exit 1
fi

TS="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
HOST_TAG="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo ecs")"
FNAME="${BACKUP_PREFIX}-${HOST_TAG}-${TS}.sql"
REMOTE_TMP="/tmp/${FNAME}"

echo "[ecs-backup] dumping to ${REMOTE_TMP} ..."
pg_dump "${PGURL}" -Fp --no-owner --no-acl -f "${REMOTE_TMP}"
ls -la "${REMOTE_TMP}"

SCP_BASE=()
if [[ -n "${BACKUP_FILE_MACHINE_SSH_IDENTITY}" ]]; then
  if [[ ! -f "${BACKUP_FILE_MACHINE_SSH_IDENTITY}" ]]; then
    echo "[ecs-backup] ERROR: BACKUP_FILE_MACHINE_SSH_IDENTITY not a file: ${BACKUP_FILE_MACHINE_SSH_IDENTITY}" >&2
    exit 1
  fi
  SCP_BASE+=(-i "${BACKUP_FILE_MACHINE_SSH_IDENTITY}")
fi
SCP_BASE+=(
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15
)

DEST="${BACKUP_FILE_MACHINE_SCP_DEST%/}/${FNAME}"
echo "[ecs-backup] scp -> ${DEST}"
scp "${SCP_BASE[@]}" "${REMOTE_TMP}" "${DEST}"

rm -f "${REMOTE_TMP}"
echo "[ecs-backup] ok removed ${REMOTE_TMP}"
