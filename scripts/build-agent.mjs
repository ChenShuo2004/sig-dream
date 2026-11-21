import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync("release", { recursive: true });
const output = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "./packages/canvas-agent", "--pack-destination", "release", "--json"], { encoding: "utf8" });
const [{ filename }] = JSON.parse(output);
copyFileSync(resolve("release", filename), resolve("release/canvas-agent.tgz"));
console.log(`Maintained Canvas Agent archive: release/${filename}`);
