# 标签管理模块开发手册 V1

版本：V1.0  
适用系统：轻量内容流程平台  
模块名称：标签管理  
开发优先级：高  
目标：提供灵活、可维护的标签管理功能，支持标签分类、标签创建、编辑、合并、停用、删除、申请与审核等功能。

---

# 一、结论

标签管理模块是素材管理系统的核心功能之一。

开发顺序：
```text
1. 创建标签分类（固定 5 类）
2. 标签创建与编辑功能
3. 标签申请与审核
4. 标签合并与删除
5. 操作日志记录
```

---

# 二、标签管理模块功能

## 1. 标签分类

### 1.1 固定标签分类

V1 固定 5 个标签分类：

```text
1. 内容对象
2. 素材形态
3. 用途
4. 场景
5. 内容主题
```

### 1.2 标签分类操作

- **查看标签分类**：展示所有已创建的标签分类。
- **新增标签分类**：允许管理员新增分类。
- **修改标签分类名称**：允许管理员修改分类名称。
- **删除标签分类**：只能在分类为空的情况下删除。

## 2. 标签管理

### 2.1 标签字段

每个标签的字段：

```text
1. 标签名（唯一，不可重复）
2. 所属分类（必选项）
3. 同义词（可选，多个）
4. 描述（可选）
5. 状态（启用/停用）
6. 创建人（系统自动记录）
7. 创建时间（系统自动记录）
8. 修改时间（系统自动记录）
```

### 2.2 标签操作

- **新增标签**：根据选择的标签分类新增标签。
- **编辑标签**：修改标签名、描述、同义词等。
- **停用标签**：标签停用后，不能再用于素材，但仍保留历史数据。
- **删除标签**：只能删除未使用的标签，删除操作需要谨慎。
- **查看标签**：支持按分类查看标签。
- **标签状态**：标签可以处于启用/停用状态。

## 3. 标签申请与审核

### 3.1 标签申请流程

普通用户申请标签时，需要填写申请理由，并由管理员审核。

- **申请标签**：普通成员可以申请新标签，并填写申请理由。
- **标签审核**：管理员审核标签申请，决定是否批准创建标签。

### 3.2 标签审核操作

- **审核通过**：标签正式创建并启用。
- **审核拒绝**：标签申请失败，附加拒绝原因。
- **合并标签**：如果两个标签相似，管理员可以合并标签。

---

# 三、标签数据库设计

## 1. 标签分类表

```sql
CREATE TABLE tag_categories (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 字段说明：

- **id**：标签分类的唯一标识符。
- **name**：标签分类的名称。
- **created_at**：分类创建时间。
- **updated_at**：分类最后更新时间。

## 2. 标签表

```sql
CREATE TABLE tags (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    category_id UUID REFERENCES tag_categories(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 字段说明：

- **id**：标签的唯一标识符。
- **name**：标签名称。
- **description**：标签描述。
- **status**：标签状态（active、disabled）。
- **category_id**：标签所属分类。
- **created_by**：标签创建者（关联用户表）。
- **created_at**：标签创建时间。
- **updated_at**：标签最后更新时间。

## 3. 标签同义词表

```sql
CREATE TABLE tag_aliases (
    id UUID PRIMARY KEY,
    tag_id UUID REFERENCES tags(id),
    alias TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 字段说明：

- **id**：同义词的唯一标识符。
- **tag_id**：关联的标签 ID。
- **alias**：标签的同义词。
- **created_at**：同义词创建时间。

## 4. 标签申请表

```sql
CREATE TABLE tag_requests (
    id UUID PRIMARY KEY,
    requested_name TEXT NOT NULL,
    category_id UUID REFERENCES tag_categories(id),
    reason TEXT,
    status TEXT DEFAULT 'pending',
    requested_by UUID REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    review_comment TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    reviewed_at TIMESTAMP
);
```

### 字段说明：

- **id**：标签申请的唯一标识符。
- **requested_name**：用户申请的标签名称。
- **category_id**：标签申请的分类。
- **reason**：标签申请的理由。
- **status**：申请状态（pending、approved、rejected）。
- **requested_by**：申请者用户 ID。
- **reviewed_by**：审核者用户 ID。
- **review_comment**：审核评论。
- **created_at**：申请时间。
- **reviewed_at**：审核时间。

---

# 四、API 设计

## 1. 获取标签分类

```text
GET /tags/categories
```

### 返回：

```json
[
    {
        "id": "uuid",
        "name": "内容对象",
        "created_at": "2026-04-28T12:00:00",
        "updated_at": "2026-04-28T12:00:00"
    },
    ...
]
```

---

## 2. 获取标签列表

```text
GET /tags
```

### 查询条件：

```text
category_id（标签分类）
status（标签状态）
```

### 返回：

```json
[
    {
        "id": "uuid",
        "name": "理想L9",
        "description": "理想L9车型",
        "status": "active",
        "category_id": "uuid",
        "created_by": "uuid",
        "created_at": "2026-04-28T12:00:00",
        "updated_at": "2026-04-28T12:00:00"
    },
    ...
]
```

---

## 3. 创建标签

```text
POST /tags
```

### 请求参数：

```json
{
    "name": "理想L9",
    "description": "理想L9车型",
    "category_id": "uuid",
    "status": "active"
}
```

### 返回：

```json
{
    "id": "uuid",
    "name": "理想L9",
    "status": "active"
}
```

---

## 4. 编辑标签

```text
PATCH /tags/{id}
```

### 请求参数：

```json
{
    "name": "理想L9",
    "description": "理想L9车型更新",
    "status": "disabled"
}
```

### 返回：

```json
{
    "id": "uuid",
    "name": "理想L9",
    "status": "disabled"
}
```

---

## 5. 停用标签

```text
POST /tags/{id}/disable
```

### 返回：

```json
{
    "status": "disabled"
}
```

---

## 6. 合并标签

```text
POST /tags/{id}/merge
```

### 请求参数：

```json
{
    "target_tag_id": "uuid"
}
```

### 返回：

```json
{
    "status": "merged"
}
```

---

## 7. 删除标签

```text
DELETE /tags/{id}
```

### 返回：

```json
{
    "status": "deleted"
}
```

---

## 8. 标签申请与审核

### 申请标签

```text
POST /tags/requests
```

### 返回：

```json
{
    "id": "uuid",
    "requested_name": "理想车机",
    "category_id": "uuid",
    "reason": "需要为理想车机添加标签",
    "status": "pending"
}
```

### 审核标签申请

```text
POST /tags/requests/{id}/approve
POST /tags/requests/{id}/reject
```

### 返回：

```json
{
    "status": "approved"
}
```

---

# 五、标签操作日志

### 记录操作：

- 创建标签
- 编辑标签
- 停用标签
- 删除标签
- 合并标签
- 标签申请与审核

每次操作都写入操作日志表。

```sql
CREATE TABLE tag_operation_logs (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    operation_type TEXT,
    tag_id UUID REFERENCES tags(id),
    tag_name TEXT,
    target_id UUID,
    target_name TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

# 六、给 Cursor 的开发指令

```text
请开发标签管理模块，支持标签分类、标签创建、编辑、停用、删除、同义词管理、标签申请与审核、标签合并等功能。

1. 标签分类固定 5 类：
   - 内容对象
   - 素材形态
   - 用途
   - 场景
   - 内容主题

2. 标签管理页面：
   - 查看标签分类
   - 新增标签分类
   - 编辑标签分类
   - 删除标签分类（分类下无标签时）

3. 标签操作：
   - 创建标签
   - 编辑标签
   - 停用标签
   - 删除标签
   - 合并标签
   - 标签申请与审核（普通成员申请，素材管理员审核）
   - 标签同义词管理（关联 tag_aliases）

4. 每次操作记录操作日志：
   - 创建标签
   - 编辑标签
   - 删除标签
   - 停用标签
   - 合并标签
   - 标签申请与审核

5. 标签数据库表：
   - tag_categories：标签分类
   - tags：标签表
   - tag_aliases：标签同义词
   - tag_requests：标签申请表
   - tag_operation_logs：标签操作日志表

6. 权限控制：
   - 普通成员不能创建正式标签，只能申请。
   - 素材管理员可以创建、编辑、停用、删除标签。
   - 标签管理页面必须有审核申请功能。

完成后将标签管理模块与其他模块联动，确保标签管理功能符合需求。
```

---

# 七、开发验收标准

1. 标签分类和标签操作：
   - 创建、编辑、停用、删除标签
   - 标签分类显示正确
   - 标签名唯一性验证
   - 删除标签时相关素材引用不受影响

2. 标签申请与审核：
   - 普通成员可申请标签
   - 素材管理员可审核标签申请
   - 通过审核后标签正式启用

3. 标签合并：
   - 合并标签时原标签素材自动转移到新标签
   - 标签合并后，旧标签转为“合并状态”并保留历史记录

4. 操作日志：
   - 标签创建、编辑、删除、合并操作记录日志
   - 每个操作都有日志，包含操作人、操作类型、目标标签等

---

# 八、最终开发顺序

```text
第一阶段：标签分类与标签管理
第二阶段：标签申请与审核
第三阶段：标签合并与删除
第四阶段：标签操作日志记录
```

