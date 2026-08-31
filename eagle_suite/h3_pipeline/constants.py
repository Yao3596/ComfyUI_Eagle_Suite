# -*- coding: utf-8 -*-
"""
h3_pipeline - H3 导演台下游制片流水线共享常量。
"""

H3_RUN_STATE = "H3_RUN_STATE"
H3_LOOP_FLOW = "H3_LOOP_FLOW"
H3_SEGMENT = "H3_SEGMENT"
H3_MANIFEST = "H3_MANIFEST"

MANIFEST_VERSION = "h3_eagle_chain_v1"
DEFAULT_CHAIN_SUBDIR = "h3_eagle_chains"

RESUME_POLICIES = ("fail", "overwrite", "resume")
CONTINUATION_MODES = ("guide", "masked_av")
ANCHOR_MODES = ("head", "before")
AUDIO_MODES = ("source_track", "generated_audio", "source_plus_timeline")

DEFAULT_SEGMENT_CRF = 18

# 状态字段中会被持久化的顶层键
MANIFEST_TOP_KEYS = frozenset([
    "version",
    "run_name",
    "base_dir",
    "mode",
    "current_index",
    "reroll_index",
    "stop",
    "total_shots",
    "plan",
    "shots",
    "created_at",
    "updated_at",
])

__all__ = [
    "H3_RUN_STATE",
    "H3_LOOP_FLOW",
    "H3_SEGMENT",
    "H3_MANIFEST",
    "MANIFEST_VERSION",
    "DEFAULT_CHAIN_SUBDIR",
    "RESUME_POLICIES",
    "CONTINUATION_MODES",
    "ANCHOR_MODES",
    "AUDIO_MODES",
    "DEFAULT_SEGMENT_CRF",
    "MANIFEST_TOP_KEYS",
]
