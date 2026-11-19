type ArchivedItem = { id?: string; primary_file_id?: string | null; file_size?: number | null };

type DownloadRoute = {
    ticket?: string;
    lan_download_base_urls?: string[];
    public_download_base_url?: string | null;
};

function platformSession() {
    try {
        const raw = localStorage.getItem("lcp_auth_session");
        if (!raw) return "";
        const parsed = JSON.parse(raw) as { access_token?: unknown };
        return typeof parsed.access_token === "string" ? parsed.access_token : "";
    } catch {
        return "";
    }
}

let catalogRequest: Promise<ArchivedItem[]> | null = null;

function archivedItems() {
    if (!catalogRequest) {
        catalogRequest = (async () => {
            const token = platformSession();
            if (!token) return [];
            const libraries = ["auto", "personal_video"];
            const items: ArchivedItem[] = [];
            for (const library of libraries) {
                const response = await fetch("/api-proxy/materials/unorganized?page=1&page_size=100", {
                    headers: { Authorization: `Bearer ${token}`, "X-Asset-Library": library },
                    cache: "no-store",
                });
                if (!response.ok) continue;
                const data = (await response.json()) as { items?: ArchivedItem[] };
                items.push(...(data.items || []));
            }
            return items;
        })().catch(() => []);
    }
    return catalogRequest;
}

/** Local IndexedDB lost the file. The same bytes may already be in the current library's unorganized list. */
export async function recoverArchivedMediaUrl(bytes?: number) {
    if (!bytes || bytes < 32) return "";
    const token = platformSession();
    const item = (await archivedItems()).find((entry) => entry.file_size === bytes && entry.id && entry.primary_file_id);
    if (!token || !item?.id || !item.primary_file_id) return "";
    const response = await fetch(`/api-proxy/materials/${item.id}/files/${item.primary_file_id}/download-route`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Asset-Library": "auto" },
    });
    if (!response.ok) return "";
    const route = (await response.json()) as DownloadRoute;
    if (!route.ticket) return "";
    const bases = [...(route.lan_download_base_urls || []), route.public_download_base_url || ""].filter((base) => base.startsWith("https://"));
    const base = bases[0];
    if (!base) return "";
    return `${base.replace(/\/$/, "")}/download?ticket=${encodeURIComponent(route.ticket)}`;
}
