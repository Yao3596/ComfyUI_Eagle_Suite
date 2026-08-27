# -*- coding: utf-8 -*-
"""Eagle Suite API 单文件多模型配置管理。"""

import base64
import json
import os
import tempfile
import threading
import urllib.parse
import ctypes
from ctypes import wintypes
import hashlib

from .logger import logger


CONFIG_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "api_config.json")
)

MODEL_TYPE_LLM = "llm"
MODEL_TYPE_IMAGE = "image"
MODEL_TYPES = (MODEL_TYPE_LLM, MODEL_TYPE_IMAGE)

_ENC_PREFIX = "ENC:"
_DPAPI_PREFIX = "DPAPI:"
_KEYRING_PREFIX = "KEYRING:"
_FERNET_PREFIX = "FERNET:"
_KEYRING_SERVICE = "ComfyUI Eagle Suite"


def _fernet_key_path() -> str:
    base = os.environ.get("EAGLE_CREDENTIAL_DIR") or os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "ComfyUI-Eagle-Suite", "credential.key")


def _get_fernet():
    from cryptography.fernet import Fernet
    path = _fernet_key_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.isfile(path):
        key = Fernet.generate_key()
        fd, temp_path = tempfile.mkstemp(prefix=".credential.", suffix=".tmp", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(key)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_path, path)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    with open(path, "rb") as handle:
        return Fernet(handle.read().strip())
_FILE_LOCK = threading.RLock()
_COMMENT = (
    "Eagle Suite API 配置文件。每个非下划线开头的根键都是一组模型配置，"
    "由 API 配置加载器统一维护。"
)
_USAGE = (
    "model_type 使用 llm 或 image；model_name 填写根键名称，"
    "加载器会输出对应的 api_key、base_url、model 和 api_config。"
)
_IMAGE_MODEL_HINTS = (
    "gpt-image", "dall-e", "imagen", "ideogram", "recraft",
    "stable-diffusion", "sdxl", "flux", "seedream", "kolors",
)


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _dpapi_protect(value: str) -> str:
    payload = value.encode("utf-8")
    buffer = ctypes.create_string_buffer(payload)
    source = _DATA_BLOB(len(payload), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    output = _DATA_BLOB()
    crypt_protect = ctypes.windll.crypt32.CryptProtectData
    crypt_protect.argtypes = [
        ctypes.POINTER(_DATA_BLOB), wintypes.LPCWSTR, ctypes.POINTER(_DATA_BLOB),
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_DATA_BLOB),
    ]
    crypt_protect.restype = wintypes.BOOL
    if not crypt_protect(
        ctypes.byref(source), "Eagle Suite API key", None, None, None, 0x1, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        encrypted = ctypes.string_at(output.pbData, output.cbData)
        return _DPAPI_PREFIX + base64.b64encode(encrypted).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)


def _dpapi_unprotect(value: str) -> str:
    payload = base64.b64decode(value[len(_DPAPI_PREFIX):], validate=True)
    buffer = ctypes.create_string_buffer(payload)
    source = _DATA_BLOB(len(payload), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    output = _DATA_BLOB()
    crypt_unprotect = ctypes.windll.crypt32.CryptUnprotectData
    crypt_unprotect.argtypes = [
        ctypes.POINTER(_DATA_BLOB), ctypes.POINTER(wintypes.LPWSTR),
        ctypes.POINTER(_DATA_BLOB), ctypes.c_void_p, ctypes.c_void_p,
        wintypes.DWORD, ctypes.POINTER(_DATA_BLOB),
    ]
    crypt_unprotect.restype = wintypes.BOOL
    if not crypt_unprotect(
        ctypes.byref(source), None, None, None, None, 0x1, ctypes.byref(output)
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData).decode("utf-8")
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)


def encode_api_key(raw: str) -> str:
    """Store API keys in the OS credential vault and serialize only a reference."""
    if not raw or not isinstance(raw, str):
        return ""
    text = raw.strip()
    if text.startswith((_DPAPI_PREFIX, _KEYRING_PREFIX, _FERNET_PREFIX)):
        return text
    if text.startswith(_ENC_PREFIX):
        text = decode_api_key(text)
    if os.name == "nt":
        try:
            import keyring
            reference = hashlib.sha256(text.encode("utf-8")).hexdigest()
            keyring.set_password(_KEYRING_SERVICE, reference, text)
            return _KEYRING_PREFIX + reference
        except Exception as error:
            logger.warning(f"[APIConfigManager] 系统凭据库不可用，回退 DPAPI: {error}")
        try:
            return _dpapi_protect(text)
        except Exception as error:
            logger.warning(f"[APIConfigManager] DPAPI 不可用，使用用户级加密密钥: {error}")
            return _FERNET_PREFIX + _get_fernet().encrypt(text.encode("utf-8")).decode("ascii")
    try:
        quoted = urllib.parse.quote(text, safe="")
        payload = base64.b64encode(quoted.encode("utf-8")).decode("utf-8")
        return _ENC_PREFIX + payload
    except Exception:
        return text


def decode_api_key(raw: str) -> str:
    """解码 ENC:Base64 API Key；兼容历史多重编码。"""
    if not raw or not isinstance(raw, str):
        return ""
    text = raw.strip()
    if text.startswith(_KEYRING_PREFIX):
        try:
            import keyring
            return keyring.get_password(_KEYRING_SERVICE, text[len(_KEYRING_PREFIX):]) or ""
        except Exception as error:
            logger.error(f"[APIConfigManager] 系统凭据库读取失败: {error}")
            return ""
    if text.startswith(_FERNET_PREFIX):
        try:
            return _get_fernet().decrypt(text[len(_FERNET_PREFIX):].encode("ascii")).decode("utf-8")
        except Exception as error:
            logger.error(f"[APIConfigManager] 用户级密钥解密失败: {error}")
            return ""
    if text.startswith(_DPAPI_PREFIX):
        try:
            return _dpapi_unprotect(text)
        except Exception as error:
            logger.error(f"[APIConfigManager] DPAPI 解密失败: {error}")
            return ""
    if not text.startswith(_ENC_PREFIX):
        return text
    try:
        for _ in range(10):
            if not text.startswith(_ENC_PREFIX):
                break
            payload = text[len(_ENC_PREFIX):]
            decoded = base64.b64decode(payload).decode("utf-8")
            text = urllib.parse.unquote(decoded)
        return text
    except Exception:
        return raw


def normalize_model_type(value: str = None, model: str = "") -> str:
    """归一化模型类型；缺少类型时根据常见生图模型名安全推断。"""
    text = str(value or "").strip().lower().replace("-", "_")
    if text in {
        "image", "image_generation", "image_gen", "text_to_image",
        "t2i", "生图", "图片", "图像",
    }:
        return MODEL_TYPE_IMAGE
    if text in {"llm", "chat", "vision", "vlm", "大语言", "对话"}:
        return MODEL_TYPE_LLM
    model_lower = str(model or "").strip().lower()
    if any(hint in model_lower for hint in _IMAGE_MODEL_HINTS):
        return MODEL_TYPE_IMAGE
    return MODEL_TYPE_LLM


def _normalize_profile(name: str, profile: dict) -> dict:
    """把一组模型配置整理为统一的四字段结构。"""
    source = profile if isinstance(profile, dict) else {}
    model = str(source.get("model") or name or "").strip()
    api_key = str(source.get("api_key") or "").strip()
    return {
        "api_key": encode_api_key(api_key) if api_key else "",
        "base_url": str(source.get("base_url") or "").strip(),
        "model": model,
        "model_type": normalize_model_type(source.get("model_type"), model),
    }


def _build_document(profiles: dict, active_profile: str = "") -> dict:
    """构造用户要求的根键即模型名的扁平 JSON。"""
    document = {"_comment": _COMMENT, "_usage": _USAGE}
    names = [str(name or "").strip() for name in (profiles or {})]
    names = [name for name in names if name and not name.startswith("_")]
    active = str(active_profile or "").strip()
    if active in names:
        names.remove(active)
        names.insert(0, active)
    for name in names:
        profile = profiles.get(name)
        if isinstance(profile, dict):
            document[name] = _normalize_profile(name, profile)
    return document


def _write_document(profiles: dict, active_profile: str = "") -> bool:
    """同目录临时文件写入后原子替换 api_config.json。"""
    with _FILE_LOCK:
        temp_path = ""
        try:
            parent = os.path.dirname(CONFIG_PATH)
            os.makedirs(parent, exist_ok=True)
            document = _build_document(profiles, active_profile)
            fd, temp_path = tempfile.mkstemp(
                prefix=".api_config.", suffix=".tmp", dir=parent
            )
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as file:
                json.dump(document, file, ensure_ascii=False, indent=2)
                file.write("\n")
                file.flush()
                os.fsync(file.fileno())
            os.replace(temp_path, CONFIG_PATH)
            return True
        except Exception as exc:
            logger.error(f"[APIConfigManager] 保存 api_config.json 失败: {exc}")
            if temp_path:
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            return False


def _ensure_config_template() -> None:
    if not os.path.exists(CONFIG_PATH) and not _write_document({}):
        raise RuntimeError("无法创建 api_config.json")


def _read_raw() -> dict:
    """读取配置；JSON 损坏时抛错，防止增删操作覆盖原文件。"""
    with _FILE_LOCK:
        try:
            _ensure_config_template()
            with open(CONFIG_PATH, "r", encoding="utf-8") as file:
                data = json.load(file)
            if not isinstance(data, dict):
                raise ValueError("配置根节点必须是 JSON 对象")
            return data
        except Exception as exc:
            logger.error(f"[APIConfigManager] 加载失败，已阻止覆盖: {exc}")
            raise RuntimeError(f"api_config.json 无法读取: {exc}") from exc


def _extract_profiles(raw: dict) -> tuple:
    """兼容扁平格式、旧 profiles 包装格式和最早的单模型格式。"""
    profiles = {}

    nested = raw.get("profiles")
    if isinstance(nested, dict):
        for raw_name, profile in nested.items():
            name = str(raw_name or "").strip()
            if name and isinstance(profile, dict):
                profiles[name] = _normalize_profile(name, profile)

    for raw_name, profile in raw.items():
        name = str(raw_name or "").strip()
        if (
            not name
            or name.startswith("_")
            or name in {"profiles", "active_profile"}
            or not isinstance(profile, dict)
        ):
            continue
        profiles[name] = _normalize_profile(name, profile)

    legacy_model = str(raw.get("model") or "").strip()
    legacy_models = raw.get("models") if isinstance(raw.get("models"), list) else []
    ordered_legacy = []
    for model in [legacy_model] + legacy_models:
        model = str(model or "").strip()
        if model and model not in ordered_legacy:
            ordered_legacy.append(model)
    for model in ordered_legacy:
        profiles.setdefault(model, _normalize_profile(model, {
            "api_key": raw.get("api_key", ""),
            "base_url": raw.get("base_url", ""),
            "model": model,
            "model_type": normalize_model_type(None, model),
        }))

    active = str(
        raw.get("_active_model")
        or raw.get("active_profile")
        or legacy_model
        or ""
    ).strip()
    if active not in profiles:
        active = next(iter(profiles), "")
    return profiles, active


def load_profiles() -> dict:
    """加载单文件中的全部模型配置，并自动升级旧结构。"""
    with _FILE_LOCK:
        raw = _read_raw()
        profiles, active = _extract_profiles(raw)
        canonical = _build_document(profiles, active)
        if raw != canonical and not _write_document(profiles, active):
            raise RuntimeError("api_config.json 结构升级写入失败")
        return {"profiles": profiles, "active_profile": active}


def save_profiles(profiles: dict, active_profile: str = None) -> bool:
    """保存全部模型配置；活动项只通过 JSON 顺序表达，不增加额外字段。"""
    clean = {}
    for raw_name, profile in (profiles or {}).items():
        name = str(raw_name or "").strip()
        if name and not name.startswith("_") and isinstance(profile, dict):
            clean[name] = _normalize_profile(name, profile)
    active = str(active_profile or "").strip()
    if active not in clean:
        active = next(iter(clean), "")
    return _write_document(clean, active)


def get_profile_names() -> list:
    return list(load_profiles().get("profiles", {}).keys())


def get_config_revision() -> str:
    """返回不含配置内容的文件版本标识，供前端检测外部修改。"""
    try:
        stat = os.stat(CONFIG_PATH)
        return f"{stat.st_mtime_ns}:{stat.st_size}"
    except OSError:
        return "missing"


def get_profiles_summary() -> list:
    data = load_profiles()
    return [
        {
            "name": name,
            "model": profile.get("model", name),
            "model_type": normalize_model_type(
                profile.get("model_type"), profile.get("model", name)
            ),
        }
        for name, profile in data.get("profiles", {}).items()
    ]


def get_profile(name: str) -> dict:
    clean_name = str(name or "").strip()
    profile = load_profiles().get("profiles", {}).get(clean_name)
    return _normalize_profile(clean_name, profile) if isinstance(profile, dict) else {}


def get_active_profile() -> dict:
    data = load_profiles()
    name = data.get("active_profile", "")
    profile = data.get("profiles", {}).get(name, {})
    result = _normalize_profile(name, profile) if profile else {}
    result["name"] = name
    return result


def set_active_profile(name: str) -> bool:
    data = load_profiles()
    clean_name = str(name or "").strip()
    if clean_name not in data.get("profiles", {}):
        return False
    if clean_name == data.get("active_profile"):
        return True
    return save_profiles(data["profiles"], clean_name)


def add_profile(
    name: str,
    api_key: str,
    base_url: str,
    model: str,
    model_type: str = MODEL_TYPE_LLM,
) -> bool:
    data = load_profiles()
    clean_model = str(model or "").strip()
    clean_name = str(name or clean_model).strip()
    if not clean_name or clean_name.startswith("_") or not clean_model:
        return False
    profiles = data.get("profiles", {})
    profiles[clean_name] = _normalize_profile(clean_name, {
        "api_key": api_key,
        "base_url": base_url,
        "model": clean_model,
        "model_type": model_type,
    })
    return save_profiles(profiles, clean_name)


def update_profile(
    name: str,
    api_key: str = None,
    base_url: str = None,
    model: str = None,
    model_type: str = None,
) -> bool:
    data = load_profiles()
    profiles = data.get("profiles", {})
    clean_name = str(name or "").strip()
    if clean_name not in profiles:
        return False

    profile = dict(profiles[clean_name])
    if api_key not in (None, ""):
        profile["api_key"] = api_key
    if base_url is not None:
        profile["base_url"] = str(base_url or "").strip()
    if model_type is not None:
        profile["model_type"] = normalize_model_type(
            model_type, profile.get("model", clean_name)
        )

    new_name = clean_name
    if model is not None:
        clean_model = str(model or "").strip()
        if not clean_model:
            return False
        profile["model"] = clean_model
        new_name = clean_model
    if new_name != clean_name and new_name in profiles:
        return False

    if new_name != clean_name:
        del profiles[clean_name]
    profiles[new_name] = _normalize_profile(new_name, profile)
    active = data.get("active_profile", "")
    if active == clean_name:
        active = new_name
    return save_profiles(profiles, active)


def remove_profile(name: str) -> bool:
    data = load_profiles()
    profiles = data.get("profiles", {})
    clean_name = str(name or "").strip()
    if clean_name not in profiles:
        return False
    del profiles[clean_name]
    active = data.get("active_profile", "")
    if active == clean_name:
        active = next(iter(profiles), "")
    return save_profiles(profiles, active)


def get_profile_for_frontend(name: str) -> dict:
    profile = get_profile(name)
    if not profile:
        return {}
    return {
        "name": str(name or "").strip(),
        "api_key": "",
        "api_key_set": bool(profile.get("api_key")),
        "base_url": profile.get("base_url", ""),
        "model": profile.get("model", ""),
        "model_type": normalize_model_type(
            profile.get("model_type"), profile.get("model", "")
        ),
    }


# ── 旧版单模型接口：保留给 Gallery 和现有工作流 ─────────────

def load_config() -> dict:
    data = load_profiles()
    names = list(data.get("profiles", {}).keys())
    active_name = data.get("active_profile", "")
    profile = data.get("profiles", {}).get(active_name, {})
    return {
        "api_key": profile.get("api_key", ""),
        "base_url": profile.get("base_url", ""),
        "model": profile.get("model", ""),
        "model_type": profile.get("model_type", MODEL_TYPE_LLM),
        "models": names,
    }


def save_config(config: dict) -> bool:
    if isinstance(config, dict) and isinstance(config.get("profiles"), dict):
        return save_profiles(config["profiles"], config.get("active_profile"))
    return save_api_config(
        api_key=(config or {}).get("api_key"),
        base_url=(config or {}).get("base_url"),
        model=(config or {}).get("model"),
        models=(config or {}).get("models"),
        model_type=(config or {}).get("model_type"),
    )


def save_api_config(
    api_key: str = None,
    base_url: str = None,
    model: str = None,
    models: list = None,
    model_type: str = None,
) -> bool:
    """在单一 api_config.json 中新增或更新实际使用的模型。"""
    data = load_profiles()
    profiles = data.get("profiles", {})
    target_model = str(model or "").strip()
    target_name = ""
    if target_model in profiles:
        target_name = target_model
    elif target_model:
        target_name = next(
            (
                name for name, profile in profiles.items()
                if str(profile.get("model") or "").strip() == target_model
            ),
            target_model,
        )
    else:
        target_name = data.get("active_profile", "")

    if target_name:
        current = dict(profiles.get(target_name, {}))
        current.update({
            "api_key": api_key if api_key is not None else current.get("api_key", ""),
            "base_url": base_url if base_url is not None else current.get("base_url", ""),
            "model": target_model or current.get("model", target_name),
            "model_type": (
                model_type
                if model_type is not None
                else current.get("model_type")
            ),
        })
        profiles[target_name] = _normalize_profile(target_name, current)

    if isinstance(models, list):
        source = profiles.get(target_name, {})
        for raw_name in models:
            name = str(raw_name or "").strip()
            if name and name not in profiles:
                profiles[name] = _normalize_profile(name, {
                    "api_key": source.get("api_key", api_key or ""),
                    "base_url": source.get("base_url", base_url or ""),
                    "model": name,
                    "model_type": normalize_model_type(None, name),
                })

    if not profiles:
        return False
    return save_profiles(profiles, target_name or next(iter(profiles), ""))


def get_model_names() -> list:
    return get_profile_names()


def get_active_model() -> str:
    return str(get_active_profile().get("model") or "").strip()


def set_active_model(model: str) -> bool:
    clean_model = str(model or "").strip()
    data = load_profiles()
    if clean_model in data.get("profiles", {}):
        return set_active_profile(clean_model)
    for name, profile in data.get("profiles", {}).items():
        if str(profile.get("model") or "").strip() == clean_model:
            return set_active_profile(name)
    return False


def add_model(model: str) -> bool:
    clean_model = str(model or "").strip()
    if not clean_model:
        return False
    data = load_profiles()
    if clean_model in data.get("profiles", {}):
        return True
    active = get_active_profile()
    return add_profile(
        clean_model,
        active.get("api_key", ""),
        active.get("base_url", ""),
        clean_model,
        normalize_model_type(None, clean_model),
    )


# ── URL 规范化 ────────────────────────────────────────────

def strip_chat_completions(url: str) -> str:
    """剥离具体 API 端点并统一为以 /v1 结尾的 Base URL。"""
    if not url or not isinstance(url, str):
        return ""
    text = url.strip().rstrip("/")
    for suffix in (
        "/chat/completions", "/images/generations", "/images/edits",
        "/images/variations", "/embeddings", "/completions", "/responses",
    ):
        if text.endswith(suffix):
            text = text[:-len(suffix)]
            break
    if not text.endswith("/v1"):
        if "/v1" in text:
            text = text.split("/v1")[0] + "/v1"
        else:
            text += "/v1"
    return text


def normalize_url(url: str) -> str:
    return strip_chat_completions(url)


# ── Eagle Saver 独立配置（保留旧接口）────────────────────

_SAVER_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "eagle_saver_config.json"
)


def load_saver_config() -> dict:
    try:
        if os.path.exists(_SAVER_CONFIG_PATH):
            with open(_SAVER_CONFIG_PATH, "r", encoding="utf-8") as file:
                return json.load(file)
    except Exception as exc:
        logger.warning(f"[APIConfigManager] 加载 saver 配置失败: {exc}")
    return {}


def save_saver_config(config: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_SAVER_CONFIG_PATH), exist_ok=True)
        with open(_SAVER_CONFIG_PATH, "w", encoding="utf-8") as file:
            json.dump(config, file, ensure_ascii=False, indent=2)
    except Exception as exc:
        logger.error(f"[APIConfigManager] 保存 saver 配置失败: {exc}")


__all__ = [
    "CONFIG_PATH",
    "MODEL_TYPE_LLM",
    "MODEL_TYPE_IMAGE",
    "MODEL_TYPES",
    "encode_api_key",
    "decode_api_key",
    "normalize_model_type",
    "load_profiles",
    "save_profiles",
    "get_profile_names",
    "get_config_revision",
    "get_profiles_summary",
    "get_profile",
    "get_active_profile",
    "set_active_profile",
    "add_profile",
    "update_profile",
    "remove_profile",
    "get_profile_for_frontend",
    "load_config",
    "save_config",
    "save_api_config",
    "get_model_names",
    "get_active_model",
    "set_active_model",
    "add_model",
    "strip_chat_completions",
    "normalize_url",
    "load_saver_config",
    "save_saver_config",
]
