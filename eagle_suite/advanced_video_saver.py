# -*- coding: utf-8 -*-
"""
高级视频保存节点 - 兼容MiniMAX H3和其他视频生成模型
支持视频+音频合并、帧率调整、插帧、多种编码格式、视频预览
新增：双路径保存、Eagle 集成、视频输入口
"""

import os
import json
import numpy as np
import torch
from pathlib import Path
import folder_paths
import subprocess
from PIL import Image
import hashlib
from datetime import datetime
import tempfile
import time
import shutil
import re
import av
from comfy_api.input_impl import VideoFromFile

from .eagle_client import eagle_client
from .utils import parse_tags
from .logger import logger
from .workflow_metadata import build_workflow_bundle, embed_workflow_in_media, persist_workflow_for_media


class EagleAdvancedVideoSaver:
    """
    高级视频保存节点
    功能：
    - 支持多种视频格式和编码器
    - 音视频合并
    - 帧插值
    - 分辨率调整
    - 双路径保存（Eagle + 本地）
    - Eagle 元数据（标签、评分、注释）
    - 视频输入口（直接传视频）
    - 穿透输出支持工作流链接
    - 视频预览
    """
    
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.prefix_append = ""

    @staticmethod
    def _media_tool(name):
        """定位 ffmpeg/ffprobe；兼容仅将 ffmpeg 暴露到 PATH 的便携环境。"""
        direct = shutil.which(name)
        if direct:
            return direct

        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            try:
                from .utils import get_cached_ffmpeg
                ffmpeg_path = get_cached_ffmpeg()
            except Exception:
                ffmpeg_path = None

        if ffmpeg_path:
            suffix = Path(ffmpeg_path).suffix or (".exe" if os.name == "nt" else "")
            sibling = Path(ffmpeg_path).with_name(name + suffix)
            if sibling.is_file():
                return str(sibling)
        return name
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # === 最上方：Eagle + 本地路径 ===
                "eagle_folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Eagle 文件夹名称、路径或 ID"
                }),
                "local_save_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "本地保存路径（留空则保存到 output 目录）"
                }),
                
                # === 基础视频参数 ===
                "filename_prefix": ("STRING", {"default": "video"}),
                "fps": ("INT", {"default": 30, "min": 1, "max": 120, "step": 1}),
                "format": (["mp4", "webm", "avi", "mov", "mkv"],),
                "codec": (["h264", "h265", "vp9", "prores"],),
                "quality": (["lossless", "high", "medium", "low"], {"default": "high"}),
                "preview": ("BOOLEAN", {"default": True}),
                
                # === Eagle 评分 ===
                "eagle_rating": ("INT", {
                    "default": 0,
                    "min": 0, "max": 5, "step": 1,
                    "tooltip": "Eagle 评分 (0-5 星)"
                }),
            },
            "optional": {
                # === 视频/图像输入（二选一或同时提供） ===
                "images": ("IMAGE",),  # 图像序列（可选）
                "video": ("VIDEO",),   # 视频文件（可选）
                
                # === 音频输入 ===
                "audio": ("AUDIO",),
                
                # === 视频处理参数 ===
                "enable_interpolation": ("BOOLEAN", {"default": False}),
                "interpolation_multiplier": ("INT", {"default": 2, "min": 2, "max": 8, "step": 1}),
                "resize_width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}),
                "resize_height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}),
                
                # === 音频编码参数 ===
                "audio_codec": (["aac", "mp3", "opus", "pcm"],),
                "audio_bitrate": (["128k", "192k", "256k", "320k"],),
                "pixel_format": (["yuv420p", "yuv444p", "rgb24"],),
                
                # === Eagle 标签 + 注释 ===
                "eagle_tags": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "Eagle 标签：用逗号或换行分隔"
                }),
                "eagle_annotation": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "Eagle 注释"
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    
    RETURN_TYPES = ("VIDEO", "VIDEO", "AUDIO", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("video", "video_passthrough", "audio_passthrough", "file_path", "metadata_json", "save_result")
    FUNCTION = "save_video"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle/工具"
    
    def save_video(self, eagle_folder, local_save_path, filename_prefix, fps, format, codec, quality,
               eagle_rating, preview=True,
               images=None, video=None, audio=None,
               enable_interpolation=False, interpolation_multiplier=2,
               resize_width=0, resize_height=0,
               audio_codec="aac", audio_bitrate="192k", pixel_format="yuv420p",
               eagle_tags="", eagle_annotation="",
               prompt=None, extra_pnginfo=None, unique_id=None):

        filename_prefix = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", str(filename_prefix or "video"))
        filename_prefix = filename_prefix.strip(" .") or "video"

        logger.debug("高级视频保存器开始执行")

        # === 0. 验证输入 ===
        if images is None and video is None:
            return self._error_result("❌ 请至少提供 images（图像序列）或 video（视频文件）输入")

        # 如果同时提供了 images 和 video，优先使用 video
        if images is not None and video is not None:
            logger.info("同时检测到 images 和 video 输入，优先使用 video")
            images = None  # 忽略 images
        
        # === 1. 解析保存目标 ===
        save_to_eagle = bool(eagle_folder.strip())
        save_to_local = bool(local_save_path.strip())
        save_to_output = not save_to_local  # 如果没指定本地路径，保存到默认 output
        
        if not save_to_eagle and not save_to_local and not save_to_output:
            return self._error_result("❌ 请至少指定 Eagle 文件夹或本地保存路径")
        
        # 解析 Eagle 文件夹 ID
        folder_id = None
        folder_correction = ""
        if save_to_eagle:
            value, itype = eagle_client.parse_folder_input(eagle_folder)
            if itype is None:
                return self._error_result(f"❌ 无法解析 Eagle 文件夹输入: {eagle_folder}")
            if itype == "eagle_id":
                folder_id, corrected = eagle_client.resolve_folder_id(value)
                if not folder_id:
                    return self._error_result(f"❌ Eagle 文件夹 ID 不存在: {value}")
                if corrected:
                    folder_correction = f"（文件夹 ID 已纠正: {value} → {folder_id}）"
            elif itype == "eagle_name":
                folder_id = eagle_client.find_folder_id_by_path(value)
                if not folder_id:
                    return self._error_result(f"❌ 找不到 Eagle 文件夹: {value}")
            elif itype == "local_path":
                logger.warning("检测到 Eagle 文件夹处填写了本地路径，已忽略 Eagle 保存")
                save_to_eagle = False
        
        # 创建输出目录
        if save_to_output:
            output_path = Path(self.output_dir)
        else:
            output_path = Path(local_save_path)
        output_path.mkdir(parents=True, exist_ok=True)
        
        # === 2. 生成唯一文件名 ===
        # ... 后续代码保持不变


        # === 2. 生成唯一文件名 ===
        counter = 1
        while True:
            filename = f"{filename_prefix}_{counter:05d}.{format}"
            full_path = output_path / filename
            if not full_path.exists():
                break
            counter += 1
        
        base_name = f"{filename_prefix}_{counter:05d}"
        logger.debug(f"输出文件: {filename}")
        
        # === 3. 处理视频源 ===
        actual_fps = fps
        source_video_path = None
        video_frames = None

        if video is not None:
            # 优先获取原生 VIDEO 的流源。文件型视频直接转码，避免把整段视频解码进内存。
            if hasattr(video, "get_stream_source"):
                try:
                    stream_source = video.get_stream_source()
                    if isinstance(stream_source, (str, Path)) and os.path.isfile(stream_source):
                        source_video_path = str(stream_source)
                        logger.debug(f"使用 VIDEO 文件流: {source_video_path}")
                except Exception as error:
                    logger.debug(f"读取 VIDEO 流源失败，尝试组件模式: {error}")

            # 非文件型原生 VIDEO（例如内存视频）通过组件帧处理。
            if source_video_path is None and hasattr(video, "get_components"):
                try:
                    logger.debug("使用 VIDEO 组件输入")
                    components = video.get_components()
                    source_tensor = getattr(components, "images", None)
                    if source_tensor is not None and getattr(source_tensor, "numel", lambda: 0)() > 0:
                        video_frames = self._process_video_input(source_tensor)
                    if getattr(components, "frame_rate", None):
                        actual_fps = float(components.frame_rate)
                        logger.debug(f"使用 VIDEO 自带帧率: {actual_fps} fps")
                    if audio is None and getattr(components, "audio", None) is not None:
                        audio = components.audio
                        logger.debug("使用 VIDEO 输入口自带的音轨")
                except Exception as error:
                    logger.warning(f"VIDEO 组件读取失败: {error}")

            # 兼容路径字符串以及部分第三方节点返回的 path/source 字典。
            if source_video_path is None and video_frames is None:
                candidate = None
                if isinstance(video, (str, Path)):
                    candidate = str(video)
                elif isinstance(video, dict):
                    candidate = video.get("path") or video.get("file") or video.get("source")
                else:
                    for attr in ("path", "file", "filename"):
                        value = getattr(video, attr, None)
                        if isinstance(value, (str, Path)):
                            candidate = str(value)
                            break
                if candidate and os.path.isfile(candidate):
                    source_video_path = os.path.abspath(candidate)
                    logger.debug(f"使用兼容视频路径: {source_video_path}")

            if source_video_path is None and video_frames is None:
                return self._error_result(f"❌ 无法从 video 输入读取有效视频: {type(video).__name__}")

        elif images is not None:
            # 情况 3：使用 images 输入（图像序列）
            logger.debug("使用 images 输入（图像序列）")
            video_frames = self._process_video_input(images)

        if source_video_path is None and video_frames is None:
            return self._error_result("❌ images 或 video 输入为空，无法生成视频")

        # 如果有视频帧（从 images 或 VIDEO.images 获取），进行后续处理
        if video_frames is not None:
            original_frame_count = len(video_frames)
            logger.debug(f"原始帧数: {original_frame_count}")

            # 如果启用插帧
            if enable_interpolation:
                logger.debug(f"启用插帧: {interpolation_multiplier}x")
                video_frames = self._interpolate_frames(video_frames, interpolation_multiplier)
                actual_fps = actual_fps * interpolation_multiplier
                logger.debug(f"插帧后帧数: {len(video_frames)}")
                logger.debug(f"实际帧率: {actual_fps} fps")

            # 调整分辨率
            if resize_width > 0 and resize_height > 0:
                logger.debug(f"调整分辨率: {resize_width}x{resize_height}")
                video_frames = self._resize_frames(video_frames, resize_width, resize_height)

            h, w = video_frames.shape[1:3]
            logger.debug(f"视频尺寸: {w}x{h}; 帧率: {actual_fps}; 编码器: {codec} ({quality})")

        
        # === 4. 保存临时视频文件 ===
        temp_owner = tempfile.TemporaryDirectory(prefix="eagle_video_saver_")
        temp_dir = temp_owner.name
        temp_video_path = Path(temp_dir) / f"temp_{counter:05d}.{format}"
        
        if source_video_path:
            # 直接转码已有视频
            self._transcode_video(source_video_path, temp_video_path, codec, quality, pixel_format, resize_width, resize_height)
            actual_fps = fps  # 使用用户指定的 fps
        else:
            # 从帧序列生成视频
            self._save_frames_to_video(video_frames, temp_video_path, actual_fps, codec, quality, pixel_format)
        
        # === 5. 合并音频（如果有） ===
        final_path = full_path
        if audio is not None:
            logger.debug("合并音频")
            temp_audio_path = Path(temp_dir) / f"temp_audio_{counter:05d}.wav"
            self._save_audio(audio, temp_audio_path)
            self._merge_audio_video(temp_video_path, temp_audio_path, final_path, audio_codec, audio_bitrate)
            
            # 删除临时音频
            if temp_audio_path.exists():
                os.remove(temp_audio_path)
        else:
            # 直接重命名临时视频
            if temp_video_path.exists():
                shutil.move(str(temp_video_path), str(final_path))
        
        # === 6. 获取视频信息 ===
        file_size = final_path.stat().st_size
        # 获取视频尺寸和时长
        video_info = self._get_video_info(final_path)
        w, h = video_info.get("width", 0), video_info.get("height", 0)
        duration = video_info.get("duration", 0)
        frame_count = video_info.get("frames", 0)
        
        # === 7. 生成元数据 ===
        metadata = self._build_metadata(
            filename, final_path, format, codec, quality, actual_fps,
            w, h, frame_count, duration, file_size,
            audio is not None, audio_codec, audio_bitrate,
            enable_interpolation, prompt, extra_pnginfo
        )
        
        # === 7.1 工作流保存：优先原生容器标签，失败/AVI 时生成同名工作流 PNG ===
        workflow_storage = persist_workflow_for_media(
            final_path, prompt, extra_pnginfo, self._media_tool("ffmpeg"),
            force_companion=final_path.suffix.lower() == ".avi",
        )
        workflow_bundle = workflow_storage["bundle"]
        embed_result = workflow_storage["embedded"]
        workflow_png = workflow_storage["companion_path"]

        # 嵌入完成后重新读取实际文件大小，并把保存状态写入 JSON 元数据。
        file_size = final_path.stat().st_size
        file_size_mb = file_size / (1024 * 1024)
        metadata["file_size"] = file_size
        json_path = final_path.with_suffix('.json')
        metadata["workflow_storage"] = {
            "mode": "native+json" if embed_result["success"] else "png+json",
            "embedded": embed_result["success"],
            "embedding_format": "comfyui-native-json-tags",
            "video_tags": ["workflow", "prompt", "extra_pnginfo"],
            "json_path": str(json_path),
            "workflow_png": workflow_png,
            "workflow_present": bool(workflow_bundle.get("workflow")),
            "message": embed_result["message"],
        }
        # 同名 JSON 保持标准 ComfyUI workflow 结构，便于直接加载；无 workflow 时保存完整包用于排查。
        workflow_json = workflow_bundle.get("workflow") or workflow_bundle
        fd, workflow_temp = tempfile.mkstemp(prefix=f".{json_path.name}.", suffix=".tmp", dir=str(json_path.parent))
        try:
            with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
                json.dump(workflow_json, f, indent=2, ensure_ascii=False)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(workflow_temp, json_path)
        finally:
            if os.path.exists(workflow_temp):
                os.remove(workflow_temp)
        
        metadata_json = json.dumps(metadata, ensure_ascii=False)
        
        # === 8. 保存到 Eagle ===
        eagle_result = ""
        if save_to_eagle:
            logger.debug("导入到 Eagle")
            eagle_result = self._save_to_eagle(
                final_path, folder_id, base_name,
                eagle_tags, eagle_rating, eagle_annotation, metadata
            )
            if workflow_png:
                workflow_tags = ",".join(filter(None, [eagle_tags, "ComfyUI工作流"]))
                companion_result = self._save_to_eagle(
                    Path(workflow_png), folder_id, base_name + "_workflow",
                    workflow_tags, eagle_rating,
                    (eagle_annotation + "\n" if eagle_annotation else "") + f"对应媒体: {filename}",
                    {"related_media": filename, "workflow_companion": True},
                )
                eagle_result += f"；工作流 PNG: {companion_result}"
            logger.info(eagle_result)
        
        # === 9. 生成视频预览 ===
        ui_result = {}
        if preview and unique_id:
            logger.debug("生成视频预览")
            ui_result = self._generate_preview(final_path, unique_id, filename)
        
        # === 10. 清理临时文件 ===
        temp_owner.cleanup()
        
        # === 11. 汇总结果 ===
        save_result = f"✅ 保存成功: {final_path}\n"
        if save_to_eagle:
            save_result += f"🦅 Eagle: {eagle_result}{folder_correction}\n"
        if save_to_local:
            save_result += f"📁 本地: {local_save_path}\n"
        save_result += f"🧩 视频内工作流: {'成功，可直接由支持视频元数据的 ComfyUI 读取' if embed_result['success'] else '该格式不可靠，已使用 PNG 伴随文件'}\n"
        if workflow_png:
            save_result += f"🖼️ 工作流 PNG: {workflow_png}\n"
        save_result += f"📄 工作流 JSON: {json_path}\n"
        save_result += f"💾 大小: {file_size_mb:.2f} MB | ⏱️ 时长: {duration:.2f}s | 🎞️ 帧率: {actual_fps} fps"
        
        logger.info(save_result)
        
        # === 12. 返回 VIDEO 输出 ===
        # VIDEO 端口必须返回 ComfyUI 原生 VideoInput，路径另由 file_path 输出。
        video_output = VideoFromFile(str(final_path))

        # 确保穿透输出不为 None
        passthrough_video = (
            video
            if video is not None and (hasattr(video, "get_components") or hasattr(video, "save_to"))
            else video_output
        )
        passthrough_audio = audio  # audio 可以是 None（ComfyUI 支持）

        return {
            "ui": ui_result,
            "result": (
                video_output,           # VIDEO：ComfyUI 原生视频对象
                passthrough_video,      # VIDEO：原始视频；图像生成时穿透生成结果
                passthrough_audio,      # AUDIO：原始音频（或 None）
                str(final_path),        # STRING：文件路径
                metadata_json,          # STRING：元数据 JSON
                save_result             # STRING：保存结果摘要
            )
        }

    @staticmethod
    def _error_result(message):
        """Return a type-correct result for validation failures."""
        logger.error(message)
        return {
            "ui": {},
            "result": (
                None,
                None,
                None,
                "",
                "",
                str(message),
            ),
        }


    
    def _save_to_eagle(self, video_path, folder_id, name, tags_str, rating, annotation, metadata):
        """保存视频到 Eagle，包含缩略图和元数据"""
        tags_list = parse_tags(tags_str)
        
        # 生成缩略图（从视频中间帧提取）
        thumbnail_path = self._generate_thumbnail(video_path)
        
        try:
            # 导入视频到 Eagle
            res = eagle_client.add_item_from_path(
                str(video_path),
                folder_id=folder_id,
                name=name,
                tags=tags_list,
                annotation=annotation,
                star=rating,
                meta=metadata
            )
            
            # 清理临时缩略图
            if thumbnail_path and os.path.exists(thumbnail_path):
                try:
                    os.remove(thumbnail_path)
                except:
                    pass
            
            if isinstance(res, dict):
                if res.get("status") == "success":
                    result = "导入成功"
                    if res.get("metadataWarning"):
                        result += f"，但 {res.get('metadataWarning')}"
                    return result
                else:
                    return f"导入失败: {res.get('message', '未知错误')}"
            else:
                return f"导入失败: 返回类型异常 {type(res).__name__}"
        
        except Exception as e:
            logger.error(f"Eagle 导入失败: {e}")
            return f"导入失败: {str(e)}"
    
    def _generate_thumbnail(self, video_path):
        """从视频中间帧生成缩略图（PNG 格式，用于 Eagle 预览）"""
        try:
            temp_dir = tempfile.gettempdir()
            thumbnail_path = os.path.join(temp_dir, f"video_thumb_{os.getpid()}_{int(time.time())}.png")
            
            # 使用 ffmpeg 提取第一帧
            cmd = [
                self._media_tool("ffmpeg"),
                '-y',
                '-i', str(video_path),
                '-vf', 'select=eq(n\\,0)',
                '-vframes', '1',
                str(thumbnail_path)
            ]
            
            subprocess.run(cmd, capture_output=True, check=True, timeout=30)
            
            if os.path.exists(thumbnail_path):
                return thumbnail_path
        
        except Exception as e:
            logger.warning(f"生成缩略图失败: {e}")
        
        return None
    
    def _transcode_video(self, input_path, output_path, codec, quality, pixel_format, width=0, height=0):
        """转码已有视频"""
        codec_params = self._get_codec_params(codec, quality)
        
        cmd = [
            self._media_tool("ffmpeg"),
            '-y',
            '-i', str(input_path),
            '-c:v', codec_params['codec'],
        ]
        
        cmd.extend(codec_params['params'])
        cmd.extend(['-pix_fmt', pixel_format])
        
        # 调整分辨率
        if width > 0 and height > 0:
            cmd.extend(['-vf', f'scale={width}:{height}'])
        
        cmd.append(str(output_path))
        
        try:
            subprocess.run(cmd, capture_output=True, check=True, timeout=300)
        except Exception as e:
            raise RuntimeError(f"视频转码失败: {str(e)}")
    
    def _get_video_info(self, video_path):
        """优先用 ffprobe，便携环境缺少 ffprobe 时回退 PyAV。"""
        try:
            cmd = [
                self._media_tool('ffprobe'),
                '-v', 'error',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,duration',
                '-of', 'json',
                str(video_path)
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
            data = json.loads(result.stdout)
            
            stream = data.get('streams', [{}])[0]
            
            # 解析帧率
            fps_str = stream.get('r_frame_rate', '30/1')
            if '/' in fps_str:
                num, den = map(int, fps_str.split('/'))
                fps = num / den if den != 0 else 30
            else:
                fps = float(fps_str)
            
            # 解析时长
            duration = float(stream.get('duration', 0))
            if duration == 0:
                nb_frames = int(stream.get('nb_frames', 0))
                if nb_frames > 0:
                    duration = nb_frames / fps
            
            return {
                'width': int(stream.get('width', 0)),
                'height': int(stream.get('height', 0)),
                'fps': fps,
                'frames': int(stream.get('nb_frames', 0)),
                'duration': duration
            }
        
        except Exception as error:
            logger.debug(f"ffprobe 获取视频信息失败，回退 PyAV: {error}")
            try:
                with av.open(str(video_path), mode="r") as container:
                    stream = container.streams.video[0]
                    fps = float(stream.average_rate) if stream.average_rate else 30.0
                    frames = int(stream.frames or 0)
                    duration = 0.0
                    if stream.duration is not None and stream.time_base is not None:
                        duration = float(stream.duration * stream.time_base)
                    elif container.duration:
                        duration = float(container.duration / av.time_base)
                    if frames <= 0 and duration > 0:
                        frames = int(round(duration * fps))
                    return {
                        'width': int(stream.width or 0),
                        'height': int(stream.height or 0),
                        'fps': fps,
                        'frames': frames,
                        'duration': duration,
                    }
            except Exception as pyav_error:
                logger.warning(f"获取视频信息失败: {pyav_error}")
                return {'width': 0, 'height': 0, 'fps': 30, 'frames': 0, 'duration': 0}
    
    def _build_metadata(self, filename, path, format, codec, quality, fps,
                       width, height, frames, duration, file_size,
                       has_audio, audio_codec, audio_bitrate, interpolated,
                       prompt, extra_pnginfo):
        """生成完整元数据（与 EagleSaver 格式一致）"""
        metadata = {
            "filename": filename,
            "path": str(path),
            "format": format,
            "codec": codec,
            "quality": quality,
            "fps": fps,
            "width": width,
            "height": height,
            "frames": frames,
            "duration": duration,
            "file_size": file_size,
            "has_audio": has_audio,
            "interpolated": interpolated,
            "created_at": datetime.now().isoformat(),
        }
        
        if has_audio:
            metadata["audio_codec"] = audio_codec
            metadata["audio_bitrate"] = audio_bitrate
        
        # 从 ComfyUI 工作流提取元数据
        try:
            if extra_pnginfo and isinstance(extra_pnginfo, dict):
                workflow = extra_pnginfo.get("workflow") or {}
                metadata["comfy_workflow"] = workflow
                
                prompt_data = extra_pnginfo.get("prompt")
                if prompt_data and isinstance(prompt_data, dict):
                    metadata["prompt"] = prompt_data
            
            if prompt and isinstance(prompt, dict):
                metadata["inputs"] = prompt
        
        except Exception as e:
            logger.warning(f"构建元数据时出错: {e}")
        
        return metadata

    def _build_workflow_bundle(self, prompt, extra_pnginfo):
        """构建可独立恢复的 ComfyUI 工作流包。"""
        return build_workflow_bundle(prompt, extra_pnginfo)

    def _embed_workflow_in_video(self, video_path, workflow_bundle):
        """兼容旧调用：写入 ComfyUI 原生视频元数据标签。"""
        return embed_workflow_in_media(video_path, workflow_bundle, self._media_tool("ffmpeg"))
    
    @staticmethod
    def _video_mime_type(ext: str) -> str:
        """把视频扩展名映射为 ComfyUI 前端识别用的 MIME type。"""
        mapping = {
            "mp4": "video/mp4",
            "webm": "video/webm",
            "mov": "video/quicktime",
            "avi": "video/x-msvideo",
            "mkv": "video/x-matroska",
            "gif": "image/gif",
            "webp": "image/webp",
        }
        return mapping.get((ext or "").lower().lstrip("."), f"video/{ext}")

    def _generate_preview(self, video_path, unique_id, filename):
        """生成视频预览"""
        try:
            output_dir = folder_paths.get_output_directory()
            
            if str(video_path.parent) == output_dir:
                return {
                    "videos": [{
                        "filename": video_path.name,
                        "subfolder": "",
                        "type": "output",
                        "format": self._video_mime_type(video_path.suffix.lstrip('.'))
                    }]
                }
            else:
                temp_dir = folder_paths.get_temp_directory()
                os.makedirs(temp_dir, exist_ok=True)
                
                preview_filename = f"video_preview_{unique_id}_{video_path.name}"
                preview_path = os.path.join(temp_dir, preview_filename)
                
                video_size_mb = video_path.stat().st_size / (1024 * 1024)
                
                if video_size_mb > 50:
                    logger.debug(f"视频较大({video_size_mb:.1f}MB)，生成压缩预览")
                    self._create_preview_video(video_path, preview_path)
                else:
                    import shutil
                    shutil.copy2(video_path, preview_path)
                
                return {
                    "videos": [{
                        "filename": preview_filename,
                        "subfolder": "",
                        "type": "temp",
                        "format": self._video_mime_type(video_path.suffix.lstrip('.'))
                    }]
                }
        except Exception as e:
            logger.warning(f"预览生成失败: {str(e)}")
            return {}
    
    def _create_preview_video(self, input_path, output_path):
        """创建压缩的预览视频"""
        cmd = [
            self._media_tool("ffmpeg"),
            '-y',
            '-i', str(input_path),
            '-c:v', 'libx264',
            '-crf', '28',
            '-preset', 'veryfast',
            '-vf', 'scale=iw/2:ih/2',
            '-an',
            str(output_path)
        ]
        
        try:
            subprocess.run(cmd, capture_output=True, check=True, timeout=60)
        except Exception as e:
            logger.warning(f"压缩预览失败: {str(e)}")
            import shutil
            shutil.copy2(input_path, output_path)
    
    def _process_video_input(self, images):
        """处理ComfyUI标准图像批次格式"""
        if isinstance(images, torch.Tensor):
            if images.dim() == 4:
                video_np = images.cpu().numpy()
                if video_np.max() <= 1.0:
                    video_np = (video_np * 255).clip(0, 255).astype(np.uint8)
                return video_np
            elif images.dim() == 3:
                video_np = images.cpu().numpy()
                if video_np.max() <= 1.0:
                    video_np = (video_np * 255).clip(0, 255).astype(np.uint8)
                return np.expand_dims(video_np, axis=0)
        elif isinstance(images, list):
            return np.array([self._to_numpy_frame(frame) for frame in images])
        elif isinstance(images, np.ndarray):
            if images.max() <= 1.0:
                images = (images * 255).clip(0, 255).astype(np.uint8)
            return images
        else:
            raise ValueError(f"不支持的视频类型: {type(images)}")
    
    def _to_numpy_frame(self, frame):
        """转换单帧到numpy"""
        if isinstance(frame, torch.Tensor):
            frame = frame.cpu().numpy()
        if isinstance(frame, Image.Image):
            frame = np.array(frame)
        if frame.max() <= 1.0:
            frame = (frame * 255).clip(0, 255).astype(np.uint8)
        return frame
    
    def _interpolate_frames(self, frames, multiplier):
        """帧插值 - 使用线性插值"""
        n_frames = len(frames)
        interpolated = []
        
        for i in range(n_frames - 1):
            interpolated.append(frames[i])
            for j in range(1, multiplier):
                alpha = j / multiplier
                interp_frame = (1 - alpha) * frames[i].astype(np.float32) + alpha * frames[i + 1].astype(np.float32)
                interpolated.append(interp_frame.clip(0, 255).astype(np.uint8))
        
        interpolated.append(frames[-1])
        return np.array(interpolated)
    
    def _resize_frames(self, frames, width, height):
        """调整帧大小"""
        resized = []
        for frame in frames:
            img = Image.fromarray(frame)
            img_resized = img.resize((width, height), Image.Resampling.LANCZOS)
            resized.append(np.array(img_resized))
        return np.array(resized)
    
    def _save_frames_to_video(self, frames, output_path, fps, codec, quality, pixel_format):
        """使用ffmpeg保存视频"""
        height, width = frames.shape[1:3]
        codec_params = self._get_codec_params(codec, quality)
        
        cmd = [
            self._media_tool("ffmpeg"),
            '-y',
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-s', f'{width}x{height}',
            '-pix_fmt', 'rgb24',
            '-r', str(fps),
            '-i', '-',
            '-c:v', codec_params['codec'],
        ]
        
        cmd.extend(codec_params['params'])
        cmd.extend(['-pix_fmt', pixel_format])
        cmd.append(str(output_path))
        
        try:
            with tempfile.TemporaryFile() as stderr_file:
                process = subprocess.Popen(
                    cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                    stderr=stderr_file
                )
                try:
                    for frame in frames:
                        process.stdin.write(frame.tobytes())
                    process.stdin.close()
                    process.stdin = None
                    process.wait(timeout=600)
                except Exception:
                    process.kill()
                    process.wait()
                    raise
                stderr_file.seek(0)
                stderr = stderr_file.read()
            
            if process.returncode != 0:
                error_msg = stderr.decode('utf-8', errors='ignore')
                raise RuntimeError(f"FFmpeg错误: {error_msg}")
                
        except Exception as e:
            raise RuntimeError(f"视频编码失败: {str(e)}")
    
    def _get_codec_params(self, codec, quality):
        """获取编码器参数"""
        quality_map = {
            "lossless": {"crf": "0", "preset": "slow"},
            "high": {"crf": "18", "preset": "slow"},
            "medium": {"crf": "23", "preset": "medium"},
            "low": {"crf": "28", "preset": "fast"}
        }
        
        q = quality_map.get(quality, quality_map["medium"])
        
        if codec == "h264":
            return {
                "codec": "libx264",
                "params": ["-crf", q["crf"], "-preset", q["preset"]]
            }
        elif codec == "h265":
            return {
                "codec": "libx265",
                "params": ["-crf", q["crf"], "-preset", q["preset"]]
            }
        elif codec == "vp9":
            crf_val = q["crf"]
            return {
                "codec": "libvpx-vp9",
                "params": ["-crf", crf_val, "-b:v", "0"]
            }
        elif codec == "prores":
            profile_map = {"lossless": "4", "high": "3", "medium": "2", "low": "0"}
            return {
                "codec": "prores_ks",
                "params": ["-profile:v", profile_map.get(quality, "2")]
            }
        else:
            return {
                "codec": "libx264",
                "params": ["-crf", "23", "-preset", "medium"]
            }
    
    def _save_audio(self, audio, output_path):
        """保存音频到临时文件"""
        try:
            import soundfile as sf
        except ImportError:
            try:
                from scipy.io import wavfile
                self._save_audio_scipy(audio, output_path)
                return
            except ImportError:
                raise RuntimeError("需要安装 soundfile 或 scipy 来处理音频")
        
        if isinstance(audio, dict):
            waveform = audio.get('waveform', audio.get('audio', None))
            sample_rate = audio.get('sample_rate', 44100)
        elif isinstance(audio, tuple):
            waveform, sample_rate = audio
        else:
            waveform = audio
            sample_rate = 44100
        
        if isinstance(waveform, torch.Tensor):
            waveform = waveform.cpu().numpy()
        
        # 修复：ComfyUI 标准 AUDIO 张量是 (batch, channels, samples) 三维，
        # 之前只处理了 1 维/2 维，三维原样传给 soundfile.write 会直接报
        # "Invalid shape ... too many dimensions"（VAE解码_音频出来的就是这种形状）。
        if waveform.ndim == 3:
            if waveform.shape[0] != 1:
                logger.warning(f"音频 batch 维度 > 1 ({waveform.shape[0]})，只取第一个")
            waveform = waveform[0]  # (batch, channels, samples) -> (channels, samples)

        if waveform.ndim == 1:
            pass
        elif waveform.ndim == 2:
            if waveform.shape[0] < waveform.shape[1]:
                waveform = waveform.T
        
        sf.write(str(output_path), waveform, sample_rate)
    
    def _save_audio_scipy(self, audio, output_path):
        """使用scipy保存音频（备用方案）"""
        from scipy.io import wavfile
        
        if isinstance(audio, dict):
            waveform = audio.get('waveform', audio.get('audio', None))
            sample_rate = audio.get('sample_rate', 44100)
        elif isinstance(audio, tuple):
            waveform, sample_rate = audio
        else:
            waveform = audio
            sample_rate = 44100
        
        if isinstance(waveform, torch.Tensor):
            waveform = waveform.cpu().numpy()

        # 修复：和 _save_audio 一样，ComfyUI 标准 AUDIO 张量是三维
        # (batch, channels, samples)，scipy.io.wavfile 只认 1/2 维。
        if waveform.ndim == 3:
            if waveform.shape[0] != 1:
                logger.warning(f"音频 batch 维度 > 1 ({waveform.shape[0]})，只取第一个")
            waveform = waveform[0]
        if waveform.ndim == 2 and waveform.shape[0] < waveform.shape[1]:
            waveform = waveform.T

        if waveform.dtype == np.float32 or waveform.dtype == np.float64:
            waveform = (waveform * 32767).astype(np.int16)
        
        wavfile.write(str(output_path), sample_rate, waveform)
    
    def _merge_audio_video(self, video_path, audio_path, output_path, audio_codec, audio_bitrate):
        """合并音频和视频"""
        cmd = [
            self._media_tool("ffmpeg"),
            '-y',
            '-i', str(video_path),
            '-i', str(audio_path),
            '-c:v', 'copy',
            '-c:a', audio_codec,
            '-b:a', audio_bitrate,
            '-shortest',
            str(output_path)
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"音频合并失败: {e.stderr}")
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")


__all__ = ["EagleAdvancedVideoSaver"]
