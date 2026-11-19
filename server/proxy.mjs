import { randomUUID } from "node:crypto";

const RELAY_UPSTREAMS = {
    volcano: {
        base: "https://ark.cn-beijing.volces.com/api/v3",
        rewrite(subPath) {
            if (subPath === "/video_generation") return "/contents/generations/tasks";
            if (subPath.startsWith("/query/video_generation/")) {
                return `/contents/generations/tasks/${subPath.slice("/query/video_generation/".length)}`;
            }
            return subPath;
        },
    },
    runninghub: {
        base: "https://www.runninghub.cn",
        rewrite(subPath) {
            if (subPath === "/account-status") return "/uc/openapi/accountStatus";
            if (subPath === "/upload") return "/task/openapi/upload";
            if (subPath === "/workflow/run") return "/openapi/v2/run/workflow";
            if (subPath === "/ai-app/run") return "/openapi/v2/run/ai-app";
            if (subPath === "/query") return "/openapi/v2/query";
            if (subPath === "/cancel") return "/task/openapi/cancel";
            return subPath;
        },
    },
    deepseek: {
        base: "https://api.deepseek.com",
        rewrite(subPath) {
            if (subPath === "/balance") return "/user/balance";
            return subPath;
        },
    },
    metaso: {
        base: "https://metaso.cn/api/minimax",
        rewrite(subPath) {
            return subPath;
        },
    },
    onion: {
        base: "https://ai.onioncreate.xyz",
        rewrite(subPath) {
            return `/v1${subPath}`;
        },
    },
    geeknow: {
        base: "https://www.geeknow.top",
        rewrite(subPath) {
            return `/v1${subPath}`;
        },
    },
    ai007: {
        base: "https://api.ai007.my",
        rewrite(subPath) {
            return subPath;
        },
    },
    crun: {
        base: "https://api.crun.ai/api/v1",
        rewrite(subPath) {
            return subPath;
        },
    },
};

// Ephemeral in-memory media cache for proxy-fetched generated media (auto-evicted).
const mediaCache = new Map();
const MAX_CACHE_ITEMS = 64;

function putCache(buffer, contentType) {
    const id = `${randomUUID()}.${contentType.includes("mp4") ? "mp4" : contentType.includes("webp") ? "webp" : contentType.includes("jpeg") ? "jpg" : "png"}`;
    if (mediaCache.size >= MAX_CACHE_ITEMS) {
        const oldest = mediaCache.keys().next().value;
        if (oldest) mediaCache.delete(oldest);
    }
    mediaCache.set(id, { buffer, contentType });
    return id;
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
    return true;
}

/**
 * Lightweight local CORS proxy middleware for Vite dev server and production Node server.
 * Zero database, zero auth: forwards the user's own API key from X-Relay-Api-Key / Authorization.
 */
export function createProxyMiddleware() {
    return async function proxyMiddleware(req, res, next) {
        const rawUrl = req.url || "/";
        if (!rawUrl.startsWith("/api-proxy/canvas-api/")) {
            if (typeof next === "function") return next();
            return false;
        }

        const urlObj = new URL(rawUrl, "http://127.0.0.1");
        const relPath = urlObj.pathname.slice("/api-proxy/canvas-api".length);

        try {
            // Serve ephemeral cached media (used by generated-media / media-fetch helpers)
            if (req.method === "GET" && relPath.startsWith("/generated-media/")) {
                const name = decodeURIComponent(relPath.slice("/generated-media/".length));
                const entry = mediaCache.get(name);
                if (!entry) return sendJson(res, 404, { detail: "Cached media not found" });
                res.statusCode = 200;
                res.setHeader("Content-Type", entry.contentType);
                res.setHeader("Cache-Control", "public, max-age=3600");
                res.end(entry.buffer);
                return true;
            }

            if (req.method === "POST" && relPath === "/generated-media") {
                const raw = await readBody(req);
                const body = JSON.parse(raw.toString("utf8") || "{}");
                const targetUrl = String(body.url || "").trim();
                if (!/^https?:\/\//i.test(targetUrl)) {
                    return sendJson(res, 400, { detail: "Invalid media URL" });
                }
                const upstream = await fetch(targetUrl);
                if (!upstream.ok) {
                    return sendJson(res, upstream.status, { detail: `Upstream media fetch failed (${upstream.status})` });
                }
                const arrayBuf = await upstream.arrayBuffer();
                const contentType = upstream.headers.get("content-type") || "application/octet-stream";
                const name = putCache(Buffer.from(arrayBuf), contentType);
                return sendJson(res, 200, { path: `/canvas-api/generated-media/${name}`, contentType });
            }

            // Route /api-proxy/canvas-api/<station>/<rest>
            const match = relPath.match(/^\/([a-z0-9-]+)(\/.*)?$/i);
            const station = match?.[1]?.toLowerCase() || "";
            const subPath = match?.[2] || "/";
            const config = RELAY_UPSTREAMS[station];
            if (!config) {
                return sendJson(res, 404, { detail: `Unknown proxy route: ${relPath}` });
            }

            const relayKey = String(req.headers["x-relay-api-key"] || "").trim();
            const relayBase = String(req.headers["x-relay-base-url"] || "").trim().replace(/\/+$/, "");
            const upstreamBase = /^https?:\/\//i.test(relayBase) ? relayBase : config.base;
            const rewritten = config.rewrite(subPath);
            const target = `${upstreamBase}${rewritten}${urlObj.search}`;

            const forwardHeaders = new Headers();
            const contentType = req.headers["content-type"];
            if (contentType) forwardHeaders.set("content-type", String(contentType));
            const accept = req.headers["accept"];
            if (accept) forwardHeaders.set("accept", String(accept));

            if (relayKey) {
                forwardHeaders.set("authorization", relayKey.startsWith("Bearer ") ? relayKey : `Bearer ${relayKey}`);
            } else if (req.headers["authorization"]) {
                forwardHeaders.set("authorization", String(req.headers["authorization"]));
            }

            const hasBody = !["GET", "HEAD"].includes((req.method || "GET").toUpperCase());
            const bodyBuf = hasBody ? await readBody(req) : undefined;

            const upstream = await fetch(target, {
                method: req.method || "GET",
                headers: forwardHeaders,
                body: bodyBuf && bodyBuf.length > 0 ? bodyBuf : undefined,
            });

            res.statusCode = upstream.status;
            const respType = upstream.headers.get("content-type");
            if (respType) res.setHeader("Content-Type", respType);
            const respBuf = Buffer.from(await upstream.arrayBuffer());
            res.end(respBuf);
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, 502, { detail: `Local proxy error: ${msg}` });
            return true;
        }
    };
}
