import type { ReactNode } from "react";
import { InputNumber, Select, Switch } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { analysisSupportsAudio } from "@/studios/replication/analysis";
import { PROMPT_MODE_LIMITS, SOURCE_STYLE_ID, TARGET_LOCALES, type ReplicationSettings } from "@/studios/replication/document";
import { VIDEO_STYLE_OPTIONS } from "@/studios/replication/stages";
import { useConfigStore } from "@/stores/use-config-store";

const ASPECT_RATIOS = ["9:16", "16:9", "1:1", "3:4", "4:3"];

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{label}</span>
            {children}
            {hint ? <span className="text-xs text-stone-400">{hint}</span> : null}
        </label>
    );
}

export function ReplicationSettingsPanel({ settings, disabled, onChange }: { settings: ReplicationSettings; disabled: boolean; onChange: (patch: Partial<ReplicationSettings>) => void }) {
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const analysisModel = settings.analysisModel || settings.textModel || config.textModel;
    const hearsAudio = analysisModel ? analysisSupportsAudio(analysisModel) : false;
    const limit = PROMPT_MODE_LIMITS[settings.promptMode];

    return (
        <section className="flex flex-col gap-4">
            <div className="grid gap-3">
                <Field label="看原片模型（大语言）" hint={analysisModel ? (hearsAudio ? "Gemini 接口：同时发送镜头截图和原片音轨" : "非 Gemini 接口只能看截图，听不到原片人声") : "先选供应商，再选支持图片理解的文本模型"}>
                    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
                        <ModelPicker config={config} value={settings.analysisModel} onChange={(value) => onChange({ analysisModel: value })} capability="text" fullWidth placeholder="默认同文本模型" onMissingConfig={() => openConfigDialog(true)} />
                    </div>
                </Field>
                <Field label="文本模型（分镜、素材、审核）" hint="先选供应商，再选文本模型">
                    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
                        <ModelPicker config={config} value={settings.textModel} onChange={(value) => onChange({ textModel: value })} capability="text" fullWidth onMissingConfig={() => openConfigDialog(true)} />
                    </div>
                </Field>
                <Field label="图片模型" hint="先选供应商，再选图片模型">
                    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
                        <ModelPicker config={config} value={settings.imageModel} onChange={(value) => onChange({ imageModel: value })} capability="image" fullWidth placeholder="使用画布默认图片模型" onMissingConfig={() => openConfigDialog(true)} />
                    </div>
                </Field>
                <Field label="视频模型" hint="先选供应商，再选视频模型">
                    <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
                        <ModelPicker config={config} value={settings.videoModel} onChange={(value) => onChange({ videoModel: value })} capability="video" fullWidth placeholder="使用画布默认视频模型" onMissingConfig={() => openConfigDialog(true)} />
                    </div>
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="视频提示词格式">
                    <Select
                        disabled={disabled}
                        value={settings.promptMode}
                        onChange={(value) => onChange({ promptMode: value, clipMaxSeconds: Math.min(settings.clipMaxSeconds, PROMPT_MODE_LIMITS[value]) })}
                        options={[
                            { value: "seedance-2.0", label: "Seedance 2.0" },
                            { value: "seedance-2.5", label: "Seedance 2.5" },
                        ]}
                    />
                </Field>
                <Field label="单片最长秒数">
                    <InputNumber disabled={disabled} className="!w-full" min={4} max={limit} value={settings.clipMaxSeconds} onChange={(value) => onChange({ clipMaxSeconds: Math.min(limit, Number(value) || limit) })} />
                </Field>
                <Field label="画面比例">
                    <Select disabled={disabled} value={settings.aspectRatio} onChange={(value) => onChange({ aspectRatio: value })} options={ASPECT_RATIOS.map((value) => ({ value, label: value }))} />
                </Field>
                <Field label="声音语言">
                    <Select disabled={disabled} value={settings.targetLocale} onChange={(value) => onChange({ targetLocale: value })} options={TARGET_LOCALES} />
                </Field>
            </div>
            <Field label="目标视觉风格" hint="保留原片风格时，视频按原片场戏的色调和光影生成">
                <Select
                    showSearch
                    disabled={disabled}
                    optionFilterProp="label"
                    value={settings.styleId || SOURCE_STYLE_ID}
                    onChange={(value) => onChange({ styleId: value })}
                    options={[{ value: SOURCE_STYLE_ID, label: "保留原片风格" }, ...VIDEO_STYLE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))]}
                />
            </Field>
            <Field label="自动审核">
                <div className="flex h-8 items-center gap-2 text-xs text-stone-500">
                    <Switch disabled={disabled} checked={settings.autoReview} onChange={(checked) => onChange({ autoReview: checked })} />
                    分镜生成后对照原片记录审核并局部修补
                </div>
            </Field>
        </section>
    );
}
