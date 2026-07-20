# -*- coding: utf-8 -*-
"""
Eagle Suite - API 配置统一管理模块
====================================
所有 API 相关节点（EagleAPILoader / EagleAPIUnifiedNode / EagleAPIKeyNode）
共享同一个 api_config.json 文件，避免多文件不同步。

配置文件路径：ComfyUI_Eagle_Suite/api_config.json
结构：
{
  "api_key": "sk-xxx",
  "base_url": "https://api.rcouyi.com/v1",
  "model": "ouyi-5-preview",
  "models": ["ouyi-5-preview", "ouyi-5-preview-thinking"]
}
"""

import os
import json
import base64
import urllib.parse

from .logger import logger


# ── 配置文件路径 ──────────────────────────────────────────
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "api_config.json")

# 默认配置模板
_DEFAULT_CONFIG = {
    "api_key": "",
    "base_url": "",
    "model": "",
    "models": [],
}

_ENC_PREFIX = "ENC:"


# ── API Key 编解码（与前端 _encodeKey / _decodeKey 对应）────

def encode_api_key(raw: str) -> str:
    """将明文 API Key 编码为 ENC:Base64；已是 ENC: 前缀则透传。"""
    if not raw or not isinstance(raw, str):
        return ""
    s = raw.strip()
    if s.startswith(_ENC_PREFIX):
        return s
    try:
        encoded = urllib.parse.quote(s, safe="")
        b64 = base64.b64encode(encoded.encode("utf-8")).decode("utf-8")
        return _ENC_PREFIX + b64
    except Exception:
        return s


def decode_api_key(raw: str) -> str:
    """解码前端 ENC:Base64 编码的 API Key；明文直接透传。"""
    if not raw or not isinstance(raw, str):
        return ""
    s = raw.strip()
    if not s.startswith(_ENC_PREFIX):
        return s
    try:
        max_depth = 10
        depth = 0
        while s.startswith(_ENC_PREFIX) and depth < max_depth:
            payload = s[len(_ENC_PREFIX):]
            decoded = base64.b64decode(payload).decode("utf-8")
            s = urllib.parse.unquote(decoded)
            depth += 1
        return s
    except Exception:
        return raw


# ── 配置文件读写 ──────────────────────────────────────────

def _ensure_config_template() -> None:
    """如果 api_config.json 不存在，自动创建一个空模板。"""
    try:
        if not os.path.exists(CONFIG_PATH):
            os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(_DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"[APIConfigManager] 创建默认配置模板失败: {e}")


def load_config() -> dict:
    """加载 api_config.json，缺失字段用默认值补齐。"""
    try:
        _ensure_config_template()
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return dict(_DEFAULT_CONFIG)
            config = dict(_DEFAULT_CONFIG)
            config.update(data)
            # 保证 models 是列表
            if not isinstance(config.get("models"), list):
                config["models"] = []
            # 如果 models 为空但有当前 model，自动补齐
            current = (config.get("model") or "").strip()
            if current and current not in config["models"]:
                config["models"].insert(0, current)
            return config
    except Exception as e:
        logger.warning(f"[APIConfigManager] 加载配置失败: {e}")
    return dict(_DEFAULT_CONFIG)


def save_config(config: dict) -> None:
    """保存配置到 api_config.json。"""
    try:
        _ensure_config_template()
        # 只保存合法字段
        clean = {k: config.get(k, v) for k, v in _DEFAULT_CONFIG.items()}
        if not isinstance(clean.get("models"), list):
            clean["models"] = []
        # api_key 统一编码存储
        clean["api_key"] = encode_api_key(clean.get("api_key", ""))
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(clean, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"[APIConfigManager] 保存配置失败: {e}")


def save_api_config(api_key: str = None, base_url: str = None, model: str = None, models: list = None) -> None:
    """只保存 API 连接信息，不覆盖其他字段。保存时自动把当前 model 加入 models 列表。"""
    config = load_config()
    if api_key is not None:
        config["api_key"] = api_key
    if base_url is not None:
        config["base_url"] = base_url.strip()
    if model is not None:
        config["model"] = model.strip()
        # 自动把当前模型加入可选列表（去重）
        if config["model"] and config["model"] not in config.get("models", []):
            config.setdefault("models", []).insert(0, config["model"])
    if models is not None:
        config["models"] = list(models)
    save_config(config)


def get_model_names() -> list:
    """获取可用于下拉菜单的模型名称列表。"""
    config = load_config()
    names = []
    # 优先使用 models 数组
    for m in config.get("models", []):
        if m and m not in names:
            names.append(m)
    # 再把当前 model 放最前面（默认选中）
    current = (config.get("model") or "").strip()
    if current:
        if current in names:
            names.remove(current)
        names.insert(0, current)
    return names


def get_active_model() -> str:
    """获取当前活动模型名称。"""
    return (load_config().get("model") or "").strip()


def set_active_model(model: str) -> None:
    """设置当前活动模型并保存。"""
    config = load_config()
    model = (model or "").strip()
    config["model"] = model
    # 同时确保该模型在 models 列表中
    if model and model not in config.get("models", []):
        config["models"] = [model] + config.get("models", [])
    save_config(config)


def add_model(model: str) -> None:
    """向 models 列表添加新模型（去重），不切换当前 model。"""
    config = load_config()
    model = (model or "").strip()
    if not model:
        return
    models = config.get("models", [])
    if model not in models:
        models.append(model)
        config["models"] = models
        save_config(config)


# ── URL 规范化 ────────────────────────────────────────────

def strip_chat_completions(url: str) -> str:
    """规范化 base_url：剥离尾部 /chat/completions 等后缀并补齐 /v1。"""
    if not url or not isinstance(url, str):
        return ""
    s = url.strip().rstrip("/")
    for suffix in ("/chat/completions", "/embeddings", "/completions", "/responses"):
        if s.endswith(suffix):
            s = s[: -len(suffix)]
            break
    if not s.endswith("/v1"):
        if "/v1" in s:
            s = s.split("/v1")[0] + "/v1"
        else:
            s = s + "/v1"
    return s


def normalize_url(url: str) -> str:
    """统一节点内部使用的 URL 规范化。"""
    return strip_chat_completions(url)


# ═══════════════════════════════════════════════════════════════
#  Eagle Saver 配置（独立文件，保留旧接口）
# ═══════════════════════════════════════════════════════════════

_SAVER_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "eagle_saver_config.json")


def load_saver_config() -> dict:
    """加载 eagle_saver_config.json（EagleSaver 节点专用）。"""
    try:
        if os.path.exists(_SAVER_CONFIG_PATH):
            with open(_SAVER_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        logger.warning(f"[APIConfigManager] 加载 saver 配置失败: {e}")
    return {}


def save_saver_config(config: dict) -> None:
    """保存 eagle_saver_config.json（EagleSaver 节点专用）。"""
    try:
        os.makedirs(os.path.dirname(_SAVER_CONFIG_PATH), exist_ok=True)
        with open(_SAVER_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"[APIConfigManager] 保存 saver 配置失败: {e}")


__all__ = [
    "CONFIG_PATH",
    "load_config",
    "save_config",
    "save_api_config",
    "get_model_names",
    "get_active_model",
    "set_active_model",
    "add_model",
    "encode_api_key",
    "decode_api_key",
    "strip_chat_completions",
    "normalize_url",
    "load_saver_config",
    "save_saver_config",
]
