const fs = require("fs");
const path = require("path");

const STORE_VERSION = 1;

function emptyStore() {
  return {
    version: STORE_VERSION,
    lastSyncedAt: null,
    tags: {},
    materials: {},
    files: {},
  };
}

function storePath(userDataDir) {
  return path.join(userDataDir, "metadata-cache.json");
}

function loadMetadataStore(userDataDir) {
  const fp = storePath(userDataDir);
  if (!fs.existsSync(fp)) return emptyStore();
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const o = JSON.parse(raw);
    return {
      version: STORE_VERSION,
      lastSyncedAt: typeof o.lastSyncedAt === "string" ? o.lastSyncedAt : null,
      tags: o.tags && typeof o.tags === "object" ? o.tags : {},
      materials: o.materials && typeof o.materials === "object" ? o.materials : {},
      files: o.files && typeof o.files === "object" ? o.files : {},
    };
  } catch {
    return emptyStore();
  }
}

function saveMetadataStore(userDataDir, store) {
  const fp = storePath(userDataDir);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 0), "utf8");
  fs.renameSync(tmp, fp);
}

/**
 * @param {ReturnType<typeof loadMetadataStore>} store
 * @param {{ tags?: unknown[]; materials?: unknown[]; files?: unknown[]; synced_at?: string }} batch
 */
function applyMetadataSyncBatch(store, batch) {
  const next = { ...store, tags: { ...store.tags }, materials: { ...store.materials }, files: { ...store.files } };
  for (const t of batch.tags || []) {
    if (!t || typeof t !== "object" || !t.id) continue;
    next.tags[String(t.id)] = t;
  }
  for (const m of batch.materials || []) {
    if (!m || typeof m !== "object" || !m.id) continue;
    next.materials[String(m.id)] = m;
  }
  for (const f of batch.files || []) {
    if (!f || typeof f !== "object" || !f.id) continue;
    const rel = f.file_relative_path || f.file_path;
    next.files[String(f.id)] = { ...f, file_relative_path: rel, file_path: rel };
  }
  if (batch.synced_at) next.lastSyncedAt = String(batch.synced_at);
  return next;
}

function getFileRecord(store, fileId) {
  return store.files[String(fileId || "")] || null;
}

function getMaterialPrimaryFile(store, materialId) {
  const mat = store.materials[String(materialId || "")];
  if (!mat) return null;
  const primaryId = mat.primary_file_id;
  if (primaryId && store.files[String(primaryId)]) return store.files[String(primaryId)];
  for (const f of Object.values(store.files)) {
    if (f && String(f.material_id) === String(materialId)) return f;
  }
  return null;
}

function metadataStats(store) {
  return {
    tagCount: Object.keys(store.tags).length,
    materialCount: Object.keys(store.materials).length,
    fileCount: Object.keys(store.files).length,
    lastSyncedAt: store.lastSyncedAt,
  };
}

module.exports = {
  loadMetadataStore,
  saveMetadataStore,
  applyMetadataSyncBatch,
  getFileRecord,
  getMaterialPrimaryFile,
  metadataStats,
  emptyStore,
};
