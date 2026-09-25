"""H3 dual-sampling handoff: native packed-grid and mask regressions, no model weights."""
import importlib.util
import os
from pathlib import Path
import sys
import unittest

import torch

COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    sys.path.insert(0, str(Path(COMFY_ROOT).expanduser()))
from comfy.nested_tensor import NestedTensor
from comfy.ldm.minimax.model import PackedLayout, patchify_video

spec = importlib.util.spec_from_file_location(
    "h3_refinement_under_test", Path(__file__).resolve().parents[1] / "eagle_suite/h3_pipeline/refinement.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeVAE:
    def __init__(self):
        self.calls = []

    def spacial_compression_encode(self):
        return 16

    def decode(self, z):
        self.calls.append("decode")
        # MiniMax H3's real video VAE returns [B,T,H,W,C], not IMAGE's
        # flattened [B*T,H,W,C].  Two latent time steps represent five frames.
        return torch.zeros(z.shape[0], 5, z.shape[3] * 16, z.shape[4] * 16, 3)

    def encode(self, frames):
        self.calls.append("encode")
        self.encoded_shape = tuple(frames.shape)
        return torch.zeros(1, 24, 2, frames.shape[1] // 16, frames.shape[2] // 16)


def pair(h=4, w=6):
    return {"samples": NestedTensor([torch.zeros(1, 24, 7, h, w), torch.zeros(1, 32, 2, 37)])}


class RefinementTests(unittest.TestCase):
    def test_native_guide_rows_match_new_canvas_without_touching_refs_or_audio(self):
        vae = FakeVAE()
        guide = torch.zeros(1, 24, 2, 4, 6)
        audio_guide = torch.ones(1, 32, 2, 3)
        refs = [{"kind": "image", "latent_h": 4, "latent_w": 6, "latent": guide}]
        metadata = {"minimax_refs": refs, "minimax_keyframes": [
            {"latent": guide, "resolved_frame_index": 0, "audio_latent": audio_guide},
            {"latent": guide, "resolved_frame_index": 5},
        ]}
        positive, result, _ = module.EagleH3RefineHandoffNode().execute(
            [[None, metadata]], pair(8, 12), vae, pair()
        )
        guides = positive[0][1]["minimax_keyframes"]
        z = guides[0]["latent"]
        self.assertEqual(tuple(z.shape), (1, 24, 2, 8, 12))
        rows = patchify_video(z)
        self.assertEqual(rows.shape[0], 2 * (8 // 2) * (12 // 2))
        layout = PackedLayout(3, 7, 8, 12, 37, keyframes=guides)
        packed_rows = sum(patchify_video(item["latent"]).shape[0] for item in guides)
        self.assertEqual(packed_rows, int((~layout.img_update).sum()))
        self.assertIs(guides[0]["audio_latent"], audio_guide)
        self.assertIs(positive[0][1]["minimax_refs"], refs)
        self.assertIs(metadata["minimax_keyframes"][0]["latent"], guide)
        self.assertEqual(vae.calls, ["decode", "encode"])
        self.assertEqual(vae.encoded_shape, (5, 128, 192, 3))

    def test_masked_av_prefix_survives_separate_upscale_concat(self):
        source = pair()
        vm = torch.ones(1, 1, 7, 4, 6)
        vm[:, :, :2] = 0
        am = torch.ones(1, 1, 2, 37)
        am[..., :9] = 0
        source["noise_mask"] = NestedTensor([vm, am])
        _, result, _ = module.EagleH3RefineHandoffNode().execute([], pair(8, 12), FakeVAE(), source)
        new_vm, new_am = result["noise_mask"].unbind()
        self.assertEqual(tuple(new_vm.shape), (1, 1, 7, 8, 12))
        self.assertEqual(new_vm[:, :, :2].count_nonzero(), 0)
        self.assertTrue(torch.all(new_vm[:, :, 2:] == 1))
        self.assertIs(new_am, am)
        self.assertEqual(tuple(vm.shape), (1, 1, 7, 4, 6))

    def test_same_canvas_has_no_vae_work(self):
        vae = FakeVAE()
        z = torch.zeros(1, 24, 2, 4, 6)
        positive = [[None, {"minimax_keyframes": [{"latent": z}]}]]
        out, _, _ = module.EagleH3RefineHandoffNode().execute(positive, pair(), vae, pair())
        self.assertIs(out[0][1]["minimax_keyframes"][0]["latent"], z)
        self.assertFalse(vae.calls)

    def test_refuses_temporal_change_or_video_only(self):
        target = pair(8, 12)
        target["samples"].tensors[1] = torch.zeros(1, 32, 2, 50)
        with self.assertRaisesRegex(ValueError, "时长"):
            module.EagleH3RefineHandoffNode().execute([], target, FakeVAE(), pair())
        with self.assertRaisesRegex(ValueError, "双流"):
            module.EagleH3RefineHandoffNode().execute([], {"samples": torch.zeros(1)}, FakeVAE(), pair())


if __name__ == "__main__":
    unittest.main()
