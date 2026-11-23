import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "../../server/index.mjs";
import { launchChromium, loadPlaywright } from "../../scripts/_playwright.mjs";

const PROMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PROMO_ROOT, "..");
const UI_LIGHT_DIR = join(PROMO_ROOT, "assets", "ui-light");
const MJ_DIR = join(PROMO_ROOT, "assets", "mj");

mkdirSync(UI_LIGHT_DIR, { recursive: true });
mkdirSync(MJ_DIR, { recursive: true });

// 1. Optimize & copy user's Midjourney character sheets & keyframes (< 1.2 MB each for fast inline)
const MJ_SOURCES = [
    {
        src: "/Users/chenshuo/1.aigc/素材角色/三视图/exec-612062b3-4c40-4ee4-a197-0ad8fb469de1.png",
        out: "nvzhu1-sheet.jpg",
        scale: "1600:-2",
    },
    {
        src: "/Users/chenshuo/1.aigc/素材角色/三视图/exec-392f6637-4644-43dd-b3cb-c7cc0438f837.png",
        out: "nvzhu2-sheet.jpg",
        scale: "1600:-2",
    },
    {
        src: "/Users/chenshuo/1.aigc/kaige/kaige_character_design_sheet.png",
        out: "kaige-sheet.jpg",
        scale: "1600:-2",
    },
    {
        src: "/Users/chenshuo/1.aigc/素材角色/三视图/exec-afee36b0-66c2-442d-b70f-dd85dc033e30.png",
        out: "nvzhu3-sheet.jpg",
        scale: "1600:-2",
    },
    {
        src: "/Users/chenshuo/1.aigc/素材角色/小美 1.png",
        out: "shot-xiaomei.jpg",
        scale: "1080:-2",
    },
    {
        src: "/Users/chenshuo/1.aigc/kaige/01.png",
        out: "shot-kaige.jpg",
        scale: "1280:-2",
    },
    {
        src: "/Users/chenshuo/1.aigc/素材角色/女主 1.png",
        out: "shot-nvzhu1.jpg",
        scale: "1080:-2",
    },
    {
        src: "/Users/chenshuo/1.aigc/2.第一集/0_0.png",
        out: "shot-nvzhu2.jpg",
        scale: "1080:-2",
    },
    {
        src: "/Users/chenshuo/1.aigc/2.第一集/物品资产/酒店大堂.png",
        out: "shot-lobby.jpg",
        scale: "1080:-2",
    },
    {
        src: "/Users/chenshuo/1.aigc/2.第一集/物品资产/酒店全景.png",
        out: "shot-tower.jpg",
        scale: "1280:-2",
    },
];

for (const item of MJ_SOURCES) {
    if (!existsSync(item.src)) throw new Error(`Missing MJ asset: ${item.src}`);
    execFileSync(
        "ffmpeg",
        [
            "-y",
            "-i",
            item.src,
            "-vf",
            `scale=${item.scale}:flags=lanczos`,
            "-q:v",
            "2",
            join(MJ_DIR, item.out),
        ],
        { stdio: "pipe" },
    );
    console.log(`Prepared MJ asset: ${item.out}`);
}

// 2. Capture Clean WHITE (Light Mode) sig-dream v0.3.1 Screens with Real MJ Character on Canvas!
const DEMO_CONFIG = {
    state: {
        config: {
            channelMode: "local",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-sig-local-demo-key",
            apiFormat: "openai",
            channels: [
                {
                    id: "ch-openai",
                    name: "OpenAI Official · GPT-Image-2",
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: "sk-proj-local-demo-9f82a1",
                    apiFormat: "openai",
                    models: [
                        { name: "gpt-image-2", capability: "image", label: "GPT-Image-2" },
                        { name: "gpt-5.4", capability: "text", label: "GPT-5.4" },
                    ],
                },
                {
                    id: "ch-gemini",
                    name: "Google Gemini · Imagen & Veo",
                    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
                    apiKey: "AIzaSyLocalDemoKey7721",
                    apiFormat: "gemini",
                    models: [
                        { name: "gemini-2.5-pro", capability: "text", label: "Gemini 2.5 Pro" },
                    ],
                },
                {
                    id: "ch-seedance",
                    name: "火山方舟 · Seedance 2.0",
                    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
                    apiKey: "ark-local-demo-seedance-20",
                    apiFormat: "openai",
                    models: [
                        { name: "seedance-2.0-pro", capability: "video", label: "Seedance 2.0 Pro" },
                    ],
                },
                {
                    id: "ch-runninghub",
                    name: "RunningHub · ComfyUI 工作流",
                    baseUrl: "https://www.runninghub.cn/openapi/v2",
                    apiKey: "rh-local-demo-workflow-88",
                    apiFormat: "openai",
                    models: [
                        { name: "rh-video-replace", capability: "video", label: "视频人物替换" },
                    ],
                },
            ],
            model: "ch-openai::gpt-5.4",
            imageModel: "ch-openai::gpt-image-2",
            videoModel: "ch-seedance::seedance-2.0-pro",
            textModel: "ch-openai::gpt-5.4",
            proxyEnabled: true,
            proxyUrl: "/api-proxy",
        },
    },
    version: 0,
};

async function captureLightScreens() {
    const srv = await startServer({ host: "127.0.0.1", port: 3442 });
    const pw = await loadPlaywright();
    const browser = await launchChromium(pw);

    try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 810 },
            deviceScaleFactor: 2,
            locale: "zh-CN",
            colorScheme: "light",
        });

        await context.addInitScript((cfg) => {
            localStorage.setItem(
                "infinite-canvas:theme_store",
                JSON.stringify({ state: { theme: "light" }, version: 0 }),
            );
            localStorage.setItem("infinite-canvas:ai_config_store", JSON.stringify(cfg));
        }, DEMO_CONFIG);

        const page = await context.newPage();
        await page.route("https://pbs.twimg.com/**", (route) => route.abort());
        await page.route("**/canvas-app/**", (route) =>
            route.continue({ url: route.request().url().replace("/canvas-app/", "/") }),
        );

        const saveOpt = async (name) => {
            const rawPng = join(UI_LIGHT_DIR, `_raw_${name}.png`);
            const outJpg = join(UI_LIGHT_DIR, `${name}.jpg`);
            await page.screenshot({ path: rawPng });
            execFileSync(
                "ffmpeg",
                ["-y", "-i", rawPng, "-vf", "scale=2160:1215:flags=lanczos", "-q:v", "2", outJpg],
                { stdio: "pipe" },
            );
            console.log(`Captured light UI: ${name}.jpg`);
        };

        // 1. Light Home
        await page.goto(`${srv.url}/#/`, { waitUntil: "networkidle" });
        await page.waitForTimeout(700);
        await saveOpt("home-light");

        // 2. Light Provider Modal
        const configBtn = page.getByRole("button", { name: /配置模型渠道|已配置/i }).first();
        await configBtn.click();
        await page.waitForTimeout(550);
        await saveOpt("provider-light");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);

        // 3. Light Infinite Canvas with real Midjourney 女主一 sheet uploaded!
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto(`${srv.url}/#/canvas`, { waitUntil: "networkidle" });
        await page.waitForTimeout(450);
        const createCanvasBtn = page.getByRole("button", { name: /新建画布|新建项目|创建/i }).first();
        if (await createCanvasBtn.isVisible()) {
            await createCanvasBtn.click();
            await page.waitForTimeout(650);
        }
        const fileInputs = page.locator('input[type="file"]');
        if ((await fileInputs.count()) > 0) {
            await fileInputs.first().setInputFiles(join(MJ_DIR, "nvzhu1-sheet.jpg"));
            await page.waitForTimeout(950);
        }
        const promptEditor = page.locator('[contenteditable="true"]:visible, textarea:visible').last();
        if (await promptEditor.isVisible()) {
            await promptEditor.click();
            await page.keyboard.insertText("保持女主五官与青瓷仙鹤长裙一致，生成水下花瓣特写与电影感连续分镜");
            await page.waitForTimeout(400);
        }
        await saveOpt("canvas-edit-light");
        await page.setViewportSize({ width: 1440, height: 810 });

        // 4. Light Prompts Center
        await page.goto(`${srv.url}/#/prompts`, { waitUntil: "domcontentloaded" });
        await page.locator("main .grid > div").first().waitFor({ state: "visible", timeout: 15000 });
        await page.waitForTimeout(900);
        await saveOpt("prompts-light");

        // 5. Script Studio + Style Modal
        await page.goto(`${srv.url}/#/studio/script`, { waitUntil: "networkidle" });
        await page.waitForTimeout(550);
        const styleBtn = page.getByRole("button", { name: /视觉风格/i }).first();
        if (await styleBtn.isVisible()) {
            await styleBtn.click();
            await page.waitForTimeout(700);
            await saveOpt("studio-style-light");
        }

        await context.close();
    } finally {
        await browser.close();
        await srv.close();
    }

    // Also optimize existing real white full-board screenshot
    execFileSync(
        "ffmpeg",
        [
            "-y",
            "-i",
            join(REPO_ROOT, "docs", "screenshots", "canvas-board.png"),
            "-q:v",
            "2",
            join(UI_LIGHT_DIR, "canvas-board-white.jpg"),
        ],
        { stdio: "pipe" },
    );
}

captureLightScreens().catch((err) => {
    console.error(err);
    process.exit(1);
});
