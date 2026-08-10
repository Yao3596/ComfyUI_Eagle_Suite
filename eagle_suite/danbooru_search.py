"""
Danbooru 标签语义搜索 + 图库浏览节点（后端）

配套前端：danbooru_search_vue.js
提供的接口：
    POST /danbooru_search/search               语义标签搜索
    POST /danbooru_search/related              关联标签（共现）
    POST /danbooru_search/translate_tags_batch 批量翻译
    POST /danbooru_search/api/posts            Danbooru 图库
    GET  /danbooru_search/image_proxy          图片代理
    GET  /danbooru_search/settings             读取设置
    POST /danbooru_search/settings             保存设置
    GET  /danbooru_search/cache_selection      读取选中缓存
    POST /danbooru_search/cache_selection      写入选中缓存
"""

import os
import io
import csv
import json
import time
import asyncio
import traceback

import numpy as np
import torch
from PIL import Image
from aiohttp import web

import server

# ────────────────────────────────────────────────────────────────────────────
# 路径与全局状态
# ────────────────────────────────────────────────────────────────────────────

NODE_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_PATH = os.path.join(NODE_DIR, "settings.json")
TAGS_CSV_PATH = os.path.join(NODE_DIR, "tags_enhanced.csv")

DANBOORU_BASE = "https://danbooru.donmai.us"
PAGE_LIMIT = 40

# 懒加载的全局对象
_model = None                 # BGE-M3 SentenceTransformer
_tag_rows = None              # [{tag, cn_name, category, embedding}]
_tag_embeddings = None        # np.ndarray  (N, dim)
_tag_translations = None      # { tag: cn_name }
_selection_cache = {}         # { node_id: {selections, output_mode} }


# ────────────────────────────────────────────────────────────────────────────
# 设置管理
# ────────────────────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "model_path": "",
    "danbooru_username": "",
    "danbooru_api_key": "",
    "rating_filter": "general",
    "hide_ai": True,
    "proxy_url": "",
}


def load_settings():
    if not os.path.exists(SETTINGS_PATH):
        return dict(DEFAULT_SETTINGS)
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        merged = dict(DEFAULT_SETTINGS)
        merged.update(data or {})
        return merged
    except Exception:
        return dict(DEFAULT_SETTINGS)


def save_settings(new_settings):
    settings = load_settings()
    settings.update(new_settings or {})
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
    return settings


def get_proxies():
    settings = load_settings()
    proxy = (settings.get("proxy_url") or "").strip()
    if proxy:
        return {"http": proxy, "https": proxy}
    return None


# ────────────────────────────────────────────────────────────────────────────
# 标签库与翻译加载
# ────────────────────────────────────────────────────────────────────────────

def _load_tag_translations():
    """
    从 tags_enhanced.csv 读取 { tag: cn_name }。

    CSV 假定含表头，列名里带 tag / name / cn / chinese / 中文 等关键字。
    若你的 CSV 列名不同，改这里的列名匹配逻辑即可。
    """
    global _tag_translations
    if _tag_translations is not None:
        return _tag_translations

    translations = {}
    if not os.path.exists(TAGS_CSV_PATH):
        print(f"[DanbooruSearch] 未找到标签表: {TAGS_CSV_PATH}")
        _tag_translations = translations
        return translations

    try:
        with open(TAGS_CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if not header:
                _tag_translations = translations
                return translations

            # 猜测列索引
            tag_idx, cn_idx = 0, None
            for i, col in enumerate(header):
                low = (col or "").strip().lower()
                if low in ("tag", "name", "tag_name", "标签"):
                    tag_idx = i
                if any(k in low for k in ("cn", "chinese", "中文", "zh", "translation", "译名")):
                    cn_idx = i

            if cn_idx is None:
                cn_idx = 1 if len(header) > 1 else 0

            for row in reader:
                if len(row) <= max(tag_idx, cn_idx):
                    continue
                tag = (row[tag_idx] or "").strip()
                cn = (row[cn_idx] or "").strip()
                if tag:
                    translations[tag] = cn

        print(f"[DanbooruSearch] 已加载 {len(translations)} 条标签翻译")
    except Exception as e:
        print(f"[DanbooruSearch] 加载翻译失败: {e}")

    _tag_translations = translations
    return translations


def _guess_category(tag, cn_name=""):
    """粗略推断标签类别（仅用于结果标注，不影响搜索）。"""
    # 真实项目里应从 CSV 的 category 列读取，这里给个占位
    return "general"


def _load_model():
    global _model
    if _model is not None:
        return _model

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise RuntimeError(
            "缺少 sentence-transformers，请先安装：pip install sentence-transformers"
        )

    settings = load_settings()
    model_path = (settings.get("model_path") or "").strip()
    source = model_path if model_path else "BAAI/bge-m3"

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[DanbooruSearch] 加载 BGE-M3 模型: {source} (device={device})")
    _model = SentenceTransformer(source, device=device)
    return _model


def _load_tag_database():
    """
    构建标签向量库。

    这里假定标签库来自 tags_enhanced.csv，用 cn_name + tag 作为文本编码。
    首次调用会较慢（编码所有标签），之后缓存在内存。
    如你已有预计算的 embedding 文件，替换这里的编码逻辑即可。
    """
    global _tag_rows, _tag_embeddings
    if _tag_rows is not None and _tag_embeddings is not None:
        return _tag_rows, _tag_embeddings

    translations = _load_tag_translations()
    if not translations:
        _tag_rows, _tag_embeddings = [], np.zeros((0, 1024), dtype=np.float32)
        return _tag_rows, _tag_embeddings

    rows = []
    texts = []
    for tag, cn in translations.items():
        rows.append({
            "tag": tag,
            "cn_name": cn,
            "category": _guess_category(tag, cn),
        })
        # 用中文名 + 英文标签做编码，兼顾中英查询
        texts.append(f"{cn} {tag.replace('_', ' ')}".strip())

    model = _load_model()
    print(f"[DanbooruSearch] 编码 {len(texts)} 个标签向量…")
    embeddings = model.encode(
        texts,
        batch_size=256,
        show_progress_bar=True,
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype(np.float32)

    _tag_rows = rows
    _tag_embeddings = embeddings
    print("[DanbooruSearch] 标签向量库就绪")
    return _tag_rows, _tag_embeddings


# ────────────────────────────────────────────────────────────────────────────
# 语义搜索
# ────────────────────────────────────────────────────────────────────────────

def _semantic_search(query, top_k=60, category="all"):
    rows, embeddings = _load_tag_database()
    if not rows or embeddings.shape[0] == 0:
        return []

    model = _load_model()
    q_emb = model.encode(
        [query],
        normalize_embeddings=True,
        convert_to_numpy=True,
    ).astype(np.float32)[0]

    scores = embeddings @ q_emb  # 余弦相似度（都已归一化）

    order = np.argsort(-scores)
    results = []
    for idx in order:
        row = rows[idx]
        if category != "all" and row.get("category") != category:
            continue
        results.append({
            "tag": row["tag"],
            "cn_name": row.get("cn_name", ""),
            "category": row.get("category", "general"),
            "score": float(scores[idx]),
        })
        if len(results) >= top_k:
            break
    return results


def _tokenize_query(query):
    """极简分词：按空格/逗号切，仅用于前端展示。"""
    import re
    parts = re.split(r"[\s,，、/]+", query.strip())
    return [p for p in parts if p]


# ────────────────────────────────────────────────────────────────────────────
# 路由注册
# ────────────────────────────────────────────────────────────────────────────

routes = server.PromptServer.instance.routes


@routes.post("/danbooru_search/search")
async def route_search(request):
    try:
        data = await request.json()
        query = (data.get("query") or "").strip()
        category = data.get("category", "all")

        if not query:
            return web.json_response({"success": False, "error": "查询为空"})

        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None, lambda: _semantic_search(query, 60, category)
        )
        keywords = _tokenize_query(query)

        return web.json_response({
            "success": True,
            "results": results,
            "keywords": keywords,
        })
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)})


@routes.post("/danbooru_search/related")
async def route_related(request):
    """
    关联标签：基于选中标签，请求 Danbooru 相似图片的共现标签统计。
    这是个实现示例；若你有本地共现矩阵，替换这里即可。
    """
    try:
        data = await request.json()
        tags = data.get("tags", [])
        limit = int(data.get("limit", 50))

        if not tags:
            return web.json_response({"success": True, "results": []})

        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None, lambda: _fetch_related_tags(tags, limit)
        )
        return web.json_response({"success": True, "results": results})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)})


def _fetch_related_tags(tags, limit):
    import requests
    settings = load_settings()
    translations = _load_tag_translations()

    params = {
        "tags": " ".join(tags[:2]),  # Danbooru 匿名最多 2 个标签
        "limit": 30,
    }
    auth = None
    if settings.get("danbooru_username") and settings.get("danbooru_api_key"):
        auth = (settings["danbooru_username"], settings["danbooru_api_key"])

    resp = requests.get(
        f"{DANBOORU_BASE}/posts.json",
        params=params,
        auth=auth,
        proxies=get_proxies(),
        timeout=20,
        headers={"User-Agent": "ComfyUI-DanbooruSearch/1.0"},
    )
    resp.raise_for_status()
    posts = resp.json()

    counter = {}
    input_set = set(tags)
    for post in posts:
        for tag in (post.get("tag_string_general") or "").split():
            if tag in input_set:
                continue
            counter[tag] = counter.get(tag, 0) + 1

    total = max(len(posts), 1)
    ranked = sorted(counter.items(), key=lambda x: -x[1])[:limit]
    results = []
    for tag, count in ranked:
        results.append({
            "tag": tag,
            "cn_name": translations.get(tag, ""),
            "category": "general",
            "cooc_score": count / total,
        })
    return results


@routes.post("/danbooru_search/translate_tags_batch")
async def route_translate_batch(request):
    try:
        data = await request.json()
        tags = data.get("tags", [])
        translations = _load_tag_translations()

        result = {}
        for tag in tags:
            result[tag] = translations.get(tag, "")

        return web.json_response({"success": True, "translations": result})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)})


@routes.post("/danbooru_search/api/posts")
async def route_posts(request):
    try:
        data = await request.json()
        tags = (data.get("tags") or "").strip()
        page = int(data.get("page", 1))
        limit = int(data.get("limit", PAGE_LIMIT))
        rating_filter = data.get("rating_filter", "general")

        loop = asyncio.get_event_loop()
        posts = await loop.run_in_executor(
            None, lambda: _fetch_posts(tags, page, limit, rating_filter)
        )
        return web.json_response({"success": True, "posts": posts})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)})


def _fetch_posts(tags, page, limit, rating_filter):
    import requests
    settings = load_settings()

    tag_parts = tags.split() if tags else []

    # 评级过滤
    if rating_filter and rating_filter != "all":
        rating_map = {
            "general": "rating:general",
            "sensitive": "rating:sensitive",
            "questionable": "rating:questionable",
            "explicit": "rating:explicit",
        }
        if rating_filter in rating_map:
            tag_parts.append(rating_map[rating_filter])

    # 隐藏 AI 图
    if settings.get("hide_ai", True):
        tag_parts.append("-ai-generated")

    auth = None
    if settings.get("danbooru_username") and settings.get("danbooru_api_key"):
        auth = (settings["danbooru_username"], settings["danbooru_api_key"])

    params = {
        "tags": " ".join(tag_parts),
        "page": page,
        "limit": limit,
    }

    resp = requests.get(
        f"{DANBOORU_BASE}/posts.json",
        params=params,
        auth=auth,
        proxies=get_proxies(),
        timeout=25,
        headers={"User-Agent": "ComfyUI-DanbooruSearch/1.0"},
    )
    resp.raise_for_status()
    raw = resp.json()

    posts = []
    for p in raw:
        # 跳过没有图片的项
        if not (p.get("file_url") or p.get("large_file_url") or p.get("preview_file_url")):
            continue
        posts.append({
            "id": p.get("id"),
            "file_url": p.get("file_url"),
            "large_file_url": p.get("large_file_url"),
            "preview_file_url": p.get("preview_file_url"),
            "image_width": p.get("image_width"),
            "image_height": p.get("image_height"),
            "rating": p.get("rating"),
            "score": p.get("score"),
            "fav_count": p.get("fav_count"),
            "tag_string_artist": p.get("tag_string_artist", ""),
            "tag_string_copyright": p.get("tag_string_copyright", ""),
            "tag_string_character": p.get("tag_string_character", ""),
            "tag_string_general": p.get("tag_string_general", ""),
            "tag_string_meta": p.get("tag_string_meta", ""),
        })
    return posts


@routes.get("/danbooru_search/image_proxy")
async def route_image_proxy(request):
    """代理 Danbooru 图片，避开跨域与防盗链。"""
    import requests
    url = request.query.get("url", "")
    if not url or not url.startswith("http"):
        return web.Response(status=400, text="invalid url")

    try:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: requests.get(
                url,
                proxies=get_proxies(),
                timeout=25,
                headers={
                    "User-Agent": "ComfyUI-DanbooruSearch/1.0",
                    "Referer": DANBOORU_BASE,
                },
            ),
        )
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "image/jpeg")
        return web.Response(
            body=resp.content,
            content_type=content_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception as e:
        return web.Response(status=502, text=f"proxy error: {e}")


@routes.get("/danbooru_search/settings")
async def route_get_settings(request):
    try:
        settings = load_settings()
        # 不回传明文 api_key 的话可在此打码；这里按前端需要原样返回
        return web.json_response({"success": True, "settings": settings})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


@routes.post("/danbooru_search/settings")
async def route_post_settings(request):
    try:
        data = await request.json()
        settings = save_settings(data)
        # 改了模型路径 → 下次搜索重新加载
        global _model, _tag_rows, _tag_embeddings
        if "model_path" in data:
            _model = None
            _tag_rows = None
            _tag_embeddings = None
        return web.json_response({"success": True, "settings": settings})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


@routes.get("/danbooru_search/cache_selection")
async def route_get_cache(request):
    node_id = request.query.get("node_id", "")
    entry = _selection_cache.get(str(node_id))
    if not entry:
        return web.json_response({"success": True, "selections": [], "output_mode": "rgb"})
    return web.json_response({
        "success": True,
        "selections": entry.get("selections", []),
        "output_mode": entry.get("output_mode", "rgb"),
    })


@routes.post("/danbooru_search/cache_selection")
async def route_post_cache(request):
    try:
        data = await request.json()
        node_id = str(data.get("node_id", ""))
        _selection_cache[node_id] = {
            "selections": data.get("selections", []),
            "output_mode": data.get("output_mode", "rgb"),
        }
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


# ────────────────────────────────────────────────────────────────────────────
# 节点定义
# ────────────────────────────────────────────────────────────────────────────

def _download_image_as_tensor(url, output_mode="rgb"):
    """下载单张图片 → torch tensor (H, W, C)，值域 0-1。"""
    import requests
    resp = requests.get(
        url,
        proxies=get_proxies(),
        timeout=30,
        headers={
            "User-Agent": "ComfyUI-DanbooruSearch/1.0",
            "Referer": DANBOORU_BASE,
        },
    )
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content))

    mode = "RGBA" if output_mode == "rgba" else "RGB"
    img = img.convert(mode)

    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)


class DanbooruVueSearchNode:
    """Danbooru 语义搜索 + 图库浏览节点。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "selection_data": ("STRING", {"default": "", "multiline": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "tags")
    FUNCTION = "execute"
    CATEGORY = "EagleSuite"
    OUTPUT_NODE = False

    def execute(self, selection_data):
        # 解析前端写入的选中数据
        selections = []
        output_mode = "rgb"
        try:
            if selection_data:
                parsed = json.loads(selection_data)
                selections = parsed.get("selections", [])
                output_mode = parsed.get("output_mode", "rgb")
        except Exception:
            pass

        if not selections:
            # 输出 1x64x64 空图，避免下游报错
            empty = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (empty, "")

        tensors = []
        all_tags = []
        target_size = None

        for sel in selections:
            url = sel.get("large_file_url") or sel.get("file_url") or sel.get("preview_file_url")
            if not url:
                continue
            try:
                t = _download_image_as_tensor(url, output_mode)
            except Exception as e:
                print(f"[DanbooruSearch] 下载失败 {url}: {e}")
                continue

            # 记录标签
            tags = sel.get("tags", [])
            if isinstance(tags, list):
                all_tags.extend(tags)

            # 统一尺寸到第一张图，方便 batch
            if target_size is None:
                target_size = (t.shape[0], t.shape[1])
            else:
                if (t.shape[0], t.shape[1]) != target_size:
                    # (H, W, C) → (C, H, W) 插值 → 还原
                    chw = t.permute(2, 0, 1).unsqueeze(0)
                    chw = torch.nn.functional.interpolate(
                        chw, size=target_size, mode="bilinear", align_corners=False
                    )
                    t = chw.squeeze(0).permute(1, 2, 0)

            tensors.append(t)

        if not tensors:
            empty = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (empty, "")

        batch = torch.stack(tensors, dim=0)

        # 去重保序
        seen = set()
        unique_tags = []
        for tag in all_tags:
            if tag not in seen:
                seen.add(tag)
                unique_tags.append(tag)
        tags_str = ", ".join(t.replace("_", " ") for t in unique_tags)

        return (batch, tags_str)


NODE_CLASS_MAPPINGS = {
    "DanbooruVueSearchNode": DanbooruVueSearchNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DanbooruVueSearchNode": "🦅 Danbooru 语义搜索 + 图库",
}
