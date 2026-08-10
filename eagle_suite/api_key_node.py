# -*- coding: utf-8 -*-
"""
Eagle API Key & Config Loader Nodes
- EagleAPIKeyNode: 独立密钥输入（向后兼容）
- EagleAPILoader:   从 api_config.json 加载配置，通过 model_name 下拉切换模型

大语言模型和生图 API 模型统一由 api_config_manager 管理，
只使用一个 api_config.json。
"""

import requests

from .logger import logger
from .utils import decode_api_key, _ENC_PREFIX
from . import api_config_manager as _legacy_cfg


# 多模型管理与旧版单模型兼容接口现已统一在同一模块中。
_profile_mgr = _legacy_cfg


# 保留 _decode_api_key 作为内部别名，兼容已有代码
_decode_api_key = decode_api_key


def _encode_api_key(raw: str) -> str:
    """将明文 API Key 编码为 ENC:Base64（与前端 JS _encodeKey 一致）。
    已是 ENC: 前缀则透传，防止重编码。
    """
    return _legacy_cfg.encode_api_key(raw)


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
    从 api_config.json 读取多组 API Profile，通过 model_name 下拉菜单切换整套配置。
    每组 Profile 独立保存 api_key / base_url / model / model_type。
    输出 API_CONFIG 复合端口（api_key + base_url + model 三线合一），
    一根线直连 API 多功能调用节点的 api_config 端口。
    model_type 作为末尾独立输出，避免改变旧工作流的端口索引。
    """

    @classmethod
    def INPUT_TYPES(cls):
        # model_name 在后端注册为 STRING，前端在运行时再转为 COMBO 下拉框，
        # 这样可以动态读取 api_config.json 中的模型根键列表。
        return {
            "required": {
                "model_name": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "选择 API Profile"
                }),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "API_CONFIG", "STRING")
    RETURN_NAMES = ("api_key", "base_url", "model", "api_config", "model_type")
    FUNCTION = "load_config"
    CATEGORY = "🦅 Eagle/API"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, model_name, **kwargs):
        """保存/导出工作流时不泄露 api_key 等配置。"""
        return float("NaN")

    def load_config(self, model_name: str):
        """从 api_config.json 加载指定 Profile 并输出。"""
        profiles_data = _profile_mgr.load_profiles()
        profiles = profiles_data.get("profiles", {})

        # 确定要使用的 Profile 名称
        name = (model_name or "").strip()
        if not name or name not in profiles:
            name = profiles_data.get("active_profile", "")
        if not name or name not in profiles:
            err = "❌ api_config.json 中未配置任何模型，请先添加 API 配置"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, "", ("", err, ""), _profile_mgr.MODEL_TYPE_LLM)

        profile = profiles[name]
        api_key = _encode_api_key(profile.get("api_key", ""))
        base_url = _legacy_cfg.strip_chat_completions(profile.get("base_url", ""))
        model = profile.get("model", "").strip()
        model_type = _profile_mgr.normalize_model_type(profile.get("model_type"))

        if not api_key:
            err = f"❌ Profile '{name}' 缺少 api_key"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, name, ("", err, name), model_type)
        if not base_url:
            err = f"❌ Profile '{name}' 缺少 base_url"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, name, ("", err, name), model_type)
        if not model:
            err = f"❌ Profile '{name}' 缺少 model"
            logger.warning(f"[EagleAPILoader] {err}")
            return ("", err, name, ("", err, name), model_type)

        # 把选中的 Profile 设为当前活动
        _profile_mgr.set_active_profile(name)

        logger.info(
            f"[EagleAPILoader] 加载 Profile '{name}': "
            f"base_url={base_url}, model={model}, model_type={model_type}"
        )
        return (api_key, base_url, model, (api_key, base_url, model), model_type)


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

    async def _safe_json(request):
        try:
            data = await request.json()
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    @routes.post("/api_loader/models")
    async def get_models_route(request):
        """前端调用：返回当前 active Profile 可用的模型名称列表（兼容旧接口）。"""
        try:
            active = _profile_mgr.get_active_profile()
            # 如果当前 Profile 有 model，返回包含该 model 的列表
            models = []
            if active.get("model"):
                models.append(active["model"])
            return web.json_response({"success": True, "models": models})
        except Exception as e:
            logger.error(f"[api_loader/models] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api_loader/profiles")
    async def get_profiles_route(request):
        """返回所有 Profile 名称和不含密钥的模型类型摘要。"""
        try:
            profiles_data = _profile_mgr.load_profiles()
            profiles = profiles_data.get("profiles", {})
            names = list(profiles.keys())
            items = [
                {
                    "name": name,
                    "model": profile.get("model", name),
                    "model_type": _profile_mgr.normalize_model_type(
                        profile.get("model_type"), profile.get("model", name)
                    ),
                }
                for name, profile in profiles.items()
            ]
            return web.json_response({
                "success": True,
                "profiles": names,
                "items": items,
                "active_profile": profiles_data.get("active_profile", ""),
                "config_revision": _profile_mgr.get_config_revision(),
            })
        except Exception as e:
            logger.error(f"[api_loader/profiles] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api_loader/profile")
    async def get_profile_route(request):
        """返回指定 Profile 详情。"""
        try:
            body = await _safe_json(request)
            name = (body.get("name") or "").strip()
            if not name:
                return web.json_response({"success": False, "error": "name 不能为空"}, status=400)
            profile = _profile_mgr.get_profile_for_frontend(name)
            if not profile:
                return web.json_response({
                    "success": False,
                    "error": f"未找到 Profile: {name}",
                }, status=404)
            return web.json_response({"success": True, "profile": profile})
        except Exception as e:
            logger.error(f"[api_loader/profile] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api_loader/save_profile")
    async def save_profile_route(request):
        """保存或更新一个 Profile。"""
        try:
            body = await _safe_json(request)
            name = (body.get("name") or "").strip()
            original_name = (body.get("original_name") or "").strip()
            api_key = body.get("api_key", "")
            base_url = (body.get("base_url") or "").strip()
            model = (body.get("model") or "").strip()
            raw_model_type = body.get("model_type")
            model_type = (
                _profile_mgr.normalize_model_type(raw_model_type)
                if raw_model_type is not None
                else None
            )

            if not name:
                name = model
            if not name:
                return web.json_response({"success": False, "error": "模型名称不能为空"}, status=400)
            if not base_url or not model:
                return web.json_response({"success": False, "error": "base_url 和 model 不能为空"}, status=400)

            # api_config.json 的根键就是实际模型名，不保留另一套 Profile 别名。
            name = model

            profiles_data = _profile_mgr.load_profiles()
            profiles = profiles_data.get("profiles", {})
            target_name = original_name or name
            if target_name in profiles:
                ok = _profile_mgr.update_profile(
                    target_name,
                    api_key=api_key,
                    base_url=base_url,
                    model=model,
                    model_type=model_type or _profile_mgr.MODEL_TYPE_LLM,
                )
            else:
                if name in profiles:
                    return web.json_response({
                        "success": False,
                        "error": f"Profile 已存在: {name}",
                    }, status=409)
                ok = _profile_mgr.add_profile(
                    name,
                    api_key=api_key,
                    base_url=base_url,
                    model=model,
                    model_type=model_type,
                )

            if not ok:
                return web.json_response({
                    "success": False,
                    "error": "配置未写入 api_config.json，请检查文件权限或模型名冲突",
                }, status=500)

            saved_name = model

            return web.json_response({
                "success": True,
                "profile_name": saved_name,
                "profiles": _profile_mgr.get_profile_names(),
                "config_revision": _profile_mgr.get_config_revision(),
            })
        except Exception as e:
            logger.error(f"[api_loader/save_profile] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api_loader/delete_profile")
    async def delete_profile_route(request):
        """删除一个 Profile。"""
        try:
            body = await _safe_json(request)
            name = (body.get("name") or "").strip()
            if not name:
                return web.json_response({"success": False, "error": "name 不能为空"}, status=400)
            ok = _profile_mgr.remove_profile(name)
            if not ok:
                return web.json_response({
                    "success": False,
                    "error": f"未找到 Profile 或删除写入失败: {name}",
                }, status=404)
            return web.json_response({
                "success": True,
                "profiles": _profile_mgr.get_profile_names(),
                "config_revision": _profile_mgr.get_config_revision(),
            })
        except Exception as e:
            logger.error(f"[api_loader/delete_profile] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api_loader/fetch_models")
    async def fetch_models_route(request):
        """从当前选中的 Profile 的 API 服务商 /v1/models 拉取模型列表。"""
        try:
            body = await _safe_json(request)
            profile_name = (body.get("profile_name") or "").strip()
            if not profile_name:
                profile_name = _profile_mgr.load_profiles().get("active_profile", "")

            profile = _profile_mgr.get_profile(profile_name)
            if not profile:
                return web.json_response({
                    "success": False,
                    "error": f"未找到 Profile: {profile_name}"
                }, status=400)

            api_key = _legacy_cfg.decode_api_key(profile.get("api_key", ""))
            base_url = _legacy_cfg.normalize_url(profile.get("base_url", ""))

            if not api_key or not base_url:
                return web.json_response({
                    "success": False,
                    "error": "该 Profile 缺少 api_key 或 base_url，无法从 API 拉取模型列表"
                }, status=400)

            try:
                resp = requests.get(
                    f"{base_url}/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=30
                )
                if resp.status_code != 200:
                    return web.json_response({
                        "success": False,
                        "error": f"API 返回 HTTP {resp.status_code}: {resp.text[:200]}"
                    }, status=502)

                data = resp.json()
                remote_models = []
                for item in data.get("data", []):
                    mdl = item.get("id") or item.get("name") or item.get("model")
                    if mdl and mdl not in remote_models:
                        remote_models.append(mdl)

                if not remote_models:
                    return web.json_response({
                        "success": False,
                        "error": "API 未返回任何模型"
                    }, status=502)

                return web.json_response({
                    "success": True,
                    "models": remote_models,
                    "profile": profile_name,
                    "model_type": _profile_mgr.normalize_model_type(profile.get("model_type")),
                })
            except requests.exceptions.ConnectionError:
                return web.json_response({
                    "success": False,
                    "error": f"无法连接到 {base_url}"
                }, status=502)
            except Exception as e:
                logger.error(f"[api_loader/fetch_models] 请求异常: {e}")
                return web.json_response({
                    "success": False,
                    "error": f"请求异常: {str(e)}"
                }, status=500)
        except Exception as e:
            logger.error(f"[api_loader/fetch_models] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    logger.info("[APILoader] API Loader 路由已注册")


__all__ = ["EagleAPIKeyNode", "EagleAPILoader"]
