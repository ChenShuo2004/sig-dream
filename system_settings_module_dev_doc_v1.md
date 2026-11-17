# 系统设置模块开发文档 V1

版本：V1.0  
适用系统：轻量内容流程平台  
模块名称：系统设置  
开发优先级：第一优先级  
目标：先完成平台级用户、角色、权限、安全策略、上传策略、下载与回收站策略，为后续标签管理、上传模块、素材库模块提供权限底座。

---

# 一、结论

系统设置模块是整个平台的权限与策略底座。

开发顺序必须先于：

```text
标签管理
上传模块
素材库主页面
回收站操作
操作日志
工作流素材调用
任务中心
```

原因：

```text
标签管理依赖权限
上传依赖权限
下载依赖权限
删除依赖权限
回收站依赖权限
日志查看依赖权限
系统参数修改依赖权限
```

如果不先完成系统设置，后续功能会写成临时判断，后期必然返工。

---

# 二、系统设置模块定位

系统设置只负责平台级规则。

它应该包含：

```text
用户管理
角色配置
权限点
安全策略
存储与上传
回收站与下载
```

它不负责具体业务操作。

不要把以下功能放进系统设置：

```text
标签增删改
具体素材上传
素材列表
素材搜索
回收站文件列表
操作日志明细
工作流编辑
任务执行
```

这些应该放在对应业务模块中。

---

# 三、系统设置页面结构

页面采用 Tab 结构。

```text
系统设置

用于配置用户、角色、权限、安全策略、上传限制、下载与回收站规则。

[用户管理] [角色配置] [权限点] [安全策略] [存储与上传] [回收站与下载]
```

页面整体布局：

```text
顶部：页面标题 + 简短说明
中部：Tab 导航
主体：当前 Tab 内容
底部：保存 / 取消 / 重置按钮，按需显示
```

---

# 四、Tab 1：用户管理

## 1. 功能定位

管理谁可以进入系统，以及用户属于什么角色。

## 2. 用户列表字段

```text
用户名
显示名
角色
账号状态
最近登录
创建时间
操作
```

## 3. 用户状态

```text
active：启用
disabled：禁用
locked：锁定
```

## 4. 支持操作

```text
新增用户
禁用用户
启用用户
锁定用户，系统自动或管理员手动
解锁用户
重置密码
修改显示名
修改角色
查看最近登录时间
```

## 5. 权限要求

```text
只有拥有 user.manage 权限的用户可以进入用户管理。
默认只有超级管理员拥有 user.manage。
```

## 6. 页面设计

```text
用户管理

[新增用户]

| 用户名 | 显示名 | 角色 | 状态 | 最近登录 | 创建时间 | 操作 |
| admin | 管理员 | 超级管理员 | 启用 | 2026-04-28 12:00 | 2026-04-01 | 修改角色 / 重置密码 |
```

## 7. 新增用户弹窗字段

```text
用户名
显示名
初始密码
确认密码
角色
账号状态，默认启用
```

## 8. 修改角色规则

```text
超级管理员可以修改其他用户角色。
不能移除最后一个超级管理员。
不能禁用最后一个超级管理员。
```

---

# 五、Tab 2：角色配置

## 1. 功能定位

配置系统角色能做什么。

角色配置是系统设置模块最核心的功能。

## 2. 固定系统角色

V1 固定 4 个系统角色：

```text
超级管理员
素材管理员
普通成员
外部协作者
```

角色等级：

```text
1 超级管理员
2 素材管理员
3 普通成员
4 外部协作者
```

## 3. 角色等级规则

```text
角色等级数字越小，权限等级越高。
高级角色可默认拥有低级角色能力。
实际授权仍以 role_permissions 为准。
```

## 4. 超级管理员硬规则

超级管理员必须遵守以下硬规则：

```text
超级管理员默认拥有全部权限。
超级管理员权限矩阵必须全选。
超级管理员权限不允许取消。
超级管理员角色不允许删除。
超级管理员角色不允许禁用。
超级管理员角色的权限复选框在页面上应显示为选中且禁用状态。
系统必须保证至少存在一个启用状态的超级管理员用户。
```

后端也必须强制：

```text
即使前端绕过限制，后端也不能允许取消超级管理员任何权限。
```

也就是说：

```text
超级管理员 = 永远全权限角色
```

## 5. 角色配置页面结构

左侧角色列表，右侧权限矩阵。

```text
角色配置

左侧：
- 超级管理员
- 素材管理员
- 普通成员
- 外部协作者

右侧：
当前角色：素材管理员

[用户与系统]
□ 用户管理
□ 角色管理
□ 系统参数管理

[标签管理]
□ 查看标签
□ 新增标签
□ 编辑标签
□ 停用标签
□ 合并标签
□ 删除标签
□ 申请标签
□ 审核标签申请

[素材资产]
□ 查看素材
□ 上传素材
□ 下载素材
□ 批量下载
□ 编辑自己上传素材
□ 编辑全部素材
□ 删除自己上传素材
□ 删除全部素材
□ 恢复自己删除素材
□ 恢复全部素材
□ 永久删除素材

[素材集合]
□ 查看集合
□ 创建集合
□ 编辑自己集合
□ 编辑全部集合
□ 删除自己集合
□ 删除全部集合

[回收站]
□ 查看回收站
□ 恢复素材
□ 永久删除

[操作日志]
□ 查看操作日志
```

## 6. 角色操作规则

```text
系统角色不允许删除。
系统角色名称不允许随意修改。
只有超级管理员可以修改角色权限。
普通成员、素材管理员、外部协作者不能进入角色配置页。
```

## 7. 素材管理员默认权限

```text
tag.view
tag.create
tag.edit
tag.disable
tag.merge
tag.request
tag.review

asset.view
asset.upload
asset.download
asset.batch_download
asset.edit_own
asset.edit_all
asset.delete_own
asset.delete_all
asset.restore_own
asset.restore_all
asset.permanent_delete

collection.view
collection.create
collection.edit_own
collection.edit_all
collection.delete_own
collection.delete_all

trash.view
trash.restore
trash.permanent_delete

log.view
```

素材管理员默认不拥有：

```text
user.manage
role.manage
system.setting.manage
tag.delete
```

## 8. 普通成员默认权限

```text
tag.view
tag.request

asset.view
asset.upload
asset.download
asset.batch_download
asset.edit_own
asset.delete_own
asset.restore_own

collection.view
collection.create
collection.edit_own
collection.delete_own
```

普通成员不允许：

```text
tag.create
tag.edit
tag.disable
tag.merge
tag.delete
tag.review
asset.edit_all
asset.delete_all
asset.restore_all
asset.permanent_delete
trash.permanent_delete
log.view
```

## 9. 外部协作者默认权限

```text
asset.view
asset.download
collection.view
```

外部协作者不允许：

```text
上传，默认不开放，可后续配置
删除
永久删除
标签管理
用户管理
角色管理
操作日志
系统设置
```

---

# 六、Tab 3：权限点

## 1. 功能定位

展示系统内置权限点。

V1 只读展示，不支持页面新增、修改、删除权限点。

原因：

```text
权限点是工程结构，不是普通业务配置。
管理员随意新增权限点会导致后端无法识别。
```

## 2. 权限点字段

```text
模块
权限编码
权限名称
说明
```

## 3. 权限点分组

### 用户与系统

```text
user.manage
role.manage
system.setting.manage
```

### 标签管理

```text
tag.view
tag.create
tag.edit
tag.disable
tag.merge
tag.delete
tag.request
tag.review
```

### 素材资产

```text
asset.view
asset.upload
asset.download
asset.batch_download
asset.edit_own
asset.edit_all
asset.delete_own
asset.delete_all
asset.restore_own
asset.restore_all
asset.permanent_delete
```

### 素材集合

```text
collection.view
collection.create
collection.edit_own
collection.edit_all
collection.delete_own
collection.delete_all
```

### 回收站

```text
trash.view
trash.restore
trash.permanent_delete
```

### 操作日志

```text
log.view
```

## 4. 页面设计

```text
权限点

说明：权限点由系统内置，V1 不支持页面新增。

| 模块 | 权限编码 | 权限名称 | 说明 |
| 素材资产 | asset.upload | 上传素材 | 允许上传素材文件 |
| 素材资产 | asset.download | 下载素材 | 允许下载素材文件 |
| 标签管理 | tag.review | 审核标签申请 | 允许审核成员提交的新标签 |
```

---

# 七、Tab 4：安全策略

## 1. 功能定位

配置平台访问环境、登录安全、公网限制。

## 2. V1 配置项

### 访问环境限制

```text
公网禁止删除素材：开启
公网禁止永久删除素材：开启
公网禁止修改角色权限：开启
公网禁止修改系统参数：开启
公网禁止用户管理：开启
```

### 登录安全

```text
登录失败锁定：开启
连续失败次数：默认 5 次
锁定时长：默认 30 分钟
```

## 3. 公网全局限制硬规则

当：

```text
access_context = public
```

后端必须强制禁止：

```text
asset.delete_own
asset.delete_all
asset.permanent_delete
trash.permanent_delete
role.manage
user.manage
system.setting.manage
```

注意：

```text
不能只靠前端隐藏按钮。
后端权限校验必须拦截。
即使是超级管理员，公网环境下也不能执行高风险操作。
```

## 4. 页面设计

```text
安全策略

[访问环境限制]
公网禁止删除素材          开启
公网禁止永久删除素材      开启
公网禁止修改角色权限      开启
公网禁止修改系统参数      开启
公网禁止用户管理          开启

[登录安全]
登录失败锁定              开启
连续失败次数              5
锁定时长                  30 分钟
```

---

# 八、Tab 5：存储与上传

## 1. 功能定位

配置上传限制、文件处理策略和 NAS 存储路径。

## 2. V1 配置项

### 上传限制

```text
单文件上传上限：10GB
分片大小：50MB
允许文件类型：视频 / 图片 / 音频 / 文档
```

### 存储策略

```text
默认存储位置：NAS
原始文件路径：/NAS/material-assets/originals
缩略图路径：/NAS/material-assets/thumbnails
预览文件路径：/NAS/material-assets/previews
回收站路径：/NAS/material-assets/trash
```

### 处理策略

```text
上传后自动生成缩略图：开启
上传后自动生成低清预览：开启
重复文件处理策略：提示并禁止重复入库
同名不同 hash 处理策略：允许上传并提醒
```

## 3. 页面设计

```text
存储与上传

[上传限制]
单文件上传上限        10 GB
分片大小              50 MB
允许文件类型          视频 / 图片 / 音频 / 文档

[存储策略]
默认存储位置          NAS
原始文件路径          /NAS/material-assets/originals
缩略图路径            /NAS/material-assets/thumbnails
预览文件路径          /NAS/material-assets/previews
回收站路径            /NAS/material-assets/trash

[处理策略]
生成缩略图            开启
生成低清预览          开启
重复文件处理          提示并禁止重复入库
同名不同 hash         允许上传并提醒
```

## 4. 权限要求

```text
只有拥有 system.setting.manage 权限的用户可以修改。
超级管理员默认拥有。
素材管理员默认不拥有。
```

## 5. 注意

真实 NAS 路径只对超级管理员和拥有系统设置权限的用户可见。

---

# 九、Tab 6：回收站与下载

## 1. 功能定位

配置删除、回收站保留、下载记录和使用次数统计规则。

## 2. V1 配置项

### 回收站策略

```text
回收站默认保留天数：30 天
自动清理回收站：开启
精选素材不自动清理：开启
已引用素材不自动清理：开启
侵权风险素材不自动清理：开启
正在审核素材不自动清理：开启
```

### 下载策略

```text
下载必须记录日志：开启
批量下载必须记录日志：开启
下载计入素材使用次数：开启
批量下载逐个素材计数：开启
```

## 3. 页面设计

```text
回收站与下载

[回收站策略]
默认保留天数              30 天
自动清理回收站            开启
精选素材不自动清理        开启
已引用素材不自动清理      开启
侵权风险素材不自动清理    开启
正在审核素材不自动清理    开启

[下载策略]
下载必须记录日志          开启
批量下载必须记录日志      开启
下载计入使用次数          开启
批量下载逐个素材计数      开启
```

---

# 十、数据库设计

## 1. users

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    failed_login_count INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

status：

```text
active
disabled
locked
```

---

## 2. roles

```sql
CREATE TABLE roles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    level INTEGER NOT NULL UNIQUE,
    description TEXT,
    is_system BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

初始化：

```text
1 超级管理员 level=1
2 素材管理员 level=2
3 普通成员 level=3
4 外部协作者 level=4
```

---

## 3. permissions

```sql
CREATE TABLE permissions (
    id UUID PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    module TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 4. role_permissions

```sql
CREATE TABLE role_permissions (
    role_id INTEGER REFERENCES roles(id),
    permission_id UUID REFERENCES permissions(id),
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);
```

注意：

```text
超级管理员 role_id=1 必须拥有所有 permissions。
后端不允许删除超级管理员的 role_permissions。
```

---

## 5. user_roles

```sql
CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id),
    role_id INTEGER REFERENCES roles(id),
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);
```

---

## 6. system_settings

```sql
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

初始化配置：

```json
{
  "public_delete_disabled": true,
  "public_permanent_delete_disabled": true,
  "public_role_manage_disabled": true,
  "public_system_setting_disabled": true,
  "public_user_manage_disabled": true,
  "login_lock_enabled": true,
  "login_max_failed_attempts": 5,
  "login_lock_minutes": 30,
  "max_file_size_gb": 10,
  "default_chunk_size_mb": 50,
  "allowed_file_types": ["video", "image", "audio", "document"],
  "storage_type": "nas",
  "nas_originals_path": "/NAS/material-assets/originals",
  "nas_thumbnails_path": "/NAS/material-assets/thumbnails",
  "nas_previews_path": "/NAS/material-assets/previews",
  "nas_trash_path": "/NAS/material-assets/trash",
  "generate_thumbnail_enabled": true,
  "generate_preview_enabled": true,
  "duplicate_file_strategy": "block_duplicate_hash",
  "same_name_different_hash_strategy": "allow_with_warning",
  "trash_retention_days": 30,
  "trash_auto_cleanup_enabled": true,
  "protect_featured_from_cleanup": true,
  "protect_referenced_from_cleanup": true,
  "protect_copyright_risk_from_cleanup": true,
  "protect_reviewing_from_cleanup": true,
  "download_log_required": true,
  "batch_download_log_required": true,
  "download_count_usage_enabled": true,
  "batch_download_count_each_asset": true
}
```

---

## 7. operation_logs

```sql
CREATE TABLE operation_logs (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    username TEXT,
    role_id INTEGER,
    operation_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    before_data JSONB,
    after_data JSONB,
    access_context TEXT,
    ip_address TEXT,
    user_agent TEXT,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

# 十一、后端权限校验规则

## 1. 权限判断入口

所有需要权限的 API 必须统一调用权限校验方法。

伪代码：

```python
def require_permission(user, permission_code, access_context):
    if is_public_restricted(permission_code, access_context):
        raise PermissionDenied

    if user_has_permission(user, permission_code):
        return True

    raise PermissionDenied
```

## 2. 超级管理员规则

```python
if user has role super_admin:
    return True
```

但注意公网限制优先级更高：

```python
if access_context == "public" and permission_code in PUBLIC_FORBIDDEN_PERMISSIONS:
    raise PermissionDenied
```

也就是说：

```text
公网限制 > 超级管理员全权限
```

## 3. 超级管理员权限不可取消

后端必须保证：

```text
不允许删除超级管理员角色
不允许禁用超级管理员角色
不允许取消超级管理员任何权限
不允许系统中没有启用状态的超级管理员
```

---

# 十二、API 设计

## 1. 用户管理

```text
GET    /settings/users
POST   /settings/users
PATCH  /settings/users/{user_id}
POST   /settings/users/{user_id}/disable
POST   /settings/users/{user_id}/enable
POST   /settings/users/{user_id}/reset-password
PATCH  /settings/users/{user_id}/roles
```

---

## 2. 角色配置

```text
GET   /settings/roles
GET   /settings/roles/{role_id}
GET   /settings/roles/{role_id}/permissions
PATCH /settings/roles/{role_id}/permissions
```

限制：

```text
role_id = 1 超级管理员时，不允许 PATCH 修改权限。
或者允许请求，但后端忽略并强制返回全权限。
```

推荐：

```text
直接禁止修改超级管理员权限，并返回明确提示：
超级管理员默认拥有全部权限，不允许取消。
```

---

## 3. 权限点

```text
GET /settings/permissions
```

只读。

---

## 4. 系统参数

```text
GET   /settings
PATCH /settings
```

---

## 5. 操作日志

系统设置模块内部涉及的操作日志写入：

```text
POST /internal/operation-logs
```

或由服务层直接写入，不暴露外部接口。

---

# 十三、系统设置操作日志

必须记录：

```text
登录成功
登录失败
新增用户
禁用用户
启用用户
重置密码
修改用户角色
修改角色权限
修改系统参数
尝试修改超级管理员权限但被拒绝
公网环境尝试高风险操作但被拒绝
```

日志字段：

```text
操作者
操作类型
目标对象
操作前数据
操作后数据
访问环境
IP
User-Agent
成功 / 失败
失败原因
时间
```

---

# 十四、前端页面设计细节

## 1. 系统设置首页

当前页面标题：

```text
系统设置
按文档结构预留：下载策略、回收站策略、角色配置、系统参数。
```

改成：

```text
系统设置
配置平台用户、角色权限、安全策略、上传限制、下载与回收站规则。
```

---

## 2. Tab 样式

```text
用户管理
角色配置
权限点
安全策略
存储与上传
回收站与下载
```

建议用横向 Tab。

---

## 3. 角色配置交互

当选择“超级管理员”时：

```text
所有权限显示为已选
所有复选框 disabled
顶部提示：
超级管理员默认拥有全部权限，不允许取消。
```

示例：

```text
当前角色：超级管理员

提示：
超级管理员是系统最高权限角色，默认拥有全部权限，权限不可取消。
```

当选择其他角色时：

```text
权限复选框可编辑
点击保存后提交 PATCH /settings/roles/{role_id}/permissions
```

---

## 4. 权限点页面

权限点只读。

不要出现：

```text
新增权限点
删除权限点
编辑权限点
```

---

## 5. 系统参数保存

系统参数修改必须：

```text
只有超级管理员可保存
保存前二次确认
保存后写操作日志
```

---

# 十五、Cursor 开发指令

直接复制给 Cursor：

```text
请开发系统设置模块。

这是当前第一优先级模块。后续标签管理、上传、素材库都依赖本模块的用户、角色、权限和系统参数。

页面使用 Tab 结构，包含：
1. 用户管理
2. 角色配置
3. 权限点
4. 安全策略
5. 存储与上传
6. 回收站与下载

核心硬规则：
超级管理员默认拥有全部权限。
超级管理员权限矩阵必须全选。
超级管理员权限不允许取消。
超级管理员角色不允许删除。
超级管理员角色不允许禁用。
系统必须保证至少存在一个启用状态的超级管理员用户。
前端要把超级管理员权限复选框显示为选中且禁用。
后端也必须禁止取消超级管理员任何权限。

一、数据库
实现以下表：
- users
- roles
- permissions
- role_permissions
- user_roles
- system_settings
- operation_logs

二、初始化数据
初始化 4 个系统角色：
1. 超级管理员 level=1
2. 素材管理员 level=2
3. 普通成员 level=3
4. 外部协作者 level=4

初始化权限点：
用户与系统：
- user.manage
- role.manage
- system.setting.manage

标签管理：
- tag.view
- tag.create
- tag.edit
- tag.disable
- tag.merge
- tag.delete
- tag.request
- tag.review

素材资产：
- asset.view
- asset.upload
- asset.download
- asset.batch_download
- asset.edit_own
- asset.edit_all
- asset.delete_own
- asset.delete_all
- asset.restore_own
- asset.restore_all
- asset.permanent_delete

素材集合：
- collection.view
- collection.create
- collection.edit_own
- collection.edit_all
- collection.delete_own
- collection.delete_all

回收站：
- trash.view
- trash.restore
- trash.permanent_delete

操作日志：
- log.view

超级管理员拥有全部权限，且不可取消。

三、用户管理
实现：
- 用户列表
- 新增用户
- 禁用 / 启用用户
- 重置密码
- 修改用户角色
- 最近登录时间
- 登录失败锁定字段

四、角色配置
实现：
- 角色列表
- 角色权限矩阵
- 修改角色权限
- 超级管理员权限全选且禁用
- 禁止删除系统角色
- 禁止取消超级管理员权限

五、权限点
只读展示。
不要做新增、编辑、删除权限点。

六、安全策略
实现配置：
- 公网禁止删除素材
- 公网禁止永久删除素材
- 公网禁止修改角色权限
- 公网禁止修改系统参数
- 公网禁止用户管理
- 登录失败锁定
- 连续失败次数，默认 5
- 锁定时长，默认 30 分钟

七、存储与上传
实现配置：
- 单文件上传上限，默认 10GB
- 分片大小，默认 50MB
- 允许文件类型：视频 / 图片 / 音频 / 文档
- 默认存储位置：NAS
- 原始文件路径
- 缩略图路径
- 预览文件路径
- 回收站路径
- 上传后生成缩略图
- 上传后生成低清预览
- 重复文件处理策略
- 同名不同 hash 处理策略

八、回收站与下载
实现配置：
- 回收站默认保留天数，默认 30 天
- 自动清理回收站
- 精选素材不自动清理
- 已引用素材不自动清理
- 侵权风险素材不自动清理
- 正在审核素材不自动清理
- 下载必须记录日志
- 批量下载必须记录日志
- 下载计入素材使用次数
- 批量下载逐个素材计数

九、公网全局限制
后端权限校验中必须实现：
如果 access_context = public，强制禁止：
- asset.delete_own
- asset.delete_all
- asset.permanent_delete
- trash.permanent_delete
- role.manage
- user.manage
- system.setting.manage

注意：
公网限制优先级高于超级管理员全权限。
即使是超级管理员，在公网环境也不能执行这些高风险操作。

十、操作日志
必须记录：
- 登录成功
- 登录失败
- 新增用户
- 禁用用户
- 启用用户
- 重置密码
- 修改用户角色
- 修改角色权限
- 修改系统参数
- 尝试修改超级管理员权限但被拒绝
- 公网环境尝试高风险操作但被拒绝

十一、页面要求
系统设置页面不要只是空壳。
请完成可操作的 UI：
- 用户管理表格
- 角色权限矩阵
- 权限点只读表格
- 安全策略表单
- 存储与上传表单
- 回收站与下载表单

完成本模块后，再进入标签管理模块。
```

---

# 十六、验收标准

## 1. 用户管理验收

```text
可以新增用户
可以禁用/启用用户
可以重置密码
可以修改用户角色
不能禁用最后一个超级管理员
不能移除最后一个超级管理员角色
```

## 2. 角色配置验收

```text
四个系统角色初始化成功
超级管理员全权限
超级管理员权限不能取消
素材管理员、普通成员、外部协作者权限可配置
只有超级管理员能修改角色权限
```

## 3. 权限点验收

```text
权限点按模块展示
权限点只读
页面不能新增权限点
```

## 4. 安全策略验收

```text
公网禁止删除生效
公网禁止永久删除生效
公网禁止修改角色权限生效
公网禁止修改系统参数生效
后端确实拦截，不只是前端隐藏
```

## 5. 系统参数验收

```text
上传上限可配置
分片大小可配置
NAS 路径可配置
回收站保留天数可配置
下载日志规则可配置
修改参数写入操作日志
```

---

# 十七、最终开发顺序

```text
第一阶段：系统设置 / 用户角色权限
第二阶段：标签管理
第三阶段：上传模块
第四阶段：素材库主页面
第五阶段：工作流素材调用
第六阶段：任务中心
```

系统设置完成后，整个平台才有可用的权限底座。
