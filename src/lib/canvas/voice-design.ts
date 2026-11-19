/** Spoken line for a VoiceStudio design node. The generated audio reads this text. */
export const VOICE_DESIGN_READING =
    "你有没有发现，生活中有很多事情，看起来很简单，真正做起来却并不容易？就像今天早上，我走在回家的路上，阳光透过树叶，轻轻洒在地面。远处传来孩子们的笑声，风吹过的时候，空气里带着一点淡淡的花香。那一刻，我忽然觉得，平凡的日子，其实也有很多值得珍惜的地方。";

export type VoiceDesignAttrs = {
    Gender: string;
    Age: string;
    Pitch: string;
    Style: string;
    EnglishAccent: string;
    ChineseDialect: string;
};

/** VoiceStudio seed is a signed 32-bit integer. */
export function randomVoiceDesignSeed() {
    return String(Math.floor(Math.random() * 2147483647));
}

export const VOICE_DESIGN_ATTR_DEFAULTS: VoiceDesignAttrs = {
    Gender: "Auto",
    Age: "Auto",
    Pitch: "Auto",
    Style: "Auto",
    EnglishAccent: "Auto",
    ChineseDialect: "Auto",
};

export type VoiceDesignChoice = { value: string; labelKey: string };

export const VOICE_DESIGN_GENDER: VoiceDesignChoice[] = [
    { value: "Auto", labelKey: "canvas.voiceDesign.auto" },
    { value: "male", labelKey: "canvas.voiceDesign.male" },
    { value: "female", labelKey: "canvas.voiceDesign.female" },
];

export const VOICE_DESIGN_AGE: VoiceDesignChoice[] = [
    { value: "Auto", labelKey: "canvas.voiceDesign.auto" },
    { value: "child", labelKey: "canvas.voiceDesign.child" },
    { value: "teenager", labelKey: "canvas.voiceDesign.teenager" },
    { value: "young adult", labelKey: "canvas.voiceDesign.youngAdult" },
    { value: "middle-aged", labelKey: "canvas.voiceDesign.middleAged" },
    { value: "elderly", labelKey: "canvas.voiceDesign.elderly" },
];

export const VOICE_DESIGN_PITCH: VoiceDesignChoice[] = [
    { value: "Auto", labelKey: "canvas.voiceDesign.auto" },
    { value: "very low pitch", labelKey: "canvas.voiceDesign.pitchVeryLow" },
    { value: "low pitch", labelKey: "canvas.voiceDesign.pitchLow" },
    { value: "moderate pitch", labelKey: "canvas.voiceDesign.pitchMid" },
    { value: "high pitch", labelKey: "canvas.voiceDesign.pitchHigh" },
    { value: "very high pitch", labelKey: "canvas.voiceDesign.pitchVeryHigh" },
];

export const VOICE_DESIGN_STYLE: VoiceDesignChoice[] = [
    { value: "Auto", labelKey: "canvas.voiceDesign.auto" },
    { value: "whisper", labelKey: "canvas.voiceDesign.whisper" },
];

export const VOICE_DESIGN_ACCENT: VoiceDesignChoice[] = [
    { value: "Auto", labelKey: "canvas.voiceDesign.auto" },
    { value: "american accent", labelKey: "canvas.voiceDesign.accentAmerican" },
    { value: "british accent", labelKey: "canvas.voiceDesign.accentBritish" },
    { value: "australian accent", labelKey: "canvas.voiceDesign.accentAustralian" },
    { value: "canadian accent", labelKey: "canvas.voiceDesign.accentCanadian" },
    { value: "indian accent", labelKey: "canvas.voiceDesign.accentIndian" },
    { value: "chinese accent", labelKey: "canvas.voiceDesign.accentChinese" },
    { value: "korean accent", labelKey: "canvas.voiceDesign.accentKorean" },
    { value: "japanese accent", labelKey: "canvas.voiceDesign.accentJapanese" },
    { value: "portuguese accent", labelKey: "canvas.voiceDesign.accentPortuguese" },
    { value: "russian accent", labelKey: "canvas.voiceDesign.accentRussian" },
];

export type VoiceDesignPreset = {
    id: string;
    labelKey: string;
    attrs: VoiceDesignAttrs;
};

function voiceDesignPreset(id: string, labelKey: string, attrs: Partial<VoiceDesignAttrs>): VoiceDesignPreset {
    return { id, labelKey, attrs: { ...VOICE_DESIGN_ATTR_DEFAULTS, ...attrs } };
}

/** VoiceStudio personality chips. Instruct tokens only; omitted categories stay Auto. */
export const VOICE_DESIGN_PERSONALITIES: VoiceDesignPreset[] = [
    voiceDesignPreset("personality-narrator", "canvas.voiceDesign.presetNarrator", { Age: "middle-aged", Pitch: "low pitch" }),
    voiceDesignPreset("personality-casual", "canvas.voiceDesign.presetCasual", { Age: "young adult", Pitch: "moderate pitch" }),
    voiceDesignPreset("personality-news-anchor", "canvas.voiceDesign.presetNewsAnchor", { Age: "middle-aged", Pitch: "moderate pitch", EnglishAccent: "american accent" }),
    voiceDesignPreset("personality-storyteller", "canvas.voiceDesign.presetStoryteller", { Age: "middle-aged", Pitch: "moderate pitch", EnglishAccent: "british accent" }),
    voiceDesignPreset("personality-corporate", "canvas.voiceDesign.presetCorporate", { Age: "middle-aged", Pitch: "moderate pitch" }),
    voiceDesignPreset("personality-energetic", "canvas.voiceDesign.presetEnergetic", { Age: "young adult", Pitch: "high pitch" }),
];

/** VoiceStudio starting-point presets under the personality chips. */
export const VOICE_DESIGN_STARTS: VoiceDesignPreset[] = [
    voiceDesignPreset("start-authoritative", "canvas.voiceDesign.presetAuthoritative", { Gender: "male", Age: "middle-aged", Pitch: "low pitch", EnglishAccent: "british accent" }),
    voiceDesignPreset("start-excited-child", "canvas.voiceDesign.presetExcitedChild", { Age: "child", Pitch: "high pitch" }),
    voiceDesignPreset("start-whisper", "canvas.voiceDesign.presetWhisper", { Age: "young adult", Style: "whisper" }),
    voiceDesignPreset("start-surprised", "canvas.voiceDesign.presetSurprised", { Gender: "female", Age: "young adult", Pitch: "high pitch" }),
    voiceDesignPreset("start-elder", "canvas.voiceDesign.presetElder", { Gender: "male", Age: "elderly", Pitch: "very low pitch" }),
    voiceDesignPreset("start-sichuan", "canvas.voiceDesign.presetSichuan", { Gender: "female", Age: "young adult", Pitch: "moderate pitch", ChineseDialect: "四川话" }),
];

export const VOICE_DESIGN_PRESETS: VoiceDesignPreset[] = [...VOICE_DESIGN_PERSONALITIES, ...VOICE_DESIGN_STARTS];

export function voiceDesignPresetMatches(current: VoiceDesignAttrs, preset: VoiceDesignPreset) {
    return (Object.keys(VOICE_DESIGN_ATTR_DEFAULTS) as (keyof VoiceDesignAttrs)[]).every((key) => current[key] === preset.attrs[key]);
}

export const VOICE_DESIGN_DIALECT: VoiceDesignChoice[] = [
    { value: "Auto", labelKey: "canvas.voiceDesign.auto" },
    { value: "河南话", labelKey: "canvas.voiceDesign.dialectHenan" },
    { value: "陕西话", labelKey: "canvas.voiceDesign.dialectShaanxi" },
    { value: "四川话", labelKey: "canvas.voiceDesign.dialectSichuan" },
    { value: "贵州话", labelKey: "canvas.voiceDesign.dialectGuizhou" },
    { value: "云南话", labelKey: "canvas.voiceDesign.dialectYunnan" },
    { value: "桂林话", labelKey: "canvas.voiceDesign.dialectGuilin" },
    { value: "济南话", labelKey: "canvas.voiceDesign.dialectJinan" },
    { value: "石家庄话", labelKey: "canvas.voiceDesign.dialectShijiazhuang" },
    { value: "甘肃话", labelKey: "canvas.voiceDesign.dialectGansu" },
    { value: "宁夏话", labelKey: "canvas.voiceDesign.dialectNingxia" },
    { value: "青岛话", labelKey: "canvas.voiceDesign.dialectQingdao" },
    { value: "东北话", labelKey: "canvas.voiceDesign.dialectDongbei" },
];
