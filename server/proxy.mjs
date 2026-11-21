import { randomUUID } from "node:crypto";
import { safeFetch, readLimited } from "./safe-fetch.mjs";

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
const MAX_CACHE_BYTES = 256 * 1024 * 1024;

function putCache(buffer, contentType) {
    const id = `${randomUUID()}.${contentType.includes("mp4") ? "mp4" : contentType.includes("webp") ? "webp" : contentType.includes("jpeg") ? "jpg" : "png"}`;
    while (mediaCache.size >= MAX_CACHE_ITEMS || [...mediaCache.values()].reduce((size, item) => size + item.buffer.length, 0) + buffer.length > MAX_CACHE_BYTES) {
        const oldest = mediaCache.keys().next().value;
        if (oldest) mediaCache.delete(oldest);
        else break;
    }
    mediaCache.set(id, { buffer, contentType });
    return id;
}

async function readBody(req) {
    return readLimited(req, 64 * 1024 * 1024);
}

function sendJson(res, status, payload) {
    if (status === 413) res.setHeader("Connection", "close");
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
    return true;
}

/**
 * Lightweight local CORS proxy middleware for Vite dev server and production Node server.
 * Access-controlled by the host server; forwards the user's own API key from X-Relay-Api-Key / Authorization.
 */
export function createProxyMiddleware() {
    const requests = new Map();
    let inFlight = 0;
    return async function proxyMiddleware(req, res, next) {
        const rawUrl = req.url || "/";
        if (!rawUrl.startsWith("/api-proxy/canvas-api/")) {
            if (typeof next === "function") return next();
            return false;
        }

        if (req.headers["sec-fetch-site"] === "cross-site") return sendJson(res, 403, { detail: "Cross-site proxy request blocked" });
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return sendJson(res, 403, { detail: "Cross-origin proxy requests are blocked" });
        const now = Date.now();
        for (const [key, value] of requests) if (value.until < now) requests.delete(key);
        const key = req.socket.remoteAddress || "unknown";
        const bucket = requests.get(key) || { count: 0, until: now + 60000 };
        if (bucket.count >= 120 || (requests.size >= 4096 && !requests.has(key))) return sendJson(res, 429, { detail: "Proxy rate limit exceeded" });
        bucket.count++;
        requests.set(key, bucket);
        const urlObj = new URL(rawUrl, "http://127.0.0.1");
        const relPath = urlObj.pathname.slice("/api-proxy/canvas-api".length);

        if (inFlight >= 4) return sendJson(res, 429, { detail: "Proxy is busy, retry shortly" });
        inFlight++;
        try {
            // Serve ephemeral cached media (used by generated-media / media-fetch helpers)
            if (req.method === "GET" && relPath.startsWith("/generated-media/")) {
                const name = decodeURIComponent(relPath.slice("/generated-media/".length));
                const entry = mediaCache.get(name);
                if (!entry) return sendJson(res, 404, { detail: "Cached media not found" });
                res.statusCode = 200;
                res.setHeader("Content-Type", entry.contentType);
                res.setHeader("Cache-Control", "private, max-age=3600");
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
                const upstream = await safeFetch(targetUrl);
                if (!upstream.ok) {
                    return sendJson(res, upstream.status, { detail: `Upstream media fetch failed (${upstream.status})` });
                }
                const arrayBuf = upstream.buffer;
                const contentType = upstream.headers.get("content-type") || "application/octet-stream";
                if (!/^(image\/(png|jpe?g|webp|gif|avif)|video\/|audio\/)/i.test(contentType)) return sendJson(res, 415, { detail: "Unsupported media content type" });
                const name = putCache(arrayBuf, contentType);
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
            const relayBase = String(req.headers["x-relay-base-url"] || "")
                .trim()
                .replace(/\/+$/, "");
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
            } else if (String(req.headers["authorization"] || "").startsWith("Bearer ")) {
                forwardHeaders.set("authorization", String(req.headers["authorization"]));
            }

            const hasBody = !["GET", "HEAD"].includes((req.method || "GET").toUpperCase());
            const bodyBuf = hasBody ? await readBody(req) : undefined;

            const upstream = await safeFetch(target, {
                method: req.method || "GET",
                headers: forwardHeaders,
                body: bodyBuf && bodyBuf.length > 0 ? bodyBuf : undefined,
            });

            res.statusCode = upstream.status;
            const respType = upstream.headers.get("content-type");
            if (respType) res.setHeader("Content-Type", respType);
            const respBuf = upstream.buffer;
            res.end(respBuf);
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendJson(res, err?.status || (err instanceof SyntaxError ? 400 : 502), { detail: `Local proxy error: ${msg}` });
            return true;
        } finally {
            inFlight--;
        }
    };
}
