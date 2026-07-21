# -*- coding: utf-8 -*-
"""
Eagle API Key & Config Loader Nodes
- EagleAPIKeyNode: 独立密钥输入（向后兼容）
- EagleAPILoader:   从 api_config.json 加载配置，通过 model_name 下拉切换模型

所有 API 配置统一由 api_config_manager 管理，共享同一个 api_config.json。
"""

import os
import json
import base64

import requests

from .logger import logger
from .utils import decode_api_key, _ENC_PREFIX
from . import api_config_manager as _cfg


# 保留 _decode_api_key 作为内部别名，兼容已有代码
_decode_api_key = decode_api_key


def _encode_api_key(raw: str) -> str:
    """将明文 API Key 编码为 ENC:Base64（与前端 JS _encodeKey 一致）。
    已是 ENC: 前缀则透传，防止重编码。
    """
    return _cfg.encode_api_key(raw)


def _strip_path_quotes(path: str) -> str:
    """去除路径两端的引号（双引号/单引号）和空白字符。"""
    if not path:
        return ""
    s = path.strip()
    while len(s) >= 2 and s[0] in ('"', "'") and s[-1] == s[0]:
        s = s[1:-1].strip()
    return s


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

    RETURN_TYPES = ("STRING", "API_CONFIG")
    RETURN_NAMES = ("api_key", "api_config")
    FUNCTION = "get_key"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, api_key, **kwargs):
        """保存/导出工作流时不写入 API Key。"""
        return float("NaN")

    def get_key(self, api_key: str):
        """输出 ENC:xxx 加密格式 + api_config 复合类型，兼容两种连接方式。"""
        encoded = _encode_api_key(api_key)
        # api_config 复合类型：只填充 api_key，base_url 和 model 留空
        return (encoded, (encoded, "", ""))


# ═══════════════════════════════════════════════════════════════
#  EagleAPILoader — 配置文件驱动加载器（推荐）
# ═══════════════════════════════════════════════════════════════

class EagleAPILoader:
    """
    🦅 API 配置加载器
    从 api_config.json 读取 API 配置，通过 model_name 下拉菜单切换模型。
    所有模型共享同一套 api_key / base_url，只切换 model 字段。
    输出 API_CONFIG 复合端口（api_key + base_url + model 三线合一），
    一根线直连 API 多功能调用节点的 api_config 端口。
    """

    @classmethod
    def INPUT_TYPES(cls):
        # model_name 在后端注册为 STRING，前端在运行时再转为 COMBO 下拉框，
        # 这样可以动态读取 api_config.json 中的 models 列表。
        return {
            "required": {
                "model_name": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "选择或输入模型名称"
                }),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "API_CONFIG")
    RETURN_NAMES = ("api_key", "base_url", "model", "api_config")
    FUNCTION = "load_config"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, model_name, **kwargs):
        """保存/导出工作流时不泄露 api_key 等配置。"""
        return float("NaN")

    def load_config(self, model_name: str):
        """从 api_config.json 加载配置并输出。"""
        config = _cfg.load_config()

        api_key = _encode_api_key(config.get("api_key", ""))
        base_url = _cfg.strip_chat_completions(config.get("base_url", ""))

        # 确定要使用的模型名称
        name = (model_name or "").strip()
        if not name:
            name = config.get("model", "").strip()
        if not name:
            err = "❌ api_config.json 中未配置 model，请在 Unified 节点填写或输入模型名称"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""))

        # 把选中的模型设为当前活动模型，并加入 models 列表
        _cfg.set_active_model(name)

        if not api_key:
            err = f"❌ api_config.json 缺少 api_key"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, name, ("", err, name))
        if not base_url:
            err = f"❌ api_config.json 缺少 base_url"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, name, ("", err, name))

        logger.info(f"[EagleAPILoader] 加载模型 '{name}': base_url={base_url}")
        return (api_key, base_url, name, (api_key, base_url, name))


# ── aiohttp 路由（延迟注册，避免导入时 PromptServer.instance 未就绪）──────

# 懒加载 aiohttp / PromptServer（避免导入时触发依赖链错误）
try:
    from aiohttp import web
    from server import PromptServer
    _HAS_PROMPT_SERVER = True
except Exception:
    web = None
    PromptServer = None
    _HAS_PROMPT_SERVER = False


def register_routes():
    """延迟注册 API Loader 路由。"""
    if not _HAS_PROMPT_SERVER:
        return
    server = PromptServer.instance
    if not server:
        logger.warning("[APILoader] PromptServer.instance 未就绪，跳过路由注册")
        return
    routes = server.routes

    @routes.post("/api_loader/models")
    async def get_models_route(request):
        """前端调用：返回 api_config.json 中保存的模型名称列表。"""
        try:
            names = _cfg.get_model_names()
            return web.json_response({"success": True, "models": names})
        except Exception as e:
            logger.error(f"[api_loader/models] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    # 保留旧接口别名，避免前端旧代码 404
    @routes.post("/api_loader/profiles")
    async def get_profiles_alias(request):
        try:
            names = _cfg.get_model_names()
            return web.json_response({"success": True, "profiles": names})
        except Exception as e:
            logger.error(f"[api_loader/profiles] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    logger.info("[APILoader] API Loader 路由已注册")


__all__ = ["EagleAPIKeyNode", "EagleAPILoader"]
