import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "../../server/index.mjs";
import { launchChromium, loadPlaywright } from "../../scripts/_playwright.mjs";

const PROMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(PROMO_ROOT, "assets", "ui-v033");

mkdirSync(OUT_DIR, { recursive: true });

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

async function openAgentConnect(page) {
    const agentBtn = page.locator('header button[aria-label*="Agent"], header button[aria-label*="agent"]').first();
    if (await agentBtn.isVisible()) {
        await agentBtn.click();
        await page.waitForTimeout(500);
    }
    const connectTab = page.getByRole("button", { name: /连接|Connect/i }).first();
    if (await connectTab.isVisible()) {
        await connectTab.click();
        await page.waitForTimeout(450);
    }
}

async function captureTheme(browser, srv, theme) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 810 },
        deviceScaleFactor: 2,
        locale: "zh-CN",
        colorScheme: theme,
    });

    await context.addInitScript(
        ({ cfg, t }) => {
            localStorage.setItem(
                "infinite-canvas:theme_store",
                JSON.stringify({ state: { theme: t }, version: 0 }),
            );
            localStorage.setItem("infinite-canvas:ai_config_store", JSON.stringify(cfg));
        },
        { cfg: DEMO_CONFIG, t: theme },
    );

    const page = await context.newPage();
    await page.route("https://pbs.twimg.com/**", (route) => route.abort());
    await page.route("**/canvas-app/**", (route) =>
        route.continue({ url: route.request().url().replace("/canvas-app/", "/") }),
    );

    // Home
    await page.goto(`${srv.url}/#/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT_DIR, `home-${theme}.jpg`), type: "jpeg", quality: 92 });
    console.log(`Captured home-${theme}.jpg`);

    if (theme === "light") {
        await page.goto(`${srv.url}/#/image`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT_DIR, "image-workbench-light.jpg"), type: "jpeg", quality: 92 });
        console.log("Captured image-workbench-light.jpg");

        await page.goto(`${srv.url}/#/video`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT_DIR, "video-workbench-light.jpg"), type: "jpeg", quality: 92 });
        console.log("Captured video-workbench-light.jpg");

        await page.goto(`${srv.url}/#/assets`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT_DIR, "assets-light.jpg"), type: "jpeg", quality: 92 });
        console.log("Captured assets-light.jpg");

        await page.goto(`${srv.url}/#/studio/script`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        const ta = page.locator("textarea:visible").first();
        if (await ta.isVisible().catch(() => false)) {
            await ta.fill(
                "《永夜回响》第一集\n场次 1 · 雨夜古老教堂（外景/夜）\n侦探凯瑟撑伞走过湿漉漉的石板长廊，手中怀表发出微弱金光。窗影后，Linna 正凝视着火光未熄的钟楼。",
            );
            await page.waitForTimeout(350);
        }
        await page.screenshot({ path: join(OUT_DIR, "studio-script-light.jpg"), type: "jpeg", quality: 92 });
        console.log("Captured studio-script-light.jpg");

        await page.goto(`${srv.url}/#/studio/replication`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT_DIR, "studio-replication-light.jpg"), type: "jpeg", quality: 92 });
        console.log("Captured studio-replication-light.jpg");

        await page.goto(`${srv.url}/#/studio/replacement`, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT_DIR, "studio-replacement-light.jpg"), type: "jpeg", quality: 92 });
        console.log("Captured studio-replacement-light.jpg");

        await page.goto(`${srv.url}/#/`, { waitUntil: "networkidle" });
        await page.waitForTimeout(450);
    }

    await openAgentConnect(page);
    await page.screenshot({ path: join(OUT_DIR, `agent-connect-${theme}.jpg`), type: "jpeg", quality: 92 });
    console.log(`Captured agent-connect-${theme}.jpg`);

    await context.close();
}

async function main() {
    const srv = await startServer({ host: "127.0.0.1", port: 3441 });
    console.log(`Started sig-dream server at ${srv.url}`);
    const pw = await loadPlaywright();
    const browser = await launchChromium(pw);

    try {
        await captureTheme(browser, srv, "light");
        await captureTheme(browser, srv, "dark");
    } finally {
        await browser.close();
        await srv.close();
    }
    console.log("All v0.3.3 UI captures completed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
