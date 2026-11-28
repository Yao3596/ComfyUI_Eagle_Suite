# -*- coding: utf-8 -*-
"""Load an editable image and its saved layers as ComfyUI tensors."""

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
from uuid import uuid4

import folder_paths
import numpy as np
from PIL import Image, ImageOps
import torch
from comfy_execution.graph_utils import ExecutionBlocker

from .image_editor_geometry import (
    apply_mask_adjustments, frame_layers, orient_image, orient_pixels, parse_adjustments, read_adjustment_values,
)
from .image_editor_upscale import parse_upscale, upscale_fingerprint, upscale_result


_LAYER_DIRECTORY = "eagle_image_editor"
_LINKED_SOURCE = "linked:"
_UNCONNECTED = object()
_LIMIT_EDGE = "限制长边"
_ORIGINAL = "原图"
_MEGAPIXELS = "按百万像素"
_SCALE = "等比例缩放"
_EXACT_SIZE = "指定尺寸"
_NO_ALIGNMENT = "关闭"
_CROP = "居中裁剪"
_EXPAND = "居中扩展"
_NEAREST = "nearest"
_MAX_DIMENSION = 16384
_MIN_MEGAPIXELS = 0.01
_MAX_MEGAPIXELS = 64.0


def _checked_file(root, relative):
    if relative.anchor or ".." in relative.parts:
        raise ValueError(f"图片路径无效 {str(relative)!r}。")
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f"找不到图片或图片路径超出目录 {str(relative)!r}。")
    return path


def _layer_path(input_root, value, label):
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label}图层需要一个 PNG 文件路径。")
    relative = Path(value)
    if relative.parts[:1] != (_LAYER_DIRECTORY,) or relative.suffix.lower() != ".png":
        raise ValueError(f"{label}图层需要保存在 {_LAYER_DIRECTORY}/ 目录中。")
    path = _checked_file(input_root, relative)
    if not path.is_relative_to(input_root / _LAYER_DIRECTORY):
        raise ValueError(f"{label}图层路径超出 {_LAYER_DIRECTORY}/ 目录。")
    return path


def _source_path(image):
    if image is None or image == "":
        return None
    if not isinstance(image, str):
        raise ValueError("请为源图选择一个图片文件。")
    name, annotated_root = folder_paths.annotated_filepath(image)
    root = Path(annotated_root or folder_paths.get_input_directory()).resolve()
    return _checked_file(root, Path(name))


def _edit_manifest(edit_layers):
    if edit_layers is None or edit_layers == "":
        return None
    try:
        manifest = json.loads(edit_layers) if isinstance(edit_layers, str) else None
    except json.JSONDecodeError as error:
        raise ValueError("编辑图层记录不是有效的 JSON。") from error
    if not isinstance(manifest, dict) or not isinstance(manifest.get("source"), str):
        raise ValueError("编辑图层记录缺少有效的源图。")
    return manifest


def _layer_paths(source, manifest):
    if manifest is None or manifest["source"] != source:
        return None, None
    input_root = Path(folder_paths.get_input_directory()).resolve()
    mask = _layer_path(input_root, manifest.get("mask"), "遮罩")
    paint = _layer_path(input_root, manifest.get("paint"), "涂鸦")
    return mask, paint


def _read_layer(path, size, label):
    try:
        with path.open("rb") as data:
            with Image.open(data, formats=["PNG"]) as image:
                if image.n_frames != 1 or ("A" not in image.getbands() and "transparency" not in image.info):
                    raise ValueError(f"{label}图层必须是带透明通道的单帧 PNG。")
                if image.size != size:
                    raise ValueError(f"{label}图层尺寸 {image.width}×{image.height} 与源图尺寸 {size[0]}×{size[1]} 不一致。")
                image.verify()
            with Image.open(data, formats=["PNG"]) as image:
                return image.convert("RGBA")
    except (OSError, SyntaxError, Image.DecompressionBombError) as error:
        raise ValueError(f"无法读取{label}图层 {path.name!r}。") from error


def _file_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_source(path):
    with Image.open(path) as opened:
        source = ImageOps.exif_transpose(opened)
        if not (source.mode.startswith("I;16") or (opened.format == "PNG" and source.mode == "I")):
            return source
    values = np.asarray(source)
    levels = np.rint(np.clip(values, 0, 65535).astype(np.float32) / 257).astype(np.uint8)
    grayscale = Image.fromarray(levels)
    transparent = source.info.get("transparency")
    if isinstance(transparent, int):
        grayscale.putalpha(Image.fromarray(np.where(values == transparent, 0, 255).astype(np.uint8)))
    return grayscale


def _has_alpha(source):
    return "A" in source.getbands() or "transparency" in source.info


def _white_png_background(source):
    if not _has_alpha(source):
        return None
    rgba = source if source.mode == "RGBA" else source.convert("RGBA")
    alpha = rgba.getchannel("A")
    if alpha.getextrema()[0] == 255:
        return None
    rgb = Image.new("RGB", source.size, "white")
    rgb.paste(rgba, mask=alpha)
    return rgb


def _linked_frame(image_input):
    if (not isinstance(image_input, torch.Tensor) or image_input.ndim != 4
            or image_input.shape[-1] not in (1, 3, 4) or not image_input.numel()):
        raise ValueError("连入图像需要至少一帧灰度、RGB 或 RGBA 图像。")
    frame = image_input[0].detach().to(device="cpu", dtype=torch.float32).contiguous()
    return frame.nan_to_num().clamp_(0, 1)


def _linked_identity(frame):
    height, width, channels = frame.shape
    digest = hashlib.sha256(f"{width}x{height}x{channels}:".encode("ascii"))
    digest.update(frame.numpy())
    return _LINKED_SOURCE + digest.hexdigest()


def _frame_image(frame):
    pixels = frame.mul(255).round_().to(torch.uint8).numpy()
    return Image.fromarray(pixels[:, :, 0] if pixels.shape[-1] == 1 else pixels)


def _temp_preview(image, filename):
    root = Path(folder_paths.get_temp_directory()).resolve()
    directory = root / _LAYER_DIRECTORY
    if not directory.resolve().is_relative_to(root):
        raise ValueError("图像编辑器临时目录无效。")
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / filename
    if not path.is_file():
        staged = directory / f".{uuid4().hex}.tmp"
        try:
            image.save(staged, format="PNG", compress_level=1)
            try:
                staged.replace(path)
            except PermissionError:
                if not path.is_file():
                    raise
        finally:
            staged.unlink(missing_ok=True)
    return {"filename": filename, "subfolder": _LAYER_DIRECTORY, "type": "temp"}


def _valid_points(points):
    return isinstance(points, list) and all(
        isinstance(point, list) and len(point) == 3
        and all(type(coord) in (int, float) and 0 <= coord <= 1 for coord in point[:2])
        and type(point[2]) is int and point[2] in (0, 1)
        for point in points
    )


@dataclass(frozen=True)
class _SamOptions:
    mode: str | None = None
    threshold: float = 0.5
    refine_iterations: int = 2
    source: str = ""
    points: tuple = ()


def _sam_options(value):
    if value is None:
        return _SamOptions()
    if not isinstance(value, dict):
        raise ValueError("SAM 设置需要使用 JSON 对象。")
    mode = value.get("mode")
    threshold = value.get("threshold", 0.5)
    refine = value.get("refine_iterations", 2)
    source = value.get("source", "")
    points = value.get("points", [])
    if mode not in (None, "points", "text"):
        raise ValueError("SAM 分割模式无效。")
    if type(threshold) not in (int, float) or not 0 <= threshold <= 1:
        raise ValueError("SAM 文本检测阈值需要在 0 到 1 之间。")
    if type(refine) is not int or not 0 <= refine <= 5:
        raise ValueError("SAM 细化迭代次数需要是 0 到 5 之间的整数。")
    if not isinstance(source, str) or not _valid_points(points) or len(points) > 64 or (points and not source):
        raise ValueError("保存的 SAM 提示点或源图无效。")
    return _SamOptions(mode, float(threshold), refine, source, tuple(map(tuple, points)))


def _editor_action(serialized):
    if serialized is None or serialized == "":
        return {}, None
    try:
        request = json.loads(serialized)
    except (ValueError, TypeError, RecursionError):
        return {}, "无法读取编辑器请求。"

    if not isinstance(request, dict) or not isinstance(request.get("id"), str) or not request["id"]:
        return {}, "编辑器请求缺少有效的 ID。"
    action = request.get("action")
    if action == "preview":
        return request, None
    if action != "segment":
        return request, "编辑器无法执行此操作。"
    if not isinstance(request.get("source"), str) or not request["source"]:
        return request, "请先预览需要分割的图像。"
    mode = request.get("mode", "points")
    if mode == "text":
        return request, None
    if mode != "points":
        return request, "编辑器无法使用此分割模式。"
    points = request.get("points")
    if not _valid_points(points):
        return request, "分割提示点坐标无效。"
    if not any(point[2] == 1 for point in points):
        return request, "请至少添加一个前景点。"
    return request, None


def _effective_sam_prompt(sam_text, sam_prompt):
    text = sam_prompt if sam_text is _UNCONNECTED else sam_text
    if not isinstance(text, str):
        return ""
    parts = text.replace("，", ",").splitlines()
    return ", ".join(part.strip() for line in parts for part in line.split(",") if part.strip())


def _segmentation_mode(request, error, options, sam_auto, prompt):
    if error:
        return None
    if request:
        return request.get("mode", "points") if request["action"] == "segment" else None
    if options.mode == "points":
        return "points" if any(point[2] for point in options.points) else None
    if prompt and (options.mode == "text" or options.mode is None and sam_auto):
        return "text"
    return None


def _is_native_sam3(model):
    diffusion_model = getattr(getattr(model, "model", None), "diffusion_model", None)
    return callable(getattr(diffusion_model, "forward_segment", None))


def _sam_mask(model, source, points, options, clip=None, prompt=None):
    text_mode = prompt is not None
    native_model = _is_native_sam3(model)
    if text_mode:
        if not prompt:
            raise ValueError("请填写 SAM 文本或连接文本输入。")
        if not native_model:
            raise ValueError("文本分割需要连接原生 SAM3 / SAM3.1 的 MODEL。")
        if clip is None:
            raise ValueError("文本分割需要连接对应检查点的 CLIP。")

    width, height = source.size
    coords = [(int(x * (width - 1) + 0.5), int(y * (height - 1) + 0.5)) for x, y, _ in points]
    labels = [point[2] for point in points]
    pixels = np.asarray(source.convert("RGB"))
    if native_model:
        try:
            from comfy_extras.nodes_sam3 import SAM3_Detect
        except ImportError as error:
            raise ValueError("当前 ComfyUI 版本缺少原生 SAM3 分割功能。") from error
        image = torch.from_numpy(pixels.astype(np.float32)).unsqueeze(0).div_(255)
        with torch.inference_mode():
            if text_mode:
                from nodes import CLIPTextEncode

                conditioning, = CLIPTextEncode().encode(clip, prompt)
                output = SAM3_Detect.execute(model, image, conditioning=conditioning, threshold=options.threshold,
                                             refine_iterations=options.refine_iterations)
            else:
                prompts = {1: [], 0: []}
                for (x, y), label in zip(coords, labels):
                    prompts[label].append({"x": x, "y": y})
                output = SAM3_Detect.execute(model, image, positive_coords=json.dumps(prompts[1]),
                                             negative_coords=json.dumps(prompts[0]),
                                             refine_iterations=options.refine_iterations)
        mask = output.result[0][0]
    else:
        wrapper = getattr(model, "sam_wrapper", model)
        if type(wrapper).__name__ == "ESAMWrapper" or not all(
            callable(getattr(wrapper, method, None)) for method in ("prepare_device", "predict", "release_device")
        ):
            raise ValueError("请连接 Impact SAMLoader 加载的 SAM 或原生 SAM3 / SAM3.1 模型。")
        try:
            wrapper.prepare_device()
            with torch.inference_mode():
                # Impact falls back to the single highest-rated mask above zero.
                candidates = wrapper.predict(pixels, coords, labels, None, float("inf"))
        finally:
            wrapper.release_device()
        mask = candidates[0] if candidates else None

    if isinstance(mask, torch.Tensor):
        mask = mask.detach().to(device="cpu", dtype=torch.float32).numpy()
    if mask is None or np.shape(mask) != (height, width):
        raise ValueError("SAM 返回的遮罩尺寸无效。")
    selected = np.asarray(mask) > 0
    if not text_mode and not selected.any():
        raise ValueError("SAM 没有找到可用遮罩，请调整提示点。")
    return Image.fromarray(selected.astype(np.uint8) * 255)


def _mask_preview(mask):
    width, height = mask.size
    candidate = Image.new("RGB", mask.size, "white")
    candidate.putalpha(mask)
    digest = hashlib.sha256(f"{width}x{height}:".encode("ascii"))
    digest.update(mask.tobytes())
    return _temp_preview(candidate, f"sam-{digest.hexdigest()}.png")


def _legacy_resize_options(serialized):
    if serialized is None or serialized == "":
        return None
    try:
        options = json.loads(serialized)
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError("旧版尺寸设置不是有效的 JSON。") from error
    if not isinstance(options, dict):
        raise ValueError("旧版尺寸设置需要使用 JSON 对象。")

    mode = options.get("mode")
    alignment = options.get("alignment", _NO_ALIGNMENT)
    if mode not in (_LIMIT_EDGE, _ORIGINAL, _SCALE, _EXACT_SIZE) or alignment not in (_NO_ALIGNMENT, _CROP, _EXPAND):
        raise ValueError("旧版尺寸模式或对齐方式无效。")

    percent = options.get("percent", 100)
    width = options.get("width", 0)
    height = options.get("height", 0)
    if type(percent) not in (int, float) or not 1 <= percent <= 400:
        raise ValueError("旧版缩放百分比无效。")
    if any(type(side) is not int or not 0 <= side <= _MAX_DIMENSION for side in (width, height)):
        raise ValueError("旧版输出宽高无效。")
    return mode, percent, width, height, alignment


def _resized_dimensions(size, mode, longest_edge, megapixels, percent, output_width, output_height):
    width, height = size
    if mode == _ORIGINAL:
        return size
    if mode == _LIMIT_EDGE:
        scale = min(1, longest_edge / max(size))
    elif mode == _MEGAPIXELS:
        if not _MIN_MEGAPIXELS <= megapixels <= _MAX_MEGAPIXELS:
            raise ValueError(f"百万像素需在 {_MIN_MEGAPIXELS:g} 到 {_MAX_MEGAPIXELS:g} 之间。")
        pixels = megapixels * 1_000_000
        # Keep a source with a subpixel short side within its area at one-pixel thickness.
        scale = min(math.sqrt(pixels / (width * height)), pixels / max(size))
    elif mode == _SCALE:
        scale = percent / 100
    elif mode == _EXACT_SIZE:
        if output_width and output_height:
            return output_width, output_height
        if output_width:
            scale = output_width / width
        elif output_height:
            scale = output_height / height
        else:
            return size
    else:
        raise ValueError(f"尺寸模式无效 {mode!r}。")
    return max(1, int(width * scale + 0.5)), max(1, int(height * scale + 0.5))


def _aligned_length(length, alignment, multiple):
    if alignment == _CROP:
        return length // multiple * multiple or length
    if alignment == _EXPAND:
        return length + (-length % multiple)
    if alignment == _NEAREST and length >= multiple:
        # Resolve exact ties toward the smaller size.
        return (length + (multiple - 1) // 2) // multiple * multiple
    return length


def _align_pixels(rgb, mask, alignment, multiple):
    height, width = mask.shape
    target_width = _aligned_length(width, alignment, multiple)
    target_height = _aligned_length(height, alignment, multiple)
    if (target_width, target_height) == (width, height):
        return rgb, mask

    left, top = max(0, (width - target_width) // 2), max(0, (height - target_height) // 2)
    region = np.s_[top:top + min(height, target_height), left:left + min(width, target_width)]
    rgb, mask = rgb[region], mask[region]

    extra_width, extra_height = max(0, target_width - width), max(0, target_height - height)
    if extra_width or extra_height:
        left, top = extra_width // 2, extra_height // 2
        padding = ((top, extra_height - top), (left, extra_width - left))
        rgb = np.pad(rgb, (*padding, (0, 0)), mode="edge")
        if alignment == _EXPAND:
            mask = np.pad(mask, padding, constant_values=1)
        else:
            mask = np.pad(mask, padding, mode="edge")
    return rgb, mask


def _render_source(source, frame, mask_path, paint_path, resize_options, alignment, multiple, adjustments,
                   detected_mask=None, white_background=None):
    source_size = source.size
    has_alpha = _has_alpha(source)
    if has_alpha and source.mode != "RGBA":
        source = source.convert("RGBA")
    if detected_mask is not None:
        mask = detected_mask
    elif mask_path is not None:
        mask = _read_layer(mask_path, source_size, "遮罩").getchannel("A")
    elif has_alpha:
        mask = ImageOps.invert(source.getchannel("A"))
    else:
        mask = Image.new("L", source_size)

    if white_background is not None:
        source = white_background
    if paint_path is not None:
        source = Image.alpha_composite(source.convert("RGBA"), _read_layer(paint_path, source_size, "涂鸦"))
    rgb = source if source.mode == "RGB" else source.convert("RGB")
    adjusted_mask = apply_mask_adjustments(mask, adjustments)
    oriented_rgb = orient_image(rgb, adjustments)
    oriented_mask = orient_image(adjusted_mask, adjustments)
    source_mask_unchanged = adjusted_mask is mask
    rgb, mask = frame_layers(oriented_rgb, oriented_mask, adjustments)
    size = _resized_dimensions(rgb.size, *resize_options)
    if size != rgb.size:
        rgb = rgb.resize(size, Image.Resampling.LANCZOS)
        mask = mask.resize(size, Image.Resampling.BILINEAR)

    # Axis swaps and flips can preserve linked precision when geometry needs no resampling.
    if frame is not None and paint_path is None and rgb is oriented_rgb:
        rgb_pixels = orient_pixels(frame[:, :, :3].expand(-1, -1, 3).numpy(), adjustments)
    else:
        rgb_pixels = np.asarray(rgb, dtype=np.float32)
        rgb_pixels /= 255
    if (frame is not None and frame.shape[-1] == 4 and mask_path is None
            and detected_mask is None and source_mask_unchanged and mask is oriented_mask):
        mask_pixels = orient_pixels((1 - frame[:, :, 3]).numpy(), adjustments)
    else:
        mask_pixels = np.asarray(mask, dtype=np.float32)
        mask_pixels /= 255

    rgb_pixels, mask_pixels = _align_pixels(rgb_pixels, mask_pixels, alignment, multiple)
    height, width = mask_pixels.shape
    image_tensor = torch.from_numpy(np.ascontiguousarray(rgb_pixels)).unsqueeze(0)
    mask_tensor = torch.from_numpy(np.ascontiguousarray(mask_pixels)).unsqueeze(0)
    return image_tensor, mask_tensor, width, height


def _ui_result(result, payload):
    return {"ui": {"eagle_image_editor": [payload]}, "result": result}


class EagleImageMaskEditor:
    CATEGORY = "🦅 Eagle Suite/媒体"
    DESCRIPTION = "加载或接入图像，支持手工编辑、SAM 点选、SAM3 文本分割和模型放大，输出图像、遮罩及像素尺寸。"
    SEARCH_ALIASES = ["加载图像", "遮罩编辑", "image loader", "mask editor"]
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("图像", "遮罩", "宽度", "高度")
    FUNCTION = "load_image"

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = Path(folder_paths.get_input_directory())
        files = [path.name for path in input_dir.iterdir() if path.is_file()] if input_dir.is_dir() else []
        images = folder_paths.filter_files_content_types(files, ["image"])
        return {
            "required": {
                "image": (["", *sorted(images)], {"default": ""}),
                "尺寸模式": ([_LIMIT_EDGE, _ORIGINAL, _MEGAPIXELS], {"default": _LIMIT_EDGE}),
                "最长边": ("INT", {"default": 2048, "min": 64, "max": _MAX_DIMENSION}),
                "百万像素": ("FLOAT", {
                    "default": 1.0, "min": _MIN_MEGAPIXELS, "max": _MAX_MEGAPIXELS,
                    "step": 0.01, "round": 0.01, "precision": 2,
                }),
                "对齐倍数": ("INT", {
                    "default": 8, "min": 1, "max": 256,
                    "tooltip": "按百万像素缩放时微调输出宽高。设为 1 时无需对齐。",
                }),
            },
            "optional": {
                "edit_layers": ("STRING", {"default": "", "multiline": False}),
                "legacy_resize": ("STRING", {"default": "", "multiline": False}),
                "image_input": ("IMAGE", {
                    "display_name": "图像输入",
                    "tooltip": "连线时编辑输入的第一张图像。点击“读取连线图像”载入预览。",
                }),
                "sam_model": ("SAM_MODEL,MODEL", {
                    "display_name": "SAM 模型",
                    "tooltip": "连接 Impact SAMLoader 或 ComfyUI 原生 SAM3 / SAM3.1 的 MODEL。",
                    "lazy": True,
                }),
                "clip": ("CLIP", {
                    "display_name": "CLIP",
                    "tooltip": "连接 SAM3 / SAM3.1 检查点对应的文本编码器。",
                    "lazy": True,
                }),
                "sam_text": ("STRING", {"display_name": "SAM 文本", "forceInput": True, "lazy": True}),
                "sam_prompt": ("STRING", {"default": "", "multiline": False}),
                "sam_auto": ("BOOLEAN", {"default": False}),
                "editor_adjustments": ("STRING", {"default": "", "multiline": False}),
                "editor_request": ("STRING", {"default": "", "multiline": False}),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, image, edit_layers="", legacy_resize="", image_input=_UNCONNECTED, editor_request="",
                        editor_adjustments=""):
        if editor_request:
            # Return editor errors in the request's UI response so the browser can clear the pending action.
            return True
        try:
            if image_input is not _UNCONNECTED or _source_path(image) is not None:
                if image_input is _UNCONNECTED:
                    _layer_paths(image, _edit_manifest(edit_layers))
                _legacy_resize_options(legacy_resize)
                values = read_adjustment_values(editor_adjustments)
                parse_adjustments(values)
                _sam_options(values.get("sam"))
                upscale_fingerprint(parse_upscale(values.get("upscale")))
        except (OSError, ValueError, RuntimeError) as error:
            return str(error)
        return True

    @classmethod
    def IS_CHANGED(cls, image, edit_layers="", image_input=_UNCONNECTED, editor_request="", editor_adjustments="", **_controls):
        try:
            if image_input is _UNCONNECTED:
                source = _source_path(image)
                layers = _layer_paths(image, _edit_manifest(edit_layers)) if source is not None else (None, None)
            else:
                source = None
                # ComfyUI provides the link placeholder here. Its upstream signature tracks the image itself.
                manifest = _edit_manifest(edit_layers)
                layers = _layer_paths(manifest["source"], manifest) if (
                    manifest is not None and manifest["source"].startswith(_LINKED_SOURCE)) else (None, None)
            files = tuple(_file_digest(path) if path is not None else None for path in (source, *layers))
            if editor_request or (source is None and image_input is _UNCONNECTED):
                return files
            values = read_adjustment_values(editor_adjustments)
            return (*files, upscale_fingerprint(parse_upscale(values.get("upscale"))))
        except (OSError, RuntimeError, ValueError):
            if image_input is not _UNCONNECTED or editor_request:
                return float("nan")
            raise

    def check_lazy_status(self, image, image_input=None, sam_model=_UNCONNECTED, editor_request="",
                          clip=_UNCONNECTED, sam_text=_UNCONNECTED, sam_prompt="", sam_auto=False,
                          editor_adjustments="", **_controls):
        request, error = _editor_action(editor_request)
        if error:
            return []
        try:
            options = _sam_options(read_adjustment_values(editor_adjustments).get("sam"))
        except ValueError:
            return []
        selection = options.mode or ("text" if sam_auto else None)
        reading = request.get("action") == "preview"
        if request:
            selection = request.get("mode", selection if reading else "points")
        if sam_text is None and selection == "text" and (
            reading or (sam_model is not _UNCONNECTED and clip is not _UNCONNECTED)
        ):
            return ["sam_text"]
        if sam_model is _UNCONNECTED:
            return []
        prompt = _effective_sam_prompt(sam_text, sam_prompt)
        mode = _segmentation_mode(request, error, options, sam_auto, prompt)
        if not mode:
            return []
        needed = ["sam_model"] if sam_model is None else []
        if mode == "text":
            if not prompt or clip is _UNCONNECTED or (sam_model is not None and not _is_native_sam3(sam_model)):
                return []
            if clip is None:
                needed.append("clip")
        if not needed:
            return []
        bound_source = request.get("source")
        if not request and mode == "points":
            bound_source = options.source
        try:
            if image_input is None:
                if _source_path(image) is None or (bound_source and bound_source != image):
                    return []
            elif bound_source and bound_source != _linked_identity(_linked_frame(image_input)):
                return []
        except (OSError, RuntimeError, ValueError):
            return []
        return needed

    def load_image(
        self, image, 尺寸模式=_LIMIT_EDGE, 最长边=2048, 百万像素=1.0, 对齐倍数=8,
        edit_layers="", legacy_resize="", image_input=None, sam_model=None, editor_request="",
        clip=None, sam_text=_UNCONNECTED, sam_prompt="", sam_auto=False, editor_adjustments="",
    ):
        request, error = _editor_action(editor_request)
        payload = {"source": image if isinstance(image, str) else ""}
        if "id" in request:
            payload["request_id"] = request["id"]
        if sam_text is not _UNCONNECTED and sam_text is not None:
            payload["sam_text"] = sam_text if isinstance(sam_text, str) else ""
        prompt = _effective_sam_prompt(sam_text, sam_prompt)
        frame = None
        white_background = None
        try:
            if image_input is not None:
                frame = _linked_frame(image_input)
                payload["source"] = _linked_identity(frame)
                source = _frame_image(frame)
                filename = f"linked-{payload['source'][len(_LINKED_SOURCE):]}.png"
                try:
                    payload["image"] = _temp_preview(source, filename)
                except (OSError, ValueError) as preview_error:
                    payload["error"] = f"无法保存连线图像预览。{preview_error}"
            else:
                path = _source_path(image)
                if path is None:
                    result = tuple(ExecutionBlocker(None) for _ in self.RETURN_TYPES)
                    if editor_request:
                        payload["error"] = error or "请先加载或连接图像。"
                    return _ui_result(result, payload) if editor_request or "sam_text" in payload else result
                source = _read_source(path)
                if path.suffix.lower() in (".png", ".apng"):
                    white_background = _white_png_background(source)

            mode, percent, width, height, alignment = _legacy_resize_options(legacy_resize) or (
                尺寸模式, 100, 0, 0, _NEAREST if 尺寸模式 == _MEGAPIXELS else _NO_ALIGNMENT,
            )
            if alignment != _NO_ALIGNMENT and not 1 <= 对齐倍数 <= 256:
                raise ValueError("对齐倍数需在 1 到 256 之间。")
            if mode == _LIMIT_EDGE and alignment == _EXPAND:
                # Leave enough room for padding within the cap, even when it isn't a multiple.
                aligned_cap = 最长边 // 对齐倍数 * 对齐倍数
                if aligned_cap:
                    最长边 = aligned_cap
                else:
                    alignment = _NO_ALIGNMENT
            values = read_adjustment_values(editor_adjustments)
            adjustments = parse_adjustments(values)
            options = _sam_options(values.get("sam"))
            segmentation = _segmentation_mode(request, error, options, sam_auto, prompt)
            if not request and (sam_model is None or segmentation == "points" and options.source != payload["source"]):
                segmentation = None
            mask_path, paint_path = _layer_paths(payload["source"], _edit_manifest(edit_layers))
            detected_mask = None
            if error:
                payload["error"] = error
            elif segmentation:
                if request and request["source"] != payload["source"]:
                    payload["error"] = "图像已更新，请重新预览后再分割。"
                else:
                    try:
                        points = request.get("points", options.points) if segmentation == "points" else ()
                        detected_mask = _sam_mask(sam_model, white_background or source, points, options, clip,
                                                  prompt if segmentation == "text" else None)
                    except ValueError as segment_error:
                        payload["error"] = str(segment_error)
                    except Exception as segment_error:
                        payload["error"] = f"SAM 分割失败。{segment_error}"
            resize_options = (mode, 最长边, 百万像素, percent, width, height)
            result = _render_source(source, frame, mask_path, paint_path, resize_options, alignment, 对齐倍数,
                                    adjustments, detected_mask, white_background)
            if not editor_request:
                result = upscale_result(result, parse_upscale(values.get("upscale")))
        except (OSError, ValueError, RuntimeError, Image.DecompressionBombError) as source_error:
            if not editor_request:
                raise
            payload["error"] = str(source_error)
            return _ui_result(tuple(ExecutionBlocker(None) for _ in self.RETURN_TYPES), payload)

        if detected_mask is not None:
            key = "mask" if request else "automatic_mask"
            payload["sam_mode"] = segmentation
            try:
                payload[key] = _mask_preview(detected_mask)
            except (OSError, ValueError, RuntimeError) as preview_error:
                payload["error"] = f"无法保存分割遮罩预览。{preview_error}"

        send_ui = (frame is not None or editor_request or detected_mask is not None
                   or "sam_text" in payload or "error" in payload)
        return _ui_result(result, payload) if send_ui else result
