// Usage: node harvest-literals.mjs <decoded root>
// Collects pure string-literal arrays joined with "\n" (internal system prompts) from
// decoded SHUO sources into tools/shuo-prompt-extract/out/shuo-literal-prompts.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const root = process.argv[2];
const DIRS = ["api", "src/domain/storyGeneration", "src/modules/storyWorkspace", "src/modules/personReplacement"];
const STR = String.raw`"(?:[^"\\]|\\.)*"`;
const ARRAY_JOIN = new RegExp(String.raw`([\w$]+)\s*[=:]\s*\[\s*(${STR}(?:\s*,\s*${STR})*)\s*\]\s*\.\s*join\(\s*"\\n"\s*\)`, "g");
const KEYED = new RegExp(String.raw`"?(systemPrompt|instruction|instructions)"?\s*:\s*\[\s*(${STR}(?:\s*,\s*${STR})*)\s*\]\s*\.\s*join\(\s*"\\n"\s*\)`, "g");

function walk(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (entry.name.endsWith(".js")) acc.push(full);
    }
    return acc;
}

const result = {};
let total = 0;
for (const file of DIRS.flatMap((dir) => walk(path.join(root, dir)))) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const items = [];
    for (const regex of [ARRAY_JOIN, KEYED]) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(source))) {
            let parts;
            try {
                parts = JSON.parse(`[${match[2]}]`);
            } catch {
                continue;
            }
            const text = parts.join("\n");
            if (!/[\u4e00-\u9fff]/.test(text) || text.length < 60) continue;
            if (items.some((item) => item.text === text)) continue;
            items.push({ binding: match[1], text });
        }
    }
    if (items.length) {
        result[rel] = items;
        total += items.length;
    }
}

const outFile = path.join(here, "out", "shuo-literal-prompts.json");
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
console.log(`files ${Object.keys(result).length}, prompts ${total}`);
