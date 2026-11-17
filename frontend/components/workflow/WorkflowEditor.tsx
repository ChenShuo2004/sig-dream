"use client";

import { useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";

import NodeConfigPanel from "@/components/workflow/NodeConfigPanel";
import NodePalette from "@/components/workflow/NodePalette";
import WorkflowCanvas from "@/components/workflow/WorkflowCanvas";
import { updateWorkflow } from "@/lib/api";
import { useWorkflowStore } from "@/stores/workflowStore";
import type { Workflow, WorkflowNodeData } from "@/types/workflow";

type WorkflowEditorProps = {
  workflow: Workflow;
};

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
      const x = typeof rawPosition.x === "number" ? rawPosition.x : 100 + index * 40;
      const y = typeof rawPosition.y === "number" ? rawPosition.y : 100 + index * 30;
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

function normalizeEdges(edges: Workflow["definition"]["edges"]): Edge[] {
  if (!Array.isArray(edges)) {
    return [];
  }
  return (edges as unknown[])
    .filter((item) => typeof item === "object" && item !== null)
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.id === "string" && typeof item.source === "string" && typeof item.target === "string")
    .map((item) => ({ id: item.id as string, source: item.source as string, target: item.target as string }));
}

export default function WorkflowEditor({ workflow }: WorkflowEditorProps) {
  const { nodes, edges } = useWorkflowStore((state) => ({ nodes: state.nodes, edges: state.edges }));
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initialNodes = useMemo(() => normalizeNodes(workflow.definition.nodes), [workflow.definition.nodes]);
  const initialEdges = useMemo(() => normalizeEdges(workflow.definition.edges), [workflow.definition.edges]);

  const onSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      await updateWorkflow(workflow.id, {
        definition: { nodes, edges }
      });
      setSaveMessage("流程保存成功");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>{workflow.name}</h1>
          <p style={{ margin: "6px 0 0 0", color: "#4b5563" }}>{workflow.description ?? "无描述"}</p>
        </div>
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? "保存中..." : "保存流程"}
        </button>
      </header>

      {saveMessage ? <p style={{ margin: 0 }}>{saveMessage}</p> : null}

      <section style={{ display: "grid", gridTemplateColumns: "240px 1fr 320px", gap: 12 }}>
        <NodePalette />
        <WorkflowCanvas workflowId={workflow.id} initialNodes={initialNodes} initialEdges={initialEdges} />
        <NodeConfigPanel />
      </section>
    </main>
  );
}
