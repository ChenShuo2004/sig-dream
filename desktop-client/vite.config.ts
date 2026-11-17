import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

type LocalJson = { webOrigin?: unknown; apiBaseUrl?: unknown; cacheRoot?: unknown };

function toApiProxyBase(origin: string): string {
  const o = origin.trim().replace(/\/+$/, "");
  return o ? `${o}/api-proxy` : "";
}

function readLocalSettingsFile(): { webOrigin: string; api: string; cache: string } {
  const primary = path.resolve(__dirname, "local.settings.json");
  const example = path.resolve(__dirname, "local.settings.example.json");
  const pick = fs.existsSync(primary) ? primary : fs.existsSync(example) ? example : null;
  if (!pick) return { webOrigin: "", api: "", cache: "" };
  try {
    const o = JSON.parse(fs.readFileSync(pick, "utf8")) as LocalJson;
    return {
      webOrigin: typeof o.webOrigin === "string" ? o.webOrigin.trim() : "",
      api: typeof o.apiBaseUrl === "string" ? o.apiBaseUrl.trim() : "",
      cache: typeof o.cacheRoot === "string" ? o.cacheRoot.trim() : "",
    };
  } catch {
    return { webOrigin: "", api: "", cache: "" };
  }
}

function effectiveApiBase(fromFile: { webOrigin: string; api: string }): string {
  const envWeb = String(process.env.LCP_WEB_ORIGIN || "").trim();
  const envApi = String(process.env.LCP_API_BASE_URL || "").trim();
  const rootWeb = envWeb || fromFile.webOrigin;
  if (rootWeb) return toApiProxyBase(rootWeb);
  return envApi || fromFile.api || "";
}

const fromFile = readLocalSettingsFile();
const injectApi = effectiveApiBase(fromFile);
const injectCache = String(process.env.LCP_CACHE_ROOT || fromFile.cache || "").trim();

export default defineConfig({
  define: {
    "import.meta.env.VITE_LCP_API_BASE_URL": JSON.stringify(injectApi),
    "import.meta.env.VITE_LCP_CACHE_ROOT": JSON.stringify(injectCache),
  },
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
