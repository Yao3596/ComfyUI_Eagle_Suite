"""Local LoRA metadata route authentication; no Civitai network requests."""

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest import mock


REPO = Path(__file__).resolve().parents[1]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    sys.path.insert(0, str(Path(COMFY_ROOT).expanduser()))
SPEC = importlib.util.spec_from_file_location(
    "eagle_suite_lora_auth_test_package",
    REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

from eagle_suite_lora_auth_test_package.eagle_suite import lora_gallery


class FakeRequest:
    def __init__(self, *, key_header="", key_query="", body=None):
        self.headers = {"X-Eagle-Civitai-Key": key_header} if key_header else {}
        self.query = {"id": "demo", "api_key": key_query}
        self.body = body or {}

    async def json(self):
        return self.body


class LoraHeaderAuthTests(unittest.TestCase):
    def _run_route(self, route, request):
        seen = []

        async def fake_resolve(_item, api_key, **_kwargs):
            seen.append(api_key)
            return "123", {"id": 456, "trainedWords": ["portrait"]}, {"raw": {}, "trainedWords": []}, "hash"

        with mock.patch.object(lora_gallery, "_find_lora_item", return_value={"triggerWords": []}), \
             mock.patch.object(lora_gallery, "_resolve_civitai_item", side_effect=fake_resolve):
            response = asyncio.run(route(request))
        self.assertEqual(200, response.status)
        self.assertTrue(json.loads(response.text)["success"])
        return seen

    def test_header_precedes_legacy_query_for_both_get_routes(self):
        request = FakeRequest(key_header="new-header-key", key_query="old-query-key")
        for route in (lora_gallery.lora_model_details_route, lora_gallery.lora_civitai_info_route):
            with self.subTest(route=route.__name__):
                self.assertEqual(["new-header-key"], self._run_route(route, request))

    def test_legacy_query_remains_supported_for_both_get_routes(self):
        request = FakeRequest(key_query="legacy-client-key")
        for route in (lora_gallery.lora_model_details_route, lora_gallery.lora_civitai_info_route):
            with self.subTest(route=route.__name__):
                self.assertEqual(["legacy-client-key"], self._run_route(route, request))

    def test_key_is_redacted_from_error_response_and_route_log(self):
        secret = "synthetic-key-not-real"

        async def fail_resolve(*_args, **_kwargs):
            raise RuntimeError(f"upstream echoed {secret}")

        for route in (lora_gallery.lora_model_details_route, lora_gallery.lora_civitai_info_route):
            with self.subTest(route=route.__name__), \
                 mock.patch.object(lora_gallery, "_find_lora_item", return_value={"triggerWords": []}), \
                 mock.patch.object(lora_gallery, "_resolve_civitai_item", side_effect=fail_resolve), \
                 mock.patch.object(lora_gallery.logger, "error") as log_error:
                response = asyncio.run(route(FakeRequest(key_header=secret)))
                self.assertEqual(500, response.status)
                self.assertNotIn(secret, response.text)
                self.assertNotIn(secret, str(log_error.call_args))

    def test_post_and_download_errors_never_echo_key(self):
        secret = "synthetic-post-key-not-real"
        request = FakeRequest(body={
            "api_key": secret,
            "id": "demo",
            "ids": ["demo"],
            "model_id": "123",
            "version_id": "456",
            "image_url": "https://civitai.red/image.jpg",
        })
        cases = (
            (lora_gallery.lora_civitai_info_post_route, "_scan_loras"),
            (lora_gallery.lora_set_preview_route, "_find_lora_item"),
            (lora_gallery.lora_download_preview_route, "_find_lora_item"),
            (lora_gallery.lora_download_model_route, "_scan_loras"),
        )
        for route, failing_lookup in cases:
            with self.subTest(route=route.__name__), \
                 mock.patch.object(
                     lora_gallery, failing_lookup,
                     side_effect=RuntimeError(f"upstream echoed {secret}"),
                 ), \
                 mock.patch.object(lora_gallery.logger, "error") as log_error:
                response = asyncio.run(route(request))
                self.assertEqual(500, response.status)
                self.assertNotIn(secret, response.text)
                self.assertNotIn(secret, str(log_error.call_args))

    def test_failed_preview_return_value_is_redacted(self):
        secret = "synthetic-preview-key-not-real"
        request = FakeRequest(body={
            "api_key": secret,
            "id": "demo",
            "image_url": "https://civitai.red/image.jpg",
        })

        async def failed_download(*_args):
            return False, "", f"server echoed {secret}"

        with mock.patch.object(lora_gallery, "_find_lora_item", return_value={"path": "demo.safetensors"}), \
             mock.patch.object(lora_gallery, "_download_preview_image", side_effect=failed_download):
            response = asyncio.run(lora_gallery.lora_set_preview_route(request))
        self.assertEqual(200, response.status)
        self.assertNotIn(secret, response.text)


if __name__ == "__main__":
    unittest.main()
