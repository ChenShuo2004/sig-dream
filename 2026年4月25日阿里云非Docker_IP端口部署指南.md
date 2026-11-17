# 2026年4月25日阿里云非Docker IP端口部署指南

## 1. 你的两个问题先给结论

## 问题1：直接在阿里云部署，不使用 Docker，是否可行？

可行，且对 V1 完全可用。建议使用：

- 系统：`Ubuntu 22.04 LTS`
- 方式：`systemd + uvicorn` 直接运行 FastAPI
- 数据库：优先阿里云 RDS PostgreSQL（也可先本机 PostgreSQL）

## 问题2：不使用域名，直接服务器 IP，自己设置端口，是否可行？

可行。你可以直接访问：

- `http://<服务器IP>:<端口>/health`

前提是：

- 阿里云安全组放行该端口
- 服务器本机防火墙放行该端口
- FastAPI 监听 `0.0.0.0`

---

## 2. 部署方案（非 Docker）

```text
本地开发机
  -> 上传代码到阿里云 ECS
  -> Python venv 安装依赖
  -> 配置 .env
  -> Alembic 迁移
  -> systemd 托管 uvicorn
  -> 通过 IP:端口访问 API
```

---

## 3. 服务器准备（阿里云 ECS）

推荐规格（V1）：

- 2C4G 起步（建议 4C8G）
- Ubuntu 22.04 LTS
- 系统盘 SSD 60G+

---

## 4. 安全组与端口

假设你准备把后端跑在 `8000` 端口：

1. 阿里云 ECS 安全组入方向放行：
   - TCP `22`（SSH）
   - TCP `8000`（API）
2. 服务器内放行：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8000/tcp
sudo ufw --force enable
sudo ufw status
```

---

## 5. 登录服务器与基础安装

```bash
ssh root@<你的服务器IP>
```

安装基础依赖：

```bash
apt update && apt upgrade -y
apt install -y git curl unzip build-essential
apt install -y python3 python3-venv python3-pip
```

（可选）创建部署用户：

```bash
adduser deploy
usermod -aG sudo deploy
su - deploy
```

---

## 6. 上传项目代码

两种方式任选：

## 方式 A：Git 拉取

```bash
mkdir -p /home/deploy/apps
cd /home/deploy/apps
git clone <你的仓库地址> light_content_workflow_platform
cd light_content_workflow_platform
```

## 方式 B：本地打包上传

本地执行（Windows PowerShell）：

```powershell
Compress-Archive -Path .\* -DestinationPath .\project.zip
scp .\project.zip deploy@<服务器IP>:/home/deploy/apps/
```

服务器解压：

```bash
cd /home/deploy/apps
unzip project.zip -d light_content_workflow_platform
cd light_content_workflow_platform
```

---

## 7. 创建 Python 虚拟环境并安装依赖

```bash
cd /home/deploy/apps/light_content_workflow_platform/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 8. 配置环境变量

复制并编辑：

```bash
cp .env.example .env
nano .env
```

建议配置示例：

```env
DATABASE_URL=postgresql+psycopg://postgres:你的密码@你的数据库地址:5432/light_content
```

如果你用阿里云 RDS，`你的数据库地址` 填 RDS 内网地址。

---

## 9. 初始化数据库迁移（Alembic）

确保在 `backend` 目录且已激活 venv：

```bash
cd /home/deploy/apps/light_content_workflow_platform/backend
source .venv/bin/activate
alembic -c alembic.ini upgrade head
```

执行成功后，`workflows` 表会创建完成。

---

## 10. 先手动启动验证

```bash
cd /home/deploy/apps/light_content_workflow_platform/backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

本地浏览器或命令行访问：

```bash
curl http://<服务器IP>:8000/health
```

预期返回：

```json
{"status":"ok"}
```

---

## 11. 配置 systemd 常驻运行（关键）

创建服务文件：

```bash
sudo nano /etc/systemd/system/light-content-api.service
```

写入以下内容（按你的实际路径修改）：

```ini
[Unit]
Description=Light Content Workflow FastAPI
After=network.target

[Service]
User=deploy
Group=deploy
WorkingDirectory=/home/deploy/apps/light_content_workflow_platform/backend
Environment="PATH=/home/deploy/apps/light_content_workflow_platform/backend/.venv/bin"
ExecStart=/home/deploy/apps/light_content_workflow_platform/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable light-content-api
sudo systemctl start light-content-api
sudo systemctl status light-content-api
```

查看日志：

```bash
sudo journalctl -u light-content-api -f
```

---

## 12. 更新发布流程（非 Docker）

每次代码更新执行：

```bash
cd /home/deploy/apps/light_content_workflow_platform
git pull

cd backend
source .venv/bin/activate
pip install -r requirements.txt
alembic -c alembic.ini upgrade head

sudo systemctl restart light-content-api
sudo systemctl status light-content-api
```

---

## 13. 前端如何连接你的 IP+端口后端

本地前端或前端服务器上设置：

`frontend/.env.local`

```env
NEXT_PUBLIC_API_BASE_URL=http://<服务器IP>:8000
```

然后重启前端服务。

---

## 14. 常见问题与排查

- `curl` 不通：
  - 检查阿里云安全组是否放行 `8000`
  - 检查 `ufw status`
  - 检查服务是否监听 `0.0.0.0`
- 服务启动失败：
  - `journalctl -u light-content-api -f` 看错误
  - 核对 `WorkingDirectory` 与 venv 路径
- 数据库连接失败：
  - 核对 `.env` 的 `DATABASE_URL`
  - 确认 RDS 白名单/ECS 网络权限

---

## 15. 生产建议（在你坚持 IP 方案前提下）

- 继续使用 IP+端口完全可行，但请至少做到：
  - 设置强密码和最小端口暴露
  - 定期数据库备份
  - systemd 自动重启
  - 保留运行日志
- 后续若需要浏览器长期稳定访问，建议再加域名与 HTTPS。

