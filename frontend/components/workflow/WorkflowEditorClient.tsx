"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

import type { Workflow } from "@/types/workflow";

const WorkflowEditor = dynamic(() => import("@/components/workflow/WorkflowEditor"), {
  ssr: false
}) as ComponentType<{ workflow: Workflow }>;

type WorkflowEditorClientProps = {
  workflow: Workflow;
};

export default function WorkflowEditorClient({ workflow }: WorkflowEditorClientProps) {
  return <WorkflowEditor workflow={workflow} />;
}
