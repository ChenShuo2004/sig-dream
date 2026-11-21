import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function findNpxPlaywrightEntry() {
    const npxDir = join(homedir(), ".npm", "_npx");
    if (!existsSync(npxDir)) return null;
    for (const hash of readdirSync(npxDir)) {
        for (const pkg of ["playwright", "playwright-core"]) {
            const candidate = join(npxDir, hash, "node_modules", pkg, "index.mjs");
            if (existsSync(candidate)) return candidate;
        }
    }
    return null;
}

export function findChromiumExecutable() {
    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH && existsSync(process.env.PLAYWRIGHT_EXECUTABLE_PATH)) {
        return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    }

    const cacheDir =
        process.platform === "darwin"
            ? join(homedir(), "Library", "Caches", "ms-playwright")
            : join(homedir(), ".cache", "ms-playwright");

    if (existsSync(cacheDir)) {
        const dirs = readdirSync(cacheDir)
            .filter((name) => name.startsWith("chromium-"))
            .sort()
            .reverse();
        for (const dir of dirs) {
            const candidates = [
                join(cacheDir, dir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
                join(cacheDir, dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
                join(cacheDir, dir, "chrome-linux", "chrome"),
                join(cacheDir, dir, "chrome-linux64", "chrome"),
            ];
            for (const candidate of candidates) {
                if (existsSync(candidate)) return candidate;
            }
        }
    }

    const systemCandidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
    ];
    for (const candidate of systemCandidates) {
        if (existsSync(candidate)) return candidate;
    }

    return undefined;
}

export async function loadPlaywright() {
    if (process.env.PLAYWRIGHT_PATH && existsSync(process.env.PLAYWRIGHT_PATH)) {
        return import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href);
    }
    try {
        return await import("playwright");
    } catch {
        // Fallback to playwright-core or cached npx playwright
    }
    try {
        return await import("playwright-core");
    } catch {
        // Continue to npx cache
    }
    const npxEntry = findNpxPlaywrightEntry();
    if (npxEntry) {
        return import(pathToFileURL(npxEntry).href);
    }
    throw new Error("Playwright not found. Install playwright or set PLAYWRIGHT_PATH.");
}

export async function launchChromium(pw, options = {}) {
    const executablePath = findChromiumExecutable();
    return pw.chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        ...options,
    });
}
