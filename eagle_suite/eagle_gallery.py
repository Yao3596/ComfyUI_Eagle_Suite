# -*- coding: utf-8 -*-
"""
Eagle Suite - EagleGalleryNode
Eagle 图片浏览器节点（DOM Widget 型）
融合 Wallhaven Gallery 即时提交 + Danbooru Gallery 丰富筛选

后端职责：
  - Eagle API v1 代理路由（文件夹树 / 图片列表 / 缩略图 / 搜索）
  - EagleGalleryNode：接收 selection_data JSON → 输出 IMAGE 张量列表
"""

import os
import json
import io
import time
import hashlib
import urllib.parse
import threading

import requests
import torch
import numpy as np
from PIL import Image
from aiohttp import web
from server import PromptServer

from .logger import logger

# ── 常量 ──────────────────────────────────────────────────────────────────────
DEFAULT_EAGLE_URL = "http://localhost:41595"
EAGLE_API_V1 = f"{DEFAULT_EAGLE_URL}/api"

SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "eagle_gallery_settings.json")
PAGE_SIZE = 24


# ── 选中数据服务端缓存（绕过 widget 序列化不可靠问题） ────────────────────────
# 全局缓存：不区分 node_id，直接存最近一次的选中数据。
# 原理：用户通常只操作一个 EagleGallery 节点，每次选中都会更新缓存。
_selection_cache_entry: dict | None = None
_selection_cache_lock = threading.Lock()
_CACHE_TTL = 3600  # 缓存有效期 1 小时


def _cache_selection(data: dict):
    """将选中数据写入服务端全局缓存。"""
    global _selection_cache_entry
    with _selection_cache_lock:
        _selection_cache_entry = {
            "selections": data.get("selections", []),
            "outputMode": data.get("outputMode", "selection"),
            "folderId": data.get("folderId", ""),
            "timestamp": time.time(),
        }
    logger.info(f"[EagleGallery] 缓存选中数据: count={len(data.get('selections', []))}")


def _get_cached_selection() -> dict | None:
    """从服务端全局缓存读取选中数据。"""
    global _selection_cache_entry
    now = time.time()
    with _selection_cache_lock:
        if _selection_cache_entry and (now - _selection_cache_entry["timestamp"]) < _CACHE_TTL:
            return _selection_cache_entry
        _selection_cache_entry = None
    return None


# ── 配置读写 ──────────────────────────────────────────────────────────────────
_DEFAULT_SETTINGS = {
    "eagle_url": DEFAULT_EAGLE_URL,
    "page_size": 24,
}


def _load_settings() -> dict:
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                for k, v in _DEFAULT_SETTINGS.items():
                    if k not in data:
                        data[k] = v
                return data
    except Exception as e:
        logger.error(f"[EagleGallery] 加载设置失败: {e}")
    return dict(_DEFAULT_SETTINGS)


def _save_settings(settings: dict) -> bool:
    try:
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"[EagleGallery] 保存设置失败: {e}")
        return False


def _get_eagle_url() -> str:
    """返回 Eagle base URL（保留 scheme://host:port，用于构造 API 路径）。"""
    raw = _load_settings().get("eagle_url", DEFAULT_EAGLE_URL)
    try:
        p = urllib.parse.urlparse(raw)
        base = f"{p.scheme}://{p.netloc}"
        return base.rstrip("/")
    except Exception:
        return raw.rstrip("/")


def _get_eagle_token() -> str:
    """从保存的 Eagle URL 中提取 token 查询参数。"""
    raw = _load_settings().get("eagle_url", DEFAULT_EAGLE_URL)
    try:
        p = urllib.parse.urlparse(raw)
        qs = urllib.parse.parse_qs(p.query)
        tokens = qs.get("token", [])
        return tokens[0] if tokens else ""
    except Exception:
        return ""


# ── Eagle API 通用请求 ────────────────────────────────────────────────────────
def _eagle_request(method: str, endpoint: str, **kwargs):
    """向 Eagle API 发送请求，返回 (success, data_or_error)."""
    base = _get_eagle_url()
    url = f"{base}{endpoint}"

    # 自动附加 token（如果设置中保存了带 token 的 URL）
    token = _get_eagle_token()
    if token:
        if "params" in kwargs and isinstance(kwargs["params"], dict):
            kwargs["params"]["token"] = token
        else:
            kwargs.setdefault("params", {})["token"] = token

    try:
        resp = requests.request(method, url, timeout=kwargs.pop("timeout", 15), **kwargs)
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}"
        data = resp.json()
        if data.get("status") != "success":
            return False, data.get("message", "Eagle API 错误")
        return True, data.get("data", [])
    except requests.exceptions.ConnectionError:
        return False, "无法连接到 Eagle（请确认 Eagle 应用已启动且插件已启用）"
    except Exception as e:
        return False, str(e)


# ── aiohttp 路由 ──────────────────────────────────────────────────────────────

@PromptServer.instance.routes.get("/eagle_gallery/settings")
async def get_settings_route(request):
    try:
        s = _load_settings()
        return web.json_response({"success": True, "settings": s})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/eagle_gallery/cache_selection")
async def cache_selection_route(request):
    """前端选中图片后，将选中数据 POST 到此路由缓存到服务端。
    绕过 ComfyUI widget 序列化机制，确保后端能可靠读取选中数据。
    请求体: { "selections": [...] }
    """
    try:
        body = await request.json()
        selections = body.get("selections", [])
        _cache_selection({
            "selections": selections,
            "outputMode": body.get("outputMode", "selection"),
            "folderId": body.get("folderId", ""),
        })
        return web.json_response({"success": True, "count": len(selections)})
    except Exception as e:
        logger.error(f"[EagleGallery] cache_selection 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/eagle_gallery/settings")
async def save_settings_route(request):
    try:
        data = await request.json()
        current = _load_settings()
        for k in _DEFAULT_SETTINGS:
            if k in data:
                current[k] = data[k]
        ok = _save_settings(current)
        return web.json_response({"success": ok})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/eagle_gallery/folders")
async def folders_route(request):
    ok, data = _eagle_request("GET", "/api/folder/list")
    if not ok:
        return web.json_response({"success": False, "error": data}, status=500)
    return web.json_response({"success": True, "folders": data})


@PromptServer.instance.routes.get("/eagle_gallery/library")
async def library_route(request):
    ok, data = _eagle_request("GET", "/api/library/info")
    if not ok:
        return web.json_response({"success": False, "error": data}, status=500)
    return web.json_response({"success": True, "library": data})


@PromptServer.instance.routes.get("/eagle_gallery/tags")
async def tags_route(request):
    """获取 Eagle 库中所有标签，供前端标签过滤下拉框使用。"""
    try:
        ok, data = _eagle_request("GET", "/api/tag/list")
        if ok and isinstance(data, list):
            tags = [{"name": t.get("name", ""), "count": t.get("count", 0)} for t in data]
            return web.json_response({"success": True, "tags": tags})
        return web.json_response({"success": False, "error": str(data)}, status=500)
    except Exception as e:
        logger.error(f"[EagleGallery] tags 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/eagle_gallery/items")
async def items_route(request):
    try:
        body = await request.json()
        folder_id = body.get("folderId", "")
        keywords = body.get("keywords", "")
        tags = body.get("tags", [])
        star = body.get("star", "")
        shape = body.get("shape", "")
        load_all = body.get("all", False)
        order_by = body.get("orderBy", "")
        ext_filter = body.get("ext", [])
        colors = body.get("colors", "")
        resolution = body.get("resolution", "")

        # Eagle v1 /item/list 参数
        def _fetch_items(offset, limit):
            params = {"limit": limit, "offset": offset}
            if folder_id:
                params["folders"] = folder_id
            if keywords:
                params["keyword"] = keywords
            if tags:
                params["tags"] = ",".join(tags)
            if star and star != "全部":
                if star == "未评分":
                    params["star"] = 0
                else:
                    try:
                        params["star"] = int(star[0])
                    except ValueError:
                        pass
            if order_by:
                params["orderBy"] = order_by
            if ext_filter:
                params["ext"] = ",".join(ext_filter)
            if colors:
                params["colors"] = colors
            ok, data = _eagle_request("GET", "/api/item/list", params=params)
            if not ok:
                return None, data
            return data if isinstance(data, list) else [], None

        if load_all:
            # 循环获取全部数据
            all_items = []
            batch_limit = 2000
            offset = 0
            while True:
                batch, err = _fetch_items(offset, batch_limit)
                if err:
                    return web.json_response({"success": False, "error": err}, status=500)
                if not batch:
                    break
                all_items.extend(batch)
                if len(batch) < batch_limit:
                    break
                offset += batch_limit
            items = all_items
        else:
            page = max(1, int(body.get("page", 1)))
            limit = min(200, max(1, int(body.get("limit", PAGE_SIZE))))
            offset = (page - 1) * limit
            batch, err = _fetch_items(offset, limit)
            if err:
                return web.json_response({"success": False, "error": err}, status=500)
            items = batch

        # 客户端筛选：shape
        if shape and shape != "全部":
            filtered = []
            for item in items:
                w = item.get("width", 0)
                h = item.get("height", 0)
                if w == 0 or h == 0:
                    continue
                ratio = w / h if h > 0 else 1
                if shape == "横向" and ratio > 1.1:
                    filtered.append(item)
                elif shape == "纵向" and ratio < 0.9:
                    filtered.append(item)
                elif shape == "方形" and 0.9 <= ratio <= 1.1:
                    filtered.append(item)
            items = filtered

        # 客户端筛选：resolution（按最大边长）
        if resolution and resolution != "全部":
            min_sizes = {"4K": 3840, "2K": 2560, "1080p": 1920, "720p": 1280}
            min_size = min_sizes.get(resolution, 0)
            if min_size:
                items = [item for item in items
                         if max(item.get("width", 0), item.get("height", 0)) >= min_size]

        return web.json_response({"success": True, "items": items, "total": len(items)})

    except Exception as e:
        logger.error(f"[EagleGallery] items 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


def _read_local_image(file_path: str):
    """读取本地图片文件，返回 (bytes, mime_type) 或 (None, None)"""
    if not file_path or not os.path.isfile(file_path):
        return None, None
    try:
        with open(file_path, "rb") as f:
            img_data = f.read()
        ext = os.path.splitext(file_path)[1].lower()
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
                ".tiff": "image/tiff", ".tif": "image/tiff", ".avif": "image/avif"}.get(ext, "image/png")
        return img_data, mime
    except Exception as e:
        logger.warning(f"[EagleGallery] 读取本地图片失败 {file_path}: {e}")
        return None, None


@PromptServer.instance.routes.get("/eagle_gallery/thumbnail")
async def thumbnail_route(request):
    """代理 Eagle 缩略图请求。

    Eagle /api/item/thumbnail 返回 JSON:
      {"status":"success","data":"C:/path/to/thumb.png"}
    也可能直接返回图片二进制（较少见）。

    Fallback 链: thumbnail API → item info 的 thumbnailPath/thumbnail/filePath
    """
    item_id = request.query.get("id", "")
    if not item_id:
        return web.Response(status=400, text="missing id")

    base = _get_eagle_url()
    cache_headers = {"Cache-Control": "public, max-age=86400"}

    def _img_response(img_data: bytes, mime: str):
        return web.Response(body=img_data, headers={**cache_headers, "Content-Type": mime})

    # ── 辅助：从 URL 获取图片 ───────────────────────────────
    def fetch_image_from_url(img_url: str):
        try:
            r = requests.get(img_url, timeout=10)
            if r.status_code == 200 and r.content:
                return r.content, r.headers.get("Content-Type", "image/png")
        except Exception as e:
            logger.warning(f"[EagleGallery] 获取图片失败 {img_url}: {e}")
        return None, None

    # ── 辅助：尝试从路径加载图片 ─────────────────────────────
    def try_load_path(path: str):
        """尝试从本地路径或URL加载图片，返回 (img_data, mime) 或 (None, None)。"""
        if not path or not isinstance(path, str):
            return None, None

        # Eagle API 返回的路径可能是 URL 编码的（含 %XX），先解码
        decoded_path = urllib.parse.unquote(path)
        # 同时标准化路径分隔符（Windows 兼容）
        normalized_path = os.path.normpath(decoded_path)

        # 本地文件路径（先尝试解码后的，再尝试原始路径）
        for try_path in (normalized_path, decoded_path, path):
            if os.path.isfile(try_path):
                img_data, mime = _read_local_image(try_path)
                if img_data:
                    logger.info(f"[EagleGallery] 本地读取成功: {try_path}")
                    return img_data, mime

        # URL 路径
        if decoded_path.startswith("http"):
            return fetch_image_from_url(decoded_path)
        if decoded_path.startswith("/"):
            return fetch_image_from_url(f"{base}{decoded_path}")
        # 可能是相对路径或 Eagle 内部路径
        return None, None

    # ── 辅助：通过 Eagle HTTP 接口获取缩略图 ────────────────────
    def fetch_thumbnail_from_eagle_http(item_id: str):
        """尝试通过 Eagle 自身的 HTTP 服务获取缩略图（如 /thumbnail?id=xxx）。"""
        token = _get_eagle_token()
        for endpoint in ("/thumbnail", "/api/item/thumbnail"):
            try:
                params = {"id": item_id}
                if token:
                    params["token"] = token
                resp = requests.get(f"{base}{endpoint}", params=params, timeout=10)
                if resp.status_code == 200 and resp.content and len(resp.content) > 100:
                    ct = resp.headers.get("Content-Type", "image/png").lower()
                    if "image" in ct or ct.startswith("application/octet"):
                        logger.info(f"[EagleGallery] 通过 Eagle HTTP {endpoint} 获取缩略图成功 id={item_id}")
                        return resp.content, ct
            except Exception as e:
                logger.debug(f"[EagleGallery] Eagle HTTP {endpoint} 失败 id={item_id}: {e}")
        return None, None

    try:
        # ── 第1步：尝试 Eagle 缩略图 API ──────────────────────
        url = f"{base}/api/item/thumbnail"
        try:
            thumb_params = {"id": item_id}
            token = _get_eagle_token()
            if token:
                thumb_params["token"] = token
            resp = requests.get(url, params=thumb_params, timeout=10)
        except requests.exceptions.RequestException as e:
            logger.warning(f"[EagleGallery] 缩略图API请求失败 {item_id}: {e}")
            resp = None

        if resp is not None and resp.status_code == 200:
            ct = resp.headers.get("Content-Type", "").lower()
            content = resp.content

            # 判断响应是否为 JSON
            is_json = "application/json" in ct
            if not is_json and content and len(content) > 0:
                # 检查内容开头是否为 JSON 标识符
                is_json = content[0:1] in (b"{", b"[")

            if is_json:
                try:
                    data = resp.json()
                    # 检查 Eagle API status 字段
                    if isinstance(data, dict):
                        if data.get("status") != "success":
                            logger.warning(f"[EagleGallery] 缩略图API返回非成功状态 id={item_id}: {data.get('status')}")
                        else:
                            thumb_path = data.get("data", "")
                            if thumb_path and isinstance(thumb_path, str):
                                decoded = urllib.parse.unquote(thumb_path)
                                logger.info(f"[EagleGallery] 缩略图路径 id={item_id}: {thumb_path} (解码后: {decoded})")
                                img_data, mime = try_load_path(thumb_path)
                                if img_data:
                                    return _img_response(img_data, mime)
                                logger.warning(f"[EagleGallery] 缩略图路径无法加载 id={item_id} path={thumb_path} (解码后: {decoded})")
                except Exception as e:
                    logger.warning(f"[EagleGallery] 解析缩略图JSON失败 {item_id}: {e}")
            else:
                # 直接返回图片二进制
                if content and len(content) > 100:  # 确保不是空或极小响应
                    return _img_response(content, ct or "image/png")
                logger.warning(f"[EagleGallery] 缩略图API返回非JSON但内容过小 id={item_id} size={len(content)}")

        elif resp is not None:
            logger.warning(f"[EagleGallery] 缩略图API返回非200 id={item_id} status={resp.status_code}")

        # ── 第2步：备用——通过 item info 获取缩略图路径 ─────────
        ok, info = _eagle_request("GET", "/api/item/info", params={"id": item_id}, timeout=10)
        if ok and isinstance(info, dict):
            # 按优先级尝试不同的字段
            # thumbnailPath: Eagle 缓存的缩略图路径（Plugin API 中的字段名）
            # thumbnail: 旧版或自定义缩略图路径
            # filePath: 原图路径（最后手段，大图加载慢）
            for field in ("thumbnailPath", "thumbnail", "filePath"):
                path = info.get(field, "")
                if not path:
                    continue
                logger.info(f"[EagleGallery] 尝试通过 {field} 加载 id={item_id}: {path}")
                img_data, mime = try_load_path(path)
                if img_data:
                    logger.info(f"[EagleGallery] 通过 {field} 加载图片成功 id={item_id}")
                    return _img_response(img_data, mime)
                else:
                    logger.warning(f"[EagleGallery] 通过 {field} 加载失败 id={item_id}: {path}")

        # ── 第3步：最后手段——通过 Eagle HTTP 服务获取 ─────────────
        logger.info(f"[EagleGallery] 尝试通过 Eagle HTTP 获取缩略图 id={item_id}")
        img_data, mime = fetch_thumbnail_from_eagle_http(item_id)
        if img_data:
            return _img_response(img_data, mime)

        status_code = resp.status_code if resp is not None else "无响应"
        logger.warning(f"[EagleGallery] 无法获取缩略图 {item_id} (HTTP {status_code})")
        return web.Response(status=404)
    except Exception as e:
        logger.error(f"[EagleGallery] 缩略图代理失败 {item_id}: {e}")
        return web.Response(status=502, text="upstream error")


@PromptServer.instance.routes.post("/eagle_gallery/item_info")
async def item_info_route(request):
    """批量获取 item 详细信息（含构建的原图路径 filePath）。

    注意：Eagle API /api/item/info 不返回 filePath 字段，
    需要通过 library_path + item 信息构建原图路径。
    """
    try:
        body = await request.json()
        item_ids = body.get("ids", [])
        if not item_ids:
            return web.json_response({"success": False, "error": "无 item IDs"})

        # 获取资源库路径用于构建 filePath
        library_path = None
        try:
            ok, lib_data = _eagle_request("GET", "/api/library/info")
            if ok and isinstance(lib_data, dict):
                lib_obj = lib_data.get("library", {})
                if isinstance(lib_obj, dict):
                    lp = lib_obj.get("path", "")
                    if lp and os.path.isdir(lp):
                        library_path = lp
                if not library_path:
                    lp = lib_data.get("libraryPath", "")
                    if lp and os.path.isdir(lp):
                        library_path = lp
        except Exception:
            pass

        results = []
        for item_id in item_ids:
            ok, data = _eagle_request("GET", "/api/item/info", params={"id": item_id}, timeout=10)
            if ok and isinstance(data, dict):
                name = data.get("name", "")
                ext = data.get("ext", "")
                # 构建原图路径
                file_path = ""
                if library_path and name and ext:
                    built = os.path.join(library_path, "images", f"{item_id}.info", f"{name}.{ext}")
                    if os.path.exists(built):
                        file_path = built
                results.append({
                    "id": item_id,
                    "filePath": file_path,
                    "name": name,
                    "ext": ext,
                    "width": data.get("width", 0),
                    "height": data.get("height", 0),
                    "tags": data.get("tags", []),
                    "star": data.get("star", 0),
                    "annotation": data.get("annotation", ""),
                })

        return web.json_response({"success": True, "items": results})

    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


def _fetch_all_folder_items(folder_id):
    """通过 Eagle API 获取指定文件夹的全部图片列表（分页获取所有）。

    Returns:
        (items_list, error_string) — items_list 为字典列表，error 为 None 表示成功
    """
    all_items = []
    batch_limit = 2000
    offset = 0

    while True:
        params = {"limit": batch_limit, "offset": offset, "folders": folder_id}
        ok, data = _eagle_request("GET", "/api/item/list", params=params)
        if not ok:
            return None, str(data)
        if not isinstance(data, list) or not data:
            break
        all_items.extend(data)
        if len(data) < batch_limit:
            break
        offset += batch_limit

    return all_items, None


# ── ComfyUI 节点 ───────────────────────────────────────────────────────────────

class EagleGalleryNode:
    """
    Eagle Gallery — DOM Widget 型图片浏览器节点。
    前端浏览 Eagle 库，选中后输出 IMAGE 张量列表。

    选中数据传递机制：前端通过 HTTP POST 将选中数据缓存到服务端，
    后端 load_images 从服务端缓存读取，绕过 ComfyUI widget 序列化。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "selection_data": ("STRING", {"default": "{}", "multiline": False}),
                "sequence_mode": (["all_at_once", "sequential"], {"default": "all_at_once"}),
                "output_rgba": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("images", "masks", "tags", "selection_data", "file_paths")
    OUTPUT_IS_LIST = (False, False, True, False, True)
    FUNCTION = "load_images"
    CATEGORY = "🦅 Eagle"
    OUTPUT_NODE = False

    # ── 内部缓存（同类共享） ──────────────────────────────────────────────
    _item_cache: dict = {}   # item_id -> {filePath, name, tags, ...}

    def load_images(self, selection_data="{}", sequence_mode="all_at_once", sequence_index=0, output_rgba=False, **kwargs):
        """从选中数据加载图片，输出 IMAGE + MASK + tags + file_paths。

        支持两种输出模式：
        - selection 模式：仅输出用户手动选中的图片
        - folder 模式：输出整个文件夹的所有图片

        顺序输出模式：
        - sequence_mode="all_at_once"：一次性输出全部图片（batch）
        - sequence_mode="sequential"：每次只输出一张，按 sequence_index 索引

        RGBA 输出模式：
        - output_rgba=False（默认）：IMAGE 输出为 3 通道 RGB，Alpha 剥离到 MASK
        - output_rgba=True：IMAGE 输出为 4 通道 RGBA（保留 Alpha），MASK 仍从 A 通道生成
        """

        # ── 读取选中数据 ─────────────────────────────────────────────
        selections = self._read_selections(selection_data)
        logger.info(f"[EagleGallery] _read_selections 返回 {len(selections)} 项数据")

        # ── 判断输出模式 ─────────────────────────────────────────────
        output_mode = "selection"
        cached = _get_cached_selection()
        folder_id = ""

        if cached:
            output_mode = cached.get("outputMode", "selection") or "selection"
            folder_id = cached.get("folderId", "")
            logger.info(f"[EagleGallery] 从缓存获取 output_mode={output_mode}, folderId={folder_id}")

        # 如果缓存没有 folder 信息，尝试从 selections 中检测文件夹模式标记
        if output_mode != "folder" and selections:
            first_sel = selections[0] if selections else {}
            if first_sel.get("outputMode") == "folder":
                output_mode = "folder"
                folder_id = first_sel.get("folderId", "")
                logger.info(f"[EagleGallery] 从 selections 检测到文件夹模式, folderId={folder_id}")

        if output_mode == "folder":
            # 文件夹模式：从缓存或 selections 中获取 folderId，调用 Eagle API 获取全部图片
            if not folder_id and cached:
                folder_id = cached.get("folderId", "")
            if not folder_id and selections:
                folder_id = selections[0].get("folderId", "")

            if folder_id:
                logger.info(f"[EagleGallery] 文件夹模式：加载文件夹 {folder_id} 的全部图片")
                all_items, err = _fetch_all_folder_items(folder_id)
                if err:
                    logger.error(f"[EagleGallery] 获取文件夹图片失败: {err}")
                    return self._empty_output()
                if not all_items:
                    logger.warning(f"[EagleGallery] 文件夹 {folder_id} 中无图片")
                    return self._empty_output()
                selections = [
                    {
                        "id": item.get("id", ""),
                        "name": item.get("name", ""),
                        "ext": item.get("ext", ""),
                        "tags": item.get("tags", []),
                        "width": item.get("width", 0),
                        "height": item.get("height", 0),
                        "star": item.get("star", 0),
                    }
                    for item in all_items
                ]
                logger.info(f"[EagleGallery] 文件夹模式：从 Eagle API 获取 {len(selections)} 张图片")
            else:
                logger.warning("[EagleGallery] 文件夹模式但未指定 folderId，回退到选择模式")
                output_mode = "selection"

        if not selections:
            logger.warning("[EagleGallery] 无选中数据")
            return self._empty_output()

        # ── 顺序输出模式处理 ─────────────────────────────────────────
        total = len(selections)
        if sequence_mode == "sequential":
            # 循环索引：超过总数时回到开头
            effective_index = sequence_index % total if total > 0 else 0
            selections = [selections[effective_index]] if total > 0 else []
            logger.info(f"[EagleGallery] 顺序模式：输出第 {effective_index + 1}/{total} 张图片 (原始索引: {sequence_index})")
        else:
            logger.info(f"[EagleGallery] 批量模式：输出全部 {total} 张图片")

        if not selections:
            return self._empty_output()

        # ── 获取 Eagle 资源库路径 ────────────────────────────────────
        library_path = self._get_library_path()

        # ── 加载图片 ────────────────────────────────────────────────
        images = []
        masks = []
        tags_list = []
        file_paths = []
        mode_label = "文件夹" if output_mode == "folder" else "选择"
        logger.info(f"[EagleGallery] {mode_label}模式：开始加载 {len(selections)} 张图片")

        for sel in selections:
            tensor, mask_tensor, tags_str, fpath = self._load_image_item(sel, library_path, output_rgba)
            images.append(tensor)
            masks.append(mask_tensor)
            tags_list.append(tags_str)
            file_paths.append(fpath)

        if not images:
            return self._empty_output()

        # ── 统一尺寸并堆叠为 batch 张量 ─────────────────────────────
        # ComfyUI 的 IMAGE 类型期望 (B, H, W, 3) 的 batch 张量
        # 找到最大宽高，将所有图片 pad 到统一尺寸（居中，黑色填充）
        max_h = max(img.shape[1] for img in images)
        max_w = max(img.shape[2] for img in images)

        padded_images = []
        padded_masks = []
        for img_tensor, mask_tensor in zip(images, masks):
            h, w = img_tensor.shape[1], img_tensor.shape[2]
            if h == max_h and w == max_w:
                padded_images.append(img_tensor)
                padded_masks.append(mask_tensor)
            else:
                # 居中 pad
                pad_top = (max_h - h) // 2
                pad_bottom = max_h - h - pad_top
                pad_left = (max_w - w) // 2
                pad_right = max_w - w - pad_left

                # IMAGE: (1, H, W, 3) → pad 最后两个维度
                padded_img = torch.nn.functional.pad(
                    img_tensor, (0, 0, pad_left, pad_right, pad_top, pad_bottom, 0, 0), value=0
                )
                padded_images.append(padded_img)

                # MASK: (1, H, W, 1) → pad 最后两个维度
                padded_mask = torch.nn.functional.pad(
                    mask_tensor, (0, 0, pad_left, pad_right, pad_top, pad_bottom, 0, 0), value=0
                )
                padded_masks.append(padded_mask)

        # 堆叠为 batch: (B, H, W, 3) 和 (B, H, W, 1)
        image_batch = torch.cat(padded_images, dim=0)
        mask_batch = torch.cat(padded_masks, dim=0)

        logger.info(f"[EagleGallery] 输出 batch: {image_batch.shape}, mask: {mask_batch.shape}")
        raw_data = json.dumps({"selections": selections, "outputMode": output_mode})
        return (image_batch, mask_batch, tags_list, raw_data, file_paths)

    @staticmethod
    def _empty_output():
        """返回空的占位输出。"""
        return (
            torch.zeros(1, 64, 64, 3),
            torch.ones(1, 64, 64, 1),
            [""],
            "{}",
            [""],
        )

    def _read_selections(self, selection_data="{}"):
        """读取选中数据，支持缓存/widget/参数三种来源。返回 selections 列表。"""
        selections = []

        # 1) 优先从服务端缓存读取（最可靠的方式，绕过 widget 序列化）
        cached = _get_cached_selection()
        if cached and cached.get("selections"):
            selections = cached["selections"]
            logger.info(f"[EagleGallery] 从服务端缓存获取 {len(selections)} 项选中数据, outputMode={cached.get('outputMode', 'selection')}")
            return selections

        # 2) fallback: 从 widget / input / _selection_data 读取
        raw_data = "{}"
        for widget in getattr(self, 'widgets', []):
            if getattr(widget, 'name', None) == 'selection_data':
                val = getattr(widget, 'value', None)
                if val and val != "{}":
                    raw_data = val
                    break
        if raw_data == "{}":
            for inp in getattr(self, 'inputs', []):
                if getattr(inp, 'name', None) == 'selection_data':
                    val = getattr(inp, 'value', None)
                    if val and val != "{}":
                        raw_data = val
                        break
        if raw_data == "{}":
            val = getattr(self, '_selection_data', None)
            if val and val != "{}":
                raw_data = val
        if raw_data == "{}":
            raw_data = selection_data if selection_data else "{}"

        if raw_data and raw_data != "{}":
            try:
                data = json.loads(raw_data) if isinstance(raw_data, str) else raw_data
                selections = data.get("selections", [])
                output_mode = data.get("outputMode", "selection")
                folder_id = data.get("folderId", "")
                # 如果检测到文件夹模式标记，同步到服务端缓存，确保后续 _get_cached_selection 能获取到
                if output_mode == "folder" and folder_id and selections:
                    _cache_selection({
                        "selections": selections,
                        "outputMode": "folder",
                        "folderId": folder_id,
                    })
                    logger.info(f"[EagleGallery] 从 selection_data 检测到文件夹模式, folderId={folder_id}, 已同步到缓存")
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"[EagleGallery] 解析 selection_data 失败: {e}")

        return selections

    def _load_image_item(self, sel, library_path, output_rgba=False):
        """加载单张图片，返回 (tensor, mask_tensor, tags_str, file_path)。

        - tensor: (1,H,W,3) RGB 或 (1,H,W,4) RGBA 图像张量（取决于 output_rgba）
        - mask_tensor: (1,H,W,1) alpha 掩码张量（无alpha时全1）
        - tags_str: 标签字符串
        - file_path: 原始文件路径（可能为空字符串）
        """
        item_id = sel.get("id", "")
        file_path = sel.get("filePath", "")
        tags = sel.get("tags", [])
        name = sel.get("name", "")
        ext = sel.get("ext", "")

        tags_str = ", ".join([str(t) for t in tags if t]) if tags else ""

        img = None
        load_method = ""

        # 第1级：本地路径构建 library_path/images/{id}.info/{name}.{ext}（原图路径）
        if img is None and library_path:
            built_path = self._build_image_path(library_path, sel)
            if built_path:
                try:
                    img = Image.open(built_path)
                    img.load()
                    load_method = "本地路径构建(原图)"
                    file_path = built_path
                except Exception as e:
                    logger.warning(f"[EagleGallery] 原图路径构建加载失败 {built_path}: {e}")
                    img = None

        # 第1.5级：目录扫描 .info 目录
        if img is None and library_path and item_id:
            info_dir = os.path.join(library_path, "images", f"{item_id}.info")
            if os.path.isdir(info_dir):
                supported_ext = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".avif"}
                thumb_suffix = "_thumbnail"
                # 收集所有候选文件，优先选择非缩略图
                candidates = []
                for fname in os.listdir(info_dir):
                    fpath = os.path.join(info_dir, fname)
                    if fname == "metadata.json":
                        continue
                    if not os.path.isfile(fpath):
                        continue
                    base_name, fext = os.path.splitext(fname)
                    if fext.lower() not in supported_ext:
                        continue
                    if base_name.endswith(thumb_suffix):
                        continue
                    # 优先级：有精确名称匹配的排最前
                    priority = 0
                    if name and base_name == name:
                        priority = 2  # 精确匹配最高优先级
                    elif ext and fext.lower() == f".{ext.lower()}":
                        priority = 1  # 扩展名匹配次高
                    candidates.append((priority, fpath, fname))

                # 按优先级排序（高优先级在前）
                candidates.sort(key=lambda x: x[0], reverse=True)

                for _priority, fpath, fname in candidates:
                    try:
                        img = Image.open(fpath)
                        img.load()
                        load_method = "目录扫描(原图)"
                        file_path = fpath
                        logger.info(f"[EagleGallery] 通过目录扫描找到原图: {fpath}")
                        break
                    except Exception as e:
                        logger.warning(f"[EagleGallery] 目录扫描文件加载失败 {fpath}: {e}")

        # 第2级：filePath 直读 / API filePath
        if img is None and file_path and os.path.exists(file_path):
            try:
                img = Image.open(file_path)
                img.load()
                load_method = "filePath直读"
            except Exception as e:
                logger.warning(f"[EagleGallery] filePath 直读失败 {file_path}: {e}")
                img = None

        if img is None and (not file_path or not os.path.exists(file_path)):
            api_path = self._get_filepath_from_api(item_id)
            if api_path:
                try:
                    img = Image.open(api_path)
                    img.load()
                    load_method = "API filePath"
                    file_path = api_path
                except Exception as e:
                    logger.warning(f"[EagleGallery] API filePath 加载失败 {api_path}: {e}")
                    img = None

        # 第3级：Eagle 缩略图 API（最后手段）
        if img is None:
            thumb_img = self._load_from_thumbnail(item_id)
            if thumb_img:
                img = thumb_img
                load_method = "Eagle缩略图(低分辨率)"

        # 转换为张量（RGBA 模式决定是否保留 Alpha 通道）
        if img is not None:
            try:
                alpha_channel = None
                original_mode = img.mode

                # RGBA 模式处理
                if output_rgba:
                    # 如果原图是 RGBA，保持 RGBA
                    if img.mode == "RGBA":
                        alpha_channel = img.split()[3]  # 提取 A 通道用于 MASK
                        # img 保持 RGBA 四通道
                    elif img.mode == "LA":
                        # LA -> RGBA（L 复制到 RGB，A 作为 Alpha）
                        l_channel, a_channel = img.split()
                        alpha_channel = a_channel
                        img = Image.merge("RGBA", (l_channel, l_channel, l_channel, a_channel))
                    elif img.mode == "PA":
                        # PA -> RGBA
                        rgba = img.convert("RGBA")
                        alpha_channel = rgba.split()[3]
                        img = rgba
                    elif img.mode == "P":
                        # 调色板模式：检查 transparency
                        if "transparency" in img.info:
                            rgba = img.convert("RGBA")
                            alpha_channel = rgba.split()[3]
                            img = rgba
                        else:
                            img = img.convert("RGBA")
                    elif img.mode == "L":
                        # 灰度图 -> RGBA（A=1）
                        img = img.convert("RGBA")
                    else:
                        # 其他模式（RGB, CMYK 等）-> RGBA（A=1）
                        img = img.convert("RGBA")
                else:
                    # 默认模式：剥离 Alpha 到 MASK，转 RGB
                    if img.mode == "RGBA":
                        alpha_channel = img.split()[3]
                        img = img.convert("RGB")
                    elif img.mode == "LA":
                        alpha_channel = img.split()[1]
                        img = img.convert("RGB")
                    elif img.mode == "PA":
                        # PA: 带alpha的调色板模式，先转RGBA再提取alpha
                        alpha_channel = img.convert("RGBA").split()[3]
                        img = img.convert("RGB")
                    elif img.mode == "P":
                        # 调色板模式：检查 transparency 信息
                        if "transparency" in img.info:
                            alpha_channel = img.convert("RGBA").split()[3]
                        img = img.convert("RGB")
                    elif img.mode == "L":
                        # 灰度图无alpha，直接转RGB
                        img = img.convert("RGB")
                    else:
                        img = img.convert("RGB")

                arr = np.array(img).astype(np.float32) / 255.0
                tensor = torch.from_numpy(arr)[None,]        # (1, H, W, 3) 或 (1, H, W, 4)

                # Alpha → MASK 张量
                if alpha_channel is not None:
                    mask_arr = np.array(alpha_channel).astype(np.float32) / 255.0
                    mask_tensor = torch.from_numpy(mask_arr)[None, ..., None]  # (1,H,W,1)
                else:
                    # 无 Alpha 通道时生成全 1 的 MASK
                    h, w = arr.shape[0], arr.shape[1]
                    mask_tensor = torch.ones(1, h, w, 1)

                logger.info(f"[EagleGallery] 加载成功: {name} ({img.size[0]}x{img.size[1]}) mode={original_mode}->{img.mode} [{load_method}] RGBA={output_rgba}")
                return (tensor, mask_tensor, tags_str, file_path or "")
            except Exception as e:
                logger.error(f"[EagleGallery] 张量转换失败 {name}: {e}")
                return (torch.zeros(1, 64, 64, 3), torch.ones(1, 64, 64, 1), "", "")
        else:
            logger.warning(f"[EagleGallery] 无法加载图片: {name or item_id}")
            return (torch.zeros(1, 64, 64, 3), torch.ones(1, 64, 64, 1), "", "")

    # ── 图片加载辅助方法（参考 EagleLoader 三级回退） ────────────────────

    def _get_library_path(self) -> str | None:
        """获取 Eagle 资源库路径。

        Eagle 4.0 API 返回格式：data.library.path（嵌套对象）
        旧版可能返回 data.libraryPath（平铺字段）
        两种格式都尝试，兼容不同版本。
        """
        try:
            ok, data = _eagle_request("GET", "/api/library/info")
            if ok and isinstance(data, dict):
                # Eagle 4.0+ 格式: data.library.path
                lib_obj = data.get("library", {})
                if isinstance(lib_obj, dict):
                    path = lib_obj.get("path", "")
                    if path and os.path.isdir(path):
                        logger.info(f"[EagleGallery] 获取资源库路径(Eagle 4.0格式): {path}")
                        return path
                # 旧版格式: data.libraryPath
                path = data.get("libraryPath", "")
                if path and os.path.isdir(path):
                    logger.info(f"[EagleGallery] 获取资源库路径(旧版格式): {path}")
                    return path
                logger.warning(f"[EagleGallery] 无法从 API 获取资源库路径, data keys: {list(data.keys())}")
        except Exception as e:
            logger.warning(f"[EagleGallery] 获取资源库路径失败: {e}")
        return None

    def _get_filepath_from_api(self, item_id: str) -> str | None:
        """通过 Eagle API /api/item/info 获取图片的原始文件路径。

        注意：Eagle 的 /api/item/info 通常不返回 filePath 字段！
        此方法主要作为兼容层，优先尝试 API 返回的 filePath（如果有的话）。
        实际获取原图应依赖 _build_image_path() 用 library_path 构建。
        """
        if not item_id:
            return None

        # 先查缓存
        if item_id in self._item_cache:
            cached_path = self._item_cache[item_id].get("filePath", "")
            if cached_path:
                decoded = urllib.parse.unquote(cached_path)
                for try_path in (cached_path, decoded, os.path.normpath(decoded)):
                    if try_path and os.path.exists(try_path):
                        return try_path

        # 调用 API 获取 item 信息
        try:
            ok, data = _eagle_request("GET", "/api/item/info", params={"id": item_id}, timeout=10)
            if ok and isinstance(data, dict):
                # 更新缓存
                self._item_cache[item_id] = data

                # 尝试 filePath 字段（某些 Eagle 版本可能存在）
                fp = data.get("filePath", "")
                if fp:
                    decoded = urllib.parse.unquote(fp)
                    for try_path in (fp, decoded, os.path.normpath(decoded)):
                        if try_path and os.path.exists(try_path):
                            return try_path
                    # filePath 存在但本地访问不到（不返回，让上层用 library_path 构建）
        except Exception as e:
            logger.warning(f"[EagleGallery] API 获取文件路径失败 {item_id}: {e}")
        return None

    def _build_image_path(self, library_path: str, sel: dict) -> str | None:
        """根据 library_path + item 信息构建本地原图路径。

        Eagle 存储规则：
          原图: {library_path}/images/{id}.info/{name}.{ext}
          缩略图: {library_path}/images/{id}.info/{name}_thumbnail.png
        此方法只返回原图路径，跳过缩略图。
        """
        item_id = sel.get("id", "")
        name = sel.get("name", "")
        ext = sel.get("ext", "png")
        if not item_id or not name:
            return None
        image_folder = os.path.join(library_path, "images", f"{item_id}.info")
        # 尝试精确路径
        image_path = os.path.join(image_folder, f"{name}.{ext}")
        if os.path.exists(image_path):
            return image_path
        # URL 解码后重试（name 可能含中文/特殊字符）
        decoded_name = urllib.parse.unquote(name)
        if decoded_name != name:
            image_path = os.path.join(image_folder, f"{decoded_name}.{ext}")
            if os.path.exists(image_path):
                return image_path
        # 扫描 .info 目录找原图文件（跳过缩略图和 metadata）
        if os.path.exists(image_folder):
            supported_ext = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".avif"}
            candidates = []
            for file in os.listdir(image_folder):
                if file == "metadata.json":
                    continue
                fpath = os.path.join(image_folder, file)
                if not os.path.isfile(fpath):
                    continue
                base_name, fext = os.path.splitext(file)
                if fext.lower() not in supported_ext:
                    continue
                # 跳过缩略图（文件名以 _thumbnail 结尾）
                if base_name.endswith("_thumbnail"):
                    continue
                # 优先选择精确名称匹配的文件
                priority = 0
                if base_name == name:
                    priority = 2
                elif ext and fext.lower() == f".{ext.lower()}":
                    priority = 1
                candidates.append((priority, fpath))

            # 按优先级排序，返回最佳匹配
            if candidates:
                candidates.sort(key=lambda x: x[0], reverse=True)
                return candidates[0][1]
        return None

    def _load_from_thumbnail(self, item_id: str) -> Image.Image | None:
        """通过 Eagle 缩略图 API 加载图片（最后手段）。"""
        if not item_id:
            return None
        try:
            base = _get_eagle_url()
            token = _get_eagle_token()
            params = {"id": item_id}
            if token:
                params["token"] = token
            resp = requests.get(f"{base}/api/item/thumbnail", params=params, timeout=10)
            if resp.status_code == 200:
                ct = resp.headers.get('content-type', '')
                content = resp.content
                # JSON 响应：包含缩略图路径
                is_json = "application/json" in ct or (content and len(content) > 0 and content[0:1] in (b"{", b"["))
                if is_json:
                    try:
                        data = resp.json()
                        if data.get("status") == "success":
                            thumb_path = data.get("data", "")
                            if thumb_path:
                                decoded = urllib.parse.unquote(thumb_path)
                                for try_path in (decoded, thumb_path, os.path.normpath(decoded)):
                                    if os.path.isfile(try_path):
                                        return Image.open(try_path)
                    except Exception:
                        pass
                # 直接图片二进制
                elif "image" in ct and len(content) >= 100:
                    return Image.open(io.BytesIO(content))
        except Exception as e:
            logger.warning(f"[EagleGallery] 缩略图加载失败 {item_id}: {e}")
        return None


__all__ = ["EagleGalleryNode"]
