# -*- coding: utf-8 -*-
"""
Eagle 视频处理节点套件
- 批量视频加载（支持预览、数量控制、格式分类）
- 视频帧提取
- 视频信息分析
"""

import os
import glob
import logging
import torch
import numpy as np
from PIL import Image
import folder_paths

logger = logging.getLogger(__name__)


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
    except Exception as e:
        logger.warning(f"视频路径解析失败: {e}")
    try:
        path = str(video).strip()
        if os.path.isfile(path):
            return path
    except Exception:
        pass
    return None


class EagleBatchVideoLoader:
    """
    🦅 批量视频加载器
    支持：视频预览、加载数量控制、格式分类/统一加载、递归搜索
    start_index + seed 控制，避免重复加载同一视频
    """

    SUPPORTED_FORMATS = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.m2ts']
    FORMAT_CATEGORIES = {
        "全部格式": ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.m2ts'],
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
                    "default": "",
                    "multiline": False,
                    "placeholder": "视频文件夹路径，留空使用默认输入目录"
                }),
                "load_mode":    (["限制数量", "加载全部", "按格式分类"], {"default": "限制数量"}),
                "max_load":     ("INT", {"default": 1, "min": 1, "max": 1000, "step": 1,
                                         "tooltip": "最大加载视频数量"}),
                "start_index":  ("INT", {"default": 0, "min": 0, "max": 99999, "step": 1,
                                         "tooltip": "从第几个视频开始加载（0=第一个）"}),
                "seed":         ("INT", {"default": -1, "min": -1, "max": 2147483647, "step": 1,
                                         "tooltip": "随机种子，-1=固定start_index，其他=随机打乱后从start_index开始"}),
                "format_filter":(["全部格式", "常用格式", "网络格式", "高清格式", "仅MP4", "仅MOV"],
                                  {"default": "全部格式"}),
                "frame_skip":   ("INT", {"default": 0, "min": 0, "max": 100, "step": 1,
                                         "tooltip": "每隔N帧加载一帧，0=不跳过"}),
                "max_frames_per_video": ("INT", {"default": 0, "min": 0, "max": 10000, "step": 1,
                                                  "tooltip": "每个视频最大加载帧数，0=无限制"}),
                "resize_width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "resize_height":("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
            },
            "optional": {
                "recursive":          ("BOOLEAN", {"default": False, "tooltip": "是否递归子文件夹"}),
                "sort_by":            (["文件名", "修改时间", "大小", "时长"], {"default": "文件名"}),
                "preview_first_frame":("BOOLEAN", {"default": True, "tooltip": "是否生成预览图"}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT", "STRING", "IMAGE", "STRING")
    RETURN_NAMES = ("frames", "video_info", "total_frames", "video_list", "preview", "video_paths")
    OUTPUT_IS_LIST = (True, False, False, False, False, True)
    FUNCTION = "load_videos"
    CATEGORY = "🦅 Eagle/视频处理"

    def load_videos(self, video_folder, load_mode, max_load, format_filter,
                    frame_skip, max_frames_per_video, resize_width, resize_height,
                    start_index, seed, recursive=False,
                    sort_by="文件名", preview_first_frame=True):

        if not video_folder:
            video_folder = folder_paths.get_input_directory()
        if not os.path.exists(video_folder):
            empty = self._empty_frame(resize_width, resize_height)
            return ([empty], "❌ 未找到视频文件夹", 0, "", empty, [""])

        formats_to_search = self.FORMAT_CATEGORIES.get(format_filter, self.SUPPORTED_FORMATS)
        video_files = []
        for ext in formats_to_search:
            for pat in [f"*{ext}", f"*{ext.upper()}"]:
                if recursive:
                    video_files.extend(glob.glob(os.path.join(video_folder, "**", pat), recursive=True))
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
            return ([empty], "❌ 未找到匹配的视频文件", 0, "", empty, [""])

        video_files = self._sort_videos(video_files, sort_by)

        if seed >= 0:
            import random
            rng = random.Random(seed)
            rng.shuffle(video_files)

        total = len(video_files)
        if load_mode in ["限制数量", "按格式分类"]:
            effective_start = start_index % total if total > 0 else 0
            end = effective_start + max_load
            indices = list(range(effective_start, min(end, total)))
            if end > total:
                indices += list(range(0, end - total))
            video_files = [video_files[i] for i in indices]
        else:
            if total > 0:
                effective_start = start_index % total
                video_files = video_files[effective_start:] + video_files[:effective_start]

        all_frames, total_frame_count, video_details, preview_frames = [], 0, [], []

        for idx, vpath in enumerate(video_files):
            try:
                frames, info, preview = self._process_video(
                    vpath, frame_skip, max_frames_per_video,
                    resize_width, resize_height, preview_first_frame and idx == 0
                )
                all_frames.extend(frames)
                total_frame_count += len(frames)
                video_details.append(info)
                if preview is not None:
                    preview_frames.append(preview)
            except Exception as e:
                video_details.append(f"❌ {os.path.basename(vpath)}: {str(e)[:50]}")

        if not all_frames:
            empty = self._empty_frame(resize_width, resize_height)
            return ([empty], "❌ 无法加载任何视频帧", 0, "", empty, [""])

        info_str  = f"📹 共加载 {len(video_files)} 个视频, {total_frame_count} 帧\n"
        info_str += f"🔍 格式筛选: {format_filter} | 模式: {load_mode}\n"
        info_str += "\n".join(video_details)
        video_list_str = "\n".join([f"{i+1}. {os.path.basename(v)}" for i, v in enumerate(video_files)])
        preview = (self._create_preview(preview_frames, resize_width, resize_height)
                   if preview_frames else self._empty_frame(resize_width, resize_height))

        return (all_frames, info_str, total_frame_count, video_list_str, preview, video_files)

    def _sort_videos(self, video_files, sort_by):
        if sort_by == "文件名":
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
            fc  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
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

        fps        = cap.get(cv2.CAP_PROP_FPS)
        frame_count= int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration   = frame_count / fps if fps > 0 else 0
        width      = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height     = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        video_name = os.path.basename(video_path)
        file_size  = os.path.getsize(video_path) / (1024 * 1024)

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
        info = (f"✅ {video_name}: {frames_loaded}帧 "
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
class EagleVideoFrameExtractor:
    """
    🦅 视频帧提取器
    - 视频预览条：自动生成 8 张均匀分布的缩略帧
    - 三种模式：单帧提取 / 均匀采样 / 自定义时间点
    - video_path 接受 STRING 或任意 VIDEO 类型
    """

    TIMELINE_STRIP_COUNT = 8

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_path":   ("*", {"forceInput": True}),   # 接受任意视频类型
                "time_mode":    (["单帧提取", "均匀采样", "自定义时间点"], {"default": "单帧提取"}),
                "frame_index":  ("INT", {
                    "default": 0, "min": 0, "max": 999999, "step": 1,
                    "tooltip": "直接输入目标帧号"
                }),
                "sample_count": ("INT", {
                    "default": 4, "min": 1, "max": 64, "step": 1,
                    "tooltip": "均匀采样帧数"
                }),
                "resize_width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "resize_height":("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "preview_strip":("BOOLEAN", {
                    "default": True,
                    "tooltip": "是否生成视频缩略帧预览条（8张均匀分布）"
                }),
            },
            "optional": {
                "custom_times": ("STRING", {
                    "default": "0, 5, 10, 15",
                    "multiline": False,
                    "tooltip": "自定义时间点（秒），用英文逗号分隔"
                }),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "IMAGE", "IMAGE")
    RETURN_NAMES = ("frames", "info", "preview", "timeline_strip")
    OUTPUT_IS_LIST = (True, False, False, False)
    FUNCTION = "extract_frames"
    CATEGORY = "🦅 Eagle/视频处理"

    def extract_frames(self, video_path, time_mode, frame_index, sample_count,
                       resize_width, resize_height, preview_strip, custom_times=""):

        # 解析路径（兼容 STRING / VIDEO 对象）
        resolved = _resolve_video_path(video_path)
        empty = torch.zeros((1, resize_height, resize_width, 3))
        if not resolved:
            return ([empty], "❌ 视频文件不存在或路径无法解析", empty, empty)
        video_path = resolved

        try:
            import cv2
        except ImportError:
            raise ImportError("需要安装 opencv-python: pip install opencv-python")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return ([empty], "❌ 无法打开视频", empty, empty)

        fps          = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration     = total_frames / fps if fps > 0 else 0
        vid_w        = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        vid_h        = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()

        # ── 工具函数 ────────────────────────────────────────────
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
            if f.shape[1] != resize_width or f.shape[0] != resize_height:
                f = cv2.resize(f, (resize_width, resize_height),
                               interpolation=cv2.INTER_LANCZOS4)
            return f

        def _to_tensor(f):
            return torch.from_numpy(f.astype(np.float32) / 255.0)

        # ── 预览条 ──────────────────────────────────────────────
        strip_frames = []
        if preview_strip and total_frames > 0:
            for k in range(self.TIMELINE_STRIP_COUNT):
                pos = int(round(k / (self.TIMELINE_STRIP_COUNT - 1) * (total_frames - 1)))
                cap2 = cv2.VideoCapture(video_path)
                f = _read_frame_at(cap2, pos)
                cap2.release()
                if f is not None:
                    strip_frames.append(f)

        if strip_frames:
            thumb_h = 128
            thumb_w = max(1, int(thumb_h * resize_width / resize_height))
            strip_imgs = []
            for idx, sf in enumerate(strip_frames):
                sm = cv2.resize(sf, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
                cv2.putText(sm, f"#{idx+1}", (5, 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                strip_imgs.append(sm)
            timeline_strip = _to_tensor(np.hstack(strip_imgs)).unsqueeze(0)
        else:
            timeline_strip = torch.zeros((1, 128, max(128, resize_width), 3))

        # ── 确定提取时间点 ───────────────────────────────────────
        if time_mode == "单帧提取":
            target = max(0, min(frame_index, total_frames - 1))
            times = [target / fps if fps > 0 else 0]
        elif time_mode == "均匀采样":
            if duration > 0:
                interval = duration / (sample_count + 1)
                times = [interval * (i + 1) for i in range(sample_count)]
            else:
                times = [0]
        else:
            try:
                times = [float(t.strip()) for t in custom_times.split(",") if t.strip()]
                if not times:
                    times = [0]
            except Exception:
                times = [0]

        # ── 提取帧 ───────────────────────────────────────────────
        frames, frame_infos, current_preview = [], [], None

        cap3 = cv2.VideoCapture(video_path)
        for i, t in enumerate(times):
            frame_pos = max(0, min(int(round(t * fps)), total_frames - 1))
            frame_rgb = _read_frame_at(cap3, frame_pos)
            if frame_rgb is None:
                continue
            frame_rgb = _resize(frame_rgb)
            frames.append(_to_tensor(frame_rgb).unsqueeze(0))
            actual_time = frame_pos / fps if fps > 0 else t
            frame_infos.append(f"帧{i+1}: {actual_time:.3f}s (#{frame_pos})")
            if current_preview is None:
                current_preview = _to_tensor(frame_rgb).unsqueeze(0)
        cap3.release()

        if not frames:
            return ([empty], "❌ 无法提取任何帧", empty, timeline_strip)

        info  = f"📹 {os.path.basename(video_path)}\n"
        info += f"🎬 {total_frames}帧 {fps:.2f}fps {duration:.2f}s {vid_w}x{vid_h}\n"
        info += f"📸 模式:{time_mode} | 提取:{len(frames)}帧\n"
        info += "\n".join(frame_infos)

        if current_preview is None:
            current_preview = empty

        return (frames, info, current_preview, timeline_strip)
class EagleVideoInfo:
    """
    🦅 视频信息分析器
    获取视频详细信息，不加载帧
    video_path 接受 STRING 或任意 VIDEO 类型
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_path": ("*", {"forceInput": True}),   # 接受任意视频类型
            }
        }

    RETURN_TYPES = ("STRING", "FLOAT", "FLOAT", "INT", "INT", "INT")
    RETURN_NAMES = ("info", "duration", "fps", "total_frames", "width", "height")
    FUNCTION = "analyze_video"
    CATEGORY = "🦅 Eagle/视频处理"

    def analyze_video(self, video_path):
        resolved = _resolve_video_path(video_path)
        if not resolved:
            return ("❌ 视频文件不存在或路径无法解析", 0.0, 0.0, 0, 0, 0)
        video_path = resolved

        try:
            import cv2
        except ImportError:
            raise ImportError("需要安装 opencv-python: pip install opencv-python")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return ("❌ 无法打开视频", 0.0, 0.0, 0, 0, 0)

        fps          = float(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width        = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height       = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration     = total_frames / fps if fps > 0 else 0.0
        file_size    = os.path.getsize(video_path) / (1024 * 1024)
        cap.release()

        info  = f"📹 {os.path.basename(video_path)}\n"
        info += f"⏱️ 时长: {duration:.2f}s\n"
        info += f"🎬 帧率: {fps:.2f} fps\n"
        info += f"📊 总帧数: {total_frames}\n"
        info += f"📐 分辨率: {width}x{height}\n"
        info += f"💾 文件大小: {file_size:.2f} MB"

        return (info, duration, fps, total_frames, width, height)


# ── 注册 ────────────────────────────────────────────────────────────────────
NODE_CLASS_MAPPINGS = {
    "EagleBatchVideoLoader":    EagleBatchVideoLoader,
    "EagleVideoFrameExtractor": EagleVideoFrameExtractor,
    "EagleVideoInfo":           EagleVideoInfo,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "EagleBatchVideoLoader":    "🦅 批量视频加载器",
    "EagleVideoFrameExtractor": "🦅 视频帧提取器",
    "EagleVideoInfo":           "🦅 视频信息分析",
}
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
