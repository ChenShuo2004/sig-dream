import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire(new URL("../packages/canvas-agent/package.json", import.meta.url));
const { parseDocument } = req("yaml");
const read = (p) => JSON.parse(readFileSync(p,"utf8"));
const version = read("package.json").version;
assert.equal(read("desktop/package.json").version,version);
assert.equal(read("packages/canvas-agent/package.json").version,version);
assert.equal(read("package-lock.json").packages["packages/canvas-agent"].version,version);
assert.equal(read("package-lock.json").version,version);
assert.equal(read("desktop/package-lock.json").version,version);
assert.equal(readFileSync("VERSION","utf8").trim(),`v${version}`);
assert.ok(readFileSync("src/lib/agent/agent-clients.ts","utf8").includes(`/v${version}/sig-dream-canvas-agent-${version}.tgz`));
for(const path of [".github/workflows/release.yml","desktop/electron-builder.yml","desktop/electron-builder.signed.yml","docker-compose.yml"]) {
 const doc = parseDocument(readFileSync(path,"utf8"));assert.deepEqual(doc.errors,[],path);
}
console.log(`PASS: v${version} manifests, lockfiles, runtime distribution URL and release YAML agree`);
