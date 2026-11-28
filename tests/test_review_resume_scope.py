"""Regression for the recorded 278 -> 47 -> 236/218 confirmation graph.

The browser's partial targets were lost before reaching ComfyUI: upstream
PreviewImage 177 was treated as an output and reran sampler 5 after saving.
"""

import copy
import importlib.util
from pathlib import Path
import unittest


MODULE = Path(__file__).resolve().parents[1] / "eagle_suite" / "execution_isolation.py"


def load_policy():
    spec = importlib.util.spec_from_file_location("eagle_resume_scope_test", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InputNode:
    RETURN_TYPES = ("IMAGE",)
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}


class Preview(InputNode):
    OUTPUT_NODE = True


class Gate(InputNode):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"value": ("*", {"lazy": True})}}


class Resume(Gate):
    @classmethod
    def INPUT_TYPES(cls):
        return {"optional": {"value": ("*", {"lazy": True})}}


def prompt():
    return {
        "5": {"class_type": "Sampler", "inputs": {"seed": 999}},
        "177": {"class_type": "PreviewImage", "inputs": {"images": ["5", 0]}},
        "278": {"class_type": "EagleReviewGate", "inputs": {
            "value": ["177", 0], "需要确认": True, "确认令牌": "current-result", "保存后重新开始": False}},
        "48": {"class_type": "ModelLoader", "inputs": {}},
        "47": {"class_type": "Upscale", "inputs": {"images": ["278", 0], "model": ["48", 0]}},
        "236": {"class_type": "PreviewImage", "inputs": {"images": ["47", 0]}},
        "218": {"class_type": "EagleSaver", "inputs": {"images": ["236", 0]}},
        "unrelated": {"class_type": "ForeignOutput", "inputs": {}},
    }


def mappings():
    eagle = {"EagleReviewGate": Gate, "EagleReviewGateResume": Resume, "EagleSaver": Preview}
    all_nodes = {**eagle, "Sampler": InputNode, "PreviewImage": Preview,
                 "ModelLoader": InputNode, "Upscale": InputNode, "ForeignOutput": Preview}
    return eagle, all_nodes


class ResumeScopeTests(unittest.TestCase):
    def test_approval_is_downstream_only_even_if_browser_loses_partial_targets(self):
        policy = load_policy()
        original = {"prompt": prompt(), "extra_data": {"extra_pnginfo": {"workflow": "preserved"}}}
        before = copy.deepcopy(original)
        filtered = policy.make_prompt_filter(*mappings())(original)
        self.assertEqual({"236", "218"}, set(filtered.get("partial_execution_targets", [])))
        self.assertNotIn("177", filtered["prompt"])
        self.assertNotIn("5", filtered["prompt"])
        self.assertNotIn("unrelated", filtered["prompt"])
        self.assertIn("48", filtered["prompt"], "downstream model dependencies remain available")
        gate = filtered["prompt"]["278"]
        self.assertEqual("EagleReviewGateResume", gate["class_type"])
        self.assertNotIn("value", gate["inputs"], "resuming must have no readable edge to upstream")
        self.assertEqual("current-result", gate["inputs"]["确认令牌"])
        self.assertEqual(before, original, "the saved workflow and original payload remain intact")

    def test_upstream_output_cannot_leak_into_explicit_approval_targets(self):
        data = {"prompt": prompt(), "partial_execution_targets": ["236", "177", "218"]}
        filtered = load_policy().make_prompt_filter(*mappings())(data)
        self.assertEqual({"236", "218"}, set(filtered["partial_execution_targets"]))
        self.assertNotIn("5", filtered["prompt"])

    def test_ordinary_generation_without_approval_retains_the_upstream_chain(self):
        data = {"prompt": prompt()}
        data["prompt"]["278"]["inputs"]["确认令牌"] = ""
        filtered = load_policy().make_prompt_filter(*mappings())(data)
        self.assertIn("5", filtered["prompt"])
        self.assertIn("177", filtered["prompt"])
        self.assertEqual(["177", 0], filtered["prompt"]["278"]["inputs"]["value"])

    def test_comparison_branch_is_available_for_preview_and_removed_from_approval(self):
        data = {"prompt": prompt()}
        data["prompt"]["reference"] = {"class_type": "Sampler", "inputs": {"seed": 1}}
        gate = data["prompt"]["278"]["inputs"]
        gate["对比图像"] = ["reference", 0]
        run_filter = load_policy().make_prompt_filter(*mappings())
        resumed = run_filter(data)
        self.assertNotIn("对比图像", resumed["prompt"]["278"]["inputs"])
        self.assertNotIn("reference", resumed["prompt"])
        gate["确认令牌"] = ""
        preview = run_filter(data)
        self.assertEqual(["reference", 0], preview["prompt"]["278"]["inputs"]["对比图像"])
        self.assertIn("reference", preview["prompt"])

    def test_blank_image_editor_does_not_block_a_valid_final_preview(self):
        eagle, all_nodes = mappings()
        all_nodes["EagleImageMaskEditor"] = InputNode
        data = {"prompt": prompt()}
        data["prompt"]["reference"] = {"class_type": "EagleImageMaskEditor", "inputs": {"image": ""}}
        gate = data["prompt"]["278"]["inputs"]
        gate.update({"需要确认": False, "确认令牌": "", "对比图像": ["reference", 0]})
        run_filter = load_policy().make_prompt_filter(eagle, all_nodes)
        preview = run_filter(data)
        self.assertEqual(["177", 0], preview["prompt"]["278"]["inputs"]["value"])
        self.assertNotIn("对比图像", preview["prompt"]["278"]["inputs"])
        data["prompt"]["reference"]["inputs"]["image"] = "reference.png"
        self.assertEqual(["reference", 0], run_filter(data)["prompt"]["278"]["inputs"]["对比图像"])
        data["prompt"]["reference"]["inputs"] = {"image": "", "image_input": ["5", 0]}
        self.assertEqual(["reference", 0], run_filter(data)["prompt"]["278"]["inputs"]["对比图像"])

    def test_editor_tool_is_isolated_when_queue_wrapper_drops_partial_targets(self):
        policy = load_policy()
        eagle, all_nodes = mappings()
        eagle["EagleImageMaskEditor"] = InputNode
        data = {"prompt": {
            "editor": {"class_type": "EagleImageMaskEditor", "inputs": {
                "image_input": ["feed", 0], "sam_model": ["model", 0], "clip": ["model", 1],
                "editor_request": '{"id":"tool-1","action":"segment","mode":"text","source":"fixture.png"}',
            }},
            "feed": {"class_type": "Sampler", "inputs": {}},
            "model": {"class_type": "ModelLoader", "inputs": {}},
            "save": {"class_type": "EagleSaver", "inputs": {"images": ["editor", 0]}},
            "other": {"class_type": "ForeignOutput", "inputs": {}},
        }}
        filtered = policy.make_prompt_filter(eagle, all_nodes)(data)
        [anchor] = filtered["partial_execution_targets"]
        self.assertEqual({"feed", "model", "editor", anchor}, set(filtered["prompt"]))
        self.assertEqual({"class_type": policy.ANCHOR_CLASS_TYPE, "inputs": {"value": ["editor", 0]}},
                         filtered["prompt"][anchor])
        self.assertIn("save", data["prompt"])

    def test_a_later_hook_can_repeat_filtering_without_widening_scope(self):
        run_filter = load_policy().make_prompt_filter(*mappings())
        once = run_filter({"prompt": prompt()})
        twice = run_filter(once)
        self.assertEqual(once, twice)


if __name__ == "__main__":
    unittest.main()
