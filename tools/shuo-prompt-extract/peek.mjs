// node peek.mjs <sampleKey> [maxLen] — print payload keys and short values of a captured sample.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = JSON.parse(fs.readFileSync(path.join(here, "out", "shuo-prompt-samples.json"), "utf8"));
const [key, maxLenArg] = process.argv.slice(2);
const maxLen = Number(maxLenArg) || 400;
const skip = new Set(["instructions", "requirements", "criteria", "outputSchema", "rules"]);

if (!key) {
    console.log(Object.keys(samples).join("\n"));
    process.exit(0);
}

function show(label, value) {
    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            console.log(`${label} (text ${value.length}):`, value.slice(0, maxLen));
            return;
        }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        console.log(`${label} keys:`, Object.keys(parsed).join(", "));
        for (const [k, v] of Object.entries(parsed)) {
            if (skip.has(k)) continue;
            console.log(`  ${k}:`, JSON.stringify(v).slice(0, maxLen));
        }
    } else console.log(label, JSON.stringify(parsed).slice(0, maxLen));
}

const entry = samples[key];
const value = entry?.value ?? entry;
const items = Array.isArray(value) ? value : [value];
items.forEach((item, index) => {
    console.log(`=== ${key}[${index}]`);
    if (item && typeof item === "object" && ("prompt" in item || "systemPrompt" in item)) {
        for (const [k, v] of Object.entries(item)) if (!["prompt", "systemPrompt"].includes(k)) console.log(`  .${k}:`, JSON.stringify(v).slice(0, 200));
        show("prompt", item.prompt);
    } else show("value", item);
});
