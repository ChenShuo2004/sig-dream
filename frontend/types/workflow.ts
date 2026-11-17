import type { Edge, Node } from "@xyflow/react";

export type WorkflowNodeData = {
  label: string;
  nodeType: string;
  params?: Record<string, unknown>;
};

export type WorkflowDefinition = {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
};

export type Workflow = {
  id: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  created_by: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type CreateWorkflowPayload = {
  name: string;
  description?: string;
  created_by?: string;
  definition?: WorkflowDefinition;
};
