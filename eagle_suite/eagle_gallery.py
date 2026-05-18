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
    """返回干净的 Eagle base URL（去除路径/查询参数，只保留 scheme://host:port）。"""
    raw = _load_settings().get("eagle_url", DEFAULT_EAGLE_URL)
    try:
        from urllib.parse import urlparse
        p = urlparse(raw)
        # 重新组合：只保留 scheme + netloc
        base = f"{p.scheme}://{p.netloc}"
        return base.rstrip("/")
    except Exception:
        return raw.rstrip("/")


# ── Eagle API 通用请求 ────────────────────────────────────────────────────────
def _eagle_request(method: str, endpoint: str, **kwargs):
    """向 Eagle API 发送请求，返回 (success, data_or_error)."""
    base = _get_eagle_url()
    url = f"{base}{endpoint}"
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
        shape = body.get("shape", "")  # square, portrait, landscape
        page = max(1, int(body.get("page", 1)))
        limit = min(200, max(1, int(body.get("limit", PAGE_SIZE))))
        offset = (page - 1) * limit

        # Eagle v1 /item/list 参数
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
            return web.json_response({"success": False, "error": data}, status=500)

        items = data if isinstance(data, list) else []

        # 客户端筛选：shape（Eagle v1 API 可能不支持 shape 参数）
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

        # 获取总数（近似：如果返回满一页，假设还有更多）
        total = len(items)
        if total >= limit:
            total = limit * page + 1  # 标记还有更多

        return web.json_response({"success": True, "items": items, "total": total, "page": page, "limit": limit})

    except Exception as e:
        logger.error(f"[EagleGallery] items 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/eagle_gallery/thumbnail")
async def thumbnail_route(request):
    """代理 Eagle 缩略图请求。支持 Eagle 直接返回图片或返回 JSON 路径。"""
    item_id = request.query.get("id", "")
    if not item_id:
        return web.Response(status=400, text="missing id")

    base = _get_eagle_url()

    try:
        # ── 第1步：尝试直接获取缩略图 ──────────────────────────
        url = f"{base}/api/item/thumbnail"
        resp = requests.get(url, params={"id": item_id}, timeout=10)
        if resp.status_code == 200:
            ct = resp.headers.get("Content-Type", "")
            # 如果返回的是 JSON，解析出缩略图路径再获取
            if ct.startswith("application/json") or resp.content[:1] in (b"{", b"["):
                try:
                    data = resp.json()
                    thumb_path = data.get("data", "") if isinstance(data, dict) else str(data)
                    if thumb_path and isinstance(thumb_path, str):
                        # thumb_path 可能是绝对路径或相对 URL
                        if thumb_path.startswith("http"):
                            img_resp = requests.get(thumb_path, timeout=10)
                        elif thumb_path.startswith("/"):
                            img_resp = requests.get(f"{base}{thumb_path}", timeout=10)
                        else:
                            img_resp = requests.get(f"{base}/{thumb_path}", timeout=10)
                        if img_resp.status_code == 200:
                            return web.Response(
                                body=img_resp.content,
                                headers={
                                    "Content-Type": img_resp.headers.get("Content-Type", "image/png"),
                                    "Cache-Control": "public, max-age=86400",
                                },
                            )
                except Exception:
                    pass
            else:
                # 直接返回图片二进制
                return web.Response(
                    body=resp.content,
                    headers={
                        "Content-Type": ct or "image/png",
                        "Cache-Control": "public, max-age=86400",
                    },
                )

        # ── 第2步：备用——通过 item info 获取缩略图路径 ─────────
        ok, info = _eagle_request("GET", "/api/item/info", params={"id": item_id}, timeout=10)
        if ok and isinstance(info, dict):
            # Eagle v1 可能在 info 中返回 thumbnail 字段
            thumb_path = info.get("thumbnail", "")
            if not thumb_path:
                # 尝试用 filePath 直接读取本地图片
                file_path = info.get("filePath", "")
                if file_path and os.path.exists(file_path):
                    try:
                        with open(file_path, "rb") as f:
                            img_data = f.read()
                        ext = os.path.splitext(file_path)[1].lower()
                        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                                ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp"}.get(ext, "image/png")
                        return web.Response(
                            body=img_data,
                            headers={
                                "Content-Type": mime,
                                "Cache-Control": "public, max-age=86400",
                            },
                        )
                    except Exception:
                        pass
            elif isinstance(thumb_path, str):
                if thumb_path.startswith("http"):
                    img_resp = requests.get(thumb_path, timeout=10)
                elif thumb_path.startswith("/"):
                    img_resp = requests.get(f"{base}{thumb_path}", timeout=10)
                else:
                    img_resp = requests.get(f"{base}/{thumb_path}", timeout=10)
                if img_resp.status_code == 200:
                    return web.Response(
                        body=img_resp.content,
                        headers={
                            "Content-Type": img_resp.headers.get("Content-Type", "image/png"),
                            "Cache-Control": "public, max-age=86400",
                        },
                    )

        logger.warning(f"[EagleGallery] 无法获取缩略图 {item_id} (HTTP {resp.status_code})")
        return web.Response(status=404)
    except Exception as e:
        logger.warning(f"[EagleGallery] 缩略图代理失败 {item_id}: {e}")
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
