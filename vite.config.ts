import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { agentRuntimeInfo } from "./server/agent-runtime.mjs";
import { createProxyMiddleware } from "./server/proxy.mjs";
import { parseChangelog } from "./src/lib/release";

const rootDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(rootDir, "VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(rootDir, "CHANGELOG.md"), "utf8");

function localPluginsManifest(): Plugin {
    const pluginsDir = resolve(rootDir, "public/plugins");
    const listLocalPlugins = () => {
        try {
            return readdirSync(pluginsDir)
                .filter((file) => file.endsWith(".js"))
                .sort()
                .map((file) => `/plugins/${file}`);
        } catch {
            return [];
        }
    };
    return {
        name: "local-plugins-manifest",
        configureServer(server) {
            server.middlewares.use("/runtime-info", (req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(agentRuntimeInfo(rootDir, ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || ""))));
            });
            server.middlewares.use("/plugins/index.json", (_req, res) => {
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(listLocalPlugins()));
            });
            server.middlewares.use(createProxyMiddleware());
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "plugins/index.json", source: JSON.stringify(listLocalPlugins()) });
        },
    };
}

export default defineConfig({
    base: "/",
    build: {
        outDir: resolve(rootDir, "dist"),
        emptyOutDir: true,
    },
    plugins: [react(), localPluginsManifest()],
    resolve: {
        alias: {
            "@": resolve(rootDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
    },
});
