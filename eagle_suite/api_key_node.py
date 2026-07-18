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
from .utils import decode_api_key, _ENC_PREFIX

# ── 懒加载 aiohttp / PromptServer（避免导入时触发依赖链错误）──
try:
    from aiohttp import web
    from server import PromptServer
    _HAS_PROMPT_SERVER = True
except Exception:
    web = None
    PromptServer = None
    _HAS_PROMPT_SERVER = False

# ── API Key 解码（使用公共函数）───────────────
# 保留 _decode_api_key 作为内部别名，兼容已有代码
_decode_api_key = decode_api_key


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
    # 去除外层配对引号：支持 "path" 、'path' 等形式
    # 注意：不能用 str.strip(char)，因为 strip 按字符集移除，会误删内容
    while len(s) >= 2 and s[0] in ('"', "'") and s[-1] == s[0]:
        s = s[1:-1].strip()
    return s


def _strip_chat_completions(url: str) -> str:
    """规范化 base_url：剥离尾部 /chat/completions 等后缀。

    配置文件中可能把完整的请求路径写入 base_url（"https://xxx/v1/chat/completions"），
    下游 EagleAPIUnifiedNode.process 会再拼接一次 /chat/completions，
    因此必须在配置加载阶段就剥离后缀，保证输出干净的根地址。
    """
    if not url or not isinstance(url, str):
        return ""
    s = url.strip().rstrip("/")
    # 剥离所有可能的尾部后缀（按从长到短匹配，避免误删）
    for suffix in ("/chat/completions", "/embeddings", "/completions", "/responses"):
        if s.endswith(suffix):
            s = s[: -len(suffix)]
            break
    # 确保以 /v1 结尾（OpenAI 兼容要求），缺失时自动补全
    if not s.endswith("/v1"):
        # 如果用户写的是裸域名，则补 /v1；否则保留原样
        if "/v1" in s:
            s = s.split("/v1")[0] + "/v1"
        else:
            s = s + "/v1"
    return s


# ── 默认配置文件路径 ──────────────────────────────────────────
# 优先使用 api_profiles.json，不存在时回退到 api_config.json（兼容旧配置）
DEFAULT_PROFILES_PATH = os.path.join(
    os.path.dirname(__file__), "..", "api_profiles.json"
)
_FALLBACK_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "api_config.json"
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


def _load_profiles_from_bytes(content: bytes) -> tuple:
    """从字节内容加载并校验 profile 配置。
    返回 (success: bool, profiles_or_error: dict|str)
    """
    try:
        data = json.loads(content.decode("utf-8"))
    except Exception as e:
        return False, f"文件内容不是有效 JSON: {e}"

    if not isinstance(data, dict):
        return False, "配置文件根必须是 JSON 对象（{profile_name: {...}}）"

    valid_profiles = {
        k: v for k, v in data.items()
        if not k.startswith("_") and isinstance(v, dict)
        and v.get("api_key") and v.get("base_url") and v.get("model")
    }
    if not valid_profiles:
        return False, "未找到有效 profile（每个 profile 必须包含 api_key、base_url、model）"
    return True, valid_profiles


def _load_fallback_profile_names() -> list:
    """备用：尝试从 api_config.json 中读取最后一次使用的 model 作为 profile 选项。
    如果 api_config.json 不存在，自动创建一个空模板，避免文件缺失导致前端下拉菜单异常。"""
    try:
        config_path = os.path.join(os.path.dirname(__file__), "..", "api_config.json")
        if not os.path.exists(config_path):
            try:
                default = {"api_key": "", "base_url": "", "model": ""}
                with open(config_path, "w", encoding="utf-8") as f:
                    json.dump(default, f, ensure_ascii=False, indent=2)
            except Exception:
                pass
            return []
        with open(config_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        model = (data.get("model") or "").strip()
        if model:
            return [model]
    except Exception:
        pass
    return []


def _load_profiles_file(path: str) -> tuple:
    """加载并校验配置文件内容。
    
    返回: (success: bool, profiles_or_error: dict|str)
    校验标准：
    1. 文件必须是合法 JSON
    2. 根必须是 JSON 对象（dict）
    3. 至少包含一个有效的 profile（值为 dict 且含 api_key / base_url / model）
    """
    if not path:
        return False, "配置文件路径为空"
    if not os.path.exists(path):
        return False, f"配置文件不存在: {path}"
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return False, f"JSON 解析失败: {e}"
    except Exception as e:
        return False, f"读取文件失败: {e}"

    if not isinstance(data, dict):
        return False, "配置文件根必须是 JSON 对象（{profile_name: {...}}）"

    valid_profiles = {
        k: v for k, v in data.items()
        if not k.startswith("_") and isinstance(v, dict)
        and v.get("api_key") and v.get("base_url") and v.get("model")
    }
    if not valid_profiles:
        return False, "配置文件中没有找到有效的 profile（必须包含 api_key、base_url、model）"

    return True, valid_profiles


def _get_profile_names(path: str) -> list:
    """从指定路径获取可用的 profile 名称列表。"""
    ok, result = _load_profiles_file(path)
    if not ok:
        return []
    return list(result.keys())


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

    def get_key(self, api_key: str):
        """输出 ENC:xxx 加密格式 + api_config 复合类型，兼容两种连接方式。"""
        encoded = _encode_api_key(api_key)
        # api_config 复合类型：只填充 api_key，base_url 和 model 留空
        # EagleAPIUnifiedNode 会优先使用 api_config，base_url/model 留空时回退到独立字段
        return (encoded, (encoded, "", ""))


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
        # model_name 始终作为 STRING 注册，避免静态 COMBO 列表与动态 config_path 冲突。
        # 前端会在运行时把该 widget 替换为下拉列表，后端执行时再校验实际文件内容。
        return {
            "required": {
                "model_name": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "点击「加载模型」或输入 profile 名称"
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
            # 优先 api_profiles.json，不存在时回退到 api_config.json
            if os.path.exists(DEFAULT_PROFILES_PATH):
                path = DEFAULT_PROFILES_PATH
            elif os.path.exists(_FALLBACK_CONFIG_PATH):
                path = _FALLBACK_CONFIG_PATH
            else:
                path = DEFAULT_PROFILES_PATH  # 都不存在，用默认路径（后续会报不存在错误）

        # ── 加载并校验配置文件内容 ───────────────────────────────
        ok, profiles = _load_profiles_file(path)
        if not ok:
            err = f"❌ {profiles}"
            logger.error(f"[EagleAPILoader] {err} | path={path}")
            return ("", err, "", ("", err, ""))

        # ── 查找指定配置 ───────────────────────────────────────
        name = (model_name or "").strip()
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

        # ── 提取字段并编码输出（保证所有端口传输 ENC:xxx）─────────
        api_key = _encode_api_key(profile.get("api_key", ""))
        # ── 规范化 base_url ───────────────────────────────────
        # 配置里可能写完整的 chat/completions 路径，必须在输出前剥离，
        # 否则下游 EagleAPIUnifiedNode.process 会再次拼接 /chat/completions，
        # 导致请求变成 https://xxx/v1/chat/completions/chat/completions（404）
        raw_base_url = profile.get("base_url", "")
        base_url = _strip_chat_completions(raw_base_url)
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


# ── aiohttp 路由（延迟注册，避免导入时 PromptServer.instance 未就绪）──────

def register_routes():
    """延迟注册 API Loader 路由。"""
    if not _HAS_PROMPT_SERVER:
        return
    server = PromptServer.instance
    if not server:
        logger.warning("[APILoader] PromptServer.instance 未就绪，跳过路由注册")
        return
    routes = server.routes

    @routes.post("/api_loader/profile_info")
    async def get_profile_info_route(request):
        """前端调用：传入 profile_name + config_path，返回该 profile 的 base_url 和 api_key。"""
        try:
            data = await request.json()
            profile_name = (data.get("profile_name") or "").strip()
            config_path = _strip_path_quotes(data.get("config_path") or "")

            path = config_path if config_path else DEFAULT_PROFILES_PATH
            ok, profiles = _load_profiles_file(path)
            if not ok:
                return web.json_response({"success": False, "error": profiles})

            profile = profiles.get(profile_name)
            if not profile:
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

    @routes.post("/api_loader/profiles")
    async def get_profiles_route(request):
        """前端调用：传入 config_path，返回配置文件中所有 profile 名称列表。
        以文件内容为准：只要 JSON 内容合法且包含有效 profile，即可返回名称列表。
        """
        try:
            data = await request.json()
            config_path = _strip_path_quotes(data.get("config_path") or "")

            path = config_path if config_path else DEFAULT_PROFILES_PATH
            ok, profiles = _load_profiles_file(path)
            if not ok:
                return web.json_response({"success": False, "error": profiles})

            names = list(profiles.keys())
            return web.json_response({"success": True, "profiles": names})
        except Exception as e:
            logger.error(f"[api_loader/profiles] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api_loader/models")
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

    @routes.post("/api_loader/select_config_file")
    async def select_config_file_route(request):
        """
        前端文件选择器回调：接收上传的 JSON 配置文件，写入 ComfyUI 临时目录，
        返回该文件的完整路径供 config_path widget 使用。
        文件名不重要，只校验内容是否合法且包含有效 profile。
        """
        import tempfile
        import uuid
        try:
            reader = await request.multipart()
            field = await reader.next()
            if not field:
                return web.json_response({"success": False, "error": "未接收到文件"})

            # 读取上传内容
            content = await field.read()
            # 验证是合法 JSON 且包含有效 profile
            ok, msg = _load_profiles_from_bytes(content)
            if not ok:
                return web.json_response({"success": False, "error": msg})

            # 写入临时目录（使用唯一文件名，避免覆盖）
            temp_dir = tempfile.gettempdir()
            dest_name = f"eagle_api_profiles_{uuid.uuid4().hex[:8]}.json"
            dest_path = os.path.join(temp_dir, dest_name)
            with open(dest_path, "wb") as f:
                f.write(content)

            logger.info(f"[EagleAPILoader] 已上传并保存配置: {dest_path}")
            return web.json_response({"success": True, "path": dest_path})
        except Exception as e:
            logger.error(f"[api_loader/select_config_file] 错误: {e}")
            return web.json_response({"success": False, "error": str(e)}, status=500)

    @routes.post("/api_loader/pick_file")
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

    logger.info("[APILoader] API Loader 路由已注册")


# 注意：路由由 eagle_suite/__init__.py 统一调用 register_routes() 注册，
# 避免在 PromptServer.instance 未就绪时自动注册导致 AttributeError。


def _native_file_dialog() -> str:
    """打开原生 Windows 文件对话框，返回选中文件路径。
    优先使用 PowerShell（在 Windows 桌面环境最稳定），兜底使用 tkinter。
    """
    # ── 优先 PowerShell（兼容 Windows 桌面与服务端环境）──
    ps_code = '''
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = "JSON 文件 (*.json)|*.json|所有文件 (*.*)|*.*"
$d.Title = "选择 API 配置文件"
$r = $d.ShowDialog()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }
'''
    try:
        import subprocess
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps_code],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            path = result.stdout.strip().split('\n')[-1].strip()
            if path and os.path.exists(path):
                return path
        if result.stderr:
            logger.warning(f"[EagleAPILoader] PowerShell 对话框错误: {result.stderr.strip()}")
    except subprocess.TimeoutExpired:
        logger.warning("[EagleAPILoader] 文件对话框超时")
    except Exception as e:
        logger.warning(f"[EagleAPILoader] PowerShell 对话框失败: {e}")

    # ── 兜底 tkinter（Python 进程内，无冷启动开销）──────────
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
        if path:
            return path
    except Exception as e:
        logger.warning(f"[EagleAPILoader] tkinter 对话框失败: {e}")

    return ""


__all__ = ["EagleAPIKeyNode", "EagleAPILoader"]
