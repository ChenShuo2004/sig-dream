import { CreateWorkflowPayload, Workflow } from "@/types/workflow";

const API_BASE_URL = "/api-proxy";

export async function getWorkflows(): Promise<Workflow[]> {
  const resp = await fetch(`${API_BASE_URL}/workflows`, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`Failed to fetch workflows: ${resp.status}`);
  }
  return resp.json();
}

export async function getWorkflow(id: string): Promise<Workflow> {
  const resp = await fetch(`${API_BASE_URL}/workflows/${id}`, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`Failed to fetch workflow detail: ${resp.status}`);
  }
  return resp.json();
}

export async function createWorkflow(payload: CreateWorkflowPayload): Promise<Workflow> {
  const resp = await fetch(`${API_BASE_URL}/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      description: payload.description ?? null,
      created_by: payload.created_by ?? null,
      definition: payload.definition ?? { nodes: [], edges: [] }
    })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create workflow: ${resp.status} ${text}`);
  }
  return resp.json();
}

export async function updateWorkflow(
  id: string,
  payload: Partial<Pick<Workflow, "name" | "description" | "status">> & {
    definition?: Workflow["definition"];
  }
): Promise<Workflow> {
  const resp = await fetch(`${API_BASE_URL}/workflows/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to update workflow: ${resp.status} ${text}`);
  }
  return resp.json();
}
