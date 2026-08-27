# -*- coding: utf-8 -*-
"""
EagleFileTools — 工具函数
移植自 ComfyUI-HugoTools
"""

import os
import json
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import folder_paths
from PIL import Image

from .eagle_suite.logger import logger

_SETTINGS_LOCK = threading.RLock()
_MEDIA_ROOTS_LOCK = threading.RLock()
_SESSION_MEDIA_ROOTS = {"all": {}, "image": {}, "video": {}, "audio": {}}
_SESSION_MEDIA_ROOT_LIMIT = 128

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
    temp_path = ""
    try:
        with _SETTINGS_LOCK:
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            else:
                data = {}
            data[name] = value
            parent = os.path.dirname(config_path)
            os.makedirs(parent, exist_ok=True)
            fd, temp_path = tempfile.mkstemp(prefix=".comfy.settings.", suffix=".tmp", dir=parent)
            with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(temp_path, config_path)
            return True
    except Exception as e:
        logger.warning(f"[EagleFileTools] 保存设置失败: {e}")
        if temp_path:
            try:
                os.remove(temp_path)
            except OSError:
                pass
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


def get_allowed_media_roots(file_type="all"):
    """Return canonical directories exposed by the media-browser HTTP APIs.

    Extra roots can be configured with ``EAGLE_MEDIA_ROOTS`` (``;`` separated on
    Windows) or the existing EagleFileTools image/audio directory settings.
    """
    candidates = [
        folder_paths.get_input_directory(),
        folder_paths.get_output_directory(),
        folder_paths.get_temp_directory(),
    ]
    if file_type in ("all", "image", "video"):
        candidates.append(get_setting("EagleFileTools.image_path"))
    if file_type in ("all", "audio"):
        candidates.extend([
            get_setting("EagleFileTools.audio_path"),
            os.path.join(folder_paths.models_dir, "TTS", "MegaTTS3", "speakers"),
        ])
    candidates.extend(filter(None, os.environ.get("EAGLE_MEDIA_ROOTS", "").split(os.pathsep)))

    roots = []
    for candidate in candidates:
        if not candidate:
            continue
        try:
            canonical = os.path.normcase(os.path.realpath(os.path.abspath(os.path.expanduser(str(candidate)))))
            if os.path.isdir(canonical) and canonical not in roots:
                roots.append(canonical)
        except (OSError, ValueError):
            continue
    with _MEDIA_ROOTS_LOCK:
        session_types = ("all", file_type) if file_type != "all" else ("all",)
        for media_type in session_types:
            for root in _SESSION_MEDIA_ROOTS.get(media_type, {}):
                if root not in roots:
                    roots.append(root)
    return roots


def authorize_media_root(path, file_type="all"):
    """Authorize an existing absolute directory for this ComfyUI process.

    Media-browser UIs call this only when restoring or applying a directory the
    user selected. Descendant requests still pass through
    :func:`resolve_allowed_media_path`, so ``..`` and junction escapes remain
    blocked. UNC shares are intentionally supported on Windows.
    """
    if file_type not in _SESSION_MEDIA_ROOTS or not isinstance(path, (str, os.PathLike)):
        return ""
    raw_path = os.path.expanduser(str(path).strip())
    if not raw_path or not os.path.isabs(raw_path):
        return ""
    try:
        canonical = os.path.normcase(os.path.realpath(os.path.abspath(raw_path)))
        if not os.path.isdir(canonical):
            return ""
        with _MEDIA_ROOTS_LOCK:
            roots = _SESSION_MEDIA_ROOTS[file_type]
            roots[canonical] = time.monotonic()
            while len(roots) > _SESSION_MEDIA_ROOT_LIMIT:
                oldest = min(roots, key=roots.get)
                roots.pop(oldest, None)
        return canonical
    except (OSError, ValueError, TypeError):
        return ""


def clear_authorized_media_roots(file_type=None):
    """Clear process-local media roots (primarily useful for tests/reload)."""
    with _MEDIA_ROOTS_LOCK:
        if file_type in _SESSION_MEDIA_ROOTS:
            _SESSION_MEDIA_ROOTS[file_type].clear()
        elif file_type is None:
            for roots in _SESSION_MEDIA_ROOTS.values():
                roots.clear()


def is_trusted_browser_request(request):
    """Accept same-origin browser POSTs used to authorize a media directory."""
    headers = getattr(request, "headers", {})
    fetch_site = str(headers.get("Sec-Fetch-Site", "")).lower()
    if fetch_site and fetch_site not in {"same-origin", "same-site", "none"}:
        return False

    request_host = str(getattr(request, "host", "")).lower()
    for header_name in ("Origin", "Referer"):
        value = str(headers.get(header_name, "")).strip()
        if value:
            try:
                return urlparse(value).netloc.lower() == request_host
            except ValueError:
                return False

    # Non-browser local clients do not always send Origin/Referer.
    remote = str(getattr(request, "remote", "") or "").split("%", 1)[0]
    return remote in {"127.0.0.1", "::1", "localhost"}


def resolve_allowed_media_path(path, file_type="all", expected=None):
    """Resolve a path and reject paths outside explicitly allowed media roots.

    ``expected`` may be ``"file"`` or ``"directory"``.  Symlink/junction
    targets are checked through ``realpath`` so they cannot escape an allowed
    root.
    """
    if not path or not isinstance(path, (str, os.PathLike)):
        return ""
    try:
        canonical = os.path.normcase(os.path.realpath(os.path.abspath(os.path.expanduser(str(path)))))
        allowed = False
        for root in get_allowed_media_roots(file_type):
            try:
                if os.path.commonpath((canonical, root)) == root:
                    allowed = True
                    break
            except ValueError:
                continue
        if not allowed:
            return ""
        if expected == "file" and not os.path.isfile(canonical):
            return ""
        if expected == "directory" and not os.path.isdir(canonical):
            return ""
        return canonical
    except (OSError, ValueError, TypeError):
        return ""
