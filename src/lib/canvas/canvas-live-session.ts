import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasLiveSnapshot = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

const snapshots = new Map<string, CanvasLiveSnapshot>();
const runningNodes = new Set<string>();
const videoWatches = new Map<string, AbortController>();
const listeners = new Set<(projectId: string, snapshot: CanvasLiveSnapshot) => void>();

function nodeKey(projectId: string, nodeId: string) {
    return `${projectId}\0${nodeId}`;
}

export function rememberCanvasSnapshot(projectId: string, patch: Partial<CanvasLiveSnapshot>) {
    if (!projectId) return;
    const current = snapshots.get(projectId);
    const stored = current ? null : useCanvasStore.getState().openProject(projectId);
    const base: CanvasLiveSnapshot = current ?? { nodes: stored?.nodes ?? [], connections: stored?.connections ?? [] };
    snapshots.set(projectId, {
        nodes: patch.nodes ?? base.nodes,
        connections: patch.connections ?? base.connections,
    });
}

export function getCanvasSnapshot(projectId: string) {
    return snapshots.get(projectId);
}

export function commitCanvasSnapshot(projectId: string, update: (snapshot: CanvasLiveSnapshot) => CanvasLiveSnapshot) {
    if (!projectId) return;
    const current = snapshots.get(projectId);
    const stored = current ? null : useCanvasStore.getState().openProject(projectId);
    const base: CanvasLiveSnapshot = current ?? { nodes: stored?.nodes ?? [], connections: stored?.connections ?? [] };
    const next = update(base);
    snapshots.set(projectId, next);
    useCanvasStore.getState().updateProject(projectId, { nodes: next.nodes, connections: next.connections });
    listeners.forEach((listener) => listener(projectId, next));
}

export function subscribeCanvasLive(listener: (projectId: string, snapshot: CanvasLiveSnapshot) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function observeCanvasGeneration(projectId: string, previous: CanvasNodeData[], next: CanvasNodeData[]) {
    if (!projectId) return;
    const wasLoading = new Set(previous.filter((node) => node.metadata?.status === "loading").map((node) => node.id));
    const nowLoading = new Set(next.filter((node) => node.metadata?.status === "loading").map((node) => node.id));
    wasLoading.forEach((id) => {
        if (!nowLoading.has(id)) runningNodes.delete(nodeKey(projectId, id));
    });
    nowLoading.forEach((id) => {
        if (!wasLoading.has(id)) runningNodes.add(nodeKey(projectId, id));
    });
}

export function isCanvasGenerationRunning(projectId: string, nodeId: string) {
    return runningNodes.has(nodeKey(projectId, nodeId));
}

/** One in-flight poll per provider task, so leaving and reopening the canvas does not download the result twice. */
export function claimCanvasVideoWatch(taskId: string, controller: AbortController) {
    const id = taskId.trim();
    const current = id ? videoWatches.get(id) : undefined;
    if (!id || (current && !current.signal.aborted)) return false;
    videoWatches.set(id, controller);
    return true;
}

export function releaseCanvasVideoWatch(taskId: string, controller?: AbortController) {
    const id = taskId.trim();
    if (!id) return;
    if (controller && videoWatches.get(id) !== controller) return;
    videoWatches.delete(id);
}

export function abortCanvasVideoWatch(taskId: string) {
    const id = taskId.trim();
    const controller = id ? videoWatches.get(id) : undefined;
    videoWatches.delete(id);
    controller?.abort();
}

export function canvasVideoWatchActive(taskId: string) {
    const controller = videoWatches.get(taskId.trim());
    return Boolean(controller && !controller.signal.aborted);
}
