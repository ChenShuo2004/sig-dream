import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createProxyMiddleware } from "./proxy.mjs";

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

function openBrowser(url) {
    try {
        if (process.platform === "darwin") {
            spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
        } else if (process.platform === "win32") {
            spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
        } else {
            spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
        }
    } catch {
        // Ignore browser launch failures on headless machines.
    }
}

function listenWithFallback(server, host, preferredPort, maxOffset) {
    return new Promise((resolveListen, rejectListen) => {
        let attempt = 0;

        const tryListen = (portToTry) => {
            const onError = (error) => {
                server.off("listening", onListening);
                if (error && error.code === "EADDRINUSE" && attempt < maxOffset) {
                    attempt += 1;
                    tryListen(preferredPort + attempt);
                    return;
                }
                rejectListen(error);
            };
            const onListening = () => {
                server.off("error", onError);
                const address = server.address();
                const boundPort = typeof address === "object" && address ? address.port : portToTry;
                resolveListen(boundPort);
            };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen(portToTry, host);
        };

        tryListen(preferredPort);
    });
}

export async function startServer(options = {}) {
    const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const distDir = resolve(options.distDir || join(rootDir, "dist"));
    const host = options.host || process.env.HOST || "0.0.0.0";
    const preferredPort = Number(options.port ?? process.env.PORT ?? 3000);
    const maxPortFallback = options.maxPortFallback ?? 20;
    const proxyMiddleware = createProxyMiddleware();

    const server = createServer(async (req, res) => {
        const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        if (urlObj.pathname === "/healthz") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        const handled = await proxyMiddleware(req, res);
        if (handled || res.writableEnded) return;

        let decodedPath = urlObj.pathname;
        try {
            decodedPath = decodeURIComponent(urlObj.pathname);
        } catch {
            decodedPath = urlObj.pathname;
        }
        const safeRel = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
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

    const port = await listenWithFallback(server, host, preferredPort, maxPortFallback);
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    const url = `http://${displayHost}:${port}`;

    return {
        server,
        host,
        port,
        url,
        close: () =>
            new Promise((resolveClose) => {
                server.close(() => resolveClose());
            }),
    };
}

const isDirectEntry = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectEntry) {
    const shouldOpen = process.argv.includes("--open") || process.env.OPEN_BROWSER === "1";
    startServer()
        .then(({ host, port, url }) => {
            console.log(`sig-dream is running at ${url} (bound to ${host}:${port})`);
            if (shouldOpen) {
                openBrowser(url);
            }
        })
        .catch((error) => {
            console.error("Failed to start sig-dream server:", error);
            process.exit(1);
        });
}
