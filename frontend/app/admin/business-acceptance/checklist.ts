export type ChecklistItem = {
  id: string;
  group: string;
  title: string;
  steps: string[];
  href?: string;
};

export const BUSINESS_ACCEPTANCE_ITEMS: ChecklistItem[] = [
  {
    id: "auth-login",
    group: "认证与账号",
    title: "登录与登出",
    steps: [
      "使用非默认账号密码登录（确认无预填敏感信息）。",
      "登录成功后页面应自动刷新并显示已登录状态（顶栏用户名）。",
      "从受保护页面退出或清除会话后，再访问业务页应跳转登录并带 redirect。",
      "点击退出，确认回到可登录状态。",
    ],
    href: "/login",
  },
  {
    id: "auth-password",
    group: "认证与账号",
    title: "修改密码",
    steps: [
      "登录后通过顶栏「修改密码」进入 /login：页面仅显示修改密码表单（不再与登录表单并排）。",
      "填写原密码（核实身份）与新密码提交，确认成功提示；原密码错误时应有明确提示。",
      "使用新密码可重新登录。",
    ],
    href: "/login",
  },
  {
    id: "home-menu",
    group: "首页",
    title: "首页模块入口",
    steps: [
      "未登录访问首页应可打开；点击各业务卡片在未登录时按中间件跳转登录。",
      "登录后首页各板块入口可进入对应页面（不含工作流/任务/接口测试三项验收时跳过）。",
    ],
    href: "/",
  },
  {
    id: "materials-list",
    group: "素材库",
    title: "列表、筛选与快捷视图",
    steps: [
      "打开素材库，确认 NAS/直传状态条：未就绪时应有提示且关键操作被拦截逻辑符合预期。",
      "快捷视图：全部素材 / 我的上传 / 最近下载 切换后列表与「包含标签」区域符合设计。",
      "关键词搜索、标签 AND/OR、查询素材、筛选重置。",
      "向下滚动或「加载更多」分页续载正常。",
    ],
    href: "/materials",
  },
  {
    id: "materials-tags",
    group: "素材库",
    title: "标签面板与收藏、最近",
    steps: [
      "快捷视图与标签分类模式下标签可点击搜索、可收藏/取消收藏。",
      "收藏与最近标签持久化（刷新后仍存在）。",
      "查询后「最近标签」更新逻辑符合说明。",
    ],
    href: "/materials",
  },
  {
    id: "materials-select-actions",
    group: "素材库",
    title: "勾选与下载、回收站",
    steps: [
      "点击卡片切换勾选；勾选 1 个：下载可用，批量下载不可用；勾选 2 个及以上：批量下载可用。",
      "勾选 1 个及以上：移入回收站可用；无勾选时上述按钮不可用。",
      "在 NAS 就绪时执行下载与移入回收站，确认权限（仅本人/管理员等）与结果提示。",
    ],
    href: "/materials",
  },
  {
    id: "upload-queue",
    group: "上传队列",
    title: "分片 / 局域网直传与入库",
    steps: [
      "确认页顶维护公告（若已发布）显示正常。",
      "选择文件加入队列，填写标题描述，选择标签（可选）。",
      "在 LAN 可达时走直传；否则走 ECS 分片上传；观察队列状态直至入库完成或失败重试。",
      "确认与 NAS 作业、重复检测（含 NAS 物理存在）行为一致。",
    ],
    href: "/materials/upload",
  },
  {
    id: "unorganized",
    group: "未整理",
    title: "列表、筛选与批量操作",
    steps: [
      "确认无标签或「未整理」标签的素材均出现；样式与素材库卡片一致。",
      "勾选、应用标签并移除未整理、移入回收站、清空选择；NAS 未就绪时操作被拦截。",
    ],
    href: "/unorganized",
  },
  {
    id: "trash",
    group: "回收站",
    title: "恢复与永久删除",
    steps: [
      "列表加载、加载更多；对素材执行恢复。",
      "超级管理员可见「永久删除」并完成确认流程；非超管不可见或不可用。",
    ],
    href: "/trash",
  },
  {
    id: "tags-manage",
    group: "标签管理",
    title: "标签 CRUD 与合并",
    steps: [
      "创建、停用、启用、合并、删除（回收站）等流程按角色权限执行。",
      "NAS 未就绪时修改类操作被拦截；就绪后成功。",
    ],
    href: "/tags",
  },
  {
    id: "tag-requests",
    group: "标签审核",
    title: "标签申请审核",
    steps: ["成员提交标签申请；管理员审核通过/拒绝（按当前流程设计逐项验证）。"],
    href: "/tag-requests",
  },
  {
    id: "sync-ops-maintenance",
    group: "同步异常",
    title: "维护公告与手动对账",
    steps: [
      "编辑维护公告文案，点击「发布公告」与「撤回公告」，确认各业务页顶横幅与状态一致。",
      "NAS 在线时点击手动对账应二次确认；对账完成后维护模式自动解除。",
      "查看死信列表、重排队、标记已修复、忽略等操作。",
    ],
    href: "/sync-ops",
  },
  {
    id: "sync-ops-db",
    group: "同步异常",
    title: "ECS 数据库导出 / 导入（仅超管）",
    steps: [
      "导出：下载 SQL 文件，检查头部为 PostgreSQL dump、尾部 dump complete。",
      "导入：仅在演练库执行；勾选「导入前自动备份」；确认恢复后服务与数据。",
    ],
    href: "/sync-ops",
  },
  {
    id: "operations-log",
    group: "操作日志",
    title: "查询与筛选",
    steps: [
      "按操作类型、目标类型、操作人、目标名称查询与分页。",
      "执行几条业务操作后在此确认有对应日志记录。",
    ],
    href: "/operations",
  },
  {
    id: "settings",
    group: "系统设置",
    title: "用户、角色与策略（仅超管）",
    steps: [
      "用户增删改、角色权限、安全策略等按《系统设置》文档逐项点验。",
      "确认外网/内网访问上下文限制与权限点一致。",
    ],
    href: "/settings",
  },
];
