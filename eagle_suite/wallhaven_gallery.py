# -*- coding: utf-8 -*-
"""
Eagle Suite - Wallhaven Gallery 节点
一比一参考 ComfyUI-Danbooru-Gallery 实现。
后端负责：
  - 速率限制（45 req/min，保守取 30/min = 2s 间隔）
  - 统一 HTTP 请求入口（限流 + 429 退避）
  - aiohttp 路由：搜索/图片详情/图片代理/收藏/认证/设置
  - WallhavenGalleryNode：ComfyUI 节点 → 输出 IMAGE list + STRING list
"""

import os
import json
import time
import threading
import asyncio
import io
import urllib.parse
import urllib.request

import requests
import torch
import numpy as np
from PIL import Image
from aiohttp import web
from server import PromptServer

from .logger import logger

# ── 常量 ──────────────────────────────────────────────────────────────────────
BASE_URL = "https://wallhaven.cc/api/v1"

WALLHAVEN_HEADERS = {
    "User-Agent": "WallhavenGallery-ComfyUI/1.0 (ComfyUI custom node; image browser only)"
}

SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "wallhaven_settings.json")


# ── 速率限制器 ─────────────────────────────────────────────────────────────────
class _RateLimiter:
    def __init__(self, min_interval_sec: float):
        self.min_interval = min_interval_sec
        self._last_ts = 0.0
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_ts
            if elapsed < self.min_interval:
                time.sleep(self.min_interval - elapsed)
            self._last_ts = time.monotonic()


_wallhaven_throttle = _RateLimiter(min_interval_sec=2.0)


def _wh_request(method: str, url: str, **kwargs) -> requests.Response:
    """统一 Wallhaven 请求入口：限流 + 默认 UA + 429 带 Retry-After 退避重试一次。
    优先使用传入的 headers 中的 API Key，其次使用 settings 文件中的。"""
    headers = dict(kwargs.pop("headers", None) or {})
    for k, v in WALLHAVEN_HEADERS.items():
        headers.setdefault(k, v)

    # 如果传入的 headers 中没有 API Key，则从 settings 读取
    if not headers.get("X-API-Key"):
        settings = _load_settings()
        api_key = settings.get("api_key", "").strip()
        if api_key:
            headers["X-API-Key"] = api_key

    for attempt in range(2):
        _wallhaven_throttle.wait()
        resp = requests.request(method, url, headers=headers, **kwargs)
        if resp.status_code not in (429, 503) or attempt == 1:
            return resp
        retry_after = resp.headers.get("Retry-After")
        delay = 3.0
        try:
            if retry_after is not None:
                delay = min(max(float(retry_after), 1.0), 15.0)
        except ValueError:
            pass
        logger.warning(f"[Wallhaven] {resp.status_code} 限流，{delay:.1f}s 后重试: {url}")
        time.sleep(delay)
    return resp


# ── 配置读写 ──────────────────────────────────────────────────────────────────
_DEFAULT_SETTINGS = {
    "lang": "zh",
    "api_key": "",
    "purity": "100",
    "categories": "111",
    "sorting": "date_added",
    "order": "desc",
    "top_range": "1M",
    "atleast": "",
    "resolutions": "",
    "ratios": "",
    "page_size": 24,
    "cache_enabled": True,
    "max_cache_age": 3600,
    "favorites_collections": [],
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
        logger.error(f"[Wallhaven] 加载设置失败: {e}")
    return dict(_DEFAULT_SETTINGS)


def _save_settings(settings: dict) -> bool:
    try:
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"[Wallhaven] 保存设置失败: {e}")
        return False


# ── 图片代理并发上限 ──────────────────────────────────────────────────────────
_image_proxy_semaphore: asyncio.Semaphore | None = None


def _get_image_proxy_sem():
    global _image_proxy_semaphore
    if _image_proxy_semaphore is None:
        _image_proxy_semaphore = asyncio.Semaphore(3)
    return _image_proxy_semaphore


# ── aiohttp 路由 ──────────────────────────────────────────────────────────────

@PromptServer.instance.routes.get("/wallhaven_gallery/settings")
async def get_settings_route(request):
    try:
        s = _load_settings()
        safe = dict(s)
        if safe.get("api_key"):
            safe["api_key"] = safe["api_key"][:4] + "****"
        return web.json_response({"success": True, "settings": safe})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/wallhaven_gallery/settings")
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


@PromptServer.instance.routes.post("/wallhaven_gallery/verify_auth")
async def verify_auth_route(request):
    try:
        data = await request.json()
        api_key = data.get("api_key", "").strip()
        if not api_key:
            return web.json_response({"success": True, "valid": False, "error": "API Key 为空"})

        url = f"{BASE_URL}/settings"
        try:
            resp = await asyncio.to_thread(
                _wh_request, "GET", url,
                headers={"X-API-Key": api_key},
                timeout=10,
            )
            if resp.status_code == 200:
                return web.json_response({"success": True, "valid": True})
            elif resp.status_code == 401:
                return web.json_response({"success": True, "valid": False, "error": "API Key 无效或已过期"})
            else:
                return web.json_response({"success": True, "valid": False, "error": f"HTTP {resp.status_code}"})
        except requests.exceptions.RequestException as e:
            return web.json_response({"success": True, "valid": False, "network_error": True, "error": str(e)})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/wallhaven_gallery/search")
async def search_route(request):
    try:
        q = request.query
        params: dict = {}

        if q.get("q"):
            params["q"] = q["q"]

        if q.get("categories"):
            params["categories"] = q["categories"]
        if q.get("purity"):
            params["purity"] = q["purity"]

        sorting = q.get("sorting", "date_added")
        params["sorting"] = sorting
        params["order"] = q.get("order", "desc")
        if sorting == "toplist":
            params["topRange"] = q.get("topRange", "1M")

        if q.get("seed"):
            params["seed"] = q["seed"]

        if q.get("atleast"):
            params["atleast"] = q["atleast"]
        if q.get("resolutions"):
            params["resolutions"] = q["resolutions"]
        if q.get("ratios"):
            params["ratios"] = q["ratios"]

        if q.get("colors"):
            params["colors"] = q["colors"]

        params["page"] = int(q.get("page", 1))

        # 获取前端传递的 API Key
        headers = {}
        api_key = request.headers.get("X-API-Key", "").strip()
        if api_key:
            headers["X-API-Key"] = api_key

        url = f"{BASE_URL}/search"
        resp = await asyncio.to_thread(_wh_request, "GET", url, params=params, headers=headers, timeout=15)

        if resp.status_code != 200:
            return web.json_response(
                {"success": False, "error": f"Wallhaven API 返回 {resp.status_code}"},
                status=resp.status_code,
            )

        return web.json_response(resp.json())

    except Exception as e:
        logger.error(f"[Wallhaven] 搜索路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/wallhaven_gallery/wallpaper/{wid}")
async def wallpaper_detail_route(request):
    try:
        wid = request.match_info["wid"]
        url = f"{BASE_URL}/w/{wid}"
        resp = await asyncio.to_thread(_wh_request, "GET", url, timeout=10)

        if resp.status_code != 200:
            return web.json_response(
                {"success": False, "error": f"HTTP {resp.status_code}"},
                status=resp.status_code,
            )
        return web.json_response(resp.json())
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/wallhaven_gallery/collections")
async def collections_route(request):
    try:
        settings = _load_settings()
        api_key = settings.get("api_key", "").strip()
        if not api_key:
            return web.json_response({"success": False, "error": "需要 API Key 才能访问收藏"})

        url = f"{BASE_URL}/collections"
        resp = await asyncio.to_thread(
            _wh_request, "GET", url,
            headers={"X-API-Key": api_key},
            timeout=10,
        )

        if resp.status_code == 401:
            return web.json_response({"success": False, "error": "API Key 无效"})
        if resp.status_code != 200:
            return web.json_response({"success": False, "error": f"HTTP {resp.status_code}"})

        data = resp.json()
        return web.json_response({"success": True, "collections": data.get("data", [])})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/wallhaven_gallery/collections/{username}/{collection_id}")
async def collection_wallpapers_route(request):
    try:
        username = request.match_info["username"]
        cid = request.match_info["collection_id"]
        page = int(request.query.get("page", 1))

        url = f"{BASE_URL}/collections/{username}/{cid}"
        params = {"page": page}

        if request.query.get("purity"):
            params["purity"] = request.query["purity"]

        resp = await asyncio.to_thread(_wh_request, "GET", url, params=params, timeout=15)

        if resp.status_code != 200:
            return web.json_response({"success": False, "error": f"HTTP {resp.status_code}"})

        return web.json_response(resp.json())
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/wallhaven_gallery/tag/{tag_id}")
async def tag_info_route(request):
    try:
        tag_id = request.match_info["tag_id"]
        url = f"{BASE_URL}/tag/{tag_id}"
        resp = await asyncio.to_thread(_wh_request, "GET", url, timeout=10)
        if resp.status_code != 200:
            return web.json_response({"success": False, "error": f"HTTP {resp.status_code}"})
        return web.json_response(resp.json())
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/wallhaven_gallery/image_proxy")
async def image_proxy_route(request):
    """
    后端图片代理——只允许代理 wallhaven.cc 域名（SSRF 防护）。
    """
    url = request.query.get("url", "")
    if not url:
        return web.Response(status=400, text="missing url")

    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return web.Response(status=400, text="invalid url")

    if parsed.scheme not in ("http", "https"):
        return web.Response(status=400, text="invalid scheme")

    host = (parsed.hostname or "").lower()
    allowed_hosts = ("wallhaven.cc", "w.wallhaven.cc", "th.wallhaven.cc")
    if not any(host == h or host.endswith("." + h) for h in allowed_hosts):
        return web.Response(status=403, text="host not allowed")

    async with _get_image_proxy_sem():
        try:
            resp = await asyncio.to_thread(_wh_request, "GET", url, timeout=20)
        except requests.exceptions.RequestException as e:
            logger.warning(f"[Wallhaven Proxy] 上游请求失败 {url}: {e}")
            return web.Response(status=502, text="upstream error")

    if resp.status_code != 200:
        return web.Response(status=resp.status_code)

    return web.Response(
        body=resp.content,
        headers={
            "Content-Type": resp.headers.get("Content-Type", "application/octet-stream"),
            "Cache-Control": "public, max-age=86400",
        },
    )


@PromptServer.instance.routes.get("/wallhaven_gallery/check_network")
async def check_network_route(request):
    try:
        resp = await asyncio.to_thread(
            requests.get,
            "https://wallhaven.cc/api/v1/search",
            params={"q": "test", "page": 1},
            headers=WALLHAVEN_HEADERS,
            timeout=8,
        )
        connected = resp.status_code in (200, 401)
        return web.json_response({"success": True, "connected": connected})
    except Exception as e:
        return web.json_response({"success": True, "connected": False, "error": str(e)})


# ── ComfyUI 节点 ───────────────────────────────────────────────────────────────

class WallhavenGalleryNode:
    """
    Wallhaven Gallery — ComfyUI 节点。
    内嵌 DOM widget（由 JS 注入），选中后输出 IMAGE 张量列表和标签字符串列表。
    """
    _post_cache: dict = {}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "bypass_image": ("IMAGE", {"forceInput": True}),
                "selection_data": ("STRING", {"default": "{}", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("images", "tags", "selection_data")
    OUTPUT_IS_LIST = (True, True, False)
    FUNCTION = "get_selected_data"
    CATEGORY = "🦅 Eagle/Wallhaven"
    OUTPUT_NODE = False

    def get_selected_data(self, bypass_image=None, selection_data="{}", **kwargs):
        """处理选中图片数据，下载原图并转换为张量，同时输出标签字符串。
        selection_data 由 ComfyUI 从 widget 自动传入。若未选中且提供了 bypass_image，直接透传。"""
        # ComfyUI 会将 widget 值作为关键字参数传入，直接使用 selection_data 即可
        if not selection_data or selection_data == "{}":
            logger.warning("[Wallhaven] 无选中数据")
            if bypass_image is not None:
                return ([bypass_image], [""], "{}")
            return ([torch.zeros(1, 512, 512, 3)], [""], "{}")

        if isinstance(selection_data, dict):
            data = selection_data
        else:
            try:
                data = json.loads(selection_data) if selection_data else {}
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"[Wallhaven] 解析 selection_data 失败: {e}")
                if bypass_image is not None:
                    return ([bypass_image], [""], "{}")
                return ([torch.zeros(1, 512, 512, 3)], [""], "{}")

        if not data or data == {}:
            logger.warning("[Wallhaven] 选中数据为空")
            logger.info(f"[Wallhaven] raw selection_data: {selection_data[:200] if isinstance(selection_data, str) else selection_data}")
            if bypass_image is not None:
                return ([bypass_image], [""], "{}")
            return ([torch.zeros(1, 512, 512, 3)], [""], "{}")

        images = []
        tags_list = []

        try:
            selections = data.get("selections", [])
            logger.info(f"[Wallhaven] 解析到 {len(selections)} 个选中项")

            if not selections:
                logger.warning("[Wallhaven] 无有效选中项")
                logger.info(f"[Wallhaven] data内容: {str(data)[:300]}")
                if bypass_image is not None:
                    return ([bypass_image], [""], selection_data)
                return ([torch.zeros(1, 512, 512, 3)], [""], selection_data)

            for sel in selections:
                image_url = sel.get("image_url")
                wallpaper_id = sel.get("wallpaper_id")
                resolution = sel.get("resolution", "")

                logger.info(f"[Wallhaven] 处理图片: id={wallpaper_id}, url={str(image_url)[:100] if image_url else 'NONE'}")

                # 获取 tags - 搜索 API 不返回 tags，需要调用详情 API
                tags_str = ""
                if wallpaper_id:
                    try:
                        detail_resp = _wh_request("GET", f"{BASE_URL}/w/{wallpaper_id}", timeout=10)
                        if detail_resp.status_code == 200:
                            detail_data = detail_resp.json()
                            tags_data = detail_data.get("data", {}).get("tags", [])
                            tags_str = ", ".join([t.get("name", "") for t in tags_data if t.get("name")])
                    except Exception as e:
                        logger.warning(f"[Wallhaven] 获取 tags 失败 {wallpaper_id}: {e}")

                tags_list.append(tags_str)

                if image_url:
                    try:
                        logger.info(f"[Wallhaven] 开始下载图片: {image_url[:100]}...")
                        resp = _wh_request("GET", image_url, timeout=60)
                        logger.info(f"[Wallhaven] 下载响应: status={resp.status_code}, size={len(resp.content)} bytes")
                        resp.raise_for_status()
                        img = Image.open(io.BytesIO(resp.content)).convert("RGB")

                        # 解析分辨率用于调试
                        if resolution:
                            logger.info(f"[Wallhaven] 下载图片 {wallpaper_id}: {resolution}")

                        arr = np.array(img).astype(np.float32) / 255.0
                        tensor = torch.from_numpy(arr)[None,]
                        images.append(tensor)
                        logger.info(f"[Wallhaven] 图片处理成功: {wallpaper_id}")
                    except Exception as e:
                        logger.error(f"[Wallhaven] 下载图片失败 {image_url}: {e}")
                        # 返回占位图
                        images.append(torch.zeros(1, 512, 512, 3))
                else:
                    logger.warning(f"[Wallhaven] 缺少图片 URL: {wallpaper_id}")
                    images.append(torch.zeros(1, 512, 512, 3))

            if not images:
                logger.warning("[Wallhaven] 无有效图片")
                return ([torch.zeros(1, 512, 512, 3)], [""], selection_data)

            logger.info(f"[Wallhaven] 输出 {len(images)} 张图片到下游节点")
            return (images, tags_list, selection_data)

        except Exception as e:
            logger.error(f"[Wallhaven] get_selected_data 错误: {e}")
            return ([torch.zeros(1, 512, 512, 3)], [""], selection_data)
