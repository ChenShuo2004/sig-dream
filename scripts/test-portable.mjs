import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPlaywright, launchChromium } from "./_playwright.mjs";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const zip = resolve(process.argv[2] || `release/sig-dream-${pkg.version}-web-portable.zip`);
const unpacked = await mkdtemp(join(tmpdir(), "sig-portable-check-"));
let browser;
let server;
try {
    execFileSync("unzip", ["-q", zip, "-d", unpacked]);
    const root = join(unpacked, `sig-dream-${pkg.version}-web-portable`);
    const bundle = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.equal(bundle.version, pkg.version);
    assert.equal(bundle.dependencies, undefined, "portable runtime requires no npm install");
    assert.equal(await readFile(join(root, "dist/index.html"), "utf8"), await readFile("dist/index.html", "utf8"));
    assert.ok((await readFile(join(root, "docs/agent-connections.md"), "utf8")).includes("MCP"));
    const { startServer } = await import(pathToFileURL(join(root, "server/index.mjs")).href);
    server = await startServer({ port: 0, distDir: join(root, "dist") });
    assert.equal(server.host, "127.0.0.1", "portable service defaults to loopback");
    assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
    browser = await launchChromium(await loadPlaywright());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.getByRole("button", { name: "打开 Agent", exact: true }).click();
    await page.locator("#canvas-agent-client").click();
    assert.equal(await page.getByRole("option").count(), 10);
    await page.getByRole("option", { name: "Muse Code", exact: true }).click();
    await page.getByText("配置片段", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    const report = {
        zip,
        version: bundle.version,
        sha256: createHash("sha256")
            .update(await readFile(zip))
            .digest("hex"),
        extractedRuntime: true,
        nodeDependenciesRequired: false,
        agentProfiles: 10,
        guideIncluded: true,
        pageErrors: errors,
    };
    await writeFile("release/agent-connections/portable-report.json", JSON.stringify(report, null, 2));
    console.log("PASS: extracted portable archive starts independently, includes Agent guide and all 10 profiles");
} finally {
    await browser?.close();
    await server?.close();
    await rm(unpacked, { recursive: true, force: true });
}
