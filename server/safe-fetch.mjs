import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const blocked = new BlockList();
for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
])
    blocked.addSubnet(network, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
export function isPublicAddress(address) {
    const family = isIP(address);
    return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
export async function resolvePublicTarget(value, resolver = lookup) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only public HTTP(S) targets without credentials are allowed");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolver(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Private, loopback, reserved and mixed DNS targets are blocked");
    return { url, address: addresses[0] };
}

export async function readLimited(stream, maxBytes) {
    const size = Number(stream.headers?.["content-length"]);
    if (size > maxBytes) throw Object.assign(new Error("Body exceeds size limit"), { status: 413 });
    let bytes = 0;
    const chunks = [];
    for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw Object.assign(new Error("Body exceeds size limit"), { status: 413 });
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

/** Pin the approved DNS result to the socket and revalidate every redirect. No ambient proxy or DNS rebinding. */
export async function safeFetch(value, { method = "GET", headers = {}, body, maxBytes = 128 * 1024 * 1024, timeoutMs = 120000, resolver = lookup, requestFactory } = {}) {
    let target = String(value);
    let currentHeaders = Object.fromEntries(new Headers(headers));
    const deadline = Date.now() + timeoutMs;
    for (let redirects = 0; redirects <= 5; redirects++) {
        const { url, address } = await resolvePublicTarget(target, resolver);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("Upstream timeout");
        const response = await new Promise((resolve, reject) => {
            const request = (requestFactory || (url.protocol === "https:" ? https.request : http.request))(
                url,
                {
                    method,
                    headers: { ...currentHeaders, "accept-encoding": "identity" },
                    agent: false,
                    lookup: (_host, options, callback) => (options?.all ? callback(null, [address]) : callback(null, address.address, address.family)),
                },
                resolve,
            );
            const timer = setTimeout(() => request.destroy(new Error("Upstream timeout")), remaining);
            request.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
            request.on("response", (res) => {
                res.once("close", () => clearTimeout(timer));
            });
            request.end(body);
        });
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
            response.destroy();
            if (redirects === 5) throw new Error("Too many redirects");
            const next = new URL(response.headers.location, url);
            if (url.protocol === "https:" && next.protocol !== "https:") throw new Error("HTTPS downgrade blocked");
            if (next.origin !== url.origin) {
                delete currentHeaders.authorization;
                delete currentHeaders.cookie;
            }
            if (response.statusCode === 303 || ([301, 302].includes(response.statusCode) && method === "POST")) {
                method = "GET";
                body = undefined;
                delete currentHeaders["content-type"];
            }
            target = next.href;
            continue;
        }
        const encoding = response.headers["content-encoding"];
        const decoder = encoding === "gzip" ? createGunzip() : encoding === "br" ? createBrotliDecompress() : encoding === "deflate" ? createInflate() : null;
        if (decoder) response.once("error", (error) => decoder.destroy(error));
        try {
            const buffer = await readLimited(decoder ? response.pipe(decoder) : response, maxBytes);
            return {
                status: response.statusCode,
                ok: response.statusCode >= 200 && response.statusCode < 300,
                headers: new Headers(
                    Object.entries(response.headers)
                        .filter(([, v]) => v !== undefined)
                        .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]),
                ),
                buffer,
            };
        } finally {
            response.destroy();
            decoder?.destroy();
        }
    }
    throw new Error("Redirect limit exceeded");
}
