# -*- coding: utf-8 -*-
"""
h3_pipeline - H3 导演台下游制片流水线共享常量。
"""

# 这些对象是 Eagle 的落盘清单/原生循环实现，不等同于第三方
# MiniMaxH3-Context-Loop 的 H3_CHAIN_STATE。使用私有类型名可以阻止
# ComfyUI 产生“端口能连接、运行时字段却完全不兼容”的假连接。
H3_RUN_STATE = "EAGLE_H3_STATE"
H3_LOOP_FLOW = "EAGLE_H3_FLOW"
H3_SEGMENT = "EAGLE_H3_SEGMENT"
H3_MANIFEST = "EAGLE_H3_MANIFEST"

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
