import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "../../server/index.mjs";
import { launchChromium, loadPlaywright } from "../../scripts/_playwright.mjs";

const PROMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PROMO_ROOT, "..");
const UI_DIR = join(PROMO_ROOT, "assets", "ui");

mkdirSync(UI_DIR, { recursive: true });

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
                    name: "Google Gemini · Veo & Imagen",
                    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
                    apiKey: "AIzaSyLocalDemoKey7721",
                    apiFormat: "gemini",
                    models: [
                        { name: "gemini-2.5-pro", capability: "text", label: "Gemini 2.5 Pro" },
                        { name: "imagen-4", capability: "image", label: "Imagen 4" },
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
                    name: "RunningHub · ComfyUI 视频工作流",
                    baseUrl: "https://www.runninghub.cn/openapi/v2",
                    apiKey: "rh-local-demo-workflow-88",
                    apiFormat: "openai",
                    models: [
                        { name: "rh-video-replace", capability: "video", label: "人物与音色替换工作流" },
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

async function main() {
    const srv = await startServer({ host: "127.0.0.1", port: 3439 });
    console.log(`Started sig-dream server at ${srv.url}`);

    const pw = await loadPlaywright();
    const browser = await launchChromium(pw);

    try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 810 },
            deviceScaleFactor: 2,
            locale: "zh-CN",
            colorScheme: "dark",
        });

        await context.addInitScript((cfg) => {
            localStorage.setItem(
                "infinite-canvas:theme_store",
                JSON.stringify({ state: { theme: "dark" }, version: 0 }),
            );
            localStorage.setItem("infinite-canvas:ai_config_store", JSON.stringify(cfg));
        }, DEMO_CONFIG);

        const page = await context.newPage();
        await page.route("https://pbs.twimg.com/**", (route) => route.abort());
        await page.route("**/canvas-app/**", (route) =>
            route.continue({ url: route.request().url().replace("/canvas-app/", "/") }),
        );

        // 1. Home Dark
        await page.goto(`${srv.url}/#/`, { waitUntil: "networkidle" });
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(UI_DIR, "home-dark.png") });
        console.log("Captured home-dark.png");

        // 2. Provider Config Modal
        const configBtn = page.getByRole("button", { name: /配置模型渠道|已配置/i }).first();
        if (await configBtn.isVisible()) {
            await configBtn.click();
        } else {
            const headerGear = page.locator("header button").last();
            await headerGear.click();
        }
        await page.waitForTimeout(550);
        await page.screenshot({ path: join(UI_DIR, "provider-modal.png") });
        console.log("Captured provider-modal.png");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);

        // 3. Infinite Canvas Dark (create project + upload real story-styles artwork)
        await page.setViewportSize({ width: 1680, height: 945 });
        await page.goto(`${srv.url}/#/canvas`, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
        const createCanvasBtn = page.getByRole("button", { name: /新建画布|新建项目|创建/i }).first();
        if (await createCanvasBtn.isVisible()) {
            await createCanvasBtn.click();
            await page.waitForTimeout(700);
        }

        const sampleImg = join(REPO_ROOT, "public", "images", "story-styles", "3d-fantasy-rpg.webp");
        const fileInputs = page.locator('input[type="file"]');
        if ((await fileInputs.count()) > 0) {
            await fileInputs.first().setInputFiles(sampleImg);
            await page.waitForTimeout(900);
        }
        const promptEditor = page.locator('[contenteditable="true"]:visible, textarea:visible').last();
        if (await promptEditor.isVisible()) {
            await promptEditor.click();
            await page.keyboard.insertText("保留主角构图与冷冽光影，延展粘土定格动画、赛博概念设定与水墨连续分镜");
            await page.waitForTimeout(400);
        }
        await page.screenshot({ path: join(UI_DIR, "canvas-edit-dark.png") });
        console.log("Captured canvas-edit-dark.png");
        await page.setViewportSize({ width: 1440, height: 810 });

        // 4. Script Studio Dark + Visual Style Modal
        await page.goto(`${srv.url}/#/studio/script`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        const ta = page.locator("textarea:visible").first();
        if (await ta.isVisible()) {
            await ta.click();
            await ta.fill(
                "《极昼观测站》\n第一场 · 冰原玻璃圆顶观测站（极夜）\n青年工程师林澈站在微光全息沙盘前，窗外绿紫色极光掠过雪原天线阵列。\n第二场 · 峡谷发射井（黎明前）\n林澈按下主控开关，四架侦测无人机沿冰裂峡谷编队升空，镜头俯冲跟拍。",
            );
            await page.waitForTimeout(350);
        }
        await page.screenshot({ path: join(UI_DIR, "studio-script-dark.png") });
        console.log("Captured studio-script-dark.png");

        const styleBtn = page.getByRole("button", { name: /视觉风格/i }).first();
        if (await styleBtn.isVisible()) {
            await styleBtn.click();
            await page.waitForTimeout(700);
            await page.screenshot({ path: join(UI_DIR, "studio-style-modal.png") });
            console.log("Captured studio-style-modal.png");
            await page.keyboard.press("Escape");
            await page.waitForTimeout(250);
        }

        // 5. Replication Studio Dark
        await page.goto(`${srv.url}/#/studio/replication`, { waitUntil: "networkidle" });
        await page.waitForTimeout(550);
        const newRepBtn = page.getByRole("button", { name: /新建项目/i }).first();
        if (await newRepBtn.isVisible()) {
            await newRepBtn.click();
            await page.waitForTimeout(600);
        }
        await page.screenshot({ path: join(UI_DIR, "studio-replication-dark.png") });
        console.log("Captured studio-replication-dark.png");

        // 6. Replacement Studio Dark
        await page.goto(`${srv.url}/#/studio/replacement`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(UI_DIR, "studio-replacement-dark.png") });
        console.log("Captured studio-replacement-dark.png");

        // 7. 1740+ Prompt Library Dark
        await page.goto(`${srv.url}/#/prompts`, { waitUntil: "domcontentloaded" });
        await page.locator("main .grid > div").first().waitFor({ state: "visible", timeout: 15000 });
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(UI_DIR, "prompts-dark.png") });
        console.log("Captured prompts-dark.png");

        await context.close();
    } finally {
        await browser.close();
        await srv.close();
    }

    // Also copy existing real production full-board screenshot for pull-back reference if needed
    copyFileSync(
        join(REPO_ROOT, "docs", "screenshots", "canvas-board.png"),
        join(UI_DIR, "canvas-board-real.png"),
    );
    console.log("All UI captures completed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
