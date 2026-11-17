"use client";

import { useEffect, useMemo, useState } from "react";

import { useWorkflowStore } from "@/stores/workflowStore";

export default function NodeConfigPanel() {
  const { nodes, selectedNodeId, updateSelectedNode } = useWorkflowStore((state) => ({
    nodes: state.nodes,
    selectedNodeId: state.selectedNodeId,
    updateSelectedNode: state.updateSelectedNode
  }));

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const [paramsInput, setParamsInput] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedNode) {
      setParamsInput(JSON.stringify(selectedNode.data.params ?? {}, null, 2));
    }
  }, [selectedNode]);

  if (!selectedNode) {
    return (
      <section style={{ background: "#fff", border: "1px solid #ddd", padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>节点配置</h3>
        <p>请先在画布中选择一个节点。</p>
      </section>
    );
  }

  const applyParams = () => {
    setError(null);
    try {
      const parsed = JSON.parse(paramsInput) as Record<string, unknown>;
      updateSelectedNode({ params: parsed });
    } catch {
      setError("params 不是合法 JSON");
    }
  };

  return (
    <section style={{ background: "#fff", border: "1px solid #ddd", padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>节点配置</h3>
      <div style={{ display: "grid", gap: 8 }}>
        <label>
          节点标题
          <input
            value={selectedNode.data.label}
            onChange={(event) => updateSelectedNode({ label: event.target.value })}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          节点参数（JSON）
          <textarea
            rows={8}
            value={paramsInput}
            onChange={(event) => setParamsInput(event.target.value)}
            style={{ width: "100%", fontFamily: "monospace" }}
          />
        </label>
        <button type="button" onClick={applyParams}>
          应用参数
        </button>
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
      </div>
    </section>
  );
}
