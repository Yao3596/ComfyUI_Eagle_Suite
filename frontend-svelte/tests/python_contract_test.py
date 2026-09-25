"""Dependency-free contract test for the isolated Python Svelte node."""

from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path
import sys
import types


ROOT = Path(__file__).resolve().parents[2]
PACKAGE_DIR = ROOT / "eagle_suite"

package = types.ModuleType("eagle_suite")
package.__path__ = [str(PACKAGE_DIR)]
sys.modules["eagle_suite"] = package


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


contract = load_module(
    "eagle_suite.h3_review_workspace_contract",
    PACKAGE_DIR / "h3_review_workspace_contract.py",
)

pipeline = types.ModuleType("eagle_suite.h3_pipeline")
pipeline.__path__ = []
sys.modules["eagle_suite.h3_pipeline"] = pipeline
nodes = types.ModuleType("eagle_suite.h3_pipeline.nodes")


class FakeReviewNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"state": ("H3_RUN_STATE",)},
            "optional": {
                "retry_length": ("INT", {"default": 0, "min": 0, "max": 3592}),
            },
        }

    async def execute(self, state, **kwargs):
        return state, kwargs


nodes.EagleH3CheckpointReviewNode = FakeReviewNode
sys.modules["eagle_suite.h3_pipeline.nodes"] = nodes

workspace_module = load_module(
    "eagle_suite.h3_review_workspace",
    PACKAGE_DIR / "h3_review_workspace.py",
)
Node = workspace_module.EagleH3ReviewWorkspaceNode

inputs = Node.INPUT_TYPES()
assert "workspace_state" in inputs["optional"]
assert inputs["optional"]["retry_length"][1]["max"] == 3592
assert '"version":2' in workspace_module.WORKSPACE_STATE_DEFAULT
assert workspace_module.NODE_CLASS_MAPPINGS_H3_REVIEW_SVELTE["EagleH3ReviewWorkspaceNode"] is Node

assert contract.validate_retry_length(0) == 0
assert contract.validate_retry_length(5) == 5
assert contract.validate_retry_length(22) == 22
assert contract.validate_retry_length(3592) == 3592
for invalid in (-1, 1, 17, 125, 3593):
    try:
        contract.validate_retry_length(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError(f"invalid H3 length accepted: {invalid}")

state, kwargs = asyncio.run(Node().execute({"run": "test"}, retry_length=124))
assert state == {"run": "test"}
assert kwargs["retry_length"] == 124

try:
    asyncio.run(Node().execute({}, retry_length=125))
except ValueError:
    pass
else:
    raise AssertionError("Python node accepted retry_length=125")


review_runtime = load_module(
    "eagle_suite.h3_pipeline.review_runtime",
    PACKAGE_DIR / "h3_pipeline" / "review_runtime.py",
)


async def exercise_pending_review_recovery():
    token_a, future_a = review_runtime.open_review("29.0.0.86", run_name="run-a")
    token_b, _ = review_runtime.open_review("30.0.0.86", run_name="run-b")
    try:
        assert review_runtime.publish_review(token_a, {
            "token": token_a,
            "run_name": "run-a",
            "node_id": "29.0.0.86",
            "awaiting_review": True,
        })
        assert review_runtime.publish_review(token_b, {
            "token": token_b,
            "run_name": "run-b",
            "node_id": "30.0.0.86",
            "awaiting_review": True,
        })

        status, payload = review_runtime.lookup_pending_review("run-a", "86")
        assert status == "ok"
        assert payload["token"] == token_a
        assert payload["node_id"] == "29.0.0.86"
        assert review_runtime.lookup_pending_review("run-b", "86")[1]["token"] == token_b
        assert review_runtime.lookup_pending_review("run-a", "28") == ("not_found", None)
        assert review_runtime.lookup_pending_review("missing", "86") == ("not_found", None)

        token_c, _ = review_runtime.open_review("31.0.0.86", run_name="run-a")
        try:
            assert review_runtime.lookup_pending_review("run-a", "86") == ("ambiguous", None)
        finally:
            review_runtime.close_review(token_c)

        assert not review_runtime.publish_review(token_a, {
            "run_name": "another-run",
            "node_id": "29.0.0.86",
        })
        assert not review_runtime.publish_review(token_a, {
            "run_name": "run-a",
            "node_id": "29.0.0.28",
        })
        assert not review_runtime.resolve_review(token_a, {
            "run_name": "run-b",
            "decision": "approve",
        })
        assert review_runtime.resolve_review(token_a, {
            "run_name": "run-a",
            "decision": "approve",
        })
        assert (await future_a)["decision"] == "approve"
    finally:
        review_runtime.close_review(token_a)
        review_runtime.close_review(token_b)


asyncio.run(exercise_pending_review_recovery())
