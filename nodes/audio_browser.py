# -*- coding: utf-8 -*-
"""
EagleAudioList — 音频浏览器（统一媒体浏览器风格）
支持目录树、网格/列表浏览、搜索、排序、多选、重命名、播放预览
"""

import os
import io
import math
import json
import time
import asyncio
import hashlib
import shutil
import atexit
import subprocess
import threading
from datetime import datetime
from urllib.parse import quote

import folder_paths
from aiohttp import web
from PIL import Image, ImageDraw, ImageFont

from ..tools_utils import (
    AUDIO_EXTENSIONS,
    authorize_media_root,
    find_files,
    get_setting,
    is_trusted_browser_request,
    resolve_allowed_media_path,
)
from ..eagle_suite.logger import logger
from ..eagle_suite.route_registry import route

# ── 缓存 ─────────────────────────────────────────────────────
_directory_cache = {}
_cache_timestamps = {}
_directory_cache_lock = threading.RLock()
_thumbnail_cache = {}
_thumbnail_cache_lock = asyncio.Lock() if hasattr(asyncio, "Lock") else None
_THUMB_CACHE_DIR = os.path.join(
    folder_paths.get_temp_directory(),
    "eagle_suite_audio_thumbs",
)


def _clear_thumbnail_disk_cache() -> None:
    try:
        shutil.rmtree(_THUMB_CACHE_DIR, ignore_errors=True)
    except Exception as error:
        logger.debug(f"[EagleAudioList] 清理缩略图缓存失败: {error}")


_clear_thumbnail_disk_cache()
atexit.register(_clear_thumbnail_disk_cache)


def _get_audio_directory():
    custom = get_setting('EagleFileTools.audio_path')
    if custom:
        return custom
    return os.path.join(folder_paths.models_dir, "TTS", "MegaTTS3", "speakers")


def _format_duration(seconds):
    if seconds <= 0:
        return "--:--"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _try_get_audio_duration(path):
    """尝试获取音频时长，失败返回 0。"""
    try:
        ext = os.path.splitext(path)[1].lower()
        if ext == ".wav":
            try:
                import wave
                with wave.open(path, "rb") as w:
                    frames = w.getnframes()
                    rate = w.getframerate()
                    return frames / float(rate) if rate else 0
            except Exception:
                pass

        try:
            from mutagen.mp3 import MP3
            from mutagen.wave import WAVE
            from mutagen.flac import FLAC
            from mutagen.oggvorbis import OggVorbis
            from mutagen.aac import AAC

            handlers = {
                ".mp3": MP3,
                ".wav": WAVE,
                ".flac": FLAC,
                ".ogg": OggVorbis,
                ".aac": AAC,
            }
            handler = handlers.get(ext)
            if handler:
                info = handler(path)
                return info.info.length if info and hasattr(info, "info") else 0
        except Exception:
            pass

        try:
            import ffmpeg
            probe = ffmpeg.probe(path)
            fmt = probe.get("format", {})
            duration = fmt.get("duration")
            return float(duration) if duration else 0
        except Exception:
            pass

        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", path],
                capture_output=True, text=True, timeout=15, check=False,
            ).stdout.strip()
            return float(result) if result else 0
        except Exception:
            pass
    except Exception as e:
        logger.debug(f"[EagleAudioList] 读取时长失败 {path}: {e}")
    return 0


def _scan_audio_files(directory, recursive=True):
    """扫描目录中的音频文件，支持可选递归。"""
    files = []
    try:
        if recursive:
            for root, _, filenames in os.walk(directory):
                for filename in filenames:
                    if os.path.splitext(filename)[1].lower() in AUDIO_EXTENSIONS:
                        files.append(os.path.join(root, filename))
        else:
            for entry in os.scandir(directory):
                if entry.is_file() and os.path.splitext(entry.name)[1].lower() in AUDIO_EXTENSIONS:
                    files.append(entry.path)
    except Exception as e:
        logger.warning(f"[EagleAudioList] 扫描目录失败 {directory}: {e}")
    return files


def _get_audio_files(directory, recursive=True):
    if not os.path.isdir(directory):
        return []

    directory = os.path.abspath(directory)
    cache_key = f"{directory}:{int(bool(recursive))}"
    with _directory_cache_lock:
        cache_time = _cache_timestamps.get(cache_key, 0)
        if cache_key in _directory_cache and (time.time() - cache_time) < 60:
            return list(_directory_cache[cache_key])

    files = _scan_audio_files(directory, recursive)

    items = []
    for f in files:
        try:
            duration = _try_get_audio_duration(f)
            items.append({
                "path": f,
                "name": os.path.basename(f),
                "type": "audio",
                "modified": os.path.getmtime(f),
                "size": os.path.getsize(f),
                "duration": duration,
            })
        except Exception as e:
            logger.warning(f"[EagleAudioList] 无法读取文件 {f}: {e}")
            continue

    with _directory_cache_lock:
        _directory_cache[cache_key] = items
        _cache_timestamps[cache_key] = time.time()
    return items


def _build_folder_tree(directory, _visited=None, _depth=0):
    if _depth > 32:
        return []
    _visited = _visited if _visited is not None else set()
    canonical = os.path.normcase(os.path.realpath(directory))
    if canonical in _visited:
        return []
    _visited.add(canonical)
    if not os.path.isdir(directory):
        return []
    tree = []
    try:
        items = sorted(os.listdir(directory))
        for item in items:
            item_path = os.path.join(directory, item)
            if os.path.isdir(item_path):
                tree.append({
                    "id": item_path,
                    "name": item,
                    "path": item_path,
                    "children": _build_folder_tree(item_path, _visited, _depth + 1)
                })
    except PermissionError:
        logger.warning(f"[EagleAudioList] 无权限访问 {directory}")
    except Exception as e:
        logger.warning(f"[EagleAudioList] 读取目录失败 {directory}: {e}")
    return tree


def _thumb_cache_path(path, size):
    stat = os.stat(path)
    raw = f"{os.path.abspath(path)}|{stat.st_mtime_ns}|{stat.st_size}|{size}"
    key = hashlib.sha256(raw.encode("utf-8", errors="surrogatepass")).hexdigest()
    os.makedirs(_THUMB_CACHE_DIR, exist_ok=True)
    return os.path.join(_THUMB_CACHE_DIR, f"{key}.png")


def _build_audio_thumbnail(path, size):
    """生成音频波形占位缩略图（带时长标签）。"""
    cache_path = _thumb_cache_path(path, size)
    if os.path.isfile(cache_path) and os.path.getsize(cache_path) > 0:
        with open(cache_path, "rb") as f:
            return f.read(), "image/png"

    duration = _try_get_audio_duration(path)
    duration_text = _format_duration(duration)
    width = max(96, size)
    height = max(72, int(size * 0.75))
    try:
        img = Image.new("RGB", (width, height), (23, 23, 29))
        draw = ImageDraw.Draw(img)

        # 波形条
        bar_count = min(40, width // 6)
        bar_gap = 2
        bar_w = max(2, (width - 20) // bar_count - bar_gap)
        max_h = height - 40
        import random
        rng = random.Random(hash(path) & 0xffffffff)
        cx = width // 2
        cy = height // 2
        for i in range(bar_count):
            h = int(max_h * (0.2 + 0.8 * rng.random()))
            x = 10 + i * (bar_w + bar_gap)
            y1 = cy - h // 2
            y2 = cy + h // 2
            color = (58, 90, 138) if i % 2 == 0 else (74, 125, 224)
            draw.rounded_rectangle([x, y1, x + bar_w, y2], radius=2, fill=color)

        # 时长
        try:
            font = ImageFont.truetype("arial.ttf", 12)
        except Exception:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), duration_text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = width - tw - 8
        ty = height - th - 8
        draw.rectangle([tx - 4, ty - 2, width - 4, height - 4], fill=(0, 0, 0, 180))
        draw.text((tx, ty), duration_text, fill=(200, 200, 200), font=font)

        # 音符图标
        draw.text((10, 8), "♪", fill=(200, 200, 200), font=font)

        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        with open(cache_path, "wb") as f:
            f.write(data)
        return data, "image/png"
    except Exception as e:
        logger.warning(f"[EagleAudioList] 缩略图生成失败 {path}: {e}")
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">'
            b'<rect width="256" height="256" fill="#17171d"/>'
            b'<text x="128" y="120" text-anchor="middle" fill="#888" font-size="48">&#9835;</text>'
            b'<text x="128" y="150" text-anchor="middle" fill="#666" font-size="12">Audio</text>'
            b'</svg>'
        )
        return svg, "image/svg+xml"


# ── 路由 ─────────────────────────────────────────────────────

@route("POST", "/EagleAudioList/authorize_root")
async def authorize_root(request):
    """Authorize a user-entered audio directory for this UI session."""
    if not is_trusted_browser_request(request):
        return web.json_response({"success": False, "error": "仅允许同源界面授权音频目录"}, status=403)
    try:
        data = await request.json()
        root_dir = authorize_media_root(data.get("directory", ""), "audio")
        if not root_dir:
            return web.json_response({"success": False, "error": "目录不存在、不可访问或不是绝对路径"}, status=400)
        return web.json_response({"success": True, "root": root_dir})
    except Exception as error:
        logger.warning(f"[EagleAudioList] 授权目录失败: {error}")
        return web.json_response({"success": False, "error": str(error)}, status=400)


@route("GET", "/EagleAudioList/folders")
async def get_folders(request):
    try:
        root_dir = request.query.get("directory", "").strip()
        root_dir = resolve_allowed_media_path(root_dir, "audio", "directory")
        if not root_dir:
            return web.json_response({"success": False, "error": "目录未配置为允许的音频根目录"}, status=403)
        tree = await asyncio.to_thread(_build_folder_tree, root_dir)
        return web.json_response({"success": True, "folders": tree, "root": root_dir})
    except Exception as e:
        logger.error(f"[EagleAudioList] get_folders error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/EagleAudioList/list")
async def list_audio(request):
    try:
        body = await request.json()
        directory = body.get("directory", "").strip()
        recursive = bool(body.get("recursive", True))
        keyword = body.get("keyword", "").strip().lower()
        sort_by = body.get("sort_by", "name")
        sort_dir = body.get("sort_dir", "asc")
        offset = int(body.get("offset", 0))
        limit = max(1, min(200, int(body.get("limit", 50))))

        directory = resolve_allowed_media_path(directory, "audio", "directory")
        if not directory:
            return web.json_response({"success": False, "error": "目录未配置为允许的音频根目录"}, status=403)

        files = await asyncio.to_thread(_get_audio_files, directory, recursive)

        if keyword:
            files = [f for f in files if keyword in f["name"].lower()]

        reverse = (sort_dir == "desc")
        if sort_by == "name":
            files.sort(key=lambda x: x["name"].lower(), reverse=reverse)
        elif sort_by == "modified":
            files.sort(key=lambda x: x["modified"], reverse=reverse)
        elif sort_by == "size":
            files.sort(key=lambda x: x["size"], reverse=reverse)
        elif sort_by == "duration":
            files.sort(key=lambda x: x.get("duration", 0), reverse=reverse)

        total = len(files)
        page_data = files[offset:offset + limit]
        has_more = (offset + limit) < total

        items = []
        for f in page_data:
            rel = os.path.relpath(f["path"], directory).replace("\\", "/")
            items.append({
                "id": f"{f['path']}_{int(f['modified'] * 1000)}",
                "name": f["name"],
                "path": f["path"],
                "rel": rel,
                "type": "audio",
                "size": f["size"],
                "modified": f["modified"],
                "duration": f.get("duration", 0),
                "hasPreview": True,
            })

        return web.json_response({
            "success": True,
            "items": items,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": has_more,
        })
    except Exception as e:
        logger.error(f"[EagleAudioList] list_audio error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/EagleAudioList/thumbnail")
async def get_thumbnail(request):
    try:
        path = request.query.get("path", "").strip()
        path = resolve_allowed_media_path(path, "audio", "file")
        if not path:
            return web.Response(status=404, text="文件不存在")
        size = max(96, min(512, int(request.query.get("size", 256))))
        data, content_type = await asyncio.to_thread(_build_audio_thumbnail, path, size)
        stat = os.stat(path)
        return web.Response(body=data, headers={
            "Content-Type": content_type,
            "Cache-Control": "public, max-age=86400, immutable",
            "ETag": f'"{stat.st_mtime_ns:x}-{stat.st_size:x}-{size}"',
        })
    except Exception as e:
        logger.warning(f"[EagleAudioList] thumbnail error: {e}")
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#17171d"/><text x="128" y="132" text-anchor="middle" fill="#666" font-size="14">Audio</text></svg>'
        return web.Response(body=svg, headers={"Content-Type": "image/svg+xml", "Cache-Control": "no-store"})


@route("GET", "/EagleAudioList/stream")
async def stream_audio(request):
    """直接返回音频文件流，用于前端预览播放。"""
    try:
        path = request.query.get("path", "").strip()
        path = resolve_allowed_media_path(path, "audio", "file")
        if not path:
            return web.Response(status=404, text="文件不存在")

        ext = os.path.splitext(path)[1].lower()
        mime_map = {
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".ogg": "audio/ogg",
            ".flac": "audio/flac",
            ".aac": "audio/aac",
            ".m4a": "audio/mp4",
            ".wma": "audio/x-ms-wma",
            ".opus": "audio/opus",
        }
        content_type = mime_map.get(ext, "application/octet-stream")
        return web.FileResponse(path, headers={
            "Content-Type": content_type,
            "Accept-Ranges": "bytes",
        })
    except Exception as e:
        logger.warning(f"[EagleAudioList] stream error: {e}")
        return web.Response(status=500, text=str(e))


@route("POST", "/EagleAudioList/rename_audio")
async def rename_audio(request):
    try:
        data = await request.json()
        path = resolve_allowed_media_path(data.get("path", ""), "audio", "file")
        new_name = str(data.get("new_name", "")).strip()
        if not path or not new_name:
            return web.json_response({"success": False, "error": "参数不足"})
        if new_name != os.path.basename(new_name) or new_name in (".", ".."):
            return web.json_response({"success": False, "error": "新名称只能是文件名"}, status=400)
        ext = os.path.splitext(path)[1]
        if not new_name.lower().endswith(ext.lower()):
            new_name += ext
        new_path = os.path.realpath(os.path.join(os.path.dirname(path), new_name))
        if os.path.dirname(new_path) != os.path.dirname(path):
            return web.json_response({"success": False, "error": "目标路径越界"}, status=400)
        if os.path.exists(new_path) and path != new_path:
            return web.json_response({"success": False, "error": "同名文件已存在"})
        os.rename(path, new_path)
        npy_old = os.path.splitext(path)[0] + ".npy"
        if os.path.isfile(npy_old):
            os.rename(npy_old, os.path.splitext(new_path)[0] + ".npy")
        # 清除缓存，避免旧路径残留
        with _directory_cache_lock:
            _directory_cache.clear()
            _cache_timestamps.clear()
        return web.json_response({"success": True, "path": new_path})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/EagleAudioList/clear_cache")
async def clear_cache(request):
    with _directory_cache_lock:
        _directory_cache.clear()
        _cache_timestamps.clear()
    await asyncio.to_thread(_clear_thumbnail_disk_cache)
    return web.json_response({"success": True})


# ── 节点类 ───────────────────────────────────────────────────

class EagleAudioList:
    """音频浏览器（统一媒体浏览器风格）"""

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "audio_path": ("STRING", {"default": ""}),
                "directory": ("STRING", {"default": ""}),
                "active_directory": ("STRING", {"default": ""}),
                "recursive": ("BOOLEAN", {"default": True}),
                "view_mode": (["grid", "list"], {"default": "grid"}),
                "selection_data": ("STRING", {"default": "[]", "multiline": False}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("audio_path", "audio_paths")
    OUTPUT_IS_LIST = (False, True)
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/音频"

    def process(self, **kwargs):
        selection_data = kwargs.get("selection_data", "[]")
        directory = str(kwargs.get("active_directory") or kwargs.get("directory") or "").strip()
        recursive = bool(kwargs.get("recursive", True))

        try:
            selections = json.loads(selection_data)
        except Exception:
            selections = []

        # 兼容旧工作流：直接用 audio_path widget 的旧路径
        if not selections:
            legacy_path = str(kwargs.get("audio_path") or "").strip()
            if legacy_path and os.path.isfile(legacy_path):
                return (legacy_path, [legacy_path])

        # 没有选择时按当前目录顺序返回第一个音频文件
        if not selections and directory and os.path.isdir(directory):
            files = _get_audio_files(directory, recursive)
            if files:
                files.sort(key=lambda item: os.path.relpath(item["path"], directory).replace("\\", "/").lower())
                selections = [{"path": item["path"], "name": item["name"]} for item in files]

        if selections:
            paths = []
            for item in selections:
                path = resolve_allowed_media_path(item.get("path", ""), "audio", "file")
                if path and os.path.splitext(path)[1].lower() in AUDIO_EXTENSIONS:
                    paths.append(path)
            if paths:
                return (paths[0], paths)

        return ("", [])

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return json.dumps(kwargs, sort_keys=True, ensure_ascii=False, default=str)


__all__ = ["EagleAudioList"]
