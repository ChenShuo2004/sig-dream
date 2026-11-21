import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { startServer } from "../server/index.mjs";
import { isPublicAddress, resolvePublicTarget, safeFetch, readLimited } from "../server/safe-fetch.mjs";

test("outbound resolver rejects private, mapped, encoded and mixed DNS targets", async () => {
    for (const address of ["127.0.0.1", "10.2.3.4", "169.254.169.254", "100.64.0.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::1"]) assert.equal(isPublicAddress(address), false, address);
    assert.equal(isPublicAddress("1.1.1.1"), true);
    assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
    for (const value of ["http://2130706433/", "http://0x7f000001/", "http://[::1]/", "http://user:pass@example.com/", "file:///etc/passwd"]) await assert.rejects(resolvePublicTarget(value));
    await assert.rejects(
        resolvePublicTarget("https://mixed.test", async () => [
            { address: "1.1.1.1", family: 4 },
            { address: "127.0.0.1", family: 4 },
        ]),
    );
});

test("safe fetch pins DNS, drops credentials on redirect and blocks private redirects", async () => {
    const requests = [];
    const factory = (url, options, callback) => {
        const req = new EventEmitter();
        req.destroy = () => req.emit("error", new Error("destroyed"));
        req.end = () =>
            queueMicrotask(() => {
                options.lookup(url.hostname, {}, (_err, address) => assert.equal(address, "1.1.1.1"));
                requests.push({ url: String(url), headers: options.headers });
                const res = Readable.from([Buffer.from("ok")]);
                res.statusCode = requests.length === 1 ? 302 : 200;
                res.headers = requests.length === 1 ? { location: "https://other.test/final" } : { "content-type": "text/plain" };
                req.emit("response", res);
                callback(res);
            });
        return req;
    };
    const resolver = async () => [{ address: "1.1.1.1", family: 4 }];
    const result = await safeFetch("https://public.test", { resolver, requestFactory: factory, headers: { authorization: "Bearer test-key" } });
    assert.equal(result.buffer.toString(), "ok");
    assert.equal(requests[0].headers.authorization, "Bearer test-key");
    assert.equal(requests[1].headers.authorization, undefined);
    const redirectToPrivate = (_url, _options, callback) => {
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = () =>
            queueMicrotask(() => {
                const res = Readable.from([]);
                res.statusCode = 302;
                res.headers = { location: "http://127.0.0.1/admin" };
                req.emit("response", res);
                callback(res);
            });
        return req;
    };
    await assert.rejects(safeFetch("https://public.test", { resolver, requestFactory: redirectToPrivate }), /downgrade|blocked/i);
});

test("streaming body limits work without Content-Length", async () => {
    await assert.rejects(readLimited(Readable.from([Buffer.alloc(16), Buffer.alloc(16)]), 24), /size limit/);
});

test("public listener fails closed; login creates a cookie usable with provider Authorization", async () => {
    await assert.rejects(startServer({ host: "0.0.0.0", port: 0 }), /password/i);
    const password = "test-only-random-password-123456789";
    const distDir = await mkdtemp(join(tmpdir(), "sig-access-test-"));
    await writeFile(join(distDir, "index.html"), "test page");
    const server = await startServer({ host: "0.0.0.0", port: 0, distDir, access: { username: "qa", password } });
    try {
        assert.equal((await fetch(server.url)).status, 401);
        assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
        const auth = await fetch(server.url, { headers: { authorization: `Basic ${Buffer.from(`qa:${password}`).toString("base64")}` } });
        assert.equal(auth.status, 200);
        const cookie = auth.headers.get("set-cookie")!.split(";")[0];
        assert.match(auth.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
        assert.equal((await fetch(server.url, { headers: { cookie, authorization: "Bearer model-key" } })).status, 200);
        assert.equal((await fetch(server.url, { headers: { cookie: cookie + "forged" } })).status, 401);
    } finally {
        await server.close();
        await rm(distDir, { recursive: true, force: true });
    }
});

test("proxy blocks cross-site calls, private upstreams and malformed payloads", async () => {
    const server = await startServer({ host: "127.0.0.1", port: 0 });
    const path = `${server.url}/api-proxy/canvas-api/generated-media`;
    try {
        assert.equal((await fetch(path, { method: "POST", headers: { origin: "https://evil.test" }, body: "{}" })).status, 403);
        const denied = await fetch(path, { method: "POST", body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data" }) });
        assert.equal(denied.status, 502);
        assert.match(await denied.text(), /blocked/i);
        assert.equal((await fetch(path, { method: "POST", body: "{" })).status, 400);
    } finally {
        await server.close();
    }
});
