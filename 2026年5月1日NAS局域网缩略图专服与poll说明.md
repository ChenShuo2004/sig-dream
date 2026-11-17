# NAS 局域网缩略图专服与 poll 说明

## 结论（架构）

- **`generate_derivatives`（ffmpeg 抽帧写 `derivatives/*_thumb.jpg`）只在 NAS 局域网侧执行**，由 `nas-client/worker.py` 轮询 ECS 的 `GET /nas-jobs/poll` 领取作业后在本机跑 ffmpeg。
- **ECS 只负责排队与落库**（`nas_jobs`、回调 `complete` 写 `extra_metadata.thumbnail_path`），**不在 ECS 上跑 ffmpeg**，避免占公网机 CPU/IO。

若长期没有缩略图，首要检查：**NAS 侧是否有常驻进程在 poll**（窗口被关、未装 NSSM、只起了下载服务未起 worker 等）。

## 全量 worker 与缩略图专服（推荐同机两进程）

| 进程 | 脚本 | 行为 |
|------|------|------|
| 全量 | `run-worker.ps1` + **`-ExcludePollJobTypes generate_derivatives`**（`start-nas-direct-services.ps1` 已带） | 领取除 `generate_derivatives` 外的全部类型（含 `prepare_download` 等） |
| 缩略图专服 | `run-derivative-worker.ps1`（即 `-PollJobTypes generate_derivatives`） | **仅**领取 `generate_derivatives` |

两路进程里线程名都会叫 `worker-1`… 属**不同进程**；日志已带 **`[nas-client][full]`** / **`[nas-client][derivatives]`** 前缀区分。

**仅开缩略图专服、不跑全量 worker** 会导致 `store_original` / `prepare_download` 无人领取。

### 下载次数

走 ECS 缓存的缩略图 `prepare_download` 在 payload 中带 **`record_download_count: false`**，用户拉取缩略图缓存文件时**不会**增加素材 `download_count`；真实下载准备任务为 **`true`**（默认缺省同 true，兼容旧数据）。

一键脚本 `start-nas-direct-services.ps1` / `.bat` 已默认再开一个 **缩略图专服** 窗口（与全量 worker、下载服务并列）。

## 后端：`/nas-jobs/poll?job_types=...`

- 可选查询参数 **`job_types`**：逗号分隔，例如 `generate_derivatives`。
- NAS 客户端通过环境变量 **`NAS_POLL_JOB_TYPES`** 传入（`run-worker.ps1` 的 `-PollJobTypes` 会写入）。

## 运维建议

- 用 **NSSM / Windows 任务计划「登录时启动」/ systemd** 把上述 PowerShell 窗口做成服务，保证**断会话仍运行**。
- **`start-nas-direct-services.bat` 须保持纯 ASCII**（无中文、无全角标点）。在简体中文 Windows 默认代码页（GBK）下，UTF-8 中文会使 `cmd.exe` 错位解析，出现 `'tlocal'`、`ROOT_DIR` 变空、`Missing "\run-worker.ps1"` 等。中文说明写在本文或 `local-env.bat` 注释（按需编码）即可。

## `start-nas-direct-services` 会打开几个窗口？

| 顺序 | 脚本 | 窗口标题（英文，避免控制台乱码） | 作用 |
|------|------|----------------------------------|------|
| 1 | `run-worker.ps1` + `-ExcludePollJobTypes generate_derivatives` | `NAS worker \| full queue except excluded...` | 轮询 `nas_jobs`：上传落盘、下载准备、回收等；**不领** `generate_derivatives` |
| 2 | `run-derivative-worker.ps1` | `NAS worker \| thumbnails only...` | 只领 `generate_derivatives`，本机 ffmpeg |
| 3 | `run-download-server.ps1` | `NAS LAN transfer \| upload + ticket...` | **不**轮询作业；HTTP 9001 局域网上传/带票下载 |

PowerShell 控制台**不写中文、不强制 `chcp 65001`**，说明以英文打印；中文说明只保留在本 Markdown。`Z:` 映射共用 `_nas-share-map.ps1`，**错误 85** 在映射正确时跳过。
- 缩略图积压时可：提高专服 `-WorkerConcurrency`（多线程 poll+执行）、或**多台 NAS 局域网机**各跑一路带 `job_types=generate_derivatives` 的 worker（poll 使用 `SKIP LOCKED`，不会重复领同一单）。
