"""Non-destructive mask effects and framing in source-image pixel coordinates."""

from dataclasses import dataclass
import json
import math
import re

import numpy as np
from PIL import Image, ImageFilter


_ASPECTS = {"1:1": (1, 1), "4:3": (4, 3), "3:4": (3, 4), "16:9": (16, 9),
            "9:16": (9, 16), "3:2": (3, 2), "2:3": (2, 3)}
_MAX_MASK_RADIUS = 4096
_MAX_FRAME_SIDE = 16_384
_MAX_FRAME_PIXELS = 64_000_000
_HEX_COLOR = re.compile(r"#[0-9a-fA-F]{6}\Z")
_IMAGE_TRANSPOSES = {
    (False, True, False): Image.Transpose.FLIP_LEFT_RIGHT,
    (False, False, True): Image.Transpose.FLIP_TOP_BOTTOM,
    (False, True, True): Image.Transpose.ROTATE_180,
    (True, False, False): Image.Transpose.TRANSPOSE,
    (True, True, False): Image.Transpose.ROTATE_270,
    (True, False, True): Image.Transpose.ROTATE_90,
    (True, True, True): Image.Transpose.TRANSVERSE,
}


@dataclass(frozen=True)
class EditorAdjustments:
    grow: bool = False
    expand: int = 16
    feather: float = 0.0
    ratio: str = "original"
    framing: str = "crop"
    zoom: float = 1.0
    x: float = 0.5
    y: float = 0.5
    fill: str = "#ffffff"
    mask_fill: bool = True
    rotation: int = 0
    flip_x: bool = False
    flip_y: bool = False


_DEFAULTS = EditorAdjustments()


def _round_pixel(value):
    """Match Math.round, with ties toward positive infinity."""
    whole = math.floor(value)
    return whole + int(value - whole >= 0.5)


def _number(data, name, lower, upper):
    value = data.get(name, getattr(_DEFAULTS, name))
    if type(value) not in (int, float) or not lower <= value <= upper:
        raise ValueError(f"调整字段 {name} 需要在 {lower:g} 到 {upper:g} 之间。")
    return float(value)


def read_adjustment_values(value):
    if value is None or isinstance(value, str) and not value.strip():
        return {}
    try:
        data = json.loads(value)
    except (TypeError, ValueError) as error:
        raise ValueError("图像编辑调整需要有效的 JSON。") from error
    if not isinstance(data, dict):
        raise ValueError("图像编辑调整需要 JSON 对象。")
    return data


def parse_adjustments(value) -> EditorAdjustments:
    data = value if isinstance(value, dict) else read_adjustment_values(value)
    if not data:
        return _DEFAULTS
    grow = data.get("grow", _DEFAULTS.grow)
    mask_fill = data.get("mask_fill", _DEFAULTS.mask_fill)
    if type(grow) is not bool or type(mask_fill) is not bool:
        raise ValueError("遮罩扩张与补边遮罩开关需要为布尔值。")
    ratio = data.get("ratio", _DEFAULTS.ratio)
    framing = data.get("framing", _DEFAULTS.framing)
    if (not isinstance(ratio, str) or (ratio != "original" and ratio not in _ASPECTS)
            or framing not in ("crop", "pad")):
        raise ValueError("构图比例或裁剪补边方式无效。")
    fill = data.get("fill", _DEFAULTS.fill)
    if not isinstance(fill, str) or not _HEX_COLOR.fullmatch(fill):
        raise ValueError("补边颜色需要使用六位十六进制色值。")
    rotation = data.get("rotation", _DEFAULTS.rotation)
    flip_x = data.get("flip_x", _DEFAULTS.flip_x)
    flip_y = data.get("flip_y", _DEFAULTS.flip_y)
    if type(rotation) not in (int, float) or rotation not in (0, 90, 180, 270):
        raise ValueError("旋转角度需要是 0、90、180 或 270 度。")
    if type(flip_x) is not bool or type(flip_y) is not bool:
        raise ValueError("水平和垂直镜像开关需要为布尔值。")
    return EditorAdjustments(
        grow=grow,
        expand=_round_pixel(_number(data, "expand", 0, _MAX_MASK_RADIUS)),
        feather=_number(data, "feather", 0, _MAX_MASK_RADIUS),
        ratio=ratio,
        framing=framing,
        zoom=_number(data, "zoom", 0.25, 4),
        x=_number(data, "x", 0, 1),
        y=_number(data, "y", 0, 1),
        fill=fill.lower(),
        mask_fill=mask_fill,
        rotation=int(rotation),
        flip_x=flip_x,
        flip_y=flip_y,
    )


def _orientation_axes(settings):
    # A clockwise turn is an axis swap and flips. Combine those flips with the output-axis settings.
    rotation = settings.rotation
    return (rotation in (90, 270), settings.flip_x ^ (rotation in (90, 180)),
            settings.flip_y ^ (rotation in (180, 270)))


def orient_image(image: Image.Image, settings: EditorAdjustments) -> Image.Image:
    transform = _IMAGE_TRANSPOSES.get(_orientation_axes(settings))
    return image if transform is None else image.transpose(transform)


def orient_pixels(pixels: np.ndarray, settings: EditorAdjustments) -> np.ndarray:
    swap_axes, flip_x, flip_y = _orientation_axes(settings)
    if swap_axes:
        pixels = pixels.swapaxes(0, 1)
    # On singleton axes NumPy can retain negative strides even in a contiguous array.
    row_step = -1 if flip_y and pixels.shape[0] > 1 else 1
    column_step = -1 if flip_x and pixels.shape[1] > 1 else 1
    return pixels[::row_step, ::column_step]


def _check_allocation(size):
    if max(size) > _MAX_FRAME_SIDE or size[0] * size[1] > _MAX_FRAME_PIXELS:
        raise ValueError("编辑输出超出处理范围。请将画布限制在每边 16384 像素且总计 64 百万像素以内。")


def apply_mask_adjustments(mask: Image.Image, settings: EditorAdjustments) -> Image.Image:
    """Dilate soft alpha by local maximum, then feather it with a Gaussian blur."""
    grow = settings.grow and settings.expand > 0
    if not grow and settings.feather == 0:
        return mask
    _check_allocation(mask.size)
    low, high = mask.getextrema()
    if low == high:
        return mask

    if grow:
        from scipy.ndimage import maximum_filter1d

        x_radius = min(settings.expand, mask.width - 1)
        y_radius = min(settings.expand, mask.height - 1)
        # Two linear-time 1-D maximum filters give the same square neighborhood as the canvas.
        alpha = maximum_filter1d(np.asarray(mask), 2 * x_radius + 1, axis=1, mode="constant", cval=0)
        alpha = maximum_filter1d(alpha, 2 * y_radius + 1, axis=0, mode="constant", cval=0)
        mask = Image.fromarray(alpha)
    if settings.feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(settings.feather))
    return mask


def _frame_size(source, settings):
    if settings.ratio == "original":
        return source
    width, height = source
    ratio_width, ratio_height = _ASPECTS[settings.ratio]
    scaled_width = width * ratio_height
    scaled_height = height * ratio_width
    if settings.framing == "crop":
        if scaled_width >= scaled_height:
            return max(1, scaled_height // ratio_height), height
        return width, max(1, scaled_width // ratio_width)

    if scaled_width >= scaled_height:
        return width, (scaled_width + ratio_width - 1) // ratio_width
    return (scaled_height + ratio_height - 1) // ratio_height, height


def frame_geometry(size, settings: EditorAdjustments):
    """Return canvas size, scaled subject size, and integer placement offsets."""
    width, height = size
    if type(width) is not int or type(height) is not int or min(width, height) < 1:
        raise ValueError("原图宽高需要为正整数。")
    source_size = (width, height)
    output_size = _frame_size(source_size, settings)
    draw_size = (max(1, _round_pixel(width * settings.zoom)), max(1, _round_pixel(height * settings.zoom)))
    if output_size != source_size or draw_size != source_size:
        _check_allocation(output_size)
    left = _round_pixel((output_size[0] - draw_size[0]) * settings.x)
    top = _round_pixel((output_size[1] - draw_size[1]) * settings.y)
    return output_size, draw_size, left, top


def frame_layers(rgb: Image.Image, mask: Image.Image, settings: EditorAdjustments):
    """Apply one shared source-to-canvas placement to the image and the mask."""
    if rgb.mode != "RGB" or mask.mode != "L" or rgb.size != mask.size:
        raise ValueError("RGB 图像和灰度遮罩需要尺寸一致。")
    output_size, draw_size, left, top = frame_geometry(rgb.size, settings)
    if output_size == draw_size == rgb.size:
        return rgb, mask

    dest_x, dest_y = max(0, left), max(0, top)
    dest_right, dest_bottom = min(output_size[0], left + draw_size[0]), min(output_size[1], top + draw_size[1])
    visible_size = (dest_right - dest_x, dest_bottom - dest_y)
    source_box = (dest_x - left, dest_y - top, dest_right - left, dest_bottom - top)
    if draw_size != rgb.size:
        # Sample only the visible window; a large zoom must not allocate a full scaled intermediate.
        source_box = tuple(coordinate * rgb.size[index % 2] / draw_size[index % 2]
                           for index, coordinate in enumerate(source_box))

    def place(layer, fill, resample):
        if draw_size != layer.size:
            piece = layer.resize(visible_size, resample, box=source_box)
        elif visible_size != layer.size:
            piece = layer.crop(source_box)
        else:
            piece = layer
        if visible_size == output_size:
            return piece
        fitted = Image.new(layer.mode, output_size, fill)
        fitted.paste(piece, (dest_x, dest_y))
        return fitted

    return (place(rgb, settings.fill, Image.Resampling.LANCZOS),
            place(mask, 255 if settings.mask_fill else 0, Image.Resampling.BILINEAR))
