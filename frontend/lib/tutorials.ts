export type TutorialKey =
  | "materials"
  | "collections"
  | "upload"
  | "unorganized"
  | "trash"
  | "tags"
  | "tag_requests"
  | "operation_logs";

export type TutorialRoutePrefix = "/collections" | "/materials";

export type TutorialStep = {
  target: string;
  title: string;
  content: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto" | "center";
  /** 仅在该路径下展示本步（用于跨页同一 tutorial key） */
  routePrefix?: TutorialRoutePrefix;
  /** 为 true 时隐藏「下一步」，须点击高亮元素一次才继续 */
  advanceOnTargetClick?: boolean;
  /** 为 true 时隐藏「下一步」，须收到收录成功事件后才继续（见素材库收录逻辑） */
  waitForCollectSuccess?: boolean;
  /** 点击「下一步」后整页跳转并结束引导，进入下一阶段的 URL */
  nextRoute?: string;
};

export type TutorialConfig = {
  key: TutorialKey;
  title: string;
  purpose: string;
  path: string;
  estimatedMinutes: number;
  /** 展示用短说明，与权限点一致 */
  applicableRolesHint: string;
  canLearn: (permissions: string[]) => boolean;
  steps: TutorialStep[];
};

function hasAny(p: string[], need: string[]) {
  return need.some((x) => p.includes(x));
}

export const tutorials: TutorialConfig[] = [
  {
    key: "materials",
    title: "素材库",
    purpose: "用于查找、筛选、查看、下载和收录素材。",
    path: "/materials?tutorial=materials",
    estimatedMinutes: 5,
    applicableRolesHint: "需 asset.view",
    canLearn: (p) => p.includes("asset.view"),
    steps: [
      {
        target: '[data-tour="materials-quick-view"]',
        title: "快捷视图",
        content: "在此可快速切换全部素材、我的上传、最近下载等视图入口。",
        placement: "right",
      },
      {
        target: '[data-tour="materials-search-input"]',
        title: "搜索框",
        content: "可按标题、原始文件名、描述、标签等关键词搜索素材。框内输入「/」且后面不写内容时，列出最近用于「查询素材」的标签；「/」后输入文字则在全部活跃标签里按名称匹配，点选后加入筛选。",
        placement: "bottom",
      },
      {
        target: '[data-tour="materials-tag-filter"]',
        title: "标签筛选",
        content: "点击标签加入当前筛选条件，用于组合查找。",
        placement: "right",
      },
      {
        target: '[data-tour="materials-match-mode"]',
        title: "查询方式",
        content: "「并且 / AND」表示素材须包含所有已选标签；「或者 / OR」表示包含任意一个已选标签即可。",
        placement: "bottom",
      },
      {
        target: '[data-tour="materials-view-switch"]',
        title: "列表与视图",
        content: "当前为卡片网格展示素材；分页在列表下方。",
        placement: "top",
      },
      {
        target: '[data-tour="materials-list"]',
        title: "素材列表",
        content: "符合条件的素材在此列出。点击卡片可切换右侧预览；勾选框用于批量操作。",
        placement: "top",
      },
      {
        target: '[data-tour="materials-detail-drawer"]',
        title: "预览与详情",
        content: "在此查看预览与文件信息，可使用「下载」获取素材，或通过「收录到集合」整理到集合。",
        placement: "left",
      },
    ],
  },
  {
    key: "collections",
    title: "素材集合",
    purpose: "分组与集合管理；从素材库收录；集合内预览、拖移与复制引用。",
    path: "/collections?tutorial=collections",
    estimatedMinutes: 12,
    applicableRolesHint: "需 collection.view；第2步在素材库需 asset.view",
    canLearn: (p) => p.includes("collection.view"),
    steps: [
      {
        target: '[data-tour="collections-tab-personal"]',
        title: "第一步 · 进入我的集合",
        content: "个人整理入口在「我的集合」。请点击该按钮切换（本步须点击高亮处才继续）。",
        placement: "bottom",
        routePrefix: "/collections",
        advanceOnTargetClick: true,
      },
      {
        target: '[data-tour="collections-new-group-form"]',
        title: "第一步 · 新建分组",
        content:
          "高亮区域包含名称输入框与「新建分组」按钮：请先输入名称，再点蓝色「新建分组」提交（仅点击提交按钮会进入下一步，避免遮罩挡住输入框）。",
        placement: "right",
        routePrefix: "/collections",
        advanceOnTargetClick: true,
      },
      {
        target: '[data-tour="collections-group-list"]',
        title: "第一步 · 选中具体分组",
        content: "新建集合前须点选一个具体分组（不要停留在「全部」）。请点击列表中的目标分组名称。",
        placement: "right",
        routePrefix: "/collections",
        advanceOnTargetClick: true,
      },
      {
        target: '[data-tour="collections-new-collection-form"]',
        title: "第一步 · 新建集合",
        content:
          "高亮区域包含名称输入与「新建集合」：选中具体分组后填写名称，再点「新建集合」；仅点击提交按钮进入下一步。",
        placement: "right",
        routePrefix: "/collections",
        advanceOnTargetClick: true,
      },
      {
        target: '[data-tour="collections-collection-list"]',
        title: "第一步 · 打开集合",
        content: "在左侧「集合」列表中点击刚创建的集合，中间与右侧会加载集合信息与素材区。",
        placement: "right",
        routePrefix: "/collections",
        advanceOnTargetClick: true,
      },
      {
        target: '[data-tour="collections-collection-meta-form"]',
        title: "第一步 · 集合信息可做什么",
        content:
          "可修改名称、描述、所属分组；点「保存修改」生效。「归档集合」将集合移入归档视图；「删除集合（软删）」仅删除集合记录，不删素材库文件。",
        placement: "left",
        routePrefix: "/collections",
      },
      {
        target: '[data-tour="collections-info-mode-switch"]',
        title: "第一步 · 切换到分组信息",
        content: "查看或维护分组属性时，请点击「切换到分组信息」（须点击该按钮才继续）。",
        placement: "bottom",
        routePrefix: "/collections",
        advanceOnTargetClick: true,
      },
      {
        target: '[data-tour="collections-group-meta-form"]',
        title: "第一步 · 分组维护",
        content:
          "可修改分组名称并保存。分组下仍有集合时不可归档/删除；无集合时可「归档分组」或「删除分组（软删）」。完成后点击「下一步」前往素材库收录。",
        placement: "left",
        routePrefix: "/collections",
      },
      {
        target: '[data-tour="collections-step-goto-materials"]',
        title: "第二步 · 前往素材库",
        content: "将打开素材库页面：勾选素材后使用「收录到我的集合」写入目标集合。请点击浮层「下一步」跳转。",
        placement: "bottom",
        routePrefix: "/collections",
        nextRoute: "/materials?tutorial=collections",
      },
      {
        target: '[data-tour="materials-list"]',
        title: "第二步 · 勾选素材",
        content: "在列表中勾选至少一条「可用」素材（可勾选第一个）。勾选后右侧会出现预览与操作按钮。",
        placement: "top",
        routePrefix: "/materials",
      },
      {
        target: '[data-tour="materials-collect-button"]',
        title: "第二步 · 打开收录",
        content: "点击「收录到我的集合」，在弹窗中选择已有分组与集合，可填备注。请点击该按钮打开弹窗（须点击才继续）。",
        placement: "left",
        routePrefix: "/materials",
        advanceOnTargetClick: true,
      },
      {
        target: '[data-tour="materials-collect-modal"]',
        title: "第二步 · 选择目标并收录",
        content:
          "在「选择分组」「选择集合」中选中目标；若列表为空请先在集合页建好集合。点击「收录到所选集合（批量）」提交。须至少一条新收录或已存在跳过（already_exists）才算成功，成功后会自动进入下一步。",
        placement: "right",
        routePrefix: "/materials",
        waitForCollectSuccess: true,
      },
      {
        target: '[data-tour="materials-step-goto-collections"]',
        title: "第三步 · 回到集合页",
        content: "收录成功后返回素材集合，继续学习集合内拖移与预览。请点击浮层「下一步」跳转。",
        placement: "bottom",
        routePrefix: "/materials",
        nextRoute: "/collections?tutorial=collections",
      },
      {
        target: '[data-tour="collections-group-list"]',
        title: "第三步 · 选中分组与集合",
        content: "在左侧先点选分组，再在「集合」列表中点击要操作的集合。",
        placement: "right",
        routePrefix: "/collections",
        advanceOnTargetClick: true,
      },
      {
        target: '[data-tour="collections-collection-list"]',
        title: "第三步 · 打开目标集合",
        content: "请点击要管理的集合名称，进入集合内素材列表。",
        placement: "right",
        routePrefix: "/collections",
        advanceOnTargetClick: true,
      },
      {
        target: '[data-tour="collections-items-list"]',
        title: "第三步 · 勾选素材",
        content: "在集合内素材网格中勾选至少一条（可勾选第一条），右侧会显示预览与文件信息。",
        placement: "top",
        routePrefix: "/collections",
      },
      {
        target: '[data-tour="collections-detail-drawer"]',
        title: "第三步 · 预览与文件信息",
        content: "右侧可预览主文件、填写并保存备注、下载主文件或从集合移除引用（不删库内素材）。",
        placement: "left",
        routePrefix: "/collections",
      },
      {
        target: '[data-tour="collections-drag-hint"]',
        title: "第三步 · 拖移与复制引用",
        content:
          "勾选后拖动卡片到左侧其它「活跃且同类型」的集合上：普通拖动为移动引用；按住 Ctrl（Mac 为 ⌘）再拖为复制引用，源集合保留。仅处理当前列表页条目。",
        placement: "top",
        routePrefix: "/collections",
      },
    ],
  },
  {
    key: "upload",
    title: "上传队列",
    purpose: "用于选择文件、设置标题和标签，并上传入库。",
    path: "/materials/upload?tutorial=upload",
    estimatedMinutes: 5,
    applicableRolesHint: "需 asset.upload",
    canLearn: (p) => p.includes("asset.upload"),
    steps: [
      {
        target: '[data-tour="upload-file-picker"]',
        title: "选择文件",
        content: "从本机选择待上传文件并加入队列。",
        placement: "bottom",
      },
      {
        target: '[data-tour="upload-queue-list"]',
        title: "上传队列",
        content: "查看待上传、上传中、已完成与失败项；可逐条点选处理。",
        placement: "right",
      },
      {
        target: '[data-tour="upload-current-file-panel"]',
        title: "入库标题与描述",
        content: "在左侧选中文件后，于此修改入库标题（默认取自文件名）与描述。",
        placement: "bottom",
      },
      {
        target: '[data-tour="upload-tag-panel"]',
        title: "标签选择",
        content: "未选择标签的素材将进入未整理；请按规范选择标签。",
        placement: "left",
      },
      {
        target: '[data-tour="upload-start-button"]',
        title: "开始上传",
        content: "开始上传并入库；大文件可能走分片或文件机直传路径。",
        placement: "bottom",
      },
      {
        target: '[data-tour="upload-status"]',
        title: "上传与入库状态",
        content: "关注上传进度与入库状态；缩略图由 NAS Worker 异步生成，非即时完成。",
        placement: "top",
      },
      {
        target: '[data-tour="upload-retry-button"]',
        title: "失败重试",
        content: "失败项在修复网络或配置后可重试上传。",
        placement: "top",
      },
    ],
  },
  {
    key: "unorganized",
    title: "未整理",
    purpose: "用于处理带「未整理」标签或无标签的素材。",
    path: "/unorganized?tutorial=unorganized",
    estimatedMinutes: 5,
    applicableRolesHint: "需 asset.view 且 asset.edit_own 或 asset.edit_all",
    canLearn: (p) => p.includes("asset.view") && hasAny(p, ["asset.edit_own", "asset.edit_all"]),
    steps: [
      {
        target: '[data-tour="unorganized-material-list"]',
        title: "未整理列表",
        content: "列出带「未整理」标签或无标签的素材，与已整理分区相对。",
        placement: "top",
      },
      {
        target: '[data-tour="unorganized-batch-select"]',
        title: "批量选择",
        content: "勾选多行可批量应用标签或移入回收站。",
        placement: "right",
      },
      {
        target: '[data-tour="unorganized-tag-panel"]',
        title: "标签面板",
        content: "为素材选择合适的分类标签；标签分类来自系统配置。",
        placement: "left",
      },
      {
        target: '[data-tour="unorganized-apply-tags-button"]',
        title: "应用标签",
        content: "将写入所选标签并替换原有标签，同时移除「未整理」标签；不会仅靠改状态为「可用」完成整理。",
        placement: "left",
      },
      {
        target: '[data-tour="unorganized-trash-button"]',
        title: "移入回收站",
        content: "无效素材可移入回收站，与素材库删除语义一致。",
        placement: "left",
      },
      {
        target: '[data-tour="unorganized-selected-count"]',
        title: "已选数量",
        content: "留意当前勾选数量，避免误操作批量范围。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "trash",
    title: "回收站",
    purpose: "用于查看已移入回收站的素材，并进行恢复或永久删除。",
    path: "/trash?tutorial=trash",
    estimatedMinutes: 4,
    applicableRolesHint: "需恢复或永久删除相关权限之一",
    canLearn: (p) => hasAny(p, ["asset.restore_own", "asset.restore_all", "asset.permanent_delete"]),
    steps: [
      {
        target: '[data-tour="trash-list"]',
        title: "回收站列表",
        content: "查看已删除或待彻底删除的素材条目。",
        placement: "top",
      },
      {
        target: '[data-tour="trash-select-item"]',
        title: "选择素材",
        content: "使用勾选框或全选当前页，便于批量彻底删除（需权限）。",
        placement: "right",
      },
      {
        target: '[data-tour="trash-restore-button"]',
        title: "恢复素材",
        content: "将素材恢复到可用状态；普通成员通常仅能恢复自己上传的素材。",
        placement: "left",
      },
      {
        target: '[data-tour="trash-permanent-delete-button"]',
        title: "永久删除",
        content: "永久删除不可恢复；需更高权限并二次确认。",
        placement: "left",
      },
      {
        target: '[data-tour="trash-permission-hint"]',
        title: "权限说明",
        content: "移入回收站不等于永久删除；能否恢复或彻底删除取决于账号权限。",
        placement: "top",
      },
    ],
  },
  {
    key: "tags",
    title: "标签管理",
    purpose: "用于维护标签分类、标签状态和标签替换。",
    path: "/tags?tutorial=tags",
    estimatedMinutes: 6,
    applicableRolesHint: "查看需 tag.view；创建/停用/合并/删除需对应权限点",
    canLearn: (p) => p.includes("tag.view"),
    steps: [
      {
        target: '[data-tour="tags-category-list"]',
        title: "标签分类",
        content: "按分类浏览与排序标签；一级分类应与标签管理配置一致。",
        placement: "bottom",
      },
      {
        target: '[data-tour="tags-create-button"]',
        title: "新增标签",
        content: "有权限时可创建标签；无创建权限的成员为申请流程。",
        placement: "bottom",
      },
      {
        target: '[data-tour="tags-edit-button"]',
        title: "行内维护",
        content: "在列表「操作」列可进行启用、停用、删除等维护（依权限显示）。",
        placement: "bottom",
      },
      {
        target: '[data-tour="tags-disable-button"]',
        title: "停用标签",
        content: "停用后标签不再参与新业务选用，可按策略恢复或进入删除流程。",
        placement: "left",
      },
      {
        target: '[data-tour="tags-replace-button"]',
        title: "标签替换",
        content: "将标签 A 合并替换为标签 B（替换成），与未整理页的「应用标签」不是同一功能。",
        placement: "bottom",
      },
      {
        target: '[data-tour="tags-delete-button"]',
        title: "删除限制",
        content: "被素材使用的标签不可随意删除；需先解除引用或走替换。",
        placement: "top",
      },
      {
        target: '[data-tour="tags-status-filter"]',
        title: "状态筛选",
        content: "按启用、停用、申请中等状态筛选列表。",
        placement: "bottom",
      },
    ],
  },
  {
    key: "tag_requests",
    title: "标签审核",
    purpose: "用于审核普通成员申请的新标签。",
    path: "/tag-requests?tutorial=tag_requests",
    estimatedMinutes: 4,
    applicableRolesHint: "需 tag.review",
    canLearn: (p) => p.includes("tag.review"),
    steps: [
      {
        target: '[data-tour="tag-requests-list"]',
        title: "待审核列表",
        content: "列出成员提交的「申请中」标签。",
        placement: "top",
      },
      {
        target: '[data-tour="tag-request-reason"]',
        title: "申请信息",
        content: "结合名称、分类与系统记录判断是否需要新增标签。",
        placement: "right",
      },
      {
        target: '[data-tour="tag-request-approve-button"]',
        title: "通过申请",
        content: "通过后标签进入可用状态，可供素材使用。",
        placement: "left",
      },
      {
        target: '[data-tour="tag-request-reject-button"]',
        title: "拒绝申请",
        content: "不合适或重复的标签可拒绝，避免标签膨胀。",
        placement: "left",
      },
      {
        target: '[data-tour="tag-request-duplicate-hint"]',
        title: "重复处理",
        content: "若已有类似标签，应引导成员使用现有标签而非重复创建。",
        placement: "top",
      },
    ],
  },
  {
    key: "operation_logs",
    title: "操作日志",
    purpose: "用于追踪谁在什么时候做了什么操作。",
    path: "/operations?tutorial=operation_logs",
    estimatedMinutes: 4,
    applicableRolesHint: "需 log.view",
    canLearn: (p) => p.includes("log.view"),
    steps: [
      {
        target: '[data-tour="operation-logs-list"]',
        title: "日志列表",
        content: "表格展示系统操作记录，支持分页浏览。",
        placement: "top",
      },
      {
        target: '[data-tour="operation-logs-user-filter"]',
        title: "操作人筛选",
        content: "按操作者用户名缩小范围。",
        placement: "bottom",
      },
      {
        target: '[data-tour="operation-logs-type-filter"]',
        title: "操作类型与目标类型",
        content: "按操作类型、目标类型筛选上传、删除、标签、集合等相关记录。",
        placement: "bottom",
      },
      {
        target: '[data-tour="operation-logs-time-filter"]',
        title: "时间列",
        content: "每条记录的时间戳便于追溯；可与操作人、类型组合排查。",
        placement: "top",
      },
      {
        target: '[data-tour="operation-logs-detail"]',
        title: "操作详情",
        content: "从目标名称、结果列了解单次操作成败与上下文。",
        placement: "top",
      },
    ],
  },
];

export function getTutorialByKey(key: string | null | undefined): TutorialConfig | undefined {
  if (!key) return undefined;
  return tutorials.find((t) => t.key === key);
}
