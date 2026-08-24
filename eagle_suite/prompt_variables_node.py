# -*- coding: utf-8 -*-
"""
Eagle Suite - EaglePromptVariablesNode
变量输入节点：集中填写多组"变量名 = 变量值"，输出 JSON 字符串。

特性：
- 动态显示/隐藏变量输入框（基于变量数量）
- 每个变量值支持 multiline 编辑
- 自动过滤空变量名
- 输出标准 JSON 格式，直接对接 EaglePromptPresets 的 variables 端口
- 支持右键 "Convert to Input" 将变量值转为可接线输入
"""

import json
from typing import Dict, Any

MAX_VARS = 20  # 最大支持 20 组变量


class EaglePromptVariablesNode:
    """
    变量输入节点 - 用于集中管理提示词模板变量
    """

    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        
        # 动态生成 MAX_VARS 组变量输入
        for i in range(1, MAX_VARS + 1):
            optional[f"变量名_{i}"] = ("STRING", {
                "default": "",
                "multiline": False,
                "placeholder": f"例: target, position, style..."
            })
            optional[f"变量值_{i}"] = ("STRING", {
                "default": "",
                "multiline": True,
                "placeholder": "输入变量的值（支持多行）"
            })

        return {
            "required": {
                "变量数量": ("INT", {
                    "default": 4,
                    "min": 1,
                    "max": MAX_VARS,
                    "step": 1,
                    "display": "number"
                }),
            },
            "optional": optional,
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO"
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("variables", "preview")
    FUNCTION = "build"
    CATEGORY = "🦅 Eagle/文本"
    OUTPUT_NODE = False

    @staticmethod
    def _normalize_name(value: Any) -> str:
        """允许变量名填写 target 或 {{target}}，输出时统一为 target。"""
        name = str(value or "").strip()
        if name.startswith("{{") and name.endswith("}}"):
            name = name[2:-2].strip()
        return name

    def build(self, 变量数量: int, **kwargs) -> tuple:
        """
        构建变量字典并输出 JSON 字符串
        
        Args:
            变量数量: 当前启用的变量组数
            **kwargs: 所有变量名和变量值的键值对
            
        Returns:
            (variables_json, preview_text): JSON 字符串和预览文本
        """
        data: Dict[str, Any] = {}
        preview_lines = []
        
        # 只处理启用数量内的变量
        for i in range(1, int(变量数量) + 1):
            name_key = f"变量名_{i}"
            value_key = f"变量值_{i}"
            
            name = self._normalize_name(kwargs.get(name_key))
            if not name:
                continue
            
            # 获取值（可能是 None、空字符串或实际内容）
            value = kwargs.get(value_key)
            if value is None:
                value = ""
            
            data[name] = value
            
            # 构建预览文本
            value_preview = str(value)[:50]
            if len(str(value)) > 50:
                value_preview += "..."
            preview_lines.append(f"{name} = {value_preview}")
        
        # 生成 JSON 输出
        variables_json = json.dumps(data, ensure_ascii=False, indent=2)
        
        # 生成预览文本
        if preview_lines:
            preview_text = "\n".join(preview_lines)
        else:
            preview_text = "(未定义任何变量)"
        
        return (variables_json, preview_text)

    @classmethod
    def IS_CHANGED(cls, 变量数量: int, **kwargs):
        """
        检测输入是否改变，确保节点正确刷新
        """
        # 收集所有当前启用的变量
        values = [str(变量数量)]
        for i in range(1, int(变量数量) + 1):
            name = kwargs.get(f"变量名_{i}", "")
            value = kwargs.get(f"变量值_{i}", "")
            values.append(f"{name}:{value}")
        
        return "|".join(values)


NODE_CLASS_MAPPINGS = {
    "EaglePromptVariablesNode": EaglePromptVariablesNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "EaglePromptVariablesNode": "🦅 变量输入",
}
