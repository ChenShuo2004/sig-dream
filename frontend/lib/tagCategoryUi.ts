/**
 * 标签分类：与数据库 `tags.category`、后端 `GET /tags/categories` 一致。
 * 短名与悬停说明用于素材库侧栏、标签管理等 UI。
 * 品牌 / 车型 / 版本 置顶（与后端 `_TAG_CATEGORIES` 顺序一致）。
 */
export const TAG_CATEGORY_BACKEND_ORDER = [
  "品牌",
  "车型",
  "版本",
  "外观",
  "内饰",
  "功能",
  "场景",
  "情绪",
  "B-roll",
  "系统状态",
] as const;

const SHORT_BY_BACKEND: Record<string, string> = {
  品牌: "品牌",
  车型: "车型",
  版本: "版本",
  外观: "外观",
  内饰: "内饰",
  功能: "功能",
  场景: "场景",
  情绪: "情绪",
  "B-roll": "B-roll",
  系统状态: "系统",
  适用主题: "主题",
};

/** 旧版 DB / 书签 URL 中的分类值 → 当前后端分类（迁移后仅兼容只读场景） */
const LEGACY_BACKEND_CATEGORY: Record<string, string> = {
  内容对象标签: "外观",
  素材形态标签: "内饰",
  用途标签: "功能",
  场景标签: "场景",
  内容主题标签: "情绪",
  状态标签: "B-roll",
};

const TITLE_BY_BACKEND: Record<string, string> = {
  品牌: "主机厂、子品牌、联名等识别维度",
  车型: "车系、具体车型与款型",
  版本: "年款、配置级、改款等版本信息",
  外观: "车外外观、车身可见元素等（《标签说明》·外观）",
  内饰: "座舱、车机、座椅等车内呈现（《标签说明》·内饰）",
  功能: "车机与智能化、用车功能与技巧（《标签说明》·功能）",
  场景: "真实使用场景与环境（《标签说明》·场景）",
  情绪: "成片情绪与共鸣点（《标签说明》·情绪）",
  "B-roll": "补充镜头、过渡与空镜（《标签说明》·B-roll）",
  系统状态: "未整理、可用、待审核等业务与合规状态类标签（《标签说明》·系统状态）",
  适用主题: "个人视频库多选主题面（表达抑制、讨好、委屈等），不是一二级分类、不是检索关键词",
};

export function tagCategoryShort(backendCategory: string): string {
  const normalized = LEGACY_BACKEND_CATEGORY[backendCategory] ?? backendCategory;
  return SHORT_BY_BACKEND[normalized] ?? normalized;
}

export function tagCategoryHoverTitle(backendCategory: string): string {
  const normalized = LEGACY_BACKEND_CATEGORY[backendCategory] ?? backendCategory;
  return TITLE_BY_BACKEND[normalized] ?? "";
}

/** 素材库侧栏「标签分类」展示顺序（品牌/车型/版本置顶；后两项非后端 category） */
export const MATERIAL_TAG_SIDEBAR_CATEGORIES = [
  "品牌",
  "车型",
  "版本",
  "外观",
  "内饰",
  "功能",
  "场景",
  "情绪",
  "B-roll",
  "系统状态",
  "收藏",
  "最近",
] as const;

/** 侧栏项 → 后端 `tags.category`；含旧侧栏键与旧后端值以兼容书签 */
export const MATERIAL_SIDEBAR_TO_BACKEND: Record<string, string> = {
  品牌: "品牌",
  车型: "车型",
  版本: "版本",
  外观: "外观",
  内饰: "内饰",
  功能: "功能",
  场景: "场景",
  情绪: "情绪",
  "B-roll": "B-roll",
  系统状态: "系统状态",
  适用主题: "适用主题",
  对象: "外观",
  形态: "内饰",
  用途: "功能",
  主题: "情绪",
  状态: "系统状态",
  内容对象: "外观",
  素材形态: "内饰",
  内容主题: "情绪",
  内容对象标签: "外观",
  素材形态标签: "内饰",
  用途标签: "功能",
  场景标签: "场景",
  内容主题标签: "情绪",
  状态标签: "B-roll",
};

export const PERSONAL_VIDEO_TAG_CATEGORIES = ["适用主题", "系统状态"] as const;

export function tagCategoriesForLibrary(library: string): readonly string[] {
  if (library === "personal_video") return PERSONAL_VIDEO_TAG_CATEGORIES;
  return TAG_CATEGORY_BACKEND_ORDER;
}

export function materialSidebarCategoriesForLibrary(library: string): readonly string[] {
  if (library === "personal_video") return ["适用主题", "系统状态", "收藏", "最近"];
  return MATERIAL_TAG_SIDEBAR_CATEGORIES;
}

export function tagCategoryHoverTitleForMaterialSidebar(sidebarKey: string): string | undefined {
  const backend = MATERIAL_SIDEBAR_TO_BACKEND[sidebarKey];
  if (!backend) return undefined;
  const t = tagCategoryHoverTitle(backend);
  return t || undefined;
}
