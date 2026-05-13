"""
Eagle Suite 工具函数
参考 videohelpersuite 的 utils 实现
"""

import os
import re
import shutil
import subprocess
import hashlib
import time
import functools
from typing import Iterable, Union, Mapping
from pathlib import Path

import torch
from torch import Tensor

from .logger import logger

# 常量
BIGMIN = -(2**53 - 1)
BIGMAX = (2**53 - 1)
DIMMAX = 8192
ENCODE_ARGS = ("utf-8", 'backslashreplace')

# ============================================================
# ffmpeg 管理
# ============================================================

def ffmpeg_suitability(path):
    """评估 ffmpeg 的适用性得分"""
    try:
        version = subprocess.run(
            [path, "-version"], check=True,
            capture_output=True
        ).stdout.decode(*ENCODE_ARGS)
    except:
        return 0
    
    score = 0
    # 特性权重
    criteria = [
        ("libvpx", 20), ("264", 10), ("265", 3),
        ("svtav1", 5), ("libopus", 1)
    ]
    for name, weight in criteria:
        if name in version:
            score += weight
    
    # 从版权信息估算编译年份
    copyright_index = version.find('2000-2')
    if copyright_index >= 0:
        year = version[copyright_index+6:copyright_index+9]
        if year.isnumeric():
            score += int(year)
    
    return score


def get_ffmpeg_path():
    """获取可用的 ffmpeg 路径"""
    # 环境变量强制路径
    if "EAGLE_FORCE_FFMPEG_PATH" in os.environ:
        return os.environ.get("EAGLE_FORCE_FFMPEG_PATH")
    
    # 尝试 imageio-ffmpeg
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
        imageio_path = get_ffmpeg_exe()
        if imageio_path and os.path.isfile(imageio_path):
            return imageio_path
    except ImportError:
        pass
    
    # 探测系统 ffmpeg
    candidates = [
        shutil.which("ffmpeg"),
        os.path.abspath("ffmpeg"),
        os.path.abspath("ffmpeg.exe"),
    ]
    
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    
    logger.error("未找到有效的 ffmpeg，请安装或设置 PATH")
    return None


# 缓存 ffmpeg 路径
_ffmpeg_path_cache = None

def get_cached_ffmpeg():
    """获取缓存的 ffmpeg 路径"""
    global _ffmpeg_path_cache
    if _ffmpeg_path_cache is None:
        _ffmpeg_path_cache = get_ffmpeg_path()
    return _ffmpeg_path_cache


# ============================================================
# 路径安全校验
# ============================================================

def is_safe_path(path, strict=False):
    """检查路径是否安全（在工作目录内）"""
    if "EAGLE_STRICT_PATHS" not in os.environ and not strict:
        return True
    
    basedir = os.path.abspath('.')
    try:
        common = os.path.commonpath([basedir, path])
    except (ValueError, TypeError):
        # Windows 不同盘符
        return False
    
    return common == basedir


def strip_path(path):
    """去除路径首尾空白和引号"""
    path = path.strip()
    if path.startswith('"'):
        path = path[1:]
    if path.endswith('"'):
        path = path[:-1]
    return path


def validate_path(path, allow_none=False, allow_url=True):
    """验证路径是否有效"""
    if path is None:
        return allow_none
    
    if is_url(path):
        if not allow_url:
            return "URLs are unsupported for this path"
        return is_safe_path(path)
    
    if not os.path.isfile(strip_path(path)):
        return f"Invalid file path: {path}"
    
    return is_safe_path(path)


def is_url(url):
    """检查是否为 URL"""
    try:
        return url.split("://")[0] in ["http", "https"]
    except:
        return False


# ============================================================
# 文件哈希与缓存
# ============================================================

def calculate_file_hash(filename: str):
    """计算文件哈希（使用修改时间）"""
    h = hashlib.sha256()
    h.update(filename.encode())
    h.update(str(os.path.getmtime(filename)).encode())
    return h.hexdigest()


def hash_path(path):
    """获取路径的哈希标识"""
    if path is None:
        return "input"
    if is_url(path):
        return "url"
    if not os.path.isfile(strip_path(path)):
        return "DNE"
    return calculate_file_hash(strip_path(path))


# ============================================================
# 目录文件操作
# ============================================================

def get_sorted_dir_files(
    directory: str,
    skip_first: int = 0,
    select_every_nth: int = 1,
    extensions: Iterable = None
):
    """获取目录中的文件列表（排序）"""
    directory = strip_path(directory)
    
    if not os.path.isdir(directory):
        return []
    
    files = sorted(os.listdir(directory))
    files = [os.path.join(directory, f) for f in files]
    files = [f for f in files if os.path.isfile(f)]
    
    # 按扩展名过滤
    if extensions is not None:
        extensions = list(extensions)
        files = [f for f in files if f".{f.split('.')[-1].lower()}" in extensions]
    
    # 跳过和间隔
    files = files[skip_first:]
    files = files[::select_every_nth]
    
    return files


# ============================================================
# 音频处理
# ============================================================

def get_audio(file, start_time=0, duration=0):
    """从视频/音频文件中提取音频"""
    ffmpeg = get_cached_ffmpeg()
    if ffmpeg is None:
        raise RuntimeError("ffmpeg not found")
    
    args = [ffmpeg, "-i", file]
    if start_time > 0:
        args += ["-ss", str(start_time)]
    if duration > 0:
        args += ["-t", str(duration)]
    
    try:
        res = subprocess.run(
            args + ["-f", "f32le", "-"],
            capture_output=True, check=True
        )
        audio = torch.frombuffer(bytearray(res.stdout), dtype=torch.float32)
        
        # 解析音频参数
        match = re.search(r', (\d+) Hz, (\w+), ', res.stderr.decode(*ENCODE_ARGS))
        if match:
            ar = int(match.group(1))
            ac = {"mono": 1, "stereo": 2}.get(match.group(2), 2)
        else:
            ar, ac = 44100, 2
        
        audio = audio.reshape((-1, ac)).transpose(0, 1).unsqueeze(0)
        return {'waveform': audio, 'sample_rate': ar}
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"EagleSuite failed to extract audio from {file}:\n{e.stderr.decode(*ENCODE_ARGS)}")


class LazyAudioMap(Mapping):
    """懒加载音频映射"""
    def __init__(self, file, start_time=0, duration=0):
        self.file = file
        self.start_time = start_time
        self.duration = duration
        self._dict = None
    
    def __getitem__(self, key):
        if self._dict is None:
            self._dict = get_audio(self.file, self.start_time, self.duration)
        return self._dict[key]
    
    def __iter__(self):
        if self._dict is None:
            self._dict = get_audio(self.file, self.start_time, self.duration)
        return iter(self._dict)
    
    def __len__(self):
        if self._dict is None:
            self._dict = get_audio(self.file, self.start_time, self.duration)
        return len(self._dict)


# ============================================================
# 索引处理
# ============================================================

def validate_index(index: int, length: int = 0, allow_negative=False) -> int:
    """验证索引是否有效"""
    if index < 0:
        if not allow_negative:
            raise IndexError(f"Negative indices not allowed, but was '{index}'.")
        index = length + index
        if index < 0:
            raise IndexError(f"Index '{index}' out of range.")
    elif length > 0 and index >= length:
        raise IndexError(f"Index '{index}' out of range for {length} item(s).")
    return index


def convert_str_to_indexes(indexes_str: str, length: int = 0) -> list[int]:
    """解析索引字符串 (e.g. "0,2:5,7")"""
    if not indexes_str:
        return []
    
    result = []
    for part in indexes_str.split(","):
        part = part.strip()
        if not part:
            continue
        
        if ":" in part:
            # 范围
            start, end = part.split(":", 1)
            start = int(start) if start else 0
            end = int(end) if end else length
            result.extend(range(start, end))
        else:
            result.append(int(part))
    
    return result


def select_indexes(input_obj: Union[Tensor, list], idxs: list):
    """根据索引选择元素"""
    if isinstance(input_obj, Tensor):
        return input_obj[idxs]
    return [input_obj[i] for i in idxs]


# ============================================================
# 装饰器
# ============================================================

def cached(duration):
    """缓存装饰器"""
    def decorator(f):
        cached_ret = None
        cache_time = 0
        
        def cached_func():
            nonlocal cache_time, cached_ret
            if time.time() > cache_time + duration or cached_ret is None:
                cache_time = time.time()
                cached_ret = f()
            return cached_ret
        
        return cached_func
    return decorator


# ============================================================
# 图像/视频格式常量
# ============================================================

VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'}
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tiff'}
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'}


# ============================================================
# 多输入类型支持
# ============================================================

class MultiInput(str):
    """支持多种类型的输入字符串"""
    def __new__(cls, string, allowed_types="*"):
        res = super().__new__(cls, string)
        res.allowed_types = allowed_types
        return res
    
    def __ne__(self, other):
        if self.allowed_types == "*" or other == "*":
            return False
        return other not in self.allowed_types


# ============================================================
# 其他工具
# ============================================================

def ensure_dir(path):
    """确保目录存在"""
    os.makedirs(path, exist_ok=True)
    return path


def get_extension(path):
    """获取文件扩展名（小写）"""
    return os.path.splitext(path)[1].lower()
