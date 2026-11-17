import type { ScriptSettings } from "./document";
import type { StudioEpisode, StudioScriptScene } from "../types";

/** Matches SHUO `UPLOADED_EPISODE_HEADING_PATTERN` (集/话/回 / Episode). */
const EPISODE_HEADING =
    /^[ \t]*(?:#{1,6}[ \t]*)?(?:第[ \t]*([0-9０-９零〇一二三四五六七八九十百千两]+)[ \t]*(?:集|话|回)|(?:episode|ep\.?)\s*([0-9０-９]+))[ \t]*(?:[：:.\-—·|][ \t]*)?(.*?)[ \t]*$/iu;

const SCENE_HEADING =
    /^(?:(?:\d{1,4}[.)、-]\s*)?(?:INT|EXT|EST|INT\.\/EXT|INT\/EXT|I\/E)(?:\.|\s)\s*\S|(?:第\s*[0-9０-９零〇一二三四五六七八九十百千两]+\s*场|场景\s*[0-9０-９零〇一二三四五六七八九十百千两]+)(?:\s|[：:.、\-—])\s*\S|(?:\d{1,4}[.)、-]\s*)?(?:(?:日|夜|晨|早晨|上午|中午|下午|傍晚|黄昏|黎明|凌晨)\s+)?(?:内景|外景|内外景|内外|内|外)(?:\s|[：:.、\-—])\s*\S)/iu;

const EMPTY_ENDING = { characters: [] as string[], props: [] as string[], unresolvedThreads: [] as string[] };

const CN_DIGITS: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
};

function normalizeDigits(raw: string) {
    return raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
}

function parseChineseNumber(raw: string) {
    const text = normalizeDigits(raw.trim());
    if (/^\d+$/.test(text)) return Number(text);
    if (!text) return NaN;
    if (text === "十") return 10;
    let total = 0;
    let current = 0;
    for (const ch of text) {
        if (ch === "十") {
            total += (current || 1) * 10;
            current = 0;
            continue;
        }
        if (ch === "百") {
            total += (current || 1) * 100;
            current = 0;
            continue;
        }
        if (ch === "千") {
            total += (current || 1) * 1000;
            current = 0;
            continue;
        }
        if (ch in CN_DIGITS) {
            current = CN_DIGITS[ch];
            continue;
        }
        return NaN;
    }
    return total + current;
}

function extractCharacters(lines: string[]) {
    const names = new Set<string>();
    for (const line of lines) {
        const match = line.match(/^[\s　]*([^\s：:]{1,12})[：:]/);
        if (match?.[1] && !/^(旁白|画外音|字幕|VO|NARRATOR)$/i.test(match[1])) names.add(match[1]);
    }
    return [...names];
}

function splitScenes(fullText: string, episodeRef: string, fallbackHeading: string): StudioScriptScene[] {
    const lines = fullText.split(/\r?\n/);
    const heads: number[] = [];
    lines.forEach((line, index) => {
        if (SCENE_HEADING.test(line.trim())) heads.push(index);
    });
    if (!heads.length) {
        return [
            {
                ref: `${episodeRef}-scene-1`,
                heading: fallbackHeading || "未命名场次",
                characters: extractCharacters(lines),
                body: fullText,
            },
        ];
    }
    return heads.map((start, index) => {
        const end = heads[index + 1] ?? lines.length;
        const chunk = lines.slice(start, end);
        const heading = chunk[0]?.trim() || `场${index + 1}`;
        const body = chunk.slice(1).join("\n").trim() || chunk.join("\n").trim();
        return {
            ref: `${episodeRef}-scene-${index + 1}`,
            heading,
            characters: extractCharacters(chunk),
            body,
        };
    });
}

type EpisodeChunk = { number: number; title: string; body: string };

function splitEpisodes(sourceText: string): EpisodeChunk[] {
    const text = sourceText.replace(/^\uFEFF/, "").trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const marks: Array<{ line: number; number: number; title: string }> = [];
    lines.forEach((line, index) => {
        const match = line.match(EPISODE_HEADING);
        if (!match) return;
        const number = parseChineseNumber(match[1] || match[2] || "");
        marks.push({ line: index, number: Number.isFinite(number) && number > 0 ? number : marks.length + 1, title: (match[3] || "").trim() });
    });
    if (!marks.length) {
        return [{ number: 1, title: "第1集", body: text }];
    }
    return marks.map((mark, index) => {
        const end = marks[index + 1]?.line ?? lines.length;
        const body = lines
            .slice(mark.line + 1, end)
            .join("\n")
            .trim();
        return {
            number: mark.number || index + 1,
            title: mark.title || `第${mark.number || index + 1}集`,
            body: body || lines[mark.line] || "",
        };
    });
}

/** SHUO upload-original: keep original chapter text as episode scripts; no AI expansion. */
export function importUploadedEpisodes(settings: ScriptSettings): StudioEpisode[] {
    const chunks = splitEpisodes(settings.sourceText);
    if (!chunks.length) throw new Error("请上传或粘贴参考剧本。");
    return chunks.map((chunk, index) => {
        const number = chunk.number || index + 1;
        const id = `episode-${number}`;
        const title = chunk.title || `第${number}集`;
        const scenes = splitScenes(chunk.body, id, title);
        return {
            id,
            number,
            title,
            synopsis: chunk.body.slice(0, 160).replace(/\s+/g, " "),
            hook: "",
            continuityFacts: [],
            endingState: { ...EMPTY_ENDING },
            script: { scenes, continuityFacts: [], endingState: { ...EMPTY_ENDING } },
            clips: [],
        };
    });
}

export function uploadImportBanner() {
    return "已按原剧本结构导入，正文未扩写";
}
