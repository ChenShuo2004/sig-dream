import { ArrowRight, CheckCircle2, Clapperboard, Copy, FileText, ImagePlus, Images, KeyRound, Maximize2, Settings, Sparkles, UserRoundCog, Video } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";

import { APP_VERSION } from "@/constant/env";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { useConfigStore } from "@/stores/use-config-store";

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children?: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-35" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-stone-900 dark:text-stone-100">{children}</span>
        </span>
    );
}

const WORKSPACES = [
    {
        key: "canvas",
        path: "/canvas",
        icon: Maximize2,
        titleKey: "home.workspaces.canvasTitle",
        tagKey: "home.workspaces.canvasTag",
        descKey: "home.workspaces.canvasDesc",
        accent: "text-[#bc7650] bg-[#bc7650]/10 dark:text-[#e3a785] dark:bg-[#bc7650]/15",
    },
    {
        key: "script",
        path: "/studio/script",
        icon: Clapperboard,
        titleKey: "home.workspaces.scriptTitle",
        tagKey: "home.workspaces.scriptTag",
        descKey: "home.workspaces.scriptDesc",
        accent: "text-amber-700 bg-amber-500/10 dark:text-amber-300 dark:bg-amber-500/15",
    },
    {
        key: "replication",
        path: "/studio/replication",
        icon: Copy,
        titleKey: "home.workspaces.replicationTitle",
        tagKey: "home.workspaces.replicationTag",
        descKey: "home.workspaces.replicationDesc",
        accent: "text-sky-700 bg-sky-500/10 dark:text-sky-300 dark:bg-sky-500/15",
    },
    {
        key: "replacement",
        path: "/studio/replacement",
        icon: UserRoundCog,
        titleKey: "home.workspaces.replacementTitle",
        tagKey: "home.workspaces.replacementTag",
        descKey: "home.workspaces.replacementDesc",
        accent: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300 dark:bg-emerald-500/15",
    },
] as const;

const QUICK_TOOLS = [
    { key: "image", path: "/image", icon: ImagePlus, labelKey: "home.quickTools.image" },
    { key: "video", path: "/video", icon: Video, labelKey: "home.quickTools.video" },
    { key: "prompts", path: "/prompts", icon: FileText, labelKey: "home.quickTools.prompts" },
    { key: "assets", path: "/assets", icon: Images, labelKey: "home.quickTools.assets" },
] as const;

export default function IndexPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const channels = useConfigStore((state) => state.config.channels);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const configuredCount = channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim()).length;
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : i18n.t("home.promptError")));
    }, [message]);

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:18px_18px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)] dark:text-stone-100">
            <div className="mx-auto max-w-6xl px-6 pb-20 pt-10 sm:pt-14">
                <section className="relative flex flex-col items-center text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-stone-200/90 bg-white/80 px-3.5 py-1 text-xs font-medium text-stone-700 shadow-xs backdrop-blur dark:border-stone-800 dark:bg-stone-900/80 dark:text-stone-300">
                        <span
                            className="size-3.5 shrink-0 bg-stone-950 dark:bg-white"
                            style={{
                                mask: `url(${import.meta.env.BASE_URL}logo.svg) center / contain no-repeat`,
                                WebkitMask: `url(${import.meta.env.BASE_URL}logo.svg) center / contain no-repeat`,
                            }}
                        />
                        <span>{APP_VERSION}</span>
                        <span className="text-stone-300 dark:text-stone-700">·</span>
                        <span>{t("home.badge")}</span>
                    </div>

                    <h1 className="ai-title-aurora mt-5 max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
                        {t("meta.title")}
                    </h1>

                    <p className="mt-5 max-w-2xl text-balance text-base leading-7 text-stone-600 sm:text-lg sm:leading-8 dark:text-stone-400">
                        <Trans
                            i18nKey="home.description"
                            components={{
                                canvas: <Highlighter action="underline" color="#bc7650" />,
                                content: <Highlighter action="highlight" color="#e3a785" />,
                            }}
                        />
                    </p>

                    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                        <Button
                            type="primary"
                            size="large"
                            onClick={() => navigate("/canvas")}
                            icon={<ArrowRight className="size-4" />}
                            iconPlacement="end"
                        >
                            {t("home.start")}
                        </Button>
                        <Button
                            size="large"
                            icon={<Settings className="size-4" />}
                            onClick={() => openConfigDialog(false, "channels")}
                        >
                            {t("home.configureProviders")}
                        </Button>
                    </div>

                    <button
                        type="button"
                        onClick={() => openConfigDialog(false, "channels")}
                        className={cn(
                            "mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition",
                            configuredCount > 0
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                                : "border-amber-500/35 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300",
                        )}
                    >
                        {configuredCount > 0 ? (
                            <>
                                <CheckCircle2 className="size-3.5 shrink-0" />
                                <span>{t("home.providersReady", { count: configuredCount })}</span>
                            </>
                        ) : (
                            <>
                                <KeyRound className="size-3.5 shrink-0" />
                                <span>{t("home.providersHint")}</span>
                            </>
                        )}
                    </button>
                </section>

                <section className="mt-12">
                    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                        <div>
                            <h2 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
                                {t("home.workspacesTitle")}
                            </h2>
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                                {t("home.workspacesDescription")}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {QUICK_TOOLS.map((tool) => {
                                const Icon = tool.icon;
                                return (
                                    <button
                                        key={tool.key}
                                        type="button"
                                        onClick={() => navigate(tool.path)}
                                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200/90 bg-white/85 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:text-white"
                                    >
                                        <Icon className="size-3.5" />
                                        <span>{t(tool.labelKey)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {WORKSPACES.map((item) => {
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => navigate(item.path)}
                                    className="group flex cursor-pointer flex-col justify-between rounded-xl border border-stone-200/90 bg-white/85 p-5 text-left shadow-xs backdrop-blur transition hover:-translate-y-0.5 hover:border-stone-400 hover:shadow-md dark:border-stone-800 dark:bg-stone-900/80 dark:hover:border-stone-600"
                                >
                                    <div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className={cn("inline-flex size-9 items-center justify-center rounded-lg", item.accent)}>
                                                <Icon className="size-4.5" />
                                            </span>
                                            <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                                {t(item.tagKey)}
                                            </span>
                                        </div>
                                        <h3 className="mt-4 flex items-center gap-1.5 text-base font-semibold text-stone-950 dark:text-stone-100">
                                            <span>{t(item.titleKey)}</span>
                                            <ArrowRight className="size-3.5 text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-stone-900 dark:group-hover:text-white" />
                                        </h3>
                                        <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
                                            {t(item.descKey)}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="mt-8 grid gap-3 rounded-xl border border-stone-200/90 bg-white/75 p-4 backdrop-blur md:grid-cols-3 dark:border-stone-800 dark:bg-stone-900/65">
                    <button
                        type="button"
                        onClick={() => openConfigDialog(false, "channels")}
                        className="cursor-pointer rounded-lg p-2.5 text-left transition hover:bg-stone-100/80 dark:hover:bg-stone-800/70"
                    >
                        <div className="flex items-center gap-2 text-xs font-semibold text-stone-900 dark:text-stone-100">
                            <KeyRound className="size-3.5 text-[#bc7650]" />
                            <span>{t("home.steps.step1Title")}</span>
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-stone-500 dark:text-stone-400">{t("home.steps.step1Desc")}</p>
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate("/canvas")}
                        className="cursor-pointer rounded-lg p-2.5 text-left transition hover:bg-stone-100/80 dark:hover:bg-stone-800/70"
                    >
                        <div className="flex items-center gap-2 text-xs font-semibold text-stone-900 dark:text-stone-100">
                            <Sparkles className="size-3.5 text-[#bc7650]" />
                            <span>{t("home.steps.step2Title")}</span>
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-stone-500 dark:text-stone-400">{t("home.steps.step2Desc")}</p>
                    </button>
                    <button
                        type="button"
                        onClick={() => openConfigDialog(false, "local-storage")}
                        className="cursor-pointer rounded-lg p-2.5 text-left transition hover:bg-stone-100/80 dark:hover:bg-stone-800/70"
                    >
                        <div className="flex items-center gap-2 text-xs font-semibold text-stone-900 dark:text-stone-100">
                            <CheckCircle2 className="size-3.5 text-[#bc7650]" />
                            <span>{t("home.steps.step3Title")}</span>
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-stone-500 dark:text-stone-400">{t("home.steps.step3Desc")}</p>
                    </button>
                </section>

                <section className="relative mt-14 border-t border-stone-200 pt-10 dark:border-stone-800">
                    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                        <div className="max-w-2xl">
                            <h2 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">
                                {t("home.showcaseTitle")}
                            </h2>
                            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
                                {t("home.showcaseDescription")}
                            </p>
                        </div>
                        <Button
                            type="link"
                            onClick={() => navigate("/prompts")}
                            className="!px-0 self-start sm:self-end"
                            icon={<ArrowRight className="size-4" />}
                            iconPlacement="end"
                        >
                            {t("home.viewPrompts")}
                        </Button>
                    </div>

                    {promptShowcase.length > 0 ? (
                        <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                            {promptShowcase.map((item, index) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                        setPreviewIndex(index);
                                        setPreviewOpen(true);
                                    }}
                                    className={cn(
                                        "group relative cursor-pointer overflow-hidden rounded-xl border border-stone-200 bg-stone-100 text-left dark:border-stone-800 dark:bg-stone-900",
                                        index === 0 && "md:col-span-2 md:row-span-2",
                                        index === 3 && "md:col-span-2",
                                    )}
                                >
                                    <img
                                        src={item.coverUrl}
                                        alt={item.title}
                                        loading="lazy"
                                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                                    />
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent p-4 text-white">
                                        <div className="mb-2 flex flex-wrap gap-1.5">
                                            {item.tags.slice(0, 2).map((tag) => (
                                                <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                    {tag}
                                                </Tag>
                                            ))}
                                        </div>
                                        <h3 className="text-sm font-medium">{item.title}</h3>
                                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </section>

                <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/80 pt-6 text-xs text-stone-500 dark:border-stone-800/80 dark:text-stone-400">
                    <span>
                        sig-dream {APP_VERSION} · {t("home.openSourceFooter")}
                    </span>
                    <a
                        href="https://github.com/ChenShuo2004/sig-dream"
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-stone-700 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white"
                    >
                        {t("home.githubLink")} ↗
                    </a>
                </footer>
            </div>

            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {promptShowcase.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
