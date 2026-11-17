@echo off
REM Copy this file to local-env.bat and fill values. Do not commit local-env.bat.
REM Use ASCII only in local-env.bat (no Chinese punctuation like full-width colon) so cmd.exe on GBK Windows parses lines correctly.
REM If another .bat uses "call local-env.bat", end local-env with "exit /b 0" (or omit exit). Never plain "exit" or the parent window closes ("flash").

REM ===== NAS / LAN transfer (optional) =====
REM start-nas-direct-services.bat reads these if set (before set/p prompt). Must match ECS backend/.env NAS_CLIENT_TOKEN.
REM Optional override: nas-client\nas-client-token.txt (one line) wins over NAS_CLIENT_TOKEN here.
set "NAS_PASSWORD=REPLACE_ME"
set "NAS_CLIENT_TOKEN=REPLACE_ME"
REM SMB for desktop drag (ensure-nas-smb.ps1): NAS user on the file machine, default PA
REM set "NAS_USER=PA"
REM SMB on NAS (see 左侧.md: NAS=YOUR_NAS_HOST). HTTP download server may be 192.168.1.20:9001.
REM set "NAS_HOST=YOUR_NAS_HOST"
REM set "NAS_SHARE=nas-file"
REM set "LCP_MATERIAL_ASSETS_ROOT=\\YOUR_NAS_HOST\nas-file\material-assets"
REM set "NAS_MAP_DRIVE=Z:"
REM Same value as above or first line of nas-client-token.txt: deploy-oneclick.ps1 merges into ECS backend/.env after a successful deploy (skips REPLACE_* placeholders).
REM set "DEPLOY_NAS_CLIENT_TOKEN=paste_same_token_as_file_machine"

REM File machine LAN/HTTP roots (no trailing slash). deploy-oneclick.ps1 writes LAN_* / PUBLIC_* into remote backend/.env so download-route returns bases.
REM HTTPS site cannot embed http://192.168.x (mixed content). File machine now also listens HTTPS :9443.
REM Office LAN has 192.168.1 and 192.168.2. Comma-separated if the file machine has NICs on both.
REM Heartbeat/start scripts also auto-detect local 192.168.1.* / 192.168.2.* and advertise all of them.
REM set "DEPLOY_LAN_UPLOAD_BASE_URL=https://192.168.1.20:9443,https://192.168.2.20:9443"
REM set "DEPLOY_LAN_DOWNLOAD_BASE_URL=https://192.168.1.20:9443,https://192.168.2.20:9443"
REM Desktop installer NAS UNC (pack-desktop.ps1). If unset, derived from DEPLOY_LAN_* host + \\host\nas-file\material-assets
REM set "LCP_MATERIAL_ASSETS_ROOT=\\YOUR_NAS_HOST\nas-file\material-assets"
REM set "DEPLOY_PUBLIC_UPLOAD_BASE_URL=https://your-file-machine.example.com"
REM set "DEPLOY_PUBLIC_DOWNLOAD_BASE_URL=https://your-file-machine.example.com"

REM Local SSH DB tunnel port (file PC). Maps localhost:PORT -> ECS 127.0.0.1:5432.
REM Default 15432 (avoids Windows WinNAT excluded ranges that often cover 5432). ECS Postgres stays on 5432.
REM set "DB_TUNNEL_LOCAL_PORT=15432"

REM ===== Deploy scripts (optional): release-new-version.bat, ECS one-click migrate .bat in repo root =====
set "SERVER_USER=root"
set "SERVER_HOST=YOUR_ECS_HOST"
set "REMOTE_APP_DIR=/root/apps/light_content_workflow_platform"
set "COMMIT_MESSAGE="
REM Optional for release-new-version.bat -> deploy-oneclick.ps1:
REM set "MIGRATE_SKIP_COMMIT=1"
REM set "BUILD_VERSION=abc1234-20260501-120000"

REM ===== SSH to ECS (deploy-oneclick.ps1) =====
REM Default uses BatchMode=yes: password prompt is disabled. Use key file or interactive flag.
REM set "DEPLOY_SSH_IDENTITY_FILE=%USERPROFILE%\.ssh\id_ed25519"
REM set "DEPLOY_SSH_INTERACTIVE=1"

REM setup-nginx-reverse-proxy.bat: write nginx on ECS to proxy port 80 to Next (optional; space-separated server_name)
REM Production public host (HTTPS via Let’s Encrypt on ECS nginx):
set "NGINX_SERVER_NAME=your.domain.example.com"
REM set "NGINX_LISTEN_PORT=80"
REM set "NGINX_UPSTREAM_HOST=127.0.0.1"
REM set "NGINX_UPSTREAM_PORT=3000"

REM release-new-version.bat defaults DEPLOY_REMOTE_AUTO_CLONE=1 for one-click new ECS. Set 0 here if remote dir always exists.
REM set "DEPLOY_REMOTE_AUTO_CLONE=0"
REM When 1: pass -RemoteAutoCloneIfMissing to deploy-oneclick.ps1. GitHub HTTPS origin is rewritten to git@ on the server.

REM release-new-version.bat defaults DEPLOY_REMOTE_PREP_PYTHON_VENV=1: before deploy, SSH once to apt-get install python3-venv. Set 0 on stable servers to skip apt update.
REM set "DEPLOY_REMOTE_PREP_PYTHON_VENV=0"

REM release-new-version.bat defaults DEPLOY_BOOTSTRAP_POSTGRES=1: on ECS, if DATABASE_URL is localhost and 5432 is down, deploy.sh apt-installs PostgreSQL and creates DB light_content. Set 0 if ECS uses RDS only.
REM set "DEPLOY_BOOTSTRAP_POSTGRES=0"

REM Optional: backup-ecs-database.bat writes .sql here (default = repo root). release-new-version.bat integrated pull uses the same. Example:
REM set "BACKUP_OUTPUT_DIR=D:\db-backups"
REM Integrated DB backup (deploy-oneclick.ps1): pg_dump+scp BEFORE remote deploy.sh; set 0 to skip
REM set "DEPLOY_POST_RELEASE_DB_BACKUP=0"

REM DB backup pull (file PC): pull-ecs-database-backup.bat uses SERVER_* , DEPLOY_SSH_* , BACKUP_OUTPUT_DIR. Doc: docs/archive/2026年5月4日ECS数据库备份到文件机.md
REM Optional if ECS uses non-default dump path: set "ECS_BACKUP_REMOTE_FILE=/root/light-content-db-backups/light-content-latest.sql"
REM ECS cron: scripts/ecs-backup-db-local.sh

REM start-nas-direct-services.bat: optional 5th PS window = loop scp pull ECS DB backup (needs SERVER_* + DEPLOY_SSH_* + BACKUP_OUTPUT_DIR like pull script)
REM set "NAS_START_DB_BACKUP_PULL_LOOP=1"
REM set "NAS_DB_BACKUP_PULL_INTERVAL_HOURS=24"

REM start-nas-direct-services.bat also opens Qwen2.5-VL on :23333 (run-qwen-vlm.ps1). Set 0 to skip.
REM set "NAS_START_QWEN_VLM=0"
REM If vLLM is not in PATH python, put your own Qwen OpenAI-compatible start command here:
REM set "NAS_VLM_START_CMD=python -m vllm.entrypoints.openai.api_server --model Qwen/Qwen2.5-VL-7B-Instruct --served-model-name Qwen2.5-VL-7B-Instruct --port 23333"
REM set "NAS_VLM_PORT=23333"
REM set "NAS_VLM_MODEL=Qwen2.5-VL-7B-Instruct"

REM Optional preset for 仅导入数据库到ECS.bat / restore-ecs-database.ps1 (skip prompt if set). Does NOT run deploy.
REM set "DEPLOY_PG_DUMP_SQL=D:\path\to\ecs-db-backup-2026-05-03T07-19-39-646Z.sql"

REM New ECS order: 1) release-new-version.bat 2) import DB batch 3) start-nas-direct-services.bat on file PC (see md 2026-05-09 deploy guide).

REM ===== GitHub Releases (desktop-client 打包并发布到GitHub.bat only) =====
REM release-new-version.bat git push uses SSH keys; electron-builder upload needs PAT:
REM set "GH_TOKEN=ghp_your_full_token_here"

REM Optional: force clone URL on ECS (e.g. private HTTPS with PAT). Do not commit secrets.
REM set "DEPLOY_GIT_CLONE_URL=git@github.com:YOUR_ORG/YOUR_REPO.git"
REM set "DEPLOY_GIT_CLONE_USE_ORIGIN=1"
