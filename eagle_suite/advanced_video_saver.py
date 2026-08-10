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

from .eagle_client import eagle_client
from .utils import parse_tags
from .logger import logger


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
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),  # ComfyUI标准图像批次 [B, H, W, C]
                
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
                "quality": (["lossless", "high", "medium", "low"],),
                "preview": ("BOOLEAN", {"default": True}),
                
                # === Eagle 评分（在文本框上方） ===
                "eagle_rating": ("INT", {
                    "default": 0,
                    "min": 0, "max": 5, "step": 1,
                    "tooltip": "Eagle 评分 (0-5 星)"
                }),
            },
            "optional": {
                # === VIDEO 输入口 ===
                "video": ("VIDEO",),  # 直接传入视频文件路径
                
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
                
                # === 最下方：Eagle 标签 + 注释（文本框） ===
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
    
    RETURN_TYPES = ("VIDEO", "IMAGE", "AUDIO", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("video", "video_passthrough", "audio_passthrough", "file_path", "metadata_json", "save_result")
    FUNCTION = "save_video"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle/Video"
    
    def save_video(self, images, eagle_folder, local_save_path, filename_prefix, fps, format, codec, quality, 
                   eagle_rating, preview=True,
                   video=None, audio=None, enable_interpolation=False, interpolation_multiplier=2,
                   resize_width=0, resize_height=0,
                   audio_codec="aac", audio_bitrate="192k", pixel_format="yuv420p",
                   eagle_tags="", eagle_annotation="",
                   prompt=None, extra_pnginfo=None, unique_id=None):
        
        print("\n" + "="*60)
        print("🎬 高级视频保存器（Eagle 集成版）")
        print("="*60)
        
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
        counter = 1
        while True:
            filename = f"{filename_prefix}_{counter:05d}.{format}"
            full_path = output_path / filename
            if not full_path.exists():
                break
            counter += 1
        
        base_name = f"{filename_prefix}_{counter:05d}"
        print(f"📁 输出文件: {filename}")
        
        # === 3. 处理视频源（优先使用 video 输入） ===
        actual_fps = fps
        source_video_path = None
        if video is not None and isinstance(video, (str, Path)):
            # 极少数情况：video 输入口直接传了一个路径字符串，走原来的直接转码逻辑
            print(f"🎥 使用 VIDEO 输入口（路径）: {video}")
            video_frames = None
            source_video_path = video
        else:
            if video is not None:
                # 修复：ComfyUI 原生 VIDEO 类型（VideoFromComponents / VideoFromFile，
                # 来自 comfy_api）是对象，不是字符串路径。之前 isinstance(video, (str, Path))
                # 永远是 False，会导致 source_video_path 恒为 None，但又不会退回去用
                # images 生成帧 —— 最终拿着 None 去调用 ffmpeg 相关函数，直接崩溃。
                # 现在统一用 get_components() 把它拆成图像帧 + 音轨 + 帧率，接入和
                # images 输入完全相同的插帧/缩放/编码流程。
                if not hasattr(video, "get_components"):
                    return self._error_result(
                        f"❌ video 输入类型不支持: {type(video).__name__}（既不是路径字符串，"
                        f"也没有 get_components 方法，可能是过旧/过新版本的 ComfyUI VIDEO 类型）"
                    )
                print("🎥 使用 VIDEO 输入口（原生 VIDEO 对象）")
                components = video.get_components()
                source_tensor = components.images
                if components.frame_rate:
                    try:
                        actual_fps = float(components.frame_rate)
                        print(f"🎞️ 使用 VIDEO 自带帧率: {actual_fps} fps（忽略 fps 参数）")
                    except Exception:
                        pass
                # 如果用户没有单独接 audio 输入，就用 VIDEO 自带的音轨，避免静默丢音频
                if audio is None and getattr(components, "audio", None) is not None:
                    audio = components.audio
                    print("🔊 使用 VIDEO 输入口自带的音轨")
            else:
                source_tensor = images

            video_frames = self._process_video_input(source_tensor)
            original_frame_count = len(video_frames)
            print(f"📊 原始帧数: {original_frame_count}")

            # 如果启用插帧
            if enable_interpolation:
                print(f"🔄 启用插帧: {interpolation_multiplier}x")
                video_frames = self._interpolate_frames(video_frames, interpolation_multiplier)
                actual_fps = actual_fps * interpolation_multiplier
                print(f"📊 插帧后帧数: {len(video_frames)}")
                print(f"🎞️ 实际帧率: {actual_fps} fps")

            # 调整分辨率
            if resize_width > 0 and resize_height > 0:
                print(f"📐 调整分辨率: {resize_width}x{resize_height}")
                video_frames = self._resize_frames(video_frames, resize_width, resize_height)

            h, w = video_frames.shape[1:3]
            print(f"📐 视频尺寸: {w}x{h}")
            print(f"🎞️ 帧率: {actual_fps} fps")
            print(f"🎨 编码器: {codec} ({quality})")
        
        # === 4. 保存临时视频文件 ===
        temp_dir = tempfile.mkdtemp(prefix="eagle_video_saver_")
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
            print("🔊 合并音频...")
            temp_audio_path = Path(temp_dir) / f"temp_audio_{counter:05d}.wav"
            self._save_audio(audio, temp_audio_path)
            self._merge_audio_video(temp_video_path, temp_audio_path, final_path, audio_codec, audio_bitrate)
            
            # 删除临时音频
            if temp_audio_path.exists():
                os.remove(temp_audio_path)
        else:
            # 直接重命名临时视频
            if temp_video_path.exists():
                os.rename(temp_video_path, final_path)
        
        # === 6. 获取视频信息 ===
        file_size = final_path.stat().st_size
        file_size_mb = file_size / (1024 * 1024)
        print(f"💾 文件大小: {file_size_mb:.2f} MB")
        
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
        
        # 保存元数据到 JSON 文件
        json_path = final_path.with_suffix('.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        
        metadata_json = json.dumps(metadata, ensure_ascii=False)
        
        # === 8. 保存到 Eagle ===
        eagle_result = ""
        if save_to_eagle:
            print("🦅 导入到 Eagle...")
            eagle_result = self._save_to_eagle(
                final_path, folder_id, base_name,
                eagle_tags, eagle_rating, eagle_annotation, metadata
            )
            print(eagle_result)
        
        # === 9. 生成视频预览 ===
        ui_result = {}
        if preview and unique_id:
            print("🎥 生成视频预览...")
            ui_result = self._generate_preview(final_path, unique_id, filename)
        
        # === 10. 清理临时文件 ===
        try:
            if temp_video_path.exists():
                os.remove(temp_video_path)
            os.rmdir(temp_dir)
        except Exception as e:
            logger.warning(f"清理临时文件失败: {e}")
        
        # === 11. 汇总结果 ===
        save_result = f"✅ 保存成功: {final_path}\n"
        if save_to_eagle:
            save_result += f"🦅 Eagle: {eagle_result}{folder_correction}\n"
        if save_to_local:
            save_result += f"📁 本地: {local_save_path}\n"
        save_result += f"💾 大小: {file_size_mb:.2f} MB | ⏱️ 时长: {duration:.2f}s | 🎞️ 帧率: {actual_fps} fps"
        
        print(save_result)
        print("="*60 + "\n")
        
        # === 12. 返回 VIDEO 输出（文件路径字符串） ===
        video_output = str(final_path)
        
        return {
            "ui": ui_result,
            "result": (video_output, images, audio, str(final_path), metadata_json, save_result)
        }
    
    def _error_result(self, message):
        """返回错误结果"""
        print(f"\n{message}\n")
        empty_image = torch.zeros((1, 64, 64, 3))
        return {
            "ui": {},
            "result": ("", empty_image, None, "", "{}", message)
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
                'ffmpeg',
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
            'ffmpeg',
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
        """使用 ffprobe 获取视频信息"""
        try:
            cmd = [
                'ffprobe',
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
        
        except Exception as e:
            logger.warning(f"获取视频信息失败: {e}")
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
                        "format": video_path.suffix.lstrip('.')
                    }]
                }
            else:
                temp_dir = folder_paths.get_temp_directory()
                os.makedirs(temp_dir, exist_ok=True)
                
                preview_filename = f"video_preview_{unique_id}_{video_path.name}"
                preview_path = os.path.join(temp_dir, preview_filename)
                
                video_size_mb = video_path.stat().st_size / (1024 * 1024)
                
                if video_size_mb > 50:
                    print(f"📦 视频较大({video_size_mb:.1f}MB)，生成压缩预览...")
                    self._create_preview_video(video_path, preview_path)
                else:
                    import shutil
                    shutil.copy2(video_path, preview_path)
                
                return {
                    "videos": [{
                        "filename": preview_filename,
                        "subfolder": "",
                        "type": "temp",
                        "format": video_path.suffix.lstrip('.')
                    }]
                }
        except Exception as e:
            print(f"⚠️ 预览生成失败: {str(e)}")
            return {}
    
    def _create_preview_video(self, input_path, output_path):
        """创建压缩的预览视频"""
        cmd = [
            'ffmpeg',
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
            print(f"⚠️ 压缩预览失败: {str(e)}")
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
            'ffmpeg',
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
            process = subprocess.Popen(
                cmd, 
                stdin=subprocess.PIPE, 
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            for frame in frames:
                process.stdin.write(frame.tobytes())
            
            process.stdin.close()
            stdout, stderr = process.communicate()
            
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
        
        if waveform.dtype == np.float32 or waveform.dtype == np.float64:
            waveform = (waveform * 32767).astype(np.int16)
        
        wavfile.write(str(output_path), sample_rate, waveform)
    
    def _merge_audio_video(self, video_path, audio_path, output_path, audio_codec, audio_bitrate):
        """合并音频和视频"""
        cmd = [
            'ffmpeg',
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
