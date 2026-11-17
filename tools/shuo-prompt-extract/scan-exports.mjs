import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const DIRS = process.argv.slice(3);
const CJK = /[\u4e00-\u9fff]/;

function walk(dir, acc = []) {
    if (fs.statSync(dir).isFile()) return [dir];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (full.endsWith(".js")) acc.push(full);
    }
    return acc;
}

function hasPromptText(value, depth = 0) {
    if (depth > 6) return false;
    if (typeof value === "string") return CJK.test(value) && value.length >= 20;
    if (Array.isArray(value)) return value.some((item) => hasPromptText(item, depth + 1));
    if (value && typeof value === "object") return Object.values(value).some((item) => hasPromptText(item, depth + 1));
    return false;
}

const report = [];
for (const dir of DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).replace(/\\/g, "/");
        try {
            const mod = await import(pathToFileURL(file).href);
            const names = Object.entries(mod)
                .filter(([, value]) => typeof value !== "function" && hasPromptText(value))
                .map(([name, value]) => `${name}:${typeof value === "string" ? value.length : Array.isArray(value) ? "arr" : "obj"}`);
            if (names.length) report.push(`${rel}\t${names.join(", ")}`);
        } catch (error) {
            report.push(`${rel}\tIMPORT_FAIL ${String(error?.message || error).slice(0, 120)}`);
        }
    }
}
console.log(report.join("\n"));
