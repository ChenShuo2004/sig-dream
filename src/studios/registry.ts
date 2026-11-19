import { REPLACEMENT_PROMPTS } from "./prompts/replacement.generated";
import { createReplacementDocument } from "./replacement/document";
import { createReplicationDocument } from "./replication/document";
import { createScriptDocument } from "./script/document";
import type { StudioDocumentBase, StudioKind } from "./types";

export function createStudioDocument(kind: StudioKind): StudioDocumentBase {
    if (kind === "script") return createScriptDocument();
    if (kind === "replication") return createReplicationDocument();
    return createReplacementDocument(REPLACEMENT_PROMPTS.defaultVideoPrompt);
}

export function isStudioKind(value: string | undefined): value is StudioKind {
    return value === "script" || value === "replication" || value === "replacement";
}
