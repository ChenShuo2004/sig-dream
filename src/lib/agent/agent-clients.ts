/** External MCP clients share the existing Canvas Agent bridge, independent of the chat runtime. */
export const CANVAS_AGENT_PACKAGE = "https://github.com/ChenShuo2004/sig-dream/releases/download/v0.3.4/sig-dream-canvas-agent-0.3.4.tgz";
export const CANVAS_AGENT_ARGS = ["--yes", "--package", CANVAS_AGENT_PACKAGE, "--", "canvas-agent", "mcp"];
export const CANVAS_AGENT_START = `npx --yes --package ${CANVAS_AGENT_PACKAGE} -- canvas-agent`;

const json = (value: unknown) => JSON.stringify(value, null, 2);

export type AgentClient = {
    id: string;
    name: string;
    configPath: string;
    config: string;
    command?: string;
    verify?: string;
    docs?: string;
};

export function buildAgentClients(packageSpec = CANVAS_AGENT_PACKAGE, shell: "posix" | "powershell" = "posix"): AgentClient[] {
    const CANVAS_AGENT_ARGS = ["--yes", "--package", packageSpec, "--", "canvas-agent", "mcp"];
    const mcpCommand = `npx --yes --package ${quoteShell(packageSpec, shell)} -- canvas-agent mcp`;
    const stdio = () => ({ command: "npx", args: [...CANVAS_AGENT_ARGS] });
    const commonConfig = () => json({ mcpServers: { "infinite-canvas": stdio() } });
    const tomlConfig = () => `[mcp_servers.infinite-canvas]\ncommand = "npx"\nargs = ${JSON.stringify(CANVAS_AGENT_ARGS)}`;
    return [
        { id: "codex", name: "Codex", configPath: "~/.codex/config.toml", config: tomlConfig(), command: `codex mcp add infinite-canvas -- ${mcpCommand}`, verify: "codex mcp list", docs: "https://developers.openai.com/codex/mcp" },
        {
            id: "claude",
            name: "Claude Code / Desktop",
            configPath: ".mcp.json (Claude Code) / claude_desktop_config.json (Desktop)",
            config: commonConfig(),
            command: `claude mcp add --scope user --transport stdio infinite-canvas -- ${mcpCommand}`,
            verify: "claude mcp list",
            docs: "https://code.claude.com/docs/en/mcp",
        },
        { id: "cursor", name: "Cursor", configPath: "~/.cursor/mcp.json / .cursor/mcp.json", config: commonConfig(), docs: "https://cursor.com/docs/mcp" },
        { id: "grok", name: "Grok Build", configPath: "~/.grok/config.toml", config: tomlConfig(), command: `grok mcp add infinite-canvas -- ${mcpCommand}`, verify: "grok mcp doctor infinite-canvas", docs: "https://docs.x.ai/build/features/mcp-servers" },
        {
            id: "opencode",
            name: "OpenCode 2",
            configPath: "opencode.json / ~/.config/opencode/opencode.json",
            config: json({ $schema: "https://opencode.ai/config.json", mcp: { servers: { "infinite-canvas": { type: "local", command: ["npx", ...CANVAS_AGENT_ARGS] } } } }),
            command: `opencode mcp add infinite-canvas -- ${mcpCommand}`,
            verify: "opencode mcp list",
            docs: "https://opencode.ai/docs/mcp-servers",
        },
        { id: "antigravity", name: "Antigravity", configPath: "MCP Servers → Manage MCP Servers → View raw config", config: commonConfig(), docs: "https://antigravity.google/docs/mcp" },
        {
            id: "muse",
            name: "Muse Code",
            configPath: ".mcp.json / ~/.config/muse/settings.json → mcpServers",
            config: json({ mcpServers: { "infinite-canvas": { type: "stdio", ...stdio() } } }),
            docs: "https://meta-models.github.io/muse-code-sdk/next/guides/extend/mcp-servers/",
        },
        {
            id: "pi",
            name: "Pi (MCP)",
            configPath: "~/.pi/agent/mcp.json / .pi/mcp.json",
            config: commonConfig(),
            command: `pi mcp add infinite-canvas -- ${mcpCommand}`,
            verify: "pi mcp list",
            docs: "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md",
        },
        {
            id: "opencode-v1",
            name: "OpenCode 1",
            configPath: "opencode.json / ~/.config/opencode/opencode.json",
            config: json({ $schema: "https://opencode.ai/config.json", mcp: { "infinite-canvas": { type: "local", command: ["npx", ...CANVAS_AGENT_ARGS], enabled: true } } }),
            verify: "opencode mcp list",
            docs: "https://opencode.ai/docs/mcp-servers",
        },
        { id: "generic", name: "MCP · stdio", configPath: "mcpServers", config: commonConfig() },
    ];
}
export const AGENT_CLIENTS = buildAgentClients();

export function quoteShell(value: string, shell: "posix" | "powershell" = "posix") {
    const escaped = shell === "powershell" ? value.replace(/'/g, "''") : value.split("'").join("'" + String.fromCharCode(92) + "''");
    return "'" + escaped + "'";
}
