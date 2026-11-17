# 素材集合模块开发技术文档 V1

版本：V1.0  
适用系统：轻量内容流程平台 / 素材库系统  
模块名称：素材集合（Asset Collections）  
开发优先级：高  
目标：在不改变真实文件存储结构的前提下，提供个人制作、项目协作、常用素材沉淀的虚拟集合能力。

---

# 一、结论

素材集合模块不是文件夹系统，而是素材引用组织系统。

核心定义：

```text
素材集合 = 一组素材引用关系，用于个人制作、项目协作、临时整理和长期复用。
```

必须坚持：

```text
1. 素材真实文件仍然只存 NAS。
2. 素材库仍然是唯一资产库。
3. 集合只保存素材引用，不复制文件。
4. 删除集合不删除素材。
5. 从集合移除素材不删除素材。
6. 集合分组不是 NAS 文件夹。
7. 项目集合权限按用户组配置。
```

---

# 二、模块定位

素材库解决的是：

```text
如何通过标签、搜索、快捷视图找到素材。
```

素材集合解决的是：

```text
用户在制作视频、整理素材、项目协作时，如何临时组织和长期沉淀一组素材。
```

它处在：

```text
素材库检索 → 素材集合组织 → 视频制作 / 工作流调用
```

中间这一层。

---

# 三、核心使用场景

## 1. 我的集合

用于个人使用习惯。

示例：

```text
我的常用车机素材
我的封面候选图
我的停车争议素材
本周要用的素材
临时素材篮
```

特点：

```text
个人创建
个人默认可见
不影响公共素材库
```

---

## 2. 项目集合

用于团队项目协作。

示例：

```text
理想车机账号素材包
理想 L9 高速专题素材包
停车争议专题素材包
HUD 功能素材包
```

特点：

```text
项目分组管理
按用户组授权
支持多人查看和协作
```

---

## 3. 复用素材包

用于长期沉淀。

示例：

```text
封面万能底图
车机功能证明素材
高转化开头素材
评论区争议截图素材
```

---

# 四、产品结构

V1 采用四层结构：

```text
一级：我的集合 / 项目集合
二级：集合分组
三级：具体集合
四级：集合内素材引用
```

示例：

```text
我的集合
├── 常用素材
│   ├── 车机截图常用包
│   └── 封面候选图
├── 临时素材
│   └── 本周理想 L9 视频

项目集合
├── 理想车机账号
│   ├── HUD 专题
│   └── 车机功能证明素材
├── 停车争议专题
│   └── 乱停车素材包
```

注意：

```text
集合分组只是集合的管理分类，不是文件夹。
```

---

# 五、V1 功能范围

## 1. 必须实现

```text
1. 我的集合
2. 项目集合
3. 集合分组
4. 创建集合
5. 编辑集合
6. 归档集合
7. 删除集合
8. 收录素材到集合
9. 从集合移除素材
10. 集合内素材排序
11. 集合内素材备注
12. 集合内素材浏览
13. 项目集合按用户组授权
14. 权限校验
15. 操作日志
```

---

## 2. V1 不做

```text
1. 不复制真实文件
2. 不移动 NAS 文件
3. 不做无限层级目录
4. 不做集合分享链接
5. 不做集合审批
6. 不做集合版本管理
7. 不做集合导出 ZIP
8. 不做集合自动推荐素材
9. 不强绑定工作流
10. 不做个人集合对外分享
```

---

# 六、术语定义

| 术语 | 定义 |
|---|---|
| 素材 | material_assets / materials 中的真实资产记录 |
| 素材文件 | material_files 中的具体文件 |
| 集合 | 一组素材引用关系 |
| 集合分组 | 用于整理集合的分类，不是文件夹 |
| 我的集合 | 个人拥有的集合 |
| 项目集合 | 团队/项目协作集合，按用户组授权 |
| 集合条目 | 某个集合里引用的一条素材 |
| 收录 | 把素材引用加入集合 |
| 移除 | 从集合删除引用，不删除素材 |

---

# 七、数据库设计

## 1. asset_collection_groups

集合分组表。

```sql
CREATE TABLE asset_collection_groups (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    group_type TEXT NOT NULL,
    parent_id UUID NULL REFERENCES asset_collection_groups(id),
    owner_user_id UUID NULL REFERENCES users(id),
    user_group_name TEXT NULL,
    sort_order INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

字段说明：

```text
id：分组 ID
name：分组名称
group_type：personal / project
parent_id：父分组 ID，V1 可限制最多一层
owner_user_id：个人分组归属用户
user_group_name：项目分组绑定的用户组名称
sort_order：排序
created_by：创建者
created_at：创建时间
updated_at：更新时间
```

约束建议：

```text
1. group_type 只能是 personal / project。
2. personal 分组必须有 owner_user_id。
3. project 分组可以绑定 user_group_name。
4. V1 不允许无限嵌套，parent_id 最多一层。
```

---

## 2. asset_collections

集合表。

```sql
CREATE TABLE asset_collections (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    collection_type TEXT NOT NULL,
    group_id UUID NULL REFERENCES asset_collection_groups(id),
    owner_user_id UUID NULL REFERENCES users(id),
    visibility TEXT NOT NULL DEFAULT 'private',
    status TEXT NOT NULL DEFAULT 'active',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

字段说明：

```text
collection_type：personal / project
group_id：所属集合分组
owner_user_id：个人集合归属用户
visibility：private / team
status：active / archived / deleted
```

状态说明：

```text
active：正常使用
archived：已归档
deleted：软删除
```

---

## 3. asset_collection_items

集合素材引用表。

```sql
CREATE TABLE asset_collection_items (
    id UUID PRIMARY KEY,
    collection_id UUID NOT NULL REFERENCES asset_collections(id),
    material_id UUID NOT NULL REFERENCES materials(id),
    material_file_id UUID NULL REFERENCES material_files(id),
    note TEXT,
    sort_order INTEGER DEFAULT 0,
    added_by UUID REFERENCES users(id),
    added_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(collection_id, material_id, material_file_id)
);
```

字段说明：

```text
collection_id：所属集合
material_id：引用的素材
material_file_id：引用的具体文件，可为空
note：集合内备注
sort_order：集合内排序
added_by：收录人
added_at：收录时间
```

为什么保留 material_file_id：

```text
一个素材可能有多个文件。
有些场景用户收录的是具体文件，而不是整个素材。
V1 如果暂时只用主文件，也可以允许 material_file_id 为空。
```

---

## 4. project_collection_permissions

项目集合权限表。

```sql
CREATE TABLE project_collection_permissions (
    id UUID PRIMARY KEY,
    collection_id UUID NOT NULL REFERENCES asset_collections(id),
    user_group_name TEXT NOT NULL,
    permission_level TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(collection_id, user_group_name)
);
```

permission_level：

```text
view：可查看
edit：可编辑
manage：可管理
```

权限解释：

| 权限 | 能力 |
|---|---|
| view | 查看集合、查看素材、下载素材 |
| edit | 添加素材、移除素材、修改备注、排序 |
| manage | 修改集合信息、修改权限、归档、删除 |

---

# 八、权限设计

## 1. 使用已有权限点

当前系统已有 collection.* 权限点，直接使用。

```text
collection.view
collection.create
collection.edit_own
collection.edit_all
collection.delete_own
collection.delete_all
```

不要新建一套孤立权限系统。

---

## 2. 我的集合权限

```text
创建者默认拥有查看、编辑、管理权限。
其他用户默认不可见。
超级管理员拥有全部权限。
```

规则：

```text
查看：owner_user_id = current_user.id 或 collection.view + edit_all
编辑：owner_user_id = current_user.id 且 collection.edit_own，或 collection.edit_all
删除：owner_user_id = current_user.id 且 collection.delete_own，或 collection.delete_all
```

---

## 3. 项目集合权限

项目集合按照用户组授权。

规则：

```text
1. 项目集合必须绑定至少一个用户组权限，或由超级管理员创建。
2. 用户属于某个授权用户组时，获得对应权限。
3. 多个用户组权限取最高权限。
4. 超级管理员拥有全部权限。
5. 素材管理员默认可管理全部项目集合，除非后续产品另行限制。
```

权限等级：

```text
view < edit < manage
```

---

## 4. 项目集合权限判断函数

建议后端实现统一函数：

```python
def get_collection_permission_level(user, collection) -> str | None:
    if user.is_super_admin:
        return "manage"

    if collection.collection_type == "personal":
        if collection.owner_user_id == user.id:
            return "manage"
        return None

    if collection.collection_type == "project":
        user_groups = get_user_group_names(user)
        permission_rows = query_permissions(collection.id, user_groups)
        return max_permission(permission_rows)

    return None
```

---

# 九、API 设计

## 1. 集合分组 API

### 获取分组树

```text
GET /collections/groups
```

查询参数：

```text
group_type=personal|project
```

返回：

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "常用素材",
      "group_type": "personal",
      "parent_id": null,
      "children": []
    }
  ]
}
```

---

### 创建分组

```text
POST /collections/groups
```

请求：

```json
{
  "name": "理想车机账号",
  "group_type": "project",
  "parent_id": null,
  "user_group_name": "理想车机项目组"
}
```

权限：

```text
collection.create
```

项目分组创建建议要求：

```text
collection.edit_all 或 超级管理员
```

---

### 修改分组

```text
PATCH /collections/groups/{group_id}
```

可修改：

```text
name
parent_id
sort_order
user_group_name
```

---

### 删除分组

```text
DELETE /collections/groups/{group_id}
```

规则：

```text
1. 分组下没有子分组。
2. 分组下没有集合。
3. 才允许删除。
```

---

## 2. 集合 API

### 获取集合列表

```text
GET /collections
```

查询参数：

```text
collection_type=personal|project
group_id
status=active|archived|deleted
keyword
page
page_size
```

返回：

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "车机截图常用包",
      "collection_type": "personal",
      "group_id": "uuid",
      "status": "active",
      "item_count": 32,
      "created_by_name": "大昌",
      "created_at": "2026-05-10T10:00:00"
    }
  ],
  "total": 1
}
```

---

### 创建集合

```text
POST /collections
```

请求：

```json
{
  "name": "HUD 专题素材包",
  "description": "理想车机 HUD 相关素材",
  "collection_type": "project",
  "group_id": "uuid",
  "visibility": "team",
  "permissions": [
    {
      "user_group_name": "理想车机项目组",
      "permission_level": "edit"
    }
  ]
}
```

权限：

```text
collection.create
```

---

### 获取集合详情

```text
GET /collections/{collection_id}
```

返回：

```json
{
  "id": "uuid",
  "name": "HUD 专题素材包",
  "description": "理想车机 HUD 相关素材",
  "collection_type": "project",
  "group_id": "uuid",
  "status": "active",
  "permission_level": "edit",
  "item_count": 12,
  "permissions": [
    {
      "user_group_name": "理想车机项目组",
      "permission_level": "edit"
    }
  ]
}
```

---

### 修改集合

```text
PATCH /collections/{collection_id}
```

可修改：

```text
name
description
group_id
status
visibility
```

权限：

```text
个人集合：edit_own / edit_all
项目集合：manage
```

---

### 归档集合

```text
POST /collections/{collection_id}/archive
```

执行：

```text
status = archived
```

---

### 删除集合

```text
DELETE /collections/{collection_id}
```

V1 建议软删除：

```text
status = deleted
```

不删除素材，不删除真实文件。

---

## 3. 集合条目 API

### 获取集合内素材

```text
GET /collections/{collection_id}/materials
```

查询参数：

```text
keyword
file_type
page
page_size
sort=sort_order|added_at|created_at
```

返回：

```json
{
  "items": [
    {
      "item_id": "uuid",
      "material_id": "uuid",
      "material_file_id": "uuid",
      "title": "理想 L9 HUD 实拍",
      "thumbnail_url": "...",
      "file_type": "video",
      "tags": ["理想L9", "HUD", "实拍"],
      "note": "适合做开头证明素材",
      "sort_order": 10,
      "added_by_name": "阿宝",
      "added_at": "2026-05-10T10:00:00"
    }
  ],
  "total": 1
}
```

---

### 添加素材到集合

```text
POST /collections/{collection_id}/items
```

请求：

```json
{
  "material_id": "uuid",
  "material_file_id": "uuid",
  "note": "适合做封面候选"
}
```

规则：

```text
1. 如果已存在相同 collection_id + material_id + material_file_id，则不重复插入。
2. 可返回 already_exists。
3. 不改变素材标签。
4. 不改变素材状态。
5. 不复制文件。
```

---

### 批量添加素材到集合

```text
POST /collections/{collection_id}/items/batch
```

请求：

```json
{
  "items": [
    {
      "material_id": "uuid1",
      "material_file_id": "file1",
      "note": "开头"
    },
    {
      "material_id": "uuid2",
      "material_file_id": null,
      "note": "备用"
    }
  ]
}
```

---

### 修改集合条目备注

```text
PATCH /collections/{collection_id}/items/{item_id}
```

请求：

```json
{
  "note": "适合第 3 段文案",
  "sort_order": 20
}
```

---

### 移除集合条目

```text
DELETE /collections/{collection_id}/items/{item_id}
```

执行：

```text
只删除 asset_collection_items 行。
不删除 material。
不删除 material_file。
不删除 NAS 文件。
```

---

### 集合内排序

```text
PATCH /collections/{collection_id}/items/reorder
```

请求：

```json
{
  "items": [
    { "item_id": "uuid1", "sort_order": 10 },
    { "item_id": "uuid2", "sort_order": 20 }
  ]
}
```

---

## 4. 素材快捷收录 API

用于素材库详情抽屉按钮。

```text
POST /materials/{material_id}/collect
```

请求：

```json
{
  "collection_id": "uuid",
  "material_file_id": "uuid",
  "note": "适合做证明素材"
}
```

返回：

```json
{
  "status": "success",
  "item_id": "uuid"
}
```

如果已存在：

```json
{
  "status": "already_exists",
  "item_id": "uuid"
}
```

---

# 十、前端页面设计

## 1. 素材集合页面

路径：

```text
/collections
```

页面采用三栏结构：

```text
左侧：集合类型 + 分组树 + 集合列表
中间：集合内素材列表
右侧：集合详情 / 素材详情
```

布局：

```text
┌──────────────────────────────────────────────┐
│ 素材集合                                      │
├──────────────┬──────────────────┬────────────┤
│ 我的集合      │ 当前集合内素材     │ 详情区       │
│ 项目集合      │ 缩略图 / 详细视图   │ 集合信息     │
│ 已归档        │ 搜索 / 筛选 / 排序  │ 素材详情     │
└──────────────┴──────────────────┴────────────┘
```

---

## 2. 左侧区域

顶部切换：

```text
我的集合
项目集合
已归档
```

下方显示分组树：

```text
我的集合
  常用素材
    车机截图常用包
    封面候选图
  临时素材
    本周视频素材

项目集合
  理想车机账号
    HUD 专题
    车机功能证明素材
  停车争议专题
    乱停车素材包
```

操作：

```text
新建分组
新建集合
重命名分组
删除空分组
归档集合
```

---

## 3. 中间集合内素材区

顶部：

```text
集合名称
素材数量
搜索框
文件类型筛选
视图切换：缩略图 / 详细
排序：手动排序 / 添加时间 / 文件类型
```

素材卡片显示：

```text
缩略图 / 文件类型 ico
标题
标签摘要
备注
添加人
添加时间
```

详细视图显示：

```text
标题
文件类型
文件大小
标签
备注
添加人
添加时间
下载次数
```

支持：

```text
点击素材查看详情
下载
从集合移除
编辑备注
拖拽排序，V1 可先用上下移动或排序号
```

---

## 4. 右侧详情区

当选中集合时显示集合详情：

```text
集合名称
描述
类型：我的集合 / 项目集合
所属分组
状态
创建人
创建时间
权限信息，项目集合显示
操作：编辑、归档、删除
```

当选中素材时显示素材详情：

```text
缩略图 / ico
标题
原始文件名
标签
备注
操作：下载、移除、编辑备注、打开素材详情
```

---

# 十一、素材库页面改造

## 1. 右侧详情抽屉新增按钮

在素材库 `/materials` 右侧详情抽屉中增加：

```text
收录我的集合
收录项目集合
```

---

## 2. 收录我的集合弹窗

内容：

```text
标题：收录我的集合
搜索集合
选择分组
选择集合
新建集合
备注
确认收录
```

---

## 3. 收录项目集合弹窗

内容：

```text
标题：收录项目集合
搜索项目集合
选择项目分组
选择集合
显示当前用户权限
备注
确认收录
```

规则：

```text
只展示当前用户有 edit 或 manage 权限的项目集合。
如果只有 view 权限，不允许收录。
```

---

# 十二、操作日志设计

所有写操作必须写 `operation_logs`。

## 1. operation_type 建议

```text
collection.group.create
collection.group.update
collection.group.delete
collection.create
collection.update
collection.archive
collection.delete
collection.permission.update
collection.item.add
collection.item.batch_add
collection.item.remove
collection.item.update_note
collection.item.reorder
```

---

## 2. 日志字段建议

```json
{
  "operation_type": "collection.item.add",
  "target_type": "asset_collection",
  "target_id": "collection_id",
  "after_data": {
    "collection_id": "uuid",
    "material_id": "uuid",
    "material_file_id": "uuid",
    "note": "适合做封面"
  }
}
```

---

# 十三、权限验收规则

## 1. 我的集合

```text
创建者能查看、编辑、删除自己的集合。
其他普通用户看不到。
超级管理员能查看和管理。
```

---

## 2. 项目集合

```text
用户属于授权用户组，才能看到项目集合。
view 权限只能查看和下载。
edit 权限可以收录、移除、备注、排序。
manage 权限可以编辑集合、归档、删除、修改权限。
```

---

## 3. 素材库收录

```text
没有 collection.edit 权限的集合，不出现在可收录列表。
```

---

# 十四、数据一致性规则

## 1. 删除集合

```text
删除集合只软删除 asset_collections。
可以同时软删除或保留 asset_collection_items。
不删除素材。
不删除文件。
```

建议 V1：

```text
collection.status = deleted
items 保留，方便恢复或审计
```

---

## 2. 从集合移除素材

```text
删除 asset_collection_items 行。
不影响 materials。
不影响 material_files。
不影响 material_tags。
不影响 NAS 文件。
```

---

## 3. 素材被移入回收站

如果素材被移入回收站：

```text
集合内仍可保留引用，但前端显示“素材已移入回收站”。
普通用户不能下载。
有恢复权限的人可跳转回收站处理。
```

V1 也可以选择：

```text
集合内默认隐藏 trashed 素材，提供“显示已回收素材”开关。
```

建议 V1：

```text
默认显示，但标记为“已回收”。
```

---

# 十五、开发顺序

## 第一阶段：数据库与后端基础

```text
1. 新增 asset_collection_groups
2. 新增 asset_collections
3. 新增 asset_collection_items
4. 新增 project_collection_permissions
5. 实现权限判断函数
6. 实现集合 CRUD API
7. 实现集合条目 API
8. 实现操作日志
```

---

## 第二阶段：素材库收录入口

```text
1. 素材详情抽屉增加“收录我的集合”
2. 素材详情抽屉增加“收录项目集合”
3. 弹窗选择集合 / 新建集合
4. 提交 POST /materials/{id}/collect
5. 处理 already_exists
```

---

## 第三阶段：素材集合页面

```text
1. 新建 /collections 页面
2. 左侧集合分组树
3. 中间集合内素材列表
4. 右侧详情区
5. 集合内搜索 / 筛选 / 视图切换
6. 备注 / 排序 / 移除
```

---

## 第四阶段：项目集合权限 UI

```text
1. 项目集合创建时选择用户组
2. 设置 view/edit/manage
3. 集合详情中展示权限
4. manage 用户可修改权限
```

---

# 十六、给 Cursor 的开发指令

```text
请开发素材集合模块 V1。

模块定位：
素材集合不是文件夹，不复制文件，不移动 NAS 文件。
它是一组素材引用关系，用于个人制作、项目协作、临时整理和复用沉淀。

核心规则：
1. 素材集合是引用关系，不是文件夹。
2. 删除集合不删除素材。
3. 从集合移除素材不删除素材。
4. 集合分组不是 NAS 目录，只是管理集合的分类结构。
5. 项目集合权限按用户组配置。
6. 权限统一使用现有 collection.* 权限点。
7. 所有写操作必须写 operation_logs。

一、数据库
新增表：
1. asset_collection_groups
2. asset_collections
3. asset_collection_items
4. project_collection_permissions

二、集合分组
支持：
- 我的集合分组
- 项目集合分组
- 新建分组
- 修改分组
- 删除空分组
- 最多一层子分组，V1 不做无限层级

三、集合
支持：
- 创建集合
- 编辑集合
- 归档集合
- 删除集合，软删除
- 我的集合
- 项目集合

四、集合条目
支持：
- 添加素材到集合
- 批量添加素材到集合
- 从集合移除素材
- 修改条目备注
- 调整排序
- 查看集合内素材

五、权限
我的集合：
- 创建者默认管理
- 其他用户默认不可见

项目集合：
- 按用户组授权
- permission_level: view / edit / manage
- view: 查看和下载
- edit: 添加、移除、备注、排序
- manage: 编辑集合、归档、删除、修改权限

六、API
实现：
GET /collections/groups
POST /collections/groups
PATCH /collections/groups/{group_id}
DELETE /collections/groups/{group_id}

GET /collections
POST /collections
GET /collections/{collection_id}
PATCH /collections/{collection_id}
POST /collections/{collection_id}/archive
DELETE /collections/{collection_id}

GET /collections/{collection_id}/materials
POST /collections/{collection_id}/items
POST /collections/{collection_id}/items/batch
PATCH /collections/{collection_id}/items/{item_id}
DELETE /collections/{collection_id}/items/{item_id}
PATCH /collections/{collection_id}/items/reorder

POST /materials/{material_id}/collect

七、前端
新增页面：
/collections

页面三栏结构：
左侧：我的集合 / 项目集合 + 分组树 + 集合列表
中间：集合内素材列表，支持缩略图 / 详细视图
右侧：集合详情 / 素材详情

素材库 /materials 右侧详情抽屉增加：
- 收录我的集合
- 收录项目集合

点击后弹窗：
- 搜索集合
- 选择分组
- 选择集合
- 新建集合
- 添加备注
- 确认收录

八、操作日志
必须记录：
- collection.group.create
- collection.group.update
- collection.group.delete
- collection.create
- collection.update
- collection.archive
- collection.delete
- collection.permission.update
- collection.item.add
- collection.item.batch_add
- collection.item.remove
- collection.item.update_note
- collection.item.reorder

九、禁止事项
不要：
- 复制真实文件
- 移动 NAS 文件
- 把集合分组做成文件夹路径
- 做无限层级目录
- 做集合分享链接
- 做集合导出 ZIP
- 做集合审批
- 改变素材标签
- 改变素材状态
```

---

# 十七、验收标准

## 1. 我的集合

```text
用户可以创建个人分组。
用户可以创建个人集合。
用户可以把素材收录到个人集合。
用户可以在集合内查看、备注、排序、移除素材。
其他普通用户看不到该个人集合。
```

---

## 2. 项目集合

```text
管理员可以创建项目分组。
项目集合可以绑定用户组。
用户组权限 view/edit/manage 生效。
无权限用户看不到项目集合。
view 用户不能添加素材。
edit 用户可以添加和移除素材。
manage 用户可以改权限和归档删除集合。
```

---

## 3. 素材库收录

```text
素材详情抽屉可以收录我的集合。
素材详情抽屉可以收录项目集合。
已存在素材再次收录时提示已存在，不重复插入。
收录不改变素材标签。
收录不改变素材状态。
收录不复制文件。
```

---

## 4. 数据安全

```text
删除集合不删除素材。
从集合移除素材不删除素材。
素材真实文件仍在 NAS。
```

---

# 十八、最终定版

素材集合模块 V1 的核心闭环：

```text
素材库找到素材
→ 收录我的集合 / 项目集合
→ 选择或新建集合
→ 添加备注
→ 打开素材集合页面
→ 查看集合内素材
→ 下载 / 移除 / 备注 / 排序
```

一句话：

```text
素材集合是用户制作视频时的素材篮和项目素材包，不是文件夹，不搬文件，只组织引用。
```
