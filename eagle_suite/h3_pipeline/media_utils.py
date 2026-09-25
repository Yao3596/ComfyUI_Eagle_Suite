# -*- coding: utf-8 -*-
"""
H3 循环链路的媒体工具函数：帧抽取、视频编码、裁剪、拼接、接缝分析。

复用 Eagle Suite 既有能力：
- ffmpeg 路径：utils.get_cached_ffmpeg
- 路径安全：utils.is_safe_path
- 目录：utils.ensure_dir

VIDEO 类型使用 ComfyUI 原生对象；内部仅在调用 ffmpeg 时解析为文件路径。
"""

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from fractions import Fraction
from pathlib import Path

import numpy as np
import torch
from PIL import Image

try:
    from comfy_api.input_impl import VideoFromFile
except Exception:  # 单元测试或旧版 ComfyUI 的兼容回退
    VideoFromFile = None

from ..utils import ensure_dir, get_cached_ffmpeg, is_safe_path
from ..logger import logger


def _resolve_video_path(video):
    """把任意视频类型解析为文件路径字符串。"""
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
            if isinstance(source, (str, Path)) and os.path.isfile(source):
                return str(source)
    except Exception:
        pass
    if isinstance(video, dict):
        for key in ['video', 'path', 'file', 'filename', 'video_path', 'source']:
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


def native_video(path):
    """把持久化文件包装为 ComfyUI 原生 VIDEO；无效路径返回 None。"""
    if not path or not os.path.isfile(path):
        return None
    if VideoFromFile is None:
        return str(path)
    try:
        return VideoFromFile(os.path.abspath(path))
    except Exception as error:
        logger.warning(f"[H3Pipeline] 创建原生 VIDEO 失败 ({path}): {error}")
        return None


def _check_ffmpeg():
    ffmpeg = get_cached_ffmpeg()
    if not ffmpeg or not os.path.isfile(ffmpeg):
        raise RuntimeError(
            "[H3Chain] 未找到 ffmpeg。请安装 ffmpeg 或设置 EAGLE_FORCE_FFMPEG_PATH 环境变量。"
        )
    return ffmpeg


def _cv2_video_info(video_path):
    """用 OpenCV 取视频基础信息，作为 ffprobe 不可用的回退。"""
    try:
        import cv2
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            return {}
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        return {
            "width": width,
            "height": height,
            "r_frame_rate": f"{int(fps*1000)}/1000" if fps else "24/1",
            "nb_frames": frames,
        }
    except Exception as e:
        logger.debug(f"[H3Chain] cv2 读取失败: {e}")
        return {}


def _ffprobe_streams(video_path):
    """用 ffprobe 取视频流信息，失败返回 {}。"""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return _cv2_video_info(video_path)
    try:
        cmd = [
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate,duration,nb_frames",
            "-of", "json", str(video_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        data = json.loads(result.stdout)
        return data.get("streams", [{}])[0]
    except Exception as e:
        logger.debug(f"[H3Chain] ffprobe 读取失败，回退 cv2: {e}")
        return _cv2_video_info(video_path)


def _probe_frame_count(video_path):
    """估算视频总帧数。"""
    stream = _ffprobe_streams(video_path)
    nb = stream.get("nb_frames")
    if nb and str(nb).isdigit():
        return int(nb)
    duration = stream.get("duration")
    fps_str = stream.get("r_frame_rate", "24/1")
    if duration:
        try:
            dur = float(duration)
            if "/" in fps_str:
                num, den = fps_str.split("/")
                fps = int(num) / int(den)
            else:
                fps = float(fps_str)
            return int(round(dur * fps))
        except Exception:
            pass
    return 0


def probe_decoded_frame_count(video_path):
    """Count decodable video frames, not just container duration or advertised frames."""
    path = _resolve_video_path(video_path)
    if not path or os.path.getsize(path) == 0:
        return 0
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        ffmpeg = get_cached_ffmpeg()
        if ffmpeg:
            sibling = Path(ffmpeg).with_name("ffprobe" + Path(ffmpeg).suffix)
            if sibling.is_file():
                ffprobe = str(sibling)
    if ffprobe:
        try:
            result = subprocess.run(
                [ffprobe, "-v", "error", "-select_streams", "v:0", "-count_frames",
                 "-show_entries", "stream=nb_read_frames", "-of", "json", path],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0:
                streams = json.loads(result.stdout).get("streams") or []
                count = (streams[0] if streams else {}).get("nb_read_frames")
                if count and str(count).isdigit():
                    return int(count)
        except Exception as error:
            logger.debug(f"[H3Chain] ffprobe 实际计帧失败: {error}")
    try:
        import cv2
        capture = cv2.VideoCapture(path)
        if not capture.isOpened():
            return 0
        count = 0
        while True:
            readable, _frame = capture.read()
            if not readable:
                break
            count += 1
        capture.release()
        return count
    except Exception as error:
        logger.debug(f"[H3Chain] 视频解码计帧失败: {error}")
        return 0


def extract_frames(video_path, fps=None, last=None, limit=None):
    """
    从视频抽取帧。
    返回: np.ndarray uint8，形状 (N, H, W, 3)。
    """
    path = _resolve_video_path(video_path)
    if not path:
        raise ValueError(f"[H3Chain] 无法解析视频路径: {video_path}")
    ffmpeg = _check_ffmpeg()
    stream = _ffprobe_streams(path)
    width = int(stream.get("width", 0))
    height = int(stream.get("height", 0))
    if not width or not height:
        raise RuntimeError(f"[H3Chain] 无法获取视频尺寸: {path}")

    vf_filters = []
    if fps and fps > 0:
        vf_filters.append(f"fps={fps}")

    # 若只需要最后 N 帧且知道总帧数，用 select 减少解码量
    total = 0
    if last and last > 0:
        total = _probe_frame_count(path)
        if total and total > last:
            vf_filters.append(f"select=gte(n\\,{total-last})")

    cmd = [ffmpeg, "-y", "-i", path]
    if vf_filters:
        cmd += ["-vf", ",".join(vf_filters)]
    cmd += ["-an", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]

    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        err = result.stderr.decode("utf-8", errors="ignore")[:300]
        raise RuntimeError(f"[H3Chain] ffmpeg 抽帧失败: {err}")

    buf = result.stdout
    pixel_count = width * height * 3
    if len(buf) % pixel_count != 0:
        logger.warning(
            f"[H3Chain] 抽帧字节数 {len(buf)} 不是 {pixel_count} 整数倍，截断处理。"
        )
    n = len(buf) // pixel_count
    frames = np.frombuffer(buf, dtype=np.uint8)[:n * pixel_count].reshape(
        (n, height, width, 3)
    ).copy()

    if last and last > 0 and len(frames) > last:
        frames = frames[-last:]
    if limit and limit > 0 and len(frames) > limit:
        frames = frames[:limit]
    return frames


def frames_to_video(frames, out_path, fps, codec="libx264", crf=18, pixel_format="yuv420p"):
    """
    把 numpy 帧序列编码成视频。
    frames: np.ndarray uint8 (N, H, W, 3)
    """
    if not isinstance(frames, np.ndarray):
        frames = np.array(frames)
    if frames.size == 0:
        raise ValueError("[H3Chain] 帧序列为空")
    if frames.max() <= 1.0:
        frames = (frames * 255).clip(0, 255).astype(np.uint8)
    else:
        frames = frames.astype(np.uint8)

    ffmpeg = _check_ffmpeg()
    height, width = frames.shape[1:3]
    out_path = Path(out_path)
    ensure_dir(str(out_path.parent))

    cmd = [
        ffmpeg, "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{width}x{height}",
        "-pix_fmt", "rgb24",
        "-r", str(fps),
        "-i", "-",
        "-c:v", codec,
        "-crf", str(crf),
        "-pix_fmt", pixel_format,
        str(out_path),
    ]

    stderr = b""
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for frame in frames:
            process.stdin.write(frame.tobytes())
        _, stderr = process.communicate(timeout=600)
    except Exception:
        process.kill()
        process.wait()
        raise

    if process.returncode != 0:
        raise RuntimeError(
            f"[H3Chain] ffmpeg 编码失败: {stderr.decode('utf-8', errors='ignore')[:400]}"
        )
    return str(out_path)


def trim_video(in_path, out_path, start, end, unit="sec", fps=24):
    """按时间或帧裁剪视频。"""
    ffmpeg = _check_ffmpeg()
    ss = f"{int(start) / float(fps):.6f}" if unit == "frame" else str(start)
    to = f"{int(end) / float(fps):.6f}" if unit == "frame" else str(end)
    cmd = [ffmpeg, "-y", "-i", str(in_path), "-ss", ss, "-to", to, "-c", "copy", str(out_path)]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"[H3Chain] 裁剪失败: {result.stderr.decode('utf-8', errors='ignore')[:300]}"
        )
    return str(out_path)


def _concat_probe_path(ffmpeg):
    """Prefer ffprobe, including one bundled next to the selected ffmpeg."""
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        return ffprobe
    sibling = Path(ffmpeg).with_name("ffprobe" + Path(ffmpeg).suffix)
    return str(sibling) if sibling.is_file() else None


def _parse_rate(value):
    try:
        rate = float(Fraction(str(value)))
        return rate if math.isfinite(rate) and rate > 0 else None
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _probe_concat_streams(path, ffmpeg, ffprobe):
    """Probe every media stream; reject unknown layouts instead of copying blindly."""
    if ffprobe:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries",
             "stream=codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate,"
             "r_frame_rate,sample_rate,channels,channel_layout", "-of", "json", path],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"[H3Chain] 无法探测拼接输入 {path}: {result.stderr[:300]}")
        try:
            return json.loads(result.stdout).get("streams") or []
        except (ValueError, TypeError) as error:
            raise RuntimeError(f"[H3Chain] 无法解析拼接输入 {path} 的流信息") from error

    # Some ComfyUI distributions ship ffmpeg without ffprobe. The input banner
    # still describes streams; incomplete banners are rejected by preflight.
    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", path],
        capture_output=True, text=True, errors="replace", timeout=30,
    )
    streams = []
    for line in result.stderr.splitlines():
        if not re.match(r"\s*Stream #0:\d+", line):
            continue
        if "Video: " in line:
            details = line.split("Video: ", 1)[1]
            fields = [field.strip() for field in details.split(",")]
            # Avoid matching codec tags such as "0x31637661" as a dimension.
            size = re.search(r"(?<!\w)([1-9]\d{1,4})x([1-9]\d{1,4})(?!\w)", details)
            rate = re.search(r"\b(\d+(?:\.\d+)?(?:/\d+)?) fps\b", details)
            streams.append({
                "codec_type": "video", "codec_name": fields[0].split()[0],
                "profile": re.search(r"\(([^)]+)\)", fields[0]).group(1)
                           if re.search(r"\(([^)]+)\)", fields[0]) else None,
                "pix_fmt": fields[1].split("(")[0].strip() if len(fields) > 1 else None,
                "width": int(size.group(1)) if size else None,
                "height": int(size.group(2)) if size else None,
                "avg_frame_rate": rate.group(1) if rate else None,
            })
        elif "Audio: " in line:
            details = line.split("Audio: ", 1)[1]
            fields = [field.strip() for field in details.split(",")]
            sample_rate = re.search(r"\b(\d+) Hz\b", details)
            layout = next((name for name in ("mono", "stereo", "5.1", "7.1")
                           if re.search(rf"\b{re.escape(name)}\b", details)), None)
            channels = {"mono": 1, "stereo": 2, "5.1": 6, "7.1": 8}.get(layout)
            streams.append({
                "codec_type": "audio", "codec_name": fields[0].split()[0],
                "profile": re.search(r"\(([^)]+)\)", fields[0]).group(1)
                           if re.search(r"\(([^)]+)\)", fields[0]) else None,
                "sample_rate": int(sample_rate.group(1)) if sample_rate else None,
                "channels": channels, "channel_layout": layout,
            })
        else:
            streams.append({"codec_type": "other"})
    return streams


def _concat_stream_signature(path, ffmpeg, ffprobe):
    streams = _probe_concat_streams(path, ffmpeg, ffprobe)
    video = [stream for stream in streams if stream.get("codec_type") == "video"]
    audio = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if len(video) != 1 or len(audio) > 1 or len(video) + len(audio) != len(streams):
        raise ValueError(
            f"[H3Chain] 无法安全无损拼接 {path}: 仅支持单视频流和最多单音轨"
        )
    v = video[0]
    rate = _parse_rate(v.get("avg_frame_rate")) or _parse_rate(v.get("r_frame_rate"))
    v_signature = (v.get("codec_name"), v.get("profile"), v.get("pix_fmt"),
                   v.get("width"), v.get("height"))
    if not rate or any(value in (None, "", 0) for value in
                       (v_signature[0], *v_signature[2:])):
        raise ValueError(f"[H3Chain] 无法确认 {path} 的视频编码、尺寸或 fps，拒绝无损拼接")
    a_signature = None
    if audio:
        a = audio[0]
        a_signature = (a.get("codec_name"), a.get("profile"),
                       a.get("sample_rate"), a.get("channels"),
                       a.get("channel_layout"))
        if any(value in (None, "", 0) for value in a_signature[:1] + a_signature[2:4]):
            raise ValueError(f"[H3Chain] 无法确认 {path} 的音轨编码，拒绝无损拼接")
    return v_signature, rate, a_signature


def concat_videos(clip_paths, out_path, fps=None):
    """Preflight media streams, then use ffmpeg concat demuxer for lossless copy."""
    if not clip_paths or any(not p or not os.path.isfile(p) for p in clip_paths):
        raise ValueError("[H3Chain] 拼接输入包含缺失视频")
    requested_fps = _parse_rate(fps) if fps is not None else None
    if fps is not None and requested_fps is None:
        raise ValueError("[H3Chain] 拼接 fps 必须是正数")
    ffmpeg = _check_ffmpeg()
    ffprobe = _concat_probe_path(ffmpeg)
    abs_paths = [str(Path(p).resolve()) for p in clip_paths]
    out_path = Path(out_path)
    if os.path.normcase(str(out_path.resolve())) in map(os.path.normcase, abs_paths):
        raise ValueError("[H3Chain] 拼接输出不能覆盖输入视频")
    first_signature = None
    for index, path in enumerate(abs_paths, start=1):
        signature = _concat_stream_signature(path, ffmpeg, ffprobe)
        if requested_fps is not None and not math.isclose(
            signature[1], requested_fps, rel_tol=0.0005, abs_tol=0.001
        ):
            raise ValueError(
                f"[H3Chain] 第 {index} 段 fps={signature[1]:g} 与请求的 fps={requested_fps:g} 不符；"
                "无损拼接不能改变帧率"
            )
        if first_signature is not None:
            first_video, first_rate, first_audio = first_signature
            video, rate, audio = signature
            if video != first_video or not math.isclose(
                rate, first_rate, rel_tol=0.0005, abs_tol=0.001
            ) or audio != first_audio:
                raise ValueError(
                    f"[H3Chain] 第 {index} 段与第 1 段的视频编码/尺寸/fps 或音轨结构/编码不兼容；"
                    "拒绝无损拼接以免输出缺帧或丢音"
                )
        else:
            first_signature = signature

    ensure_dir(str(out_path.parent))
    list_path = None
    staged_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", prefix=out_path.stem + "_",
            suffix=".concat.txt", dir=out_path.parent, delete=False,
        ) as list_file:
            list_path = Path(list_file.name)
            for path in abs_paths:
                list_file.write("file '" + path.replace("'", "'\\''") + "'\n")
        with tempfile.NamedTemporaryFile(
            prefix=out_path.stem + "_", suffix=out_path.suffix,
            dir=out_path.parent, delete=False,
        ) as staged_file:
            staged_path = Path(staged_file.name)
        cmd = [
            ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_path),
            "-map", "0:v:0",
        ]
        if first_signature[2] is not None:
            cmd += ["-map", "0:a:0"]
        cmd += ["-c", "copy", str(staged_path)]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0 or staged_path.stat().st_size == 0:
            raise RuntimeError(
                f"[H3Chain] 拼接失败: {result.stderr.decode('utf-8', errors='ignore')[:400]}"
            )
        os.replace(staged_path, out_path)
        staged_path = None
    finally:
        if list_path:
            list_path.unlink(missing_ok=True)
        if staged_path:
            staged_path.unlink(missing_ok=True)
    return str(out_path)


def load_image_tensor(path):
    """加载图片为 torch float32 [1,H,W,3]。"""
    img = Image.open(path).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def load_video_tensor(path, trim_start=0, trim_end=0, target_fps=None):
    """加载视频为 torch float32 [N,H,W,3]。"""
    frames = extract_frames(path, fps=target_fps)
    if trim_start or trim_end:
        fps_eff = target_fps or 24
        start = int(trim_start * fps_eff) if trim_start else 0
        end = int(trim_end * fps_eff) if trim_end else 0
        if start:
            frames = frames[start:]
        if end:
            frames = frames[:end]
    arr = frames.astype(np.float32) / 255.0
    return torch.from_numpy(arr)


def _resize_short_side(frames, target_size):
    """把帧序列的短边等比缩放到 target_size，保持另一边为 32 倍数。"""
    if not target_size:
        return frames
    h, w = frames.shape[1:3]
    if h < w:
        scale = target_size / h
        new_h = target_size
        new_w = max(32, int(round(w * scale / 32)) * 32)
    else:
        scale = target_size / w
        new_w = target_size
        new_h = max(32, int(round(h * scale / 32)) * 32)
    if new_h == h and new_w == w:
        return frames
    from PIL import Image
    resized = []
    for frame in frames:
        img = Image.fromarray(frame)
        resized.append(np.array(img.resize((new_w, new_h), Image.Resampling.LANCZOS)))
    return np.stack(resized, axis=0)


def seam_analysis(prev_path, cur_path, blend_frames, downscale=256):
    """
    计算两段视频接缝处的差异。
    返回: (preview_np uint8, report_str, recommended_offset_frames:int)
    preview 为左右并排的 RGB 图 (H, W*2, 3)。
    """
    if not blend_frames or blend_frames <= 0:
        blend_frames = 1
    prev = extract_frames(prev_path, last=blend_frames)
    cur = extract_frames(cur_path, limit=blend_frames)
    if prev.size == 0 or cur.size == 0:
        raise ValueError("[H3Chain] 接缝分析需要两段有效视频")

    # 为加速先等比缩小
    if downscale:
        prev = _resize_short_side(prev, downscale)
        cur = _resize_short_side(cur, downscale)

    prev_last = prev[-1].astype(np.float32)
    cur_first = cur[0].astype(np.float32)

    diff = np.abs(prev_last - cur_first)
    mse = float(np.mean(diff ** 2))
    mean_diff = float(np.mean(diff))

    # 推荐偏移：简单取 blend_frames // 2
    recommended_offset = max(1, blend_frames // 2)

    # 生成并排预览（原尺寸，不缩放）
    h, w = prev[-1].shape[:2]
    preview = np.zeros((h, w * 2, 3), dtype=np.uint8)
    preview[:, :w] = prev[-1]
    preview[:, w:] = cur[0]

    report = (
        f"接缝分析 ({blend_frames} 帧 blend):\n"
        f"  平均绝对差: {mean_diff:.2f}/255\n"
        f"  均方误差: {mse:.2f}\n"
        f"  推荐 overlap 帧数: {recommended_offset}\n"
        f"  诊断: {'差异小，可拼接' if mean_diff < 30 else '差异中等，建议检查' if mean_diff < 60 else '差异大，可能出现跳切'}"
    )
    return preview, report, recommended_offset


def extract_audio(video_path, out_path, start=0.0, duration=0.0, sample_rate=44100):
    """从视频中提取一段音频为 WAV。"""
    ffmpeg = _check_ffmpeg()
    cmd = [ffmpeg, "-y", "-i", str(video_path)]
    if start > 0:
        cmd += ["-ss", str(start)]
    if duration > 0:
        cmd += ["-t", str(duration)]
    cmd += ["-ar", str(sample_rate), "-ac", "2", "-vn", str(out_path)]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"[H3Chain] 提取音频失败: {result.stderr.decode('utf-8', errors='ignore')[:300]}"
        )
    return str(out_path)


def merge_audio_video(video_path, audio_path, out_path, audio_codec="aac", audio_bitrate="192k"):
    """把音轨合并到视频。"""
    ffmpeg = _check_ffmpeg()
    cmd = [
        ffmpeg, "-y", "-i", str(video_path), "-i", str(audio_path),
        "-c:v", "copy", "-c:a", audio_codec, "-b:a", audio_bitrate,
        "-shortest", str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"[H3Chain] 合并音视频失败: {result.stderr.decode('utf-8', errors='ignore')[:400]}"
        )
    return str(out_path)


def safe_output_path(root, *parts, create_dirs=True):
    """在 root 下生成安全子路径，并确保仍在 root 内。"""
    path = Path(root)
    for part in parts:
        path = path / part
    if create_dirs:
        ensure_dir(str(path.parent))
    # 校验：path 的 realpath 必须在 root 的 realpath 下
    real_root = Path(root).resolve()
    real_path = path.resolve()
    # resolve 可能失败（不存在的父目录），所以用 parents 判断
    if real_root not in [real_path, *real_path.parents]:
        raise ValueError(f"[H3Chain] 非法输出路径: {path} 越界 {root}")
    return str(path)


__all__ = [
    "_resolve_video_path",
    "native_video",
    "extract_frames",
    "frames_to_video",
    "trim_video",
    "concat_videos",
    "load_image_tensor",
    "load_video_tensor",
    "seam_analysis",
    "extract_audio",
    "merge_audio_video",
    "safe_output_path",
]
