"""Run ComfyUI's native model upscaler as the editor's final output stage."""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path, PurePosixPath, PureWindowsPath
from stat import S_ISREG
from threading import Lock

import folder_paths
import torch
from comfy.utils import common_upscale

from .image_editor_geometry import _MAX_FRAME_SIDE, _check_allocation, _round_pixel


_MODEL_DIRECTORY = "upscale_models"
_INTERPOLATIONS = ("lanczos", "bicubic", "bilinear", "area", "nearest-exact")
_MODEL_LOCK = Lock()


@dataclass(frozen=True)
class UpscaleSettings:
    enabled: bool = False
    model: str = ""
    mode: str = "scale"
    factor: float = 2.0
    width: int = 1024
    method: str = "lanczos"
    multiple: int = 1


_DEFAULTS = UpscaleSettings()


def parse_upscale(value) -> UpscaleSettings:
    """Read the optional upscale object stored in editor adjustments."""
    if value is None:
        return _DEFAULTS
    if not isinstance(value, dict):
        raise ValueError("超分设置需要使用 JSON 对象。")
    enabled = value.get("enabled", _DEFAULTS.enabled)
    model = value.get("model", _DEFAULTS.model)
    mode = value.get("mode", _DEFAULTS.mode)
    factor = value.get("factor", _DEFAULTS.factor)
    width = value.get("width", _DEFAULTS.width)
    method = value.get("method", _DEFAULTS.method)
    multiple = value.get("multiple", _DEFAULTS.multiple)
    if type(enabled) is not bool or not isinstance(model, str):
        raise ValueError("超分设置需要布尔开关和模型文件名。")
    if mode not in ("scale", "width"):
        raise ValueError("超分尺寸模式无效。")
    if type(factor) not in (int, float) or not 1 <= factor <= 8:
        raise ValueError("超分倍率需要在 1 到 8 之间。")
    if type(width) is not int or not 1 <= width <= _MAX_FRAME_SIDE:
        raise ValueError(f"超分目标宽度需要是 1 到 {_MAX_FRAME_SIDE} 之间的整数。")
    if method not in _INTERPOLATIONS:
        raise ValueError("超分重采样方式无效。")
    if type(multiple) is not int or not 1 <= multiple <= 256:
        raise ValueError("超分对齐倍数需要是 1 到 256 之间的整数。")
    return UpscaleSettings(enabled, model, mode, float(factor), width, method, multiple)


def _checkpoint(name):
    if not name:
        raise ValueError("请先选择超分模型。")
    normalized = name.replace("\\", "/")
    relative = PurePosixPath(normalized)
    if relative.is_absolute() or PureWindowsPath(name).anchor or ".." in relative.parts:
        raise ValueError("超分模型需要使用注册目录中的相对文件名。")
    try:
        registered = next((item for item in folder_paths.get_filename_list(_MODEL_DIRECTORY)
                           if item.replace("\\", "/") == normalized), None)
        if registered is None:
            raise ValueError(f"找不到已注册的超分模型 {name!r}。")
        location = folder_paths.get_full_path(_MODEL_DIRECTORY, registered)
        if location is None:
            raise ValueError(f"找不到超分模型文件 {name!r}。")
        path = Path(location).resolve(strict=True)
        roots = (Path(root).resolve() for root in folder_paths.get_folder_paths(_MODEL_DIRECTORY))
        if not any(path.is_relative_to(root) for root in roots):
            raise ValueError(f"超分模型文件超出已注册目录 {name!r}。")
        info = path.stat()
        if not S_ISREG(info.st_mode):
            raise ValueError(f"无效的超分模型文件 {name!r}。")
    except (KeyError, OSError, RuntimeError) as error:
        raise ValueError(f"无法访问超分模型 {name!r}。") from error
    return registered, (str(path), info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def upscale_fingerprint(settings: UpscaleSettings):
    return _checkpoint(settings.model)[1] if settings.enabled else None


@lru_cache(maxsize=1)
def _load_model(name, fingerprint):
    try:
        from comfy_extras.nodes_upscale_model import UpscaleModelLoader

        model = UpscaleModelLoader.execute(name).result[0]
    except Exception as error:
        raise ValueError(f"无法加载超分模型 {name!r}。{error}") from error
    if _checkpoint(name)[1] != fingerprint:
        raise ValueError("超分模型文件在加载期间已更改，请重新运行。")
    return model


def _target_size(width, height, settings):
    if settings.mode == "width":
        desired = settings.width, height * settings.width / width
    else:
        desired = width * settings.factor, height * settings.factor
    multiple = settings.multiple
    return tuple(max(multiple, _round_pixel(side / multiple) * multiple) for side in desired)


def upscale_result(result, settings: UpscaleSettings):
    if not settings.enabled:
        return result

    image, mask, width, height = result
    if (not isinstance(image, torch.Tensor) or image.ndim != 4 or image.shape[-1] not in (3, 4)
            or image.shape[0] == 0 or min(width, height) < 1 or image.shape[1:3] != (height, width)
            or not isinstance(mask, torch.Tensor) or mask.shape != image.shape[:3]):
        raise ValueError("超分需要同尺寸的图像、遮罩和有效的输出宽高。")
    output_width, output_height = _target_size(width, height, settings)
    _check_allocation((output_width, output_height))

    with torch.inference_mode():
        # The native loader and upscaler share the cached model's device state.
        with _MODEL_LOCK:
            name, fingerprint = _checkpoint(settings.model)
            model = _load_model(name, fingerprint)
            native_scale = getattr(model, "scale", None)
            if type(native_scale) not in (int, float) or not 1 <= native_scale <= _MAX_FRAME_SIDE:
                raise ValueError("超分模型的原生倍率无效。")
            native_size = round(width * native_scale), round(height * native_scale)
            try:
                _check_allocation(native_size)
            except ValueError as error:
                raise ValueError(f"超分模型的原生输出 {native_size[0]}×{native_size[1]} 超出处理范围。"
                                 "请缩小输入图像或选择原生倍率更低的模型。") from error

            from comfy_extras.nodes_upscale_model import ImageUpscaleWithModel

            image = ImageUpscaleWithModel.execute(model, image).result[0]

        if (not isinstance(image, torch.Tensor) or image.ndim != 4 or image.shape[-1] not in (3, 4)
                or image.shape[0] != mask.shape[0] or min(image.shape[1:3]) < 1):
            raise ValueError("超分模型返回的图像尺寸无效。")
        _check_allocation((image.shape[2], image.shape[1]))
        if image.shape[1:3] != (output_height, output_width):
            channels = image.movedim(-1, 1)
            if settings.method == "lanczos" and channels.dtype == torch.bfloat16:
                channels = channels.float()
            scaled = common_upscale(channels, output_width, output_height, settings.method, "disabled")
            image = scaled.to(image.dtype).movedim(1, -1).clamp_(0, 1)
        if mask.shape[1:] != (output_height, output_width):
            mask = common_upscale(mask.unsqueeze(1), output_width, output_height, "bilinear", "disabled").squeeze(1)
    return image, mask, output_width, output_height
