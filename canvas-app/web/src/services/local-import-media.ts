const localImports: Record<string, string> = {};

export function localImportUrl(title?: string) {
    const name = fileNameFromTitle(title);
    const file = name ? localImports[name] : "";
    if (!file || typeof window === "undefined") return "";
    return new URL(encodeURI(file), new URL(import.meta.env.BASE_URL || "/", window.location.href)).href;
}

function fileNameFromTitle(title?: string) {
    const line = (title || "").split(/\r?\n/, 1)[0]?.trim() || "";
    const base = line.split(/[/\\]/).pop() || "";
    return base.replace(/\s+Copy(?:\s+\d+)?$/i, "").trim();
}
