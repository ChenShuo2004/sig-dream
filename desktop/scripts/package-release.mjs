import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../package.json", import.meta.url));
const args = process.argv.slice(2);
const signed = process.env.SIG_DREAM_REQUIRE_SIGNING === "1";
const mac = args.includes("--mac");
const windows = args.includes("--win");
if (signed && (mac || windows) && !process.env.CSC_LINK && !process.env.CSC_NAME) throw new Error("Signed release requires CSC_LINK or CSC_NAME; no unsigned fallback is permitted.");
if (signed && mac && !(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER) && !(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)) throw new Error("Signed macOS release requires Apple notarization credentials.");
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: signed ? "true" : "false" };
for (const key of ["CSC_LINK", "CSC_NAME", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) if (!env[key]?.trim()) delete env[key];
const builderCli = require.resolve("electron-builder/out/cli/cli.js");
const cwd = fileURLToPath(new URL("..", import.meta.url));
const config = signed ? "electron-builder.signed.yml" : "electron-builder.yml";
// Build distributable installers first, then make a retained unpacked app for launch QA.
execFileSync(process.execPath, [builderCli, ...args, "--config", config, "--publish", "never"], { cwd, env, stdio: "inherit" });
execFileSync(process.execPath, [builderCli, ...args, "--dir", "--config", config, "--publish", "never"], { cwd, env, stdio: "inherit" });
