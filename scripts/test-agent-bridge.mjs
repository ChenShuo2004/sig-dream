import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { startServer } from "../server/index.mjs";
import { loadPlaywright, launchChromium } from "./_playwright.mjs";

const require = createRequire(import.meta.url);
const entry = require.resolve("@sig-dream/canvas-agent");
const agentRequire = createRequire(entry);
const { Client } = await import(pathToFileURL(agentRequire.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
const { StdioClientTransport } = await import(pathToFileURL(agentRequire.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
const { StreamableHTTPClientTransport } = await import(pathToFileURL(agentRequire.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js")).href);
const sandbox = await mkdtemp(join(tmpdir(), "sig-agent-bridge-"));
const preload = join(sandbox, "isolated-home.mjs");
// Scope os.homedir() only inside test children. Never replace the user's HOME or read their bridge credentials.
await writeFile(preload, 'import os from "node:os"; import {syncBuiltinESMExports} from "node:module"; os.homedir = () => process.env.SIG_DREAM_TEST_HOME; syncBuiltinESMExports();');
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const bridgeUrl = `http://127.0.0.1:${port}`;
const token = randomBytes(24).toString("hex");
await mkdir(join(sandbox, ".infinite-canvas"));
await writeFile(join(sandbox, ".infinite-canvas/canvas-agent.json"), JSON.stringify({ url: bridgeUrl, token, workspace: { workspacePath: sandbox } }));
const childEnv = { ...process.env, SIG_DREAM_TEST_HOME: sandbox, PORT: String(port) };
let service;
let browser;
let site;
const clients = [];
const results = [];
const record = (check) => {
    results.push({ check, passed: true });
    console.log(`PASS: ${check}`);
};
const startBridge = async () => {
    service = spawn(process.execPath, ["--import", preload, entry], { env: childEnv, stdio: "ignore" });
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            if ((await fetch(`${bridgeUrl}/health`)).ok) return;
        } catch {}
        if (service.exitCode !== null) throw new Error(`Bridge exited with ${service.exitCode}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Bridge startup timed out");
};
const stopBridge = async () => {
    if (service && service.exitCode === null) {
        const stopped = new Promise((resolve) => service.once("exit", resolve));
        service.kill();
        await stopped;
    }
};
const openMcp = async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", preload, entry, "mcp"], env: childEnv, stderr: "ignore" });
    const client = new Client({ name: "sig-dream-release-check", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);
    return client;
};
const call = async (client, name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name}: ${result.content?.[0]?.text}`);
    return JSON.parse(result.content[0].text);
};
try {
    await startBridge();
    assert.equal((await fetch(`${bridgeUrl}/config`).then((r) => r.json())).token, undefined);
    assert.equal((await fetch(`${bridgeUrl}/api/tools`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "canvas_get_state", input: {} }) })).status, 401);
    record("HTTP bridge keeps Token private and rejects unauthenticated calls");
    site = await startServer({ host: "127.0.0.1", port: 0 });
    browser = await launchChromium(await loadPlaywright());
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const codexRequests = [];
    page.on("request", (req) => {
        if (req.url().startsWith(`${bridgeUrl}/agent/codex/`)) codexRequests.push(new URL(req.url()).pathname);
    });
    await page.goto(`${site.url}/#/canvas`);
    await page
        .getByRole("button", { name: /新建画布|新建项目|创建/ })
        .first()
        .click();
    await page.waitForURL(/\/canvas\/.+/);
    const projectId = new URL(page.url()).hash.split("/").pop();
    await page.locator("div.bottom-5 button").first().waitFor();
    await page.waitForTimeout(700);
    const panelBounds = await page.locator("#canvas-agent-client").boundingBox();
    if (!panelBounds || panelBounds.x >= 1440 || panelBounds.x < 0) {
        await page.getByTitle("打开本地 Codex 面板", { exact: true }).click();
        await page.waitForTimeout(600);
    }
    await page.locator("#canvas-agent-client").click();
    await page.getByRole("option", { name: "Cursor", exact: true }).click();
    await page.getByPlaceholder("例如 http://127.0.0.1:17371").fill(bridgeUrl);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await page.getByText("已找到画布服务，请将服务终端显示的 Connect token 填入下方后重试。", { exact: true }).first().waitFor();
    record("New-user connection explains missing Token without reporting service absent");
    const tokenInput = page.getByPlaceholder("填入服务终端显示的 Connect token");
    await tokenInput.fill("wrong-token");
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await page.getByRole("button", { name: "连接设置，当前连接失败", exact: true }).waitFor();
    record("Wrong Token fails visibly and allows retry");
    await tokenInput.fill(token);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await page.getByRole("button", { name: "断开", exact: true }).waitFor();
    const first = await openMcp();
    const tools = await first.listTools();
    assert.equal(tools.tools.length, 34);
    let state;
    for (let attempt = 0; attempt < 30; attempt++) {
        const result = await first.callTool({ name: "canvas_get_state", arguments: {} });
        if (!result.isError) {
            state = JSON.parse(result.content[0].text);
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(state?.projectId, projectId);
    record("MCP initialize/tools/list/read reaches the actual browser canvas");
    const remote = new Client({ name: "sig-dream-http-release-check", version: "1.0.0" });
    await remote.connect(new StreamableHTTPClientTransport(new URL(`${bridgeUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    clients.push(remote);
    assert.equal((await remote.listTools()).tools.length, 34);
    assert.equal((await call(remote, "canvas_get_state")).projectId, projectId);
    record("Authenticated Streamable HTTP MCP exposes the same 34 tools and real canvas");
    const oversized = await first.callTool({ name: "canvas_create_text_nodes", arguments: { items: Array.from({length:1001}, () => ({text:"must not be written"})) } });
    assert.equal(oversized.isError, true);
    assert.equal((await call(first, "canvas_get_state")).nodes.length, state.nodes.length);
    record("Oversized MCP input is rejected without changing canvas state");

    await call(first, "canvas_create_text_node", { title: "Agent release check", text: "MCP end-to-end verification", x: 100, y: 100 });
    state = await call(first, "canvas_get_state");
    const node = state.nodes.find((n) => n.title === "Agent release check");
    assert.ok(node);
    await page.getByText("MCP end-to-end verification", { exact: true }).first().waitFor();
    const packed = new Client({ name: "sig-dream-packed-runtime-check", version: "1.0.0" });
    let packedErrors = "";
    const packedTransport = new StdioClientTransport({ command: process.platform === "win32" ? "npx.cmd" : "npx", args: ["--yes", `--node-options=--import=${preload}`, "--package", resolve("release/canvas-agent.tgz"), "--", "canvas-agent", "mcp"], cwd: sandbox, env: childEnv, stderr: "pipe" });
    packedTransport.stderr?.on("data", (chunk) => { packedErrors = (packedErrors + chunk.toString()).slice(-6000); });
    try { await packed.connect(packedTransport); } catch (error) { throw new Error(`Packed MCP startup failed: ${error.message}\n${packedErrors}`); }

    clients.push(packed);
    assert.equal((await packed.listTools()).tools.length, 34);
    assert.equal((await call(packed, "canvas_get_state")).projectId, projectId);
    record("Distributable tarball installs with npx and reaches the same real canvas");
    const second = await openMcp();
    const secondState = await call(second, "canvas_get_state");
    assert.equal(secondState.projectId, projectId);
    assert.ok(secondState.nodes.some((n) => n.id === node.id));
    record("Two independent MCP clients share the same canvas and see written text");
    await call(second, "canvas_update_node_text", { id: node.id, text: "Updated by second MCP client" });
    await page.getByText("Updated by second MCP client", { exact: true }).first().waitFor();
    await call(first, "canvas_delete_nodes", { ids: [node.id] });
    assert.ok(!(await call(second, "canvas_get_state")).nodes.some((n) => n.id === node.id));
    record("MCP text write/update/delete round trip succeeds without generation");
    assert.deepEqual(codexRequests, []);
    record("External Agent connection makes no Codex runtime requests");
    await page.reload();
    await page.locator("div.bottom-5 button").first().waitFor();
    await page.waitForTimeout(700);
    const reloadPanelBounds = await page.locator("#canvas-agent-client").boundingBox();
    if (!reloadPanelBounds || reloadPanelBounds.x >= 1440 || reloadPanelBounds.x < 0) {
        await page.getByTitle("打开本地 Codex 面板", { exact: true }).click();
        await page.waitForTimeout(600);
    }
    assert.ok(
        (
            await page
                .locator(".ant-select")
                .filter({ has: page.locator("#canvas-agent-client") })
                .innerText()
        ).includes("Cursor"),
    );
    // The saved Token auto-connects on reload; wait for a successful tool read.
    await page.getByRole("button", { name: "断开", exact: true }).waitFor();
    record("Client choice and service credentials survive reload");
    await page.getByRole("button", { name: "断开", exact: true }).click();
    await page.getByRole("button", { name: "连接", exact: true }).waitFor();
    for (let attempt = 0; attempt < 30; attempt++) {
        const result = await first.callTool({ name: "canvas_get_state", arguments: {} });
        if (result.isError) break;
        if (attempt === 29) throw new Error("Disconnected canvas remained accessible");
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    record("Disconnect removes canvas access for external MCP clients");
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await page.getByRole("button", { name: "断开", exact: true }).waitFor();
    await stopBridge();
    await page.getByRole("button", { name: "连接设置，当前连接失败", exact: true }).waitFor();
    await startBridge();
    // If EventSource retries automatically it may already be connected; otherwise allow manual recovery.
    const connect = page.getByRole("button", { name: "连接", exact: true });
    if (await connect.isVisible()) await connect.click();
    await page.getByRole("button", { name: "断开", exact: true }).waitFor();
    for (let attempt = 0; attempt < 30; attempt++) {
        const result = await first.callTool({ name: "canvas_get_state", arguments: {} });
        if (!result.isError) {
            assert.equal(JSON.parse(result.content[0].text).projectId, projectId);
            break;
        }
        if (attempt === 29) throw new Error("Canvas did not recover after bridge restart");
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    record("Service shutdown is visible; restart/reconnect restores canvas reads");
    assert.deepEqual(codexRequests, []);
    // Positive regression: choosing Codex still opens its runtime path. Mock its APIs to avoid starting a real account session.
    await page.route(`${bridgeUrl}/agent/codex/**`, async (route) => {
        const conversation = { revision: 100, conversationId: "qa-codex", threadId: "qa-codex", status: "ready", mcpStatuses: {} };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation, data: [], messages: [], workspace: { activeThreadId: "qa-codex" } }) });
    });
    await page.locator("#canvas-agent-client").click();
    await Promise.all([
        page.waitForRequest((req) => req.url().startsWith(`${bridgeUrl}/agent/codex/threads/reset`)),
        page.getByRole("option", { name: "Codex", exact: true }).click(),
    ]);
    await page.getByRole("tab", { name: "对话", exact: true }).waitFor();
    record("Codex opt-in retains its runtime path (mocked APIs, no model turn)");
    await mkdir("release/agent-connections", { recursive: true });
    await writeFile(
        "release/agent-connections/bridge-report.json",
        JSON.stringify({ agentVersion: JSON.parse(await readFile(join(dirname(entry), "../package.json"), "utf8")).version, checks: results, generationCalls: 0, clientApplicationsTested: false }, null, 2),
    );
} finally {
    for (const client of clients) await client.close().catch(() => {});
    await browser?.close();
    await site?.close();
    await stopBridge();
    await rm(sandbox, { recursive: true, force: true });
}
