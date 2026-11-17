# 文件直传与自动选路技术实现文档 V1

版本：V1.0  
适用系统：轻量内容流程平台 / 素材库系统  
模块：文件上传、文件下载、文件机服务、NAS 存储、ECS 调度  
目标：把大文件传输从「ECS 整文件中转」改为「浏览器 ↔ 文件机」直传，ECS 只负责鉴权、票据、元数据、日志和兜底。

---

# 一、结论

当前「NAS worker 把整文件上传到 ECS download_cache，再由浏览器从 ECS 下载」不适合作为主路径。

正确架构应改为：

```text
ECS = 鉴权 / 票据 / 元数据 / 日志 / 任务协调 / 兜底
文件机 = 文件上传下载服务 / NAS 读写 / Range 下载 / 分片上传
浏览器 = 直接和文件机传输文件
NAS = 真实文件存储
```

最终传输路径：

```text
优先：浏览器 ↔ 局域网文件机 ↔ NAS
其次：浏览器 ↔ 公网文件机 ↔ NAS
兜底：浏览器 ↔ ECS ↔ 文件机 ↔ NAS
```

一句话：

```text
ECS 发票据，文件机传字节，浏览器自动选路，失败走 ECS 兜底。
```

---

# 二、为什么要改

## 1. 当前下载路径的问题

当前路径：

```text
浏览器请求 ECS 下载
→ ECS 创建 prepare_download 任务
→ NAS worker 读取 NAS 文件
→ NAS worker 整文件 POST 到 ECS
→ ECS 写入 download_cache
→ 前端轮询成功
→ 浏览器再从 ECS 下载
```

问题：

```text
文件被传了两次
NAS → ECS 一次
ECS → 浏览器 一次
```

对于大文件，例如 320MB 视频，会出现：

```text
准备时间长
ECS 带宽压力大
ECS 磁盘 IO 压力大
用户以为页面卡死
worker 队列被大文件阻塞
```

---

## 2. 新方案的核心优势

新路径：

```text
浏览器直接从文件机下载
文件机直接读 NAS
ECS 不再搬运大文件
```

优势：

```text
大幅减少 ECS 带宽消耗
下载响应更快
支持断点续传
支持局域网高速传输
支持公网文件机直连
ECS 保留权限控制和日志能力
```

---

# 三、整体架构

## 1. 组件职责

### ECS

负责：

```text
用户登录鉴权
权限校验
签发上传 / 下载票据
记录素材元数据
记录操作日志
管理文件机节点
返回 LAN / WAN 文件机地址
提供兜底 prepare_download
```

不负责主路径中的：

```text
整文件下载中转
整文件上传中转
长期缓存大文件
```

---

### 文件机

文件机是部署在 NAS 所在局域网的服务。

负责：

```text
访问 NAS 挂载目录
执行真实文件读取
执行真实文件写入
提供 HTTP 下载接口
提供 HTTP 上传接口
支持 Range 下载
支持断点续传上传
验证 ECS 签发的票据
回报上传 / 下载结果给 ECS
```

---

### 浏览器前端

负责：

```text
向 ECS 请求上传 / 下载票据
探测 LAN 文件机是否可达
探测 WAN 文件机是否可达
选择最快可用路径
发起直传上传 / 下载
展示进度
失败时回退 ECS 兜底路径
```

---

### NAS

负责：

```text
存储原始素材
存储缩略图
存储预览图
存储回收站文件
```

NAS 不直接暴露给浏览器。

---

# 四、传输路径设计

## 1. 下载路径

### 主路径：LAN 直连

适用于：

```text
用户电脑与文件机在同一局域网
```

流程：

```text
用户点击下载
→ 前端请求 ECS 创建 download_ticket
→ ECS 校验权限
→ ECS 返回 ticket + lan_base_url + wan_base_url + fallback_url
→ 前端探测 lan_base_url/health
→ LAN 可达
→ 浏览器打开 lan_base_url/download/{ticket}
→ 文件机验票
→ 文件机从 NAS 读取文件
→ 文件机直接返回给浏览器
→ 文件机回报 ECS 下载日志
```

---

### 次路径：WAN 直连

适用于：

```text
用户不在局域网，但文件机有公网入口
```

流程：

```text
LAN 探测失败
→ 前端探测 wan_base_url/health
→ WAN 可达
→ 浏览器打开 wan_base_url/download/{ticket}
→ 文件机验票
→ 文件机从 NAS 读取文件
→ 文件机通过公网直接返回给浏览器
→ 文件机回报 ECS 下载日志
```

---

### 兜底路径：ECS prepare_download

适用于：

```text
LAN 不可达
WAN 不可达
文件机公网入口异常
文件机直连失败
```

流程：

```text
前端走原 prepare_download
→ ECS 创建 NasJob
→ NAS worker 上传文件到 ECS download_cache
→ 前端轮询任务状态
→ 成功后从 ECS 下载
```

说明：

```text
该路径只作为兜底，不作为主路径。
```

---

## 2. 上传路径

### 主路径：LAN 直传上传

流程：

```text
用户选择文件
→ 前端请求 ECS 创建 upload_ticket
→ ECS 校验权限
→ ECS 返回 ticket + lan_base_url + wan_base_url
→ 前端探测 LAN
→ LAN 可达
→ 浏览器直接上传到 lan_base_url/upload/{ticket}
→ 文件机写入 NAS
→ 文件机计算 hash
→ 文件机回报 ECS 入库结果
→ ECS 创建素材元数据
```

---

### 次路径：WAN 直传上传

流程：

```text
LAN 不可达
→ 前端探测 WAN
→ WAN 可达
→ 浏览器上传到 wan_base_url/upload/{ticket}
→ 文件机写入 NAS
→ 文件机回报 ECS
```

---

### 兜底路径：ECS 中转上传

适用于：

```text
文件机不可达
公网文件机未配置
上传失败
```

流程：

```text
浏览器上传到 ECS
→ ECS 创建任务
→ NAS worker 拉取或接收文件
→ 写入 NAS
```

说明：

```text
兜底路径保留，但不作为主路径。
```

---

# 五、LAN / WAN 自动选路

## 1. 为什么不能让 ECS 判断是否同局域网

ECS 看到的是用户访问 ECS 的公网出口 IP。

这不能代表：

```text
用户浏览器能否访问 <FILE_HTTP_HOST>:9000
用户是否与文件机在同一个二层网络
用户是否能访问局域网文件机服务
```

所以正确方式是：

```text
浏览器自己探测文件机地址
```

---

## 2. 探测顺序

```text
第一步：探测 LAN
第二步：探测 WAN
第三步：回退 ECS
```

前端逻辑：

```text
1. 请求 ECS 获取 ticket 和候选地址
2. fetch(lan_base_url + "/health", timeout=800ms)
3. LAN 成功 → 使用 LAN
4. LAN 失败 → fetch(wan_base_url + "/health", timeout=1500ms)
5. WAN 成功 → 使用 WAN
6. WAN 失败 → 使用 ECS fallback_url
```

---

## 3. 探测接口

文件机提供：

```text
GET /health
```

返回：

```json
{
  "status": "ok",
  "node_id": "file-node-001",
  "storage_pool_id": "nas-main",
  "version": "1.0.0",
  "time": "2026-05-04T10:00:00Z"
}
```

---

## 4. CORS 要求

如果前端用 `fetch` 探测：

```text
文件机必须允许 ECS 前端域名跨域访问 /health
```

需要配置：

```text
Access-Control-Allow-Origin: http://<ECS_PUBLIC_IP>:3000
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
```

下载如果用 `<a href>` 直接跳转，对 CORS 要求较低。  
上传通常必须配置 CORS。

---

# 六、数据模型改造

## 1. 文件机节点表

现有文件机节点表需要增加或确认以下字段：

```sql
ALTER TABLE nas_file_service_nodes
ADD COLUMN lan_base_url TEXT,
ADD COLUMN wan_base_url TEXT,
ADD COLUMN is_lan_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN is_wan_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN health_status TEXT DEFAULT 'unknown',
ADD COLUMN last_seen_at TIMESTAMP,
ADD COLUMN storage_pool_id TEXT,
ADD COLUMN max_concurrency INTEGER DEFAULT 3,
ADD COLUMN weight INTEGER DEFAULT 100;
```

字段说明：

```text
lan_base_url：局域网访问地址，例如 http://<FILE_HTTP_HOST>:9000
wan_base_url：公网访问地址，例如 https://file.example.com
is_lan_enabled：是否启用 LAN 直连
is_wan_enabled：是否启用 WAN 直连
health_status：节点健康状态
last_seen_at：最近心跳时间
storage_pool_id：绑定的存储池
max_concurrency：最大并发任务数
weight：多节点负载权重
```

---

## 2. 下载票据表

```sql
CREATE TABLE file_transfer_tickets (
    id UUID PRIMARY KEY,
    ticket TEXT NOT NULL UNIQUE,
    ticket_type TEXT NOT NULL,
    asset_id UUID,
    user_id UUID NOT NULL,
    storage_pool_id TEXT,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);
```

ticket_type：

```text
download
upload
```

status：

```text
active
used
expired
revoked
```

---

## 3. 操作日志

下载与上传必须写入操作日志。

字段建议：

```text
operation_type
target_type
target_id
user_id
access_context
transfer_route
file_node_id
success
error_message
created_at
```

transfer_route：

```text
lan_direct
wan_direct
ecs_fallback
```

---

# 七、ECS API 设计

## 1. 创建下载票据

```text
POST /materials/{asset_id}/download-ticket
```

权限：

```text
asset.download
```

返回：

```json
{
  "ticket": "signed-ticket-or-ticket-id",
  "asset_id": "asset-uuid",
  "file_name": "demo.mp4",
  "file_size": 335544320,
  "mime_type": "video/mp4",
  "expires_at": "2026-05-04T10:30:00Z",
  "lan_base_url": "http://<FILE_HTTP_HOST>:9000",
  "wan_base_url": "https://file.example.com",
  "fallback_prepare_url": "http://<ECS_PUBLIC_IP>:8000/materials/demo/download-prepare",
  "recommended_order": ["lan", "wan", "ecs_fallback"]
}
```

---

## 2. 创建上传票据

```text
POST /materials/upload-ticket
```

请求：

```json
{
  "file_name": "demo.mp4",
  "file_size": 335544320,
  "mime_type": "video/mp4",
  "title": "demo",
  "tag_ids": ["tag1", "tag2"]
}
```

返回：

```json
{
  "ticket": "signed-upload-ticket",
  "upload_session_id": "uuid",
  "expires_at": "2026-05-04T10:30:00Z",
  "lan_base_url": "http://<FILE_HTTP_HOST>:9000",
  "wan_base_url": "https://file.example.com",
  "fallback_upload_url": "http://<ECS_PUBLIC_IP>:8000/materials/upload",
  "recommended_order": ["lan", "wan", "ecs_fallback"]
}
```

---

## 3. 文件机回报上传完成

```text
POST /file-service/upload-complete
```

请求：

```json
{
  "ticket": "signed-upload-ticket",
  "upload_session_id": "uuid",
  "storage_path": "originals/2026/05/demo.mp4",
  "file_size": 335544320,
  "sha256": "xxx",
  "file_node_id": "file-node-001"
}
```

ECS 执行：

```text
校验 ticket
创建或更新 material_assets
写入文件路径
写入 hash
写入标签
记录操作日志
触发缩略图任务
```

---

## 4. 直传结果回报

```text
POST /file-service/transfer-log
```

请求：

```json
{
  "ticket": "xxx",
  "ticket_type": "download",
  "asset_id": "asset-uuid",
  "file_node_id": "file-node-001",
  "transfer_route": "lan_direct",
  "success": true,
  "bytes_transferred": 335544320,
  "duration_ms": 18200
}
```

---

# 八、文件机 API 设计

## 1. 健康检查

```text
GET /health
```

返回：

```json
{
  "status": "ok",
  "node_id": "file-node-001",
  "storage_pool_id": "nas-main"
}
```

---

## 2. 下载接口

```text
GET /download/{ticket}
```

文件机逻辑：

```text
1. 校验 ticket
2. 确认 ticket 未过期
3. 确认 ticket 类型为 download
4. 获取文件路径
5. 从 NAS 打开文件
6. 支持 HTTP Range
7. 返回文件流
8. 下载完成后回报 ECS
```

必须支持响应头：

```text
Content-Type
Content-Length
Content-Disposition
Accept-Ranges: bytes
```

如果是 Range 请求：

```text
206 Partial Content
Content-Range: bytes start-end/total
```

---

## 3. 上传接口

建议优先使用 tus。

### 方案 A：tus 上传

部署：

```text
文件机运行 tusd
前端使用 Uppy + tus
```

优点：

```text
成熟
断点续传
大文件稳定
前端组件成熟
```

---

### 方案 B：自研分片上传

接口：

```text
POST /upload/{ticket}/chunks
POST /upload/{ticket}/complete
GET /upload/{ticket}/status
```

chunk 请求：

```text
Content-Range: bytes start-end/total
```

complete 后：

```text
文件机合并分片
计算 sha256
写入 NAS
回报 ECS
```

---

# 九、前端实现逻辑

## 1. 下载选路函数

```ts
async function createDownloadLink(assetId: string) {
  const ticket = await ecs.createDownloadTicket(assetId);

  const lanOk = await probe(ticket.lan_base_url, 800);
  if (lanOk) {
    return `${ticket.lan_base_url}/download/${ticket.ticket}`;
  }

  const wanOk = await probe(ticket.wan_base_url, 1500);
  if (wanOk) {
    return `${ticket.wan_base_url}/download/${ticket.ticket}`;
  }

  return ticket.fallback_prepare_url;
}
```

---

## 2. 探测函数

```ts
async function probe(baseUrl: string, timeoutMs: number) {
  if (!baseUrl) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store"
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
```

---

## 3. 下载动作

```text
获取最佳 URL
→ 如果是直连 URL，直接 window.location.href = url
→ 如果是 fallback_prepare_url，走原 prepare_download 轮询流程
```

---

## 4. 上传动作

```text
选择文件
→ 请求 ECS 创建 upload_ticket
→ 探测 LAN
→ 探测 WAN
→ 选择上传 URL
→ 使用 Uppy + tus 上传
→ 文件机上传完成后回报 ECS
→ 前端刷新素材列表
```

---

# 十、安全设计

## 1. 票据设计

票据必须包含：

```text
user_id
asset_id 或 upload_session_id
file_path
ticket_type
expires_at
nonce
signature
```

推荐：

```text
JWT 或 HMAC 签名 token
```

有效期建议：

```text
下载票据：10~30 分钟
上传票据：30~120 分钟，视文件大小调整
```

---

## 2. 文件机验票方式

两种方式：

### A. 文件机本地验签

```text
ECS 和文件机共享密钥
文件机本地校验 HMAC / JWT
```

优点：

```text
快
不依赖 ECS 实时可用
```

缺点：

```text
密钥管理要安全
```

---

### B. 文件机向 ECS 验票

```text
文件机收到 ticket
→ 请求 ECS /verify-ticket
→ ECS 返回是否有效
```

优点：

```text
可控
可随时吊销
```

缺点：

```text
每次下载多一次 ECS 请求
```

建议 V1：

```text
下载用本地验签
上传完成回报 ECS
```

---

## 3. 防刷与限流

文件机必须做：

```text
单 IP 并发限制
单 ticket 访问次数限制
ticket 过期校验
下载频率限制
上传大小限制
路径穿越防护
```

路径穿越必须禁止：

```text
../../
绝对路径
未授权路径
```

---

# 十一、文件机公网入口

## 1. 推荐方式

```text
公网域名 + HTTPS + Nginx 反代文件机
```

例如：

```text
https://file.example.com
→ 路由器端口映射
→ 局域网文件机 Nginx
→ 文件服务
→ NAS
```

---

## 2. 必备配置

```text
HTTPS 证书
防火墙
端口映射
CORS
限流
访问日志
错误日志
```

---

## 3. 无公网 IP 方案

可以使用：

```text
frp
Cloudflare Tunnel
Tailscale
ZeroTier
```

选择建议：

```text
团队内部使用：Tailscale / ZeroTier
外部用户访问：frp / Cloudflare Tunnel / 公网域名反代
```

---

# 十二、兼容现有系统

现有 prepare_download 不删除。

改成：

```text
主路径失败后的兜底路径
```

前端逻辑：

```text
直连成功 → 不走 prepare
直连失败 → 走 prepare
```

这样不会破坏当前已上线系统。

---

# 十三、最小实现范围

## 第一阶段：下载直连

先做下载，因为收益最大。

需要完成：

```text
1. 文件机增加 /health
2. 文件机增加 /download/{ticket}
3. 下载支持 HTTP Range
4. ECS 增加 /materials/{id}/download-ticket
5. 文件机节点增加 lan_base_url / wan_base_url
6. 前端下载按钮接入探测选路
7. 失败回退原 prepare_download
```

---

## 第二阶段：上传直传

需要完成：

```text
1. ECS 增加 upload_ticket
2. 文件机接入 tusd 或自研分片上传
3. 文件机写入 NAS
4. 文件机回报 ECS 入库
5. 前端上传队列接入 LAN / WAN 选路
```

---

## 第三阶段：公网文件机

需要完成：

```text
1. 配置公网域名
2. 配置 HTTPS
3. 配置 Nginx 反代
4. 配置 CORS
5. 配置限流
6. 前端启用 WAN 探测
```

---

# 十四、验收标准

## 1. LAN 下载验收

```text
局域网电脑点击下载
→ 不触发 prepare_download
→ 浏览器直接从 <FILE_HTTP_HOST> 文件机下载
→ ECS 只记录日志
```

---

## 2. WAN 下载验收

```text
外网电脑点击下载
→ LAN 探测失败
→ WAN 探测成功
→ 浏览器从 file.example.com 下载
→ ECS 不缓存整文件
```

---

## 3. 兜底验收

```text
LAN/WAN 都失败
→ 自动走原 ECS prepare_download
→ 下载仍然可用
```

---

## 4. Range 验收

```text
浏览器下载中断后可继续
下载工具支持断点续传
响应包含 Accept-Ranges: bytes
Range 请求返回 206
```

---

## 5. 日志验收

```text
每次下载记录：
用户
素材
传输路径：lan_direct / wan_direct / ecs_fallback
文件机节点
成功 / 失败
耗时
传输字节数
```

---

# 十五、给 Cursor 的开发指令

```text
请开发文件直传与自动选路模块。

目标：
把大文件上传下载从 ECS 整文件中转，改为浏览器与文件机直传。
ECS 只负责鉴权、票据、元数据、日志和兜底。

一、下载主流程

1. 前端点击下载时，先请求：
POST /materials/{asset_id}/download-ticket

2. ECS 校验 asset.download 权限后返回：
- ticket
- lan_base_url
- wan_base_url
- fallback_prepare_url
- expires_at
- file_name
- file_size

3. 前端探测：
- 优先 GET {lan_base_url}/health
- LAN 不通则 GET {wan_base_url}/health
- 都不通则走 fallback_prepare_url

4. 如果 LAN 或 WAN 可用：
浏览器直接访问：
{base_url}/download/{ticket}

5. 文件机：
- 校验 ticket
- 从 NAS 读取真实文件
- 支持 HTTP Range
- 返回文件流
- 下载结束后回报 ECS transfer-log

6. 如果直连失败：
保留并使用当前 prepare_download 流程作为兜底。

二、上传主流程

1. 前端选择文件后，请求：
POST /materials/upload-ticket

2. ECS 返回：
- upload_ticket
- upload_session_id
- lan_base_url
- wan_base_url
- fallback_upload_url

3. 前端探测 LAN / WAN。
4. 成功则使用文件机上传接口。
5. 建议使用 tus 协议：
- 前端 Uppy + tus
- 文件机 tusd
6. 文件机写入 NAS 后，回报 ECS upload-complete。
7. ECS 创建素材元数据，并触发缩略图任务。

三、数据库改造

nas_file_service_nodes 增加：
- lan_base_url
- wan_base_url
- is_lan_enabled
- is_wan_enabled
- health_status
- last_seen_at
- storage_pool_id
- max_concurrency
- weight

新增 file_transfer_tickets 表，用于记录上传/下载票据。

四、文件机接口

实现：
GET /health
GET /download/{ticket}

下载接口必须支持：
- Accept-Ranges: bytes
- Range 请求
- 206 Partial Content
- Content-Disposition
- Content-Length

上传接口优先使用 tus。
如不用 tus，则实现分片上传接口。

五、安全要求

- ticket 必须有过期时间
- ticket 必须签名
- 文件机必须校验 ticket
- 禁止路径穿越
- 限制单 IP 并发
- 限制 ticket 使用次数
- 记录访问日志
- CORS 只允许指定前端域名

六、前端要求

下载按钮逻辑：
- 创建 ticket
- 探测 LAN
- 探测 WAN
- 选择可用路径
- 失败走 ECS fallback

上传队列逻辑：
- 创建 upload ticket
- 探测 LAN/WAN
- 使用文件机直传
- 上传完成后刷新素材列表

七、保留旧逻辑

当前 prepare_download 不删除。
它作为 LAN/WAN 失败后的兜底方案。

验收：
局域网下载不再经过 ECS download_cache。
外网配置 WAN 后可直连文件机下载。
直连失败时仍能通过 ECS prepare_download 下载。
```

---

# 十六、最终定版

核心路径：

```text
浏览器请求 ECS 要票据
→ ECS 鉴权后返回 LAN/WAN 文件机地址
→ 浏览器探测 LAN/WAN
→ 浏览器直接和文件机传文件
→ 文件机读写 NAS
→ 文件机回报 ECS 日志
→ 失败走 ECS 兜底
```

这是当前系统最现实、最快落地、风险最低的成熟方案。
