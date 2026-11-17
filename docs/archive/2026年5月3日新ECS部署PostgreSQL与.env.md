# 新 ECS 部署 PostgreSQL 与 backend/.env

> 现象：`alembic upgrade` 报 **`connection to server at "127.0.0.1", port 5432 failed: Connection refused`**。  
> 含义：**本机未安装/未启动 PostgreSQL**，或 **`backend/.env` 的 `DATABASE_URL` 仍指向本机**，但库不在本机。

---

## 方案一：本机安装 PostgreSQL（与默认 `.env` 一致）

适用于单机 ECS 自带数据库（与《2026年4月26日第一阶段上线与服务器重建及数据迁移手册》一致）。

在 **ECS 上**以 `root` 执行：

```bash
apt-get update
apt-get install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql
```

创建业务库与用户（密码请改成你自己的，并与下面 `DATABASE_URL` 一致）：

```bash
sudo -u postgres psql -c "CREATE DATABASE light_content;"
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
```

确认监听：

```bash
pg_isready -h 127.0.0.1 -p 5432
```

`backend/.env` 中保持（或改为与你设置的密码一致）：

```env
DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:5432/light_content
```

> 生产环境请使用**强密码**，并限制 Postgres 仅本机或安全组内访问。

然后重新执行 **`deploy.sh`**（或本机一键部署）。

---

## 方案二：使用阿里云 RDS / 外部 Postgres

1. 在控制台创建 **PostgreSQL**，记下 **内网地址、端口、库名、账号、密码**。  
2. 在 ECS 上编辑 **`/root/apps/light_content_workflow_platform/backend/.env`**（或你的 `APP_DIR`）：

```env
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@RDS内网主机:5432/数据库名
```

3. 确保安全组允许 **ECS → RDS 5432**。  
4. 再跑 **`deploy.sh`**。

此时 **`deploy.sh`** 中的 **`[2b]`** 预检不会要求本机 `5432` 监听（仅当 `DATABASE_URL` 仍指向 `127.0.0.1` / `localhost` 时才检查本机）。

---

## 与一键部署脚本的关系

- 若 **`backend` 下没有 `.env`**，**`deploy.sh`** 会自动 **`cp .env.example .env`**（首次）。  
- **`[2b]`** 仅在 **`DATABASE_URL` 指向本机** 时用 **`pg_isready`** 预检，避免直接看到一长段 SQLAlchemy 栈。

---

## 导入已有备份（可选）

若从旧机迁了 **`pg_dump` 的 .sql`**，在 ECS 上：

```bash
psql -U postgres -h 127.0.0.1 -d light_content < /path/to/backup.sql
```

导入后再 **`alembic upgrade head`**（`deploy.sh` 已包含）。
