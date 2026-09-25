# -*- coding: utf-8 -*-
"""Lightweight in-node video/audio timeline editor for Eagle Suite."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import uuid
import wave

import numpy as np
import torch
from aiohttp import web
import folder_paths

from comfy_api.input_impl import VideoFromFile

from .batch_video_nodes import _register_video_preview, _resolve_video_path
from .route_registry import route
from .utils import get_audio, get_cached_ffmpeg
from ..tools_utils import is_trusted_browser_request


VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mpg", ".mpeg", ".wmv"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus"}
TIMELINE_VERSION = 1
MAX_ASSETS = 128
MAX_CLIPS = 256
TIMELINE_PREVIEW_COUNT = 12
TIMELINE_PREVIEW_WIDTH = 192
MAX_OUTPUT_FRAMES = 128
MAX_OUTPUT_FRAME_PIXELS = 24_000_000
MAX_SCANNED_VIDEO_FRAMES = 1200
MAX_FRAMES_MODE_SECONDS = 300
MAX_FRAMES_MODE_RENDER_PIXELS = 6_000_000_000


def _empty_project():
    return {
        "version": TIMELINE_VERSION,
        "assets": [],
        "video_clips": [],
        "audio_tracks": [
            {"id": "A1", "name": "A1", "clips": []},
            {"id": "A2", "name": "A2", "clips": []},
        ],
    }


def _safe_number(value, default=0.0, minimum=None, maximum=None):
    try:
        result = float(value)
    except (TypeError, ValueError):
        result = float(default)
    if not np.isfinite(result):
        result = float(default)
    if minimum is not None:
        result = max(float(minimum), result)
    if maximum is not None:
        result = min(float(maximum), result)
    return result


def _load_project(raw):
    if isinstance(raw, dict):
        source = raw
    else:
        try:
            source = json.loads(str(raw or ""))
        except Exception:
            source = {}
    if not isinstance(source, dict):
        source = {}
    project = _empty_project()
    assets = source.get("assets") if isinstance(source.get("assets"), list) else []
    seen = set()
    for row in assets[:MAX_ASSETS]:
        if not isinstance(row, dict):
            continue
        asset_id = str(row.get("id") or "").strip()
        media_type = str(row.get("type") or "").lower()
        filename = str(row.get("filename") or "").replace("\\", "/").strip()
        if not asset_id or asset_id in seen or media_type not in {"video", "audio"} or not filename:
            continue
        seen.add(asset_id)
        project["assets"].append({
            "id": asset_id,
            "type": media_type,
            "filename": filename,
            "name": str(row.get("name") or os.path.basename(filename)),
            "duration": _safe_number(row.get("duration"), 0, 0, 86400),
            "width": int(_safe_number(row.get("width"), 0, 0, 16384)),
            "height": int(_safe_number(row.get("height"), 0, 0, 16384)),
            "fps": _safe_number(row.get("fps"), 0, 0, 1000),
            "has_audio": bool(row.get("has_audio", media_type == "audio")),
        })
    asset_ids = {item["id"] for item in project["assets"]}

    def normalize_clip(row, audio=False):
        if not isinstance(row, dict):
            return None
        asset_id = str(row.get("asset_id") or "").strip()
        if asset_id not in asset_ids and not asset_id.startswith("__connected_"):
            return None
        start = _safe_number(row.get("in"), 0, 0, 86400)
        end = _safe_number(row.get("out"), start, 0, 86400)
        if end <= start:
            return None
        result = {
            "id": str(row.get("id") or f"clip-{uuid.uuid4().hex}"),
            "asset_id": asset_id,
            "in": round(start, 6),
            "out": round(end, 6),
            "volume": _safe_number(row.get("volume"), 1, 0, 4),
            "mute": bool(row.get("mute", False)),
            "fade_in": _safe_number(row.get("fade_in"), 0, 0, end - start),
            "fade_out": _safe_number(row.get("fade_out"), 0, 0, end - start),
        }
        if audio:
            result["start"] = _safe_number(row.get("start"), 0, 0, 86400)
        else:
            result["include_audio"] = bool(row.get("include_audio", True))
        return result

    for row in (source.get("video_clips") or [])[:MAX_CLIPS]:
        clip = normalize_clip(row, audio=False)
        if clip:
            project["video_clips"].append(clip)
    source_tracks = source.get("audio_tracks") if isinstance(source.get("audio_tracks"), list) else []
    for index in range(2):
        source_track = source_tracks[index] if index < len(source_tracks) and isinstance(source_tracks[index], dict) else {}
        project["audio_tracks"][index]["name"] = str(source_track.get("name") or f"A{index + 1}")
        for row in (source_track.get("clips") or [])[:MAX_CLIPS]:
            clip = normalize_clip(row, audio=True)
            if clip:
                project["audio_tracks"][index]["clips"].append(clip)
    return project


def _input_media_path(filename):
    value = str(filename or "").replace("\\", "/").strip().lstrip("/")
    if not value:
        return None
    root = pathlib.Path(folder_paths.get_input_directory()).resolve()
    try:
        candidate = (root / value).resolve()
        if root not in candidate.parents or not candidate.is_file():
            return None
    except (OSError, RuntimeError, ValueError):
        return None
    extension = candidate.suffix.lower()
    return str(candidate) if extension in VIDEO_EXTENSIONS | AUDIO_EXTENSIONS else None


def _ffprobe_binary():
    ffmpeg = get_cached_ffmpeg()
    if not ffmpeg:
        return None
    sibling = os.path.join(os.path.dirname(ffmpeg), "ffprobe.exe" if os.name == "nt" else "ffprobe")
    return sibling if os.path.isfile(sibling) else shutil.which("ffprobe")


def _probe_media(path):
    probe = _ffprobe_binary()
    if probe:
        try:
            command = [
                probe, "-v", "error", "-show_streams", "-show_format",
                "-of", "json", path,
            ]
            completed = subprocess.run(command, capture_output=True, timeout=30, check=False)
            if completed.returncode == 0:
                data = json.loads(completed.stdout.decode("utf-8", errors="replace") or "{}")
                streams = data.get("streams") or []
                video_stream = next((item for item in streams if item.get("codec_type") == "video"), {})
                has_audio = any(item.get("codec_type") == "audio" for item in streams)
                duration = _safe_number(data.get("format", {}).get("duration"), 0, 0, 86400)
                if duration <= 0:
                    duration = _safe_number(video_stream.get("duration"), 0, 0, 86400)
                fps_text = str(video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "0/1")
                try:
                    numerator, denominator = fps_text.split("/", 1)
                    fps = float(numerator) / max(float(denominator), 1e-9)
                except Exception:
                    fps = 0.0
                if video_stream or has_audio:
                    return {
                        "duration": round(duration, 6),
                        "width": int(video_stream.get("width") or 0),
                        "height": int(video_stream.get("height") or 0),
                        "fps": round(fps, 6),
                        "has_video": bool(video_stream),
                        "has_audio": has_audio,
                    }
        except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError):
            pass

    # imageio-ffmpeg bundles ffmpeg but not ffprobe. Aki commonly runs in that
    # configuration, so read the input stream banner without decoding the file.
    ffmpeg = get_cached_ffmpeg()
    empty = {"duration": 0.0, "width": 0, "height": 0, "fps": 0.0, "has_video": False, "has_audio": False}
    if not ffmpeg:
        return empty
    try:
        completed = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", path, "-t", "0", "-f", "null", os.devnull],
            capture_output=True, timeout=30, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return empty
    banner = completed.stderr.decode("utf-8", errors="replace").split("Stream mapping:", 1)[0]
    stream_lines = [line.strip() for line in banner.splitlines() if re.match(r"^\s*Stream #\d+:\d+.*?: (?:Video|Audio):", line)]
    video_line = next((line for line in stream_lines if ": Video:" in line), "")
    has_audio = any(": Audio:" in line for line in stream_lines)
    duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", banner)
    duration = 0.0
    if duration_match:
        duration = int(duration_match.group(1)) * 3600 + int(duration_match.group(2)) * 60 + float(duration_match.group(3))
    dimensions = re.search(r"(?:^|,\s*)(\d{2,5})x(\d{2,5})(?:[\s,]|$)", video_line)
    fps_match = re.search(r"(\d+(?:\.\d+)?)\s+fps(?:[\s,]|$)", video_line)
    return {
        "duration": round(_safe_number(duration, 0, 0, 86400), 6),
        "width": int(dimensions.group(1)) if dimensions else 0,
        "height": int(dimensions.group(2)) if dimensions else 0,
        "fps": round(_safe_number(fps_match.group(1) if fps_match else 0, 0, 0, 1000), 6),
        "has_video": bool(video_line),
        "has_audio": has_audio,
    }


def _asset_record(path, media_type, filename, name=None, asset_id=None):
    metadata = _probe_media(path)
    if media_type == "video" and not metadata["has_video"]:
        raise ValueError("文件中没有可用视频流")
    if media_type == "audio" and not metadata["has_audio"]:
        raise ValueError("文件中没有可用音频流")
    return {
        "id": asset_id or f"asset-{uuid.uuid4().hex}",
        "type": media_type,
        "filename": filename,
        "name": name or os.path.basename(filename),
        "duration": metadata["duration"],
        "width": metadata["width"],
        "height": metadata["height"],
        "fps": metadata["fps"],
        "has_audio": metadata["has_audio"],
    }


@route("POST", "/eagle/media_timeline/upload")
async def upload_timeline_media(request):
    if not is_trusted_browser_request(request):
        return web.json_response({"success": False, "error": "仅允许同源界面上传"}, status=403)
    reader = await request.multipart()
    field = await reader.next()
    if field is None or not field.filename:
        return web.json_response({"success": False, "error": "未收到文件"}, status=400)
    original_name = os.path.basename(field.filename)
    extension = os.path.splitext(original_name)[1].lower()
    media_type = "video" if extension in VIDEO_EXTENSIONS else "audio" if extension in AUDIO_EXTENSIONS else ""
    if not media_type:
        return web.json_response({"success": False, "error": "仅支持视频或音频文件"}, status=400)
    root = pathlib.Path(folder_paths.get_input_directory(), "eagle_timeline")
    root.mkdir(parents=True, exist_ok=True)
    filename = f"timeline_{uuid.uuid4().hex}{extension}"
    path = root / filename
    maximum = 2 * 1024 ** 3 if media_type == "video" else 512 * 1024 ** 2
    total = 0
    try:
        with path.open("wb") as stream:
            while True:
                chunk = await field.read_chunk(size=1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > maximum:
                    raise ValueError("文件超过允许大小")
                stream.write(chunk)
        if total <= 0:
            raise ValueError("空文件")
        relative = f"eagle_timeline/{filename}"
        asset = _asset_record(str(path), media_type, relative, original_name)
        return web.json_response({"success": True, "asset": asset})
    except Exception as error:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return web.json_response({"success": False, "error": str(error)}, status=400)


def _timeline_preview_frames(path, count=TIMELINE_PREVIEW_COUNT, width=TIMELINE_PREVIEW_WIDTH):
    """Extract a small, cached contact strip without decoding the full video."""
    import cv2

    count = max(3, min(32, int(count or TIMELINE_PREVIEW_COUNT)))
    width = max(96, min(320, int(width or TIMELINE_PREVIEW_WIDTH)))
    stat = os.stat(path)
    fingerprint = f"{os.path.realpath(path)}|{stat.st_size}|{stat.st_mtime_ns}|{count}|{width}"
    cache_key = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:24]
    relative_dir = pathlib.Path("eagle_timeline_thumbnails", cache_key)
    output_dir = pathlib.Path(folder_paths.get_temp_directory(), relative_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        raise ValueError("无法解码视频预览帧")
    fps = _safe_number(capture.get(cv2.CAP_PROP_FPS), 0, 0, 1000)
    frame_count = max(0, int(_safe_number(capture.get(cv2.CAP_PROP_FRAME_COUNT), 0, 0)))
    source_width = max(0, int(_safe_number(capture.get(cv2.CAP_PROP_FRAME_WIDTH), 0, 0)))
    source_height = max(0, int(_safe_number(capture.get(cv2.CAP_PROP_FRAME_HEIGHT), 0, 0)))
    metadata = _probe_media(path)
    duration = _safe_number(metadata.get("duration"), 0, 0, 86400)
    if duration <= 0 and fps > 0 and frame_count > 0:
        duration = frame_count / fps

    sample_count = min(count, frame_count) if frame_count > 0 else count
    sample_count = max(1, sample_count)
    if frame_count > 1:
        indices = np.linspace(0, frame_count - 1, sample_count, dtype=np.int64).tolist()
    else:
        indices = [0] * sample_count

    frames = []
    try:
        for order, frame_index in enumerate(indices):
            filename = f"frame_{order:03d}.jpg"
            output_path = output_dir / filename
            timestamp = frame_index / fps if fps > 0 else duration * order / max(1, sample_count - 1)
            if not output_path.is_file():
                if frame_count > 0:
                    capture.set(cv2.CAP_PROP_POS_FRAMES, int(frame_index))
                else:
                    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp) * 1000.0)
                ok, frame = capture.read()
                if not ok or frame is None:
                    continue
                height = max(1, int(round(frame.shape[0] * width / max(1, frame.shape[1]))))
                frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
                if not cv2.imwrite(str(output_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82]):
                    continue
            frames.append({
                "filename": filename,
                "subfolder": relative_dir.as_posix(),
                "type": "temp",
                "time": round(max(0.0, timestamp), 6),
                "frame": int(frame_index),
            })
    finally:
        capture.release()
    if not frames:
        raise ValueError("视频中没有可提取的预览帧")
    return {
        "frames": frames,
        "duration": round(duration, 6),
        "fps": round(fps, 6),
        "width": source_width,
        "height": source_height,
    }


@route("GET", "/eagle/media_timeline/preview_frames")
async def timeline_preview_frames(request):
    if not is_trusted_browser_request(request):
        return web.json_response({"success": False, "error": "仅允许同源界面读取"}, status=403)
    filename = request.query.get("filename", "")
    path = _input_media_path(filename)
    if not path or pathlib.Path(path).suffix.lower() not in VIDEO_EXTENSIONS:
        return web.json_response({"success": False, "error": "视频文件不存在或不受支持"}, status=404)
    try:
        count = int(request.query.get("count", TIMELINE_PREVIEW_COUNT))
        width = int(request.query.get("width", TIMELINE_PREVIEW_WIDTH))
        result = await asyncio.to_thread(_timeline_preview_frames, path, count, width)
        return web.json_response({"success": True, **result})
    except (OSError, ValueError, TypeError) as error:
        return web.json_response({"success": False, "error": str(error)}, status=400)


def _write_audio_wav(audio, path):
    if not isinstance(audio, dict) or "waveform" not in audio:
        return None, 0.0
    waveform = audio["waveform"]
    if not torch.is_tensor(waveform):
        waveform = torch.as_tensor(waveform)
    waveform = waveform.detach().float().cpu()
    while waveform.ndim > 2:
        waveform = waveform[0]
    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)
    sample_rate = max(8000, int(audio.get("sample_rate") or 44100))
    pcm = waveform.clamp(-1, 1).transpose(0, 1).numpy()
    pcm = (pcm * 32767.0).round().astype(np.int16)
    with wave.open(str(path), "wb") as stream:
        stream.setnchannels(int(pcm.shape[1]))
        stream.setsampwidth(2)
        stream.setframerate(sample_rate)
        stream.writeframes(pcm.tobytes())
    return str(path), float(pcm.shape[0]) / sample_rate


def _scale_filter(width, height, fit_mode):
    width = max(2, int(width)) // 2 * 2
    height = max(2, int(height)) // 2 * 2
    if fit_mode == "stretch":
        return f"scale={width}:{height}:flags=lanczos"
    if fit_mode == "cover":
        return (
            f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={width}:{height}"
        )
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"
    )


def _run(command, label, timeout=1800):
    completed = subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"{label}失败：{detail[-800:]}")


def _render_key(project, paths, settings):
    fingerprint = {"project": project, "settings": settings, "files": []}
    for path in sorted(set(paths)):
        try:
            stat = os.stat(path)
            fingerprint["files"].append((path, stat.st_size, stat.st_mtime_ns))
        except OSError:
            fingerprint["files"].append((path, 0, 0))
    payload = json.dumps(fingerprint, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _usable_cached_media(path, stream_type):
    """Do not reuse a partial render left by an interrupted FFmpeg process."""
    try:
        if not path.is_file() or path.stat().st_size < 64:
            return False
        if path.suffix.lower() == ".wav":
            with wave.open(str(path), "rb") as stream:
                payload_bytes = stream.getnframes() * stream.getnchannels() * stream.getsampwidth()
            if payload_bytes <= 0 or path.stat().st_size < 44 + payload_bytes:
                return False
        metadata = _probe_media(str(path))
        return bool(metadata.get(f"has_{stream_type}")) and metadata.get("duration", 0) > 0.001
    except (OSError, ValueError, wave.Error):
        return False


def _decode_frames(path, frame_step=1, max_frames=0):
    import cv2
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return torch.zeros((1, 64, 64, 3), dtype=torch.float32), 0, False
    step = max(1, int(frame_step or 1))
    # IMAGE batches live entirely in RAM. A zero user limit means "automatic",
    # not unbounded; also cap source reads when frame_step is very large.
    limit = min(MAX_OUTPUT_FRAMES, max(1, int(max_frames or MAX_OUTPUT_FRAMES)))
    frames = []
    index = 0
    pixels = 0
    truncated = False
    try:
        while index < MAX_SCANNED_VIDEO_FRAMES:
            ok, frame = cap.read()
            if not ok:
                break
            if index % step == 0:
                frame_pixels = int(frame.shape[0]) * int(frame.shape[1])
                if pixels + frame_pixels > MAX_OUTPUT_FRAME_PIXELS:
                    if not frames:
                        raise ValueError("视频单帧过大，无法安全输出 IMAGE 张量")
                    truncated = True
                    break
                frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                frames.append(torch.from_numpy(frame).float().div_(255.0))
                pixels += frame_pixels
                if len(frames) >= limit:
                    truncated = True
                    break
            index += 1
        else:
            truncated = True
    finally:
        cap.release()
    if not frames:
        return torch.zeros((1, 64, 64, 3), dtype=torch.float32), 0, truncated
    return torch.stack(frames, dim=0), len(frames), truncated


class EagleMediaTimelineEditor:
    """One video track plus two independent audio tracks, rendered by FFmpeg."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "timeline_json": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
                "output_mode": (["video_audio", "video_audio_frames", "frames", "audio"], {"default": "video_audio"}),
                "size_mode": (["follow_first", "custom"], {"default": "follow_first"}),
                "width": ("INT", {"default": 1280, "min": 64, "max": 8192, "step": 8}),
                "height": ("INT", {"default": 720, "min": 64, "max": 8192, "step": 8}),
                "lock_aspect_ratio": ("BOOLEAN", {"default": True}),
                "resize_anchor": (["width", "height"], {"default": "width"}),
                "fit_mode": (["contain", "cover", "stretch"], {"default": "contain"}),
                "output_fps": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 240.0, "step": 0.001}),
                "include_video_audio": ("BOOLEAN", {"default": True}),
                "audio_sample_rate": (["44100", "48000"], {"default": "48000"}),
                "video_crf": ("INT", {"default": 18, "min": 0, "max": 40, "step": 1}),
                "frame_step": ("INT", {"default": 1, "min": 1, "max": 240, "step": 1}),
                "max_frames": ("INT", {"default": 0, "min": 0, "max": 100000, "step": 1,
                                       "tooltip": "0 表示自动安全上限；图像帧还受内存和扫描预算限制。"}),
                "render_revision": ("INT", {"default": 0, "min": 0, "max": 2147483647}),
            },
            "optional": {
                "video": ("VIDEO", {"tooltip": "时间线没有视频片段时，外接视频自动成为首段。"}),
                "audio_1": ("AUDIO", {"tooltip": "A1 为空时，外接音频从 0 秒开始。"}),
                "audio_2": ("AUDIO", {"tooltip": "A2 为空时，外接音频从 0 秒开始。"}),
            },
        }

    RETURN_TYPES = ("VIDEO", "IMAGE", "AUDIO", "STRING", "STRING")
    RETURN_NAMES = ("video", "images", "audio", "timeline_json", "info")
    FUNCTION = "render"
    CATEGORY = "🦅 Eagle/视频"
    OUTPUT_NODE = True
    DESCRIPTION = "节点内轻量剪辑台：多段视频裁剪拼接、视频原声分离、双音频轨裁剪混音。"

    def render(self, timeline_json="", output_mode="video_audio", size_mode="follow_first",
               width=1280, height=720, lock_aspect_ratio=True, resize_anchor="width",
               fit_mode="contain", output_fps=0.0, include_video_audio=True,
               audio_sample_rate="48000", video_crf=18, frame_step=1, max_frames=0,
               render_revision=0, video=None, audio_1=None, audio_2=None):
        project = _load_project(timeline_json)
        render_root = pathlib.Path(folder_paths.get_temp_directory(), "eagle_timeline_renders")
        render_root.mkdir(parents=True, exist_ok=True)

        assets = {item["id"]: dict(item) for item in project["assets"]}
        paths = {}
        for asset_id, asset in assets.items():
            path = _input_media_path(asset["filename"])
            if path:
                paths[asset_id] = path
                probed = _probe_media(path)
                for key in ("duration", "width", "height", "fps", "has_audio"):
                    asset[key] = probed[key]

        connected_video_path = _resolve_video_path(video)
        if connected_video_path:
            assets["__connected_video__"] = _asset_record(
                connected_video_path, "video", "", "外接 VIDEO", "__connected_video__"
            )
            paths["__connected_video__"] = connected_video_path

        video_clips = [dict(item) for item in project["video_clips"] if item["asset_id"] in paths]
        if not video_clips and connected_video_path:
            duration = assets["__connected_video__"]["duration"]
            video_clips = [{
                "id": "connected-video", "asset_id": "__connected_video__",
                "in": 0.0, "out": duration, "volume": 1.0, "mute": False,
                "fade_in": 0.0, "fade_out": 0.0, "include_audio": True,
            }]

        if not video_clips and output_mode != "audio":
            raise ValueError("剪辑时间线没有可用视频片段；请拖入视频或连接 VIDEO")

        first_asset = assets.get(video_clips[0]["asset_id"], {}) if video_clips else {}
        source_width = max(2, int(first_asset.get("width") or width or 1280))
        source_height = max(2, int(first_asset.get("height") or height or 720))
        if size_mode == "follow_first":
            output_width, output_height = source_width, source_height
        else:
            output_width, output_height = max(2, int(width)), max(2, int(height))
            if lock_aspect_ratio:
                ratio = source_width / max(1, source_height)
                if resize_anchor == "height":
                    output_width = max(2, int(round(output_height * ratio / 2)) * 2)
                else:
                    output_height = max(2, int(round(output_width / ratio / 2)) * 2)
        output_width -= output_width % 2
        output_height -= output_height % 2
        fps = _safe_number(output_fps, 0, 0, 240) or _safe_number(first_asset.get("fps"), 24, 1, 240)
        wants_video = output_mode in {"video_audio", "video_audio_frames"}
        wants_frames = output_mode in {"video_audio_frames", "frames"}
        wants_audio = output_mode in {"video_audio", "video_audio_frames", "audio"}
        if wants_frames:
            # This renderer encodes the full timeline before extracting IMAGEs.
            # Reject oversized jobs up front rather than spending hours encoding
            # video that cannot be returned as a resident tensor anyway.
            estimated_seconds = 0.0
            for clip in video_clips:
                asset = assets.get(clip["asset_id"], {})
                source_end = float(asset.get("duration") or clip["out"])
                estimated_seconds += max(0.0, min(float(clip["out"]), source_end) - float(clip["in"]))
            render_pixels = estimated_seconds * fps * output_width * output_height
            if estimated_seconds > MAX_FRAMES_MODE_SECONDS or render_pixels > MAX_FRAMES_MODE_RENDER_PIXELS:
                raise ValueError(
                    "图像帧模式的时间线过长或分辨率/FPS 过高；请缩短片段、降低尺寸/FPS，"
                    "或切换为‘视频 + 音频’以保留完整视频输出"
                )

        connected_audio = [audio_1, audio_2]
        connected_audio_root = None
        for index, value in enumerate(connected_audio):
            track = project["audio_tracks"][index]
            if value is None or track["clips"]:
                continue
            asset_id = f"__connected_audio_{index + 1}__"
            if connected_audio_root is None:
                # Never share a mutable WAV pathname between overlapping runs.
                connected_audio_root = render_root / "connected_inputs" / uuid.uuid4().hex
                connected_audio_root.mkdir(parents=True, exist_ok=False)
            wav_path, duration = _write_audio_wav(value, connected_audio_root / f"connected_audio_{index + 1}.wav")
            if wav_path and duration > 0:
                assets[asset_id] = {
                    "id": asset_id, "type": "audio", "filename": "",
                    "name": f"外接 AUDIO {index + 1}", "duration": duration,
                    "width": 0, "height": 0, "fps": 0, "has_audio": True,
                }
                paths[asset_id] = wav_path
                track["clips"].append({
                    "id": f"connected-audio-{index + 1}", "asset_id": asset_id,
                    "in": 0.0, "out": duration, "start": 0.0, "volume": 1.0,
                    "mute": False, "fade_in": 0.0, "fade_out": 0.0,
                })
        sample_rate = int(audio_sample_rate)
        settings = {
            "width": output_width, "height": output_height, "fps": fps,
            "fit": fit_mode, "source_audio": bool(include_video_audio),
            "sample_rate": sample_rate, "crf": int(video_crf),
            "revision": int(render_revision),
        }
        key = _render_key(project, list(paths.values()), settings)
        target = render_root / key
        target.mkdir(parents=True, exist_ok=True)
        ffmpeg = get_cached_ffmpeg()
        if not ffmpeg:
            raise RuntimeError("未找到 FFmpeg")

        timeline_cursor = 0.0
        source_audio_segments = []
        segment_paths = []
        if video_clips:
            scale = _scale_filter(output_width, output_height, fit_mode)
            for index, clip in enumerate(video_clips):
                asset = assets.get(clip["asset_id"], {})
                path = paths.get(clip["asset_id"])
                if not path:
                    continue
                clip_in = max(0.0, min(float(clip["in"]), float(asset.get("duration") or clip["out"])))
                clip_out = max(clip_in, min(float(clip["out"]), float(asset.get("duration") or clip["out"])))
                duration = clip_out - clip_in
                if duration <= 0.001:
                    continue
                segment_path = target / f"segment_{index:04d}.mp4"
                if not _usable_cached_media(segment_path, "video"):
                    command = [
                        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                        "-ss", f"{clip_in:.6f}", "-i", path, "-t", f"{duration:.6f}",
                        "-map", "0:v:0", "-an", "-vf", f"{scale},fps={fps:.6f}",
                        "-c:v", "libx264", "-preset", "fast", "-crf", str(int(video_crf)),
                        "-pix_fmt", "yuv420p", str(segment_path),
                    ]
                    _run(command, f"视频片段 {index + 1} 编码")
                    if not _usable_cached_media(segment_path, "video"):
                        raise RuntimeError(f"视频片段 {index + 1} 编码未产生完整文件")
                segment_paths.append(str(segment_path))
                if wants_audio and include_video_audio and clip.get("include_audio", True) and asset.get("has_audio") and not clip.get("mute"):
                    source_audio_segments.append({
                        "path": path, "in": clip_in, "out": clip_out,
                        "start": timeline_cursor, "volume": clip.get("volume", 1),
                        "fade_in": clip.get("fade_in", 0), "fade_out": clip.get("fade_out", 0),
                    })
                timeline_cursor += duration

        total_duration = timeline_cursor
        video_only = target / "video_only.mp4"
        if segment_paths and not _usable_cached_media(video_only, "video"):
            concat_file = target / "concat.txt"
            with concat_file.open("w", encoding="utf-8") as stream:
                for path in segment_paths:
                    escaped = path.replace("'", "'\\''")
                    stream.write(f"file '{escaped}'\n")
            _run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "concat", "-safe", "0", "-i", str(concat_file),
                "-c", "copy", "-movflags", "+faststart", str(video_only),
            ], "视频拼接")
            if not _usable_cached_media(video_only, "video"):
                raise RuntimeError("视频拼接未产生完整文件")

        audio_segments = list(source_audio_segments)
        for track in (project["audio_tracks"] if wants_audio else []):
            for clip in track["clips"]:
                if clip.get("mute") or clip["asset_id"] not in paths:
                    continue
                asset = assets.get(clip["asset_id"], {})
                clip_in = max(0.0, float(clip["in"]))
                clip_out = min(float(clip["out"]), float(asset.get("duration") or clip["out"]))
                if clip_out <= clip_in:
                    continue
                audio_segments.append({
                    "path": paths[clip["asset_id"]], "in": clip_in, "out": clip_out,
                    "start": max(0.0, float(clip.get("start") or 0)),
                    "volume": clip.get("volume", 1), "fade_in": clip.get("fade_in", 0),
                    "fade_out": clip.get("fade_out", 0),
                })
                total_duration = max(total_duration, float(clip.get("start") or 0) + clip_out - clip_in)

        mixed_audio_path = target / "mixed.wav"
        if audio_segments and not _usable_cached_media(mixed_audio_path, "audio"):
            command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
            filters = []
            labels = []
            for index, segment in enumerate(audio_segments):
                command.extend(["-i", segment["path"]])
                duration = max(0.001, segment["out"] - segment["in"])
                fade_in = min(duration, _safe_number(segment.get("fade_in"), 0, 0, duration))
                fade_out = min(duration, _safe_number(segment.get("fade_out"), 0, 0, duration))
                chain = (
                    f"[{index}:a:0]atrim=start={segment['in']:.6f}:end={segment['out']:.6f},"
                    f"asetpts=PTS-STARTPTS,volume={_safe_number(segment.get('volume'), 1, 0, 4):.6f}"
                )
                if fade_in > 0:
                    chain += f",afade=t=in:st=0:d={fade_in:.6f}"
                if fade_out > 0:
                    chain += f",afade=t=out:st={max(0, duration - fade_out):.6f}:d={fade_out:.6f}"
                delay = int(round(max(0.0, segment["start"]) * 1000))
                chain += f",adelay={delay}:all=1[a{index}]"
                filters.append(chain)
                labels.append(f"[a{index}]")
            filters.append(
                f"{''.join(labels)}amix=inputs={len(labels)}:duration=longest:dropout_transition=0,"
                f"atrim=duration={max(0.001, total_duration):.6f},aresample={sample_rate}[mix]"
            )
            command.extend([
                "-filter_complex", ";".join(filters), "-map", "[mix]",
                "-c:a", "pcm_s16le", str(mixed_audio_path),
            ])
            _run(command, "音频混音")
            if not _usable_cached_media(mixed_audio_path, "audio"):
                raise RuntimeError("音频混音未产生完整文件")

        final_video = target / "timeline.mp4"
        video_ready = _usable_cached_media(video_only, "video")
        audio_ready = _usable_cached_media(mixed_audio_path, "audio")
        if wants_video and video_ready:
            if audio_ready:
                if not _usable_cached_media(final_video, "video"):
                    _run([
                        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(video_only), "-i", str(mixed_audio_path),
                        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                        "-c:a", "aac", "-b:a", "192k", "-shortest",
                        "-movflags", "+faststart", str(final_video),
                    ], "音视频封装")
            elif not _usable_cached_media(final_video, "video"):
                shutil.copy2(video_only, final_video)
            if not _usable_cached_media(final_video, "video"):
                raise RuntimeError("音视频封装未产生完整文件")

        final_video_ready = _usable_cached_media(final_video, "video")
        frame_source = str(final_video if final_video_ready else video_only)
        frames_limited = False
        if wants_frames and (final_video_ready or video_ready):
            images, image_count, frames_limited = _decode_frames(frame_source, frame_step, max_frames)
        elif wants_video and (final_video_ready or video_ready):
            # Keep the IMAGE output meaningful in the default lightweight mode:
            # one real preview frame instead of a misleading 64x64 black tensor.
            images, image_count, _ = _decode_frames(frame_source, 1, 1)
        else:
            images, image_count = torch.zeros((1, 64, 64, 3), dtype=torch.float32), 0
        video_output = VideoFromFile(str(final_video)) if wants_video and final_video_ready else None
        audio_output = get_audio(str(mixed_audio_path)) if wants_audio and audio_ready else {
            "waveform": torch.zeros((1, 2, 1), dtype=torch.float32), "sample_rate": sample_rate,
        }
        public_json = json.dumps(project, ensure_ascii=False, separators=(",", ":"))
        info = (
            f"视频片段 {len(segment_paths)} · 音频片段 {len(audio_segments)} · "
            f"时长 {total_duration:.3f}s · {output_width}×{output_height} · {fps:.3f}fps"
        )
        if wants_frames:
            info += f" · 输出帧 {image_count}"
            if frames_limited:
                info += "（已按安全帧/内存/扫描预算截取）"
        elif wants_video and image_count:
            info += " · 图像口首帧预览"
        preview_url = _register_video_preview(str(final_video)) if final_video_ready else ""
        return {
            "ui": {
                "status": [info],
                "video_url": [preview_url] if preview_url else [],
                "timeline_json": [public_json],
                "render_meta": [{
                    "duration": total_duration, "width": output_width, "height": output_height,
                    "fps": fps, "video_clips": len(segment_paths), "audio_clips": len(audio_segments),
                }],
            },
            "result": (video_output, images, audio_output, public_json, info),
        }


__all__ = ["EagleMediaTimelineEditor"]
