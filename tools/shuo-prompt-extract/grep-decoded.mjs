// Usage: node grep-decoded.mjs <decoded file> <needle> [before] [after] > writes %TEMP%/shuo-grep.txt
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [file, needle, before = "900", after = "300"] = process.argv.slice(2);
const source = fs.readFileSync(file, "utf8");
const chunks = [];
let index = -1;
while ((index = source.indexOf(needle, index + 1)) >= 0 && chunks.length < 6) {
    chunks.push(source.slice(Math.max(0, index - Number(before)), index + Number(after)));
}
fs.writeFileSync(path.join(os.tmpdir(), "shuo-grep.txt"), chunks.join("\n\n=====\n\n"));
console.log(`matches ${chunks.length}`);
