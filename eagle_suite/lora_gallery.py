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
from pathlib import Path

import folder_paths
import comfy.utils
import comfy.sd
import torch

from aiohttp import web
from PIL import Image

from .route_registry import route
from .logger import logger

try:
    import aiohttp
except Exception:
    aiohttp = None

# ── 常量 ──────────────────────────────────────────────────────────────────────
_LORA_EXT = (".safetensors", ".ckpt", ".pt", ".pth")
_PREVIEW_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
_CACHE_TTL = 30.0  # 目录缓存刷新间隔（秒）
_PAGE_SIZE = 50

# ── 全局缓存 ──────────────────────────────────────────────────────────────────
_lora_scan_cache = {"data": None, "ts": 0.0, "lock": threading.Lock()}
_lora_selection_cache = {}  # node_id -> {selections: [...], weights: {...}}
_civitai_cache = {"lock": threading.Lock(), "data": {}}  # model_id -> {trainedWords, fetched_at}


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

                civitai_info_path = os.path.splitext(fp)[0] + ".civitai.info"
                if not os.path.isfile(civitai_info_path):
                    civitai_info_path = os.path.splitext(fp)[0] + ".json"
                if os.path.isfile(civitai_info_path):
                    try:
                        with open(civitai_info_path, "r", encoding="utf-8") as jf:
                            info = json.load(jf)
                        if isinstance(info, dict):
                            # civitai.info 格式
                            if not trigger_words and "trainedTags" in info:
                                trigger_words = [str(t).strip() for t in info["trainedTags"] if str(t).strip()]
                            elif not trigger_words and "activation text" in info:
                                trigger_words = [t.strip() for t in info["activation text"].split(",") if t.strip()]
                            model_id = info.get("modelId") or info.get("model_id") or info.get("id")
                            if model_id:
                                civitai_id = str(model_id)
                                civitai_url = f"https://civitai.com/models/{model_id}"
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
                    "civitaiUrl": civitai_url,
                    "size": os.path.getsize(fp),
                    "modified": os.path.getmtime(fp),
                })

    result = {"items": items, "folders": folders["_root"]["children"]}
    with _lora_scan_cache["lock"]:
        _lora_scan_cache["data"] = result
        _lora_scan_cache["ts"] = time.time()
    return result


def _clear_scan_cache():
    with _lora_scan_cache["lock"]:
        _lora_scan_cache["data"] = None
        _lora_scan_cache["ts"] = 0.0


# ── 路由 ──────────────────────────────────────────────────────────────────────

@route("GET", "/lora_gallery/folders")
async def lora_folders_route(request):
    try:
        data = _scan_loras()
        return web.json_response({"success": True, "folders": data["folders"]})
    except Exception as e:
        logger.error(f"[LoraGallery] folders error: {e}")
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
    """代理 LoRA 预览图，无预览时返回占位 SVG。"""
    try:
        lora_id = request.query.get("id", "")
        if not lora_id:
            return web.Response(status=400, text="missing id")

        data = _scan_loras()
        item = next((it for it in data["items"] if it["id"] == lora_id), None)
        if not item:
            return web.Response(status=404, text="not found")

        preview_path = item.get("preview", "")
        if preview_path and os.path.isfile(preview_path):
            try:
                with open(preview_path, "rb") as f:
                    img_bytes = f.read()
                ext = os.path.splitext(preview_path)[1].lower().lstrip(".")
                if ext == "jpg":
                    ext = "jpeg"
                return web.Response(body=img_bytes, headers={
                    "Content-Type": f"image/{ext}",
                    "Cache-Control": "public, max-age=86400"
                })
            except Exception as e:
                logger.warning(f"[LoraGallery] 读取预览图失败 {preview_path}: {e}")

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
    """读取 LoRA safetensors 元数据。"""
    try:
        lora_id = request.query.get("id", "")
        data = _scan_loras()
        item = next((it for it in data["items"] if it["id"] == lora_id), None)
        if not item:
            return web.json_response({"success": False, "error": "not found"}, status=404)

        path = item["path"]
        metadata = {}
        if path.lower().endswith(".safetensors"):
            try:
                with open(path, "rb") as f:
                    length = struct.unpack("Q", f.read(8))[0]
                    if length > 0:
                        metadata = json.loads(f.read(length).decode("utf-8"))
            except Exception as e:
                logger.warning(f"[LoraGallery] 读取元数据失败 {path}: {e}")

        return web.json_response({"success": True, "metadata": metadata})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def _fetch_civitai_model(model_id, api_key=""):
    """从 Civitai API 拉取模型触发词等元数据。"""
    if not model_id:
        return None
    model_id = str(model_id)
    now = time.time()
    with _civitai_cache["lock"]:
        cached = _civitai_cache["data"].get(model_id)
        if cached and (now - cached.get("fetched_at", 0)) < 3600:
            return cached

    if aiohttp is None:
        return None

    url = f"https://civitai.com/api/v1/models/{model_id}"
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
                        _civitai_cache["data"][model_id] = result
                    return result
                else:
                    text = await resp.text()
                    logger.warning(f"[LoraGallery] Civitai API HTTP {resp.status}: {text[:200]}")
    except Exception as e:
        logger.warning(f"[LoraGallery] Civitai API 请求失败: {e}")
    return None


@route("GET", "/lora_gallery/civitai_info")
async def lora_civitai_info_route(request):
    """查询单个 LoRA 的 Civitai 元数据，支持 API Key。"""
    try:
        lora_id = request.query.get("id", "")
        api_key = request.query.get("api_key", "")
        data = _scan_loras()
        item = next((it for it in data["items"] if it["id"] == lora_id), None)
        if not item:
            return web.json_response({"success": False, "error": "not found"}, status=404)

        model_id = item.get("civitaiId", "")
        local_words = item.get("triggerWords", [])
        info = None
        if model_id:
            info = await _fetch_civitai_model(model_id, api_key)

        return web.json_response({
            "success": True,
            "id": lora_id,
            "civitaiId": model_id,
            "civitaiUrl": item.get("civitaiUrl", ""),
            "localWords": local_words,
            "apiWords": info.get("trainedWords", []) if info else [],
            "cached": bool(info),
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
            model_id = item.get("civitaiId", "")
            info = await _fetch_civitai_model(model_id, api_key) if model_id else None
            results[lid] = {
                "civitaiId": model_id,
                "apiWords": info.get("trainedWords", []) if info else [],
                "cached": bool(info),
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
    try:
        timeout = aiohttp.ClientTimeout(total=600)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    return False, f"HTTP {resp.status}: {text[:200]}"
                with open(dest_path, "wb") as f:
                    async for chunk in resp.content.iter_chunked(1024 * 1024):
                        if chunk:
                            f.write(chunk)
                return True, ""
    except Exception as e:
        return False, str(e)


@route("POST", "/lora_gallery/download_preview")
async def lora_download_preview_route(request):
    """从 Civitai 下载模型预览图到 LoRA 同名路径。"""
    try:
        body = await request.json()
        lora_id = body.get("id", "")
        api_key = body.get("api_key", "")
        data = _scan_loras()
        item = next((it for it in data["items"] if it["id"] == lora_id), None)
        if not item:
            return web.json_response({"success": False, "error": "not found"}, status=404)

        # 如果已有预览图则直接返回成功
        if item.get("preview"):
            return web.json_response({"success": True, "path": item["preview"], "cached": True})

        model_id = item.get("civitaiId", "")
        if not model_id:
            return web.json_response({"success": False, "error": "no civitai id"})

        info = await _fetch_civitai_model(model_id, api_key)
        if not info:
            return web.json_response({"success": False, "error": "fetch civitai failed"})

        raw = info.get("raw", {})
        image_url = ""
        for ver in raw.get("modelVersions", []):
            images = ver.get("images", [])
            if images:
                image_url = images[0].get("url", "")
                if not image_url:
                    image_url = images[0].get("raw", "")
                if image_url:
                    break
        if not image_url:
            return web.json_response({"success": False, "error": "no preview image in civitai"})

        base = os.path.splitext(item["path"])[0]
        dest = base + ".png"
        ok, err = await _download_url(image_url, dest, api_key)
        if not ok:
            return web.json_response({"success": False, "error": err})

        _clear_scan_cache()
        return web.json_response({"success": True, "path": dest})
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
        data = _scan_loras()
        item = next((it for it in data["items"] if it["id"] == lora_id), None)
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
        target_dir = _get_lora_dirs()[0]
        if folder_id and folder_id != "_all":
            # folder_id 形如 loras/Noob/Artist Style，取后半部分
            rel = folder_id.split("/", 1)[1] if "/" in folder_id else folder_id
            cand = os.path.join(target_dir, rel)
            if os.path.isdir(cand):
                target_dir = cand

        # 从 Civitai API 获取版本详情
        if aiohttp is None:
            return web.json_response({"success": False, "error": "aiohttp not available"})
        url = f"https://civitai.com/api/v1/model-versions/{version_id}"
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

        name = file_info.get("name", f"{model_id}_{version_id}.safetensors")
        if not name.lower().endswith(_LORA_EXT):
            name += ".safetensors"
        dest = os.path.join(target_dir, name)

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
                "trigger_source": (["none", "file", "civitai", "merge"], {"default": "file"}),
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
    CATEGORY = "🦅 Eagle/工具"
    OUTPUT_NODE = True

    def load_loras(self, model, selection_data="[]", trigger_source="file", trigger_concat=True, clip=None, civitai_api_key="", manual_triggers="", **kwargs):
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
            return (model, clip, "[]", "")

        data = _scan_loras()
        id_to_item = {it["id"]: it for it in data["items"]}

        def _collect_triggers(item):
            """根据 trigger_source 收集触发词。"""
            local_words = [str(t).strip() for t in (item.get("triggerWords") or []) if str(t).strip()]
            if trigger_source == "none":
                return []
            if trigger_source == "file":
                return local_words
            if trigger_source == "civitai":
                model_id = item.get("civitaiId", "")
                if model_id:
                    # 同步获取 Civitai 触发词（有 1 小时缓存）
                    import asyncio
                    try:
                        info = asyncio.run(_fetch_civitai_model(model_id, civitai_api_key or ""))
                        if info and info.get("trainedWords"):
                            return [str(t).strip() for t in info["trainedWords"] if str(t).strip()]
                    except Exception as e:
                        logger.warning(f"[LoraGallery] 同步获取 Civitai 触发词失败 {model_id}: {e}")
                return local_words
            if trigger_source == "merge":
                model_id = item.get("civitaiId", "")
                merged = list(local_words)
                if model_id:
                    import asyncio
                    try:
                        info = asyncio.run(_fetch_civitai_model(model_id, civitai_api_key or ""))
                        if info and info.get("trainedWords"):
                            for t in info["trainedWords"]:
                                t = str(t).strip()
                                if t and t not in merged:
                                    merged.append(t)
                    except Exception as e:
                        logger.warning(f"[LoraGallery] 同步获取 Civitai 触发词失败 {model_id}: {e}")
                return merged
            return local_words

        applied = []
        all_triggers = []

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
                triggers = _collect_triggers(item)
                # loraTag: 可直接用于 prompt 的 <lora:name:weight> 格式
                lora_tag = f"<lora:{item['name']}:{w}>"
                applied.append({
                    "name": item["name"],
                    "path": path,
                    "weight": w,
                    "triggerWords": triggers,
                    "civitaiUrl": item.get("civitaiUrl", ""),
                    "loraTag": lora_tag,
                })
                if trigger_concat:
                    for t in triggers:
                        if t and t not in all_triggers:
                            all_triggers.append(t)
                logger.info(f"[LoraGallery] 已应用 LoRA: {item['name']} (weight={w}, triggers={len(triggers)})")
            except Exception as e:
                logger.error(f"[LoraGallery] 加载 LoRA 失败 {path}: {e}")

        # 追加手动触发词
        manual_list = [t.strip() for t in (manual_triggers or "").replace("\n", ",").split(",") if t.strip()]
        for t in manual_list:
            if t and t not in all_triggers:
                all_triggers.append(t)

        # 触发词输出：每个词后加逗号+空格，末尾也补逗号，方便直接拼接到 prompt
        trigger_str = ", ".join(all_triggers) + (", " if all_triggers else "")
        info_str = json.dumps(applied, ensure_ascii=False)

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
