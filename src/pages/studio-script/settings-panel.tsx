import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Input, InputNumber, Segmented, Select, Switch, Tooltip } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { videoQualityChoices, videoQualityLabel } from "@/components/video-settings-panel";
import { clampH3DeOilStrength, isRunningHubFixedQualityTiers, isRunningHubH3FaceGen, normalizeRunningHubInstanceType, RUNNINGHUB_H3_FACE_RATIOS, RUNNINGHUB_INSTANCE_OPTIONS } from "@/lib/relay-stations";
import { normalizeH3FaceRatio } from "@/lib/media-size";
import type { ScriptSettings } from "@/studios/script/document";
import { modelOptionName, useConfigStore } from "@/stores/use-config-store";

import { findStylePreset, StyleLibraryField } from "./style-library-modal";

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "3:4", "4:3", "3:2", "2:3", "21:9", "auto"];
const IMAGE_QUALITIES = ["1K", "2K", "4K"];
const DEFAULT_VIDEO_QUALITIES = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];

const INSTANCE_TIPS: Record<string, string> = {
    default: "24G（Standard）：调用 24G 显存机器，按 0.2 RH币/s 扣费。",
    plus: "48G（Plus）：调用 48G 显存机器，按 0.4 RH币/s 扣费。",
    ultra: "84G（Ultra）已停用：速度不明显更快，费用更高。请用 24G / 48G。",
};

function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{label}</span>
            {children}
            {hint ? <span className="text-xs text-stone-400">{hint}</span> : null}
        </label>
    );
}

export function ScriptSettingsPanel({ settings, disabled, onChange }: { settings: ScriptSettings; disabled: boolean; onChange: (patch: Partial<ScriptSettings>) => void }) {
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const selectedStyle = findStylePreset(settings);
    const selectedVideo = settings.videoModel || config.videoModel || config.model || "";
    const videoModelName = modelOptionName(selectedVideo);
    const faceModel = isRunningHubFixedQualityTiers(videoModelName);
    const faceDeOil = isRunningHubH3FaceGen(videoModelName);
    const faceQuality = videoQualityChoices({ ...config, model: selectedVideo, videoModel: selectedVideo }, faceModel);
    const videoQualityOptions = faceModel ? faceQuality.map((value) => ({ value, label: videoQualityLabel(value) })) : DEFAULT_VIDEO_QUALITIES;
    const videoRatioOptions = faceModel ? [...RUNNINGHUB_H3_FACE_RATIOS] : ASPECT_RATIOS;
    const videoRatioValue = faceModel
        ? normalizeH3FaceRatio(settings.videoSize || settings.aspectRatio || "16:9")
        : settings.videoSize || settings.aspectRatio || "16:9";
    const instanceType = normalizeRunningHubInstanceType(settings.runningHubInstanceType);

    const readFile = async (file: File) => {
        const text = await file.text();
        onChange({ sourceText: text, fileName: file.name });
    };

    return (
        <section className="flex flex-col gap-4">
            <Segmented
                block
                disabled={disabled}
                value={settings.sourceMode}
                onChange={(value) => onChange({ sourceMode: value as ScriptSettings["sourceMode"] })}
                options={[
                    { value: "generate", label: "AI 创意生成" },
                    { value: "upload", label: "上传剧本" },
                    { value: "rewrite", label: "剧本改写" },
                ]}
            />
            {settings.sourceMode === "generate" ? (
                <Field label="创意">
                    <Input.TextArea disabled={disabled} autoSize={{ minRows: 4, maxRows: 10 }} value={settings.idea} placeholder="一句话或一段描述：人物、冲突、结局都可以写进来" onChange={(event) => onChange({ idea: event.target.value })} />
                </Field>
            ) : (
                <Field label="参考剧本" hint={settings.fileName ? `已读取：${settings.fileName}，${settings.sourceText.length} 字` : "支持 .txt / .md，也可以直接粘贴"}>
                    <input
                        type="file"
                        accept=".txt,.md,text/plain,text/markdown"
                        disabled={disabled}
                        className="text-xs text-stone-500 file:mr-3 file:rounded-md file:border-0 file:bg-stone-800 file:px-3 file:py-1.5 file:text-white"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void readFile(file);
                            event.target.value = "";
                        }}
                    />
                    <Input.TextArea disabled={disabled} autoSize={{ minRows: 5, maxRows: 12 }} value={settings.sourceText} onChange={(event) => onChange({ sourceText: event.target.value })} />
                </Field>
            )}
            {settings.sourceMode === "rewrite" ? (
                <Field label="改写要求">
                    <Input.TextArea disabled={disabled} autoSize={{ minRows: 2, maxRows: 6 }} value={settings.rewriteInstruction} placeholder="例如：改成都市职场背景，结局改为主角主动离开" onChange={(event) => onChange({ rewriteInstruction: event.target.value })} />
                </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
                <Field label="剧本模式">
                    <Segmented
                        block
                        disabled={disabled}
                        value={settings.scriptMode}
                        onChange={(value) => onChange({ scriptMode: value as ScriptSettings["scriptMode"] })}
                        options={[
                            { value: "plot", label: "剧情" },
                            { value: "narration", label: "解说" },
                        ]}
                    />
                </Field>
                <Field label="视频提示词格式">
                    <Select
                        disabled={disabled}
                        value={settings.promptMode}
                        onChange={(value) => onChange({ promptMode: value, clipMaxSeconds: Math.min(settings.clipMaxSeconds, value === "seedance-2.5" ? 30 : 15) })}
                        options={[
                            { value: "seedance-2.0", label: "Seedance 2.0（单片 ≤15 秒）" },
                            { value: "seedance-2.5", label: "Seedance 2.5（单片 ≤30 秒）" },
                        ]}
                    />
                </Field>
                <Field label="目标集数" hint="支持自定义 1–200 集">
                    <InputNumber disabled={disabled} className="!w-full" min={1} max={200} precision={0} value={settings.episodeCount} onChange={(value) => onChange({ episodeCount: Math.max(1, Math.min(200, Math.floor(Number(value) || 1))) })} />
                </Field>
                <Field label="单片最长秒数">
                    <InputNumber disabled={disabled} className="!w-full" min={4} max={settings.promptMode === "seedance-2.5" ? 30 : 15} value={settings.clipMaxSeconds} onChange={(value) => onChange({ clipMaxSeconds: Number(value) || 15 })} />
                </Field>
                <Field label="画面比例" hint="素材生图默认 16:9；选 auto 为自适应">
                    <Select disabled={disabled} value={settings.aspectRatio || "16:9"} onChange={(value) => onChange({ aspectRatio: value })} options={ASPECT_RATIOS.map((value) => ({ value, label: value === "auto" ? "自适应" : value }))} />
                </Field>
                <Field label="生图画质">
                    <Select disabled={disabled} value={settings.imageQuality || "2K"} onChange={(value) => onChange({ imageQuality: value })} options={IMAGE_QUALITIES.map((value) => ({ value, label: value }))} />
                </Field>
                <Field label="视频清晰度" hint={faceModel ? `人脸优化版：${videoQualityOptions.map((item) => item.label).join(" / ")}；成片按短边对齐裁剪（如 9:16@1080→1080×1920）` : "按所选视频模型能力；分集编辑栏可快捷改"}>
                    <Select
                        disabled={disabled}
                        value={faceModel && !videoQualityOptions.some((item) => item.value === (settings.videoQuality || "720")) ? "720" : settings.videoQuality || "720"}
                        onChange={(value) => onChange({ videoQuality: value })}
                        options={videoQualityOptions}
                    />
                </Field>
                <Field label="视频比例" hint={faceModel ? "人脸优化版仅 9:16 / 16:9" : "可与素材生图比例分开；空则跟画面比例"}>
                    <Select
                        disabled={disabled}
                        value={videoRatioValue}
                        onChange={(value) => onChange({ videoSize: faceModel ? normalizeH3FaceRatio(value) : value })}
                        options={videoRatioOptions.map((value) => ({ value, label: value === "auto" ? "自适应" : value }))}
                    />
                </Field>
                {faceModel ? null : (
                    <Field label="视频模式">
                        <Select
                            disabled={disabled}
                            value={settings.videoMode || "reference"}
                            onChange={(value) => onChange({ videoMode: value })}
                            options={[
                                { value: "reference", label: "全能参考模式" },
                                { value: "frames", label: "首尾帧模式" },
                            ]}
                        />
                    </Field>
                )}
                <Field
                    label={
                        <span className="inline-flex items-center gap-1.5">
                            <span>运行模式</span>
                            <Tooltip
                                title={
                                    <div className="max-w-xs space-y-2 text-xs leading-5">
                                        <div>{INSTANCE_TIPS.default}</div>
                                        <div>{INSTANCE_TIPS.plus}</div>
                                        <div>{INSTANCE_TIPS.ultra}</div>
                                    </div>
                                }
                                placement="top"
                            >
                                <button type="button" className="inline-grid size-4 place-items-center rounded-full opacity-70 transition hover:opacity-100" aria-label="RunningHub 运行模式说明" onMouseDown={(event) => event.stopPropagation()}>
                                    <CircleHelp className="size-3.5" />
                                </button>
                            </Tooltip>
                        </span>
                    }
                    hint="与视频创作台相同：default=24G · plus=48G（84G 已停用）"
                >
                    <Select
                        disabled={disabled}
                        value={instanceType}
                        onChange={(value) => onChange({ runningHubInstanceType: value })}
                        options={RUNNINGHUB_INSTANCE_OPTIONS.filter((item) => !item.disabled).map((item) => ({
                            value: item.value,
                            label: `${item.vram}（${item.value === "default" ? "Standard" : "Plus"}）`,
                        }))}
                    />
                </Field>
                {faceDeOil ? (
                    <Field label="去油腻" hint="数值越大，去油腻越明显，但是会影响动态。对应 LoRA 模型强度，默认 0.4">
                        <InputNumber
                            disabled={disabled}
                            className="!w-full"
                            min={0}
                            max={1}
                            step={0.01}
                            value={clampH3DeOilStrength(settings.h3DeOilStrength)}
                            onChange={(value) => onChange({ h3DeOilStrength: String(clampH3DeOilStrength(value ?? 0.4)) })}
                        />
                    </Field>
                ) : null}
                <Field label="生图并发" hint="批量缺图 / 多张素材同时请求 API，建议 4–8">
                    <InputNumber
                        disabled={disabled}
                        className="!w-full"
                        min={1}
                        max={12}
                        value={settings.imageConcurrency ?? 6}
                        onChange={(value) => onChange({ imageConcurrency: Math.min(12, Math.max(1, Number(value) || 6)) })}
                    />
                </Field>
                <Field label="生视频并发" hint="批量缺视频时同时请求 API，建议 3–6">
                    <InputNumber
                        disabled={disabled}
                        className="!w-full"
                        min={1}
                        max={12}
                        value={settings.videoConcurrency ?? 4}
                        onChange={(value) => onChange({ videoConcurrency: Math.min(12, Math.max(1, Number(value) || 4)) })}
                    />
                </Field>
                <Field label="自动审核">
                    <div className="flex h-8 items-center gap-2 text-xs text-stone-500">
                        <Switch disabled={disabled} checked={settings.autoReview} onChange={(checked) => onChange({ autoReview: checked })} />
                        每个阶段生成后自动检查并局部修补
                    </div>
                </Field>
            </div>

            <Field label="视觉风格" hint="从风格库选预设；也可直接填写自定义风格名">
                <StyleLibraryField
                    disabled={disabled}
                    selected={selectedStyle}
                    onChange={(preset) => onChange(preset ? { visualStyle: preset.label, stylePrompt: preset.prompt } : { visualStyle: "", stylePrompt: "" })}
                />
                <Input disabled={disabled} value={settings.visualStyle} placeholder="自定义风格名，例如：真人写实 · 电影感" onChange={(event) => onChange({ visualStyle: event.target.value, stylePrompt: selectedStyle && event.target.value === selectedStyle.label ? settings.stylePrompt : "" })} />
            </Field>

            <div className="grid gap-3">
                <Field label="文本模型（大语言）" hint="先选供应商，再选该供应商下的文本模型">
                    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
                        <ModelPicker config={config} value={settings.textModel} onChange={(value) => onChange({ textModel: value })} capability="text" fullWidth onMissingConfig={() => openConfigDialog(true)} />
                    </div>
                </Field>
                <Field label="图片模型" hint="先选供应商，再选图片模型；可清空用画布默认">
                    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
                        <ModelPicker config={config} value={settings.imageModel} onChange={(value) => onChange({ imageModel: value })} capability="image" fullWidth placeholder="使用画布默认图片模型" onMissingConfig={() => openConfigDialog(true)} />
                    </div>
                </Field>
                <Field label="视频模型" hint="人脸优化版走工作流调用（与视频创作台一致）">
                    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
                        <ModelPicker config={config} value={settings.videoModel} onChange={(value) => onChange({ videoModel: value })} capability="video" fullWidth placeholder="使用画布默认视频模型" onMissingConfig={() => openConfigDialog(true)} />
                    </div>
                </Field>
            </div>
        </section>
    );
}
