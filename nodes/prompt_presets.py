# -*- coding: utf-8 -*-
"""
EaglePromptPresets - 提示词预设模板（增强版）
支持 Obsidian 集成、Markdown 格式、自定义路径
"""

import json
import uuid
import os
import re
import copy
import io
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


def parse_markdown_template(content: str, filename: str) -> Optional[Dict]:
    """
    解析 Markdown 格式的模板文件

    支持格式：
    ---
    label: 模板名称
    category: 分类
    tags: [tag1, tag2]
    ---

    ## 指令
    {{instruction}}

    ## 示例
    {{example}}
    """
    try:
        # 解析 YAML Front Matter
        parts = content.split('---')
        metadata = {}
        body = content

        if len(parts) >= 3:
            # 有 Front Matter
            front_matter = parts[1].strip()
            body = '---'.join(parts[2:]).strip()

            # 简单解析 YAML（支持基本键值对）
            for line in front_matter.split('\n'):
                if ':' in line:
                    key, value = line.split(':', 1)
                    key = key.strip()
                    value = value.strip()

                    # 处理数组格式
                    if value.startswith('[') and value.endswith(']'):
                        value = [v.strip().strip('"\'') for v in value[1:-1].split(',')]

                    metadata[key] = value

        # 提取指令和示例
        instruction_match = re.search(r'##\s*指令\s*\n(.*?)(?=\n##|\Z)', body, re.DOTALL)
        example_match = re.search(r'##\s*示例\s*\n(.*?)(?=\n##|\Z)', body, re.DOTALL)

        instruction = instruction_match.group(1).strip() if instruction_match else body.strip()
        example = example_match.group(1).strip() if example_match else ""

        # 如果没有明确的指令标记，尝试使用第一个非空行
        if not instruction and body:
            lines = [l for l in body.split('\n') if l.strip()]
            if lines:
                instruction = lines[0].strip()
                if len(lines) > 1:
                    example = lines[1].strip()

        return {
            "id": str(uuid.uuid4()),
            "Label": metadata.get('label', filename.replace('.md', '')),
            "Instruction": instruction,
            "example": example,
            "category": metadata.get('category', '自定义'),
            "tags": metadata.get('tags', []),
            "cover": metadata.get('cover', ''),
            "source": "local",
            "file_path": filename,
            "created_at": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"解析 Markdown 失败 ({filename}): {e}")
        return None


def template_to_markdown(template: Dict) -> str:
    """将模板转换为 Markdown 格式"""
    tags_str = json.dumps(template.get('tags', []))

    return f"""---
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

    # 编辑器和导入器默认写入该文件；旧实现没有把它读回列表。
    if USER_TEMPLATES_FILE.exists():
        try:
            with open(USER_TEMPLATES_FILE, 'r', encoding='utf-8') as f:
                stored = json.load(f)
            if isinstance(stored, list):
                templates.extend(stored)
        except Exception as e:
            logger.error(f"加载用户模板文件失败 ({USER_TEMPLATES_FILE}): {e}")

    for path_str in paths:
        path = Path(path_str)
        if not path.exists():
            logger.warning(f"路径不存在: {path}")
            continue

        # 遍历 JSON 和 Markdown 文件
        for file_path in path.glob('**/*'):
            if file_path.is_file():
                try:
                    if file_path.suffix == '.json':
                        with open(file_path, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            if isinstance(data, list):
                                templates.extend(data)
                            elif isinstance(data, dict):
                                templates.append(data)

                    elif file_path.suffix in ['.md', '.markdown']:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                            template = parse_markdown_template(content, file_path.name)
                            if template:
                                template['file_path'] = str(file_path)
                                templates.append(template)

                except Exception as e:
                    logger.error(f"加载文件失败 ({file_path}): {e}")

    return templates


def _resolve_obsidian_local_dir(obsidian: dict) -> Optional[Path]:
    """兼容“Vault 根目录 + 相对目录”以及直接填写 Windows 提示词目录。"""
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
                item = parse_markdown_template(file_path.read_text(encoding="utf-8"), file_path.name)
                if item:
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
                                template = parse_markdown_template(await file_resp.text(), str(file_name))
                                if template:
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

    # 内置模板使用稳定 ID，避免每次刷新都让前端误判为一批新项目。
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

    # 本地和 Obsidian 模板
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

        # 加载配置
        config = load_config()

        # 加载所有来源的模板
        local_templates = load_local_templates(config['local_paths'])
        obsidian_templates = await load_obsidian_templates(config)

        # 合并模板
        all_templates = merge_templates(PROMPT_TEMPLATES, local_templates, obsidian_templates)

        # 获取分类列表
        categories = list(all_templates.keys())

        # 筛选分类
        if category and category in all_templates:
            items = all_templates[category]
        else:
            # 合并所有分类
            items = []
            for cat_items in all_templates.values():
                items.extend(cat_items)

        # 关键词过滤
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
        save_format = body.get("format", "json")  # json 或 markdown

        if not template:
            return web.json_response({"success": False, "error": "缺少模板数据"}, status=400)

        # 确保有 ID
        if not template.get("id"):
            template["id"] = str(uuid.uuid4())

        # 内置模板通过“另存为自定义”进入编辑器，不能覆盖或伪装成内置项。
        if template.get("source") in {"built-in", "obsidian"}:
            template["id"] = str(uuid.uuid4())
        template["source"] = "user"

        template["created_at"] = template.get("created_at", datetime.now().isoformat())
        template["updated_at"] = datetime.now().isoformat()

        # 根据格式保存
        if save_format == "markdown":
            # 保存为 Markdown
            filename = f"{template['Label'].replace(' ', '_')}_{template['id'][:8]}.md"
            file_path = USER_TEMPLATES_DIR / filename

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(template_to_markdown(template))

            template['file_path'] = str(file_path)

        else:
            # 保存到 JSON 文件（向后兼容）
            templates = []
            if USER_TEMPLATES_FILE.exists():
                with open(USER_TEMPLATES_FILE, 'r', encoding='utf-8') as f:
                    templates = json.load(f)

            # 更新或添加
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

        # 尝试从 JSON 删除
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

        # 尝试从 Markdown 文件删除
        for md_file in USER_TEMPLATES_DIR.glob("*.md"):
            try:
                with open(md_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                template = parse_markdown_template(content, md_file.name)
                if template and template.get('id') == template_id:
                    md_file.unlink()
                    deleted = True
                    break
            except Exception as e:
                logger.error(f"删除 MD 文件失败: {e}")

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
            template = parse_markdown_template(content_str, field.filename)
            if template:
                templates = [template]

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

        # 保存导入的模板
        existing = []
        if USER_TEMPLATES_FILE.exists():
            with open(USER_TEMPLATES_FILE, 'r', encoding='utf-8') as f:
                existing = json.load(f)

        for t in templates:
            if not t.get("id"):
                t["id"] = str(uuid.uuid4())
            t["created_at"] = datetime.now().isoformat()
            t["source"] = t.get("source", "imported")

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
        # 隐藏敏感信息
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

        # 如果 API key 是占位符，保留原值
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
    """优先测试本地 Vault 直读；否则诊断 Local REST API 的 HTTP/HTTPS。"""
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
    """保存模板小封面。文件只写入节点自己的 prompts/covers 目录。"""
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
        export_format = body.get("format", "json")  # json, markdown, txt

        # 加载所有模板
        config = load_config()
        local_templates = load_local_templates(config['local_paths'])

        # 筛选要导出的模板
        if template_ids:
            templates = [t for t in local_templates if t.get('id') in template_ids]
        else:
            templates = local_templates

        # 根据格式导出
        if export_format == "markdown":
            # 生成 Markdown 文件内容
            content = "\n\n---\n\n".join([template_to_markdown(t) for t in templates])
            return web.Response(
                text=content,
                content_type="text/markdown",
                headers={"Content-Disposition": f'attachment; filename="prompts_export.md"'}
            )

        elif export_format == "txt":
            # 纯文本格式（每行一个指令）
            lines = [t.get('Instruction', '') for t in templates]
            content = "\n".join(lines)
            return web.Response(
                text=content,
                content_type="text/plain",
                headers={"Content-Disposition": f'attachment; filename="prompts_export.txt"'}
            )

        else:  # json
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
# 节点类
# ─────────────────────────────────────────────────────────

class EaglePromptPresets:
    """提示词预设模板（增强版）"""

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "输入提示词，或通过前端选择模板"
                }),
            },
            "optional": {
                "variables": ("STRING", {
                    "forceInput": True,
                    "tooltip": "外部多变量：支持 JSON 对象，或每行 key=value / key: value"
                }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("Prompt",)
    FUNCTION = "process"
    CATEGORY = "🦅 Eagle/工具"

    @staticmethod
    def _parse_variables(value):
        text = str(value or "").strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return {str(key).strip(): str(val) for key, val in parsed.items() if str(key).strip()}
        except (TypeError, ValueError, json.JSONDecodeError):
            pass

        result = {}
        for raw_line in text.splitlines():
            line = raw_line.strip().strip(",")
            if not line or line.startswith("#"):
                continue
            match = re.match(r"^\s*([^:=：]+?)\s*(?:=|:|：)\s*(.*?)\s*$", line)
            if match:
                result[match.group(1).strip()] = match.group(2).strip()
        return result

    def process(self, prompt, variables=""):
        rendered = str(prompt or "")
        for key, value in self._parse_variables(variables).items():
            rendered = re.sub(
                r"\{\{\s*" + re.escape(key) + r"\s*\}\}",
                lambda _match, replacement=value: replacement,
                rendered,
            )
        return (rendered,)
