"""Contract tests for the editor's native model upscaling stage."""

from contextlib import ExitStack
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import torch
import torch.nn.functional as F


REPO = Path(__file__).resolve().parents[1]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    sys.path.insert(0, str(Path(COMFY_ROOT).expanduser()))
SPEC = importlib.util.spec_from_file_location(
    "eagle_suite_upscale_test_package",
    REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

import folder_paths
from comfy_api.latest import io
from comfy_extras.nodes_upscale_model import ImageUpscaleWithModel, UpscaleModelLoader
from eagle_suite_upscale_test_package.eagle_suite import image_editor_upscale as upscale


class EditorUpscaleTests(unittest.TestCase):
    def setUp(self):
        resources = ExitStack()
        self.addCleanup(resources.close)
        self.root = Path(resources.enter_context(tempfile.TemporaryDirectory()))
        weights = self.root / "upscale_models"
        self.checkpoint = weights / "nested" / "model.safetensors"
        self.checkpoint.parent.mkdir(parents=True)
        self.checkpoint.write_bytes(b"fixture checkpoint")
        self.name = self.checkpoint.relative_to(weights).as_posix()
        resources.enter_context(patch.dict(folder_paths.folder_names_and_paths, {
            "upscale_models": ([str(weights)], {".safetensors"}),
        }))
        resources.enter_context(patch.dict(folder_paths.filename_list_cache, {}))

    def settings(self, **values):
        return upscale.parse_upscale({"enabled": True, "model": self.name, **values})

    def planes(self, width=5, height=3):
        rgb = torch.linspace(0, 1, width * height * 3).reshape(1, height, width, 3)
        mask = torch.linspace(0, 1, width * height).reshape(1, height, width)
        return rgb, mask, width, height

    def test_disabled_is_identity_and_skips_registry_and_model_loading(self):
        settings = upscale.parse_upscale(None)
        self.assertEqual(settings, upscale.parse_upscale({}))
        self.assertEqual(
            (False, "", "scale", 2.0, 1024, "lanczos", 1),
            (settings.enabled, settings.model, settings.mode, settings.factor,
             settings.width, settings.method, settings.multiple),
        )
        result = self.planes()
        with patch.object(folder_paths, "get_filename_list", side_effect=AssertionError("registry consulted")), \
                patch.object(UpscaleModelLoader, "execute", side_effect=AssertionError("model loaded")):
            self.assertIsNone(upscale.upscale_fingerprint(settings))
            self.assertIs(result, upscale.upscale_result(result, settings))

    def test_invalid_persisted_settings_are_reported(self):
        for data in (
            [],
            {"enabled": 1},
            {"model": []},
            {"mode": "height"},
            {"factor": 0},
            {"factor": float("nan")},
            {"factor": 8.01},
            {"width": 0},
            {"width": 20000},
            {"method": "unknown"},
            {"multiple": 0},
            {"multiple": 257},
        ):
            with self.subTest(data=data), self.assertRaises(ValueError):
                upscale.parse_upscale(data)

    def test_scale_rounds_half_up_and_resizes_mask_directly_to_final_dimensions(self):
        rgb, mask, width, height = self.planes()
        model = SimpleNamespace(scale=2)
        native = F.interpolate(rgb.movedim(-1, 1), size=(6, 10), mode="nearest").movedim(1, -1)
        settings = self.settings(factor=2, multiple=4, method="nearest-exact")
        with patch.object(UpscaleModelLoader, "execute", return_value=io.NodeOutput(model)), \
                patch.object(ImageUpscaleWithModel, "execute", return_value=io.NodeOutput(native)) as run_model:
            image, aligned_mask, actual_width, actual_height = upscale.upscale_result(
                (rgb, mask, width, height), settings)

        self.assertIs(model, run_model.call_args.args[0])
        self.assertIs(rgb, run_model.call_args.args[1])
        self.assertEqual((12, 8), (actual_width, actual_height))
        torch.testing.assert_close(image, F.interpolate(native.movedim(-1, 1), size=(8, 12),
                                                        mode="nearest-exact").movedim(1, -1))
        torch.testing.assert_close(aligned_mask, F.interpolate(mask.unsqueeze(1), size=(8, 12),
                                                               mode="bilinear", align_corners=False).squeeze(1))

    def test_width_mode_preserves_ratio_and_minimum_alignment(self):
        result = self.planes(width=9, height=4)
        model = SimpleNamespace(scale=2)
        native = torch.zeros((1, 8, 18, 3))
        with patch.object(UpscaleModelLoader, "execute", return_value=io.NodeOutput(model)), \
                patch.object(ImageUpscaleWithModel, "execute", return_value=io.NodeOutput(native)):
            image, mask, width, height = upscale.upscale_result(
                result, self.settings(mode="width", width=18, method="bilinear"))
            self.assertEqual((18, 8), (width, height))
            self.assertIs(image, native)
            self.assertEqual((1, 8, 18), tuple(mask.shape))
            tiny = upscale.upscale_result(result, self.settings(mode="width", width=1, multiple=4, method="area"))
        self.assertEqual((4, 4), tiny[2:])
        self.assertEqual((1, 4, 4, 3), tuple(tiny[0].shape))
        self.assertEqual((1, 4, 4), tuple(tiny[1].shape))

    def test_lanczos_accepts_native_bfloat16_output(self):
        model = SimpleNamespace(scale=2)
        native = torch.full((1, 6, 10, 3), 0.5, dtype=torch.bfloat16)
        with patch.object(UpscaleModelLoader, "execute", return_value=io.NodeOutput(model)), \
                patch.object(ImageUpscaleWithModel, "execute", return_value=io.NodeOutput(native)):
            image, _, width, height = upscale.upscale_result(self.planes(), self.settings(factor=3))
        self.assertEqual((15, 9), (width, height))
        self.assertEqual(torch.bfloat16, image.dtype)
        torch.testing.assert_close(image.float(), torch.full((1, 9, 15, 3), 127 / 255), atol=0.004, rtol=0)

    def test_model_cache_invalidates_when_checkpoint_changes(self):
        settings = self.settings()
        first = upscale.upscale_fingerprint(settings)
        self.assertEqual(first, upscale.upscale_fingerprint(settings))
        model = SimpleNamespace(scale=1)
        result = self.planes()
        with patch.object(UpscaleModelLoader, "execute", return_value=io.NodeOutput(model)) as loader, \
                patch.object(ImageUpscaleWithModel, "execute", return_value=io.NodeOutput(result[0])):
            upscale.upscale_result(result, settings)
            upscale.upscale_result(result, settings)
            loader.assert_called_once()
            previous = self.checkpoint.stat()
            self.checkpoint.write_bytes(b"updated checkpoint")
            os.utime(self.checkpoint, ns=(previous.st_atime_ns, previous.st_mtime_ns + 1_000_000_000))
            self.assertNotEqual(first, upscale.upscale_fingerprint(settings))
            upscale.upscale_result(result, settings)
            self.assertEqual(2, loader.call_count)

    def test_checkpoint_must_be_registered_and_resolve_inside_a_model_directory(self):
        for filename in ("", "../model.safetensors", "/tmp/model.safetensors", "C:relative.pth", "missing.pth"):
            with self.subTest(filename=filename), self.assertRaises(ValueError):
                upscale.upscale_fingerprint(self.settings(model=filename))

        outsider = self.root / "outside.safetensors"
        outsider.touch()
        with patch.object(folder_paths, "get_full_path", return_value=str(outsider)):
            with self.assertRaises(ValueError):
                upscale.upscale_fingerprint(self.settings())

    def test_oversized_final_result_is_rejected_before_loading(self):
        rgb = torch.zeros((1, 1, 1, 3)).expand(1, 2, 10000, 3)
        mask = torch.zeros((1, 1, 1)).expand(1, 2, 10000)
        with patch.object(UpscaleModelLoader, "execute", side_effect=AssertionError("model loaded")):
            with self.assertRaisesRegex(ValueError, "超出"):
                upscale.upscale_result((rgb, mask, 10000, 2), self.settings(factor=2))

    def test_oversized_native_intermediate_is_rejected_before_inference(self):
        with patch.object(UpscaleModelLoader, "execute", return_value=io.NodeOutput(SimpleNamespace(scale=8192))), \
                patch.object(ImageUpscaleWithModel, "execute", side_effect=AssertionError("inference ran")):
            with self.assertRaisesRegex(ValueError, "原生"):
                upscale.upscale_result(self.planes(), self.settings(factor=1))


if __name__ == "__main__":
    unittest.main()
