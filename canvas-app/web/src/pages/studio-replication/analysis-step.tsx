import { Alert, Button, Empty, Input, Select, Tag } from "antd";

import { REPLICATION_CHARACTER_ROLES, REPLICATION_CONTENT_TYPES, REPLICATION_VOICEOVER_KINDS, type ReplicationContentType } from "@/studios/prompts/replication-policy";
import type { ReplicationStudioDocument, SourceCharacter, SourceEvent } from "@/studios/replication/document";

import { FrameThumb, formatSec, shotAt } from "./media";
import type { ReplicationRunner } from "./use-replication-runner";

const CONTENT_TYPE_LABEL: Record<ReplicationContentType, string> = { story: "剧情", narrated_story: "解说剧情", advertisement: "广告", unknown: "未确定" };

export function AnalysisStep({ document, runner }: { document: ReplicationStudioDocument; runner: ReplicationRunner }) {
    const disabled = Boolean(runner.busy);
    const { analysis, source } = document;
    if (!analysis || !source) return <Empty className="mt-24" description="请先在「上传原片」步骤完成切镜并分析原片" />;

    const names = new Map(analysis.characters.map((character) => [character.id, character.name]));
    const updateAnalysis = (mutate: (value: NonNullable<ReplicationStudioDocument["analysis"]>) => NonNullable<ReplicationStudioDocument["analysis"]>) =>
        runner.update((current) => (current.analysis ? { ...current, analysis: mutate(current.analysis) } : current));
    const updateCharacter = (id: string, patch: Partial<SourceCharacter>) => updateAnalysis((value) => ({ ...value, characters: value.characters.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
    const updateEvent = (id: string, mutate: (event: SourceEvent) => SourceEvent) => {
        updateAnalysis((value) => ({ ...value, events: value.events.map((item) => (item.id === id ? mutate(item) : item)) }));
        runner.replan();
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                    <h3 className="text-base font-medium">{analysis.title || source.fileName}</h3>
                    <p className="mt-1 text-xs leading-5 text-stone-500">{analysis.synopsis}</p>
                </div>
                <Select
                    disabled={disabled}
                    className="w-36"
                    value={document.contentType}
                    onChange={(contentType) => runner.update((current) => ({ ...current, contentType }))}
                    options={REPLICATION_CONTENT_TYPES.map((value) => ({ value, label: `类型：${CONTENT_TYPE_LABEL[value]}` }))}
                />
                <Button disabled={disabled} onClick={() => void runner.analyze()}>
                    重新分析
                </Button>
                <Button type="primary" disabled={disabled} onClick={() => void runner.extract()}>
                    {document.assets.length ? "重新整理素材" : "整理素材"}
                </Button>
            </div>
            {analysis.contentTypeReason ? <p className="-mt-3 text-xs text-stone-400">类型依据：{analysis.contentTypeReason}</p> : null}
            {!analysis.audioHeard ? <Alert type="warning" showIcon message="本次分析没有听原片音轨，台词只依据画面字幕推测，请逐句核对后再生成分镜。" /> : null}

            <section className="flex flex-col gap-3">
                <h4 className="text-sm font-medium">人物（{analysis.characters.length}）</h4>
                <div className="grid gap-3 xl:grid-cols-2">
                    {analysis.characters.map((character) => (
                        <div key={character.id} className="flex gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <FrameThumb frameKey={shotAt(source.shots, character.representativeTimeSec)?.frameKey} className="h-28 w-20 shrink-0 rounded-md" alt={character.name} />
                            <div className="flex min-w-0 flex-1 flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <Input size="small" disabled={disabled} className="!w-40" value={character.name} onChange={(event) => updateCharacter(character.id, { name: event.target.value })} />
                                    <Tag>{REPLICATION_CHARACTER_ROLES[character.role]}</Tag>
                                    <span className="text-xs text-stone-400">{character.id}</span>
                                </div>
                                <Input.TextArea size="small" disabled={disabled} autoSize={{ minRows: 2, maxRows: 6 }} value={character.visualPrompt} placeholder="外貌、发型、服装" onChange={(event) => updateCharacter(character.id, { visualPrompt: event.target.value })} />
                                {character.description ? <p className="text-xs text-stone-500">{character.description}</p> : null}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <h4 className="text-sm font-medium">
                    分段计划（{document.segmentPlan.length} 段，每段不超过 {document.settings.clipMaxSeconds} 秒）
                </h4>
                <div className="flex flex-wrap gap-2 text-xs">
                    {document.segmentPlan.map((clip) => (
                        <span key={clip.ref} className="rounded-md bg-stone-100 px-2 py-1 dark:bg-stone-900">
                            {clip.ref} · {formatSec(clip.sourceStartSec)}–{formatSec(clip.sourceEndSec)} · {clip.durationSec}s
                        </span>
                    ))}
                </div>
            </section>

            <section className="flex flex-col gap-3">
                <h4 className="text-sm font-medium">事件时间轴（{analysis.events.length}）</h4>
                {analysis.events.map((event) => (
                    <article key={event.id} className="flex flex-col gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-medium">{event.id}</span>
                            <span className="text-stone-500">
                                {formatSec(event.startSec)}–{formatSec(event.endSec)}
                            </span>
                            {event.characterIds.map((id) => (
                                <Tag key={id}>{names.get(id) || id}</Tag>
                            ))}
                        </div>
                        <p className="text-xs leading-5">{event.visual}</p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {event.shots.map((shot) => {
                                const intake = source.shots.find((item) => `shot-${item.index}` === shot.id);
                                return (
                                    <figure key={shot.id} className="w-36 shrink-0" title={`${shot.visual}\n${shot.camera}`}>
                                        <FrameThumb frameKey={intake?.frameKey} className="aspect-video w-full rounded" />
                                        <figcaption className="mt-1 line-clamp-2 text-[11px] leading-4 text-stone-500">
                                            {shot.id} {shot.visual}
                                        </figcaption>
                                    </figure>
                                );
                            })}
                        </div>
                        {event.speechOrder.map((ref) => {
                            const [kind, rawIndex] = ref.split(":");
                            const index = Number(rawIndex);
                            const item = kind === "dialogue" ? event.dialogue[index] : event.voiceover[index];
                            if (!item) return null;
                            const label = kind === "dialogue" ? names.get(item.speakerId) || "未知说话人" : `${REPLICATION_VOICEOVER_KINDS[(item as SourceEvent["voiceover"][number]).kind]}${item.speakerId ? `（${names.get(item.speakerId) || item.speakerId}）` : ""}`;
                            return (
                                <div key={ref} className="flex items-center gap-2 text-xs">
                                    <span className="w-32 shrink-0 truncate text-stone-500">{label}</span>
                                    <Input
                                        size="small"
                                        disabled={disabled}
                                        status={item.uncertain ? "warning" : undefined}
                                        value={item.text}
                                        onChange={(change) =>
                                            updateEvent(event.id, (current) =>
                                                kind === "dialogue"
                                                    ? { ...current, dialogue: current.dialogue.map((entry, position) => (position === index ? { ...entry, text: change.target.value } : entry)) }
                                                    : { ...current, voiceover: current.voiceover.map((entry, position) => (position === index ? { ...entry, text: change.target.value } : entry)) },
                                            )
                                        }
                                    />
                                </div>
                            );
                        })}
                        {event.uncertainties.length ? <p className="text-xs text-amber-600">需核对：{event.uncertainties.join("；")}</p> : null}
                    </article>
                ))}
            </section>
        </div>
    );
}
