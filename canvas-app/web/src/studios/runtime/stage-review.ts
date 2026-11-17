import { SCRIPT_TEMPLATES } from "../prompts/script.generated";
import { expectArray, expectObject, readText, requestStrictResult, StrictResultError } from "./strict-request";

export type ReviewStage = "summary" | "outline" | "script";
export type ReviewVerdict = "pass" | "repair" | "needs_confirmation";

export type ReviewIssue = { ref: string; field: string; code: string; reason: string; evidence: string; instruction: string };
export type ReviewDecision = { ref: string; field: string; disposition: "repair" | "needs_confirmation" | "dismiss"; reason: string };
export type ReviewPatch = { ref: string; field: string; value: string | string[] };

export type ReviewTarget = { ref: string; title?: string; fields: Record<string, unknown> };

export type StageReviewOutcome = {
    verdict: ReviewVerdict;
    issues: ReviewIssue[];
    decisions: ReviewDecision[];
    repairRounds: number;
    reviewRounds: number;
};

type ReviewTemplate = {
    reviewSystemPrompt: string;
    review: Record<string, unknown> & { instructions: string[]; outputSchema: Record<string, unknown> };
    resolveSystemPrompt?: string;
    resolve?: Record<string, unknown> & { instructions: string[]; outputSchema: Record<string, unknown> };
};

const TEMPLATES = SCRIPT_TEMPLATES.stageReview as unknown as Record<ReviewStage, ReviewTemplate>;
const SUMMARY_TEMPLATE = TEMPLATES.summary;
const REPAIR_LIMIT = 2;

export function readPath(value: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined), value);
}

export function writePath<T extends Record<string, unknown>>(value: T, path: string, next: unknown): T {
    const [head, ...rest] = path.split(".");
    if (!rest.length) return { ...value, [head]: next };
    const child = value[head] && typeof value[head] === "object" ? (value[head] as Record<string, unknown>) : {};
    return { ...value, [head]: writePath(child, rest.join("."), next) };
}

function parseIssues(value: unknown): { verdict: ReviewVerdict; issues: ReviewIssue[] } {
    const result = expectObject(value, "审核结果");
    const verdict = readText(result.verdict) as ReviewVerdict;
    if (!["pass", "repair", "needs_confirmation"].includes(verdict)) throw new StrictResultError("verdict 必须是 pass、repair 或 needs_confirmation。");
    const issues = expectArray(result.issues ?? [], "issues").map((item) => {
        const issue = expectObject(item, "issue");
        return {
            ref: readText(issue.ref),
            field: readText(issue.field),
            code: readText(issue.code),
            reason: readText(issue.reason),
            evidence: readText(issue.evidence),
            instruction: readText(issue.instruction),
        };
    });
    if (verdict === "pass" && issues.length) throw new StrictResultError("verdict=pass 时 issues 必须为空数组。");
    if (verdict !== "pass" && !issues.length) throw new StrictResultError("verdict 不是 pass 时必须列出 issues。");
    return { verdict, issues };
}

function parseResolution(value: unknown, claims: ReviewIssue[]) {
    const result = expectObject(value, "核验结果");
    const decisions = expectArray(result.decisions ?? [], "decisions").map((item) => {
        const decision = expectObject(item, "decision");
        const disposition = readText(decision.disposition) as ReviewDecision["disposition"];
        if (!["repair", "needs_confirmation", "dismiss"].includes(disposition)) throw new StrictResultError("disposition 必须是 repair、needs_confirmation 或 dismiss。");
        return { ref: readText(decision.ref), field: readText(decision.field), disposition, reason: readText(decision.reason) };
    });
    const missing = claims.filter((claim) => !decisions.some((decision) => decision.ref === claim.ref && decision.field === claim.field));
    if (missing.length) throw new StrictResultError("每条 claims 必须恰好有一个决定。", { missing: missing.map(({ ref, field }) => ({ ref, field })) });
    const patches = expectArray(result.patches ?? [], "patches").map((item) => {
        const patch = expectObject(item, "patch");
        const raw = patch.value;
        const patchValue = Array.isArray(raw) ? raw.map(readText) : readText(raw);
        if (!patchValue || (Array.isArray(patchValue) && !patchValue.length)) throw new StrictResultError("patch.value 不能为空。");
        return { ref: readText(patch.ref), field: readText(patch.field), value: patchValue };
    });
    return { decisions, patches };
}

function valueContract(value: unknown) {
    if (Array.isArray(value)) return { valueType: "string[]", arrayLength: value.length, serializedJsonDocumentAllowed: false };
    return { valueType: "string", serializedJsonDocumentAllowed: false };
}

function resolveInstructions(stage: ReviewStage, allowRepair: boolean) {
    const instructions = (SUMMARY_TEMPLATE.resolve?.instructions || []).filter((line) => stage === "summary" || !line.startsWith("摘要阶段"));
    if (allowRepair) return instructions;
    return instructions.map((line) => (line.startsWith("当前尚有原内容修补预算") ? "原内容修补预算已用完；核实成立的问题仍判 repair 或 needs_confirmation，但 patches=[]。" : line));
}

export async function runStageReview({
    stage,
    model,
    grounding,
    artifact,
    targets,
    applyPatches,
    criteria,
    signal,
    onLog,
}: {
    stage: ReviewStage;
    model: string;
    grounding: Record<string, unknown>;
    artifact: () => unknown;
    targets: () => ReviewTarget[];
    applyPatches: (patches: ReviewPatch[]) => void;
    criteria?: string[];
    signal?: AbortSignal;
    onLog?: (message: string) => void;
}): Promise<StageReviewOutcome> {
    const template = TEMPLATES[stage];
    const resolveTemplate = SUMMARY_TEMPLATE.resolve!;
    let reviewRound = 1;
    let repairRound = 0;
    let previousIssues: ReviewIssue[] = [];
    let decisions: ReviewDecision[] = [];
    for (;;) {
        const editableTargets = targets().map((target) => ({ ref: target.ref, fields: Object.keys(target.fields) }));
        onLog?.(`第 ${reviewRound} 轮自动审核`);
        const { result: review } = await requestStrictResult({
            model,
            systemPrompt: template.reviewSystemPrompt,
            payload: {
                task: template.review.task,
                stage,
                reviewRound,
                repairRound,
                grounding,
                artifact: artifact(),
                issues: previousIssues,
                editableTargets,
                criteria: criteria || template.review.criteria,
                instructions: template.review.instructions,
                outputSchema: template.review.outputSchema,
                formatCorrectionProtocol: template.review.formatCorrectionProtocol,
            },
            schemaName: `story_${stage}_review`,
            schema: template.review.outputSchema,
            temperature: 0.1,
            parse: (value) => parseIssues(value),
            signal,
        });
        if (review.verdict === "pass") return { verdict: "pass", issues: [], decisions, repairRounds: repairRound, reviewRounds: reviewRound };
        if (review.verdict === "needs_confirmation" || repairRound >= REPAIR_LIMIT) {
            return { verdict: review.verdict, issues: review.issues, decisions, repairRounds: repairRound, reviewRounds: reviewRound };
        }

        reviewRound += 1;
        const currentTargets = targets();
        const claimTargets = currentTargets
            .map((target) => {
                const fields = Object.keys(target.fields).filter((field) => review.issues.some((issue) => issue.ref === target.ref && issue.field === field));
                return { target, fields };
            })
            .filter((entry) => entry.fields.length);
        onLog?.(`核验 ${review.issues.length} 条问题并局部修补`);
        const { result: resolution } = await requestStrictResult({
            model,
            systemPrompt: SUMMARY_TEMPLATE.resolveSystemPrompt || "",
            payload: {
                task: resolveTemplate.task,
                stage,
                reviewRound,
                repairRound,
                allowRepair: true,
                grounding,
                claims: review.issues,
                editableTargets: claimTargets.map(({ target, fields }) => ({
                    ref: target.ref,
                    fields,
                    valueContracts: Object.fromEntries(fields.map((field) => [field, valueContract(target.fields[field])])),
                })),
                targetContext: claimTargets.map(({ target }) => ({ ref: target.ref, value: target.fields })),
                structure: currentTargets.map((target) => ({ ref: target.ref, title: target.title || target.ref })),
                instructions: resolveInstructions(stage, true),
                outputSchema: resolveTemplate.outputSchema,
                formatCorrectionProtocol: resolveTemplate.formatCorrectionProtocol,
            },
            schemaName: `story_${stage}_finding_resolution`,
            schema: resolveTemplate.outputSchema,
            temperature: 0.1,
            parse: (value) => parseResolution(value, review.issues),
            signal,
        });
        decisions = resolution.decisions;
        if (resolution.decisions.some((decision) => decision.disposition === "needs_confirmation")) {
            return { verdict: "needs_confirmation", issues: review.issues, decisions, repairRounds: repairRound, reviewRounds: reviewRound };
        }
        const allowed = new Set(claimTargets.flatMap(({ target, fields }) => fields.map((field) => `${target.ref}::${field}`)));
        const repairs = new Set(resolution.decisions.filter((decision) => decision.disposition === "repair").map((decision) => `${decision.ref}::${decision.field}`));
        const patches = resolution.patches.filter((patch) => allowed.has(`${patch.ref}::${patch.field}`) && repairs.has(`${patch.ref}::${patch.field}`));
        if (!repairs.size) return { verdict: "pass", issues: [], decisions, repairRounds: repairRound, reviewRounds: reviewRound };
        if (!patches.length) return { verdict: "repair", issues: review.issues, decisions, repairRounds: repairRound, reviewRounds: reviewRound };
        applyPatches(patches);
        repairRound += 1;
        previousIssues = review.issues.filter((issue) => repairs.has(`${issue.ref}::${issue.field}`));
        reviewRound += 1;
    }
}
