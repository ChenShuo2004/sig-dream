import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "../server/index.mjs";
import { launchChromium, loadPlaywright } from "./_playwright.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "demos");
const TMP_ROOT = join(ROOT, "release", "demo-frames-tmp");
const SAMPLE_IMAGE = join(ROOT, "docs", "screenshots", "canvas-board.png");

const FPS = 24;
const VIEWPORT = { width: 1440, height: 810 };
const DEVICE_SCALE_FACTOR = 1.5; // 2160x1215 -> lanczos downscale to crisp 1920x1080

mkdirSync(OUT_DIR, { recursive: true });

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const HUD_INIT_SCRIPT = `
(() => {
    window.__demoHud = {
        x: 720,
        y: 405,
        badge: "",
        caption: "",
        ensure() {
            let root = document.getElementById("__sig_demo_hud__");
            if (root) return root;
            root = document.createElement("div");
            root.id = "__sig_demo_hud__";
            root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;";
            root.innerHTML = \`
                <div id="__sig_demo_badge__" style="position:fixed;top:52px;right:20px;display:flex;align-items:center;gap:8px;padding:6px 13px;border-radius:999px;background:rgba(12,10,9,0.78);border:1px solid rgba(255,255,255,0.14);backdrop-filter:blur(12px);color:#fafaf9;font-size:12px;font-weight:600;letter-spacing:0.02em;box-shadow:0 10px 28px rgba(0,0,0,0.32);opacity:0;transition:opacity 0.2s ease;"></div>
                <div id="__sig_demo_caption__" style="position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:82vw;padding:9px 20px;border-radius:999px;background:rgba(12,10,9,0.86);border:1px solid rgba(255,255,255,0.16);backdrop-filter:blur(14px);color:#fafaf9;font-size:14.5px;font-weight:500;letter-spacing:0.02em;white-space:nowrap;box-shadow:0 14px 36px rgba(0,0,0,0.42);opacity:0;transition:opacity 0.2s ease;"></div>
                <div id="__sig_demo_ripple__" style="position:fixed;left:0;top:0;width:36px;height:36px;margin-left:-18px;margin-top:-18px;border-radius:999px;border:2.5px solid #f59e0b;background:rgba(245,158,11,0.18);transform:translate(-100px,-100px) scale(0.2);opacity:0;pointer-events:none;"></div>
                <div id="__sig_demo_cursor__" style="position:fixed;left:0;top:0;width:26px;height:26px;transform:translate(720px,405px);filter:drop-shadow(0 4px 10px rgba(0,0,0,0.45));pointer-events:none;">
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M4.2 2.6L21.6 12.1C22.5 12.6 22.3 14.0 21.3 14.2L13.6 15.8L9.6 22.5C9.1 23.4 7.7 23.1 7.6 22.1L3.0 3.7C2.8 2.8 3.5 2.2 4.2 2.6Z" fill="#111111" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>
                    </svg>
                </div>
            \`;
            document.documentElement.appendChild(root);
            return root;
        },
        update({ x, y, badge, caption, rippleProgress }) {
            this.ensure();
            if (typeof x === "number" && typeof y === "number") {
                this.x = x;
                this.y = y;
                const cursor = document.getElementById("__sig_demo_cursor__");
                if (cursor) cursor.style.transform = \`translate(\${x.toFixed(1)}px, \${y.toFixed(1)}px)\`;
            }
            if (typeof badge === "string") {
                this.badge = badge;
                const el = document.getElementById("__sig_demo_badge__");
                if (el) {
                    el.textContent = badge;
                    el.style.opacity = badge ? "1" : "0";
                }
            }
            if (typeof caption === "string") {
                this.caption = caption;
                const el = document.getElementById("__sig_demo_caption__");
                if (el) {
                    el.textContent = caption;
                    el.style.opacity = caption ? "1" : "0";
                }
            }
            const ripple = document.getElementById("__sig_demo_ripple__");
            if (ripple) {
                if (typeof rippleProgress === "number" && rippleProgress >= 0 && rippleProgress <= 1) {
                    const scale = 0.35 + rippleProgress * 1.25;
                    const alpha = Math.max(0, 1 - rippleProgress);
                    ripple.style.transform = \`translate(\${this.x.toFixed(1)}px, \${this.y.toFixed(1)}px) scale(\${scale.toFixed(3)})\`;
                    ripple.style.opacity = alpha.toFixed(3);
                } else {
                    ripple.style.opacity = "0";
                }
            }
        }
    };
    document.addEventListener("DOMContentLoaded", () => window.__demoHud.ensure());
})();
`;

class DemoRecorder {
    constructor(page, framesDir, badge) {
        this.page = page;
        this.framesDir = framesDir;
        this.badge = badge;
        this.caption = "";
        this.x = 720;
        this.y = 420;
        this.frameIndex = 0;
        mkdirSync(framesDir, { recursive: true });
    }

    async syncHud(rippleProgress = -1) {
        await this.page.evaluate(
            (payload) => {
                if (window.__demoHud) window.__demoHud.update(payload);
            },
            {
                x: this.x,
                y: this.y,
                badge: this.badge,
                caption: this.caption,
                rippleProgress,
            },
        );
    }

    async snap(rippleProgress = -1) {
        await this.syncHud(rippleProgress);
        this.frameIndex += 1;
        const name = `frame-${String(this.frameIndex).padStart(5, "0")}.jpg`;
        await this.page.screenshot({
            path: join(this.framesDir, name),
            type: "jpeg",
            quality: 94,
        });
    }

    async setCaption(text) {
        this.caption = text;
        await this.syncHud();
    }

    async hold(seconds) {
        const count = Math.max(1, Math.round(seconds * FPS));
        for (let i = 0; i < count; i++) {
            await this.page.waitForTimeout(16);
            await this.snap();
        }
    }

    async moveTo(targetX, targetY, seconds = 0.55) {
        const startX = this.x;
        const startY = this.y;
        const steps = Math.max(2, Math.round(seconds * FPS));
        for (let i = 1; i <= steps; i++) {
            const t = easeInOutCubic(i / steps);
            this.x = startX + (targetX - startX) * t;
            this.y = startY + (targetY - startY) * t;
            await this.page.mouse.move(this.x, this.y);
            await this.snap();
        }
    }

    async moveToLocator(locator, seconds = 0.55) {
        const box = await locator.boundingBox();
        if (!box) return false;
        const tx = box.x + box.width / 2;
        const ty = box.y + box.height / 2;
        await this.moveTo(tx, ty, seconds);
        return true;
    }

    async clickAt(targetX, targetY, { moveSeconds = 0.5, holdAfter = 0.45 } = {}) {
        await this.moveTo(targetX, targetY, moveSeconds);
        await this.page.mouse.click(this.x, this.y);
        const rippleFrames = 8;
        for (let i = 0; i < rippleFrames; i++) {
            await this.page.waitForTimeout(20);
            await this.snap(i / (rippleFrames - 1));
        }
        if (holdAfter > 0) {
            await this.hold(holdAfter);
        }
    }

    async clickLocator(locator, opts = {}) {
        await locator.waitFor({ state: "visible", timeout: 8000 });
        const box = await locator.boundingBox();
        if (!box) throw new Error("Target locator has no boundingBox");
        const tx = box.x + Math.min(box.width * 0.5, Math.max(18, box.width / 2));
        const ty = box.y + box.height / 2;
        await this.clickAt(tx, ty, opts);
    }

    async typeText(text, { charsPerFrame = 2, holdAfter = 0.4 } = {}) {
        const chars = [...text];
        for (let i = 0; i < chars.length; i += charsPerFrame) {
            const chunk = chars.slice(i, i + charsPerFrame).join("");
            await this.page.keyboard.insertText(chunk);
            await this.snap();
        }
        if (holdAfter > 0) await this.hold(holdAfter);
    }

    async smoothScroll(selector, deltaY, seconds = 0.9) {
        const steps = Math.max(2, Math.round(seconds * FPS));
        const stepDelta = deltaY / steps;
        for (let i = 0; i < steps; i++) {
            await this.page.evaluate(
                ({ sel, dy }) => {
                    const el = sel ? document.querySelector(sel) : document.scrollingElement;
                    if (el) el.scrollBy(0, dy);
                },
                { sel: selector, dy: stepDelta },
            );
            await this.snap();
        }
    }

    encodeMp4(outMp4, posterPng) {
        execFileSync(
            "ffmpeg",
            [
                "-y",
                "-framerate",
                String(FPS),
                "-i",
                join(this.framesDir, "frame-%05d.jpg"),
                "-vf",
                `scale=1920:1080:flags=lanczos,fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0, this.frameIndex / FPS - 0.45).toFixed(2)}:d=0.45,format=yuv420p`,
                "-c:v",
                "libx264",
                "-preset",
                "slow",
                "-crf",
                "19",
                "-movflags",
                "+faststart",
                "-an",
                outMp4,
            ],
            { stdio: "pipe" },
        );

        if (posterPng) {
            const midSec = Math.max(1, (this.frameIndex / FPS) * 0.45).toFixed(2);
            execFileSync(
                "ffmpeg",
                ["-y", "-ss", midSec, "-i", outMp4, "-frames:v", "1", posterPng],
                { stdio: "pipe" },
            );
        }

        const outGif = outMp4.replace(/\.mp4$/i, ".gif");
        execFileSync(
            "ffmpeg",
            [
                "-y",
                "-i",
                outMp4,
                "-vf",
                "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
                "-loop",
                "0",
                outGif,
            ],
            { stdio: "pipe" },
        );
    }
}

function probeVideo(filePath) {
    const raw = execFileSync(
        "ffprobe",
        [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate,codec_name:format=duration,size",
            "-of",
            "json",
            filePath,
        ],
        { encoding: "utf8" },
    );
    const parsed = JSON.parse(raw);
    const stream = parsed.streams?.[0] || {};
    const format = parsed.format || {};
    return {
        codec: stream.codec_name,
        width: stream.width,
        height: stream.height,
        fps: stream.r_frame_rate,
        durationSec: Number(Number(format.duration || 0).toFixed(2)),
        sizeKB: Math.round(statSync(filePath).size / 1024),
    };
}

const FALLBACK_DEMO_PROMPTS = [
    {
        id: "demo-poster-01",
        title: "极简黑白工业设计产品海报",
        prompt: "Minimalist monochrome industrial design product poster, matte anodized aluminum camera body floating on sculpted basalt stone, soft diffused top-down studio rim lighting, subtle typographic grid layout, 8k photorealistic commercial photography.",
        description: "高对比极简工业设计商业海报，适合硬件与数码主视觉。",
        coverUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%2318181b'/%3E%3Cstop offset='100%25' stop-color='%2327272a'/%3E%3C/linearGradient%3E%3CradialGradient id='r' cx='50%25' cy='42%25' r='48%25'%3E%3Cstop offset='0%25' stop-color='%23f4f4f5' stop-opacity='0.28'/%3E%3Cstop offset='100%25' stop-color='%2318181b' stop-opacity='0'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='640' height='480' fill='url(%23g)'/%3E%3Crect width='640' height='480' fill='url(%23r)'/%3E%3Crect x='190' y='130' width='260' height='190' rx='26' fill='%2309090b' stroke='%23a1a1aa' stroke-width='2'/%3E%3Ccircle cx='320' cy='225' r='58' fill='%2318181b' stroke='%23e4e4e7' stroke-width='3'/%3E%3Ccircle cx='320' cy='225' r='26' fill='%233f3f46'/%3E%3Ctext x='64' y='420' fill='%23e4e4e7' font-family='sans-serif' font-size='20' font-weight='600' letter-spacing='3'%3EMONOCHROME STUDIO%3C/text%3E%3C/svg%3E",
        tags: ["海报", "工业设计", "商业摄影", "极简"],
    },
    {
        id: "demo-3d-02",
        title: "3D 等距微缩创意分镜工作室海报",
        prompt: "3D isometric cutaway miniature creative film studio, warm tungsten desk lamp, dual ultrawide monitors showing node-based storyboard canvas, tactile clay and brushed metal materials, Octane Render.",
        description: "温暖细腻的 3D 等距视角微缩创作者房间与分镜工作台。",
        coverUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%231c1917'/%3E%3Cstop offset='100%25' stop-color='%23431407'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='480' fill='url(%23g)'/%3E%3Cpolygon points='320,105 490,195 320,285 150,195' fill='%23fb923c' fill-opacity='0.22' stroke='%23fdba74' stroke-width='2'/%3E%3Cpolygon points='150,195 320,285 320,385 150,295' fill='%23ea580c' fill-opacity='0.25' stroke='%23fb923c' stroke-width='2'/%3E%3Cpolygon points='490,195 320,285 320,385 490,295' fill='%239a3412' fill-opacity='0.35' stroke='%23fb923c' stroke-width='2'/%3E%3Ctext x='64' y='426' fill='%23fed7aa' font-family='sans-serif' font-size='20' font-weight='600' letter-spacing='2'%3E3D ISOMETRIC ATELIER%3C/text%3E%3C/svg%3E",
        tags: ["3D", "微缩模型", "等距视角", "海报"],
    },
    {
        id: "demo-cinema-03",
        title: "电影感雨夜霓虹宽银幕海报",
        prompt: "Cinematic 2.39:1 anamorphic film poster still, lone figure beside vintage coupe under rain-slicked overpass, cyan and warm sodium vapor reflections on wet asphalt, 35mm Kodak Vision3 500T grain.",
        description: "宽银幕变形镜头质感雨夜电影关键帧与海报。",
        coverUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%23082f49'/%3E%3Cstop offset='60%25' stop-color='%230f172a'/%3E%3Cstop offset='100%25' stop-color='%23451a03'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='480' fill='url(%23g)'/%3E%3Ccircle cx='460' cy='180' r='90' fill='%23f59e0b' fill-opacity='0.22'/%3E%3Ccircle cx='200' cy='230' r='110' fill='%2338bdf8' fill-opacity='0.18'/%3E%3Crect x='64' y='92' width='512' height='260' rx='8' fill='none' stroke='%237dd3fc' stroke-opacity='0.45' stroke-width='2'/%3E%3Ctext x='64' y='420' fill='%23bae6fd' font-family='sans-serif' font-size='20' font-weight='600' letter-spacing='2'%3EANAMORPHIC STORYBOARD%3C/text%3E%3C/svg%3E",
        tags: ["海报", "电影分镜", "写实", "光影"],
    },
    {
        id: "demo-city-04",
        title: "立体城市地标微缩旅行海报",
        prompt: "Creative 3D city landmark poster floating on soft volumetric clouds, miniature architectural slice with golden sunset light, clean editorial serif title header and coordinates.",
        description: "悬浮云端 3D 城市切片艺术海报，适合文旅与专题视觉。",
        coverUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0%25' stop-color='%231e293b'/%3E%3Cstop offset='100%25' stop-color='%230f172a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='480' fill='url(%23g)'/%3E%3Crect x='180' y='80' width='280' height='310' rx='18' fill='%23334155' fill-opacity='0.55' stroke='%2394a3b8' stroke-width='2'/%3E%3Ccircle cx='320' cy='210' r='68' fill='%23f59e0b' fill-opacity='0.32'/%3E%3Crect x='225' y='215' width='190' height='95' rx='10' fill='%230f172a' stroke='%23cbd5e1' stroke-width='1.5'/%3E%3Ctext x='64' y='432' fill='%23e2e8f0' font-family='sans-serif' font-size='20' font-weight='600' letter-spacing='2'%3ECITYSCAPE POSTER 3D%3C/text%3E%3C/svg%3E",
        tags: ["海报", "3D", "城市", "插画"],
    },
    {
        id: "demo-char-05",
        title: "动画角色三视图与表情设定表",
        prompt: "Character turnaround sheet, front view, side view, back view, plus four expressive headshots, stylized sci-fi courier wearing weathered mustard jacket and utility backpack.",
        description: "标准角色三视图 + 表情设定卡，适合作为画布与剧本角色资产锚点。",
        coverUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'%3E%3Crect width='640' height='480' fill='%2318181b'/%3E%3Crect x='76' y='100' width='140' height='250' rx='14' fill='%2327272a' stroke='%23fbbf24' stroke-opacity='0.6' stroke-width='2'/%3E%3Crect x='250' y='100' width='140' height='250' rx='14' fill='%2327272a' stroke='%23fbbf24' stroke-opacity='0.6' stroke-width='2'/%3E%3Crect x='424' y='100' width='140' height='250' rx='14' fill='%2327272a' stroke='%23fbbf24' stroke-opacity='0.6' stroke-width='2'/%3E%3Ctext x='76' y='420' fill='%23fde68a' font-family='sans-serif' font-size='20' font-weight='600' letter-spacing='2'%3ECHARACTER SHEET%3C/text%3E%3C/svg%3E",
        tags: ["角色设定", "三视图", "动漫", "分镜"],
    },
    {
        id: "demo-glass-06",
        title: "渐变毛玻璃科技发布会主视觉海报",
        prompt: "Futuristic frosted glassmorphism keynote presentation slide and poster, translucent layered cards with subtle iridescent rim glow over deep obsidian background.",
        description: "通透毛玻璃质感科技主视觉与 PPT 海报模板。",
        coverUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%2309090b'/%3E%3Cstop offset='100%25' stop-color='%231e1b4b'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='480' fill='url(%23g)'/%3E%3Ccircle cx='440' cy='170' r='95' fill='%23818cf8' fill-opacity='0.3'/%3E%3Crect x='130' y='130' width='360' height='210' rx='22' fill='%23ffffff' fill-opacity='0.08' stroke='%23a5b4fc' stroke-opacity='0.5' stroke-width='2'/%3E%3Ctext x='76' y='420' fill='%23c7d2fe' font-family='sans-serif' font-size='20' font-weight='600' letter-spacing='2'%3EGLASS KEYNOTE POSTER%3C/text%3E%3C/svg%3E",
        tags: ["海报", "PPT", "UI设计", "3D"],
    },
    {
        id: "demo-infographic-07",
        title: "手绘知识科普信息图海报",
        prompt: "Hand-drawn editorial sketchnote infographic poster on warm cream paper texture, structured flow arrows, clean icons, highlighted callout boxes.",
        description: "将长文或概念转化为结构清晰的暖色手绘知识信息图。",
        coverUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'%3E%3Crect width='640' height='480' fill='%231c1917'/%3E%3Crect x='90' y='88' width='460' height='276' rx='16' fill='%23292524' stroke='%23d6d3d1' stroke-opacity='0.45' stroke-width='2'/%3E%3Cline x1='140' y1='160' x2='340' y2='160' stroke='%23fbbf24' stroke-width='4' stroke-linecap='round'/%3E%3Cline x1='140' y1='215' x2='480' y2='215' stroke='%23a8a29e' stroke-width='3' stroke-linecap='round'/%3E%3Cline x1='140' y1='265' x2='430' y2='265' stroke='%23a8a29e' stroke-width='3' stroke-linecap='round'/%3E%3Ctext x='90' y='420' fill='%23e7e5e4' font-family='sans-serif' font-size='20' font-weight='600' letter-spacing='2'%3ESKETCHNOTE INFOGRAPHIC%3C/text%3E%3C/svg%3E",
        tags: ["海报", "信息图", "插画", "学习"],
    },
    {
        id: "demo-mech-08",
        title: "3D 精密机械爆炸剖面结构图",
        prompt: "3D exploded axonometric cutaway diagram of a precision vintage mechanical watch movement, brass gears, ruby jewels, sapphire crystal layers on dark slate background.",
        description: "高精度 3D 机械爆炸图与剖面工程美学展示。",
        coverUrl: "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'%3E%3Crect width='640' height='480' fill='%230c0a09'/%3E%3Ccircle cx='320' cy='220' r='105' fill='none' stroke='%23f59e0b' stroke-opacity='0.6' stroke-width='2' stroke-dasharray='8 6'/%3E%3Ccircle cx='320' cy='220' r='64' fill='%231c1917' stroke='%23e7e5e4' stroke-width='2.5'/%3E%3Ccircle cx='320' cy='220' r='22' fill='%23f59e0b' fill-opacity='0.45'/%3E%3Ctext x='76' y='420' fill='%23fde68a' font-family='sans-serif' font-size='20' font-weight='600' letter-spacing='2'%3E3D EXPLODED CUTAWAY%3C/text%3E%3C/svg%3E",
        tags: ["3D", "工业设计", "剖面图", "写实"],
    },
];

async function createDemoSession(browser, baseUrl) {
    const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
        locale: "zh-CN",
        colorScheme: "dark",
    });
    await context.addInitScript(HUD_INIT_SCRIPT);
    // Avoid stalling on external GitHub API / broken Twitter hotlinks during deterministic offline rendering
    await context.route("https://api.github.com/**", (route) => route.abort());
    await context.route("https://pbs.twimg.com/**", (route) => route.abort());
    await context.route(/https:\/\/(raw\.githubusercontent\.com|cdn\.jsdelivr\.net|fastly\.jsdelivr\.net)\/.*\/sources\/([^/]+)\.json/, async (route) => {
        try {
            const response = await route.fetch({ timeout: 2500 });
            if (response.ok()) {
                await route.fulfill({ response });
                return;
            }
        } catch {
            // Fall through to deterministic local prompt cards when GitHub/CDN is unreachable
        }
        const url = route.request().url();
        const slug = url.match(/\/sources\/([^/.]+)\.json/)?.[1] || "src";
        const seeded = FALLBACK_DEMO_PROMPTS.map((item, idx) => ({
            ...item,
            id: `${slug}-${item.id}-${idx}`,
        }));
        await route.fulfill({
            status: 200,
            contentType: "application/json; charset=utf-8",
            body: JSON.stringify(seeded),
        });
    });

    const page = await context.newPage();
    await page.goto(`${baseUrl}/#/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h1");
    await page.waitForTimeout(450);
    return { context, page };
}

// ---------------------------------------------------------------------------
// Demo 01: Overview & Zero-DB Local Configuration (~20s)
// ---------------------------------------------------------------------------
async function renderDemo01(browser, baseUrl) {
    const { context, page } = await createDemoSession(browser, baseUrl);
    const framesDir = join(TMP_ROOT, "01");
    const rec = new DemoRecorder(page, framesDir, "01 / 05 · 零数据库启动与多渠道配置");

    try {
        await rec.setCaption("sig-dream：开源、零数据库、本地优先的 AI 无限画布与视频创作工作室");
        await rec.hold(2.2);

        // Hover across the 4 workspace cards on Home
        await rec.setCaption("内置四大核心工作区：无限画布 · 剧本工作室 · 复刻工作室 · 替换工作室");
        const cards = page.locator("section").nth(1).locator(".grid > button");
        for (let i = 0; i < 4; i++) {
            await rec.moveToLocator(cards.nth(i), 0.55);
            await rec.hold(0.45);
        }

        // Open Model Provider Config Modal
        await rec.setCaption("无需注册登录，点击「配置模型渠道」即可接入自有 API Key");
        const configBtn = page.getByRole("button", { name: /配置模型渠道/i }).first();
        await rec.clickLocator(configBtn, { moveSeconds: 0.6, holdAfter: 0.9 });

        // Click Add Channel
        await rec.setCaption("支持 OpenAI 兼容、Gemini、DeepSeek、火山引擎 Seedance、RunningHub 等渠道");
        const addChannelBtn = page.locator(".ant-modal").getByRole("button", { name: /新增渠道|添加渠道/i }).first();
        if (await addChannelBtn.isVisible()) {
            await rec.clickLocator(addChannelBtn, { moveSeconds: 0.55, holdAfter: 1.2 });
            const closeDrawer = page.locator(".ant-drawer-close").first();
            if (await closeDrawer.isVisible()) {
                await rec.clickLocator(closeDrawer, { moveSeconds: 0.45, holdAfter: 0.5 });
            }
        }

        // Switch config tabs: 本地代理 -> WebDAV -> 本地存储
        await rec.setCaption("内置零依赖 CORS 代理、WebDAV 跨设备同步，所有数据与 Key 100% 留在本机");
        const tabs = page.locator(".ant-modal .ant-tabs-tab");
        for (const tabIdx of [1, 4, 5]) {
            if ((await tabs.count()) > tabIdx) {
                await rec.clickLocator(tabs.nth(tabIdx), { moveSeconds: 0.45, holdAfter: 0.85 });
            }
        }

        const doneBtn = page.locator(".ant-modal").getByRole("button", { name: /完成/i }).first();
        if (await doneBtn.isVisible()) {
            await rec.clickLocator(doneBtn, { moveSeconds: 0.45, holdAfter: 1.0 });
        } else {
            await page.keyboard.press("Escape");
            await rec.hold(1.0);
        }
    } finally {
        await context.close();
    }

    const outMp4 = join(OUT_DIR, "01-overview-and-config.mp4");
    const poster = join(OUT_DIR, "01-overview-and-config-poster.png");
    rec.encodeMp4(outMp4, poster);
    return {
        id: "01-overview-and-config",
        mp4: "docs/demos/01-overview-and-config.mp4",
        gif: "docs/demos/01-overview-and-config.gif",
        poster: "docs/demos/01-overview-and-config-poster.png",
        ...probeVideo(outMp4),
    };
}

// ---------------------------------------------------------------------------
// Demo 02: Infinite Canvas Workflow (~23s)
// ---------------------------------------------------------------------------
async function renderDemo02(browser, baseUrl) {
    const { context, page } = await createDemoSession(browser, baseUrl);
    const framesDir = join(TMP_ROOT, "02");
    const rec = new DemoRecorder(page, framesDir, "02 / 05 · 无限画布多模态编排");

    try {
        await page.goto(`${baseUrl}/#/canvas`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(450);

        await rec.setCaption("进入无限画布工程库，一键新建本地画布项目");
        await rec.hold(1.2);

        const createBtn = page.getByRole("button", { name: /新建画布|新建项目|创建/i }).first();
        await rec.clickLocator(createBtn, { moveSeconds: 0.6, holdAfter: 1.0 });

        const toolbar = page.locator("div.bottom-5 button");
        await rec.setCaption("底部工具栏支持自由创建文本、图片、视频、音频节点与分组编排");
        // Add Text node (3), Video node (5), Group (8)
        await rec.clickLocator(toolbar.nth(3), { moveSeconds: 0.55, holdAfter: 0.65 });
        await rec.clickLocator(toolbar.nth(5), { moveSeconds: 0.4, holdAfter: 0.65 });
        await rec.clickLocator(toolbar.nth(8), { moveSeconds: 0.4, holdAfter: 0.7 });

        // Upload local reference image onto canvas
        await rec.setCaption("直接导入本地参考图上画布，选中图片即可唤起多图参考改图面板");
        const fileInputs = page.locator('input[type="file"]');
        if ((await fileInputs.count()) > 0) {
            await fileInputs.first().setInputFiles(SAMPLE_IMAGE);
            await page.waitForTimeout(650);
        }
        await rec.hold(1.3);

        // Type modification prompt if prompt editor is visible on selected node
        const promptEditor = page.locator('[contenteditable="true"]:visible, textarea:visible').last();
        if (await promptEditor.isVisible()) {
            await rec.clickLocator(promptEditor, { moveSeconds: 0.55, holdAfter: 0.25 });
            await rec.typeText("保持构图一致，转换为电影级暖金夜景光影与细腻胶片颗粒质感", { charsPerFrame: 2, holdAfter: 1.1 });
        }

        // Open Canvas Appearance panel briefly
        await rec.setCaption("支持画布网格/点阵外观切换、历史撤销重做与右侧本地 Agent 协同");
        const styleBtn = page.locator("#tool-style");
        if (await styleBtn.isVisible()) {
            await rec.clickLocator(styleBtn, { moveSeconds: 0.5, holdAfter: 0.9 });
            await rec.clickLocator(styleBtn, { moveSeconds: 0.25, holdAfter: 0.35 });
        }

        // Open Agent panel
        const agentBtn = page.getByRole("button", { name: /^Agent$/i }).first();
        if (await agentBtn.isVisible()) {
            await rec.clickLocator(agentBtn, { moveSeconds: 0.6, holdAfter: 1.8 });
        }
    } finally {
        await context.close();
    }

    const outMp4 = join(OUT_DIR, "02-infinite-canvas.mp4");
    const poster = join(OUT_DIR, "02-infinite-canvas-poster.png");
    rec.encodeMp4(outMp4, poster);
    return {
        id: "02-infinite-canvas",
        mp4: "docs/demos/02-infinite-canvas.mp4",
        gif: "docs/demos/02-infinite-canvas.gif",
        poster: "docs/demos/02-infinite-canvas-poster.png",
        ...probeVideo(outMp4),
    };
}

// ---------------------------------------------------------------------------
// Demo 03: Script Studio (~21s)
// ---------------------------------------------------------------------------
async function renderDemo03(browser, baseUrl) {
    const { context, page } = await createDemoSession(browser, baseUrl);
    const framesDir = join(TMP_ROOT, "03");
    const rec = new DemoRecorder(page, framesDir, "03 / 05 · 剧本工作室");

    try {
        await page.goto(`${baseUrl}/#/studio/script`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(500);

        await rec.setCaption("剧本工作室：支持上传剧本、快速改写与 AI 协作创作三种起步方式");
        await rec.hold(1.2);

        for (const tabName of ["快速创作", "AI 协作创作", "上传剧本"]) {
            const btn = page.getByRole("button", { name: tabName }).first();
            if (await btn.isVisible()) {
                await rec.clickLocator(btn, { moveSeconds: 0.45, holdAfter: 0.55 });
            }
        }

        await rec.setCaption("粘贴或导入长篇剧本（最高 10 万字），自动按集拆分角色、场景与道具");
        const ta = page.locator("textarea:visible").first();
        await rec.clickLocator(ta, { moveSeconds: 0.5, holdAfter: 0.2 });
        await rec.typeText(
            "《极昼观测站》\n第一场 · 冰原玻璃圆顶室内（夜）\n青年工程师林澈站在全息沙盘前，窗外极光掠过雪原天线阵列。\n林澈按下控制台开关，无人机群沿峡谷缓缓升空。",
            { charsPerFrame: 3, holdAfter: 1.0 },
        );

        // Open visual style library modal
        await rec.setCaption("内置多分类视觉风格库，为全片角色、场景与分镜锁定统一美学方向");
        const styleField = page.getByRole("button", { name: /视觉风格/i }).first();
        if (await styleField.isVisible()) {
            await rec.clickLocator(styleField, { moveSeconds: 0.55, holdAfter: 1.0 });
            const modal = page.locator(".ant-modal:visible").last();
            if (await modal.isVisible()) {
                for (const cat of ["真人", "2D", "3D", "全部"]) {
                    const catBtn = modal.getByRole("button", { name: cat, exact: true }).first();
                    if (await catBtn.isVisible()) {
                        await rec.clickLocator(catBtn, { moveSeconds: 0.35, holdAfter: 0.45 });
                    }
                }
                const firstPreset = modal.locator("button").filter({ hasText: /复古|电影|写实|动漫|国风/ }).first();
                if (await firstPreset.isVisible()) {
                    await rec.clickLocator(firstPreset, { moveSeconds: 0.45, holdAfter: 0.9 });
                } else {
                    await page.keyboard.press("Escape");
                    await rec.hold(0.6);
                }
            }
        }

        // Open default settings modal briefly
        await rec.setCaption("支持 Seedance 2.0 等主流视频提示词规格与全局剧集参数定制");
        const settingsBtn = page.getByRole("button", { name: /默认设置/i }).first();
        if (await settingsBtn.isVisible()) {
            await rec.clickLocator(settingsBtn, { moveSeconds: 0.55, holdAfter: 1.6 });
        } else {
            await rec.hold(1.6);
        }
    } finally {
        await context.close();
    }

    const outMp4 = join(OUT_DIR, "03-script-studio.mp4");
    const poster = join(OUT_DIR, "03-script-studio-poster.png");
    rec.encodeMp4(outMp4, poster);
    return {
        id: "03-script-studio",
        mp4: "docs/demos/03-script-studio.mp4",
        gif: "docs/demos/03-script-studio.gif",
        poster: "docs/demos/03-script-studio-poster.png",
        ...probeVideo(outMp4),
    };
}

// ---------------------------------------------------------------------------
// Demo 04: Replication & Replacement Studios (~21s)
// ---------------------------------------------------------------------------
async function renderDemo04(browser, baseUrl) {
    const { context, page } = await createDemoSession(browser, baseUrl);
    const framesDir = join(TMP_ROOT, "04");
    const rec = new DemoRecorder(page, framesDir, "04 / 05 · 复刻工作室与替换工作室");

    try {
        await page.goto(`${baseUrl}/#/studio/replication`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(500);

        await rec.setCaption("复刻工作室：拆解参考视频镜头与分镜脚本，支持单段精准修改重生成");
        await rec.hold(1.1);

        const newRepBtn = page.getByRole("button", { name: /新建项目/i }).first();
        await rec.clickLocator(newRepBtn, { moveSeconds: 0.55, holdAfter: 1.0 });

        await rec.setCaption("四步标准化流水线：上传原片 → 原片分析 → 素材设定 → 分镜与视频");
        for (const stepLabel of ["2 原片分析", "3 素材设定", "4 分镜与视频", "1 上传原片"]) {
            const stepBtn = page.getByRole("button", { name: new RegExp(stepLabel.slice(2)) }).first();
            if (await stepBtn.isVisible()) {
                await rec.moveToLocator(stepBtn, 0.4);
                await rec.hold(0.35);
            }
        }
        await rec.hold(0.8);

        // Navigate to Replacement Studio
        await page.goto(`${baseUrl}/#/studio/replacement`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(500);

        await rec.setCaption("替换工作室：完整替换视频人物主体与声音，或单独进行音色克隆");
        await rec.hold(1.0);

        const audioModeBtn = page.getByRole("button", { name: /只克隆声音/i }).first();
        const videoModeBtn = page.getByRole("button", { name: /视频替换/i }).first();
        if (await audioModeBtn.isVisible()) {
            await rec.clickLocator(audioModeBtn, { moveSeconds: 0.5, holdAfter: 0.8 });
        }
        if (await videoModeBtn.isVisible()) {
            await rec.clickLocator(videoModeBtn, { moveSeconds: 0.45, holdAfter: 0.7 });
        }

        await rec.setCaption("进入替换项目工作台，一站式管理角色资产、画面替换、配音与成片合成");
        const createEmptyCard = page.getByRole("button", { name: /新建/i }).last();
        if (await createEmptyCard.isVisible()) {
            await rec.clickLocator(createEmptyCard, { moveSeconds: 0.55, holdAfter: 1.8 });
        } else {
            await rec.hold(1.8);
        }
    } finally {
        await context.close();
    }

    const outMp4 = join(OUT_DIR, "04-replication-and-replacement.mp4");
    const poster = join(OUT_DIR, "04-replication-and-replacement-poster.png");
    rec.encodeMp4(outMp4, poster);
    return {
        id: "04-replication-and-replacement",
        mp4: "docs/demos/04-replication-and-replacement.mp4",
        gif: "docs/demos/04-replication-and-replacement.gif",
        poster: "docs/demos/04-replication-and-replacement-poster.png",
        ...probeVideo(outMp4),
    };
}

// ---------------------------------------------------------------------------
// Demo 05: 1700+ Prompt Library & Local Assets Flow (~22s)
// ---------------------------------------------------------------------------
async function renderDemo05(browser, baseUrl) {
    const { context, page } = await createDemoSession(browser, baseUrl);
    const framesDir = join(TMP_ROOT, "05");
    const rec = new DemoRecorder(page, framesDir, "05 / 05 · 1700+ 提示词库与本地资产");

    try {
        await page.goto(`${baseUrl}/#/prompts`, { waitUntil: "domcontentloaded" });
        await page.locator("main .grid > div").first().waitFor({ state: "visible", timeout: 15000 });
        await page.waitForTimeout(400);

        await rec.setCaption("内置聚合 1740+ 条开源高质量提示词，支持多来源与标签秒级检索");
        await rec.hold(1.3);

        const searchInput = page.locator('main input[type="text"], main input:not([type])').first();
        await rec.clickLocator(searchInput, { moveSeconds: 0.55, holdAfter: 0.2 });
        await rec.typeText("海报", { charsPerFrame: 1, holdAfter: 1.0 });

        await rec.setCaption("点开卡片查看完整 Prompt 与参考图，一键复制或加入本地资产库");
        const firstCard = page.locator("main .grid > div").first();
        if (await firstCard.isVisible()) {
            const addBtn = firstCard.getByRole("button", { name: /加入我的资产/i }).first();
            if (await addBtn.isVisible()) {
                await rec.clickLocator(addBtn, { moveSeconds: 0.5, holdAfter: 0.8 });
            }
            await rec.clickLocator(firstCard, { moveSeconds: 0.4, holdAfter: 1.2 });
            await page.keyboard.press("Escape");
            await rec.hold(0.5);
        }

        // Go to Local Assets page
        await rec.setCaption("我的资产：在浏览器本地统一管理常用角色、场景、视频与提示词模板");
        const assetsNav = page.getByRole("link", { name: /我的资产/i }).first();
        await rec.clickLocator(assetsNav, { moveSeconds: 0.55, holdAfter: 1.1 });

        // Go to Quick Image Workbench & open Asset Picker
        await rec.setCaption("在生图 / 视频工作台与无限画布中随时调用本地资产，形成完整创作闭环");
        const imageNav = page.getByRole("link", { name: /生图工作台/i }).first();
        await rec.clickLocator(imageNav, { moveSeconds: 0.55, holdAfter: 0.9 });

        const viewAssetsBtn = page.getByRole("button", { name: /查看我的资产/i }).first();
        if (await viewAssetsBtn.isVisible()) {
            await rec.clickLocator(viewAssetsBtn, { moveSeconds: 0.55, holdAfter: 1.6 });
        } else {
            await rec.hold(1.6);
        }
    } finally {
        await context.close();
    }

    const outMp4 = join(OUT_DIR, "05-prompts-and-assets.mp4");
    const poster = join(OUT_DIR, "05-prompts-and-assets-poster.png");
    rec.encodeMp4(outMp4, poster);
    return {
        id: "05-prompts-and-assets",
        mp4: "docs/demos/05-prompts-and-assets.mp4",
        gif: "docs/demos/05-prompts-and-assets.gif",
        poster: "docs/demos/05-prompts-and-assets-poster.png",
        ...probeVideo(outMp4),
    };
}

async function main() {
    rmSync(TMP_ROOT, { recursive: true, force: true });
    mkdirSync(TMP_ROOT, { recursive: true });

    const srv = await startServer({ host: "127.0.0.1", port: 3420 });
    console.log(`Demo render server running at ${srv.url}`);

    const pw = await loadPlaywright();
    const browser = await launchChromium(pw);

    const manifest = [];
    try {
        for (const fn of [renderDemo01, renderDemo02, renderDemo03, renderDemo04, renderDemo05]) {
            console.log(`Rendering ${fn.name}...`);
            const info = await fn(browser, srv.url);
            manifest.push(info);
            console.log(`  -> ${info.id}: ${info.width}x${info.height} @ ${info.fps}fps, ${info.durationSec}s, ${info.sizeKB} KB`);
        }
    } finally {
        await browser.close();
        await srv.close();
        rmSync(TMP_ROOT, { recursive: true, force: true });
    }

    const manifestPath = join(OUT_DIR, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`\nAll ${manifest.length} demo videos rendered successfully! Manifest: ${manifestPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
