import { useMemo, useState } from "react";
import { App, Button, Input, Modal, Tag } from "antd";
import { BookOpen, Box, Clapperboard, Copy, ExternalLink, Layers, Search, Sparkles } from "lucide-react";

import { BUILTIN_SKILLS, type BuiltinSkillCategory, type BuiltinSkillItem } from "@/data/builtin-skills";
import { cn } from "@/lib/utils";

type CategoryFilter = "all" | BuiltinSkillCategory;

const CATEGORIES: { key: CategoryFilter; label: string; icon: typeof Sparkles }[] = [
    { key: "all", label: "全部技能", icon: Sparkles },
    { key: "cs-workflow", label: "陈硕创作工作流", icon: Clapperboard },
    { key: "craft", label: "视觉结构与分镜", icon: BookOpen },
    { key: "motion", label: "视频与动效引擎", icon: Layers },
    { key: "3d", label: "3D 与粒子渲染", icon: Box },
];

const CATEGORY_BADGE: Record<BuiltinSkillCategory, { label: string; cls: string }> = {
    "cs-workflow": {
        label: "创作工作流",
        cls: "bg-[#bc7650]/12 text-[#bc7650] dark:bg-[#bc7650]/20 dark:text-[#e3a785]",
    },
    craft: {
        label: "视觉与分镜",
        cls: "bg-sky-500/12 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
    },
    motion: {
        label: "视频与动效",
        cls: "bg-violet-500/12 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
    },
    "3d": {
        label: "3D 与粒子",
        cls: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    },
};

export default function SkillsPage() {
    const { message } = App.useApp();
    const [category, setCategory] = useState<CategoryFilter>("all");
    const [keyword, setKeyword] = useState("");
    const [activeSkill, setActiveSkill] = useState<BuiltinSkillItem | null>(null);

    const counts = useMemo(() => {
        const map: Record<CategoryFilter, number> = {
            all: BUILTIN_SKILLS.length,
            "cs-workflow": 0,
            craft: 0,
            motion: 0,
            "3d": 0,
        };
        for (const item of BUILTIN_SKILLS) {
            map[item.category] += 1;
        }
        return map;
    }, []);

    const filtered = useMemo(() => {
        const q = keyword.trim().toLowerCase();
        return BUILTIN_SKILLS.filter((skill) => {
            if (category !== "all" && skill.category !== category) return false;
            if (!q) return true;
            return (
                skill.slug.toLowerCase().includes(q) ||
                skill.title.toLowerCase().includes(q) ||
                skill.summary.toLowerCase().includes(q) ||
                skill.tags.some((t) => t.toLowerCase().includes(q))
            );
        });
    }, [category, keyword]);

    const copyText = async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text);
            message.success(`已复制${label}`);
        } catch {
            message.error("复制失败，请手动复制");
        }
    };

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:18px_18px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.12)_1px,transparent_1px)] dark:text-stone-100">
            <div className="mx-auto max-w-7xl px-6 pb-20 pt-8">
                <header className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-6 md:flex-row md:items-end dark:border-stone-800">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                            <Sparkles className="size-3.5" />
                            <span>已同步内置至 .agents/skills · 支持 MCP Agent 直接调用</span>
                        </div>
                        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">
                            内置技能中心（{BUILTIN_SKILLS.length}）
                        </h1>
                        <p className="mt-1.5 max-w-2xl text-sm text-stone-500 dark:text-stone-400">
                            内置陈硕视频与内容创作工作流、人体解剖与电影分镜工艺，以及 Remotion、Motion Canvas、Anime.js、Manim、Three.js、Blender、Godot 等 18 大动效与 3D 渲染引擎 Skill。
                        </p>
                    </div>

                    <div className="w-full md:w-80">
                        <Input
                            size="large"
                            allowClear
                            prefix={<Search className="size-4 text-stone-400" />}
                            placeholder="搜索 Skill 名称、引擎或场景..."
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                        />
                    </div>
                </header>

                <div className="mt-5 flex flex-wrap gap-2">
                    {CATEGORIES.map((item) => {
                        const Icon = item.icon;
                        const active = category === item.key;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => setCategory(item.key)}
                                className={cn(
                                    "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
                                    active
                                        ? "border-stone-950 bg-stone-950 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950"
                                        : "border-stone-200 bg-white/80 text-stone-600 hover:border-stone-400 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-300 dark:hover:border-stone-600",
                                )}
                            >
                                <Icon className="size-3.5" />
                                <span>{item.label}</span>
                                <span className="opacity-70">{counts[item.key]}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((skill) => {
                        const badge = CATEGORY_BADGE[skill.category];
                        return (
                            <article
                                key={skill.slug}
                                onClick={() => setActiveSkill(skill)}
                                className="group flex cursor-pointer flex-col justify-between rounded-xl border border-stone-200/90 bg-white/85 p-5 shadow-xs backdrop-blur transition hover:-translate-y-0.5 hover:border-violet-500/50 hover:shadow-md dark:border-stone-800 dark:bg-stone-900/80 dark:hover:border-violet-400/50"
                            >
                                <div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-xs font-semibold text-stone-900 dark:text-stone-100">
                                            {skill.trigger}
                                        </span>
                                        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", badge.cls)}>
                                            {badge.label}
                                        </span>
                                    </div>
                                    <h2 className="mt-2.5 text-base font-semibold text-stone-950 dark:text-stone-50">
                                        {skill.title}
                                    </h2>
                                    <p className="mt-1.5 line-clamp-3 text-xs leading-5 text-stone-500 dark:text-stone-400">
                                        {skill.summary}
                                    </p>
                                </div>

                                <div className="mt-4 flex items-center justify-between gap-2 border-t border-stone-100 pt-3 dark:border-stone-800/80">
                                    <div className="flex flex-wrap gap-1">
                                        {skill.tags.slice(0, 3).map((tag) => (
                                            <Tag key={tag} className="m-0 text-[11px]">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<Copy className="size-3.5" />}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void copyText(skill.trigger, `触发词 ${skill.trigger}`);
                                        }}
                                    >
                                        复制
                                    </Button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            </div>

            <Modal
                open={Boolean(activeSkill)}
                onCancel={() => setActiveSkill(null)}
                width={760}
                centered
                title={
                    activeSkill ? (
                        <div className="flex items-center gap-2.5">
                            <span className="font-mono text-sm text-violet-600 dark:text-violet-300">
                                {activeSkill.trigger}
                            </span>
                            <span>·</span>
                            <span>{activeSkill.title}</span>
                        </div>
                    ) : null
                }
                footer={
                    activeSkill ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                {activeSkill.repo ? (
                                    <a
                                        href={activeSkill.repo}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
                                    >
                                        <span>查看开源参考</span>
                                        <ExternalLink className="size-3.5" />
                                    </a>
                                ) : null}
                            </div>
                            <div className="flex gap-2">
                                <Button onClick={() => void copyText(activeSkill.trigger, `触发词 ${activeSkill.trigger}`)}>
                                    复制触发词
                                </Button>
                                <Button
                                    type="primary"
                                    icon={<Copy className="size-3.5" />}
                                    onClick={() => void copyText(activeSkill.instructions, "完整 Skill 指令")}
                                >
                                    复制完整 SKILL.md
                                </Button>
                            </div>
                        </div>
                    ) : null
                }
            >
                {activeSkill ? (
                    <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-stone-200 bg-stone-50 p-4 font-mono text-xs leading-6 whitespace-pre-wrap text-stone-800 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200">
                        {activeSkill.instructions}
                    </div>
                ) : null}
            </Modal>
        </main>
    );
}
