/**
 * 在支持 File System Access API 的浏览器中，将用户曾用于「保存到目录」的
 * `FileSystemDirectoryHandle` 持久化到 IndexedDB，便于下次免弹窗选目录（仍需
 * `requestPermission`，由浏览器决定是否再次提示）。
 */

const DB_NAME = "lcwp_material_save_dir_v1";
const STORE = "handles";
const KEY = "default";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function getSavedMaterialDownloadDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const g = store.get(KEY);
      g.onerror = () => reject(g.error ?? new Error("IDB get failed"));
      g.onsuccess = () => {
        const v = g.result;
        resolve(v && typeof (v as FileSystemDirectoryHandle).getFileHandle === "function" ? v : null);
      };
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function persistMaterialSaveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const p = store.put(handle, KEY);
      p.onerror = () => reject(p.error ?? new Error("IDB put failed"));
      p.onsuccess = () => resolve();
      tx.oncomplete = () => db.close();
    });
  } catch {
    /* 忽略持久化失败 */
  }
}

export async function clearSavedMaterialDownloadDirectory(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const p = store.delete(KEY);
      p.onerror = () => reject(p.error ?? new Error("IDB delete failed"));
      p.onsuccess = () => resolve();
      tx.oncomplete = () => db.close();
    });
  } catch {
    /* ignore */
  }
}

/** 若已保存目录且仍被授予读写权限，返回该句柄；否则返回 null（并清除失效记录）。Chromium File System Access：TS DOM 类型可能未含 requestPermission。 */
type DirectoryHandleWithPerm = FileSystemDirectoryHandle & {
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};

export async function tryReuseSavedMaterialDownloadDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const saved = await getSavedMaterialDownloadDirectory();
  if (!saved) return null;
  try {
    const h = saved as DirectoryHandleWithPerm;
    const perm = await h.requestPermission?.({ mode: "readwrite" });
    if (perm === "granted") return saved;
  } catch {
    /* 权限不可用 */
  }
  await clearSavedMaterialDownloadDirectory();
  return null;
}
