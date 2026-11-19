import type { ReactNode } from "react";
import { Input, Select, Slider, Switch } from "antd";

import { ModelPicker } from "@/components/model-picker";
import type { ReplacementSettings } from "@/studios/replacement/document";
import { REPLACEMENT_PROMPTS } from "@/studios/prompts/replacement.generated";
import { useConfigStore } from "@/stores/use-config-store";

import { QUALITY_OPTIONS, resolveRunningHubVideoOptionValue, useRunningHubVideoOptions } from "./ui";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-neutral-300">{label}</span>
            {children}
            {hint ? <span className="text-xs leading-5 text-neutral-500">{hint}</span> : null}
        </label>
    );
}

function Toggle({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
    return (
        <div className="flex items-center gap-2 text-xs text-neutral-400">
            <Switch size="small" disabled={disabled} checked={checked} onChange={onChange} />
            {children}
        </div>
    );
}

export function ReplacementSettingsPanel({ settings, disabled, onChange }: { settings: ReplacementSettings; disabled: boolean; onChange: (patch: Partial<ReplacementSettings>) => void }) {
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const videoModels = useRunningHubVideoOptions();
    return (
        <section className="flex flex-col gap-4">
            <Field label="图像替换模型" hint="先选供应商，再选图片模型；推荐 gpt-image-2 系列">
                <div className="flex gap-2">
                    <div className={`min-w-0 flex-1 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
                        <ModelPicker config={config} value={settings.imageModel} onChange={(value) => onChange({ imageModel: value })} capability="image" fullWidth placeholder="使用画布默认图片模型" onMissingConfig={() => openConfigDialog(true)} />
                    </div>
                    <Select className="w-28" disabled={disabled} value={settings.imageQuality || "auto"} onChange={(value) => onChange({ imageQuality: value })} options={QUALITY_OPTIONS} />
                </div>
            </Field>
            <Field label="视频替换模型" hint="仅 RunningHub 视频编辑应用（供应商已固定）；需在 API 设置填写密钥">
                <Select
                    disabled={disabled}
                    showSearch
                    optionFilterProp="label"
                    allowClear
                    placeholder="视频编辑 Scail V1"
                    value={resolveRunningHubVideoOptionValue(settings.videoModel, videoModels) || undefined}
                    onChange={(value) => onChange({ videoModel: value || "" })}
                    options={videoModels}
                />
            </Field>
            <Field label="看图模型（大语言）" hint="先选供应商，再选文本/多模态模型；听写仍走 VoiceStudio">
                <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
                    <ModelPicker config={config} value={settings.visionModel} onChange={(value) => onChange({ visionModel: value })} capability="text" fullWidth placeholder="默认同画布文本模型" onMissingConfig={() => openConfigDialog(true)} />
                </div>
            </Field>
            <Field label="人声听写（VoiceStudio ASR）" hint="经文件机调用局域网 VoiceStudio /v1/audio/transcriptions（在后端环境变量配置地址）。未启动时会提示连接失败。">
                <div className="flex gap-2">
                    <Input disabled={disabled} className="flex-1" value={settings.asrModel || "whisper-1"} placeholder="whisper-1" onChange={(event) => onChange({ asrModel: event.target.value })} />
                    <Input disabled={disabled} className="w-24" value={settings.asrLanguage ?? "zh"} placeholder="语言" onChange={(event) => onChange({ asrLanguage: event.target.value })} />
                </div>
            </Field>
            <Field label="声音克隆引擎" hint="在局域网 GPU 主机上运行 IndexTTS（:7860）或 VoiceStudio（:3901）。声音工作室页也可切换。">
                <Select
                    disabled={disabled}
                    value={settings.ttsEngine || "indextts"}
                    onChange={(value) => onChange({ ttsEngine: value })}
                    options={[
                        { value: "indextts", label: "IndexTTS（本地 GPU）" },
                        { value: "voicestudio", label: "VoiceStudio（本地 GPU）" },
                    ]}
                />
            </Field>
            <Field label="原人物描述">
                <Toggle checked={settings.useSourceDescriptions} disabled={disabled} onChange={(checked) => onChange({ useSourceDescriptions: checked })}>
                    替换前先识别选框里的原人物，用文字描述定位
                </Toggle>
            </Field>
            <Field label="拖拽绑定">
                <Toggle checked={settings.syncIdentity} disabled={disabled} onChange={(checked) => onChange({ syncIdentity: checked })}>
                    把素材拖到人物框时，同步到同一人物出现的所有镜头
                </Toggle>
            </Field>
            <Field label="视频替换默认提示词">
                <Input.TextArea disabled={disabled} autoSize={{ minRows: 2, maxRows: 5 }} value={settings.videoPrompt} placeholder={REPLACEMENT_PROMPTS.defaultVideoPrompt} onChange={(event) => onChange({ videoPrompt: event.target.value })} />
            </Field>
            <Field label="合成时原声 / 背景声音量" hint="已分离人声时使用背景声；未分离时，有克隆配音的句子会自动静音原声">
                <Slider disabled={disabled} min={0} max={1} step={0.05} value={settings.originalAudioVolume} onChange={(value) => onChange({ originalAudioVolume: value })} />
            </Field>
        </section>
    );
}
