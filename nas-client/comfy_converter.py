# -*- coding: utf-8 -*-
"""Convert a ComfyUI UI workflow JSON into an API prompt graph.

Vendored from the whiteboard studio (lip_sync_web/converter.py) so the
file-machine worker can submit the same MiniMax H3 graphs.
"""

from __future__ import annotations

import copy
import json
from typing import Any

VIRTUAL_TYPES = {
    "Note",
    "MarkdownNote",
    "Reroute",
    "SetNode",
    "GetNode",
    "Label (rgthree)",
    "Bookmark (rgthree)",
    "Fast Groups Muter (rgthree)",
    "Note Plus (mtb)",
}

WIDGET_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN"}
MUTED = 2
BYPASS = 4
ALWAYS = 0


def _spec_kind(spec: Any) -> str:
    t = spec[0] if isinstance(spec, (list, tuple)) else spec
    extra = spec[1] if isinstance(spec, (list, tuple)) and len(spec) > 1 and isinstance(spec[1], dict) else {}
    if isinstance(t, list):
        return "COMBO"
    if isinstance(t, str) and ("COMBO" in t.upper() or extra.get("options") or extra.get("multiselect") is not None):
        return "COMBO"
    if t in WIDGET_TYPES:
        return "WIDGET"
    return "SOCKET"


CONTROL_AFTER = {"fixed", "increment", "decrement", "randomize"}


def normalize_widget_value(value: Any) -> Any:
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, (int, float, bool, str)) or first is None:
            if len(value) >= 2 and (
                value[1] in ("fixed", "increment", "decrement", "randomize", True, False) or value[1] is None
            ):
                return first
            if len(value) == 2 and isinstance(value[1], bool):
                return first
    return value


def apply_list_widgets(inputs: dict, names: list[str], values: list, linked_names: set) -> None:
    i = 0
    vals = list(values)
    for name in names:
        if i >= len(vals):
            break
        val = vals[i]
        i += 1
        if i < len(vals) and isinstance(vals[i], str) and vals[i] in CONTROL_AFTER:
            i += 1
        if name in linked_names or val is None:
            continue
        inputs[name] = normalize_widget_value(val)


def widget_input_names(info: dict) -> list[str]:
    names: list[str] = []
    inp = info.get("input") or {}
    for section in ("required", "optional"):
        block = inp.get(section) or {}
        for name, spec in block.items():
            kind = _spec_kind(spec)
            extra = spec[1] if isinstance(spec, (list, tuple)) and len(spec) > 1 and isinstance(spec[1], dict) else {}
            if kind in ("WIDGET", "COMBO") or extra.get("image_upload") or extra.get("audio_upload") or extra.get("video_upload"):
                names.append(name)
    return names


def node_widget_names(node: dict, info: dict) -> list[str]:
    names: list[str] = []
    for inp in node.get("inputs") or []:
        widget = inp.get("widget")
        if not widget:
            continue
        name = str((widget.get("name") if isinstance(widget, dict) else None) or inp.get("name") or "")
        if name:
            names.append(name)
    return names or widget_input_names(info)


def _in_group(node: dict, group: dict) -> bool:
    x, y = node["pos"][0], node["pos"][1]
    gx, gy, gw, gh = group["bounding"]
    return gx <= x <= gx + gw and gy <= y <= gy + gh


def apply_mode(workflow: dict, mode: str) -> None:
    """Image mode mutes cyan video group; video mode unmutes it."""
    groups = {g["id"]: g for g in workflow.get("groups") or []}
    video_g = groups.get(18)
    if not video_g:
        for g in workflow.get("groups") or []:
            if "视频对口型" in g.get("title", ""):
                video_g = g
                break
    video_mode = mode == "video"
    for node in workflow["nodes"]:
        ntype = node.get("type")
        if video_g and _in_group(node, video_g):
            node["mode"] = ALWAYS if video_mode else MUTED
        if ntype == "VHS_LoadVideo":
            node["mode"] = ALWAYS if video_mode else MUTED
        if ntype == "LoadImage" and video_mode:
            # Keep image loader only for image mode; video path uses LoadVideo.
            node["mode"] = MUTED


def apply_job_params(workflow: dict, params: dict) -> None:
    fps = int(params["fps"])
    frames = int(params["frames"])
    max_res = int(params["max_res"])
    prompt = params.get("prompt") or ""
    seed = int(params.get("seed") or 0)
    image_name = params.get("image_name")
    audio_name = params.get("audio_name")
    video_name = params.get("video_name")
    filename = params.get("filename") or "webjob"

    for node in workflow["nodes"]:
        ntype = node.get("type")
        nid = node.get("id")
        title = node.get("title") or ""
        wv = node.get("widgets_values")

        if nid == 159 or title == "生成时长（帧）":
            node["widgets_values"] = [frames]
        elif nid == 72 or title == "限制分辨率":
            node["widgets_values"] = [max_res]
        elif ntype == "LoadImage" and image_name:
            vals = list(wv or ["", "image"])
            vals[0] = image_name
            if len(vals) < 2:
                vals.append("image")
            node["widgets_values"] = vals
        elif ntype == "LoadAudio" and audio_name:
            vals = list(wv or [audio_name, None, None])
            vals[0] = audio_name
            node["widgets_values"] = vals
        elif ntype == "VHS_LoadVideo":
            # Input decoding and final encoding must use the same FPS or the
            # video-mode result drifts away from the audio.
            if isinstance(wv, dict):
                values = dict(wv)
                if video_name:
                    values["video"] = video_name
                values["force_rate"] = fps
                preview = dict(values.get("videopreview") or {})
                preview_params = dict(preview.get("params") or {})
                preview_params["force_rate"] = fps
                if video_name:
                    preview_params["filename"] = video_name
                preview["params"] = preview_params
                values["videopreview"] = preview
                node["widgets_values"] = values
            elif isinstance(wv, list):
                values = list(wv)
                # Current VHS list workflows store video first and force_rate second.
                if video_name and values:
                    values[0] = video_name
                if len(values) > 1:
                    values[1] = fps
                node["widgets_values"] = values
        elif ntype == "VHS_VideoCombine":
            # This is also required in image mode: generated IMAGE frames are
            # turned into the final mp4 here. Setting only frame generation is
            # not enough and causes audio/video duration mismatch.
            if isinstance(wv, dict):
                values = dict(wv)
                values["frame_rate"] = fps
                preview = dict(values.get("videopreview") or {})
                preview_params = dict(preview.get("params") or {})
                preview_params["frame_rate"] = fps
                preview["params"] = preview_params
                values["videopreview"] = preview
                node["widgets_values"] = values
            elif isinstance(wv, list):
                values = list(wv)
                if values:
                    values[0] = fps
                node["widgets_values"] = values
        elif ntype == "PrimitiveStringMultiline" and title == "提示词":
            node["widgets_values"] = [prompt]
        elif ntype == "easy seed":
            vals = list(wv or [seed, "fixed", None])
            vals[0] = seed
            vals[1] = "fixed"
            node["widgets_values"] = vals
        elif ntype == "PrimitiveString" and (nid == 86 or "图片的名称" in title):
            node["widgets_values"] = [filename]


def _as_link(link: Any) -> list:
    if isinstance(link, dict):
        return [
            int(link["id"]),
            int(link["origin_id"]),
            int(link["origin_slot"]),
            int(link["target_id"]),
            int(link["target_slot"]),
            link.get("type"),
        ]
    return [
        int(link[0]),
        int(link[1]),
        int(link[2]),
        int(link[3]),
        int(link[4]),
        link[5] if len(link) > 5 else None,
    ]


def _subgraph_defs(workflow: dict) -> dict[str, dict]:
    raw = (workflow.get("definitions") or {}).get("subgraphs") or []
    if isinstance(raw, dict):
        return {str(key): value for key, value in raw.items() if isinstance(value, dict)}
    return {str(item.get("id")): item for item in raw if isinstance(item, dict) and item.get("id")}


def _widget_map(node: dict) -> dict[str, Any]:
    values = list(node.get("widgets_values") or [])
    mapping: dict[str, Any] = {}
    index = 0
    for inp in node.get("inputs") or []:
        if not inp.get("widget"):
            continue
        if index < len(values):
            mapping[str(inp.get("name") or "")] = values[index]
        index += 1
    return mapping


def _set_slot_widget(node: dict, slot: int, value: Any) -> None:
    inputs = node.get("inputs") or []
    if slot < 0 or slot >= len(inputs):
        return
    inp = inputs[slot]
    widget_inputs = [item for item in inputs if item.get("widget")]
    names = [str((item.get("widget") or {}).get("name") or item.get("name") or "") for item in widget_inputs]
    widget_name = str((inp.get("widget") or {}).get("name") or inp.get("name") or "")
    values = list(node.get("widgets_values") or [])
    if widget_name in names:
        index = names.index(widget_name)
        while len(values) <= index:
            values.append(None)
        values[index] = value
        node["widgets_values"] = values
        return
    if not values:
        node["widgets_values"] = [value]
        return
    values[0] = value
    node["widgets_values"] = values


def _sync_input_links(nodes: list[dict], links: list[list]) -> None:
    by_target: dict[tuple[int, int], int] = {}
    for item in links:
        by_target[(int(item[3]), int(item[4]))] = int(item[0])
    for node in nodes:
        for slot, inp in enumerate(node.get("inputs") or []):
            inp["link"] = by_target.get((int(node["id"]), slot))


def _next_ids(nodes: list[dict], links: list[list]) -> tuple[int, int]:
    node_id = max((int(node["id"]) for node in nodes), default=0)
    link_id = max((int(item[0]) for item in links), default=0)
    return node_id, link_id


def expand_subgraphs(workflow: dict) -> dict:
    """Inline ComfyUI subgraph nodes so graph_to_prompt can emit an API prompt."""
    workflow = copy.deepcopy(workflow)
    defs = _subgraph_defs(workflow)
    nodes = list(workflow.get("nodes") or [])
    links = [_as_link(item) for item in workflow.get("links") or []]
    if not defs:
        workflow["links"] = links
        _sync_input_links(nodes, links)
        workflow["nodes"] = nodes
        return workflow

    next_node_id, next_link_id = _next_ids(nodes, links)
    kept_nodes: list[dict] = []
    extra_links: list[list] = []
    removed: set[int] = set()

    for node in nodes:
        ntype = str(node.get("type") or "")
        if ntype not in defs:
            kept_nodes.append(node)
            continue
        subgraph = defs[ntype]
        parent_id = int(node["id"])
        removed.add(parent_id)
        id_map: dict[int, int] = {}
        for inner in subgraph.get("nodes") or []:
            next_node_id += 1
            cloned = copy.deepcopy(inner)
            old_id = int(inner["id"])
            cloned["id"] = next_node_id
            id_map[old_id] = next_node_id
            kept_nodes.append(cloned)

        widgets = _widget_map(node)
        incoming: dict[int, tuple[int, int, Any]] = {}
        outgoing: list[list] = []
        for item in links:
            if int(item[3]) == parent_id:
                incoming[int(item[4])] = (int(item[1]), int(item[2]), item[5])
            if int(item[1]) == parent_id:
                outgoing.append(item)

        inner_links = [_as_link(item) for item in subgraph.get("links") or []]
        sg_inputs = subgraph.get("inputs") or []
        for item in inner_links:
            origin_id, origin_slot = int(item[1]), int(item[2])
            target_id, target_slot = int(item[3]), int(item[4])
            link_type = item[5]
            if origin_id == -10:
                mapped_target = id_map.get(target_id)
                if mapped_target is None:
                    continue
                if origin_slot in incoming:
                    src_id, src_slot, src_type = incoming[origin_slot]
                    next_link_id += 1
                    extra_links.append([next_link_id, src_id, src_slot, mapped_target, target_slot, src_type or link_type])
                else:
                    input_name = str(sg_inputs[origin_slot].get("name") or "") if origin_slot < len(sg_inputs) else ""
                    if input_name in widgets:
                        inner_node = next(n for n in kept_nodes if int(n["id"]) == mapped_target)
                        _set_slot_widget(inner_node, target_slot, widgets[input_name])
                        if inner_node.get("type") == "RandomNoise":
                            values = list(inner_node.get("widgets_values") or [widgets[input_name], "fixed"])
                            values[0] = widgets[input_name]
                            if len(values) < 2:
                                values.append("fixed")
                            values[1] = "fixed"
                            inner_node["widgets_values"] = values
                continue
            if target_id == -20:
                continue
            if origin_id not in id_map or target_id not in id_map:
                continue
            next_link_id += 1
            extra_links.append([next_link_id, id_map[origin_id], origin_slot, id_map[target_id], target_slot, link_type])

        for out_index, _output in enumerate(subgraph.get("outputs") or []):
            inner_origin = None
            inner_slot = 0
            inner_type = None
            for item in inner_links:
                if int(item[3]) == -20 and int(item[4]) == out_index:
                    inner_origin = id_map.get(int(item[1]))
                    inner_slot = int(item[2])
                    inner_type = item[5]
                    break
            if inner_origin is None:
                continue
            for item in outgoing:
                if int(item[2]) != out_index:
                    continue
                next_link_id += 1
                extra_links.append([next_link_id, inner_origin, inner_slot, int(item[3]), int(item[4]), item[5] or inner_type])

    kept_links = [item for item in links if int(item[1]) not in removed and int(item[3]) not in removed]
    kept_links.extend(extra_links)
    _sync_input_links(kept_nodes, kept_links)
    workflow["nodes"] = kept_nodes
    workflow["links"] = kept_links
    return workflow


def _set_load_image(node: dict, filename: str) -> None:
    values = list(node.get("widgets_values") or ["", "image"])
    if not values:
        values = [filename, "image"]
    else:
        values[0] = filename
        if len(values) < 2:
            values.append("image")
    node["mode"] = ALWAYS
    node["widgets_values"] = values


def _add_load_image(workflow: dict, filename: str) -> int:
    next_node_id, _unused_link_id = _next_ids(workflow.get("nodes") or [], [_as_link(item) for item in workflow.get("links") or []])
    node_id = next_node_id + 1
    workflow.setdefault("nodes", []).append(
        {
            "id": node_id,
            "type": "LoadImage",
            "mode": ALWAYS,
            "inputs": [
                {"name": "image", "type": "COMBO", "widget": {"name": "image"}, "link": None},
                {"name": "upload", "type": "IMAGEUPLOAD", "widget": {"name": "upload"}, "link": None},
            ],
            "outputs": [
                {"name": "IMAGE", "type": "IMAGE", "links": []},
                {"name": "MASK", "type": "MASK", "links": None},
            ],
            "widgets_values": [filename, "image"],
        }
    )
    return node_id


def _connect_nodes(workflow: dict, origin_id: int, origin_slot: int, target_id: int, target_slot: int, link_type: str) -> None:
    links = [_as_link(item) for item in workflow.get("links") or []]
    next_link_id = max((int(item[0]) for item in links), default=0) + 1
    links = [item for item in links if not (int(item[3]) == int(target_id) and int(item[4]) == int(target_slot))]
    links.append([next_link_id, int(origin_id), int(origin_slot), int(target_id), int(target_slot), link_type])
    workflow["links"] = links
    _sync_input_links(workflow.get("nodes") or [], links)


def _node_by_id(workflow: dict) -> dict[int, dict]:
    return {int(node["id"]): node for node in workflow.get("nodes") or []}


def _link_by_id(workflow: dict) -> dict[int, list]:
    found: dict[int, list] = {}
    for item in workflow.get("links") or []:
        link = _as_link(item)
        found[int(link[0])] = link
    return found


def _set_node_source(workflow: dict, set_node: dict) -> dict | None:
    inputs = set_node.get("inputs") or []
    link_id = inputs[0].get("link") if inputs else None
    if link_id is None:
        return None
    link = _link_by_id(workflow).get(int(link_id))
    if not link:
        return None
    return _node_by_id(workflow).get(int(link[1]))


def _enable_slot(set_node: dict, source: dict | None, enabled: bool) -> None:
    mode = ALWAYS if enabled else BYPASS
    set_node["mode"] = mode
    if source is not None:
        source["mode"] = mode


# Same labels as ComfyUI-Easy-Use ResolutionSelector (nodes_resolution.py).
_ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    "1:1 (Square)": (1, 1),
    "2:3 (Portrait Photo)": (2, 3),
    "3:2 (Photo)": (3, 2),
    "3:4 (Portrait Standard)": (3, 4),
    "4:3 (Standard)": (4, 3),
    "9:16 (Portrait Widescreen)": (9, 16),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}


def _deoil_strength(value: object) -> float | None:
    """Face workflow node 400 LoRA strength. Empty leaves the graph's baked value."""
    if value is None or str(value).strip() == "":
        return None
    try:
        return max(0.0, min(1.0, round(float(value), 2)))
    except (TypeError, ValueError):
        return None


def _quality_megapixels(quality: str) -> float | None:
    """480→0.4, 720→0.9, 1080→2.0. Empty means keep the workflow's baked value."""
    raw = str(quality or "").strip().lower().replace("p", "")
    if not raw.isdigit():
        return None
    tier = int(raw)
    if tier >= 1080:
        return 2.0
    if tier <= 480:
        return 0.4
    return 0.9


def _js_round(value: float) -> int:
    return int(value + 0.5) if value >= 0 else int(value - 0.5)


def _selector_dimensions(aspect: str, megapixels: float, multiple: int = 32) -> tuple[int, int]:
    width_ratio, height_ratio = _ASPECT_RATIOS.get(aspect, (16, 9))
    total = max(0.1, float(megapixels)) * 1024 * 1024
    scale = (total / (width_ratio * height_ratio)) ** 0.5
    width = max(multiple, _js_round((width_ratio * scale) / multiple) * multiple)
    height = max(multiple, _js_round((height_ratio * scale) / multiple) * multiple)
    return width, height


def _short_edge_size(aspect: str, megapixels: float) -> tuple[int, int]:
    """Short side follows the clarity tier: 480 / 720 / 1080."""
    if megapixels >= 1.5:
        short = 1080
    elif megapixels <= 0.5:
        short = 480
    else:
        short = 720
    width_ratio, height_ratio = _ASPECT_RATIOS.get(aspect, (16, 9))
    if width_ratio >= height_ratio:
        width = max(2, _js_round(short * width_ratio / height_ratio / 2) * 2)
        height = short
    else:
        width = short
        height = max(2, _js_round(short * height_ratio / width_ratio / 2) * 2)
    return width, height


def _ensure_output_crop(workflow: dict) -> None:
    """Goldfish has no ImageCrop. Insert one between the decode and the video save."""
    nodes = workflow.setdefault("nodes", [])
    if any(node.get("type") == "ImageCrop" for node in nodes):
        return
    vhs = next((node for node in nodes if node.get("type") == "VHS_VideoCombine"), None)
    if not isinstance(vhs, dict):
        return
    images_slot = next(
        (index for index, item in enumerate(vhs.get("inputs") or []) if item.get("name") == "images"),
        None,
    )
    if images_slot is None:
        return
    images = vhs["inputs"][images_slot]
    if images.get("link") is None:
        return
    links = [_as_link(item) for item in workflow.get("links") or []]
    incoming = next((item for item in links if int(item[0]) == int(images["link"])), None)
    if not incoming:
        return
    crop_id = max((int(node["id"]) for node in nodes), default=0) + 1
    save_link_id = max((int(item[0]) for item in links), default=0) + 1
    incoming[3] = crop_id
    incoming[4] = 0
    links.append([save_link_id, crop_id, 0, int(vhs["id"]), images_slot, "IMAGE"])
    nodes.append(
        {
            "id": crop_id,
            "type": "ImageCrop",
            "pos": [0, 0],
            "size": [310, 174],
            "flags": {},
            "order": 0,
            "mode": ALWAYS,
            "inputs": [
                {"name": "image", "type": "IMAGE", "link": None},
                {"name": "width", "type": "INT", "widget": {"name": "width"}, "link": None},
                {"name": "height", "type": "INT", "widget": {"name": "height"}, "link": None},
                {"name": "x", "type": "INT", "widget": {"name": "x"}, "link": None},
                {"name": "y", "type": "INT", "widget": {"name": "y"}, "link": None},
            ],
            "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [save_link_id]}],
            "properties": {"Node name for S&R": "ImageCrop"},
            "widgets_values": [1280, 720, 0, 0],
        }
    )
    workflow["links"] = links
    workflow["last_node_id"] = crop_id
    workflow["last_link_id"] = save_link_id
    _sync_input_links(nodes, links)


def _apply_output_crop(node: dict, aspect: str, megapixels: float) -> None:
    generated_w, generated_h = _selector_dimensions(aspect, megapixels)
    crop_w, crop_h = _short_edge_size(aspect, megapixels)
    crop_w = min(crop_w, generated_w)
    crop_h = min(crop_h, generated_h)
    origin_x = max(0, (generated_w - crop_w) // 2)
    origin_y = max(0, (generated_h - crop_h) // 2)
    node["widgets_values"] = [crop_w, crop_h, origin_x, origin_y]
    named = node.get("widgets_values_named")
    if isinstance(named, dict):
        named = dict(named)
        named.update({"width": crop_w, "height": crop_h, "x": origin_x, "y": origin_y})
        node["widgets_values_named"] = named


def apply_studio_h3_params(workflow: dict, params: dict) -> None:
    """Fill the 8189 MiniMax H3 reference workflows (人脸优化 / YZ金鱼).

    Unused 图像 / 参考视频 / 参考音频 slots stay bypassed, so the sample files
    saved in the graph are not submitted.
    """
    prompt = str(params.get("prompt") or "")
    duration = float(params.get("duration") or 5)
    aspect = str(params.get("aspect") or "16:9 (Widescreen)")
    quality_mp = _quality_megapixels(str(params.get("quality") or ""))
    images = [name for name in (params.get("image_names") or []) if name]
    videos = [name for name in (params.get("video_names") or []) if name]
    audios = [name for name in (params.get("audio_names") or []) if name]
    seed = params.get("seed")
    deoil = _deoil_strength(params.get("deoil"))

    for node in workflow.get("nodes") or []:
        ntype = node.get("type")
        title = str(node.get("title") or "")
        if ntype == "Text":
            node["widgets_values"] = [prompt]
        elif ntype == "PrimitiveFloat" and "时长" in title:
            node["widgets_values"] = [max(1.0, min(15.0, duration))]
        elif ntype == "ResolutionSelector":
            values = list(node.get("widgets_values") or [])
            while len(values) < 3:
                values.append(32 if len(values) == 2 else 0.9)
            values[0] = aspect
            if quality_mp is not None:
                values[1] = quality_mp
            node["widgets_values"] = values
        elif ntype == "LoraLoaderModelOnly" and int(node.get("id") or -1) == 400 and deoil is not None:
            values = list(node.get("widgets_values") or [])
            lora_name = str(values[0] if values else "")
            if "Mystic" in lora_name:
                while len(values) < 2:
                    values.append(deoil)
                values[1] = deoil
                node["widgets_values"] = values
        elif ntype == "SelfLiftH3Sampler" and seed is not None:
            values = list(node.get("widgets_values") or [])
            if values:
                values[0] = int(seed)
                if len(values) > 1:
                    values[1] = "fixed"
                node["widgets_values"] = values

    selector_mp = quality_mp
    if selector_mp is None:
        for node in workflow.get("nodes") or []:
            if node.get("type") == "ResolutionSelector":
                values = list(node.get("widgets_values") or [])
                if len(values) > 1:
                    try:
                        selector_mp = float(values[1])
                    except (TypeError, ValueError):
                        selector_mp = None
                break
    if selector_mp is None:
        selector_mp = 0.9
    _ensure_output_crop(workflow)
    for node in workflow.get("nodes") or []:
        if node.get("type") == "ImageCrop":
            _apply_output_crop(node, aspect, selector_mp)

    grouped = {"图像": images, "参考视频": videos, "参考音频": audios}
    for node in workflow.get("nodes") or []:
        if node.get("type") != "SetNode":
            continue
        label = str((node.get("widgets_values") or [""])[0])
        kind = next((prefix for prefix in grouped if label.startswith(prefix) and label[len(prefix):].isdigit()), "")
        if not kind:
            continue
        index = int(label[len(kind):])
        names = grouped[kind]
        source = _set_node_source(workflow, node)
        enabled = 1 <= index <= len(names)
        if enabled and source is not None:
            filename = names[index - 1]
            if source.get("type") == "LoadImage":
                _set_load_image(source, filename)
            elif source.get("type") == "LoadAudio":
                values = list(source.get("widgets_values") or ["", None])
                values[0] = filename
                source["widgets_values"] = values
            elif source.get("type") == "VHS_LoadVideo" and isinstance(source.get("widgets_values"), dict):
                values = dict(source["widgets_values"])
                values["video"] = filename
                preview = dict(values.get("videopreview") or {})
                preview_params = dict(preview.get("params") or {})
                preview_params["filename"] = filename
                preview["params"] = preview_params
                values["videopreview"] = preview
                source["widgets_values"] = values
        _enable_slot(node, source, enabled)


def apply_video_params(workflow: dict, params: dict) -> None:
    prompt = str(params.get("prompt") or "")
    duration = float(params.get("duration") or 5)
    aspect = str(params.get("aspect") or "16:9 (Widescreen)")
    megapixels = float(params.get("megapixels") or 0.4)
    seed = int(params.get("seed") or 0)
    images = [name for name in (params.get("image_names") or []) if name]
    last_frame = str(params.get("last_frame_name") or "")

    load_nodes = sorted(
        [node for node in workflow.get("nodes") or [] if node.get("type") == "LoadImage"],
        key=lambda node: int(node["id"]),
    )
    for index, node in enumerate(load_nodes):
        if index < len(images):
            _set_load_image(node, images[index])
        else:
            node["mode"] = MUTED

    subgraph_nodes = [
        node
        for node in workflow.get("nodes") or []
        if str(node.get("type") or "") in _subgraph_defs(workflow)
    ]
    if last_frame and subgraph_nodes:
        parent = subgraph_nodes[0]
        last_node_id = _add_load_image(workflow, last_frame)
        _connect_nodes(workflow, last_node_id, 0, int(parent["id"]), 1, "IMAGE")

    for node in workflow.get("nodes") or []:
        ntype = node.get("type")
        title = str(node.get("title") or "")
        values = list(node.get("widgets_values") or [])
        if ntype == "ResolutionSelector":
            while len(values) < 3:
                values.append(32 if len(values) == 2 else 0.4)
            values[0] = aspect
            values[1] = megapixels
            node["widgets_values"] = values
        elif ntype == "PrimitiveFloat" and ("uration" in title or title == "Float (Duration)"):
            node["widgets_values"] = [duration]
        elif ntype == "PrimitiveStringMultiline" and ("Prompt" in title or "提示词" in title):
            node["widgets_values"] = [prompt]
        elif ntype in {"MiniMaxH3ImageToVideo", "MiniMaxH3ReferenceToVideo"}:
            if values:
                values[0] = prompt
                node["widgets_values"] = values
        elif ntype in {"RandomNoise", "easy seed"}:
            while len(values) < 2:
                values.append("fixed")
            values[0] = seed
            values[1] = "fixed"
            node["widgets_values"] = values
        elif str(ntype) in _subgraph_defs(workflow):
            widget_inputs = [item for item in (node.get("inputs") or []) if item.get("widget")]
            names = [str(item.get("name") or "") for item in widget_inputs]
            while len(values) < len(names):
                values.append(None)
            for name, index in (("prompt", names.index("prompt") if "prompt" in names else -1), ("value_1", names.index("value_1") if "value_1" in names else -1), ("noise_seed", names.index("noise_seed") if "noise_seed" in names else -1)):
                if index >= 0:
                    values[index] = prompt if name == "prompt" else duration if name == "value_1" else seed
            node["widgets_values"] = values


def _index_nodes(workflow: dict) -> dict[int, dict]:
    return {int(n["id"]): n for n in workflow["nodes"]}


def _link_map(workflow: dict) -> dict[int, tuple]:
    out = {}
    for L in workflow.get("links") or []:
        item = _as_link(L)
        out[int(item[0])] = tuple(item)
    return out


def _set_nodes_by_name(nodes: dict[int, dict]) -> dict[str, dict]:
    mapping = {}
    for n in nodes.values():
        if n.get("type") == "SetNode":
            wv = n.get("widgets_values") or [""]
            mapping[str(wv[0])] = n
    return mapping


def resolve_origin(
    node_id: int,
    slot: int,
    nodes: dict[int, dict],
    links: dict[int, tuple],
    sets: dict[str, dict],
    seen: set | None = None,
) -> tuple[int, int] | None:
    seen = seen or set()
    key = (node_id, slot)
    if key in seen:
        return None
    seen.add(key)
    node = nodes.get(int(node_id))
    if not node:
        return None
    mode = int(node.get("mode") or 0)
    ntype = node.get("type")

    if mode == MUTED:
        return None

    if ntype in VIRTUAL_TYPES or mode == BYPASS:
        ins = node.get("inputs") or []
        if ntype == "GetNode":
            name = str((node.get("widgets_values") or [""])[0])
            setter = sets.get(name)
            if not setter:
                return None
            set_in = (setter.get("inputs") or [{}])[0]
            link_id = set_in.get("link")
            if link_id is None:
                return None
            L = links.get(int(link_id))
            if not L:
                return None
            return resolve_origin(int(L[1]), int(L[2]), nodes, links, sets, seen)
        # Reroute / bypass / SetNode: first connected input
        for inp in ins:
            link_id = inp.get("link")
            if link_id is None:
                continue
            L = links.get(int(link_id))
            if not L:
                continue
            resolved = resolve_origin(int(L[1]), int(L[2]), nodes, links, sets, seen)
            if resolved:
                return resolved
        return None

    return int(node_id), int(slot)


def graph_to_prompt(workflow: dict, object_info: dict) -> dict:
    workflow = expand_subgraphs(workflow)
    nodes = _index_nodes(workflow)
    links = _link_map(workflow)
    sets = _set_nodes_by_name(nodes)
    prompt: dict[str, Any] = {}

    for nid, node in nodes.items():
        ntype = node.get("type")
        mode = int(node.get("mode") or 0)
        if ntype in VIRTUAL_TYPES or mode in (MUTED, BYPASS):
            continue
        info = object_info.get(ntype)
        if not info:
            continue

        inputs: dict[str, Any] = {}
        linked_names = set()
        for inp in node.get("inputs") or []:
            name = inp.get("name")
            link_id = inp.get("link")
            if not name or link_id is None:
                continue
            L = links.get(int(link_id))
            if not L:
                continue
            resolved = resolve_origin(int(L[1]), int(L[2]), nodes, links, sets)
            if not resolved:
                continue
            src_id, src_slot = resolved
            src = nodes.get(src_id)
            if not src or src.get("type") in VIRTUAL_TYPES:
                continue
            if int(src.get("mode") or 0) in (MUTED, BYPASS):
                continue
            inputs[name] = [str(src_id), int(src_slot)]
            linked_names.add(name)

        wv = node.get("widgets_values")
        if isinstance(wv, dict):
            for k, v in wv.items():
                if k in ("videopreview", "choose video to upload"):
                    continue
                if k not in linked_names:
                    inputs[k] = v
        elif isinstance(wv, list):
            apply_list_widgets(inputs, node_widget_names(node, info), wv, linked_names)

        prompt[str(nid)] = {"class_type": ntype, "inputs": inputs}

    return prompt
