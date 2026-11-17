# 轻量内容流程编排台 + 素材资产管理模块 开发总文档 V1

版本：V1.0  
用途：直接交给 Cursor / AI 编程工具开发  
项目定位：同一个平台、同一个仓库、同一个后端、同一个数据库  
当前优先级：先开发素材资产管理模块，再接入工作流画布

---

# 一、总结论

本项目不是两个独立系统。

正确定位是：

```text
light_content_workflow_platform
= 主平台 / 总系统

material_asset_management
= 主平台里的 materials 素材资产管理模块
```

必须遵守：

```text
同一个项目仓库
同一个 Next.js 前端
同一个 FastAPI 后端
同一个 PostgreSQL 数据库
同一套用户系统
同一套权限系统
同一套操作日志系统
NAS Client 作为独立文件执行子服务
```

不要拆成两个后端、两个数据库、两套用户系统。

---

# 二、系统总定位

## 2.1 主平台定位

轻量内容流程编排台用于支持团队内容生产流程。

核心能力包括：

```text
工作流画布
标准节点编排
素材资产管理
Style Agent 资产管理
选题生成
文案生成
人工审核
任务派发
操作日志
```

## 2.2 素材模块定位

素材资产管理模块是主平台的资产底座。

它负责：

```text
素材上传
素材存储
标签管理
素材检索
素材下载
下载记录
素材使用统计
回收站
NAS 文件操作
```

它不是普通文件管理器，而是内容生产系统里的可复用素材资产库。

---

# 三、总体技术栈

## 3.1 前端

```text
Next.js
TypeScript
React Flow
Tailwind CSS
shadcn/ui
Zustand
```

## 3.2 后端

```text
FastAPI
Pydantic
SQLAlchemy / SQLModel
Alembic
PostgreSQL
```

## 3.3 素材处理

```text
公司本地 NAS
NAS Client
FFmpeg / ffprobe
```

## 3.4 后续预留

```text
Qdrant
AI 自动标签
语义搜索
OCR
视频字幕提取
音频转文字
```

V1 暂不实现这些，只预留扩展空间。

---

# 四、系统架构

```text
Next.js 前端
├── 工作流画布
├── 素材资产
├── Agent 资产
├── 任务中心
├── 标签管理
├── 操作日志
└── 系统设置

↓ API

FastAPI 后端
├── auth 用户认证
├── permissions 权限控制
├── audit 操作日志
├── materials 素材资产模块
├── uploads 分片上传模块
├── tags 标签模块
├── workflows 工作流模块
├── agents Style Agent 模块
└── tasks 任务模块

↓ 内网安全通道

NAS Client
├── 写入 NAS
├── 合并分片
├── 生成缩略图
├── 生成低清预览
├── 移动到回收站
├── 恢复文件
├── 永久删除
└── 下载流式代理

↓

公司本地 NAS
├── originals 原始文件
├── thumbnails 缩略图
├── previews 低清预览
└── trash 回收站文件
```

---

# 五、项目目录结构

```text
light_content_workflow_platform/

  frontend/
    app/
      login/
      workflows/
      materials/
      materials/[id]/
      upload/
      agents/
      tasks/
      tags/
      tag-requests/
      trash/
      operations/
      settings/

    components/
      workflow/
        WorkflowCanvas.tsx
        NodePalette.tsx
        NodeConfigPanel.tsx
        RunPanel.tsx

      materials/
        MaterialList.tsx
        MaterialCard.tsx
        MaterialDetail.tsx
        UploadPanel.tsx
        TagSelector.tsx
        DownloadButton.tsx

      tags/
        TagManager.tsx
        TagRequestList.tsx

      common/
        AppLayout.tsx
        DataTable.tsx
        ConfirmDialog.tsx

    stores/
      workflowStore.ts
      materialStore.ts
      authStore.ts

    lib/
      api.ts
      auth.ts
      permissions.ts

    types/
      workflow.ts
      material.ts
      tag.ts
      user.ts
      audit.ts

  backend/
    app/
      main.py

      core/
        config.py
        database.py
        security.py
        permissions.py
        audit.py

      models/
        user.py
        role.py
        audit.py
        tag.py
        material.py
        upload.py
        trash.py
        setting.py
        workflow.py
        style_agent.py
        task.py
        nas_job.py

      schemas/
        auth.py
        user.py
        audit.py
        tag.py
        material.py
        upload.py
        trash.py
        setting.py
        workflow.py
        style_agent.py
        task.py
        nas_job.py

      api/
        routes/
          auth.py
          users.py
          materials.py
          uploads.py
          tags.py
          tag_requests.py
          trash.py
          operations.py
          settings.py
          workflows.py
          workflow_runs.py
          style_agents.py
          tasks.py
          nas_jobs.py

      services/
        auth_service.py
        permission_service.py
        audit_log_service.py
        material_service.py
        upload_service.py
        tag_service.py
        trash_service.py
        download_service.py
        nas_job_service.py
        metadata_service.py
        workflow_runner.py
        node_registry.py
        style_agent_service.py
        task_service.py

      modules/
        workflow_nodes/
          material_search_node.py
          material_upload_node.py
          style_agent_node.py
          script_generator_node.py
          manual_review_node.py

      utils/
        hash.py
        filename.py
        file_type.py
        ffmpeg.py
        pagination.py

      tests/
        test_auth.py
        test_permissions.py
        test_upload.py
        test_materials.py
        test_tags.py
        test_download.py
        test_trash.py
        test_audit.py
        test_workflow_runner.py

  nas-client/
    app/
      worker.py
      config.py
      storage_service.py
      ffmpeg_service.py
      job_client.py
      download_stream.py

  docs/
    light_platform_with_materials_dev_doc.md
```

---

# 六、开发优先级

当前不要先重做复杂工作流。

开发顺序必须是：

```text
1. 统一项目骨架
2. 用户与权限系统
3. 操作日志系统
4. 标签体系
5. 素材资产模块
6. NAS Client 文件执行机制
7. 素材上传 / 下载 / 搜索 / 回收站
8. 再接入工作流画布节点
9. 再开发 Agent 和选题文案节点
```

当前最优先：

```text
materials 素材资产管理模块
```

---

# 七、公共能力设计

## 7.1 用户系统

统一用户系统，所有模块共用。

角色等级：

```text
1 超级管理员
2 素材管理员
3 普通成员
4 外部协作者
```

规则：

```text
高级角色拥有低级角色权限
```

## 7.2 权限系统

权限判断必须在后端完成，前端只负责隐藏按钮，不能作为安全边界。

必须支持：

```text
role_level
resource_owner
access_context
```

其中：

```text
access_context = lan | public
```

公网环境必须禁止删除、永久删除、权限修改、系统配置修改等高风险操作。

## 7.3 操作日志系统

所有关键操作写入统一日志表。

必须记录：

```text
上传
下载
批量下载
修改标签
申请标签
审核标签
删除
恢复
永久删除
移动
登录
登录失败
权限修改
系统设置修改
```

日志原则：

```text
永久保存
不可修改
原则上不删除
如超级管理员执行系统级日志清理，清理行为本身也要写日志
```

---

# 八、素材资产模块 V1 边界

## 8.1 必须实现

```text
1. 上传视频、音频、图片、文档
2. 单文件最大 10GB
3. 批量上传
4. 分片上传
5. 断点续传
6. 上传前选择标签
7. 素材形态标签必填
8. 系统自动归档到 NAS
9. 原始文件名保留
10. 真实存储名系统生成
11. SHA256 hash 重复检测
12. 同名不同 hash 允许上传并提醒
13. 文件元数据提取
14. 视频缩略图生成
15. 视频低清预览生成
16. 素材列表
17. 素材详情页
18. 标签筛选 AND / OR
19. 关键词搜索
20. 下载
21. 批量下载
22. 下载日志
23. 素材使用次数统计
24. 修改标签
25. 标签申请
26. 标签审核
27. 标签管理
28. 软删除到回收站
29. 恢复
30. 永久删除，需素材管理员及以上权限 + 二次确认
31. 回收站默认保留 30 天
32. 不自动清理精选、已引用、侵权风险、正在审核素材
33. 公网访问代理下载
34. 公网禁止删除
```

## 8.2 V1 不实现

```text
AI 自动打标签
Qdrant 语义搜索
文档转 PDF 预览
复杂文件版本管理
视频近似重复检测
图片相似搜索
音频指纹识别
OCR 搜索
复杂外链分享
自动发布
复杂审批流
多租户
```

---

# 九、标签体系

## 9.1 标签大类

V1 使用 6 类标签：

```text
内容对象标签
素材形态标签
用途标签
场景标签
内容主题标签
状态标签
```

## 9.2 上传必填规则

| 标签大类 | V1 规则 |
|---|---|
| 内容对象标签 | 建议必填 |
| 素材形态标签 | 必填 |
| 用途标签 | 可选 |
| 场景标签 | 可选 |
| 内容主题标签 | 建议填写 |
| 状态标签 | 系统自动生成 |

实际强制：

```text
素材形态标签必填
状态标签由系统自动赋值
```

如果无法判断：

```text
选择「未整理」或「未识别对象」
```

## 9.3 标签状态

```text
active：启用
pending：待审核
rejected：驳回
disabled：停用
merged：已合并
```

标签删除建议逻辑删除，不建议物理删除。

---

# 十、文件命名与重复检测

## 10.1 文件名规则

数据库保存两个名字：

```text
original_filename：用户上传时的原始文件名
stored_filename：系统生成的真实存储文件名
```

真实文件名由系统生成，不使用用户文件名作为真实路径。

## 10.2 stored_filename 格式

```text
mat_{YYYYMMDD}_{sequence}_{hash8}.{ext}
```

示例：

```text
mat_20260427_000001_ab12cd34.mp4
```

## 10.3 重复判断

V1 使用 SHA256 判断完全重复。

```text
相同 SHA256 = 完全重复
相同文件名但 SHA256 不同 = 同名不同内容
```

## 10.4 重复处理

同 hash：

```text
提示用户该文件已存在
默认不重复入库
允许取消上传或关联已有素材
```

同名但 hash 不同：

```text
允许上传
提示存在同名文件但内容不同
系统生成不同 stored_filename
记录 same_original_filename_group
```

---

# 十一、NAS 存储路径

```text
/NAS/material-assets/
  originals/
    video/
      2026/04/
    image/
      2026/04/
    audio/
      2026/04/
    document/
      2026/04/

  previews/
    video/
      2026/04/
    image/
      2026/04/
    audio/
      2026/04/

  thumbnails/
    video/
      2026/04/
    image/
      2026/04/

  trash/
    2026/04/
```

说明：

```text
originals：原始文件
previews：低清预览
thumbnails：缩略图
trash：回收站文件
```

用户不能直接决定真实存储路径。

---

# 十二、上传流程

```text
选择文件
→ 选择必填标签
→ 选择可选标签
→ 创建上传任务
→ 分片上传
→ 断点续传
→ 上传完成
→ 后端合并分片
→ 计算 SHA256
→ 重复检测
→ 生成 stored_filename
→ 创建 NAS job
→ NAS Client 写入 NAS
→ 写入数据库
→ 写操作日志
→ 后台异步提取元数据
→ 后台异步生成缩略图/低清预览
```

上传限制：

```text
单文件最大 10GB
默认 chunk_size = 50MB
支持批量上传
支持断点续传
支持失败重试
```

批量上传规则：

```text
批量上传前先选择一组默认标签
所有文件继承这组标签
上传后允许逐个修改
```

---

# 十三、预览与 FFmpeg

## 13.1 视频

使用 FFmpeg / ffprobe 提取：

```text
duration
width
height
fps
codec
bitrate
format
```

必须生成：

```text
缩略图
低清预览
```

低清预览建议：

```text
720p 或 480p 完整低清版
```

## 13.2 音频

提取：

```text
duration
sample_rate
channels
codec
format
```

## 13.3 图片

提取：

```text
width
height
format
color_mode
exif，可选
```

## 13.4 文档

V1 只保存：

```text
filename
extension
file_size
mime_type
```

不做文档转 PDF，不做文档预览。

## 13.5 预览日志

```text
普通预览不记录操作日志
下载必须记录
公网预览失败/异常可以记录安全日志
```

---

# 十四、搜索能力

V1 搜索方式：

```text
PostgreSQL + 标签筛选
```

V1 不接 Qdrant。

搜索字段：

```text
关键词
标签
标签匹配方式
文件类型
上传人
上传时间
素材状态
文件大小
视频时长
是否精选
是否已引用
```

标签筛选必须支持：

```text
all：同时满足全部标签
any：满足任一标签
```

前端文案：

```text
同时满足全部标签
满足任一标签
```

---

# 十五、下载与使用记录

## 15.1 下载规则

```text
所有角色都可以下载
所有角色都可以批量下载
公网下载必须通过后端代理
下载必须记录日志
```

## 15.2 使用记录

下载和加入任务都算素材使用，但分开统计。

使用类型：

```text
download_usage
task_usage
```

统计字段：

```text
download_count
task_usage_count
total_usage_count
last_used_at
```

解释：

```text
下载次数 = 素材被关注程度
任务使用次数 = 素材被生产采用程度
```

---

# 十六、删除与回收站

## 16.1 删除规则

```text
删除 = 软删除，进入回收站
永久删除 = 素材管理员及以上权限 + 二次确认
公网禁止删除
```

## 16.2 谁能删除

```text
上传者可以删除自己上传的素材
素材管理员及以上可以删除所有素材
外部协作者不能删除
公网环境不允许删除
```

## 16.3 回收站规则

```text
默认保留 30 天
超级管理员可设置保留周期
素材管理员及以上可以恢复
永久删除需要二次确认
```

不自动清理：

```text
精选
已引用
侵权风险
正在审核
```

## 16.4 永久删除清理

永久删除需要处理：

```text
原始文件
缩略图
低清预览
回收站文件
数据库状态
后续如有 Qdrant 索引，也要删除索引
```

日志保留。

---

# 十七、数据库表设计

## 17.1 users

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

## 17.2 roles

```sql
CREATE TABLE roles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    level INTEGER NOT NULL UNIQUE
);
```

初始化：

```text
1 超级管理员
2 素材管理员
3 普通成员
4 外部协作者
```

## 17.3 user_roles

```sql
CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id),
    role_id INTEGER REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);
```

## 17.4 tag_categories

```sql
CREATE TABLE tag_categories (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_required BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 17.5 tags

```sql
CREATE TABLE tags (
    id UUID PRIMARY KEY,
    category_id UUID REFERENCES tag_categories(id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    merged_to UUID REFERENCES tags(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(category_id, name)
);
```

## 17.6 tag_aliases

```sql
CREATE TABLE tag_aliases (
    id UUID PRIMARY KEY,
    tag_id UUID REFERENCES tags(id),
    alias TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tag_id, alias)
);
```

## 17.7 tag_requests

```sql
CREATE TABLE tag_requests (
    id UUID PRIMARY KEY,
    requested_name TEXT NOT NULL,
    category_id UUID REFERENCES tag_categories(id),
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by UUID REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    review_comment TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    reviewed_at TIMESTAMP
);
```

## 17.8 material_assets

```sql
CREATE TABLE material_assets (
    id UUID PRIMARY KEY,
    title TEXT,
    asset_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_review',
    uploader_id UUID REFERENCES users(id),
    is_featured BOOLEAN DEFAULT FALSE,
    is_referenced BOOLEAN DEFAULT FALSE,
    risk_level TEXT DEFAULT 'normal',
    download_count INTEGER DEFAULT 0,
    task_usage_count INTEGER DEFAULT 0,
    total_usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);
```

asset_type：

```text
video
image
audio
document
other
```

status：

```text
unorganized
pending_review
available
featured
discarded
copyright_risk
needs_confirmation
archived
reviewing
trashed
deleted
```

## 17.9 material_files

```sql
CREATE TABLE material_files (
    id UUID PRIMARY KEY,
    asset_id UUID REFERENCES material_assets(id),
    file_role TEXT NOT NULL,
    storage_type TEXT NOT NULL DEFAULT 'nas',
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT,
    extension TEXT,
    file_size BIGINT,
    sha256 TEXT,
    same_original_filename_group TEXT,
    width INTEGER,
    height INTEGER,
    duration_seconds NUMERIC,
    fps NUMERIC,
    codec TEXT,
    bitrate BIGINT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(file_path)
);

CREATE INDEX idx_material_files_sha256 ON material_files(sha256);
CREATE INDEX idx_material_files_asset_id ON material_files(asset_id);
```

file_role：

```text
original
thumbnail
preview
trash
```

## 17.10 material_tags

```sql
CREATE TABLE material_tags (
    asset_id UUID REFERENCES material_assets(id),
    tag_id UUID REFERENCES tags(id),
    added_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (asset_id, tag_id)
);
```

## 17.11 upload_sessions

```sql
CREATE TABLE upload_sessions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    original_filename TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type TEXT,
    chunk_size BIGINT NOT NULL,
    total_chunks INTEGER NOT NULL,
    uploaded_chunks INTEGER[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    selected_tag_ids UUID[],
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

## 17.12 asset_operations

```sql
CREATE TABLE asset_operations (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    username TEXT,
    role_id INTEGER,
    operation_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID,
    before_data JSONB,
    after_data JSONB,
    access_context TEXT,
    ip_address TEXT,
    user_agent TEXT,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_asset_operations_user_id ON asset_operations(user_id);
CREATE INDEX idx_asset_operations_target ON asset_operations(target_type, target_id);
CREATE INDEX idx_asset_operations_type ON asset_operations(operation_type);
CREATE INDEX idx_asset_operations_created_at ON asset_operations(created_at);
```

## 17.13 asset_usages

```sql
CREATE TABLE asset_usages (
    id UUID PRIMARY KEY,
    asset_id UUID REFERENCES material_assets(id),
    user_id UUID REFERENCES users(id),
    usage_type TEXT NOT NULL,
    related_task_id UUID,
    workflow_run_id UUID,
    access_context TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 17.14 trash_items

```sql
CREATE TABLE trash_items (
    id UUID PRIMARY KEY,
    asset_id UUID REFERENCES material_assets(id),
    deleted_by UUID REFERENCES users(id),
    deleted_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    restored_by UUID REFERENCES users(id),
    restored_at TIMESTAMP,
    permanently_deleted_by UUID REFERENCES users(id),
    permanently_deleted_at TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'trashed'
);
```

## 17.15 system_settings

```sql
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

初始设置：

```json
{
  "trash_retention_days": 30,
  "max_file_size_gb": 10,
  "default_chunk_size_mb": 50,
  "public_delete_disabled": true
}
```

## 17.16 nas_jobs

```sql
CREATE TABLE nas_jobs (
    id UUID PRIMARY KEY,
    job_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    finished_at TIMESTAMP
);
```

job_type：

```text
store_original
generate_thumbnail
generate_preview
move_to_trash
restore_from_trash
permanent_delete
stream_download
```

---

# 十八、API 设计

统一前缀：

```text
/api
```

## 18.1 Auth

```text
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
```

## 18.2 Uploads

```text
POST /api/uploads/init
POST /api/uploads/{upload_id}/chunks/{chunk_index}
GET  /api/uploads/{upload_id}/status
POST /api/uploads/{upload_id}/complete
POST /api/uploads/batch/init
```

## 18.3 Materials

```text
GET    /api/materials
GET    /api/materials/{asset_id}
PATCH  /api/materials/{asset_id}/tags
POST   /api/materials/{asset_id}/download
POST   /api/materials/batch-download
DELETE /api/materials/{asset_id}
POST   /api/materials/{asset_id}/restore
DELETE /api/materials/{asset_id}/permanent
```

## 18.4 Tags

```text
GET  /api/tag-categories
GET  /api/tags
POST /api/tags
PATCH /api/tags/{tag_id}
POST /api/tags/{tag_id}/disable
POST /api/tags/{tag_id}/merge
```

## 18.5 Tag Requests

```text
POST /api/tag-requests
GET  /api/tag-requests
POST /api/tag-requests/{request_id}/approve
POST /api/tag-requests/{request_id}/reject
```

## 18.6 Trash

```text
GET    /api/trash
POST   /api/trash/{trash_item_id}/restore
DELETE /api/trash/{trash_item_id}/permanent
POST   /api/trash/cleanup
```

## 18.7 Operations

```text
GET /api/operations
```

## 18.8 Settings

```text
GET   /api/settings
PATCH /api/settings
```

## 18.9 NAS Jobs

```text
GET  /api/nas-jobs/poll
POST /api/nas-jobs/{job_id}/start
POST /api/nas-jobs/{job_id}/complete
POST /api/nas-jobs/{job_id}/fail
```

## 18.10 Workflows，后续接入

```text
GET  /api/workflows
POST /api/workflows
GET  /api/workflows/{id}
PUT  /api/workflows/{id}
POST /api/workflow-runs
GET  /api/workflow-runs/{id}
```

---

# 十九、NAS Client 设计

## 19.1 定位

NAS Client 是运行在公司局域网内的文件执行代理。

它不是独立业务系统。

它只负责执行主平台下发的文件任务。

## 19.2 通信原则

推荐：

```text
NAS Client 主动连接阿里云后端，轮询或长连接拉取任务。
```

原因：

```text
NAS 不需要暴露公网端口
安全性更高
易于控制
```

## 19.3 任务类型

```text
store_original
generate_thumbnail
generate_preview
move_to_trash
restore_from_trash
permanent_delete
stream_download
```

## 19.4 任务流程

```text
NAS Client 启动
→ 使用 client_token 鉴权
→ 轮询 /api/nas-jobs/poll
→ 获取 pending job
→ 标记 running
→ 执行本地 NAS 操作
→ 回传 success / failed
```

---

# 二十、和工作流画布的关系

素材模块完成后，画布系统通过节点调用素材能力。

第一批素材相关节点：

```text
素材检索节点
素材上传节点
素材入库节点
素材下载节点
素材标签审核节点
```

典型流程：

```text
素材检索
→ 选题生成
→ 文案生成
→ 人工审核
→ 任务派发
```

节点本质上调用已有 API：

```text
/api/materials
/api/uploads
/api/tags
/api/materials/{id}/download
```

不要给画布节点另做一套素材逻辑。

---

# 二十一、前端页面

## 21.1 必须页面

```text
/login
/materials
/materials/[id]
/upload
/tags
/tag-requests
/trash
/operations
/settings
/workflows
/agents
/tasks
```

## 21.2 当前优先页面

先做：

```text
/login
/upload
/materials
/materials/[id]
/tags
/tag-requests
/trash
/operations
```

工作流和 Agent 页面可以后置。

---

# 二十二、Cursor 总指令

直接复制给 Cursor：

```md
我要开发的是 light_content_workflow_platform 主平台，不是两个独立系统。

请注意：material_asset_management 是主平台里的 materials 模块。

必须使用：
- 同一个项目仓库
- 同一个 Next.js 前端
- 同一个 FastAPI 后端
- 同一个 PostgreSQL 数据库
- 同一套用户系统
- 同一套权限系统
- 同一套操作日志系统

NAS Client 可以作为 nas-client 子目录独立运行，但它只是文件执行代理，不是独立业务系统。

当前开发优先级：先开发素材资产管理模块。

技术栈：
- Frontend: Next.js + TypeScript
- Backend: FastAPI + Pydantic + PostgreSQL
- Storage: 公司本地 NAS
- Media Processing: FFmpeg / ffprobe

V1 核心规则：
1. 文件存 NAS，数据库只存元数据。
2. 公网不直连 NAS，所有公网访问走阿里云后端代理。
3. 所有下载必须权限校验并记录日志。
4. 单文件最大 10GB。
5. 支持批量上传、分片上传、断点续传。
6. 上传前必须选择标签，素材形态标签必填。
7. 文件真实存储名由系统生成，原始文件名保存在数据库。
8. 使用 SHA256 判断完全重复。
9. 同 hash 默认不重复入库，只允许关联已有素材。
10. 同名不同 hash 允许上传并提醒。
11. 系统自动按类型和年月归档到 NAS。
12. 视频使用 FFmpeg 生成缩略图和低清预览。
13. V1 搜索使用 PostgreSQL + 标签筛选，标签筛选支持全部满足和任一满足。
14. 权限等级：超级管理员、素材管理员、普通成员、外部协作者，高级拥有低级权限。
15. 公网环境不允许删除和永久删除。
16. 删除进入回收站，默认保留 30 天。
17. 精选、已引用、侵权风险、正在审核素材不自动清理。
18. 永久删除需要素材管理员及以上权限，并二次确认。
19. 操作日志永久保存，不能修改。
20. 下载和加入任务都算素材使用，但分别统计。
21. 普通预览不记录日志。
22. V1 不做 AI 自动标签、语义搜索、文档预览、复杂版本管理。

请按以下顺序开发：
1. 统一项目骨架
2. 数据库模型与迁移
3. 用户与权限
4. 操作日志
5. 标签体系
6. 分片上传
7. 素材入库
8. 素材列表与详情
9. 下载与使用记录
10. 回收站
11. NAS Client 任务机制
12. FFmpeg 元数据与预览生成
13. 前端页面
14. 再接入工作流画布节点

不要把素材系统拆成独立后端、独立数据库或独立用户系统。
不要一次性写完整系统。
每次只实现一个阶段，并说明新增/修改了哪些文件。
```

---

# 二十三、开发阶段验收

## 阶段 1：项目骨架

验收：

```text
Next.js 能启动
FastAPI 能启动
PostgreSQL 能连接
Alembic 能迁移
基础目录结构完成
```

## 阶段 2：用户与权限

验收：

```text
能登录
能识别角色等级
能识别 access_context
公网删除类 API 被禁止
```

## 阶段 3：标签体系

验收：

```text
6 大标签分类初始化
普通成员可申请标签
素材管理员可审核标签
标签可停用、合并
```

## 阶段 4：分片上传

验收：

```text
支持初始化上传
支持上传分片
支持查询已上传分片
支持断点续传
支持完成合并
支持 SHA256 重复检测
```

## 阶段 5：素材入库

验收：

```text
上传后创建 material_asset
创建 material_file
写入 material_tags
生成 stored_filename
创建 NAS job
写操作日志
```

## 阶段 6：搜索与详情

验收：

```text
素材列表可用
详情页可用
关键词搜索可用
标签 all/any 筛选可用
```

## 阶段 7：下载与使用记录

验收：

```text
单文件下载可用
批量下载可用
每次下载有日志
asset_usages 有记录
download_count 增加
```

## 阶段 8：回收站

验收：

```text
删除进入回收站
可恢复
可永久删除
永久删除需要权限与二次确认
公网不能删除
```

## 阶段 9：NAS Client

验收：

```text
NAS Client 能拉取任务
能写入文件
能移动到回收站
能恢复
能回传任务状态
```

## 阶段 10：FFmpeg

验收：

```text
视频能提取元数据
能生成缩略图
能生成低清预览
缩略图和预览路径写入数据库
```

## 阶段 11：前端页面

验收：

```text
普通成员能上传、搜索、下载
素材管理员能审核标签、管理回收站
超级管理员能修改系统设置
公网删除按钮隐藏，后端也禁止
```

---

# 二十四、最小可用闭环

V1 最低闭环：

```text
登录
→ 上传视频
→ 选择标签
→ 分片上传
→ 入库
→ 生成缩略图
→ 列表搜索
→ 下载
→ 记录下载日志
→ 删除进入回收站
→ 管理员恢复
```

只要这个闭环跑通，素材资产管理模块 V1 成立。

---

# 二十五、后续再接入工作流

素材模块完成后，再做：

```text
素材检索节点
素材上传节点
素材下载节点
素材入库节点
素材标签审核节点
```

工作流节点不要重复实现素材逻辑，只调用 materials 模块已有 API。

---

# 二十六、最终原则

```text
同平台开发
模块化隔离
共用用户
共用权限
共用日志
共用数据库
素材模块先做
画布后续调用
```

一句话：

> light_content_workflow_platform 是总系统，materials 是资产底座模块。当前开发重心是先把 materials 做稳，再让画布调用它。
