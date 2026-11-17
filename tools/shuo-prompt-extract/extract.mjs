// Usage: node tools/shuo-prompt-extract/extract.mjs "<SHUO webapp dir>"
// Copies the webapp to a temp work dir, re-exports every top-level binding of the
// studio modules, imports them in Node and writes their string / data values to
// tools/shuo-prompt-extract/out/shuo-prompts.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const require = createRequire(path.join(repo, "canvas-app", "web", "package.json"));
const { parse } = require("@babel/parser");

const webapp = process.argv[2];
if (!webapp || !fs.existsSync(path.join(webapp, "package.json"))) {
    console.error("usage: node extract.mjs <SHUO webapp dir>");
    process.exit(1);
}

const TARGETS = [
    "api/storyGenerationApi.js",
    "api/storyAssetExperimentalApi.js",
    "api/storyAssetHybridExtractionApi.js",
    "api/storyReplicationAdaptationApi.js",
    "api/personReplacementPromptEnhancementApi.js",
    "api/story-generation",
    "src/domain/storyGeneration",
    "src/modules/storyWorkspace",
    "src/modules/personReplacement",
    "src/modules/promptPresets.js",
];
const CJK = /[\u4e00-\u9fff]/;
const work = path.join(os.tmpdir(), "shuo-prompt-work");

function walk(target, acc = []) {
    const stat = fs.statSync(target);
    if (stat.isFile()) {
        if (target.endsWith(".js")) acc.push(target);
        return acc;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) walk(path.join(target, entry.name), acc);
    return acc;
}

function copyTree(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dst, entry.name);
        if (entry.isDirectory()) copyTree(from, to);
        else if (/\.(js|json|mjs)$/.test(entry.name)) fs.copyFileSync(from, to);
    }
}

function topLevelNames(code) {
    const ast = parse(code, { sourceType: "module", errorRecovery: true, plugins: ["importAttributes"] });
    const declared = new Set();
    const exported = new Set();
    for (const node of ast.program.body) {
        const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
        if (node.type === "ExportNamedDeclaration") {
            for (const spec of node.specifiers || []) exported.add(spec.exported.name ?? spec.exported.value);
        }
        if (!decl) continue;
        if (decl.type === "VariableDeclaration") {
            for (const d of decl.declarations) if (d.id.type === "Identifier") (node === decl ? declared : exported).add(d.id.name);
        } else if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id) {
            (node === decl ? declared : exported).add(decl.id.name);
        }
    }
    return [...declared].filter((name) => !exported.has(name) && !/^_0x|^a\d+_0x/.test(name));
}

function hasPromptText(value, depth = 0) {
    if (depth > 8) return false;
    if (typeof value === "string") return CJK.test(value) && value.length >= 12;
    if (Array.isArray(value)) return value.some((item) => hasPromptText(item, depth + 1));
    if (value && typeof value === "object") return Object.values(value).some((item) => hasPromptText(item, depth + 1));
    return false;
}

function isSchema(name, value) {
    return value && typeof value === "object" && !Array.isArray(value) && /schema/i.test(name) && ("type" in value || "properties" in value || "schema" in value);
}

function plain(value, depth = 0) {
    if (depth > 12) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) return value;
    if (Array.isArray(value)) return value.map((item) => plain(item, depth + 1));
    if (value instanceof Set) return [...value].map((item) => plain(item, depth + 1));
    if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), plain(v, depth + 1)]));
    if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) if (typeof v !== "function") out[k] = plain(v, depth + 1);
        return out;
    }
    return undefined;
}

fs.rmSync(work, { recursive: true, force: true });
copyTree(webapp, work);

const files = TARGETS.flatMap((target) => walk(path.join(work, target)));
for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    const names = topLevelNames(code);
    if (names.length) fs.writeFileSync(file, `${code}\n;export { ${names.join(", ")} };\n`);
}

const result = {};
const failures = [];
for (const file of files) {
    const rel = path.relative(work, file).replace(/\\/g, "/");
    let mod;
    try {
        mod = await import(pathToFileURL(file).href);
    } catch (error) {
        failures.push(`${rel}: ${String(error?.message || error).slice(0, 160)}`);
        continue;
    }
    const entries = {};
    for (const [name, value] of Object.entries(mod)) {
        if (typeof value === "function") continue;
        const namedPrompt = /PROMPT|RULE|GUIDANCE|INSTRUCTION|TEMPLATE/.test(name) && typeof value === "string" && value.length >= 40;
        if (namedPrompt || hasPromptText(value) || isSchema(name, value)) entries[name] = plain(value);
    }
    if (Object.keys(entries).length) result[rel] = entries;
}

const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "shuo-prompts.json"), `${JSON.stringify(result, null, 2)}\n`);
const count = Object.values(result).reduce((sum, entries) => sum + Object.keys(entries).length, 0);
console.log(`modules ${Object.keys(result).length}, constants ${count}, import failures ${failures.length}`);
for (const line of failures) console.log(`  fail ${line}`);
