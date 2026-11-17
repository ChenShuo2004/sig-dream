"use client";

import "@xyflow/react/dist/style.css";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";

import type { Workflow } from "@/types/workflow";
import type { WorkflowNodeData } from "@/types/workflow";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class CanvasErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("Workflow readonly canvas crashed", { error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function normalizeNodes(nodes: unknown): Node<WorkflowNodeData>[] {
  if (!Array.isArray(nodes)) {
    return [];
  }
  return (nodes as unknown[])
    .filter((item) => typeof item === "object" && item !== null)
    .map((item, index) => {
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" && row.id.length > 0 ? row.id : `node_${index + 1}`;
      const rawPosition = (row.position as Record<string, unknown> | undefined) ?? {};
      const x = typeof rawPosition.x === "number" ? rawPosition.x : 80 + index * 40;
      const y = typeof rawPosition.y === "number" ? rawPosition.y : 80 + index * 30;
      const rawData = (row.data as Record<string, unknown> | undefined) ?? {};
      const label = typeof rawData.label === "string" && rawData.label.length > 0 ? rawData.label : `节点 ${index + 1}`;
      const nodeType =
        typeof rawData.nodeType === "string" && rawData.nodeType.length > 0 ? rawData.nodeType : "custom";
      const params =
        typeof rawData.params === "object" && rawData.params !== null
          ? (rawData.params as Record<string, unknown>)
          : {};
      return {
        id,
        type: "default",
        position: { x, y },
        data: { label, nodeType, params }
      };
    });
}

function normalizeEdges(edges: unknown): Edge[] {
  if (!Array.isArray(edges)) {
    return [];
  }
  return (edges as unknown[])
    .filter((item) => typeof item === "object" && item !== null)
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.id === "string" && typeof item.source === "string" && typeof item.target === "string")
    .map((item) => ({ id: item.id as string, source: item.source as string, target: item.target as string }));
}

type WorkflowReadonlyViewProps = {
  workflow: Workflow;
};

export default function WorkflowReadonlyView({ workflow }: WorkflowReadonlyViewProps) {
  const nodes = normalizeNodes(workflow.definition.nodes);
  const edges = normalizeEdges(workflow.definition.edges);
  const isEmpty = nodes.length === 0;

  const fallback = (
    <pre style={{ margin: 0, background: "#fff", border: "1px solid #ddd", padding: 12, overflow: "auto" }}>
      {JSON.stringify(workflow.definition, null, 2)}
    </pre>
  );

  return (
    <CanvasErrorBoundary fallback={fallback}>
      <div style={{ width: "100%", height: 520, border: "1px solid #ddd", background: "#fff", position: "relative" }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </ReactFlowProvider>
        {isEmpty ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#6b7280",
              pointerEvents: "none"
            }}
          >
            当前流程还没有节点，请在工作流列表页新建或后续恢复编辑模式后添加节点。
          </div>
        ) : null}
      </div>
    </CanvasErrorBoundary>
  );
}
