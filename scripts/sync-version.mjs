import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rawArg = (process.argv[2] || "").trim();

const rootPkgPath = join(rootDir, "package.json");
const desktopPkgPath = join(rootDir, "desktop", "package.json");
const versionFilePath = join(rootDir, "VERSION");

const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, "utf8"));

const targetVersion = (rawArg || rootPkg.version).replace(/^v/i, "");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
    console.error(`Invalid semver version: "${rawArg}". Usage: npm run version:sync -- 0.3.2`);
    process.exit(1);
}

rootPkg.version = targetVersion;
desktopPkg.version = targetVersion;

writeFileSync(rootPkgPath, `${JSON.stringify(rootPkg, null, 4)}\n`, "utf8");
writeFileSync(desktopPkgPath, `${JSON.stringify(desktopPkg, null, 2)}\n`, "utf8");
writeFileSync(versionFilePath, `v${targetVersion}\n`, "utf8");
const agentPackagePath = join(rootDir, "packages/canvas-agent/package.json");
const agentPackage = JSON.parse(readFileSync(agentPackagePath, "utf8"));
agentPackage.version = targetVersion;
writeFileSync(agentPackagePath, `${JSON.stringify(agentPackage, null, 2)}\n`);
const clientsPath = join(rootDir, "src/lib/agent/agent-clients.ts");
writeFileSync(clientsPath, readFileSync(clientsPath, "utf8").replace(/releases\/download\/v[\d.]+\/sig-dream-canvas-agent-[\d.]+\.tgz/, `releases/download/v${targetVersion}/sig-dream-canvas-agent-${targetVersion}.tgz`));

// Keep npm ci reproducible after the next release bump.
for (const lockPath of [join(rootDir, "package-lock.json"), join(rootDir, "desktop/package-lock.json")]) {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.version = targetVersion;
    if (lock.packages?.[""]) lock.packages[""].version = targetVersion;
    if (lock.packages?.["packages/canvas-agent"]) lock.packages["packages/canvas-agent"].version = targetVersion;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

console.log(`Synced version to v${targetVersion}:`);
console.log(`- package.json -> ${targetVersion}`);
console.log(`- desktop/package.json -> ${targetVersion}`);
console.log(`- VERSION -> v${targetVersion}`);
