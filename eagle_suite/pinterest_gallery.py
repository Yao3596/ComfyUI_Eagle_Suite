# -*- coding: utf-8 -*-
"""
Eagle Suite - Pinterest Gallery 节点
后端负责：
  - Pinterest API v5 代理路由（搜索 Pins / 浏览 Boards / 图片代理）
  - PinterestGalleryNode：ComfyUI 节点 → 输出 IMAGE 张量列表
"""

import os
import json
import time
import threading
import asyncio
import io
import urllib.parse

import requests
import torch
import numpy as np
from PIL import Image
from aiohttp import web
from server import PromptServer

from .logger import logger

# ── 常量 ──────────────────────────────────────────────────────────────────────
BASE_URL = "https://api.pinterest.com/v5"

PINTEREST_HEADERS = {
    "User-Agent": "PinterestGallery-ComfyUI/1.0 (ComfyUI custom node; image browser)",
    "Accept": "application/json",
}

SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "pinterest_settings.json")
PAGE_SIZE = 24


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


_pinterest_throttle = _RateLimiter(min_interval_sec=1.0)


# ── 配置读写 ──────────────────────────────────────────────────────────────────
_DEFAULT_SETTINGS = {
    "access_token": "",
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
        logger.error(f"[Pinterest] 加载设置失败: {e}")
    return dict(_DEFAULT_SETTINGS)


def _save_settings(settings: dict) -> bool:
    try:
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"[Pinterest] 保存设置失败: {e}")
        return False


def _get_auth_headers(token: str = "") -> dict:
    """构建带 Bearer Token 的请求头。"""
    headers = dict(PINTEREST_HEADERS)
    if not token:
        token = _load_settings().get("access_token", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


# ── 统一请求入口 ──────────────────────────────────────────────────────────────
def _pin_request(method: str, url: str, token: str = "", **kwargs) -> requests.Response:
    """统一 Pinterest 请求入口：限流 + 默认头 + 429 退避重试一次。"""
    headers = _get_auth_headers(token)
    req_headers = dict(kwargs.pop("headers", None) or {})
    for k, v in headers.items():
        req_headers.setdefault(k, v)

    for attempt in range(2):
        _pinterest_throttle.wait()
        resp = requests.request(method, url, headers=req_headers, **kwargs)
        if resp.status_code not in (429, 503) or attempt == 1:
            return resp
        retry_after = resp.headers.get("Retry-After")
        delay = 3.0
        try:
            if retry_after is not None:
                delay = min(max(float(retry_after), 1.0), 15.0)
        except ValueError:
            pass
        logger.warning(f"[Pinterest] {resp.status_code} 限流，{delay:.1f}s 后重试: {url}")
        time.sleep(delay)
    return resp


# ── 图片代理并发上限 ──────────────────────────────────────────────────────────
_image_proxy_semaphore: asyncio.Semaphore | None = None


def _get_image_proxy_sem():
    global _image_proxy_semaphore
    if _image_proxy_semaphore is None:
        _image_proxy_semaphore = asyncio.Semaphore(3)
    return _image_proxy_semaphore


# ── aiohttp 路由 ──────────────────────────────────────────────────────────────

@PromptServer.instance.routes.get("/pinterest_gallery/settings")
async def get_settings_route(request):
    try:
        s = _load_settings()
        safe = dict(s)
        if safe.get("access_token"):
            safe["access_token"] = safe["access_token"][:4] + "****"
        return web.json_response({"success": True, "settings": safe})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/pinterest_gallery/settings")
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


@PromptServer.instance.routes.get("/pinterest_gallery/search")
async def search_route(request):
    try:
        q = request.query
        query = q.get("q", "").strip()
        page_size = min(100, max(1, int(q.get("page_size", PAGE_SIZE))))
        bookmark = q.get("bookmark", "")

        params = {"page_size": page_size}
        if query:
            params["q"] = query
        if bookmark:
            params["bookmark"] = bookmark

        token = q.get("token", "").strip()
        url = f"{BASE_URL}/pins/search"
        resp = await asyncio.to_thread(_pin_request, "GET", url, token, params=params, timeout=15)

        if resp.status_code == 401:
            return web.json_response({"success": False, "error": "Access Token 无效或已过期", "auth_error": True}, status=401)
        if resp.status_code != 200:
            return web.json_response({"success": False, "error": f"Pinterest API 返回 {resp.status_code}"}, status=resp.status_code)

        return web.json_response(resp.json())
    except Exception as e:
        logger.error(f"[Pinterest] 搜索路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/pinterest_gallery/boards")
async def boards_route(request):
    try:
        token = request.query.get("token", "").strip()
        page_size = min(100, max(1, int(request.query.get("page_size", 25))))
        bookmark = request.query.get("bookmark", "")

        params = {"page_size": page_size}
        if bookmark:
            params["bookmark"] = bookmark

        url = f"{BASE_URL}/boards"
        resp = await asyncio.to_thread(_pin_request, "GET", url, token, params=params, timeout=15)

        if resp.status_code == 401:
            return web.json_response({"success": False, "error": "Access Token 无效", "auth_error": True}, status=401)
        if resp.status_code != 200:
            return web.json_response({"success": False, "error": f"Pinterest API 返回 {resp.status_code}"}, status=resp.status_code)

        return web.json_response(resp.json())
    except Exception as e:
        logger.error(f"[Pinterest] Boards 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/pinterest_gallery/boards/{board_id}/pins")
async def board_pins_route(request):
    try:
        board_id = request.match_info["board_id"]
        token = request.query.get("token", "").strip()
        page_size = min(100, max(1, int(request.query.get("page_size", PAGE_SIZE))))
        bookmark = request.query.get("bookmark", "")

        params = {"page_size": page_size}
        if bookmark:
            params["bookmark"] = bookmark

        url = f"{BASE_URL}/boards/{board_id}/pins"
        resp = await asyncio.to_thread(_pin_request, "GET", url, token, params=params, timeout=15)

        if resp.status_code == 401:
            return web.json_response({"success": False, "error": "Access Token 无效", "auth_error": True}, status=401)
        if resp.status_code != 200:
            return web.json_response({"success": False, "error": f"Pinterest API 返回 {resp.status_code}"}, status=resp.status_code)

        return web.json_response(resp.json())
    except Exception as e:
        logger.error(f"[Pinterest] Board Pins 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/pinterest_gallery/pin/{pin_id}")
async def pin_detail_route(request):
    try:
        pin_id = request.match_info["pin_id"]
        token = request.query.get("token", "").strip()

        url = f"{BASE_URL}/pins/{pin_id}"
        resp = await asyncio.to_thread(_pin_request, "GET", url, token, timeout=10)

        if resp.status_code == 401:
            return web.json_response({"success": False, "error": "Access Token 无效", "auth_error": True}, status=401)
        if resp.status_code != 200:
            return web.json_response({"success": False, "error": f"Pinterest API 返回 {resp.status_code}"}, status=resp.status_code)

        return web.json_response(resp.json())
    except Exception as e:
        logger.error(f"[Pinterest] Pin 详情路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/pinterest_gallery/image_proxy")
async def image_proxy_route(request):
    """后端图片代理——只允许代理 Pinterest CDN 域名（SSRF 防护）。"""
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
    allowed_hosts = ("i.pinimg.com", "s.pinimg.com", "v.pinimg.com")
    if not any(host == h or host.endswith("." + h) for h in allowed_hosts):
        return web.Response(status=403, text="host not allowed")

    async with _get_image_proxy_sem():
        try:
            resp = await asyncio.to_thread(requests.get, url, timeout=20, headers={"User-Agent": PINTEREST_HEADERS["User-Agent"]})
        except requests.exceptions.RequestException as e:
            logger.warning(f"[Pinterest Proxy] 上游请求失败 {url}: {e}")
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


@PromptServer.instance.routes.get("/pinterest_gallery/check_auth")
async def check_auth_route(request):
    """检查 Access Token 是否有效。"""
    try:
        token = request.query.get("token", "").strip()
        if not token:
            return web.json_response({"success": True, "valid": False, "error": "Token 为空"})

        url = f"{BASE_URL}/user_account"
        resp = await asyncio.to_thread(_pin_request, "GET", url, token, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return web.json_response({"success": True, "valid": True, "username": data.get("username", "")})
        elif resp.status_code == 401:
            return web.json_response({"success": True, "valid": False, "error": "Token 无效或已过期"})
        else:
            return web.json_response({"success": True, "valid": False, "error": f"HTTP {resp.status_code}"})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ── ComfyUI 节点 ───────────────────────────────────────────────────────────────

class PinterestGalleryNode:
    """
    Pinterest Gallery — ComfyUI 节点。
    内嵌 DOM widget（由 JS 注入），选中后输出 IMAGE 张量列表。
    """

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
    CATEGORY = "🦅 Eagle/Pinterest"
    OUTPUT_NODE = False

    def get_selected_data(self, bypass_image=None, selection_data="{}", **kwargs):
        """处理选中图片数据，下载原图并转换为张量。"""
        if not selection_data or selection_data == "{}":
            logger.warning("[Pinterest] 无选中数据")
            if bypass_image is not None:
                return ([bypass_image], [""], "{}")
            return ([torch.zeros(1, 512, 512, 3)], [""], "{}")

        if isinstance(selection_data, dict):
            data = selection_data
        else:
            try:
                data = json.loads(selection_data) if selection_data else {}
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"[Pinterest] 解析 selection_data 失败: {e}")
                if bypass_image is not None:
                    return ([bypass_image], [""], "{}")
                return ([torch.zeros(1, 512, 512, 3)], [""], "{}")

        selections = data.get("selections", [])
        if not selections:
            logger.warning("[Pinterest] 无有效选中项")
            if bypass_image is not None:
                return ([bypass_image], [""], selection_data)
            return ([torch.zeros(1, 512, 512, 3)], [""], selection_data)

        images = []
        tags_list = []

        logger.info(f"[Pinterest] 处理 {len(selections)} 个选中项")

        for sel in selections:
            image_url = sel.get("image_url")
            pin_id = sel.get("pin_id")
            title = sel.get("title", "")
            tags = sel.get("tags", "")

            tags_list.append(str(tags) if tags else "")

            if image_url:
                try:
                    logger.info(f"[Pinterest] 下载图片: {image_url[:100]}...")
                    resp = requests.get(image_url, timeout=60, headers={"User-Agent": PINTEREST_HEADERS["User-Agent"]})
                    resp.raise_for_status()
                    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
                    arr = np.array(img).astype(np.float32) / 255.0
                    tensor = torch.from_numpy(arr)[None,]
                    images.append(tensor)
                    logger.info(f"[Pinterest] 图片处理成功: {pin_id}")
                except Exception as e:
                    logger.error(f"[Pinterest] 下载图片失败 {image_url}: {e}")
                    images.append(torch.zeros(1, 512, 512, 3))
            else:
                logger.warning(f"[Pinterest] 缺少图片 URL: {pin_id}")
                images.append(torch.zeros(1, 512, 512, 3))

        if not images:
            return ([torch.zeros(1, 512, 512, 3)], [""], selection_data)

        logger.info(f"[Pinterest] 输出 {len(images)} 张图片到下游节点")
        return (images, tags_list, selection_data)


__all__ = ["PinterestGalleryNode"]
