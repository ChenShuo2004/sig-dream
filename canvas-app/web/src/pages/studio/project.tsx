import { lazy, Suspense } from "react";
import { useParams } from "react-router-dom";

import NotFound from "@/pages/not-found";
import { StudioLoading } from "@/studios/components/studio-shell";
import { isStudioKind } from "@/studios/registry";

const ScriptStudio = lazy(() => import("@/pages/studio-script"));
const ReplicationStudio = lazy(() => import("@/pages/studio-replication"));
const ReplacementStudio = lazy(() => import("@/pages/studio-replacement"));

export default function StudioProjectPage() {
    const { kind, id } = useParams();
    if (!isStudioKind(kind) || !id) return <NotFound />;
    const Studio = kind === "script" ? ScriptStudio : kind === "replication" ? ReplicationStudio : ReplacementStudio;
    return (
        <Suspense fallback={<StudioLoading error="" />}>
            <Studio key={id} projectId={id} />
        </Suspense>
    );
}
