# -*- coding: utf-8 -*-
"""
Eagle API Key & Config Loader Nodes
- EagleAPIKeyNode: 独立密钥输入（向后兼容）
- EagleAPILoader:   配置文件驱动加载器（推荐）
  输出 API_CONFIG 复合类型（api_key + base_url + model 三线合一）
"""

import os
import json
import base64

import requests

from .logger import logger

# ── 懒加载 aiohttp / PromptServer（避免导入时触发依赖链错误）──
try:
    from aiohttp import web
    from server import PromptServer
    _HAS_PROMPT_SERVER = True
except Exception:
    web = None
    PromptServer = None
    _HAS_PROMPT_SERVER = False

# ── API Key 解码（兼容前端 ENC:Base64 编码）───────────────
_ENC_PREFIX = "ENC:"

def _decode_api_key(raw: str) -> str:
    """解码前端 ENC:Base64 编码的 API Key；明文直接透传。"""
    if not raw or not isinstance(raw, str):
        return ""
    import urllib.parse
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
        return raw.strip()


def _encode_api_key(raw: str) -> str:
    """将明文 API Key 编码为 ENC:Base64（与前端 JS _encodeKey 一致）。
    已是 ENC: 前缀则透传，防止重编码。
    """
    if not raw or not isinstance(raw, str):
        return ""
    s = raw.strip()
    if s.startswith(_ENC_PREFIX):
        return s
    try:
        import urllib.parse
        encoded = urllib.parse.quote(s, safe='')
        b64 = base64.b64encode(encoded.encode('utf-8')).decode('utf-8')
        return _ENC_PREFIX + b64
    except Exception:
        return s


def _strip_path_quotes(path: str) -> str:
    """去除路径两端的引号（双引号/单引号）和空白字符。"""
    if not path:
        return ""
    s = path.strip()
    # 去除外层引号：支持 "path" 、'path'、"path 、path" 等常见形式
    while s and s[0] in ('"', "'") and s[-1] in ('"', "'"):
        s = s.strip(s[0])
        s = s.strip()
    return s


# ── 默认配置文件路径 ──────────────────────────────────────────
DEFAULT_PROFILES_PATH = os.path.join(
    os.path.dirname(__file__), "..", "api_profiles.json"
)


def _load_profile_names() -> list:
    """读取配置文件，返回所有配置名称列表（用于下拉菜单）。"""
    try:
        if not os.path.exists(DEFAULT_PROFILES_PATH):
            # 默认文件不存在时，尝试从 api_config.json 获取最后一次使用的 model 作为有效选项
            return _load_fallback_profile_names()
        with open(DEFAULT_PROFILES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return []
        return [k for k in data.keys() if not k.startswith("_") and isinstance(data[k], dict)]
    except Exception:
        return []


def _load_fallback_profile_names() -> list:
    """备用：尝试从 api_config.json 中读取最后一次使用的 model 作为 profile 选项。"""
    try:
        config_path = os.path.join(os.path.dirname(__file__), "..", "api_config.json")
        if not os.path.exists(config_path):
            return []
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        model = (data.get("model") or "").strip()
        if model:
            return [model]
    except Exception:
        pass
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
        """输出 ENC:xxx 加密格式，下游节点接收后自行解码。"""
        return (_encode_api_key(api_key),)


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
        if profiles:
            return {
                "required": {
                    "model_name": (profiles, {"default": profiles[0]}),
                },
                "optional": {
                    "config_path": ("STRING", {
                        "default": "",
                        "multiline": False,
                        "placeholder": "配置文件路径（留空使用默认 api_profiles.json）"
                    }),
                }
            }
        # 配置文件不存在时：不设 COMBO 验证，JS 动态加载后替换为下拉
        return {
            "required": {
                "model_name": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "点击「加载模型」自动填充"
                }),
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

    def load_config(self, model_name: str, config_path: str = ""):
        """从配置文件加载指定名称的 API 配置。
        输出 3 个独立端口 + 1 个 api_config 复合总线端口。
        """

        # ── 确定配置文件路径 ───────────────────────────────────
        path = _strip_path_quotes(config_path) if config_path else ""
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

        # ── 提取字段并编码输出（保证所有端口传输 ENC:xxx）─────────
        api_key = _encode_api_key(profile.get("api_key", ""))
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


# ── aiohttp 路由（仅在 PromptServer 可用时注册）─────────────────────────

if _HAS_PROMPT_SERVER:

    @PromptServer.instance.routes.post("/api_loader/profile_info")
    async def get_profile_info_route(request):
        """前端调用：传入 profile_name + config_path，返回该 profile 的 base_url 和 api_key。"""
        try:
            data = await request.json()
            profile_name = (data.get("profile_name") or "").strip()
            config_path = _strip_path_quotes(data.get("config_path") or "")

            path = config_path if config_path else DEFAULT_PROFILES_PATH
            if not os.path.exists(path):
                return web.json_response({"success": False, "error": "配置文件不存在"})

            with open(path, "r", encoding="utf-8") as f:
                profiles = json.load(f)

            if not isinstance(profiles, dict):
                return web.json_response({"success": False, "error": "配置文件格式错误"})

            profile = profiles.get(profile_name)
            if not profile or not isinstance(profile, dict):
                return web.json_response({"success": False, "error": f"未找到配置 '{profile_name}'"})

            # 返回时遮挡 api_key，防止后台/网络面板明文泄露
            raw_key = profile.get("api_key", "")
            masked_key = (raw_key[:4] + "****") if len(raw_key) > 8 else "****"
            return web.json_response({
                "success": True,
                "base_url": profile.get("base_url", ""),
                "api_key": masked_key,
            })
        except Exception as e:
            logger.error(f"[api_loader/profile_info] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)


    @PromptServer.instance.routes.post("/api_loader/profiles")
    async def get_profiles_route(request):
        """前端调用：传入 config_path，返回配置文件中所有 profile 名称列表。"""
        try:
            data = await request.json()
            config_path = _strip_path_quotes(data.get("config_path") or "")

            path = config_path if config_path else DEFAULT_PROFILES_PATH
            if not os.path.exists(path):
                return web.json_response({"success": False, "error": "配置文件不存在"})

            with open(path, "r", encoding="utf-8") as f:
                profiles = json.load(f)

            if not isinstance(profiles, dict):
                return web.json_response({"success": False, "error": "配置文件格式错误"})

            names = [k for k in profiles.keys() if not k.startswith("_") and isinstance(profiles[k], dict)]
            return web.json_response({"success": True, "profiles": names})
        except Exception as e:
            logger.error(f"[api_loader/profiles] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)


    @PromptServer.instance.routes.post("/api_loader/models")
    async def get_models_route(request):
        """
        前端调用：传入 base_url + api_key，返回该端点的可用模型列表。
        兼容 OpenAI /models 接口格式。
        """
        import asyncio
        try:
            data = await request.json()
            base_url = (data.get("base_url") or "").strip().rstrip("/")
            api_key = (data.get("api_key") or "").strip()

            if not base_url:
                return web.json_response({"success": False, "error": "base_url 为空"})
            if not api_key:
                return web.json_response({"success": False, "error": "api_key 为空"})

            # 确保 base_url 以 /v1 结尾（兼容各种填法）
            if not base_url.endswith("/v1"):
                if "/v1" not in base_url:
                    base_url = base_url + "/v1"

            models_url = base_url.rstrip("/") + "/models"

            def _fetch():
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                }
                resp = requests.get(models_url, headers=headers, timeout=10)
                return resp

            resp = await asyncio.to_thread(_fetch)

            if resp.status_code == 401:
                return web.json_response({"success": False, "error": "API Key 无效（401）"})
            if resp.status_code == 404:
                return web.json_response({"success": False, "error": f"接口不存在（404）: {models_url}"})
            if resp.status_code != 200:
                return web.json_response({"success": False, "error": f"HTTP {resp.status_code}"})

            result = resp.json()
            model_data = result.get("data", [])
            if not isinstance(model_data, list):
                return web.json_response({"success": False, "error": "返回格式不符合 OpenAI /models 规范"})

            model_ids = sorted([m.get("id", "") for m in model_data if m.get("id")])
            return web.json_response({"success": True, "models": model_ids})

        except requests.exceptions.ConnectionError:
            return web.json_response({"success": False, "error": "无法连接到 API 服务器"})
        except requests.exceptions.Timeout:
            return web.json_response({"success": False, "error": "连接超时（10s）"})
        except Exception as e:
            logger.error(f"[api_loader/models] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)


    @PromptServer.instance.routes.post("/api_loader/select_config_file")
    async def select_config_file_route(request):
        """
        前端文件选择器回调：接收上传的 JSON 配置文件，写入 ComfyUI 临时目录，
        返回该文件的完整路径供 config_path widget 使用。
        """
        import tempfile
        try:
            reader = await request.multipart()
            field = await reader.next()
            if not field:
                return web.json_response({"success": False, "error": "未接收到文件"})

            # 读取上传内容
            content = await field.read()
            # 验证是合法 JSON
            try:
                json.loads(content)
            except json.JSONDecodeError:
                return web.json_response({"success": False, "error": "文件内容不是有效 JSON"})

            # 写入临时目录
            temp_dir = tempfile.gettempdir()
            dest_name = "eagle_api_profiles_uploaded.json"
            dest_path = os.path.join(temp_dir, dest_name)
            with open(dest_path, "wb") as f:
                f.write(content)

            logger.info(f"[EagleAPILoader] 已上传并保存配置: {dest_path}")
            return web.json_response({"success": True, "path": dest_path})
        except Exception as e:
            logger.error(f"[api_loader/select_config_file] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)


    @PromptServer.instance.routes.post("/api_loader/pick_file")
    async def pick_file_route(request):
        """
        在服务端打开原生 Windows 文件选择对话框，返回真实的文件路径。
        优先使用 PowerShell (System.Windows.Forms)，兜底使用 tkinter。
        """
        try:
            path = _native_file_dialog()
            if path:
                return web.json_response({"success": True, "path": path})
            return web.json_response({"success": False, "error": "未选择文件"})
        except Exception as e:
            logger.error(f"[api_loader/pick_file] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)


def _native_file_dialog() -> str:
    """打开原生 Windows 文件对话框，返回选中文件路径。"""
    import subprocess
    ps_code = '''
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = "JSON 文件 (*.json)|*.json|所有文件 (*.*)|*.*"
$d.Title = "选择 API 配置文件"
$r = $d.ShowDialog()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }
'''
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_code],
            capture_output=True, text=True, timeout=30
        )
        path = result.stdout.strip()
        if path and os.path.exists(path):
            return path
    except subprocess.TimeoutExpired:
        logger.warning("[EagleAPILoader] 文件对话框超时")
    except Exception as e:
        logger.warning(f"[EagleAPILoader] PowerShell 对话框失败: {e}")

    # 兜底：尝试 tkinter
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        path = filedialog.askopenfilename(
            title="选择 API 配置文件",
            filetypes=[("JSON 文件", "*.json"), ("所有文件", "*.*")]
        )
        root.destroy()
        return path if path else ""
    except Exception as e:
        logger.warning(f"[EagleAPILoader] tkinter 对话框失败: {e}")

    return ""


__all__ = ["EagleAPIKeyNode", "EagleAPILoader"]
