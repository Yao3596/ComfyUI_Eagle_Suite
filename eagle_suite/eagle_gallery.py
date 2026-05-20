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
import urllib.parse

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
            ok, data = _eagle_request("GET", "/api/item/list", params=params)
            if not ok:
                return None, data
            return data if isinstance(data, list) else [], None

        if load_all:
            # 循环获取全部数据
            all_items = []
            batch_limit = 200
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
            resp = requests.get(url, params={"id": item_id}, timeout=10)
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
    """批量获取 item 详细信息（含 filePath）。"""
    try:
        body = await request.json()
        item_ids = body.get("ids", [])
        if not item_ids:
            return web.json_response({"success": False, "error": "无 item IDs"})

        results = []
        for item_id in item_ids:
            ok, data = _eagle_request("GET", "/api/item/info", params={"id": item_id}, timeout=10)
            if ok and isinstance(data, dict):
                results.append({
                    "id": item_id,
                    "filePath": data.get("filePath", ""),
                    "name": data.get("name", ""),
                    "ext": data.get("ext", ""),
                    "width": data.get("width", 0),
                    "height": data.get("height", 0),
                    "tags": data.get("tags", []),
                    "star": data.get("star", 0),
                    "annotation": data.get("annotation", ""),
                })

        return web.json_response({"success": True, "items": results})

    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ── ComfyUI 节点 ───────────────────────────────────────────────────────────────

class EagleGalleryNode:
    """
    Eagle Gallery — DOM Widget 型图片浏览器节点。
    前端浏览 Eagle 库，选中后输出 IMAGE 张量列表。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "selection_data": ("STRING", {"default": "{}", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("images", "tags", "selection_data")
    OUTPUT_IS_LIST = (True, True, False)
    FUNCTION = "load_images"
    CATEGORY = "🦅 Eagle"
    OUTPUT_NODE = False

    # ── 内部缓存（同类共享） ──────────────────────────────────────────────
    _item_cache: dict = {}   # item_id -> {filePath, name, tags, ...}

    def load_images(self, selection_data="{}", **kwargs):
        """从 selection_data JSON 解析选中项，批量补全元数据后加载图片。"""

        # 读取 selection_data
        raw_data = "{}"
        inputs = getattr(self, 'inputs', [])
        for inp in inputs:
            if getattr(inp, 'name', None) == 'selection_data':
                widget = getattr(inp, 'widget', None)
                if widget:
                    raw_data = getattr(widget, 'value', '{}') or '{}'
                if raw_data == '{}':
                    raw_data = getattr(self, '_selection_data', '{}')
                break

        if raw_data == "{}":
            for widget in getattr(self, 'widgets', []):
                if getattr(widget, 'name', None) == 'selection_data':
                    raw_data = widget.value if widget.value else "{}"
                    break
            if raw_data == "{}":
                raw_data = getattr(self, '_selection_data', '{}')

        if not raw_data or raw_data == "{}":
            logger.warning("[EagleGallery] 无选中数据")
            return ([torch.zeros(1, 64, 64, 3)], [""], "{}")

        try:
            data = json.loads(raw_data) if isinstance(raw_data, str) else raw_data
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"[EagleGallery] 解析 selection_data 失败: {e}")
            return ([torch.zeros(1, 64, 64, 3)], [""], "{}")

        selections = data.get("selections", [])
        if not selections:
            logger.warning("[EagleGallery] 无有效选中项")
            return ([torch.zeros(1, 64, 64, 3)], [""], raw_data)

        # ── 批量补全缺失 filePath（修复 N+1 问题） ───────────────────────
        needs_fetch = []
        for sel in selections:
            if not sel.get("filePath") and sel.get("id"):
                needs_fetch.append(sel["id"])

        if needs_fetch:
            batch_info = self._fetch_item_batch(needs_fetch)
            for sel in selections:
                if sel["id"] in batch_info:
                    sel.setdefault("filePath", batch_info[sel["id"]].get("filePath", ""))
                    if not sel.get("tags"):
                        sel["tags"] = batch_info[sel["id"]].get("tags", [])

        images = []
        tags_list = []
        logger.info(f"[EagleGallery] 加载 {len(selections)} 张选中图片")

        for sel in selections:
            item_id = sel.get("id", "")
            file_path = sel.get("filePath", "")
            tags = sel.get("tags", [])
            name = sel.get("name", "")

            tags_str = ", ".join([str(t) for t in tags if t]) if tags else ""
            tags_list.append(tags_str)

            if file_path and os.path.exists(file_path):
                try:
                    img = Image.open(file_path)
                    img.load()
                    if img.mode == "RGBA":
                        bg = Image.new("RGB", img.size, (255, 255, 255))
                        bg.paste(img, mask=img.split()[3])
                        img = bg
                    else:
                        img = img.convert("RGB")

                    arr = np.array(img).astype(np.float32) / 255.0
                    tensor = torch.from_numpy(arr)[None,]
                    images.append(tensor)
                    logger.info(f"[EagleGallery] 加载成功: {name} ({img.size[0]}x{img.size[1]})")
                except Exception as e:
                    logger.error(f"[EagleGallery] 加载图片失败 {file_path}: {e}")
                    images.append(torch.zeros(1, 64, 64, 3))
            else:
                logger.warning(f"[EagleGallery] 图片路径无效: {file_path or item_id}")
                images.append(torch.zeros(1, 64, 64, 3))

        if not images:
            return ([torch.zeros(1, 64, 64, 3)], [""], raw_data)

        logger.info(f"[EagleGallery] 输出 {len(images)} 张图片到下游节点")
        return (images, tags_list, raw_data)

    def _fetch_item_batch(self, item_ids: list) -> dict:
        """批量从 /eagle_gallery/item_info 获取 item 元数据，一次 HTTP 请求替代 N 次。"""
        try:
            url = f"http://127.0.0.1:8188/eagle_gallery/item_info"
            resp = requests.post(url, json={"ids": item_ids}, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("success"):
                    result = {}
                    for item in data.get("items", []):
                        result[item["id"]] = item
                    return result
        except Exception as e:
            logger.warning(f"[EagleGallery] 批量获取 item 信息失败: {e}")
        return {}


__all__ = ["EagleGalleryNode"]
