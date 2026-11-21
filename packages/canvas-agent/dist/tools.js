import { toolInputSchemas, toolNames } from "./schemas.js";
export function isToolName(name) {
    return typeof name === "string" && toolNames.includes(name);
}
export function parseToolInput(name, input) {
    return toolInputSchemas[name].parse(input ?? {});
}
export function compactCanvasState(state) {
    if (!state)
        throw new Error("当前没有已连接画布");
    return { ...state, nodes: (state.nodes || []).map(compactNode) };
}
export function compactNode(node) {
    const metadata = { ...(node.metadata || {}) };
    if (typeof metadata.content === "string" && metadata.content.length > 240)
        metadata.content = `${metadata.content.slice(0, 120)}...`;
    return { id: node.id, type: node.type, title: node.title, position: node.position, width: node.width, height: node.height, metadata };
}
export function nextCanvasX(state) {
    const nodes = state?.nodes || [];
    return nodes.length ? Math.max(...nodes.map((node) => node.position.x + node.width)) + 80 : 0;
}
