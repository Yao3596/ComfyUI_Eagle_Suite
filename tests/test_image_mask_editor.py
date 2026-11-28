# -*- coding: utf-8 -*-
import asyncio
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from PIL import Image
import torch


REPO = Path(__file__).resolve().parents[1]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    sys.path.insert(0, str(Path(COMFY_ROOT).expanduser()))
SPEC = importlib.util.spec_from_file_location(
    "eagle_suite_image_editor_test_package",
    REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

import folder_paths
from comfy_execution.graph_utils import ExecutionBlocker


class PointPredictor:
    def __init__(self, error=None):
        self.error = error
        self.calls = []

    def prepare_device(self):
        self.calls.append("prepare")

    def predict(self, image, points, labels, bbox, threshold):
        self.calls.append((image, points, labels, bbox))
        if self.error:
            raise self.error
        mask = torch.zeros(image.shape[:2], dtype=torch.bool)
        mask[1:3, 2:5] = True
        return [mask.numpy()]

    def release_device(self):
        self.calls.append("release")


class TextClip:
    def __init__(self):
        self.calls = []
        self.conditioning = [[torch.zeros((1, 1, 1024)), {}]]

    def tokenize(self, text):
        self.calls.append(("tokenize", text))
        return {"text": text}

    def encode_from_tokens_scheduled(self, tokens):
        self.calls.append(("encode", tokens))
        return self.conditioning


class ImageMaskEditorTests(unittest.TestCase):
    def setUp(self):
        node_class = PACKAGE.NODE_CLASS_MAPPINGS.get("EagleImageMaskEditor")
        self.assertIsNotNone(node_class)
        self.node = node_class()
        resources = ExitStack()
        self.addCleanup(resources.close)
        self.root = Path(resources.enter_context(tempfile.TemporaryDirectory()))
        self.input = self.root / "input"
        self.layers = self.input / "eagle_image_editor"
        self.output = self.root / "output"
        self.temp = self.root / "temp"
        self.layers.mkdir(parents=True)
        self.output.mkdir()
        self.temp.mkdir()
        resources.enter_context(patch.object(folder_paths, "get_input_directory", return_value=str(self.input)))
        resources.enter_context(patch.object(folder_paths, "get_output_directory", return_value=str(self.output)))
        resources.enter_context(patch.object(folder_paths, "get_temp_directory", return_value=str(self.temp)))

    def run_editor(self, image, **options):
        return getattr(self.node, self.node.FUNCTION)(image, **options)

    def assert_shape(self, result, width, height):
        image, mask, out_width, out_height = result
        self.assertEqual((width, height), (out_width, out_height))
        self.assertEqual((1, height, width, 3), tuple(image.shape))
        self.assertEqual((1, height, width), tuple(mask.shape))
        self.assertEqual(torch.float32, image.dtype)
        self.assertEqual(torch.float32, mask.dtype)

    def save_png(self, filename, size=(9, 5), color=(255, 0, 0, 255)):
        path = self.input / filename
        Image.new("RGBA", size, color).save(path, compress_level=0)
        return path

    def temp_image(self, descriptor):
        self.assertEqual("temp", descriptor["type"])
        return Image.open(self.temp / descriptor["subfolder"] / descriptor["filename"])

    def segment_request(self, source, points=None):
        return json.dumps({
            "id": "segment-1", "action": "segment", "source": source,
            "points": points if points is not None else [[0.5, 1, 1], [0, 0.25, 0]],
        })

    def text_request(self, source="source.png"):
        return json.dumps({"id": "text-1", "action": "segment", "mode": "text", "source": source})

    def native_sam(self):
        return SimpleNamespace(model=SimpleNamespace(diffusion_model=SimpleNamespace(forward_segment=lambda: None)))

    def test_native_combo_and_silent_empty_outputs(self):
        self.save_png("image.png")
        (self.input / "other.txt").write_text("text", encoding="utf-8")
        inputs = self.node.INPUT_TYPES()
        required = inputs["required"]
        self.assertEqual(["image", "尺寸模式", "最长边", "百万像素", "对齐倍数"], list(required))
        self.assertEqual(["限制长边", "原图", "按百万像素"], required["尺寸模式"][0])
        self.assertEqual(2048, required["最长边"][1]["default"])
        self.assertEqual("FLOAT", required["百万像素"][0])
        self.assertEqual(1.0, required["百万像素"][1]["default"])
        self.assertLessEqual(required["百万像素"][1]["step"], 0.01)
        optional = inputs["optional"]
        self.assertEqual(["edit_layers", "legacy_resize", "image_input", "sam_model", "clip", "sam_text",
                          "sam_prompt", "sam_auto", "editor_adjustments", "editor_request"], list(optional))
        self.assertEqual("IMAGE", optional["image_input"][0])
        model_type, model_options = optional["sam_model"]
        self.assertEqual(model_type, "SAM_MODEL,MODEL")
        self.assertTrue(model_options["lazy"])
        self.assertEqual(model_options["display_name"], "SAM 模型")
        self.assertEqual("STRING", optional["editor_request"][0])
        self.assertEqual("CLIP", optional["clip"][0])
        self.assertEqual("CLIP", optional["clip"][1]["display_name"])
        self.assertTrue(optional["clip"][1]["lazy"])
        self.assertEqual("STRING", optional["sam_text"][0])
        self.assertEqual("SAM 文本", optional["sam_text"][1]["display_name"])
        self.assertTrue(optional["sam_text"][1]["forceInput"])
        self.assertEqual("", optional["sam_prompt"][1]["default"])
        self.assertIs(False, optional["sam_auto"][1]["default"])
        self.assertEqual("", optional["editor_adjustments"][1]["default"])
        self.assertFalse(getattr(self.node, "OUTPUT_NODE", False))
        self.assertEqual(["", "image.png"], required["image"][0])
        self.assertEqual("", required["image"][1]["default"])
        self.assertNotIn("image_upload", required["image"][1])
        self.assertEqual(("IMAGE", "MASK", "INT", "INT"), self.node.RETURN_TYPES)
        self.assertEqual(("图像", "遮罩", "宽度", "高度"), self.node.RETURN_NAMES)
        self.assertIs(self.node.VALIDATE_INPUTS(""), True)
        outputs = self.run_editor("")
        self.assertEqual(4, len(outputs))
        for output in outputs:
            self.assertIsInstance(output, ExecutionBlocker)
            self.assertIsNone(output.message)

    def test_prompt_validation_accepts_annotated_subfolder_and_rejects_escape(self):
        from execution import validate_inputs
        from nodes import NODE_CLASS_MAPPINGS

        (self.output / "sub").mkdir()
        Image.new("RGB", (3, 2)).save(self.output / "sub" / "file.png")
        Image.new("RGB", (3, 2)).save(self.root / "outside.png")
        self.assert_shape(self.run_editor("sub/file.png [output]"), 3, 2)
        self.assertIsNot(self.node.VALIDATE_INPUTS(str(self.root / "outside.png")), True)
        with patch.dict(NODE_CLASS_MAPPINGS, {"EagleImageMaskEditor": type(self.node)}):
            required = self.node.INPUT_TYPES()["required"]
            values = {name: options["default"] for name, (_, options) in required.items()}
            prompt = {"1": {"class_type": "EagleImageMaskEditor", "inputs": values}}
            for filename, expected in (("", True), ("sub/file.png [output]", True), ("../outside.png", False)):
                with self.subTest(filename=filename):
                    values["image"] = filename
                    valid, reasons, _ = asyncio.run(validate_inputs("test-prompt", prompt, "1", {}))
                    self.assertEqual(expected, valid, reasons)

    def test_exif_orientation_applies_to_color_and_native_inverted_alpha(self):
        source = Image.new("RGBA", (3, 2), (0, 0, 255, 255))
        source.putpixel((0, 0), (255, 0, 0, 64))
        exif = Image.Exif()
        exif[274] = 6
        source.save(self.input / "oriented.png", exif=exif)
        result = self.run_editor("oriented.png")
        self.assert_shape(result, 2, 3)
        image, mask = result[:2]
        torch.testing.assert_close(image[0, 0, 1], torch.tensor([255, 191, 191]) / 255.0)
        self.assertAlmostEqual(191 / 255, mask[0, 0, 1].item())
        self.assertEqual(0, mask[0, 0, 0].item())

    def test_animated_source_uses_first_frame_and_full_size_zero_mask(self):
        red = Image.new("RGB", (9, 5), "red")
        blue = Image.new("RGB", (9, 5), "blue")
        red.save(self.input / "two-frames.gif", save_all=True, append_images=[blue], duration=100)
        result = self.run_editor("two-frames.gif")
        self.assert_shape(result, 9, 5)
        image, mask = result[:2]
        self.assertEqual([1, 0, 0], image[0, 0, 0].tolist())
        self.assertEqual(0, torch.count_nonzero(mask).item())

    def test_sixteen_bit_png_preserves_the_grayscale_range(self):
        import numpy as np

        Image.fromarray(np.array([[0, 256, 32768, 65535]], dtype=np.uint16)).save(self.input / "depth.png")
        result = self.run_editor("depth.png")
        self.assert_shape(result, 4, 1)
        values = (result[0][0, 0, :, 0] * 255).round().int().tolist()
        self.assertEqual([0, 1, 128, 255], values)

    def test_original_and_limit_edge_keep_their_output_geometry(self):
        self.save_png("wide.png", (2050, 20))
        self.assert_shape(self.run_editor("wide.png"), 2048, 20)
        self.assert_shape(self.run_editor("wide.png", 尺寸模式="原图"), 2050, 20)
        self.save_png("source.png")
        self.assert_shape(self.run_editor("source.png", 对齐倍数=16), 9, 5)
        self.assert_shape(self.run_editor("source.png", 尺寸模式="原图", 对齐倍数=16), 9, 5)

    def test_megapixel_resize_scales_portrait_to_decimal_fractional_area(self):
        self.save_png("portrait.png", (320, 480))
        result = self.run_editor("portrait.png", 尺寸模式="按百万像素", 百万像素=1.5, 对齐倍数=1)
        self.assert_shape(result, 1000, 1500)
        result = self.run_editor("portrait.png", 尺寸模式="按百万像素", 百万像素=1.5)
        self.assert_shape(result, 1000, 1496)

    def test_megapixel_matching_geometry_does_not_select_opaque_padding(self):
        source = Image.new("RGBA", (80, 125), (0, 0, 255, 255))
        source.putpixel((19, 50), (255, 0, 0, 0))
        source.save(self.input / "source.png")
        result = self.run_editor("source.png", 尺寸模式="按百万像素", 百万像素=0.01)
        self.assert_shape(result, 80, 128)
        image, mask = result[:2]
        self.assertEqual([1, 1, 1], image[0, 51, 19].tolist())
        self.assertEqual(1, mask[0, 51, 19].item())
        self.assertEqual(1, torch.count_nonzero(mask).item())

    def test_megapixel_alignment_keeps_a_side_smaller_than_the_multiple(self):
        self.save_png("sliver.png", (1, 10000))
        result = self.run_editor("sliver.png", 尺寸模式="按百万像素", 百万像素=0.01, 对齐倍数=64)
        self.assert_shape(result, 1, 9984)

    def test_legacy_settings_preserve_percentage_and_exact_size(self):
        self.save_png("source.png")
        for settings, width, height in (
            ({"mode": "等比例缩放", "percent": 50}, 5, 3),
            ({"mode": "等比例缩放", "percent": 200}, 18, 10),
            ({"mode": "指定尺寸"}, 9, 5),
            ({"mode": "指定尺寸", "width": 18}, 18, 10),
            ({"mode": "指定尺寸", "height": 10}, 18, 10),
            ({"mode": "指定尺寸", "width": 7, "height": 6}, 7, 6),
        ):
            with self.subTest(settings=settings):
                result = self.run_editor("source.png", 尺寸模式="原图", legacy_resize=json.dumps(settings))
                self.assert_shape(result, width, height)

    def test_legacy_center_crop_uses_same_coordinates_for_image_and_mask(self):
        source = Image.new("RGBA", (13, 11), (0, 0, 255, 255))
        source.putpixel((2, 1), (255, 0, 0, 0))
        source.save(self.input / "crop.png")
        legacy = json.dumps({"mode": "原图", "alignment": "居中裁剪"})
        result = self.run_editor("crop.png", legacy_resize=legacy)
        self.assert_shape(result, 8, 8)
        image, mask = result[:2]
        self.assertEqual([1, 1, 1], image[0, 0, 0].tolist())
        self.assertEqual(1, mask[0, 0, 0].item())
        self.assertEqual(1, torch.count_nonzero(mask).item())

        self.save_png("sliver.png", (1, 31))
        self.assert_shape(self.run_editor("sliver.png", legacy_resize=legacy), 1, 24)

    def test_legacy_center_expand_extends_edge_colors_and_marks_new_pixels(self):
        source = Image.new("RGBA", (9, 5), (0, 0, 255, 255))
        source.putpixel((0, 0), (255, 0, 0, 255))
        source.putpixel((2, 4), (0, 255, 0, 0))
        source.save(self.input / "expand.png")
        legacy = json.dumps({"mode": "原图", "alignment": "居中扩展"})
        result = self.run_editor("expand.png", legacy_resize=legacy)
        self.assert_shape(result, 16, 8)
        image, mask = result[:2]
        self.assertEqual([1, 0, 0], image[0, 0, 0].tolist())
        self.assertEqual([1, 1, 1], image[0, 5, 5].tolist())
        self.assertEqual(0, mask[0, 1, 3].item())
        self.assertEqual(1, mask[0, 5, 5].item())
        self.assertEqual(16 * 8 - 9 * 5 + 1, torch.count_nonzero(mask).item())

    def test_legacy_long_edge_limit_also_applies_after_expansion(self):
        self.save_png("wide.png", (150, 37))
        legacy = json.dumps({"mode": "限制长边", "alignment": "居中扩展"})
        capped = self.run_editor("wide.png", 最长边=100, 对齐倍数=16, legacy_resize=legacy)
        self.assert_shape(capped, 96, 32)
        self.assertEqual(8 * 96, torch.count_nonzero(capped[1]).item())
        impossible = self.run_editor("wide.png", 最长边=64, 对齐倍数=128, legacy_resize=legacy)
        self.assert_shape(impossible, 64, 16)

    def test_invalid_legacy_resize_is_rejected_at_validation_and_execution(self):
        self.save_png("source.png")
        for serialized in (
            "{", "[]", "{}", '{"mode": "foo"}',
            '{"mode": "原图", "alignment": "foo"}',
            '{"mode": "等比例缩放", "percent": NaN}',
            '{"mode": "指定尺寸", "width": -1}',
        ):
            with self.subTest(serialized=serialized):
                self.assertIsInstance(self.node.VALIDATE_INPUTS("source.png", legacy_resize=serialized), str)
                with self.assertRaises(ValueError):
                    self.run_editor("source.png", legacy_resize=serialized)

    def test_saved_layers_use_mask_coverage_and_rgba_paint(self):
        source = Image.new("RGBA", (2, 1), (255, 0, 0, 255))
        source.putpixel((1, 0), (0, 0, 255, 0))
        source.save(self.input / "source.png")
        mask_path = "eagle_image_editor/mask.png"
        paint_path = "eagle_image_editor/paint.png"
        manifest = json.dumps({"source": "source.png", "mask": mask_path, "paint": paint_path})
        self.save_png(mask_path, (2, 1), (0, 0, 0, 0))
        paint = Image.new("RGBA", (2, 1), (0, 0, 0, 0))
        paint.putpixel((0, 0), (0, 255, 0, 128))
        paint.save(self.input / paint_path)

        image, mask = self.run_editor("source.png", edit_layers=manifest)[:2]
        self.assertEqual([[0, 0]], mask[0].tolist())
        torch.testing.assert_close(image[0, 0, 0], torch.tensor([127, 128, 0]) / 255.0)
        self.assertEqual([1, 1, 1], image[0, 0, 1].tolist())

        mask = Image.new("RGBA", (2, 1), (0, 0, 0, 0))
        mask.putpixel((0, 0), (0, 0, 0, 128))
        mask.save(self.input / mask_path)
        legacy = json.dumps({"mode": "指定尺寸", "height": 2})
        resized = self.run_editor("source.png", edit_layers=manifest, legacy_resize=legacy)
        self.assert_shape(resized, 4, 2)
        self.assertAlmostEqual(128 / 255, resized[1][0, 0, 0].item())
        self.assertEqual(0, resized[1][0, 0, 3].item())

    def test_manifest_for_previous_source_is_ignored(self):
        self.save_png("source.png", color=(255, 0, 0, 0))
        stale = json.dumps({"source": "previous.png", "mask": "missing.png", "paint": False})
        self.assertIs(self.node.VALIDATE_INPUTS("source.png", stale), True)
        image, mask = self.run_editor("source.png", edit_layers=stale)[:2]
        self.assertEqual([1, 1, 1], image[0, 0, 0].tolist())
        self.assertEqual(1, mask.min().item())

    def test_malformed_manifest_and_invalid_layer_files_fail(self):
        self.save_png("source.png")
        self.save_png("mask-outside-editor.png")
        self.save_png("eagle_image_editor/wrong-size.png", (3, 4))
        Image.new("RGB", (9, 5)).save(self.layers / "no-alpha.png")
        Image.new("RGB", (9, 5)).save(self.layers / "fake.png", format="JPEG")
        (self.layers / "corrupt.png").write_bytes(b"not an image")
        truncated = self.save_png("eagle_image_editor/truncated.png")
        truncated.write_bytes(truncated.read_bytes()[:-12])
        for path in (
            "mask-outside-editor.png",
            "eagle_image_editor/../mask-outside-editor.png",
            "eagle_image_editor/missing.png",
            "eagle_image_editor/wrong-size.png",
            "eagle_image_editor/no-alpha.png",
            "eagle_image_editor/fake.png",
            "eagle_image_editor/corrupt.png",
            "eagle_image_editor/truncated.png",
            1,
        ):
            with self.subTest(layer=path), self.assertRaises(ValueError):
                self.run_editor("source.png", edit_layers=json.dumps({"source": "source.png", "mask": path}))
        for manifest in ("{", "[]", '{"mask": "example.png"}'):
            with self.subTest(manifest=manifest), self.assertRaises(ValueError):
                self.run_editor("source.png", edit_layers=manifest)

    def test_fingerprint_detects_same_size_and_mtime_replacements(self):
        self.save_png("source.png")
        mask_path = "eagle_image_editor/mask.png"
        paint_path = "eagle_image_editor/paint.png"
        manifest = json.dumps({"source": "source.png", "mask": mask_path, "paint": paint_path})
        self.save_png(mask_path)
        self.save_png(paint_path)
        for filename in ("source.png", mask_path, paint_path):
            with self.subTest(filename=filename):
                before = self.node.IS_CHANGED("source.png", manifest, 尺寸模式="原图")
                path = self.input / filename
                previous = path.stat()
                self.save_png(filename, color=(0, 255, 0, 128))
                os.utime(path, ns=(previous.st_atime_ns, previous.st_mtime_ns))
                after_stat = path.stat()
                self.assertEqual((previous.st_size, previous.st_mtime_ns), (after_stat.st_size, after_stat.st_mtime_ns))
                self.assertNotEqual(before, self.node.IS_CHANGED("source.png", manifest, 尺寸模式="原图"))

    def test_linked_image_overrides_file_and_previews_cached_first_frame(self):
        frame = torch.full((2, 3, 5, 3), 0.23456)
        frame[1] = 1
        editor = self.run_editor("missing-local-file.png", image_input=frame)
        self.assert_shape(editor["result"], 5, 3)
        torch.testing.assert_close(frame[:1], editor["result"][0])
        payload = editor["ui"]["eagle_image_editor"][0]
        self.assertTrue(payload["source"].startswith("linked:"))
        with self.temp_image(payload["image"]) as preview:
            self.assertEqual((5, 3), preview.size)
            self.assertEqual((60, 60, 60), preview.getpixel((4, 2)))

        different_second_frame = frame.clone()
        different_second_frame[1] = 0
        explicit_preview = self.run_editor("", image_input=different_second_frame,
                                           editor_request='{"id":"preview-1","action":"preview"}')
        self.assertEqual({**payload, "request_id": "preview-1"}, explicit_preview["ui"]["eagle_image_editor"][0])
        self.assertEqual(1, len(list(self.temp.rglob("*.png"))))

    def test_linked_orientation_preserves_float_color_and_alpha_and_keeps_raw_preview(self):
        frame = torch.arange(1, 25, dtype=torch.float32).reshape(1, 2, 3, 4) / 31
        settings = json.dumps({"rotation": 90, "flip_y": True})
        result = self.run_editor("", image_input=frame, editor_adjustments=settings)
        self.assert_shape(result["result"], 2, 3)
        expected = frame.reshape(6, 4)[[5, 2, 4, 1, 3, 0]].reshape(1, 3, 2, 4)
        torch.testing.assert_close(expected[..., :3], result["result"][0], rtol=0, atol=0)
        torch.testing.assert_close(1 - expected[..., 3], result["result"][1], rtol=0, atol=0)
        payload = result["ui"]["eagle_image_editor"][0]
        with self.temp_image(payload["image"]) as preview:
            self.assertEqual((3, 2), preview.size)

    def test_linked_rotation_accepts_a_single_pixel_axis(self):
        for channels in (3, 4):
            with self.subTest(channels=channels):
                frame = torch.arange(1, 3 * channels + 1, dtype=torch.float32).reshape(1, 1, 3, channels) / 13
                result = self.run_editor("", image_input=frame, editor_adjustments='{"rotation":90}')["result"]
                self.assert_shape(result, 1, 3)
                expected = frame.transpose(1, 2)
                torch.testing.assert_close(expected[..., :3], result[0], rtol=0, atol=0)
                if channels == 4:
                    torch.testing.assert_close(1 - expected[..., 3], result[1], rtol=0, atol=0)

    def test_validation_ignores_stale_local_file_when_image_is_linked(self):
        from execution import validate_inputs
        from nodes import NODE_CLASS_MAPPINGS

        class ImageFeed:
            RETURN_TYPES = ("IMAGE",)

            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {}}

        values = {name: options["default"] for name, (_, options) in self.node.INPUT_TYPES()["required"].items()}
        values.update(image="missing.png", image_input=["1", 0])
        prompt = {"1": {"class_type": "TestImageFeed", "inputs": {}},
                  "2": {"class_type": "EagleImageMaskEditor", "inputs": values}}
        with patch.dict(NODE_CLASS_MAPPINGS, {"TestImageFeed": ImageFeed, "EagleImageMaskEditor": type(self.node)}):
            valid, reasons, _ = asyncio.run(validate_inputs("test-prompt", prompt, "2", {}))
        self.assertTrue(valid, reasons)

    def test_linked_edit_layers_follow_first_frame_fingerprint(self):
        frame = torch.zeros((1, 5, 9, 3))
        first = self.run_editor("", image_input=frame)
        source = first["ui"]["eagle_image_editor"][0]["source"]
        relative = "eagle_image_editor/linked-mask.png"
        manifest = json.dumps({"source": source, "mask": relative})
        mask_file = self.save_png(relative, color=(0, 0, 0, 64))
        edited = self.run_editor("", image_input=frame.clone(), edit_layers=manifest)
        self.assertAlmostEqual(64 / 255, edited["result"][1][0, 0, 0].item())

        previous = self.node.IS_CHANGED("missing.png", edit_layers=manifest, image_input=None)
        self.save_png(relative, color=(0, 0, 0, 128))
        self.assertNotEqual(previous, self.node.IS_CHANGED("missing.png", edit_layers=manifest, image_input=None))
        mask_file.unlink()

        different = frame.clone()
        different[0, 4, 8, 2] = 0.001
        updated = self.run_editor("", image_input=different, edit_layers=manifest)
        self.assertNotEqual(source, updated["ui"]["eagle_image_editor"][0]["source"])
        self.assertEqual(0, torch.count_nonzero(updated["result"][1]).item())

    def test_sam_uses_raw_local_image_and_returns_temp_mask_without_overwriting_edits(self):
        self.save_png("source.png")
        paint_file = self.save_png("eagle_image_editor/paint.png", color=(0, 255, 0, 255))
        mask_file = self.save_png("eagle_image_editor/mask.png", color=(0, 0, 0, 255))
        original_files = paint_file.read_bytes(), mask_file.read_bytes()
        layers = json.dumps({"source": "source.png", "mask": "eagle_image_editor/mask.png",
                             "paint": "eagle_image_editor/paint.png"})
        predictor = PointPredictor()
        result = self.run_editor("source.png", edit_layers=layers, sam_model=SimpleNamespace(sam_wrapper=predictor),
                                 editor_request=self.segment_request("source.png"),
                                 legacy_resize='{"mode":"指定尺寸","width":4,"height":2}')
        payload = result["ui"]["eagle_image_editor"][0]
        self.assertEqual("segment-1", payload["request_id"])
        self.assertEqual("source.png", payload["source"])
        self.assertNotIn("image", payload)
        self.assertNotIn("error", payload)
        self.assert_shape(result["result"], 4, 2)
        self.assertEqual([0, 1, 0], result["result"][0][0, 0, 0].tolist())
        self.assertLess(result["result"][1].min().item(), 1)
        self.assertGreater(result["result"][1].max().item(), 0)
        self.assertEqual(original_files, (paint_file.read_bytes(), mask_file.read_bytes()))

        self.assertEqual("prepare", predictor.calls[0])
        pixels, points, labels, bbox = predictor.calls[1]
        self.assertEqual((5, 9, 3), pixels.shape)
        self.assertEqual([255, 0, 0], pixels[0, 0].tolist())
        self.assertEqual([(4, 4), (0, 1)], points)
        self.assertEqual([1, 0], labels)
        self.assertIsNone(bbox)
        self.assertEqual("release", predictor.calls[2])
        with self.temp_image(payload["mask"]) as candidate:
            self.assertEqual((9, 5), candidate.size)
            self.assertEqual("RGBA", candidate.mode)
            self.assertEqual(255, candidate.getpixel((2, 1))[3])
            self.assertEqual(0, candidate.getpixel((0, 0))[3])

    def test_sam_model_is_requested_only_for_current_segment_action(self):
        self.save_png("source.png")
        segment = self.segment_request("source.png")
        self.assertEqual([], self.node.check_lazy_status("source.png", sam_model=None))
        self.assertEqual([], self.node.check_lazy_status("source.png", sam_model=None,
                                                       editor_request='{"id":"preview-1","action":"preview"}'))
        self.assertEqual([], self.node.check_lazy_status("source.png", editor_request=segment))
        self.assertEqual(["sam_model"], self.node.check_lazy_status("source.png", sam_model=None,
                                                                  editor_request=segment))

        frame = torch.zeros((1, 5, 9, 3))
        source = self.run_editor("", image_input=frame)["ui"]["eagle_image_editor"][0]["source"]
        self.assertEqual(["sam_model"], self.node.check_lazy_status("", sam_model=None, image_input=frame,
                                                                  editor_request=self.segment_request(source)))
        self.assertEqual([], self.node.check_lazy_status("", sam_model=None, image_input=frame,
                                                       editor_request=self.segment_request("linked:old-image")))

    def test_partial_editor_execution_loads_linked_model_only_for_segment(self):
        from execution import PromptExecutor, validate_prompt
        from nodes import NODE_CLASS_MAPPINGS
        from eagle_suite_image_editor_test_package.eagle_suite.execution_isolation import make_prompt_filter

        calls = []

        class ModelFeed:
            RETURN_TYPES = ("SAM_MODEL",)
            FUNCTION = "load_model"

            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {}}

            def load_model(self):
                calls.append("load")
                return (PointPredictor(),)

        self.save_png("source.png")
        values = {name: options["default"] for name, (_, options) in self.node.INPUT_TYPES()["required"].items()}
        values.update(image="source.png", sam_model=["1", 0])
        prompt = {"1": {"class_type": "TestModelFeed", "inputs": {}},
                  "2": {"class_type": "EagleImageMaskEditor", "inputs": values}}
        registry = {**NODE_CLASS_MAPPINGS, **PACKAGE.NODE_CLASS_MAPPINGS, "TestModelFeed": ModelFeed}
        run_filter = make_prompt_filter(PACKAGE.NODE_CLASS_MAPPINGS, registry)
        server = SimpleNamespace(client_id=None, last_node_id=None, sockets_metadata={}, send_sync=lambda *_: None)
        executor = PromptExecutor(server, cache_type=False, cache_args={"ram": 0.0, "ram_inactive": 0.0})

        def execute(request, prompt_id):
            values["editor_request"] = request
            submission = run_filter({"prompt": prompt, "partial_execution_targets": ["2"]})
            valid, error, targets, node_errors = asyncio.run(validate_prompt(
                prompt_id, submission["prompt"], submission["partial_execution_targets"]))
            self.assertTrue(valid, error)
            self.assertFalse(node_errors)
            executor.execute(submission["prompt"], prompt_id, {}, execute_outputs=targets)
            self.assertTrue(executor.success, executor.status_messages)
            return executor.history_result["outputs"]["2"]["eagle_image_editor"][0]

        with patch.dict(NODE_CLASS_MAPPINGS, registry):
            preview = execute('{"id":"preview-1","action":"preview"}', "test-preview")
            self.assertEqual("preview-1", preview["request_id"])
            self.assertEqual([], calls)
            segmented = execute(self.segment_request("source.png"), "test-segment")
            self.assertIn("mask", segmented)
            self.assertEqual(["load"], calls)

    def test_no_source_and_invalid_editor_requests_report_ui_errors(self):
        empty = self.run_editor("", editor_request='{"id":"preview-1","action":"preview"}')
        self.assertTrue(all(isinstance(value, ExecutionBlocker) for value in empty["result"]))
        self.assertEqual("preview-1", empty["ui"]["eagle_image_editor"][0]["request_id"])
        self.assertTrue(empty["ui"]["eagle_image_editor"][0]["error"])

        self.save_png("source.png")
        for request in ("{", self.segment_request("previous.png"),
                        self.segment_request("source.png", [[1.1, 0.5, 1]]),
                        self.segment_request("source.png", [[0, 0.5, 0]])):
            with self.subTest(request=request):
                predictor = PointPredictor()
                result = self.run_editor("source.png", sam_model=predictor, editor_request=request)
                self.assert_shape(result["result"], 9, 5)
                payload = result["ui"]["eagle_image_editor"][0]
                self.assertTrue(payload["error"])
                self.assertNotIn("mask", payload)
                self.assertEqual([], predictor.calls)

    def test_sam_failure_releases_device_and_reports_error(self):
        self.save_png("source.png")
        predictor = PointPredictor(RuntimeError("inference failed"))
        result = self.run_editor("source.png", sam_model=predictor, editor_request=self.segment_request("source.png"))
        payload = result["ui"]["eagle_image_editor"][0]
        self.assertTrue(payload["error"])
        self.assertNotIn("mask", payload)
        self.assertEqual(("prepare", "release"), (predictor.calls[0], predictor.calls[-1]))
        self.assert_shape(result["result"], 9, 5)

    def test_native_sam3_model_uses_comfy_point_inference(self):
        from comfy_api.latest import io
        from comfy_execution.validation import validate_node_input
        from comfy_extras.nodes_sam3 import SAM3_Detect

        sam_type = self.node.INPUT_TYPES()["optional"]["sam_model"][0]
        for model_type in ("SAM_MODEL", "MODEL"):
            self.assertTrue(validate_node_input(model_type, sam_type))

        self.save_png("source.png")
        model = SimpleNamespace(model=SimpleNamespace(diffusion_model=SimpleNamespace(forward_segment=lambda: None)))
        mask = torch.zeros((1, 5, 9))
        mask[0, 4, 4] = 1
        with patch.object(SAM3_Detect, "execute", return_value=io.NodeOutput(mask, [])) as execute:
            result = self.run_editor("source.png", sam_model=model, editor_request=self.segment_request("source.png"))
        payload = result["ui"]["eagle_image_editor"][0]
        self.assertNotIn("error", payload)
        args, kwargs = execute.call_args
        self.assertIs(model, args[0])
        self.assertEqual((1, 5, 9, 3), tuple(args[1].shape))
        self.assertEqual([1, 0, 0], args[1][0, 0, 0].tolist())
        self.assertEqual([{"x": 4, "y": 4}], json.loads(kwargs["positive_coords"]))
        self.assertEqual([{"x": 0, "y": 1}], json.loads(kwargs["negative_coords"]))
        self.assertEqual(2, kwargs["refine_iterations"])
        with self.temp_image(payload["mask"]) as candidate:
            self.assertEqual(255, candidate.getpixel((4, 4))[3])
            self.assertEqual(0, candidate.getpixel((0, 0))[3])

    def test_saved_point_prompts_run_automatically_for_their_source_with_a_model(self):
        from comfy_api.latest import io
        from comfy_extras.nodes_sam3 import SAM3_Detect

        self.save_png("source.png")
        self.save_png("other.png")
        settings = json.dumps({"sam": {"mode": "points", "source": "source.png",
                                       "points": [[.5, 1, 1], [0, .25, 0]], "refine_iterations": 4}})
        mask = torch.zeros((1, 5, 9))
        mask[0, 4, 4] = 1
        model = self.native_sam()
        with patch.object(SAM3_Detect, "execute", return_value=io.NodeOutput(mask, [])) as execute:
            self.assertEqual(["sam_model"], self.node.check_lazy_status(
                "source.png", sam_model=None, editor_adjustments=settings))
            result = self.run_editor("source.png", sam_model=model, editor_adjustments=settings, sam_prompt="unused")
            self.assertEqual(4, execute.call_args.kwargs["refine_iterations"])
            self.assertEqual([{"x": 4, "y": 4}], json.loads(execute.call_args.kwargs["positive_coords"]))
            other = self.run_editor("other.png", sam_model=model, editor_adjustments=settings)
            unwired = self.run_editor("source.png", editor_adjustments=settings)
            text_mode = json.loads(settings)
            text_mode["sam"]["mode"] = "text"
            inactive_points = self.run_editor("source.png", sam_model=model, editor_adjustments=json.dumps(text_mode))
            execute.assert_called_once()
        payload = result["ui"]["eagle_image_editor"][0]
        with self.temp_image(payload["automatic_mask"]) as candidate:
            self.assertEqual(255, candidate.getpixel((4, 4))[3])
        self.assertEqual(0, torch.count_nonzero(other[1]).item())
        self.assertEqual(0, torch.count_nonzero(unwired[1]).item())
        self.assertEqual(0, torch.count_nonzero(inactive_points[1]).item())

    def test_configured_text_mode_uses_threshold_and_refinement_with_white_png_background(self):
        from comfy_api.latest import io
        from comfy_extras.nodes_sam3 import SAM3_Detect

        path = self.save_png("source.png")
        with Image.open(path) as opened:
            source = opened.copy()
        source.putpixel((0, 0), (0, 0, 0, 0))
        source.putpixel((1, 0), (0, 0, 255, 128))
        source.save(path)
        original = path.read_bytes()
        options = dict(sam_model=self.native_sam(), clip=TextClip(), sam_prompt="car",
                       editor_adjustments=json.dumps({"sam": {
                           "mode": "text", "threshold": .72, "refine_iterations": 4,
                           "source": "source.png", "points": [[.5, .5, 1]],
                       }}))
        mask = torch.zeros((1, 5, 9))
        mask[0, 1, 1] = 1
        with patch.object(SAM3_Detect, "execute", return_value=io.NodeOutput(mask, [])) as execute:
            automatic = self.run_editor("source.png", **options)
            explicit = self.run_editor("source.png", **options, editor_request=self.text_request())
            self.assertEqual(2, execute.call_count)
            for call in execute.call_args_list:
                self.assertEqual((.72, 4), (call.kwargs["threshold"], call.kwargs["refine_iterations"]))
                self.assertNotIn("positive_coords", call.kwargs)
                self.assertEqual([1, 1, 1], call.args[1][0, 0, 0].tolist())
        self.assertIn("automatic_mask", automatic["ui"]["eagle_image_editor"][0])
        self.assertIn("mask", explicit["ui"]["eagle_image_editor"][0])
        image, alpha_mask = self.run_editor("source.png")[:2]
        torch.testing.assert_close(image[0, 0, :2], torch.tensor([[255, 255, 255], [127, 127, 255]]) / 255.0)
        torch.testing.assert_close(alpha_mask[0, 0, :2], torch.tensor([255, 127]) / 255.0)
        self.assertEqual(original, path.read_bytes())

    def test_upscaler_is_a_final_stage_for_workflow_execution(self):
        self.save_png("source.png", size=(9, 5))
        settings = json.dumps({"upscale": {"enabled": True, "model": "model.safetensors", "factor": 2}})
        resized = (torch.zeros((1, 8, 14, 3)), torch.zeros((1, 8, 14)), 14, 8)
        module = sys.modules[type(self.node).__module__]
        with patch.object(module, "upscale_result", return_value=resized) as upscale:
            result = self.run_editor("source.png", 最长边=7, editor_adjustments=settings)
            upscale.assert_called_once()
            inputs, options = upscale.call_args.args
            self.assert_shape(inputs, 7, 4)
            self.assertTrue(options.enabled)
            self.assertEqual("model.safetensors", options.model)
            preview = self.run_editor("source.png", 最长边=7, editor_adjustments=settings,
                                      editor_request='{"id":"read","action":"preview"}')
            upscale.assert_called_once()
        self.assertIs(resized, result)
        self.assert_shape(preview["result"], 7, 4)

    def test_lazy_wired_text_is_requested_only_for_text_mode_or_text_preview(self):
        self.save_png("source.png")
        points = '{"sam":{"mode":"points","source":"source.png","points":[[0.5,0.5,1]]}}'
        text = '{"sam":{"mode":"text"}}'
        inputs = dict(image="source.png", sam_text=None, clip=None, sam_model=None)
        self.assertEqual(["sam_model"], self.node.check_lazy_status(**inputs, editor_adjustments=points))
        self.assertEqual(["sam_text"], self.node.check_lazy_status(**inputs, editor_adjustments=text))
        self.assertEqual(["sam_text"], self.node.check_lazy_status(
            "source.png", sam_text=None, editor_request='{"id":"read","action":"preview","mode":"text"}'))
        self.assertEqual([], self.node.check_lazy_status(
            "source.png", sam_text=None, editor_request='{"id":"read","action":"preview","mode":"points"}',
            editor_adjustments=text))

    def test_non_sam_diffusion_model_reports_error_without_running_model(self):
        self.save_png("source.png")
        model = SimpleNamespace(model=SimpleNamespace(diffusion_model=object()))
        result = self.run_editor("source.png", sam_model=model, editor_request=self.segment_request("source.png"))
        payload = result["ui"]["eagle_image_editor"][0]
        self.assertIn("SAM", payload["error"])
        self.assertNotIn("mask", payload)

    def test_connected_text_is_echoed_and_empty_text_blocks_manual_fallback(self):
        self.save_png("source.png")
        clip = TextClip()
        active = self.run_editor("source.png", sam_text="wire\nword", sam_prompt="local", clip=clip)
        self.assertEqual("wire\nword", active["ui"]["eagle_image_editor"][0]["sam_text"])
        blank = self.run_editor("source.png", sam_text="", sam_prompt="local", sam_auto=True, clip=clip,
                                sam_model=PointPredictor())
        self.assertEqual("", blank["ui"]["eagle_image_editor"][0]["sam_text"])
        self.assertNotIn("error", blank["ui"]["eagle_image_editor"][0])
        self.assertEqual([], clip.calls)

    def test_native_sam3_text_request_uses_wire_tags_and_returns_resized_and_raw_masks(self):
        from comfy_api.latest import io
        from comfy_extras.nodes_sam3 import SAM3_Detect

        self.save_png("source.png")
        clip = TextClip()
        selection = torch.zeros((1, 5, 9))
        selection[0, 1:4, 3:7] = 1
        with patch.object(SAM3_Detect, "execute", return_value=io.NodeOutput(selection, [])) as execute:
            result = self.run_editor("source.png", sam_model=self.native_sam(), clip=clip, sam_prompt="local",
                                     sam_text="  blue car:2\n bicycle，bus ", editor_request=self.text_request(),
                                     legacy_resize='{"mode":"指定尺寸","width":4,"height":2}')
        payload = result["ui"]["eagle_image_editor"][0]
        self.assertEqual("text-1", payload["request_id"])
        self.assertEqual("  blue car:2\n bicycle，bus ", payload["sam_text"])
        self.assertNotIn("error", payload)
        self.assertEqual([("tokenize", "blue car:2, bicycle, bus"),
                          ("encode", {"text": "blue car:2, bicycle, bus"})], clip.calls)
        self.assertIs(clip.conditioning, execute.call_args.kwargs["conditioning"])
        self.assertEqual((1, 5, 9, 3), tuple(execute.call_args.args[1].shape))
        self.assert_shape(result["result"], 4, 2)
        self.assertGreater(result["result"][1].max().item(), 0.5)
        with self.temp_image(payload["mask"]) as candidate:
            self.assertEqual((9, 5), candidate.size)
            self.assertEqual(255, candidate.getpixel((3, 1))[3])
            self.assertEqual(0, candidate.getpixel((0, 0))[3])

    def test_text_auto_output_overrides_manual_mask_only_on_normal_execution(self):
        from comfy_api.latest import io
        from comfy_extras.nodes_sam3 import SAM3_Detect

        self.save_png("source.png")
        mask_path = self.save_png("eagle_image_editor/manual.png", color=(0, 0, 0, 255))
        manual_png = mask_path.read_bytes()
        manual_layers = json.dumps({"source": "source.png", "mask": "eagle_image_editor/manual.png"})
        clip = TextClip()
        options = dict(edit_layers=manual_layers, sam_prompt="car", sam_model=self.native_sam(), clip=clip)
        selection = torch.zeros((1, 5, 9))
        with patch.object(SAM3_Detect, "execute", return_value=io.NodeOutput(selection, [])) as execute:
            manual = self.run_editor("source.png", **options)
            auto = self.run_editor("source.png", **options, sam_auto=True)
            preview = self.run_editor("source.png", **options, sam_auto=True,
                                      editor_request='{"id":"preview","action":"preview"}')
        self.assertEqual(1, execute.call_count)
        self.assertEqual(1, manual[1].min().item())
        self.assertEqual(0, torch.count_nonzero(auto["result"][1]).item())
        with self.temp_image(auto["ui"]["eagle_image_editor"][0]["automatic_mask"]) as automatic_mask:
            self.assertEqual((9, 5), automatic_mask.size)
            self.assertEqual((0, 0), automatic_mask.getchannel("A").getextrema())
        self.assertEqual(1, preview["result"][1].min().item())
        self.assertNotIn("mask", preview["ui"]["eagle_image_editor"][0])
        self.assertNotIn("automatic_mask", preview["ui"]["eagle_image_editor"][0])
        self.assertEqual(manual_png, mask_path.read_bytes())

    def test_auto_mask_preview_keeps_raw_coordinates_and_reuses_candidate_asset(self):
        from comfy_api.latest import io
        from comfy_extras.nodes_sam3 import SAM3_Detect

        self.save_png("source.png")
        settings = json.dumps({"grow": True, "expand": 1, "rotation": 90, "flip_x": True,
                               "ratio": "1:1", "framing": "crop"})
        options = dict(sam_model=self.native_sam(), clip=TextClip(), sam_prompt="person",
                       sam_auto=True, editor_adjustments=settings)
        selection = torch.zeros((1, 5, 9))
        selection[0, 2, 1] = 1
        with patch.object(SAM3_Detect, "execute", return_value=io.NodeOutput(selection, [])):
            automatic = self.run_editor("source.png", **options)
            explicit = self.run_editor("source.png", **options, editor_request=self.text_request())
        payload = automatic["ui"]["eagle_image_editor"][0]
        self.assertEqual("source.png", payload["source"])
        self.assertNotIn("request_id", payload)
        self.assertNotIn("mask", payload)
        self.assert_shape(automatic["result"], 5, 5)
        self.assertEqual(3, torch.count_nonzero(automatic["result"][1]).item())
        self.assertEqual([0, 1, 1, 1, 0], automatic["result"][1][0, 0].tolist())
        with self.temp_image(payload["automatic_mask"]) as candidate:
            self.assertEqual("RGBA", candidate.mode)
            self.assertEqual((9, 5), candidate.size)
            self.assertEqual(255, candidate.getpixel((1, 2))[3])
            self.assertEqual(1, candidate.getchannel("A").histogram()[255])
        explicit_payload = explicit["ui"]["eagle_image_editor"][0]
        self.assertEqual("text-1", explicit_payload["request_id"])
        self.assertEqual(payload["automatic_mask"], explicit_payload["mask"])
        self.assertNotIn("automatic_mask", explicit_payload)
        self.assertEqual(1, len(list(self.temp.rglob("*.png"))))

    def test_auto_mask_preview_write_failure_preserves_detected_output(self):
        from comfy_api.latest import io
        from comfy_extras.nodes_sam3 import SAM3_Detect

        self.save_png("source.png")
        broken_temp = self.root / "file-instead-of-temp-directory"
        broken_temp.touch()
        selection = torch.zeros((1, 5, 9))
        selection[0, 2, 1] = 1
        with patch.object(SAM3_Detect, "execute", return_value=io.NodeOutput(selection, [])), \
                patch.object(folder_paths, "get_temp_directory", return_value=str(broken_temp)):
            output = self.run_editor("source.png", sam_model=self.native_sam(), clip=TextClip(),
                                     sam_prompt="person", sam_auto=True)
        self.assert_shape(output["result"], 9, 5)
        torch.testing.assert_close(selection, output["result"][1])
        payload = output["ui"]["eagle_image_editor"][0]
        self.assertIn("预览", payload["error"])
        self.assertNotIn("automatic_mask", payload)

    def test_text_segmentation_rejects_stale_source_and_impact_before_clip_encoding(self):
        self.save_png("source.png")
        clip = TextClip()
        for request, sam_model in ((self.text_request("previous.png"), self.native_sam()),
                                   (self.text_request(), PointPredictor())):
            with self.subTest(request=request):
                result = self.run_editor("source.png", sam_model=sam_model, clip=clip, sam_prompt="car",
                                         editor_request=request)
                payload = result["ui"]["eagle_image_editor"][0]
                self.assertTrue(payload["error"])
                self.assertNotIn("mask", payload)
                self.assertEqual([], clip.calls)

    def test_text_segmentation_requests_lazy_model_and_clip_together(self):
        self.save_png("source.png")
        ports = {"sam_model", "clip"}
        self.assertEqual(ports, set(self.node.check_lazy_status("source.png", sam_model=None, clip=None,
                                                               sam_prompt="cat", editor_request=self.text_request())))
        self.assertEqual(ports, set(self.node.check_lazy_status("source.png", sam_model=None, clip=None,
                                                               sam_prompt="cat", sam_auto=True)))
        self.assertEqual(["sam_model"], self.node.check_lazy_status("source.png", sam_model=None, clip=None,
                                                                  editor_request=self.segment_request("source.png")))
        self.assertEqual([], self.node.check_lazy_status("source.png", sam_model=None, sam_prompt="cat",
                                                       editor_request=self.text_request()))
        self.assertEqual([], self.node.check_lazy_status("source.png", sam_model=None, clip=None, sam_text="",
                                                       sam_prompt="cat", editor_request=self.text_request()))

    def test_output_limit_is_computed_from_the_framed_image(self):
        self.save_png("source.png", (160, 80))
        settings = json.dumps({"ratio": "1:1", "framing": "crop"})
        result = self.run_editor("source.png", 最长边=64, editor_adjustments=settings)
        self.assert_shape(result, 64, 64)

    def test_rotated_and_mirrored_paint_and_mask_move_together_before_crop(self):
        self.save_png("source.png", (4, 3), color=(0, 0, 255, 255))
        paint = Image.new("RGBA", (4, 3))
        paint.putpixel((2, 1), (255, 0, 0, 255))
        paint.putpixel((0, 1), (0, 255, 0, 255))
        paint.save(self.layers / "paint.png")
        mask = Image.new("RGBA", (4, 3))
        mask.putpixel((2, 1), (0, 0, 0, 128))
        mask.putpixel((0, 1), (0, 0, 0, 255))
        mask.save(self.layers / "mask.png")
        manifest = json.dumps({"source": "source.png", "paint": "eagle_image_editor/paint.png",
                               "mask": "eagle_image_editor/mask.png"})
        settings = json.dumps({"rotation": 90, "flip_x": True, "ratio": "1:1", "y": 1})
        result = self.run_editor("source.png", edit_layers=manifest, editor_adjustments=settings)
        self.assert_shape(result, 3, 3)
        image, mask, _, _ = result
        self.assertEqual([[0, 1, 1]], (image[..., 0] == 1).nonzero().tolist())
        self.assertEqual(0, image[..., 1].count_nonzero().item())
        self.assertEqual([[0, 1, 1]], mask.nonzero().tolist())
        self.assertAlmostEqual(128 / 255, mask[0, 1, 1].item())

    def test_detected_mask_grows_once_before_crop_and_candidate_stays_raw(self):
        from comfy_api.latest import io
        from comfy_extras.nodes_sam3 import SAM3_Detect

        self.save_png("source.png")
        settings = json.dumps({"grow": True, "expand": 1, "ratio": "1:1", "framing": "crop"})
        selection = torch.zeros((1, 5, 9))
        selection[0, 2, 1] = 1
        with patch.object(SAM3_Detect, "execute", return_value=io.NodeOutput(selection, [])):
            result = self.run_editor("source.png", sam_model=self.native_sam(), clip=TextClip(),
                                     sam_prompt="person", editor_request=self.text_request(),
                                     editor_adjustments=settings)
        self.assert_shape(result["result"], 5, 5)
        mask = result["result"][1]
        self.assertEqual(3, torch.count_nonzero(mask).item())
        self.assertEqual([0, 1, 1, 1, 0], mask[0, :, 0].tolist())
        payload = result["ui"]["eagle_image_editor"][0]
        with self.temp_image(payload["mask"]) as candidate:
            self.assertEqual((9, 5), candidate.size)
            self.assertEqual(1, candidate.getchannel("A").histogram()[255])

    def test_comfy_execution_uses_text_wire_with_both_outputs_of_the_same_loader(self):
        from comfy_api.latest import io
        from comfy_extras.nodes_sam3 import SAM3_Detect
        from execution import PromptExecutor, validate_prompt
        from nodes import NODE_CLASS_MAPPINGS
        from eagle_suite_image_editor_test_package.eagle_suite.execution_isolation import make_prompt_filter

        loads = []
        model, clip = self.native_sam(), TextClip()

        class TextFeed:
            RETURN_TYPES = ("STRING",)
            FUNCTION = "emit"

            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {}}

            def emit(self):
                return ("car\nperson",)

        class ModelFeed(TextFeed):
            RETURN_TYPES = ("MODEL", "CLIP")

            def emit(self):
                loads.append("load")
                return model, clip

        self.save_png("source.png")
        values = {name: options["default"] for name, (_, options) in self.node.INPUT_TYPES()["required"].items()}
        values.update(image="source.png", sam_text=["1", 0], sam_model=["2", 0],
                      clip=["2", 1], sam_prompt="local", sam_auto=True)
        prompt = {
            "1": {"class_type": "TestTextFeed", "inputs": {}},
            "2": {"class_type": "TestModelFeed", "inputs": {}},
            "3": {"class_type": "EagleImageMaskEditor", "inputs": values},
        }
        registry = {**NODE_CLASS_MAPPINGS, **PACKAGE.NODE_CLASS_MAPPINGS,
                    "TestTextFeed": TextFeed, "TestModelFeed": ModelFeed}
        run_filter = make_prompt_filter(PACKAGE.NODE_CLASS_MAPPINGS, registry)
        server = SimpleNamespace(client_id=None, last_node_id=None, sockets_metadata={}, send_sync=lambda *_: None)
        executor = PromptExecutor(server, cache_type=False, cache_args={"ram": 0.0, "ram_inactive": 0.0})

        def execute(request, prompt_id):
            values["editor_request"] = request
            submission = run_filter({"prompt": prompt, "partial_execution_targets": ["3"]})
            valid, error, targets, node_errors = asyncio.run(validate_prompt(
                prompt_id, submission["prompt"], submission["partial_execution_targets"]))
            self.assertTrue(valid, error)
            self.assertFalse(node_errors)
            executor.execute(submission["prompt"], prompt_id, {}, execute_outputs=targets)
            self.assertTrue(executor.success, executor.status_messages)
            return executor.history_result["outputs"]["3"]["eagle_image_editor"][0]

        selection = torch.ones((1, 5, 9))
        with patch.dict(NODE_CLASS_MAPPINGS, registry), \
                patch.object(SAM3_Detect, "execute", return_value=io.NodeOutput(selection, [])) as inference:
            preview = execute('{"id":"preview","action":"preview"}', "test-text-preview")
            self.assertEqual("car\nperson", preview["sam_text"])
            self.assertEqual([], loads)
            normal = execute("", "test-text-normal")
            self.assertNotIn("error", normal)
            self.assertNotIn("mask", normal)
            with self.temp_image(normal["automatic_mask"]) as automatic_mask:
                self.assertEqual((9, 5), automatic_mask.size)
                self.assertEqual((255, 255), automatic_mask.getchannel("A").getextrema())
            self.assertEqual(["load"], loads)
            self.assertEqual(("tokenize", "car, person"), clip.calls[0])
            inference.assert_called_once()


if __name__ == "__main__":
    unittest.main()
