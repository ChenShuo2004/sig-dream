from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.asset_library import LibraryTaxonomyNode
from app.models.material import Material, MaterialFile, MaterialTag, NasJob
from app.models.tag import Tag
from app.services.library_service import (
    THEME_TAG_CATEGORY,
    UNORGANIZED_TAG_NAME,
    is_personal_video_library,
    library_code_for_id,
    normalize_copy_fit,
    normalize_keywords,
    tag_categories_for_library,
)
from app.services.material_service import get_material
from app.services.operation_log_service import record_operation_log
from app.services.settings_service import get_user_permissions
from app.services.tag_service import next_sort_order_for_category

ANALYZE_CONTENT_JOB_TYPE = "analyze_content"
# 建议写在主文件 metadata 上，不落 materials 正式字段；采纳时才写入业务字段
ANALYSIS_METADATA_KEY = "ai_analysis"
# 文件机回写进度；百分比给未整理页卡片/中间栏
ANALYSIS_PROGRESS_STEPS: dict[str, tuple[int, str]] = {
    "queued": (10, "已排队，等待文件机领取"),
    "claimed": (20, "文件机已领取任务"),
    "frames": (40, "正在从预览或原片抽帧"),
    "vision": (75, "视觉模型正在看画面"),
    "saving": (90, "正在回写识别建议"),
}

_IMAGE_EXTENSIONS = frozenset({"jpg", "jpeg", "png", "gif", "webp", "bmp"})
_VIDEO_EXTENSIONS = frozenset({"mp4", "mov", "mkv", "avi", "webm", "m4v"})


def _normalize_name(raw: object) -> str:
    return str(raw or "").strip()


def _match_key(raw: object) -> str:
    return _normalize_name(raw).casefold()


def _alias_keys(raw: object) -> set[str]:
    name = _normalize_name(raw)
    if not name:
        return set()
    keys = {_match_key(name)}
    for part in name.split("/"):
        part_key = _match_key(part)
        if part_key:
            keys.add(part_key)
    return keys


def _aliases_overlap(left: object, right: object) -> bool:
    return bool(_alias_keys(left) & _alias_keys(right))


def _taxonomy_name_matches(node_name: object, suggested: object) -> bool:
    if _aliases_overlap(node_name, suggested):
        return True
    node_key = _match_key(node_name)
    sug_key = _match_key(suggested)
    if not node_key or not sug_key or len(sug_key) < 2:
        return False
    if sug_key in node_key:
        return True
    return any(sug_key in part or part.startswith(sug_key) for part in _alias_keys(node_name))


def _name_overlap_score(left: object, right: object) -> int:
    a = _match_key(left).replace(" ", "").replace("/", "")
    b = _match_key(right).replace(" ", "").replace("/", "")
    if not a or not b:
        return 0
    if a == b:
        return 100
    score = 0
    for n in (2, 3):
        grams_a = {a[i : i + n] for i in range(0, max(len(a) - n + 1, 0))}
        grams_b = {b[i : i + n] for i in range(0, max(len(b) - n + 1, 0))}
        score += len(grams_a & grams_b) * n
    skip = set("的与和及或了着过")
    score += len((set(a) - skip) & (set(b) - skip))
    return score


def _infer_primary_for_secondary(
    roots: list[LibraryTaxonomyNode],
    children: list[LibraryTaxonomyNode],
    secondary_name: str,
) -> tuple[str | None, str | None]:
    """新二级对不上树时，按用词重叠推断一个已有一级，避免建议只有二级。"""
    best_score = 0
    best_root: LibraryTaxonomyNode | None = None
    for child in children:
        parent = next((r for r in roots if r.id == child.parent_id), None)
        if parent is None:
            continue
        score = _name_overlap_score(child.name, secondary_name)
        if score > best_score:
            best_score = score
            best_root = parent
    for root in roots:
        score = _name_overlap_score(root.name, secondary_name)
        if score > best_score:
            best_score = score
            best_root = root
    if best_root is None and roots:
        best_root = roots[0]
    if best_root is None:
        return None, None
    return str(best_root.id), best_root.name


def _primary_file(db: Session, material_id: UUID) -> MaterialFile | None:
    return db.scalar(
        select(MaterialFile)
        .where(MaterialFile.material_id == material_id)
        .order_by(MaterialFile.created_at.asc())
        .limit(1)
    )


def _can_edit(perms: set[str], material: Material, username: str) -> bool:
    if "asset.edit_all" in perms:
        return True
    return "asset.edit_own" in perms and material.uploader == username


def _ensure_edit_permission(perms: set[str]) -> None:
    if "asset.edit_all" not in perms and "asset.edit_own" not in perms:
        raise HTTPException(status_code=403, detail="Missing permission: asset.edit_own/asset.edit_all")


def _suggestable_tags(db: Session, library_id: UUID) -> list[Tag]:
    """当前库可被建议的业务标签：启用、非「未整理」；个人视频库仅「适用主题」。"""
    rows = list(
        db.scalars(
            select(Tag)
            .where(Tag.library_id == library_id, Tag.status == "active")
            .order_by(Tag.sort_order.asc(), Tag.name.asc())
        ).all()
    )
    themes_only = is_personal_video_library(library_id)
    out: list[Tag] = []
    for row in rows:
        if row.name == UNORGANIZED_TAG_NAME:
            continue
        if themes_only and row.category != THEME_TAG_CATEGORY:
            continue
        out.append(row)
    return out


def _allowed_tags_payload(db: Session, library_id: UUID) -> list[dict]:
    """按分类给出候选词表，供文件机侧模型「只能从清单里选」。"""
    library_code = library_code_for_id(library_id)
    by_category: dict[str, list[str]] = {}
    for tag in _suggestable_tags(db, library_id):
        by_category.setdefault(tag.category, []).append(tag.name)
    ordered = [c for c in tag_categories_for_library(library_code) if c in by_category]
    extras = [c for c in by_category if c not in ordered]
    return [{"category": c, "names": by_category[c]} for c in [*ordered, *extras]]


def _taxonomy_payload(db: Session, library_id: UUID) -> list[dict]:
    rows = list(
        db.scalars(
            select(LibraryTaxonomyNode)
            .where(LibraryTaxonomyNode.library_id == library_id)
            .order_by(LibraryTaxonomyNode.sort_order.asc(), LibraryTaxonomyNode.name.asc())
        ).all()
    )
    children: dict[UUID, list[str]] = {}
    for row in rows:
        if row.parent_id is not None:
            children.setdefault(row.parent_id, []).append(row.name)
    return [
        {"primary": row.name, "secondary": children.get(row.id, [])}
        for row in rows
        if row.parent_id is None
    ]


def _media_kind(extension: str | None) -> str | None:
    ext = (extension or "").strip().lower().lstrip(".")
    if ext in _IMAGE_EXTENSIONS:
        return "image"
    if ext in _VIDEO_EXTENSIONS:
        return "video"
    return None


def read_analysis(material_file: MaterialFile | None) -> dict | None:
    if material_file is None:
        return None
    meta = material_file.extra_metadata
    if not isinstance(meta, dict):
        return None
    value = meta.get(ANALYSIS_METADATA_KEY)
    return dict(value) if isinstance(value, dict) else None


def _write_analysis(material_file: MaterialFile, value: dict) -> None:
    meta = dict(material_file.extra_metadata or {})
    meta[ANALYSIS_METADATA_KEY] = value
    material_file.extra_metadata = meta


def update_content_analysis_progress(
    db: Session,
    material_file: MaterialFile,
    *,
    step: str,
    percent: int | None = None,
    label: str | None = None,
) -> None:
    """识别进行中回写步骤，不记操作日志（高频）。"""
    known = ANALYSIS_PROGRESS_STEPS.get(step)
    resolved_percent = percent if percent is not None else (known[0] if known else 0)
    resolved_label = (label or "").strip() or (known[1] if known else step)
    prev = read_analysis(material_file) or {}
    _write_analysis(
        material_file,
        {
            **prev,
            "status": "pending",
            "step": step,
            "step_label": resolved_label,
            "percent": max(0, min(100, int(resolved_percent))),
            "error": None,
        },
    )
    db.add(material_file)


def _has_open_analysis_job(db: Session, material_file_id: UUID) -> bool:
    row = db.scalar(
        select(NasJob.id)
        .where(
            NasJob.job_type == ANALYZE_CONTENT_JOB_TYPE,
            NasJob.status.in_(("pending", "running")),
            NasJob.payload["material_file_id"].astext == str(material_file_id),
        )
        .limit(1)
    )
    return row is not None


def enqueue_content_analysis(
    db: Session, *, username: str, asset_ids: list[str], library_id: UUID, auto_apply: bool = False
) -> tuple[int, int, list[dict]]:
    """为未整理素材排队 analyze_content：文件机侧读缩略图/预览抽帧跑视觉模型，产出建议标签与描述。"""
    perms = get_user_permissions(db, username)
    _ensure_edit_permission(perms)
    allowed_tags = _allowed_tags_payload(db, library_id)
    personal_video = is_personal_video_library(library_id)
    if not allowed_tags and not personal_video:
        raise HTTPException(status_code=400, detail="当前库没有可用标签，无法生成建议")
    taxonomy_options = _taxonomy_payload(db, library_id) if personal_video else []
    library_code = library_code_for_id(library_id)
    success_count = 0
    failed_items: list[dict] = []
    for asset_id in asset_ids:
        try:
            material = get_material(db, asset_id, only_available=False)
            if material.library_id != library_id:
                raise HTTPException(status_code=400, detail="素材不属于当前素材库")
            if not _can_edit(perms, material, username):
                raise HTTPException(status_code=403, detail="No edit permission for material")
            primary = _primary_file(db, material.id)
            if primary is None:
                raise HTTPException(status_code=400, detail="素材没有主文件")
            kind = _media_kind(primary.extension)
            if kind is None:
                raise HTTPException(status_code=400, detail="仅图片与视频支持内容识别")
            file_path = (primary.file_path or "").strip().replace("\\", "/")
            if not file_path:
                raise HTTPException(status_code=400, detail="主文件尚未写入 NAS 路径")
            if _has_open_analysis_job(db, primary.id):
                raise HTTPException(status_code=409, detail="该素材已有进行中的识别任务")
            meta = dict(primary.extra_metadata or {})
            db.add(
                NasJob(
                    job_type=ANALYZE_CONTENT_JOB_TYPE,
                    payload={
                        "material_id": str(material.id),
                        "material_file_id": str(primary.id),
                        "library_code": library_code,
                        "media_kind": kind,
                        "extension": (primary.extension or "").strip().lower().lstrip("."),
                        "file_path": file_path,
                        "thumbnail_path": str(meta.get("thumbnail_path") or "").strip() or None,
                        "preview_video_path": str(meta.get("preview_video_path") or "").strip() or None,
                        "original_filename": primary.original_filename,
                        "allowed_tags": allowed_tags,
                        "taxonomy_options": taxonomy_options,
                        "allow_open_vocab": personal_video,
                        "needs_keywords": personal_video,
                        "needs_copy_fit": personal_video,
                    },
                    status="pending",
                    max_retries=0,
                )
            )
            _write_analysis(
                primary,
                {
                    **(read_analysis(primary) or {}),
                    "status": "pending",
                    "step": "queued",
                    "step_label": ANALYSIS_PROGRESS_STEPS["queued"][1],
                    "percent": ANALYSIS_PROGRESS_STEPS["queued"][0],
                    "library_code": library_code,
                    "requested_by": username,
                    "requested_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                    "auto_apply": bool(auto_apply),
                    "error": None,
                },
            )
            success_count += 1
        except HTTPException as exc:
            failed_items.append({"asset_id": asset_id, "reason": str(exc.detail)})
        except Exception as exc:  # noqa: BLE001
            failed_items.append({"asset_id": asset_id, "reason": str(exc)})
    db.commit()
    return success_count, len(failed_items), failed_items


def _resolve_taxonomy_suggestion(
    db: Session,
    library_id: UUID,
    primary_raw: object,
    secondary_raw: object,
) -> tuple[str | None, str | None, str | None, str | None]:
    """把模型给的一二级名对到当前库分类树；对不上也保留建议名，供用户确认后新增。"""
    primary_name = _normalize_name(primary_raw) or None
    secondary_name = _normalize_name(secondary_raw) or None
    primary_key = _match_key(primary_raw)
    secondary_key = _match_key(secondary_raw)
    if not primary_key and not secondary_key:
        return None, None, None, None
    nodes = list(
        db.scalars(select(LibraryTaxonomyNode).where(LibraryTaxonomyNode.library_id == library_id)).all()
    )
    roots = [n for n in nodes if n.parent_id is None]
    children = [n for n in nodes if n.parent_id is not None]
    primary_id: str | None = None
    secondary_id: str | None = None
    if secondary_key:
        hits: list[tuple[LibraryTaxonomyNode, LibraryTaxonomyNode | None]] = []
        for child in children:
            if not _taxonomy_name_matches(child.name, secondary_raw):
                continue
            parent = next((r for r in roots if r.id == child.parent_id), None)
            hits.append((child, parent))
        preferred = next(
            (
                (child, parent)
                for child, parent in hits
                if parent is not None and primary_key and _taxonomy_name_matches(parent.name, primary_raw)
            ),
            hits[0] if hits else None,
        )
        if preferred is not None:
            child, parent = preferred
            secondary_id = str(child.id)
            secondary_name = child.name
            if parent is not None:
                primary_id = str(parent.id)
                primary_name = parent.name
    if primary_id is None and primary_key:
        for root in roots:
            if _taxonomy_name_matches(root.name, primary_raw):
                primary_id = str(root.id)
                primary_name = root.name
                break
    # 模型已给新一级名则保留，供页面「新增一级」；只有完全没给一级时才推断
    if secondary_name and primary_id is None and not primary_name:
        inferred_id, inferred_name = _infer_primary_for_secondary(roots, children, secondary_name)
        primary_id = inferred_id
        primary_name = inferred_name
    return primary_id, secondary_id, primary_name, secondary_name


def enrich_ai_analysis_taxonomy(db: Session, library_id: UUID, analysis: dict | None) -> dict | None:
    """列表展示时按当前分类树补全一级；已落库的旧建议往往只有二级名。"""
    if not isinstance(analysis, dict) or not is_personal_video_library(library_id):
        return analysis
    if str(analysis.get("status") or "") not in {"ready", "applied"}:
        return analysis
    primary_id, secondary_id, primary_name, secondary_name = _resolve_taxonomy_suggestion(
        db,
        library_id,
        analysis.get("primary_taxonomy_name") or analysis.get("primary_taxonomy"),
        analysis.get("secondary_taxonomy_name") or analysis.get("secondary_taxonomy"),
    )
    stored_secondary_id = str(analysis.get("secondary_taxonomy_id") or "").strip()
    if stored_secondary_id and not secondary_id:
        try:
            node = db.get(LibraryTaxonomyNode, UUID(stored_secondary_id))
        except (TypeError, ValueError):
            node = None
        if node is not None and node.library_id == library_id and node.parent_id is not None:
            parent = db.get(LibraryTaxonomyNode, node.parent_id)
            secondary_id = str(node.id)
            secondary_name = node.name
            if parent is not None:
                primary_id = str(parent.id)
                primary_name = parent.name
    if not primary_id and not primary_name and not secondary_id and not secondary_name:
        return analysis
    out = dict(analysis)
    if primary_id:
        out["primary_taxonomy_id"] = primary_id
    if primary_name:
        out["primary_taxonomy_name"] = primary_name
    if secondary_id:
        out["secondary_taxonomy_id"] = secondary_id
    if secondary_name:
        out["secondary_taxonomy_name"] = secondary_name
    return out


def store_content_analysis_result(db: Session, material_file: MaterialFile, result_map: dict) -> None:
    """把文件机返回的原始建议映射到当前库标签与分类树；未命中的主题/分类名保留给用户确认后新增。"""
    raw = result_map.get("analysis")
    analysis = raw if isinstance(raw, dict) else result_map
    thumb = str(result_map.get("thumbnail_path") or "").strip()
    if thumb:
        meta = dict(material_file.extra_metadata or {})
        meta["thumbnail_path"] = thumb
        material_file.extra_metadata = meta
    material = db.get(Material, material_file.material_id)
    if material is None:
        return
    prev = read_analysis(material_file) or {}
    auto_apply = bool(prev.get("auto_apply"))
    requested_by = str(prev.get("requested_by") or "").strip()
    library_id = material.library_id
    personal_video = is_personal_video_library(library_id)

    tag_by_key = {_match_key(t.name): t for t in _suggestable_tags(db, library_id)}
    matched_ids: list[str] = []
    matched_names: list[str] = []
    unmatched: list[str] = []
    seen: set[str] = set()
    for item in analysis.get("tags") or []:
        key = _match_key(item)
        if not key or key in seen:
            continue
        seen.add(key)
        tag = tag_by_key.get(key)
        if tag is None:
            unmatched.append(_normalize_name(item))
            continue
        matched_ids.append(str(tag.id))
        matched_names.append(tag.name)

    primary_id: str | None = None
    secondary_id: str | None = None
    primary_name: str | None = None
    secondary_name: str | None = None
    if personal_video:
        primary_id, secondary_id, primary_name, secondary_name = _resolve_taxonomy_suggestion(
            db,
            library_id,
            analysis.get("primary_taxonomy") or analysis.get("primary_taxonomy_name"),
            analysis.get("secondary_taxonomy") or analysis.get("secondary_taxonomy_name"),
        )
        if not primary_name or not secondary_name:
            raise HTTPException(status_code=400, detail="识别结果缺少两级分类，不能落库")
        keywords = normalize_keywords(analysis.get("keywords"))
        copy_fit = normalize_copy_fit(analysis.get("copy_fit"))
        if len(keywords) < 3:
            raise HTTPException(status_code=400, detail="识别结果缺少关键词，不能落库")
        if not copy_fit:
            raise HTTPException(status_code=400, detail="识别结果缺少承接句意，不能落库")
    else:
        keywords = []
        copy_fit = None

    _write_analysis(
        material_file,
        {
            "status": "ready",
            "library_code": library_code_for_id(library_id),
            "description": _normalize_name(analysis.get("description")) or None,
            "tag_ids": matched_ids,
            "tags": matched_names,
            "unmatched_tags": unmatched,
            "keywords": keywords,
            "copy_fit": copy_fit,
            "primary_taxonomy_id": primary_id,
            "primary_taxonomy_name": primary_name,
            "secondary_taxonomy_id": secondary_id,
            "secondary_taxonomy_name": secondary_name,
            "model": _normalize_name(analysis.get("model")) or None,
            "frames": analysis.get("frames") if isinstance(analysis.get("frames"), int) else None,
            "analyzed_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "auto_apply": auto_apply,
            "requested_by": requested_by or None,
            "step": "done",
            "step_label": "识别完成",
            "percent": 100,
            "error": None,
        },
    )
    if auto_apply and requested_by:
        apply_content_analysis_suggestions(
            db,
            username=requested_by,
            asset_ids=[str(material.id)],
            library_id=library_id,
            auto_create=True,
        )


def mark_content_analysis_failed(db: Session, material_file: MaterialFile, error_message: str) -> None:
    _write_analysis(
        material_file,
        {
            **(read_analysis(material_file) or {}),
            "status": "failed",
            "error": (error_message or "识别失败")[:500],
            "step": "failed",
            "step_label": "识别失败",
            "percent": 100,
            "analyzed_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        },
    )


def _ensure_theme_tag(db: Session, *, library_id: UUID, library_code: str, name: str, perms: set[str] | list[str]) -> Tag:
    cleaned = _normalize_name(name)
    if not cleaned:
        raise HTTPException(status_code=400, detail="空标签名无法自动新增")
    existing = db.scalar(select(Tag).where(Tag.library_id == library_id, Tag.name == cleaned))
    if existing is not None:
        if existing.status != "active":
            raise HTTPException(status_code=400, detail=f"标签「{cleaned}」待审，无法自动采纳")
        return existing
    if "tag.create" not in perms:
        raise HTTPException(status_code=403, detail=f"自动新增适用主题需要 tag.create：{cleaned}")
    tag = Tag(
        library_id=library_id,
        name=cleaned[:64],
        category=THEME_TAG_CATEGORY,
        description="AI内容识别自动新增",
        status="active",
        synonyms=[],
        sort_order=next_sort_order_for_category(
            db, THEME_TAG_CATEGORY, library_id=library_id, library_code=library_code
        ),
    )
    db.add(tag)
    db.flush()
    return tag


def _ensure_taxonomy_node(
    db: Session, *, library_id: UUID, name: str, parent_id: UUID | None, perms: set[str] | list[str]
) -> LibraryTaxonomyNode:
    cleaned = _normalize_name(name)[:64]
    if not cleaned:
        raise HTTPException(status_code=400, detail="空分类名无法自动新增")
    existing = db.scalar(
        select(LibraryTaxonomyNode).where(
            LibraryTaxonomyNode.library_id == library_id,
            LibraryTaxonomyNode.name == cleaned,
            LibraryTaxonomyNode.parent_id == parent_id if parent_id is not None else LibraryTaxonomyNode.parent_id.is_(None),
        )
    )
    if existing is not None:
        return existing
    if "tag.create" not in perms:
        raise HTTPException(status_code=403, detail=f"自动新增分类需要 tag.create：{cleaned}")
    mx = db.scalar(
        select(func.max(LibraryTaxonomyNode.sort_order)).where(
            LibraryTaxonomyNode.library_id == library_id,
            LibraryTaxonomyNode.parent_id == parent_id if parent_id is not None else LibraryTaxonomyNode.parent_id.is_(None),
        )
    )
    node = LibraryTaxonomyNode(
        library_id=library_id,
        parent_id=parent_id,
        name=cleaned,
        description="AI内容识别自动新增",
        sort_order=int(mx or 0) + 10,
    )
    db.add(node)
    db.flush()
    return node


def apply_content_analysis_suggestions(
    db: Session,
    *,
    username: str,
    asset_ids: list[str],
    library_id: UUID,
    auto_create: bool = False,
) -> tuple[int, int, list[dict]]:
    """逐素材采纳各自建议：替换为建议标签（等价移除「未整理」）并写入描述等字段。"""
    perms = get_user_permissions(db, username)
    _ensure_edit_permission(perms)
    personal_video = is_personal_video_library(library_id)
    library_code = library_code_for_id(library_id)
    success_count = 0
    failed_items: list[dict] = []
    for asset_id in asset_ids:
        try:
            material = get_material(db, asset_id, only_available=False)
            if material.library_id != library_id:
                raise HTTPException(status_code=400, detail="素材不属于当前素材库")
            if not _can_edit(perms, material, username):
                raise HTTPException(status_code=403, detail="No edit permission for material")
            primary = _primary_file(db, material.id)
            analysis = enrich_ai_analysis_taxonomy(db, library_id, read_analysis(primary))
            if analysis is None or str(analysis.get("status") or "") != "ready":
                raise HTTPException(status_code=400, detail="尚无可采纳的识别建议")
            tag_ids = [str(x) for x in (analysis.get("tag_ids") or [])]
            if auto_create and personal_video:
                for name in analysis.get("unmatched_tags") or []:
                    tag = _ensure_theme_tag(
                        db, library_id=library_id, library_code=library_code, name=str(name), perms=perms
                    )
                    if str(tag.id) not in tag_ids:
                        tag_ids.append(str(tag.id))
            if not tag_ids:
                raise HTTPException(status_code=400, detail="建议标签均不在当前库标签中，请人工选择")
            tags = list(db.scalars(select(Tag).where(Tag.id.in_([UUID(t) for t in tag_ids]))).all())
            if len(tags) != len(tag_ids) or any(t.library_id != library_id for t in tags):
                raise HTTPException(status_code=400, detail="建议标签已失效，请重新识别")
            if personal_video:
                secondary_id = analysis.get("secondary_taxonomy_id")
                if auto_create and not secondary_id:
                    primary_name = _normalize_name(analysis.get("primary_taxonomy_name"))
                    secondary_name = _normalize_name(analysis.get("secondary_taxonomy_name"))
                    if not secondary_name:
                        raise HTTPException(status_code=400, detail="建议未给出二级分类，无法自动整理")
                    parent = None
                    stored_primary_id = str(analysis.get("primary_taxonomy_id") or "").strip()
                    if stored_primary_id:
                        parent = db.get(LibraryTaxonomyNode, UUID(stored_primary_id))
                    if parent is None and primary_name:
                        parent = _ensure_taxonomy_node(
                            db, library_id=library_id, name=primary_name, parent_id=None, perms=perms
                        )
                    if parent is None:
                        raise HTTPException(status_code=400, detail="建议缺少一级分类，无法自动新增二级")
                    child = _ensure_taxonomy_node(
                        db, library_id=library_id, name=secondary_name, parent_id=parent.id, perms=perms
                    )
                    secondary_id = str(child.id)
                if not secondary_id:
                    raise HTTPException(status_code=400, detail="建议未命中二级分类，请人工选择")
                secondary = db.get(LibraryTaxonomyNode, UUID(str(secondary_id)))
                if secondary is None or secondary.library_id != library_id or secondary.parent_id is None:
                    raise HTTPException(status_code=400, detail="建议的二级分类已失效")
                material.primary_taxonomy_id = secondary.parent_id
                material.secondary_taxonomy_id = secondary.id
                material.keywords = normalize_keywords(analysis.get("keywords"), required_min=1)
                material.copy_fit = normalize_copy_fit(analysis.get("copy_fit"), required=True)
            description = _normalize_name(analysis.get("description"))
            if description:
                material.description = description
            db.query(MaterialTag).filter(MaterialTag.material_id == material.id).delete(synchronize_session=False)
            for tag in tags:
                db.add(MaterialTag(material_id=material.id, tag_id=tag.id))
            if primary is not None:
                _write_analysis(primary, {**analysis, "status": "applied", "applied_by": username, "auto_applied": auto_create})
            success_count += 1
        except HTTPException as exc:
            failed_items.append({"asset_id": asset_id, "reason": str(exc.detail)})
        except Exception as exc:  # noqa: BLE001
            failed_items.append({"asset_id": asset_id, "reason": str(exc)})
    if auto_create:
        record_operation_log(
            db,
            username=username,
            operation_type="unorganized.auto_apply_ai_suggestions",
            target_type="material",
            target_name="batch",
            after_data={
                "asset_ids": asset_ids,
                "success_count": success_count,
                "failed_count": len(failed_items),
                "failed_items": failed_items,
            },
        )
    db.commit()
    return success_count, len(failed_items), failed_items


__all__ = [
    "ANALYSIS_METADATA_KEY",
    "ANALYZE_CONTENT_JOB_TYPE",
    "apply_content_analysis_suggestions",
    "enqueue_content_analysis",
    "mark_content_analysis_failed",
    "read_analysis",
    "enrich_ai_analysis_taxonomy",
    "store_content_analysis_result",
    "update_content_analysis_progress",
]
