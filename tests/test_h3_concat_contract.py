# -*- coding: utf-8 -*-
"""The H3 concat contract can be tested without importing a ComfyUI runtime."""

import importlib.util
import json
import logging
import pathlib
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

import numpy as np


ROOT = pathlib.Path(__file__).resolve().parents[1]
PACKAGE_NAME = "h3_concat_contract_test"
for name in (PACKAGE_NAME, PACKAGE_NAME + ".h3_pipeline"):
    package = types.ModuleType(name)
    package.__path__ = []
    sys.modules[name] = package
utils = types.ModuleType(PACKAGE_NAME + ".utils")
utils.ensure_dir = lambda path: pathlib.Path(path).mkdir(parents=True, exist_ok=True)
utils.get_cached_ffmpeg = lambda: shutil.which("ffmpeg")
utils.is_safe_path = lambda _path: True
sys.modules[utils.__name__] = utils
logger_module = types.ModuleType(PACKAGE_NAME + ".logger")
logger_module.logger = logging.getLogger(__name__)
sys.modules[logger_module.__name__] = logger_module
spec = importlib.util.spec_from_file_location(
    PACKAGE_NAME + ".h3_pipeline.media_utils",
    ROOT / "eagle_suite" / "h3_pipeline" / "media_utils.py",
)
media_utils = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = media_utils
spec.loader.exec_module(media_utils)


class H3ConcatContractTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = pathlib.Path(self.temp_dir.name)
        self.a = self.root / "a.mp4"
        self.b = self.root / "b.mp4"
        self.out = self.root / "joined.mp4"
        self.a.write_bytes(b"clip")
        self.b.write_bytes(b"clip")

    def _signatures(self, first, second):
        return mock.patch.object(media_utils, "_concat_stream_signature", side_effect=[first, second])

    def test_rejects_missing_audio_before_copy(self):
        video = ("h264", "High", "yuv420p", 32, 32)
        with mock.patch.object(media_utils, "_check_ffmpeg", return_value="ffmpeg"), \
             mock.patch.object(media_utils, "_concat_probe_path", return_value=None), \
             self._signatures((video, 24.0, ("aac", "LC", 44100, 2, "stereo")),
                              (video, 24.0, None)), \
             mock.patch.object(media_utils.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "音轨结构/编码不兼容"):
                media_utils.concat_videos([self.a, self.b], self.out, fps=24)
        run.assert_not_called()
        self.assertFalse(self.out.exists())

    def test_rejects_incompatible_audio_encoding_before_copy(self):
        video = ("h264", "High", "yuv420p", 32, 32)
        first = (video, 24.0, ("aac", "LC", 44100, 2, "stereo"))
        second = (video, 24.0, ("mp3", None, 44100, 2, "stereo"))
        with mock.patch.object(media_utils, "_check_ffmpeg", return_value="ffmpeg"), \
             mock.patch.object(media_utils, "_concat_probe_path", return_value=None), \
             self._signatures(first, second), \
             mock.patch.object(media_utils.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "音轨结构/编码不兼容"):
                media_utils.concat_videos([self.a, self.b], self.out, fps=24)
        run.assert_not_called()

    def test_rejects_resolution_and_frame_rate_mismatches(self):
        first = (("h264", "High", "yuv420p", 32, 32), 24.0, None)
        for second in (
            (("h264", "High", "yuv420p", 64, 32), 24.0, None),
            (("h264", "High", "yuv420p", 32, 32), 30.0, None),
        ):
            with self.subTest(second=second), \
                 mock.patch.object(media_utils, "_check_ffmpeg", return_value="ffmpeg"), \
                 mock.patch.object(media_utils, "_concat_probe_path", return_value=None), \
                 self._signatures(first, second), \
                 mock.patch.object(media_utils.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "不兼容"):
                    media_utils.concat_videos([self.a, self.b], self.out)
                run.assert_not_called()

    def test_ffprobe_reads_audio_and_rational_frame_rate(self):
        streams = [
            {"codec_type": "video", "codec_name": "h264", "profile": "High",
             "pix_fmt": "yuv420p", "width": 32, "height": 32,
             "avg_frame_rate": "30000/1001", "r_frame_rate": "30000/1001"},
            {"codec_type": "audio", "codec_name": "aac", "profile": "LC",
             "sample_rate": "44100", "channels": 2, "channel_layout": "stereo"},
        ]
        result = subprocess.CompletedProcess([], 0, json.dumps({"streams": streams}), "")
        with mock.patch.object(media_utils.subprocess, "run", return_value=result) as run:
            video, rate, audio = media_utils._concat_stream_signature(
                str(self.a), "ffmpeg", "ffprobe"
            )
        self.assertEqual(video[3:], (32, 32))
        self.assertAlmostEqual(rate, 29.97002997)
        self.assertEqual(audio[0], "aac")
        self.assertIn("-show_entries", run.call_args.args[0])

    def test_fps_is_enforced_even_for_matching_clips(self):
        signature = (("h264", "High", "yuv420p", 32, 32), 24.0, None)
        with mock.patch.object(media_utils, "_check_ffmpeg", return_value="ffmpeg"), \
             mock.patch.object(media_utils, "_concat_probe_path", return_value=None), \
             self._signatures(signature, signature), \
             mock.patch.object(media_utils.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "请求的 fps=30"):
                media_utils.concat_videos([self.a, self.b], self.out, fps=30)
        run.assert_not_called()
        with self.assertRaisesRegex(ValueError, "fps 必须是正数"):
            media_utils.concat_videos([self.a, self.b], self.out, fps=0)

    def test_copy_maps_audio_and_preserves_prior_output_on_failure(self):
        signature = (("h264", "High", "yuv420p", 32, 32), 24.0,
                     ("aac", "LC", 44100, 2, "stereo"))
        self.out.write_bytes(b"old output")
        with mock.patch.object(media_utils, "_check_ffmpeg", return_value="ffmpeg"), \
             mock.patch.object(media_utils, "_concat_probe_path", return_value=None), \
             self._signatures(signature, signature), \
             mock.patch.object(media_utils.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, b"", b"failure")) as run:
            with self.assertRaisesRegex(RuntimeError, "拼接失败"):
                media_utils.concat_videos([self.a, self.b], self.out, fps=24)
        self.assertEqual(self.out.read_bytes(), b"old output")
        command = run.call_args.args[0]
        self.assertIn("0:v:0", command)
        self.assertIn("0:a:0", command)
        self.assertFalse(list(self.root.glob("*.concat.txt")))

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg unavailable")
    def test_real_ffmpeg_banner_fallback_and_lossless_join(self):
        frames = np.zeros((3, 32, 32, 3), dtype=np.uint8)
        media_utils.frames_to_video(frames, self.a, fps=5)
        media_utils.frames_to_video(frames + 255, self.b, fps=5)
        with mock.patch.object(media_utils, "_concat_probe_path", return_value=None):
            result = media_utils.concat_videos([self.a, self.b], self.out, fps=5)
        self.assertEqual(result, str(self.out))
        self.assertGreater(self.out.stat().st_size, 0)
        self.assertEqual(media_utils.probe_decoded_frame_count(self.out), 6)

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg unavailable")
    def test_real_audio_is_mapped_and_mixed_audio_is_rejected(self):
        ffmpeg = media_utils._check_ffmpeg()
        frames = np.zeros((3, 32, 32, 3), dtype=np.uint8)
        media_utils.frames_to_video(frames, self.a, fps=5)
        media_utils.frames_to_video(frames + 255, self.b, fps=5)
        with_audio = []
        for index, path in enumerate((self.a, self.b)):
            audio_path = self.root / f"audio_{index}.mp4"
            command = [
                ffmpeg, "-y", "-i", str(path), "-f", "lavfi", "-i",
                "sine=frequency=440:sample_rate=44100:duration=0.6",
                "-c:v", "copy", "-c:a", "aac", "-shortest", str(audio_path),
            ]
            result = subprocess.run(command, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr[-500:])
            with_audio.append(audio_path)
        with mock.patch.object(media_utils, "_concat_probe_path", return_value=None):
            with self.assertRaisesRegex(ValueError, "音轨结构/编码不兼容"):
                media_utils.concat_videos([with_audio[0], self.b], self.out, fps=5)
            self.assertFalse(self.out.exists())
            media_utils.concat_videos(with_audio, self.out, fps=5)
        audio_check = subprocess.run(
            [ffmpeg, "-v", "error", "-i", str(self.out), "-map", "0:a:0",
             "-f", "null", "-"], capture_output=True,
        )
        self.assertEqual(audio_check.returncode, 0, audio_check.stderr[-500:])


if __name__ == "__main__":
    unittest.main()
