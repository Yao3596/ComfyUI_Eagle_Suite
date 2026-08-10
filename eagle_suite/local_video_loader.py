# -*- coding: utf-8 -*-
"""
Eagle Suite - EagleLocalVideoLoaderNode
本地文件夹视频加载器（DOM Widget 型）

不依赖 Eagle 应用，直接读取用户手动填写的本地文件夹路径，浏览其中的视频文件，
支持多选批量输出 VIDEO（ComfyUI 原生视频类型） + AUDIO（音频张量）。

后端职责：
  - /local_video_loader/list       扫描文件夹，返回视频文件列表（不生成缩略图）
  - /local_video_loader/thumbnail  按需生成并缓存单个视频的首帧缩略图
  - /local_video_loader/cache_selection  前端选中后同步到服务端缓存（绕过 widget 序列化不可靠问题）
  - EagleLocalVideoLoaderNode：读取 selection_data → 输出 VIDEO 列表 + AUDIO 列表 + file_paths 列表
"""

import os
import json
import time
import hashlib
import threading

import torch
import numpy as np
from aiohttp import web
from .route_registry import route
from .logger import logger

try:
    import av
    _HAS_AV = True
except ImportError:
    _HAS_AV = False

try:
    import cv2
    _HAS_CV2 = True
except ImportError:
    _HAS_CV2 = False

# ── 常量 ──────────────────────────────────────────────────────────────────────
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".flv", ".wmv", ".m4v", ".mpg", ".mpeg"}

_THUMB_CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", ".local_video_thumb_cache")

# ── 选中数据服务端缓存（同 eagle_video_gallery 的做法，绕过 widget 序列化不可靠问题） ──
_selection_cache_entry: dict | None = None
_selection_cache_lock = threading.Lock()
_CACHE_TTL = 3600  # 1 小时


def _cache_selection(selections: list):
    global _selection_cache_entry
    with _selection_cache_lock:
        _selection_cache_entry = {"selections": selections, "timestamp": time.time()}
    logger.info(f"[LocalVideoLoader] 缓存选中数据: count={len(selections)}")


def _get_cached_selection() -> dict | None:
    global _selection_cache_entry
    now = time.time()
    with _selection_cache_lock:
        if _selection_cache_entry and (now - _selection_cache_entry["timestamp"]) < _CACHE_TTL:
            return _selection_cache_entry
        _selection_cache_entry = None
    return None


# ── 文件夹扫描 ────────────────────────────────────────────────────────────────
def _build_item(fpath: str, name: str, ext: str) -> dict:
    try:
        stat = os.stat(fpath)
        size, mtime = stat.st_size, stat.st_mtime
    except Exception:
        size, mtime = 0, 0
    item_id = hashlib.md5(fpath.encode("utf-8")).hexdigest()
    return {
        "id": item_id,
        "name": name,
        "ext": ext.lstrip("."),
        "filePath": fpath,
        "size": size,
        "mtime": mtime,
    }


def _scan_folder(folder_path: str, recursive: bool) -> list:
    results = []
    if not folder_path or not os.path.isdir(folder_path):
        return results
    if recursive:
        for root, _dirs, files in os.walk(folder_path):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in VIDEO_EXTENSIONS:
                    results.append(_build_item(os.path.join(root, f), f, ext))
    else:
        try:
            for f in os.listdir(folder_path):
                fpath = os.path.join(folder_path, f)
                if not os.path.isfile(fpath):
                    continue
                ext = os.path.splitext(f)[1].lower()
                if ext in VIDEO_EXTENSIONS:
                    results.append(_build_item(fpath, f, ext))
        except Exception as e:
            logger.error(f"[LocalVideoLoader] 扫描文件夹失败: {e}")
    results.sort(key=lambda x: x["name"])
    return results


# ── 缩略图（抓首帧，磁盘缓存，避免每次都重新解码） ────────────────────────────
def _get_thumb_cache_path(file_path: str) -> str:
    os.makedirs(_THUMB_CACHE_DIR, exist_ok=True)
    key = hashlib.md5(file_path.encode("utf-8")).hexdigest()
    return os.path.join(_THUMB_CACHE_DIR, f"{key}.jpg")


def _generate_thumbnail(file_path: str) -> str | None:
    if not _HAS_CV2:
        return None
    thumb_path = _get_thumb_cache_path(file_path)
    if os.path.exists(thumb_path):
        return thumb_path
    try:
        cap = cv2.VideoCapture(file_path)
        cap.set(cv2.CAP_PROP_POS_FRAMES, 5)  # 跳过开头可能的黑帧
        ok, frame = cap.read()
        if not ok:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = cap.read()
        cap.release()
        if not ok:
            return None
        h, w = frame.shape[:2]
        scale = 320 / max(h, w)
        if scale < 1:
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
        cv2.imwrite(thumb_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return thumb_path
    except Exception as e:
        logger.warning(f"[LocalVideoLoader] 生成缩略图失败 {file_path}: {e}")
        return None


# ── 轻量音频提取（只解码音轨，不解码视频帧，避免 get_components() 的开销） ────
def _extract_audio(file_path: str):
    if not _HAS_AV:
        return None
    try:
        with av.open(file_path) as container:
            audio_stream = next(
                (s for s in reversed(container.streams.audio) if s.codec_context is not None), None
            )
            if audio_stream is None:
                return None
            resampler = av.audio.resampler.AudioResampler(format="fltp")
            chunks = []
            for packet in container.demux(audio_stream):
                try:
                    decoded = packet.decode()
                except av.error.FFmpegError:
                    continue
                for frame in decoded:
                    for rframe in resampler.resample(frame):
                        chunks.append(rframe.to_ndarray())
            if not chunks:
                return None
            data = np.concatenate(chunks, axis=1)  # (channels, samples)
            waveform = torch.from_numpy(data).unsqueeze(0)  # (1, channels, samples)
            sample_rate = int(audio_stream.codec_context.sample_rate or audio_stream.rate or 44100)
            return {"waveform": waveform, "sample_rate": sample_rate}
    except Exception as e:
        logger.warning(f"[LocalVideoLoader] 提取音频失败 {file_path}: {e}")
        return None


# ── aiohttp 路由 ──────────────────────────────────────────────────────────────
@route("POST", "/local_video_loader/list")
async def list_videos_route(request):
    try:
        body = await request.json()
        folder_path = (body.get("folderPath") or "").strip()
        recursive = bool(body.get("recursive", False))
        if not folder_path:
            return web.json_response({"success": True, "items": [], "total": 0})
        if not os.path.isdir(folder_path):
            return web.json_response(
                {"success": False, "error": f"路径不存在或不是文件夹: {folder_path}"}, status=400
            )
        items = _scan_folder(folder_path, recursive)
        return web.json_response({"success": True, "items": items, "total": len(items)})
    except Exception as e:
        logger.error(f"[LocalVideoLoader] list 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/local_video_loader/thumbnail")
async def thumbnail_route(request):
    file_path = request.query.get("path", "")
    if not file_path or not os.path.isfile(file_path):
        return web.Response(status=404)
    thumb_path = _generate_thumbnail(file_path)
    if not thumb_path or not os.path.exists(thumb_path):
        return web.Response(status=404)
    try:
        with open(thumb_path, "rb") as f:
            data = f.read()
        return web.Response(body=data, content_type="image/jpeg")
    except Exception as e:
        logger.error(f"[LocalVideoLoader] 读取缩略图失败: {e}")
        return web.Response(status=500)


@route("POST", "/local_video_loader/cache_selection")
async def cache_selection_route(request):
    try:
        body = await request.json()
        selections = body.get("selections", [])
        _cache_selection(selections)
        return web.json_response({"success": True, "count": len(selections)})
    except Exception as e:
        logger.error(f"[LocalVideoLoader] cache_selection 路由错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ── 节点定义 ──────────────────────────────────────────────────────────────────
class EagleLocalVideoLoaderNode:
    """
    本地视频文件夹加载器
    - folder_path 是可见的原生 widget，手动填写/粘贴路径，不会自动扫描
    - 是否递归扫描子文件夹由前端 UI 里的按钮控制（不影响节点输出结构）
    - 多选批量：VIDEO / AUDIO / file_paths 都以列表形式输出（OUTPUT_IS_LIST）
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "folder_path": ("STRING", {"default": "", "multiline": False}),
                "selection_data": ("STRING", {"default": "[]", "multiline": False}),
            },
        }

    RETURN_TYPES = ("VIDEO", "AUDIO", "STRING", "STRING")
    RETURN_NAMES = ("video", "audio", "file_paths", "selection_data")
    OUTPUT_IS_LIST = (True, True, True, False)
    FUNCTION = "load_videos"
    CATEGORY = "🦅 Eagle/工具"
    OUTPUT_NODE = False

    @classmethod
    def IS_CHANGED(cls, selection_data="[]", **kwargs):
        return hashlib.md5((selection_data or "[]").encode("utf-8")).hexdigest()

    def load_videos(self, folder_path="", selection_data="[]", **kwargs):
        # 延迟导入：VideoFromFile 是 ComfyUI 较新版本才有的类型，放在函数体内
        # 导入可以避免旧版本 ComfyUI 在节点扫描阶段就因为找不到这个模块而整体加载失败。
        from comfy_api.input_impl import VideoFromFile

        selections = self._read_selections(selection_data)
        if not selections:
            logger.warning("[LocalVideoLoader] 未选中任何视频，输出空列表")
            return ([], [], [], selection_data or "[]")

        videos, audios, file_paths = [], [], []

        for sel in selections:
            file_path = sel.get("filePath", "")
            if not file_path or not os.path.isfile(file_path):
                logger.warning(f"[LocalVideoLoader] 文件不存在，跳过: {file_path}")
                continue
            try:
                video_obj = VideoFromFile(file_path)
                audio = _extract_audio(file_path)
                if audio is None:
                    # 没有音轨时给一个极短静音占位，避免下游 AUDIO 节点因为 None 报错
                    audio = {"waveform": torch.zeros(1, 1, 1), "sample_rate": 44100}
                videos.append(video_obj)
                audios.append(audio)
                file_paths.append(file_path)
            except Exception as e:
                logger.error(f"[LocalVideoLoader] 加载视频失败 {file_path}: {e}")

        return (videos, audios, file_paths, selection_data or "[]")

    def _read_selections(self, selection_data="[]") -> list:
        raw = selection_data
        if not raw or raw == "[]":
            cached = _get_cached_selection()
            if cached:
                return cached.get("selections", [])
            return []
        try:
            data = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                return data.get("selections", [])
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"[LocalVideoLoader] 解析 selection_data 失败: {e}")
        return []


__all__ = ["EagleLocalVideoLoaderNode"]
