"use client";

import { useWorkflowStore } from "@/stores/workflowStore";

const NODE_TYPES = [
  "link_import",
  "content_parser",
  "style_agent_runner",
  "topic_generator",
  "script_generator",
  "manual_review",
  "task_dispatcher"
];

export default function NodePalette() {
  const addNode = useWorkflowStore((state) => state.addNode);

  return (
    <section style={{ background: "#fff", border: "1px solid #ddd", padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>节点面板</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {NODE_TYPES.map((nodeType) => (
          <button key={nodeType} type="button" onClick={() => addNode(nodeType)} style={{ textAlign: "left" }}>
            添加 {nodeType}
          </button>
        ))}
      </div>
    </section>
  );
}
