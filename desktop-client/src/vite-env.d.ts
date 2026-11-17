/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    desktopClient?: {
      platform: string;
      getBootConfig?: () => Promise<{
        apiBaseUrl: string;
        cacheRoot: string;
        material_assets_root?: string;
        nasMountRoot?: string;
        jsonPath?: string;
        settingsFileMissing?: boolean;
        usesNextApiProxy?: boolean;
        serverOrigin?: string;
      }>;
      saveServerOrigin?: (origin: string) => Promise<{ ok: boolean; message?: string }>;
      probeHttpGet?: (url: string, timeoutMs?: number) => Promise<{ ok: boolean; status?: number; error?: string }>;
      getDesktopLocalSettings?: () => Promise<{
        material_assets_root: string;
        nasMountRoot: string;
        defaultMaterialAssetsRoot: string;
        defaultNasMountRoot: string;
        cacheRoot: string;
        metadata: {
          tagCount: number;
          materialCount: number;
          fileCount: number;
          lastSyncedAt: string | null;
        };
      }>;
      saveDesktopLocalSettings?: (patch: {
        material_assets_root?: string;
        nasMountRoot?: string;
      }) => Promise<{ material_assets_root: string; nasMountRoot: string }>;
      metadataSyncApply?: (batch: {
        tags?: unknown[];
        materials?: unknown[];
        files?: unknown[];
        synced_at?: string;
      }) => Promise<{
        tagCount: number;
        materialCount: number;
        fileCount: number;
        lastSyncedAt: string | null;
      }>;
      metadataSyncStats?: () => Promise<{
        tagCount: number;
        materialCount: number;
        fileCount: number;
        lastSyncedAt: string | null;
      }>;
      resolveMaterialFile?: (payload: {
        materialId?: string;
        fileId?: string;
        fileRelativePath?: string;
        file_relative_path?: string;
      }) => Promise<{
        ok: boolean;
        exists?: boolean;
        absolutePath?: string;
        file_relative_path?: string;
        material_assets_root?: string;
        error?: string | null;
        message?: string | null;
      }>;
      resolveNasFile?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
      peekFileDragSync?: (payload: {
        materialId?: string;
        fileId?: string;
        fileRelativePath?: string;
        file_relative_path?: string;
      }) => {
        ok: boolean;
        exists?: boolean;
        absolutePath?: string;
        error?: string;
        message?: string;
        material_assets_root?: string;
        file_relative_path?: string;
      };
      beginCachedFileDragSync?: (payload: { absolutePath: string }) => {
        ok: boolean;
        absolutePath?: string;
        exists?: boolean;
        error?: string;
      };
      downloadToCache?: (payload: {
        url: string;
        materialId: string;
        fileId: string;
        originalFilename: string;
        expectedSize?: number;
        headers?: Record<string, string>;
        cacheRoot?: string;
      }) => Promise<{ ok: boolean; absolutePath?: string; fromCache?: boolean; message?: string }>;
      showItemInFolder?: (absolutePath: string) => Promise<{ ok: boolean; error?: string }>;
      copyText?: (text: string) => Promise<{ ok: boolean }>;
      copyFileForPaste?: (absolutePath: string) => Promise<{ ok: boolean; message?: string; absolutePath?: string }>;
      getAppVersion?: () => Promise<{ version: string; packaged: boolean }>;
      checkForUpdates?: () => Promise<{ ok: boolean; message?: string; updateInfo?: { version?: string } }>;
      downloadUpdate?: () => Promise<{ ok: boolean; message?: string }>;
      quitAndInstall?: () => Promise<{ ok: boolean }>;
      onUpdateStatus?: (handler: (payload: { phase: string; message: string; version?: string; percent?: number }) => void) => () => void;
      startNativeFilesDragSync?: (payload: { items: Array<Record<string, unknown>> }) => {
        ok: boolean;
        fileCount?: number;
        files?: string[];
        missingCount?: number;
        skipped?: Array<{ materialId?: string; error?: string; message?: string | null }>;
        truncated?: boolean;
        maxBulk?: number;
        error?: string;
        message?: string;
      };
      startNativeFileDragSync?: (payload: {
        materialId?: string;
        fileId?: string;
        fileRelativePath?: string;
        file_relative_path?: string;
        absolutePath?: string;
        path?: string;
      }) => {
        ok: boolean;
        absolutePath?: string;
        error?: string;
        message?: string;
        mode?: string;
      };
      startNativeFileDrag?: (payload: { path: string }) => void;
    };
  }
}
