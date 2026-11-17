"use client";

import "@xyflow/react/dist/style.css";

import { useEffect, useRef } from "react";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node
} from "@xyflow/react";

import { useWorkflowStore } from "@/stores/workflowStore";
import type { WorkflowNodeData } from "@/types/workflow";

type WorkflowCanvasProps = {
  workflowId: string;
  initialNodes: Node<WorkflowNodeData>[];
  initialEdges: Edge[];
};

function CanvasInner({ workflowId, initialNodes, initialEdges }: WorkflowCanvasProps) {
  const { nodes, edges, initialize } = useWorkflowStore((state) => ({
    nodes: state.nodes,
    edges: state.edges,
    initialize: state.initialize
  }));
  const initializedWorkflowIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializedWorkflowIdRef.current === workflowId) {
      return;
    }
    initialize(initialNodes, initialEdges);
    initializedWorkflowIdRef.current = workflowId;
  }, [initialize, initialEdges, initialNodes, workflowId]);

  return (
    <div style={{ width: "100%", height: 520, border: "1px solid #ddd", background: "#fff" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}

export default function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
