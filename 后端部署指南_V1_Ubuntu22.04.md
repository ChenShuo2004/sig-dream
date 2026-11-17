# 后端部署指南 V1（Ubuntu 22.04）

## 1. 先回答：后端是否需要部署到服务器？

结论：**需要**，但分阶段。

- 本地开发阶段：可先本地运行，不强制上云。
- 团队联调/验收阶段：建议部署一套测试环境（必须）。
- 对内正式使用阶段：建议部署一套生产环境（必须）。

原因：

- 前端需要稳定 API 地址，不适合长期依赖个人电脑。
- 工作流运行、日志留存、数据库连接都需要稳定运行环境。
- 便于团队统一访问、权限管理、备份和故障恢复。

---

## 2. 服务器系统选型建议

推荐系统：**Ubuntu Server 22.04 LTS**

推荐理由：

- 社区资料丰富，FastAPI + Docker + Nginx 方案成熟。
- LTS 长期支持，适合团队稳定运行。
- 运维门槛低，后续迁移到容器编排也平滑。

不建议在 V1 一开始就上 Kubernetes，复杂度过高。

---

## 3. V1 推荐部署架构（单机 Docker Compose）

```text
公网
  ↓
Nginx（80/443，SSL，反向代理）
  ↓
FastAPI（Uvicorn，容器）
  ↓
PostgreSQL（容器或托管服务）

Qdrant / MinIO 可先不在第一阶段强制上线，按功能推进逐步接入。
```

---

## 4. 部署前准备

## 4.1 服务器建议配置（V1）

- CPU：2 核起（建议 4 核）
- 内存：4 GB 起（建议 8 GB）
- 硬盘：60 GB SSD 起
- 系统：Ubuntu 22.04 LTS

## 4.2 域名与 DNS

- 准备一个 API 域名，例如：`api.your-domain.com`
- 在 DNS 控制台将该域名解析到服务器公网 IP（A 记录）

## 4.3 开放端口（云防火墙/安全组）

- `22`（SSH，建议只放行办公 IP）
- `80`（HTTP）
- `443`（HTTPS）

---

## 5. 服务器初始化

SSH 登录：

```bash
ssh root@<your_server_ip>
```

更新系统并安装基础工具：

```bash
apt update && apt upgrade -y
apt install -y curl git ufw ca-certificates gnupg lsb-release
```

配置防火墙：

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
ufw status
```

创建部署用户（推荐）：

```bash
adduser deploy
usermod -aG sudo deploy
```

---

## 6. 安装 Docker 与 Docker Compose

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker --version
docker compose version
```

---

## 7. 上传项目并准备目录

切换到部署用户并创建目录：

```bash
su - deploy
mkdir -p /home/deploy/apps/light_content_workflow_platform
cd /home/deploy/apps/light_content_workflow_platform
```

上传方式任选其一：

- `git clone`（推荐）
- `scp` 上传代码包

---

## 8. 准备后端容器化文件（示例）

在项目根目录创建 `backend/Dockerfile`：

```dockerfile
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend /app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 9. 编写 Docker Compose（后端 + PostgreSQL + Nginx）

在项目根目录创建 `docker-compose.yml`：

```yaml
version: "3.9"

services:
  db:
    image: postgres:16
    container_name: lcw_db
    restart: always
    environment:
      POSTGRES_DB: light_content
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: change_me_strong_password
    volumes:
      - pg_data:/var/lib/postgresql/data
    networks:
      - lcw_net

  api:
    build:
      context: .
      dockerfile: backend/Dockerfile
    container_name: lcw_api
    restart: always
    environment:
      DATABASE_URL: postgresql+psycopg://postgres:change_me_strong_password@db:5432/light_content
    depends_on:
      - db
    networks:
      - lcw_net

  nginx:
    image: nginx:1.27-alpine
    container_name: lcw_nginx
    restart: always
    ports:
      - "80:80"
    volumes:
      - ./infra/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - api
    networks:
      - lcw_net

volumes:
  pg_data:

networks:
  lcw_net:
```

---

## 10. Nginx 反向代理配置

创建 `infra/nginx/default.conf`：

```nginx
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 11. 首次启动与迁移

在项目根目录执行：

```bash
docker compose up -d --build
docker compose ps
```

执行数据库迁移（Alembic）：

```bash
docker compose exec api alembic -c alembic.ini upgrade head
```

检查健康接口：

```bash
curl http://127.0.0.1/health
```

预期返回：

```json
{"status":"ok"}
```

---

## 12. 配置 HTTPS（Let's Encrypt）

推荐安装 Certbot（宿主机）：

```bash
sudo apt install -y certbot python3-certbot-nginx
```

申请证书：

```bash
sudo certbot --nginx -d api.your-domain.com
```

自动续期测试：

```bash
sudo certbot renew --dry-run
```

---

## 13. 发布流程（以后每次更新）

```bash
cd /home/deploy/apps/light_content_workflow_platform
git pull
docker compose up -d --build
docker compose exec api alembic -c alembic.ini upgrade head
docker compose ps
```

---

## 14. 备份与恢复（最小可用）

## 14.1 PostgreSQL 备份

```bash
docker compose exec -T db pg_dump -U postgres light_content > /home/deploy/backup_light_content_$(date +%F).sql
```

## 14.2 PostgreSQL 恢复

```bash
cat /home/deploy/backup_light_content_2026-04-25.sql | docker compose exec -T db psql -U postgres -d light_content
```

建议每天定时备份并保留 7~30 天。

---

## 15. 运维检查清单

- `docker compose ps` 全部容器为 `Up`
- `/health` 返回 `{"status":"ok"}`
- `workflows` 表可读写
- Nginx 可访问、HTTPS 有效
- 备份任务已验证

---

## 16. 常见问题排查

- API 无法连接 DB：
  - 检查 `DATABASE_URL` 主机名是否为 `db`（容器内）
  - 检查 Postgres 容器是否已启动
- Alembic 执行失败：
  - 确认 `alembic.ini` 在容器工作目录可访问
  - 确认 `app.models` 已被 `env.py` 正确导入
- 502/504：
  - 查看 `nginx` 与 `api` 日志：
    - `docker compose logs -f nginx`
    - `docker compose logs -f api`

---

## 17. V1 到 V2 的扩展建议（可后续做）

- PostgreSQL 改为托管数据库（RDS/Cloud SQL）
- 增加 Redis（缓存、队列状态）
- 接入 Qdrant 与 MinIO 容器
- 增加 CI/CD（GitHub Actions）
- 监控告警（Prometheus + Grafana / Sentry）

---

## 18. 最终建议

对你当前项目，建议执行策略是：

1. 本周先完成本地开发与联调。  
2. 同步搭建 1 台 Ubuntu 22.04 测试机。  
3. 按本文档部署测试环境，团队先跑流程闭环。  
4. 稳定后复制同方案到生产环境（仅改配置与域名）。  
