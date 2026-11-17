#!/usr/bin/env bash
# 服务器一键发布：与《docs/archive/2026年4月26日更新发布流程》一致，并针对小内存 ECS 优化 git 拉取。
set -euo pipefail
# 保留 SSH 非登录会话里已有的 PATH（如 /opt/...），避免「只写死标准路径」导致找不到 python3
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}"

# 从 git 检出时 deploy.sh 可能无 +x，导致 ./deploy.sh Permission denied
_DEPLOY_SELF="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
if [ -f "$_DEPLOY_SELF" ] && [ ! -x "$_DEPLOY_SELF" ]; then
  echo "==> [0] deploy.sh 无执行位，正在 chmod +x（若失败请改用: bash deploy.sh）"
  chmod +x "$_DEPLOY_SELF" 2>/dev/null || true
fi

# 返回第一个可用的 Python3 可执行文件路径（stdout 一行）；失败返回非 0
# 使用 type -P（bash 内置），避免 Ubuntu 交互式下 command-not-found 依赖已损坏的 /usr/bin/python3
_deploy_pick_python3() {
  local _p
  for c in python3 python3.12 python3.11 python3.10 python3.9; do
    _p="$(type -P "$c" 2>/dev/null || true)"
    if [ -n "$_p" ] && [ -x "$_p" ] && "$_p" -c 'import sys; assert sys.version_info >= (3, 9)' 2>/dev/null; then
      echo "$_p"
      return 0
    fi
  done
  for _p in /usr/bin/python3 /usr/local/bin/python3 /usr/bin/python3.12 /usr/bin/python3.11 /usr/bin/python3.10; do
    if [ -x "$_p" ] && "$_p" -c 'import sys; assert sys.version_info >= (3, 9)' 2>/dev/null; then
      echo "$_p"
      return 0
    fi
  done
  _p="$(type -P python 2>/dev/null || true)"
  if [ -n "$_p" ] && [ -x "$_p" ] && "$_p" -c 'import sys; assert sys.version_info >= (3, 9)' 2>/dev/null; then
    echo "$_p"
    return 0
  fi
  return 1
}

# root + apt：尽量修好/装上系统 Python（子 shell 执行，避免 set -e 与 apt 非零码干扰）
_deploy_apt_install_python3_if_root() {
  [ "$(id -u)" = "0" ] || return 1
  local agt=""
  if [ -x /usr/bin/apt-get ]; then
    agt=/usr/bin/apt-get
  elif type -P apt-get >/dev/null 2>&1; then
    agt="$(type -P apt-get)"
  else
    return 1
  fi
  echo "==> [2a-apt] root：通过 apt 确保 python3 / python3-venv / python3-minimal（已装则几乎无操作）"
  export DEBIAN_FRONTEND=noninteractive
  (
    set +e
    "$agt" update -qq
    _u=$?
    if [ "$_u" != 0 ]; then
      echo "[2a-apt][warn] apt-get update -qq 退出 $_u ，重试 apt-get update"
      "$agt" update
    fi
    dpkg --configure -a 2>/dev/null || true
    "$agt" -f install -y 2>/dev/null || true
    "$agt" install -y python3 python3-venv python3-minimal
    echo "[2a-apt] apt-get install python3 python3-venv python3-minimal 退出码=$?"
    "$agt" install -y --reinstall python3 python3-minimal 2>/dev/null || true
    "$agt" install -y --reinstall python3-venv 2>/dev/null || true
  )
  return 0
}

# 裸机曾出现 /usr/bin/python3.10 权限为 ----------（000），或 /usr/bin/python3 软链指向已删文件 → pick 与 apt 均异常
_deploy_fix_system_python_if_root() {
  [ "$(id -u)" = "0" ] || return 0
  local p cand
  for p in /usr/bin/python3.12 /usr/bin/python3.11 /usr/bin/python3.10 /usr/bin/python3.9; do
    [ -f "$p" ] || continue
    if [ ! -x "$p" ]; then
      echo "==> [2a-fixperm] $p 不可执行（常见为被 chmod 0），正在 chmod a+rx"
      chmod a+rx "$p" 2>/dev/null || chmod 755 "$p" 2>/dev/null || true
    fi
  done
  if [ -L /usr/bin/python3 ] && ! /usr/bin/python3 -c 'pass' 2>/dev/null; then
    echo "==> [2a-symlink] 移除损坏的 /usr/bin/python3"
    rm -f /usr/bin/python3
  fi
  if ! { [ -x /usr/bin/python3 ] && /usr/bin/python3 -c 'import sys; assert sys.version_info >= (3, 9)' 2>/dev/null; }; then
    for cand in /usr/bin/python3.12 /usr/bin/python3.11 /usr/bin/python3.10 /usr/bin/python3.9; do
      if [ -x "$cand" ] && "$cand" -c 'import sys; assert sys.version_info >= (3, 9)' 2>/dev/null; then
        echo "==> [2a-symlink] ln -sf $cand /usr/bin/python3"
        ln -sf "$cand" /usr/bin/python3
        break
      fi
    done
  fi
  return 0
}

if [ ! -d "${APP_DIR}/backend" ] || [ ! -d "${APP_DIR}/frontend" ]; then
  APP_DIR="/root/apps/light_content_workflow_platform"
fi

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git 未安装或不在 PATH 中。请执行: apt-get update && apt-get install -y git"
  exit 127
fi

echo "==> [1/9] 拉取最新代码"
cd "$APP_DIR"
export GIT_OPTIONAL_LOCKS=0
# 只拉取 main，避免 git fetch origin 拉全量引用导致内存不足被 Killed
if ! git -c pack.threads=1 fetch --no-tags --prune --depth=200 origin main; then
  echo "[warn] shallow fetch failed, retrying full branch fetch..."
  git -c pack.threads=1 fetch --no-tags --prune origin main
fi
git checkout -f main
git reset --hard origin/main

echo "==> [2/9] 后端依赖与迁移"
cd "$APP_DIR/backend"
if [ ! -f .env ] && [ -f .env.example ]; then
  echo "==> [2a-env] 首次部署：从 .env.example 创建 backend/.env（请按需修改密钥与 DATABASE_URL）"
  cp .env.example .env
fi
# .venv 在但解释器失效（系统 Python 升级、误删、目录搬迁）→ pip 报 bad interpreter: exit 126
if [ -d .venv ]; then
  _venv_py=""
  if [ -x .venv/bin/python3 ]; then
    _venv_py=".venv/bin/python3"
  elif [ -x .venv/bin/python ]; then
    _venv_py=".venv/bin/python"
  fi
  if [ -z "$_venv_py" ]; then
    echo "==> [2a-venv-broken] backend/.venv 内无可用 python，删除后重建"
    rm -rf .venv
  elif ! "$_venv_py" -c "pass" 2>/dev/null; then
    echo "==> [2a-venv-broken] backend/.venv 解释器无法运行，删除后重建"
    rm -rf .venv
  fi
fi
# 系统 python 权限/软链异常时 apt 与 venv 均失败：先于 apt 修复（见 ECS 上 python3.10 为 ---------- 的案例）
if [ "$(id -u)" = "0" ]; then
  _deploy_fix_system_python_if_root || true
fi
# 删除坏 .venv 之后：若仍无可用 venv，root 下先 apt 一轮再探测（避免残留 activate 跳过预装）
if [ ! -f .venv/bin/activate ] && [ "$(id -u)" = "0" ]; then
  if [ -x /usr/bin/apt-get ] || type -P apt-get >/dev/null 2>&1; then
    _deploy_apt_install_python3_if_root || true
  fi
fi
if [ ! -f .venv/bin/activate ]; then
  echo "==> [2a] 首次部署：创建 Python 虚拟环境 (.venv)"
  DEPLOY_PYTHON=""
  if ! DEPLOY_PYTHON="$(_deploy_pick_python3)"; then
    _deploy_apt_install_python3_if_root || true
    DEPLOY_PYTHON="$(_deploy_pick_python3)" || true
  fi
  if [ -z "${DEPLOY_PYTHON:-}" ] || ! "$DEPLOY_PYTHON" -c 'import sys; assert sys.version_info >= (3, 9)' 2>/dev/null; then
    echo "ERROR: 仍无可用的 Python 3.9+（PATH=${PATH}）。请向上翻看 [2a-apt] 与 apt 退出码；若本段无 [2a-apt]，说明远端 deploy.sh 不是最新，请先 git pull / 重新 release 推送。"
    echo "  手动修复（ECS root）：apt-get update && apt-get install -y --reinstall python3 python3-minimal python3-venv && dpkg --configure -a"
    echo "  验证：ls -la /usr/bin/python3*（若为 ---------- 需 chmod；deploy 已尝试 [2a-fixperm]/[2a-symlink]）"
    exit 127
  fi
  echo "==> [2a] 使用解释器: $DEPLOY_PYTHON ($("$DEPLOY_PYTHON" --version 2>&1 || true))"
  if type -P apt-get >/dev/null 2>&1 || [ -x /usr/bin/apt-get ]; then
    echo "==> [2a-dep] Debian/Ubuntu：安装 python3-venv（ensurepip/venvmodule，裸机常见缺此包）"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y python3-venv || true
    _py_ver="$("$DEPLOY_PYTHON" -c 'import sys; print("%d.%d" % (sys.version_info[0], sys.version_info[1]))' 2>/dev/null || true)"
    if [ -n "${_py_ver}" ]; then
      apt-get install -y "python${_py_ver}-venv" 2>/dev/null || true
    fi
  fi
  "$DEPLOY_PYTHON" -m venv .venv || {
    echo "ERROR: python -m venv 仍失败。请在 ECS（root）执行后重跑 deploy："
    echo "  apt-get update && apt-get install -y python3-venv"
    echo "  # 若提示 ensurepip 针对具体版本，再试：apt-get install -y python3.10-venv   （把 3.10 换成 python3 --version 的小版本号）"
    exit 1
  }
fi
# shellcheck source=/dev/null
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "==> [2b] PostgreSQL 可达性（alembic 需要数据库）"
need_local_pg=0
if [ ! -f .env ]; then
  need_local_pg=1
elif grep -qE '^DATABASE_URL=.*@(127\.0\.0\.1|localhost):' .env 2>/dev/null; then
  need_local_pg=1
fi
if [ "$need_local_pg" -eq 1 ]; then
  if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null || pg_isready -h localhost -p 5432 -q 2>/dev/null; then
      :
    else
      if [ "${DEPLOY_BOOTSTRAP_POSTGRES:-0}" = "1" ] && command -v apt-get >/dev/null 2>&1; then
        echo "==> [2b-bootstrap] DEPLOY_BOOTSTRAP_POSTGRES=1: apt install postgresql and create DB light_content"
        echo "    默认用户 postgres 密码 postgres，与 .env.example 一致；生产请尽快修改密码与 pg_hba。"
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y postgresql postgresql-contrib
        systemctl enable postgresql
        systemctl start postgresql
        sleep 2
        sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" || true
        if ! sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'light_content'" | grep -q 1; then
          sudo -u postgres psql -c "CREATE DATABASE light_content;"
        fi
        if ! pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null && ! pg_isready -h localhost -p 5432 -q 2>/dev/null; then
          echo "[error] bootstrap 后仍无法连接 127.0.0.1:5432，请检查 postgresql 服务与 listen_addresses。"
          exit 1
        fi
        echo "==> [2b-bootstrap] PostgreSQL 已就绪"
      else
        echo "[error] DATABASE_URL 指向本机 Postgres，但 127.0.0.1:5432 / localhost:5432 无监听。"
        echo "  新 ECS 可选：在本机一键发布环境变量中设置 DEPLOY_BOOTSTRAP_POSTGRES=1 后重试，将自动 apt 安装 PostgreSQL 并建库 light_content。"
        echo "  或手动安装：仓库文档 docs/archive/2026年5月3日新ECS部署PostgreSQL与.env.md；或把 backend/.env 的 DATABASE_URL 改为 RDS/外库。"
        exit 1
      fi
    fi
  else
    echo "[warn] 未找到 pg_isready，跳过本机 5432 预检，直接尝试 alembic"
  fi
fi

alembic -c alembic.ini upgrade head

echo "==> [2c-systemd] 确保 systemd 单元存在（新 ECS 首次）"
API_SVC="/etc/systemd/system/light-content-api.service"
WEB_SVC="/etc/systemd/system/light-content-web.service"
if [ ! -f "$API_SVC" ]; then
  echo "==> [2c] 写入 light-content-api.service，APP_DIR=$APP_DIR"
  cat >"$API_SVC" <<EOF
[Unit]
Description=Light Content Workflow FastAPI
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=root
Group=root
WorkingDirectory=$APP_DIR/backend
Environment=PATH=$APP_DIR/backend/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$APP_DIR/backend/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
fi
if [ ! -f "$WEB_SVC" ]; then
  echo "==> [2c] 写入 light-content-web.service，APP_DIR=$APP_DIR"
  cat >"$WEB_SVC" <<EOF
[Unit]
Description=Light Content Workflow Next.js
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=$APP_DIR/frontend
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- -p 3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
fi
systemctl daemon-reload
systemctl enable light-content-api 2>/dev/null || true
systemctl enable light-content-web 2>/dev/null || true

echo "==> [3/9] 重启后端"
systemctl restart light-content-api

echo "==> [3b] Node.js / npm（Next.js 需 Node 18+，裸机 ECS 常未预装）"
if ! command -v npm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "==> [3b] apt: 通过 NodeSource 安装 Node.js 20 LTS"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y ca-certificates curl gnupg
    if curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; then
      apt-get install -y nodejs
    else
      echo "[error] NodeSource 安装脚本失败（无外网或被墙）。请手动安装 Node.js 20+ 与 npm 后再跑 deploy.sh。"
      exit 127
    fi
  else
    echo "ERROR: 未找到 npm/node 且无 apt-get，无法自动安装前端工具链。"
    exit 127
  fi
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: 安装后仍无 npm，请检查 PATH 或手动安装 Node.js 20+。"
  exit 127
fi
node -v
npm -v

echo "==> [4/9] 构建前端"
cd "$APP_DIR/frontend"
npm install
rm -rf .next
npm run build

echo "==> [5/9] 重启前端"
systemctl restart light-content-web

echo "==> [6/9] 服务状态"
systemctl status light-content-api --no-pager | sed -n '1,12p'
systemctl status light-content-web --no-pager | sed -n '1,12p'

echo "==> [7/9] 等待服务稳定"
sleep 2

echo "==> [8/9] 健康检查"
curl -sS http://127.0.0.1:8000/health
echo
curl -sS http://127.0.0.1:3000/tester | head -c 200
echo -e "\n"

echo "==> [9/9] 发布完成"
