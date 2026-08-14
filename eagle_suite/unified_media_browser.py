# -*- coding: utf-8 -*-
"""
Eagle Suite - 统一媒体浏览器
支持图片和视频混合加载，用户手动输入目录路径
"""

import os
import io
import json
import time
import asyncio
import atexit
import hashlib
import random
import shutil
import subprocess
import threading
import numpy as np
import torch
import folder_paths
from PIL import Image

from aiohttp import web
from .route_registry import route
from .logger import logger

# 视频扩展名
VIDEO_EXTENSIONS = (".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv", ".wmv", ".m4v")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tga")

# 缓存
_directory_cache = {}
_cache_lock = {}
_thumbnail_cache = {}
_thumbnail_cache_lock = threading.Lock()
_dimension_cache = {}
THUMBNAIL_SIZE = 256
THUMBNAIL_CACHE_MAX = 512
_THUMB_CACHE_DIR = os.path.join(
    folder_paths.get_temp_directory(),
    "eagle_suite_unified_media_thumbs",
)


def _clear_thumbnail_disk_cache() -> None:
    """只清理 Eagle Suite 自己的缩略图临时目录。"""
    try:
        shutil.rmtree(_THUMB_CACHE_DIR, ignore_errors=True)
    except Exception as error:
        logger.debug(f"[UnifiedMediaBrowser] 清理缩略图临时缓存失败: {error}")


# ComfyUI 每次启动/重启都从空缓存开始；正常退出时再清理一次。
_clear_thumbnail_disk_cache()
atexit.register(_clear_thumbnail_disk_cache)

try:
    import cv2
    _HAS_CV2 = True
except ImportError:
    _HAS_CV2 = False


def _thumbnail_memory_key(file_path: str, size: int) -> tuple:
    stat = os.stat(file_path)
    return (os.path.abspath(file_path), stat.st_mtime_ns, stat.st_size, size)


def _video_thumb_cache_path(file_path: str, size: int) -> str:
    """按路径、修改时间、文件大小和目标尺寸生成稳定磁盘缓存键。"""
    stat = os.stat(file_path)
    raw = f"{os.path.abspath(file_path)}|{stat.st_mtime_ns}|{stat.st_size}|{size}"
    key = hashlib.sha256(raw.encode("utf-8", errors="surrogatepass")).hexdigest()
    os.makedirs(_THUMB_CACHE_DIR, exist_ok=True)
    return os.path.join(_THUMB_CACHE_DIR, f"{key}.jpg")


def _build_video_thumbnail(file_path: str, size: int) -> tuple[bytes, str]:
    """优先用 OpenCV 抓取前几帧，失败时回退 FFmpeg，并把结果写入磁盘缓存。"""
    cache_path = _video_thumb_cache_path(file_path, size)
    if os.path.isfile(cache_path) and os.path.getsize(cache_path) > 0:
        with open(cache_path, "rb") as cached:
            return cached.read(), "image/jpeg"

    if _HAS_CV2:
        cap = None
        try:
            cap = cv2.VideoCapture(file_path)
            cap.set(cv2.CAP_PROP_POS_FRAMES, 5)
            ok, frame = cap.read()
            if not ok:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ok, frame = cap.read()
            if ok and frame is not None:
                height, width = frame.shape[:2]
                scale = min(1.0, float(size) / max(height, width))
                if scale < 1.0:
                    frame = cv2.resize(
                        frame,
                        (max(1, int(width * scale)), max(1, int(height * scale))),
                        interpolation=cv2.INTER_AREA,
                    )
                if cv2.imwrite(cache_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 82]):
                    with open(cache_path, "rb") as cached:
                        return cached.read(), "image/jpeg"
        except Exception as error:
            logger.debug(f"[UnifiedMediaBrowser] OpenCV 视频封面失败，回退 FFmpeg: {error}")
        finally:
            if cap is not None:
                cap.release()

    try:
        # 这里必须使用当前 eagle_suite 包内的 utils；旧代码的 ``..utils`` 会导入失败。
        from .utils import get_cached_ffmpeg

        ffmpeg_path = get_cached_ffmpeg()
        result = subprocess.run(
            [
                ffmpeg_path,
                "-ss", "00:00:01",
                "-i", file_path,
                "-frames:v", "1",
                "-vf", f"scale={size}:{size}:force_original_aspect_ratio=decrease",
                "-q:v", "4",
                "-y", cache_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
            check=False,
        )
        if result.returncode == 0 and os.path.isfile(cache_path) and os.path.getsize(cache_path) > 0:
            with open(cache_path, "rb") as cached:
                return cached.read(), "image/jpeg"
        raise RuntimeError(f"ffmpeg exit code {result.returncode}")
    except Exception as error:
        logger.warning(f"[UnifiedMediaBrowser] 视频缩略图生成失败 {file_path}: {error}")
        placeholder = (
            b'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">'
            b'<rect width="256" height="256" fill="#17171d"/>'
            b'<text x="128" y="120" text-anchor="middle" fill="#666" font-size="48">&#127916;</text>'
            b'<text x="128" y="150" text-anchor="middle" fill="#555" font-size="12">No Preview</text>'
            b'</svg>'
        )
        return placeholder, "image/svg+xml"


def _build_thumbnail(file_path: str, size: int) -> tuple[bytes, str]:
    """生成缩略图（支持图片和视频）"""
    cache_key = _thumbnail_memory_key(file_path, size)
    with _thumbnail_cache_lock:
        cached = _thumbnail_cache.get(cache_key)
        if cached is not None:
            return cached

    ext = os.path.splitext(file_path)[1].lower()

    if ext in VIDEO_EXTENSIONS:
        result = _build_video_thumbnail(file_path, size)
    else:
        try:
            with Image.open(file_path) as source:
                img = source.copy()
                if img.mode in ("RGBA", "LA", "P"):
                    if img.mode == "P":
                        img = img.convert("RGBA")
                    bg = Image.new("RGB", img.size, (23, 23, 29))
                    bg.paste(img, mask=img.getchannel("A") if "A" in img.getbands() else None)
                    img = bg
                elif img.mode != "RGB":
                    img = img.convert("RGB")
                img.thumbnail((size, size), Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=85, optimize=True)
                result = (buf.getvalue(), "image/jpeg")
        except Exception as error:
            logger.warning(f"[UnifiedMediaBrowser] 图片缩略图生成失败: {error}")
            placeholder = (
                b'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">'
                b'<rect width="256" height="256" fill="#17171d"/>'
                b'<text x="128" y="132" text-anchor="middle" fill="#666" font-size="14">No Preview</text>'
                b'</svg>'
            )
            result = (placeholder, "image/svg+xml")

    with _thumbnail_cache_lock:
        if len(_thumbnail_cache) >= THUMBNAIL_CACHE_MAX:
            _thumbnail_cache.pop(next(iter(_thumbnail_cache)))
        _thumbnail_cache[cache_key] = result
    return result


def _get_media_files(directory, media_type="all", recursive=True):
    """
    扫描目录，返回图片或视频文件列表
    media_type: "image" | "video" | "all"
    """
    if not os.path.isdir(directory):
        return []

    directory = os.path.abspath(directory)
    cache_key = f"{directory}:{media_type}:{int(bool(recursive))}"
    cache_time = _cache_lock.get(cache_key, 0)

    # 缓存 60 秒
    if cache_key in _directory_cache and (time.time() - cache_time) < 60:
        return _directory_cache[cache_key]

    files = []
    try:
        if recursive:
            roots = os.walk(directory)
        else:
            roots = [(directory, [], [entry.name for entry in os.scandir(directory) if entry.is_file()])]

        for root, _, filenames in roots:
            for filename in filenames:
                lower = filename.lower()
                is_image = any(lower.endswith(ext) for ext in IMAGE_EXTENSIONS)
                is_video = any(lower.endswith(ext) for ext in VIDEO_EXTENSIONS)

                if media_type == "image" and not is_image:
                    continue
                if media_type == "video" and not is_video:
                    continue
                if media_type == "all" and not (is_image or is_video):
                    continue

                full_path = os.path.join(root, filename)
                try:
                    files.append({
                        "path": full_path,
                        "name": filename,
                        "type": "image" if is_image else "video",
                        "modified": os.path.getmtime(full_path),
                        "size": os.path.getsize(full_path),
                    })
                except Exception as e:
                    logger.warning(f"[UnifiedMediaBrowser] 无法读取文件 {full_path}: {e}")
                    continue
    except Exception as e:
        logger.error(f"[UnifiedMediaBrowser] 扫描目录失败 {directory}: {e}")

    _directory_cache[cache_key] = files
    _cache_lock[cache_key] = time.time()
    return files


def _get_media_dimensions(file_path):
    """按文件状态缓存媒体宽高；仅在比例筛选或输出尺寸需要时读取。"""
    try:
        stat = os.stat(file_path)
        cache_key = (os.path.abspath(file_path), stat.st_mtime_ns, stat.st_size)
        cached = _dimension_cache.get(cache_key)
        if cached:
            return cached

        ext = os.path.splitext(file_path)[1].lower()
        width = height = 0
        if ext in VIDEO_EXTENSIONS:
            if _HAS_CV2:
                capture = cv2.VideoCapture(file_path)
                try:
                    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
                    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
                finally:
                    capture.release()
            if width <= 0 or height <= 0:
                result = subprocess.run(
                    [
                        "ffprobe", "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height", "-of", "json", file_path,
                    ],
                    capture_output=True, text=True, timeout=15, check=False,
                )
                streams = json.loads(result.stdout or "{}").get("streams", [])
                if streams:
                    width = int(streams[0].get("width") or 0)
                    height = int(streams[0].get("height") or 0)
        else:
            with Image.open(file_path) as image:
                width, height = image.size

        dimensions = (max(0, width), max(0, height))
        if dimensions[0] > 0 and dimensions[1] > 0:
            _dimension_cache[cache_key] = dimensions
        return dimensions
    except Exception as error:
        logger.debug(f"[UnifiedMediaBrowser] 无法读取媒体尺寸 {file_path}: {error}")
        return (0, 0)


def _matches_aspect_ratio(file_path, aspect_ratio):
    """按方向或常用比例筛选，允许约 4% 的编码/裁切误差。"""
    if not aspect_ratio or aspect_ratio == "all":
        return True
    width, height = _get_media_dimensions(file_path)
    if width <= 0 or height <= 0:
        return False
    ratio = width / height
    if aspect_ratio == "landscape":
        return ratio > 1.04
    if aspect_ratio == "portrait":
        return ratio < 0.96
    if aspect_ratio == "square":
        return 0.96 <= ratio <= 1.04
    try:
        left, right = aspect_ratio.split(":", 1)
        target = float(left) / float(right)
        return abs(ratio - target) / target <= 0.04
    except Exception:
        return True


def _build_folder_tree(directory):
    """构建文件夹树结构（滑动双栏用）"""
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
                    "children": _build_folder_tree(item_path)
                })
    except PermissionError:
        logger.warning(f"[UnifiedMediaBrowser] 无权限访问 {directory}")
    except Exception as e:
        logger.warning(f"[UnifiedMediaBrowser] 读取目录失败 {directory}: {e}")

    return tree


@route("GET", "/unified_media_browser/folders")
async def get_folders(request):
    """返回指定目录的文件夹树"""
    try:
        root_dir = request.query.get("directory", "")
        if not root_dir or not os.path.isdir(root_dir):
            return web.json_response({
                "success": False,
                "error": "目录不存在或未指定"
            }, status=400)

        tree = await asyncio.to_thread(_build_folder_tree, root_dir)
        return web.json_response({
            "success": True,
            "folders": tree,
            "root": root_dir
        })
    except Exception as e:
        logger.error(f"[UnifiedMediaBrowser] get_folders error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/unified_media_browser/list")
async def list_media(request):
    """
    分页加载媒体列表
    """
    try:
        body = await request.json()
        directory = body.get("directory", "")
        media_type = body.get("media_type", "all")
        recursive = bool(body.get("recursive", True))
        aspect_ratio = str(body.get("aspect_ratio", "all") or "all")
        keyword = body.get("keyword", "").strip().lower()
        sort_by = body.get("sort_by", "name")
        sort_dir = body.get("sort_dir", "asc")
        offset = int(body.get("offset", 0))
        limit = max(1, min(200, int(body.get("limit", 50))))

        if not directory or not os.path.isdir(directory):
            return web.json_response({
                "success": False,
                "error": "目录不存在或未指定"
            }, status=400)

        files = await asyncio.to_thread(_get_media_files, directory, media_type, recursive)

        if aspect_ratio != "all":
            files = await asyncio.to_thread(
                lambda: [f for f in files if _matches_aspect_ratio(f["path"], aspect_ratio)]
            )

        if keyword:
            files = [f for f in files if keyword in f["name"].lower()]

        reverse = (sort_dir == "desc")
        if sort_by == "name":
            files.sort(key=lambda x: x["name"].lower(), reverse=reverse)
        elif sort_by == "modified":
            files.sort(key=lambda x: x["modified"], reverse=reverse)
        elif sort_by == "size":
            files.sort(key=lambda x: x["size"], reverse=reverse)

        total = len(files)
        page_data = files[offset:offset + limit]
        has_more = (offset + limit) < total

        items = []
        for f in page_data:
            rel_path = os.path.relpath(f["path"], directory)
            items.append({
                "id": f"{f['path']}_{int(f['modified'] * 1000)}",
                "name": f["name"],
                "path": f["path"],
                "rel": rel_path.replace("\\", "/"),
                "type": f["type"],
                "size": f["size"],
                "modified": f["modified"],
                "hasPreview": True
            })

        return web.json_response({
            "success": True,
            "items": items,
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": has_more
        })

    except Exception as e:
        logger.error(f"[UnifiedMediaBrowser] list_media error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/unified_media_browser/thumbnail")
async def get_thumbnail(request):
    """返回缩略图"""
    try:
        file_path = request.query.get("path", "")
        if not file_path or not os.path.isfile(file_path):
            return web.Response(status=404, text="文件不存在")

        size = max(96, min(512, int(request.query.get("size", THUMBNAIL_SIZE))))
        image_bytes, content_type = await asyncio.to_thread(_build_thumbnail, file_path, size)

        stat = os.stat(file_path)
        return web.Response(body=image_bytes, headers={
            "Content-Type": content_type,
            "Cache-Control": "public, max-age=86400, immutable",
            "ETag": f'"{stat.st_mtime_ns:x}-{stat.st_size:x}-{size}"',
        })
    except Exception as e:
        logger.warning(f"[UnifiedMediaBrowser] thumbnail error: {e}")
        placeholder = b'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#17171d"/><text x="128" y="132" text-anchor="middle" fill="#666" font-size="14">No Preview</text></svg>'
        return web.Response(body=placeholder, headers={
            "Content-Type": "image/svg+xml",
            "Cache-Control": "no-store",
        })


@route("POST", "/unified_media_browser/clear_cache")
async def clear_cache(request):
    """清除目录、尺寸、内存缩略图和磁盘临时缓存。"""
    _directory_cache.clear()
    _cache_lock.clear()
    with _thumbnail_cache_lock:
        _thumbnail_cache.clear()
    _dimension_cache.clear()
    await asyncio.to_thread(_clear_thumbnail_disk_cache)
    return web.json_response({"success": True})


class UnifiedMediaBrowser:
    """统一媒体浏览器 - 支持图片和视频加载"""

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            # 修复：这些都是普通 widget 承载的真实数据（前端 DOM widget 写入对应的
            # 原生隐藏 widget），必须放在 optional 里 ComfyUI 执行引擎才会真正把
            # 提交的值传给 process()。hidden 分区只认 UNIQUE_ID / PROMPT /
            # EXTRA_PNGINFO / DYNPROMPT 这几个固定的特殊标记，其它类型放这里
            # 执行时会被直接忽略，process() 拿到的永远是这里声明的默认值——
            # 这也是"未选择时批次输出失败"的根因：directory 永远是空字符串，
            # 第 522 行 `if not selections and directory and ...` 恒为 False。
            "optional": {
                "directory": ("STRING", {"default": ""}),
                "active_directory": ("STRING", {"default": ""}),
                "media_type": (["all", "image", "video"], {"default": "all"}),
                "recursive": ("BOOLEAN", {"default": True}),
                "view_mode": (["grid", "list"], {"default": "grid"}),
                "fallback_mode": (["sequential", "random"], {"default": "sequential"}),
                "batch_count": ("INT", {"default": 1, "min": 1, "max": 64}),
                "start_index": ("INT", {"default": 0, "min": 0, "max": 999999}),
                "random_seed": ("INT", {"default": -1, "min": -1, "max": 0xffffffffffffffff}),
                "aspect_ratio": (["all", "landscape", "portrait", "square", "1:1", "4:3", "3:4", "16:9", "9:16"], {"default": "all"}),
                "selection_data": ("STRING", {"default": "[]", "multiline": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "VIDEO")
    RETURN_NAMES = ("images", "masks", "width", "height", "videos")
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle"
    OUTPUT_NODE = False

    def process(self, **kwargs):
        """处理选中的媒体文件"""
        selection_data = kwargs.get("selection_data", "[]")
        directory = str(kwargs.get("active_directory") or kwargs.get("directory") or "").strip()
        media_type = str(kwargs.get("media_type", "all") or "all")
        recursive = bool(kwargs.get("recursive", True))
        fallback_mode = str(kwargs.get("fallback_mode", "sequential") or "sequential")
        batch_count = max(1, min(64, int(kwargs.get("batch_count", 1))))
        start_index = max(0, int(kwargs.get("start_index", 0)))
        random_seed = int(kwargs.get("random_seed", -1))
        aspect_ratio = str(kwargs.get("aspect_ratio", "all") or "all")

        try:
            selections = json.loads(selection_data)
        except:
            selections = []

        # 显式选择始终优先；没有选择时才按当前文件夹顺序或随机取一个批次。
        if not selections and directory and os.path.isdir(directory):
            files = _get_media_files(directory, media_type, recursive)
            files = [f for f in files if _matches_aspect_ratio(f["path"], aspect_ratio)]
            files.sort(key=lambda item: os.path.relpath(item["path"], directory).replace("\\", "/").lower())
            if files:
                take = min(batch_count, len(files))
                if fallback_mode == "random":
                    rng = random.SystemRandom() if random_seed < 0 else random.Random(random_seed)
                    files = rng.sample(files, take)
                else:
                    begin = start_index % len(files)
                    files = [files[(begin + offset) % len(files)] for offset in range(take)]
                selections = [
                    {"path": item["path"], "name": item["name"], "type": item["type"]}
                    for item in files
                ]

        if selections and aspect_ratio != "all":
            selections = [
                item for item in selections
                if item.get("path") and _matches_aspect_ratio(item["path"], aspect_ratio)
            ]

        if not selections:
            empty_img = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (empty_img, empty_img[:, :, :, 0], 64, 64, None)

        images = []
        masks = []
        video_paths = []
        image_sources = []

        for item in selections:
            path = item.get("path", "")
            if not path or not os.path.isfile(path):
                continue

            ext = os.path.splitext(path)[1].lower()
            if ext in VIDEO_EXTENSIONS:
                video_paths.append(path)
            else:
                try:
                    with Image.open(path) as source:
                        image_sources.append(source.convert("RGBA"))
                except Exception as e:
                    logger.warning(f"[UnifiedMediaBrowser] 加载图片失败: {path}, {e}")

        # IMAGE 批次必须同尺寸：以第一张为基准，仅对本次输出做内存缩放。
        if image_sources:
            target_size = image_sources[0].size
            for source in image_sources:
                if source.size != target_size:
                    source = source.resize(target_size, Image.Resampling.LANCZOS)
                rgba = np.asarray(source).astype(np.float32) / 255.0
                images.append(rgba[:, :, :3])
                masks.append(rgba[:, :, 3])

        # 构建 VIDEO 输出格式
        if video_paths:
            # 如果选中多个视频，只返回第一个
            try:
                from comfy_api.input_impl import VideoFromFile
                video_output = VideoFromFile(video_paths[0])
            except Exception:
                video_output = {
                    "source": "path",
                    "format": "video",
                    "path": video_paths[0],
                    "paths": video_paths,
                }
        else:
            video_output = None

        if not images:
            empty_img = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            video_width, video_height = _get_media_dimensions(video_paths[0]) if video_paths else (64, 64)
            return (empty_img, empty_img[:, :, :, 0], video_width or 64, video_height or 64, video_output)

        images_tensor = torch.from_numpy(np.stack(images))
        masks_tensor = torch.from_numpy(np.stack(masks))
        h, w = images[0].shape[:2]

        return (images_tensor, masks_tensor, w, h, video_output)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # seed=-1 的随机模式每次执行都重新抽取；其余模式由控件值正常参与缓存键。
        if kwargs.get("fallback_mode") == "random" and int(kwargs.get("random_seed", -1)) < 0:
            return float("nan")
        return json.dumps(kwargs, sort_keys=True, ensure_ascii=False, default=str)



__all__ = ["UnifiedMediaBrowser"]
