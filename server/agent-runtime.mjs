import { existsSync } from "node:fs";
import { resolve } from "node:path";
export function agentRuntimeInfo(rootDir, local) {
    const candidates = [resolve(rootDir, "canvas-agent.tgz"), resolve(rootDir, "release/canvas-agent.tgz")];
    return { packageSpec: local ? candidates.find(existsSync) || null : null };
}
