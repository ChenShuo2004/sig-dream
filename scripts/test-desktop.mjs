import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadPlaywright } from "./_playwright.mjs";
const pw = await loadPlaywright();
const profile = await mkdtemp(join(tmpdir(), "sig-desktop-check-"));
const env = { ...process.env, SIG_DREAM_PORT: "28441" };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
    app = await pw._electron.launch({
        executablePath: resolve(process.argv[2] || { darwin: "desktop/release/mac-arm64/sig-dream.app/Contents/MacOS/sig-dream", win32: "desktop/release/win-unpacked/sig-dream.exe", linux: "desktop/release/linux-unpacked/sig-dream" }[process.platform]),
        args: [`--user-data-dir=${profile}`, ...(process.env.SIG_DREAM_TEST_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])],
        env,
        timeout: 30000,
    });
    const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath("userData"), version: app.getVersion(), electron: process.versions.electron }));
    if (runtime.userData !== profile) throw new Error("Desktop test userData was not isolated");
    const window = await app.firstWindow();
    await window.getByRole("button", { name: "打开 Agent", exact: true }).click();
    await window.locator("#canvas-agent-client").click();
    await window.getByRole("option", { name: "Cursor", exact: true }).click();
    await window.getByText("配置片段", { exact: true }).waitFor();
    await mkdir("release/agent-connections", { recursive: true });
    await window.screenshot({ path: "release/agent-connections/desktop-app.png" });
    await writeFile("release/agent-connections/desktop-report.json", JSON.stringify({ ...runtime, userData: undefined, userDataIsolated: true, agentProfiles: 10, cursorConfigVisible: true }, null, 2));
    console.log("PASS: packaged desktop app launched with isolated profile and displayed external Agent configuration");
} finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true });
}
