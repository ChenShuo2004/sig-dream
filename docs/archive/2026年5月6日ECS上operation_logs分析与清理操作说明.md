# ECS 上 operation_logs 分析与清理操作说明

> 本文档整理自 2026-05-06 前后对话：**pg_dump 备份变大**、**operation_logs 行数分析**、**误用 `$DATABASE_URL`**、**按类型清理**、**产品侧已改 dedup 不再记操作日志** 等。  
> 适用：已 SSH 到 ECS（`root`），PostgreSQL 与 **`backend/.env`** 中 **`DATABASE_URL`** 与仓库 **`2026年5月9日新ECS部署操作说明.md`** 默认路径一致。

---

## 一、本次对话结论摘要

1. **备份文件变大（约 592MB）**  
   对 **`light-content-latest.sql`** 做 `COPY` 段行数统计后，**`public.operation_logs` 约 174 万行**，占 dump 绝大部分；业务主表（素材等）行数相对很小。

2. **`operation_logs` 里主要不是「上传重复检测」**  
   按 **`operation_type`** 分组后，**`HTTP异常` 约 174 万条**；**`上传重复检测` 仅约 271 条**（且产品已改为 dedup 不再写库，见下文）。

3. **`HTTP异常` 来源**  
   后端 **`backend/app/main.py`** 中 **`http_exception_logger`**：对 **`HTTPException`**，当状态码 **`>=500` 或 `401` / `403`** 时调用 **`record_operation_log_safe`**，**`operation_type="HTTP异常"`**。公网扫描、未带 Token 的客户端、错误鉴权等会导致 **401/403 高频记库**，体积暴涨。

4. **产品逻辑已调整（需发版生效）**  
   **`GET /uploads/dedup`** 已**不再**写入 **`operation_logs`**（与灾难恢复、日常修库无关的高频只读查询）。见 **`backend/app/api/routes/uploads.py`** 中 **`dedup_route`**。

5. **扫备份 SQL 文件 ≠ 查当前库**  
   **`/root/light-content-db-backups/light-content-latest.sql`** 是某次 **`pg_dump` 快照**；删库数据后**不重新 dump**，文件内行数**不会变**。判断是否删干净应 **`psql` 查在线库**。

6. **常见误操作：`$DATABASE_URL` 为空**  
   未 **`export DATABASE_URL=...`** 时，`psql` 走本机 socket、用户 **`root`** → **`FATAL: role "root" does not exist`**。  
   **`.env` 常为 `postgresql+psycopg://...`**，**`psql` 需改为 `postgresql://`**。

---

## 二、每次新开 SSH 都要做的：连接串（复制整段）

默认应用目录（与 **`REMOTE_APP_DIR`** 一致）：

```text
/root/apps/light_content_workflow_platform/backend/.env
```

在 ECS 上执行（**整段复制**）：

```bash
ENV_FILE=/root/apps/light_content_workflow_platform/backend/.env

RAW=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | sed '1s/^DATABASE_URL=//' | sed 's/^"//;s/"$//')
export DATABASE_URL=$(printf '%s' "$RAW" | sed 's#^postgresql+psycopg://#postgresql://#')

echo "DATABASE_URL is set: ${DATABASE_URL:+yes}"
```

**不要** `echo "$DATABASE_URL"`（避免密码出现在屏幕/日志）。

验证能连上数据库：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT current_database(), current_user, COUNT(*) AS operation_logs_n FROM public.operation_logs;"
```

若仍报 **`role "root" does not exist`**：说明 **`DATABASE_URL` 未生效**（新开终端未执行上面 `export`，或 `RAW` 为空）。检查：

```bash
test -f "$ENV_FILE" && echo "env file ok" || echo "missing env file"
grep -E '^DATABASE_URL=' "$ENV_FILE" | sed 's/=.*/=***masked***/'
```

---

## 三、分析：operation_logs 按类型分布

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
SELECT operation_type, COUNT(*) AS n
FROM public.operation_logs
GROUP BY 1
ORDER BY n DESC
LIMIT 25;
"
```

用于确认是否仍以 **`HTTP异常`** 为主。

---

## 四、清理：删除「HTTP异常」类日志（推荐先做）

**一条 SQL**（低峰执行；数据量大时可能持续数分钟）：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM public.operation_logs WHERE operation_type = 'HTTP异常';"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "VACUUM ANALYZE public.operation_logs;"
```

再确认总量：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM public.operation_logs;"
```

---

## 五、可选：清空整张 operation_logs（接受丢失全部操作审计时）

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE public.operation_logs RESTART IDENTITY;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "VACUUM ANALYZE public.operation_logs;"
```

若 **`TRUNCATE`** 报外键相关错误，改用：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM public.operation_logs;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "VACUUM ANALYZE public.operation_logs;"
```

---

## 六、可选：仅分析备份文件体积（不连库）

ECS 上备份目录一般为：

```text
/root/light-content-db-backups/light-content-latest.sql
```

**注意**：文件名是 **`light-content-latest.sql`**；带 **`pre-deploy-`、时间戳** 的 sql 多在**发版机本机**拉取目录，不一定在 ECS。

统计各 `public.*` 表在 **该 sql 文件** 中的 `COPY` 行数（大文件需跑几分钟）：

```bash
FILE=/root/light-content-db-backups/light-content-latest.sql

python3 - "$FILE" <<'PY'
import re, sys
path = sys.argv[1]
table = None
rows = 0
pat = re.compile(r"^COPY (public\.\w+)")
with open(path, "r", encoding="utf-8", errors="replace") as f:
    for line in f:
        if table is None:
            m = pat.match(line)
            if m:
                table = m.group(1)
                rows = 0
            continue
        s = line.rstrip("\n")
        if s == r"\.": 
            print(f"{rows}\t{table}")
            table = None
            rows = 0
            continue
        rows += 1
if table is not None:
    print(f"{rows}\t{table}")
PY
```

按行数排序看前若干名：

```bash
FILE=/root/light-content-db-backups/light-content-latest.sql
python3 - "$FILE" <<'PY' | sort -nr | head -30
import re, sys
path = sys.argv[1]
table = None
rows = 0
pat = re.compile(r"^COPY (public\.\w+)")
with open(path, "r", encoding="utf-8", errors="replace") as f:
    for line in f:
        if table is None:
            m = pat.match(line)
            if m:
                table = m.group(1)
                rows = 0
            continue
        s = line.rstrip("\n")
        if s == r"\.": 
            print(rows, table, sep="\t")
            table = None
            rows = 0
            continue
        rows += 1
if table is not None:
    print(rows, table, sep="\t")
PY
```

**heredoc 结束行必须单独一行 `PY`**，勿与 `print` 粘在同一行。

---

## 七、按时间删除不生效的说明

若使用：

```sql
DELETE FROM public.operation_logs
WHERE created_at < (CURRENT_TIMESTAMP - INTERVAL '90 days');
```

得到 **`DELETE 0`**：表示**没有行早于 90 天**（近期集中写入）。需缩短天数，或按 **`operation_type`** 删除（如 **`HTTP异常`**）。

---

## 八、后续产品建议（未在本文档中改代码）

为控制 **`HTTP异常`** 再次堆到百万级，可在 **`backend/app/main.py`** 收紧 **`http_exception_logger`** 的记库条件（例如：**仅 5xx 写库**，401/403 只打标准日志不写 `operation_logs`；或抽样）。需与「审计 / 安全」要求对齐后再改。

---

## 九、相关仓库文件

| 说明 | 路径 |
|------|------|
| 去掉 dedup 写操作日志 | `backend/app/api/routes/uploads.py` |
| HTTP 异常写库 | `backend/app/main.py`（`http_exception_logger`） |
| 术语对齐记录 | `2026年4月30日术语对齐记录.md`（dedup 不再记日志条目） |
| ECS 默认应用路径 | `2026年5月9日新ECS部署操作说明.md`（`REMOTE_APP_DIR`） |

---

## 十、操作检查清单

- [ ] 已 SSH 到 ECS  
- [ ] 已执行 **`ENV_FILE` + `export DATABASE_URL`**（含 **`+psycopg` → `postgresql://`**）  
- [ ] **`SELECT current_database()`** 能成功  
- [ ] 已 **`GROUP BY operation_type`** 确认要删类型  
- [ ] 已执行 **`DELETE` / `TRUNCATE`** + **`VACUUM ANALYZE`**  
- [ ] 已 **`SELECT COUNT(*)`** 确认剩余行数  
- [ ] 已计划发版：**dedup 不再记日志**；可选：**收紧 HTTP 401/403 记库**  
