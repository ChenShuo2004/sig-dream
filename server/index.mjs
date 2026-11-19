import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProxyMiddleware } from "./proxy.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(rootDir, "dist");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const proxyMiddleware = createProxyMiddleware();

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
};

function serveFile(filePath, res) {
    const ext = extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    if (filePath.includes("/assets/") || filePath.includes("\\assets\\")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
    const handled = await proxyMiddleware(req, res);
    if (handled || res.writableEnded) return;

    const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const safeRel = normalize(decodeURIComponent(urlObj.pathname)).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    const candidate = join(distDir, safeRel);

    if (safeRel && candidate.startsWith(distDir) && existsSync(candidate) && statSync(candidate).isFile()) {
        return serveFile(candidate, res);
    }

    const indexHtml = join(distDir, "index.html");
    if (existsSync(indexHtml)) {
        return serveFile(indexHtml, res);
    }

    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("dist/index.html not found. Run `npm run build` first.");
});

server.listen(port, host, () => {
    console.log(`sig-dream listening on http://${host}:${port}`);
});
