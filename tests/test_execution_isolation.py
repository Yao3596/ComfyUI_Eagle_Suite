import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace


MODULE = Path(__file__).resolve().parents[1] / "eagle_suite" / "execution_isolation.py"


def load_policy():
    assert MODULE.is_file(), "Eagle nodes need a shared inactive-branch policy before ComfyUI validates prompts"
    spec = importlib.util.spec_from_file_location("eagle_execution_isolation_test", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Source:
    OUTPUT_NODE = True
    RETURN_TYPES = ("IMAGE",)
    schema_calls = 0

    @classmethod
    def INPUT_TYPES(cls):
        cls.schema_calls += 1
        return {"required": {"folder": ("STRING", {"default": ""})}}


class Saver:
    OUTPUT_NODE = True
    RETURN_TYPES = ("STRING",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "folder": ("STRING", {"default": ""})}}


class Processor(Saver):
    OUTPUT_NODE = False
    RETURN_TYPES = ("IMAGE",)


EAGLE = {"EagleLoader": Source, "EagleSaver": Saver, "EagleProcessor": Processor}
ALL = {**EAGLE, "BaseSource": Processor, "BaseSave": Saver}


def node(kind, **inputs):
    return {"class_type": kind, "inputs": inputs}


def active_branch():
    return {"source": node("BaseSource"), "output": node("BaseSave", images=["source", 0], folder="")}


def test_disconnected_eagle_nodes_do_not_invalidate_or_run_with_other_outputs():
    policy = load_policy()
    data = {"prompt": {**active_branch(), "unused_save": node("EagleSaver", folder=""),
                       "unused_loader": node("EagleLoader", folder="")},
            "extra_data": {"extra_pnginfo": {"workflow": {"nodes": ["unchanged"]}}}}
    original = copy.deepcopy(data)
    filtered = policy.make_prompt_filter(EAGLE, ALL)(data)
    assert filtered["prompt"] == active_branch()
    assert filtered["extra_data"] == data["extra_data"]
    assert data == original, "filtering execution must not delete nodes from the saved workflow"


def test_missing_data_port_skips_just_that_branch_and_its_orphan_eagle_sources():
    policy = load_policy()
    data = {"prompt": {**active_branch(),
        "unused_loader": node("EagleLoader", folder="unused"),
        "incomplete": node("EagleSaver", folder=["unused_loader", 0]),
        "dependent": node("BaseSave", images=["incomplete", 0], folder=""),
    }}
    filtered = policy.make_prompt_filter(EAGLE, ALL)(data)
    assert filtered["prompt"] == active_branch()


def test_connected_sources_savers_and_unrelated_nodes_are_preserved():
    policy = load_policy()
    data = {"prompt": {**active_branch(), "loader": node("EagleLoader", folder="photos"),
                       "save": node("EagleSaver", images=["loader", 0], folder="")}}
    assert policy.make_prompt_filter(EAGLE, ALL)(data) == data


def test_a_local_run_keeps_its_explicit_target_without_other_workflows():
    policy = load_policy()
    data = {"prompt": {**active_branch(), "preview": node("EagleLoader", folder="photos")},
            "partial_execution_targets": ["preview"]}
    filtered = policy.make_prompt_filter(EAGLE, ALL)(data)
    assert "preview" in filtered["prompt"]
    assert filtered["partial_execution_targets"] == ["preview"]


def test_empty_eagle_only_run_is_a_side_effect_free_noop():
    policy = load_policy()
    data = {"prompt": {"empty": node("EagleSaver", folder="")}}
    filtered = policy.make_prompt_filter(EAGLE, ALL)(data)
    assert "empty" not in filtered["prompt"]
    anchors = [entry for entry in filtered["prompt"].values()
               if entry["class_type"] == policy.ANCHOR_CLASS_TYPE]
    assert len(anchors) == 1
    assert anchors[0]["inputs"] == {}
    result = policy.EagleExecutionAnchor().finish()
    assert result["result"] == ()
    assert result["ui"]["eagle_inactive_execution"] == [True]


def test_local_run_can_target_a_non_output_eagle_node_without_running_its_downstream():
    policy = load_policy()
    data = {"prompt": {**active_branch(), "local": node("EagleProcessor", images=["source", 0], folder="")},
            "partial_execution_targets": ["local"]}
    filtered = policy.make_prompt_filter(EAGLE, ALL)(data)
    targets = filtered["partial_execution_targets"]
    assert len(targets) == 1
    anchor = filtered["prompt"][targets[0]]
    assert anchor["class_type"] == policy.ANCHOR_CLASS_TYPE
    assert anchor["inputs"]["value"] == ["local", 0]


def test_director_authoring_keeps_only_its_model_dependencies_if_partial_scope_is_lost():
    policy = load_policy()
    eagle = {**EAGLE, "EagleH3DirectorNode": Processor}
    run_filter = policy.make_prompt_filter(eagle, ALL)
    data = {"prompt": {
        **active_branch(),
        "model": node("BaseSource"),
        "director": node("EagleH3DirectorNode", images=["model", 0], folder="",
                         skill_request='{"run":true,"requestId":"scene-test","blockDownstream":false}'),
        "video": node("BaseSave", images=["director", 0]),
    }}
    filtered = run_filter(data)
    [target] = filtered["partial_execution_targets"]
    assert set(filtered["prompt"]) == {"model", "director", target}
    assert filtered["prompt"][target]["inputs"]["value"] == ["director", 0]
    assert "video" in data["prompt"]

    ordinary_prompt = {**data["prompt"], "director": node(
        "EagleH3DirectorNode", images=["model", 0], folder="", skill_request="")}
    assert run_filter({"prompt": ordinary_prompt}) == {"prompt": ordinary_prompt}


def test_incomplete_local_target_never_falls_back_to_full_workflow_execution():
    policy = load_policy()
    data = {"prompt": {**active_branch(), "empty": node("EagleSaver", folder="")},
            "partial_execution_targets": ["empty"]}
    filtered = policy.make_prompt_filter(EAGLE, ALL)(data)
    targets = filtered["partial_execution_targets"]
    assert targets and targets != ["output"]
    assert all(filtered["prompt"][target]["class_type"] == policy.ANCHOR_CLASS_TYPE for target in targets)


def test_required_force_input_strings_are_ports_but_normal_widget_strings_are_not():
    policy = load_policy()

    class Forced(Saver):
        @classmethod
        def INPUT_TYPES(cls):
            return {"required": {"text": ("STRING", {"forceInput": True}), "directory": ("STRING",)}}

    data = {"prompt": {**active_branch(), "empty": node("EagleForced", directory=["source", 0])}}
    filtered = policy.make_prompt_filter({**EAGLE, "EagleForced": Forced}, ALL)(data)
    assert "empty" not in filtered["prompt"]


def test_schema_reads_are_cached_and_isolated_loaders_do_not_scan_catalogs():
    policy = load_policy()
    Source.schema_calls = 0
    run_filter = policy.make_prompt_filter(EAGLE, ALL)
    run_filter({"prompt": {**active_branch(), "unused": node("EagleLoader", folder="")}})
    assert Source.schema_calls == 0
    data = {"prompt": {"loader": node("EagleLoader", folder="photos"),
                       "save": node("EagleSaver", images=["loader", 0], folder="")}}
    run_filter(data)
    run_filter(data)
    assert Source.schema_calls == 1


def test_server_hook_registers_once_and_never_replaces_the_global_run_function():
    policy = load_policy()
    server = SimpleNamespace(on_prompt_handlers=[])
    server.add_on_prompt_handler = server.on_prompt_handlers.append
    policy.register_prompt_filter(server, EAGLE, ALL)
    policy.register_prompt_filter(server, EAGLE, ALL)
    assert len(server.on_prompt_handlers) == 1
    filtered = server.on_prompt_handlers[0]({"prompt": {**active_branch(), "unused": node("EagleSaver")}})
    assert filtered["prompt"] == active_branch()


def test_foreign_disconnected_nodes_still_use_comfyui_validation():
    policy = load_policy()
    data = {"prompt": {**active_branch(), "foreign": node("OtherExtensionSaver")}}
    filtered = policy.make_prompt_filter(EAGLE, ALL)(data)
    assert filtered == data


def test_unused_eagle_models_upstream_of_a_skipped_branch_never_load():
    policy = load_policy()
    data = {"prompt": {**active_branch(),
        "model": node("EagleLoader", folder="models"),
        "middle": node("BaseSource", images=["model", 0]),
        "incomplete": node("EagleSaver", folder=["middle", 0]),
    }}
    filtered = policy.make_prompt_filter(EAGLE, ALL)(data)
    assert filtered["prompt"] == active_branch()


if __name__ == "__main__":
    import unittest
    suite = unittest.TestSuite(unittest.FunctionTestCase(function)
        for name, function in tuple(globals().items()) if name.startswith("test_"))
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    raise SystemExit(not result.wasSuccessful())
