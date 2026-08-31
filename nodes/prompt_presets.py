# -*- coding: utf-8 -*-
"""
EaglePromptPresets - 提示词预设模板（增强版）
支持 Obsidian 集成、Markdown 格式、自定义路径、动态变量
"""

import json
import uuid
import os
import re
import copy
import io
import shutil
import mimetypes
import tempfile
import threading
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional
from urllib.parse import quote, urlparse, urlunparse

import aiohttp
from aiohttp import web
from PIL import Image, ImageOps

from ..eagle_suite.logger import logger
from ..eagle_suite.route_registry import route

# ─────────────────────────────────────────────────────────
# 配置与路径
# ─────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent / "prompts"
BASE_DIR.mkdir(parents=True, exist_ok=True)

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = PLUGIN_ROOT / "eagle_suite" / "skills"
LEGACY_SINGULAR_SKILL_DIR = PLUGIN_ROOT / "eagle_suite" / "Skill"
SKILL_DIR.mkdir(parents=True, exist_ok=True)

CONFIG_FILE = BASE_DIR / "config.json"
USER_TEMPLATES_FILE = BASE_DIR / "user_templates.json"
USER_TEMPLATES_DIR = SKILL_DIR / "user_templates"
USER_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
COVERS_DIR = BASE_DIR / "covers"
COVERS_DIR.mkdir(exist_ok=True)
_WRITE_LOCK = threading.RLock()


def _atomic_write_text(path: Path, content: str) -> None:
    path = Path(path)
    temp_name = ""
    with _WRITE_LOCK:
        try:
            fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, path)
        finally:
            if temp_name and os.path.exists(temp_name):
                os.remove(temp_name)


def _atomic_write_json(path: Path, data) -> None:
    _atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


async def _read_json_request(request, label: str):
    """Read a JSON object without depending on the browser's Content-Type header.

    Some ComfyUI frontends/proxies strip the request Content-Type header, while a
    stale cached frontend can issue a POST with no body at all.  aiohttp's
    request.json() turns both cases into an opaque JSONDecodeError/ContentTypeError.
    Return a user-facing validation error instead of escalating them to HTTP 500.
    """
    try:
        raw = await request.text()
    except Exception as error:
        return None, f"{label}请求体读取失败: {error}"
    if not str(raw or "").strip():
        return None, f"{label}请求体为空，请刷新浏览器页面后重试"
    try:
        body = json.loads(raw)
    except (TypeError, ValueError) as error:
        return None, f"{label}请求不是有效 JSON: {error}"
    if not isinstance(body, dict):
        return None, f"{label}请求必须是 JSON 对象"
    return body, None

# 默认配置
DEFAULT_CONFIG = {
    "obsidian": {
        "enabled": False,
        "api_url": "https://127.0.0.1:27124",
        "api_key": "",
        "vault_path": "",
        "prompts_folder": "ComfyUI/Prompts",
        "director_skills_folder": "ComfyUI/DirectorSkills",
        "director_skills_file": "Eagle Director Skills.md"
    },
    "director_skills": {
        "source": "eagle",
        "custom_path": "",
        "filmstrip_megapixels": 1.0
    },
    "local_paths": [str(USER_TEMPLATES_DIR)],
    "auto_sync": True,
    "default_category": "自定义"
}

# 内置模板
PROMPT_TEMPLATES = {
    "图片编辑 (kontext)": [
        {"Label": "移除物体", "Instruction": "remove the {{target}}", "example": "remove the grapes on the left"},
        {"Label": "主体微调", "Instruction": "make the object {{adjustment}}", "example": "make the object head gigantic"},
        {"Label": "替换主体", "Instruction": "turn the object into a {{replacement}}", "example": "turn the object into a mech"},
        {"Label": "添加物件", "Instruction": "give the object a {{item}}", "example": "give the object a hat"},
        {"Label": "更换背景", "Instruction": "Replace the background with a {{scene}}", "example": "Replace the background with a desert"},
        {"Label": "添加文字", "Instruction": 'write the words "{{text}}"', "example": 'write the words "Hello World" in the bottom left'},
        {"Label": "移除水印", "Instruction": "remove the watermark", "example": "remove the watermark"},
        {"Label": "高清修复", "Instruction": "unblur the photo, make it more clear", "example": "unblur the photo"},
    ],
    "风格转换": [
        {"Label": "转动漫风格", "Instruction": "Make this into anime", "example": "Make this into anime"},
        {"Label": "转写实风格", "Instruction": "Make this a real photo", "example": "Make this a real photo"},
        {"Label": "水彩画", "Instruction": "Turn this into a watercolor painting", "example": "Turn this into a watercolor painting"},
        {"Label": "钢笔画", "Instruction": "turn this into a detailed pen and ink sketch", "example": "turn this into a detailed pen and ink sketch"},
        {"Label": "木炭素描", "Instruction": "convert this picture to a charcoal sketch", "example": "convert this picture to a charcoal sketch"},
        {"Label": "黑白漫画", "Instruction": "turn this into a manga panel", "example": "turn this into a manga panel"},
        {"Label": "像素化", "Instruction": "Turn this into pixel art", "example": "Turn this into pixel art"},
        {"Label": "3D化", "Instruction": "turn this into a low poly isometric render", "example": "turn this into a low poly 3d render"},
        {"Label": "吉卜力风格", "Instruction": "This image in the style of Studio Ghibli", "example": "This image in the style of Studio Ghibli"},
        {"Label": "贴纸化", "Instruction": "A sticker of this image", "example": "A sticker of this image"},
    ],
    "镜头/视角": [
        {"Label": "推进镜头", "Instruction": "Zoom in on the object closest to the camera", "example": "Zoom in on the object"},
        {"Label": "拉远镜头", "Instruction": "Zoom out to show the whole scene", "example": "Zoom out to show the whole scene"},
        {"Label": "俯瞰镜头", "Instruction": "show me an aerial view from above", "example": "show me an aerial view from above"},
        {"Label": "无人机视角", "Instruction": "An aerial drone shot of this scene", "example": "An aerial drone shot"},
        {"Label": "侧视图", "Instruction": "Generate a side view of this subject", "example": "Generate a side view"},
        {"Label": "正视图", "Instruction": "Generate a front view of this subject", "example": "Generate a front view"},
    ],
}

# ─────────────────────────────────────────────────────────
# 新增：动态变量提取
# ─────────────────────────────────────────────────────────

def extract_template_variables(template: str) -> List[str]:
    """从模板字符串中提取所有 {{变量名}} 格式的变量（去重保持顺序）"""
    if not template:
        return []
    matches = re.findall(r'\{\{\s*(\w+)\s*\}\}', template)
    seen = set()
    result = []
    for m in matches:
        if m not in seen:
            seen.add(m)
            result.append(m)
    return result

# ─────────────────────────────────────────────────────────
# 工具函数
# ─────────────────────────────────────────────────────────

def load_config() -> dict:
    """加载配置"""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                stored = json.load(f) or {}
                merged = copy.deepcopy(DEFAULT_CONFIG)
                merged.update({key: value for key, value in stored.items() if key not in {"obsidian", "director_skills"}})
                if isinstance(stored.get("obsidian"), dict):
                    merged["obsidian"].update(stored["obsidian"])
                if isinstance(stored.get("director_skills"), dict):
                    merged["director_skills"].update(stored["director_skills"])
                try:
                    merged["director_skills"]["filmstrip_megapixels"] = min(
                        10.0,
                        max(1.0, float(merged["director_skills"].get("filmstrip_megapixels") or 1.0)),
                    )
                except (TypeError, ValueError):
                    merged["director_skills"]["filmstrip_megapixels"] = 1.0
                legacy_template_dirs = {
                    (BASE_DIR / "user_templates").resolve(),
                    (LEGACY_SINGULAR_SKILL_DIR / "user_templates").resolve(),
                }
                normalized_paths = []
                for raw_path in merged.get("local_paths") or []:
                    try:
                        path = Path(str(raw_path)).expanduser().resolve()
                        normalized_paths.append(
                            str(USER_TEMPLATES_DIR) if path in legacy_template_dirs else str(raw_path)
                        )
                    except Exception:
                        normalized_paths.append(str(raw_path))
                merged["local_paths"] = list(dict.fromkeys(normalized_paths))
                return merged
        except Exception as e:
            logger.error(f"加载配置失败: {e}")
    return copy.deepcopy(DEFAULT_CONFIG)


def save_config(config: dict):
    """保存配置"""
    try:
        config = copy.deepcopy(config or {})
        director_settings = config.setdefault("director_skills", {})
        try:
            director_settings["filmstrip_megapixels"] = min(
                10.0, max(1.0, float(director_settings.get("filmstrip_megapixels") or 1.0))
            )
        except (TypeError, ValueError):
            director_settings["filmstrip_megapixels"] = 1.0
        _atomic_write_json(CONFIG_FILE, config)
    except Exception as e:
        logger.error(f"保存配置失败: {e}")
        raise


def _markdown_front_matter(content: str):
    """读取文件级 YAML 风格元数据；仅支持本节点需要的简单键值和数组。"""
    metadata = {}
    body = str(content or "")
    match = re.match(r'^\ufeff?\s*---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)', body, re.DOTALL)
    if not match:
        return metadata, body

    for line in match.group(1).splitlines():
        if ':' not in line or line.lstrip().startswith('#'):
            continue
        key, value = line.split(':', 1)
        key = key.strip().lower()
        value = value.strip()
        if value.startswith('[') and value.endswith(']'):
            value = [item.strip().strip('"\'') for item in value[1:-1].split(',') if item.strip()]
        metadata[key] = value
    return metadata, body[match.end():]


def _markdown_template_id(filename: str, label: str, instruction: str, section: str = "") -> str:
    stable_key = f"{filename}:{section}:{label}:{instruction}"
    return 'markdown-' + uuid.uuid5(uuid.NAMESPACE_URL, stable_key).hex


def _markdown_field(section_body: str, heading: str) -> str:
    pattern = rf'(?ms)^###\s*{re.escape(heading)}\s*$\r?\n(.*?)(?=^###\s+|\Z)'
    match = re.search(pattern, section_body)
    return match.group(1).strip() if match else ""


def parse_markdown_templates(content: str, filename: str, source: str = "local") -> List[Dict]:
    """解析单模板或多模板 Markdown。

    多模板格式使用二级标题作为模板名，并在其下使用三级“指令/示例”标题。
    普通知识库 Markdown 没有“指令”段时不会被误判为模板。
    """
    try:
        metadata, body = _markdown_front_matter(content)
        default_category = str(metadata.get('category') or '自定义')
        default_tags = metadata.get('tags', [])
        if isinstance(default_tags, str):
            default_tags = [item.strip() for item in default_tags.split(',') if item.strip()]
        default_cover = str(metadata.get('cover') or '')
        results = []

        sections = list(re.finditer(r'(?ms)^##\s+([^\r\n]+?)\s*$\r?\n(.*?)(?=^##\s+|\Z)', body))
        document_id = str(metadata.get('id') or '').strip()
        for index, section_match in enumerate(sections):
            label = section_match.group(1).strip()
            section_body = section_match.group(2)
            instruction = _markdown_field(section_body, '指令')
            if not instruction:
                continue
            example = _markdown_field(section_body, '示例')
            section_id = (
                f"{document_id}:{index}"
                if document_id
                else _markdown_template_id(filename, label, instruction, str(index))
            )
            results.append({
                "id": section_id,
                "Label": label,
                "Instruction": instruction,
                "example": example,
                "category": default_category,
                "tags": list(default_tags),
                "cover": default_cover,
                "source": source,
                "file_path": filename,
                "section_index": index,
            })

        if results:
            return results

        instruction_match = re.search(r'(?ms)^##\s*指令\s*$\r?\n(.*?)(?=^##\s+|\Z)', body)
        if not instruction_match:
            # 有明确 label/type 的文档可把正文作为单模板；普通 Obsidian 文档则忽略。
            doc_type = str(metadata.get('type') or '').lower()
            if not metadata.get('label') and doc_type not in {'prompt', 'template', 'prompt-template'}:
                return []
            instruction = body.strip()
        else:
            instruction = instruction_match.group(1).strip()

        if not instruction:
            return []
        example_match = re.search(r'(?ms)^##\s*示例\s*$\r?\n(.*?)(?=^##\s+|\Z)', body)
        example = example_match.group(1).strip() if example_match else ""
        label = str(metadata.get('label') or Path(filename).stem)
        return [{
            "id": str(metadata.get('id') or _markdown_template_id(filename, label, instruction)),
            "Label": label,
            "Instruction": instruction,
            "example": example,
            "category": default_category,
            "tags": list(default_tags),
            "cover": default_cover,
            "source": source,
            "file_path": filename,
        }]
    except Exception as e:
        logger.error(f"解析 Markdown 失败 ({filename}): {e}")
        return []


def parse_markdown_template(content: str, filename: str) -> Optional[Dict]:
    """兼容旧调用：返回文档中的第一个模板。"""
    templates = parse_markdown_templates(content, filename)
    return templates[0] if templates else None


def template_to_markdown(template: Dict) -> str:
    """将模板转换为 Markdown 格式"""
    tags_str = json.dumps(template.get('tags', []))

    return f"""---
id: {template.get('id', '')}
label: {template.get('Label', '')}
category: {template.get('category', '自定义')}
tags: {tags_str}
cover: {template.get('cover', '')}
---

## 指令
{template.get('Instruction', '')}

## 示例
{template.get('example', '')}
"""


def load_local_templates(paths: List[str]) -> List[Dict]:
    """从本地路径加载模板"""
    templates = []

    if USER_TEMPLATES_FILE.exists():
        try:
            with open(USER_TEMPLATES_FILE, 'r', encoding='utf-8') as f:
                stored = json.load(f)
            if isinstance(stored, list):
                for item in stored:
                    if isinstance(item, dict):
                        normalized = dict(item)
                        normalized['source'] = 'user'
                        templates.append(normalized)
        except Exception as e:
            logger.error(f"加载用户模板文件失败 ({USER_TEMPLATES_FILE}): {e}")

    scanned_paths = set()
    for path_str in list(paths or []) + [str(USER_TEMPLATES_DIR)]:
        path = Path(path_str)
        if not _is_allowed_prompt_path(path):
            logger.warning(f"已拒绝未登记的提示词目录: {path}")
            continue
        if not path.exists():
            logger.warning(f"路径不存在: {path}")
            continue
        try:
            path_key = str(path.resolve()).lower()
        except Exception:
            path_key = str(path).lower()
        if path_key in scanned_paths:
            continue
        scanned_paths.add(path_key)

        # Scanned files are source documents and therefore read-only. Templates
        # saved/imported through the UI live in USER_TEMPLATES_FILE and are the
        # only individually deletable entries. This prevents deleting one H2
        # template from accidentally deleting a multi-template Markdown file.
        source = 'local'

        for file_path in path.glob('**/*'):
            if file_path.is_file():
                try:
                    if file_path.resolve() == USER_TEMPLATES_FILE.resolve():
                        continue
                    if file_path.suffix.lower() == '.json':
                        with open(file_path, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            entries = data if isinstance(data, list) else [data]
                            for entry in entries:
                                if isinstance(entry, dict):
                                    item = dict(entry)
                                    item['source'] = source
                                    item['file_path'] = str(file_path)
                                    templates.append(item)

                    elif file_path.suffix.lower() in ['.md', '.markdown']:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                            parsed = parse_markdown_templates(content, str(file_path), source=source)
                            for template in parsed:
                                template['file_path'] = str(file_path)
                                templates.append(template)

                except Exception as e:
                    logger.error(f"加载文件失败 ({file_path}): {e}")

    return templates


def _prompt_roots() -> List[Path]:
    values = [str(USER_TEMPLATES_DIR)]
    values.extend(filter(None, os.environ.get("EAGLE_PROMPT_ROOTS", "").split(os.pathsep)))
    roots = []
    for value in values:
        try:
            root = Path(value).expanduser().resolve()
            if root.is_dir():
                roots.append(root)
        except OSError:
            pass
    return roots


def _is_allowed_prompt_path(path: Path) -> bool:
    try:
        resolved = path.expanduser().resolve()
        return any(resolved == root or root in resolved.parents for root in _prompt_roots())
    except OSError:
        return False


def _resolve_obsidian_local_dir(obsidian: dict) -> Optional[Path]:
    """兼容"Vault 根目录 + 相对目录"以及直接填写 Windows 提示词目录。"""
    folder_raw = str(obsidian.get("prompts_folder") or "").strip()
    vault_raw = str(obsidian.get("vault_path") or "").strip()
    if folder_raw:
        folder_path = Path(folder_raw).expanduser()
        if folder_path.is_absolute() and folder_path.is_dir() and _is_allowed_prompt_path(folder_path):
            return folder_path.resolve()
    if vault_raw:
        vault_path = Path(vault_raw).expanduser()
        if vault_path.is_dir() and _is_allowed_prompt_path(vault_path):
            if folder_raw and not Path(folder_raw).is_absolute():
                candidate = vault_path / Path(folder_raw.replace("/", os.sep))
                if candidate.is_dir():
                    return candidate.resolve()
            return vault_path.resolve()
    return None


def _load_obsidian_local_templates(obsidian: dict) -> List[Dict]:
    directory = _resolve_obsidian_local_dir(obsidian)
    if not directory:
        return []
    templates = []
    for file_path in directory.glob("**/*"):
        if not file_path.is_file() or file_path.suffix.lower() not in {".md", ".markdown", ".json"}:
            continue
        try:
            if file_path.suffix.lower() == ".json":
                data = json.loads(file_path.read_text(encoding="utf-8"))
                entries = data if isinstance(data, list) else [data]
                for entry in entries:
                    if isinstance(entry, dict):
                        item = dict(entry)
                        item["source"] = "obsidian"
                        item["file_path"] = str(file_path)
                        templates.append(item)
            else:
                items = parse_markdown_templates(
                    file_path.read_text(encoding="utf-8"), str(file_path), source="obsidian"
                )
                for item in items:
                    item["source"] = "obsidian"
                    item["file_path"] = str(file_path)
                    templates.append(item)
        except Exception as error:
            logger.warning(f"读取 Obsidian 本地模板失败 ({file_path}): {error}")
    return templates


def _obsidian_api_candidates(api_url: str) -> List[str]:
    raw = str(api_url or "").strip().rstrip("/")
    if not raw:
        return []
    parsed = urlparse(raw if "://" in raw else "https://" + raw)
    allowed_hosts = {"127.0.0.1", "localhost", "::1"}
    allowed_hosts.update(filter(None, os.environ.get("EAGLE_OBSIDIAN_HOSTS", "").lower().split(",")))
    if (parsed.hostname or "").lower() not in allowed_hosts or parsed.username or parsed.password:
        return []
    candidates = [urlunparse(parsed).rstrip("/")]
    if (parsed.hostname or "").lower() in {"127.0.0.1", "localhost", "::1"}:
        alternate = parsed._replace(scheme="https" if parsed.scheme == "http" else "http")
        alt_url = urlunparse(alternate).rstrip("/")
        if alt_url not in candidates:
            candidates.append(alt_url)
    return candidates


async def load_obsidian_templates(config: dict) -> List[Dict]:
    """从 Obsidian Vault 加载模板"""
    if not config['obsidian']['enabled']:
        return []

    obsidian = config['obsidian']
    local_templates = _load_obsidian_local_templates(obsidian)
    if local_templates:
        return local_templates

    templates = []
    api_key = obsidian.get('api_key', '')
    folder = str(obsidian.get('prompts_folder') or '').strip().strip('/\\')
    if not folder or Path(folder).is_absolute():
        logger.warning("Obsidian API 模式需要填写 Vault 内相对目录，不能填写 Windows 绝对路径")
        return []

    headers = {}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'

    try:
        timeout = aiohttp.ClientTimeout(total=6)
        async with aiohttp.ClientSession() as session:
            for api_url in _obsidian_api_candidates(obsidian.get('api_url', '')):
                try:
                    async with session.get(
                        f"{api_url}/vault/{quote(folder, safe='/')}/",
                        headers=headers, timeout=timeout
                    ) as resp:
                        if resp.status != 200:
                            logger.warning(f"Obsidian API {api_url} 返回 HTTP {resp.status}")
                            continue
                        files = await resp.json()
                    for file_name in files.get('files', []):
                        if not str(file_name).lower().endswith(('.md', '.markdown')):
                            continue
                        file_path = f"{folder}/{file_name}".strip('/')
                        async with session.get(
                            f"{api_url}/vault/{quote(file_path, safe='/')}",
                            headers=headers, timeout=timeout
                        ) as file_resp:
                            if file_resp.status == 200:
                                parsed = parse_markdown_templates(
                                    await file_resp.text(), file_path, source='obsidian'
                                )
                                for template in parsed:
                                    template['source'] = 'obsidian'
                                    template['file_path'] = file_path
                                    templates.append(template)
                    return templates
                except aiohttp.ClientError as error:
                    logger.warning(f"连接 Obsidian {api_url} 失败: {error}")

    except aiohttp.ClientError as e:
        logger.error(f"连接 Obsidian 失败: {e}")
    except Exception as e:
        logger.error(f"加载 Obsidian 模板失败: {e}")

    return templates


def merge_templates(built_in: dict, local: List[Dict], obsidian: List[Dict]) -> dict:
    """合并所有来源的模板"""
    result = {}

    for category, items in built_in.items():
        result[category] = []
        for index, item in enumerate(items):
            stable_key = f"{category}:{item.get('Label', '')}:{index}"
            result[category].append({
                **item,
                'source': 'built-in',
                'category': category,
                'id': 'builtin-' + uuid.uuid5(uuid.NAMESPACE_URL, stable_key).hex,
            })

    seen_ids = set()
    for template in local + obsidian:
        category = template.get('category', '自定义')
        if category not in result:
            result[category] = []
        normalized = dict(template)
        normalized['category'] = category
        normalized['source'] = normalized.get('source') or 'user'
        if not normalized.get('id'):
            raw_key = f"{normalized.get('file_path', '')}:{normalized.get('Label', '')}:{normalized.get('Instruction', '')}"
            normalized['id'] = 'local-' + uuid.uuid5(uuid.NAMESPACE_URL, raw_key).hex
        if normalized['id'] in seen_ids:
            continue
        seen_ids.add(normalized['id'])
        result[category].append(normalized)

    return result


# ─────────────────────────────────────────────────────────
# 路由
# ─────────────────────────────────────────────────────────

@route("GET", "/eaglePromptPresets/search_template")
async def search_template(request):
    """返回合并后的模板集合；筛选与搜索由前端本地完成。"""
    try:
        keyword = request.query.get("keyword", "").strip()
        category = request.query.get("category", "")

        config = load_config()
        local_templates = load_local_templates(config['local_paths'])
        obsidian_templates = await load_obsidian_templates(config)
        all_templates = merge_templates(PROMPT_TEMPLATES, local_templates, obsidian_templates)
        categories = list(all_templates.keys())

        if category and category in all_templates:
            items = all_templates[category]
        else:
            items = []
            for cat_items in all_templates.values():
                items.extend(cat_items)

        if keyword:
            kw = keyword.lower()
            items = [
                d for d in items
                if kw in d.get('Label', '').lower()
                or kw in d.get('Instruction', '').lower()
                or kw in d.get('example', '').lower()
            ]

        total = len(items)

        return web.json_response({
            "success": True,
            "data": {
                "list_data": items,
                "total_count": total,
                "categories": categories,
            }
        })

    except Exception as e:
        logger.error(f"search_template 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eaglePromptPresets/save_template")
async def save_template(request):
    """保存模板"""
    try:
        body = await request.json()
        template = body.get("template")
        save_format = body.get("format", "json")

        if not template:
            return web.json_response({"success": False, "error": "缺少模板数据"}, status=400)

        if not template.get("id"):
            template["id"] = str(uuid.uuid4())

        if template.get("source") in {"built-in", "obsidian"}:
            template["id"] = str(uuid.uuid4())
        template["source"] = "user"

        template["created_at"] = template.get("created_at", datetime.now().isoformat())
        template["updated_at"] = datetime.now().isoformat()

        if save_format == "markdown":
            label = str(template.get("Label") or "template").strip()
            safe_label = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', '_', label)
            safe_label = safe_label.strip(" ._")[:80] or "template"
            filename = f"{safe_label.replace(' ', '_')}_{template['id'][:8]}.md"
            file_path = (USER_TEMPLATES_DIR / filename).resolve()
            if USER_TEMPLATES_DIR.resolve() not in file_path.parents:
                return web.json_response(
                    {"success": False, "error": "模板文件名无效"}, status=400
                )

            _atomic_write_text(file_path, template_to_markdown(template))

            template['file_path'] = str(file_path)

        else:
            templates = []
            if USER_TEMPLATES_FILE.exists():
                with open(USER_TEMPLATES_FILE, 'r', encoding='utf-8') as f:
                    templates = json.load(f)

            found = False
            for i, t in enumerate(templates):
                if t.get("id") == template["id"]:
                    templates[i] = template
                    found = True
                    break

            if not found:
                templates.append(template)

            _atomic_write_json(USER_TEMPLATES_FILE, templates)

        return web.json_response({"success": True, "data": template})

    except Exception as e:
        logger.error(f"save_template 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("DELETE", "/eaglePromptPresets/delete_template")
async def delete_template(request):
    """删除模板"""
    try:
        template_id = request.query.get("id")

        deleted = False
        if USER_TEMPLATES_FILE.exists():
            with open(USER_TEMPLATES_FILE, 'r', encoding='utf-8') as f:
                templates = json.load(f)

            original_count = len(templates)
            templates = [t for t in templates if t.get("id") != template_id]

            if len(templates) < original_count:
                _atomic_write_json(USER_TEMPLATES_FILE, templates)
                deleted = True

        if deleted:
            return web.json_response({"success": True})
        else:
            return web.json_response({"success": False, "error": "模板未找到"}, status=404)

    except Exception as e:
        logger.error(f"delete_template 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eaglePromptPresets/import_file")
async def import_file(request):
    """导入模板文件"""
    try:
        reader = await request.multipart()
        field = await reader.next()

        if not field:
            return web.json_response({"success": False, "error": "没有文件"}, status=400)

        content = await field.read(decode=False)
        if len(content) > 4 * 1024 * 1024:
            return web.json_response({"success": False, "error": "导入文件不能超过 4 MiB"}, status=413)
        file_ext = field.filename.split('.')[-1].lower()

        templates = []

        if file_ext == 'json':
            data = json.loads(content.decode('utf-8'))
            if isinstance(data, list):
                templates = data
            elif isinstance(data, dict):
                templates = [data]

        elif file_ext in ['md', 'markdown']:
            content_str = content.decode('utf-8')
            templates = parse_markdown_templates(content_str, field.filename, source='user')

        elif file_ext == 'txt':
            lines = content.decode('utf-8').strip().split('\n')
            for line in lines:
                if line.strip():
                    templates.append({
                        "Label": line.strip()[:50],
                        "Instruction": line.strip(),
                        "example": "",
                        "source": "imported"
                    })

        existing = []
        if USER_TEMPLATES_FILE.exists():
            with open(USER_TEMPLATES_FILE, 'r', encoding='utf-8') as f:
                existing = json.load(f)

        for t in templates:
            if not t.get("id"):
                t["id"] = str(uuid.uuid4())
            t["created_at"] = datetime.now().isoformat()
            # 导入内容保存为用户模板副本，因此可独立编辑和删除，不反向改写源文档。
            t["source"] = "user"
            t.pop("file_path", None)
            t.pop("section_index", None)

        existing.extend(templates)

        _atomic_write_json(USER_TEMPLATES_FILE, existing)

        return web.json_response({"success": True, "imported_count": len(templates)})

    except Exception as e:
        logger.error(f"import_file 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("GET", "/eaglePromptPresets/config")
async def get_config(request):
    """获取配置"""
    try:
        config = load_config()
        safe_config = copy.deepcopy(config)
        if safe_config['obsidian']['api_key']:
            safe_config['obsidian']['api_key'] = '***'

        return web.json_response({"success": True, "data": safe_config})
    except Exception as e:
        logger.error(f"get_config 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eaglePromptPresets/config")
async def update_config(request):
    """更新配置"""
    try:
        body, request_error = await _read_json_request(request, "保存设置")
        if request_error:
            logger.warning(request_error)
            return web.json_response({"success": False, "error": request_error}, status=400)

        # 兼容当前 {config: {...}} 与旧版直接发送配置对象两种格式。
        new_config = body.get("config") if "config" in body else body

        current_config = load_config()
        if not isinstance(new_config, dict):
            return web.json_response({"success": False, "error": "配置结构无效"}, status=400)

        # 旧版面板可能只提交部分字段；与当前配置深度合并，避免清空新增设置。
        merged_config = copy.deepcopy(current_config)
        merged_config.update({
            key: value for key, value in new_config.items()
            if key not in {"obsidian", "director_skills"}
        })
        for section in ("obsidian", "director_skills"):
            incoming = new_config.get(section)
            if incoming is not None and not isinstance(incoming, dict):
                return web.json_response({"success": False, "error": f"配置项 {section} 结构无效"}, status=400)
            if isinstance(incoming, dict):
                merged_config.setdefault(section, {}).update(incoming)
        if merged_config['obsidian'].get('api_key') == '***':
            merged_config['obsidian']['api_key'] = current_config['obsidian']['api_key']

        save_config(merged_config)

        safe_config = copy.deepcopy(merged_config)
        if safe_config.get("obsidian", {}).get("api_key"):
            safe_config["obsidian"]["api_key"] = "***"
        return web.json_response({"success": True, "data": safe_config})
    except Exception as e:
        logger.error(f"update_config 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eaglePromptPresets/test_obsidian")
async def test_obsidian(request):
    """测试 Obsidian 连接"""
    try:
        body = await request.json()
        obsidian = {
            "api_url": body.get("api_url", ""),
            "api_key": body.get("api_key", ""),
            "vault_path": body.get("vault_path", ""),
            "prompts_folder": body.get("prompts_folder", ""),
        }
        local_dir = _resolve_obsidian_local_dir(obsidian)
        if local_dir:
            count = sum(1 for item in local_dir.glob("**/*") if item.is_file() and item.suffix.lower() in {'.md', '.markdown', '.json'})
            return web.json_response({
                "success": True,
                "mode": "local",
                "message": f"本地目录可读：{local_dir}（{count} 个模板文件）",
            })

        api_key = obsidian["api_key"]

        headers = {}
        if api_key and api_key != '***':
            headers['Authorization'] = f'Bearer {api_key}'

        attempts = []
        timeout = aiohttp.ClientTimeout(total=4)
        async with aiohttp.ClientSession() as session:
            for api_url in _obsidian_api_candidates(obsidian["api_url"]):
                try:
                    async with session.get(f"{api_url}/", headers=headers, timeout=timeout) as resp:
                        body_preview = (await resp.text())[:120].replace("\n", " ")
                        attempts.append(f"{api_url} → HTTP {resp.status}")
                        if 200 <= resp.status < 300:
                            return web.json_response({
                                "success": True,
                                "mode": "api",
                                "api_url": api_url,
                                "message": f"Local REST API 连接成功：{api_url}",
                            })
                        if resp.status in {401, 403}:
                            return web.json_response({
                                "success": False,
                                "error": f"API 已响应但鉴权失败（HTTP {resp.status}），请检查 API Key",
                                "attempts": attempts,
                            })
                        if body_preview:
                            attempts[-1] += f" · {body_preview}"
                except Exception as error:
                    attempts.append(f"{api_url} → {type(error).__name__}: {error}")
        return web.json_response({
            "success": False,
            "error": "；".join(attempts) or "没有可测试的 API 地址",
            "hint": "27124 常用于 HTTPS。也可填写本地 Vault/提示词目录，绕过 REST API。",
        })

    except aiohttp.ClientError as e:
        return web.json_response({"success": False, "error": f"连接失败: {str(e)}"})
    except Exception as e:
        logger.error(f"test_obsidian 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


def _allowed_cover_path(raw_path: str) -> Optional[Path]:
    try:
        raw_candidate = Path(str(raw_path or "")).expanduser()
        candidates = (
            [raw_candidate.resolve()]
            if raw_candidate.is_absolute()
            else [(BASE_DIR / raw_candidate).resolve(), (SKILL_DIR / raw_candidate).resolve()]
        )
        config = load_config()
        roots = [BASE_DIR.resolve(), SKILL_DIR.resolve()]
        for raw_root in config.get("local_paths", []):
            root = Path(str(raw_root)).expanduser()
            if root.is_dir():
                roots.append(root.resolve())
        
        obsidian_root = _resolve_obsidian_local_dir(config.get("obsidian", {}))
        if obsidian_root:
            roots.append(obsidian_root)

        for candidate in candidates:
            if candidate.is_symlink():
                candidate = candidate.readlink().resolve()
            if candidate.is_file() and any(candidate == root or root in candidate.parents for root in roots):
                return candidate
    except Exception:
        pass
    return None


@route("POST", "/eaglePromptPresets/upload_cover")
async def upload_template_cover(request):
    """上传模板封面"""
    try:
        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "file":
            return web.json_response({"success": False, "error": "缺少封面文件"}, status=400)
        content = await field.read(decode=False)
        if not content:
            return web.json_response({"success": False, "error": "封面文件为空"}, status=400)
        if len(content) > 8 * 1024 * 1024:
            return web.json_response({"success": False, "error": "封面不能超过 8 MB"}, status=413)

        image = Image.open(io.BytesIO(content))
        image.verify()
        image_format = str(image.format or "").upper()
        extensions = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "GIF": ".gif"}
        extension = extensions.get(image_format)
        if not extension:
            return web.json_response({"success": False, "error": f"不支持的封面格式: {image_format or 'unknown'}"}, status=415)

        filename = f"cover_{uuid.uuid4().hex}{extension}"
        destination = COVERS_DIR / filename
        destination.write_bytes(content)
        relative_path = destination.relative_to(BASE_DIR).as_posix()
        return web.json_response({"success": True, "path": relative_path})
    except Exception as error:
        logger.error(f"upload_template_cover 错误: {error}")
        return web.json_response({"success": False, "error": str(error)}, status=400)


@route("GET", "/eaglePromptPresets/cover")
async def get_template_cover(request):
    """获取模板封面"""
    path = _allowed_cover_path(request.query.get("path", ""))
    if not path:
        return web.Response(status=404, text="cover not found or outside configured template paths")
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if not content_type.startswith("image/"):
        return web.Response(status=415, text="cover must be an image")
    return web.FileResponse(path, headers={"Cache-Control": "public, max-age=3600"})


@route("POST", "/eaglePromptPresets/export")
async def export_templates(request):
    """导出模板"""
    try:
        body = await request.json()
        template_ids = body.get("template_ids", [])
        export_format = body.get("format", "json")

        config = load_config()
        local_templates = load_local_templates(config['local_paths'])

        if template_ids:
            templates = [t for t in local_templates if t.get('id') in template_ids]
        else:
            templates = local_templates

        if export_format == "markdown":
            content = "\n\n---\n\n".join([template_to_markdown(t) for t in templates])
            return web.Response(
                text=content,
                content_type="text/markdown",
                headers={"Content-Disposition": f'attachment; filename="prompts_export.md"'}
            )

        elif export_format == "txt":
            lines = [t.get('Instruction', '') for t in templates]
            content = "\n".join(lines)
            return web.Response(
                text=content,
                content_type="text/plain",
                headers={"Content-Disposition": f'attachment; filename="prompts_export.txt"'}
            )

        else:
            content = json.dumps(templates, ensure_ascii=False, indent=2)
            return web.Response(
                text=content,
                content_type="application/json",
                headers={"Content-Disposition": f'attachment; filename="prompts_export.json"'}
            )

    except Exception as e:
        logger.error(f"export_templates 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ─────────────────────────────────────────────────────────
# 导演技能管理
# ─────────────────────────────────────────────────────────

# 导演技能、素材胶片与 Markdown 用户模板统一归档在 eagle_suite/skills 下。
DIRECTOR_SKILLS_DEFAULT_DIR = SKILL_DIR
DIRECTOR_SKILLS_DEFAULT_DIR.mkdir(parents=True, exist_ok=True)
DIRECTOR_SKILLS_FILE = DIRECTOR_SKILLS_DEFAULT_DIR / "director_skills.json"
FILMSTRIP_DIR = DIRECTOR_SKILLS_DEFAULT_DIR / "filmstrip"
FILMSTRIP_DIR.mkdir(exist_ok=True)

# 旧 prompts 路径仅作为一次性兼容迁移来源，不再作为运行时存储。
LEGACY_PROMPTS_SKILLS_DIR = BASE_DIR / "director_skills"
LEGACY_PROMPTS_SKILLS_FILE = LEGACY_PROMPTS_SKILLS_DIR / "skills.json"
LEGACY_PROMPTS_USER_TEMPLATES_DIR = BASE_DIR / "user_templates"
LEGACY_DIRECTOR_SKILLS_FILE = BASE_DIR / "director_skills.json"
LEGACY_FILMSTRIP_DIRS = [
    LEGACY_SINGULAR_SKILL_DIR / "filmstrip",
    LEGACY_PROMPTS_SKILLS_DIR / "filmstrip",
    BASE_DIR / "filmstrip",
]


def _director_skill_source(config: Optional[dict] = None) -> str:
    value = str(((config or load_config()).get("director_skills") or {}).get("source") or "eagle").lower()
    return value if value in {"eagle", "obsidian", "custom"} else "eagle"


def resolve_director_skills_file(config: Optional[dict] = None):
    """解析用户选择的 JSON 技能源；未设置时始终使用 Eagle 节点技能库。"""
    cfg = config or load_config()
    if _director_skill_source(cfg) == "custom":
        raw = str((cfg.get("director_skills") or {}).get("custom_path") or "").strip()
        if raw:
            target = Path(raw).expanduser()
            if target.suffix.lower() != ".json":
                target = target / "director_skills.json"
            target = target.resolve()
            target.parent.mkdir(parents=True, exist_ok=True)
            return target
    DIRECTOR_SKILLS_DEFAULT_DIR.mkdir(parents=True, exist_ok=True)
    return DIRECTOR_SKILLS_FILE


def director_skill_storage_status(config: Optional[dict] = None) -> Dict:
    """返回技能库真实读写位置；配置无效时明确说明为何回退到 Eagle。"""
    cfg = config or load_config()
    configured = _director_skill_source(cfg)
    effective = configured
    fallback_reason = ""

    if configured == "obsidian":
        target = _director_obsidian_file(cfg)
        if target is None:
            effective = "eagle"
            target = DIRECTOR_SKILLS_FILE
            fallback_reason = "Obsidian Vault 路径为空、无效或技能目录越界"
    elif configured == "custom":
        raw = str((cfg.get("director_skills") or {}).get("custom_path") or "").strip()
        if not raw:
            effective = "eagle"
            target = DIRECTOR_SKILLS_FILE
            fallback_reason = "自定义技能库路径为空"
        else:
            target = resolve_director_skills_file(cfg)
    else:
        target = DIRECTOR_SKILLS_FILE

    target = Path(target).expanduser().resolve()
    parent = target.parent
    try:
        parent.mkdir(parents=True, exist_ok=True)
        writable = os.access(str(parent), os.W_OK)
    except OSError:
        writable = False
    return {
        "source": configured,
        "configured_source": configured,
        "effective_source": effective,
        "storage_path": str(target),
        "storage_exists": target.is_file(),
        "storage_writable": bool(writable),
        "fallback_reason": fallback_reason,
    }


def _load_skill_json(path: Path) -> Dict:
    if not path or not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return {str(item.get("id") or uuid.uuid4()): item for item in data if isinstance(item, dict)}
        return data if isinstance(data, dict) else {}
    except Exception as error:
        logger.warning(f"读取导演技能文件失败 ({path}): {error}")
        return {}


def _legacy_director_skill_files(config: Optional[dict] = None) -> List[Path]:
    cfg = config or load_config()
    candidates = [
        LEGACY_SINGULAR_SKILL_DIR / "director_skills.json",
        LEGACY_PROMPTS_SKILLS_FILE,
        LEGACY_PROMPTS_USER_TEMPLATES_DIR / "EagleSuite" / "director_skills.json",
        LEGACY_DIRECTOR_SKILLS_FILE,
    ]
    for raw in (cfg.get("local_paths") or []):
        value = str(raw or "").strip()
        if value:
            candidates.append(Path(value).expanduser() / "EagleSuite" / "director_skills.json")
    unique = []
    seen = set()
    for item in candidates:
        key = str(item.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def _director_skill_updated_at(skill: Dict) -> float:
    raw = str((skill or {}).get("updated_at") or (skill or {}).get("created_at") or "").strip()
    if not raw:
        return 0.0
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        pass
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).timestamp()
        except (TypeError, ValueError):
            continue
    return 0.0


def _merge_director_skill_sources(sources: List[Dict]) -> Dict:
    """按技能名称去重并保留最新版，同时合并同名条目的素材引用。"""
    selected = {}
    order = []
    for source in sources:
        for skill_id, raw_skill in (source or {}).items():
            if not isinstance(raw_skill, dict):
                continue
            skill = copy.deepcopy(raw_skill)
            skill_id = str(skill.get("id") or skill_id or uuid.uuid4())
            skill["id"] = skill_id
            name = str(skill.get("name") or "").strip().casefold()
            key = f"name:{name}" if name else f"id:{skill_id}"
            current = selected.get(key)
            if current is None:
                order.append(key)
                selected[key] = (skill_id, skill)
                continue

            current_id, current_skill = current
            merged_filmstrip = list(dict.fromkeys(
                list(current_skill.get("filmstrip") or []) + list(skill.get("filmstrip") or [])
            ))
            if _director_skill_updated_at(skill) > _director_skill_updated_at(current_skill):
                skill["filmstrip"] = merged_filmstrip
                selected[key] = (skill_id, skill)
            else:
                current_skill["filmstrip"] = merged_filmstrip
                selected[key] = (current_id, current_skill)
    return {selected[key][0]: selected[key][1] for key in order}


def load_director_skills() -> Dict:
    """加载所有导演技能"""
    config = load_config()
    if _director_skill_source(config) == "obsidian":
        markdown_file = _director_obsidian_file(config)
        if markdown_file and markdown_file.is_file():
            incoming = _director_skills_from_markdown(markdown_file.read_text(encoding="utf-8"))
            if incoming:
                eagle = _load_skill_json(DIRECTOR_SKILLS_FILE)
                for skill_id, skill in incoming.items():
                    if eagle.get(skill_id, {}).get("filmstrip"):
                        skill["filmstrip"] = list(eagle[skill_id].get("filmstrip") or [])
                return incoming
    return _load_skill_json(resolve_director_skills_file(config))


def save_director_skills(skills: Dict):
    """保存导演技能"""
    try:
        config = load_config()
        if _director_skill_source(config) == "obsidian":
            markdown_file = _director_obsidian_file(config)
            if markdown_file:
                markdown_file.parent.mkdir(parents=True, exist_ok=True)
                markdown_file.write_text(_director_skills_to_markdown(skills), encoding="utf-8")
                return
        path = resolve_director_skills_file(config)
        path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(Path(path), skills)
    except Exception as e:
        logger.error(f"保存导演技能失败: {e}")
        raise


def _director_obsidian_file(config: dict) -> Optional[Path]:
    """Resolve the local Obsidian Markdown library used by Director Skills."""
    obsidian = (config or {}).get("obsidian") or {}
    vault_raw = str(obsidian.get("vault_path") or "").strip()
    if not vault_raw:
        return None
    vault = Path(vault_raw).expanduser().resolve()
    if not vault.is_dir():
        return None
    folder = str(obsidian.get("director_skills_folder") or "ComfyUI/DirectorSkills").strip().strip("/\\")
    filename = Path(str(obsidian.get("director_skills_file") or "Eagle Director Skills.md")).name
    target_dir = (vault / folder).resolve() if folder else vault
    if target_dir != vault and vault not in target_dir.parents:
        return None
    return target_dir / filename


def _director_skills_to_markdown(skills: Dict) -> str:
    """Store many skills in one Obsidian-friendly Markdown document."""
    blocks = [
        "---",
        "eagle_type: director_skill_library",
        "version: 1",
        f"updated_at: {datetime.now().isoformat()}",
        "---",
        "",
        "# Eagle Director Skills",
        "",
        "> 此文件由 ComfyUI Eagle Suite 管理；每个 skill 区块都可以在 Obsidian 中直接编辑。",
        "",
    ]
    for skill in skills.values():
        metadata = {
            "id": str(skill.get("id") or uuid.uuid4()),
            "name": str(skill.get("name") or "未命名技能"),
            "category": str(skill.get("category") or "custom"),
            "tasks": list(skill.get("tasks") or []),
            "tags": list(skill.get("tags") or []),
        }
        blocks.extend([
            "<!-- eagle-skill:start -->",
            "```eagle-skill-meta",
            json.dumps(metadata, ensure_ascii=False),
            "```",
            "",
            str(skill.get("content") or "").strip(),
            "",
            "<!-- eagle-skill:end -->",
            "",
        ])
    return "\n".join(blocks).rstrip() + "\n"


def _director_skills_from_markdown(text: str) -> Dict:
    """Read skill blocks written by _director_skills_to_markdown."""
    result = {}
    pattern = re.compile(
        r"<!--\s*eagle-skill:start\s*-->\s*"
        r"```eagle-skill-meta\s*\r?\n(.*?)\r?\n```\s*"
        r"(.*?)\s*<!--\s*eagle-skill:end\s*-->",
        re.DOTALL | re.IGNORECASE,
    )
    for meta_raw, content in pattern.findall(str(text or "")):
        try:
            metadata = json.loads(meta_raw.strip())
        except Exception:
            continue
        skill_id = str(metadata.get("id") or uuid.uuid4())
        result[skill_id] = {
            "id": skill_id,
            "name": str(metadata.get("name") or "未命名技能"),
            "category": str(metadata.get("category") or "custom"),
            "tasks": list(metadata.get("tasks") or []),
            "tags": list(metadata.get("tags") or []),
            "content": content.strip(),
            "filmstrip": [],
            "updated_at": datetime.now().isoformat(),
        }
    return result


def _ensure_default_skill():
    """首次使用时创建一个默认导演技能，避免空库报错。"""
    default_skill = {
        "id": str(uuid.uuid4()),
        "name": "默认导演技能 / Default Director Skill",
        "content": (
            "# 导演技能模板\n\n"
            "## 世界观与风格\n\n"
            "- 视觉基调：cinematic, high detail\n"
            "- 运镜偏好：stable camera, medium shot\n"
            "- 声音氛围：immersive ambient\n\n"
            "## 使用方式\n\n"
            "在此编辑可复用的导演上下文，连接到 H3 导演台的 `director_skill` 端口即可注入生成。"
        ),
        "filmstrip": [],
        "updated_at": datetime.now().isoformat(),
        "created_at": datetime.now().isoformat(),
    }
    save_director_skills({default_skill["id"]: default_skill})


def _ensure_professional_director_pack():
    """Seed a composable director pack once, without overwriting user skills."""
    skills = load_director_skills()
    if any(str(skill_id).startswith("pro-v1-") for skill_id in skills):
        return

    now = datetime.now().isoformat()
    pack = [
        {
            "id": "pro-v1-story-architecture",
            "name": "故事节拍与场面调度",
            "category": "narrative",
            "tasks": ["script", "shots", "dialogue"],
            "tags": ["beat", "blocking", "continuity", "setup-payoff"],
            "content": """# 故事节拍与场面调度

## 目标
- 每场必须有明确的欲望、阻力、转折和新的局面，避免镜头只做画面罗列。
- 用动作和空间关系表达人物权力变化；台词只承担画面无法表达的信息。
- 建立 setup → development → payoff，结尾保留动作、视线或声音钩子供下一场承接。

## 输出纪律
- 先确定场景的 dramatic question，再设计主镜头、覆盖镜头和反应镜头。
- 每次切镜必须回答：信息改变、情绪改变、视点改变或节奏改变。
- 保持人物轴线、屏幕方向、道具位置、服装和光线连续性。""",
        },
        {
            "id": "pro-v1-shot-language",
            "name": "景别、构图与视点语言",
            "category": "shot_language",
            "tasks": ["shots"],
            "tags": ["framing", "composition", "pov", "coverage"],
            "content": """# 景别、构图与视点语言

- Extreme wide / wide：建立地理、规模、孤独或压迫；主体必须有清晰的空间关系。
- Full / medium：呈现行为、调度和人物关系；优先保证动作可读。
- Close-up / extreme close-up：只在信息或情绪达到临界点时使用，明确眼神、呼吸或关键物件。
- OTS、POV、two-shot、profile、insert、reaction shot 应服务视点和关系，不把景别当随机装饰。
- 写明主体位置、前中后景、焦点转移、镜头高度、俯仰角和画面方向；避免连续镜头无动机跳轴。""",
        },
        {
            "id": "pro-v1-camera-motion",
            "name": "专业运镜与镜头动机",
            "category": "camera_motion",
            "tasks": ["shots"],
            "tags": ["push", "pull", "pan", "tilt", "tracking", "orbit"],
            "content": """# 专业运镜与镜头动机

## 运动词典
- slow push-in：压缩注意力、逼近领悟或威胁；以人物反应为落点。
- pull-out / dolly-out：揭示处境、疏离或失去控制；结束时必须出现新空间信息。
- pan / tilt：跟随视线、揭示信息或连接两个主体；注明起点、触发点、终点。
- tracking / leading / trailing：伴随行动建立速度与空间；保持主体运动方向连续。
- orbit / arc：关系逆转、眩晕或英雄化；限制角度并给出前景参照，避免无意义环绕。
- crane / boom / drone：规模揭示或段落收束；说明升降速度和最终构图。
- handheld：只用于主观不稳、纪录感或冲突升级；注明震动幅度。
- rack focus / parallax：在同镜头内转移叙事权重。

## 约束
每个运动都写成：镜头装置 + 方向/路径 + 速度曲线 + 触发动作 + 结束构图 + 叙事目的。静止镜头也是主动选择。""",
        },
        {
            "id": "pro-v1-transitions",
            "name": "转场、连续性与叙事桥接",
            "category": "transition",
            "tasks": ["script", "shots"],
            "tags": ["match-cut", "j-cut", "l-cut", "whip-pan", "motif"],
            "content": """# 转场、连续性与叙事桥接

- cut on action：在动作峰值切换景别，前后动作姿态与方向匹配。
- eyeline / POV cut：先给视线，再给所见；反打保持轴线和视线高度。
- match cut：用形状、色彩、动作、构图或语义呼应连接时空。
- J-cut：下一场声音先入，制造期待或反讽；L-cut：上一场声音延续，保留情绪余波。
- whip-pan / foreground wipe：只在速度、方向和遮挡物可匹配时使用。
- dissolve / time-lapse / montage：表达时间、省略过程或记忆，不替代缺失的戏剧转折。
- hard cut / smash cut：用强烈反差制造笑点、惊吓或观点碰撞。

为每场结尾给出 `transition_out`，下一场给出 `transition_in`，二者须共享声音、动作、视线、色彩或图形中的至少一个桥接元素。""",
        },
        {
            "id": "pro-v1-rhythm",
            "name": "节奏、时长与蒙太奇",
            "category": "rhythm",
            "tasks": ["script", "shots"],
            "tags": ["pacing", "montage", "duration", "contrast"],
            "content": """# 节奏、时长与蒙太奇

- 镜头时长由信息读取时间和情绪停留时间决定；建立镜头较长，动作节点可缩短，关键反应需留余量。
- 用长短、动静、远近、明暗、响静形成节奏对比，避免所有镜头同速同长。
- 蒙太奇必须有清楚的组织原则：时间推进、空间并行、动作升级、视觉押韵或因果链。
- 高潮前减少解释并加速动作切分；高潮落点后保留一个反应或环境镜头让信息沉淀。
- H3 分镜必须给出可执行的 `estSeconds`，总时长与场景预算一致。""",
        },
        {
            "id": "pro-v1-sound-dialogue",
            "name": "台词、表演与声音叙事",
            "category": "performance_sound",
            "tasks": ["script", "dialogue", "shots"],
            "tags": ["dialogue", "performance", "soundscape", "j-cut", "l-cut"],
            "content": """# 台词、表演与声音叙事

- 台词要可表演、可呼吸、带潜台词；控制句长，避免角色说出已经看见的画面。
- 每句台词附带动作或反应语境，但不把情绪写成空泛形容词。
- 设计环境底噪、同步动作声、关键音效、画外声和非叙事音乐的层级。
- 用声音先行、声音延续、突然静默和声画对位承担转场及悬念。
- 对白场优先建立 master、双人、OTS、单人和反应镜头的覆盖关系，确保剪辑连续。""",
        },
    ]
    for item in pack:
        item["filmstrip"] = []
        item["created_at"] = now
        item["updated_at"] = now
        skills[item["id"]] = item
    save_director_skills(skills)


def _migrate_director_skills_storage():
    """把旧 Skill/prompts 技能与素材非覆盖迁移到 eagle_suite/skills。"""
    try:
        migrated = False
        current_skills = _load_skill_json(DIRECTOR_SKILLS_FILE)
        sources = [current_skills] + [
            _load_skill_json(path) for path in _legacy_director_skill_files() if path.is_file()
        ]
        merged_skills = _merge_director_skill_sources(sources)
        if merged_skills != current_skills or (merged_skills and not DIRECTOR_SKILLS_FILE.exists()):
            DIRECTOR_SKILLS_FILE.parent.mkdir(parents=True, exist_ok=True)
            DIRECTOR_SKILLS_FILE.write_text(
                json.dumps(merged_skills, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            logger.info(
                f"导演技能已统一迁移到 {DIRECTOR_SKILLS_FILE}，"
                f"合并前 {sum(len(source) for source in sources)} 项，去重后 {len(merged_skills)} 项"
            )
            migrated = True

        # 迁移素材胶片图片
        for legacy_filmstrip_dir in LEGACY_FILMSTRIP_DIRS:
            if not legacy_filmstrip_dir.exists() or not legacy_filmstrip_dir.is_dir():
                continue
            moved_images = 0
            for img in legacy_filmstrip_dir.iterdir():
                if img.is_file():
                    target = FILMSTRIP_DIR / img.name
                    if not target.exists():
                        shutil.copy2(str(img), str(target))
                        moved_images += 1
            if moved_images:
                logger.info(
                    f"已迁移 {moved_images} 张素材胶片: {legacy_filmstrip_dir} -> {FILMSTRIP_DIR}"
                )
                migrated = True

        # 新库为空时自动创建默认技能，保证首次加载有内容。
        if not resolve_director_skills_file().exists():
            _ensure_default_skill()
            migrated = True

        _ensure_professional_director_pack()

        if migrated:
            logger.info("导演技能库初始化/迁移完成")
    except Exception as e:
        logger.error(f"导演技能库迁移失败: {e}")


# 模块加载时执行一次性迁移与初始化
_migrate_director_skills_storage()


@route("GET", "/eaglePromptPresets/director_skills")
async def get_director_skills(request):
    """获取所有导演技能"""
    try:
        skills = load_director_skills()
        config = load_config()
        storage = director_skill_storage_status(config)
        return web.json_response({
            "success": True,
            "data": list(skills.values()),
            **storage,
        })
    except Exception as e:
        logger.error(f"get_director_skills 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eaglePromptPresets/director_skills")
async def save_director_skill(request):
    """保存单个导演技能"""
    try:
        body, request_error = await _read_json_request(request, "保存导演技能")
        if request_error:
            logger.warning(request_error)
            return web.json_response({"success": False, "error": request_error}, status=400)

        # 兼容当前 {skill: {...}} 与旧版直接发送技能对象两种格式。
        skill = body.get("skill") if "skill" in body else body
        
        if not isinstance(skill, dict) or not str(skill.get("name") or "").strip():
            return web.json_response({"success": False, "error": "缺少技能名称"}, status=400)
        skill = copy.deepcopy(skill)
        skill["name"] = str(skill["name"]).strip()
        
        if not skill.get("id"):
            skill["id"] = str(uuid.uuid4())

        skill.setdefault("category", "custom")
        skill.setdefault("tasks", ["script", "shots", "dialogue"])
        skill.setdefault("tags", [])
        skill.setdefault("filmstrip", [])
        
        skill["updated_at"] = datetime.now().isoformat()
        
        skills = load_director_skills()
        skills[skill["id"]] = skill
        save_director_skills(skills)
        
        return web.json_response({
            "success": True,
            "data": skill,
            **director_skill_storage_status(),
        })
    except Exception as e:
        logger.error(f"save_director_skill 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eaglePromptPresets/director_skills/sync_obsidian")
async def sync_director_skills_obsidian(request):
    """Bidirectionally synchronize the director library with one Markdown file."""
    try:
        config = load_config()
        obsidian = config.get("obsidian") or {}
        if not obsidian.get("enabled"):
            return web.json_response({"success": False, "error": "请先在设置中启用 Obsidian 集成"}, status=400)
        markdown_file = _director_obsidian_file(config)
        if markdown_file is None:
            return web.json_response({"success": False, "error": "Vault 路径无效或不可访问"}, status=400)

        skills = load_director_skills()
        imported = 0
        if markdown_file.is_file():
            incoming = _director_skills_from_markdown(markdown_file.read_text(encoding="utf-8"))
            for skill_id, skill in incoming.items():
                current = skills.get(skill_id) or {}
                if current.get("filmstrip"):
                    skill["filmstrip"] = list(current.get("filmstrip") or [])
                skill.setdefault("created_at", current.get("created_at") or datetime.now().isoformat())
                skills[skill_id] = skill
                imported += 1

        save_director_skills(skills)
        markdown_file.parent.mkdir(parents=True, exist_ok=True)
        markdown_file.write_text(_director_skills_to_markdown(skills), encoding="utf-8")
        return web.json_response({
            "success": True,
            "count": len(skills),
            "imported": imported,
            "path": str(markdown_file),
            "message": f"已同步 {len(skills)} 个导演技能",
        })
    except Exception as e:
        logger.error(f"sync_director_skills_obsidian error: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eaglePromptPresets/director_skills/delete")
async def delete_director_skill(request):
    """删除导演技能"""
    try:
        body, request_error = await _read_json_request(request, "删除导演技能")
        if request_error:
            return web.json_response({"success": False, "error": request_error}, status=400)
        skill_id = str(body.get("id") or "")
        skills = load_director_skills()
        
        if skill_id in skills:
            del skills[skill_id]
            save_director_skills(skills)
            return web.json_response({"success": True})
        else:
            return web.json_response({"success": False, "error": "技能未找到"}, status=404)
    except Exception as e:
        logger.error(f"delete_director_skill 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eaglePromptPresets/upload_filmstrip")
async def upload_filmstrip_image(request):
    """上传素材胶片，并按设置的最大百万像素等比缩小。"""
    try:
        reader = await request.multipart()
        content = b""
        try:
            requested_megapixels = float((load_config().get("director_skills") or {}).get("filmstrip_megapixels") or 1.0)
        except (TypeError, ValueError):
            requested_megapixels = 1.0
        while True:
            field = await reader.next()
            if field is None:
                break
            if field.name == "file":
                content = await field.read(decode=False)
            elif field.name == "megapixels":
                try:
                    requested_megapixels = float((await field.text()).strip())
                except (TypeError, ValueError):
                    requested_megapixels = 1.0

        if not content:
            return web.json_response({"success": False, "error": "缺少图片文件"}, status=400)

        if len(content) > 10 * 1024 * 1024:
            return web.json_response({"success": False, "error": "图片不能超过 10 MB"}, status=413)

        requested_megapixels = min(10.0, max(1.0, requested_megapixels))
        image = Image.open(io.BytesIO(content))
        image_format = str(image.format or "").upper()
        image.load()
        animated = bool(getattr(image, "is_animated", False))
        if animated:
            image.seek(0)
            image_format = "PNG"
            image = image.convert("RGBA")
        image = ImageOps.exif_transpose(image)
        extensions = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "GIF": ".gif"}
        extension = extensions.get(image_format)

        if not extension:
            return web.json_response({"success": False, "error": f"不支持的图片格式: {image_format}"}, status=415)

        original_width, original_height = image.size
        target_pixels = requested_megapixels * 1_000_000.0
        current_pixels = float(original_width * original_height)
        resized = current_pixels > target_pixels
        if resized:
            scale = (target_pixels / current_pixels) ** 0.5
            width = max(1, int(round(original_width * scale)))
            height = max(1, int(round(original_height * scale)))
            image = image.resize((width, height), Image.Resampling.LANCZOS)

        filename = f"film_{uuid.uuid4().hex}{extension}"
        destination = FILMSTRIP_DIR / filename
        save_options = {}
        if image_format == "JPEG":
            if image.mode not in {"RGB", "L"}:
                image = image.convert("RGB")
            save_options = {"quality": 92, "optimize": True}
        elif image_format == "WEBP":
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            save_options = {"quality": 92, "method": 6}
        elif image_format == "PNG":
            save_options = {"optimize": True}
        image.save(destination, format=image_format, **save_options)

        width, height = image.size
        relative_path = destination.relative_to(SKILL_DIR).as_posix()
        return web.json_response({
            "success": True,
            "path": relative_path,
            "width": width,
            "height": height,
            "megapixels": round((width * height) / 1_000_000.0, 4),
            "requested_megapixels": requested_megapixels,
            "resized": resized,
            "original_width": original_width,
            "original_height": original_height,
        })
    except Exception as error:
        logger.error(f"upload_filmstrip_image 错误: {error}")
        return web.json_response({"success": False, "error": str(error)}, status=400)


@route("GET", "/eaglePromptPresets/filmstrip")
async def get_filmstrip_image(request):
    """获取素材胶片图片"""
    path = _allowed_cover_path(request.query.get("path", ""))
    if not path:
        return web.Response(status=404, text="filmstrip image not found")
    
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if not content_type.startswith("image/"):
        return web.Response(status=415, text="filmstrip must be an image")
    
    return web.FileResponse(path, headers={"Cache-Control": "public, max-age=3600"})


# ─────────────────────────────────────────────────────────
# 节点类
# ─────────────────────────────────────────────────────────

class EaglePromptPresets:
    """提示词预设模板（增强版）- 支持动态变量"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "输入提示词或通过前端选择模板\n支持 {{变量名}} 占位符"
                }),
            },
            "optional": {
                "variables": ("STRING", {
                    "forceInput": True,
                    "tooltip": "外部变量输入：JSON 对象或 key=value 格式"
                }),
                "director_skills_input": ("STRING", {
                    "forceInput": True,
                    "tooltip": "可选：Markdown 导演 Skills（连线输入）"
                }),
                "api_config": ("API_CONFIG", {
                    "forceInput": True,
                    "tooltip": "可选：来自 API 配置加载器的 api_config（用于 LLM 扩写）"
                }),
                "llm_config_secondary": ("API_CONFIG", {
                    "forceInput": True,
                    "tooltip": "可选：第二个 LLM 配置（备用 / 审核模型）"
                }),
                "template": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "模板字符串（前端自动填充）"
                }),
                "local_variables": ("STRING", {
                    "default": "{}",
                    "multiline": True,
                    "tooltip": "前端变量快照（JSON 格式）"
                }),
                "ui_state": ("STRING", {
                    "default": "{\"version\": 1}",
                    "multiline": True,
                    "tooltip": "前端界面状态（自动保存，请勿手动修改）"
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("prompt", "missing_vars", "director_skills", "api_config_out", "llm_config_secondary_out")
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/工具"

    @staticmethod
    def _normalize_variable_name(value) -> str:
        name = str(value or "").strip()
        wrapped = re.fullmatch(r"\{\{\s*(.*?)\s*\}\}", name)
        return (wrapped.group(1) if wrapped else name).strip()

    @staticmethod
    def _parse_variables(value) -> Dict[str, str]:
        text = str(value or "").strip()
        if not text:
            return {}

        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                result = {}
                for key, item_value in parsed.items():
                    name = EaglePromptPresets._normalize_variable_name(key)
                    if name:
                        result[name] = str(item_value)
                return result
        except:
            pass

        result = {}
        for raw_line in text.splitlines():
            line = raw_line.strip().rstrip(",")
            if not line or line.startswith("#"):
                continue
            match = re.match(r"^\s*([^:=：]+?)\s*(?:=|:|：)\s*(.*?)\s*$", line)
            if match:
                name = EaglePromptPresets._normalize_variable_name(match.group(1))
                if name:
                    result[name] = match.group(2).strip()
        return result

    def process(self, prompt="", variables="", director_skills_input="",
                api_config="", llm_config_secondary="",
                template="", local_variables="", ui_state="", **kwargs):
        final_template = (template or prompt or "").strip()

        template_vars = extract_template_variables(final_template)
        local_vars = self._parse_variables(local_variables)
        external_vars = self._parse_variables(variables)

        dynamic_vars = {}
        for var_name in template_vars:
            widget_name = f"var_{var_name}"
            if widget_name in kwargs:
                dynamic_vars[var_name] = str(kwargs[widget_name] or "")

        merged_vars = {**local_vars, **external_vars, **dynamic_vars}

        rendered = final_template
        for var_name in template_vars:
            pattern = r'\{\{\s*' + re.escape(var_name) + r'\s*\}\}'
            value = merged_vars.get(var_name, f"{{{{{var_name}}}}}")
            rendered = re.sub(pattern, value, rendered)

        missing = sorted(set(extract_template_variables(rendered)))
        final_director_skills = director_skills_input or ""

        return (rendered, ", ".join(missing), final_director_skills, api_config or "", llm_config_secondary or "")


# 注意：本文件仅作为 EaglePromptPresets 的实现模块，节点注册统一由
# eagle_suite/nodes.py 负责。此处不再导出 NODE_CLASS_MAPPINGS，
# 避免 ComfyUI 自动扫描 nodes/ 目录时造成重复注册。
# NODE_CLASS_MAPPINGS = {"EaglePromptPresets": EaglePromptPresets}
# NODE_DISPLAY_NAME_MAPPINGS = {"EaglePromptPresets": "🦅 提示词预设"}
