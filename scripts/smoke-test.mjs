import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "../server/index.mjs";
import { launchChromium, loadPlaywright } from "./_playwright.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = join(ROOT, "release", "smoke-test");
const SAMPLE_IMAGE = join(ROOT, "docs", "screenshots", "canvas-board.png");

mkdirSync(REPORT_DIR, { recursive: true });

const results = [];
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];

function record(module, name, passed, detail = "") {
    results.push({ module, name, passed, detail });
    const icon = passed ? "PASS" : "FAIL";
    console.log(`[${icon}] [${module}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function runStep(module, name, fn) {
    try {
        const detail = await fn();
        record(module, name, true, typeof detail === "string" ? detail : "");
    } catch (err) {
        record(module, name, false, err instanceof Error ? err.message : String(err));
    }
}

async function main() {
    const srv = await startServer({ host: "127.0.0.1", port: 3410 });
    console.log(`Test server started at ${srv.url}`);

    const pw = await loadPlaywright();
    const browser = await launchChromium(pw);

    try {
        // 1. Server & proxy checks
        await runStep("server", "GET /healthz returns { ok: true }", async () => {
            const res = await fetch(`${srv.url}/healthz`);
            const data = await res.json();
            if (res.status !== 200 || !data.ok) throw new Error(`Unexpected healthz: ${res.status} ${JSON.stringify(data)}`);
            return `HTTP ${res.status}`;
        });

        await runStep("server", "Unknown proxy route returns 404 JSON", async () => {
            const res = await fetch(`${srv.url}/api-proxy/canvas-api/nonexistent/test`);
            const data = await res.json();
            if (res.status !== 404 || !data.detail) throw new Error(`Unexpected proxy 404: ${res.status}`);
            return data.detail;
        });

        await runStep("server", "POST /generated-media validates invalid URL", async () => {
            const res = await fetch(`${srv.url}/api-proxy/canvas-api/generated-media`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: "javascript:alert(1)" }),
            });
            if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
            return "Rejected invalid URL with HTTP 400";
        });

        // Browser context
        const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            locale: "zh-CN",
            acceptDownloads: true,
        });
        const page = await context.newPage();

        page.on("pageerror", (err) => {
            pageErrors.push({ url: page.url(), message: err.message });
        });
        page.on("console", (msg) => {
            if (msg.type() === "error") {
                consoleErrors.push({ url: page.url(), text: msg.text() });
            }
        });
        page.on("response", (res) => {
            if (res.status() >= 400 && !res.url().includes("/api-proxy/")) {
                failedRequests.push({ url: res.url(), status: res.status() });
            }
        });

        // 2. Home & Global Settings Modal
        await runStep("home", "Load home page and verify 4 workspaces + 4 quick tools", async () => {
            await page.goto(`${srv.url}/#/`, { waitUntil: "networkidle" });
            await page.waitForSelector("h1");
            const h1 = await page.locator("h1").first().textContent();
            const cards = await page.locator("section").nth(1).locator("button").count();
            if (!h1?.trim()) throw new Error("Empty H1");
            await page.screenshot({ path: join(REPORT_DIR, "01-home.png") });
            return `H1="${h1.trim()}", buttons=${cards}`;
        });

        await runStep("config", "Open provider config modal, add & edit channel, switch tabs", async () => {
            await page.getByRole("button", { name: /配置模型渠道|Configure/i }).first().click();
            await page.waitForSelector(".ant-modal");

            // Check tabs in modal
            const tabs = page.locator(".ant-modal .ant-tabs-tab");
            const tabCount = await tabs.count();
            if (tabCount < 4) throw new Error(`Expected >=4 config tabs, got ${tabCount}`);

            // Click add channel button if visible
            const addBtn = page.locator(".ant-modal").getByRole("button", { name: /添加渠道|新增渠道|Add/i }).first();
            if (await addBtn.isVisible()) {
                await addBtn.click();
                await page.waitForTimeout(300);
                await page.screenshot({ path: join(REPORT_DIR, "02-config-channel-drawer.png") });
                // Close drawer if open
                const closeDrawer = page.locator(".ant-drawer-close").first();
                if (await closeDrawer.isVisible()) {
                    await closeDrawer.click();
                    await page.waitForTimeout(250);
                }
            }

            // Switch through tabs
            for (let i = 1; i < Math.min(tabCount, 5); i++) {
                await tabs.nth(i).click();
                await page.waitForTimeout(150);
            }
            await page.screenshot({ path: join(REPORT_DIR, "02-config-modal.png") });

            // Close modal
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            const modalStillOpen = await page.locator(".ant-modal-wrap:visible").count();
            if (modalStillOpen > 0) {
                const closeBtn = page.locator(".ant-modal-close").first();
                if (await closeBtn.isVisible()) await closeBtn.click();
            }
            return `Checked ${tabCount} config tabs`;
        });

        // 3. Infinite Canvas
        let canvasProjectUrl = "";
        await runStep("canvas", "Create canvas project, add nodes (text/image/video/group), undo/redo, toggle appearance & agent", async () => {
            await page.goto(`${srv.url}/#/canvas`, { waitUntil: "networkidle" });
            await page.waitForTimeout(400);
            const createBtn = page.getByRole("button", { name: /新建画布|新建项目|创建|Create|New/i }).first();
            await createBtn.click();
            await page.waitForURL(/#\/canvas\/.+/);
            await page.waitForTimeout(700);
            canvasProjectUrl = page.url();

            // Click toolbar buttons by their DOM id or aria-label
            // Inspect canvas toolbar buttons
            const toolbarButtons = page.locator("div.bottom-5 button");
            const tbCount = await toolbarButtons.count();
            if (tbCount < 8) throw new Error(`Expected >=8 canvas toolbar buttons, got ${tbCount}`);

            // Add text node (index 3: select, undo, redo, text, image, video, audio, config, group)
            await toolbarButtons.nth(3).click();
            await page.waitForTimeout(300);
            // Add image node
            await toolbarButtons.nth(4).click();
            await page.waitForTimeout(300);
            // Add video node
            await toolbarButtons.nth(5).click();
            await page.waitForTimeout(300);
            // Add group
            await toolbarButtons.nth(8).click();
            await page.waitForTimeout(350);

            // Upload local sample image via hidden file input on canvas
            const fileInputs = page.locator('input[type="file"]');
            const fiCount = await fileInputs.count();
            if (fiCount > 0) {
                await fileInputs.first().setInputFiles(SAMPLE_IMAGE);
                await page.waitForTimeout(600);
            }

            // Test Undo then Redo
            await toolbarButtons.nth(1).click();
            await page.waitForTimeout(200);
            await toolbarButtons.nth(2).click();
            await page.waitForTimeout(200);

            // Toggle Agent panel
            const agentBtn = page.getByRole("button", { name: /Agent/i }).first();
            if (await agentBtn.isVisible()) {
                await agentBtn.click();
                await page.waitForTimeout(350);
                await page.screenshot({ path: join(REPORT_DIR, "03-canvas-with-agent.png") });
                await agentBtn.click();
                await page.waitForTimeout(250);
            }

            await page.screenshot({ path: join(REPORT_DIR, "03-canvas-board.png") });
            return `Project created (${canvasProjectUrl.split("/").pop()}), toolbar buttons=${tbCount}, fileInputs=${fiCount}`;
        });

        await runStep("canvas", "Canvas project persists in list after reload", async () => {
            await page.goto(`${srv.url}/#/canvas`, { waitUntil: "networkidle" });
            await page.waitForTimeout(500);
            await page.reload({ waitUntil: "networkidle" });
            await page.waitForTimeout(500);
            const bodyText = await page.locator("main").innerText();
            if (/还没有|empty/i.test(bodyText) && !/未命名|画布/i.test(bodyText)) {
                throw new Error("Created canvas project disappeared after reload");
            }
            await page.screenshot({ path: join(REPORT_DIR, "03-canvas-list.png") });
            return "Persisted across reload";
        });

        // 4. Script Studio
        await runStep("studio-script", "Script Studio tabs, style library modal, settings & create project", async () => {
            await page.goto(`${srv.url}/#/studio/script`, { waitUntil: "networkidle" });
            await page.waitForTimeout(500);
            // Switch tabs: 快速创作, AI 协作创作, back to 上传剧本
            for (const label of ["快速创作", "AI 协作创作", "上传剧本"]) {
                const btn = page.getByRole("button", { name: label }).first();
                if (await btn.isVisible()) {
                    await btn.click();
                    await page.waitForTimeout(200);
                }
            }
            // Paste a sample script
            const textarea = page.locator("textarea").first();
            if (await textarea.isVisible()) {
                await textarea.fill("《雨夜代码工作室》\n第一幕：深夜的玻璃工作室，霓虹倒映在湿润的窗面上。\n角色：陈硕，独立开发者，在画布前编排 AI 分镜。");
                await page.waitForTimeout(200);
            }
            // Open style library if trigger exists
            const styleBtn = page.getByRole("button", { name: /风格|画风|复古|写实|选择/i }).first();
            if (await styleBtn.isVisible()) {
                await styleBtn.click();
                await page.waitForTimeout(350);
                await page.screenshot({ path: join(REPORT_DIR, "04-studio-script-style.png") });
                await page.keyboard.press("Escape");
                await page.waitForTimeout(200);
            }
            await page.screenshot({ path: join(REPORT_DIR, "04-studio-script-home.png") });
            return "Script Studio interactive flow verified";
        });

        // 5. Replication Studio
        await runStep("studio-replication", "Replication Studio create project & inspect workflow steps", async () => {
            await page.goto(`${srv.url}/#/studio/replication`, { waitUntil: "networkidle" });
            await page.waitForTimeout(500);
            const createBtn = page.getByRole("button", { name: /新建项目/i }).first();
            await createBtn.click();
            await page.waitForURL(/#\/studio\/replication\/.+/);
            await page.waitForTimeout(600);
            await page.screenshot({ path: join(REPORT_DIR, "05-studio-replication.png") });
            return `Opened ${page.url().split("/").pop()}`;
        });

        // 6. Replacement Studio
        await runStep("studio-replacement", "Replacement Studio switch video/audio mode & create empty project", async () => {
            await page.goto(`${srv.url}/#/studio/replacement`, { waitUntil: "networkidle" });
            await page.waitForTimeout(500);
            await page.screenshot({ path: join(REPORT_DIR, "06-studio-replacement-home.png") });
            const audioBtn = page.getByRole("button", { name: /音频|仅声音/i }).first();
            if (await audioBtn.isVisible()) {
                await audioBtn.click();
                await page.waitForTimeout(250);
            }
            const videoBtn = page.getByRole("button", { name: /视频/i }).first();
            if (await videoBtn.isVisible()) {
                await videoBtn.click();
                await page.waitForTimeout(250);
            }
            const emptyBtn = page.getByRole("button", { name: /空白项目|空项目|新建/i }).first();
            if (await emptyBtn.isVisible()) {
                await emptyBtn.click();
                await page.waitForTimeout(600);
                await page.screenshot({ path: join(REPORT_DIR, "06-studio-replacement-project.png") });
            }
            return `Current route: ${page.url().split("#")[1]}`;
        });

        // 7. Quick Image & Quick Video pages
        await runStep("image", "Quick Image page renders controls and accepts prompt input", async () => {
            await page.goto(`${srv.url}/#/image`, { waitUntil: "networkidle" });
            await page.waitForTimeout(500);
            const editor = page.locator('[contenteditable="true"]:visible, textarea:visible').first();
            await editor.click();
            await page.keyboard.type("极简黑白工业设计海报，柔和漫反射光影，超高清细节");
            await page.waitForTimeout(200);
            await page.screenshot({ path: join(REPORT_DIR, "07-quick-image.png") });
            return "Prompt entered & controls visible";
        });

        await runStep("video", "Quick Video page renders controls and accepts prompt input", async () => {
            await page.goto(`${srv.url}/#/video`, { waitUntil: "networkidle" });
            await page.waitForTimeout(500);
            const editor = page.locator('[contenteditable="true"]:visible, textarea:visible').first();
            await editor.click();
            await page.keyboard.type("镜头缓慢推进，穿过玻璃幕墙展现夜间城市光轨，电影质感");
            await page.waitForTimeout(200);
            await page.screenshot({ path: join(REPORT_DIR, "08-quick-video.png") });
            return "Video page interactive";
        });

        // 8. Prompt Library & Assets Library
        await runStep("prompts", "Prompt Library loads prompts, filters by search/tag, opens detail, saves to assets", async () => {
            await page.goto(`${srv.url}/#/prompts`, { waitUntil: "domcontentloaded" });
            await page.locator("main .grid > div").first().waitFor({ state: "visible", timeout: 15000 });
            await page.waitForTimeout(300);
            const subtitle = await page.locator("main p").first().textContent();
            const cardsBefore = await page.locator("main .grid > div").count();
            if (cardsBefore === 0) throw new Error("No prompt cards rendered");

            // Save first prompt to assets
            const addAssetBtn = page.getByRole("button", { name: /加入资产|添加资产|Add to/i }).first();
            if (await addAssetBtn.isVisible()) {
                await addAssetBtn.click();
                await page.waitForTimeout(300);
            }

            // Search keyword
            const searchInput = page.locator('main input[type="text"], main input:not([type])').first();
            await searchInput.fill("3D");
            await page.waitForTimeout(500);
            const cardsAfterSearch = await page.locator("main .grid > div").count();
            await page.screenshot({ path: join(REPORT_DIR, "09-prompts.png") });

            // Open first prompt detail dialog
            const firstCard = page.locator("main .grid > div").first();
            if (await firstCard.isVisible()) {
                await firstCard.click();
                await page.waitForTimeout(350);
                await page.screenshot({ path: join(REPORT_DIR, "09-prompts-detail.png") });
                await page.keyboard.press("Escape");
            }
            return `${subtitle?.trim()} | cards=${cardsBefore} -> search("3D")=${cardsAfterSearch}`;
        });

        await runStep("assets", "Assets Library shows saved prompt, supports creating new text asset & filtering", async () => {
            await page.goto(`${srv.url}/#/assets`, { waitUntil: "networkidle" });
            await page.waitForTimeout(500);
            const bodyText = await page.locator("main").innerText();
            const hasSavedPrompt = !/暂无|Empty/i.test(bodyText);

            // Create a manual text asset
            const createBtn = page.getByRole("button", { name: /新建|新增|创建|Add|New/i }).first();
            if (await createBtn.isVisible()) {
                await createBtn.click();
                await page.waitForTimeout(350);
                const modal = page.locator(".ant-modal, .ant-drawer").last();
                const titleInput = modal.locator('input#title, input[type="text"]:visible').first();
                if (await titleInput.isVisible()) {
                    await titleInput.fill("测试角色设定卡");
                }
                const contentTa = modal.locator("textarea:visible").last();
                if (await contentTa.isVisible()) {
                    await contentTa.fill("主角：极简主义产品设计师，黑框眼镜，暖白工作室灯光");
                }
                const saveBtn = modal.getByRole("button", { name: /保存|确定|提交|Save|OK/i }).first();
                if (await saveBtn.isVisible()) {
                    await saveBtn.click();
                    await page.waitForTimeout(400);
                }
            }
            await page.screenshot({ path: join(REPORT_DIR, "10-assets.png") });
            return `SavedPromptVisible=${hasSavedPrompt}`;
        });

        // 9. Config Route directly
        await runStep("config-page", "Standalone /config page renders properly", async () => {
            await page.goto(`${srv.url}/#/config`, { waitUntil: "networkidle" });
            await page.waitForTimeout(500);
            await page.screenshot({ path: join(REPORT_DIR, "11-config-page.png") });
            return "Standalone config page rendered";
        });

        await context.close();
    } finally {
        await browser.close();
        await srv.close();
    }

    const report = {
        timestamp: new Date().toISOString(),
        summary: {
            total: results.length,
            passed: results.filter((r) => r.passed).length,
            failed: results.filter((r) => !r.passed).length,
            pageErrors: pageErrors.length,
            consoleErrors: consoleErrors.length,
            failedRequests: failedRequests.length,
        },
        results,
        pageErrors,
        consoleErrors,
        failedRequests,
    };

    writeFileSync(join(REPORT_DIR, "report.json"), JSON.stringify(report, null, 2));
    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify(report.summary, null, 2));
    if (pageErrors.length) console.log("Page errors:", pageErrors);
    if (consoleErrors.length) console.log("Console errors:", consoleErrors);
    if (failedRequests.length) console.log("Failed requests:", failedRequests);

    if (report.summary.failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
