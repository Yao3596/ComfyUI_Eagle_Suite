# -*- coding: utf-8 -*-
"""Eagle Suite - EagleDirectorSkillNode

导演技能库节点：集中管理可复用的「导演技能」（Markdown 文档 + 素材胶片），
输出当前选中技能的内容（STRING），供 H3 导演台等节点通过连线使用。

技能存储复用提示词预设节点的同一套后端接口：
  GET/POST/DELETE /eaglePromptPresets/director_skills
  POST /eaglePromptPresets/upload_filmstrip
因此两个节点共享同一个技能库，无需数据迁移。
"""

from typing import Any


class EagleDirectorSkillNode:
    """导演技能库：管理并输出当前选中的导演技能内容。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "director_skill": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "当前选中的导演技能内容（Markdown）。由前端从技能库写入，"
                               "作为输出端口供其他节点（如 H3 导演台）连接使用。",
                }),
                "ui_state": ("STRING", {
                    "default": "{}",
                    "multiline": False,
                    "dynamicPrompts": False,
                }),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("director_skill",)
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle Suite/导演技能"
    OUTPUT_NODE = False

    def process(self, director_skill="", ui_state="", unique_id="", **kwargs):
        return (director_skill or "",)