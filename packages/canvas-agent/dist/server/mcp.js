import { assertBoundedInput } from "../canvas/input-limits.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { toolDescriptions, toolInputSchemas, toolNames } from "../canvas/schemas.js";
import { AGENT_PROMPT, loadConfig, VERSION } from "../config.js";
/** 启动通过标准输入输出通信的 MCP 服务。 */
export async function startMcpServer() {
    const config = loadConfig(true);
    const server = createCanvasMcpServer(config);
    await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 4 * 1024 * 1024 }));
}
export function createCanvasMcpServer(config, invoke) {
    const server = new McpServer({ name: "canvas-agent", version: VERSION }, { instructions: AGENT_PROMPT });
    toolNames.forEach((name) => registerCanvasTool(server, config, name, invoke));
    return server;
}
/** 向 MCP Server 注册单个 Canvas Agent 工具。 */
function registerCanvasTool(server, config, name, invoke) {
    const schema = toolInputSchemas[name];
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: schema.shape }, async (input) => {
        assertBoundedInput(input);
        const result = await (invoke ? invoke(name, schema.parse(input)) : postCanvasAgentTool(config, name, schema.parse(input)));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    });
}
/** 将 MCP 工具调用转发到本地 Canvas Agent HTTP 服务。 */
async function postCanvasAgentTool(config, name, input) {
    const res = await fetch(`${config.url}/api/tools`, { method: "POST", headers: { "content-type": "application/json", "x-canvas-agent-token": config.token }, body: JSON.stringify({ name, input }) });
    const body = (await res.json());
    if (!body.ok)
        throw new Error(body.error || "tool call failed");
    return body.result;
}
