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
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional
from urllib.parse import quote, urlparse, urlunparse

import aiohttp
from aiohttp import web
from PIL import Image

from ..eagle_suite.logger import logger
from ..eagle_suite.route_registry import route

# ─────────────────────────────────────────────────────────
# 配置与路径
# ─────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent / "prompts"
BASE_DIR.mkdir(parents=True, exist_ok=True)

CONFIG_FILE = BASE_DIR / "config.json"
USER_TEMPLATES_FILE = BASE_DIR / "user_templates.json"
USER_TEMPLATES_DIR = BASE_DIR / "user_templates"
USER_TEMPLATES_DIR.mkdir(exist_ok=True)
COVERS_DIR = BASE_DIR / "covers"
COVERS_DIR.mkdir(exist_ok=True)

# 默认配置
DEFAULT_CONFIG = {
    "obsidian": {
        "enabled": False,
        "api_url": "https://127.0.0.1:27124",
        "api_key": "",
        "vault_path": "",
        "prompts_folder": "ComfyUI/Prompts"
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
                merged.update({key: value for key, value in stored.items() if key != "obsidian"})
                if isinstance(stored.get("obsidian"), dict):
                    merged["obsidian"].update(stored["obsidian"])
                return merged
        except Exception as e:
            logger.error(f"加载配置失败: {e}")
    return copy.deepcopy(DEFAULT_CONFIG)


def save_config(config: dict):
    """保存配置"""
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"保存配置失败: {e}")


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


def _resolve_obsidian_local_dir(obsidian: dict) -> Optional[Path]:
    """兼容"Vault 根目录 + 相对目录"以及直接填写 Windows 提示词目录。"""
    folder_raw = str(obsidian.get("prompts_folder") or "").strip()
    vault_raw = str(obsidian.get("vault_path") or "").strip()
    if folder_raw:
        folder_path = Path(folder_raw).expanduser()
        if folder_path.is_absolute() and folder_path.is_dir():
            return folder_path.resolve()
    if vault_raw:
        vault_path = Path(vault_raw).expanduser()
        if vault_path.is_dir():
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
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
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
            filename = f"{template['Label'].replace(' ', '_')}_{template['id'][:8]}.md"
            file_path = USER_TEMPLATES_DIR / filename

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(template_to_markdown(template))

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

            with open(USER_TEMPLATES_FILE, 'w', encoding='utf-8') as f:
                json.dump(templates, f, ensure_ascii=False, indent=2)

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
                with open(USER_TEMPLATES_FILE, 'w', encoding='utf-8') as f:
                    json.dump(templates, f, ensure_ascii=False, indent=2)
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

        content = await field.read()
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

        with open(USER_TEMPLATES_FILE, 'w', encoding='utf-8') as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)

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
        body = await request.json()
        new_config = body.get("config")

        current_config = load_config()
        if not isinstance(new_config, dict) or not isinstance(new_config.get('obsidian'), dict):
            return web.json_response({"success": False, "error": "配置结构无效"}, status=400)
        if new_config['obsidian'].get('api_key') == '***':
            new_config['obsidian']['api_key'] = current_config['obsidian']['api_key']

        save_config(new_config)

        return web.json_response({"success": True, "data": new_config})
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
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
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
        candidate = (raw_candidate if raw_candidate.is_absolute() else BASE_DIR / raw_candidate).resolve()
        
        if candidate.is_symlink():
            candidate = candidate.readlink().resolve()
        
        config = load_config()
        roots = [BASE_DIR.resolve()]
        for raw_root in config.get("local_paths", []):
            root = Path(str(raw_root)).expanduser()
            if root.is_dir():
                roots.append(root.resolve())
        
        obsidian_root = _resolve_obsidian_local_dir(config.get("obsidian", {}))
        if obsidian_root:
            roots.append(obsidian_root)
        
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

# 导演技能库默认存放目录（插件内）
DIRECTOR_SKILLS_DEFAULT_DIR = BASE_DIR / "director_skills"
DIRECTOR_SKILLS_DEFAULT_DIR.mkdir(parents=True, exist_ok=True)
DIRECTOR_SKILLS_FILE = DIRECTOR_SKILLS_DEFAULT_DIR / "skills.json"
FILMSTRIP_DIR = DIRECTOR_SKILLS_DEFAULT_DIR / "filmstrip"
FILMSTRIP_DIR.mkdir(exist_ok=True)

#  (用于一次性迁移)
LEGACY_DIRECTOR_SKILLS_FILE = BASE_DIR / "director_skills.json"
LEGACY_FILMSTRIP_DIR = BASE_DIR / "filmstrip"


def resolve_director_skills_file():
    """技能库存储路径：优先使用配置中的用户本地目录，否则用插件默认目录。

    配置项 config.local_paths 中第一个真实存在的目录会被采用，并在其下创建
    EagleSuite/director_skills.json。这样用户可以把数据放在 NAS、网盘同步目录等位置。
    """
    cfg = load_config()
    for raw in (cfg.get("local_paths") or []):
        p = Path(str(raw).strip())
        if p and p.is_dir():
            target = p / "EagleSuite" / "director_skills.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            return target
    DIRECTOR_SKILLS_DEFAULT_DIR.mkdir(parents=True, exist_ok=True)
    return DIRECTOR_SKILLS_FILE


def load_director_skills() -> Dict:
    """加载所有导演技能"""
    path = resolve_director_skills_file()
    if not path.exists():
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"加载导演技能失败: {e}")
        return {}


def save_director_skills(skills: Dict):
    """保存导演技能"""
    path = resolve_director_skills_file()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(skills, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"保存导演技能失败: {e}")


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


def _migrate_director_skills_storage():
    """将旧路径的导演技能数据迁移到专用子目录（一次性，保留旧文件作备份）。"""
    try:
        migrated = False

        # 迁移 skills.json
        if LEGACY_DIRECTOR_SKILLS_FILE.exists() and not DIRECTOR_SKILLS_FILE.exists():
            shutil.copy2(str(LEGACY_DIRECTOR_SKILLS_FILE), str(DIRECTOR_SKILLS_FILE))
            logger.info(
                f"已迁移导演技能库: {LEGACY_DIRECTOR_SKILLS_FILE} -> {DIRECTOR_SKILLS_FILE}"
            )
            migrated = True

        # 迁移素材胶片图片
        if LEGACY_FILMSTRIP_DIR.exists() and LEGACY_FILMSTRIP_DIR.is_dir():
            moved_images = 0
            for img in LEGACY_FILMSTRIP_DIR.iterdir():
                if img.is_file():
                    target = FILMSTRIP_DIR / img.name
                    if not target.exists():
                        shutil.copy2(str(img), str(target))
                        moved_images += 1
            if moved_images:
                logger.info(
                    f"已迁移 {moved_images} 张素材胶片: {LEGACY_FILMSTRIP_DIR} -> {FILMSTRIP_DIR}"
                )
                migrated = True

        # 新库为空时自动创建默认技能，保证首次加载有内容
        if not resolve_director_skills_file().exists():
            _ensure_default_skill()
            migrated = True

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
        return web.json_response({
            "success": True,
            "data": list(skills.values()),
            "storage_path": str(resolve_director_skills_file())
        })
    except Exception as e:
        logger.error(f"get_director_skills 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/eaglePromptPresets/director_skills")
async def save_director_skill(request):
    """保存单个导演技能"""
    try:
        body = await request.json()
        skill = body.get("skill")
        
        if not skill or not skill.get("name"):
            return web.json_response({"success": False, "error": "缺少技能名称"}, status=400)
        
        if not skill.get("id"):
            skill["id"] = str(uuid.uuid4())
        
        skill["updated_at"] = datetime.now().isoformat()
        
        skills = load_director_skills()
        skills[skill["id"]] = skill
        save_director_skills(skills)
        
        return web.json_response({"success": True, "data": skill})
    except Exception as e:
        logger.error(f"save_director_skill 错误: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("DELETE", "/eaglePromptPresets/director_skills")
async def delete_director_skill(request):
    """删除导演技能"""
    try:
        skill_id = request.query.get("id")
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
    """上传素材胶片图片"""
    try:
        reader = await request.multipart()
        field = await reader.next()
        
        if field is None or field.name != "file":
            return web.json_response({"success": False, "error": "缺少图片文件"}, status=400)
        
        content = await field.read(decode=False)
        if not content:
            return web.json_response({"success": False, "error": "图片文件为空"}, status=400)
        
        if len(content) > 10 * 1024 * 1024:
            return web.json_response({"success": False, "error": "图片不能超过 10 MB"}, status=413)
        
        image = Image.open(io.BytesIO(content))
        image.verify()
        image_format = str(image.format or "").upper()
        extensions = {"PNG": ".png", "JPEG": ".jpg", "WEBP": ".webp", "GIF": ".gif"}
        extension = extensions.get(image_format)
        
        if not extension:
            return web.json_response({"success": False, "error": f"不支持的图片格式: {image_format}"}, status=415)
        
        filename = f"film_{uuid.uuid4().hex}{extension}"
        destination = FILMSTRIP_DIR / filename
        destination.write_bytes(content)
        
        relative_path = destination.relative_to(BASE_DIR).as_posix()
        return web.json_response({"success": True, "path": relative_path})
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
