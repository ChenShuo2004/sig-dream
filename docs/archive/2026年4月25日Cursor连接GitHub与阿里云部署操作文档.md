# 2026年4月25日Cursor连接GitHub与阿里云部署操作文档（不勾README）

## 1. 适用场景

用于在 Cursor 本地项目中首次连接 GitHub、推送代码，并在阿里云服务器拉取仓库后启动后端服务。  
本流程默认使用 SSH，且 **GitHub 新建仓库时不勾选 README**（保持空仓库）。

---

## 2. 前置条件

- 已安装 Git
- 已有 GitHub 账号
- 已在 Cursor 打开本地项目目录
- 已完成 SSH key 配置（`ssh -T git@github.com` 可成功）
- 阿里云 ECS 已可 SSH 登录

---

## 3. GitHub 新建仓库（关键）

1. 进入 GitHub，点击 `New repository`
2. 输入仓库名（例如：`light_content_workflow_platform`）
3. 选择可见性（Public/Private）
4. **不要勾选**：
   - Add a README file
   - Add .gitignore
   - Choose a license
5. 点击创建

说明：不勾 README 可以避免本地首次推送时出现远端历史冲突。

---

## 4. Cursor 本机配置 SSH 公钥到 GitHub

如果你在 Cursor 电脑上还没配置 SSH，先执行：

```powershell
ssh-keygen -t ed25519 -C "cursor-local"
```

启动 agent 并加载私钥（Windows PowerShell）：

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
ssh-add $env:USERPROFILE\.ssh\id_ed25519
```

复制公钥内容：

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

到 GitHub 添加公钥：

- `Settings` -> `SSH and GPG keys` -> `New SSH key`
- `Key type` 选 `Authentication Key`
- 粘贴公钥并保存

验证：

```powershell
ssh -T git@github.com
```

出现 `Hi <你的GitHub用户名>! You've successfully authenticated...` 即成功。

---

## 5. 本地初始化并首次推送（PowerShell）

在 Cursor 终端执行：

```powershell
cd "D:\cursor项目\light_content_workflow_platform"

git init
git branch -M main
```

---

## 6. 配置 .gitignore（避免大文件与敏感文件）

创建或更新 `.gitignore`：

```gitignore
# dependencies
node_modules/
frontend/node_modules/
backend/.venv/
.venv/

# env
.env
.env.*
!.env.example
!.env.local.example

# build/cache
frontend/.next/
frontend/out/
__pycache__/
*.pyc
*.log
```

---

## 7. 提交与绑定远程

```powershell
git add .
git commit -m "初始化项目骨架与第一阶段实现"

git remote add origin git@github.com:ChenShuo2004/sig-dream.git
git push -u origin main
```

首次成功后，`main` 会跟踪 `origin/main`。

---

## 8. 成功标志

终端出现：

- `* [new branch] main -> main`
- `branch 'main' set up to track 'origin/main'.`

---

## 9. 阿里云服务器拉取仓库并启动后端（非 Docker）

以下示例假设你使用 Ubuntu，且直接用 root（不创建 deploy 用户）。

### 9.1 登录服务器并安装基础依赖

```bash
ssh root@<你的服务器IP>
apt update && apt upgrade -y
apt install -y git python3 python3-venv python3-pip
```

### 9.2 服务器 root 配置 SSH 公钥到 GitHub

服务器和本机是两套独立密钥。你在服务器上也要单独配置一次：

```bash
ssh-keygen -t ed25519 -C "aliyun-root"
eval "$(ssh-agent -s)"
ssh-add /root/.ssh/id_ed25519
cat /root/.ssh/id_ed25519.pub
```

复制输出的公钥内容，到 GitHub 添加：

- `Settings` -> `SSH and GPG keys` -> `New SSH key`
- `Title` 可写 `aliyun-root`
- `Key type` 选 `Authentication Key`
- 粘贴公钥并保存

验证：

```bash
ssh -T git@github.com
```

出现 `Hi <你的GitHub用户名>! You've successfully authenticated...` 即成功。

### 9.3 拉取仓库

```bash
mkdir -p /root/apps
cd /root/apps
git clone git@github.com:ChenShuo2004/sig-dream.git
cd light_content_workflow_platform/backend
```

### 9.4 创建虚拟环境并安装依赖

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 9.5 配置环境变量并迁移数据库

```bash
cp .env.example .env
nano .env
```

编辑 `DATABASE_URL` 后执行：

```bash
source .venv/bin/activate
alembic -c alembic.ini upgrade head
```

### 9.6 手动启动验证

```bash
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

本机或其他机器访问：

```bash
curl http://<你的服务器IP>:8000/health
```

---

## 10. 日常更新流程

### 10.1 本地更新并推送

```powershell
git add .
git commit -m "你的提交说明"
git push
```

### 10.2 服务器一键发布脚本（推荐，标准发布块）

在服务器创建 `deploy.sh`（首次仅需执行一次）：

```bash
cat >/root/apps/light_content_workflow_platform/deploy.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/apps/light_content_workflow_platform"

echo "==> [1/9] 拉取最新代码"
cd "$APP_DIR"
git fetch origin
git checkout main
git reset --hard origin/main

echo "==> [2/9] 后端依赖与迁移"
cd "$APP_DIR/backend"
source .venv/bin/activate
pip install -r requirements.txt
alembic -c alembic.ini upgrade head

echo "==> [3/9] 重启后端"
systemctl restart light-content-api

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
EOF

chmod +x /root/apps/light_content_workflow_platform/deploy.sh
```

以后每次发布直接执行：

```bash
/root/apps/light_content_workflow_platform/deploy.sh
```

### 10.3 手动发布（分步执行）

```bash
cd /root/apps/light_content_workflow_platform
git pull
cd backend
source .venv/bin/activate
pip install -r requirements.txt
alembic -c alembic.ini upgrade head
systemctl restart light-content-api
systemctl status light-content-api --no-pager
curl http://127.0.0.1:8000/health
```

### 10.4 前端线上部署（首次）

在服务器执行：

```bash
cd /root/apps/light_content_workflow_platform/frontend
echo 'NEXT_PUBLIC_API_BASE_URL=http://<ECS_PUBLIC_IP>:8000' > .env.production
npm install
npm run build
```

创建前端 systemd 服务：

```bash
cat >/etc/systemd/system/light-content-web.service <<'EOF'
[Unit]
Description=Light Content Workflow Next.js
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=/root/apps/light_content_workflow_platform/frontend
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- -p 3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable light-content-web
systemctl restart light-content-web
systemctl status light-content-web --no-pager
```

访问验证：

```bash
curl http://127.0.0.1:3000
```

```powershell
curl http://<ECS_PUBLIC_IP>:3000
```

### 10.5 前端线上更新（后续每次发布）

```bash
cd /root/apps/light_content_workflow_platform
git pull
cd frontend
npm install
npm run build
systemctl restart light-content-web
systemctl status light-content-web --no-pager
```

---

## 11. 常见问题

### 11.1 `remote origin already exists`

```powershell
git remote remove origin
git remote add origin git@github.com:ChenShuo2004/sig-dream.git
```

### 11.2 `Repository not found`

- 检查仓库是否已创建
- 检查仓库名与用户名是否拼写正确
- 检查当前账号是否有权限

### 11.3 大文件被拒绝（GH001）

- 确认 `.gitignore` 包含 `node_modules/`
- 移除已跟踪的大文件并重新提交
- 必要时重建本地 git 历史后再推送

### 11.4 SSH 连接失败

```powershell
ssh -T git@github.com
```

若失败，先修复 SSH key 或网络解析问题。

---

## 12. 推荐验证命令

### 12.1 本地验证

```powershell
git remote -v
git branch --show-current
git status
```

- `remote` 正确
- 当前分支是 `main`
- `working tree clean` 即状态正常

### 12.2 服务器验证

```bash
curl http://127.0.0.1:8000/health
```

返回 `{"status":"ok"}` 即后端运行正常。

---

## 13. 阶段2（认证/权限/测试台）发布增补（2026-04-27）

### 13.1 本次新增能力

- 后端：`/auth/login`、`/auth/me`、`users/tags/materials/material_tags` 持久化
- 后端：角色权限控制（`super_admin` / `material_admin` 可写，`member` 只读）
- 后端：删除操作保留 `X-Access-Context: internal` 限制
- 前端：`/tester` 页面用于公网联调登录与权限

### 13.2 发布后最短核验命令（服务器）

```bash
cd /root/apps/light_content_workflow_platform/backend
source .venv/bin/activate
alembic -c alembic.ini current
psql "postgresql://postgres:postgres@127.0.0.1:5432/light_content" -c "\dt"
systemctl status light-content-api --no-pager -l
systemctl status light-content-web --no-pager -l
curl -sS http://127.0.0.1:8000/health
curl -sS http://127.0.0.1:3000/tester >/dev/null && echo OK
```

通过标准：

- 迁移版本显示 `20260427_0003 (head)`
- 表里包含 `users/tags/materials/material_tags`
- 两个服务均 `active (running)`
- `health` 正常，`/tester` 可访问

### 13.3 高频误区（已踩坑）

- 在 `frontend` 目录下执行 `cd backend` 会失败，导致后端未重启到最新。
- `systemctl restart` 后立刻 `curl` 可能出现瞬时 `Connection refused`，建议 `sleep 2` 后复测。
- 浏览器直接打开 `.../auth/login` 是 `GET`，会返回 `405`；该接口必须 `POST`。
- 若 `/tester` 提示 `Failed to fetch`，优先检查：
  - 前端是否已发布到含修复提交的版本
  - 后端是否已启用 CORS
  - 浏览器请求目标是否为服务器 `:8000` 而非本机 `127.0.0.1`
