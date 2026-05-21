# -*- coding: utf-8 -*-
"""
Eagle API Key & Config Loader Nodes
- EagleAPIKeyNode: 独立密钥输入（向后兼容）
- EagleAPILoader:   配置文件驱动加载器（推荐）
  输出 API_CONFIG 复合类型（api_key + base_url + model 三线合一）
"""

import os
import json

from .logger import logger

# ── 默认配置文件路径 ──────────────────────────────────────────
DEFAULT_PROFILES_PATH = os.path.join(
    os.path.dirname(__file__), "..", "api_profiles.json"
)


def _load_profile_names() -> list:
    """读取配置文件，返回所有配置名称列表（用于下拉菜单）。"""
    try:
        if not os.path.exists(DEFAULT_PROFILES_PATH):
            return []
        with open(DEFAULT_PROFILES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return []
        return [k for k in data.keys() if not k.startswith("_") and isinstance(data[k], dict)]
    except Exception:
        return []


# ═══════════════════════════════════════════════════════════════
#  EagleAPIKeyNode — 简单密钥输入（向后兼容）
# ═══════════════════════════════════════════════════════════════

class EagleAPIKeyNode:
    """
    🦅 API 密钥输入节点
    独立的密码输入框，输出 api_key 字符串
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "api_key": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "password": True,
                    "placeholder": "输入 API Key（留空使用已保存）"
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("api_key",)
    FUNCTION = "get_key"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    def get_key(self, api_key: str):
        return (api_key.strip(),)


# ═══════════════════════════════════════════════════════════════
#  EagleAPILoader — 配置文件驱动加载器（推荐）
# ═══════════════════════════════════════════════════════════════

class EagleAPILoader:
    """
    🦅 API 配置加载器
    从本地 JSON 配置文件读取多组 API 配置，通过 model_name 下拉菜单选择。
    输出 API_CONFIG 复合端口（api_key + base_url + model 三线合一），
    一根线直连 API 多功能调用节点的 api_config 端口。

    配置文件格式 (api_profiles.json):
    {
      "ouyi-5-preview": {
        "api_key": "sk-xxx",
        "base_url": "https://hk-2.rcouyi.com/v1",
        "model": "ouyi-5-preview"
      }
    }
    """

    @classmethod
    def INPUT_TYPES(cls):
        profiles = _load_profile_names()
        return {
            "required": {
                "model_name": (profiles if profiles else ["(Empty)"],),
                "force_refresh": ("BOOLEAN", {"default": False, "label_on": "已刷新", "label_off": "刷新列表"}),
            },
            "optional": {
                "config_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "配置文件路径（留空使用默认 api_profiles.json）"
                }),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "API_CONFIG")
    RETURN_NAMES = ("api_key", "base_url", "model", "api_config")
    FUNCTION = "load_config"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    def load_config(self, model_name: str, force_refresh: bool = False, config_path: str = ""):
        """从配置文件加载指定名称的 API 配置。
        输出 3 个独立端口 + 1 个 api_config 复合总线端口。
        """

        # ── 确定配置文件路径 ───────────────────────────────────
        path = config_path.strip() if config_path else ""
        if not path:
            path = DEFAULT_PROFILES_PATH

        # ── 加载配置文件 ───────────────────────────────────────
        if not os.path.exists(path):
            err = f"❌ 配置文件不存在: {path}"
            logger.error(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))

        try:
            with open(path, "r", encoding="utf-8") as f:
                profiles = json.load(f)
        except json.JSONDecodeError as e:
            err = f"❌ JSON 解析失败: {e}"
            logger.error(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))
        except Exception as e:
            err = f"❌ 读取配置文件失败: {e}"
            logger.error(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))

        if not isinstance(profiles, dict):
            err = "❌ 配置文件根必须是 JSON 对象（{名称: {配置}}）"
            logger.error(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))

        # ── 查找指定配置 ───────────────────────────────────────
        name = model_name.strip()
        if not name:
            err = "❌ 请输入 model_name（配置文件中的键名）"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))

        profile = profiles.get(name)
        if not profile:
            available = ", ".join(profiles.keys())
            err = f"❌ 未找到配置 '{name}'。可用: {available}"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))

        if not isinstance(profile, dict):
            err = f"❌ 配置 '{name}' 格式错误，必须是对象"
            logger.error(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))

        # ── 提取字段 ───────────────────────────────────────────
        api_key = profile.get("api_key", "")
        base_url = profile.get("base_url", "")
        model = profile.get("model", "")

        if not api_key:
            err = f"❌ 配置 '{name}' 缺少 api_key"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))
        if not base_url:
            err = f"❌ 配置 '{name}' 缺少 base_url"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))
        if not model:
            err = f"❌ 配置 '{name}' 缺少 model"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))

        logger.info(f"[EagleAPILoader] 加载配置 '{name}': base_url={base_url}, model={model}")
        # 返回：3个独立端口 + 1个复合总线
        return (api_key, base_url, model, (api_key, base_url, model))


__all__ = ["EagleAPIKeyNode", "EagleAPILoader"]
