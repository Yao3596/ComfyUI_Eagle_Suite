"""Optional Svelte review workspace node.

This module deliberately exports its own mappings so it can be developed and
tested without modifying the package-wide registry while the H3 loop backend is
changing.  Integration only needs to merge the two mappings below.
"""

from __future__ import annotations

from copy import deepcopy

from .h3_pipeline.nodes import EagleH3CheckpointReviewNode
from .h3_review_workspace_contract import validate_retry_length


WORKSPACE_STATE_DEFAULT = (
    '{"version":2,"selectedTakeKey":"","retry":{"prompt":"","seed":-1,'
    '"length":0},"options":{"assemblePartial":true,"timeoutMinutes":0,'
    '"unloadModels":false,"autoplay":false}}'
)


class EagleH3ReviewWorkspaceNode(EagleH3CheckpointReviewNode):
    """Svelte UI shell over the existing checkpoint and review state machine."""

    DESCRIPTION = (
        "独立的 H3 审片工作台实验节点；运行逻辑复用分段保存与审片节点，"
        "界面状态保存在版本化 workspace_state 中。"
    )
    CATEGORY = "🦅 Eagle Suite/H3 实验室"

    @classmethod
    def INPUT_TYPES(cls):
        inputs = deepcopy(super().INPUT_TYPES())
        inputs.setdefault("optional", {})["workspace_state"] = (
            "STRING",
            {"default": WORKSPACE_STATE_DEFAULT, "multiline": False},
        )
        inputs["optional"]["retry_length"] = (
            "INT",
            {
                "default": 0,
                "min": 0,
                "max": 3592,
                "step": 1,
                "tooltip": "0 表示不覆盖；其他值必须满足 17k+5（5、22、39……）",
            },
        )
        return inputs

    async def execute(self, state, workspace_state=WORKSPACE_STATE_DEFAULT, **kwargs):
        # workspace_state is intentionally frontend-only.  Generation and review
        # decisions remain governed by the established H3 backend contract.
        del workspace_state
        kwargs["retry_length"] = validate_retry_length(kwargs.get("retry_length", 0))
        return await super().execute(state, **kwargs)


NODE_CLASS_MAPPINGS_H3_REVIEW_SVELTE = {
    "EagleH3ReviewWorkspaceNode": EagleH3ReviewWorkspaceNode,
}

NODE_DISPLAY_NAME_MAPPINGS_H3_REVIEW_SVELTE = {
    "EagleH3ReviewWorkspaceNode": "🦅 H3 · 审片工作台（Svelte）",
}


__all__ = [
    "EagleH3ReviewWorkspaceNode",
    "NODE_CLASS_MAPPINGS_H3_REVIEW_SVELTE",
    "NODE_DISPLAY_NAME_MAPPINGS_H3_REVIEW_SVELTE",
]
