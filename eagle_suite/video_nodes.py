# -*- coding: utf-8 -*-
"""
Eagle Suite 视频节点 - 图像序列→视频 + 视频格式转换
重构版本，使用 eagle_suite.utils 和 eagle_suite.logger
"""

import os
import re
import json
import requests
import subprocess
import shutil
import tempfile
import time
import uuid
from datetime import datetime

import torch
import numpy as np
from PIL import Image
import folder_paths

from .logger import logger
from .utils import (
    get_cached_ffmpeg,
    is_safe_path,
    validate_path,
    strip_path,
    is_url,
    hash_path,
    get_sorted_dir_files,
    ensure_dir,
    get_extension,
    LazyAudioMap,
    VIDEO_EXTENSIONS,
    IMAGE_EXTENSIONS,
)


EAGLE_API_URL = "http://localhost:41595/api"

STAR_OPTIONS = ["0 未评级", "1 ★", "2 ★★", "3 ★★★", "4 ★★★★", "5 ★★★★★"]

RESOLUTION_PRESETS = [
    "original",
    "480p  (854x480)",
    "720p  (1280x720)",
    "1080p (1920x1080)",
    "1440p (2560x1440)",
    "4K    (3840x2160)",
    "custom",
]
RESOLUTION_MAP = {
    "original":           None,
    "480p  (854x480)":    (854,  480),
    "720p  (1280x720)":   (1280, 720),
    "1080p (1920x1080)":  (1920, 1080),
    "1440p (2560x1440)":  (2560, 1440),
    "4K    (3840x2160)":  (3840, 2160),
    "custom":             None,
}

ALPHA_CAPABLE_FORMATS = {"prores-mov", "vp9-webm", "webp", "apng", "gif"}


def _parse_star(star) -> int:
    if isinstance(star, str):
        return int(star.split()[0])
    return int(star)


def _parse_resolution(resolution, custom_w=1920, custom_h=1080):
    if resolution == "original":
        return None
    if resolution == "custom":
        return (int(custom_w), int(custom_h))
    return RESOLUTION_MAP.get(resolution)


def _check_ffmpeg():
    """检查 ffmpeg 是否可用"""
    ffmpeg = get_cached_ffmpeg()
    if not ffmpeg or not os.path.isfile(ffmpeg):
        raise RuntimeError(
            "EagleSuite: FFmpeg 未找到。请安装 ffmpeg 或设置 EAGLE_FORCE_FFMPEG_PATH 环境变量。"
        )


def _tensor_to_np_uint8(frame_tensor) -> np.ndarray:
    if isinstance(frame_tensor, torch.Tensor):
        arr = frame_tensor.cpu().numpy()
    else:
        arr = np.array(frame_tensor)
    return (arr * 255 + 0.5).clip(0, 255).astype(np.uint8)


def _resolve_video_path(video):
    """解析视频路径"""
    if video is None:
        return None
    if isinstance(video, (list, tuple)):
        if not video:
            return None
        video = video[0]
    if isinstance(video, str):
        path = video.strip()
        return path if path and os.path.isfile(path) else None
    try:
        for attr in ['video_path', 'path', 'file', 'filename']:
            if hasattr(video, attr):
                path = getattr(video, attr)
                if isinstance(path, str) and os.path.isfile(path):
                    return path
        if isinstance(video, dict):
            for key in ['video', 'path', 'file']:
                if key in video:
                    path = video[key]
                    if isinstance(path, str) and os.path.isfile(path):
                        return path
    except Exception as e:
        logger.warning(f"视频路径解析失败: {e}")
    try:
        path = str(video)
        if os.path.isfile(path):
            return path
    except Exception:
        pass
    return None


def _extract_frames(video_path, target_fps, frame_limit=0):
    """从视频提取帧"""
    cap = None
    try:
        import cv2
        path = _resolve_video_path(video_path)
        if not path or not os.path.isfile(path):
            logger.error(f"视频路径不存在或无效: {path}")
            return None
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            logger.error(f"无法打开视频: {path}")
            return None
        total_input_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        if frame_limit > 0 and frame_limit < total_input_frames:
            indices = np.linspace(0, total_input_frames - 1, frame_limit, dtype=int)
        else:
            interval = max(1, int(original_fps / target_fps)) if target_fps > 0 else 1
            indices = range(0, total_input_frames, interval)
        target_indices = set(indices)
        frames = []
        curr = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            if curr not in target_indices:
                curr += 1
                continue
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame_tensor = torch.from_numpy(frame_rgb).float() / 255.0
            frames.append(frame_tensor)
            curr += 1
            if frame_limit > 0 and len(frames) >= frame_limit:
                break
        return torch.stack(frames) if frames else None
    except Exception as e:
        logger.error(f"提取帧失败: {e}")
        return None
    finally:
        if cap is not None:
            cap.release()


def _prepare_alpha(mask, images):
    """将 mask 整理为与 images 匹配的 [N,H,W,1] alpha 通道"""
    alpha = mask
    if isinstance(alpha, np.ndarray):
        alpha = torch.from_numpy(alpha).float()
    else:
        alpha = alpha.float()
    if alpha.ndim == 2:
        alpha = alpha.unsqueeze(0).unsqueeze(-1)
    elif alpha.ndim == 3:
        alpha = alpha.unsqueeze(-1)
    if alpha.shape[0] == 1 and images.shape[0] > 1:
        alpha = alpha.expand(images.shape[0], -1, -1, -1)
    if alpha.shape[1:3] != images.shape[1:3]:
        import torch.nn.functional as F
        alpha = F.interpolate(
            alpha.permute(0, 3, 1, 2),
            size=(images.shape[1], images.shape[2]),
            mode='bilinear',
            align_corners=False
        ).permute(0, 2, 3, 1)
    return alpha.to(images.device)


def _apply_mask(images, mask):
    """仅用于不支持 alpha 的格式：将背景乘黑"""
    alpha = _prepare_alpha(mask, images)
    return images * alpha


def _write_audio(audio, out_dir):
    """将音频数据写入临时 WAV 文件"""
    import wave
    try:
        if isinstance(audio, dict):
            waveform = audio.get("waveform")
            sample_rate = audio.get("sample_rate", 44100)
        elif isinstance(audio, (list, tuple)) and len(audio) == 2:
            waveform, sample_rate = audio
        else:
            logger.warning("音频格式不支持")
            return None
        if waveform is None:
            return None
        if isinstance(waveform, torch.Tensor):
            arr = waveform.cpu().numpy()
        else:
            arr = np.array(waveform)
        if arr.ndim == 3:
            arr = arr[0]
        if arr.ndim == 1:
            arr = arr[np.newaxis, :]
        temp_path = os.path.join(out_dir, f"__eagle_audio_{uuid.uuid4().hex[:8]}.wav")
        with wave.open(temp_path, "w") as wf:
            wf.setnchannels(arr.shape[0])
            wf.setsampwidth(2)
            wf.setframerate(int(sample_rate))
            pcm = (arr * 32767).clip(-32768, 32767).astype(np.int16)
            wf.writeframes(pcm.T.flatten().tobytes())
        return temp_path
    except Exception as e:
        logger.error(f"音频写入失败: {e}")
        return None


def _generate_unique_filename(prefix):
    """生成唯一文件名"""
    date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    short_id = uuid.uuid4().hex[:6]
    return f"{prefix}_{date_str}_{short_id}"


def _parse_folder_input(folder_input):
    """解析文件夹输入"""
    s = folder_input.strip()
    if not s:
        return None, None
    if s.startswith("eagle://folder/"):
        return s.replace("eagle://folder/", ""), "eagle_id"
    if "localhost:41595" in s or "127.0.0.1:41595" in s:
        match = re.search(r'[?&]id=([A-Z0-9]+)', s)
        if match:
            return match.group(1), "eagle_id"
    if ":" in s or "/" in s or "\\" in s:
        return s, "local_path"
    if len(s) == 13 and s.isalnum() and s.isupper():
        return s, "eagle_id"
    return s, "eagle_name"


def _get_folders():
    """获取 Eagle 文件夹列表"""
    try:
        response = requests.get(f"{EAGLE_API_URL}/folder/list", timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "success":
                return data.get("data", [])
    except Exception as e:
        logger.warning(f"获取 Eagle 文件夹失败: {e}")
    return []


def _find_folder_by_path(folders, path):
    """根据路径查找文件夹 ID"""
    path_parts = [p.strip() for p in path.split("/") if p.strip()]

    def search(folder_list, parts, depth=0):
        if depth >= len(parts):
            return None
        for f in folder_list:
            if f.get("name") == parts[depth]:
                if depth == len(parts) - 1:
                    return f.get("id")
                children = f.get("children", [])
                if children:
                    res = search(children, parts, depth + 1)
                    if res:
                        return res
        return None

    return search(folders, path_parts)


def _save_to_eagle(file_path, folder_id, name, tags=None, annotation="", star=0):
    """保存文件到 Eagle"""
    try:
        request_data = {'path': file_path, 'folderId': folder_id, 'name': name}
        if tags:
            request_data['tags'] = (
                tags if isinstance(tags, list)
                else [t.strip() for t in tags.split(",") if t.strip()]
            )
        if annotation:
            request_data['annotation'] = annotation
        if star > 0:
            request_data['star'] = star
        response = requests.post(
            f"{EAGLE_API_URL}/item/addFromPath", json=request_data, timeout=30
        )
        if response.status_code == 200:
            result = response.json()
            return result.get("status") == "success", result.get("message", "")
        return False, f"HTTP {response.status_code}"
    except Exception as e:
        return False, str(e)


def _cleanup_temp_file(file_path):
    """清理临时文件"""
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as e:
            logger.warning(f"临时文件清理失败 {file_path}: {e}")


# ============================================================================
# 节点1: 图像序列 → 视频
# ============================================================================

class EagleImagesToVideo:

    VIDEO_FORMATS = [
        "h264-mp4", "h265-mp4", "av1-webm", "vp9-webm",
        "gif", "apng", "webp", "prores-mov",
    ]
    FORMAT_MAP = {
        "h264-mp4":   ("libx264",    "mp4"),
        "h265-mp4":   ("libx265",    "mp4"),
        "av1-webm":   ("libaom-av1", "webm"),
        "vp9-webm":   ("libvpx-vp9", "webm"),
        "gif":        ("gif",        "gif"),
        "apng":       ("apng",       "apng"),
        "webp":       ("webp",       "webp"),
        "prores-mov": ("prores_ks",  "mov"),
    }
    SIZE_MODES = ["original", "fit-max", "fit-min", "stretch", "crop"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "eagle_folder":    ("STRING", {"default": "", "multiline": False,
                                               "placeholder": "Eagle文件夹路径/ID"}),
                "local_save_path": ("STRING", {"default": "", "multiline": False,
                                               "placeholder": "本地保存路径"}),
                "filename_prefix": ("STRING", {"default": "video", "multiline": False}),
                "format":          (cls.VIDEO_FORMATS, {"default": "h264-mp4"}),
                "fps":             ("FLOAT",  {"default": 24.0, "min": 1.0,
                                               "max": 120.0, "step": 0.5}),
                "quality":         (["high", "medium", "low", "custom"],
                                    {"default": "high"}),
                "size_mode":       (cls.SIZE_MODES, {"default": "original"}),
                "resolution":      (RESOLUTION_PRESETS, {"default": "1080p (1920x1080)"}),
            },
            "optional": {
                "images":        ("IMAGE",),
                "input_video":   ("STRING",  {"forceInput": True}),
                "frame_skip":    ("INT",     {
                    "default": 0, "min": 0, "max": 100, "step": 1,
                    "tooltip": (
                        "每隔N帧取一帧，0=不跳过\n"
                        "输出fps = 节点fps设置 ÷ (frame_skip + 1)\n"
                        "\n"
                        "源序列帧率      frame_skip   实际输出帧数   建议fps\n"
                        "30fps / 90帧       0           90帧          30\n"
                        "30fps / 90帧       1           45帧          15\n"
                        "30fps / 90帧       2           30帧          10\n"
                        "24fps / 120帧      3           30帧           6"
                    ),
                }),
                "frame_limit":   ("INT",     {"default": 0, "min": 0,
                                              "max": 10000, "step": 1,
                                              "tooltip": "最终保留帧数上限，0=不限制。在frame_skip之后生效"}),
                "mask":          ("MASK",),
                "audio":         ("AUDIO",),
                "crf":           ("INT",     {"default": 20, "min": 0, "max": 51}),
                "custom_width":  ("INT",     {"default": 1920, "min": 64,
                                              "max": 8192, "step": 2}),
                "custom_height": ("INT",     {"default": 1080, "min": 64,
                                              "max": 8192, "step": 2}),
                "tags":          ("STRING",  {"default": "", "multiline": False}),
                "annotation":    ("STRING",  {"default": "", "multiline": True}),
                "star":          (STAR_OPTIONS, {"default": "0 未评分"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("filepath", "info", "video_path")
    OUTPUT_NODE = True
    FUNCTION = "save"
    CATEGORY = "🦅 Eagle/视频处理"

    def save(self, eagle_folder, local_save_path, filename_prefix, format, fps,
             quality, size_mode, resolution="1080p (1920x1080)",
             images=None, input_video=None, frame_skip=0, frame_limit=0,
             mask=None, audio=None, crf=20,
             custom_width=1920, custom_height=1080,
             tags="", annotation="", star="0 未评分"):

        _check_ffmpeg()
        star_val = _parse_star(star)

        save_to_eagle = bool(eagle_folder.strip())
        save_to_local = bool(local_save_path.strip())
        if not save_to_eagle and not save_to_local:
            return ("", "❌ 请至少指定 Eagle 文件夹或本地保存路径", "")

        if input_video is not None:
            video_path = _resolve_video_path(input_video)
            if video_path:
                images = _extract_frames(video_path, fps, frame_limit)
                if images is None:
                    return ("", "❌ 无法从视频提取帧", "")
            else:
                return ("", "❌ 无法解析视频路径", "")
        elif images is None:
            return ("", "❌ 请提供 images 图像序列或 input_video 视频路径", "")

        if not isinstance(images, torch.Tensor):
            images = torch.as_tensor(images)
        if images.ndim == 3:
            images = images.unsqueeze(0)
        if images.shape[0] == 0:
            return ("", "❌ 图像序列为空", "")

        # 抽帧
        if frame_skip > 0:
            indices = list(range(0, len(images), frame_skip + 1))
            images = images[indices]
            if images.shape[0] == 0:
                return ("", "❌ 抽帧后图像序列为空", "")

        # 帧数上限
        if frame_limit > 0 and len(images) > frame_limit:
            indices = np.linspace(0, len(images) - 1, frame_limit, dtype=int)
            images = images[indices]

        # 透明通道处理
        n_channels = images.shape[-1]

        if n_channels == 4:
            if format in ALPHA_CAPABLE_FORMATS:
                frame_data    = images
                input_pix_fmt = "rgba"
                use_alpha     = True
            else:
                rgb           = images[..., :3]
                alpha         = images[..., 3:4]
                frame_data    = (rgb * alpha).clamp(0, 1)
                input_pix_fmt = "rgb24"
                use_alpha     = False
        else:
            use_alpha = (mask is not None) and (format in ALPHA_CAPABLE_FORMATS)
            if use_alpha:
                alpha_ch      = _prepare_alpha(mask, images)
                frame_data    = torch.cat([images, alpha_ch], dim=-1)
                input_pix_fmt = "rgba"
            else:
                if mask is not None:
                    images = _apply_mask(images, mask)
                frame_data    = images
                input_pix_fmt = "rgb24"

        codec, ext = self.FORMAT_MAP.get(format, ("libx264", "mp4"))
        quality_crf = {"high": 18, "medium": 23, "low": 28, "custom": crf}
        final_crf = quality_crf.get(quality, 20)

        unique_name = _generate_unique_filename(filename_prefix)
        filename    = f"{unique_name}.{ext}"

        if save_to_local:
            out_dir = local_save_path.strip()
            os.makedirs(out_dir, exist_ok=True)
        else:
            out_dir = tempfile.gettempdir()
        out_path = os.path.join(out_dir, filename)

        H, W   = images.shape[1], images.shape[2]
        target = _parse_resolution(resolution, custom_width, custom_height)
        if target is None:
            out_w, out_h = W, H
        else:
            out_w, out_h = self._calc_size(W, H, size_mode, target[0], target[1])
        out_w = out_w if out_w % 2 == 0 else out_w + 1
        out_h = out_h if out_h % 2 == 0 else out_h + 1

        ffmpeg = get_cached_ffmpeg()
        args = [ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", input_pix_fmt,
                "-s", f"{W}x{H}", "-r", str(fps), "-i", "pipe:0"]
        audio_path = None

        try:
            if audio is not None:
                audio_path = _write_audio(audio, out_dir)
                if audio_path:
                    args += ["-i", audio_path]
                else:
                    logger.warning("音频处理失败，将生成无音频视频")

            t_w      = target[0] if target else out_w
            t_h      = target[1] if target else out_h
            eff_mode = size_mode if target else "original"
            vf       = self._build_vf(W, H, out_w, out_h, eff_mode, t_w, t_h, use_alpha)

            # GIF
            if format == "gif":
                # 参考 comfyui-videohelpersuite 的 GIF 处理方式：
                # - 不使用 alpha_threshold 强制二值化，保留抖动效果
                # - transparency_color=ffffff 指定透明色为白色
                # - 使用 sierra2_4a 抖动算法获得更平滑的透明边缘
                base_gif = f"fps={min(int(fps), 15)},scale={out_w}:{out_h}:flags=lanczos"
                if use_alpha or input_pix_fmt == "rgba":
                    gif_vf = (
                        f"{base_gif},split[s0][s1];"
                        f"[s0]palettegen=max_colors=255:reserve_transparent=on:"
                        f"transparency_color=ffffff[p];"
                        f"[s1][p]paletteuse=dither=sierra2_4a"
                    )
                else:
                    gif_vf = (
                        f"{base_gif},split[s0][s1];"
                        f"[s0]palettegen=max_colors=128[p];"
                        f"[s1][p]paletteuse=dither=sierra2_4a"
                    )
                if vf:
                    args += ["-vf", vf + "," + gif_vf, "-an"]
                else:
                    args += ["-vf", gif_vf, "-an"]

            # APNG
            elif format == "apng":
                if vf:
                    args += ["-vf", vf]
                pix = "rgba" if use_alpha else "rgb24"
                args += ["-c:v", "apng", "-plays", "0", "-pix_fmt", pix, "-an"]

            # WebP
            elif format == "webp":
                if vf:
                    args += ["-vf", vf]
                if use_alpha:
                    args += ["-c:v", "libwebp_anim", "-pix_fmt", "rgba",
                             "-quality", "85", "-an"]
                else:
                    args += ["-c:v", "libwebp_anim", "-quality", "85", "-an"]

            # ProRes
            elif format == "prores-mov":
                if vf:
                    args += ["-vf", vf]
                if use_alpha:
                    args += ["-c:v", "prores_ks", "-profile:v", "4444",
                             "-pix_fmt", "yuva444p10le"]
                else:
                    args += ["-c:v", "prores_ks", "-profile:v", "3",
                             "-pix_fmt", "yuv422p10le"]
                if audio_path:
                    args += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
                else:
                    args += ["-an"]

            # VP9-WebM
            elif format == "vp9-webm":
                if vf:
                    args += ["-vf", vf]
                if use_alpha:
                    args += ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                             "-auto-alt-ref", "0", "-crf", str(final_crf), "-b:v", "0"]
                else:
                    args += ["-c:v", "libvpx-vp9", "-crf", str(final_crf),
                             "-pix_fmt", "yuv420p", "-b:v", "0"]
                if audio_path:
                    args += ["-c:a", "libopus", "-b:a", "192k", "-shortest"]
                else:
                    args += ["-an"]

            # H.264 / H.265 / AV1
            else:
                if vf:
                    args += ["-vf", vf]
                args += ["-c:v", codec, "-crf", str(final_crf), "-pix_fmt", "yuv420p"]
                if audio_path:
                    args += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
                else:
                    args += ["-an"]

            args.append(out_path)

            proc = subprocess.Popen(args, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
            for frame in frame_data:
                proc.stdin.write(_tensor_to_np_uint8(frame).tobytes())
            proc.stdin.close()
            _, stderr = proc.communicate(timeout=600)
            if proc.returncode != 0:
                raise RuntimeError(
                    f"FFmpeg 错误: {stderr.decode('utf-8', errors='replace')[-300:]}"
                )
        finally:
            _cleanup_temp_file(audio_path)

        eagle_result = ""
        if save_to_eagle:
            val, itype = _parse_folder_input(eagle_folder)
            if val and itype != "local_path":
                folder_id = (
                    val if itype == "eagle_id"
                    else _find_folder_by_path(_get_folders(), val)
                )
                if folder_id:
                    success, msg = _save_to_eagle(
                        out_path, folder_id, unique_name, tags, annotation, star_val
                    )
                    eagle_result = (
                        f" | ✅ Eagle: {folder_id[:8]}..."
                        if success else f" | ❌ Eagle: {msg[:30]}"
                    )

        alpha_tag = " [含Alpha]" if use_alpha else ""
        skip_tag  = f" [抽帧1/{frame_skip+1}]" if frame_skip > 0 else ""
        file_size = os.path.getsize(out_path) / (1024 * 1024)
        info = (f"{filename} | {frame_data.shape[0]}帧{skip_tag} | {out_w}x{out_h}"
                f"{alpha_tag} | {file_size:.1f}MB{eagle_result}")
        return (out_path, info, out_path)

    def _calc_size(self, w, h, mode, target_w, target_h):
        if mode == "original":
            return w, h
        if mode == "fit-max":
            scale = min(1.0, max(target_w, target_h) / max(w, h))
            return int(w * scale), int(h * scale)
        if mode == "fit-min":
            scale = min(1.0, min(target_w, target_h) / min(w, h))
            return int(w * scale), int(h * scale)
        if mode in ("stretch", "crop"):
            return target_w, target_h
        return w, h

    def _build_vf(self, in_w, in_h, out_w, out_h, mode, target_w, target_h, use_alpha=False):
        filters = []
        
        if mode == "crop":
            filters.append(
                f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h}:(iw-{target_w})/2:(ih-{target_h})/2"
            )
        elif out_w != in_w or out_h != in_h:
            filters.append(f"scale={out_w}:{out_h}:flags=lanczos")
        
        # 确保透明通道在滤镜链中不被丢弃
        if use_alpha:
            filters.append("format=rgba")
        
        return ",".join(filters) if filters else ""


# ============================================================================
# 节点2: 视频格式转换
# ============================================================================

class EagleVideoConverter:
    """视频格式转换，支持视频输入或图像序列，可保存到本地路径或 Eagle"""

    FORMATS = [
        "h264-mp4", "h265-mp4", "av1-webm", "vp9-webm",
        "gif", "apng", "webp", "prores-mov",
        "sequence-png", "sequence-jpg", "sequence-webp",
    ]
    CODEC_MAP = {
        "h264-mp4":   ("libx264",    "mp4"),
        "h265-mp4":   ("libx265",    "mp4"),
        "av1-webm":   ("libaom-av1", "webm"),
        "vp9-webm":   ("libvpx-vp9", "webm"),
        "gif":        ("gif",        "gif"),
        "apng":       ("apng",       "apng"),
        "webp":       ("webp",       "webp"),
        "prores-mov": ("prores_ks",  "mov"),
    }
    SIZE_MODES = ["original", "fit-max", "fit-min", "stretch", "crop"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "eagle_folder":    ("STRING", {"default": "", "multiline": False,
                                               "placeholder": "Eagle文件夹路径/ID"}),
                "local_save_path": ("STRING", {"default": "", "multiline": False,
                                               "placeholder": "本地保存路径"}),
                "filename_prefix": ("STRING", {"default": "converted", "multiline": False}),
                "format":          (cls.FORMATS, {"default": "h264-mp4"}),
                "quality":         (["high", "medium", "low"], {"default": "medium"}),
                "size_mode":       (cls.SIZE_MODES, {"default": "original"}),
                "resolution":      (RESOLUTION_PRESETS, {"default": "1080p (1920x1080)"}),
            },
            "optional": {
                "video":         ("STRING",  {"forceInput": True}),
                "images":        ("IMAGE",),
                "fps":           ("FLOAT",   {"default": 24.0, "min": 1.0,
                                              "max": 120.0, "step": 0.5}),
                "frame_limit":   ("INT",     {"default": 0, "min": 0,
                                              "max": 10000, "step": 1}),
                "speed":         ("FLOAT",   {"default": 1.0, "min": 0.25,
                                              "max": 4.0, "step": 0.25}),
                "target_fps":    ("FLOAT",   {"default": 0, "min": 0, "max": 120}),
                "custom_width":  ("INT",     {"default": 1920, "min": 64,
                                              "max": 8192, "step": 2}),
                "custom_height": ("INT",     {"default": 1080, "min": 64,
                                              "max": 8192, "step": 2}),
                "tags":          ("STRING",  {"default": "", "multiline": False}),
                "annotation":    ("STRING",  {"default": "", "multiline": True}),
                "star":          (STAR_OPTIONS, {"default": "0 未评分"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("filepath", "info", "video_path")
    OUTPUT_NODE = True
    FUNCTION = "convert"
    CATEGORY = "🦅 Eagle/视频处理"

    def convert(self, eagle_folder, local_save_path, filename_prefix, format, quality,
                size_mode, resolution="1080p (1920x1080)",
                video=None, images=None, fps=24.0, frame_limit=0, speed=1.0,
                target_fps=0, custom_width=1920, custom_height=1080,
                tags="", annotation="", star="0 未评分"):

        _check_ffmpeg()
        star_val = _parse_star(star)
        target   = _parse_resolution(resolution, custom_width, custom_height)

        save_to_eagle = bool(eagle_folder.strip())
        save_to_local = bool(local_save_path.strip())
        if not save_to_eagle and not save_to_local:
            return ("", "❌ 请至少指定 Eagle 文件夹或本地保存路径", "")

        input_path     = None
        temp_video_path = None

        try:
            if video is not None:
                input_path = _resolve_video_path(video)
                if not input_path:
                    return ("", "❌ 无法解析视频路径", "")
                if frame_limit > 0:
                    extracted_images = _extract_frames(input_path, fps, frame_limit)
                    if extracted_images is None:
                        return ("", "❌ 帧提取失败", "")
                    temp_video_path = self._create_temp_video(extracted_images, fps)
                    if not temp_video_path:
                        return ("", "❌ 临时视频创建失败", "")
                    input_path = temp_video_path
            elif images is not None:
                final_images = images
                if frame_limit > 0:
                    total = len(images)
                    if frame_limit < total:
                        indices = np.linspace(0, total - 1, frame_limit, dtype=int)
                        final_images = images[indices]
                temp_video_path = self._create_temp_video(final_images, fps)
                input_path = temp_video_path
            if not input_path:
                return ("", "❌ 无法准备输入视频", "")

            # 图像序列导出
            if format.startswith("sequence-"):
                seq_w = target[0] if target else 0
                seq_h = target[1] if target else 0
                return self._export_sequence(
                    input_path, format, eagle_folder, local_save_path,
                    filename_prefix, size_mode, seq_w, seq_h, tags, annotation, star_val
                )

            codec, ext = self.CODEC_MAP.get(format, ("libx264", "mp4"))
            crf = {"high": "18", "medium": "23", "low": "28"}.get(quality, "23")

            unique_name = _generate_unique_filename(filename_prefix)
            filename    = f"{unique_name}.{ext}"

            if save_to_local:
                out_dir = local_save_path.strip()
                os.makedirs(out_dir, exist_ok=True)
            else:
                out_dir = tempfile.gettempdir()
            out_path = os.path.join(out_dir, filename)

            ffmpeg = get_cached_ffmpeg()
            args   = [ffmpeg, "-y", "-i", input_path]
            vf_parts = []

            if speed != 1.0:
                vf_parts.append(f"setpts={1.0/speed:.4f}*PTS")

            if target is not None:
                w, h = target
                if size_mode == "fit-max":
                    vf_parts.append(
                        f"scale='min({w},iw)':'min({h},ih)'"
                        f":force_original_aspect_ratio=decrease"
                    )
                elif size_mode == "fit-min":
                    vf_parts.append(
                        f"scale='if(gt(iw,ih),{w},-1)':'if(gt(iw,ih),-1,{h})'"
                        f":force_original_aspect_ratio=decrease"
                    )
                elif size_mode == "stretch":
                    vf_parts.append(f"scale={w}:{h}")
                elif size_mode == "crop":
                    vf_parts.append(
                        f"scale={w}:{h}:force_original_aspect_ratio=increase,"
                        f"crop={w}:{h}:(iw-{w})/2:(ih-{h})/2"
                    )

            if target_fps > 0:
                args += ["-r", str(target_fps)]

            # GIF
            if codec == "gif":
                gif_vf = (
                    "fps=15,scale=480:-1:flags=lanczos,"
                    "split[s0][s1];"
                    "[s0]palettegen=max_colors=255:reserve_transparent=on:"
                    "transparency_color=ffffff[p];"
                    "[s1][p]paletteuse=dither=sierra2_4a"
                )
                combined = ",".join(vf_parts) + "," + gif_vf if vf_parts else gif_vf
                args += ["-vf", combined, "-an"]

            # APNG
            elif codec == "apng":
                if vf_parts:
                    args += ["-vf", ",".join(vf_parts)]
                args += ["-c:v", "apng", "-plays", "0", "-an"]

            # WebP
            elif codec == "webp":
                if vf_parts:
                    args += ["-vf", ",".join(vf_parts)]
                args += ["-c:v", "libwebp_anim", "-quality", "85", "-an"]

            # ProRes
            elif format == "prores-mov":
                if vf_parts:
                    args += ["-vf", ",".join(vf_parts)]
                args += ["-c:v", "prores_ks", "-profile:v", "3",
                         "-pix_fmt", "yuv422p10le", "-an"]

            # VP9-WebM
            elif format == "vp9-webm":
                if vf_parts:
                    args += ["-vf", ",".join(vf_parts)]
                args += ["-c:v", "libvpx-vp9", "-crf", crf, "-b:v", "0",
                         "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "128k"]

            # H.264 / H.265 / AV1
            else:
                if vf_parts:
                    args += ["-vf", ",".join(vf_parts)]
                args += ["-c:v", codec, "-crf", crf, "-pix_fmt", "yuv420p",
                         "-c:a", "aac", "-b:a", "128k"]

            args.append(out_path)
            result = subprocess.run(args, capture_output=True, timeout=600)

            if result.returncode != 0:
                return (
                    "",
                    f"❌ 转换失败: {result.stderr.decode('utf-8', errors='replace')[-300:]}",
                    ""
                )

            eagle_result = ""
            if save_to_eagle:
                val, itype = _parse_folder_input(eagle_folder)
                if val and itype != "local_path":
                    folder_id = (
                        val if itype == "eagle_id"
                        else _find_folder_by_path(_get_folders(), val)
                    )
                    if folder_id:
                        success, msg = _save_to_eagle(
                            out_path, folder_id, unique_name, tags, annotation, star_val
                        )
                        eagle_result = (
                            f" | ✅ Eagle: {folder_id[:8]}..."
                            if success else f" | ❌ Eagle: {msg[:30]}"
                        )

            file_size = os.path.getsize(out_path) / (1024 * 1024)
            info = (
                f"{filename} | {speed if speed != 1.0 else '原'}速"
                f" | {file_size:.1f}MB{eagle_result}"
            )
            return (out_path, info, out_path)

        finally:
            _cleanup_temp_file(temp_video_path)

    def _export_sequence(self, input_path, format, eagle_folder, local_save_path,
                         filename_prefix, size_mode, width, height,
                         tags, annotation, star_val):
        """导出图像序列"""
        ext        = format.split("-")[-1]
        unique_name = _generate_unique_filename(filename_prefix)
        base_dir   = local_save_path.strip() if local_save_path.strip() else folder_paths.get_output_directory()
        out_dir    = os.path.join(base_dir, unique_name)
        os.makedirs(out_dir, exist_ok=True)

        ffmpeg = get_cached_ffmpeg()
        args   = [ffmpeg, "-y", "-i", input_path]
        vf_parts = []

        if width > 0 and height > 0:
            if size_mode == "fit-max":
                vf_parts.append(
                    f"scale='min({width},iw)':'min({height},ih)'"
                    f":force_original_aspect_ratio=decrease"
                )
            elif size_mode == "fit-min":
                vf_parts.append(
                    f"scale='if(gt(iw,ih),{width},-1)':'if(gt(iw,ih),-1,{height})'"
                    f":force_original_aspect_ratio=decrease"
                )
            elif size_mode == "stretch":
                vf_parts.append(f"scale={width}:{height}")
            elif size_mode == "crop":
                vf_parts.append(
                    f"scale={width}:{height}:force_original_aspect_ratio=increase,"
                    f"crop={width}:{height}:(iw-{width})/2:(ih-{height})/2"
                )

        if vf_parts:
            args += ["-vf", ",".join(vf_parts)]

        args.append(os.path.join(out_dir, f"{filename_prefix}_%05d.{ext}"))
        result = subprocess.run(args, capture_output=True, timeout=600)

        if result.returncode != 0:
            return (
                "",
                f"❌ 序列导出失败: {result.stderr.decode('utf-8', errors='replace')[-300:]}",
                ""
            )

        eagle_result = ""
        first_frame  = os.path.join(out_dir, f"{filename_prefix}_00001.{ext}")
        if eagle_folder.strip() and os.path.exists(first_frame):
            val, itype = _parse_folder_input(eagle_folder)
            if val and itype != "local_path":
                folder_id = (
                    val if itype == "eagle_id"
                    else _find_folder_by_path(_get_folders(), val)
                )
                if folder_id:
                    success, msg = _save_to_eagle(
                        first_frame, folder_id, f"{unique_name}_preview",
                        tags, annotation, star_val
                    )
                    eagle_result = (
                        " | ✅ Eagle预览已生成"
                        if success else f" | ❌ Eagle: {msg[:20]}"
                    )

        return (
            out_dir,
            f"🖼️ 序列已导出到: {os.path.basename(out_dir)}{eagle_result}",
            first_frame if os.path.exists(first_frame) else ""
        )

    def _create_temp_video(self, images, fps):
        """创建临时视频"""
        try:
            if images is None or len(images) == 0:
                return None
            if not isinstance(images, torch.Tensor):
                images = torch.as_tensor(images)
            if images.ndim == 3:
                images = images.unsqueeze(0)
            if images.ndim != 4 or images.shape[0] == 0:
                return None
            temp_path = os.path.join(
                tempfile.gettempdir(), f"_eagle_temp_{uuid.uuid4().hex[:8]}.mp4"
            )
            if images.shape[-1] == 4:
                images = (images[..., :3] * images[..., 3:4]).clamp(0, 1)

            H, W  = images.shape[1], images.shape[2]
            ffmpeg = get_cached_ffmpeg()
            args  = [ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                     "-s", f"{W}x{H}", "-r", str(fps), "-i", "pipe:0",
                     "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", temp_path]
            proc  = subprocess.Popen(args, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
            for frame in images:
                proc.stdin.write(_tensor_to_np_uint8(frame).tobytes())
            proc.stdin.close()
            _, stderr = proc.communicate(timeout=600)
            if proc.returncode != 0:
                logger.error(
                    f"临时视频创建失败: {stderr.decode('utf-8', errors='replace')[-200:]}"
                )
                return None
            return temp_path if os.path.exists(temp_path) else None
        except Exception as e:
            logger.error(f"临时视频创建异常: {e}")
            return None


# 导出映射
NODE_CLASS_MAPPINGS = {
    "EagleImagesToVideo":  EagleImagesToVideo,
    "EagleVideoConverter": EagleVideoConverter,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "EagleImagesToVideo":  "🦅 图像序列 → 视频",
    "EagleVideoConverter": "🦅 视频格式转换",
}
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
