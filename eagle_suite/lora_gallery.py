# -*- coding: utf-8 -*-
"""
Eagle Suite - LoRA Gallery Node
基于 Vue Gallery 高性能架构的 LoRA 视觉加载器。
- 扫描 ComfyUI models/loras 目录
- 缩略图代理、分页、搜索、文件夹树
- 多选 LoRA + 权重滑块
- 读取 safetensors 元数据 / 触发词 / Civitai 链接
- 输出 MODEL、CLIP、已选 LoRA JSON、触发词拼接
"""

import os
import re
import json
import time
import math
import struct
import threading
import hashlib
import asyncio
import html
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

import folder_paths
import comfy.utils
import comfy.sd
import torch

from aiohttp import web
from PIL import Image, ImageOps

from .route_registry import route
from .logger import logger

try:
    import aiohttp
except Exception:
    aiohttp = None

# ── 常量 ──────────────────────────────────────────────────────────────────────
_LORA_EXT = (".safetensors", ".ckpt", ".pt", ".pth")
_PREVIEW_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
_CACHE_TTL = 120.0  # 目录缓存刷新间隔（秒）；手动刷新仍可立即生效
_PAGE_SIZE = 50
_CIVITAI_BASE = "https://civitai.red"
_THUMBNAIL_SIZE = 320
_THUMBNAIL_CACHE_MAX = 192
_PREVIEW_MAX_BYTES = 32 * 1024 * 1024
_LORA_MODEL_MAX_BYTES = 8 * 1024 * 1024 * 1024


def _path_is_within(path, root):
    try:
        return os.path.commonpath([
            os.path.realpath(path), os.path.realpath(root)
        ]) == os.path.realpath(root)
    except (ValueError, TypeError):
        return False

# ── 全局缓存 ──────────────────────────────────────────────────────────────────
_lora_scan_cache = {"data": None, "ts": 0.0, "lock": threading.Lock()}
_lora_selection_cache = {}  # node_id -> {selections: [...], weights: {...}}
_civitai_cache = {"lock": threading.Lock(), "data": {}}
_file_hash_cache = {"lock": threading.Lock(), "data": {}}
_thumbnail_cache = {"lock": threading.Lock(), "data": {}}
_preview_fail_cache = {"lock": threading.Lock(), "data": {}}


# ── 目录与扫描 ────────────────────────────────────────────────────────────────

def _get_lora_dirs() -> list:
    """返回所有 loras 目录路径（支持 folder_paths 多路径）。"""
    try:
        return folder_paths.get_folder_paths("loras")
    except Exception:
        return [os.path.join(folder_paths.models_dir, "loras")]


def _scan_loras() -> list:
    """扫描所有 loras 目录，返回统一列表（带文件夹树结构）。"""
    now = time.time()
    with _lora_scan_cache["lock"]:
        if _lora_scan_cache["data"] is not None and (now - _lora_scan_cache["ts"]) < _CACHE_TTL:
            return _lora_scan_cache["data"]

    dirs = _get_lora_dirs()
    items = []
    folders = {"_root": {"id": "_all", "name": "全部", "children": []}}
    folder_id_map = {}  # 用于去重文件夹

    for lora_dir in dirs:
        if not os.path.isdir(lora_dir):
            continue
        base_name = os.path.basename(lora_dir.rstrip("/\\")) or "loras"

        for root, _, files in os.walk(lora_dir):
            rel_root = os.path.relpath(root, lora_dir)
            is_root = rel_root in (".", "")

            # 构建文件夹树
            if not is_root:
                parent_rel = os.path.dirname(rel_root)
                parent_id = "_all" if parent_rel in (".", "") else folder_id_map.get(parent_rel)
                folder_id = f"{base_name}/{rel_root}"
                folder_id_map[rel_root] = folder_id
                if folder_id not in folders:
                    folders[folder_id] = {"id": folder_id, "name": os.path.basename(rel_root), "children": []}
                    # 挂到父级
                    if parent_id and parent_id in folders:
                        folders[parent_id]["children"].append(folders[folder_id])
                    else:
                        folders["_root"]["children"].append(folders[folder_id])

            for f in sorted(files, key=lambda x: x.lower()):
                if not f.lower().endswith(_LORA_EXT):
                    continue
                fp = os.path.join(root, f)
                rel = os.path.relpath(fp, lora_dir).replace("\\", "/")
                name_no_ext = os.path.splitext(f)[0]

                # 预览图路径（优先同目录同名图片）
                preview = ""
                for ext in _PREVIEW_EXT:
                    cand = os.path.splitext(fp)[0] + ext
                    if os.path.isfile(cand):
                        preview = cand
                        break

                # 触发词：优先 .txt，其次 civitai.info / json
                trigger_words = []
                civitai_url = ""
                civitai_id = ""
                civitai_version_id = ""

                txt_path = os.path.splitext(fp)[0] + ".txt"
                if os.path.isfile(txt_path):
                    try:
                        with open(txt_path, "r", encoding="utf-8") as tf:
                            raw = tf.read()
                            # 兼容旧版逗号分隔和新版每行一个触发词
                            sep = "\n" if "\n" in raw else ","
                            trigger_words = [t.strip() for t in raw.split(sep) if t.strip()]
                    except Exception:
                        pass

                sidecar_base = os.path.splitext(fp)[0]
                civitai_info_path = next((
                    path for path in (
                        sidecar_base + ".civitai.json",
                        sidecar_base + ".civitai.info",
                        sidecar_base + ".json",
                    ) if os.path.isfile(path)
                ), "")
                if civitai_info_path:
                    try:
                        with open(civitai_info_path, "r", encoding="utf-8") as jf:
                            info = json.load(jf)
                        if isinstance(info, dict):
                            # Eagle Suite 完整归档格式：保留完整模型与版本响应，同时提供扁平关键字段。
                            archived_civitai = info.get("civitai") if isinstance(info.get("civitai"), dict) else {}
                            archived_version = archived_civitai.get("version") if isinstance(archived_civitai.get("version"), dict) else {}
                            archived_model = archived_civitai.get("model") if isinstance(archived_civitai.get("model"), dict) else {}
                            # civitai.info 格式
                            archived_words = (
                                info.get("trainedWords")
                                or archived_version.get("trainedWords")
                                or []
                            )
                            if not trigger_words and archived_words:
                                trigger_words = [str(t).strip() for t in archived_words if str(t).strip()]
                            elif not trigger_words and "trainedTags" in info:
                                trigger_words = [str(t).strip() for t in info["trainedTags"] if str(t).strip()]
                            elif not trigger_words and isinstance(info.get("trainedWords"), list):
                                trigger_words = [str(t).strip() for t in info["trainedWords"] if str(t).strip()]
                            elif not trigger_words and "activation text" in info:
                                trigger_words = [t.strip() for t in info["activation text"].split(",") if t.strip()]
                            model_id = (
                                info.get("modelId")
                                or info.get("model_id")
                                or archived_version.get("modelId")
                                or archived_model.get("id")
                                or info.get("id")
                            )
                            if model_id:
                                civitai_id = str(model_id)
                                civitai_url = str(info.get("civitaiUrl") or f"{_CIVITAI_BASE}/models/{model_id}")
                            civitai_version_id = str(
                                info.get("modelVersionId")
                                or archived_version.get("id")
                                or (info.get("id") if info.get("modelId") else "")
                                or ""
                            )
                    except Exception:
                        pass

                folder_id = folder_id_map.get(rel_root, "_all") if not is_root else "_all"
                folder_path = "" if is_root else rel_root.replace("\\", "/")

                items.append({
                    "id": f"{base_name}/{rel}",
                    "name": name_no_ext,
                    "fileName": f,
                    "path": fp,
                    "rel": rel,
                    "dir": base_name,
                    "folderId": folder_id,
                    "folderPath": folder_path,
                    "preview": preview,
                    "triggerWords": trigger_words,
                    "civitaiId": civitai_id,
                    "civitaiVersionId": civitai_version_id,
                    "civitaiUrl": civitai_url,
                    "size": os.path.getsize(fp),
                    "modified": os.path.getmtime(fp),
                })

    result = {
        "items": items,
        "folders": folders["_root"]["children"],
        "byId": {item["id"]: item for item in items},
    }
    with _lora_scan_cache["lock"]:
        _lora_scan_cache["data"] = result
        _lora_scan_cache["ts"] = time.time()
    return result


def _clear_scan_cache():
    with _lora_scan_cache["lock"]:
        _lora_scan_cache["data"] = None
        _lora_scan_cache["ts"] = 0.0


def _find_lora_item(lora_id):
    """O(1) 查找 LoRA，避免每张缩略图都线性遍历完整模型列表。"""
    if not lora_id:
        return None
    return _scan_loras().get("byId", {}).get(str(lora_id))


# ── 路由 ──────────────────────────────────────────────────────────────────────

@route("GET", "/lora_gallery/folders")
async def lora_folders_route(request):
    try:
        data = _scan_loras()
        return web.json_response({"success": True, "folders": data["folders"]})
    except Exception as e:
        logger.error(f"[LoraGallery] folders error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/lora_gallery/quick_list")
async def lora_quick_list_route(request):
    """为折叠状态下的模型树提供轻量元数据，不返回图片或本地绝对路径。"""
    try:
        data = _scan_loras()
        items = []
        for it in data["items"]:
            items.append({
                "id": it["id"],
                "name": it["name"],
                "fileName": it["fileName"],
                "library": it.get("dir", ""),
                "folderId": it["folderId"],
                "folderPath": it.get("folderPath", ""),
                "hasPreview": bool(it.get("preview")),
                "triggerWords": it.get("triggerWords", []),
                "civitaiId": it.get("civitaiId"),
                "civitaiVersionId": it.get("civitaiVersionId"),
                "civitaiUrl": it.get("civitaiUrl", ""),
                "size": it.get("size", 0),
                "modified": it.get("modified", 0),
            })
        items.sort(key=lambda item: (
            (item.get("folderPath") or "").lower(),
            (item.get("name") or "").lower(),
        ))
        return web.json_response({"success": True, "items": items})
    except Exception as e:
        logger.error(f"[LoraGallery] quick list error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/lora_gallery/list")
async def lora_list_route(request):
    try:
        body = await request.json()
        folder_id = body.get("folderId", "_all")
        keyword = (body.get("keyword", "") or "").strip().lower()
        sort_by = body.get("sortBy", "name")
        sort_dir = body.get("sortDir", "asc")
        page = max(1, int(body.get("page", 1)))
        page_size = min(200, max(1, int(body.get("pageSize", _PAGE_SIZE))))

        data = _scan_loras()
        items = data["items"]

        # 文件夹筛选：选择父级时同时包含所有子级
        if folder_id and folder_id != "_all":
            def _in_folder(it, fid):
                if it["folderId"] == fid:
                    return True
                fpath = it.get("folderPath", "")
                prefix = fid.split("/", 1)[1] if "/" in fid else fid
                return fpath.startswith(prefix + "/") or fpath == prefix
            items = [it for it in items if _in_folder(it, folder_id)]

        # 关键词筛选
        if keyword:
            items = [it for it in items if keyword in it["name"].lower()]

        # 排序
        reverse = sort_dir == "desc"
        if sort_by == "name":
            items.sort(key=lambda x: x["name"].lower(), reverse=reverse)
        elif sort_by == "modified":
            items.sort(key=lambda x: x["modified"], reverse=reverse)
        elif sort_by == "size":
            items.sort(key=lambda x: x["size"], reverse=reverse)

        total = len(items)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        page_items = items[start:start + page_size]

        # 安全：不返回本地绝对路径给前端，用 id 代理
        safe_items = []
        for it in page_items:
            safe_items.append({
                "id": it["id"],
                "name": it["name"],
                "fileName": it["fileName"],
                "dir": it["dir"],
                "folderId": it["folderId"],
                "folderPath": it["folderPath"],
                "hasPreview": bool(it["preview"]),
                "triggerWords": it["triggerWords"],
                "civitaiId": it["civitaiId"],
                "civitaiVersionId": it.get("civitaiVersionId", ""),
                "civitaiUrl": it["civitaiUrl"],
                "size": it["size"],
                "modified": it["modified"],
            })

        return web.json_response({
            "success": True,
            "items": safe_items,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "totalPages": total_pages,
        })
    except Exception as e:
        logger.error(f"[LoraGallery] list error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/lora_gallery/thumbnail")
async def lora_thumbnail_route(request):
    """返回轻量缩略图；缓存解码结果，避免把 4K 原图反复送到 Vue。"""
    try:
        lora_id = request.query.get("id", "")
        if not lora_id:
            return web.Response(status=400, text="missing id")

        item = _find_lora_item(lora_id)
        if not item:
            return web.Response(status=404, text="not found")

        preview_path = item.get("preview", "")
        if preview_path and os.path.isfile(preview_path):
            try:
                stat = os.stat(preview_path)
                cache_key = (preview_path, stat.st_mtime_ns, stat.st_size, _THUMBNAIL_SIZE)
                with _thumbnail_cache["lock"]:
                    cached = _thumbnail_cache["data"].get(cache_key)
                if cached is None:
                    cached = await asyncio.to_thread(_build_thumbnail, preview_path)
                    with _thumbnail_cache["lock"]:
                        cache = _thumbnail_cache["data"]
                        cache[cache_key] = cached
                        while len(cache) > _THUMBNAIL_CACHE_MAX:
                            cache.pop(next(iter(cache)))
                image_bytes, content_type = cached
                return web.Response(body=image_bytes, headers={
                    "Content-Type": content_type,
                    "Cache-Control": "public, max-age=86400",
                    "ETag": f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"',
                })
            except Exception as e:
                logger.warning(f"[LoraGallery] 读取预览图失败 {preview_path}: {e}")
                # 修复：之前这里只打日志，item["preview"] 没有被清掉，导致损坏的
                # 封面文件会被永久当成"已有封面"，自动补全/批量补全都不会再碰它，
                # 变成一个谁都修不了的死状态。现在判定为无效封面：清空记录 +
                # 删除这个坏文件，让它重新落回"无封面"，下次补全时能正常重下。
                item["preview"] = ""
                try:
                    os.remove(preview_path)
                except Exception as remove_err:
                    logger.warning(f"[LoraGallery] 删除损坏封面失败 {preview_path}: {remove_err}")

        # 占位图（512 以下尺寸，减少资源占用）
        svg = b"""<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <rect width="128" height="128" fill="#1a1a24"/>
  <text x="64" y="67" text-anchor="middle" fill="#555" font-size="10" font-family="system-ui">No Preview</text>
</svg>"""
        return web.Response(body=svg, headers={
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=3600"
        })
    except Exception as e:
        logger.error(f"[LoraGallery] thumbnail error: {e}")
        return web.Response(status=500, text=str(e))


def _build_thumbnail(preview_path):
    """在线程中解码预览图并生成 WebP 缩略图。"""
    with Image.open(preview_path) as image:
        try:
            image.seek(0)
        except Exception:
            pass
        image = ImageOps.exif_transpose(image)
        resampling = getattr(Image, "Resampling", Image)
        image.thumbnail((_THUMBNAIL_SIZE, _THUMBNAIL_SIZE), resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        output = BytesIO()
        try:
            image.save(output, format="WEBP", quality=82, method=4)
            return output.getvalue(), "image/webp"
        except Exception:
            output = BytesIO()
            image.save(output, format="PNG", optimize=True)
            return output.getvalue(), "image/png"


@route("POST", "/lora_gallery/clear_cache")
async def lora_clear_cache_route(request):
    _clear_scan_cache()
    return web.json_response({"success": True})


@route("POST", "/lora_gallery/cache_selection")
async def lora_cache_selection_route(request):
    """缓存节点选中的 LoRA 与权重。"""
    try:
        body = await request.json()
        node_id = str(body.get("node_id", ""))
        selections = body.get("selections", [])
        weights = body.get("weights", {})
        if node_id:
            _lora_selection_cache[node_id] = {
                "selections": selections,
                "weights": weights,
            }
        return web.json_response({"success": True})
    except Exception as e:
        logger.error(f"[LoraGallery] cache_selection error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/lora_gallery/cache_selection")
async def lora_cache_selection_get_route(request):
    try:
        node_id = str(request.query.get("node_id", ""))
        cache = _lora_selection_cache.get(node_id, {"selections": [], "weights": {}})
        return web.json_response({"success": True, **cache})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/lora_gallery/metadata")
async def lora_metadata_route(request):
    """读取 LoRA 常用 safetensors 元数据摘要。"""
    try:
        lora_id = request.query.get("id", "")
        item = _find_lora_item(lora_id)
        if not item:
            return web.json_response({"success": False, "error": "not found"}, status=404)

        metadata = await asyncio.to_thread(_read_safetensors_metadata, item["path"])
        return web.json_response({"success": True, "metadata": _metadata_summary(metadata)})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def _fetch_civitai_model(model_id, api_key=""):
    """从 Civitai API 拉取模型触发词等元数据。"""
    if not model_id:
        return None
    model_id = str(model_id)
    cache_key = f"model:{model_id}"
    now = time.time()
    with _civitai_cache["lock"]:
        cached = _civitai_cache["data"].get(cache_key)
        if cached and (now - cached.get("fetched_at", 0)) < 3600:
            return cached

    if aiohttp is None:
        return None

    url = f"{_CIVITAI_BASE}/api/v1/models/{model_id}"
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        timeout = aiohttp.ClientTimeout(total=20)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    trained = []
                    if isinstance(data, dict):
                        for m in data.get("modelVersions", []):
                            words = m.get("trainedWords") or []
                            for w in words:
                                w = str(w).strip()
                                if w and w not in trained:
                                    trained.append(w)
                    result = {
                        "modelId": model_id,
                        "name": data.get("name", "") if isinstance(data, dict) else "",
                        "trainedWords": trained,
                        "raw": data if isinstance(data, dict) else {},
                        "fetched_at": now,
                    }
                    with _civitai_cache["lock"]:
                        _civitai_cache["data"][cache_key] = result
                    return result
                else:
                    text = await resp.text()
                    logger.warning(f"[LoraGallery] Civitai API HTTP {resp.status}: {text[:200]}")
    except Exception as e:
        logger.warning(f"[LoraGallery] Civitai API 请求失败: {e}")
    return None


def _hash_file_sha256(path):
    """按文件属性缓存 SHA256；只在详情或缺失封面识别时计算。"""
    stat = os.stat(path)
    cache_key = (path, stat.st_mtime_ns, stat.st_size)
    with _file_hash_cache["lock"]:
        cached = _file_hash_cache["data"].get(cache_key)
    if cached:
        return cached

    digest = hashlib.sha256()
    with open(path, "rb") as file_obj:
        while True:
            chunk = file_obj.read(4 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    value = digest.hexdigest().upper()
    with _file_hash_cache["lock"]:
        cache = _file_hash_cache["data"]
        cache.clear() if len(cache) > 512 else None
        cache[cache_key] = value
    return value


async def _fetch_civitai_version_by_hash(path, api_key=""):
    """通过本地文件 SHA256 精确识别 Civitai 模型版本。"""
    if aiohttp is None:
        return None, ""
    file_hash = await asyncio.to_thread(_hash_file_sha256, path)
    cache_key = f"hash:{file_hash}"
    now = time.time()
    with _civitai_cache["lock"]:
        cached = _civitai_cache["data"].get(cache_key)
        if cached and (now - cached.get("fetched_at", 0)) < 86400:
            return cached.get("raw"), file_hash

    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    url = f"{_CIVITAI_BASE}/api/v1/model-versions/by-hash/{file_hash}"
    try:
        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    raw = await resp.json()
                    with _civitai_cache["lock"]:
                        _civitai_cache["data"][cache_key] = {
                            "raw": raw if isinstance(raw, dict) else {},
                            "fetched_at": now,
                        }
                    return raw if isinstance(raw, dict) else None, file_hash
                if resp.status != 404:
                    logger.warning(f"[LoraGallery] Civitai hash API HTTP {resp.status}")
    except Exception as e:
        logger.warning(f"[LoraGallery] Civitai hash 查询失败: {e}")
    return None, file_hash


def _write_civitai_sidecar(item, version_data):
    """复用现有 .civitai.info 约定，避免后续启动再次计算大文件哈希。"""
    if not isinstance(version_data, dict) or not version_data.get("modelId"):
        return
    info_path = os.path.splitext(item["path"])[0] + ".civitai.info"
    if os.path.isfile(info_path):
        return
    try:
        temp_path = info_path + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as file_obj:
            json.dump(version_data, file_obj, ensure_ascii=False, indent=2)
        os.replace(temp_path, info_path)
    except Exception as e:
        logger.warning(f"[LoraGallery] 保存 Civitai 旁车信息失败: {e}")


def _clean_trigger_words(words):
    """清洗并去重触发词，保留原始顺序。"""
    if isinstance(words, str):
        words = re.split(r"[,，\n]", words)
    result = []
    for word in words or []:
        value = str(word).strip()
        if value and value not in result:
            result.append(value)
    return result


def _load_civitai_archive(item):
    """读取 Eagle 完整归档；兼容只有版本数据的旧 .civitai.info。"""
    base = os.path.splitext(item["path"])[0]
    archive_path = base + ".civitai.json"
    if os.path.isfile(archive_path):
        try:
            with open(archive_path, "r", encoding="utf-8") as file_obj:
                archive = json.load(file_obj)
            if isinstance(archive, dict):
                return archive
        except Exception as error:
            logger.warning(f"[LoraGallery] 读取 Civitai 完整归档失败: {error}")

    legacy_path = base + ".civitai.info"
    if os.path.isfile(legacy_path):
        try:
            with open(legacy_path, "r", encoding="utf-8") as file_obj:
                version = json.load(file_obj)
            if isinstance(version, dict):
                model_id = str(version.get("modelId") or "")
                version_id = str(version.get("id") or version.get("modelVersionId") or "")
                return {
                    "_schema": "eagle-suite.lora-civitai-archive.legacy",
                    "modelId": model_id,
                    "modelVersionId": version_id,
                    "civitaiUrl": f"{_CIVITAI_BASE}/models/{model_id}" if model_id else "",
                    "trainedWords": _clean_trigger_words(version.get("trainedWords") or version.get("trainedTags") or []),
                    "civitai": {"model": {}, "version": version},
                }
        except Exception:
            pass
    return {}


def _persist_civitai_words(item, words):
    """将 Civitai 触发词合并写入同名 .txt，避免每次重复请求。"""
    remote_words = _clean_trigger_words(words)
    if not remote_words:
        return _clean_trigger_words(item.get("triggerWords") or [])

    local_words = _clean_trigger_words(item.get("triggerWords") or [])
    merged = _clean_trigger_words(local_words + remote_words)
    txt_path = os.path.splitext(item["path"])[0] + ".txt"
    try:
        current = ""
        if os.path.isfile(txt_path):
            with open(txt_path, "r", encoding="utf-8") as file_obj:
                current = file_obj.read()
        desired = "\n".join(merged)
        if current.strip() != desired.strip():
            temp_path = txt_path + ".tmp"
            with open(temp_path, "w", encoding="utf-8") as file_obj:
                file_obj.write(desired)
            os.replace(temp_path, txt_path)
    except Exception as error:
        logger.warning(f"[LoraGallery] 自动保存 Civitai 触发词失败: {error}")
    item["triggerWords"] = merged
    return merged


def _write_civitai_archive(item, model_id, version_data, model_info, file_hash=""):
    """原子保存完整 Civitai 模型页与精确版本响应，供离线回退。"""
    previous_archive = _load_civitai_archive(item)
    previous_file = previous_archive.get("modelFile") if isinstance(previous_archive.get("modelFile"), dict) else {}
    version = version_data if isinstance(version_data, dict) else {}
    raw_model = model_info.get("raw", {}) if isinstance(model_info, dict) else {}
    raw_model = raw_model if isinstance(raw_model, dict) else {}
    model_id = str(model_id or version.get("modelId") or raw_model.get("id") or "")
    if not model_id or (not version and not raw_model):
        return

    version_id = str(version.get("id") or item.get("civitaiVersionId") or "")
    words = _clean_trigger_words(
        version.get("trainedWords")
        or (model_info.get("trainedWords", []) if isinstance(model_info, dict) else [])
    )
    model_ref = version.get("model") if isinstance(version.get("model"), dict) else {}
    creator = raw_model.get("creator") if isinstance(raw_model.get("creator"), dict) else {}
    civitai_url = f"{_CIVITAI_BASE}/models/{model_id}"
    if version_id:
        civitai_url += f"?modelVersionId={version_id}"

    payload = {
        "_schema": "eagle-suite.lora-civitai-archive.v1",
        "source": _CIVITAI_BASE,
        "modelFile": {
            "name": item.get("fileName", os.path.basename(item["path"])),
            "relativePath": item.get("rel", ""),
            "size": item.get("size", 0),
            "modified": item.get("modified", 0),
            "sha256": file_hash or previous_file.get("sha256", ""),
        },
        "modelId": model_id,
        "modelVersionId": version_id,
        "civitaiUrl": civitai_url,
        "trainedWords": words,
        "profile": {
            "modelName": raw_model.get("name") or model_ref.get("name") or item.get("name", ""),
            "versionName": version.get("name", ""),
            "baseModel": version.get("baseModel", ""),
            "modelType": raw_model.get("type") or model_ref.get("type") or "LORA",
            "creator": creator.get("username", ""),
            "tags": raw_model.get("tags") or [],
            "description": _plain_text(raw_model.get("description")),
            "versionDescription": _plain_text(version.get("description")),
            "stats": raw_model.get("stats") or {},
            "versionStats": version.get("stats") or {},
        },
        "civitai": {
            "model": raw_model,
            "version": version,
        },
    }

    archive_path = os.path.splitext(item["path"])[0] + ".civitai.json"
    try:
        existing = {}
        if os.path.isfile(archive_path):
            with open(archive_path, "r", encoding="utf-8") as file_obj:
                existing = json.load(file_obj)
        existing_compare = dict(existing) if isinstance(existing, dict) else {}
        existing_compare.pop("savedAt", None)
        if existing_compare == payload:
            return
        payload["savedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        temp_path = archive_path + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as file_obj:
            json.dump(payload, file_obj, ensure_ascii=False, indent=2)
        os.replace(temp_path, archive_path)
    except Exception as error:
        logger.warning(f"[LoraGallery] 保存 Civitai 完整归档失败: {error}")


async def _resolve_civitai_item(item, api_key="", include_model=True, prefer_hash=False):
    """在线读取成功即归档；在线不可用时回退到模型旁完整 JSON。"""
    archive = _load_civitai_archive(item)
    archived_civitai = archive.get("civitai") if isinstance(archive.get("civitai"), dict) else {}
    archived_version = archived_civitai.get("version") if isinstance(archived_civitai.get("version"), dict) else {}
    archived_model = archived_civitai.get("model") if isinstance(archived_civitai.get("model"), dict) else {}
    archived_file = archive.get("modelFile") if isinstance(archive.get("modelFile"), dict) else {}
    archive_matches_file = (
        archive.get("_schema") == "eagle-suite.lora-civitai-archive.v1"
        and archived_model
        and archived_version
        and int(archived_file.get("size") or -1) == int(item.get("size") or 0)
        and abs(float(archived_file.get("modified") or 0) - float(item.get("modified") or 0)) < 0.001
    )
    if archive_matches_file:
        model_id = str(archive.get("modelId") or archived_version.get("modelId") or archived_model.get("id") or "")
        model_info = {
            "modelId": model_id,
            "name": archived_model.get("name", ""),
            "trainedWords": _clean_trigger_words(archive.get("trainedWords") or archived_version.get("trainedWords") or []),
            "raw": archived_model,
            "fetched_at": 0,
            "offline": True,
            "archived": True,
        }
        words = archived_version.get("trainedWords") or model_info["trainedWords"]
        if words:
            _persist_civitai_words(item, words)
        item["civitaiId"] = model_id
        item["civitaiVersionId"] = str(archive.get("modelVersionId") or archived_version.get("id") or "")
        item["civitaiUrl"] = archive.get("civitaiUrl") or (f"{_CIVITAI_BASE}/models/{model_id}" if model_id else "")
        return model_id, archived_version, model_info if include_model else None, str(archived_file.get("sha256") or "")

    version_data = None
    file_hash = ""
    model_id = str(item.get("civitaiId") or archive.get("modelId") or archived_version.get("modelId") or archived_model.get("id") or "")
    version_id = str(item.get("civitaiVersionId") or archive.get("modelVersionId") or archived_version.get("id") or "")

    if prefer_hash or not model_id:
        version_data, file_hash = await _fetch_civitai_version_by_hash(item["path"], api_key)
        if version_data:
            model_id = str(version_data.get("modelId") or model_id or "")
            if model_id:
                item["civitaiId"] = model_id
                item["civitaiVersionId"] = str(version_data.get("id") or "")
                item["civitaiUrl"] = f"{_CIVITAI_BASE}/models/{model_id}"
                _write_civitai_sidecar(item, version_data)

    model_info = await _fetch_civitai_model(model_id, api_key) if include_model and model_id else None
    if model_info is None and archived_model:
        model_info = {
            "modelId": model_id,
            "name": archived_model.get("name", ""),
            "trainedWords": _clean_trigger_words(archive.get("trainedWords") or archived_version.get("trainedWords") or []),
            "raw": archived_model,
            "fetched_at": 0,
            "offline": True,
        }
    if version_data is None and model_info:
        versions = model_info.get("raw", {}).get("modelVersions", [])
        if version_id:
            version_data = next((version for version in versions if str(version.get("id")) == version_id), None)
        if version_data is None and versions:
            version_data = versions[0]
    if not version_data and archived_version:
        version_data = archived_version

    version_data = version_data or {}
    words = version_data.get("trainedWords") or (model_info.get("trainedWords", []) if model_info else [])
    if words:
        _persist_civitai_words(item, words)
    if model_id and (version_data or model_info):
        _write_civitai_archive(item, model_id, version_data, model_info, file_hash)
        item["civitaiId"] = model_id
        item["civitaiVersionId"] = str(version_data.get("id") or version_id or "")
        item["civitaiUrl"] = archive.get("civitaiUrl") or f"{_CIVITAI_BASE}/models/{model_id}"
    return model_id, version_data, model_info, file_hash


def _plain_text(value, limit=8000):
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", str(value))
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    return text[:limit]


def _read_safetensors_metadata(path):
    if not path.lower().endswith(".safetensors"):
        return {}
    try:
        with open(path, "rb") as file_obj:
            length_data = file_obj.read(8)
            if len(length_data) != 8:
                return {}
            length = struct.unpack("<Q", length_data)[0]
            if length <= 0 or length > 64 * 1024 * 1024:
                return {}
            data = json.loads(file_obj.read(length).decode("utf-8"))
            return data.get("__metadata__", data) if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning(f"[LoraGallery] 读取元数据失败 {path}: {e}")
        return {}


def _metadata_summary(metadata):
    """只返回常用训练参数，避免把超大的 tag_frequency 推到浏览器。"""
    if not isinstance(metadata, dict):
        return {}
    keys = (
        "ss_base_model_version", "ss_sd_model_name", "ss_resolution", "ss_clip_skip",
        "ss_network_module", "ss_network_dim", "ss_network_alpha", "ss_network_args",
        "ss_num_train_images", "ss_num_reg_images", "ss_num_epochs", "ss_epoch",
        "ss_steps", "ss_mixed_precision", "ss_seed", "ss_output_name",
        "ss_training_started_at", "ss_training_finished_at",
    )
    result = {}
    for key in keys:
        if key in metadata and metadata[key] not in (None, ""):
            value = metadata[key]
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False)
            result[key] = str(value)[:2000]
    return result


@route("GET", "/lora_gallery/model_details")
async def lora_model_details_route(request):
    """通过文件哈希定位版本，只向前端返回 civitai.red 模型信息。"""
    try:
        lora_id = request.query.get("id", "")
        api_key = request.query.get("api_key", "")
        item = _find_lora_item(lora_id)
        if not item:
            return web.json_response({"success": False, "error": "not found"}, status=404)

        model_id, version, model_info, _ = await _resolve_civitai_item(
            item, api_key, include_model=True, prefer_hash=True
        )
        raw_model = model_info.get("raw", {}) if model_info else {}

        version_id = version.get("id") or ""
        words = version.get("trainedWords") or (model_info.get("trainedWords", []) if model_info else [])
        images = []
        for image in (version.get("images") or [])[:8]:
            if not isinstance(image, dict) or not image.get("url"):
                continue
            if str(image.get("type") or "image").lower() not in ("", "image"):
                continue
            images.append({
                "url": image.get("url", ""),
                "width": image.get("width"),
                "height": image.get("height"),
                "nsfw": image.get("nsfw"),
            })

        creator = raw_model.get("creator") or {}
        files = []
        for file_info in (version.get("files") or [])[:6]:
            if not isinstance(file_info, dict):
                continue
            files.append({
                "name": file_info.get("name", ""),
                "sizeKB": file_info.get("sizeKB") or file_info.get("sizeKb"),
                "type": file_info.get("type", ""),
                "metadata": file_info.get("metadata") or {},
                "pickleScanResult": file_info.get("pickleScanResult", ""),
                "virusScanResult": file_info.get("virusScanResult", ""),
            })

        civitai_url = f"{_CIVITAI_BASE}/models/{model_id}"
        if model_id and version_id:
            civitai_url += f"?modelVersionId={version_id}"
        api_words = [str(word).strip() for word in words if str(word).strip()]

        return web.json_response({
            "success": True,
            "civitai": {
                "found": bool(model_id),
                "modelId": model_id,
                "versionId": version_id,
                "url": civitai_url if model_id else "",
                "name": raw_model.get("name") or (version.get("model") or {}).get("name") or "",
                "type": raw_model.get("type") or (version.get("model") or {}).get("type") or "",
                "creator": creator.get("username", "") if isinstance(creator, dict) else "",
                "nsfw": raw_model.get("nsfw", (version.get("model") or {}).get("nsfw")),
                "tags": raw_model.get("tags") or [],
                "description": _plain_text(raw_model.get("description")),
                "versionName": version.get("name", ""),
                "versionDescription": _plain_text(version.get("description")),
                "baseModel": version.get("baseModel", ""),
                "createdAt": version.get("createdAt", ""),
                "updatedAt": version.get("updatedAt", ""),
                "trainedWords": api_words,
                "stats": raw_model.get("stats") or {},
                "versionStats": version.get("stats") or {},
                "files": files,
                "images": images,
            },
        })
    except Exception as e:
        logger.error(f"[LoraGallery] model_details error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/lora_gallery/civitai_info")
async def lora_civitai_info_route(request):
    """查询单个 LoRA 的 Civitai 元数据，支持 API Key。"""
    try:
        lora_id = request.query.get("id", "")
        api_key = request.query.get("api_key", "")
        item = _find_lora_item(lora_id)
        if not item:
            return web.json_response({"success": False, "error": "not found"}, status=404)

        local_words = item.get("triggerWords", [])
        model_id, version, info, _ = await _resolve_civitai_item(item, api_key, include_model=True)
        api_words = version.get("trainedWords") or (info.get("trainedWords", []) if info else [])

        return web.json_response({
            "success": True,
            "id": lora_id,
            "civitaiId": model_id,
            "civitaiUrl": f"{_CIVITAI_BASE}/models/{model_id}" if model_id else "",
            "localWords": local_words,
            "apiWords": api_words,
            "cached": bool(info or version),
        })
    except Exception as e:
        logger.error(f"[LoraGallery] civitai_info error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/lora_gallery/civitai_info")
async def lora_civitai_info_post_route(request):
    """批量刷新 Civitai 触发词。"""
    try:
        body = await request.json()
        ids = body.get("ids", [])
        api_key = body.get("api_key", "")
        data = _scan_loras()
        id_to_item = {it["id"]: it for it in data["items"]}
        results = {}
        for lid in ids:
            item = id_to_item.get(lid)
            if not item:
                continue
            model_id, version, info, _ = await _resolve_civitai_item(item, api_key, include_model=True)
            results[lid] = {
                "civitaiId": model_id,
                "apiWords": version.get("trainedWords") or (info.get("trainedWords", []) if info else []),
                "cached": bool(info or version),
            }
        return web.json_response({"success": True, "results": results})
    except Exception as e:
        logger.error(f"[LoraGallery] civitai_info_post error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def _download_url(url, dest_path, api_key=""):
    """通用下载文件到本地路径。"""
    if aiohttp is None:
        return False, "aiohttp not available"
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    temp_path = str(dest_path) + ".part"
    try:
        timeout = aiohttp.ClientTimeout(total=600)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    return False, f"HTTP {resp.status}: {text[:200]}"
                declared = int(resp.headers.get("Content-Length") or 0)
                if declared > _LORA_MODEL_MAX_BYTES:
                    return False, "model file is too large"
                total = 0
                with open(temp_path, "wb") as f:
                    async for chunk in resp.content.iter_chunked(1024 * 1024):
                        if chunk:
                            total += len(chunk)
                            if total > _LORA_MODEL_MAX_BYTES:
                                raise ValueError("model file is too large")
                            f.write(chunk)
                os.replace(temp_path, dest_path)
                return True, ""
    except Exception as e:
        return False, str(e)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _is_civitai_image_url(url):
    try:
        host = (urlparse(url).hostname or "").lower()
        return host == "civitai.red" or host.endswith(".civitai.red") or host == "civitai.com" or host.endswith(".civitai.com")
    except Exception:
        return False


async def _download_preview_image(url, base_path, api_key=""):
    """限制来源和体积，并按真实格式保存预览图。"""
    if aiohttp is None:
        return False, "", "aiohttp not available"
    if not _is_civitai_image_url(url):
        return False, "", "unsupported preview host"
    headers = {"Accept": "image/*"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        timeout = aiohttp.ClientTimeout(total=90)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status >= 400:
                    return False, "", f"HTTP {resp.status}"
                content_type = (resp.headers.get("Content-Type") or "").split(";", 1)[0].lower()
                if not content_type.startswith("image/"):
                    return False, "", f"invalid content type: {content_type or 'unknown'}"
                chunks = []
                size = 0
                async for chunk in resp.content.iter_chunked(512 * 1024):
                    size += len(chunk)
                    if size > _PREVIEW_MAX_BYTES:
                        return False, "", "preview image is too large"
                    chunks.append(chunk)
        image_bytes = b"".join(chunks)

        def _validate_and_save():
            with Image.open(BytesIO(image_bytes)) as image:
                image.verify()
                image_format = (image.format or "").upper()
            extension = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif"}.get(image_format)
            if not extension:
                raise ValueError(f"unsupported image format: {image_format or 'unknown'}")
            destination = base_path + extension
            temp_path = destination + ".tmp"
            with open(temp_path, "wb") as file_obj:
                file_obj.write(image_bytes)
            os.replace(temp_path, destination)
            return destination

        destination = await asyncio.to_thread(_validate_and_save)
        return True, destination, ""
    except Exception as e:
        return False, "", str(e)


@route("POST", "/lora_gallery/set_preview")
async def lora_set_preview_route(request):
    """把指定的 civitai.red 图片设为该模型的封面（无论是否已有封面，都会覆盖）。
    用于「模型信息」弹窗里每张图片上的『设为封面』按钮。"""
    try:
        body = await request.json()
        lora_id = body.get("id", "")
        image_url = body.get("image_url", "")
        api_key = body.get("api_key", "")
        item = _find_lora_item(lora_id)
        if not item:
            return web.json_response({"success": False, "error": "not found"}, status=404)
        if not image_url:
            return web.json_response({"success": False, "error": "image_url required"}, status=400)

        base = os.path.splitext(item["path"])[0]
        ok, dest, err = await _download_preview_image(image_url, base, api_key)
        if not ok:
            return web.json_response({"success": False, "error": err})

        # 清理其它扩展名残留的旧封面文件（比如旧封面是 .jpg，新选的图是 .png，
        # 避免同一模型底下堆出好几张封面图，导致下次扫描时用到哪张不确定）
        for ext in _PREVIEW_EXT:
            old_path = base + ext
            if old_path != dest and os.path.isfile(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        item["preview"] = dest
        # 缩略图缓存的 key 里已经带了 mtime/size（见 lora_thumbnail_route），
        # 新文件写入后 mtime 变了，缓存会自然失效，不需要在这里手动清。

        return web.json_response({"success": True, "preview": dest})
    except Exception as e:
        logger.error(f"[LoraGallery] set_preview error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/lora_gallery/download_preview")
async def lora_download_preview_route(request):
    """从 Civitai 下载模型预览图到 LoRA 同名路径。"""
    try:
        body = await request.json()
        lora_id = body.get("id", "")
        api_key = body.get("api_key", "")
        item = _find_lora_item(lora_id)
        if not item:
            return web.json_response({"success": False, "error": "not found"}, status=404)

        # 如果已有预览图则直接返回成功，不发起任何网络请求。
        if item.get("preview") and os.path.isfile(item["preview"]):
            return web.json_response({
                "success": True,
                "cached": True,
                "civitaiId": item.get("civitaiId", ""),
                "civitaiUrl": item.get("civitaiUrl", ""),
                "triggerWords": item.get("triggerWords", []),
            })

        fail_key = (item["path"], item.get("modified"), item.get("size"))
        with _preview_fail_cache["lock"]:
            failed_at = _preview_fail_cache["data"].get(fail_key, 0)
        if failed_at and time.time() - failed_at < 6 * 3600:
            return web.json_response({"success": False, "error": "not found on Civitai (cached)"}, status=404)

        model_id, version, info, _ = await _resolve_civitai_item(item, api_key, include_model=True)
        if not model_id:
            with _preview_fail_cache["lock"]:
                _preview_fail_cache["data"][fail_key] = time.time()
            return web.json_response({"success": False, "error": "model hash not found on Civitai"}, status=404)

        raw = info.get("raw", {}) if info else {}
        image_urls = []
        candidates = [version] + list(raw.get("modelVersions", []))
        for version_item in candidates:
            images = version_item.get("images", []) if isinstance(version_item, dict) else []
            for image in images:
                if not isinstance(image, dict):
                    continue
                if str(image.get("type") or "image").lower() not in ("", "image"):
                    continue
                image_url = image.get("url", "") or image.get("raw", "")
                lower_url = image_url.lower().split("?", 1)[0]
                if image_url and not lower_url.endswith((".mp4", ".webm", ".mov")) and image_url not in image_urls:
                    image_urls.append(image_url)
        if not image_urls:
            return web.json_response({"success": False, "error": "no preview image in civitai"})

        base = os.path.splitext(item["path"])[0]
        ok, dest, err = False, "", "no usable preview image"
        for image_url in image_urls[:5]:
            ok, dest, err = await _download_preview_image(image_url, base, api_key)
            if ok:
                break
        if not ok:
            return web.json_response({"success": False, "error": err})

        words = version.get("trainedWords") or (info.get("trainedWords", []) if info else [])
        item["preview"] = dest
        if words and not item.get("triggerWords"):
            item["triggerWords"] = [str(word).strip() for word in words if str(word).strip()]
        return web.json_response({
            "success": True,
            "civitaiId": model_id,
            "civitaiUrl": f"{_CIVITAI_BASE}/models/{model_id}",
            "triggerWords": words,
        })
    except Exception as e:
        logger.error(f"[LoraGallery] download_preview error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/lora_gallery/save_trigger_words")
async def lora_save_trigger_words_route(request):
    """保存用户编辑的触发词到本地同名 .txt 文件。"""
    try:
        body = await request.json()
        lora_id = body.get("id", "")
        words = body.get("words", [])
        item = _find_lora_item(lora_id)
        if not item:
            return web.json_response({"success": False, "error": "not found"}, status=404)

        txt_path = os.path.splitext(item["path"])[0] + ".txt"
        try:
            # 保留用户输入的每个触发词原样（允许词内带空格），过滤空字符串
            cleaned = [str(w).strip() for w in words if str(w).strip()]
            # 文件保存格式：每个词独占一行，避免逗号格式争议，也便于人工编辑
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write("\n".join(cleaned))
        except Exception as e:
            return web.json_response({"success": False, "error": f"write failed: {e}"})

        # 更新内存缓存中的触发词
        item["triggerWords"] = [str(w).strip() for w in words if str(w).strip()]
        return web.json_response({"success": True, "triggerWords": item["triggerWords"]})
    except Exception as e:
        logger.error(f"[LoraGallery] save_trigger_words error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/lora_gallery/download_model")
async def lora_download_model_route(request):
    """通过 Civitai API 下载指定模型版本到 models/loras 对应文件夹。"""
    try:
        body = await request.json()
        model_id = body.get("model_id", "")
        version_id = body.get("version_id", "")
        folder_id = body.get("folder_id", "_all")
        api_key = body.get("api_key", "")

        if not model_id or not version_id:
            return web.json_response({"success": False, "error": "model_id and version_id required"})
        if not api_key:
            return web.json_response({"success": False, "error": "api_key required for download"})

        data = _scan_loras()
        # 查找目标文件夹路径
        lora_roots = _get_lora_dirs()
        if not lora_roots:
            return web.json_response({"success": False, "error": "no LoRA directory"}, status=500)
        target_root = os.path.realpath(lora_roots[0])
        target_dir = target_root
        if folder_id and folder_id != "_all":
            # folder_id 形如 loras/Noob/Artist Style，取后半部分
            rel = folder_id.split("/", 1)[1] if "/" in folder_id else folder_id
            cand = os.path.realpath(os.path.join(target_root, rel))
            if not _path_is_within(cand, target_root) or not os.path.isdir(cand):
                return web.json_response({"success": False, "error": "invalid target folder"}, status=400)
            target_dir = cand

        # 从 Civitai API 获取版本详情
        if aiohttp is None:
            return web.json_response({"success": False, "error": "aiohttp not available"})
        url = f"{_CIVITAI_BASE}/api/v1/model-versions/{version_id}"
        headers = {"Authorization": f"Bearer {api_key}"}
        version_data = {}
        try:
            timeout = aiohttp.ClientTimeout(total=30)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers=headers) as resp:
                    if resp.status == 200:
                        version_data = await resp.json()
                    else:
                        text = await resp.text()
                        return web.json_response({"success": False, "error": f"Civitai HTTP {resp.status}: {text[:200]}"})
        except Exception as e:
            return web.json_response({"success": False, "error": f"fetch version failed: {e}"})

        files = version_data.get("files", [])
        if not files:
            return web.json_response({"success": False, "error": "no files in this version"})

        file_info = files[0]
        for f in files:
            if f.get("primary"):
                file_info = f
                break
        download_url = file_info.get("downloadUrl", "")
        if not download_url:
            return web.json_response({"success": False, "error": "no download url"})

        name = os.path.basename(str(file_info.get("name") or f"{model_id}_{version_id}.safetensors")).strip()
        if not name or name in (".", ".."):
            return web.json_response({"success": False, "error": "invalid model filename"}, status=400)
        if not name.lower().endswith(_LORA_EXT):
            name += ".safetensors"
        dest = os.path.realpath(os.path.join(target_dir, name))
        if not _path_is_within(dest, target_root):
            return web.json_response({"success": False, "error": "invalid model destination"}, status=400)

        ok, err = await _download_url(download_url, dest, api_key)
        if not ok:
            return web.json_response({"success": False, "error": err})

        # 尝试保存 civitai.info
        try:
            info_path = os.path.splitext(dest)[0] + ".civitai.info"
            with open(info_path, "w", encoding="utf-8") as f:
                json.dump(version_data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

        _clear_scan_cache()
        return web.json_response({"success": True, "path": dest, "name": name})
    except Exception as e:
        logger.error(f"[LoraGallery] download_model error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ── ComfyUI 节点 ───────────────────────────────────────────────────────────────

class EagleLoraGalleryNode:
    """
    🦅 LoRA 画廊加载器
    视觉化选择 LoRA，支持多选、权重调节、触发词查看、Civitai 跳转。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "selection_data": ("STRING", {"default": "[]", "multiline": False}),
                "trigger_source": (["none", "file", "civitai", "merge"], {"default": "civitai"}),
                "trigger_concat": ("BOOLEAN", {"default": True, "label_on": "拼接触发词", "label_off": "不拼接"}),
            },
            "optional": {
                "clip": ("CLIP",),
                "civitai_api_key": ("STRING", {"default": "", "multiline": False}),
                "manual_triggers": ("STRING", {"default": "", "multiline": True}),
            },
            "hidden": {
                "node_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING", "STRING")
    RETURN_NAMES = ("model", "clip", "lora_info", "trigger_words")
    FUNCTION = "load_loras"
    CATEGORY = "🦅 Eagle"
    OUTPUT_NODE = True

    def load_loras(self, model, selection_data="[]", trigger_source="civitai", trigger_concat=True, clip=None, civitai_api_key="", manual_triggers="", **kwargs):
        node_id = str(kwargs.get("node_id", "default"))

        # 优先从 selection_data widget 读取（ComfyUI 会把它作为输入参数，变化时触发重算）
        selections = []
        weights = {}
        if selection_data and selection_data != "[]":
            try:
                restored = json.loads(selection_data)
                if isinstance(restored, dict):
                    selections = restored.get("selections", [])
                    weights = restored.get("weights", {})
                elif isinstance(restored, list):
                    selections = restored
            except Exception:
                pass

        # 如果 widget 没有数据，再回退到服务端内存缓存（兼容旧工作流/异常场景）
        if not selections:
            cache = _lora_selection_cache.get(node_id, {"selections": [], "weights": {}})
            selections = cache.get("selections", [])
            weights = cache.get("weights", {})

        if not selections:
            empty_info = {
                "loras": [],
                "count": 0,
                "triggerWords": "",
                "triggerSource": trigger_source,
                "triggerConcat": bool(trigger_concat),
            }
            return (model, clip, json.dumps(empty_info, ensure_ascii=False, indent=2), "")

        data = _scan_loras()
        id_to_item = {it["id"]: it for it in data["items"]}

        def _unique_words(words):
            result = []
            for word in words or []:
                value = str(word).strip()
                if value and value not in result:
                    result.append(value)
            return result

        def _fetch_remote_profile(item):
            """通过 SHA256 查询准确版本，一次取得触发词和模型使用信息。"""
            try:
                model_id, version, model_info, _ = asyncio.run(
                    _resolve_civitai_item(
                        item,
                        civitai_api_key or "",
                        include_model=True,
                        prefer_hash=True,
                    )
                )
            except Exception as error:
                logger.warning(f"[LoraGallery] Civitai 模型信息查询失败 {item['name']}: {error}")
                model_id, version, model_info = "", {}, None

            raw_model = model_info.get("raw", {}) if model_info else {}
            version = version if isinstance(version, dict) else {}
            model = version.get("model") if isinstance(version.get("model"), dict) else {}
            version_id = version.get("id") or item.get("civitaiVersionId") or ""
            model_id = model_id or item.get("civitaiId") or ""
            words = _unique_words(
                version.get("trainedWords")
                or (model_info.get("trainedWords", []) if model_info else [])
            )

            tags = []
            for tag in raw_model.get("tags") or []:
                value = tag.get("name") if isinstance(tag, dict) else tag
                value = str(value or "").strip()
                if value and value not in tags:
                    tags.append(value)

            creator = raw_model.get("creator") or {}
            creator_name = creator.get("username", "") if isinstance(creator, dict) else ""
            civitai_url = f"{_CIVITAI_BASE}/models/{model_id}" if model_id else ""
            if civitai_url and version_id:
                civitai_url += f"?modelVersionId={version_id}"

            return {
                "found": bool(model_id),
                "modelId": model_id,
                "versionId": version_id,
                "modelName": raw_model.get("name") or model.get("name") or item["name"],
                "versionName": version.get("name") or "",
                "baseModel": version.get("baseModel") or "",
                "modelType": raw_model.get("type") or model.get("type") or "LORA",
                "creator": creator_name,
                "tags": tags,
                "trainedWords": words,
                "description": _plain_text(raw_model.get("description")),
                "versionDescription": _plain_text(version.get("description")),
                "civitaiUrl": civitai_url or item.get("civitaiUrl", ""),
            }

        def _select_triggers(local_words, remote_words):
            local_words = _unique_words(local_words)
            remote_words = _unique_words(remote_words)
            if trigger_source == "none":
                return []
            if trigger_source == "file":
                # 本地没有配置时，直接使用 C 站检测出的触发词。
                return local_words or remote_words
            if trigger_source == "civitai":
                return remote_words or local_words
            if trigger_source == "merge":
                return _unique_words(local_words + remote_words)
            return remote_words or local_words

        def _build_json_info(profile, trigger_words, lora_tag, weight):
            intro = profile.get("description") or "无模型介绍。"
            version_info = profile.get("versionDescription") or "无版本信息。"
            usage_words = ", ".join(trigger_words) if trigger_words else "无"
            return (
                "--- 基础信息 ---\n"
                f"模型名称: {profile.get('modelName') or '未知'}\n"
                f"版本名称: {profile.get('versionName') or '未知'}\n"
                f"基础模型: {profile.get('baseModel') or '未知'}\n"
                f"模型类型: {profile.get('modelType') or 'LORA'}\n"
                f"作者: {profile.get('creator') or '未知'}\n"
                f"C站链接: {profile.get('civitaiUrl') or '未匹配'}\n\n"
                "--- 使用方法 ---\n"
                f"LoRA 标签: {lora_tag}\n"
                f"当前权重: {weight}\n"
                f"触发词: {usage_words}\n\n"
                "--- 模型介绍 ---\n"
                f"{intro}\n\n"
                "--- 版本信息 ---\n"
                f"{version_info}\n"
            )

        applied = []
        all_triggers = []
        trigger_groups = []

        for sel in selections:
            lid = sel.get("id", "")
            item = id_to_item.get(lid)
            if not item:
                continue
            path = item["path"]
            w = float(weights.get(lid, sel.get("weight", 1.0)))

            try:
                lora = comfy.utils.load_torch_file(path, safe_load=True)
                model, clip = comfy.sd.load_lora_for_models(model, clip, lora, w, w)
                profile = _fetch_remote_profile(item)
                local_words = _unique_words(item.get("triggerWords") or [])
                remote_words = _unique_words(profile.get("trainedWords") or [])
                triggers = _select_triggers(local_words, remote_words)
                record_words = remote_words or local_words

                relative_name = item.get("rel") or item.get("fileName") or item["name"]
                json_name = relative_name.replace("/", "\\")
                prompt_name = os.path.splitext(relative_name)[0].replace("\\", "/")
                # 可直接用于提示词记录的 <lora:相对路径:权重> 格式。
                lora_tag = f"<lora:{prompt_name}:{w:g}>"
                applied.append({
                    "name": json_name,
                    "weight": w,
                    "enabled": True,
                    "tags": ", ".join(profile.get("tags") or []),
                    "note": "",
                    "triggerWords": ", ".join(record_words),
                    "jsonInfo": _build_json_info(profile, record_words, lora_tag, w),
                    "logInfo": f"加载成功；MODEL/CLIP 权重={w:g}",
                    "modelName": profile.get("modelName", ""),
                    "versionName": profile.get("versionName", ""),
                    "baseModel": profile.get("baseModel", ""),
                    "modelType": profile.get("modelType", "LORA"),
                    "creator": profile.get("creator", ""),
                    "modelId": profile.get("modelId", ""),
                    "modelVersionId": profile.get("versionId", ""),
                    "civitaiUrl": profile.get("civitaiUrl", ""),
                    "loraTag": lora_tag,
                })
                if triggers:
                    trigger_groups.append(triggers)
                    for trigger in triggers:
                        if trigger not in all_triggers:
                            all_triggers.append(trigger)
                logger.info(f"[LoraGallery] 已应用 LoRA: {item['name']} (weight={w}, triggers={len(triggers)})")
            except Exception as e:
                logger.error(f"[LoraGallery] 加载 LoRA 失败 {path}: {e}")

        # 追加手动触发词
        manual_list = [t.strip() for t in (manual_triggers or "").replace("\n", ",").split(",") if t.strip()]
        manual_list = _unique_words(manual_list)
        if manual_list:
            trigger_groups.append(manual_list)
        for t in manual_list:
            if t and t not in all_triggers:
                all_triggers.append(t)

        # 拼接模式输出单行；关闭拼接时，每个 LoRA 的触发词独占一行。
        if trigger_concat:
            trigger_str = ", ".join(all_triggers) + (", " if all_triggers else "")
        else:
            trigger_lines = [", ".join(_unique_words(group)) for group in trigger_groups if group]
            trigger_str = "\n".join(line for line in trigger_lines if line)

        info_payload = {
            "loras": applied,
            "count": len(applied),
            "triggerWords": ", ".join(all_triggers),
            "triggerSource": trigger_source,
            "triggerConcat": bool(trigger_concat),
        }
        info_str = json.dumps(info_payload, ensure_ascii=False, indent=2)

        return (model, clip, info_str, trigger_str)

    @classmethod
    def IS_CHANGED(cls, selection_data="[]", **kwargs):
        # 让 ComfyUI 能检测到 LoRA 选择变化：selection_data 变化时返回新 hash，否则返回固定值
        try:
            import hashlib
            return hashlib.md5((selection_data or "[]").encode("utf-8")).hexdigest()
        except Exception:
            return float("nan")


__all__ = ["EagleLoraGalleryNode"]
