import importlib.util
import asyncio
import copy
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

import torch


REPO = pathlib.Path(__file__).resolve().parents[1]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT")
if COMFY_ROOT:
    sys.path.insert(0, COMFY_ROOT)
SPEC = importlib.util.spec_from_file_location(
    "eagle_suite_review_test_package", REPO / "__init__.py",
    submodule_search_locations=[str(REPO)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)


class ReviewGateTests(unittest.TestCase):
    def setUp(self):
        from eagle_suite_review_test_package.eagle_suite.review_gate import EagleReviewGate
        EagleReviewGate.clear_pending_for_tests()
        self.gate = EagleReviewGate()

    def tearDown(self):
        type(self.gate).clear_pending_for_tests()

    def test_pending_blocks_downstream_and_approval_reuses_exact_value(self):
        from comfy_execution.graph_utils import ExecutionBlocker

        images = torch.rand((1, 8, 8, 3))
        self.assertEqual(["value"], self.gate.check_lazy_status(True, "", "node-1"))
        pending = self.gate.run(images, True, "", "node-1")
        self.assertIsInstance(pending["result"][0], ExecutionBlocker)
        token = pending["ui"]["eagle_review"][0]["token"]
        self.assertTrue(token)
        self.assertEqual([], self.gate.check_lazy_status(True, token, "node-1"))
        approved = self.gate.run(None, True, token, "node-1")
        self.assertIs(approved["result"][0], images)
        self.assertEqual("approved", approved["ui"]["eagle_review"][0]["state"])
        self.assertEqual([], self.gate.check_lazy_status(True, token, "node-1"))
        expired = self.gate.run(None, True, token, "node-1")
        self.assertIsInstance(expired["result"][0], ExecutionBlocker)

    def test_new_run_replaces_pending_and_old_token_cannot_approve(self):
        from comfy_execution.graph_utils import ExecutionBlocker

        old_token = self.gate.run("old", True, "", "node-2")["ui"]["eagle_review"][0]["token"]
        new_token = self.gate.run("new", True, "", "node-2")["ui"]["eagle_review"][0]["token"]
        self.assertNotEqual(old_token, new_token)
        self.assertIsInstance(self.gate.run(None, True, old_token, "node-2")["result"][0], ExecutionBlocker)
        self.assertEqual("new", self.gate.run(None, True, new_token, "node-2")["result"][0])

    def test_empty_result_retires_the_previous_approval(self):
        pending = self.gate.run("old", True, "", "empty-result")["ui"]["eagle_review"][0]
        empty = self.gate.run(None, True, "", "empty-result")["ui"]["eagle_review"][0]
        self.assertEqual("empty", empty["state"])
        retired = self.gate.run(None, True, pending["token"], "empty-result")["ui"]["eagle_review"][0]
        self.assertEqual("expired", retired["state"])

    def test_switch_off_passes_value_without_confirmation(self):
        value = {"any": "payload"}
        self.assertEqual(["value"], self.gate.check_lazy_status(False, "", "node-3"))
        self.assertIs(self.gate.run(value, False, "", "node-3")["result"][0], value)

    def test_pending_batch_previews_each_full_size_image_and_reuses_the_value(self):
        import folder_paths
        from PIL import Image

        images = torch.zeros((2, 620, 1030, 4))
        images[0, 1, 2] = torch.tensor([1.0, 0.0, 1.0, 0.0])
        images[1, 4, 5] = torch.tensor([0.0, 1.0, 0.0, 1.0])
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            folder_paths, "get_temp_directory", return_value=directory,
        ):
            pending = self.gate.run(images, True, "", "image-preview")["ui"]["eagle_review"][0]
            self.assertEqual(2, len(pending["images"]))
            for preview, xy, expected in zip(
                pending["images"], [(2, 1), (5, 4)], [(255, 0, 255, 0), (0, 255, 0, 255)],
            ):
                self.assertEqual("temp", preview["type"])
                path = pathlib.Path(directory, preview["subfolder"], preview["filename"])
                with Image.open(path) as image:
                    self.assertEqual("PNG", image.format)
                    self.assertEqual((1030, 620), image.size)
                    self.assertEqual(expected, image.getpixel(xy))
            files = list(pathlib.Path(directory).rglob("*.png"))
            approved = self.gate.run(None, True, pending["token"], "image-preview")
            self.assertIs(images, approved["result"][0])
            self.assertEqual(files, list(pathlib.Path(directory).rglob("*.png")),
                             "approval reuses the existing preview and original input")

    def test_preview_also_works_without_confirmation_or_a_saver(self):
        import folder_paths
        from PIL import Image

        self.assertTrue(getattr(type(self.gate), "OUTPUT_NODE", False),
                        "a connected preview must work before adding a saver")
        image = torch.ones((1, 520, 700, 1))
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            folder_paths, "get_temp_directory", return_value=directory,
        ):
            result = self.gate.run(image, False, "", "image-preview")
            self.assertIs(image, result["result"][0])
            payload = result["ui"]["eagle_review"][0]
            self.assertEqual("bypass", payload["state"])
            self.assertNotIn("workflow", payload)
            [preview] = payload["images"]
            with Image.open(pathlib.Path(directory, preview["subfolder"], preview["filename"])) as preview_image:
                self.assertEqual((700, 520), preview_image.size)
                self.assertEqual(255, preview_image.getpixel((0, 0)))

    def test_workflow_remains_available_as_json_when_png_metadata_is_disabled(self):
        import folder_paths
        import nodes as comfy_nodes
        from PIL import Image

        workflow = {"version": 1, "nodes": [{"id": 1, "widgets_values_named": {"seed": 12}}],
                    "links": [{"id": 2, "origin_id": 1, "target_id": 3}], "extra": {"fixture": [1, 2]}}
        prompt = {"1": {"class_type": "TestImageSource", "inputs": {"seed": 12}}}
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            folder_paths, "get_temp_directory", return_value=directory,
        ), mock.patch.object(comfy_nodes.args, "disable_metadata", True):
            result = self.gate.run(torch.zeros((1, 2, 3, 3)), prompt=prompt,
                                   extra_pnginfo={"workflow": workflow, "fixture": {"sample": "保留"}})
            payload = result["ui"]["eagle_review"][0]
            self.assertEqual(workflow, payload["workflow"])
            [preview] = payload["images"]
            with Image.open(pathlib.Path(directory, preview["subfolder"], preview["filename"])) as image:
                self.assertEqual((3, 2), image.size)
                self.assertFalse({"workflow", "prompt", "fixture"}.intersection(image.info))

    def test_comparison_previews_reference_and_approval_returns_only_final_images(self):
        import folder_paths
        from PIL import Image

        final = torch.ones((2, 10, 8, 3))
        reference = torch.zeros((1, 6, 14, 3))
        self.assertEqual("IMAGE", self.gate.INPUT_TYPES()["optional"]["对比图像"][0])
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            folder_paths, "get_temp_directory", return_value=directory,
        ):
            pending = self.gate.run(final, True, "", "compare", 对比图像=reference)["ui"]["eagle_review"][0]
            self.assertEqual(2, len(pending["images"]))
            [before] = pending["reference_images"]
            with Image.open(pathlib.Path(directory, before["subfolder"], before["filename"])) as image:
                self.assertEqual((14, 6), image.size)
                self.assertEqual((0, 0, 0), image.getpixel((0, 0)))
            saved = set(pathlib.Path(directory).rglob("*.png"))
            approved = self.gate.run(None, True, pending["token"], "compare")
            self.assertEqual(1, len(approved["result"]))
            self.assertIs(final, approved["result"][0])
            self.assertEqual(saved, set(pathlib.Path(directory).rglob("*.png")))

    def test_comparison_input_does_not_replace_text_or_create_a_preview_for_it(self):
        result = self.gate.run("文字结果", False, 对比图像=torch.zeros((1, 2, 2, 3)))
        self.assertEqual(("文字结果",), result["result"])
        self.assertEqual([], result["ui"]["eagle_review"][0].get("reference_images", []))

    def test_input_thumbnail_is_resized_and_cannot_read_outside_media_directories(self):
        import io
        from urllib.parse import urlencode

        from aiohttp.test_utils import make_mocked_request
        import folder_paths
        from PIL import Image
        from eagle_suite_review_test_package.eagle_suite import review_gate

        def thumbnail(name):
            path = "/eagle_review/input_thumbnail?" + urlencode({"filename": name})
            return asyncio.run(review_gate.review_input_thumbnail(make_mocked_request("GET", path)))

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            input_dir = root / "input"
            (input_dir / "shots").mkdir(parents=True)
            Image.new("RGB", (512, 256), "orange").save(input_dir / "shots" / "入口.png")
            Image.new("RGB", (512, 256), "blue").save(root / "private.png")
            with mock.patch.object(folder_paths, "get_input_directory", return_value=str(input_dir)):
                result = thumbnail("shots/入口.png")
                self.assertEqual(200, result.status)
                with Image.open(io.BytesIO(result.body)) as image:
                    self.assertEqual((128, 64), image.size)
                self.assertEqual(404, thumbnail("../private.png").status)
                self.assertEqual(404, thumbnail(str(root / "private.png")).status)

    def test_any_contract_and_comfy_ui_payload(self):
        from comfy_execution.graph_utils import ExecutionBlocker
        from execution import get_output_from_returns
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_CLASS_MAPPINGS

        definition = self.gate.INPUT_TYPES()
        self.assertEqual("*", definition["required"]["value"][0])
        self.assertTrue(definition["required"]["value"][1]["lazy"])
        self.assertIs(NODE_CLASS_MAPPINGS["EagleReviewGate"], type(self.gate))
        output, ui, _, = get_output_from_returns(
            [self.gate.run("review text", True, "", "node-4")], type(self.gate)
        )
        self.assertIsInstance(output[0][0], ExecutionBlocker)
        self.assertEqual("pending", ui["eagle_review"][0]["state"])

    def test_expired_approval_does_not_evaluate_upstream(self):
        self.assertEqual([], self.gate.check_lazy_status(True, "obsolete-token", "node-5"))

    def test_repeat_switch_defaults_off_and_preview_name_is_updated(self):
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_DISPLAY_NAME_MAPPINGS

        optional = self.gate.INPUT_TYPES().get("optional", {})
        self.assertIn("保存后重新开始", optional)
        self.assertFalse(optional["保存后重新开始"][1]["default"])
        self.assertEqual("🦅 预览确认", NODE_DISPLAY_NAME_MAPPINGS["EagleReviewGate"])


class SaverGapTests(unittest.TestCase):
    def test_fill_gaps_uses_smallest_free_number_and_default_keeps_max_plus_one(self):
        from eagle_suite_review_test_package.eagle_suite import eagle_saver

        with tempfile.TemporaryDirectory() as directory:
            for name in ("ComfyUI_0000.png", "ComfyUI_0002.png", "ComfyUI_0469.png"):
                pathlib.Path(directory, name).write_bytes(b"occupied")
            images = torch.zeros((2, 2, 2, 3))
            saver = eagle_saver.EagleSaver()
            saver.save_images(images, "", directory, fill_number_gaps=True)
            self.assertTrue(pathlib.Path(directory, "ComfyUI_0001.png").is_file())
            self.assertTrue(pathlib.Path(directory, "ComfyUI_0003.png").is_file())
            saver.save_images(images[:1], "", directory)
            self.assertTrue(pathlib.Path(directory, "ComfyUI_0470.png").is_file())

    def test_gap_mode_respects_start_and_ignores_other_prefixes(self):
        from eagle_suite_review_test_package.eagle_suite import eagle_saver

        with tempfile.TemporaryDirectory() as directory:
            pathlib.Path(directory, "Other_0005.png").write_bytes(b"unrelated")
            pathlib.Path(directory, "ComfyUI_0005.webp").write_bytes(b"other extension")
            saver = eagle_saver.EagleSaver()
            saver.save_images(torch.zeros((1, 2, 2, 3)), "", directory,
                              filename_number_start=5, fill_number_gaps=True)
            self.assertTrue(pathlib.Path(directory, "ComfyUI_0005.png").is_file())

    def test_gap_switch_is_last_optional_widget_for_existing_workflows(self):
        from eagle_suite_review_test_package.eagle_suite.eagle_saver import EagleSaver

        optional = list(EagleSaver.INPUT_TYPES()["optional"])
        self.assertEqual("fill_number_gaps", optional[-1])
        self.assertFalse(EagleSaver.INPUT_TYPES()["optional"]["fill_number_gaps"][1]["default"])

    def test_eagle_only_gap_mode_uses_existing_item_names(self):
        from eagle_suite_review_test_package.eagle_suite import eagle_saver

        existing = [{"name": "ComfyUI_0000"}, {"name": "ComfyUI_0002.png"}]
        with mock.patch.object(eagle_saver.eagle_client, "parse_folder_input", return_value=("folder", "eagle_id")), \
                mock.patch.object(eagle_saver.eagle_client, "resolve_folder_id", return_value=("folder", False)), \
                mock.patch.object(eagle_saver.eagle_client, "get_items_in_folder", return_value=existing), \
                mock.patch.object(eagle_saver.eagle_client, "add_item_from_path", return_value={"status": "success"}) as add_item, \
                mock.patch.object(eagle_saver.time, "sleep"):
            eagle_saver.EagleSaver().save_images(
                torch.zeros((1, 2, 2, 3)), "folder", fill_number_gaps=True
            )
        self.assertEqual("ComfyUI_0001", add_item.call_args.kwargs["name"])


class ExecutionIsolationIntegrationTests(unittest.TestCase):
    def test_joint_approval_with_different_source_metadata_blocks_without_consuming_tokens(self):
        from comfy_execution.graph_utils import ExecutionBlocker
        from eagle_suite_review_test_package.eagle_suite.execution_isolation import make_prompt_filter
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_CLASS_MAPPINGS

        gate = NODE_CLASS_MAPPINGS["EagleReviewGate"]()
        resume = NODE_CLASS_MAPPINGS["EagleReviewGateResume"]()
        prompt = {}
        tokens = {}
        for key in ("left", "right"):
            pending = gate.run(key, unique_id=key, extra_pnginfo={"workflow": {"id": key}})
            tokens[key] = pending["ui"]["eagle_review"][0]["token"]
            prompt[key] = {"class_type": "EagleReviewGate", "inputs": {"确认令牌": tokens[key]}}
            prompt[f"save-{key}"] = {"class_type": "EagleSaveString", "inputs": {"text": [key, 0]}}

        isolated = make_prompt_filter(NODE_CLASS_MAPPINGS)({"prompt": prompt})["prompt"]
        for key, token in tokens.items():
            result = resume.run(确认令牌=token, unique_id=key, prompt=isolated)
            self.assertIsInstance(result["result"][0], ExecutionBlocker)
            self.assertEqual("error", result["ui"]["eagle_review"][0]["state"])
        for key, token in tokens.items():
            self.assertEqual(key, resume.run(确认令牌=token, unique_id=key)["result"][0])

    def test_stale_queued_or_mismatched_approval_does_not_apply_candidate_metadata(self):
        from comfy_execution.graph import DynamicPrompt
        from comfy_execution.graph_utils import ExecutionBlocker
        from eagle_suite_review_test_package.eagle_suite.execution_isolation import make_prompt_filter
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_CLASS_MAPPINGS

        gate = NODE_CLASS_MAPPINGS["EagleReviewGate"]()
        resume = NODE_CLASS_MAPPINGS["EagleReviewGateResume"]()
        run_filter = make_prompt_filter(NODE_CLASS_MAPPINGS)
        original_prompt = {"source": {"class_type": "EagleText", "inputs": {"text": "old"}}}
        original_pnginfo = {"workflow": {"version": 1, "nodes": [{"id": 1}]}}
        first = gate.run("old", unique_id="gate", prompt=original_prompt,
                         extra_pnginfo=original_pnginfo)["ui"]["eagle_review"][0]
        live_pnginfo = {"workflow": {"version": 1, "nodes": [{"id": 2}]}}
        payload = {"prompt": {
            "gate": {"class_type": "EagleReviewGate", "inputs": {"确认令牌": first["token"]}},
            "save": {"class_type": "EagleSaveString", "inputs": {"text": ["gate", 0]}},
        }, "extra_data": {"extra_pnginfo": live_pnginfo, "client_id": "browser"}}
        queued = run_filter(payload)
        self.assertEqual({"extra_pnginfo": original_pnginfo, "client_id": "browser"}, queued["extra_data"])
        runtime = DynamicPrompt(queued["prompt"])

        wrong_gate = resume.run(确认令牌=first["token"], unique_id="other-gate",
                                prompt=queued["prompt"], dynprompt=runtime)
        self.assertIsInstance(wrong_gate["result"][0], ExecutionBlocker)
        self.assertIs(runtime.get_original_prompt(), queued["prompt"])

        newer = gate.run("new", unique_id="gate", extra_pnginfo=live_pnginfo)["ui"]["eagle_review"][0]
        expired = resume.run(确认令牌=first["token"], unique_id="gate",
                             prompt=queued["prompt"], dynprompt=runtime)
        self.assertIsInstance(expired["result"][0], ExecutionBlocker)
        self.assertIs(runtime.get_original_prompt(), queued["prompt"])
        self.assertEqual(live_pnginfo, run_filter(payload)["extra_data"]["extra_pnginfo"])
        self.assertEqual("new", gate.run(确认令牌=newer["token"], unique_id="gate")["result"][0])

    def test_savers_keep_the_approved_candidates_workflow_and_never_regenerate(self):
        import folder_paths
        import nodes as comfy_nodes
        from PIL import Image
        from execution import PromptExecutor, validate_prompt
        from types import SimpleNamespace
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_CLASS_MAPPINGS
        from eagle_suite_review_test_package.eagle_suite.execution_isolation import make_prompt_filter

        calls = []
        images = torch.ones((1, 40, 60, 3))

        class ImageSource:
            RETURN_TYPES = ("IMAGE",)
            FUNCTION = "run"

            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {"seed": ("INT", {})}}

            def run(self, seed):
                calls.append(seed)
                return (images,)

        registry = {**comfy_nodes.NODE_CLASS_MAPPINGS, **NODE_CLASS_MAPPINGS, "TestImageSource": ImageSource}
        filter_prompt = make_prompt_filter(NODE_CLASS_MAPPINGS, registry)
        prompt = {
            "1": {"class_type": "TestImageSource", "inputs": {"seed": 41}},
            "2": {"class_type": "EagleReviewGate", "inputs": {
                "value": ["1", 0], "需要确认": True, "确认令牌": "",
            }},
        }
        workflow = {"version": 0.4, "nodes": [{"id": 1, "type": "TestImageSource", "widgets_values": [41]}],
                    "links": [[1, 1, 0, 2, 0, "IMAGE"]], "extra": {"fixture": "原始工作流"}}
        extra_pnginfo = {"workflow": workflow, "fixture": {"frames": [1, 2], "origin": "原始生成"}}
        submit_data = {"extra_pnginfo": extra_pnginfo, "keep_fixture": "resume queue setting"}
        server = SimpleNamespace(client_id=None, last_node_id=None, sockets_metadata={},
                                 send_sync=lambda *_args: None)
        executor = PromptExecutor(server, cache_type=False, cache_args={"ram": 0.0, "ram_inactive": 0.0})

        def execute(prompt_id):
            submission = filter_prompt({"prompt": prompt, "extra_data": submit_data})
            inputs = submission["prompt"]
            valid, error, outputs, node_errors = asyncio.run(validate_prompt(
                prompt_id, inputs, submission.get("partial_execution_targets")))
            self.assertTrue(valid, error)
            self.assertFalse(node_errors)
            executor.execute(inputs, prompt_id, submission["extra_data"], execute_outputs=outputs)
            self.assertTrue(executor.success, executor.status_messages)
            return executor.history_result["outputs"]["2"]["eagle_review"][0]

        with tempfile.TemporaryDirectory() as scratch, mock.patch.dict(comfy_nodes.NODE_CLASS_MAPPINGS, registry), \
                mock.patch.object(comfy_nodes.args, "disable_metadata", False):
            temp = pathlib.Path(scratch, "preview")
            output = pathlib.Path(scratch, "output")
            temp.mkdir()
            output.mkdir()
            with mock.patch.object(folder_paths, "get_temp_directory", return_value=str(temp)), \
                    mock.patch.object(folder_paths, "get_output_directory", return_value=str(output)):
                standalone = execute("standalone")
                self.assertEqual("pending", standalone["state"])
                self.assertEqual([41], calls)
                prompt["3"] = {"class_type": "SaveImage", "inputs": {
                    "images": ["2", 0], "filename_prefix": "approved_native",
                }}
                prompt["4"] = {"class_type": "EagleSaver", "inputs": {
                    "images": ["2", 0], "eagle_folder": "", "local_save_path": str(output),
                    "filename_prefix": "approved_eagle",
                }}
                prompt["5"] = {"class_type": "EagleAPIKeyNode", "inputs": {"api_key": "fixture-secret"}}
                source_prompt = copy.deepcopy(prompt)
                source_prompt["5"]["inputs"]["api_key"] = ""
                source_extra = copy.deepcopy(extra_pnginfo)
                pending = execute("with-saver")
                self.assertEqual("pending", pending["state"])
                self.assertFalse(list(output.glob("*.png")))
                self.assertEqual(source_extra["workflow"], pending.get("workflow"))
                [preview] = pending["images"]
                with Image.open(temp / preview["subfolder"] / preview["filename"]) as image:
                    self.assertEqual(source_prompt, json.loads(image.info["prompt"]))
                    self.assertEqual(source_extra["workflow"], json.loads(image.info["workflow"]))
                    self.assertEqual(source_extra["fixture"], json.loads(image.info["fixture"]))
                # Only approval may enter the native saver, even with no browser partial targets.
                before_approval = list(calls)
                prompt["2"]["inputs"]["确认令牌"] = pending["token"]
                prompt["1"]["inputs"]["seed"] = 9001
                workflow["nodes"][0]["widgets_values"][0] = 9001
                extra_pnginfo["fixture"]["origin"] = "已编辑"
                self.assertEqual("approved", execute("approval")["state"])
                self.assertEqual(before_approval, calls)
                [native] = list(output.glob("approved_native_*.png"))
                [eagle] = list(output.glob("approved_eagle_*.png"))
                with Image.open(native) as image:
                    self.assertEqual((60, 40), image.size)
                    self.assertEqual((255, 255, 255), image.getpixel((0, 0)))
                    self.assertEqual(source_prompt, json.loads(image.info["prompt"]))
                    self.assertEqual(source_extra["workflow"], json.loads(image.info["workflow"]))
                    self.assertEqual(source_extra["fixture"], json.loads(image.info["fixture"]))
                with Image.open(eagle) as image:
                    self.assertEqual(source_extra["workflow"], json.loads(image.info["workflow"]))
                    self.assertEqual(source_prompt, json.loads(image.info["eagle_suite_meta"])["inputs"])

    def test_waiting_status_is_sent_only_to_the_gate_in_the_requested_branch(self):
        from types import SimpleNamespace
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_CLASS_MAPPINGS
        from eagle_suite_review_test_package.eagle_suite.execution_isolation import register_prompt_filter

        messages = []
        server = SimpleNamespace(on_prompt_handlers=[], send_sync=lambda *args: messages.append(args))
        server.add_on_prompt_handler = server.on_prompt_handlers.append
        register_prompt_filter(server, NODE_CLASS_MAPPINGS, NODE_CLASS_MAPPINGS)
        prompt = {}
        for letter in ("a", "b"):
            prompt[f"source_{letter}"] = {"class_type": "EagleText", "inputs": {"text": letter}}
            prompt[f"gate_{letter}"] = {"class_type": "EagleReviewGate", "inputs": {
                "value": [f"source_{letter}", 0], "需要确认": True, "确认令牌": ""}}
            prompt[f"save_{letter}"] = {"class_type": "EagleSaveString", "inputs": {"text": [f"gate_{letter}", 0]}}
        payload = {"prompt": prompt, "partial_execution_targets": ["save_a"], "client_id": "browser"}
        server.on_prompt_handlers[0](payload)
        self.assertEqual([("eagle_preview_waiting", {"node_ids": ["gate_a"]}, "browser")], messages)
        messages.clear()
        prompt["gate_a"]["inputs"]["确认令牌"] = "current-approval"
        server.on_prompt_handlers[0](payload)
        self.assertEqual([], messages)

    def test_preview_gate_is_eager_until_real_input_arrives_but_approval_stays_lazy(self):
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_CLASS_MAPPINGS
        from eagle_suite_review_test_package.eagle_suite.execution_isolation import make_prompt_filter

        self.assertIn("EagleReviewGateEager", NODE_CLASS_MAPPINGS)
        run_filter = make_prompt_filter(NODE_CLASS_MAPPINGS, NODE_CLASS_MAPPINGS)
        payload = {"prompt": {
            "source": {"class_type": "EagleText", "inputs": {"text": "current value"}},
            "gate": {"class_type": "EagleReviewGate", "inputs": {
                "value": ["source", 0], "需要确认": True, "确认令牌": ""}},
            "save": {"class_type": "EagleSaveString", "inputs": {"text": ["gate", 0]}},
        }}
        filtered = run_filter(payload)
        eager = NODE_CLASS_MAPPINGS[filtered["prompt"]["gate"]["class_type"]]
        self.assertFalse(eager.INPUT_TYPES()["required"]["value"][1]["lazy"])
        self.assertEqual("EagleReviewGate", payload["prompt"]["gate"]["class_type"])
        pending = eager().run("same current value", True, "", "gate-input-test")
        token = pending["ui"]["eagle_review"][0]["token"]
        payload["prompt"]["gate"]["inputs"]["确认令牌"] = token
        filtered = run_filter(payload)
        approval = NODE_CLASS_MAPPINGS[filtered["prompt"]["gate"]["class_type"]]
        self.assertEqual("EagleReviewGateResume", filtered["prompt"]["gate"]["class_type"])
        self.assertNotIn("value", filtered["prompt"]["gate"]["inputs"])
        self.assertTrue(approval.INPUT_TYPES()["optional"]["value"][1]["lazy"])
        self.assertEqual("same current value", approval().run(None, True, token, "gate-input-test")["result"][0])

    def test_real_comfy_scheduler_never_reschedules_sampler_when_continuing(self):
        import nodes as comfy_nodes
        from comfy_execution.graph import DynamicPrompt, ExecutionList
        from execution import get_output_data, validate_prompt
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_CLASS_MAPPINGS
        from eagle_suite_review_test_package.eagle_suite.execution_isolation import make_prompt_filter

        class Source:
            RETURN_TYPES = ("IMAGE",)
            FUNCTION = "run"

            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {}}

        class Preview(Source):
            OUTPUT_NODE = True

            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {"images": ("IMAGE",)}}

        class Upscale(Preview):
            OUTPUT_NODE = False

        mappings = {**NODE_CLASS_MAPPINGS, "TestSampler": Source,
                    "TestPreview": Preview, "TestUpscale": Upscale}
        images = torch.zeros((1, 2, 2, 3))
        pending = NODE_CLASS_MAPPINGS["EagleReviewGateEager"]().run(images, True, "", "278")
        token = pending["ui"]["eagle_review"][0]["token"]
        prompt = {
            "5": {"class_type": "TestSampler", "inputs": {}},
            "177": {"class_type": "TestPreview", "inputs": {"images": ["5", 0]}},
            "278": {"class_type": "EagleReviewGate", "inputs": {
                "value": ["177", 0], "需要确认": True, "确认令牌": token, "保存后重新开始": False}},
            "47": {"class_type": "TestUpscale", "inputs": {"images": ["278", 0]}},
            "236": {"class_type": "TestPreview", "inputs": {"images": ["47", 0]}},
            "218": {"class_type": "TestPreview", "inputs": {"images": ["236", 0]}},
        }
        # Reproduce the actual full-output list recorded on the local server,
        # rather than trusting the browser's requested [236, 218] scope.
        filtered = make_prompt_filter(NODE_CLASS_MAPPINGS, mappings)({
            "prompt": prompt, "partial_execution_targets": ["236", "177", "218"]})

        class EmptyCache:
            def get_local(self, _node_id):
                return None

        with mock.patch.dict(comfy_nodes.NODE_CLASS_MAPPINGS, mappings):
            valid, error, outputs, node_errors = asyncio.run(validate_prompt(
                "test-resume", filtered["prompt"], filtered["partial_execution_targets"]))
            self.assertTrue(valid, error)
            self.assertFalse(node_errors)
            execution = ExecutionList(DynamicPrompt(filtered["prompt"]), EmptyCache())
            for output in outputs:
                execution.add_node(output)
            self.assertEqual({"278", "47", "236", "218"}, set(execution.pendingNodes))
            resume = NODE_CLASS_MAPPINGS["EagleReviewGateResume"]()
            data, ui, _expanded, _async = asyncio.run(get_output_data("test-resume", "278", resume, {
                "需要确认": [True], "确认令牌": [token], "unique_id": ["278"], "保存后重新开始": [False]}))
        self.assertIs(images, data[0][0])
        self.assertEqual("approved", ui["eagle_review"][0]["state"])

    def test_comfyui_validates_other_outputs_with_all_idle_eagle_nodes_present(self):
        import nodes as comfy_nodes
        from execution import validate_prompt
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_CLASS_MAPPINGS
        from eagle_suite_review_test_package.eagle_suite.execution_isolation import make_prompt_filter

        class ImageSource:
            RETURN_TYPES = ("IMAGE",)
            FUNCTION = "run"

            @classmethod
            def INPUT_TYPES(cls):
                return {"required": {}}

        mappings = {**NODE_CLASS_MAPPINGS, "TestImageSource": ImageSource}
        prompt = {
            "source": {"class_type": "TestImageSource", "inputs": {}},
            "active_save": {"class_type": "EagleSaver", "inputs": {
                "images": ["source", 0], "eagle_folder": "", "local_save_path": "", "filename_prefix": "test"}},
        }
        for index, (name, cls) in enumerate(NODE_CLASS_MAPPINGS.items()):
            if getattr(cls, "OUTPUT_NODE", False) and name != "EagleExecutionAnchor":
                prompt[f"idle_{index}"] = {"class_type": name, "inputs": {}}
        filtered = make_prompt_filter(NODE_CLASS_MAPPINGS, mappings)({"prompt": prompt})
        self.assertEqual({"source", "active_save"}, set(filtered["prompt"]))
        with mock.patch.dict(comfy_nodes.NODE_CLASS_MAPPINGS, mappings):
            valid, error, outputs, node_errors = asyncio.run(validate_prompt("test-idle", filtered["prompt"], None))
        self.assertTrue(valid, error)
        self.assertEqual(["active_save"], outputs)
        self.assertFalse(node_errors)

    def test_empty_and_node_local_runs_pass_real_comfyui_validation(self):
        import nodes as comfy_nodes
        from execution import get_output_from_returns, validate_prompt
        from eagle_suite_review_test_package.eagle_suite.nodes import NODE_CLASS_MAPPINGS
        from eagle_suite_review_test_package.eagle_suite.execution_isolation import make_prompt_filter

        run_filter = make_prompt_filter(NODE_CLASS_MAPPINGS, NODE_CLASS_MAPPINGS)
        cases = [
            {"prompt": {"save": {"class_type": "EagleSaver", "inputs": {"eagle_folder": ""}}}},
            {"prompt": {"text": {"class_type": "EagleText", "inputs": {"text": "local"}}},
             "partial_execution_targets": ["text"]},
        ]
        for payload in cases:
            filtered = run_filter(payload)
            with mock.patch.dict(comfy_nodes.NODE_CLASS_MAPPINGS, NODE_CLASS_MAPPINGS):
                valid, error, outputs, node_errors = asyncio.run(validate_prompt(
                    "test-local", filtered["prompt"], filtered.get("partial_execution_targets")))
            self.assertTrue(valid, error)
            self.assertEqual(1, len(outputs))
            self.assertFalse(node_errors)
        anchor = NODE_CLASS_MAPPINGS["EagleExecutionAnchor"]()
        output, ui, expanded = get_output_from_returns([anchor.finish()], type(anchor))
        self.assertEqual([], output)
        self.assertEqual([True], ui["eagle_inactive_execution"])
        self.assertFalse(expanded)


if __name__ == "__main__":
    unittest.main()
