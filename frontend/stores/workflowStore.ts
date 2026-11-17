import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange
} from "@xyflow/react";
import { create } from "zustand";

import type { WorkflowNodeData } from "@/types/workflow";

type WorkflowStoreState = {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  initialize: (nodes: Node<WorkflowNodeData>[], edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange<Node<WorkflowNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  onConnect: (connection: Connection) => void;
  selectNode: (nodeId: string | null) => void;
  addNode: (nodeType: string) => void;
  updateSelectedNode: (data: Partial<WorkflowNodeData>) => void;
};

export const useWorkflowStore = create<WorkflowStoreState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  initialize: (nodes, edges) => set({ nodes, edges }),
  onNodesChange: (changes) => set((state) => ({ nodes: applyNodeChanges<Node<WorkflowNodeData>>(changes, state.nodes) })),
  onEdgesChange: (changes) => set((state) => ({ edges: applyEdgeChanges<Edge>(changes, state.edges) })),
  onConnect: (connection) => set((state) => ({ edges: addEdge<Edge>(connection, state.edges) })),
  selectNode: (nodeId) =>
    set((state) => {
      if (state.selectedNodeId === nodeId) {
        return state;
      }
      return { selectedNodeId: nodeId };
    }),
  addNode: (nodeType) =>
    set((state) => ({
      nodes: [
        ...state.nodes,
        {
          id: `node_${crypto.randomUUID()}`,
          type: "default",
          position: { x: 120 + state.nodes.length * 40, y: 120 + state.nodes.length * 30 },
          data: {
            label: `${nodeType} 节点`,
            nodeType,
            params: {}
          }
        }
      ]
    })),
  updateSelectedNode: (data) => {
    const selectedNodeId = get().selectedNodeId;
    if (!selectedNodeId) {
      return;
    }
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, ...data, params: { ...node.data.params, ...data.params } } }
          : node
      )
    }));
  }
}));
