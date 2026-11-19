import { findRelayChannel, type RelayStationId } from "@/lib/relay-stations";
import { useConfigStore } from "@/stores/use-config-store";

/**
 * Build headers for the built-in local CORS proxy (/api-proxy/canvas-api/<station>/...).
 * Reads the user's own API key & base URL from local browser config — no platform login required.
 */
export function applyLocalRelayHeaders(headers: Headers, station: RelayStationId) {
    const channel = findRelayChannel(useConfigStore.getState().config.channels, station);
    const apiKey = (channel?.apiKey || "").trim();
    const baseUrl = (channel?.baseUrl || "").trim();
    if (apiKey) headers.set("X-Relay-Api-Key", apiKey);
    if (baseUrl) headers.set("X-Relay-Base-Url", baseUrl);
    return headers;
}
