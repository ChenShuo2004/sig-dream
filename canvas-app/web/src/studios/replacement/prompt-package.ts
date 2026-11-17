/** Port of SHUO personReplacementPromptCompiler.buildPersonReplacementPromptPackage for one shot. */
import { characterImageKey, personTarget, type ReplacementCharacter, type ReplacementIdentity, type ReplacementPerson, type ReplacementShot } from "./document";
import {
    NO_BINDING_PROMPT,
    buildPersonReplacementLocationGuideSvg,
    buildPersonReplacementPositioningPrompt,
    describePersonReplacementBoxPosition,
    formatPersonReplacementPersonLabel,
    getPersonReplacementPromptMarker,
    type DescriptionBinding,
    type PromptEntry,
} from "./prompt-mode";

export type PackageReference =
    | { slot: number; label: string; role: "source-keyframe"; mediaKey: string }
    | { slot: number; label: string; role: "target-character"; mediaKey: string; characterId: string }
    | { slot: number; label: string; role: "person-location-guide"; svg: string }
    | { slot: number; label: string; role: "target-scene"; mediaKey: string; characterId: string };

export type PromptPackage = {
    mode: ReplacementShot["promptMode"];
    prompt: string;
    references: PackageReference[];
    bindings: DescriptionBinding[];
    locationGuideSlot: number;
    sceneReferenceSlot: number;
    markers: Array<{ personId: string; label: string; colorIndex: number; mapped: boolean }>;
    warnings: string[];
};

const MAX_TARGETS = 8;

function compareByPosition(a: ReplacementPerson, b: ReplacementPerson) {
    const left = a.bbox.x + a.bbox.width / 2;
    const right = b.bbox.x + b.bbox.width / 2;
    return left - right || a.id.localeCompare(b.id, "zh-CN");
}

export function personLabel(person: ReplacementPerson) {
    return formatPersonReplacementPersonLabel(person.promptMarkerIndex);
}

export function buildShotPromptPackage(shot: ReplacementShot, identities: ReplacementIdentity[], characters: ReplacementCharacter[], frame: { width: number; height: number }): PromptPackage {
    const mode = shot.promptMode;
    const manual = mode === "manual";
    const positioning = mode === "positioning";
    const byId = new Map(characters.map((character) => [character.id, character]));
    const ordered = [...shot.persons].sort((a, b) => a.promptMarkerIndex - b.promptMarkerIndex);
    const references: PackageReference[] = [{ slot: 1, label: "图像1", role: "source-keyframe", mediaKey: shot.keyframeKey }];
    const targetRefs = new Map<string, PackageReference>();
    const entries: Array<{ person: ReplacementPerson; reference: PackageReference; sourceLabel: string }> = [];
    const warnings: string[] = [];
    let overflow = false;

    for (const person of ordered) {
        const targetId = personTarget(person, identities);
        if (!targetId) continue;
        const character = byId.get(targetId);
        const imageKey = characterImageKey(character, person.targetAppearanceId);
        if (!character || !imageKey) {
            if (!manual) warnings.push(!character ? `未找到目标角色：${targetId}` : `目标角色缺少参考图：${character.name || targetId}`);
            continue;
        }
        const refKey = `${targetId}:${imageKey}`;
        if (!targetRefs.has(refKey)) {
            if (!manual && targetRefs.size >= MAX_TARGETS) {
                overflow = true;
                continue;
            }
            const slot = references.length + 1;
            const reference: PackageReference = { slot, label: `图${slot}`, role: "target-character", mediaKey: imageKey, characterId: targetId };
            references.push(reference);
            targetRefs.set(refKey, reference);
        }
        entries.push({ person, reference: targetRefs.get(refKey)!, sourceLabel: personLabel(person) });
    }
    if (overflow) warnings.push("单次最多替换 8 个目标人物");

    let locationGuideSlot = 0;
    if (positioning && entries.length) {
        locationGuideSlot = references.length + 1;
        const guide = buildPersonReplacementLocationGuideSvg({
            frame,
            people: entries.map(({ person, sourceLabel }) => ({ label: sourceLabel.replace("人物", ""), markerIndex: person.promptMarkerIndex, bbox: person.bbox })),
        });
        references.push({ slot: locationGuideSlot, label: `图${locationGuideSlot}`, role: "person-location-guide", svg: guide.svg });
    }

    let sceneReferenceSlot = 0;
    if (shot.sceneId) {
        const scene = byId.get(shot.sceneId);
        const sceneKey = characterImageKey(scene);
        if (scene && sceneKey) {
            sceneReferenceSlot = references.length + 1;
            references.push({ slot: sceneReferenceSlot, label: `图${sceneReferenceSlot}`, role: "target-scene", mediaKey: sceneKey, characterId: scene.id });
        } else if (!manual) warnings.push(scene ? `场景缺少参考图：${scene.name}` : `未找到场景：${shot.sceneId}`);
    }

    const positioned = [...shot.persons].sort(compareByPosition);
    const mappedById = new Map(entries.map((entry) => [entry.person.id, entry]));
    const promptEntries: PromptEntry[] = [];
    const markers: PromptPackage["markers"] = [];
    if (!manual) {
        positioned.forEach((person, positionIndex) => {
            const entry = mappedById.get(person.id);
            const marker = getPersonReplacementPromptMarker(mode, positioning ? person.promptMarkerIndex : positionIndex, positioned.length, entry?.reference.slot);
            if (!marker) return;
            if (positioning) {
                marker.label = personLabel(person).replace("人物", "");
                marker.position = describePersonReplacementBoxPosition(person, positioned);
            }
            markers.push({ personId: person.id, label: marker.label, colorIndex: positioning ? person.promptMarkerIndex : positionIndex, mapped: Boolean(entry) });
        });
        for (const entry of entries) {
            const positionIndex = positioned.findIndex((person) => person.id === entry.person.id);
            const marker = getPersonReplacementPromptMarker(mode, positioning ? entry.person.promptMarkerIndex : positionIndex, positioned.length, entry.reference.slot)!;
            if (positioning) {
                marker.label = entry.sourceLabel.replace("人物", "");
                marker.position = describePersonReplacementBoxPosition(entry.person, positioned);
            }
            promptEntries.push({ marker, reference: entry.reference, scope: entry.person.scope });
        }
    }

    const prompt = manual ? shot.manualPrompt : promptEntries.length ? buildPersonReplacementPositioningPrompt(promptEntries, sceneReferenceSlot, mode, locationGuideSlot) : NO_BINDING_PROMPT(sceneReferenceSlot);
    const bindings: DescriptionBinding[] = entries.map(({ person, reference }) => ({
        personId: person.id,
        markerLabel: markers.find((marker) => marker.personId === person.id)?.label || "",
        bbox: person.bbox,
        referenceLabel: reference.label,
        replacementScope: person.scope,
    }));
    return { mode, prompt, references, bindings, locationGuideSlot, sceneReferenceSlot, markers, warnings };
}
