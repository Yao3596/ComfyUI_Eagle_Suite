# -*- coding: utf-8 -*-
"""
EagleFileTools — 工具函数
移植自 ComfyUI-HugoTools
"""

import os
import json
import re
import subprocess
from pathlib import Path

import folder_paths
from PIL import Image

from .eagle_suite.logger import logger

# ── 文件类型 ─────────────────────────────────────────────────

IMAGE_EXTENSIONS = ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff',
                    '.webp', '.svg', '.ico', '.avif', '.heic', '.jfif', '.pjpeg', '.pjp')
AUDIO_EXTENSIONS = ('.mp3', '.wav', '.aac', '.flac', '.m4a', '.wma',
                    '.ogg', '.amr', '.ape', '.ac3', '.aiff', '.opus', '.caf', '.dts')


# ── 设置读取 ─────────────────────────────────────────────────

def get_setting(name, default=None):
    """从 ComfyUI 用户配置读取设置。"""
    config_path = os.path.join(folder_paths.get_user_directory(), 'default', "comfy.settings.json")
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data.get(name, default)
    except Exception as e:
        logger.warning(f"[EagleFileTools] 读取设置失败: {e}")
    return default


def set_setting(name, value):
    """保存设置到 ComfyUI 用户配置。"""
    config_path = os.path.join(folder_paths.get_user_directory(), 'default', "comfy.settings.json")
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = {}
        data[name] = value
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.warning(f"[EagleFileTools] 保存设置失败: {e}")
        return False


# ── 文件查找 ─────────────────────────────────────────────────

def find_files(root_dir, file_type="image"):
    """在目录中查找指定类型的文件。
    - image: 平铺查找（不递归子文件夹）
    - audio: 递归查找所有子文件夹
    """
    extensions = IMAGE_EXTENSIONS if file_type == "image" else AUDIO_EXTENSIONS
    files = []
    root = Path(root_dir)

    if not root.exists():
        return []

    it = root.iterdir() if file_type == "image" else root.rglob('*')
    for fp in it:
        try:
            if fp.is_file() and fp.suffix.lower() in extensions:
                files.append(str(fp.resolve()))
        except (PermissionError, OSError):
            pass
    return files


# ── 图片操作 ─────────────────────────────────────────────────

def get_image_size(image_path):
    """获取图片尺寸 (width, height)"""
    try:
        with Image.open(image_path) as img:
            return img.size
    except Exception as e:
        logger.warning(f"[EagleFileTools] 获取图片尺寸失败: {e}")
        return (0, 0)


# ── 视频信息 ─────────────────────────────────────────────────

def get_video_info(video_path):
    """使用 ffprobe 获取视频信息。"""
    cmd = [
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=avg_frame_rate,duration,width,height',
        '-of', 'json', video_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        data = json.loads(result.stdout)
        if 'streams' in data and data['streams']:
            s = data['streams'][0]
            fps_str = s.get('avg_frame_rate', '')
            if '/' in fps_str:
                num, den = map(int, fps_str.split('/'))
                fps = num / den if den else 0
            else:
                fps = float(fps_str) if fps_str else 0
            return {
                'fps': fps,
                'width': int(s.get('width', 0)),
                'height': int(s.get('height', 0)),
                'duration': float(s.get('duration', 0)),
            }
    except subprocess.TimeoutExpired:
        logger.warning(f"[EagleFileTools] ffprobe 超时: {video_path}")
    except Exception as e:
        logger.warning(f"[EagleFileTools] ffprobe 失败: {e}")
    return {}


# ── 路径工具 ─────────────────────────────────────────────────

def normalize_path(path):
    """统一路径格式（正斜杠）"""
    if not path:
        return ""
    return path.replace("\\", "/")


def is_image_file(path):
    """判断是否是支持的图片格式"""
    return path.lower().endswith(IMAGE_EXTENSIONS) if path else False


def generate_template_string(filename):
    """将文件名中的数字替换为格式化占位符（如 001 → %03d）"""
    match = re.search(r'\d+', filename)
    if match:
        return re.sub(r'\d+', lambda x: f'%0{len(x.group())}d', filename)
    return filename


# ── 图片目录 ─────────────────────────────────────────────────

def get_image_directory():
    """获取配置的图片目录（如未配置则使用 ComfyUI 输入目录）"""
    custom = get_setting('EagleFileTools.image_path')
    return custom if custom else folder_paths.get_input_directory()
