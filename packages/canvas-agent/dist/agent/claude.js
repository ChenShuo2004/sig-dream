import { spawn } from "node:child_process";
import { AGENT_PROMPT } from "../config.js";
import { errorMessage } from "../utils/value.js";
/** 使用 Claude CLI 执行一次带 Canvas Agent 工具的任务。 */
export function runClaudeTurn(prompt, emit) {
    const fullPrompt = withAgentPrompt(prompt);
    if (!fullPrompt)
        return;
    const child = spawnAgent("claude", ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--allowedTools", "mcp__infinite-canvas__*", fullPrompt], emit);
    if (child)
        pipeJsonLines(child, emit, "claude");
}
/** 为 Claude CLI 请求拼接 Canvas Agent 指令。 */
function withAgentPrompt(prompt) {
    return prompt.trim() ? `${AGENT_PROMPT}\n\n用户请求：${prompt}` : "";
}
/** 将 Claude CLI 的 JSON Lines 输出转换为 Agent 事件。 */
function pipeJsonLines(child, emit, agent) {
    let out = "";
    child.stdout?.on("data", (chunk) => {
        out += chunk.toString();
        const lines = out.split(/\r?\n/);
        out = lines.pop() || "";
        lines.filter(Boolean).forEach((line) => {
            try {
                emit("agent_event", { agent, ...JSON.parse(line) });
            }
            catch {
                emit("agent_event", { agent, type: "raw", text: line });
            }
        });
    });
    child.stderr?.on("data", (chunk) => emit("agent_log", { text: chunk.toString() }));
    child.on("error", (error) => emit("agent_error", { message: error.message }));
    child.on("close", (code) => emit("agent_done", { agent, code }));
}
/** 启动外部 Agent CLI，并将同步启动异常转换为事件。 */
function spawnAgent(name, args, emit) {
    try {
        return spawn(name, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", windowsHide: true });
    }
    catch (error) {
        emit("agent_error", { message: errorMessage(error) });
        return null;
    }
}
