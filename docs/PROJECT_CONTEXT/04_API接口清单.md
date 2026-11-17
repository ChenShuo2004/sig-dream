# 04 API 接口清单

> 浏览器经 **`/api-proxy/*`** rewrite 到 **`NEXT_PUBLIC_API_BASE_URL`**（**`frontend/next.config.ts`**）。除注明外：**`Authorization: Bearer <JWT>`**。素材语义接口另带 **`X-Asset-Library: auto|personal_video`**（或 **`?library=`**，缺省 `auto`）。文件机/Worker：**`X-NAS-Client-Token`**。

## 全局

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | `status`、`version` |

## `/libraries`

| 方法 | 路径 |
|------|------|
| GET | `/libraries` |
| GET | `/libraries/{library_code}/taxonomy` |
| POST | `/libraries/{library_code}/taxonomy` |
| PATCH | `/libraries/{library_code}/taxonomy/{node_id}` |
| DELETE | `/libraries/{library_code}/taxonomy/{node_id}` |

## `/auth`

| 方法 | 路径 |
|------|------|
| POST | `/auth/login` |
| GET | `/auth/me` |
| POST | `/auth/change-password` |
| POST | `/auth/logout` |
| DELETE | `/auth/dangerous-delete-simulate` |

## `/workflows`

| 方法 | 路径 |
|------|------|
| POST | `/workflows` |
| GET | `/workflows` |
| GET | `/workflows/{workflow_id}` |
| PUT | `/workflows/{workflow_id}` |

## `/tags`

| 方法 | 路径 |
|------|------|
| GET | `/tags/categories` |
| GET | `/tags/active` |
| GET | `/tags` |
| GET | `/tags/preferences` |
| PUT | `/tags/preferences` |
| POST | `/tags/apply` |
| PATCH | `/tags/{tag_id}/review` |
| POST | `/tags` |
| PATCH | `/tags/{tag_id}/deactivate` |
| POST | `/tags/merge` |
| PATCH | `/tags/{tag_id}/activate` |
| PATCH | `/tags/{tag_id}/trash` |
| DELETE | `/tags/{tag_id}/permanent` |

## `/materials`

| 方法 | 路径 |
|------|------|
| GET | `/materials` |
| POST | `/materials` |
| GET | `/materials/unorganized` |
| PATCH | `/materials/unorganized/batch-tags` |
| POST | `/materials/batch-mark-unorganized` |
| POST | `/materials/unorganized/batch-trash` |
| POST | `/materials/download-client-report` |
| GET | `/materials/{material_id}` |
| PATCH | `/materials/{material_id}` |
| POST | `/materials/{material_id}/collect` |
| GET | `/materials/{material_id}/usages` |
| POST | `/materials/ingest-from-nas` |
| PATCH | `/materials/{material_id}/storage-pool` |
| DELETE | `/materials/{material_id}` |
| POST | `/materials/{material_id}/restore` |
| DELETE | `/materials/{material_id}/permanent` |
| POST | `/materials/{material_id}/files/{file_id}/download-ticket` |
| POST | `/materials/{material_id}/files/{file_id}/download-route` |
| GET | `/materials/{material_id}/files/{file_id}/thumbnail-url` |
| GET | `/materials/{material_id}/files/{file_id}/preview-video-url` |
| POST | `/materials/{material_id}/files/{file_id}/regenerate-derivatives` |
| GET | `/materials/download-ticket/verify` |
| POST | `/materials/download-ticket/report` |
| POST | `/materials/lan-upload-ticket` |
| GET | `/materials/lan-upload-ticket/verify` |
| POST | `/materials/lan-upload-ticket/report` |
| POST | `/materials/{material_id}/files/{file_id}/download-prepare` |
| GET | `/materials/download-prepare/{job_id}` |
| POST | `/materials/download-prepare/{job_id}/upload` |
| GET | `/materials/download-cache/{job_id}` |

## `/collections`

| 方法 | 路径 |
|------|------|
| GET | `/collections/groups` |
| POST | `/collections/groups` |
| PATCH | `/collections/groups/{group_id}` |
| DELETE | `/collections/groups/{group_id}` |
| POST | `/collections/groups/{group_id}/archive` |
| POST | `/collections/groups/{group_id}/restore` |
| GET | `/collections` |
| POST | `/collections` |
| GET | `/collections/{collection_id}` |
| PATCH | `/collections/{collection_id}` |
| POST | `/collections/{collection_id}/archive` |
| POST | `/collections/{collection_id}/restore` |
| DELETE | `/collections/{collection_id}` |
| GET | `/collections/{collection_id}/materials` |
| POST | `/collections/{collection_id}/items` |
| POST | `/collections/{collection_id}/items/batch` |
| PATCH | `/collections/{collection_id}/items/{item_id}` |
| DELETE | `/collections/{collection_id}/items/{item_id}` |
| PATCH | `/collections/{collection_id}/items/reorder` |

## `/uploads`

| 方法 | 路径 |
|------|------|
| POST | `/uploads/init` |
| GET | `/uploads/{upload_session_id}/chunks` |
| POST | `/uploads/{upload_session_id}/chunks/{chunk_index}` |
| POST | `/uploads/{upload_session_id}/complete` |
| GET | `/uploads/dedup` |
| POST | `/uploads/{upload_session_id}/ingest` |

## `/nas-jobs`

| 方法 | 路径 |
|------|------|
| GET | `/nas-jobs/poll` |
| GET | `/nas-jobs/client-status` |
| POST | `/nas-jobs/file-service/heartbeat` |
| GET | `/nas-jobs/file-service-nodes` |
| POST | `/nas-jobs/{job_id}/start` |
| POST | `/nas-jobs/{job_id}/complete` |
| POST | `/nas-jobs/{job_id}/fail` |
| GET | `/nas-jobs/{job_id}/source` |
| GET | `/nas-jobs/{job_id}` |
| GET | `/nas-jobs/sync/deadletters` |
| POST | `/nas-jobs/sync/{sync_operation_id}/action` |
| POST | `/nas-jobs/sync/reconcile` |
| GET | `/nas-jobs/sync/maintenance-status` |
| POST | `/nas-jobs/sync/reconcile-with-maintenance` |
| POST | `/nas-jobs/sync/maintenance-announcement/publish` |
| POST | `/nas-jobs/sync/maintenance-announcement/withdraw` |
| GET | `/nas-jobs/sync/db/export` |
| POST | `/nas-jobs/sync/db/import` |

## `/settings`（超管）

| 方法 | 路径 |
|------|------|
| GET | `/settings/users` |
| POST | `/settings/users` |
| PATCH | `/settings/users/{user_id}` |
| POST | `/settings/users/{user_id}/disable` |
| POST | `/settings/users/{user_id}/enable` |
| DELETE | `/settings/users/{user_id}` |
| POST | `/settings/users/{user_id}/reset-password` |
| PATCH | `/settings/users/{user_id}/roles` |
| GET | `/settings/user-groups` |
| POST | `/settings/user-groups` |
| DELETE | `/settings/user-groups/{group_name}` |
| GET | `/settings/roles` |
| GET | `/settings/roles/{role_id}/permissions` |
| PATCH | `/settings/roles/{role_id}/permissions` |
| GET | `/settings/permissions` |
| GET | `/settings` |
| PATCH | `/settings` |

## `/operation-logs`

| 方法 | 路径 |
|------|------|
| GET | `/operation-logs` |
| GET | `/operation-logs/enums` |
| GET | `/operation-logs/{user_id}` |

## `/feedbacks`

| 方法 | 路径 |
|------|------|
| GET | `/feedbacks` |
| POST | `/feedbacks` |
| GET | `/feedbacks/{feedback_id}` |
| POST | `/feedbacks/{feedback_id}/replies` |
| POST | `/feedbacks/{feedback_id}/react` |

## `/tutorials`

| 方法 | 路径 |
|------|------|
| GET | `/tutorials/progress` |
| POST | `/tutorials/progress/start` |
| POST | `/tutorials/progress/update` |
| POST | `/tutorials/progress/complete` |
| POST | `/tutorials/progress/reset` |
