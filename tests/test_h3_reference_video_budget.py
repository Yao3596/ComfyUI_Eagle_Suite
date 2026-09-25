"""Bounded reference-video IMAGE batches without changing H3 slot contracts."""

import importlib.util
import os
import pathlib
import sys
import unittest
from unittest import mock

import cv2
import numpy as np
import torch


REPO = pathlib.Path(__file__).resolve().parents[1]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    sys.path.insert(0, str(pathlib.Path(COMFY_ROOT).expanduser()))
SPEC = importlib.util.spec_from_file_location(
    "eagle_suite_reference_video_test_package",
    REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

from eagle_suite_reference_video_test_package.eagle_suite import h3_director_node as director


class FakeCapture:
    def __init__(self, count=300, fps=30, height=12, width=10):
        self.count = count
        self.fps = fps
        self.height = height
        self.width = width
        self.position = 0
        self.read_positions = []
        self.released = False

    def isOpened(self):
        return True

    def get(self, property_id):
        if property_id == cv2.CAP_PROP_FPS:
            return self.fps
        if property_id == cv2.CAP_PROP_FRAME_COUNT:
            return self.count
        return 0

    def set(self, property_id, value):
        if property_id != cv2.CAP_PROP_POS_FRAMES:
            return False
        self.position = int(value)
        return True

    def read(self):
        if self.position >= self.count:
            return False, None
        index = self.position
        self.read_positions.append(index)
        self.position += 1
        return True, np.full((self.height, self.width, 3), index % 256, dtype=np.uint8)

    def release(self):
        self.released = True


class ReferenceVideoBudgetTests(unittest.TestCase):
    def test_default_ceiling_fits_three_official_video_slots(self):
        self.assertLessEqual(director.H3_REF_VIDEO_MAX_FRAMES, 96)
        self.assertLessEqual(director.H3_REF_VIDEO_MAX_PIXELS, 250_000)
        self.assertLessEqual(director.H3_REF_VIDEO_MAX_TENSOR_BYTES, 192 * 1024 * 1024)
        self.assertLessEqual(3 * director.H3_REF_VIDEO_MAX_TENSOR_BYTES,
                             576 * 1024 * 1024)

    def load(self, capture, **limits):
        with mock.patch.object(director, "_media_path", return_value="safe.mp4"), \
             mock.patch.object(cv2, "VideoCapture", return_value=capture), \
             mock.patch.multiple(director, **limits):
            return director._load_video_tensor("safe.mp4", target_fps=24)

    def test_long_video_is_uniformly_sampled_not_fully_decoded(self):
        capture = FakeCapture(count=300, fps=30)
        video = self.load(capture, H3_REF_VIDEO_MAX_FRAMES=7)
        self.assertIsInstance(video, torch.Tensor)
        self.assertEqual(tuple(video.shape), (7, 12, 10, 3))
        self.assertEqual(capture.read_positions[0], 0)
        self.assertEqual(capture.read_positions[-1], 299)
        self.assertEqual(len(capture.read_positions), 7)
        self.assertTrue(capture.released)
        self.assertEqual(video.dtype, torch.float32)

    def test_pixel_and_float_tensor_budgets_are_both_enforced(self):
        capture = FakeCapture(count=100, fps=24, height=20, width=20)
        video = self.load(
            capture,
            H3_REF_VIDEO_MAX_FRAMES=96,
            H3_REF_VIDEO_MAX_PIXELS=100,
            H3_REF_VIDEO_MAX_TENSOR_BYTES=6 * 10 * 10 * 3 * 4,
        )
        self.assertEqual(tuple(video.shape), (6, 10, 10, 3))
        self.assertLessEqual(video.numel() * video.element_size(), 7200)
        self.assertEqual(capture.read_positions[-1], 99)

    def test_trim_keeps_full_requested_interval(self):
        capture = FakeCapture(count=300, fps=30)
        with mock.patch.object(director, "_media_path", return_value="safe.mp4"), \
             mock.patch.object(cv2, "VideoCapture", return_value=capture), \
             mock.patch.object(director, "H3_REF_VIDEO_MAX_FRAMES", 5):
            video = director._load_video_tensor("safe.mp4", trim_start=2, trim_end=4)
        self.assertEqual(video.shape[0], 5)
        self.assertEqual(capture.read_positions[0], 60)
        self.assertEqual(capture.read_positions[-1], 119)


if __name__ == "__main__":
    unittest.main()
