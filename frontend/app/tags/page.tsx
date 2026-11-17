"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { loadAuthSession } from "@/lib/auth";
import { assetLibraryHeaders, useAssetLibrary } from "@/lib/assetLibrary";
import Link from "next/link";
import TutorialGate from "@/components/tutorials/TutorialGate";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import { tagCategoriesForLibrary, tagCategoryHoverTitle, tagCategoryShort } from "@/lib/tagCategoryUi";
import { isNasTransferReady, nasStatusFetchFailed, type NasClientStatus } from "@/lib/nasClientStatus";

type TagItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  status: string;
  synonyms: string[];
  sort_order: number;
  created_at: string;
};

const allCategoryOption = "全部分类";
const statusOptions = [
  { value: "", label: "全部状态" },
  { value: "active", label: "启用" },
  { value: "pending", label: "申请中" },
  { value: "inactive", label: "已停用" },
  { value: "merged", label: "已合并" },
] as const;

function statusLabel(status: string): string {
  if (status === "deleted") return "已删除（回收站）";
  if (status === "rejected") return "已拒绝";
  const match = statusOptions.find((item) => item.value === status);
  return match?.label ?? status;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseErrorDetail(value: unknown): string {
  if (value && typeof value === "object" && "detail" in value) {
    const detail = (value as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return "";
}

function normalizeTagRow(t: TagItem & { description?: string; sort_order?: unknown }): TagItem {
  return {
    ...t,
    description: typeof t.description === "string" ? t.description : "",
    sort_order: typeof t.sort_order === "number" && !Number.isNaN(t.sort_order) ? t.sort_order : Number(t.sort_order) || 0,
  };
}

export default function TagsPage() {
  const apiBaseUrl = useMemo(() => "/api-proxy", []);
  const [token, setToken] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  /** 列表「查找」应用的关键词 / 分类（与创建表单中的名称、分类输入独立应用时机） */
  const [listKeyword, setListKeyword] = useState("");
  const [listCategory, setListCategory] = useState(allCategoryOption);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("等待操作...");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(allCategoryOption);
  const [synonymsText, setSynonymsText] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sourceTagId, setSourceTagId] = useState("");
  const [targetTagId, setTargetTagId] = useState("");
  const [sortBy, setSortBy] = useState<"sort_order" | "name" | "category" | "status" | "created_at">("sort_order");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  /** 点击「手动顺序」表头后置 true，仅在该状态下允许拖拽（须已选定单一列表分类） */
  const [dragSortArmed, setDragSortArmed] = useState(false);
  const [nasStatus, setNasStatus] = useState<NasClientStatus | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const isTagManager = permissions.includes("tag.create");
  const canReviewTags = permissions.includes("tag.review");
  const canDisableTags = permissions.includes("tag.disable");
  const canMergeTags = permissions.includes("tag.merge");
  const canDeleteTags = permissions.includes("tag.delete");
  const { library, isPersonalVideo } = useAssetLibrary();
  const tagEpochRef = useRef(0);
  const categories = tagCategoriesForLibrary(library);
  const [taxonomyTree, setTaxonomyTree] = useState<{ id: string; name: string; children?: { id: string; name: string }[] }[]>([]);
  const [taxonomyName, setTaxonomyName] = useState("");
  const [taxonomyParentId, setTaxonomyParentId] = useState("");

  useEffect(() => {
    const session = loadAuthSession();
    if (session) {
      setToken(session.access_token);
      setPermissions(session.permissions || []);
    }
  }, []);

  function authHeaders(extra: Record<string, string> = {}) {
    const withLib = assetLibraryHeaders(extra, library);
    return token ? { ...withLib, Authorization: `Bearer ${token}` } : withLib;
  }

  async function loadNasClientStatus() {
    if (!token) return;
    try {
      const resp = await fetch(`${apiBaseUrl}/nas-jobs/client-status`, { headers: authHeaders() });
      let data: unknown = null;
      try {
        data = await resp.json();
      } catch {
        data = null;
      }
      if (!resp.ok) {
        setNasStatus(nasStatusFetchFailed(resp.status, data));
        return;
      }
      setNasStatus(data as NasClientStatus);
    } catch {
      setNasStatus(nasStatusFetchFailed());
    }
  }

  function ensureNasReadyOrWarn(actionName: string): boolean {
    if (!nasStatus) return true;
    if (isNasTransferReady(nasStatus)) return true;
    setResult(`[${actionName}已拦截]\n${nasStatus.message || "请联系管理员检查 NAS 客户端与局域网直传服务。"}`);
    return false;
  }

  async function loadTags() {
    const epoch = tagEpochRef.current;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags`, { headers: authHeaders() });
      const data = (await resp.json()) as (TagItem & { description?: string; sort_order?: unknown })[] | { detail?: unknown };
      if (epoch !== tagEpochRef.current) return;
      if (!resp.ok) throw new Error(pretty(data));
      const rows = (data as TagItem[]).map((t) => normalizeTagRow(t as TagItem & { description?: string; sort_order?: unknown }));
      setTags(rows);
      setResult(`[加载标签成功] total=${rows.length}`);
    } catch (error) {
      if (epoch !== tagEpochRef.current) return;
      setResult(`[加载标签失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (epoch === tagEpochRef.current) setBusy(false);
    }
  }

  async function loadTaxonomy() {
    const epoch = tagEpochRef.current;
    if (!isPersonalVideo) {
      if (epoch === tagEpochRef.current) setTaxonomyTree([]);
      return;
    }
    try {
      const resp = await fetch(`${apiBaseUrl}/libraries/${library}/taxonomy`, { headers: authHeaders() });
      const data = await resp.json();
      if (epoch !== tagEpochRef.current) return;
      setTaxonomyTree(resp.ok && Array.isArray(data) ? data : []);
    } catch {
      if (epoch === tagEpochRef.current) setTaxonomyTree([]);
    }
  }

  async function createTaxonomyNode() {
    const name = taxonomyName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/libraries/${library}/taxonomy`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name, parent_id: taxonomyParentId || null }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(pretty(data));
      setTaxonomyName("");
      setTaxonomyParentId("");
      await loadTaxonomy();
      setResult(`[新增分类成功] ${name}`);
    } catch (error) {
      setResult(`[新增分类失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTaxonomyNode(nodeId: string) {
    if (!window.confirm("确认删除该分类节点？二级节点会一并删除，且已绑定素材将无法再按此分类筛选。")) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/libraries/${library}/taxonomy/${nodeId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(pretty(data));
      await loadTaxonomy();
      setResult("[删除分类成功]");
    } catch (error) {
      setResult(`[删除分类失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function searchTags() {
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags`, { headers: authHeaders() });
      const data = (await resp.json()) as (TagItem & { description?: string; sort_order?: unknown })[] | { detail?: unknown };
      if (!resp.ok) throw new Error(pretty(data));
      const rows = (data as TagItem[]).map((t) => normalizeTagRow(t as TagItem & { description?: string; sort_order?: unknown }));
      setTags(rows);
      setListKeyword(name.trim());
      setListCategory(category);
      setResult(`[查找已应用] 当前库 ${rows.length} 条，请查看下方筛选结果`);
    } catch (error) {
      setResult(`[查找失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshTags() {
    setFilterStatus("");
    setListKeyword("");
    setListCategory(allCategoryOption);
    setSortBy("sort_order");
    setSortOrder("asc");
    setDragSortArmed(false);
    await loadTags();
  }

  function toggleSort(column: "sort_order" | "name" | "category" | "status" | "created_at") {
    if (column !== "sort_order") {
      setDragSortArmed(false);
    }
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortOrder(column === "created_at" ? "desc" : "asc");
  }

  function onManualOrderHeaderClick() {
    setDragSortArmed(true);
    toggleSort("sort_order");
  }

  const rowsForTable = useMemo(() => {
    return tags.filter((item) => {
      if (filterStatus && item.status !== filterStatus) return false;
      const kw = listKeyword.trim().toLowerCase();
      if (kw) {
        const hit =
          item.name.toLowerCase().includes(kw) ||
          (item.description || "").toLowerCase().includes(kw) ||
          item.category.toLowerCase().includes(kw) ||
          tagCategoryShort(item.category).toLowerCase().includes(kw);
        if (!hit) return false;
      }
      if (listCategory !== allCategoryOption) {
        if (item.category !== listCategory) return false;
      }
      return true;
    });
  }, [tags, filterStatus, listKeyword, listCategory]);

  const sortedTags = useMemo(() => {
    const rows = [...rowsForTable];
    rows.sort((a, b) => {
      if (sortBy === "sort_order") {
        const da = Number(a.sort_order) || 0;
        const db = Number(b.sort_order) || 0;
        const c = da - db;
        return sortOrder === "asc" ? c : -c;
      }
      let va: string = a[sortBy];
      let vb: string = b[sortBy];
      if (sortBy === "category") {
        va = tagCategoryShort(a.category);
        vb = tagCategoryShort(b.category);
      }
      if (sortBy === "created_at") {
        va = new Date(a.created_at).toISOString();
        vb = new Date(b.created_at).toISOString();
      }
      const compared = va.localeCompare(vb, "zh-CN");
      return sortOrder === "asc" ? compared : -compared;
    });
    return rows;
  }, [rowsForTable, sortBy, sortOrder]);

  const tagsInListCategoryCount =
    listCategory === allCategoryOption ? 0 : tags.filter((t) => t.category === listCategory).length;

  const canDragReorder =
    isTagManager &&
    !filterStatus &&
    !listKeyword.trim() &&
    listCategory !== allCategoryOption &&
    sortBy === "sort_order" &&
    dragSortArmed &&
    tagsInListCategoryCount > 0 &&
    rowsForTable.length === tagsInListCategoryCount;

  async function persistTagOrder(orderedIds: string[]) {
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags/reorder`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify({ category: listCategory, ordered_tag_ids: orderedIds }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(pretty(data));
      setResult(`[调整标签顺序成功]\n${pretty(data)}`);
      await loadTags();
    } catch (error) {
      setResult(`[调整标签顺序失败]\n${error instanceof Error ? error.message : String(error)}`);
      await loadTags();
    } finally {
      setBusy(false);
    }
  }

  async function handleRowDrop(sourceId: string, targetId: string) {
    if (!canDragReorder || sourceId === targetId) return;
    if (!ensureNasReadyOrWarn("调整标签顺序")) return;
    const ids = sortedTags.map((t) => t.id);
    const si = ids.indexOf(sourceId);
    const ti = ids.indexOf(targetId);
    if (si < 0 || ti < 0) return;
    const next = [...ids];
    next.splice(si, 1);
    next.splice(ti, 0, sourceId);
    const cat = listCategory;
    setTags((prev) => {
      const others = prev.filter((t) => t.category !== cat);
      const reordered = next.map((id) => prev.find((t) => t.id === id)).filter((x): x is TagItem => Boolean(x));
      return [...others, ...reordered];
    });
    await persistTagOrder(next);
  }

  const firstActiveForTour = useMemo(
    () => sortedTags.find((t) => t.status === "active" && canDisableTags)?.id,
    [sortedTags, canDisableTags]
  );
  const firstTrashableForTour = useMemo(
    () => sortedTags.find((t) => t.status === "inactive" && canDisableTags && canDeleteTags)?.id,
    [sortedTags, canDisableTags, canDeleteTags]
  );

  useEffect(() => {
    tagEpochRef.current += 1;
    setTags([]);
    setTaxonomyTree([]);
    void loadTags();
    void loadTaxonomy();
    setListCategory(allCategoryOption);
    setCategory(allCategoryOption);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  useEffect(() => {
    if (!token) return;
    void loadNasClientStatus();
    const timer = window.setInterval(() => {
      void loadNasClientStatus();
    }, 10000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submitTag(e: FormEvent) {
    e.preventDefault();
    const actionName = isTagManager ? "创建标签" : "申请标签";
    if (!ensureNasReadyOrWarn(actionName)) return;
    if (category === allCategoryOption) {
      setResult(`[${actionName}失败]\n请先选择具体标签分类后再提交。`);
      return;
    }
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}${isTagManager ? "/tags" : "/tags/apply"}`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: name.trim(),
          category,
          description: descriptionText.trim(),
          synonyms: synonymsText.split(",").map((x) => x.trim()).filter(Boolean),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const detail = parseErrorDetail(data);
        if (resp.status === 409 || detail === "Tag already exists") {
          throw new Error("标签已存在，请更换标签名称或先搜索确认。");
        }
        throw new Error(pretty(data));
      }
      setResult(`[${actionName}成功]\n${pretty(data)}`);
      setName("");
      setSynonymsText("");
      setDescriptionText("");
      await loadTags();
    } catch (error) {
      setResult(`[${actionName}失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deactivateTag(tagId: string) {
    if (!ensureNasReadyOrWarn("停用标签")) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags/${tagId}/deactivate`, {
        method: "PATCH",
        headers: authHeaders({ "X-Access-Context": "internal" }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(pretty(data));
      setResult(`[停用标签成功]\n${pretty(data)}`);
      await loadTags();
    } catch (error) {
      setResult(`[停用标签失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function mergeTags() {
    if (!ensureNasReadyOrWarn("合并标签")) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags/merge`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json", "X-Access-Context": "internal" }),
        body: JSON.stringify({ source_tag_id: sourceTagId, target_tag_id: targetTagId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(pretty(data));
      setResult(`[合并标签成功]\n${pretty(data)}`);
      await loadTags();
    } catch (error) {
      setResult(`[合并标签失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function activateTag(tagId: string) {
    if (!ensureNasReadyOrWarn("启用标签")) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags/${tagId}/activate`, {
        method: "PATCH",
        headers: authHeaders({ "X-Access-Context": "internal" }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(pretty(data));
      setResult(`[启用标签成功]\n${pretty(data)}`);
      await loadTags();
    } catch (error) {
      setResult(`[启用标签失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTagToTrash(tagId: string) {
    if (!ensureNasReadyOrWarn("删除标签")) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags/${tagId}/trash`, {
        method: "PATCH",
        headers: authHeaders({ "X-Access-Context": "internal" }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const detail = parseErrorDetail(data);
        if (resp.status === 409 && detail === "Tag is in use by materials") {
          throw new Error("该标签正在被素材使用，不能删除。");
        }
        throw new Error(pretty(data));
      }
      setResult(`[删除标签成功，已进入回收站]\n${pretty(data)}`);
      await loadTags();
    } catch (error) {
      setResult(`[删除标签失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDeleteTag(tagId: string) {
    if (!window.confirm("确认彻底删除该标签？该操作不可恢复。")) return;
    if (!ensureNasReadyOrWarn("彻底删除标签")) return;
    setBusy(true);
    try {
      const resp = await fetch(`${apiBaseUrl}/tags/${tagId}/permanent`, {
        method: "DELETE",
        headers: authHeaders({ "X-Access-Context": "internal" }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(pretty(data));
      setResult(`[彻底删除标签成功]\n${pretty(data)}`);
      await loadTags();
    } catch (error) {
      setResult(`[彻底删除标签失败]\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 grid gap-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <MaintenanceBanner token={token} />
        {nasStatus && !isNasTransferReady(nasStatus) ? (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {nasStatus.message}
          </div>
        ) : null}
        <h1 className="text-xl font-semibold text-slate-900">标签管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          {isPersonalVideo
            ? "当前为个人视频素材库：主题面在此维护；一二级分类用下方「库内分类树」。"
            : "超级管理员/素材管理员可创建标签；其他成员可申请标签。"}
        </p>
        {canReviewTags ? <Link href="/tag-requests" className="mt-2 inline-block text-sm text-blue-600 underline">进入标签审核页</Link> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm grid gap-3">
        <form onSubmit={submitTag} className="grid gap-2 md:grid-cols-4">
          <input className="rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="标签名" required />
          <select className="rounded border px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value={allCategoryOption}>{allCategoryOption}</option>
            {categories.map((c) => (
              <option key={c} value={c} title={tagCategoryHoverTitle(c)}>
                {tagCategoryShort(c)}
              </option>
            ))}
          </select>
          <input className="rounded border px-3 py-2" value={synonymsText} onChange={(e) => setSynonymsText(e.target.value)} placeholder="同义词（逗号分隔）" />
          <select
            data-tour="tags-status-filter"
            className="rounded border px-3 py-2"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            {statusOptions.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <textarea
            className="rounded border px-3 py-2 md:col-span-4"
            rows={2}
            value={descriptionText}
            onChange={(e) => setDescriptionText(e.target.value)}
            placeholder="说明（可选，与《标签说明》一致便于团员理解）"
          />
          <button
            data-tour="tags-create-button"
            className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-40 md:col-span-1"
            disabled={busy}
          >
            {isTagManager ? "创建标签" : "申请标签"}
          </button>
          <button type="button" className="rounded border px-3 py-2" onClick={searchTags} disabled={busy}>查找</button>
          <button type="button" className="rounded border px-3 py-2" onClick={refreshTags} disabled={busy}>刷新</button>
        </form>

        <div className="grid gap-2 md:grid-cols-[1fr,120px,1fr]">
          <input className="rounded border px-3 py-2" value={sourceTagId} onChange={(e) => setSourceTagId(e.target.value)} placeholder="标签A（输入标签 ID）" />
          <button
            data-tour="tags-replace-button"
            type="button"
            className="rounded border px-3 py-2 text-sm"
            onClick={mergeTags}
            disabled={busy || !canMergeTags || !sourceTagId || !targetTagId}
          >
            替换成
          </button>
          <input className="rounded border px-3 py-2" value={targetTagId} onChange={(e) => setTargetTagId(e.target.value)} placeholder="标签B（输入标签 ID）" />
        </div>
      </section>

      {isPersonalVideo ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm grid gap-3">
          <h2 className="text-base font-semibold text-slate-900">库内分类树（一级 / 二级）</h2>
          <p className="text-sm text-slate-600">一级与二级是受控分类节点，不是标签。关键词请写在素材上，不要建成标签。</p>
          <div className="grid gap-2 md:grid-cols-[1fr,1fr,auto]">
            <input
              className="rounded border px-3 py-2"
              value={taxonomyName}
              onChange={(e) => setTaxonomyName(e.target.value)}
              placeholder="分类名称（如：防御机制 / 假装没事）"
            />
            <select className="rounded border px-3 py-2" value={taxonomyParentId} onChange={(e) => setTaxonomyParentId(e.target.value)}>
              <option value="">作为一级分类</option>
              {taxonomyTree.map((node) => (
                <option key={node.id} value={node.id}>
                  挂到「{node.name}」下（二级）
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-40"
              disabled={busy || !isTagManager || !taxonomyName.trim()}
              onClick={() => void createTaxonomyNode()}
            >
              新增分类
            </button>
          </div>
          <ul className="grid gap-2 text-sm text-slate-800">
            {taxonomyTree.length === 0 ? <li className="text-slate-500">暂无分类节点</li> : null}
            {taxonomyTree.map((node) => (
              <li key={node.id} className="rounded border border-slate-200 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{node.name}</span>
                  {canDeleteTags ? (
                    <button type="button" className="text-xs text-red-600" onClick={() => void deleteTaxonomyNode(node.id)}>
                      删除一级
                    </button>
                  ) : null}
                </div>
                <ul className="mt-1 grid gap-1 pl-3">
                  {(node.children || []).map((child) => (
                    <li key={child.id} className="flex items-center justify-between gap-2 text-slate-600">
                      <span>{child.name}</span>
                      {canDeleteTags ? (
                        <button type="button" className="text-xs text-red-600" onClick={() => void deleteTaxonomyNode(child.id)}>
                          删除
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-2 text-sm text-slate-500">
          标签列表（当前库 {tags.length} 条，当前显示 {rowsForTable.length} 条）
              {isTagManager ? (
            <span className="ml-2 text-xs text-slate-400">
              {canDragReorder
                ? `已启用拖拽排序（分类「${listCategory}」）：拖动左侧手柄将提交该分类下全部标签的新顺序。`
                : "拖拽排序：列表须选定某一分类、全部状态、无关键词；先点击表头「手动顺序」进入可拖状态。"}
            </span>
          ) : null}
        </div>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="w-10 px-1 py-2 text-center text-xs font-semibold text-slate-500" title="拖拽排序">
                  {canDragReorder ? "⋮" : ""}
                </th>
                <th className="px-3 py-2 text-left">
                  <button type="button" className="font-semibold hover:underline" onClick={() => onManualOrderHeaderClick()}>
                    手动顺序{sortBy === "sort_order" ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <button className="font-semibold hover:underline" onClick={() => toggleSort("name")}>
                    标签名{sortBy === "name" ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="px-3 py-2 text-left" data-tour="tags-category-list">
                  <button className="font-semibold hover:underline" onClick={() => toggleSort("category")}>
                    分类{sortBy === "category" ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="min-w-[10rem] max-w-md px-3 py-2 text-left text-xs font-semibold">说明</th>
                <th className="px-3 py-2 text-left">
                  <button className="font-semibold hover:underline" onClick={() => toggleSort("status")}>
                    状态{sortBy === "status" ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <button className="font-semibold hover:underline" onClick={() => toggleSort("created_at")}>
                    创建时间{sortBy === "created_at" ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                <th className="px-3 py-2 text-left">标签 ID</th>
                <th className="px-3 py-2 text-left" data-tour="tags-edit-button">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTags.map((tag) => (
                <tr
                  key={tag.id}
                  className={`border-t ${dragOverId === tag.id ? "bg-sky-50" : ""}`}
                  draggable={canDragReorder}
                  onDragStart={
                    canDragReorder
                      ? (e) => {
                          e.dataTransfer.setData("text/plain", tag.id);
                          e.dataTransfer.effectAllowed = "move";
                        }
                      : undefined
                  }
                  onDragOver={
                    canDragReorder
                      ? (e) => {
                          e.preventDefault();
                          setDragOverId(tag.id);
                        }
                      : undefined
                  }
                  onDragLeave={canDragReorder ? () => setDragOverId(null) : undefined}
                  onDrop={
                    canDragReorder
                      ? (e) => {
                          e.preventDefault();
                          const sid = e.dataTransfer.getData("text/plain");
                          setDragOverId(null);
                          if (sid) void handleRowDrop(sid, tag.id);
                        }
                      : undefined
                  }
                >
                  <td className="px-1 py-2 text-center text-slate-400 select-none">{canDragReorder ? "⠿" : ""}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{tag.sort_order}</td>
                  <td className="px-3 py-2 font-medium">{tag.name}</td>
                  <td className="px-3 py-2 text-slate-500" title={tagCategoryHoverTitle(tag.category)}>
                    {tagCategoryShort(tag.category)}
                  </td>
                  <td className="max-w-md px-3 py-2 align-top text-xs text-slate-600">
                    <div className="line-clamp-4 whitespace-pre-wrap break-words" title={tag.description || ""}>
                      {(tag.description || "").trim() ? tag.description : "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{statusLabel(tag.status)}</td>
                  <td className="px-3 py-2 text-slate-500">{new Date(tag.created_at).toLocaleString("zh-CN")}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{tag.id}</td>
                  <td className="px-3 py-2">
                    {!isTagManager ? (
                      <button className="rounded border px-2 py-1 text-xs opacity-50 cursor-not-allowed" disabled>
                        {tag.status === "pending" ? "申请中" : "不可操作"}
                      </button>
                    ) : tag.status === "active" && canDisableTags ? (
                      <button
                        data-tour={tag.id === firstActiveForTour ? "tags-disable-button" : undefined}
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => deactivateTag(tag.id)}
                        disabled={busy}
                      >
                        停用
                      </button>
                    ) : tag.status === "inactive" && canDisableTags ? (
                      <div className="flex items-center gap-2">
                        <button className="rounded border px-2 py-1 text-xs" onClick={() => activateTag(tag.id)} disabled={busy}>
                          启用
                        </button>
                        <button
                          data-tour={tag.id === firstTrashableForTour ? "tags-delete-button" : undefined}
                          className="rounded border border-red-300 px-2 py-1 text-xs text-red-300"
                          onClick={() => deleteTagToTrash(tag.id)}
                          disabled={busy || !canDeleteTags}
                        >
                          删除
                        </button>
                      </div>
                    ) : tag.status === "deleted" && canDeleteTags ? (
                      <button className="rounded border border-red-300 px-2 py-1 text-xs text-red-300" onClick={() => permanentlyDeleteTag(tag.id)} disabled={busy || !canDeleteTags}>
                        彻底删除
                      </button>
                    ) : (
                      <button className="rounded border px-2 py-1 text-xs opacity-50 cursor-not-allowed" disabled>
                        不可操作
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <pre className="rounded bg-slate-900 p-4 text-xs text-emerald-100 whitespace-pre-wrap">{result}</pre>
      <Suspense fallback={null}>
        <TutorialGate pageTutorialKey="tags" />
      </Suspense>
    </main>
  );
}
