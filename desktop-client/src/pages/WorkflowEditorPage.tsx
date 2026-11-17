import { useParams } from "react-router-dom";

import WebParityPending from "@/pages/WebParityPending";

export default function WorkflowEditorPage() {
  const { id } = useParams();
  return <WebParityPending title={`工作流 ${id ?? ""}`} refPath="frontend/app/workflows/[id]/page.tsx" />;
}
