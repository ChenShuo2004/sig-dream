# 教程中心与交互式操作引导模块开发技术文档 V1

版本：V1.0  
适用项目：轻量内容流程平台（Light Content Workflow Platform）  
模块名称：教程中心 / 交互式操作引导  
前端技术栈：Next.js App Router + React + TypeScript  
后端技术栈：FastAPI + SQLAlchemy 2 + PostgreSQL  
开发优先级：中高  
目标：让团队成员通过系统内教程页面，点击对应页面教程后，自动跳转到业务页面，并通过高亮提示一步一步学习系统操作。

---

## 一、项目上下文依据

当前项目是面向素材收集、标签组织、上传入库、下载分发与基础流程协作的 Web 应用。前端为 Next.js + React + TypeScript，后端为 FastAPI + SQLAlchemy 2 + PostgreSQL，浏览器通过 `/api-proxy/*` 反代到后端。

当前系统已有以下页面和模块：

```text
/materials              素材库
/collections            素材集合
/materials/upload       上传队列
/unorganized            未整理素材
/trash                  回收站
/tags                   标签管理
/tag-requests           标签审核
/operations             操作日志
```

教程模块必须围绕这些已存在页面展开，而不是另起一套孤立教程系统。

---

## 二、模块定位

### 1. 功能定位

教程中心不是普通图文说明页，而是系统内的交互式学习入口。

用户进入：

```text
/tutorials
```

可以看到 8 个页面教程：

```text
01 素材库
02 素材集合
03 上传队列
04 未整理
05 回收站
06 标签管理
07 标签审核
08 操作日志
```

用户点击某个教程后：

```text
跳转对应页面
→ 自动启动页面引导
→ 高亮页面关键区域
→ 用户按步骤点击下一步
→ 完成后记录学习进度
```

---

### 2. 设计原则

```text
1. 按页面做教程，不按零散任务做教程。
2. 每个页面教程控制在 4～7 步。
3. 教程内容只讲使用，不讲技术实现。
4. 页面高亮定位必须使用 data-tour，不依赖 CSS class。
5. 有权限才能学习对应页面。
6. 教程完成状态要按用户记录。
7. 桌面端优先做交互式引导。
8. 手机端可降级为图文步骤。
9. 不破坏现有页面业务逻辑。
10. 教程模块本身不写入全局操作日志，除非后续产品明确要求。
```

---

## 三、教程中心页面设计

### 1. 新增页面

```text
/tutorials
```

页面标题：

```text
教程中心
```

页面说明：

```text
按页面学习系统功能，点击后系统会自动跳转并一步一步引导操作。
```

---

### 2. 教程卡片

教程中心显示 8 个卡片：

```text
01 素材库
02 素材集合
03 上传队列
04 未整理
05 回收站
06 标签管理
07 标签审核
08 操作日志
```

每个卡片显示：

```text
页面名称
页面用途
预计用时
适用角色
学习状态
开始学习按钮
重新学习按钮，已完成后显示
```

学习状态：

```text
未开始
学习中
已完成
需要权限
```

---

### 3. 无权限处理

如果当前用户没有该教程对应页面权限：

```text
卡片仍然显示
状态显示：需要权限
开始学习按钮禁用
```

不要直接隐藏教程卡片。原因是让用户知道系统里有该模块，只是当前账号没有权限。

---

## 四、8 个教程定义

---

## 01 素材库教程

### 跳转路径

```text
/materials?tutorial=materials
```

### 页面用途

```text
用于查找、筛选、查看、下载和收录素材。
```

### 适用权限

```text
asset.view
```

### 教程步骤

```text
1. 快捷视图：全部素材、我的上传、最近下载等入口。
2. 搜索框：按标题、原始文件名、描述、标签搜索素材。
3. 标签筛选：点击标签加入当前筛选条件。
4. 查询方式：同时满足 / 满足任一。
5. 素材列表与视图切换：缩略图、列表、详细视图。
6. 右侧详情抽屉：查看详情、下载、收录集合。
```

### data-tour

```text
data-tour="materials-quick-view"
data-tour="materials-search-input"
data-tour="materials-tag-filter"
data-tour="materials-match-mode"
data-tour="materials-view-switch"
data-tour="materials-list"
data-tour="materials-detail-drawer"
data-tour="materials-download-button"
data-tour="materials-collect-button"
```

### 引导文案重点

```text
“同时满足”表示素材必须包含所有已选标签。
“满足任一”表示素材只要包含任意一个已选标签即可。
```

---

## 02 素材集合教程

### 跳转路径

```text
/collections?tutorial=collections
```

### 页面用途

```text
用于管理个人集合、项目集合和集合内素材引用。
```

### 适用权限

```text
collection.view
```

### 教程步骤

```text
1. 我的集合 / 项目集合：区分个人整理和团队项目整理。
2. 集合分组：像目录一样管理集合，但不是 NAS 文件夹。
3. 新建集合：创建个人集合或项目集合。
4. 集合内素材列表：查看集合中收录的素材引用。
5. 移动 / 复制 / 从集合移除素材。
6. 备注与排序：给集合内素材补充使用说明，并调整顺序。
```

### data-tour

```text
data-tour="collections-root-tabs"
data-tour="collections-tree"
data-tour="collections-group-list"
data-tour="collections-create-button"
data-tour="collections-items-list"
data-tour="collections-item-actions"
data-tour="collections-note-editor"
data-tour="collections-sort-handle"
data-tour="collections-detail-drawer"
```

### 引导文案重点

```text
素材集合是引用关系，不是真实文件夹。
从集合中移除素材，不会删除素材库中的真实文件。
分组树只是 UI 和权限组织，不代表 NAS 目录。
```

---

## 03 上传队列教程

### 跳转路径

```text
/materials/upload?tutorial=upload
```

### 页面用途

```text
用于选择文件、设置标题和标签，并上传入库。
```

### 适用权限

```text
asset.upload
```

### 教程步骤

```text
1. 选择文件：从本地选择要上传的文件。
2. 上传队列：查看待上传、上传中、已完成、失败的文件。
3. 入库标题：默认取文件名，可手动修改。
4. 标签选择：为上传素材选择标签。
5. 开始上传：开始上传并入库。
6. 上传状态与失败重试：查看进度，失败后可重试。
```

### data-tour

```text
data-tour="upload-file-picker"
data-tour="upload-queue-list"
data-tour="upload-title-input"
data-tour="upload-tag-panel"
data-tour="upload-start-button"
data-tour="upload-status"
data-tour="upload-retry-button"
```

### 引导文案重点

```text
未选择标签的素材会自动进入未整理。
上传完成不代表缩略图马上生成，缩略图由 NAS Worker 异步处理。
```

---

## 04 未整理教程

### 跳转路径

```text
/unorganized?tutorial=unorganized
```

### 页面用途

```text
用于处理带“未整理”标签或无标签的素材。
```

### 适用权限

```text
asset.view
+
asset.edit_own 或 asset.edit_all
```

### 教程步骤

```text
1. 未整理素材列表：这里显示带“未整理”标签或无标签素材。
2. 批量选择素材：可以一次选择多个素材处理。
3. 右侧五类标签：为素材选择合适标签。
4. 应用标签：给素材写入所选标签。
5. 自动移除“未整理”标签。
6. 移入回收站：无效素材可移入回收站。
```

### data-tour

```text
data-tour="unorganized-material-list"
data-tour="unorganized-batch-select"
data-tour="unorganized-tag-panel"
data-tour="unorganized-apply-tags-button"
data-tour="unorganized-trash-button"
data-tour="unorganized-selected-count"
```

### 引导文案重点

```text
未整理页面不会把素材状态改成“可用”。
应用标签会替换素材现有标签，并移除“未整理”标签。
```

---

## 05 回收站教程

### 跳转路径

```text
/trash?tutorial=trash
```

### 页面用途

```text
用于查看已移入回收站的素材，并进行恢复或永久删除。
```

### 适用权限

至少满足以下之一：

```text
asset.restore_own
asset.restore_all
asset.permanent_delete
```

### 教程步骤

```text
1. 回收站列表：查看已删除或待删除素材。
2. 选择素材：选择要恢复或永久删除的素材。
3. 恢复素材：将素材恢复到素材库。
4. 永久删除说明：永久删除不可恢复。
5. 权限限制：不是所有人都能恢复或永久删除。
```

### data-tour

```text
data-tour="trash-list"
data-tour="trash-select-item"
data-tour="trash-restore-button"
data-tour="trash-permanent-delete-button"
data-tour="trash-permission-hint"
```

### 引导文案重点

```text
移入回收站不等于永久删除。
永久删除需要更高权限，且不可恢复。
```

---

## 06 标签管理教程

### 跳转路径

```text
/tags?tutorial=tags
```

### 页面用途

```text
用于维护标签分类、标签状态和标签替换。
```

### 适用权限

至少满足：

```text
tag.view
```

不同操作还需要：

```text
tag.create
tag.edit
tag.disable
tag.merge
tag.delete
```

### 教程步骤

```text
1. 标签分类：查看不同一级分类下的标签。
2. 新增标签：创建新标签。
3. 编辑 / 停用标签：维护标签名称和状态。
4. 标签替换：把 A 标签替换成 B 标签。
5. 删除标签限制：被素材使用的标签不能随意删除。
```

### data-tour

```text
data-tour="tags-category-list"
data-tour="tags-create-button"
data-tour="tags-edit-button"
data-tour="tags-disable-button"
data-tour="tags-replace-button"
data-tour="tags-delete-button"
data-tour="tags-status-filter"
```

### 引导文案重点

```text
标签分类来自系统标签管理，不要在前端写死。
标签替换是把 A 标签替换成 B 标签，不是创建新标签。
标签替换与未整理页“应用标签”不是同一个功能。
```

---

## 07 标签审核教程

### 跳转路径

```text
/tag-requests?tutorial=tag_requests
```

### 页面用途

```text
用于审核普通成员申请的新标签。
```

### 适用权限

```text
tag.review
```

### 教程步骤

```text
1. 待审核标签列表：查看成员申请的新标签。
2. 查看申请理由：判断是否需要新增标签。
3. 通过申请：新标签进入可用状态。
4. 拒绝申请：不合适或重复的标签可拒绝。
5. 重复标签处理说明：已有类似标签时，不要重复创建。
```

### data-tour

```text
data-tour="tag-requests-list"
data-tour="tag-request-reason"
data-tour="tag-request-approve-button"
data-tour="tag-request-reject-button"
data-tour="tag-request-duplicate-hint"
```

---

## 08 操作日志教程

### 跳转路径

```text
/operations?tutorial=operation_logs
```

### 页面用途

```text
用于追踪谁在什么时候做了什么操作。
```

### 适用权限

```text
log.view
```

### 教程步骤

```text
1. 日志列表：查看系统操作记录。
2. 用户筛选：按操作者筛选日志。
3. 操作类型筛选：按上传、删除、标签、集合等操作筛选。
4. 时间筛选：按时间范围查找。
5. 操作详情：查看具体操作内容。
```

### data-tour

```text
data-tour="operation-logs-list"
data-tour="operation-logs-user-filter"
data-tour="operation-logs-type-filter"
data-tour="operation-logs-time-filter"
data-tour="operation-logs-detail"
```

---

## 五、跳转规则

| 教程 | 跳转路径 |
|---|---|
| 素材库 | `/materials?tutorial=materials` |
| 素材集合 | `/collections?tutorial=collections` |
| 上传队列 | `/materials/upload?tutorial=upload` |
| 未整理 | `/unorganized?tutorial=unorganized` |
| 回收站 | `/trash?tutorial=trash` |
| 标签管理 | `/tags?tutorial=tags` |
| 标签审核 | `/tag-requests?tutorial=tag_requests` |
| 操作日志 | `/operations?tutorial=operation_logs` |

页面读取 URL 参数：

```text
tutorial=xxx
```

如果匹配当前页面教程，则自动启动交互式引导。

---

## 六、技术选型

### 1. 推荐使用 react-joyride

```text
react-joyride
```

原因：

```text
1. 适合 React / Next.js
2. 支持步骤控制
3. 支持高亮元素
4. 支持下一步 / 上一步 / 完成
5. 可以和用户学习进度结合
```

### 2. 备选方案

```text
driver.js
```

如果 react-joyride 在某些页面不稳定，可改用 driver.js。

---

## 七、前端文件结构建议

```text
frontend/
├── app/
│   ├── tutorials/
│   │   └── page.tsx
│   ├── materials/
│   │   └── page.tsx
│   ├── collections/
│   │   └── page.tsx
│   ├── materials/upload/
│   │   └── page.tsx
│   ├── unorganized/
│   │   └── page.tsx
│   ├── trash/
│   │   └── page.tsx
│   ├── tags/
│   │   └── page.tsx
│   ├── tag-requests/
│   │   └── page.tsx
│   └── operations/
│       └── page.tsx
├── components/
│   └── tutorials/
│       ├── TutorialCenterCard.tsx
│       ├── TutorialJoyride.tsx
│       └── TutorialProgressBadge.tsx
├── lib/
│   └── tutorials.ts
└── hooks/
    └── useTutorial.ts
```

---

## 八、教程配置文件

新增：

```text
frontend/lib/tutorials.ts
```

### 类型定义

```ts
export type TutorialKey =
  | "materials"
  | "collections"
  | "upload"
  | "unorganized"
  | "trash"
  | "tags"
  | "tag_requests"
  | "operation_logs";

export type TutorialStep = {
  target: string;
  title: string;
  content: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
};

export type TutorialConfig = {
  key: TutorialKey;
  title: string;
  description: string;
  path: string;
  estimatedMinutes: number;
  requiredPermissions: string[];
  steps: TutorialStep[];
};
```

### 示例配置

```ts
export const tutorials: TutorialConfig[] = [
  {
    key: "materials",
    title: "素材库",
    description: "学习如何查找、筛选、查看、下载和收录素材。",
    path: "/materials?tutorial=materials",
    estimatedMinutes: 5,
    requiredPermissions: ["asset.view"],
    steps: [
      {
        target: '[data-tour="materials-quick-view"]',
        title: "快捷视图",
        content: "这里可以快速切换全部素材、我的上传、最近下载。",
        placement: "right"
      },
      {
        target: '[data-tour="materials-search-input"]',
        title: "搜索素材",
        content: "可以按标题、原始文件名、描述和标签搜索素材。",
        placement: "bottom"
      },
      {
        target: '[data-tour="materials-tag-filter"]',
        title: "标签筛选",
        content: "点击标签后会加入当前筛选条件，用于精准查找素材。",
        placement: "right"
      },
      {
        target: '[data-tour="materials-match-mode"]',
        title: "查询方式",
        content: "同时满足表示必须包含所有已选标签；满足任一表示包含任意一个标签即可。",
        placement: "bottom"
      },
      {
        target: '[data-tour="materials-list"]',
        title: "素材列表",
        content: "这里显示符合条件的素材。点击素材后，右侧会显示详情。",
        placement: "top"
      },
      {
        target: '[data-tour="materials-detail-drawer"]',
        title: "详情抽屉",
        content: "这里可以查看素材信息、下载素材或收录到集合。",
        placement: "left"
      }
    ]
  }
];
```

说明：所有 8 个教程都按这个结构配置。

---

## 九、学习进度数据表

新增表：

```text
user_tutorial_progress
```

### SQL 建议

```sql
CREATE TABLE user_tutorial_progress (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    tutorial_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started',
    last_step INTEGER DEFAULT 0,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, tutorial_key)
);
```

### status 枚举

```text
not_started
in_progress
completed
```

说明：

```text
not_started：未开始
in_progress：学习中
completed：已完成
```

---

## 十、后端 API 设计

新增 API 前缀：

```text
/tutorials
```

---

### 1. 获取当前用户教程进度

```text
GET /tutorials/progress
```

权限：

```text
登录用户即可
```

返回：

```json
[
  {
    "tutorial_key": "materials",
    "status": "completed",
    "last_step": 6,
    "completed_at": "2026-05-05T10:00:00"
  },
  {
    "tutorial_key": "upload",
    "status": "not_started",
    "last_step": 0,
    "completed_at": null
  }
]
```

---

### 2. 开始教程

```text
POST /tutorials/progress/start
```

请求：

```json
{
  "tutorial_key": "materials"
}
```

后端逻辑：

```text
如果记录不存在，创建记录：
status = in_progress
last_step = 0

如果记录已存在且不是 completed：
更新为 in_progress
```

---

### 3. 更新步骤

```text
POST /tutorials/progress/update
```

请求：

```json
{
  "tutorial_key": "materials",
  "last_step": 3
}
```

后端逻辑：

```text
更新 last_step
status = in_progress
updated_at = now()
```

---

### 4. 完成教程

```text
POST /tutorials/progress/complete
```

请求：

```json
{
  "tutorial_key": "materials"
}
```

后端逻辑：

```text
status = completed
completed_at = now()
last_step = 最后一步
```

---

### 5. 重置教程，可选

```text
POST /tutorials/progress/reset
```

请求：

```json
{
  "tutorial_key": "materials"
}
```

后端逻辑：

```text
status = not_started
last_step = 0
completed_at = null
```

---

## 十一、权限控制

教程中心根据当前用户权限判断是否可学习。

| 教程 | 所需权限 |
|---|---|
| 素材库 | `asset.view` |
| 素材集合 | `collection.view` |
| 上传队列 | `asset.upload` |
| 未整理 | `asset.view` + `asset.edit_own` 或 `asset.edit_all` |
| 回收站 | `asset.restore_own` 或 `asset.restore_all` 或 `asset.permanent_delete` |
| 标签管理 | `tag.view` |
| 标签审核 | `tag.review` |
| 操作日志 | `log.view` |

无权限时：

```text
卡片显示：需要权限
开始学习按钮禁用
```

---

## 十二、页面 data-tour 标记规则

所有需要被引导高亮的元素必须加：

```tsx
data-tour="xxx"
```

不要使用：

```text
CSS class
按钮文字
DOM 层级
```

原因：页面样式改了，教程仍然稳定。

示例：

```tsx
<input
  data-tour="materials-search-input"
  placeholder="搜索素材"
/>
```

按钮示例：

```tsx
<button data-tour="materials-download-button">
  下载
</button>
```

---

## 十三、交互式引导组件

新增组件：

```text
frontend/components/tutorials/TutorialJoyride.tsx
```

功能：

```text
读取当前 tutorial key
读取 tutorials.ts 中对应 steps
启动 react-joyride
处理 next / back / close / complete
调用后端 API 更新进度
```

关键逻辑：

```text
1. 页面读取 URL 参数 tutorial
2. 找到对应配置
3. 调用 /tutorials/progress/start
4. 启动 Joyride
5. 每一步调用 /tutorials/progress/update
6. 完成时调用 /tutorials/progress/complete
7. 退出时保留 in_progress
```

---

## 十四、移动端处理

手机端交互式浮层容易遮挡页面。

V1 规则：

```text
桌面端：使用 react-joyride 交互式引导
手机端：显示简化图文步骤
```

判断方式：

```ts
const isMobile = window.innerWidth < 768;
```

手机端显示：

```text
步骤 1：……
步骤 2：……
步骤 3：……
```

并提供：

```text
标记为已完成
```

---

## 十五、教程学习是否记录操作日志

教程学习本身可以不写入全局操作日志。

建议只保存到：

```text
user_tutorial_progress
```

如果后续要记录，则只记录：

```text
tutorial.start
tutorial.complete
```

不建议每一步都写 `operation_logs`，会污染审计日志。

---

## 十六、与现有项目的关系

### 1. 与前端页面关系

现有页面包括：

```text
/materials
/collections
/materials/upload
/unorganized
/trash
/tags
/tag-requests
/operations
```

教程模块不替代这些页面，只在这些页面上叠加操作引导。

---

### 2. 与权限系统关系

权限判断必须基于当前项目已有权限点：

```text
asset.*
collection.*
tag.*
log.view
```

不要在教程模块里写死角色名。

---

### 3. 与素材集合关系

素材集合已经是已落地模块：

```text
/collections API
asset_collection_groups
asset_collections
asset_collection_items
project_collection_permissions
```

教程应明确：

```text
集合是素材引用关系，不是真实文件夹。
```

---

### 4. 与下载选路关系

素材库教程只讲用户层面的“下载按钮”和“下载方式”。不要向普通用户解释：

```text
LAN
WAN
ECS fallback
download-route
ticket
nas_jobs
```

这些属于管理员或技术文档，不属于普通教程。

---

## 十七、Cursor 开发指令

```text
请开发“教程中心 + 交互式操作引导”模块。

目标：
让用户进入 /tutorials 后，可以看到 8 个按页面划分的教程入口。
点击某个教程后，自动跳转到对应业务页面，并使用高亮式步骤引导教用户操作。

一、新增教程中心页面

新增页面：

/tutorials

显示 8 个教程卡片：

01 素材库
02 素材集合
03 上传队列
04 未整理
05 回收站
06 标签管理
07 标签审核
08 操作日志

每个卡片显示：
- 页面名称
- 页面用途
- 预计用时
- 适用角色
- 学习状态：未开始 / 学习中 / 已完成 / 需要权限
- 开始学习按钮
- 已完成后显示重新学习按钮

二、跳转规则

素材库 → /materials?tutorial=materials
素材集合 → /collections?tutorial=collections
上传队列 → /materials/upload?tutorial=upload
未整理 → /unorganized?tutorial=unorganized
回收站 → /trash?tutorial=trash
标签管理 → /tags?tutorial=tags
标签审核 → /tag-requests?tutorial=tag_requests
操作日志 → /operations?tutorial=operation_logs

三、交互式引导

使用 react-joyride 实现高亮式操作引导。

要求：
1. 每个页面读取 URL 参数 tutorial。
2. 如果 tutorial 匹配当前页面，就自动启动教程。
3. 每一步高亮一个页面元素。
4. 每一步显示标题、说明、上一步、下一步、完成、退出。
5. 完成后记录学习状态。
6. 中途退出保留学习中状态。

四、教程配置

新增：

frontend/lib/tutorials.ts

集中配置 8 个教程：
- key
- title
- description
- path
- estimatedMinutes
- requiredPermissions
- steps

steps 包含：
- target
- title
- content
- placement

五、页面元素定位

所有被高亮的元素必须使用 data-tour 属性。
不要使用 CSS class 作为定位。

六、学习进度表

新增表：

user_tutorial_progress

字段：
- id
- user_id
- tutorial_key
- status
- last_step
- completed_at
- created_at
- updated_at

status：
- not_started
- in_progress
- completed

唯一约束：
user_id + tutorial_key

七、后端 API

新增接口：

GET /tutorials/progress
POST /tutorials/progress/start
POST /tutorials/progress/update
POST /tutorials/progress/complete
POST /tutorials/progress/reset

八、权限控制

教程中心根据用户权限控制教程卡片状态。

无权限时：
- 显示“需要权限”
- 开始学习按钮禁用
- 不直接隐藏卡片

权限对应：
- 素材库：asset.view
- 素材集合：collection.view
- 上传队列：asset.upload
- 未整理：asset.view + asset.edit_own 或 asset.edit_all
- 回收站：asset.restore_own 或 asset.restore_all 或 asset.permanent_delete
- 标签管理：tag.view
- 标签审核：tag.review
- 操作日志：log.view

九、移动端处理

桌面端使用 react-joyride。
手机端如果浮层体验不好，则显示简化图文步骤和“标记完成”按钮。

十、验收标准

1. /tutorials 页面能显示 8 个教程卡片。
2. 每个卡片能显示当前用户学习状态。
3. 无权限教程显示“需要权限”，不能开始。
4. 点击开始学习能跳转到对应页面。
5. 对应页面能根据 tutorial 参数自动启动引导。
6. 引导能正确高亮 data-tour 元素。
7. 用户点击完成后，状态变为已完成。
8. 用户中途退出后，状态为学习中。
9. 刷新页面后，学习进度仍然保留。
10. 手机端不出现严重遮挡页面的问题。
```

---

## 十八、验收标准

### 1. 教程中心验收

```text
/tutorials 页面存在
显示 8 个教程入口
每个入口有状态
可按权限启用 / 禁用
```

---

### 2. 页面跳转验收

```text
点击素材库教程 → 跳转 /materials?tutorial=materials
点击素材集合教程 → 跳转 /collections?tutorial=collections
点击上传队列教程 → 跳转 /materials/upload?tutorial=upload
点击操作日志教程 → 跳转 /operations?tutorial=operation_logs
```

---

### 3. 高亮引导验收

```text
页面加载后自动启动教程
能高亮对应 data-tour 元素
能下一步 / 上一步 / 退出 / 完成
```

---

### 4. 学习进度验收

```text
开始教程后状态变为学习中
完成教程后状态变为已完成
刷新页面后状态不丢失
重新学习可以再次启动教程
```

---

### 5. 权限验收

```text
无 asset.upload 权限的用户不能开始上传队列教程
无 tag.review 权限的用户不能开始标签审核教程
无 log.view 权限的用户不能开始操作日志教程
```

---

## 十九、最终定版

教程模块 V1 定义为：

```text
按页面划分的系统操作引导中心。
```

8 个教程入口：

```text
素材库
素材集合
上传队列
未整理
回收站
标签管理
标签审核
操作日志
```

核心能力：

```text
点击教程
→ 跳转页面
→ 高亮引导
→ 记录进度
→ 支持重新学习
```

第一版先把页面型教程做好。后续可扩展任务型教程，例如：

```text
如何完成一次视频素材整理
如何从上传到收录集合
如何维护标签体系
如何处理无效素材
```
