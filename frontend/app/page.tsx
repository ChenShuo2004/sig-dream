import HomeSections from "@/components/home-sections";

const menuSections = [
  {
    title: "画布",
    items: [
      { href: "/canvas", title: "画布", desc: "在画布里生成、连接和重组图片、文字与视频" },
    ],
    gradient: "from-fuchsia-400/30 to-violet-500/10",
  },
  {
    title: "素材中心",
    items: [
      {
        href: "/materials",
        title: "素材库",
        desc: "快捷视图与标签分类筛选；卡片列表、右侧预览与下载（含批量）；收录至集合、加入未整理",
      },
      {
        href: "/collections",
        title: "素材集合",
        desc: "个人/项目下「分组→集合」两级引用整理；集合信息/分组信息、集合内素材与素材库一致的多选与预览",
      },
      {
        href: "/materials/upload",
        title: "上传队列",
        desc: "多文件排队上传；逐文件标签与入库，NAS 同步与「进未整理」状态可见",
      },
      {
        href: "/unorganized",
        title: "未整理",
        desc: "无标签或带「未整理」标签；未整理/已整理双列表、预览与批量替换标签（卡片与素材库统一）",
      },
      { href: "/trash", title: "回收站", desc: "软删素材恢复、按权限永久删除与回收站清理" },
    ],
    gradient: "from-cyan-400/30 to-blue-500/10",
  },
  {
    title: "标签与日志",
    items: [
      { href: "/tags", title: "标签管理", desc: "标签增删改、状态与可见性维护" },
      { href: "/tag-requests", title: "标签审核", desc: "成员申请标签；管理员审核与通过/驳回" },
    ],
    gradient: "from-emerald-400/30 to-teal-500/10",
  },
  {
    title: "工具箱",
    items: [
      {
        href: "/toolbox/video-to-gif",
        title: "视频片段转 GIF",
        desc: "选择本机视频，截取短片段导出 GIF；本机浏览器处理，不上传、不入素材库",
      },
    ],
    gradient: "from-rose-400/30 to-pink-500/10",
  },
  {
    title: "系统管理",
    items: [
      { href: "/settings", title: "系统设置", desc: "用户、权限点与系统参数（超管/有权限角色）" },
      { href: "/settings/api", title: "API设置", desc: "仅超级管理员可修改画布模型渠道的接口地址与 API Key" },
      { href: "/sync-ops", title: "同步异常", desc: "NAS 同步死信查看、上报与重试排队" },
      { href: "/file-machine", title: "文件机与队列", desc: "查看文件服务心跳、任务进程，以及正在执行和排队的任务" },
      { href: "/operations", title: "操作日志", desc: "按 log.view 查询全局操作审计记录" },
      {
        href: "/admin/business-acceptance",
        title: "业务验收测试",
        desc: "仅超级管理员：业务 Checklist 勾选与备注（不含工作流/任务/接口自动化）",
      },
    ],
    gradient: "from-amber-300/30 to-orange-500/10",
  },
  {
    title: "教程",
    items: [{ href: "/tutorials", title: "教程中心", desc: "按页面跳转并高亮引导，学习素材库、集合、上传、未整理、回收站、标签与操作日志" }],
    gradient: "from-indigo-400/25 to-violet-600/10",
  },
] as const;

type HomePageProps = {
  searchParams?: Promise<{ auth?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) || {};
  const authRequired = params.auth === "required";

  return (
    <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <section className="space-y-3">
        <div className="rounded-xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            {/* eslint-disable-next-line @next/next/no-img-element -- 品牌标静态 SVG */}
            <img src="/brand/youwendu-mark-white.svg" alt="" className="h-7 w-auto" />
            轻量内容流程平台
          </h1>
          <p className="mt-1 text-xs text-slate-300">
            深色工作台：流程与任务驱动业务；素材侧覆盖上传入库、库内筛选与下载、引用型分组与集合、未整理打标及回收站，与标签体系贯通。
          </p>
          {authRequired ? (
            <p className="mt-2 rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
              当前未登录，受保护页面已限制访问。请点击右上角「登录」。
            </p>
          ) : null}
        </div>

        <HomeSections sections={menuSections} />
      </section>
    </main>
  );
}