import { applyLocalRelayHeaders } from "@/services/api/local-relay-headers";
function platformToken() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        const parsed = raw ? (JSON.parse(raw) as { access_token?: string }) : null;
        return typeof parsed?.access_token === "string" ? parsed.access_token : "";
    } catch {
        return "";
    }
}

async function readPayload(response: Response) {
    const raw = await response.text();
    if (!raw.trim()) return {} as Record<string, unknown>;
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return {};
    }
}

export type ChannelBalance =
    | { kind: "points"; amount: string }
    | { kind: "money"; amount: string; currency: string };

const cache = new Map<string, { at: number; value: ChannelBalance | null }>();
const TTL_MS = 60_000;

export async function fetchChannelBalance(station: "runninghub" | "deepseek"): Promise<ChannelBalance | null> {
    const cached = cache.get(station);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
    
    const path = station === "runninghub" ? "/api-proxy/canvas-api/runninghub/account-status" : "/api-proxy/canvas-api/deepseek/balance";
    const headers = applyLocalRelayHeaders(new Headers(), station);
    if (station === "runninghub") headers.set("Content-Type", "application/json");
    const response = await fetch(path, {
        method: station === "runninghub" ? "POST" : "GET",
        headers,
        body: station === "runninghub" ? "{}" : undefined,
    });
    const payload = await readPayload(response);
    if (!response.ok) {
        cache.set(station, { at: Date.now(), value: null });
        return null;
    }
    const value = station === "runninghub" ? pointsBalance(payload) : moneyBalance(payload);
    cache.set(station, { at: Date.now(), value });
    return value;
}

function pointsBalance(payload: Record<string, unknown>): ChannelBalance | null {
    const amount = String(payload.remainCoins ?? "").trim();
    if (!amount || !Number.isFinite(Number(amount))) return null;
    return { kind: "points", amount };
}

function moneyBalance(payload: Record<string, unknown>): ChannelBalance | null {
    const amount = String(payload.totalBalance ?? "").trim();
    const currency = String(payload.currency ?? "").trim();
    if (!amount || !Number.isFinite(Number(amount))) return null;
    return { kind: "money", amount, currency: currency || "CNY" };
}
