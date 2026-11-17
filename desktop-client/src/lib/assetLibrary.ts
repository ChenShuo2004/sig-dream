import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const ASSET_LIBRARY_STORAGE_KEY = "lcp_asset_library";
export const ASSET_LIBRARY_EVENT = "lcp-asset-library-change";

export const ASSET_LIBRARY_AUTO = "auto";
export const ASSET_LIBRARY_PERSONAL_VIDEO = "personal_video";

export type AssetLibraryCode = typeof ASSET_LIBRARY_AUTO | typeof ASSET_LIBRARY_PERSONAL_VIDEO;

export const ASSET_LIBRARY_OPTIONS: { code: AssetLibraryCode; label: string }[] = [
  { code: ASSET_LIBRARY_AUTO, label: "汽车素材库" },
  { code: ASSET_LIBRARY_PERSONAL_VIDEO, label: "个人视频素材库" },
];

export function isAssetLibraryCode(value: string | null | undefined): value is AssetLibraryCode {
  return value === ASSET_LIBRARY_AUTO || value === ASSET_LIBRARY_PERSONAL_VIDEO;
}

export function loadAssetLibraryCode(): AssetLibraryCode {
  if (typeof window === "undefined") return ASSET_LIBRARY_AUTO;
  const raw = window.localStorage.getItem(ASSET_LIBRARY_STORAGE_KEY);
  return isAssetLibraryCode(raw) ? raw : ASSET_LIBRARY_AUTO;
}

export function saveAssetLibraryCode(code: AssetLibraryCode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ASSET_LIBRARY_STORAGE_KEY, code);
  window.dispatchEvent(new Event(ASSET_LIBRARY_EVENT));
}

export function assetLibraryHeaders(
  extra: Record<string, string> = {},
  libraryCode?: AssetLibraryCode,
): Record<string, string> {
  const code = isAssetLibraryCode(libraryCode) ? libraryCode : loadAssetLibraryCode();
  return { ...extra, "X-Asset-Library": code };
}

type AssetLibraryContextValue = {
  library: AssetLibraryCode;
  setLibrary: (code: AssetLibraryCode) => void;
  isPersonalVideo: boolean;
};

const AssetLibraryContext = createContext<AssetLibraryContextValue | null>(null);

export function AssetLibraryProvider({ children }: { children: ReactNode }) {
  const [library, setLibraryState] = useState<AssetLibraryCode>(ASSET_LIBRARY_AUTO);

  useEffect(() => {
    setLibraryState(loadAssetLibraryCode());
    function onChange() {
      setLibraryState(loadAssetLibraryCode());
    }
    window.addEventListener(ASSET_LIBRARY_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(ASSET_LIBRARY_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setLibrary = useCallback((code: AssetLibraryCode) => {
    saveAssetLibraryCode(code);
    setLibraryState(code);
  }, []);

  const value = useMemo(
    () => ({ library, setLibrary, isPersonalVideo: library === ASSET_LIBRARY_PERSONAL_VIDEO }),
    [library, setLibrary],
  );

  return createElement(AssetLibraryContext.Provider, { value }, children);
}

export function useAssetLibrary(): AssetLibraryContextValue {
  const ctx = useContext(AssetLibraryContext);
  if (!ctx) {
    throw new Error("useAssetLibrary 必须在 AssetLibraryProvider 内使用");
  }
  return ctx;
}
