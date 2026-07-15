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
import math
import time
import threading
import urllib.parse

import requests
import torch
import numpy as np
from PIL import Image
from aiohttp import web
from .route_registry import route
from .logger import logger
from .api_unified import _mask_url_token, _load_config

# ── 常量 ──────────────────────────────────────────────────────────────────────
DEFAULT_EAGLE_URL = "http://localhost:41595"
EAGLE_API_V1 = f"{DEFAULT_EAGLE_URL}/api"

SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "eagle_gallery_settings.json")
PAGE_SIZE = 100  # 每页加载数量

# ── 选中数据缓存（内存级，按节点 ID）──────────────────────────────────────────
_selection_cache: dict = {}

def _get_cached_selection(node_id: str) -> dict:
    """供其他模块调用，安全获取缓存的选中数据。"""
    return _selection_cache.get(node_id, {})


# ── 连通性探测结果缓存 ─────────────────────────────────────────────────────────
# 修复：之前每次 _load_settings() 都会同步阻塞探测一次 Eagle 连接（1.5s 超时），
# 而几乎所有路由（尤其是缩略图，一张图一次调用）都会间接触发它，导致画廊加载
# 一百多张缩略图时要额外阻塞几十上百秒，且会卡住整个 aiohttp 事件循环。
# 现在改为 60 秒内复用上一次探测结果，避免热路径反复做同步网络请求。
_conn_check_cache = {"url": None, "ok": None, "ts": 0.0}
_conn_check_lock = threading.Lock()
_CONN_CHECK_TTL = 60.0


# ── 配置读写 ──────────────────────────────────────────────────────────────────
_DEFAULT_SETTINGS = {
    "eagle_url": DEFAULT_EAGLE_URL,
}


def _load_settings() -> dict:
    try:
        data = None
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        
        # 尝试从 api_config.json 加载 base_url 的条件：文件不存在、eagle_url 为空、或无法连接
        need_fallback = not data or not data.get("eagle_url") or data.get("eagle_url") == DEFAULT_EAGLE_URL
        
        # 如果已有配置但尝试连接失败，也触发回退。
        # 修复：不再每次调用都同步阻塞探测——60 秒内复用上一次探测结果，
        # 否则画廊加载几十上百张缩略图时，每张都会额外卡 1.5s，
        # 并且会阻塞整个 aiohttp 事件循环导致界面看起来"卡死不出图"。
        if not need_fallback and data.get("eagle_url"):
            url = data["eagle_url"]
            now = time.time()
            with _conn_check_lock:
                cached = (_conn_check_cache["url"] == url
                          and (now - _conn_check_cache["ts"]) < _CONN_CHECK_TTL)
                cached_ok = _conn_check_cache["ok"]
            if cached:
                if not cached_ok:
                    need_fallback = True
            else:
                try:
                    p = urllib.parse.urlparse(url)
                    # 修复：/api/v1/info 不是 Eagle 的真实端点（必失败），
                    # 改用 Eagle 官方存在的 /api/application/info。
                    check_url = f"{p.scheme}://{p.netloc}/api/application/info"
                    requests.get(check_url, timeout=1.5)
                    with _conn_check_lock:
                        _conn_check_cache.update(url=url, ok=True, ts=now)
                except Exception:
                    logger.info(f"[EagleGallery] 现有配置 {url} 无法连接，尝试回退到全局配置")
                    with _conn_check_lock:
                        _conn_check_cache.update(url=url, ok=False, ts=now)
                    need_fallback = True

        if need_fallback:
            unified_config = _load_config()
            base_url = unified_config.get("base_url", "")
            if base_url and base_url != DEFAULT_EAGLE_URL:
                logger.info(f"[EagleGallery] 自动同步 api_config.json 中的 base_url: {base_url}")
                if not data: data = {}
                data["eagle_url"] = base_url
            elif not data:
                data = dict(_DEFAULT_SETTINGS)
        
        # 迁移旧配置：如果存在 token 且 eagle_url 中没有 token，则尝试合并
        if "token" in data and data["token"] and "token=" not in data["eagle_url"]:
            url = data["eagle_url"].rstrip("/")
            sep = "&" if "?" in url else "?"
            data["eagle_url"] = f"{url}{sep}token={data['token']}"
            del data["token"]
        
        for k, v in _DEFAULT_SETTINGS.items():
            if k not in data:
                data[k] = v
        return data
    except Exception as e:
        logger.error(f"[EagleGallery] 加载设置失败: {e}")
    return dict(_DEFAULT_SETTINGS)


def _save_settings(settings: dict) -> bool:
    try:
        # 严防掩码写入磁盘
        url = settings.get("eagle_url", "")
        if url and "****" in url:
            logger.error("[EagleGallery] 拒绝保存包含掩码的 URL 到磁盘")
            return False

        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        # 移除可能存在的旧字段
        if "token" in settings:
            del settings["token"]
            
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"[EagleGallery] 保存设置失败: {e}")
        return False


def _get_eagle_url() -> str:
    raw = _load_settings().get("eagle_url", DEFAULT_EAGLE_URL).rstrip("/")
    # 返回不含 token 的基础 URL 用于拼接路径
    try:
        p = urllib.parse.urlparse(raw)
        return f"{p.scheme}://{p.netloc}".rstrip("/")
    except Exception:
        return raw.split('?')[0].rstrip("/")

def _get_eagle_token() -> str:
    raw = _load_settings().get("eagle_url", "")
    if not raw: return ""
    try:
        p = urllib.parse.urlparse(raw)
        qs = urllib.parse.parse_qs(p.query)
        tokens = qs.get("token", [])
        return tokens[0] if tokens else ""
    except Exception:
        return ""


def _batch_fetch_thumbnails(items: list, max_concurrent=8):
    """为 item 列表批量附加 thumbnail 字段（V1 优先，V1 失败用 V2 回退）。"""
    import concurrent.futures

    def _fetch_one(item):
        try:
            item_id = item.get("id", "")
            if not item_id or item.get("thumbnail"):
                return
            # V1 尝试
            path = _eagle_v1_thumbnail(item_id)
            # V1 失败 → V2 回退
            if not path:
                v2_item = _eagle_v2_item_info(item_id)
                path = v2_item.get("thumbnail", v2_item.get("thumbnailPath", v2_item.get("filePath", "")))
            if path:
                item["thumbnail"] = path
            else:
                # 标记为无缩略图，避免前端反复请求
                item["thumbnail"] = ""
        except Exception:
            pass

    subset = items[:50] if len(items) > 50 else items
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_concurrent) as pool:
        list(pool.map(_fetch_one, subset))


# ── Eagle API V2 通用请求 ────────────────────────────────────────────────────
def _eagle_v2_request(endpoint: str, body: dict = None, timeout: int = 15):
    """向 Eagle API V2 发送 POST 请求，返回 (success, data_or_error)."""
    base = _get_eagle_url()
    token = _get_eagle_token()
    url = f"{base}{endpoint}"
    # token 放在 URL query 中（Eagle API 标准做法）
    if token:
        url += ("&" if "?" in url else "?") + "token=" + urllib.parse.quote(token, safe="")
    req_body = dict(body) if body else {}
    try:
        resp = requests.post(url, json=req_body, timeout=timeout)
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}"
        data = resp.json()
        if data.get("status") != "success":
            return False, data.get("message", "Eagle API 错误")
        # V2 响应: {status:"success", data:{...}}
        inner = data.get("data", {})
        return True, inner if isinstance(inner, dict) else data
    except requests.exceptions.ConnectionError:
        return False, "无法连接到 Eagle（请确认 Eagle 应用已启动）"
    except Exception as e:
        return False, str(e)


def _eagle_v1_thumbnail(item_id: str) -> str:
    """获取缩略图文件路径（V1 端点，返回 JSON 内含路径）。"""
    base = _get_eagle_url()
    token = _get_eagle_token()
    url = f"{base}/api/item/thumbnail"
    params = {"id": item_id}
    if token:
        params["token"] = token
    try:
        resp = requests.get(url, params=params, timeout=8)
        if resp.status_code == 200 and resp.text.strip().startswith("{"):
            info = resp.json()
            if isinstance(info, dict):
                return info.get("data", "")
    except Exception:
        pass
    return ""


# ── aiohttp 路由 ──────────────────────────────────────────────────────────────

@route("GET", "/eagle_gallery/settings")
async def get_settings_route(request):
    try:
        s = _load_settings()
        # 安全：使用统一掩码工具处理 URL
        safe = dict(s)
        if "eagle_url" in safe:
            safe["eagle_url"] = _mask_url_token(safe["eagle_url"])
        return web.json_response({"success": True, "settings": safe})
    except Exception as e:
        logger.error(f"[EagleGallery] /settings GET error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eagle_gallery/settings")
async def save_settings_route(request):
    try:
        data = await request.json()
        current = _load_settings()
        
        new_url = data.get("eagle_url", "").strip()
        if new_url:
            # 强化掩码恢复逻辑：支持仅恢复 Token 而保留 URL 其他部分的修改
            if "****" in new_url:
                logger.info("[EagleGallery] 检测到掩码 Token，尝试从现有配置恢复")
                try:
                    p_new = urllib.parse.urlparse(new_url)
                    qs_new = urllib.parse.parse_qs(p_new.query)
                    token_new = (qs_new.get("token") or [""])[0]
                    
                    if "****" in token_new:
                        # 1. 尝试从当前文件记录中恢复
                        old_url = current.get("eagle_url", "")
                        old_token = ""
                        if old_url:
                            p_old = urllib.parse.urlparse(old_url)
                            qs_old = urllib.parse.parse_qs(p_old.query)
                            old_token = (qs_old.get("token") or [""])[0]
                        
                        # 2. 如果当前文件也是掩码，尝试从 api_config.json 恢复
                        if not old_token or "****" in old_token:
                            unified_config = _load_config()
                            saved_url = unified_config.get("base_url", "")
                            if saved_url:
                                p_saved = urllib.parse.urlparse(saved_url)
                                qs_saved = urllib.parse.parse_qs(p_saved.query)
                                old_token = (qs_saved.get("token") or [""])[0]
                        
                        if old_token and "****" not in old_token:
                            # 替换 Token 部分，保留 Host/Port 修改
                            qs_new["token"] = [old_token]
                            new_query = urllib.parse.urlencode(qs_new, doseq=True)
                            new_url = urllib.parse.urlunparse((p_new.scheme, p_new.netloc, p_new.path, p_new.params, new_query, p_new.fragment))
                            logger.info("[EagleGallery] 已成功从历史凭据恢复 Token")
                        else:
                            # 彻底无法恢复，报错并阻止保存
                            logger.error("[EagleGallery] 无法恢复掩码密钥，请提供完整 Token 或 URL")
                            return web.json_response({"success": False, "error": "无法恢复掩码密钥，请重新输入完整连接"}, status=400)
                except Exception as e:
                    logger.error(f"[EagleGallery] Token 恢复异常: {e}")
            
            current["eagle_url"] = new_url
                
        ok = _save_settings(current)
        return web.json_response({"success": ok})
    except Exception as e:
        logger.error(f"[EagleGallery] /settings POST error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/eagle_gallery/folders")
async def folders_route(request):
    ok, data = _eagle_v2_request("/api/v2/folder/get")
    if not ok:
        return web.json_response({"success": False, "error": data}, status=500)
    # V2 returns: {data: [...], total: N} or just the list
    folders = data.get("data", data) if isinstance(data, dict) else data
    if not isinstance(folders, list):
        folders = []
    return web.json_response({"success": True, "folders": folders})


@route("GET", "/eagle_gallery/library")
async def library_route(request):
    ok, data = _eagle_v2_request("/api/v2/library/info")
    if not ok:
        return web.json_response({"success": False, "error": data}, status=500)
    return web.json_response({"success": True, "library": data})


@route("POST", "/eagle_gallery/items")
async def items_route(request):
    try:
        body = await request.json()
        folder_id = body.get("folderId", "")
        keywords = body.get("keywords", "")
        tags = body.get("tags", [])
        star = body.get("star", "")
        shape = body.get("shape", "")  # 横向 / 纵向 / 方形
        color = body.get("color", "")  # hex 颜色筛选
        resolution = body.get("resolution", "")
        fmt = body.get("format", "")
        offset = max(0, int(body.get("offset", body.get("page", 0))))
        limit = min(200, max(1, int(body.get("limit", PAGE_SIZE))))

        # 当有 shape/color/star 筛选时，多取数据再过滤
        need_shape_filter = shape and shape != "全部"
        need_color_filter = bool(color)
        need_star_filter = star and star != "全部"
        need_resolution_filter = resolution and resolution != "全部"
        need_format_filter = fmt and fmt != "全部"
        need_tags_filter = bool(tags)
        need_extra = need_shape_filter or need_color_filter or need_star_filter or need_resolution_filter or need_format_filter or need_tags_filter
        fetch_limit = limit * 6 if need_extra else limit

        # ── 构建 V2 API 请求体 ──
        v2_body = {"limit": fetch_limit, "offset": offset}
        if folder_id:
            v2_body["folders"] = [folder_id]
        if keywords:
            v2_body["keywords"] = [keywords]
        
        # 评分过滤逻辑增强
        if need_star_filter:
            try:
                if star == "未评分":
                    v2_body["rating"] = 0
                else:
                    v2_body["rating"] = int(star[0])
            except (ValueError, IndexError):
                pass
        if shape and shape != "全部":
            shape_map = {"横向": "landscape", "纵向": "portrait", "方形": "square"}
            v2_body["shape"] = shape_map.get(shape, shape)

        ok, v2_data = _eagle_v2_request("/api/v2/item/get", v2_body)
        if not ok:
            return web.json_response({"success": False, "error": v2_data}, status=500)

        # V2 response: data.data 是 items 列表
        items = v2_data.get("data", []) if isinstance(v2_data, dict) else []
        if not isinstance(items, list):
            items = []
        raw_count = len(items)

        # shape 筛选
        if need_shape_filter:
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
            items = filtered[:limit]
            total = offset + len(items)
            if raw_count >= fetch_limit and len(filtered) >= limit:
                total = offset + len(items) + 1  # 暗示还有更多
        else:
            total = offset + len(items)
            if raw_count >= limit:
                total = offset + len(items) + 1  # 暗示还有更多

        # ── 颜色筛选（后端 RGB 欧氏距离）──
        if need_color_filter:
            try:
                r = int(color[0:2], 16)
                g = int(color[2:4], 16)
                b = int(color[4:6], 16)
            except (ValueError, IndexError):
                r, g, b = 0, 0, 0

            color_filtered = []
            for item in items:
                palettes = item.get("palettes", [])
                if not palettes:
                    continue
                matched = False
                for palette in palettes:
                    # palette 格式: [[r, g, b], ratio]
                    pc = palette[0] if isinstance(palette, list) and len(palette) > 0 else []
                    if len(pc) < 3:
                        continue
                    dist = math.sqrt((pc[0] - r)**2 + (pc[1] - g)**2 + (pc[2] - b)**2)
                    if dist < 120:
                        matched = True
                        break
                if matched:
                    color_filtered.append(item)
            items = color_filtered[:limit]
            total = offset + len(items)
            if raw_count >= fetch_limit and len(color_filtered) >= limit:
                total = offset + len(items) + 1

        # ── 分辨率筛选 ──
        if need_resolution_filter:
            resolution_map = {
                "<720p": (0, 1280 * 720),
                "720p-1080p": (1280 * 720, 1920 * 1080),
                "1080p-2k": (1920 * 1080, 2560 * 1440),
                "2k-4k": (2560 * 1440, 3840 * 2160),
                ">4k": (3840 * 2160, float('inf')),
            }
            min_px, max_px = resolution_map.get(resolution, (0, float('inf')))
            items = [it for it in items if min_px <= (it.get("width", 0) * it.get("height", 0)) <= max_px]

        # ── 格式筛选 ──
        if need_format_filter:
            items = [it for it in items if (it.get("ext", "") or "").lower() == fmt.lower()]

        # ── 标签筛选（多选交集） ──
        if need_tags_filter:
            def _has_all_tags(item, required):
                item_tags = set(str(t).lower() for t in item.get("tags", []))
                return all(str(t).lower() in item_tags for t in required)
            items = [it for it in items if _has_all_tags(it, tags)]

        # 批量获取缩略图路径（供前端直接使用）
        _batch_fetch_thumbnails(items)

        return web.json_response({"success": True, "items": items, "total": total, "offset": offset, "limit": limit})

    except Exception as e:
        logger.error(f"[EagleGallery] items 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eagle_gallery/tags")
async def tags_route(request):
    """获取当前文件夹/搜索条件下的标签列表及数量（用于标签弹窗）。"""
    try:
        body = await request.json()
        folder_id = body.get("folderId", "")
        keywords = body.get("keywords", "")

        # 先拉取符合条件的 items（用较大 limit 保证标签覆盖）
        v2_body = {"limit": 500, "offset": 0}
        if folder_id:
            v2_body["folders"] = [folder_id]
        if keywords:
            v2_body["keywords"] = [keywords]

        ok, v2_data = _eagle_v2_request("/api/v2/item/get", v2_body)
        if not ok:
            return web.json_response({"success": False, "error": v2_data}, status=500)

        items = v2_data.get("data", []) if isinstance(v2_data, dict) else []
        if not isinstance(items, list):
            items = []

        counter = {}
        for item in items:
            for tag in item.get("tags", []) or []:
                name = str(tag)
                counter[name] = counter.get(name, 0) + 1

        tags = [{"name": name, "count": count} for name, count in counter.items()]
        tags.sort(key=lambda x: x["name"].lower())
        return web.json_response({"success": True, "tags": tags, "total": len(tags)})

    except Exception as e:
        logger.error(f"[EagleGallery] tags 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


def _eagle_v2_item_info(item_id: str):
    """通过 V2 获取单个 item 的详细信息（含 filePath / thumbnail）。"""
    ok, data = _eagle_v2_request("/api/v2/item/get", {"id": item_id})
    if not ok:
        logger.warning(f"[EagleGallery] V2 item/get failed for {item_id}: {data}")
        return {}
    if not isinstance(data, dict):
        logger.warning(f"[EagleGallery] V2 item/get unexpected response type for {item_id}: {type(data)}")
        return {}
    # V2 响应可能是 {data: {...}} 或 {data: {data: [...], total: N}}
    inner = data.get("data", data)
    if isinstance(inner, list) and len(inner) > 0:
        return inner[0]
    if isinstance(inner, dict):
        # 检查是否是分页格式 {data: [...], total: N}
        if "data" in inner and isinstance(inner["data"], list) and len(inner["data"]) > 0:
            return inner["data"][0]
        return inner
    logger.warning(f"[EagleGallery] V2 item/get no item found for {item_id}")
    return {}


# ── 原图路径解析 helpers ─────────────────────────────────────────────────────
# 修复：Eagle API V2 返回的 filePath 在部分场景下是 URL 编码路径、缩略图路径，
# 或者干脆缺失。这里做四层回退：URL 解码 → 同目录原图 → .info 目录扫描 → HTTP 缩略图。

_SUPPORTED_IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif")


def _get_eagle_library_path() -> str:
    """同步获取 Eagle 资源库根目录（V2 API）。"""
    try:
        ok, data = _eagle_v2_request("/api/v2/library/info")
        if ok and isinstance(data, dict):
            if "path" in data and data["path"]:
                return data["path"]
            lib = data.get("library", {})
            return lib.get("path", "")
    except Exception as e:
        logger.warning(f"[EagleGallery] 获取 Eagle 资源库路径失败: {e}")
    return ""


def _open_image(path: str):
    """打开本地图片并强制加载，失败返回 None。"""
    if not path or not os.path.exists(path):
        return None
    try:
        img = Image.open(path)
        img.load()
        return img
    except Exception as e:
        logger.warning(f"[EagleGallery] 打开图片失败 {path}: {e}")
        return None


def _is_thumbnail_filename(fname: str) -> bool:
    """判断文件名是否是 Eagle 缩略图。"""
    if not fname:
        return False
    low = fname.lower()
    base, _ = os.path.splitext(low)
    return low.startswith("_thumbnail") or base.endswith("_thumbnail")


def _scan_info_folder(info_dir: str, prefer_original: bool = True):
    """扫描 Eagle .info 目录，返回最佳图片路径。"""
    if not info_dir or not os.path.isdir(info_dir):
        return None
    try:
        # 优先读取 metadata.json 中的 name + ext
        meta_path = os.path.join(info_dir, "metadata.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                name = meta.get("name", "")
                ext = meta.get("ext", "")
                if name and ext:
                    candidate = os.path.join(info_dir, f"{name}.{ext}")
                    if os.path.exists(candidate):
                        return candidate
            except Exception as e:
                logger.warning(f"[EagleGallery] 读取 metadata.json 失败: {e}")

        originals = []
        thumbs = []
        for fname in os.listdir(info_dir):
            low = fname.lower()
            if low == "metadata.json" or not low.endswith(_SUPPORTED_IMG_EXT):
                continue
            fpath = os.path.join(info_dir, fname)
            try:
                with Image.open(fpath) as im:
                    w, h = im.size
                area = w * h
            except Exception:
                area = 0
            if _is_thumbnail_filename(fname):
                thumbs.append((area, fpath))
            else:
                originals.append((area, fpath))

        if prefer_original:
            if originals:
                originals.sort(key=lambda x: x[0], reverse=True)
                return originals[0][1]
        if thumbs:
            thumbs.sort(key=lambda x: x[0], reverse=True)
            return thumbs[0][1]
        return None
    except Exception as e:
        logger.warning(f"[EagleGallery] 扫描 .info 目录失败 {info_dir}: {e}")
        return None


def _http_thumbnail_image(item_id: str):
    """从 Eagle HTTP 缩略图端点加载图片，返回 PIL Image。"""
    if not item_id:
        return None
    try:
        thumb_path = _eagle_v1_thumbnail(item_id)
        if thumb_path:
            thumb_path = urllib.parse.unquote(thumb_path)
            if os.path.isfile(thumb_path):
                img = _open_image(thumb_path)
                if img:
                    return img
        # V1 路径也失败，尝试通过 V2 拿到 thumbnail 路径
        v2_item = _eagle_v2_item_info(item_id)
        for key in ("thumbnail", "thumbnailPath", "filePath"):
            path = v2_item.get(key, "")
            if path:
                path = urllib.parse.unquote(path)
                img = _open_image(path)
                if img:
                    return img
    except Exception as e:
        logger.warning(f"[EagleGallery] HTTP 缩略图加载失败 {item_id}: {e}")
    return None


def _resolve_image_path(sel: dict):
    """解析选中项对应的真实图片路径（优先原图）。返回 (img, path_or_id)。"""
    item_id = sel.get("id", "")
    raw_path = sel.get("filePath", "") or ""
    file_path = urllib.parse.unquote(raw_path) if raw_path else ""

    # 1. 如果已有 filePath 且存在，并非常规缩略图，直接用
    if file_path and os.path.isfile(file_path) and not _is_thumbnail_filename(file_path):
        img = _open_image(file_path)
        if img:
            logger.info(f"[EagleGallery] 直接加载: {file_path}")
            return img, file_path

    # 2. filePath 指向缩略图时，到同目录找原图
    if file_path and os.path.isfile(file_path):
        parent = os.path.dirname(file_path)
        scanned = _scan_info_folder(parent, prefer_original=True)
        if scanned:
            img = _open_image(scanned)
            if img:
                logger.info(f"[EagleGallery] 同目录扫描原图: {scanned}")
                return img, scanned

    # 3. 用 item_id + name/ext 构造确定性路径
    lib_path = _get_eagle_library_path()
    if lib_path and item_id:
        info_dir = os.path.join(lib_path, "images", f"{item_id}.info")
        name = sel.get("name", "")
        ext = sel.get("ext", "")
        if name and ext:
            candidate = os.path.join(info_dir, f"{name}.{ext}")
            img = _open_image(candidate)
            if img:
                logger.info(f"[EagleGallery] 确定性路径加载: {candidate}")
                return img, candidate
        # 4. 扫描 .info 目录
        scanned = _scan_info_folder(info_dir, prefer_original=True)
        if scanned:
            img = _open_image(scanned)
            if img:
                logger.info(f"[EagleGallery] .info 扫描原图: {scanned}")
                return img, scanned
        # 5. 缩略图降级
        scanned_thumb = _scan_info_folder(info_dir, prefer_original=False)
        if scanned_thumb:
            img = _open_image(scanned_thumb)
            if img:
                logger.warning(f"[EagleGallery] 未找到原图，降级加载缩略图: {scanned_thumb}")
                return img, scanned_thumb

    # 6. 最后回退：HTTP 缩略图
    img = _http_thumbnail_image(item_id)
    if img:
        logger.warning(f"[EagleGallery] 未找到本地文件，使用 HTTP 缩略图 id={item_id}")
        return img, f"eagle://thumb/{item_id}"

    return None, ""


def _generate_placeholder_image() -> bytes:
    """生成一个带'无缩略图'文字的 SVG 占位图（避免透明 PNG 在暗色背景上显示为黑块）。"""
    svg_text = """<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">
  <rect width="200" height="150" fill="#2a2a36"/>
  <text x="100" y="80" text-anchor="middle" fill="#666" font-size="14" font-family="system-ui">No Thumbnail</text>
</svg>"""
    return svg_text.encode("utf-8")


_PLACEHOLDER_BYTES = _generate_placeholder_image()


@route("GET", "/eagle_gallery/thumbnail")
async def thumbnail_route(request):
    """代理 Eagle 缩略图 — 从 V1 端点获取路径后读磁盘返回图片；V1 失败时回退到 V2。"""
    item_id = request.query.get("id", "")
    if not item_id:
        return web.Response(status=400, text="missing id")

    try:
        # 尝试 V1 端点
        path = _eagle_v1_thumbnail(item_id)
        if path:
            # 关键修复：解码 URL 编码的路径（如 %E8%B5%84%E6%BA%90%E5%BA%93）
            path = urllib.parse.unquote(path)
            logger.info(f"[EagleGallery] V1 thumbnail path for {item_id}: {path}")

        # V1 失败 → 回退到 V2 获取 filePath / thumbnail
        if not path:
            v2_item = _eagle_v2_item_info(item_id)
            # 尝试多种可能的字段名
            path = v2_item.get("thumbnail") or v2_item.get("thumbnailPath") or v2_item.get("filePath") or ""
            if path:
                path = urllib.parse.unquote(path)
                logger.info(f"[EagleGallery] V2 fallback path for {item_id}: {path}")

        if path and os.path.isfile(path):
            try:
                img = Image.open(path)
                # 如果图片太大，缩放到缩略图尺寸
                max_size = (400, 400)
                if img.width > max_size[0] or img.height > max_size[1]:
                    img.thumbnail(max_size, Image.LANCZOS)
                buf = io.BytesIO()
                fmt = img.format or "JPEG"
                # 统一转换为 JPEG 以提高兼容性
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                    fmt = "JPEG"
                img.save(buf, format=fmt, quality=85)
                buf.seek(0)
                return web.Response(body=buf.read(),
                    headers={"Content-Type": "image/" + fmt.lower(), "Cache-Control": "public, max-age=86400"})
            except Exception as img_e:
                logger.warning(f"[EagleGallery] 图片处理失败 {path}: {img_e}")
                return web.Response(body=_PLACEHOLDER_BYTES,
                    headers={"Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=60"})

        # 所有方法都失败 → 返回占位图（避免前端 onError 循环）
        logger.warning(f"[EagleGallery] 无可用缩略图 {item_id}")
        return web.Response(body=_PLACEHOLDER_BYTES,
            headers={"Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=60"})
    except Exception as e:
        logger.warning(f"[EagleGallery] 缩略图代理失败 {item_id}: {e}")
        return web.Response(body=_PLACEHOLDER_BYTES,
            headers={"Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=60"})


@route("POST", "/eagle_gallery/item_info")
async def item_info_route(request):
    """批量获取 item 详细信息（含 filePath）。"""
    try:
        body = await request.json()
        item_ids = body.get("ids", [])
        if not item_ids:
            return web.json_response({"success": False, "error": "无 item IDs"})

        results = []
        for item_id in item_ids:
            ok, data = _eagle_v2_request("/api/v2/item/get", {"id": item_id})
            if ok and isinstance(data, dict):
                item = data.get("data", data)
                if isinstance(item, list) and len(item) > 0:
                    item = item[0]
                if isinstance(item, dict):
                    results.append({
                        "id": item_id,
                        "filePath": item.get("filePath", item.get("url", "")),
                        "name": item.get("name", ""),
                        "ext": item.get("ext", ""),
                        "width": item.get("width", 0),
                        "height": item.get("height", 0),
                        "tags": item.get("tags", []),
                        "star": item.get("star", 0),
                        "annotation": item.get("annotation", ""),
                    })

        return web.json_response({"success": True, "items": results})

    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eagle_gallery/cache_selection")
async def cache_selection_post_route(request):
    """缓存节点选中数据 + 前端配置（output_mode / sequence_index）。"""
    try:
        body = await request.json()
        node_id = str(body.get("node_id", ""))
        if node_id:
            selections = body.get("selections")
            # 兼容性处理：如果前端发送的是 selection_data 字符串（Pinterest/Wallhaven 逻辑）
            if selections is None:
                selection_data_str = body.get("selection_data")
                if selection_data_str:
                    try:
                        data = json.loads(selection_data_str)
                        selections = data.get("selections", [])
                    except:
                        selections = []
            
            _selection_cache[node_id] = {
                "selections": selections if selections is not None else [],
                "output_mode": body.get("output_mode", "rgb"),
                "sequence_index": body.get("sequence_index", 0),
            }
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/eagle_gallery/cache_selection")
async def cache_selection_get_route(request):
    """获取节点缓存的选中数据。"""
    try:
        node_id = str(request.query.get("node_id", ""))
        cache = _selection_cache.get(node_id, {})
        if isinstance(cache, list):
            # 兼容旧格式（纯列表）
            cache = {"selections": cache, "output_mode": "rgb", "sequence_index": 0}
        return web.json_response({"success": True, "selections": cache.get("selections", []), "output_mode": cache.get("output_mode", "rgb"), "sequence_index": cache.get("sequence_index", 0)})
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
            "required": {
                "trigger": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {
                "selection_data": ("STRING", {"default": "{}", "multiline": False}),
            },
            "hidden": {
                # 修复：之前没有声明这个隐藏输入，load_images() 里
                # kwargs.get("node_id") 永远拿不到真实节点 ID（永远是
                # "default"），导致前端按真实 node.id 缓存的选中数据
                # 在执行时对不上，读到的永远是空/错误的缓存。
                "node_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT")
    RETURN_NAMES = ("images", "tags", "selection_data", "next_index")
    OUTPUT_IS_LIST = (True, True, False, False)
    FUNCTION = "load_images"
    CATEGORY = "🦅 Eagle"
    OUTPUT_NODE = True

    def load_images(self, trigger="", selection_data="{}", **kwargs):
        """从缓存或备份数据读取选中项。"""
        node_id = str(kwargs.get("node_id", "default"))
        cache = _selection_cache.get(node_id, {})

        selections = cache.get("selections", [])
        output_mode = cache.get("output_mode", "rgb")
        sequence_index = cache.get("sequence_index", 0)

        # 备份恢复逻辑：如果内存缓存丢失，尝试从节点属性中恢复
        if not selections and selection_data and selection_data != "{}":
            try:
                data = json.loads(selection_data)
                selections = data.get("selections", [])
                _selection_cache[node_id] = {
                    "selections": selections,
                    "output_mode": data.get("output_mode", "rgb"),
                    "sequence_index": data.get("sequence_index", 0),
                }
                logger.info(f"[EagleGallery] 内存缓存丢失，从节点属性恢复了 {len(selections)} 个选中项")
            except: pass

        return_rgba = (output_mode == "rgba")

        if not selections:
            logger.warning(f"[EagleGallery] 节点 {node_id} 无选中数据，返回空占位")
            # 强化空选择处理：返回一个黑色 64x64 占位符和空字符串
            dummy_shape = (1, 64, 64, 4) if return_rgba else (1, 64, 64, 3)
            black_tensor = torch.zeros(dummy_shape, dtype=torch.float32)
            return ([black_tensor], [""], "{}", sequence_index)

        # ── 顺序索引裁剪 ──
        target_selections = selections
        idx = sequence_index % len(selections)
        if idx > 0:
            target_selections = selections[idx:] + selections[:idx]
            logger.info(f"[EagleGallery] 起始索引 {idx}/{len(selections)}")

        # ── 批量补全缺失 filePath ───────────────────────
        needs_fetch = []
        for sel in target_selections:
            if not sel.get("filePath") and sel.get("id"):
                needs_fetch.append(sel["id"])

        if needs_fetch:
            batch_info = self._fetch_item_batch(needs_fetch)
            for sel in target_selections:
                if sel["id"] in batch_info:
                    sel.setdefault("filePath", batch_info[sel["id"]].get("filePath", ""))
                    if not sel.get("tags"):
                        sel["tags"] = batch_info[sel["id"]].get("tags", [])

        images = []
        tags_list = []

        for sel in target_selections:
            tags = sel.get("tags", [])

            tags_str = ", ".join([str(t) for t in tags if t]) if tags else ""
            tags_list.append(tags_str)

            # 使用多级回退解析原图路径（URL 解码 / 同目录扫描 / .info 扫描 / HTTP 缩略图）
            img, resolved_path = _resolve_image_path(sel)
            if img:
                try:
                    if return_rgba:
                        # RGBA 模式：保留透明通道
                        if img.mode != "RGBA":
                            img = img.convert("RGBA")
                        arr = np.array(img).astype(np.float32) / 255.0
                        # ComfyUI RGBA: (B, H, W, 4)
                        tensor = torch.from_numpy(arr)[None,]
                    else:
                        # RGB 模式：去透明通道
                        if img.mode == "RGBA":
                            bg = Image.new("RGB", img.size, (255, 255, 255))
                            bg.paste(img, mask=img.split()[3])
                            img = bg
                        else:
                            img = img.convert("RGB")
                        arr = np.array(img).astype(np.float32) / 255.0
                        tensor = torch.from_numpy(arr)[None,]

                    images.append(tensor)
                except Exception as e:
                    logger.error(f"[EagleGallery] 转换图片失败 {resolved_path}: {e}")
                    dummy_shape = (1, 64, 64, 4) if return_rgba else (1, 64, 64, 3)
                    images.append(torch.zeros(dummy_shape))
            else:
                item_id = sel.get("id", "")
                logger.warning(f"[EagleGallery] 无法解析图片路径 id={item_id}")
                dummy_shape = (1, 64, 64, 4) if return_rgba else (1, 64, 64, 3)
                images.append(torch.zeros(dummy_shape))

        next_idx = sequence_index
        raw_data = json.dumps({"selections": selections}, ensure_ascii=False)

        return (images, tags_list, raw_data, next_idx)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 以节点 ID 为变化标识，确保每次执行都读取最新缓存
        return float('nan')

    def _fetch_item_batch(self, item_ids: list) -> dict:
        """批量获取 item 元数据，直接调用内部逻辑避免 HTTP 端口冲突。"""
        if not item_ids:
            return {}
        try:
            results = {}
            for item_id in item_ids:
                ok, data = _eagle_v2_request("/api/v2/item/get", {"id": item_id})
                if ok and isinstance(data, dict):
                    item = data.get("data", data)
                    if isinstance(item, list) and len(item) > 0:
                        item = item[0]
                    if isinstance(item, dict):
                        results[item_id] = {
                            "id": item_id,
                            "filePath": item.get("filePath", item.get("url", "")),
                            "name": item.get("name", ""),
                            "tags": item.get("tags", []),
                        }
            return results
        except Exception as e:
            logger.warning(f"[EagleGallery] 批量获取 item 信息失败: {e}")
        return {}


__all__ = ["EagleGalleryNode"]
