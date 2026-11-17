import { loadAuthSession } from "@/lib/auth";
import { assetLibraryHeaders } from "@/lib/assetLibrary";

/** 与素材库 download-route / prepare 请求一致的头（含 Bearer）。 */
export function materialDownloadAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Access-Context": "internal",
    ...assetLibraryHeaders(),
  };
  const token = loadAuthSession()?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
