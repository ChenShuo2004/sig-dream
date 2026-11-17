import { useCallback, useEffect, useState } from "react";

import { apiJson } from "@/lib/apiClient";
import { useAssetLibrary } from "@/lib/assetLibrary";
import { hasPermission } from "@/lib/auth";
import { formatBytes } from "@/lib/formatBytes";

type GroupNode = { id: string; name: string; children?: GroupNode[] };
type GroupsResponse = { items: GroupNode[] };
type CollectionRow = {
  id: string;
  name: string;
  collection_type: string;
  group_id: string | null;
  status: string;
  item_count: number;
  created_by_name: string;
};
type CollectionListResponse = { items: CollectionRow[]; total: number; page: number; page_size: number };
type CollectionMaterialRow = {
  material_id: string;
  title: string;
  original_filename: string | null;
  file_size: number | null;
  material_status: string;
};
type CollectionMaterialsResponse = { items: CollectionMaterialRow[]; total: number; page: number; page_size: number };

function GroupTree({ nodes, depth = 0 }: { nodes: GroupNode[]; depth?: number }) {
  return (
    <ul className={depth ? "ml-3 border-l border-white/10 pl-2" : ""}>
      {nodes.map((n) => (
        <li key={n.id} className="py-0.5 text-sm text-slate-300">
          <span className="text-slate-100">{n.name}</span>
          {n.children?.length ? <GroupTree nodes={n.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

export default function CollectionsPage() {
  const { library, isPersonalVideo } = useAssetLibrary();
  const [tab, setTab] = useState<"personal" | "project">("personal");
  const [groups, setGroups] = useState<GroupNode[]>([]);
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<CollectionMaterialRow[]>([]);
  const [totalMat, setTotalMat] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const canView = hasPermission("collection.view");

  const loadGroups = useCallback(async () => {
    if (!canView) return;
    const data = await apiJson<GroupsResponse>(`/collections/groups?group_type=${tab}`);
    setGroups(Array.isArray(data.items) ? data.items : []);
  }, [canView, tab, library]);

  const loadCollections = useCallback(async () => {
    if (!canView) return;
    const params = new URLSearchParams();
    params.set("collection_type", tab);
    params.set("page", "1");
    params.set("page_size", "100");
    const data = await apiJson<CollectionListResponse>(`/collections?${params.toString()}`);
    setCollections(data.items || []);
  }, [canView, tab, library]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        await loadGroups();
        await loadCollections();
        setSelectedId(null);
        setMaterials([]);
        setTotalMat(0);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, loadCollections, loadGroups]);

  async function loadMaterials(collectionId: string) {
    setSelectedId(collectionId);
    setLoading(true);
    setErr("");
    try {
      const params = new URLSearchParams({ page: "1", page_size: "50" });
      const data = await apiJson<CollectionMaterialsResponse>(`/collections/${collectionId}/materials?${params}`);
      setMaterials(data.items || []);
      setTotalMat(data.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setMaterials([]);
    } finally {
      setLoading(false);
    }
  }

  if (!canView) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">当前账号无「素材集合」查看权限（collection.view）。</div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full min-w-0 px-4 py-8 sm:px-6 2xl:px-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-slate-100">
        {isPersonalVideo ? "素材集合 · 个人视频素材库" : "素材集合 · 汽车素材库"}
      </h1>
      <p className="mb-4 text-xs text-slate-400">集合为引用关系，与 Web 端一致；此处仅浏览与条目列表，后续版本支持缓存与拖拽。</p>
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          className={tab === "personal" ? "rounded-lg bg-sky-600/40 px-3 py-1.5 text-sm text-sky-100" : "rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"}
          onClick={() => setTab("personal")}
        >
          我的集合
        </button>
        <button
          type="button"
          className={tab === "project" ? "rounded-lg bg-sky-600/40 px-3 py-1.5 text-sm text-sky-100" : "rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"}
          onClick={() => setTab("project")}
        >
          项目集合
        </button>
      </div>
      {err ? <div className="mb-3 rounded-lg border border-red-400/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</div> : null}
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-white/10 bg-slate-900/55 p-4 backdrop-blur-xl">
          <h2 className="text-sm font-semibold text-slate-100">分组树</h2>
          {loading && !groups.length ? <p className="mt-2 text-xs text-slate-500">加载中…</p> : <div className="mt-2 max-h-[50vh] overflow-auto">{groups.length ? <GroupTree nodes={groups} /> : <p className="text-xs text-slate-500">暂无分组</p>}</div>}
          <h2 className="mt-4 text-sm font-semibold text-slate-100">集合列表</h2>
          <ul className="mt-2 max-h-[40vh] space-y-1 overflow-auto text-sm">
            {collections.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={
                    selectedId === c.id
                      ? "w-full rounded-md bg-sky-600/35 px-2 py-1.5 text-left text-sky-50"
                      : "w-full rounded-md px-2 py-1.5 text-left text-slate-300 hover:bg-white/10"
                  }
                  onClick={() => void loadMaterials(c.id)}
                >
                  {c.name}
                  <span className="ml-1 text-xs text-slate-500">({c.item_count})</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-200">集合内素材</h2>
          {!selectedId ? (
            <p className="mt-3 text-sm text-slate-500">请从左侧选择一个集合。</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">共 {totalMat} 条（首屏最多 50 条）</p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead>
                <tr className="border-b border-slate-600 text-slate-500">
                  <th className="py-2 pr-2">标题</th>
                  <th className="py-2 pr-2">原始文件名</th>
                  <th className="py-2 pr-2">大小</th>
                  <th className="py-2">状态</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={m.material_id} className="border-b border-slate-700/80">
                    <td className="py-2 pr-2 font-medium text-slate-100">{m.title}</td>
                    <td className="py-2 pr-2">{m.original_filename ?? "—"}</td>
                    <td className="py-2 pr-2">{formatBytes(m.file_size)}</td>
                    <td className="py-2">{m.material_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
