# -*- coding: utf-8 -*-
"""
Eagle 批量视频处理节点
迁移自 nodes/batch_video_loader.py
"""
import os
import glob
import json
import atexit
import hashlib
import secrets
import shutil
import subprocess
import threading
import torch
import numpy as np
from PIL import Image
import folder_paths
from aiohttp import web
from comfy_api.input_impl import VideoFromFile
from .route_registry import route
from .utils import get_audio, get_cached_ffmpeg
from ..tools_utils import is_trusted_browser_request


_FRAME_PREVIEW_ROOT = os.path.join(folder_paths.get_temp_directory(), "eagle_suite_frame_previews")
_VIDEO_PREVIEW_TOKENS = {}
_VIDEO_PREVIEW_LOCK = threading.RLock()


def _clear_frame_preview_cache():
    """Only remove thumbnails owned by the Eagle frame selector."""
    try:
        shutil.rmtree(_FRAME_PREVIEW_ROOT, ignore_errors=True)
    except Exception:
        pass


_clear_frame_preview_cache()
atexit.register(_clear_frame_preview_cache)


def _register_video_preview(video_path):
    """Expose a runtime VIDEO source through an opaque, same-origin token."""
    token = secrets.token_urlsafe(24)
    with _VIDEO_PREVIEW_LOCK:
        _VIDEO_PREVIEW_TOKENS[token] = os.path.abspath(video_path)
        while len(_VIDEO_PREVIEW_TOKENS) > 128:
            _VIDEO_PREVIEW_TOKENS.pop(next(iter(_VIDEO_PREVIEW_TOKENS)))
    return f"/eagle/video_frame_selector/media?token={token}"


@route("GET", "/eagle/video_frame_selector/media")
async def video_frame_selector_media(request):
    """Stream the connected runtime video to the Vue player with Range support."""
    if not is_trusted_browser_request(request):
        return web.Response(status=403, text="仅允许同源界面读取视频预览")
    token = str(request.query.get("token") or "")
    with _VIDEO_PREVIEW_LOCK:
        video_path = _VIDEO_PREVIEW_TOKENS.get(token)
    if not video_path or not os.path.isfile(video_path):
        return web.Response(status=404, text="视频预览已失效，请重新执行节点")
    return web.FileResponse(
        video_path,
        headers={"Cache-Control": "no-store", "Content-Disposition": "inline"},
    )


def _resolve_video_path(video):
    """将任意视频类型解析为文件路径字符串"""
    if video is None:
        return None
    if isinstance(video, (list, tuple)):
        if not video:
            return None
        for item in video:
            if isinstance(item, str) and os.path.isfile(item):
                return item
        video = video[0]
    if isinstance(video, str):
        path = video.strip()
        return path if path and os.path.isfile(path) else None
    try:
        if hasattr(video, "get_stream_source"):
            source = video.get_stream_source()
            if isinstance(source, (str, os.PathLike)) and os.path.isfile(source):
                return str(source)
    except Exception:
        pass
    if isinstance(video, dict):
        for key in ['video', 'path', 'file', 'filename', 'video_path']:
            val = video.get(key)
            if isinstance(val, str) and os.path.isfile(val):
                return val
    try:
        for attr in ['video_path', 'path', 'file', 'filename', 'source']:
            if hasattr(video, attr):
                path = getattr(video, attr)
                if isinstance(path, str) and os.path.isfile(path):
                    return path
    except Exception:
        pass
    try:
        path = str(video).strip()
        if os.path.isfile(path):
            return path
    except Exception:
        pass
    return None


_VIDEO_FILE_EXTENSIONS = {
    ".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".mpeg", ".mpg", ".wmv", ".gif",
}


def _input_video_choices():
    """List uploadable videos under ComfyUI/input, including subfolders."""
    input_root = folder_paths.get_input_directory()
    choices = []
    try:
        for root, _directories, files in os.walk(input_root):
            for filename in files:
                if os.path.splitext(filename)[1].lower() not in _VIDEO_FILE_EXTENSIONS:
                    continue
                relative = os.path.relpath(os.path.join(root, filename), input_root).replace("\\", "/")
                choices.append(relative)
    except OSError:
        pass
    return [""] + sorted(set(choices), key=str.casefold)


def _resolve_input_video(filename):
    """Resolve only a ComfyUI annotated/input filename, never an arbitrary path."""
    value = str(filename or "").strip()
    if not value:
        return None
    try:
        path = folder_paths.get_annotated_filepath(value)
    except Exception:
        path = os.path.join(folder_paths.get_input_directory(), value)
    if not path or not os.path.isfile(path):
        return None
    if os.path.splitext(path)[1].lower() not in _VIDEO_FILE_EXTENSIONS:
        return None
    return os.path.abspath(path)


def _native_videos(paths):
    """Create native ComfyUI VIDEO objects for a batch of persistent files."""
    videos = []
    for path in paths or []:
        if not path or not os.path.isfile(path):
            continue
        try:
            videos.append(VideoFromFile(os.path.abspath(path)))
        except Exception:
            continue
    return videos


def _passthrough_video_list(video):
    if video is None:
        return []
    items = list(video) if isinstance(video, (list, tuple)) else [video]
    output = []
    for item in items:
        if hasattr(item, "get_components") or hasattr(item, "save_to"):
            output.append(item)
            continue
        resolved = _resolve_video_path(item)
        output.extend(_native_videos([resolved]) if resolved else [])
    return output


def _passthrough_video(video):
    videos = _passthrough_video_list(video)
    return videos[0] if videos else None


def _get_codec_info(video_path):
    """用 ffprobe 获取视频编解码器名称和比特率(kbps)"""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return "unknown", 0
    try:
        cmd = [
            ffprobe, "-v", "quiet", "-print_format", "json",
            "-show_streams", "-show_format", video_path
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=10)
        data = json.loads(result.stdout)
        codec = "unknown"
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                codec = stream.get("codec_name", "unknown")
                break
        bitrate = int(data.get("format", {}).get("bit_rate", 0)) // 1000
        return codec, bitrate
    except Exception:
        return "unknown", 0


# ══════════════════════════════════════════════════════════════════════════════
# 节点1: 批量视频加载
# ══════════════════════════════════════════════════════════════════════════════
class EagleBatchVideoLoader:
    """
    🦅 批量视频加载
    支持：视频预览、加载数量控制、格式分类统一加载、递归搜索
    """
    SUPPORTED_FORMATS = ['.mp4', '.avi', '.mov', '.mkv', '.webm',
                         '.flv', '.wmv', '.m4v', '.ts', '.m2ts']
    FORMAT_CATEGORIES = {
        "全部格式": ['.mp4', '.avi', '.mov', '.mkv', '.webm',
                    '.flv', '.wmv', '.m4v', '.ts', '.m2ts'],
        "常用格式": ['.mp4', '.avi', '.mov', '.mkv'],
        "网络格式": ['.webm', '.flv', '.mp4'],
        "高清格式": ['.mkv', '.ts', '.m2ts', '.m4v'],
        "仅MP4":   ['.mp4'],
        "仅MOV":   ['.mov'],
    }

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_folder": ("STRING", {
                    "default": "", "multiline": False,
                    "placeholder": "视频文件夹路径，留空使用默认输入目录"
                }),
                "load_mode":    (["限制数量", "加载全部", "按格式分类"],
                                  {"default": "限制数量"}),
                "max_load":     ("INT", {"default": 1, "min": 1, "max": 1000, "step": 1}),
                "start_index":  ("INT", {"default": 0, "min": 0, "max": 99999, "step": 1}),
                "seed":         ("INT", {"default": -1, "min": -1, "max": 2147483647, "step": 1, "control_after_generate": True}),
                "format_filter":(["全部格式", "常用格式", "网络格式", "高清格式", "仅MP4", "仅MOV"],
                                  {"default": "全部格式"}),
                "frame_skip":   ("INT", {"default": 0, "min": 0, "max": 100, "step": 1}),
                "max_frames_per_video": ("INT", {
                    "default": 0, "min": 0, "max": 10000, "step": 1,
                    "tooltip": "每个视频最大加载帧数，0=无限"
                }),
                "resize_width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "resize_height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
            },
            "optional": {
                "video":               ("VIDEO",),
                "images":              ("IMAGE",),
                "recursive":           ("BOOLEAN", {"default": False}),
                "sort_by":             (["文件", "修改时间", "大小", "时长"],
                                        {"default": "文件"}),
                "preview_first_frame": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT", "STRING", "IMAGE", "STRING", "VIDEO", "IMAGE")
    RETURN_NAMES = ("frames", "video_info", "total_frames", "video_list", "preview", "video_paths", "video", "images")
    OUTPUT_IS_LIST = (False, False, False, False, False, False, True, False)
    FUNCTION = "load_videos"
    CATEGORY = "🦅 Eagle/视频"

    def load_videos(self, video_folder, load_mode, max_load, start_index, seed,
                    format_filter, frame_skip, max_frames_per_video,
                    resize_width, resize_height,
                    recursive=False, sort_by="文件", preview_first_frame=True,
                    video=None, images=None):
        if not video_folder:
            video_folder = folder_paths.get_input_directory()
        if not os.path.exists(video_folder):
            empty = self._empty_frame(resize_width, resize_height)
            return (empty, "未找到视频文件夹", 0, "", empty, "", _passthrough_video_list(video), images)
        formats_to_search = self.FORMAT_CATEGORIES.get(
            format_filter, self.SUPPORTED_FORMATS
        )
        video_files = []
        for ext in formats_to_search:
            for pat in [f"*{ext}", f"*{ext.upper()}"]:
                if recursive:
                    video_files.extend(
                        glob.glob(os.path.join(video_folder, "**", pat), recursive=True)
                    )
                else:
                    video_files.extend(glob.glob(os.path.join(video_folder, pat)))
        seen, unique_files = set(), []
        for f in video_files:
            norm = os.path.normcase(os.path.abspath(f))
            if norm not in seen:
                seen.add(norm)
                unique_files.append(f)
        video_files = unique_files
        if not video_files:
            empty = self._empty_frame(resize_width, resize_height)
            return (empty, "未找到匹配的视频文件", 0, "", empty, "", _passthrough_video_list(video), images)
        video_files = self._sort_videos(video_files, sort_by)
        if seed >= 0:
            import random
            rng = random.Random(seed)
            rng.shuffle(video_files)
        total = len(video_files)
        if load_mode == "按格式分类":
            selected = []
            for ext in formats_to_search:
                matched = [f for f in video_files
                           if os.path.splitext(f)[1].lower() == ext]
                selected.extend(matched[:max_load])
            video_files = selected if selected else video_files[:max_load]
        elif load_mode == "限制数量":
            effective_start = start_index % total if total > 0 else 0
            # 允许请求数量超过目录总数，并按目录顺序循环取样；旧实现只
            # 能跨越一次末尾，max_load > total * 2 时会产生越界索引。
            indices = [
                (effective_start + offset) % total
                for offset in range(max(0, int(max_load)))
            ]
            video_files = [video_files[i] for i in indices]
        else:
            if total > 0:
                effective_start = start_index % total
                video_files = (video_files[effective_start:]
                               + video_files[:effective_start])
        # IMAGE batches are fully resident tensors.  Keep a hard global budget
        # even when max_frames_per_video=0 ("all") so long videos cannot exhaust
        # the ComfyUI process.  The environment override is intentionally capped.
        configured_frames = max(1, min(8192, int(os.environ.get("EAGLE_MAX_BATCH_VIDEO_FRAMES", "2048"))))
        memory_budget_mb = max(128, min(4096, int(os.environ.get("EAGLE_MAX_BATCH_VIDEO_MB", "1024"))))
        bytes_per_frame = max(1, resize_width * resize_height * 3 * 4)
        memory_frame_limit = max(1, (memory_budget_mb * 1024 * 1024) // bytes_per_frame)
        frame_budget = min(configured_frames, memory_frame_limit)
        all_frames, total_frame_count, video_details, preview_frames = [], 0, [], []
        processed_video_paths = []
        for idx, vpath in enumerate(video_files):
            remaining = frame_budget - total_frame_count
            if remaining <= 0:
                video_details.append(f"已达到全局帧预算 {frame_budget}，其余视频未解码")
                break
            try:
                effective_max = remaining if max_frames_per_video <= 0 else min(max_frames_per_video, remaining)
                frames, info, preview = self._process_video(
                    vpath, frame_skip, effective_max,
                    resize_width, resize_height,
                    preview_first_frame and idx == 0
                )
                all_frames.extend(frames)
                total_frame_count += len(frames)
                video_details.append(info)
                if frames:
                    processed_video_paths.append(vpath)
                if preview is not None:
                    preview_frames.append(preview)
            except Exception as e:
                video_details.append(
                    f"{os.path.basename(vpath)}: {str(e)[:50]}"
                )
        if not all_frames:
            empty = self._empty_frame(resize_width, resize_height)
            return (empty, "无法加载任何视频", 0, "", empty, "", _passthrough_video_list(video), images)
        frames_tensor = torch.cat(all_frames, dim=0)
        info_str = f"📹 共加载 {len(video_files)} 个视频，{total_frame_count} 帧\n"
        info_str += f"🔍 格式筛选: {format_filter} | 模式: {load_mode}\n"
        info_str += "\n".join(video_details)
        video_list_str = "\n".join(
            [f"{i+1}. {os.path.basename(v)}" for i, v in enumerate(video_files)]
        )
        preview = (
            self._create_preview(preview_frames, resize_width, resize_height)
            if preview_frames else self._empty_frame(resize_width, resize_height)
        )
        video_paths_str = "\n".join(video_files)
        return (frames_tensor, info_str, total_frame_count,
                video_list_str, preview, video_paths_str,
                _native_videos(processed_video_paths), images)

    def _sort_videos(self, video_files, sort_by):
        if sort_by == "文件":
            video_files.sort()
        elif sort_by == "修改时间":
            video_files.sort(key=lambda x: os.path.getmtime(x))
        elif sort_by == "大小":
            video_files.sort(key=lambda x: os.path.getsize(x))
        elif sort_by == "时长":
            video_files.sort(key=lambda x: self._get_video_duration(x))
        return video_files

    def _get_video_duration(self, video_path):
        try:
            import cv2
            cap = cv2.VideoCapture(video_path)
            fps = cap.get(cv2.CAP_PROP_FPS)
            fc = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            cap.release()
            return fc / fps if fps > 0 else 0
        except Exception:
            return 0

    def _process_video(self, video_path, frame_skip, max_frames,
                       resize_width, resize_height, get_preview):
        try:
            import cv2
        except ImportError:
            raise ImportError("需要安装 opencv-python: pip install opencv-python")
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise Exception("无法打开视频文件")
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = frame_count / fps if fps > 0 else 0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        video_name = os.path.basename(video_path)
        file_size = os.path.getsize(video_path) / (1024 * 1024)
        frames, frame_idx, frames_loaded, preview = [], 0, 0, None
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_skip > 0 and frame_idx % (frame_skip + 1) != 0:
                frame_idx += 1
                continue
            if max_frames > 0 and frames_loaded >= max_frames:
                break
            if frame.ndim == 2:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
            elif frame.ndim == 3 and frame.shape[2] == 4:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGRA2RGB)
            else:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            if resize_width != frame.shape[1] or resize_height != frame.shape[0]:
                frame_rgb = cv2.resize(frame_rgb, (resize_width, resize_height),
                                       interpolation=cv2.INTER_LANCZOS4)
            t = torch.from_numpy(frame_rgb.astype(np.float32) / 255.0).unsqueeze(0)
            if get_preview and preview is None:
                preview = t
            frames.append(t)
            frames_loaded += 1
            frame_idx += 1
        cap.release()
        # ── cv2 读不出帧时，尝试 ffmpeg 备用 ──
        if not frames and os.path.getsize(video_path) > 1024:
            ff_frames, ff_preview = self._extract_frames_ffmpeg(
                video_path, frame_skip, max_frames, resize_width, resize_height, get_preview
            )
            if ff_frames:
                frames = ff_frames
                preview = ff_preview
                info = (f"{video_name}: {len(frames)} 帧 (ffmpeg备用) "
                        f"({duration:.1f}s, {file_size:.1f}MB)")
                return frames, info, preview
        info = (f"{video_name}: {frames_loaded} 帧 "
                f"({fps:.1f}fps, {duration:.1f}s, {width}x{height}, {file_size:.1f}MB)")
        return frames, info, preview

    def _create_preview(self, preview_frames, width, height):
        if not preview_frames:
            return self._empty_frame(width, height)
        if len(preview_frames) == 1:
            return preview_frames[0]
        thumb_h = 256
        resized = []
        for f in preview_frames:
            t = f[0]
            h, w = t.shape[0], t.shape[1]
            new_w = max(1, int(w * thumb_h / h))
            t2 = torch.nn.functional.interpolate(
                t.permute(2, 0, 1).unsqueeze(0),
                size=(thumb_h, new_w), mode='bilinear', align_corners=False
            ).squeeze(0).permute(1, 2, 0)
            resized.append(t2)
        return torch.cat(resized, dim=1).unsqueeze(0)

    def _empty_frame(self, width, height):
        return torch.zeros((1, height, width, 3))

    def _extract_frames_ffmpeg(self, video_path, frame_skip, max_frames,
                               resize_width, resize_height, get_preview):
        """ffmpeg 备用提取：cv2 读不出时调用"""
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            return [], None
        import tempfile
        tmpdir = tempfile.mkdtemp(prefix="eagle_video_")
        frames, preview = [], None
        try:
            out_pattern = os.path.join(tmpdir, "frame_%06d.jpg")
            # 先尝试用 select 过滤器隔帧提取，限制总帧数
            select_expr = f"not(mod(n\\,{frame_skip + 1}))" if frame_skip > 0 else "1"
            vf = f"select='{select_expr}',scale={resize_width}:{resize_height}:flags=lanczos"
            cmd = [
                ffmpeg, "-y", "-i", video_path,
                "-vf", vf,
                "-vsync", "vfr",
                "-q:v", "2",
            ]
            if max_frames > 0:
                cmd += ["-frames:v", str(max_frames)]
            cmd += [out_pattern]
            subprocess.run(cmd, capture_output=True, timeout=120)
            jpg_files = sorted(glob.glob(os.path.join(tmpdir, "frame_*.jpg")))
            for jpg in jpg_files:
                img = Image.open(jpg).convert("RGB")
                arr = np.array(img).astype(np.float32) / 255.0
                t = torch.from_numpy(arr).unsqueeze(0)
                frames.append(t)
                if get_preview and preview is None:
                    preview = t
        except Exception:
            pass
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
        return frames, preview


# ══════════════════════════════════════════════════════════════════════════════
# 节点2: 视频帧提取器
# ══════════════════════════════════════════════════════════════════════════════
def _selected_frame_indices(value, total_frames):
    """Decode, deduplicate and clamp the frame numbers stored by the Vue UI."""
    try:
        raw = json.loads(value or "[]") if isinstance(value, str) else value
    except (TypeError, ValueError, json.JSONDecodeError):
        raw = []
    if not isinstance(raw, list) or total_frames <= 0:
        return []
    result = []
    seen = set()
    for item in raw:
        if isinstance(item, dict):
            item = item.get("frame", item.get("frame_index"))
        try:
            index = max(0, min(int(item), total_frames - 1))
        except (TypeError, ValueError):
            continue
        if index not in seen:
            seen.add(index)
            result.append(index)
    return result


def _preview_cache_key(video_path, preview_count):
    try:
        stat = os.stat(video_path)
        source = f"{os.path.abspath(video_path)}|{stat.st_mtime_ns}|{stat.st_size}|{preview_count}"
    except OSError:
        source = f"{os.path.abspath(video_path)}|{preview_count}"
    return hashlib.sha256(source.encode("utf-8", errors="surrogatepass")).hexdigest()[:24]


def _store_frame_previews(video_path, records):
    """Save small JPEGs under ComfyUI temp and return standard /view descriptors."""
    if not records:
        return []
    key = _preview_cache_key(video_path, len(records))
    target_dir = os.path.join(_FRAME_PREVIEW_ROOT, key)
    os.makedirs(target_dir, exist_ok=True)
    temp_root = folder_paths.get_temp_directory()
    subfolder = os.path.relpath(target_dir, temp_root).replace("\\", "/")
    result = []
    for order, record in enumerate(records):
        frame_index, seconds, frame_rgb = record
        filename = f"frame_{order:02d}_{frame_index:09d}.jpg"
        output_path = os.path.join(target_dir, filename)
        if not os.path.isfile(output_path):
            image = Image.fromarray(frame_rgb, mode="RGB")
            image.thumbnail((360, 202), Image.Resampling.LANCZOS)
            image.save(output_path, format="JPEG", quality=80, optimize=True)
        result.append({
            "filename": filename,
            "subfolder": subfolder,
            "type": "temp",
            "frame": int(frame_index),
            "time": round(float(seconds), 4),
        })
    return result


def _empty_audio():
    return {
        "waveform": torch.zeros((1, 2, 1), dtype=torch.float32),
        "sample_rate": 44100,
    }


def _extract_trimmed_audio(video_path, trim_start, trim_end, total_duration, enabled):
    """Decode only the selected time range; disabled mode never reads the audio stream."""
    if not enabled:
        return _empty_audio(), "音频输出未启用"
    start = max(0.0, min(float(trim_start or 0.0), max(0.0, total_duration)))
    end = float(trim_end or 0.0)
    if end <= 0 or end > total_duration:
        end = total_duration
    if end <= start:
        end = total_duration
    clip_duration = max(0.0, end - start)
    try:
        audio = get_audio(video_path, start_time=start, duration=clip_duration)
        return audio, f"音频 {start:.3f}s–{end:.3f}s"
    except Exception as error:
        return _empty_audio(), f"视频无可用音轨或音频提取失败：{error}"


def _resolve_frame_output_size(source_width, source_height, resize_width=0, resize_height=0,
                               size_mode="original", lock_aspect_ratio=True,
                               resize_anchor="width"):
    """Resolve frame dimensions while preventing locked output from stretching.

    The axis edited most recently stays exact. The dependent axis is aligned to
    8 pixels so the result remains friendly to the usual ComfyUI latent stack.
    This backend rule also protects API runs that bypass the Vue interface.
    """
    source_width = max(1, int(source_width or 1))
    source_height = max(1, int(source_height or 1))
    if str(size_mode or "original") != "custom":
        return source_width, source_height

    width = max(0, min(8192, int(resize_width or 0)))
    height = max(0, min(8192, int(resize_height or 0)))
    if width <= 0 and height <= 0:
        return source_width, source_height
    if not bool(lock_aspect_ratio):
        return width or source_width, height or source_height

    ratio = source_width / source_height

    def _aligned(value):
        return max(8, min(8192, int(round(float(value) / 8.0)) * 8))

    anchor = str(resize_anchor or "width").lower()
    if (anchor == "height" and height > 0) or width <= 0:
        height = height or source_height
        width = _aligned(height * ratio)
    else:
        width = width or source_width
        height = _aligned(width / ratio)
    return width, height


def _store_waveform_preview(video_path):
    """Render one cached full-source waveform image for the timeline audio track."""
    key = _preview_cache_key(video_path, "waveform-v1")
    target_dir = os.path.join(_FRAME_PREVIEW_ROOT, key)
    os.makedirs(target_dir, exist_ok=True)
    output_path = os.path.join(target_dir, "waveform.png")
    if not os.path.isfile(output_path):
        command = [
            get_cached_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y",
            "-i", video_path,
            "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=1200x92:colors=0x8bd450:scale=sqrt",
            "-frames:v", "1", output_path,
        ]
        try:
            completed = subprocess.run(command, capture_output=True, timeout=45, check=False)
            if completed.returncode != 0:
                return None
        except (OSError, subprocess.SubprocessError):
            return None
    if not os.path.isfile(output_path):
        return None
    temp_root = folder_paths.get_temp_directory()
    return {
        "filename": os.path.basename(output_path),
        "subfolder": os.path.relpath(target_dir, temp_root).replace("\\", "/"),
        "type": "temp",
    }


def _create_trimmed_video(video_path, trim_start, trim_end, total_duration,
                          output_width, output_height, enabled):
    """Create and cache an accurately trimmed MP4 for the VIDEO output port."""
    if not enabled:
        return None, "裁剪视频输出未启用"
    start = max(0.0, min(float(trim_start or 0.0), max(0.0, total_duration)))
    end = float(trim_end or 0.0)
    if end <= 0 or end > total_duration:
        end = total_duration
    if end <= start:
        start, end = 0.0, total_duration
    # libx264 + yuv420p requires even dimensions. Keep this protection in the
    # backend as API/workflow calls can bypass the Vue aspect-lock controls.
    encode_width = max(2, min(8192, int(output_width or 2)))
    encode_height = max(2, min(8192, int(output_height or 2)))
    encode_width -= encode_width % 2
    encode_height -= encode_height % 2
    source_key = _preview_cache_key(
        video_path,
        f"clip-v1|{start:.6f}|{end:.6f}|{encode_width}x{encode_height}",
    )
    target_dir = os.path.join(_FRAME_PREVIEW_ROOT, source_key)
    os.makedirs(target_dir, exist_ok=True)
    output_path = os.path.join(target_dir, "trimmed.mp4")
    if not os.path.isfile(output_path):
        command = [
            get_cached_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{start:.6f}", "-i", video_path,
            "-t", f"{max(0.001, end - start):.6f}",
            "-map", "0:v:0", "-map", "0:a:0?",
            "-vf", f"scale={encode_width}:{encode_height}:flags=lanczos",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output_path,
        ]
        try:
            completed = subprocess.run(command, capture_output=True, timeout=600, check=False)
            if completed.returncode != 0:
                detail = completed.stderr.decode("utf-8", errors="replace").strip()
                return None, f"裁剪视频编码失败：{detail[-300:]}"
        except (OSError, subprocess.SubprocessError) as error:
            return None, f"裁剪视频编码失败：{error}"
    native = _passthrough_video(output_path)
    if native is None:
        return None, "裁剪视频已生成，但无法创建 VIDEO 输出"
    return native, f"裁剪视频 {start:.3f}s–{end:.3f}s · {encode_width}×{encode_height}"


class EagleVideoFrameExtractor:
    """
    🦅 视频帧提取器
    - Vue 视频预览网格：默认生成 12 张均匀分布的可选缩略帧
    - 四种模式：预览选择 / 单帧提取 / 均匀采样 / 自定义时间点
    """
    TIMELINE_STRIP_COUNT = 12

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Vue 界面自行处理上传，避免 ComfyUI 再插入一个重复的原生上传按钮。
                "video_file":   (_input_video_choices(),),
                "time_mode":    (["预览选择", "单帧提取", "均匀采样", "自定义时间点"],
                                  {"default": "预览选择"}),
                "frame_index":  ("INT", {
                    "default": 0, "min": 0, "max": 999999, "step": 1,
                    "tooltip": "直接输入目标帧号(单帧提取模式)"
                }),
                "sample_count": ("INT", {
                    "default": 4, "min": 1, "max": 64, "step": 1,
                    "tooltip": "均匀采样帧数"
                }),
                "resize_width": ("INT", {
                    "default": 0, "min": 0, "max": 8192, "step": 64,
                    "tooltip": "自定义模式下的输出宽度；0 表示视频原始宽度",
                }),
                "resize_height": ("INT", {
                    "default": 0, "min": 0, "max": 8192, "step": 64,
                    "tooltip": "自定义模式下的输出高度；0 表示视频原始高度",
                }),
                "preview_strip":("BOOLEAN", {
                    "default": True,
                    "tooltip": "是否生成视频缩略帧预览条（均匀分布）"
                }),
            },
            "optional": {
                "video_path":   ("VIDEO",),
                "custom_times": ("STRING", {
                    "default": "0, 5, 10, 15",
                    "multiline": False,
                    "tooltip": "自定义时间点(秒)，用英文逗号分隔"
                }),
                "preview_count": ("INT", {
                    "default": 12, "min": 4, "max": 120, "step": 1,
                    "tooltip": "当前入点/出点区间内的预览密度；不是可提取帧数上限"
                }),
                "selection_mode": (["single", "multiple"], {"default": "single"}),
                "selected_frames": ("STRING", {"default": "[]", "multiline": False}),
                "preview_revision": ("INT", {"default": 0, "min": 0, "max": 2147483647}),
                "size_mode": (["original", "custom"], {"default": "original"}),
                "trim_start": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 86400.0, "step": 0.01}),
                "trim_end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 86400.0, "step": 0.01}),
                "extract_audio": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "输出入点到出点之间的原视频音频；关闭时不解码音轨",
                }),
                "lock_aspect_ratio": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "自定义尺寸时锁定原视频宽高比，避免画面拉伸",
                }),
                "resize_anchor": (["width", "height"], {
                    "default": "width",
                    "tooltip": "比例锁定时保留最近编辑的宽度或高度",
                }),
                "timeline_zoom": ("INT", {
                    "default": 100, "min": 100, "max": 800, "step": 25,
                    "tooltip": "时间线水平缩放百分比，仅影响编辑界面",
                }),
                "output_mode": (["frames", "video", "both"], {
                    "default": "frames",
                    "tooltip": "输出帧序列、裁剪后视频，或同时输出；视频模式会执行编码",
                }),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "IMAGE", "IMAGE", "VIDEO", "AUDIO")
    RETURN_NAMES = ("frames", "info", "preview", "timeline_strip", "trimmed_video", "audio")
    OUTPUT_IS_LIST = (True, False, False, False, False, False)
    FUNCTION = "extract_frames"
    CATEGORY = "🦅 Eagle/视频"
    OUTPUT_NODE = True

    def extract_frames(self, video_path=None, time_mode="预览选择", frame_index=0, sample_count=4,
                       resize_width=0, resize_height=0, preview_strip=True, video_file="", custom_times="",
                       preview_count=12, selection_mode="single", selected_frames="[]",
                       preview_revision=0, size_mode="original", trim_start=0.0,
                       trim_end=0.0, extract_audio=False, lock_aspect_ratio=True,
                       resize_anchor="width", timeline_zoom=100, output_mode="frames"):
        connected_video = _resolve_video_path(video_path)
        uploaded_video = _resolve_input_video(video_file)
        resolved = connected_video or uploaded_video
        video_input = video_path if connected_video else resolved
        empty_height = max(1, int(resize_height or 64))
        empty_width = max(1, int(resize_width or 64))
        empty = torch.zeros((1, empty_height, empty_width, 3))

        def _response(result, status, previews=None, summary="", selected=None,
                      video_url="", video_meta=None, timeline_previews=None,
                      waveform_preview=None):
            return {
                "ui": {
                    "frame_previews": previews or [],
                    "timeline_previews": timeline_previews or [],
                    "waveform_preview": [waveform_preview] if waveform_preview else [],
                    "video_summary": [summary] if summary else [],
                    "selected_frames": selected or [],
                    "status": [status],
                    "video_url": [video_url] if video_url else [],
                    "video_meta": [video_meta] if video_meta else [],
                },
                "result": result,
            }

        if not resolved:
            message = "视频文件不存在或路径无法解析"
            return _response(
                ([empty], message, empty, empty, None, _empty_audio()), message
            )
        video_path = resolved
        try:
            import cv2
        except ImportError:
            raise ImportError("需要安装 opencv-python: pip install opencv-python")
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            message = "无法打开视频"
            return _response(
                ([empty], message, empty, empty, None, _empty_audio()), message
            )
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()
        range_start = max(0.0, min(float(trim_start or 0.0), max(0.0, duration)))
        range_end = float(trim_end or 0.0)
        if range_end <= 0 or range_end > duration:
            range_end = duration
        if range_end <= range_start:
            range_start, range_end = 0.0, duration
        start_frame = max(0, min(int(round(range_start * fps)), max(0, total_frames - 1)))
        end_frame = max(start_frame, min(int(round(range_end * fps)), max(0, total_frames - 1)))
        video_url = _register_video_preview(video_path)
        video_meta = {
            "duration": round(float(duration), 6), "fps": round(float(fps), 6),
            "total_frames": int(total_frames), "width": int(vid_w), "height": int(vid_h),
        }
        output_width, output_height = _resolve_frame_output_size(
            vid_w, vid_h, resize_width, resize_height, size_mode,
            lock_aspect_ratio, resize_anchor,
        )
        video_meta.update({
            "output_width": int(output_width), "output_height": int(output_height),
            "aspect_ratio": round(float(vid_w) / max(1, float(vid_h)), 8),
        })

        def _read_frame_at(cap_local, pos):
            pos = max(0, min(pos, total_frames - 1))
            cap_local.set(cv2.CAP_PROP_POS_FRAMES, pos)
            ret, frame = cap_local.read()
            if not ret:
                return None
            if frame.ndim == 2:
                return cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
            if frame.ndim == 3 and frame.shape[2] == 4:
                return cv2.cvtColor(frame, cv2.COLOR_BGRA2RGB)
            return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        def _resize(f):
            if str(size_mode or "original") != "custom":
                return f
            if f.shape[1] != output_width or f.shape[0] != output_height:
                f = cv2.resize(f, (output_width, output_height),
                               interpolation=cv2.INTER_LANCZOS4)
            return f

        def _to_tensor(f):
            return torch.from_numpy(f.astype(np.float32) / 255.0)

        # 预览
        strip_records = []
        timeline_records = []
        if preview_strip and total_frames > 0:
            n = max(4, min(120, int(preview_count or self.TIMELINE_STRIP_COUNT)))
            cap2 = cv2.VideoCapture(video_path)
            for k in range(n):
                pos = int(round(start_frame + k / max(n - 1, 1) * (end_frame - start_frame)))
                f = _read_frame_at(cap2, pos)
                if f is not None:
                    seconds = pos / fps if fps > 0 else 0
                    strip_records.append((pos, seconds, f))
            cap2.release()
            # The card grid follows the selected interval. The editor timeline
            # remains anchored to the complete source, like H3 Director.
            if range_start <= 0 and abs(range_end - duration) < 0.001 and n == self.TIMELINE_STRIP_COUNT:
                timeline_records = list(strip_records)
            else:
                cap_timeline = cv2.VideoCapture(video_path)
                for k in range(self.TIMELINE_STRIP_COUNT):
                    pos = int(round(k / max(self.TIMELINE_STRIP_COUNT - 1, 1) * (total_frames - 1)))
                    f = _read_frame_at(cap_timeline, pos)
                    if f is not None:
                        seconds = pos / fps if fps > 0 else 0
                        timeline_records.append((pos, seconds, f))
                cap_timeline.release()
        preview_items = _store_frame_previews(video_path, strip_records)
        timeline_items = _store_frame_previews(video_path, timeline_records)
        waveform_item = _store_waveform_preview(video_path)
        video_output, video_output_status = _create_trimmed_video(
            video_path, range_start, range_end, duration, output_width, output_height,
            str(output_mode or "frames") in {"video", "both"},
        )
        if timeline_records:
            thumb_h = 128
            thumb_w = max(1, int(thumb_h * max(1, vid_w) / max(1, vid_h)))
            strip_imgs = []
            for idx, (_pos, _seconds, sf) in enumerate(timeline_records):
                sm = cv2.resize(sf, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
                cv2.putText(sm, f"#{idx+1}", (5, 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                strip_imgs.append(sm)
            timeline_strip = _to_tensor(np.hstack(strip_imgs)).unsqueeze(0)
        else:
            timeline_strip = torch.zeros((1, 128, max(128, int(vid_w or 128)), 3))

        # 确定提取时间
        selected_indices = _selected_frame_indices(selected_frames, total_frames)
        selected_indices = [index for index in selected_indices if start_frame <= index <= end_frame]
        if str(selection_mode or "single") == "single" and len(selected_indices) > 1:
            selected_indices = selected_indices[:1]

        if time_mode == "预览选择":
            # 第一次执行尚未点选时仍输出首帧，同时把整组缩略帧送回 Vue；
            # 用户点选后，后续执行严格按保存的帧号输出。
            times = [index / fps if fps > 0 else range_start for index in selected_indices] or [range_start]
        elif time_mode == "单帧提取":
            target = max(start_frame, min(frame_index, end_frame))
            times = [target / fps if fps > 0 else 0]
        elif time_mode == "均匀采样":
            selected_duration = max(0.0, range_end - range_start)
            if selected_duration > 0:
                interval = selected_duration / (sample_count + 1)
                times = [range_start + interval * (i + 1) for i in range(sample_count)]
            else:
                times = [range_start]
        else:
            try:
                times = [float(t.strip()) for t in custom_times.split(",") if t.strip()]
                times = [max(range_start, min(value, range_end)) for value in times]
                if not times:
                    times = [range_start]
            except Exception:
                times = [range_start]

        # 提取
        frames, frame_infos, current_preview = [], [], None
        cap3 = cv2.VideoCapture(video_path)
        for i, t in enumerate(times):
            frame_pos = max(0, min(int(round(t * fps)), total_frames - 1))
            frame_rgb = _read_frame_at(cap3, frame_pos)
            if frame_rgb is None:
                continue
            frame_rgb = _resize(frame_rgb)
            tensor = _to_tensor(frame_rgb).unsqueeze(0)
            frames.append(tensor)
            actual_time = frame_pos / fps if fps > 0 else t
            frame_infos.append(f"帧{i+1}: {actual_time:.3f}s (#{frame_pos})")
            if current_preview is None:
                current_preview = tensor
        cap3.release()
        if not frames:
            message = "无法提取任何帧"
            summary = f"{os.path.basename(video_path)} · {total_frames}帧 · {fps:.2f}fps · {duration:.2f}s"
            audio_output, _audio_status = _extract_trimmed_audio(
                video_path, range_start, range_end, duration, bool(extract_audio)
            )
            return _response(
                ([empty], message, empty, timeline_strip, video_output, audio_output),
                message, preview_items, summary, selected_indices, video_url, video_meta,
                timeline_items, waveform_item,
            )
        codec, bitrate = _get_codec_info(video_path)
        info = f"📹 {os.path.basename(video_path)}\n"
        info += f"🎬 {total_frames} 帧 {fps:.2f}fps {duration:.2f}s {vid_w}x{vid_h}\n"
        info += f"🎞 编解码器: {codec}"
        if bitrate > 0:
            info += f" | 比特率: {bitrate} kbps"
        info += f"\n📸 模式: {time_mode} | 提取: {len(frames)} 帧\n"
        info += "\n".join(frame_infos)
        audio_output, audio_status = _extract_trimmed_audio(
            video_path, range_start, range_end, duration, bool(extract_audio)
        )
        info += f"\n🎵 {audio_status}"
        info += f"\n✂️ {video_output_status}"
        if current_preview is None:
            current_preview = empty
        output_h, output_w = frames[0].shape[1:3]
        summary = (
            f"{os.path.basename(video_path)} · {total_frames}帧 · {fps:.2f}fps · {duration:.2f}s · "
            f"源 {vid_w}×{vid_h} · 输出 {output_w}×{output_h} · 区间 {range_start:.2f}–{range_end:.2f}s"
        )
        status = (
            f"已按预览选择提取 {len(frames)} 帧"
            if time_mode == "预览选择" and selected_indices
            else f"预览已生成，可选择帧；当前输出 {len(frames)} 帧"
        )
        return _response(
            (frames, info, current_preview, timeline_strip, video_output, audio_output),
            status, preview_items, summary, selected_indices, video_url, video_meta,
            timeline_items, waveform_item,
        )


# ══════════════════════════════════════════════════════════════════════════════
# 节点3: 视频信息分析
# ══════════════════════════════════════════════════════════════════════════════
class EagleVideoInfo:
    """
    🦅 视频信息分析
    获取视频详细信息(含编解码器、比特率)，不加载帧
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_path": ("VIDEO",),
            }
        }

    RETURN_TYPES = ("STRING", "FLOAT", "FLOAT", "INT", "INT", "INT", "VIDEO")
    RETURN_NAMES = ("info", "duration", "fps", "total_frames", "width", "height", "video")
    FUNCTION = "analyze_video"
    CATEGORY = "🦅 Eagle/视频"

    def analyze_video(self, video_path):
        video_input = video_path
        resolved = _resolve_video_path(video_path)
        if not resolved:
            return ("视频文件不存在或路径无法解析", 0.0, 0.0, 0, 0, 0, _passthrough_video(video_input))
        video_path = resolved
        try:
            import cv2
        except ImportError:
            raise ImportError("需要安装 opencv-python: pip install opencv-python")
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return ("无法打开视频", 0.0, 0.0, 0, 0, 0, _passthrough_video(video_input))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0.0
        file_size = os.path.getsize(video_path) / (1024 * 1024)
        cap.release()
        codec, bitrate = _get_codec_info(video_path)
        info = f"📹 {os.path.basename(video_path)}\n"
        info += f"⏱️ 时长: {duration:.2f}s\n"
        info += f"🎬 帧率: {fps:.2f} fps\n"
        info += f"📊 总帧数: {total_frames}\n"
        info += f"📐 分辨率: {width}x{height}\n"
        info += f"🎞 编解码器: {codec}\n"
        if bitrate > 0:
            info += f"📡 比特率: {bitrate} kbps\n"
        info += f"💾 文件大小: {file_size:.2f} MB"
        return (info, duration, fps, total_frames, width, height, _passthrough_video(video_input))


__all__ = ["EagleBatchVideoLoader", "EagleVideoFrameExtractor", "EagleVideoInfo"]
