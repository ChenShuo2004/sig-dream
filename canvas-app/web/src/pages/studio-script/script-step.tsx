import { useMemo, useState } from "react";
import { Collapse, Input, Tag } from "antd";
import { ChevronRight, FileText, ListTree, RefreshCw, Settings2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { DarkButton, EmptyHint, Panel } from "@/studios/components/studio-dark-ui";
import type { ScriptStudioDocument } from "@/studios/script/document";
import { uploadImportBanner } from "@/studios/script/import-uploaded";
import type { StudioEpisode } from "@/studios/types";

import type { ScriptRunner } from "./use-script-runner";

const VERDICT_LABEL: Record<string, { text: string; color: string }> = {
    pass: { text: "审核通过", color: "green" },
    repair: { text: "仍有问题", color: "orange" },
    needs_confirmation: { text: "需要确认", color: "red" },
    skipped: { text: "未审核", color: "default" },
};

function EpisodeScript({ episode, disabled, onChange }: { episode: StudioEpisode; disabled: boolean; onChange: (episode: StudioEpisode) => void }) {
    if (!episode.script) return <p className="p-3 text-xs text-neutral-500">还没有剧本。</p>;
    return (
        <div className="flex flex-col gap-3 p-3">
            {episode.script.scenes.map((scene, index) => (
                <div key={scene.ref} className="flex flex-col gap-1">
                    <Input
                        variant="borderless"
                        disabled={disabled}
                        className="!px-0 !text-sm font-medium !text-neutral-100"
                        value={scene.heading}
                        onChange={(event) => onChange({ ...episode, script: { ...episode.script!, scenes: episode.script!.scenes.map((item, itemIndex) => (itemIndex === index ? { ...item, heading: event.target.value } : item)) } })}
                    />
                    <Input.TextArea
                        disabled={disabled}
                        autoSize={{ minRows: 3, maxRows: 24 }}
                        className="!text-xs"
                        value={scene.body}
                        onChange={(event) => onChange({ ...episode, script: { ...episode.script!, scenes: episode.script!.scenes.map((item, itemIndex) => (itemIndex === index ? { ...item, body: event.target.value } : item)) } })}
                    />
                </div>
            ))}
        </div>
    );
}

function SourceBody({ document }: { document: ScriptStudioDocument }) {
    const settings = document.settings;
    const summary = document.summary;
    if (settings.sourceText.trim()) {
        return <pre className="whitespace-pre-wrap p-4 font-sans text-xs leading-6 text-neutral-200">{settings.sourceText}</pre>;
    }
    if (settings.idea.trim()) {
        return (
            <div className="flex flex-col gap-3 p-4 text-xs leading-6 text-neutral-200">
                <p className="font-medium text-neutral-100">创意</p>
                <p className="whitespace-pre-wrap">{settings.idea}</p>
                {settings.rewriteInstruction ? (
                    <>
                        <p className="font-medium text-neutral-100">改写要求</p>
                        <p className="whitespace-pre-wrap text-neutral-300">{settings.rewriteInstruction}</p>
                    </>
                ) : null}
            </div>
        );
    }
    if (summary) {
        return (
            <div className="flex flex-col gap-3 p-4 text-xs leading-6 text-neutral-200">
                <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="text-sm font-semibold text-neutral-100">{summary.title}</h2>
                    {summary.storyType ? <span className="text-[11px] text-neutral-500">{summary.storyType}</span> : null}
                </div>
                {summary.logline ? <p className="text-neutral-400">{summary.logline}</p> : null}
                <p className="whitespace-pre-wrap">{summary.storySummary}</p>
                {summary.characters.length ? (
                    <div className="flex flex-wrap gap-1.5">
                        {summary.characters.map((character) => (
                            <span key={character.ref} className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] text-neutral-200">
                                {character.name}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }
    return <EmptyHint icon={<FileText className="size-5" />} title="还没有原始剧本" hint="回到首页上传/改写，或打开设置后生成" />;
}

export function ScriptStep({ document, runner, onOpenSettings }: { document: ScriptStudioDocument; runner: ScriptRunner; onOpenSettings?: () => void }) {
    const disabled = Boolean(runner.busy);
    const [tocOpen, setTocOpen] = useState(false);
    const [openKeys, setOpenKeys] = useState<string[]>(() => {
        if (document.summary || document.settings.sourceText || document.settings.idea) return ["source", ...(document.episodes[0] ? ["episodes"] : [])];
        return document.episodes[0] ? ["episodes"] : ["source"];
    });
    const [episodeKeys, setEpisodeKeys] = useState<string[]>(document.episodes[0] ? [document.episodes[0].id] : []);
    const updateEpisode = (episode: StudioEpisode) => runner.update((current) => ({ ...current, episodes: current.episodes.map((item) => (item.id === episode.id ? episode : item)) }));
    const missingScripts = document.episodes.filter((episode) => !episode.script).length;
    const isUpload = document.settings.sourceMode === "upload";
    const uploadedReady = isUpload && document.episodes.some((episode) => episode.script);
    const empty = !document.summary && !document.episodes.length && !document.settings.sourceText.trim() && !document.settings.idea.trim();

    const tocItems = useMemo(
        () => [
            { id: "source", label: "原始剧本" },
            ...document.episodes.map((episode) => ({ id: episode.id, label: `第${episode.number}集 ${episode.title || ""}`.trim() })),
        ],
        [document.episodes],
    );

    const jumpTo = (id: string) => {
        if (id === "source") {
            setOpenKeys((keys) => (keys.includes("source") ? keys : [...keys, "source"]));
            return;
        }
        setOpenKeys((keys) => (keys.includes("episodes") ? keys : [...keys, "episodes"]));
        setEpisodeKeys((keys) => (keys.includes(id) ? keys : [...keys, id]));
    };

    if (empty) {
        return (
            <Panel className="h-full" bodyClassName="flex items-center justify-center">
                <EmptyHint icon={<Sparkles className="size-5" />} title="从创意或上传剧本开始" hint="在首页导入剧本，或打开设置后生成">
                    <DarkButton size="sm" tone="subtle" onClick={onOpenSettings}>
                        <Settings2 className="size-3.5" />
                        打开设置
                    </DarkButton>
                    <DarkButton size="sm" tone="primary" disabled={disabled} onClick={() => void runner.generateStory("summary")}>
                        <Sparkles className="size-3.5" />
                        生成剧本
                    </DarkButton>
                </EmptyHint>
            </Panel>
        );
    }

    return (
        <div className="relative flex h-full min-h-0">
            <button
                type="button"
                onClick={() => setTocOpen((open) => !open)}
                className="absolute left-0 top-1/2 z-20 flex h-16 w-6 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-r-md border border-l-0 border-white/[0.08] bg-[#1a1a1d] text-[10px] text-neutral-400 hover:text-white"
                title="目录"
            >
                <ListTree className="size-3.5" />
                <span style={{ writingMode: "vertical-rl" }} className="tracking-[0.2em]">
                    目录
                </span>
            </button>
            {tocOpen ? (
                <aside className="z-10 flex w-52 shrink-0 flex-col border-r border-white/[0.06] bg-[#121214] pl-6">
                    <div className="flex h-9 items-center justify-between px-3 text-xs font-medium text-neutral-300">
                        目录
                        <button type="button" className="text-neutral-500 hover:text-white" onClick={() => setTocOpen(false)}>
                            <ChevronRight className="size-3.5 rotate-180" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-auto px-2 pb-3">
                        {tocItems.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => jumpTo(item.id)}
                                className={cn("mb-0.5 block w-full truncate rounded-md px-2 py-1.5 text-left text-[11px] text-neutral-300 hover:bg-white/[0.06] hover:text-white")}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </aside>
            ) : null}

            <Panel className="h-full min-h-0 flex-1" bodyClassName="min-h-0 overflow-auto">
                <Collapse
                    bordered={false}
                    className="bg-transparent [&_.ant-collapse-header]:!items-center [&_.ant-collapse-header]:!px-4 [&_.ant-collapse-header]:!py-3 [&_.ant-collapse-header]:!text-neutral-100 [&_.ant-collapse-content-box]:!px-0 [&_.ant-collapse-content-box]:!pb-0"
                    activeKey={openKeys}
                    onChange={(keys) => setOpenKeys(keys as string[])}
                    items={[
                        {
                            key: "source",
                            label: (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium">原始剧本</span>
                                    {uploadedReady ? <Tag className="!m-0 !text-[10px]">{uploadImportBanner()}</Tag> : null}
                                </div>
                            ),
                            children: (
                                <div className="max-h-[46vh] overflow-auto border-t border-white/[0.06]">
                                    <SourceBody document={document} />
                                </div>
                            ),
                        },
                        {
                            key: "episodes",
                            label: (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium">分集剧本</span>
                                    <span className="text-[11px] text-neutral-500">{document.episodes.length} 集</span>
                                    {uploadedReady ? <Tag color="green" className="!m-0 !text-[10px]">原稿导入</Tag> : null}
                                    {document.reviews.slice(-3).map((review, index) => {
                                        const label = VERDICT_LABEL[review.verdict] || VERDICT_LABEL.skipped;
                                        return (
                                            <Tag key={`${review.stage}-${index}`} color={label.color} className="!m-0 !text-[10px]">
                                                {review.stage}：{label.text}
                                            </Tag>
                                        );
                                    })}
                                </div>
                            ),
                            extra: isUpload ? (
                                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                                    <DarkButton size="sm" disabled={disabled || !document.settings.sourceText.trim()} onClick={() => void runner.generateStory("summary")}>
                                        <RefreshCw className="size-3" />
                                        重新导入
                                    </DarkButton>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                                    <DarkButton size="sm" disabled={disabled || !document.summary} onClick={() => void runner.generateStory("outline")}>
                                        <RefreshCw className="size-3" />
                                        重做大纲
                                    </DarkButton>
                                    {missingScripts ? (
                                        <DarkButton size="sm" tone="primary" disabled={disabled} onClick={() => void runner.generateStory("scripts")}>
                                            补写 {missingScripts} 集
                                        </DarkButton>
                                    ) : null}
                                </div>
                            ),
                            children: (
                                <div className="border-t border-white/[0.06]">
                                    {!document.episodes.length ? (
                                        <EmptyHint title={isUpload ? "还没有导入分集" : "还没有分集大纲"} hint={isUpload ? "点击首页「导入剧本」或此处重新导入" : "生成摘要后会继续规划分集"} />
                                    ) : (
                                        <Collapse
                                            bordered={false}
                                            className="bg-transparent [&_.ant-collapse-header]:!text-neutral-200 [&_.ant-collapse-content-box]:!px-0"
                                            activeKey={episodeKeys}
                                            onChange={(keys) => setEpisodeKeys(keys as string[])}
                                            items={document.episodes.map((episode, index) => ({
                                                key: episode.id,
                                                label: (
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-xs font-medium">
                                                            第{episode.number}集 {episode.title}
                                                        </span>
                                                        {episode.script ? (
                                                            <Tag color="green" className="!m-0 !text-[10px]">
                                                                {isUpload ? "原稿" : "已写"} · {episode.script.scenes.length} 场
                                                            </Tag>
                                                        ) : (
                                                            <Tag className="!m-0 !text-[10px]">仅大纲</Tag>
                                                        )}
                                                    </div>
                                                ),
                                                extra: isUpload ? null : (
                                                    <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                                                        {(() => {
                                                            const pending = [...document.reviews].reverse().find((item) => item.targetId === episode.id && item.verdict === "needs_confirmation" && !item.confirmed);
                                                            if (!pending) return null;
                                                            return (
                                                                <>
                                                                    <DarkButton size="sm" disabled={disabled} onClick={() => runner.confirmReview(pending.at)}>
                                                                        确认通过
                                                                    </DarkButton>
                                                                    <DarkButton size="sm" tone="primary" disabled={disabled} onClick={() => void runner.reviseEpisodeFromReview(episode.id)}>
                                                                        按意见修订
                                                                    </DarkButton>
                                                                </>
                                                            );
                                                        })()}
                                                        <button type="button" className="rounded-full px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-white/[0.08]" disabled={disabled} onClick={() => void runner.regenerateEpisode(index)}>
                                                            {episode.script ? "重写" : "写剧本"}
                                                        </button>
                                                    </div>
                                                ),
                                                children: (
                                                    <div className="flex flex-col gap-2 border-t border-white/[0.06]">
                                                        <div className="bg-white/[0.03] px-3 py-2 text-xs leading-5 text-neutral-300">
                                                            <p className="whitespace-pre-wrap">{episode.synopsis}</p>
                                                            {episode.hook ? <p className="mt-1.5 text-neutral-500">结尾钩子：{episode.hook}</p> : null}
                                                        </div>
                                                        <EpisodeScript episode={episode} disabled={disabled} onChange={updateEpisode} />
                                                    </div>
                                                ),
                                            }))}
                                        />
                                    )}
                                </div>
                            ),
                        },
                    ]}
                />
            </Panel>
        </div>
    );
}
