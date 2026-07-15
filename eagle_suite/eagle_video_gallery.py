# -*- coding: utf-8 -*-
"""
Eagle Suite - EagleVideoGalleryNode
Eagle 视频浏览器节点（DOM Widget 型）
支持浏览 Eagle 库中的视频文件，提供缩略图预览和视频文件路径输出

后端职责：
  - Eagle API v1 代理路由（文件夹树 / 视频列表 / 缩略图 / 搜索）
  - EagleVideoGalleryNode：接收 selection_data JSON → 输出 IMAGE（缩略图）+ 视频文件路径列表
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
from .route_registry import route
from .logger import logger

# ── 常量 ──────────────────────────────────────────────────────────────────────
DEFAULT_EAGLE_URL = "http://localhost:41595"
EAGLE_API_V1 = f"{DEFAULT_EAGLE_URL}/api"

SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "eagle_gallery_settings.json")
PAGE_SIZE = 24

# 视频文件扩展名
VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg"]

# ── 选中数据服务端缓存（绕过 widget 序列化不可靠问题） ────────────────────────
# 全局缓存：不区分 node_id，直接存最近一次的选中数据。
# 原理：用户通常只操作一个 EagleVideoGallery 节点，每次选中都会更新缓存。
_video_selection_cache_entry: dict | None = None
_video_selection_cache_lock = threading.Lock()
_VIDEO_CACHE_TTL = 3600  # 缓存有效期 1 小时


def _cache_video_selection(data: dict):
    """将选中数据写入服务端全局缓存。"""
    global _video_selection_cache_entry
    with _video_selection_cache_lock:
        _video_selection_cache_entry = {
            "selections": data.get("selections", []),
            "outputMode": data.get("outputMode", "selection"),
            "folderId": data.get("folderId", ""),
            "timestamp": time.time(),
        }
    logger.info(f"[EagleVideoGallery] 缓存选中数据: count={len(data.get('selections', []))}")


def _get_cached_video_selection() -> dict | None:
    """从服务端全局缓存读取选中数据。"""
    global _video_selection_cache_entry
    now = time.time()
    with _video_selection_cache_lock:
        if _video_selection_cache_entry and (now - _video_selection_cache_entry["timestamp"]) < _VIDEO_CACHE_TTL:
            return _video_selection_cache_entry
        _video_selection_cache_entry = None
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
        logger.error(f"[EagleVideoGallery] 加载设置失败: {e}")
    return dict(_DEFAULT_SETTINGS)


def _save_settings(settings: dict) -> bool:
    try:
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"[EagleVideoGallery] 保存设置失败: {e}")
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

@route("GET", "/eagle_video_gallery/settings")
async def get_video_settings_route(request):
    try:
        s = _load_settings()
        return web.json_response({"success": True, "settings": s})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eagle_video_gallery/cache_selection")
async def cache_video_selection_route(request):
    """前端选中视频后，将选中数据 POST 到此路由缓存到服务端。
    绕过 ComfyUI widget 序列化机制，确保后端能可靠读取选中数据。
    请求体: { "selections": [...] }
    """
    try:
        body = await request.json()
        selections = body.get("selections", [])
        _cache_video_selection({
            "selections": selections,
            "outputMode": body.get("outputMode", "selection"),
            "folderId": body.get("folderId", ""),
        })
        return web.json_response({"success": True, "count": len(selections)})
    except Exception as e:
        logger.error(f"[EagleVideoGallery] cache_selection 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eagle_video_gallery/settings")
async def save_video_settings_route(request):
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


@route("GET", "/eagle_video_gallery/folders")
async def video_folders_route(request):
    ok, data = _eagle_request("GET", "/api/folder/list")
    if not ok:
        return web.json_response({"success": False, "error": data}, status=500)
    return web.json_response({"success": True, "folders": data})


@route("GET", "/eagle_video_gallery/library")
async def video_library_route(request):
    ok, data = _eagle_request("GET", "/api/library/info")
    if not ok:
        return web.json_response({"success": False, "error": data}, status=500)
    return web.json_response({"success": True, "library": data})


@route("GET", "/eagle_video_gallery/tags")
async def video_tags_route(request):
    """获取 Eagle 库中所有标签，供前端标签过滤下拉框使用。"""
    try:
        ok, data = _eagle_request("GET", "/api/tag/list")
        if ok and isinstance(data, list):
            tags = [{"name": t.get("name", ""), "count": t.get("count", 0)} for t in data]
            return web.json_response({"success": True, "tags": tags})
        return web.json_response({"success": False, "error": str(data)}, status=500)
    except Exception as e:
        logger.error(f"[EagleVideoGallery] tags 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eagle_video_gallery/items")
async def video_items_route(request):
    try:
        body = await request.json()
        folder_id = body.get("folderId", "")
        keywords = body.get("keywords", "")
        tags = body.get("tags", [])
        star = body.get("star", "")
        shape = body.get("shape", "")
        load_all = body.get("all", False)
        order_by = body.get("orderBy", "")
        colors = body.get("colors", "")

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
            if colors:
                params["colors"] = colors
            # 只获取视频文件
            params["ext"] = ",".join([ext.lstrip(".") for ext in VIDEO_EXTENSIONS])
            
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

        return web.json_response({"success": True, "items": items, "total": len(items)})

    except Exception as e:
        logger.error(f"[EagleVideoGallery] items 路由错误: {e}")
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
        logger.warning(f"[EagleVideoGallery] 读取本地图片失败 {file_path}: {e}")
        return None, None


@route("GET", "/eagle_video_gallery/thumbnail")
async def video_thumbnail_route(request):
    """代理 Eagle 缩略图请求（视频文件）。
    
    视频文件的缩略图获取逻辑与图片相同，Eagle 会为视频生成预览缩略图。
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
            logger.warning(f"[EagleVideoGallery] 获取图片失败 {img_url}: {e}")
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
                    logger.info(f"[EagleVideoGallery] 本地读取成功: {try_path}")
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
                        logger.info(f"[EagleVideoGallery] 通过 Eagle HTTP {endpoint} 获取缩略图成功 id={item_id}")
                        return resp.content, ct
            except Exception as e:
                logger.debug(f"[EagleVideoGallery] Eagle HTTP {endpoint} 失败 id={item_id}: {e}")
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
            logger.warning(f"[EagleVideoGallery] 缩略图API请求失败 {item_id}: {e}")
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
                            logger.warning(f"[EagleVideoGallery] 缩略图API返回非成功状态 id={item_id}: {data.get('status')}")
                        else:
                            thumb_path = data.get("data", "")
                            if thumb_path and isinstance(thumb_path, str):
                                decoded = urllib.parse.unquote(thumb_path)
                                logger.info(f"[EagleVideoGallery] 缩略图路径 id={item_id}: {thumb_path} (解码后: {decoded})")
                                img_data, mime = try_load_path(thumb_path)
                                if img_data:
                                    return _img_response(img_data, mime)
                                logger.warning(f"[EagleVideoGallery] 缩略图路径无法加载 id={item_id} path={thumb_path} (解码后: {decoded})")
                except Exception as e:
                    logger.warning(f"[EagleVideoGallery] 解析缩略图JSON失败 {item_id}: {e}")
            else:
                # 直接返回图片二进制
                if content and len(content) > 100:  # 确保不是空或极小响应
                    return _img_response(content, ct or "image/png")
                logger.warning(f"[EagleVideoGallery] 缩略图API返回非JSON但内容过小 id={item_id} size={len(content)}")

        elif resp is not None:
            logger.warning(f"[EagleVideoGallery] 缩略图API返回非200 id={item_id} status={resp.status_code}")

        # ── 第2步：备用——通过 item info 获取缩略图路径 ─────────
        ok, info = _eagle_request("GET", "/api/item/info", params={"id": item_id}, timeout=10)
        if ok and isinstance(info, dict):
            # 按优先级尝试不同的字段
            # thumbnailPath: Eagle 缓存的缩略图路径（Plugin API 中的字段名）
            # thumbnail: 旧版或自定义缩略图路径
            # filePath: 原视频路径（最后手段，大文件加载慢）
            for field in ("thumbnailPath", "thumbnail", "filePath"):
                path = info.get(field, "")
                if not path:
                    continue
                logger.info(f"[EagleVideoGallery] 尝试通过 {field} 加载 id={item_id}: {path}")
                img_data, mime = try_load_path(path)
                if img_data:
                    logger.info(f"[EagleVideoGallery] 通过 {field} 加载图片成功 id={item_id}")
                    return _img_response(img_data, mime)
                else:
                    logger.warning(f"[EagleVideoGallery] 通过 {field} 加载失败 id={item_id}: {path}")

        # ── 第3步：最后手段——通过 Eagle HTTP 服务获取 ─────────────
        logger.info(f"[EagleVideoGallery] 尝试通过 Eagle HTTP 获取缩略图 id={item_id}")
        img_data, mime = fetch_thumbnail_from_eagle_http(item_id)
        if img_data:
            return _img_response(img_data, mime)

        status_code = resp.status_code if resp is not None else "无响应"
        logger.warning(f"[EagleVideoGallery] 无法获取缩略图 {item_id} (HTTP {status_code})")
        return web.Response(status=404)
    except Exception as e:
        logger.error(f"[EagleVideoGallery] 缩略图代理失败 {item_id}: {e}")
        return web.Response(status=502, text="upstream error")


@route("POST", "/eagle_video_gallery/item_info")
async def video_item_info_route(request):
    """批量获取 item 详细信息（含构建的视频文件路径 filePath）。"""
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
                # 构建视频文件路径
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


def _fetch_all_video_folder_items(folder_id):
    """通过 Eagle API 获取指定文件夹的全部视频列表（分页获取所有）。"""
    all_items = []
    batch_limit = 2000
    offset = 0

    while True:
        params = {"limit": batch_limit, "offset": offset, "folders": folder_id}
        # 只获取视频文件
        params["ext"] = ",".join([ext.lstrip(".") for ext in VIDEO_EXTENSIONS])
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

class EagleVideoGalleryNode:
    """
    Eagle Video Gallery — DOM Widget 型视频浏览器节点。
    前端浏览 Eagle 库中的视频文件，选中后输出 IMAGE（缩略图）+ 视频文件路径列表。
    
    输出端口：
    - images: 视频缩略图/预览帧（支持 RGBA）
    - masks: 掩码（全1，占位用）
    - file_paths: 视频文件绝对路径列表（用于穿透给下游视频处理节点）
    - selection_data: 选中数据的 JSON 字符串
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "selection_data": ("STRING", {"default": "{}", "multiline": False}),
                "sequence_mode": (["all_at_once", "sequential"], {"default": "all_at_once"}),
                "sequence_index": ("INT", {"default": 0, "min": 0, "max": 9999, "step": 1}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = ("images", "masks", "file_paths", "selection_data")
    OUTPUT_IS_LIST = (False, False, True, False)
    FUNCTION = "load_videos"
    CATEGORY = "🦅 Eagle"
    OUTPUT_NODE = False

    # ── 内部缓存（同类共享） ──────────────────────────────────────────────
    _item_cache: dict = {}   # item_id -> {filePath, name, tags, ...}

    def load_videos(self, selection_data="{}", sequence_mode="all_at_once", sequence_index=0, **kwargs):
        """从选中数据加载视频缩略图，输出 IMAGE + MASK + file_paths。
        
        支持两种输出模式：
        - selection 模式：仅输出用户手动选中的视频
        - folder 模式：输出整个文件夹的所有视频
        
        顺序输出模式：
        - sequence_mode="all_at_once"：一次性输出全部缩略图（batch）
        - sequence_mode="sequential"：每次只输出一张缩略图，按 sequence_index 索引
        """
        # ── 读取选中数据 ─────────────────────────────────────────────
        selections = self._read_selections(selection_data)
        logger.info(f"[EagleVideoGallery] _read_selections 返回 {len(selections)} 项数据")

        # ── 判断输出模式 ─────────────────────────────────────────────
        output_mode = "selection"
        cached = _get_cached_video_selection()
        folder_id = ""

        if cached:
            output_mode = cached.get("outputMode", "selection") or "selection"
            folder_id = cached.get("folderId", "")
            logger.info(f"[EagleVideoGallery] 从缓存获取 output_mode={output_mode}, folderId={folder_id}")

        # 如果缓存没有 folder 信息，尝试从 selections 中检测文件夹模式标记
        if output_mode != "folder" and selections:
            first_sel = selections[0] if selections else {}
            if first_sel.get("outputMode") == "folder":
                output_mode = "folder"
                folder_id = first_sel.get("folderId", "")
                logger.info(f"[EagleVideoGallery] 从 selections 检测到文件夹模式, folderId={folder_id}")

        if output_mode == "folder":
            # 文件夹模式：从缓存或 selections 中获取 folderId，调用 Eagle API 获取全部视频
            if not folder_id and cached:
                folder_id = cached.get("folderId", "")
            if not folder_id and selections:
                folder_id = selections[0].get("folderId", "")

            if folder_id:
                logger.info(f"[EagleVideoGallery] 文件夹模式：加载文件夹 {folder_id} 的全部视频")
                all_items, err = _fetch_all_video_folder_items(folder_id)
                if err:
                    logger.error(f"[EagleVideoGallery] 获取文件夹视频失败: {err}")
                    return self._empty_output()
                if not all_items:
                    logger.warning(f"[EagleVideoGallery] 文件夹 {folder_id} 中无视频")
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
                logger.info(f"[EagleVideoGallery] 文件夹模式：从 Eagle API 获取 {len(selections)} 个视频")
            else:
                logger.warning("[EagleVideoGallery] 文件夹模式但未指定 folderId，回退到选择模式")
                output_mode = "selection"

        if not selections:
            logger.warning("[EagleVideoGallery] 无选中数据")
            return self._empty_output()

        # ── 顺序输出模式处理 ─────────────────────────────────────────
        total = len(selections)
        if sequence_mode == "sequential":
            # 循环索引：超过总数时回到开头
            effective_index = sequence_index % total if total > 0 else 0
            selections = [selections[effective_index]] if total > 0 else []
            logger.info(f"[EagleVideoGallery] 顺序模式：输出第 {effective_index + 1}/{total} 个视频 (原始索引: {sequence_index})")
        else:
            logger.info(f"[EagleVideoGallery] 批量模式：输出全部 {total} 个视频")

        if not selections:
            return self._empty_output()

        # ── 获取 Eagle 资源库路径 ────────────────────────────────────
        library_path = self._get_library_path()

        # ── 加载视频缩略图 ──────────────────────────────────────────
        images = []
        masks = []
        file_paths = []
        mode_label = "文件夹" if output_mode == "folder" else "选择"
        logger.info(f"[EagleVideoGallery] {mode_label}模式：开始加载 {len(selections)} 个视频的缩略图")

        for sel in selections:
            tensor, mask_tensor, fpath = self._load_video_thumbnail(sel, library_path)
            images.append(tensor)
            masks.append(mask_tensor)
            file_paths.append(fpath)

        if not images:
            return self._empty_output()

        # ── 统一尺寸并堆叠为 batch 张量 ─────────────────────────────
        # ComfyUI 的 IMAGE 类型期望 (B, H, W, 3) 的 batch 张量
        # 找到最大宽高，将所有图片 pad 到统一尺寸（居中，黑色填充）
        max_h = max(img.shape[1] for img in images) if images else 64
        max_w = max(img.shape[2] for img in images) if images else 64

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

        logger.info(f"[EagleVideoGallery] 输出 batch: {image_batch.shape}, mask: {mask_batch.shape}")
        raw_data = json.dumps({"selections": selections, "outputMode": output_mode})
        return (image_batch, mask_batch, file_paths, raw_data)

    @staticmethod
    def _empty_output():
        """返回空的占位输出。"""
        return (
            torch.zeros(1, 64, 64, 3),
            torch.ones(1, 64, 64, 1),
            [""],
            "{}",
        )

    def _read_selections(self, selection_data="{}"):
        """读取选中数据，支持缓存/widget/参数三种来源。返回 selections 列表。"""
        selections = []

        # 1) 优先从服务端缓存读取（最可靠的方式，绕过 widget 序列化）
        cached = _get_cached_video_selection()
        if cached and cached.get("selections"):
            selections = cached["selections"]
            logger.info(f"[EagleVideoGallery] 从服务端缓存获取 {len(selections)} 项选中数据, outputMode={cached.get('outputMode', 'selection')}")
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
                    _cache_video_selection({
                        "selections": selections,
                        "outputMode": "folder",
                        "folderId": folder_id,
                    })
                    logger.info(f"[EagleVideoGallery] 从 selection_data 检测到文件夹模式, folderId={folder_id}, 已同步到缓存")
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"[EagleVideoGallery] 解析 selection_data 失败: {e}")

        return selections

    def _load_video_thumbnail(self, sel, library_path):
        """加载视频缩略图，返回 (tensor, mask_tensor, file_path)。
        
        - tensor: (1,H,W,3) RGB 图像张量（视频缩略图）
        - mask_tensor: (1,H,W,1) alpha 掩码张量（全1）
        - file_path: 视频文件原始路径
        """
        item_id = sel.get("id", "")
        file_path = sel.get("filePath", "")
        name = sel.get("name", "")
        ext = sel.get("ext", "")

        img = None
        load_method = ""

        # 第1级：本地路径构建 library_path/images/{id}.info/{name}.{ext}（视频文件路径）
        if img is None and library_path:
            built_path = self._build_video_path(library_path, sel)
            if built_path:
                # 视频文件路径，不是缩略图
                file_path = built_path
                logger.info(f"[EagleVideoGallery] 构建视频文件路径: {built_path}")

        # 第2级：filePath 直读 / API filePath
        if not file_path and library_path and item_id:
            api_path = self._get_filepath_from_api(item_id)
            if api_path:
                file_path = api_path

        # 第3级：Eagle 缩略图 API 获取缩略图
        if img is None:
            thumb_img = self._load_from_thumbnail(item_id)
            if thumb_img:
                img = thumb_img
                load_method = "Eagle缩略图"

        # 转换为张量
        if img is not None:
            try:
                # 缩略图转 RGB
                if img.mode != "RGB":
                    img = img.convert("RGB")
                
                arr = np.array(img).astype(np.float32) / 255.0
                tensor = torch.from_numpy(arr)[None,]  # (1, H, W, 3)

                # 生成全 1 的 MASK
                h, w = arr.shape[0], arr.shape[1]
                mask_tensor = torch.ones(1, h, w, 1)

                logger.info(f"[EagleVideoGallery] 加载成功: {name} ({img.size[0]}x{img.size[1]}) [{load_method}]")
                return (tensor, mask_tensor, file_path or "")
            except Exception as e:
                logger.error(f"[EagleVideoGallery] 张量转换失败 {name}: {e}")
                return (torch.zeros(1, 64, 64, 3), torch.ones(1, 64, 64, 1), "")
        else:
            logger.warning(f"[EagleVideoGallery] 无法加载缩略图: {name or item_id}")
            return (torch.zeros(1, 64, 64, 3), torch.ones(1, 64, 64, 1), "")

    # ── 辅助方法 ──────────────────────────────────────────────────────

    def _get_library_path(self) -> str | None:
        """获取 Eagle 资源库路径。"""
        try:
            ok, data = _eagle_request("GET", "/api/library/info")
            if ok and isinstance(data, dict):
                # Eagle 4.0+ 格式: data.library.path
                lib_obj = data.get("library", {})
                if isinstance(lib_obj, dict):
                    path = lib_obj.get("path", "")
                    if path and os.path.isdir(path):
                        logger.info(f"[EagleVideoGallery] 获取资源库路径(Eagle 4.0格式): {path}")
                        return path
                # 旧版格式: data.libraryPath
                path = data.get("libraryPath", "")
                if path and os.path.isdir(path):
                    logger.info(f"[EagleVideoGallery] 获取资源库路径(旧版格式): {path}")
                    return path
                logger.warning(f"[EagleVideoGallery] 无法从 API 获取资源库路径, data keys: {list(data.keys())}")
        except Exception as e:
            logger.warning(f"[EagleVideoGallery] 获取资源库路径失败: {e}")
        return None

    def _get_filepath_from_api(self, item_id: str) -> str | None:
        """通过 Eagle API /api/item/info 获取视频的原始文件路径。"""
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
        except Exception as e:
            logger.warning(f"[EagleVideoGallery] API 获取文件路径失败 {item_id}: {e}")
        return None

    def _build_video_path(self, library_path: str, sel: dict) -> str | None:
        """根据 library_path + item 信息构建本地视频文件路径。"""
        item_id = sel.get("id", "")
        name = sel.get("name", "")
        ext = sel.get("ext", "")
        if not item_id or not name:
            return None
        image_folder = os.path.join(library_path, "images", f"{item_id}.info")
        # 尝试精确路径
        video_path = os.path.join(image_folder, f"{name}.{ext}")
        if os.path.exists(video_path):
            return video_path
        # URL 解码后重试（name 可能含中文/特殊字符）
        decoded_name = urllib.parse.unquote(name)
        if decoded_name != name:
            video_path = os.path.join(image_folder, f"{decoded_name}.{ext}")
            if os.path.exists(video_path):
                return video_path
        # 扫描 .info 目录找视频文件
        if os.path.exists(image_folder):
            for file in os.listdir(image_folder):
                if file == "metadata.json":
                    continue
                fpath = os.path.join(image_folder, file)
                if not os.path.isfile(fpath):
                    continue
                _, fext = os.path.splitext(file)
                if fext.lower() in VIDEO_EXTENSIONS:
                    # 检查是否是视频文件
                    return fpath
        return None

    def _load_from_thumbnail(self, item_id: str) -> Image.Image | None:
        """通过 Eagle 缩略图 API 加载缩略图（最后手段）。"""
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
            logger.warning(f"[EagleVideoGallery] 缩略图加载失败 {item_id}: {e}")
        return None


__all__ = ["EagleVideoGalleryNode"]