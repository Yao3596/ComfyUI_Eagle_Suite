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
import re
import random
import time
import asyncio
import traceback
import ipaddress
from urllib.parse import urlparse

import numpy as np
import torch
from PIL import Image
from aiohttp import web

from .route_registry import route
from .logger import logger

# ────────────────────────────────────────────────────────────────────────────
# 路径与全局状态
# ────────────────────────────────────────────────────────────────────────────

NODE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(NODE_DIR)
SETTINGS_PATH = os.path.join(PROJECT_DIR, "danbooru_search_settings.json")
ENGINE_DIR = os.path.join(NODE_DIR, "danbooru_engine")
TAGS_CSV_PATH = os.path.join(ENGINE_DIR, "origin_database", "tags_enhanced.csv")
TAG_METADATA_PATH = os.path.join(ENGINE_DIR, "tags_embedding", "tags_metadata.parquet")
EMBEDDING_CACHE_DIR = os.path.join(ENGINE_DIR, "tags_embedding")
COOCCURRENCE_PATH = os.path.join(ENGINE_DIR, "origin_database", "cooccurrence_clean.parquet")

DANBOORU_BASE = "https://danbooru.donmai.us"
PAGE_LIMIT = 40

# 懒加载的全局对象
_model = None                 # BGE-M3 SentenceTransformer
_tag_rows = None              # [{tag, cn_name, category, embedding}]
_tag_embeddings = None        # np.ndarray  (N, dim)
_tag_translations = None      # { tag: cn_name }
_selection_cache = {}         # { node_id: {selections, selected_tags, ...} }
_engine = None                # danbooru_engine.core.engine.DanbooruTagger
_engine_lock = None
_danbooru_session = None
_gacha_counter = 0

GACHA_RULE_CARDS = [
    {"name": "放学后的教室", "hints": ("school", "uniform", "student", "serafuku"), "tags": {
        "outfit": ["school_uniform", "pleated_skirt", "kneehighs", "loafers"],
        "action": ["sitting", "looking_at_viewer", "gentle_smile"],
        "scene": ["classroom", "desk", "window", "day"],
        "composition": ["full_body", "three-quarter_view"], "lighting": ["sunlight", "soft_lighting"]}},
    {"name": "雨夜城市漫步", "hints": ("coat", "urban", "modern", "mature"), "tags": {
        "outfit": ["trench_coat", "boots", "scarf"], "action": ["walking", "holding_umbrella", "looking_aside"],
        "scene": ["city", "street", "rain", "night"], "composition": ["cowboy_shot", "dynamic_angle"],
        "lighting": ["neon_lights", "reflections"]}},
    {"name": "夏日海边", "hints": ("summer", "casual", "dress", "cheerful"), "tags": {
        "outfit": ["summer_dress", "sun_hat", "sandals"], "action": ["standing", "holding_hat", "smile"],
        "scene": ["beach", "ocean", "blue_sky", "summer"], "composition": ["full_body", "wide_shot"],
        "lighting": ["sunlight", "backlighting"]}},
    {"name": "冬日咖啡馆", "hints": ("sweater", "cozy", "casual", "adult"), "tags": {
        "outfit": ["sweater", "long_skirt", "tights"], "action": ["sitting", "holding_cup", "looking_at_viewer"],
        "scene": ["cafe", "indoors", "window", "winter"], "composition": ["upper_body", "eye_level"],
        "lighting": ["warm_lighting", "soft_lighting"]}},
    {"name": "奇幻森林旅行", "hints": ("fantasy", "elf", "mage", "armor", "adventurer"), "tags": {
        "outfit": ["cloak", "leather_boots", "belt_pouch"], "action": ["walking", "holding_staff", "looking_ahead"],
        "scene": ["forest", "path", "fantasy", "mist"], "composition": ["full_body", "depth_of_field"],
        "lighting": ["volumetric_lighting", "light_rays"]}},
    {"name": "屋顶夜景", "hints": ("hoodie", "streetwear", "sport", "teen"), "tags": {
        "outfit": ["hoodie", "shorts", "sneakers"], "action": ["sitting", "legs_dangling", "looking_at_sky"],
        "scene": ["rooftop", "cityscape", "night", "starry_sky"], "composition": ["from_side", "wide_shot"],
        "lighting": ["moonlight", "rim_light"]}},
    {"name": "花园下午茶", "hints": ("lolita", "princess", "elegant", "frilled"), "tags": {
        "outfit": ["frilled_dress", "ribbon", "mary_janes"], "action": ["sitting", "holding_teacup", "smile"],
        "scene": ["garden", "table", "flowers", "afternoon_tea"], "composition": ["full_body", "eye_level"],
        "lighting": ["dappled_sunlight", "soft_lighting"]}},
    {"name": "图书馆阅读", "hints": ("glasses", "book", "quiet", "cardigan"), "tags": {
        "outfit": ["cardigan", "collared_shirt", "long_skirt"], "action": ["reading", "holding_book", "sitting"],
        "scene": ["library", "bookshelf", "indoors"], "composition": ["upper_body", "from_side"],
        "lighting": ["window_light", "ambient_light"]}},
    {"name": "车站等候", "hints": ("jacket", "traveler", "office", "casual"), "tags": {
        "outfit": ["casual_clothes", "jacket", "shoulder_bag"], "action": ["standing", "checking_phone", "waiting"],
        "scene": ["train_station", "platform", "evening"], "composition": ["full_body", "perspective"],
        "lighting": ["golden_hour", "cinematic_lighting"]}},
    {"name": "工作室创作", "hints": ("artist", "creative", "apron", "work"), "tags": {
        "outfit": ["apron", "rolled_up_sleeves"], "action": ["drawing", "sitting", "focused"],
        "scene": ["studio", "desk", "art_supplies", "indoors"], "composition": ["upper_body", "over_shoulder"],
        "lighting": ["desk_lamp", "warm_lighting"]}},
]


# ────────────────────────────────────────────────────────────────────────────
# 设置管理
# ────────────────────────────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    "_config_version": 2,
    "model_path": "",
    "danbooru_username": "",
    "danbooru_api_key": "",
    "rating_filter": "general",
    "hide_ai": True,
    "proxy_url": "",
    "api_base_url": DANBOORU_BASE,
    # 总开关：关闭时 Danbooru 节点绝不会加载本地生成模型或请求 LLM API。
    "enable_model_calls": False,
    "gacha_provider": "rules",
    "gacha_api_profile": "",
    "gacha_local_url": "http://127.0.0.1:11434/v1",
    "gacha_local_model": "",
    "gacha_comfy_model": "",
    "gacha_comfy_device": "auto",
    "gacha_comfy_dtype": "bf16",
}


def load_settings():
    merged = dict(DEFAULT_SETTINGS)
    if not os.path.exists(SETTINGS_PATH):
        return merged
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
        merged.update({key: value for key, value in data.items() if key in DEFAULT_SETTINGS})
    except Exception as error:
        logger.warning(f"[DanbooruSearch] 读取设置失败 {SETTINGS_PATH}: {error}")
    return merged


def save_settings(new_settings):
    settings = load_settings()
    allowed = set(DEFAULT_SETTINGS)
    clean = {key: value for key, value in (new_settings or {}).items() if key in allowed}
    settings.update(clean)
    temp_path = SETTINGS_PATH + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
    os.replace(temp_path, SETTINGS_PATH)
    return settings


def get_proxies():
    settings = load_settings()
    proxy = (settings.get("proxy_url") or "").strip()
    if proxy:
        return {"http": proxy, "https": proxy}
    return None


def _get_api_base(settings=None):
    """返回经过基本安全校验的 Danbooru API 基址。"""
    settings = settings or load_settings()
    value = (settings.get("api_base_url") or DANBOORU_BASE).strip().rstrip("/")
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not host or parsed.username or parsed.password:
        raise ValueError("Danbooru API 基址无效，请填写完整的 HTTP(S) 地址")
    if parsed.scheme == "http" and host not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("非本机 Danbooru API 基址必须使用 HTTPS")
    try:
        address = ipaddress.ip_address(host)
        if address.is_private and host not in {"127.0.0.1", "::1"}:
            raise ValueError("Danbooru API 基址不能指向内网 IP")
    except ValueError as error:
        if "内网 IP" in str(error):
            raise
    return value


def _is_cloudflare_challenge(response):
    text = (response.text or "")[:8192].lower()
    return response.status_code == 403 and (
        "just a moment" in text
        or "cf-chl-" in text
        or "cloudflare" in (response.headers.get("Server") or "").lower()
    )


def _get_danbooru_session():
    """复用参考 Danbooru Gallery 节点的传输行为。"""
    import requests

    global _danbooru_session
    if _danbooru_session is None:
        _danbooru_session = requests.Session()
        _danbooru_session.headers.update({"User-Agent": "Danbooru-Gallery/1.0"})
    return _danbooru_session


def _danbooru_get(path, params, timeout=25):
    """统一 Danbooru 请求，并把 Cloudflare HTML 挑战转换成可操作提示。"""
    import requests

    settings = load_settings()
    base = _get_api_base(settings)
    query = dict(params or {})
    # 公开 posts.json 查询不携带账号凭据。参考节点同样将
    # Danbooru 公开搜索与用户验证/收藏分离；把凭据注入普通搜索
    # 会使当前账号直接返回 User::PrivilegeError。
    session = _get_danbooru_session()
    proxy_url = (settings.get("proxy_url") or "").strip()
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    response = session.get(
        f"{base}{path}",
        params=query,
        proxies=proxies,
        timeout=timeout,
        headers={
            "Accept": "application/json",
            "User-Agent": "Danbooru-Gallery/1.0",
        },
    )
    if _is_cloudflare_challenge(response):
        route_name = f"代理 {proxy_url}" if proxy_url else "当前直连网络"
        raise RuntimeError(
            f"Danbooru 拒绝了{route_name}的出口 IP（Cloudflare 验证页）。"
            "请在节点设置中更换可访问 Danbooru 的代理节点，"
            "或填写你信任的 Danbooru API 反向代理基址。"
        )
    response.raise_for_status()
    content_type = (response.headers.get("Content-Type") or "").lower()
    if "json" not in content_type:
        raise RuntimeError(f"Danbooru API 返回了非 JSON 内容（{content_type or '未知类型'}）")
    return response.json()


def _is_allowed_image_url(url: str) -> bool:
    """图片代理只允许 Danbooru 官方域名或用户配置的 API 域名。"""
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        api_host = (urlparse(_get_api_base()).hostname or "").lower()
        is_local_api = api_host in {"localhost", "127.0.0.1", "::1"}
        scheme_allowed = parsed.scheme == "https" or (is_local_api and parsed.scheme == "http")
        return scheme_allowed and (
            host == "donmai.us"
            or host.endswith(".donmai.us")
            or (api_host and host == api_host)
        )
    except Exception:
        return False


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
        # 旧安装可能只保留了 embedding metadata，作为只读后备来源。
        if os.path.isfile(TAG_METADATA_PATH):
            try:
                import pandas as pd
                frame = pd.read_parquet(TAG_METADATA_PATH, columns=["name", "cn_name"])
                translations = {
                    str(name): str(cn or "")
                    for name, cn in zip(frame["name"], frame["cn_name"])
                    if str(name)
                }
                logger.info(f"[DanbooruSearch] 标签 CSV 缺失，已从 metadata 后备加载 {len(translations)} 条翻译")
            except Exception as error:
                logger.warning(f"[DanbooruSearch] metadata 后备翻译读取失败: {error}")
        else:
            logger.warning(f"[DanbooruSearch] 未找到标签表: {TAGS_CSV_PATH}")
        _tag_translations = translations
        return translations

    try:
        with open(TAGS_CSV_PATH, "rb") as f:
            sample = f.read(65536)
        try:
            sample.decode("utf-8-sig")
            csv_encoding = "utf-8-sig"
        except UnicodeDecodeError:
            csv_encoding = "gb18030"

        with open(TAGS_CSV_PATH, "r", encoding=csv_encoding, newline="") as f:
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

        logger.info(f"[DanbooruSearch] 已加载 {len(translations)} 条标签翻译")
    except Exception as e:
        logger.warning(f"[DanbooruSearch] 加载翻译失败: {e}")

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


def _repair_incomplete_bge_cache():
    """移除 Hugging Face 缓存中已确认是 0 字节的关键 JSON，让下次加载重新下载。"""
    try:
        from huggingface_hub.constants import HF_HUB_CACHE
        cache_root = os.path.join(HF_HUB_CACHE, "models--BAAI--bge-m3", "snapshots")
        if not os.path.isdir(cache_root):
            return []
        repaired = []
        critical_names = {"modules.json", "config_sentence_transformers.json"}
        for root, _, files in os.walk(cache_root):
            for name in files:
                path = os.path.join(root, name)
                if name in critical_names and os.path.getsize(path) == 0:
                    os.remove(path)
                    repaired.append(path)
        if repaired:
            logger.warning(
                f"[DanbooruSearch] 已清理 {len(repaired)} 个损坏的 BGE-M3 缓存文件，"
                "首次搜索将重新下载缺失模型文件"
            )
        return repaired
    except Exception as error:
        logger.warning(f"[DanbooruSearch] 检查 BGE-M3 缓存失败: {error}")
        return []


def _load_engine_with_proxy(engine, proxy_url):
    """仅在模型加载期间把节点代理传给 Hugging Face，随后恢复进程环境。"""
    keys = ("HTTP_PROXY", "HTTPS_PROXY")
    previous = {key: os.environ.get(key) for key in keys}
    try:
        if proxy_url:
            for key in keys:
                os.environ[key] = proxy_url
        engine.load()
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


async def _get_search_engine():
    """懒加载项目自带的多视图 embedding 引擎，避免节点启动时占用模型资源。"""
    global _engine, _engine_lock
    if _engine is not None and getattr(_engine, "is_loaded", False):
        return _engine
    if _engine_lock is None:
        _engine_lock = asyncio.Lock()

    async with _engine_lock:
        if _engine is not None and getattr(_engine, "is_loaded", False):
            return _engine

        from .danbooru_engine.core.engine import DanbooruTagger

        settings = load_settings()
        model_path = (settings.get("model_path") or "").strip()
        if not model_path:
            _repair_incomplete_bge_cache()
            model_path = "BAAI/bge-m3"
        engine = DanbooruTagger(
            model_path=model_path,
            csv_file=TAGS_CSV_PATH,
            cache_dir=EMBEDDING_CACHE_DIR,
            cooc_file=COOCCURRENCE_PATH,
        )
        try:
            await asyncio.to_thread(
                _load_engine_with_proxy,
                engine,
                (settings.get("proxy_url") or "").strip(),
            )
        except Exception as error:
            _engine = None
            raise RuntimeError(
                "BGE-M3 模型加载失败。首次使用需要下载完整的 BAAI/bge-m3；"
                "请检查设置中的本地模型路径/代理，或稍后重试。"
            ) from error
        _engine = engine
        return _engine


def _target_categories(category: str) -> list[str]:
    category_map = {
        "general": "General",
        "artist": "Artist",
        "copyright": "Copyright",
        "character": "Character",
        "meta": "Meta",
    }
    if category in category_map:
        return [category_map[category]]
    return ["General", "Artist", "Copyright", "Character", "Meta"]


async def _search_with_engine(query, search_mode, category, show_nsfw):
    from .danbooru_engine.core.models import SearchRequest

    mode_options = {
        "full_scene": {
            "top_k": 80, "limit": 80, "popularity_weight": 0.15,
            "use_segmentation": True,
            "target_layers": ["英文", "中文扩展词", "释义", "中文核心词"],
        },
        "concept_explore": {
            "top_k": 120, "limit": 100, "popularity_weight": 0.25,
            "use_segmentation": True,
            "target_layers": ["中文扩展词", "释义", "英文"],
        },
        "subject_describe": {
            "top_k": 90, "limit": 80, "popularity_weight": 0.12,
            "use_segmentation": True,
            "target_layers": ["英文", "中文核心词", "中文扩展词"],
        },
        "precise_lookup": {
            "top_k": 50, "limit": 60, "popularity_weight": 0.03,
            "use_segmentation": False,
            "target_layers": ["英文", "中文核心词", "中文扩展词"],
        },
    }
    options = mode_options.get(search_mode, mode_options["full_scene"])
    request = SearchRequest(
        query=query,
        show_nsfw=bool(show_nsfw),
        target_categories=_target_categories(category),
        **options,
    )
    engine = await _get_search_engine()
    response = await asyncio.to_thread(engine.search, request)

    results = []
    for item in response.results:
        if not show_nsfw and str(item.nsfw) == "1":
            continue
        results.append({
            "tag": item.tag,
            "cn_name": item.cn_name,
            "category": item.category,
            "score": float(item.final_score),
            "semantic_score": float(item.semantic_score),
            "count": int(item.count),
            "source": item.source,
            "layer": item.layer,
            "wiki": item.wiki,
            "nsfw": item.nsfw,
        })
    return results, response.keywords


async def _related_with_engine(tags, limit, show_nsfw):
    engine = await _get_search_engine()
    related = await asyncio.to_thread(
        engine.get_related,
        tags,
        set(tags),
        limit,
        bool(show_nsfw),
    )
    return [
        {
            "tag": item.tag,
            "cn_name": item.cn_name,
            "category": item.category,
            "cooc_score": float(item.cooc_score),
            "cooc_count": int(item.cooc_count),
            "sources": item.sources,
            "post_count": int(item.post_count),
            "wiki": item.wiki,
            "nsfw": item.nsfw,
        }
        for item in related
    ]


# ────────────────────────────────────────────────────────────────────────────
# 路由注册（统一走 Eagle 延迟注册表，避免 PromptServer.instance 尚未创建）
# ────────────────────────────────────────────────────────────────────────────

@route("POST", "/danbooru_search/search")
async def route_search(request):
    try:
        data = await request.json()
        query = (data.get("query") or "").strip()
        category = data.get("category", "all")
        search_mode = data.get("search_mode", "full_scene")
        show_nsfw = bool(data.get("show_nsfw", False))

        if not query:
            return web.json_response({"success": False, "error": "查询为空"}, status=400)

        results, keywords = await _search_with_engine(
            query, search_mode, category, show_nsfw
        )

        return web.json_response({
            "success": True,
            "results": results,
            "keywords": keywords,
        })
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)}, status=500)


@route("POST", "/danbooru_search/related")
async def route_related(request):
    """
    关联标签：基于选中标签，请求 Danbooru 相似图片的共现标签统计。
    这是个实现示例；若你有本地共现矩阵，替换这里即可。
    """
    try:
        data = await request.json()
        tags = data.get("tags", [])
        limit = max(1, min(100, int(data.get("limit", 50))))
        show_nsfw = bool(data.get("show_nsfw", False))

        if not tags:
            return web.json_response({"success": True, "results": []})

        try:
            results = await _related_with_engine(tags, limit, show_nsfw)
        except Exception as engine_error:
            logger.warning(f"[DanbooruSearch] 本地共现引擎不可用，回退在线关联查询: {engine_error}")
            results = await asyncio.to_thread(_fetch_related_tags, tags, limit)
        return web.json_response({"success": True, "results": results})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)}, status=500)


def _fetch_related_tags(tags, limit):
    settings = load_settings()
    translations = _load_tag_translations()

    params = {
        "tags": " ".join(tags[:2]),  # Danbooru 匿名最多 2 个标签
        "limit": 30,
    }
    posts = _danbooru_get("/posts.json", params, timeout=20)

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


@route("POST", "/danbooru_search/translate_tags_batch")
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


@route("POST", "/danbooru_search/api/posts")
async def route_posts(request):
    try:
        data = await request.json()
        tags = (data.get("tags") or "").strip()
        page = max(1, int(data.get("page", 1)))
        limit = max(1, min(200, int(data.get("limit", PAGE_LIMIT))))
        rating_filter = data.get("rating_filter", "general")

        posts = await asyncio.to_thread(_fetch_posts, tags, page, limit, rating_filter)
        return web.json_response({"success": True, "posts": posts})
    except Exception as e:
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)})


def _fetch_posts(tags, page, limit, rating_filter):
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

    params = {
        "tags": " ".join(tag_parts),
        "page": page,
        "limit": limit,
    }

    raw = _danbooru_get("/posts.json", params, timeout=25)

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


@route("GET", "/danbooru_search/image_proxy")
async def route_image_proxy(request):
    """代理 Danbooru 图片，避开跨域与防盗链。"""
    import requests
    url = request.query.get("url", "")
    if not url or not _is_allowed_image_url(url):
        return web.Response(status=400, text="invalid url")

    try:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: _get_danbooru_session().get(
                url,
                proxies=get_proxies(),
                timeout=25,
                headers={
                    "User-Agent": "Danbooru-Gallery/1.0",
                    "Referer": DANBOORU_BASE,
                },
            ),
        )
        resp.raise_for_status()
        if not _is_allowed_image_url(str(resp.url)):
            return web.Response(status=403, text="redirect target is not allowed")
        content_type = resp.headers.get("Content-Type", "image/jpeg").split(";", 1)[0]
        return web.Response(
            body=resp.content,
            content_type=content_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception as e:
        return web.Response(status=502, text=f"proxy error: {e}")


@route("GET", "/danbooru_search/settings")
async def route_get_settings(request):
    try:
        settings = load_settings()
        # 不回传明文 api_key 的话可在此打码；这里按前端需要原样返回
        return web.json_response({"success": True, "settings": settings})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


@route("POST", "/danbooru_search/settings")
async def route_post_settings(request):
    try:
        data = await request.json()
        previous = load_settings()
        settings = save_settings(data)
        # 改了模型路径 → 下次搜索重新加载
        global _model, _tag_rows, _tag_embeddings, _engine
        if settings.get("model_path") != previous.get("model_path"):
            _model = None
            _tag_rows = None
            _tag_embeddings = None
            _engine = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        return web.json_response({"success": True, "settings": settings})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


def _file_status(path):
    if not os.path.isfile(path):
        return {"path": path, "exists": False, "size": 0, "modified": None}
    stat = os.stat(path)
    return {
        "path": path,
        "exists": True,
        "size": int(stat.st_size),
        "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)),
    }


def _tag_data_status():
    return {
        "tags": _file_status(TAGS_CSV_PATH),
        "cooccurrence": _file_status(COOCCURRENCE_PATH),
        "translations_in_memory": len(_tag_translations or {}),
        "engine_loaded": bool(_engine is not None and getattr(_engine, "is_loaded", False)),
    }


@route("GET", "/danbooru_search/tag_data_status")
async def route_tag_data_status(request):
    return web.json_response({"success": True, "data": _tag_data_status()})


@route("POST", "/danbooru_search/reload_tag_data")
async def route_reload_tag_data(request):
    """重新读取用户在磁盘上更新的 CSV/Parquet；不在请求线程重建向量。"""
    try:
        global _tag_translations, _tag_rows, _tag_embeddings, _engine
        _tag_translations = None
        _tag_rows = None
        _tag_embeddings = None
        _engine = None
        try:
            from .danbooru_engine.core.engine import DanbooruTagger
            DanbooruTagger._instance = None
        except Exception:
            pass
        translations = await asyncio.to_thread(_load_tag_translations)
        status = _tag_data_status()
        status["translations_in_memory"] = len(translations)
        return web.json_response({
            "success": True,
            "message": f"已重新载入 {len(translations)} 条标签；下一次语义搜索会按新数据更新索引",
            "data": status,
        })
    except Exception as error:
        return web.json_response({"success": False, "error": str(error)}, status=500)


@route("GET", "/danbooru_search/local_models")
async def route_local_models(request):
    try:
        from .local_llm_node import list_local_models
        models = await asyncio.to_thread(list_local_models)
        usable = []
        semantic_markers = ("bge", "bert", "roberta", "mpnet", "gte", "e5", "xlm")
        for model in models:
            path = str(model.get("path") or "")
            semantic = os.path.isfile(os.path.join(path, "modules.json"))
            try:
                with open(os.path.join(path, "config.json"), "r", encoding="utf-8") as handle:
                    config = json.load(handle) or {}
                architectures = config.get("architectures") or []
                if isinstance(architectures, str):
                    architectures = [architectures]
                descriptor = " ".join(str(value) for value in [*architectures, config.get("model_type", "")]).lower()
                semantic = semantic or any(marker in descriptor for marker in semantic_markers)
            except Exception:
                pass
            item = dict(model)
            item["semantic"] = bool(semantic)
            if item["semantic"] or item.get("generative"):
                usable.append(item)
        return web.json_response({"success": True, "models": usable})
    except Exception as error:
        return web.json_response({"success": False, "models": [], "error": str(error)}, status=500)


def _gacha_items_from_card(card, variant_index=None):
    items = []
    for kind, tags in (card.get("tags") or {}).items():
        selected = list(tags)
        # 匹配结果只有一张卡时仍轮换其自身构图/光照，保证连续执行
        # 能得到不同提示词，又不跳到与前置角色风格无关的场景。
        if variant_index is not None and len(selected) > 1:
            if kind == "composition":
                selected = [selected[variant_index % len(selected)]]
            elif kind == "lighting":
                selected = [selected[(variant_index // 2) % len(selected)]]
        for tag in selected:
            items.append({
                "tag": str(tag).strip().replace(" ", "_"),
                "kind": kind,
                "category": "general",
                "source": "gacha",
                "weight": 1.0,
                "enabled": True,
            })
    return items


def _rule_gacha(character_tags="", seed=-1):
    """根据前置角色/风格特征加权匹配，并按 seed/执行计数在同分卡组间轮换。"""
    global _gacha_counter
    _gacha_counter += 1
    source = str(character_tags or "").lower().replace("_", " ")
    scored = []
    for card in GACHA_RULE_CARDS:
        score = sum(1 for hint in card.get("hints", ()) if hint in source)
        scored.append((score, card))
    best_score = max((score for score, _ in scored), default=0)
    pool = [card for score, card in scored if score == best_score] if best_score else list(GACHA_RULE_CARDS)
    try:
        base = int(seed)
    except (TypeError, ValueError):
        base = -1
    index = (_gacha_counter - 1 if base < 0 else base + _gacha_counter - 1) % len(pool)
    card = pool[index]
    variant_index = (_gacha_counter - 1) % 4 if len(pool) == 1 else None
    name = card["name"] if variant_index is None else f"{card['name']} · 方案 {variant_index + 1}"
    return {"name": name, "tags": _gacha_items_from_card(card, variant_index), "provider": "rules"}


def _gallery_gacha(selections, character_tags="", seed=-1):
    """从当前已选画廊图片提取角色特征以外的 general 标签并组合一张卡。"""
    candidates = []
    for selection in selections or []:
        if not isinstance(selection, dict):
            continue
        groups = selection.get("tag_groups") or {}
        values = groups.get("general", []) if isinstance(groups, dict) else []
        if not values:
            values = selection.get("tags", [])
        if isinstance(values, str):
            values = re.split(r"[,，;；、\n]+", values)
        candidates.extend(str(value).strip().lower().replace(" ", "_") for value in values or [])

    fixed = {
        re.sub(r"\s+", "_", value.strip().lower())
        for value in re.split(r"[,，;；、\n]+", str(character_tags or "")) if value.strip()
    }
    identity_patterns = (
        r"^\d+(?:girl|boy|other)s?$", r"^(solo|multiple_girls|multiple_boys)$",
        r"(?:^|_)(hair|eyes?|skin|breasts?|age|teen|adult|child|loli|shota)(?:_|$)",
    )
    filtered = []
    seen = set()
    for tag in candidates:
        if not tag or tag in fixed or tag in seen:
            continue
        if any(re.search(pattern, tag) for pattern in identity_patterns):
            continue
        if not re.fullmatch(r"[a-z0-9_()'\-]+", tag):
            continue
        seen.add(tag)
        filtered.append(tag)
    if not filtered:
        raise ValueError("已选画廊图片没有可用于抽卡的角色外标签")

    marker_groups = {
        "outfit": ("dress", "skirt", "shirt", "coat", "jacket", "uniform", "boots", "shoes", "hat", "gloves", "scarf", "clothes"),
        "action": ("sitting", "standing", "walking", "running", "holding", "looking", "smile", "pose", "reading", "drawing"),
        "scene": ("indoors", "outdoors", "room", "street", "city", "forest", "beach", "school", "garden", "night", "day", "rain", "snow"),
        "composition": ("shot", "view", "angle", "body", "portrait", "perspective", "focus", "close-up"),
        "lighting": ("light", "sun", "shadow", "glow", "reflection", "backlighting", "rim_light"),
    }
    buckets = {kind: [] for kind in marker_groups}
    remainder = []
    for tag in filtered:
        matched = next((kind for kind, markers in marker_groups.items() if any(marker in tag for marker in markers)), None)
        (buckets[matched] if matched else remainder).append(tag)

    try:
        base_seed = int(seed)
    except (TypeError, ValueError):
        base_seed = -1
    rng = random.Random(None if base_seed < 0 else base_seed)
    items = []
    quotas = {"outfit": 3, "action": 3, "scene": 4, "composition": 2, "lighting": 2}
    for kind, quota in quotas.items():
        values = buckets[kind]
        rng.shuffle(values)
        for tag in values[:quota]:
            items.append({"tag": tag, "kind": kind, "category": "general", "source": "gacha", "weight": 1.0, "enabled": True})
    rng.shuffle(remainder)
    for tag in remainder[:max(0, 12 - len(items))]:
        items.append({"tag": tag, "kind": "general", "category": "general", "source": "gacha", "weight": 1.0, "enabled": True})
    if not items:
        raise ValueError("画廊标签未形成可用组合")
    return {"name": "已选画廊标签组合", "tags": items, "provider": "gallery"}


def _decode_jsonish(source):
    """接受代码围栏、思考块、JSON 前后说明和常见 Python 字典格式。"""
    import ast

    cleaned = re.sub(r"<think>.*?</think>", "", str(source or ""), flags=re.I | re.S).strip()
    cleaned = re.sub(r"```(?:json|javascript|python)?", "", cleaned, flags=re.I)
    cleaned = cleaned.replace("```", "").strip()
    decoder = json.JSONDecoder()
    for index, char in enumerate(cleaned):
        if char not in "[{":
            continue
        try:
            value, _ = decoder.raw_decode(cleaned[index:])
            if isinstance(value, dict):
                return value
            if isinstance(value, list):
                return {"tags": value}
        except json.JSONDecodeError:
            continue
    try:
        value = ast.literal_eval(cleaned)
        if isinstance(value, dict):
            return value
        if isinstance(value, list):
            return {"tags": value}
    except Exception:
        pass
    return None


def _fallback_llm_sections(source):
    aliases = {
        "outfit": ("outfit", "clothing", "服装", "穿搭"),
        "action": ("action", "pose", "动作", "姿势"),
        "scene": ("scene", "background", "场景", "背景"),
        "composition": ("composition", "camera", "shot", "构图", "镜头"),
        "lighting": ("lighting", "light", "光照", "灯光"),
    }
    sections = {}
    for line in str(source or "").splitlines():
        line = re.sub(r"^[\s#>*\-\d.]+", "", line).strip()
        match = re.match(r"([^:：]{2,20})[:：]\s*(.+)$", line)
        if not match:
            continue
        heading = match.group(1).strip().lower()
        for kind, names in aliases.items():
            if any(name in heading for name in names):
                sections[kind] = match.group(2).strip()
                break
    return sections


def _extract_llm_json(text):
    source = str(text or "").strip()
    data = _decode_jsonish(source) or _fallback_llm_sections(source)
    if not isinstance(data, dict):
        raise ValueError("模型没有返回 JSON 或可识别的分类标签")
    if isinstance(data.get("tags"), dict):
        data = {**data, **data["tags"]}
    tags = []
    for kind in ("outfit", "action", "scene", "composition", "lighting"):
        values = data.get(kind, [])
        if isinstance(values, str):
            values = re.split(r"[,，;；\n]+", values)
        for value in values if isinstance(values, list) else []:
            weight = 1.0
            if isinstance(value, dict):
                weight = value.get("weight", 1.0)
                value = value.get("tag") or value.get("name") or ""
            tag = str(value).strip().strip("`'\"").lower().replace(" ", "_")
            if tag and re.fullmatch(r"[a-z0-9_()'\-]+", tag):
                try:
                    weight = max(-2.0, min(2.0, float(weight)))
                except (TypeError, ValueError):
                    weight = 1.0
                tags.append({"tag": tag, "kind": kind, "category": "general", "source": "gacha", "weight": weight, "enabled": True})
    if not tags:
        raise ValueError("LLM 没有返回可用标签")
    return {"name": str(data.get("name") or "AI 匹配卡"), "tags": tags}


def _gacha_prompts(character_tags):
    system_prompt = (
        "You are a Danbooru prompt planner. Output a single JSON object only. "
        "Never add markdown fences, analysis or prose."
    )
    user_prompt = (
        "Create one coherent prompt card for the fixed character traits below. "
        "Never repeat or change identity, face, hair, eye color, age, body traits, species or artist style. "
        "Generate only compatible outfit, action, scene, composition and lighting tags. "
        "Use known lowercase Danbooru-style English tags. Return exactly these keys: "
        "name, outfit, action, scene, composition, lighting. Each category must be a short JSON string array.\n"
        f"Fixed character/style traits: {character_tags or '(none)'}"
    )
    return system_prompt, user_prompt


def _llm_gacha(
    character_tags, provider, profile_name, local_url, local_model,
    comfy_model="", comfy_device="auto", comfy_dtype="bf16", timeout=45,
):
    import requests
    from . import api_config_manager as config_manager

    system_prompt, prompt = _gacha_prompts(character_tags)

    if provider == "comfyui_model":
        from .local_llm_node import generate_local_text
        if not comfy_model:
            raise ValueError("请选择 ComfyUI 本地生成模型")
        content = generate_local_text(
            comfy_model, system_prompt, prompt,
            device=comfy_device, dtype=comfy_dtype,
            max_new_tokens=600, temperature=0.85, top_p=0.95,
        )
        result = _extract_llm_json(content)
        result["provider"] = provider
        return result

    if provider == "api_profile":
        profile = config_manager.get_profile(profile_name) if profile_name else config_manager.get_active_profile()
        if config_manager.normalize_model_type(profile.get("model_type"), profile.get("model", "")) != config_manager.MODEL_TYPE_LLM:
            raise ValueError("选中的 API Profile 不是 LLM 类型")
        key = config_manager.decode_api_key(profile.get("api_key", ""))
        base_url = str(profile.get("base_url") or "").rstrip("/")
        model = str(profile.get("model") or "").strip()
    else:
        key = ""
        base_url = str(local_url or "").rstrip("/")
        model = str(local_model or "").strip()
    if not base_url or not model:
        raise ValueError("缺少 LLM Base URL 或 Model")
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    endpoint = base_url if base_url.rstrip("/").endswith("/chat/completions") else f"{base_url}/chat/completions"
    response = requests.post(
        endpoint, headers=headers,
        json={"model": model, "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ], "temperature": 0.9, "max_tokens": 600},
        timeout=max(10, min(120, int(timeout))),
    )
    response.raise_for_status()
    content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    result = _extract_llm_json(content)
    result["provider"] = provider
    return result


@route("GET", "/danbooru_search/gacha_profiles")
async def route_gacha_profiles(request):
    try:
        from . import api_config_manager as config_manager
        profiles = [item for item in config_manager.get_profiles_summary() if item.get("model_type") == config_manager.MODEL_TYPE_LLM]
        return web.json_response({"success": True, "profiles": profiles})
    except Exception as error:
        return web.json_response({"success": False, "profiles": [], "error": str(error)})


@route("POST", "/danbooru_search/gacha")
async def route_gacha(request):
    try:
        data = await request.json()
        settings = load_settings()
        provider = str(data.get("provider") or settings.get("gacha_provider") or "rules")
        character_tags = str(data.get("character_tags") or "")
        seed = data.get("seed", -1)
        if provider == "rules":
            result = _rule_gacha(character_tags, seed)
        elif provider == "gallery":
            try:
                result = _gallery_gacha(data.get("selections") or [], character_tags, seed)
            except Exception as error:
                result = _rule_gacha(character_tags, seed)
                result["warning"] = f"画廊标签不可用，已回退规则卡组: {error}"
        elif not bool(settings.get("enable_model_calls", False)):
            result = _rule_gacha(character_tags, seed)
            result["warning"] = "语言模型/API 调用总开关已关闭，未加载模型并回退规则卡组"
        else:
            try:
                result = await asyncio.to_thread(
                    _llm_gacha, character_tags, provider,
                    data.get("profile_name") or settings.get("gacha_api_profile", ""),
                    data.get("local_url") or settings.get("gacha_local_url", ""),
                    data.get("local_model") or settings.get("gacha_local_model", ""),
                    data.get("comfy_model") or settings.get("gacha_comfy_model", ""),
                    data.get("comfy_device") or settings.get("gacha_comfy_device", "auto"),
                    data.get("comfy_dtype") or settings.get("gacha_comfy_dtype", "bf16"),
                )
            except Exception as error:
                logger.warning(f"[DanbooruSearch] AI 抽卡失败，回退规则卡组: {error}")
                result = _rule_gacha(character_tags, seed)
                result["warning"] = f"AI 不可用，已回退规则卡组: {error}"
        return web.json_response({"success": True, **result})
    except Exception as error:
        return web.json_response({"success": False, "error": str(error)}, status=400)


@route("GET", "/danbooru_search/cache_selection")
async def route_get_cache(request):
    node_id = request.query.get("node_id", "")
    entry = _selection_cache.get(str(node_id))
    if not entry:
        return web.json_response({
            "success": True,
            "found": False,
            "selections": [],
            "selected_tags": [],
            "gallery_collapsed": False,
            "auto_gacha": False,
            "gacha_context": "",
        })
    return web.json_response({
        "success": True,
        "found": True,
        "selections": entry.get("selections", []),
        "selected_tags": entry.get("selected_tags", []),
        "gallery_collapsed": bool(entry.get("gallery_collapsed", False)),
        "auto_gacha": bool(entry.get("auto_gacha", False)),
        "gacha_context": str(entry.get("gacha_context", "")),
    })


@route("POST", "/danbooru_search/cache_selection")
async def route_post_cache(request):
    try:
        data = await request.json()
        node_id = str(data.get("node_id", ""))
        _selection_cache[node_id] = {
            "selections": data.get("selections", []),
            "selected_tags": data.get("selected_tags", []),
            "gallery_collapsed": bool(data.get("gallery_collapsed", False)),
            "auto_gacha": bool(data.get("auto_gacha", False)),
            "gacha_context": str(data.get("gacha_context", "")),
        }
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


# ────────────────────────────────────────────────────────────────────────────
# 节点定义
# ────────────────────────────────────────────────────────────────────────────

def _download_image_as_tensor(url):
    """下载单张图片 → torch tensor (H, W, C)，值域 0-1。"""
    import requests
    resp = _get_danbooru_session().get(
        url,
        proxies=get_proxies(),
        timeout=30,
        headers={
            "User-Agent": "Danbooru-Gallery/1.0",
            "Referer": DANBOORU_BASE,
        },
    )
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content))

    img = img.convert("RGB")

    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)


class DanbooruVueSearchNode:
    """Danbooru 语义搜索 + 图库浏览节点。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "selection_data": ("STRING", {"default": "", "multiline": True}),
            },
            "optional": {
                # 外部角色特征始终优先合并，不参与前端抽卡。
                "character_tags": ("STRING", {"forceInput": True}),
                # 必须由工作流显式开启；与设置总开关同时为真才允许加载 LLM/API。
                "enable_language_model": ("BOOLEAN", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("images", "tags")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle/工具"
    OUTPUT_NODE = False

    @classmethod
    def IS_CHANGED(cls, selection_data, character_tags="", enable_language_model=False):
        try:
            if selection_data and bool(json.loads(selection_data).get("auto_gacha", False)):
                # 自动抽卡需要每次队列执行，不使用 ComfyUI 结果缓存。
                return float("nan")
        except Exception:
            pass
        return selection_data, character_tags, bool(enable_language_model)

    @staticmethod
    def _split_external_tags(value):
        if not value:
            return []
        # 只在括号外按逗号/分号/换行拆分，保留
        # ``(white hair, blue eyes:1.2)`` 这类组合权重表达式。
        parts, current, depth, quote = [], [], 0, None
        for char in str(value):
            if quote:
                current.append(char)
                if char == quote:
                    quote = None
                continue
            if char in {'"', "'"}:
                quote = char
                current.append(char)
            elif char in "([{<":
                depth += 1
                current.append(char)
            elif char in ")]}>":
                depth = max(0, depth - 1)
                current.append(char)
            elif depth == 0 and char in {',', ';', '，', '；', '、', '\n', '\r'}:
                value = ''.join(current).strip()
                if value:
                    parts.append(value)
                current = []
            else:
                current.append(char)
        tail = ''.join(current).strip()
        if tail:
            parts.append(tail)
        return parts

    @staticmethod
    def _tag_identity(value):
        """忽略常见权重包装后比较标签，避免前置标签与编辑器标签重复。"""
        text = str(value or "").strip()
        weighted = re.fullmatch(r"\((.*):\s*-?\d+(?:\.\d+)?\)", text)
        if weighted:
            text = weighted.group(1)
        return re.sub(r"\s+", " ", text.replace("_", " ").strip().lower())

    @staticmethod
    def _format_selected_tag(item):
        if isinstance(item, str):
            tag = item.strip()
            weight = 1.0
            enabled = True
        elif isinstance(item, dict):
            tag = str(item.get("tag", "")).strip()
            enabled = bool(item.get("enabled", True))
            try:
                weight = float(item.get("weight", 1.0))
            except (TypeError, ValueError):
                weight = 1.0
        else:
            return ""
        if not tag or not enabled:
            return ""
        rendered = tag.replace("_", " ")
        if abs(weight - 1.0) < 1e-6:
            return rendered
        return f"({rendered}:{weight:g})"

    def execute(self, selection_data, character_tags="", enable_language_model=False):
        # 解析前端写入的选中数据
        selections = []
        selected_tags = None
        parsed = {}
        try:
            if selection_data:
                parsed = json.loads(selection_data)
                selections = parsed.get("selections", [])
                if "selected_tags" in parsed:
                    selected_tags = parsed.get("selected_tags") or []
        except Exception:
            pass

        if bool(parsed.get("auto_gacha", False)):
            settings = load_settings()
            provider = str(settings.get("gacha_provider") or "rules")
            context = ", ".join(filter(None, [
                str(character_tags or "").strip(),
                str(parsed.get("gacha_context") or "").strip(),
                ", ".join(
                    str(item.get("tag") or "") for item in (selected_tags or [])
                    if isinstance(item, dict) and item.get("enabled", True) and item.get("source") != "gacha"
                ),
            ]))
            try:
                if provider == "rules":
                    card = _rule_gacha(context, parsed.get("gacha_seed", -1))
                elif provider == "gallery":
                    try:
                        card = _gallery_gacha(selections, context, parsed.get("gacha_seed", -1))
                    except Exception as error:
                        logger.warning(f"[DanbooruSearch] 画廊标签抽卡失败，回退规则卡组: {error}")
                        card = _rule_gacha(context, parsed.get("gacha_seed", -1))
                elif not (bool(enable_language_model) and bool(settings.get("enable_model_calls", False))):
                    # 两级开关防止节点加载时或误执行时占用本地模型/API。
                    card = _rule_gacha(context, parsed.get("gacha_seed", -1))
                else:
                    try:
                        card = _llm_gacha(
                            context, provider, settings.get("gacha_api_profile", ""),
                            settings.get("gacha_local_url", ""), settings.get("gacha_local_model", ""),
                            settings.get("gacha_comfy_model", ""),
                            settings.get("gacha_comfy_device", "auto"),
                            settings.get("gacha_comfy_dtype", "bf16"),
                        )
                    except Exception as error:
                        logger.warning(f"[DanbooruSearch] 自动 AI 抽卡失败，回退规则卡组: {error}")
                        card = _rule_gacha(context, parsed.get("gacha_seed", -1))
                selected_tags = [item for item in (selected_tags or []) if not (isinstance(item, dict) and item.get("source") == "gacha")]
                selected_tags.extend(card.get("tags", []))
            except Exception as error:
                logger.warning(f"[DanbooruSearch] 自动抽卡失败，保留当前标签: {error}")

        tensors = []
        # 新版工作流以顶部标签编辑器为唯一标签源；旧工作流
        # 没有 selected_tags 字段时，仍回退到“已选图片的全部标签”。
        all_tags = self._split_external_tags(character_tags)
        if selected_tags is not None:
            all_tags.extend(filter(None, (self._format_selected_tag(item) for item in selected_tags)))
        target_size = None

        for sel in selections:
            url = sel.get("large_file_url") or sel.get("file_url") or sel.get("preview_file_url")
            if not url:
                continue
            try:
                t = _download_image_as_tensor(url)
            except Exception as e:
                print(f"[DanbooruSearch] 下载失败 {url}: {e}")
                continue

            # 记录标签
            if selected_tags is None:
                tags = sel.get("tags", [])
                if isinstance(tags, list):
                    all_tags.extend(tag.replace("_", " ") for tag in tags)

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
            batch = empty
        else:
            batch = torch.stack(tensors, dim=0)

        # 去重保序
        positions = {}
        unique_tags = []
        for tag in all_tags:
            key = self._tag_identity(tag)
            if not key:
                continue
            rendered = tag.strip().replace("_", " ")
            weighted = bool(re.fullmatch(r"\(.*:\s*-?\d+(?:\.\d+)?\)", rendered))
            if key not in positions:
                positions[key] = len(unique_tags)
                unique_tags.append(rendered)
            elif weighted:
                # 重复时显式权重优先，允许顶部编辑器覆盖前置无权重标签。
                unique_tags[positions[key]] = rendered
        tags_str = ", ".join(unique_tags)

        return (batch, tags_str)


NODE_CLASS_MAPPINGS = {
    "DanbooruVueSearchNode": DanbooruVueSearchNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DanbooruVueSearchNode": "🦅 Danbooru 语义搜索 + 图库",
}
