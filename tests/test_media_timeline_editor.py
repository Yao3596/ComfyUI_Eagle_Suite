# -*- coding: utf-8 -*-
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import torch


REPO = pathlib.Path(__file__).resolve().parents[1]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    COMFY_ROOT = pathlib.Path(COMFY_ROOT).expanduser()
    sys.path.insert(0, str(COMFY_ROOT))
SPEC = importlib.util.spec_from_file_location(
    "eagle_suite_timeline_test_package",
    REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)

from eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor import (
    EagleMediaTimelineEditor,
    _decode_frames,
    _load_project,
    _probe_media,
    _timeline_preview_frames,
    _usable_cached_media,
)
from eagle_suite_timeline_test_package.eagle_suite.utils import get_cached_ffmpeg


class MediaTimelineEditorTests(unittest.TestCase):
    def test_contract_and_registration(self):
        self.assertIn("EagleMediaTimelineEditor", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertEqual("🦅 媒体剪辑台", PACKAGE.NODE_DISPLAY_NAME_MAPPINGS["EagleMediaTimelineEditor"])
        self.assertEqual(
            ("VIDEO", "IMAGE", "AUDIO", "STRING", "STRING"),
            EagleMediaTimelineEditor.RETURN_TYPES,
        )
        self.assertEqual(("video", "images", "audio", "timeline_json", "info"), EagleMediaTimelineEditor.RETURN_NAMES)
        inputs = EagleMediaTimelineEditor.INPUT_TYPES()
        self.assertIn("timeline_json", inputs["required"])
        self.assertEqual(("VIDEO",), inputs["optional"]["video"][:1])
        self.assertIn("audio_1", inputs["optional"])
        self.assertIn("audio_2", inputs["optional"])

    def test_project_normalization_rejects_unknown_and_invalid_clips(self):
        project = _load_project(json.dumps({
            "assets": [{"id": "v", "type": "video", "filename": "eagle_timeline/v.mp4", "duration": 2}],
            "video_clips": [
                {"id": "ok", "asset_id": "v", "in": 0, "out": 1},
                {"id": "bad-range", "asset_id": "v", "in": 2, "out": 1},
                {"id": "missing", "asset_id": "other", "in": 0, "out": 1},
            ],
            "audio_tracks": [],
        }))
        self.assertEqual(["ok"], [item["id"] for item in project["video_clips"]])
        self.assertEqual(2, len(project["audio_tracks"]))

    def test_two_video_clips_and_audio_render_to_all_outputs(self):
        ffmpeg = get_cached_ffmpeg()
        if not ffmpeg:
            self.skipTest("FFmpeg unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            input_root = root / "input"
            temp_root = root / "temp"
            media_root = input_root / "eagle_timeline"
            media_root.mkdir(parents=True)
            temp_root.mkdir(parents=True)
            red = media_root / "red.mp4"
            blue = media_root / "blue.mp4"
            music = media_root / "music.wav"
            for path, color, tone in ((red, "red", 440), (blue, "blue", 660)):
                made = subprocess.run([
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", f"color=c={color}:s=96x64:r=12:d=0.5",
                    "-f", "lavfi", "-i", f"sine=frequency={tone}:sample_rate=48000:duration=0.5",
                    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path),
                ], capture_output=True, check=False)
                self.assertEqual(0, made.returncode, made.stderr.decode("utf-8", errors="replace"))
            made = subprocess.run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=1",
                "-c:a", "pcm_s16le", str(music),
            ], capture_output=True, check=False)
            self.assertEqual(0, made.returncode, made.stderr.decode("utf-8", errors="replace"))

            with mock.patch(
                "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor._ffprobe_binary",
                return_value=None,
            ):
                fallback_metadata = _probe_media(str(red))
                fallback_audio_metadata = _probe_media(str(music))
            self.assertTrue(fallback_metadata["has_video"])
            self.assertTrue(fallback_metadata["has_audio"])
            self.assertEqual((96, 64), (fallback_metadata["width"], fallback_metadata["height"]))
            self.assertGreater(fallback_metadata["duration"], .4)
            self.assertFalse(fallback_audio_metadata["has_video"])
            self.assertTrue(fallback_audio_metadata["has_audio"])
            self.assertGreater(fallback_audio_metadata["duration"], .9)

            project = {
                "version": 1,
                "assets": [
                    {"id": "red", "type": "video", "filename": "eagle_timeline/red.mp4", "name": "red", "duration": .5},
                    {"id": "blue", "type": "video", "filename": "eagle_timeline/blue.mp4", "name": "blue", "duration": .5},
                    {"id": "music", "type": "audio", "filename": "eagle_timeline/music.wav", "name": "music", "duration": 1},
                ],
                "video_clips": [
                    {"id": "v1", "asset_id": "red", "in": 0, "out": .5, "include_audio": True},
                    {"id": "v2", "asset_id": "blue", "in": 0, "out": .5, "include_audio": True},
                ],
                "audio_tracks": [
                    {"id": "A1", "name": "A1", "clips": []},
                    {"id": "A2", "name": "A2", "clips": [
                        {"id": "a1", "asset_id": "music", "in": 0, "out": 1, "start": 0, "volume": .2, "fade_in": .05, "fade_out": .05},
                    ]},
                ],
            }
            with mock.patch(
                "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.folder_paths.get_input_directory",
                return_value=str(input_root),
            ), mock.patch(
                "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.folder_paths.get_temp_directory",
                return_value=str(temp_root),
            ):
                output = EagleMediaTimelineEditor().render(
                    timeline_json=json.dumps(project), output_mode="video_audio_frames",
                    size_mode="custom", width=128, height=72, lock_aspect_ratio=False,
                    fit_mode="cover", output_fps=12, include_video_audio=True,
                    max_frames=8,
                )
                preview_only = EagleMediaTimelineEditor().render(
                    timeline_json=json.dumps(project), output_mode="video_audio",
                    size_mode="custom", width=128, height=72, lock_aspect_ratio=False,
                    fit_mode="cover", output_fps=12, include_video_audio=True,
                )
                strip = _timeline_preview_frames(str(red), count=4, width=96)
                with mock.patch(
                    "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.MAX_OUTPUT_FRAMES",
                    3,
                ):
                    bounded_images, bounded_count, bounded = _decode_frames(str(red), max_frames=0)
                with mock.patch(
                    "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.MAX_OUTPUT_FRAME_PIXELS",
                    96 * 64 * 2,
                ):
                    pixel_images, pixel_count, pixel_bounded = _decode_frames(str(red), max_frames=0)
                with mock.patch(
                    "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.MAX_SCANNED_VIDEO_FRAMES",
                    3,
                ):
                    scan_images, scan_count, scan_bounded = _decode_frames(str(red), frame_step=240)

            result = output["result"]
            self.assertIsNotNone(result[0])
            self.assertEqual((8, 72, 128, 3), tuple(result[1].shape))
            self.assertGreater(result[2]["waveform"].shape[-1], 40000)
            self.assertEqual(2, len(json.loads(result[3])["video_clips"]))
            self.assertIn("视频片段 2", result[4])
            self.assertEqual((128, 72), tuple(result[0].get_dimensions()))
            self.assertGreater(float(result[0].get_duration()), .8)
            self.assertTrue(output["ui"]["video_url"])
            self.assertEqual((1, 72, 128, 3), tuple(preview_only["result"][1].shape))
            self.assertGreater(float(preview_only["result"][1].mean()), 0.01)
            self.assertIn("图像口首帧预览", preview_only["result"][4])
            self.assertEqual(4, len(strip["frames"]))
            self.assertTrue(all(
                (temp_root / item["subfolder"] / item["filename"]).is_file()
                for item in strip["frames"]
            ))
            self.assertEqual((3, 64, 96, 3), tuple(bounded_images.shape))
            self.assertEqual(3, bounded_count)
            self.assertTrue(bounded)
            self.assertEqual((2, 64, 96, 3), tuple(pixel_images.shape))
            self.assertEqual(2, pixel_count)
            self.assertTrue(pixel_bounded)
            self.assertEqual((1, 64, 96, 3), tuple(scan_images.shape))
            self.assertEqual(1, scan_count)
            self.assertTrue(scan_bounded)

            segment = next(temp_root.glob("eagle_timeline_renders/*/segment_0000.mp4"))
            self.assertTrue(_usable_cached_media(segment, "video"))
            segment.write_bytes(b"partial")
            self.assertFalse(_usable_cached_media(segment, "video"))
            with mock.patch(
                "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.folder_paths.get_input_directory",
                return_value=str(input_root),
            ), mock.patch(
                "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.folder_paths.get_temp_directory",
                return_value=str(temp_root),
            ):
                EagleMediaTimelineEditor().render(
                    timeline_json=json.dumps(project), output_mode="video_audio",
                    size_mode="custom", width=128, height=72, lock_aspect_ratio=False,
                    fit_mode="cover", output_fps=12, include_video_audio=True,
                )
            self.assertTrue(_usable_cached_media(segment, "video"))

    def test_connected_audio_uses_execution_private_paths(self):
        if not get_cached_ffmpeg():
            self.skipTest("FFmpeg unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            temp_root = root / "temp"
            temp_root.mkdir()
            with mock.patch(
                "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.folder_paths.get_temp_directory",
                return_value=str(temp_root),
            ):
                for amplitude in (0.2, 0.8):
                    result = EagleMediaTimelineEditor().render(
                        output_mode="audio",
                        audio_1={
                            "waveform": torch.full((1, 1, 4800), amplitude),
                            "sample_rate": 48000,
                        },
                    )
                    self.assertGreater(result["result"][2]["waveform"].shape[-1], 4000)
            private_wavs = sorted(temp_root.glob("eagle_timeline_renders/connected_inputs/*/connected_audio_1.wav"))
            mixed_wavs = sorted(temp_root.glob("eagle_timeline_renders/*/mixed.wav"))
            self.assertEqual(2, len(private_wavs))
            self.assertEqual(2, len(mixed_wavs))
            self.assertNotEqual(private_wavs[0].parent, private_wavs[1].parent)
            self.assertNotEqual(private_wavs[0].read_bytes(), private_wavs[1].read_bytes())
            self.assertTrue(_usable_cached_media(mixed_wavs[0], "audio"))
            payload = mixed_wavs[0].read_bytes()
            mixed_wavs[0].write_bytes(payload[:len(payload) // 2])
            self.assertFalse(_usable_cached_media(mixed_wavs[0], "audio"))

    def test_long_frames_mode_rejects_before_encoding(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            input_root = root / "input"
            temp_root = root / "temp"
            media_root = input_root / "eagle_timeline"
            media_root.mkdir(parents=True)
            temp_root.mkdir()
            (media_root / "long.mp4").write_bytes(b"test fixture")
            project = {
                "assets": [{"id": "long", "type": "video", "filename": "eagle_timeline/long.mp4"}],
                "video_clips": [{"asset_id": "long", "in": 0, "out": 600}],
            }
            metadata = {
                "duration": 600.0, "width": 1920, "height": 1080, "fps": 30.0,
                "has_video": True, "has_audio": False,
            }
            with mock.patch(
                "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.folder_paths.get_input_directory",
                return_value=str(input_root),
            ), mock.patch(
                "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor.folder_paths.get_temp_directory",
                return_value=str(temp_root),
            ), mock.patch(
                "eagle_suite_timeline_test_package.eagle_suite.media_timeline_editor._probe_media",
                return_value=metadata,
            ):
                with self.assertRaisesRegex(ValueError, "图像帧模式"):
                    EagleMediaTimelineEditor().render(
                        timeline_json=json.dumps(project), output_mode="frames", max_frames=1,
                    )
            self.assertFalse(list(temp_root.glob("eagle_timeline_renders/*/segment_*.mp4")))

    def test_frontend_contains_persistent_drag_timeline_controls(self):
        source = (REPO / "web" / "js" / "media_timeline_editor.js").read_text(encoding="utf-8")
        self.assertIn('/eagle/media_timeline/upload', source)
        self.assertIn('/eagle/media_timeline/preview_frames', source)
        self.assertIn('setWidget(node, "timeline_json"', source)
        self.assertIn('dropTrack($event,\'video\')', source)
        self.assertIn('function openFilePicker()', source)
        self.assertIn('载入失败', source)
        self.assertIn("splitAtPlayhead", source)
        self.assertIn("toggleFullscreen", source)
        self.assertIn("beginSeek", source)
        self.assertIn("positionPlayer", source)
        self.assertIn("emte-frame-strip", source)


if __name__ == "__main__":
    unittest.main()
