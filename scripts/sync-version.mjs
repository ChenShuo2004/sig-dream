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

console.log(`Synced version to v${targetVersion}:`);
console.log(`- package.json -> ${targetVersion}`);
console.log(`- desktop/package.json -> ${targetVersion}`);
console.log(`- VERSION -> v${targetVersion}`);
