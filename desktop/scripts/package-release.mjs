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
execFileSync(process.execPath, [require.resolve("electron-builder/out/cli/cli.js"), ...args, "--config", signed ? "electron-builder.signed.yml" : "electron-builder.yml", "--publish", "never"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: signed ? "true" : "false" }, stdio: "inherit",
});
