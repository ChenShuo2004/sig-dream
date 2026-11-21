import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const digest = (value) => createHash("sha256").update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
export const isLoopbackHost = (host) => ["127.0.0.1", "::1", "localhost"].includes(host);

/** Browser Basic login establishes a signed cookie, keeping provider Authorization headers separate. */
export function createAccessControl({
    host,
    username = process.env.SIG_DREAM_ACCESS_USER || "sig-dream",
    password = process.env.SIG_DREAM_ACCESS_PASSWORD,
    passwordFile = process.env.SIG_DREAM_ACCESS_PASSWORD_FILE,
    secureCookie = process.env.SIG_DREAM_SECURE_COOKIE === "1",
} = {}) {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username)) throw new Error("Invalid access username");
    if (passwordFile) password = readFileSync(passwordFile, "utf8").trim();
    if (!password && !isLoopbackHost(host)) throw new Error("Non-loopback listeners require SIG_DREAM_ACCESS_PASSWORD or SIG_DREAM_ACCESS_PASSWORD_FILE (20+ characters).");
    if (password && password.length < 20) throw new Error("Access password must contain at least 20 characters.");
    const secret = randomBytes(32);
    const cookieName = "sig_dream_access";
    const sign = (value) => createHmac("sha256", secret).update(value).digest("base64url");
    const failedLogins = new Map();
    return (req, res) => {
        if (!password || req.url === "/healthz") return true;
        res.setHeader("Cache-Control", "no-store");
        const cookie = String(req.headers.cookie || "")
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith(`${cookieName}=`))
            ?.slice(cookieName.length + 1);
        if (cookie) {
            const [expires, signature] = cookie.split(".");
            if (signature && Number(expires) > Date.now() && equal(signature, sign(expires))) return true;
        }
        const address = req.socket.remoteAddress || "unknown";
        const now = Date.now();
        for (const [key, entry] of failedLogins) if (entry.until < now) failedLogins.delete(key);
        const failures = failedLogins.get(address);
        if (failures?.count >= 10 && failures.until > now) {
            res.writeHead(429, { "Retry-After": "60" });
            res.end("Too many login attempts");
            return false;
        }
        const auth = String(req.headers.authorization || "");
        if (auth.startsWith("Basic ")) {
            const credentials = Buffer.from(auth.slice(6), "base64").toString("utf8");
            if (equal(credentials, `${username}:${password}`)) {
                failedLogins.delete(address);
                const expiry = String(now + 8 * 60 * 60 * 1000);
                res.setHeader("Set-Cookie", `${cookieName}=${expiry}.${sign(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie ? "; Secure" : ""}`);
                return true;
            }
        }
        if (failedLogins.size >= 4096 && !failedLogins.has(address)) {
            res.writeHead(429);
            res.end("Login capacity reached");
            return false;
        }
        failedLogins.set(address, { count: (failures?.count || 0) + 1, until: failures?.until || now + 60000 });
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="sig-dream", charset="UTF-8"' });
        res.end("Authentication required");
        return false;
    };
}
