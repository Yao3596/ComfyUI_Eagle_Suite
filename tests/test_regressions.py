import importlib.util
import asyncio
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

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
    def test_director_skill_json_request_compatibility(self):
        from eagle_suite_test_package.nodes.prompt_presets import _read_json_request

        class FakeRequest:
            def __init__(self, body):
                self.body = body

            async def text(self):
                return self.body

        body, error = asyncio.run(_read_json_request(FakeRequest('{"name":"Direct payload"}'), "测试"))
        self.assertEqual({"name": "Direct payload"}, body)
        self.assertIsNone(error)

        body, error = asyncio.run(_read_json_request(FakeRequest("  "), "测试"))
        self.assertIsNone(body)
        self.assertIn("请求体为空", error)

    def test_director_skill_endpoints_accept_legacy_direct_payloads(self):
        from eagle_suite_test_package.nodes import prompt_presets

        class FakeRequest:
            def __init__(self, body):
                self.body = body

            async def text(self):
                return self.body

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            config_file = root / "config.json"
            skills_file = root / "director_skills.json"
            with mock.patch.object(prompt_presets, "CONFIG_FILE", config_file), mock.patch.object(
                prompt_presets, "DIRECTOR_SKILLS_FILE", skills_file
            ):
                config_response = asyncio.run(prompt_presets.update_config(FakeRequest('{"auto_sync":false}')))
                self.assertEqual(200, config_response.status)
                saved_config = json.loads(config_file.read_text(encoding="utf-8"))
                self.assertFalse(saved_config["auto_sync"])
                self.assertIn("obsidian", saved_config)

                skill_response = asyncio.run(prompt_presets.save_director_skill(
                    FakeRequest('{"name":"兼容测试","content":"test"}')
                ))
                self.assertEqual(200, skill_response.status)
                saved_skills = json.loads(skills_file.read_text(encoding="utf-8"))
                self.assertEqual("兼容测试", next(iter(saved_skills.values()))["name"])

                empty_response = asyncio.run(prompt_presets.save_director_skill(FakeRequest("")))
                self.assertEqual(400, empty_response.status)

    def test_director_skill_storage_reports_effective_fallback(self):
        from eagle_suite_test_package.nodes import prompt_presets

        with tempfile.TemporaryDirectory() as directory:
            default_file = pathlib.Path(directory) / "skills" / "director_skills.json"
            obsidian_config = {
                "director_skills": {"source": "obsidian"},
                "obsidian": {"vault_path": str(pathlib.Path(directory) / "missing")},
            }
            with mock.patch.object(prompt_presets, "DIRECTOR_SKILLS_FILE", default_file):
                status = prompt_presets.director_skill_storage_status(obsidian_config)
            self.assertEqual("obsidian", status["configured_source"])
            self.assertEqual("eagle", status["effective_source"])
            self.assertTrue(status["fallback_reason"])
            self.assertEqual(str(default_file.resolve()), status["storage_path"])

    def test_lora_selection_can_be_ignored_without_loading(self):
        from eagle_suite_test_package.eagle_suite import lora_gallery

        model, clip = object(), object()
        selection = json.dumps({
            "selections": [{"id": "test", "name": "Test LoRA", "weight": 0.75, "enabled": False}],
            "weights": {"test": 0.75},
            "enabled": {"test": False},
        })
        scanned = {"items": [{
            "id": "test", "name": "Test LoRA", "path": "never-loaded.safetensors",
            "rel": "folder/Test LoRA.safetensors", "triggerWords": ["should_not_emit"],
        }]}
        with mock.patch.object(lora_gallery, "_scan_loras", return_value=scanned), \
             mock.patch.object(lora_gallery.comfy.utils, "load_torch_file") as load_file:
            out_model, out_clip, info_json, triggers = lora_gallery.EagleLoraGalleryNode().load_loras(
                model, selection, clip=clip
            )
        info = json.loads(info_json)
        self.assertIs(model, out_model)
        self.assertIs(clip, out_clip)
        load_file.assert_not_called()
        self.assertEqual(0, info["count"])
        self.assertEqual(1, info["selectedCount"])
        self.assertEqual(1, info["ignoredCount"])
        self.assertFalse(info["loras"][0]["enabled"])
        self.assertEqual("", triggers)

    def test_node_output_contracts(self):
        self.assertGreaterEqual(len(PACKAGE.NODE_CLASS_MAPPINGS), 29)
        self.assertIn("EagleH3MediaPortsNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3PlanNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3ShotContextNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3CheckpointReviewNode", PACKAGE.NODE_CLASS_MAPPINGS)
        self.assertIn("EagleH3NativeLoopEndNode", PACKAGE.NODE_CLASS_MAPPINGS)
        hidden_implementation_nodes = {
            "EagleH3PreflightNode", "EagleH3LoadManifestNode", "EagleH3StartNode",
            "EagleH3CurrentShotNode", "EagleH3ContextNode", "EagleH3TrimNode",
            "EagleH3SegmentCheckpointNode", "EagleH3ReviewGateNode", "EagleH3EndNode",
            "EagleH3AssembleNode", "EagleH3FinalizeNode",
        }
        self.assertTrue(hidden_implementation_nodes.isdisjoint(PACKAGE.NODE_CLASS_MAPPINGS))
        self.assertEqual(
            "🦅 Eagle Suite/H3 导演台/核心流程",
            PACKAGE.NODE_CLASS_MAPPINGS["EagleH3ShotContextNode"].CATEGORY,
        )
        self.assertEqual(
            "🦅 Eagle Suite/H3 导演台/工具",
            PACKAGE.NODE_CLASS_MAPPINGS["EagleH3SeamProbeNode"].CATEGORY,
        )
        for name, node in PACKAGE.NODE_CLASS_MAPPINGS.items():
            returns = tuple(getattr(node, "RETURN_TYPES", ()))
            names = tuple(getattr(node, "RETURN_NAMES", returns))
            self.assertEqual(len(returns), len(names), name)
            output_is_list = getattr(node, "OUTPUT_IS_LIST", None)
            if output_is_list is not None:
                self.assertEqual(len(returns), len(output_is_list), name)

    def test_director_media_ports_are_split(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import (
            EagleH3DirectorNode,
            EagleH3MediaPortsNode,
            H3_MEDIA_BUNDLE_TYPE,
        )
        self.assertEqual(H3_MEDIA_BUNDLE_TYPE, EagleH3DirectorNode.RETURN_TYPES[1])
        self.assertEqual(7, len(EagleH3DirectorNode.RETURN_TYPES))
        self.assertTrue(EagleH3MediaPortsNode.OUTPUT_IS_LIST[0])
        self.assertEqual("REF_IMAGES", EagleH3MediaPortsNode.RETURN_NAMES[0])

    def test_director_skill_prompts_use_scene_duration_without_size_duplication(self):
        from eagle_suite_test_package.eagle_suite.h3_director_node import _build_skill_prompts

        project = {"aspect": "9:16", "resolution": "720p", "foundation": "world 100% real"}
        scene = {
            "title": "雨夜追逐",
            "defaultSeconds": 18,
            "preamble": "[Shot 1] A runner crosses the street.",
        }
        for task in ("script", "shots", "dialogue"):
            _system, user = _build_skill_prompts(task, project, scene, "", request={})
            self.assertIn("【场景时长预算】18 秒", user)
            self.assertNotIn("9:16", user)
            self.assertNotIn("720p", user)
        _system, script = _build_skill_prompts("script", project, scene, "", request={})
        self.assertNotIn("单镜头约 10 秒", script)
        self.assertIn("不要套用固定的 10 秒单镜头假设", script)
        _system, shots = _build_skill_prompts("shots", project, scene, "", request={})
        self.assertIn("estSeconds 之和约等于 18 秒", shots)

    def test_chained_skill_tasks_keep_scene_metadata(self):
        from eagle_suite_test_package.eagle_suite import h3_director_node

        prompts = []
        responses = iter([
            '{"preamble":"[Shot 1] generated"}',
            '{"shots":[{"content":"generated shot","estSeconds":18}]}',
        ])

        def fake_call(_kind, _transport, _system, user, _temperature):
            prompts.append(user)
            return next(responses)

        scene = {"id": 7, "title": "雨夜追逐", "defaultSeconds": 18,
                 "preamble": "", "shots": [], "dialogues": []}
        request = {"sceneId": 7, "tasks": ["script", "shots"], "modelPref": "api"}
        with mock.patch.object(h3_director_node, "_select_transport", return_value=("api", {})), \
             mock.patch.object(h3_director_node, "_call_llm", side_effect=fake_call):
            result = h3_director_node.run_director_skill({}, [scene], request)

        self.assertIsNone(result["error"])
        self.assertEqual(2, len(prompts))
        self.assertIn("【场景标题】雨夜追逐", prompts[1])
        self.assertIn("【场景时长预算】18 秒", prompts[1])

    def test_skill_generation_orders_tasks_and_passes_references_and_shots(self):
        from eagle_suite_test_package.eagle_suite import h3_director_node

        prompts = []
        responses = iter([
            '{"preamble":"Use <Picture 1>. <d>[Nali] 走吧</d>"}',
            '{"shots":[{"content":"Nali continues walking","estSeconds":8}]}',
            '{"dialogues":[{"role":"Nali","text":"走吧","time":"00:01.000"}]}',
        ])

        def fake_call(_kind, _transport, _system, user, _temperature):
            prompts.append(user)
            return next(responses)

        project = {"mediaRefs": [{
            "id": "nali", "type": "image", "filename": "nali.png",
            "name": "Nali", "kind": "person", "retention": "fully_preserved",
        }]}
        scenes = [
            {"id": 1, "title": "开场", "defaultSeconds": 8,
             "preamble": "", "shots": [], "dialogues": []},
            {"id": 2, "title": "续场", "defaultSeconds": 8,
             "preamble": "", "shots": [], "dialogues": []},
        ]
        request = {"sceneId": 2, "tasks": ["dialogue", "shots", "script"], "modelPref": "api"}
        with mock.patch.object(h3_director_node, "_select_transport", return_value=("api", {})), \
             mock.patch.object(h3_director_node, "_call_llm", side_effect=fake_call):
            result = h3_director_node.run_director_skill(project, scenes, request)

        self.assertIsNone(result["error"])
        self.assertIn("<Picture 1>: image | person | Nali", prompts[0])
        self.assertIn("上一场景：开场", prompts[0])
        self.assertIn("【已生成分镜】", prompts[2])
        self.assertIn("Nali continues walking", prompts[2])

    def test_skill_generation_rejects_stale_scene_id(self):
        from eagle_suite_test_package.eagle_suite import h3_director_node

        request = {"sceneId": 999, "tasks": ["script"], "modelPref": "api"}
        with mock.patch.object(h3_director_node, "_select_transport", return_value=("api", {})), \
             mock.patch.object(h3_director_node, "_call_llm") as call:
            result = h3_director_node.run_director_skill({}, [{"id": 1}], request)
        self.assertIn("sceneId", result["error"])
        call.assert_not_called()

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

    def test_video_workflow_metadata_round_trip(self):
        import av
        from eagle_suite_test_package.eagle_suite.utils import get_cached_ffmpeg
        from eagle_suite_test_package.eagle_suite.workflow_metadata import (
            build_workflow_bundle,
            embed_workflow_in_media,
        )
        ffmpeg = get_cached_ffmpeg()
        with tempfile.TemporaryDirectory() as directory:
            video_path = pathlib.Path(directory, "workflow.mp4")
            created = subprocess.run(
                [ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.2",
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_path)],
                capture_output=True, check=False,
            )
            self.assertEqual(0, created.returncode)
            workflow = {"last_node_id": 1, "nodes": [], "links": [], "version": 0.4}
            prompt = {"1": {"class_type": "Test", "inputs": {}}}
            result = embed_workflow_in_media(
                video_path, build_workflow_bundle(prompt, {"workflow": workflow}), ffmpeg
            )
            self.assertTrue(result["success"], result["message"])
            with av.open(str(video_path)) as container:
                metadata = {str(k).lower(): str(v) for k, v in container.metadata.items()}
            self.assertEqual(workflow, json.loads(metadata["workflow"]))
            self.assertEqual(prompt, json.loads(metadata["prompt"]))

    def test_video_ports_use_native_comfyui_contract(self):
        from comfy_api.input import VideoInput
        from eagle_suite_test_package.eagle_suite.advanced_video_saver import EagleAdvancedVideoSaver
        from eagle_suite_test_package.eagle_suite.audio_nodes import EagleAudioExtractor
        from eagle_suite_test_package.eagle_suite.batch_video_nodes import (
            EagleBatchVideoLoader,
            EagleVideoFrameExtractor,
            EagleVideoInfo,
            _native_videos,
            _passthrough_video,
        )
        from eagle_suite_test_package.eagle_suite.video_nodes import (
            EagleImagesToVideo,
            EagleVideoConverter,
            _coerce_native_video,
            _native_video,
        )
        from eagle_suite_test_package.eagle_suite.utils import get_cached_ffmpeg

        self.assertEqual(("VIDEO", "VIDEO"), EagleImagesToVideo.RETURN_TYPES[2::2])
        self.assertEqual("VIDEO", EagleImagesToVideo.INPUT_TYPES()["optional"]["input_video"][0])
        self.assertEqual("VIDEO", EagleVideoConverter.INPUT_TYPES()["optional"]["video"][0])
        self.assertEqual("VIDEO", EagleVideoConverter.RETURN_TYPES[3])
        self.assertEqual("VIDEO", EagleBatchVideoLoader.RETURN_TYPES[6])
        self.assertTrue(EagleBatchVideoLoader.OUTPUT_IS_LIST[6])
        self.assertEqual("VIDEO", EagleVideoFrameExtractor.RETURN_TYPES[-1])
        self.assertEqual("VIDEO", EagleVideoInfo.RETURN_TYPES[-1])
        self.assertEqual("VIDEO", EagleAudioExtractor.INPUT_TYPES()["required"]["video_path"][0])
        self.assertEqual(("VIDEO", "VIDEO", "AUDIO"), EagleAdvancedVideoSaver.RETURN_TYPES[:3])

        with tempfile.TemporaryDirectory() as directory:
            video_path = pathlib.Path(directory, "native.mp4")
            created = subprocess.run(
                [get_cached_ffmpeg(), "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1",
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_path)],
                capture_output=True, check=False,
            )
            self.assertEqual(0, created.returncode)
            native = _native_video(str(video_path))
            self.assertIsInstance(native, VideoInput)
            self.assertIsInstance(_coerce_native_video(str(video_path)), VideoInput)
            self.assertEqual(1, len(_native_videos([str(video_path)])))
            self.assertIsInstance(_native_videos([str(video_path)])[0], VideoInput)
            self.assertIsInstance(_passthrough_video(str(video_path)), VideoInput)

        error_result = EagleAdvancedVideoSaver._error_result("test")["result"]
        self.assertIsNone(error_result[0])
        self.assertIsNone(error_result[1])

    def test_gif_creates_standard_workflow_png(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite.utils import get_cached_ffmpeg
        from eagle_suite_test_package.eagle_suite.workflow_metadata import (
            build_workflow_bundle,
            save_workflow_companion_png,
        )
        workflow = {"last_node_id": 0, "nodes": [], "links": [], "version": 0.4}
        prompt = {"1": {"class_type": "Test", "inputs": {}}}
        with tempfile.TemporaryDirectory() as directory:
            gif_path = pathlib.Path(directory, "animation.gif")
            Image.new("RGB", (32, 32), "black").save(gif_path, format="GIF")
            png_path = save_workflow_companion_png(
                gif_path, build_workflow_bundle(prompt, {"workflow": workflow}), get_cached_ffmpeg()
            )
            self.assertTrue(png_path)
            with Image.open(png_path) as companion:
                self.assertEqual(workflow, json.loads(companion.info["workflow"]))
                self.assertEqual(prompt, json.loads(companion.info["prompt"]))

    def test_route_decorator_is_idempotent(self):
        from eagle_suite_test_package.eagle_suite import route_registry
        before = len(route_registry._route_handlers)

        async def handler(request):
            return request

        route_registry.route("GET", "/__eagle_test_idempotent")(handler)
        route_registry.route("GET", "/__eagle_test_idempotent")(handler)
        self.assertEqual(before + 1, len(route_registry._route_handlers))

    def test_h3_media_upload_routes_are_declared(self):
        from eagle_suite_test_package.eagle_suite import route_registry
        routes = {(method, path) for method, path, _handler in route_registry._route_handlers}
        self.assertIn(("GET", "/h3_director/input_images"), routes)
        self.assertIn(("POST", "/h3_director/upload_media"), routes)
        self.assertIn(("POST", "/h3_director/upload_ref"), routes)

    def test_h3_input_image_listing_and_safe_resolution(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite import h3_director_node

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            nested = root / "references"
            nested.mkdir()
            image_path = nested / "hero.png"
            Image.new("RGB", (20, 12), "blue").save(image_path)
            (nested / "ignore.txt").write_text("no", encoding="utf-8")
            with mock.patch.object(h3_director_node, "_comfy_input_root", return_value=root.resolve()):
                response = asyncio.run(h3_director_node.list_input_images(None))
                payload = json.loads(response.body.decode("utf-8"))
                self.assertTrue(payload["success"])
                self.assertEqual(["references/hero.png"], [item["path"] for item in payload["items"]])
                self.assertEqual(str(image_path.resolve()), h3_director_node._media_path("references/hero.png"))
                self.assertEqual("", h3_director_node._media_path("../outside.png"))

    def test_gif_resize_palette_and_frame_skip_duration(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite.gif_compressor import GifCompressorNode

        base = torch.linspace(0, 1, 96).view(1, 96, 1).repeat(64, 1, 3)
        gradient = torch.stack([base.roll(index * 7, dims=1) for index in range(6)])
        with tempfile.TemporaryDirectory() as directory:
            _preview, output_path, status = GifCompressorNode().compress_gif(
                gradient, "", 8, 1.0, 2, 100,
                resize_mode="指定宽度", target_width=48, target_height=512,
                dither_mode="无抖动", 保持总时长=True, 播放速度=1.0,
                local_save_path=directory, filename_prefix="timing",
            )
            self.assertTrue(pathlib.Path(output_path).is_file(), status)
            with Image.open(output_path) as gif:
                self.assertEqual((48, 32), gif.size)
                self.assertEqual(3, gif.n_frames)
                self.assertEqual(200, gif.info.get("duration"))
                gif.seek(0)
                colors = gif.convert("RGB").getcolors(maxcolors=256)
                self.assertIsNotNone(colors)
                self.assertLessEqual(len(colors), 8)

    def test_h3_uploaded_image_validation(self):
        from PIL import Image
        from eagle_suite_test_package.eagle_suite.h3_director_node import _validate_uploaded_image
        with tempfile.TemporaryDirectory() as directory:
            image_path = pathlib.Path(directory, "reference.png")
            Image.new("RGB", (16, 16), "white").save(image_path)
            _validate_uploaded_image(image_path)

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
