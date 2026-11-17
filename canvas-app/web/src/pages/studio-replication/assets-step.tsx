import { useState } from "react";
import { Button, Empty, Image, Input, Segmented, Spin, Tag } from "antd";
import { ImagePlus } from "lucide-react";

import { useStudioMedia } from "@/studios/media";
import type { ReplicationStudioDocument } from "@/studios/replication/document";
import type { StudioAppearance, StudioAsset, StudioAssetKind } from "@/studios/types";

import { FrameThumb, shotAt } from "./media";
import type { ReplicationRunner } from "./use-replication-runner";

const KIND_LABEL: Record<StudioAssetKind, string> = { character: "角色", scene: "场景", prop: "道具" };

function LookCard({ asset, look, disabled, runner }: { asset: StudioAsset; look: StudioAppearance; disabled: boolean; runner: ReplicationRunner }) {
    const url = useStudioMedia(look.imageKey);
    const updateLook = (patch: Partial<StudioAppearance>) =>
        runner.update((current) => ({
            ...current,
            assets: current.assets.map((item) => (item.id === asset.id ? { ...item, appearances: item.appearances.map((entry) => (entry.id === look.id ? { ...entry, ...patch } : entry)) } : item)),
        }));
    return (
        <div className="flex gap-3">
            <div className="flex h-40 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md bg-stone-100 dark:bg-stone-900">
                {look.imageStatus === "running" ? <Spin /> : url ? <Image src={url} alt={asset.name} className="!h-40 !w-28 object-cover" /> : <ImagePlus className="size-6 text-stone-400" />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Input.TextArea size="small" disabled={disabled} autoSize={{ minRows: 4, maxRows: 10 }} value={look.prompt} placeholder="外观描述，用于生成参考图" onChange={(event) => updateLook({ prompt: event.target.value, description: event.target.value })} />
                <div className="flex items-center gap-2">
                    <Button size="small" disabled={disabled || !look.prompt.trim()} onClick={() => void runner.generateImages([{ assetId: asset.id, appearanceId: look.id }])}>
                        {look.imageKey ? "重新生成" : "生成图片"}
                    </Button>
                    {look.imageStatus === "failed" && look.imageError ? <span className="text-xs text-red-600">{look.imageError}</span> : null}
                </div>
            </div>
        </div>
    );
}

export function AssetsStep({ document, runner }: { document: ReplicationStudioDocument; runner: ReplicationRunner }) {
    const disabled = Boolean(runner.busy);
    const [kind, setKind] = useState<StudioAssetKind | "all">("all");
    const visible = document.assets.filter((asset) => kind === "all" || asset.kind === kind);
    const missing = document.assets.flatMap((asset) => asset.appearances.filter((look) => !look.imageKey && look.prompt.trim()).map((look) => ({ assetId: asset.id, appearanceId: look.id })));
    const sourceOf = (assetId: string) => {
        const sourceId = Object.keys(document.characterBindings).find((id) => document.characterBindings[id] === assetId);
        return document.analysis?.characters.find((character) => character.id === sourceId);
    };

    if (!document.analysis) return <Empty className="mt-24" description="请先完成原片分析" />;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
                <Segmented
                    value={kind}
                    onChange={(value) => setKind(value as StudioAssetKind | "all")}
                    options={[
                        { value: "all", label: `全部 ${document.assets.length}` },
                        ...(["character", "scene", "prop"] as StudioAssetKind[]).map((value) => ({ value, label: `${KIND_LABEL[value]} ${document.assets.filter((asset) => asset.kind === value).length}` })),
                    ]}
                />
                <div className="ml-auto flex gap-2">
                    <Button disabled={disabled} onClick={() => void runner.extract()}>
                        {document.assets.length ? "重新整理素材" : "整理素材"}
                    </Button>
                    <Button disabled={disabled || !missing.length} onClick={() => void runner.generateImages(missing)}>
                        生成缺少的图片{missing.length ? `（${missing.length}）` : ""}
                    </Button>
                    <Button type="primary" disabled={disabled || !document.assets.length} onClick={() => void runner.generateStoryboard()}>
                        {document.clips.length ? "重新生成分镜" : "生成分镜"}
                    </Button>
                </div>
            </div>
            <p className="text-xs leading-5 text-stone-500">角色名称和外观会替换原片人物：改成新的名字和外貌即可复刻成新角色，台词中的人物名在生成分镜时按这里的名称输出。</p>
            {!document.assets.length ? (
                <Empty className="mt-16" description="点击「整理素材」从原片记录中提取人物、场景和道具" />
            ) : (
                <div className="grid gap-5 xl:grid-cols-2">
                    {visible.map((asset) => {
                        const original = asset.kind === "character" ? sourceOf(asset.id) : undefined;
                        const rename = (name: string) => runner.update((current) => ({ ...current, assets: current.assets.map((item) => (item.id === asset.id ? { ...item, name } : item)) }));
                        return (
                            <section key={asset.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Tag color={asset.kind === "character" ? "blue" : asset.kind === "scene" ? "green" : "gold"}>{KIND_LABEL[asset.kind]}</Tag>
                                    <Input size="small" disabled={disabled} className="!w-44" value={asset.name} onChange={(event) => rename(event.target.value)} />
                                    {original ? (
                                        <span className="flex items-center gap-1.5 text-xs text-stone-500">
                                            原片：
                                            <FrameThumb frameKey={document.source ? shotAt(document.source.shots, original.representativeTimeSec)?.frameKey : undefined} className="size-7 rounded" />
                                            {original.name}
                                        </span>
                                    ) : null}
                                </div>
                                {asset.description ? <p className="text-xs leading-5 text-stone-500">{asset.description}</p> : null}
                                {asset.appearances.map((look) => (
                                    <LookCard key={look.id} asset={asset} look={look} disabled={disabled} runner={runner} />
                                ))}
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
