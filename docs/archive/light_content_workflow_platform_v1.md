# 轻量内容流程编排台 V1  
## Next.js + React Flow + FastAPI + PostgreSQL + Qdrant + NAS/MinIO 技术栈文档

版本：V1.0  
定位：团队内部使用的轻量画布式内容生产流程编排系统  
核心原则：标准节点、轻量流程、人工审核、资产沉淀、持续迭代

---

# 一、系统结论

这套系统不是要做一个通用版 n8n，也不是要做复杂自动化平台。

它的本质是：

> 以 React Flow 做前端画布，用 FastAPI 承载标准能力模块和轻量工作流执行器，用 PostgreSQL 保存结构化数据，用 Qdrant 做语义检索，用 NAS/MinIO 存储素材文件，最终让团队成员在标准流程内自编、运行和复用内容生产工作流。

第一版目标不是“功能全”，而是跑通：

```text
对标内容导入
→ 内容解析
→ 风格 Agent 资产化
→ 选题生成
→ 文案生成
→ 人工审核
→ 任务派发
```

---

# 二、系统边界

## 1. 本系统要做什么

- 画布式组合内容生产流程
- 标准节点能力模块调用
- 对标内容解析与风格蒸馏
- Style Agent 资产化
- 选题、标题、脚本自动生成
- 人工审核节点
- 任务派发
- 素材资产检索
- 工作流模板复用
- 节点运行日志保存

## 2. 第一版不做什么

第一版不做：

- 复杂分支
- 循环节点
- 定时任务
- 多人实时协作
- 自动发布
- 插件市场
- 复杂权限树
- 通用自动化能力
- 全自动视频生成
- 重型企业级后台

原因：

> 当前核心不是炫技，而是降低团队使用门槛，让标准流程真正跑起来。

---

# 三、技术栈选择

## 1. 前端

```text
Next.js
React Flow
Tailwind CSS
shadcn/ui
Zustand
```

### 作用

| 技术 | 作用 |
|---|---|
| Next.js | 前端应用框架 |
| React Flow | 画布节点、连线、流程编辑 |
| Tailwind CSS | 快速写界面样式 |
| shadcn/ui | 常用 UI 组件 |
| Zustand | 轻量状态管理 |

---

## 2. 后端

```text
FastAPI
Pydantic
SQLAlchemy / SQLModel
Alembic
```

### 作用

| 技术 | 作用 |
|---|---|
| FastAPI | 后端 API 服务 |
| Pydantic | 输入输出 Schema 校验 |
| SQLAlchemy / SQLModel | 数据库 ORM |
| Alembic | 数据库迁移 |

选择 FastAPI 的原因：

> 系统核心能力偏 AI、文本处理、爬虫、向量检索、素材解析，Python 生态比 NestJS 更顺手。

---

## 3. 数据与存储

```text
PostgreSQL
Qdrant
NAS / MinIO
```

### 作用

| 技术 | 作用 |
|---|---|
| PostgreSQL | 保存结构化数据、工作流、节点、日志、Agent 卡片 |
| Qdrant | 保存向量，用于语义检索 |
| NAS / MinIO | 保存视频、图片、音频、文档等原始文件 |

---

# 四、系统总体架构

```text
前端画布层
Next.js + React Flow
负责：画节点、连线、配置参数、展示运行状态

↓ API 调用

后端编排层
FastAPI Workflow Runner
负责：读取流程 JSON、拓扑排序、执行节点、保存日志

↓ 调用能力模块

标准能力模块层
Module API
负责：链接导入、内容解析、Agent 调用、文案生成、审核、派发

↓ 读写资产

数据资产层
PostgreSQL + Qdrant + NAS/MinIO
负责：结构化数据、语义检索、素材文件存储
```

---

# 五、核心概念定义

## 1. Workflow Definition

工作流定义。

它是用户在 React Flow 画布上保存下来的流程图。

包含：

```text
节点列表
连线列表
节点参数
节点位置
节点类型
```

它回答的是：

> 这个流程长什么样？

---

## 2. Workflow Run

工作流运行实例。

每点击一次“运行”，就生成一次 Workflow Run。

包含：

```text
本次运行 ID
运行状态
开始时间
结束时间
每个节点的输入
每个节点的输出
错误信息
人工审核状态
```

它回答的是：

> 这次流程跑得怎么样？

---

## 3. Node Definition

节点定义。

它是系统预先定义好的标准能力模块。

例如：

```text
链接导入节点
内容解析节点
风格 Agent 调用节点
文案生成节点
人工审核节点
任务派发节点
```

它回答的是：

> 系统有哪些标准能力？

---

## 4. Node Run

节点运行记录。

每个节点执行一次，就产生一条 Node Run。

包含：

```text
节点 ID
所属 workflow_run_id
输入数据
输出数据
执行状态
错误信息
耗时
```

它回答的是：

> 某个节点具体执行结果是什么？

---

## 5. Style Agent Card

风格智能体资产卡。

它不是单个 Prompt，而是：

```text
样本来源
+ 语言风格画像
+ 结构规则
+ 提示词模板
+ 调用记录
+ 效果反馈
```

它回答的是：

> 这个 Agent 是什么风格、从哪里来、适合什么场景、效果怎么样？

---

# 六、第一版核心数据类型

## 1. ContentSource

原始内容来源。

```json
{
  "id": "source_001",
  "source_type": "video_url",
  "url": "https://example.com/video/123",
  "platform": "douyin",
  "creator_name": "对标博主A",
  "raw_metadata": {}
}
```

---

## 2. ContentAsset

解析后的内容资产。

```json
{
  "id": "asset_001",
  "source_id": "source_001",
  "title": "视频标题",
  "transcript": "字幕或正文内容",
  "summary": "内容摘要",
  "tags": ["理想汽车", "车主吐槽", "停车争议"],
  "platform_metrics": {
    "likes": 12000,
    "comments": 800,
    "shares": 300
  }
}
```

---

## 3. MaterialAsset

素材资产。

```json
{
  "id": "material_001",
  "asset_type": "video",
  "file_path": "/nas/materials/video_001.mp4",
  "thumbnail_path": "/nas/materials/thumb_001.jpg",
  "tags": ["车机", "理想L9", "实拍"],
  "metadata": {}
}
```

---

## 4. StyleAgent

风格 Agent。

```json
{
  "id": "agent_001",
  "name": "理想车主犀利吐槽风格",
  "domain": "新能源汽车",
  "target_user": "理想车主",
  "language_style_profile": {},
  "structure_rules": {},
  "prompt_template": "",
  "version": "v1.0",
  "status": "active"
}
```

---

## 5. Topic

选题。

```json
{
  "id": "topic_001",
  "title": "理想车主到底该不该为乱停车背锅？",
  "angle": "车主群体自省",
  "target_user": "理想车主",
  "content_goal": "引发评论与共鸣",
  "risk_level": "medium"
}
```

---

## 6. Script

脚本。

```json
{
  "id": "script_001",
  "topic_id": "topic_001",
  "title_options": [],
  "hook": "",
  "body": "",
  "ending": "",
  "comment_trigger": ""
}
```

---

## 7. ReviewResult

人工审核结果。

```json
{
  "id": "review_001",
  "status": "approved",
  "reviewer": "陈继昌",
  "comment": "标题可以更犀利，正文通过",
  "approved_payload": {}
}
```

---

## 8. Task

制作任务。

```json
{
  "id": "task_001",
  "title": "制作理想车主停车争议图文",
  "assignee": "火华",
  "script_id": "script_001",
  "status": "todo",
  "deadline": "2026-04-26"
}
```

---

# 七、第一版节点清单

## 1. 链接导入节点

### 用途

把视频链接、文章链接、账号链接导入系统。

### 输入

```json
{
  "url": "string",
  "platform": "douyin | xiaohongshu | bilibili | website",
  "creator_name": "string"
}
```

### 输出

```json
{
  "content_source": "ContentSource"
}
```

---

## 2. 内容解析节点

### 用途

解析标题、正文、字幕、封面、互动数据。

### 输入

```json
{
  "content_source": "ContentSource"
}
```

### 输出

```json
{
  "content_asset": "ContentAsset"
}
```

---

## 3. 素材入库节点

### 用途

把素材文件和元数据写入素材库。

### 输入

```json
{
  "content_asset": "ContentAsset",
  "files": []
}
```

### 输出

```json
{
  "material_assets": ["MaterialAsset"]
}
```

---

## 4. 素材检索节点

### 用途

按关键词、标签、语义描述检索素材。

### 输入

```json
{
  "query": "string",
  "tags": [],
  "top_k": 10
}
```

### 输出

```json
{
  "materials": ["MaterialAsset"]
}
```

---

## 5. 风格拆解节点

### 用途

从对标内容中提取语言风格、结构规则、情绪强度和表达方式。

### 输入

```json
{
  "content_assets": ["ContentAsset"]
}
```

### 输出

```json
{
  "language_style_profile": {},
  "structure_rules": {},
  "style_summary": "string"
}
```

---

## 6. Style Agent 创建节点

### 用途

把风格拆解结果沉淀为可复用 Agent 资产。

### 输入

```json
{
  "agent_name": "string",
  "source_assets": ["ContentAsset"],
  "language_style_profile": {},
  "structure_rules": {},
  "prompt_template": "string"
}
```

### 输出

```json
{
  "style_agent": "StyleAgent"
}
```

---

## 7. Style Agent 调用节点

### 用途

调用已有 Style Agent 生成内容。

### 输入

```json
{
  "style_agent_id": "string",
  "task": "string",
  "input_material": {},
  "tone_intensity": 7
}
```

### 输出

```json
{
  "generated_result": {}
}
```

---

## 8. 选题生成节点

### 用途

基于账号定位、素材、对标内容和 Agent 风格生成候选选题。

### 输入

```json
{
  "account_profile": {},
  "target_user": "string",
  "style_agent": "StyleAgent",
  "content_assets": ["ContentAsset"],
  "topic_count": 5
}
```

### 输出

```json
{
  "topics": ["Topic"]
}
```

---

## 9. 文案生成节点

### 用途

生成标题、口播稿、图文文案、评论区引导话术。

### 输入

```json
{
  "topic": "Topic",
  "style_agent": "StyleAgent",
  "materials": ["MaterialAsset"]
}
```

### 输出

```json
{
  "script": "Script"
}
```

---

## 10. 人工审核节点

### 用途

暂停流程，等待人确认、修改或驳回。

### 输入

```json
{
  "review_payload": {}
}
```

### 输出

```json
{
  "review_result": "ReviewResult"
}
```

---

## 11. 任务派发节点

### 用途

生成制作任务，并推送到飞书或内部任务表。

### 输入

```json
{
  "script": "Script",
  "assignee": "string",
  "deadline": "string"
}
```

### 输出

```json
{
  "task": "Task"
}
```

---

# 八、Style Agent Card V1

## 1. 基础信息

```yaml
agent_id:
agent_name:
source_creator:
platform:
domain:
target_user:
content_type:
version:
status:
created_by:
created_at:
```

---

## 2. 样本来源

```yaml
source_samples:
  - sample_id:
    url:
    title:
    transcript:
    performance_data:
      likes:
      comments:
      shares:
      views:
    tags:
```

---

## 3. 语言风格画像

```yaml
language_style_profile:
  signature_phrases:
    high_frequency:
      - 
    medium_frequency:
      - 
    low_frequency:
      - 

  tone:
    base_tone:
    tone_intensity:
    emotion_range:
    forbidden_tone:

  sentence_patterns:
    preferred:
      - 
    forbidden:
      - 

  hook_language_patterns:
    - 

  transition_patterns:
    - 

  judgment_style:
    default_strength:
    mild_examples:
      - 
    balanced_examples:
      - 
    sharp_examples:
      - 

  emotion_words:
    frustration:
      - 
    defense:
      - 
    resonance:
      - 
    satire:
      - 

  forbidden_words:
    - 

  rhetorical_questions:
    - 

  familiarity_style:
    - 

  comment_triggers:
    - 

  forbidden_styles:
    - 官方公关腔
    - 过度科普腔
    - 客服解释腔
    - 学术分析腔
    - 过度营销
    - 人身攻击
    - 绝对化攻击

  similarity_evaluation:
    phrase_similarity_weight: 15
    sentence_pattern_weight: 25
    tone_similarity_weight: 20
    rhythm_similarity_weight: 20
    viewpoint_expression_weight: 20
```

---

## 4. 内容结构规则

```yaml
structure_rules:
  hook_patterns:
    - 
  body_patterns:
    - 
  ending_patterns:
    - 
  conflict_patterns:
    - 
  reversal_patterns:
    - 
```

---

## 5. 适用边界

```yaml
use_boundary:
  suitable_for:
    - 
  not_suitable_for:
    - 
  risk_notes:
    - 
```

---

## 6. 调用模板

```text
你现在调用的是【{{agent_name}}】。

你的语言风格画像：
{{language_style_profile}}

你的内容结构规则：
{{structure_rules}}

你的使用边界：
{{use_boundary}}

本次任务：
{{task}}

输入材料：
{{input_material}}

输出要求：
1. 保持语言风格一致
2. 保持结构规则一致
3. 不要使用禁用表达
4. 输出标题、正文、结尾评论钩子
5. 给出风格相似度自评分
```

---

## 7. 效果反馈

```yaml
performance:
  total_uses:
  avg_views:
  avg_completion_rate:
  avg_comment_rate:
  best_cases:
    - 
  weak_cases:
    - 
```

---

## 8. 版本记录

```yaml
version_history:
  - version:
    change:
    date:
    result:
```

---

# 九、数据库表设计 V1

## 1. workflows

保存工作流定义。

```sql
CREATE TABLE workflows (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    definition JSONB NOT NULL,
    created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    status TEXT DEFAULT 'active'
);
```

---

## 2. workflow_runs

保存工作流运行实例。

```sql
CREATE TABLE workflow_runs (
    id UUID PRIMARY KEY,
    workflow_id UUID REFERENCES workflows(id),
    status TEXT NOT NULL,
    input_payload JSONB,
    output_payload JSONB,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    finished_at TIMESTAMP
);
```

---

## 3. node_runs

保存节点运行记录。

```sql
CREATE TABLE node_runs (
    id UUID PRIMARY KEY,
    workflow_run_id UUID REFERENCES workflow_runs(id),
    node_id TEXT NOT NULL,
    node_type TEXT NOT NULL,
    status TEXT NOT NULL,
    input_payload JSONB,
    output_payload JSONB,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    finished_at TIMESTAMP
);
```

---

## 4. content_sources

```sql
CREATE TABLE content_sources (
    id UUID PRIMARY KEY,
    source_type TEXT NOT NULL,
    platform TEXT,
    url TEXT,
    creator_name TEXT,
    raw_metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 5. content_assets

```sql
CREATE TABLE content_assets (
    id UUID PRIMARY KEY,
    source_id UUID REFERENCES content_sources(id),
    title TEXT,
    transcript TEXT,
    summary TEXT,
    tags TEXT[],
    platform_metrics JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 6. material_assets

```sql
CREATE TABLE material_assets (
    id UUID PRIMARY KEY,
    asset_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    thumbnail_path TEXT,
    tags TEXT[],
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 7. style_agents

```sql
CREATE TABLE style_agents (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    target_user TEXT,
    language_style_profile JSONB,
    structure_rules JSONB,
    prompt_template TEXT,
    source_asset_ids UUID[],
    version TEXT DEFAULT 'v1.0',
    status TEXT DEFAULT 'active',
    performance JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 8. agent_runs

```sql
CREATE TABLE agent_runs (
    id UUID PRIMARY KEY,
    style_agent_id UUID REFERENCES style_agents(id),
    task TEXT,
    input_payload JSONB,
    output_payload JSONB,
    similarity_score INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 9. topics

```sql
CREATE TABLE topics (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    angle TEXT,
    target_user TEXT,
    content_goal TEXT,
    risk_level TEXT,
    source_payload JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 10. scripts

```sql
CREATE TABLE scripts (
    id UUID PRIMARY KEY,
    topic_id UUID REFERENCES topics(id),
    title_options JSONB,
    hook TEXT,
    body TEXT,
    ending TEXT,
    comment_trigger TEXT,
    full_script TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 11. review_results

```sql
CREATE TABLE review_results (
    id UUID PRIMARY KEY,
    status TEXT NOT NULL,
    reviewer TEXT,
    comment TEXT,
    approved_payload JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 12. tasks

```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    assignee TEXT,
    script_id UUID REFERENCES scripts(id),
    status TEXT DEFAULT 'todo',
    deadline TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

# 十、后端目录结构

```text
backend/
  app/
    main.py

    core/
      config.py
      database.py
      logging.py

    models/
      workflow.py
      content.py
      material.py
      style_agent.py
      topic.py
      script.py
      task.py

    schemas/
      workflow.py
      node.py
      content.py
      style_agent.py
      topic.py
      script.py

    api/
      routes/
        workflows.py
        workflow_runs.py
        nodes.py
        content_sources.py
        content_assets.py
        materials.py
        style_agents.py
        topics.py
        scripts.py
        tasks.py

    services/
      workflow_runner.py
      node_registry.py
      topological_sort.py
      qdrant_service.py
      storage_service.py
      llm_service.py

    modules/
      link_import/
        module.py
      content_parser/
        module.py
      style_analyzer/
        module.py
      style_agent_creator/
        module.py
      style_agent_runner/
        module.py
      topic_generator/
        module.py
      script_generator/
        module.py
      manual_review/
        module.py
      task_dispatcher/
        module.py

    tests/
      test_workflow_runner.py
      test_node_registry.py
      test_topological_sort.py
```

---

# 十一、前端目录结构

```text
frontend/
  app/
    page.tsx
    workflows/
      page.tsx
      [id]/
        page.tsx
    agents/
      page.tsx
      [id]/
        page.tsx

  components/
    workflow/
      WorkflowCanvas.tsx
      NodePalette.tsx
      NodeConfigPanel.tsx
      RunPanel.tsx
      CustomNode.tsx

    agents/
      StyleAgentCard.tsx
      LanguageStyleProfileView.tsx

    common/
      AppLayout.tsx
      DataTable.tsx

  stores/
    workflowStore.ts
    agentStore.ts

  lib/
    api.ts
    workflowSchema.ts
    nodeTypes.ts

  types/
    workflow.ts
    node.ts
    styleAgent.ts
```

---

# 十二、轻量 Workflow Runner 设计

## 1. 执行原则

第一版只支持：

```text
DAG 有向无环图
顺序执行
失败中断
人工节点暂停
手动继续
运行日志保存
```

不支持：

```text
循环
复杂条件分支
定时任务
多流程嵌套
```

---

## 2. 执行流程

```text
接收 workflow_id 和 input_payload
→ 读取 workflow definition
→ 校验节点和连线
→ 拓扑排序
→ 创建 workflow_run
→ 依次执行节点
→ 保存 node_run
→ 遇到 manual_review 节点则暂停
→ 全部完成后保存 output_payload
```

---

## 3. 节点执行状态

```text
pending
running
success
failed
waiting_review
skipped
```

---

## 4. 工作流执行状态

```text
pending
running
success
failed
waiting_review
cancelled
```

---

# 十三、Cursor Rules

以下规则建议放入项目目录：

```text
.cursor/rules/
  00-project-overview.mdc
  01-architecture.mdc
  02-frontend-next-reactflow.mdc
  03-backend-fastapi.mdc
  04-workflow-runner.mdc
  05-style-agent.mdc
  06-database.mdc
  07-testing.mdc
  08-code-style.mdc
```

---

## 00-project-overview.mdc

```md
---
description: Project overview and product boundaries
globs: ["**/*"]
alwaysApply: true
---

# Project Overview

This project is a lightweight content workflow orchestration platform.

It is not a general automation platform like n8n.
It is not a complex enterprise workflow system.
It is a team-facing content production canvas.

Core product goal:
- Allow the owner to define standard content production workflows.
- Allow team members to use standard nodes to build and run simple workflows.
- Convert competitor content into reusable Style Agent assets.
- Generate topics, titles, scripts, and production tasks.
- Preserve human review as a first-class workflow node.

First version constraints:
- Support DAG only.
- No loops.
- No complex branching.
- No scheduler.
- No plugin marketplace.
- No real-time multi-user editing.
- No automatic publishing.

Tech stack:
- Frontend: Next.js, React Flow, Tailwind CSS, shadcn/ui, Zustand.
- Backend: FastAPI, Pydantic, PostgreSQL, Qdrant.
- Storage: NAS or MinIO.
```

---

## 01-architecture.mdc

```md
---
description: System architecture rule
globs: ["**/*"]
alwaysApply: true
---

# Architecture Rule

The system must keep these layers separated:

1. Frontend Canvas Layer
   - Next.js + React Flow.
   - Responsible for drawing nodes, edges, parameters, and run status.

2. Workflow Runner Layer
   - FastAPI backend.
   - Responsible for validation, topological sorting, execution, node run logs, and pause/resume.

3. Module API Layer
   - Standard capability modules.
   - Each node maps to one backend module.

4. Data Asset Layer
   - PostgreSQL for structured data.
   - Qdrant for vector search.
   - NAS/MinIO for files.

Never put execution logic inside React Flow components.
React Flow only edits and displays workflow definitions.
Actual execution must happen in backend services.
```

---

## 02-frontend-next-reactflow.mdc

```md
---
description: Frontend and React Flow rules
globs: ["frontend/**/*"]
alwaysApply: true
---

# Frontend Rules

Use Next.js with React Flow.

React Flow responsibilities:
- Render nodes.
- Render edges.
- Allow drag and drop.
- Allow node config editing.
- Save workflow definition JSON.
- Display workflow run status and node run results.

React Flow must not:
- Execute backend modules directly.
- Contain business logic for node execution.
- Perform topological sorting for real execution.
- Decide final workflow status.

Preferred structure:
- WorkflowCanvas.tsx handles React Flow rendering.
- NodePalette.tsx handles available nodes.
- NodeConfigPanel.tsx handles selected node config.
- RunPanel.tsx shows workflow run logs.
- workflowStore.ts stores local canvas state.

Keep node UI simple:
- Node title.
- Node type.
- Short status.
- Input/output badges.
```

---

## 03-backend-fastapi.mdc

```md
---
description: FastAPI backend rules
globs: ["backend/**/*"]
alwaysApply: true
---

# Backend Rules

Use FastAPI as the backend API layer.

Backend responsibilities:
- Store workflow definitions.
- Run workflow instances.
- Execute node modules.
- Validate schemas.
- Save logs.
- Manage Style Agent assets.
- Manage content assets and material assets.

Use Pydantic schemas for all API inputs and outputs.
Use SQLAlchemy or SQLModel for database models.
Do not return unstructured dictionaries when a schema should exist.

API routes should be thin.
Business logic should live in services or modules.

Preferred route groups:
- /workflows
- /workflow-runs
- /nodes
- /content-sources
- /content-assets
- /materials
- /style-agents
- /topics
- /scripts
- /tasks
```

---

## 04-workflow-runner.mdc

```md
---
description: Workflow runner rules
globs: ["backend/app/services/workflow_runner.py", "backend/app/services/topological_sort.py", "backend/app/modules/**/*"]
alwaysApply: true
---

# Workflow Runner Rules

The workflow runner must be lightweight.

Supported:
- Directed acyclic graph only.
- Topological sorting.
- Sequential execution.
- Failure stops the workflow.
- Manual review pauses the workflow.
- Resume after manual review.
- Save every node input and output.

Not supported in V1:
- Loops.
- Complex branches.
- Schedulers.
- Parallel execution.
- Nested workflows.
- Plugin marketplace.

Every node module must implement a standard interface:

```python
class BaseNodeModule:
    node_type: str
    input_schema: type
    output_schema: type

    async def run(self, input_data: BaseModel, context: WorkflowContext) -> BaseModel:
        ...
```

Every node run must be recorded with:
- workflow_run_id
- node_id
- node_type
- input_payload
- output_payload
- status
- error_message
- started_at
- finished_at
```

---

## 05-style-agent.mdc

```md
---
description: Style Agent asset rules
globs: ["backend/app/models/style_agent.py", "backend/app/schemas/style_agent.py", "backend/app/modules/style_*", "frontend/components/agents/**/*"]
alwaysApply: true
---

# Style Agent Rules

A Style Agent is not just a prompt.

A Style Agent must include:
- source samples
- language style profile
- structure rules
- prompt template
- use boundary
- version
- status
- performance feedback
- run history

Language Style Profile is a core asset.

It should include:
- signature phrases
- tone intensity
- sentence patterns
- hook language patterns
- transition patterns
- judgment style
- emotion words
- forbidden words
- rhetorical questions
- familiarity style
- comment triggers
- forbidden styles
- similarity evaluation rules

Never overwrite old Style Agent versions silently.
Create a new version when changing core style rules.

Every Style Agent run should record:
- input payload
- output payload
- similarity score
- selected style parameters
- created content
```

---

## 06-database.mdc

```md
---
description: Database rules
globs: ["backend/app/models/**/*", "backend/alembic/**/*"]
alwaysApply: true
---

# Database Rules

Use PostgreSQL as the main structured database.

Use JSONB for flexible fields such as:
- workflow definition
- node input/output payloads
- language style profile
- structure rules
- performance data
- raw metadata

Use UUID primary keys.

Core tables:
- workflows
- workflow_runs
- node_runs
- content_sources
- content_assets
- material_assets
- style_agents
- agent_runs
- topics
- scripts
- review_results
- tasks

Do not store large files in PostgreSQL.
Store files in NAS/MinIO and keep only paths and metadata in PostgreSQL.
```

---

## 07-testing.mdc

```md
---
description: Testing rules
globs: ["backend/tests/**/*", "frontend/**/*"]
alwaysApply: true
---

# Testing Rules

Backend tests must cover:
- topological sort
- invalid graph detection
- node registry
- workflow runner success path
- workflow runner failure path
- manual review pause/resume
- Style Agent creation
- Style Agent run logging

Frontend tests should at least cover:
- workflow JSON generation
- node config panel behavior
- API request wrappers

Every new backend node module should include:
- input validation test
- output validation test
- basic run test
```

---

## 08-code-style.mdc

```md
---
description: Code style rules
globs: ["**/*"]
alwaysApply: true
---

# Code Style

General:
- Keep modules small.
- Keep names explicit.
- Prefer clarity over cleverness.
- Do not create over-engineered abstractions in V1.

Backend:
- Use typed Python.
- Use Pydantic schemas.
- Put business logic in services/modules.
- Keep API routes thin.
- Add docstrings for workflow runner and node modules.

Frontend:
- Use TypeScript.
- Keep React components focused.
- Avoid mixing API calls with presentation logic.
- Use stores for shared workflow state.
- Use clear types for Workflow, Node, Edge, NodeRun, StyleAgent.

Product principle:
- Simple beats powerful in V1.
- Standard templates beat unlimited freedom.
- Human review is required before production task creation.
```

---

# 十四、Cursor Skill 调用模板

这里的 Skill 不是 Cursor 官方固定功能名，而是项目内可复用的 AI 编程提示词。建议放在：

```text
.cursor/skills/
  architect.md
  frontend-reactflow.md
  backend-fastapi.md
  workflow-runner.md
  style-agent.md
  database.md
  test-writer.md
  code-reviewer.md
```

使用方式：

> 在 Cursor 对话里直接粘贴对应 Skill 内容，或者让 Cursor 读取该文件后执行。

---

## 1. architect.md

```md
# Skill: System Architect

你是本项目的系统架构师。

项目定位：
轻量内容流程编排台，不是通用自动化平台。

技术栈：
Next.js + React Flow + FastAPI + PostgreSQL + Qdrant + NAS/MinIO。

你需要遵守：
1. React Flow 只负责画布和流程定义，不负责真实执行。
2. Workflow Runner 在 FastAPI 后端执行。
3. 第一版只支持 DAG，不支持循环、复杂分支、定时任务。
4. 每个节点必须是标准能力模块。
5. Style Agent 必须资产化，而不是单个 prompt。

当我提出新功能时，请输出：
- 是否符合 V1 边界
- 需要改哪些层
- 涉及哪些数据表
- 涉及哪些 API
- 是否会增加团队使用难度
- 推荐实现顺序
```

---

## 2. frontend-reactflow.md

```md
# Skill: Frontend React Flow Developer

你负责实现前端画布。

要求：
1. 使用 Next.js + React Flow + TypeScript。
2. 实现节点面板、画布、配置面板、运行面板。
3. 工作流保存为 workflow definition JSON。
4. 不在前端执行节点真实逻辑。
5. 通过 API 调用后端创建 workflow、运行 workflow、读取 run logs。

第一版页面包括：
- 工作流列表页
- 工作流编辑页
- Agent 资产列表页
- Agent 详情页

请优先实现：
1. WorkflowCanvas
2. NodePalette
3. NodeConfigPanel
4. RunPanel
5. workflowStore
6. api client

每次输出代码前，先说明要改哪些文件。
```

---

## 3. backend-fastapi.md

```md
# Skill: Backend FastAPI Developer

你负责实现 FastAPI 后端。

要求：
1. 使用 Pydantic 定义输入输出 Schema。
2. 使用 PostgreSQL 保存结构化数据。
3. API routes 保持轻薄，业务逻辑放 services/modules。
4. 工作流执行逻辑放 workflow_runner.py。
5. 节点模块放 backend/app/modules/ 下。

第一版 API：
- POST /workflows
- GET /workflows
- GET /workflows/{id}
- PUT /workflows/{id}
- POST /workflow-runs
- GET /workflow-runs/{id}
- POST /workflow-runs/{id}/resume
- GET /nodes
- POST /style-agents
- GET /style-agents
- GET /style-agents/{id}
- POST /style-agents/{id}/run

每次生成代码前，先说明：
- 新增文件
- 修改文件
- 数据结构
- API 行为
```

---

## 4. workflow-runner.md

```md
# Skill: Workflow Runner Engineer

你负责实现轻量工作流执行器。

V1 规则：
1. 只支持 DAG。
2. 使用拓扑排序确定执行顺序。
3. 顺序执行节点。
4. 节点失败则 workflow failed。
5. 遇到 manual_review 节点则 workflow waiting_review。
6. 人工审核通过后可以 resume。
7. 每个节点输入输出都要保存 node_run。

请实现：
- WorkflowRunner
- NodeRegistry
- topological_sort
- BaseNodeModule
- WorkflowContext
- manual review pause/resume

不要实现：
- 循环
- 定时任务
- 复杂条件分支
- 并行执行
- 插件市场

请优先写测试。
```

---

## 5. style-agent.md

```md
# Skill: Style Agent Engineer

你负责实现 Style Agent 资产库。

Style Agent 不是 prompt，而是生产能力资产。

必须包含：
- source samples
- language style profile
- structure rules
- prompt template
- use boundary
- version
- status
- performance feedback
- run history

Language Style Profile 必须包含：
- signature phrases
- tone intensity
- sentence patterns
- hook language patterns
- transition patterns
- judgment style
- emotion words
- forbidden words
- rhetorical questions
- familiarity style
- comment triggers
- forbidden styles
- similarity evaluation

请实现：
- StyleAgent model
- StyleAgent schema
- create style agent API
- get/list style agent API
- run style agent API
- agent_runs logging
- version field

不要把 Style Agent 简化成单个 prompt 字段。
```

---

## 6. database.md

```md
# Skill: Database Engineer

你负责数据库设计和迁移。

数据库：
PostgreSQL。

规则：
1. 使用 UUID 主键。
2. 灵活字段使用 JSONB。
3. 大文件不进数据库，只保存 file_path 和 metadata。
4. workflow definition 存 JSONB。
5. node run input/output 存 JSONB。
6. language style profile 存 JSONB。

核心表：
- workflows
- workflow_runs
- node_runs
- content_sources
- content_assets
- material_assets
- style_agents
- agent_runs
- topics
- scripts
- review_results
- tasks

请输出：
- SQLAlchemy / SQLModel models
- Alembic migration
- 必要索引
- 数据关系说明
```

---

## 7. test-writer.md

```md
# Skill: Test Writer

你负责为项目写测试。

优先覆盖：
1. topological sort 正常排序
2. graph 有循环时拒绝运行
3. node registry 能找到节点模块
4. workflow runner 成功执行
5. workflow runner 节点失败
6. manual review 暂停
7. manual review resume
8. Style Agent 创建
9. Style Agent 调用记录保存

要求：
- 后端使用 pytest。
- 测试要小而清晰。
- 不依赖真实 LLM API。
- 使用 mock 替代外部服务。
```

---

## 8. code-reviewer.md

```md
# Skill: Code Reviewer

你负责审查代码。

审查标准：
1. 是否违反系统边界。
2. React Flow 是否承担了不该承担的执行逻辑。
3. 后端 routes 是否过重。
4. Workflow Runner 是否保持 V1 简洁。
5. 节点模块输入输出是否标准化。
6. Style Agent 是否被错误简化成 prompt。
7. 数据库是否把大文件直接存入 PostgreSQL。
8. 是否过度工程化。
9. 是否缺少测试。
10. 是否影响团队成员上手难度。

请输出：
- 必须修改
- 建议修改
- 可以暂缓
- 风险说明
```

---

# 十五、开发阶段计划

## 阶段 1：项目骨架

目标：

```text
跑起前端
跑起后端
连上 PostgreSQL
保存一个空工作流
```

产出：

```text
Next.js 项目
FastAPI 项目
PostgreSQL 连接
workflows 表
基础 API
```

---

## 阶段 2：React Flow 画布

目标：

```text
可以拖节点、连线、配置参数、保存 workflow JSON
```

产出：

```text
WorkflowCanvas
NodePalette
NodeConfigPanel
workflowStore
保存/读取 workflow API
```

---

## 阶段 3：轻量 Workflow Runner

目标：

```text
可以读取 workflow JSON 并顺序执行 mock 节点
```

产出：

```text
NodeRegistry
BaseNodeModule
topological_sort
workflow_runner
workflow_runs
node_runs
```

---

## 阶段 4：真实节点 MVP

目标：

```text
跑通 3 个真实节点
```

优先节点：

```text
链接导入
内容解析
文案生成
```

---

## 阶段 5：Style Agent 资产库

目标：

```text
可以创建、查看、调用 Style Agent
```

产出：

```text
StyleAgent model
Language Style Profile
Prompt Template
agent_runs
Style Agent 调用节点
```

---

## 阶段 6：人工审核节点

目标：

```text
流程可以暂停、人工确认、继续运行
```

产出：

```text
manual_review module
waiting_review 状态
resume API
审核结果保存
```

---

## 阶段 7：任务派发节点

目标：

```text
审核通过后生成制作任务
```

产出：

```text
tasks 表
task dispatcher module
任务列表页
可选飞书通知
```

---

# 十六、第一版标准工作流模板

## 1. 对标博主蒸馏流程

```text
链接导入
→ 内容解析
→ 风格拆解
→ Style Agent 创建
```

用途：

> 把对标博主内容沉淀为可复用 Agent 资产。

---

## 2. 选题生成流程

```text
素材检索
→ Style Agent 调用
→ 选题生成
→ 人工审核
```

用途：

> 生成每天可拍选题。

---

## 3. 文案生成流程

```text
选题输入
→ Style Agent 调用
→ 文案生成
→ 人工审核
→ 任务派发
```

用途：

> 把选题变成制作任务。

---

## 4. 对标内容到任务流程

```text
链接导入
→ 内容解析
→ 风格拆解
→ Style Agent 调用
→ 选题生成
→ 文案生成
→ 人工审核
→ 任务派发
```

用途：

> 从对标内容直接转化为团队制作任务。

---

# 十七、给 Cursor 的第一条总指令

可以直接复制给 Cursor：

```md
我要开发一个轻量内容流程编排台，不是通用自动化平台。

技术栈：
Next.js + React Flow + FastAPI + PostgreSQL + Qdrant + NAS/MinIO。

产品定位：
由负责人定义标准流程骨架，团队成员通过画布调用标准节点，完成内容生产流程。

第一版只支持：
1. React Flow 画布拖拽节点、连线、配置参数、保存流程。
2. FastAPI 后端执行 DAG 工作流。
3. 节点顺序执行。
4. 节点失败则中断。
5. 人工审核节点可以暂停和继续。
6. 保存 workflow definition、workflow run、node run。
7. Style Agent 资产库，包含语言风格画像、结构规则、提示词模板、调用记录和版本。

第一版不支持：
1. 循环。
2. 复杂条件分支。
3. 定时任务。
4. 插件市场。
5. 多人实时协作。
6. 自动发布。

请先根据这些要求生成项目目录结构、数据模型、API 路由清单和第一阶段开发任务。
不要直接一次性写完整系统。
```

---

# 十八、验收标准

## 1. 产品验收

第一版完成后，应该能做到：

```text
创建工作流
→ 拖入标准节点
→ 连线
→ 配置参数
→ 保存模板
→ 运行流程
→ 查看每个节点输出
→ 人工审核
→ 生成任务
```

---

## 2. 技术验收

必须满足：

```text
React Flow 不执行真实业务逻辑
Workflow Runner 在后端
节点输入输出有 Schema
每次运行有日志
每个 Agent 可复用
每个 Agent 有版本
素材文件不进数据库
```

---

## 3. 团队使用验收

团员只需要会：

```text
选择模板
填参数
点击运行
查看结果
人工修改
确认任务
```

如果团员需要理解太多技术概念，说明系统设计失败。

---

# 十九、核心原则复盘

```text
轻量优先
标准优先
模板优先
人工审核优先
资产沉淀优先
流程复用优先
```

最重要的一句话：

> 这套系统的价值不是让每个人无限自由，而是在你定义的标准范围内，让团队成员可以低成本搭建、运行和复用内容生产流程。
