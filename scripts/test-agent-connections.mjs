import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { startServer } from "../server/index.mjs";
import { loadPlaywright, launchChromium } from "./_playwright.mjs";

const srv = await startServer({ host: "127.0.0.1", port: 0 });
const browser = await launchChromium(await loadPlaywright());
const report = [];
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(srv.url);
    await page.getByRole("button", { name: "打开 Agent", exact: true }).click();
    const selector = page.locator("#canvas-agent-client");
    const names = ["Codex", "Claude Code / Desktop", "Cursor", "Grok Build", "OpenCode 2", "Antigravity", "Muse Code", "Pi (MCP)", "OpenCode 1", "其他 Agent（标准 MCP stdio）"];
    for (const name of names) {
        await selector.click();
        await page.getByRole("option", { name, exact: true }).click();
        const details = page.locator("details").first();
        if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
        const config = await details.locator("code").innerText();
        assert.ok(config.includes("mcp"), name);
        assert.ok(config.includes("canvas-agent") && config.includes(".tgz"), name);
        await page.getByRole("button", { name: "复制 配置片段", exact: true }).click();
        await page.getByText("已复制", { exact: true }).last().waitFor();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), config);
        report.push({ client: name, switched: true, configCopied: true });
    }
    await selector.click();
    await page.getByRole("option", { name: names.at(-1), exact: true }).click();
    const httpConfig = await page.locator("pre code").allInnerTexts().then((blocks) => blocks.find((value) => value.includes("/mcp")));
    assert.ok(httpConfig, "generic Streamable HTTP config is visible");
    const parsedHttpConfig = JSON.parse(httpConfig);
    assert.match(parsedHttpConfig.mcpServers["infinite-canvas"].url, /\/mcp$/);
    assert.equal(parsedHttpConfig.mcpServers["infinite-canvas"].headers.Authorization, "Bearer <Connect token>");
    assert.equal(httpConfig.includes("undefined"), false);
    await page.getByRole("button", { name: "复制连接测试指令", exact: true }).click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /canvas_get_state/);
    await page.locator(".ant-message-notice").last().waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const bounds = await selector.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, "client selector fits narrow viewport");
    await mkdir("release/agent-connections", { recursive: true });
    await page.screenshot({ path: "release/agent-connections/narrow.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "release/agent-connections/desktop.png" });
    // Reload with English preferences in this isolated browser context.
    await page.evaluate(() => localStorage.setItem("infinite-canvas:locale", "en-US"));
    await page.reload();
    await page.getByRole("button", { name: /Open Agent/, exact: true }).click();
    await page.getByText("Choose an external Agent", { exact: false }).waitFor();
    assert.equal((await page.locator("body").innerText()).includes("agent.connect.setup"), false);
    assert.deepEqual(errors, []);
    await writeFile("release/agent-connections/report.json", JSON.stringify({ clients: report, narrowNoPageOverflow: true, english: true, pageErrors: errors }, null, 2));
    console.log("PASS: 10 client profiles, real clipboard copies, read-only test prompt, narrow layout, English, no page errors");
} finally {
    await browser.close();
    await srv.close();
}
