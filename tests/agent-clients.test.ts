import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_CLIENTS, CANVAS_AGENT_ARGS, CANVAS_AGENT_START, CANVAS_AGENT_PACKAGE, quoteShell } from "../src/lib/agent/agent-clients.ts";

test("all requested clients and a generic stdio entry are discoverable", () => {
    for (const id of ["codex", "claude", "cursor", "grok", "opencode", "antigravity", "muse", "pi", "generic"]) {
        assert.ok(
            AGENT_CLIENTS.find((client) => client.id === id),
            id,
        );
    }
    assert.equal(new Set(AGENT_CLIENTS.map((client) => client.id)).size, AGENT_CLIENTS.length);
});

test("JSON clients start MCP mode rather than the HTTP-only service", () => {
    for (const client of AGENT_CLIENTS.filter((client) => client.config.startsWith("{"))) {
        const config = JSON.parse(client.config);
        const server = config.mcpServers?.["infinite-canvas"] ?? config.mcp?.servers?.["infinite-canvas"] ?? config.mcp?.["infinite-canvas"];
        assert.ok(server, client.id);
        if (Array.isArray(server.command)) assert.deepEqual(server.command, ["npx", ...CANVAS_AGENT_ARGS]);
        else {
            assert.equal(server.command, "npx");
            assert.deepEqual(server.args, CANVAS_AGENT_ARGS);
        }
    }
    assert.ok(!CANVAS_AGENT_START.endsWith(" mcp"));
});

test("OpenCode versions retain their distinct schemas", () => {
    const v2 = JSON.parse(AGENT_CLIENTS.find((c) => c.id === "opencode")!.config);
    const v1 = JSON.parse(AGENT_CLIENTS.find((c) => c.id === "opencode-v1")!.config);
    assert.equal(v2.mcp.servers["infinite-canvas"].type, "local");
    assert.equal(v2.mcp.servers["infinite-canvas"].enabled, undefined);
    assert.equal(v1.mcp["infinite-canvas"].enabled, true);
    assert.equal(v1.mcp.servers, undefined);
});

test("registration commands include stdio mode and keep approval settings intact", () => {
    for (const client of AGENT_CLIENTS) {
        if (client.command) assert.ok(client.command.endsWith(` -- npx --yes --package ${quoteShell(CANVAS_AGENT_PACKAGE)} -- canvas-agent mcp`), client.id);
        assert.ok(!client.config.includes("approval_mode"));
        assert.ok(!client.config.includes("token"));
    }
});

test("package paths with spaces, quotes and shell metacharacters remain one literal argument", async () => {
    const { execFileSync } = await import("node:child_process");
    const value = "/tmp/Agent's canvas $name `text`/canvas-agent.tgz";
    if (process.platform !== "win32") assert.equal(execFileSync("/bin/sh", ["-c", `printf '%s' ${quoteShell(value)}`], { encoding: "utf8" }), value);
    assert.equal(quoteShell("C:\\Agent's files\\agent.tgz", "powershell"), "'C:\\Agent''s files\\agent.tgz'");
});
