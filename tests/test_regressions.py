import importlib.util
import os
import pathlib
import sys
import tempfile
import unittest

import numpy as np
import torch


REPO = pathlib.Path(__file__).resolve().parents[1]
COMFY_ROOT = pathlib.Path(os.environ.get("COMFYUI_ROOT", r"E:\ComfyUI-AKI\ComfyUI"))
sys.path.insert(0, str(COMFY_ROOT))
SPEC = importlib.util.spec_from_file_location(
    "eagle_suite_test_package",
    REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)


class RegressionTests(unittest.TestCase):
    def test_node_output_contracts(self):
        self.assertEqual(39, len(PACKAGE.NODE_CLASS_MAPPINGS))
        for name, node in PACKAGE.NODE_CLASS_MAPPINGS.items():
            returns = tuple(getattr(node, "RETURN_TYPES", ()))
            names = tuple(getattr(node, "RETURN_NAMES", returns))
            self.assertEqual(len(returns), len(names), name)
            output_is_list = getattr(node, "OUTPUT_IS_LIST", None)
            if output_is_list is not None:
                self.assertEqual(len(returns), len(output_is_list), name)

    def test_filename_prefix_is_contained(self):
        from eagle_suite_test_package.eagle_suite.utils import generate_unique_filename
        name = generate_unique_filename(r"..\outside/evil", "png")
        self.assertEqual(name, os.path.basename(name))
        self.assertTrue(name.endswith(".png"))

    def test_media_path_allowlist_blocks_escape(self):
        from eagle_suite_test_package.tools_utils import resolve_allowed_media_path
        with tempfile.TemporaryDirectory() as allowed, tempfile.TemporaryDirectory() as outside:
            inside_file = pathlib.Path(allowed, "inside.wav")
            outside_file = pathlib.Path(outside, "outside.wav")
            inside_file.write_bytes(b"RIFF")
            outside_file.write_bytes(b"RIFF")
            previous = os.environ.get("EAGLE_MEDIA_ROOTS")
            os.environ["EAGLE_MEDIA_ROOTS"] = allowed
            try:
                self.assertTrue(resolve_allowed_media_path(str(inside_file), "audio", "file"))
                self.assertEqual("", resolve_allowed_media_path(str(outside_file), "audio", "file"))
            finally:
                if previous is None:
                    os.environ.pop("EAGLE_MEDIA_ROOTS", None)
                else:
                    os.environ["EAGLE_MEDIA_ROOTS"] = previous

    def test_session_media_root_authorization(self):
        from eagle_suite_test_package.tools_utils import (
            authorize_media_root,
            clear_authorized_media_roots,
            resolve_allowed_media_path,
        )
        with tempfile.TemporaryDirectory() as directory:
            media_file = pathlib.Path(directory, "clip.mp4")
            media_file.write_bytes(b"video")
            clear_authorized_media_roots()
            try:
                self.assertEqual("", resolve_allowed_media_path(str(media_file), "all", "file"))
                self.assertTrue(authorize_media_root(directory, "all"))
                self.assertTrue(resolve_allowed_media_path(str(media_file), "all", "file"))
            finally:
                clear_authorized_media_roots()

    def test_route_decorator_is_idempotent(self):
        from eagle_suite_test_package.eagle_suite import route_registry
        before = len(route_registry._route_handlers)

        async def handler(request):
            return request

        route_registry.route("GET", "/__eagle_test_idempotent")(handler)
        route_registry.route("GET", "/__eagle_test_idempotent")(handler)
        self.assertEqual(before + 1, len(route_registry._route_handlers))

    def test_audio_mixer_standard_shape_resample_and_crossfade(self):
        from eagle_suite_test_package.eagle_suite.audio_nodes import EagleAudioMixer
        mixer = EagleAudioMixer()
        a = {"waveform": torch.ones((1, 1, 8000)), "sample_rate": 8000}
        b = {"waveform": torch.zeros((1, 2, 16000)), "sample_rate": 16000}
        output, _ = mixer.mix_audio("交叉淡入淡出", 0, 0, a, b)
        waveform = output["waveform"]
        self.assertEqual((1, 2), tuple(waveform.shape[:2]))
        self.assertGreater(waveform.shape[-1], 16000)
        self.assertEqual(16000, output["sample_rate"])

    def test_mask_direction_matches_comfyui(self):
        from eagle_suite_test_package.eagle_suite.video_nodes import _prepare_alpha
        images = torch.zeros((1, 1, 2, 3))
        mask = torch.tensor([[[0.0, 1.0]]])
        alpha = _prepare_alpha(mask, images)
        np.testing.assert_allclose(alpha.cpu().numpy().reshape(-1), [1.0, 0.0])

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI test")
    def test_api_key_uses_os_vault_and_round_trips(self):
        from eagle_suite_test_package.eagle_suite.api_config_manager import encode_api_key, decode_api_key
        with tempfile.TemporaryDirectory() as directory:
            os.environ["EAGLE_CREDENTIAL_DIR"] = directory
            try:
                protected = encode_api_key("test-secret-not-real")
                self.assertTrue(protected.startswith(("KEYRING:", "DPAPI:", "FERNET:")))
                self.assertNotIn("test-secret", protected)
                self.assertEqual("test-secret-not-real", decode_api_key(protected))
                if protected.startswith("KEYRING:"):
                    import keyring
                    keyring.delete_password("ComfyUI Eagle Suite", protected.split(":", 1)[1])
            finally:
                os.environ.pop("EAGLE_CREDENTIAL_DIR", None)


if __name__ == "__main__":
    unittest.main()
