"""Size-chain regression tests; all API calls and configuration writes are mocked."""
import io
import unittest
from unittest import mock

import torch
from PIL import Image

from test_regressions import PACKAGE  # Shared ComfyUI test import/bootstrap.
from eagle_suite_test_package.eagle_suite import api_model_loader as api


class APIImageSizeTests(unittest.TestCase):
    def setUp(self):
        self.node = api.EagleAPIImageNode()
        self.args = dict(api_config_key="test-only", api_config_url="https://example.invalid/v1",
            api_config_model="gpt-image-2", prompt="size regression", mode="自动",
            size="比例预设", quality="high", background="auto", output_format="png",
            batch_count=1, timeout=30, aspect_ratio="3:4", resolution="4K",
            custom_width=128, custom_height=96, input_resize_mode="适应留边")
        self.response = mock.Mock(ok=True)
        self.response.json.return_value = {"data": [{"b64_json": "mock"}]}

    def run_process(self, native=(1087, 1447), **updates):
        args = {**self.args, **updates}
        with mock.patch.object(api, "_load_config", return_value={}), \
             mock.patch.object(api, "_decode_api_key", side_effect=lambda key: key), \
             mock.patch.object(api, "_save_api_config"), \
             mock.patch.object(api.requests, "post", return_value=self.response) as post:
            with mock.patch.object(type(self.node), "_decode_response_image", return_value=Image.new("RGB", native, "red")):
                try:
                    result = self.node.process(**args)
                finally:
                    self.assertEqual(post.call_count, 1)
            return result, post.call_args

    def test_screenshot_edit_4k_reaches_output(self):
        reference = torch.zeros((1, 1448, 1086, 3))
        result, call = self.run_process(image_1=reference)
        tensor, status, _ = result["result"]
        self.assertEqual(tuple(tensor.shape), (1, 3840, 2880, 3))
        self.assertTrue(call.args[0].endswith("/images/edits"))
        request = self.node._request_size_for_model("gpt-image-2", (2880, 3840))
        self.assertEqual(call.kwargs["data"]["size"], f"{request[0]}x{request[1]}")
        with Image.open(io.BytesIO(call.kwargs["files"][0][1][1])) as uploaded:
            self.assertEqual(uploaded.size, request)
        self.assertIn("API 返回 1087x1447", status)
        self.assertIn("目标 2880x3840", status)
        self.assertIn("非原生生成分辨率", status)
        self.assertEqual(result["ui"]["text"], [status])

    def test_auto_does_not_apply_inactive_4k_settings(self):
        result, call = self.run_process(native=(120, 90), size="auto")
        self.assertNotIn("size", call.kwargs["json"])
        self.assertEqual(tuple(result["result"][0].shape), (1, 90, 120, 3))

    def test_custom_generation_and_no_input_resize_are_independent(self):
        result, call = self.run_process(native=(64, 64), size="自定义宽高", input_resize_mode="不缩放")
        self.assertEqual(tuple(result["result"][0].shape), (1, 96, 128, 3))
        self.assertTrue(call.args[0].endswith("/images/generations"))

    def test_no_upload_resize_still_enforces_output_size(self):
        result, call = self.run_process(native=(64, 64), size="自定义宽高",
            image_1=torch.zeros((1, 80, 112, 3)), input_resize_mode="不缩放")
        with Image.open(io.BytesIO(call.kwargs["files"][0][1][1])) as uploaded:
            self.assertEqual(uploaded.size, (112, 80))
        self.assertEqual(tuple(result["result"][0].shape), (1, 96, 128, 3))

    def test_keep_native_is_explicit(self):
        result, _ = self.run_process(native=(120, 90), output_resize_mode="保留API原图")
        self.assertEqual(tuple(result["result"][0].shape), (1, 90, 120, 3))
        self.assertIn("未进行本地缩放", result["result"][1])

    def test_strict_mismatch_errors_without_retry(self):
        with self.assertRaisesRegex(ValueError, "可能已计费"):
            self.run_process(native=(120, 90), output_resize_mode="尺寸不符时报错")

    def test_aspect_modes_do_not_silently_stretch(self):
        data = {"data": [{"b64_json": "mock"}]}
        with mock.patch.object(type(self.node), "_decode_response_image", return_value=Image.new("RGB", (80, 40), "red")):
            fit, _, _ = self.node._parse_images(data, 30, (64, 64))
            crop, _, _ = self.node._parse_images(data, 30, (64, 64), "裁剪填满")
            self.assertEqual(tuple(fit.shape), (1, 64, 64, 3))
            self.assertTrue(torch.all(fit[0, 0, 0] == 1))  # white letterbox
            self.assertEqual(crop[0, 0, 0].tolist(), [1, 0, 0])

    def test_native_batch_mismatched_shapes_fail_instead_of_resizing(self):
        with mock.patch.object(type(self.node), "_decode_response_image", side_effect=[Image.new("RGB", (80, 40)), Image.new("RGB", (40, 80))]):
            with self.assertRaisesRegex(ValueError, "无法无损组成"):
                self.node._parse_images({"data": [{}, {}]}, 30, resize_mode="保留API原图")

    def test_target_modes_and_widget_order(self):
        resolve = self.node._resolve_target_size
        self.assertEqual(resolve("比例预设", "3:4", "4K", 128, 96, []), (2880, 3840))
        self.assertEqual(resolve("自定义宽高", "3:4", "4K", 128, 96, []), (128, 96))
        self.assertEqual(resolve("原图尺寸", "3:4", "4K", 128, 96, [torch.zeros(1, 80, 112, 3)]), (112, 80))
        fields = list(self.node.INPUT_TYPES()["required"])
        self.assertEqual(fields[-2:], ["input_resize_mode", "output_resize_mode"])

    def test_oversize_rejected_before_paid_request(self):
        with mock.patch.object(api, "_load_config", return_value={}), mock.patch.object(api.requests, "post") as post:
            with self.assertRaisesRegex(RuntimeError, "可能耗尽内存"):
                self.node.process(**{**self.args, "size": "自定义宽高", "custom_width": 16384, "custom_height": 16384})
            post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
