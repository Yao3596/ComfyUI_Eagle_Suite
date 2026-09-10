/**
 * Danbooru 标签语义搜索 + 图库浏览节点（Vue 3 增强版）
 *
 * 功能整合：
 *   1. 左侧：语义标签搜索面板
 *   2. 右侧：Danbooru 图库浏览（无限滚动）
 *   3. 图片卡片：悬浮编辑按钮 + 已编辑徽章
 *   4. 编辑面板：分类标签展示 + 右键菜单（搜索/删除）+ 添加 + 复制 + 重置
 *   5. 底部：已选图片预览条
 *   6. 输出：IMAGE + STRING
 */
import { app } from "../../../scripts/app.js";
import { createApp, h, ref, reactive, computed, onMounted, onBeforeUnmount, watch } from "../lib/vue.esm-browser.js";
import "./eagle_vue_theme.js";

// ════════════════════════════════════════════════════════════════════════════
// 常量定义
// ════════════════════════════════════════════════════════════════════════════

const MODE_OPTIONS = [
  { value: "full_scene",       label: "完整画面" },
  { value: "concept_explore",  label: "概念发散" },
  { value: "subject_describe", label: "描述查词" },
  { value: "precise_lookup",   label: "精确查询" },
];

const CATEGORY_OPTIONS = [
  { value: "all",       label: "全部类别" },
  { value: "general",   label: "General" },
  { value: "artist",    label: "Artist" },
  { value: "character", label: "Character" },
  { value: "copyright", label: "Copyright" },
  { value: "meta",      label: "Meta" },
];

const GALLERY_SORT_OPTIONS = [
  { value: "id_desc", label: "最新" },
  { value: "score", label: "评分热门" },
  { value: "favcount", label: "收藏热门" },
  { value: "random", label: "随机" },
];

const RATING_OPTIONS = [
  { value: "all",          label: "全部评级" },
  { value: "general",      label: "General (SFW)" },
  { value: "sensitive",    label: "Sensitive" },
  { value: "questionable", label: "Questionable" },
  { value: "explicit",     label: "Explicit (NSFW)" },
];

// 标签分类顺序与中文标题
const TAG_CATEGORIES = [
  { key: "artist",    label: "艺术家" },
  { key: "copyright", label: "版权" },
  { key: "character", label: "角色" },
  { key: "general",   label: "通用" },
  { key: "meta",      label: "元数据" },
];

const PAGE_LIMIT = 40;
const libraryFacetLabels = reactive({});

const TAG_KIND_LABELS = {
  semantic: "语义", detail: "图片", manual: "手动", gacha: "抽卡",
  outfit: "服装", action: "动作", expression: "表情", scene: "场景", environment: "环境", composition: "构图",
  lighting: "光照", quality: "质量", appearance: "外观", general: "通用",
};
const PROMPT_KIND_LABELS = {
  outfit: "服装", action: "动作", expression: "表情", scene: "场景",
  environment: "环境", composition: "构图", lighting: "光照",
};

const GACHA_FACET_GROUPS = [
  { key: "character", label: "人物锁定", prefixes: ["identity", "body", "hair", "face"] },
  { key: "styling", label: "换装", prefixes: ["clothing"] },
  { key: "expression", label: "面部表情", prefixes: ["expression"] },
  { key: "pose", label: "身体姿态", prefixes: ["pose"] },
  { key: "interaction", label: "动作交互", prefixes: ["action"], excludeKeys: ["action.self_contact", "action.intimate"] },
  { key: "adult", label: "成人内容", keys: ["action.self_contact", "action.intimate"] },
  { key: "world", label: "场景环境", prefixes: ["scene", "environment"] },
  { key: "visual", label: "镜头画面", prefixes: ["camera", "lighting", "style"] },
];

const GACHA_MODE_LABELS = { auto: "自动", required: "必选", off: "禁用" };
const GACHA_FACET_MODE_LABELS = { "": "自动", prefer: "偏好", required: "必选", off: "禁用" };

const TAG_MAJOR_GROUPS = [
  { key: "character", label: "人物" },
  { key: "styling", label: "服装装饰" },
  { key: "action", label: "动作表情" },
  { key: "world", label: "场景环境" },
  { key: "visual", label: "构图画面" },
  { key: "other", label: "其他" },
];

const TAG_SUBGROUP_LABELS = {
  artist: "艺术家", copyright: "版权", character: "角色", appearance: "外观特征",
  clothing: "服装", footwear: "鞋袜", accessory: "配饰",
  expression: "表情", gaze: "视线", pose: "姿势", interaction: "动作/交互",
  place: "地点", weather: "天气/时间", object: "物件/背景",
  composition: "镜头构图", lighting: "光照色彩", quality: "质量/元数据",
  manual: "手动", general: "未分类",
};

// 运行期显示设置由设置弹窗即时更新。界面本身固定中文，避免保留无效语言选项。
const danbooruUiSettings = reactive({
  tagDisplayLanguage: "bilingual",
  groupOutputTags: false,
});

function applyDanbooruUiSettings(settings = {}) {
  danbooruUiSettings.tagDisplayLanguage = settings.tag_display_language || "bilingual";
  danbooruUiSettings.groupOutputTags = false;
}

async function readJsonResponse(response, label = "服务") {
  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error(`${label}返回空响应；前后端版本可能不一致，请重启 ComfyUI 后刷新浏览器`);
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error(`${label}返回非 JSON（HTTP ${response.status}）：${raw.slice(0, 160)}`);
  }
}

function inferTagTaxonomy(value) {
  const item = typeof value === "string" ? { tag: value } : (value || {});
  if (Array.isArray(item.facets) && item.facets.length) {
    const facet = item.facets[0];
    Object.assign(TAG_SUBGROUP_LABELS, item.facet_labels || libraryFacetLabels);
    const major = { identity: "character", body: "character", hair: "character", face: "character",
      clothing: "styling", pose: "action", action: "action", expression: "action", scene: "world",
      environment: "world", camera: "visual", lighting: "visual", style: "visual" }[facet.split(".")[0]];
    if (major) return { major, sub: facet };
  }
  const tag = String(item.tag || "").toLowerCase().replace(/\s+/g, "_");
  const cn = String(item.translation || item.cn_name || translationCache[tag] || "").toLowerCase();
  const text = tag + "_" + cn;
  const category = String(item.category || "general").toLowerCase();
  let kind = String(item.kind || "general").toLowerCase();

  if (["artist", "copyright", "character"].includes(category)) {
    return { major: "character", sub: category };
  }
  if (category === "meta") kind = "quality";
  if (["semantic", "detail", "manual", "gacha", "general"].includes(kind)) {
    const rules = [
      ["quality", /masterpiece|best_quality|highres|absurdres|lowres|watermark|signature|commentary|request|censored|monochrome|greyscale/],
      ["lighting", /light|lighting|shadow|sunlight|backlight|glow|ray|reflection|bloom|neon|lens_flare/],
      ["composition", /view|shot|angle|focus|depth_of_field|perspective|portrait|close[-_]?up|full_body|upper_body|cowboy_shot|from_/],
      ["expression", /smile|grin|blush|frown|angry|cry|tear|expression|closed_eyes|one_eye_closed|open_mouth|closed_mouth|tongue|pout|surprised/],
      ["action", /holding|sitting|standing|walking|running|kneeling|lying|looking|facing|leaning|reaching|raised_|spread_|crossed_|hug|kiss|fighting|dancing|reading|eating|drinking|sleeping|gesture|pose/],
      ["outfit", /dress|shirt|skirt|coat|jacket|uniform|clothes|pants|shorts|socks|stockings|thighhighs|pantyhose|legwear|boots|shoes|gloves|hat|cap|ribbon|tie|collar|scarf|swimsuit|bikini|lingerie|armor|apron|hoodie|sweater|bra|panties|accessor|jewel/],
      ["environment", /rain|snow|weather|sky|cloud|sunset|sunrise|night|day|morning|evening|season|wind|fog|mist|water|fire|flower|tree|grass/],
      ["scene", /indoors|outdoors|room|bedroom|classroom|school|street|city|forest|garden|beach|ocean|mountain|library|station|platform|park|cafe|restaurant|office|background|scenery/],
      ["appearance", /hair|eyes|skin|breast|chest|ass|hips|waist|body|face|ears|horns|tail|wings|age|girl|boy|female|male|solo|multiple_/],
    ];
    kind = rules.find(([, pattern]) => pattern.test(text))?.[0] || kind;
  }

  if (kind === "appearance") return { major: "character", sub: "appearance" };
  if (kind === "outfit") {
    if (/boots|shoes|socks|stockings|thighhighs|pantyhose|legwear|sandals|heels|footwear/.test(text)) return { major: "styling", sub: "footwear" };
    if (/hat|cap|ribbon|tie|collar|scarf|gloves|jewel|accessor|bag|belt|necklace|earring/.test(text)) return { major: "styling", sub: "accessory" };
    return { major: "styling", sub: "clothing" };
  }
  if (kind === "expression") return { major: "action", sub: "expression" };
  if (kind === "action") {
    if (/looking|facing|eye_contact|gaze/.test(text)) return { major: "action", sub: "gaze" };
    if (/holding|hug|kiss|touch|fighting|reading|eating|drinking|interaction/.test(text)) return { major: "action", sub: "interaction" };
    return { major: "action", sub: "pose" };
  }
  if (kind === "scene") return { major: "world", sub: "place" };
  if (kind === "environment") return { major: "world", sub: /rain|snow|weather|sunset|sunrise|night|day|morning|evening|wind|fog|mist/.test(text) ? "weather" : "object" };
  if (kind === "composition") return { major: "visual", sub: "composition" };
  if (kind === "lighting") return { major: "visual", sub: "lighting" };
  if (kind === "quality") return { major: "visual", sub: "quality" };
  return { major: "other", sub: kind === "manual" ? "manual" : "general" };
}

function buildTagTaxonomy(tags) {
  const entries = (tags || []).map((item, index) => ({ item, index, ...inferTagTaxonomy(item) }));
  return TAG_MAJOR_GROUPS.map(group => {
    const groupEntries = entries.filter(entry => entry.major === group.key);
    const subKeys = [...new Set(groupEntries.map(entry => entry.sub))];
    return { ...group, entries: groupEntries, subKeys };
  }).filter(group => group.entries.length);
}

function splitPromptTags(text) {
  const result = [];
  let current = "", depth = 0, quote = "";
  for (const char of String(text || "")) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if ("([{<".includes(char)) { depth++; current += char; continue; }
    if (")]}>".includes(char)) { depth = Math.max(0, depth - 1); current += char; continue; }
    if (depth === 0 && (char === "," || char === ";" || char === "，" || char === "；" || char === "、" || char === "\n" || char === "\r")) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function validTranslation(value) {
  const text = String(value || "").trim();
  return text && !text.includes("\uFFFD");
}

function resolveTranslation(tag, value = "") {
  return validTranslation(value) ? value : (translationCache[tag] || "");
}

function normalizeTagItem(value, defaults = {}) {
  const raw = typeof value === "string" ? { tag: value } : (value || {});
  let sourceTag = String(raw.tag || "").trim();
  const inlineWeight = sourceTag.match(/^\(([^(),]+):\s*(-?\d+(?:\.\d+)?)\)$/);
  if (inlineWeight) sourceTag = inlineWeight[1].trim();
  const tag = sourceTag.replace(/\s+/g, "_");
  if (!tag) return null;
  if (!validTranslation(raw.translation)) requestTranslations([tag]);
  const weightValue = Number(raw.weight == null ? (inlineWeight ? inlineWeight[2] : 1) : raw.weight);
  return {
    tag,
    translation: resolveTranslation(tag, raw.translation),
    category: raw.category || defaults.category || "general",
    kind: raw.kind || defaults.kind || "general",
    facets: Array.isArray(raw.facets) ? raw.facets.slice() : [],
    facet_labels: raw.facet_labels || {},
    source: raw.source || defaults.source || "manual",
    // Weight is intentionally not clamped. Advanced prompt syntaxes may use
    // values outside the usual -2..2 range; only reject non-finite values.
    weight: Number.isFinite(weightValue) ? weightValue : 1,
    enabled: raw.enabled !== false,
  };
}

function isGachaItem(item) {
  return String(item?.source || "").startsWith("gacha");
}

function mergeTagItems(current, incoming, defaults = {}) {
  const result = (current || []).map(item => normalizeTagItem(item)).filter(Boolean);
  const keys = new Set(result.map(item => item.tag.toLowerCase()));
  (incoming || []).forEach(value => {
    const item = normalizeTagItem(value, defaults);
    if (item && !keys.has(item.tag.toLowerCase())) {
      keys.add(item.tag.toLowerCase());
      result.push(item);
    }
  });
  requestTranslations(result.map(item => item.tag));
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════════════════

function proxiedImageUrl(url) {
  if (!url) return "";
  return "/danbooru_search/image_proxy?url=" + encodeURIComponent(url);
}

function getRatingColor(rating) {
  const map = {
    "g": "#2a5a2a",
    "s": "#5a4a2a",
    "q": "#5a3a2a",
    "e": "#5a2a2a",
  };
  return map[rating] || "#3a3a3a";
}

function getRatingLabel(rating) {
  const map = { "g": "G", "s": "S", "q": "Q", "e": "E" };
  return map[rating] || "?";
}

function splitTags(str) {
  return (str || "").split(" ").map(t => t.trim()).filter(Boolean);
}

// 从 post 解析原始分类标签
function parseOriginalTags(post) {
  return {
    artist:    splitTags(post.tag_string_artist),
    copyright: splitTags(post.tag_string_copyright),
    character: splitTags(post.tag_string_character),
    general:   splitTags(post.tag_string_general),
    meta:      splitTags(post.tag_string_meta),
  };
}

// ── 全局翻译缓存 ──────────────────────────────────────────────────────────
const translationCache = reactive({});   // { tag: cn_name }
let _pendingTranslate = new Set();
let _translateTimer = null;

function requestTranslations(tags) {
  let need = false;
  tags.forEach(t => {
    if (t && !(t in translationCache) && !_pendingTranslate.has(t)) {
      _pendingTranslate.add(t);
      need = true;
    }
  });
  if (!need) return;

  clearTimeout(_translateTimer);
  _translateTimer = setTimeout(async () => {
    const batch = Array.from(_pendingTranslate);
    _pendingTranslate = new Set();
    if (batch.length === 0) return;
    try {
      const res = await fetch("/danbooru_search/translate_tags_batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: batch }),
      });
      const data = await res.json();
      if (data.success && data.translations) {
        Object.assign(translationCache, data.translations);
      }
      // 未命中的也标记为空串，避免重复请求
      batch.forEach(t => {
        if (!(t in translationCache)) translationCache[t] = "";
      });
    } catch (e) {
      // 忽略
    }
  }, 200);
}

// ════════════════════════════════════════════════════════════════════════════
// 编辑状态存储（跨组件共享）
// ════════════════════════════════════════════════════════════════════════════

const editedStore = reactive({});          // { postId: {artist:[],...} }
const editedFlags = reactive(new Set());   // 已编辑的 postId 集合

function ensureEditStore(post) {
  const id = String(post.id);
  if (!editedStore[id]) {
    editedStore[id] = JSON.parse(JSON.stringify(parseOriginalTags(post)));
  }
  return editedStore[id];
}

function getEffectiveTags(post) {
  const id = String(post.id);
  return editedStore[id] || parseOriginalTags(post);
}

function isPostEdited(post) {
  return editedFlags.has(String(post.id));
}

function recomputeEditedFlag(post) {
  const id = String(post.id);
  const orig = parseOriginalTags(post);
  const cur = editedStore[id];
  if (!cur) { editedFlags.delete(id); return; }
  const changed = TAG_CATEGORIES.some(c => {
    const a = [...(orig[c.key] || [])].sort().join(" ");
    const b = [...(cur[c.key] || [])].sort().join(" ");
    return a !== b;
  });
  if (changed) editedFlags.add(id);
  else editedFlags.delete(id);
}

function resetEdits(post) {
  const id = String(post.id);
  editedStore[id] = JSON.parse(JSON.stringify(parseOriginalTags(post)));
  editedFlags.delete(id);
}

// 把某个 post 的有效标签展平成数组（用于选中输出）
function flattenEffectiveTags(post) {
  const t = getEffectiveTags(post);
  const out = [];
  ["artist", "copyright", "character", "general", "meta"].forEach(k => {
    (t[k] || []).forEach(tag => out.push(tag));
  });
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 子组件：语义标签搜索面板
// ════════════════════════════════════════════════════════════════════════════

const TagSearchPanel = {
  name: "TagSearchPanel",
  props: {
    onAddOutput: Function,
    onSearchGallery: Function,
  },
  setup(props) {
    const query = ref("");
    const mode = ref("full_scene");
    const category = ref("all");
    const showNsfw = ref(false);
    const loading = ref(false);
    const errorMsg = ref("");
    const results = ref([]);
    const keywords = ref([]);
    const searchSummary = ref("");
    const selected = ref([]);
    const related = ref([]);
    const relatedLoading = ref(false);

    const selectedTags = computed(() => {
      const s = {};
      selected.value.forEach(it => { s[it.tag] = true; });
      return s;
    });

    async function doSearch() {
      if (!query.value.trim()) return;
      loading.value = true;
      errorMsg.value = "";

      try {
        const res = await fetch("/danbooru_search/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: query.value,
            search_mode: mode.value,
            category: category.value,
            show_nsfw: showNsfw.value,
          }),
        });

        const data = await readJsonResponse(res, "本地标签搜索接口");

        if (data.success) {
          results.value = data.results || [];
          keywords.value = data.keywords || [];
          const source = data.data_source || {};
          const semanticText = source.semantic
            ? `；向量 ${source.semantic}${source.semantic_rows ? ` ${Number(source.semantic_rows).toLocaleString()} 条` : ""}`
            : "";
          searchSummary.value = `检索来源：精确 ${source.direct || "未知"}${semanticText}`;
        } else {
          errorMsg.value = data.error || "搜索失败";
          results.value = [];
          searchSummary.value = "";
        }
      } catch (e) {
        errorMsg.value = "请求失败: " + e.message;
        results.value = [];
        searchSummary.value = "";
      } finally {
        loading.value = false;
      }
    }

    function toggleSelect(item) {
      if (selectedTags.value[item.tag]) {
        selected.value = selected.value.filter(s => s.tag !== item.tag);
      } else {
        selected.value.push({
          tag: item.tag,
          cn_name: item.cn_name,
          category: item.category,
          kind: item.kind,
          facets: item.facets, facet_labels: item.facet_labels,
          score: item.score,
        });
      }
      loadRelated();
    }

    function removeSelected(item) {
      selected.value = selected.value.filter(s => s.tag !== item.tag);
      loadRelated();
    }

    function clearSelected() {
      selected.value = [];
      related.value = [];
    }

    let _relatedTimer = null;
    function loadRelated() {
      clearTimeout(_relatedTimer);
      if (selected.value.length === 0) {
        related.value = [];
        return;
      }

      _relatedTimer = setTimeout(async () => {
        relatedLoading.value = true;
        const tags = selected.value.map(s => s.tag);

        try {
          const res = await fetch("/danbooru_search/related", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tags, limit: 50, show_nsfw: showNsfw.value }),
          });

          const data = await readJsonResponse(res, "关联标签接口");
          if (data.success) {
            related.value = data.results || [];
          }
        } catch (e) {
          // 忽略
        } finally {
          relatedLoading.value = false;
        }
      }, 350);
    }

    function addFromRelated(item) {
      if (selectedTags.value[item.tag]) return;
      selected.value.push({
        tag: item.tag,
        cn_name: item.cn_name,
        category: item.category,
        kind: item.kind,
        facets: item.facets, facet_labels: item.facet_labels,
        score: item.cooc_score,
      });
      loadRelated();
    }

    function selectedItems() {
      return selected.value.map(s => ({
          tag: s.tag,
          translation: s.cn_name || "",
          category: String(s.category || "general").toLowerCase(),
          kind: s.kind || "semantic",
          facets: s.facets, facet_labels: s.facet_labels,
          source: "semantic",
          weight: 1,
          enabled: true,
      }));
    }

    function addToOutput() {
      if (props.onAddOutput && selected.value.length > 0) {
        props.onAddOutput(selectedItems());
      }
    }

    function searchGalleryOnly() {
      if (props.onSearchGallery && selected.value.length > 0) {
        props.onSearchGallery(selectedItems());
      }
    }

    return () => {
      return h("div", { class: "dbs-panel" }, [
        h("div", { class: "dbs-search-box" }, [
          h("textarea", {
            class: "dbs-input",
            placeholder: "本地标签库查词（中/英文），例如：一个在雨中奔跑的少女",
            value: query.value,
            onInput: e => { query.value = e.target.value; },
            onKeydown: e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                doSearch();
              }
            },
          }),

          h("div", { class: "dbs-toolbar" }, [
            h("select", {
              class: "dbs-select",
              value: mode.value,
              onChange: e => { mode.value = e.target.value; },
            }, MODE_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

            h("select", {
              class: "dbs-select",
              value: category.value,
              onChange: e => { category.value = e.target.value; },
            }, CATEGORY_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

            h("label", { class: "dbs-check" }, [
              h("input", {
                type: "checkbox",
                checked: showNsfw.value,
                onChange: e => { showNsfw.value = e.target.checked; },
              }),
              " NSFW",
            ]),

            h("button", {
              class: "dbs-btn primary",
              onClick: doSearch,
            }, loading.value ? "搜索中…" : "🔍 搜索"),
          ]),

          keywords.value.length > 0
            ? h("div", { class: "dbs-keywords" }, "分词: " + keywords.value.join(" / "))
            : null,
          searchSummary.value ? h("div", { class: "dbs-keywords" }, searchSummary.value) : null,
        ]),

        h("div", { class: "dbs-results" }, [
          errorMsg.value
            ? h("div", { class: "dbs-error" }, errorMsg.value)
            : loading.value
            ? h("div", { class: "dbs-empty" }, "🔄 搜索中…")
            : results.value.length === 0
            ? h("div", { class: "dbs-empty" }, "输入描述并回车搜索")
            : h("div", { class: "dbs-table" }, results.value.map(r => {
                return h("div", {
                  class: ["dbs-row", selectedTags.value[r.tag] ? "selected" : ""],
                  title: [r.tag, r.cn_name, r.wiki].filter(Boolean).join("\n"),
                  onClick: () => toggleSelect(r),
                }, [
                  h("input", {
                    type: "checkbox",
                    checked: !!selectedTags.value[r.tag],
                    onClick: e => {
                      e.stopPropagation();
                      toggleSelect(r);
                    },
                  }),
                  h("span", { class: "dbs-tag", title: r.tag }, r.tag),
                  h("span", { class: "dbs-cn" }, r.cn_name || ""),
                  h("span", { class: "dbs-cat dbs-cat-" + (r.category || "").toLowerCase() }, r.category || ""),
                  h("span", { class: "dbs-count", title: "Danbooru 作品数" }, r.count ? Number(r.count).toLocaleString() : ""),
                  h("span", { class: "dbs-score" }, r.score != null ? r.score.toFixed(2) : ""),
                ]);
              })),
        ]),

        h("div", { class: "dbs-selected compact" }, [
          h("div", { class: "dbs-selected-header" }, [
            h("span", {}, "候选标签 " + selected.value.length + " 个"),
            selected.value.length > 0
              ? h("button", { class: "dbs-btn small primary", onClick: addToOutput }, "加入输出")
              : null,
            selected.value.length > 0
              ? h("button", { class: "dbs-btn small", onClick: searchGalleryOnly }, "仅搜索图库")
              : null,
            selected.value.length > 0
              ? h("button", { class: "dbs-btn small", onClick: clearSelected }, "清除")
              : null,
          ]),
        ]),

        h("div", { class: "dbs-related" }, [
          h("div", { class: "dbs-related-header" }, "关联推荐" + (relatedLoading.value ? " …" : "")),
          h("div", { class: "dbs-related-list" }, related.value.length === 0
            ? [h("div", { class: "dbs-empty-small" }, "勾选标签后自动推荐")]
            : related.value.map(r => {
                return h("div", { class: "dbs-related-row", onClick: () => addFromRelated(r) }, [
                  h("span", { class: "dbs-tag", title: r.tag }, r.tag),
                  h("span", { class: "dbs-cn" }, r.cn_name || ""),
                  h("span", { class: "dbs-score" }, r.cooc_score != null ? r.cooc_score.toFixed(2) : ""),
                ]);
              }),
          ),
        ]),
      ]);
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 子组件：标签右键菜单
// ════════════════════════════════════════════════════════════════════════════

const TagContextMenu = {
  name: "TagContextMenu",
  props: {
    state: Object,       // { visible, x, y, tag, category }
    onSearch: Function,
    onDelete: Function,
  },
  setup(props) {
    return () => {
      if (!props.state.visible) return h("div");
      return h("div", {
        class: "dbs-tag-context-menu",
        style: { left: props.state.x + "px", top: props.state.y + "px" },
        onClick: e => e.stopPropagation(),
      }, [
        h("div", {
          class: "dbs-tag-context-menu-item",
          onClick: () => props.onSearch && props.onSearch(props.state.tag),
        }, "🔍 搜索此标签"),
        h("div", {
          class: "dbs-tag-context-menu-item",
          onClick: () => props.onDelete && props.onDelete(props.state.tag, props.state.category),
        }, "🗑️ 删除"),
      ]);
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 子组件：图片详情 / 编辑面板
// ════════════════════════════════════════════════════════════════════════════

const PostEditDialog = {
  name: "PostEditDialog",
  props: {
    post: Object,
    onClose: Function,
    onSearchTag: Function,     // 把标签送到图库搜索框
    onEdited: Function,        // 编辑发生后回调（同步选中项标签）
    onAddTags: Function,       // 把高亮标签加入节点顶部标签编辑器
  },
  setup(props) {
    // 保证编辑副本存在
    ensureEditStore(props.post);

    const store = computed(() => editedStore[String(props.post.id)]);

    const addCategory = ref("general");
    const addValue = ref("");
    const highlighted = reactive(new Set());

    const ctxMenu = reactive({
      visible: false, x: 0, y: 0, tag: "", category: "",
    });

    // 请求当前所有标签的翻译
    function requestAllTranslations() {
      const all = [];
      TAG_CATEGORIES.forEach(c => {
        (store.value[c.key] || []).forEach(t => all.push(t));
      });
      requestTranslations(all);
    }
    requestAllTranslations();

    function showCtxMenu(e, tag, category) {
      e.preventDefault();
      e.stopPropagation();
      ctxMenu.visible = true;
      ctxMenu.x = e.clientX;
      ctxMenu.y = e.clientY;
      ctxMenu.tag = tag;
      ctxMenu.category = category;
    }

    function hideCtxMenu() {
      ctxMenu.visible = false;
    }

    function deleteTag(tag, category) {
      const arr = store.value[category];
      const idx = arr.indexOf(tag);
      if (idx > -1) arr.splice(idx, 1);
      recomputeEditedFlag(props.post);
      hideCtxMenu();
      props.onEdited && props.onEdited(props.post);
    }

    function searchTag(tag) {
      hideCtxMenu();
      props.onSearchTag && props.onSearchTag(tag);
    }

    function addTag() {
      const val = addValue.value.trim().replace(/\s+/g, "_");
      if (!val) return;
      const cat = addCategory.value;
      if (!store.value[cat].includes(val)) {
        store.value[cat].push(val);
        requestTranslations([val]);
        recomputeEditedFlag(props.post);
        props.onEdited && props.onEdited(props.post);
      }
      addValue.value = "";
    }

    function toggleHighlighted(tag) {
      if (highlighted.has(tag)) highlighted.delete(tag);
      else highlighted.add(tag);
    }

    function selectableTags() {
      const parts = [];
      TAG_CATEGORIES.forEach(cat => (store.value[cat.key] || []).forEach(tag => {
        parts.push({ tag, category: cat.key, translation: translationCache[tag] || "" });
      }));
      return parts;
    }

    function detailSections() {
      const sections = [];
      TAG_CATEGORIES.forEach(cat => {
        const tags = store.value[cat.key] || [];
        if (!tags.length) return;
        if (cat.key !== "general") {
          sections.push({ key: cat.key, label: cat.label, category: cat.key, tags });
          return;
        }
        const buckets = new Map();
        tags.forEach(tag => {
          const taxonomy = inferTagTaxonomy({ tag, translation: translationCache[tag], category: cat.key, kind: "detail" });
          const key = taxonomy.major + "/" + taxonomy.sub;
          if (!buckets.has(key)) buckets.set(key, { taxonomy, tags: [] });
          buckets.get(key).tags.push(tag);
        });
        for (const [key, bucket] of buckets) {
          const majorLabel = TAG_MAJOR_GROUPS.find(item => item.key === bucket.taxonomy.major)?.label || "其他";
          const subLabel = TAG_SUBGROUP_LABELS[bucket.taxonomy.sub] || bucket.taxonomy.sub;
          sections.push({ key: "general-" + key, label: majorLabel + " / " + subLabel, category: cat.key, tags: bucket.tags });
        }
      });
      return sections;
    }

    function copyTags() {
      const text = selectableTags()
        .filter(item => highlighted.has(item.tag))
        .map(item => item.tag.replace(/_/g, " ")).join(", ");
      if (!text) return;
      navigator.clipboard.writeText(text).catch(() => {});
    }

    function addHighlighted() {
      const items = selectableTags().filter(item => highlighted.has(item.tag)).map(item => ({
        ...item, kind: item.category === "general" ? "detail" : item.category,
        source: "detail", weight: 1, enabled: true,
      }));
      if (items.length && props.onAddTags) props.onAddTags(items);
    }

    function selectAllTags() {
      selectableTags().forEach(item => highlighted.add(item.tag));
    }

    function doReset() {
      resetEdits(props.post);
      requestAllTranslations();
      props.onEdited && props.onEdited(props.post);
    }

    onMounted(() => {
      document.addEventListener("click", hideCtxMenu);
    });
    onBeforeUnmount(() => {
      document.removeEventListener("click", hideCtxMenu);
    });

    return () => {
      const post = props.post;
      const edited = isPostEdited(post);

      return h("div", { class: "dbs-modal-backdrop", onClick: props.onClose }, [
        h("div", {
          class: "dbs-modal dbs-detail-modal",
          onClick: e => e.stopPropagation(),
        }, [
          h("div", { class: "dbs-detail-header" }, [
            h("h3", {}, "🖼 图片详情 #" + post.id + (edited ? "  (已编辑)" : "")),
            h("button", { class: "dbs-btn small", onClick: props.onClose }, "✕"),
          ]),

          h("div", { class: "dbs-detail-body" }, [
            h("div", { class: "dbs-detail-preview" }, [
              h("img", {
                src: proxiedImageUrl(post.large_file_url || post.file_url || post.preview_file_url),
                alt: "Danbooru #" + post.id,
              }),
            ]),
            h("div", { class: "dbs-detail-side" }, [
              h("div", { class: "dbs-detail-tags" }, detailSections().map(section => h("div", { class: "dbs-tag-section", key: section.key }, [
                h("div", { class: "dbs-tag-section-title" }, section.label + " (" + section.tags.length + ")"),
                h("div", { class: "dbs-tag-group" }, section.tags.map(tag => {
                  const cn = translationCache[tag];
                  const mode = danbooruUiSettings.tagDisplayLanguage;
                  const label = mode === "zh" && cn ? cn : (mode === "bilingual" && cn ? (tag + " (" + cn + ")") : tag);
                  return h("div", {
                    class: ["dbs-tag-chip", "dbs-tag-category-" + section.category, highlighted.has(tag) ? "highlighted" : ""],
                    key: tag,
                    title: cn ? (tag + " · " + cn) : tag,
                    onClick: () => toggleHighlighted(tag),
                    onContextmenu: e => showCtxMenu(e, tag, section.category),
                  }, label);
                })),
              ]))),
              h("div", { class: "dbs-detail-footer" }, [
                h("div", { class: "dbs-add-tag-row" }, [
                  h("select", {
                    class: "dbs-select",
                    value: addCategory.value,
                    onChange: e => { addCategory.value = e.target.value; },
                  }, TAG_CATEGORIES.map(c => h("option", { value: c.key }, c.label))),
                  h("input", {
                    class: "dbs-input-line",
                    style: { flex: "1", margin: "0" },
                    placeholder: "输入新标签，回车添加",
                    value: addValue.value,
                    onInput: e => { addValue.value = e.target.value; },
                    onKeydown: e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } },
                  }),
                  h("button", { class: "dbs-btn small", onClick: addTag }, "➕ 添加"),
                ]),
                h("div", { class: "dbs-detail-actions" }, [
                  h("button", { class: "dbs-detail-btn", onClick: selectAllTags }, "全选"),
                  h("button", { class: "dbs-detail-btn", onClick: () => highlighted.clear() }, "清除高亮"),
                  h("button", { class: "dbs-detail-btn primary", onClick: addHighlighted }, "➕ 加入节点标签"),
                  h("button", { class: "dbs-detail-btn primary", onClick: copyTags }, "📋 复制高亮标签"),
                  h("button", { class: "dbs-detail-btn", disabled: !edited, onClick: doReset }, "🔄 重置标签"),
                ]),
              ]),
            ]),
          ]),

          h(TagContextMenu, {
            state: ctxMenu,
            onSearch: searchTag,
            onDelete: deleteTag,
          }),
        ]),
      ]);
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 子组件：图库浏览面板（无限滚动）
// ════════════════════════════════════════════════════════════════════════════

const GalleryPanel = {
  name: "GalleryPanel",
  props: {
    initialTags: String,
    initialSelections: Array,
    onSelectionChange: Function,
    onAddTags: Function,
  },
  setup(props) {
    const tags = ref(props.initialTags || "");
    const page = ref(1);
    const posts = ref([]);
    const loading = ref(false);
    const loadingMore = ref(false);
    const hasMore = ref(true);
    const errorMsg = ref("");
    const selected = reactive(new Set());
    const selectedPosts = ref([]);
    const ratingFilter = ref("general");
    const sortOrder = ref("id_desc");
    const minScore = ref(0);
    const minFavorites = ref(0);
    const poolQuery = ref("");
    const poolResults = ref([]);
    const poolLoading = ref(false);
    const pageLimit = ref(PAGE_LIMIT);
    const lazyLoadImages = ref(true);

    const gridRef = ref(null);
    const detailPost = ref(null);

    watch(() => props.initialSelections, (items) => {
      const incoming = Array.isArray(items) ? items : [];
      selected.clear();
      incoming.forEach(item => selected.add(String(item.id)));
      selectedPosts.value = incoming.slice();
    }, { immediate: true });

    // 监听外部传入的标签变化
    watch(() => props.initialTags, (newTags) => {
      if (newTags && newTags !== tags.value) {
        tags.value = newTags;
        doSearch();
      }
    });

    async function fetchPage(pageNum, replace) {
      if (replace) {
        loading.value = true;
      } else {
        loadingMore.value = true;
      }
      errorMsg.value = "";

      try {
        const res = await fetch("/danbooru_search/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tags: tags.value,
            page: pageNum,
            limit: pageLimit.value,
            rating_filter: ratingFilter.value,
            sort_order: sortOrder.value,
            min_score: Math.max(0, Number(minScore.value) || 0),
            min_favorites: Math.max(0, Number(minFavorites.value) || 0),
          }),
        });

        const data = await res.json();

        if (data.success) {
          const incoming = data.posts || [];
          if (replace) {
            posts.value = incoming;
          } else {
            // 去重追加
            const existIds = new Set(posts.value.map(p => String(p.id)));
            const merged = incoming.filter(p => !existIds.has(String(p.id)));
            posts.value = posts.value.concat(merged);
          }
          hasMore.value = typeof data.has_more === "boolean"
            ? data.has_more
            : incoming.length >= pageLimit.value;
        } else {
          errorMsg.value = data.error || "搜索失败";
          if (replace) posts.value = [];
          hasMore.value = false;
        }
      } catch (e) {
        errorMsg.value = "请求失败: " + e.message;
        if (replace) posts.value = [];
        hasMore.value = false;
      } finally {
        loading.value = false;
        loadingMore.value = false;
      }
    }

    function doSearch() {
      page.value = 1;
      hasMore.value = true;
      fetchPage(1, true);
    }

    function loadMore() {
      if (loading.value || loadingMore.value || !hasMore.value) return;
      page.value++;
      fetchPage(page.value, false);
    }

    async function searchPools() {
      if (!poolQuery.value.trim() || poolLoading.value) return;
      poolLoading.value = true;
      errorMsg.value = "";
      try {
        const response = await fetch("/danbooru_search/api/pools", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: poolQuery.value, category: "series", limit: 20 }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "Pool 搜索失败");
        poolResults.value = data.pools || [];
      } catch (error) {
        errorMsg.value = "Pool 搜索失败: " + error.message;
        poolResults.value = [];
      } finally { poolLoading.value = false; }
    }

    function usePool(pool) {
      tags.value = `pool:${pool.id}`;
      poolQuery.value = String(pool.name || "").replaceAll("_", " ");
      poolResults.value = [];
      doSearch();
    }

    function onScroll(e) {
      const el = e.target;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
        loadMore();
      }
    }

    function toggleSelect(post) {
      const id = String(post.id);
      if (selected.has(id)) {
        selected.delete(id);
        selectedPosts.value = selectedPosts.value.filter(p => String(p.id) !== id);
      } else {
        selected.add(id);
        selectedPosts.value.push({
          id: post.id,
          file_url: post.file_url,
          large_file_url: post.large_file_url,
          preview_file_url: post.preview_file_url,
          tags: flattenEffectiveTags(post),
          tag_groups: getEffectiveTags(post),
          rating: post.rating,
          width: post.image_width,
          height: post.image_height,
        });
      }
      syncSelection();
    }

    function removeSelection(id) {
      selected.delete(String(id));
      selectedPosts.value = selectedPosts.value.filter(p => String(p.id) !== String(id));
      syncSelection();
    }

    function clearSelection() {
      selected.clear();
      selectedPosts.value = [];
      syncSelection();
    }

    function syncSelection() {
      if (props.onSelectionChange) {
        props.onSelectionChange(selectedPosts.value);
      }
    }

    // 编辑面板改动后，如果该图已选中，更新其标签
    function onPostEdited(post) {
      const id = String(post.id);
      const sel = selectedPosts.value.find(p => String(p.id) === id);
      if (sel) {
        sel.tags = flattenEffectiveTags(post);
        sel.tag_groups = getEffectiveTags(post);
        syncSelection();
      }
    }

    function openDetail(post, e) {
      if (e) e.stopPropagation();
      detailPost.value = post;
    }

    function closeDetail() {
      detailPost.value = null;
    }

    function searchTagFromDetail(tag) {
      tags.value = tags.value ? (tags.value + " " + tag) : tag;
      closeDetail();
      doSearch();
    }

    onMounted(async () => {
      try {
        const res = await fetch("/danbooru_search/settings");
        const data = await res.json();
        if (data.success && data.settings) {
          if (data.settings.rating_filter) {
            ratingFilter.value = data.settings.rating_filter;
          }
          lazyLoadImages.value = data.settings.lazy_load_images !== false;
          // 缩略图并发设置只负责资源请求策略，不能改变远端分页大小或总量。
          // 保持固定页大小；滚动到末端后继续异步请求下一页。
          pageLimit.value = PAGE_LIMIT;
        }
      } catch (_) {
        // 设置接口不可用时沿用 general，不阻断图库。
      }
      if (tags.value) doSearch();
    });

    return () => {
      return h("div", { class: "dbg-panel" }, [
        h("div", { class: "dbg-search-bar" }, [
          h("input", {
            class: "dbg-input",
            type: "text",
            placeholder: "输入 Danbooru 标签搜索，例如：1girl solo",
            value: tags.value,
            onInput: e => { tags.value = e.target.value; },
            onKeydown: e => {
              if (e.key === "Enter") { e.preventDefault(); doSearch(); }
            },
          }),

          h("select", {
            class: "dbg-select",
            value: ratingFilter.value,
            onChange: e => { ratingFilter.value = e.target.value; },
          }, RATING_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

          h("select", {
            class: "dbg-select",
            value: sortOrder.value,
            title: "Danbooru 官方 order 排序",
            onChange: e => { sortOrder.value = e.target.value; doSearch(); },
          }, GALLERY_SORT_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

          h("button", { class: "dbg-btn primary", onClick: doSearch }, loading.value ? "搜索中…" : "🔍 搜索"),

          h("div", { class: "dbg-page-info" }, posts.value.length > 0 ? ("已加载 " + posts.value.length + " 张") : ""),
        ]),

        h("div", { class: "dbg-filter-bar" }, [
          h("label", {}, ["最低评分 ", h("input", {
            class: "dbg-number", type: "number", min: 0, value: minScore.value,
            onInput: e => { minScore.value = Math.max(0, Number(e.target.value) || 0); },
            onKeydown: e => { if (e.key === "Enter") doSearch(); },
          })]),
          h("label", {}, ["最低收藏 ", h("input", {
            class: "dbg-number", type: "number", min: 0, value: minFavorites.value,
            onInput: e => { minFavorites.value = Math.max(0, Number(e.target.value) || 0); },
            onKeydown: e => { if (e.key === "Enter") doSearch(); },
          })]),
          h("div", { class: "dbg-pool-search" }, [
            h("input", {
              class: "dbg-pool-input", value: poolQuery.value,
              placeholder: "系列 Pool 名称",
              onInput: e => { poolQuery.value = e.target.value; poolResults.value = []; },
              onKeydown: e => { if (e.key === "Enter") { e.preventDefault(); searchPools(); } },
            }),
            h("button", { class: "dbg-btn", disabled: poolLoading.value, onClick: searchPools }, poolLoading.value ? "查找中…" : "查系列"),
            poolResults.value.length ? h("div", { class: "dbg-pool-results" }, poolResults.value.map(pool => h("button", {
              title: `${pool.category || "pool"} · ${pool.post_count || 0} 张`,
              onClick: () => usePool(pool),
            }, [h("span", {}, String(pool.name || "").replaceAll("_", " ")), h("small", {}, pool.post_count || 0)]))) : null,
          ]),
          h("span", {}, "热门/收藏由服务端筛选；Pool 仅点击查找时请求。"),
        ]),

        h("div", {
          class: "dbg-grid",
          ref: gridRef,
          onScroll: onScroll,
        }, [
          errorMsg.value
            ? h("div", { class: "dbg-error" }, errorMsg.value)
            : loading.value && posts.value.length === 0
            ? h("div", { class: "dbg-loading" }, "🔄 加载中…")
            : posts.value.length === 0
            ? h("div", { class: "dbg-empty" }, "输入标签搜索 Danbooru 图库")
            : posts.value.map(post => {
                const id = String(post.id);
                const isSelected = selected.has(id);
                const edited = isPostEdited(post);

                return h("div", {
                  class: ["dbg-card", isSelected ? "selected" : ""],
                  key: id,
                  onClick: () => toggleSelect(post),
                  onContextmenu: e => { e.preventDefault(); openDetail(post, e); },
                }, [
                  edited ? h("div", { class: "dbs-edited-badge" }, "已编辑") : null,

                  h("div", { class: "dbg-img-box" }, [
                    h("img", {
                      class: "dbg-img",
                      src: proxiedImageUrl(post.preview_file_url || post.large_file_url),
                      loading: lazyLoadImages.value ? "lazy" : "eager",
                      onError: e => {
                        if (!e.target._errFixed) {
                          e.target._errFixed = true;
                          e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect fill='%23333'/%3E%3Ctext x='75' y='80' text-anchor='middle' fill='%23666' font-size='12'%3E加载失败%3C/text%3E%3C/svg%3E";
                        }
                      },
                    }),
                    // 悬浮编辑按钮
                    h("button", {
                      class: "dbg-edit-btn",
                      title: "编辑标签",
                      onClick: e => openDetail(post, e),
                    }, "✎"),
                  ]),

                  h("div", { class: "dbg-info" }, [
                    h("span", { class: "dbg-size" }, (post.image_width || "?") + " × " + (post.image_height || "?")),
                    h("span", {
                      class: "dbg-rating",
                      style: { background: getRatingColor(post.rating) },
                    }, getRatingLabel(post.rating)),
                  ]),

                  h("div", { class: "dbg-stats" }, [
                    h("span", {}, "♥ " + (post.fav_count || 0)),
                    h("span", {}, "★ " + (post.score || 0)),
                  ]),

                  isSelected ? h("div", { class: "dbg-check" }) : null,
                ]);
              }),

          // 底部加载提示
          posts.value.length > 0
            ? h("div", { class: "dbg-load-more" },
                loadingMore.value ? "🔄 加载更多…" : (hasMore.value ? "" : "— 没有更多了 —"))
            : null,
        ]),

        // 详情 / 编辑面板
        detailPost.value
          ? h(PostEditDialog, {
              post: detailPost.value,
              onClose: closeDetail,
              onSearchTag: searchTagFromDetail,
              onEdited: onPostEdited,
              onAddTags: props.onAddTags,
            })
          : null,
      ]);
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 子组件：已选预览条
// ════════════════════════════════════════════════════════════════════════════

const TagEditor = {
  name: "TagEditor",
  props: {
    tags: Array, collapsed: Boolean, onChange: Function, onAdd: Function,
    onToggleCollapse: Function, onGacha: Function, onClearGacha: Function,
    onOpenSettings: Function, gachaName: String, gachaLoading: Boolean,
    autoGacha: Boolean, onAutoGacha: Function, onClearAll: Function,
  },
  setup(props) {
    const input = ref("");
    const editingIndex = ref(-1);
    const hoverIndex = ref(-1);
    const dragIndex = ref(-1);
    const dropIndex = ref(-1);
    const selectedKeys = ref(new Set());
    const selectionAnchor = ref(-1);
    const listElement = ref(null);
    const marquee = ref(null);
    const activeMajor = ref("");
    const activeSub = ref("");
    function itemKey(item) { return String(item?.tag || "") + "\u0000" + String(item?.source || ""); }
    function setSelected(keys) { selectedKeys.value = new Set(keys); }
    function selectChip(index, event) {
      const items = props.tags || [];
      const key = itemKey(items[index]);
      const next = new Set(selectedKeys.value);
      if (event.shiftKey && selectionAnchor.value >= 0) {
        if (!event.ctrlKey && !event.metaKey) next.clear();
        const [start, end] = [selectionAnchor.value, index].sort((a, b) => a - b);
        for (let i = start; i <= end; i++) next.add(itemKey(items[i]));
      } else if (event.ctrlKey || event.metaKey) {
        next.has(key) ? next.delete(key) : next.add(key);
        selectionAnchor.value = index;
      } else if (!next.has(key)) {
        next.clear(); next.add(key); selectionAnchor.value = index;
      }
      setSelected(next);
    }
    function startMarquee(event) {
      if (event.button !== 0 || event.target.closest?.(".dbte-chip")) return;
      const el = listElement.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!event.ctrlKey && !event.metaKey) setSelected([]);
      marquee.value = { startX: event.clientX - rect.left, startY: event.clientY - rect.top, x: event.clientX - rect.left, y: event.clientY - rect.top, w: 0, h: 0, additive: event.ctrlKey || event.metaKey, base: new Set(selectedKeys.value) };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }
    function moveMarquee(event) {
      if (!marquee.value || !listElement.value) return;
      const rect = listElement.value.getBoundingClientRect();
      const currentX = event.clientX - rect.left;
      const currentY = event.clientY - rect.top;
      const box = {
        ...marquee.value,
        x: Math.min(marquee.value.startX, currentX),
        y: Math.min(marquee.value.startY, currentY),
        w: Math.abs(currentX - marquee.value.startX),
        h: Math.abs(currentY - marquee.value.startY),
      };
      marquee.value = box;
      const next = box.additive ? new Set(box.base) : new Set();
      listElement.value.querySelectorAll(".dbte-chip[data-tag-key]").forEach(chip => {
        const chipRect = chip.getBoundingClientRect();
        const relative = { left: chipRect.left - rect.left, right: chipRect.right - rect.left, top: chipRect.top - rect.top, bottom: chipRect.bottom - rect.top };
        if (relative.right >= box.x && relative.left <= box.x + box.w && relative.bottom >= box.y && relative.top <= box.y + box.h) next.add(chip.dataset.tagKey);
      });
      setSelected(next);
    }
    function finishMarquee(event) {
      if (!marquee.value) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      marquee.value = null;
    }
    function emit(items) { props.onChange && props.onChange(items); }
    function addManual() {
      const values = splitPromptTags(input.value);
      if (values.length && props.onAdd) props.onAdd(values.map(tag => ({ tag, source: "manual", kind: "manual" })));
      input.value = "";
    }
    function updateAt(index, patch) {
      emit((props.tags || []).map((item, i) => i === index ? { ...item, ...patch } : item));
    }
    function removeAt(index) { emit((props.tags || []).filter((_, i) => i !== index)); }
    function reorder(from, target) {
      if (from < 0 || target < 0 || from === target || from >= (props.tags || []).length || target >= (props.tags || []).length) return;
      const items = (props.tags || []).slice();
      const draggedKey = itemKey(items[from]);
      if (!selectedKeys.value.has(draggedKey)) setSelected([draggedKey]);
      const movingKeys = new Set(selectedKeys.value.has(draggedKey) ? selectedKeys.value : [draggedKey]);
      const targetKey = itemKey(items[target]);
      if (movingKeys.has(targetKey)) return;
      const moving = items.filter(item => movingKeys.has(itemKey(item)));
      const remaining = items.filter(item => !movingKeys.has(itemKey(item)));
      const insertAt = Math.max(0, remaining.findIndex(item => itemKey(item) === targetKey));
      remaining.splice(insertAt, 0, ...moving);
      emit(remaining);
      editingIndex.value = -1;
      hoverIndex.value = Math.min(insertAt, remaining.length - 1);
    }
    function finishDrag() {
      dragIndex.value = -1;
      dropIndex.value = -1;
    }
    return () => {
      const taxonomyGroups = buildTagTaxonomy(props.tags || []);
      // The output strip always shows the complete ordered tag list. Category
      // management lives in the dedicated manager under the gacha constraints.
      const grouped = false;
      const currentMajor = taxonomyGroups.some(group => group.key === activeMajor.value) ? activeMajor.value : (taxonomyGroups[0]?.key || "");
      const majorGroup = taxonomyGroups.find(group => group.key === currentMajor);
      const currentSub = majorGroup?.subKeys.includes(activeSub.value) ? activeSub.value : (majorGroup?.subKeys[0] || "");
      const visibleEntries = grouped
        ? (majorGroup?.entries || []).filter(entry => !currentSub || entry.sub === currentSub)
        : (props.tags || []).map((item, index) => ({ item, index }));
      const inspectorIndex = editingIndex.value >= 0 ? editingIndex.value : hoverIndex.value;
      const inspectorItem = (props.tags || [])[inspectorIndex];
      const inspectorCn = inspectorItem ? resolveTranslation(inspectorItem.tag, inspectorItem.translation) : "";
      const inspectorWeight = inspectorItem ? Number(inspectorItem.weight == null ? 1 : inspectorItem.weight) : 1;
      const inspectorWeightText = Number.isInteger(inspectorWeight) ? inspectorWeight.toFixed(1) : String(Math.round(inspectorWeight * 100) / 100);
      return h("div", { class: ["dbte", props.collapsed ? "expanded" : ""] }, [
      h("div", { class: "dbte-head" }, [
        h("strong", {}, "🏷️ 输出标签 " + (props.tags || []).filter(item => item.enabled !== false).length + " / " + (props.tags || []).length),
        h("span", { class: "dbte-spacer" }),
        h("button", { class: ["dbs-btn", props.collapsed ? "primary" : ""], onClick: props.onToggleCollapse }, props.collapsed ? "展开画廊" : "折叠画廊"),
        h("button", {
          class: "dbs-btn gacha", disabled: props.gachaLoading || props.autoGacha, onClick: props.onGacha,
          title: props.autoGacha ? "自动换卡由工作流执行时生成；关闭自动换卡后可手动抽取并编辑" : "手动抽取一组可编辑标签",
        }, props.gachaLoading ? "匹配中…" : props.autoGacha ? "自动换卡已开启" : "🎴 抽取角色外内容"),
        h("label", { class: "dbte-auto", title: "开启后 ComfyUI 每次执行都会根据前置 character_tags 更换组合" }, [
          h("input", { type: "checkbox", checked: !!props.autoGacha, onChange: e => props.onAutoGacha && props.onAutoGacha(e.target.checked) }),
          "每次执行换卡",
        ]),
        props.gachaName ? h("span", { class: "dbs-gacha-name" }, props.gachaName) : null,
        props.gachaName ? h("button", { class: "dbs-btn small", onClick: props.onClearGacha }, "清除抽卡") : null,
        selectedKeys.value.size ? h("span", { class: "dbte-selection-count" }, "已框选 " + selectedKeys.value.size) : null,
        selectedKeys.value.size ? h("button", { class: "dbs-btn small", onClick: () => navigator.clipboard?.writeText((props.tags || []).filter(item => selectedKeys.value.has(itemKey(item)) && item.enabled !== false).map(item => item.tag.replace(/_/g, " ")).join(", ")).catch(() => {}) }, "复制框选") : null,
        (props.tags || []).length ? h("button", { class: "dbs-btn small", onClick: () => navigator.clipboard?.writeText((props.tags || []).filter(item => item.enabled !== false).map(item => {
          const tag = item.tag.replace(/_/g, " ");
          const weight = Number(item.weight == null ? 1 : item.weight);
          return Math.abs(weight - 1) < 0.0001 ? tag : "(" + tag + ":" + (Math.round(weight * 100) / 100) + ")";
        }).join(", ")).catch(() => {}) }, "复制全部") : null,
        (props.tags || []).length ? h("button", { class: "dbs-btn small danger", onClick: props.onClearAll }, "清空") : null,
        h("button", { class: "dbs-btn", title: "Danbooru / 抽卡模型设置", onClick: props.onOpenSettings }, "⚙"),
      ]),
      h("div", { class: ["dbte-body", inspectorItem ? "has-inspector" : ""] }, [
      h("div", { class: "dbte-tags-pane" }, [
      h("div", { class: "dbte-add" }, [
        h("span", { class: "dbte-tip" }, "character_tags 固定角色特征优先合并，不被抽卡改写"),
        h("input", { class: "dbs-input-line", placeholder: "手动添加标签，逗号分隔", value: input.value,
          onInput: e => { input.value = e.target.value; }, onKeydown: e => { if (e.key === "Enter") addManual(); } }),
        h("button", { class: "dbs-btn", onClick: addManual }, "+ 添加"),
      ]),
      grouped ? h("div", { class: "dbte-taxonomy" }, [
        h("div", { class: "dbte-major-tabs" }, taxonomyGroups.map(group => h("button", {
          class: currentMajor === group.key ? "active" : "",
          onClick: () => { activeMajor.value = group.key; activeSub.value = group.subKeys[0] || ""; },
        }, [group.label, h("span", {}, String(group.entries.length))]))),
        majorGroup?.subKeys.length > 1 ? h("div", { class: "dbte-sub-tabs" }, majorGroup.subKeys.map(key => h("button", {
          class: currentSub === key ? "active" : "",
          onClick: () => { activeSub.value = key; },
        }, [TAG_SUBGROUP_LABELS[key] || key, h("span", {}, String(majorGroup.entries.filter(entry => entry.sub === key).length))]))) : null,
      ]) : null,
      h("div", {
        class: "dbte-list",
        ref: listElement,
        onPointerdown: startMarquee,
        onPointermove: moveMarquee,
        onPointerup: finishMarquee,
        onPointercancel: finishMarquee,
      }, visibleEntries.length ? visibleEntries.map(({ item, index }) => {
        const cn = resolveTranslation(item.tag, item.translation);
        const key = itemKey(item);
        const weight = Number(item.weight == null ? 1 : item.weight);
        const weightText = Number.isInteger(weight) ? weight.toFixed(1) : String(Math.round(weight * 100) / 100);
        return h("div", {
          class: ["dbte-chip", "kind-" + (item.kind || item.category || "general"), item.enabled === false ? "disabled" : "", selectedKeys.value.has(key) ? "group-selected" : "", dragIndex.value === index ? "dragging" : "", dropIndex.value === index ? "drop-target" : ""],
          key: (item.tag || "tag") + "-" + index,
          "data-tag-key": key,
          draggable: true,
          title: "空白处拖框多选；Ctrl/Shift 追加；拖动任一已选标签可整组移动",
          onPointerdown: e => selectChip(index, e),
          onMouseenter: () => { if (editingIndex.value < 0) hoverIndex.value = index; },
          onContextmenu: e => { e.preventDefault(); editingIndex.value = editingIndex.value === index ? -1 : index; },
          onDblclick: () => updateAt(index, { enabled: item.enabled === false }),
          onDragstart: e => {
            e.stopPropagation();
            dragIndex.value = index;
            dropIndex.value = index;
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(index));
            }
          },
          onDragover: e => { e.preventDefault(); e.stopPropagation(); dropIndex.value = index; if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; },
          onDrop: e => { e.preventDefault(); e.stopPropagation(); reorder(dragIndex.value, index); finishDrag(); },
          onDragend: finishDrag,
        }, [
          h("span", { class: "dbte-drag-handle", title: "拖拽排序" }, "⠿"),
          h("span", { class: "dbte-text" }, [
            danbooruUiSettings.tagDisplayLanguage !== "zh" || !cn ? h("span", { class: "dbte-name" }, item.tag.replace(/_/g, " ")) : h("span", { class: "dbte-name" }, cn),
            danbooruUiSettings.tagDisplayLanguage === "bilingual" ? h("span", { class: "dbte-cn" }, cn || "未翻译") : null,
          ]),
          Math.abs(weight - 1) > 0.0001 ? h("span", { class: "dbte-weight-badge" }, weightText) : null,
        ]);
      }).concat(marquee.value ? [h("div", { class: "dbte-marquee", style: { left: marquee.value.x + "px", top: marquee.value.y + "px", width: marquee.value.w + "px", height: marquee.value.h + "px" } })] : []) : [h("div", { class: "dbte-empty" }, (props.tags || []).length ? "当前分类暂无标签" : "从语义搜索、图片详情高亮或角色抽卡加入标签")]),
      ]),
      inspectorItem ? h("div", { class: ["dbte-inspector", editingIndex.value >= 0 ? "pinned" : ""] }, [
        h("div", { class: "dbte-pop-head" }, [
          h("strong", {}, inspectorItem.tag),
          h("span", { class: "dbte-source" }, "来源: " + (inspectorItem.source || "manual")),
          editingIndex.value >= 0 ? h("button", { class: "dbte-toggle", onClick: () => { editingIndex.value = -1; } }, "取消固定") : h("span", { class: "dbte-source" }, "右键标签可固定"),
        ]),
        h("div", { class: "dbte-pop-row" }, [
          h("label", {}, ["用途 ", h("select", { class: "dbte-kind-select", value: inspectorItem.kind || "general", onChange: e => updateAt(inspectorIndex, { kind: e.target.value }) },
            ["general", "outfit", "action", "expression", "scene", "environment", "composition", "lighting", "quality", "manual", "semantic", "detail"].map(kind => h("option", { value: kind }, TAG_KIND_LABELS[kind] || kind))
          )]),
          h("label", {}, ["Danbooru 类型 ", h("select", { class: "dbte-kind-select", value: inspectorItem.category || "general", onChange: e => updateAt(inspectorIndex, { category: e.target.value }) },
            ["general", "character", "copyright", "artist", "meta"].map(kind => h("option", { value: kind }, kind))
          )]),
          h("label", {}, ["权重 ", h("input", { class: "dbte-weight", type: "number", step: 0.1, value: inspectorWeightText,
            title: "支持任意有限数值；常用范围通常为 0–2",
            style: { width: Math.max(3.5, inspectorWeightText.length + 1) + "ch" }, onChange: e => {
              const value = Number(e.target.value);
              updateAt(inspectorIndex, { weight: Number.isFinite(value) ? value : 1 });
            } })]),
        ]),
        h("label", { class: "dbte-translation" }, ["译名 ", h("input", { value: inspectorCn, placeholder: "可选中文说明", onChange: e => updateAt(inspectorIndex, { translation: e.target.value.trim() }) })]),
        h("div", { class: "dbte-pop-row actions" }, [
          h("button", { class: "dbte-toggle", onClick: () => updateAt(inspectorIndex, { enabled: inspectorItem.enabled === false }) }, inspectorItem.enabled === false ? "恢复输出" : "屏蔽输出"),
          h("button", { class: "dbte-toggle", onClick: () => navigator.clipboard?.writeText(inspectorItem.tag.replace(/_/g, " ")).catch(() => {}) }, "复制"),
          h("button", { class: "dbte-toggle", onClick: () => updateAt(inspectorIndex, { weight: 1 }) }, "重置权重"),
          h("span", { class: "dbte-drag-note" }, "⠿ 直接拖动上方标签排序"),
          h("button", { class: "dbte-remove", onClick: () => { removeAt(inspectorIndex); editingIndex.value = -1; hoverIndex.value = -1; } }, "删除"),
        ]),
      ]) : null,
      ]),
    ]);
    };
  },
};

const TagCategoryManager = {
  name: "TagCategoryManager",
  props: { tags: Array, onChange: Function },
  setup(props) {
    const activeMajor = ref("all");
    const selected = reactive(new Set());
    const targetKind = ref("general");
    const keyOf = (item, index) => String(item?.tag || "") + "\u0000" + String(item?.source || "") + "\u0000" + index;
    const entries = computed(() => (props.tags || []).map((item, index) => ({ item, index, key: keyOf(item, index), ...inferTagTaxonomy(item) })));
    const groups = computed(() => [
      { key: "all", label: "全部", count: entries.value.length },
      ...TAG_MAJOR_GROUPS.map(group => ({ ...group, count: entries.value.filter(entry => entry.major === group.key).length }))
    ]);
    const visible = computed(() => activeMajor.value === "all" ? entries.value : entries.value.filter(entry => entry.major === activeMajor.value));

    function toggle(entry) {
      if (selected.has(entry.key)) selected.delete(entry.key); else selected.add(entry.key);
    }
    function selectVisible() { visible.value.forEach(entry => selected.add(entry.key)); }
    function applyCategory() {
      if (!selected.size) return;
      const next = (props.tags || []).map((item, index) => selected.has(keyOf(item, index)) ? { ...item, kind: targetKind.value } : item);
      props.onChange && props.onChange(next);
      selected.clear();
    }

    return () => h("div", { class: "dbcm" }, [
      h("div", { class: "dbcm-head" }, [
        h("strong", {}, "标签分类管理器"),
        h("span", {}, "顶部始终显示完整标签；在这里单独整理用途分类")
      ]),
      h("div", { class: "dbcm-tabs" }, groups.value.map(group => h("button", {
        class: activeMajor.value === group.key ? "active" : "", onClick: () => { activeMajor.value = group.key; }
      }, [group.label, h("small", {}, String(group.count))]))),
      h("div", { class: "dbcm-tools" }, [
        h("button", { class: "dbs-btn small", onClick: selectVisible }, "选择当前分类"),
        h("button", { class: "dbs-btn small", disabled: !selected.size, onClick: () => selected.clear() }, "取消选择"),
        h("span", {}, "已选 " + selected.size),
        h("select", { class: "dbs-select", value: targetKind.value, onChange: event => { targetKind.value = event.target.value; } },
          ["appearance", "outfit", "action", "expression", "scene", "environment", "composition", "lighting", "quality", "general"].map(kind => h("option", { value: kind }, TAG_KIND_LABELS[kind] || kind))),
        h("button", { class: "dbs-btn primary", disabled: !selected.size, onClick: applyCategory }, "应用分类")
      ]),
      h("div", { class: "dbcm-tags" }, visible.value.length ? visible.value.map(entry => {
        const cn = resolveTranslation(entry.item.tag, entry.item.translation);
        const text = danbooruUiSettings.tagDisplayLanguage === "zh" && cn
          ? cn
          : entry.item.tag.replace(/_/g, " ") + (danbooruUiSettings.tagDisplayLanguage === "bilingual" && cn ? " · " + cn : "");
        return h("button", {
          class: ["dbcm-tag", selected.has(entry.key) ? "selected" : "", "major-" + entry.major],
          title: (TAG_KIND_LABELS[entry.item.kind] || entry.item.kind || "通用") + " / " + (TAG_SUBGROUP_LABELS[entry.sub] || entry.sub),
          onClick: () => toggle(entry)
        }, text);
      }) : [h("span", { class: "dbcm-empty" }, "当前分类没有标签")])
    ]);
  }
};

const SelectionBar = {
  name: "SelectionBar",
  props: {
    selections: Array,
    onRemove: Function,
    onClear: Function,
  },
  setup(props) {
    return () => {
      const selections = props.selections || [];

      if (selections.length === 0) {
        return h("div", { class: "dbsb-empty" }, "点击中间图片加入输出列表");
      }

      return h("div", { class: "dbsb-wrap vertical" }, [
        h("div", { class: "dbsb-title" }, "已选图像 (" + selections.length + ")"),
        h("div", { class: "dbsb-list" }, selections.map(sel => {
          return h("div", { class: "dbsb-item", key: sel.id }, [
            h("img", {
              class: "dbsb-thumb",
              src: proxiedImageUrl(sel.preview_file_url || sel.large_file_url),
            }),
            h("span", { class: "dbsb-name" }, "#" + sel.id),
            h("button", {
              class: "dbsb-remove",
              onClick: () => props.onRemove && props.onRemove(sel.id),
              title: "移除",
            }, "×"),
          ]);
        })),

        h("div", { class: "dbsb-info" }, [
          h("button", {
            class: "dbsb-btn",
            onClick: () => props.onClear && props.onClear(),
          }, "清除"),
        ]),
      ]);
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 子组件：设置弹窗
// ════════════════════════════════════════════════════════════════════════════

const TagLibraryPanel = {
  name: "TagLibraryPanel",
  props: {
    node: { type: Object, required: true },
  },
  setup(props) {
    const info = ref(null), error = ref(""), busy = ref(false);
    const pages = ref(10), batch = ref(20);
    const enrichmentEnabled = ref(false);
    let timer = null, alive = true;
    function selectionWidget() {
      return (props.node.widgets || []).find(item => item.name === "selection_data");
    }
    function readSelectionPayload() {
      try { return JSON.parse(selectionWidget()?.value || "{}"); }
      catch (_) { return {}; }
    }
    function saveEnrichmentState(enabled) {
      const widget = selectionWidget();
      if (!widget) throw new Error("找不到 selection_data，刷新页面或重新创建节点后再试。");
      const payload = readSelectionPayload();
      payload.library_enrichment_enabled = !!enabled;
      payload.library_enrichment_batch = Math.min(50, Math.max(1, Number(batch.value) || 1));
      delete payload.library_fill_request;
      widget.value = JSON.stringify(payload);
      if (typeof widget.callback === "function") widget.callback(widget.value, widget, props.node);
      props.node.graph?.change?.();
      props.node.graph?.setDirtyCanvas?.(true, true);
      enrichmentEnabled.value = !!enabled;
    }
    async function refresh() {
      clearTimeout(timer);
      try {
        const res = await fetch("/danbooru_search/library");
        const data = await readJsonResponse(res, "词库状态接口");
        if (!res.ok || !data.success) throw new Error(data.error || "读取词库状态失败");
        if (!alive) return;
        info.value = data;
        Object.assign(libraryFacetLabels, data.facets || {});
        if (data.job.running) timer = setTimeout(refresh, 2500);
      } catch (e) { if (alive) error.value = e.message; }
    }
    async function run(action, extra = {}) {
      busy.value = true; error.value = "";
      try {
        const res = await fetch("/danbooru_search/library", { method: "POST",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, pages: pages.value, batch: batch.value, ...extra }) });
        const data = await readJsonResponse(res, "词库任务接口");
        if (!res.ok || !data.success) throw new Error(data.error || "任务失败");
        if (action === "review") {
          for (const key of Object.keys(translationCache)) delete translationCache[key];
        }
        await refresh();
      } catch (e) { error.value = e.message; }
      finally { busy.value = false; }
    }
    function inputConnected(name) {
      const input = (props.node?.inputs || []).find(item => item?.name === name);
      return !!input && (input.link != null || (Array.isArray(input.links) && input.links.length > 0));
    }
    async function togglePortFill() {
      error.value = "";
      if (enrichmentEnabled.value) {
        try {
          saveEnrichmentState(false);
          error.value = "已关闭模型词库补全；正在执行的单批不会强制中断。";
        } catch (e) { error.value = e.message; }
        return;
      }
      if (!inputConnected("local_model") && !inputConnected("api_config")) {
        error.value = "请先在节点左侧连接 local_model 或 api_config；本地模型端口优先。";
        return;
      }
      busy.value = true;
      try {
        saveEnrichmentState(true);
        await app.queuePrompt(0);
        error.value = "✅ 已启用并提交首批；以后每次正常执行工作流时只处理一批。";
        setTimeout(refresh, 800);
      } catch (e) {
        try { saveEnrichmentState(false); } catch (_) {}
        error.value = "提交模型填充失败：" + e.message;
      } finally {
        busy.value = false;
      }
    }
    onMounted(() => {
      const payload = readSelectionPayload();
      enrichmentEnabled.value = !!payload.library_enrichment_enabled;
      if (Number(payload.library_enrichment_batch) > 0) {
        batch.value = Math.min(50, Math.max(1, Number(payload.library_enrichment_batch)));
      }
      refresh();
    });
    onBeforeUnmount(() => { alive = false; clearTimeout(timer); });
    return () => {
      const data = info.value, running = busy.value || data?.job?.running;
      const button = (label, action) => h("button", { class: "dbs-btn", disabled: running, onClick: () => run(action) }, label);
      const bootstrap = data?.bootstrap || {};
      const progress = data?.job?.progress || {};
      const progressLabel = progress.stage === "groups" ? "Wiki 标签组" : progress.stage === "tags" ? "官方标签" : progress.stage === "seed" ? "随附词表" : "准备中";
      return h("section", { class: "dbs-setting-section" }, [
        h("h4", {}, "本地词库 · 同步 / 翻译 / 审核"),
        h("p", { class: "dbs-setting-desc" }, "首次初始化依次导入随附词表、续传 Wiki 分组和官方标签，只读取元数据、不抓图片。完成阶段不会重复执行；中断后从事务断点继续。"),
        data ? h("p", {}, `本地 ${data.status.total} 条 · 原表译名 ${data.status.translated} 条 · API 更新 ${data.status.official} 条 · Wiki 组 ${data.status.groups} 个 · 已审核 ${data.status.annotations.approved || 0} 条 · 待审核 ${data.status.annotations.pending || 0} 条`) : null,
        data ? h("div", { class: ["dbs-bootstrap-card", bootstrap.ready ? "ready" : "pending"] }, [
          h("strong", {}, bootstrap.ready ? "✅ 首次词库初始化已完成" : "⏳ 首次词库尚未完成"),
          h("span", {}, bootstrap.ready
            ? `官方标签与 Wiki 组均已抵达结束页；建议约 ${bootstrap.refresh_days || 30} 天后再手动刷新。`
            : `当前阶段：${bootstrap.stage === "groups" ? "Wiki 标签组" : "官方标签"}；已保存官方记录 ${bootstrap.tag_records || 0} 条。`),
          h("button", { class: "dbs-btn primary", disabled: running || bootstrap.ready, onClick: () => run("bootstrap") }, bootstrap.tag_records ? "继续首次初始化" : "开始首次初始化"),
        ]) : null,
        h("div", { class: "dbs-setting-checks" }, [button("导入/补充随附词表", "seed"),
          h("label", {}, ["每轮页数 ", h("input", { type: "number", min: 0, value: pages.value, style: { width: "80px" }, onInput: e => { pages.value = Math.max(0, Number(e.target.value) || 0); } })]),
          button("手动同步/续传官方标签", "tags"), button("手动同步/续传 Wiki 组", "groups"),
        ]),
        h("p", { class: "dbs-setting-desc" }, "一键首次初始化会运行到结束；手动同步默认 10 页，每页至多 1000 条，0 表示运行到结束。请求节奏读取已保存的连接设置；429/5xx 退避，403、跳转或验证页立即停止。"),
        h("div", { class: "dbs-setting-checks" }, [
          h("label", {}, ["翻译单批 ", h("input", { type: "number", min: 1, max: 50, value: batch.value, style: { width: "80px" }, onInput: e => { batch.value = Math.min(50, Math.max(1, Number(e.target.value) || 1)); } })]),
          button("④ 检索本批官方释义", "wiki"),
          h("button", {
            class: ["dbs-btn", enrichmentEnabled.value ? "danger" : "primary"],
            disabled: busy.value,
            onClick: togglePortFill,
          }, enrichmentEnabled.value ? "模型补全：已启用 · 点击关闭" : "模型补全：已关闭 · 点击启用"),
          button("导出 JSONL + 已审核 Markdown", "export"),
          h("button", { class: "dbs-btn", disabled: !data?.job?.running, onClick: () => run("stop") }, "停止采集并保留断点"),
          h("button", { class: "dbs-btn", onClick: refresh }, "刷新状态"),
        ]),
        h("p", { class: "dbs-setting-desc" }, "这不是首次连接或数据库校验。开关只控制“每次工作流执行时，用画布已连接模型翻译/细分类一批”；local_model 优先，未连接时才用 api_config。结果先进入待审核，不会自动采用，也不会自行循环排队。"),
        h("p", { role: "status" }, data?.job?.message || "读取中…"),
        data?.job?.running ? h("p", { class: "dbs-library-progress" }, `${progressLabel} · 本轮 ${progress.pages_this_run || 0} 页 · 已记录 ${progress.records || 0} 条 · 断点 ${progress.cursor || "准备中"}`) : null,
        error.value ? h("p", { role: "alert" }, error.value) : null,
        ...(data?.pending || []).map(item => h("div", { class: "dbs-status-card", key: item.name }, [
          h("strong", {}, item.name + " → " + (item.cn_name || "译名不确定")),
          h("span", {}, item.facets.map(key => libraryFacetLabels[key] || key).join("、") || "尚未分类"),
          h("span", {}, `评级 ${item.rating} · 置信度 ${item.confidence} · ${item.model}`),
          h("span", {}, item.note),
          h("div", { class: "dbs-setting-checks" }, [
            h("button", { class: "dbs-btn", disabled: running, onClick: () => run("review", { name: item.name, approve: true }) }, "核对无误，采用"),
            h("button", { class: "dbs-btn", disabled: running, onClick: () => run("review", { name: item.name, approve: false }) }, "拒绝"),
          ]),
        ])),
      ]);
    };
  },
};

const SettingsDialog = {
  name: "SettingsDialog",
  props: {
    visible: Boolean,
    onClose: Function,
    onSaved: Function,
    initialTab: String,
    node: { type: Object, required: true },
  },
  setup(props) {
    const activeTab = ref(props.initialTab || "general");
    const tagDisplayLanguage = ref("bilingual");
    const groupOutputTags = ref(false);
    const includeSelectedImageTags = ref(true);
    const underscoreMode = ref("space");
    const normalizePunctuation = ref(true);
    const defaultGalleryCollapsed = ref(false);
    const modelPath = ref("");
    const username = ref("");
    const apiKey = ref("");
    const ratingFilter = ref("general");
    const hideAi = ref(true);
    const proxyUrl = ref("");
    const apiBaseUrl = ref("https://danbooru.donmai.us");
    const libraryRequestInterval = ref(3);
    const libraryRequestJitter = ref(1);
    const libraryPauseEveryPages = ref(25);
    const libraryPauseSeconds = ref(15);
    const libraryRefreshDays = ref(30);
    const enableModelCalls = ref(false);
    const searchMode = ref("hybrid");
    const searchTopK = ref(80);
    const searchResultLimit = ref(80);
    const searchPopularityWeight = ref(0.15);
    const searchTagTypes = ref(["General", "Artist", "Copyright", "Character", "Meta"]);
    const semanticUseLibrary = ref(true);
    const semanticLibraryLimit = ref(60000);
    const semanticLibraryMinPostCount = ref(100);
    const semanticTestStatus = ref("");
    const testingSemantic = ref(false);
    const gachaProvider = ref("database");
    const gachaCounts = ref({ outfit: 2, action: 2, expression: 1, scene: 2, environment: 2, composition: 1, lighting: 1 });
    const gachaFacetCounts = ref({});
    const gachaAllocationMode = ref("smart");
    const gachaDensity = ref("balanced");
    const gachaCategoryModes = ref(Object.fromEntries(Object.keys(PROMPT_KIND_LABELS).map(key => [key, "auto"])));
    const gachaFacetModes = ref({});
    const gachaModelPlanning = ref(true);
    const selectedGachaFacetGroups = ref(["styling"]);
    const libraryModelProvider = ref("comfyui_model");
    const gachaAvoidDuplicates = ref(true);
    const gachaSeed = ref(-1);
    const gachaOnlineQuery = ref("");
    const gachaMinPostCount = ref(5000);
    const gachaApiProfile = ref("");
    const gachaLocalUrl = ref("http://127.0.0.1:11434/v1");
    const gachaLocalModel = ref("");
    const gachaComfyModel = ref("");
    const gachaComfyDevice = ref("auto");
    const gachaComfyDtype = ref("bf16");
    const exclusiveModelMemory = ref(true);
    const historyLimit = ref(50);
    const thumbnailConcurrency = ref(6);
    const lazyLoadImages = ref(true);
    const gachaProfiles = ref([]);
    const localModels = ref([]);
    const ollamaModels = ref([]);
    const tagDataStatus = ref(null);
    const reloadingTags = ref(false);
    const saving = ref(false);
    const errorMsg = ref("");
    const importInput = ref(null);

    async function scanOllama() {
      try {
        const res = await fetch("/danbooru_search/ollama_models");
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Ollama 连接失败");
        ollamaModels.value = data.models || [];
        gachaLocalUrl.value = data.base_url;
        libraryModelProvider.value = "local_openai";
        const names = ollamaModels.value.map(model => model.name);
        if (!names.includes(gachaLocalModel.value)) {
          gachaLocalModel.value = names.find(name => /^qwen.*27b/i.test(name))
            || names.find(name => /^gemma.*12b/i.test(name))
            || names[0]
            || "";
        }
        errorMsg.value = gachaLocalModel.value
          ? `✅ 已连接 Ollama，发现 ${names.length} 个模型，已选 ${gachaLocalModel.value}；保存后生效`
          : "Ollama 已连接，但未发现可用模型";
      } catch (e) { errorMsg.value = e.message; }
    }

    const tabs = [
      ["general", "通用"], ["connection", "Danbooru 连接"], ["search", "搜索与匹配"],
      ["data", "标签数据"], ["gacha", "抽卡"], ["models", "模型"], ["workspace", "工作区与性能"],
    ];

    function applySettings(s) {
      tagDisplayLanguage.value = s.tag_display_language || "bilingual";
      groupOutputTags.value = false;
      includeSelectedImageTags.value = s.include_selected_image_tags !== false;
      applyDanbooruUiSettings(s);
      underscoreMode.value = s.underscore_mode || "space";
      normalizePunctuation.value = s.normalize_punctuation !== false;
      defaultGalleryCollapsed.value = s.default_gallery_collapsed === true;
      modelPath.value = s.model_path || "";
      username.value = s.danbooru_username || "";
      apiKey.value = s.danbooru_api_key || "";
      ratingFilter.value = s.rating_filter || "general";
      hideAi.value = s.hide_ai !== false;
      proxyUrl.value = s.proxy_url || "";
      apiBaseUrl.value = s.api_base_url || "https://danbooru.donmai.us";
      libraryRequestInterval.value = Number(s.library_request_interval ?? 3);
      libraryRequestJitter.value = Number(s.library_request_jitter ?? 1);
      libraryPauseEveryPages.value = Number(s.library_pause_every_pages ?? 25);
      libraryPauseSeconds.value = Number(s.library_pause_seconds ?? 15);
      libraryRefreshDays.value = Number(s.library_refresh_days ?? 30);
      searchMode.value = s.search_mode || "hybrid";
      searchTopK.value = Number(s.search_top_k || 80);
      searchResultLimit.value = Number(s.search_result_limit || 80);
      searchPopularityWeight.value = Number(s.search_popularity_weight ?? 0.15);
      searchTagTypes.value = Array.isArray(s.search_tag_types) ? s.search_tag_types.slice() : ["General", "Artist", "Copyright", "Character", "Meta"];
      semanticUseLibrary.value = s.semantic_use_library !== false;
      semanticLibraryLimit.value = Number(s.semantic_library_limit || 60000);
      semanticLibraryMinPostCount.value = Number(s.semantic_library_min_post_count ?? 100);
      enableModelCalls.value = s.enable_model_calls === true;
      gachaProvider.value = s.gacha_provider || "database";
      gachaCounts.value = { ...gachaCounts.value, ...(s.gacha_category_counts || {}) };
      gachaFacetCounts.value = { ...(s.gacha_facet_counts || {}) };
      gachaAllocationMode.value = s.gacha_allocation_mode || "smart";
      gachaDensity.value = s.gacha_density || "balanced";
      gachaCategoryModes.value = { ...gachaCategoryModes.value, ...(s.gacha_category_modes || {}) };
      gachaFacetModes.value = { ...(s.gacha_facet_modes || {}) };
      selectedGachaFacetGroups.value = Array.isArray(s.gacha_facet_group_preferences)
        ? [...new Set(s.gacha_facet_group_preferences.filter(key => GACHA_FACET_GROUPS.some(group => group.key === key)))]
        : ["styling"];
      gachaModelPlanning.value = s.gacha_model_planning !== false;
      libraryModelProvider.value = s.library_model_provider || "comfyui_model";
      gachaAvoidDuplicates.value = s.gacha_avoid_duplicates !== false;
      gachaSeed.value = Number(s.gacha_seed ?? -1);
      gachaOnlineQuery.value = s.gacha_online_query || "";
      gachaMinPostCount.value = Number(s.gacha_min_post_count || 5000);
      gachaApiProfile.value = s.gacha_api_profile || "";
      gachaLocalUrl.value = s.gacha_local_url || "http://127.0.0.1:11434/v1";
      gachaLocalModel.value = s.gacha_local_model || "";
      gachaComfyModel.value = s.gacha_comfy_model || "";
      gachaComfyDevice.value = s.gacha_comfy_device || "auto";
      gachaComfyDtype.value = s.gacha_comfy_dtype || "bf16";
      exclusiveModelMemory.value = s.exclusive_model_memory !== false;
      historyLimit.value = Number(s.history_limit || 50);
      thumbnailConcurrency.value = Number(s.thumbnail_concurrency || 6);
      lazyLoadImages.value = s.lazy_load_images !== false;
    }

    function collectSettings() {
      return {
        tag_display_language: tagDisplayLanguage.value,
        group_output_tags: false,
        include_selected_image_tags: includeSelectedImageTags.value,
        underscore_mode: underscoreMode.value, normalize_punctuation: normalizePunctuation.value,
        default_gallery_collapsed: defaultGalleryCollapsed.value, model_path: modelPath.value,
        danbooru_username: username.value, danbooru_api_key: apiKey.value,
        rating_filter: ratingFilter.value, hide_ai: hideAi.value, proxy_url: proxyUrl.value,
        api_base_url: apiBaseUrl.value,
        library_request_interval: libraryRequestInterval.value,
        library_request_jitter: libraryRequestJitter.value,
        library_pause_every_pages: libraryPauseEveryPages.value,
        library_pause_seconds: libraryPauseSeconds.value,
        library_refresh_days: libraryRefreshDays.value,
        search_mode: searchMode.value,
        search_top_k: searchTopK.value, search_result_limit: searchResultLimit.value,
        search_popularity_weight: searchPopularityWeight.value, search_tag_types: searchTagTypes.value,
        semantic_use_library: semanticUseLibrary.value,
        semantic_library_limit: semanticLibraryLimit.value,
        semantic_library_min_post_count: semanticLibraryMinPostCount.value,
        enable_model_calls: enableModelCalls.value, gacha_provider: gachaProvider.value,
        gacha_category_counts: gachaCounts.value, gacha_avoid_duplicates: gachaAvoidDuplicates.value,
        gacha_facet_counts: gachaFacetCounts.value, library_model_provider: libraryModelProvider.value,
        gacha_allocation_mode: gachaAllocationMode.value, gacha_density: gachaDensity.value,
        gacha_category_modes: gachaCategoryModes.value, gacha_facet_modes: gachaFacetModes.value,
        gacha_facet_group_preferences: selectedGachaFacetGroups.value,
        gacha_model_planning: gachaModelPlanning.value,
        gacha_seed: gachaSeed.value, gacha_online_query: gachaOnlineQuery.value,
        gacha_min_post_count: gachaMinPostCount.value, gacha_api_profile: gachaApiProfile.value,
        gacha_local_url: gachaLocalUrl.value, gacha_local_model: gachaLocalModel.value,
        gacha_comfy_model: gachaComfyModel.value, gacha_comfy_device: gachaComfyDevice.value,
        gacha_comfy_dtype: gachaComfyDtype.value, exclusive_model_memory: exclusiveModelMemory.value,
        history_limit: historyLimit.value, thumbnail_concurrency: thumbnailConcurrency.value,
        lazy_load_images: lazyLoadImages.value,
      };
    }

    async function loadSettings() {
      errorMsg.value = "";
      try {
        const res = await fetch("/danbooru_search/settings");
        const data = await readJsonResponse(res, "设置接口");

        if (data.success && data.settings) {
          applySettings(data.settings);
        } else {
          errorMsg.value = data.error || "读取设置失败";
        }
        const profilesRes = await fetch("/danbooru_search/gacha_profiles");
        const profilesData = await readJsonResponse(profilesRes, "模型配置接口");
        gachaProfiles.value = profilesData.success && Array.isArray(profilesData.profiles) ? profilesData.profiles : [];
        const [modelsRes, statusRes] = await Promise.all([
          fetch("/danbooru_search/local_models"),
          fetch("/danbooru_search/tag_data_status"),
        ]);
        const modelsData = await readJsonResponse(modelsRes, "本地模型接口");
        const statusData = await readJsonResponse(statusRes, "标签状态接口");
        localModels.value = modelsData.success && Array.isArray(modelsData.models) ? modelsData.models : [];
        tagDataStatus.value = statusData.success ? statusData.data : null;
        const libraryRes = await fetch("/danbooru_search/library");
        const libraryData = await readJsonResponse(libraryRes, "词库接口");
        if (libraryData.success) Object.assign(libraryFacetLabels, libraryData.facets || {});
      } catch (e) {
        errorMsg.value = "读取设置失败: " + e.message;
      }
    }

    async function saveSettings() {
      saving.value = true;
      errorMsg.value = "";

      try {
        const res = await fetch("/danbooru_search/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(collectSettings()),
        });
        const data = await readJsonResponse(res, "设置保存接口");
        if (!res.ok || !data.success) {
          throw new Error(data.error || ("HTTP " + res.status));
        }
        const savedSettings = data.settings || collectSettings();
        applyDanbooruUiSettings(savedSettings);
        if (props.onSaved) props.onSaved(savedSettings);
        if (props.onClose) props.onClose();
      } catch (e) {
        errorMsg.value = "保存失败: " + e.message;
      } finally {
        saving.value = false;
      }
    }

    async function reloadTagData() {
      if (reloadingTags.value) return;
      reloadingTags.value = true;
      errorMsg.value = "";
      try {
        const res = await fetch("/danbooru_search/reload_tag_data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            semantic_use_library: semanticUseLibrary.value,
            semantic_library_limit: semanticLibraryLimit.value,
            semantic_library_min_post_count: semanticLibraryMinPostCount.value,
          }),
        });
        const data = await readJsonResponse(res, "标签数据刷新接口");
        if (!res.ok || !data.success) throw new Error(data.error || ("HTTP " + res.status));
        tagDataStatus.value = data.data || null;
        Object.keys(translationCache).forEach(key => { delete translationCache[key]; });
        errorMsg.value = "✅ " + data.message;
      } catch (error) {
        errorMsg.value = "标签重载失败: " + error.message;
      } finally {
        reloadingTags.value = false;
      }
    }

    async function testSemanticModel() {
      if (testingSemantic.value) return;
      testingSemantic.value = true;
      semanticTestStatus.value = "正在加载编码器并校验中英文向量…";
      try {
        const res = await fetch("/danbooru_search/test_semantic_model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model_path: modelPath.value }),
        });
        const data = await readJsonResponse(res, "向量模型校验接口");
        if (!res.ok || !data.success) throw new Error(data.error || ("HTTP " + res.status));
        const value = data.result || {};
        semanticTestStatus.value = `✅ 校验通过 · ${value.dimension || "?"} 维 · ${value.device || "?"} · 中英相似度 ${value.bilingual_similarity ?? "?"} · ${value.seconds ?? "?"} 秒`;
      } catch (error) {
        semanticTestStatus.value = "❌ " + error.message;
      } finally {
        testingSemantic.value = false;
      }
    }

    async function unloadModel(kind) {
      errorMsg.value = "";
      try {
        const res = await fetch("/danbooru_search/unload_" + kind + "_model", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || ("HTTP " + res.status));
        errorMsg.value = "✅ " + data.message;
      } catch (error) { errorMsg.value = "释放模型失败: " + error.message; }
    }

    async function testDanbooru() {
      errorMsg.value = "正在测试 Danbooru…";
      try {
        const res = await fetch("/danbooru_search/api/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags: "", page: 1, limit: 1, rating_filter: ratingFilter.value }) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || ("HTTP " + res.status));
        errorMsg.value = "✅ Danbooru 连接正常";
      } catch (error) { errorMsg.value = "连接失败: " + error.message; }
    }

    function exportSettings() {
      const blob = new Blob([JSON.stringify(collectSettings(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "danbooru_search_settings.json"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function importSettings(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const value = JSON.parse(await file.text());
        applySettings(value);
        errorMsg.value = "✅ 设置已导入到界面，点击保存后生效";
      } catch (error) { errorMsg.value = "导入失败: " + error.message; }
      event.target.value = "";
    }

    function cycleGachaCategory(kind) {
      const current = gachaCategoryModes.value[kind] || "auto";
      const next = current === "auto" ? "required" : current === "required" ? "off" : "auto";
      gachaCategoryModes.value = { ...gachaCategoryModes.value, [kind]: next };
    }

    function cycleGachaFacet(key) {
      const current = gachaFacetModes.value[key] || "";
      const next = current === "" ? "prefer" : current === "prefer" ? "required" : current === "required" ? "off" : "";
      const updated = { ...gachaFacetModes.value };
      if (next) updated[key] = next;
      else delete updated[key];
      gachaFacetModes.value = updated;
    }

    function facetsForGroup(groupKey) {
      const group = GACHA_FACET_GROUPS.find(item => item.key === groupKey) || GACHA_FACET_GROUPS[0];
      return Object.entries(libraryFacetLabels).filter(([key]) => {
        if (Array.isArray(group.keys)) return group.keys.includes(key);
        const matches = (group.prefixes || []).includes(String(key).split(".", 1)[0]);
        return matches && !(group.excludeKeys || []).includes(key);
      });
    }

    function toggleGachaFacetGroup(groupKey) {
      const current = selectedGachaFacetGroups.value;
      selectedGachaFacetGroups.value = current.includes(groupKey)
        ? current.filter(key => key !== groupKey)
        : [...current, groupKey];
    }

    watch(() => props.visible, (visible) => {
      if (visible) loadSettings();
    }, { immediate: true });

    return () => {
      if (!props.visible) return h("div");

      const row = (label, control, hint = "") => h("div", { class: "dbs-setting-row" }, [
        h("div", { class: "dbs-setting-label" }, label),
        h("div", { class: "dbs-setting-control" }, [control, hint ? h("small", {}, hint) : null]),
      ]);
      const section = (title, children, desc = "") => h("section", { class: "dbs-setting-section" }, [
        h("h4", {}, title), desc ? h("p", { class: "dbs-setting-desc" }, desc) : null, ...children,
      ]);
      const select = (value, onchange, options) => h("select", { class: "dbs-input-line", value, onChange: e => onchange(e.target.value) }, options.map(option => h("option", { value: option[0], disabled: !!option[2] }, option[1])));
      const numberInput = (value, onchange, min, max, step = 1) => h("input", { class: "dbs-input-line", type: "number", value, min, max, step, onInput: e => onchange(Number(e.target.value)) });
      let panel;
      if (activeTab.value === "general") panel = [
        section("基础显示", [
          row("标签显示", select(tagDisplayLanguage.value, v => { tagDisplayLanguage.value = v; }, [["bilingual", "英文 + 中文（两行）"], ["en", "仅英文"], ["zh", "仅中文"]])),
          row("顶部标签显示", h("span", { style: { color: "#9fc5f8" } }, "始终显示完整有序标签"), "分类与批量整理已移到“抽卡匹配约束”下方的标签分类管理器"),
          row("选图合并完整标签", h("input", { type: "checkbox", checked: includeSelectedImageTags.value, onChange: e => { includeSelectedImageTags.value = e.target.checked; } }), "选中图片后，执行时同时输出该图片的完整 Danbooru 标签；关闭后仅输出上方标签编辑区"),
          row("下划线输出", select(underscoreMode.value, v => { underscoreMode.value = v; }, [["space", "输出时转为空格"], ["keep", "保留下划线"]])),
          row("标点规范化", h("input", { type: "checkbox", checked: normalizePunctuation.value, onChange: e => { normalizePunctuation.value = e.target.checked; } }), "把中文逗号、分号和顿号统一识别为标签分隔符"),
          row("默认折叠画廊", h("input", { type: "checkbox", checked: defaultGalleryCollapsed.value, onChange: e => { defaultGalleryCollapsed.value = e.target.checked; } })),
        ]),
      ];
      else if (activeTab.value === "connection") panel = [
        section("Danbooru API 与账户", [
          row("用户名", h("input", { class: "dbs-input-line", value: username.value, placeholder: "可选", onInput: e => { username.value = e.target.value; } })),
          row("API Key", h("input", { class: "dbs-input-line", type: "password", value: apiKey.value, placeholder: "可选", onInput: e => { apiKey.value = e.target.value; } })),
          row("API 基址", h("input", { class: "dbs-input-line", value: apiBaseUrl.value, onInput: e => { apiBaseUrl.value = e.target.value; } }), "支持官方地址或你信任的 HTTPS 反代；本机可使用 HTTP"),
          row("本地代理", h("input", { class: "dbs-input-line", value: proxyUrl.value, placeholder: "例如 http://127.0.0.1:7890", onInput: e => { proxyUrl.value = e.target.value; } })),
          row("默认评级", select(ratingFilter.value, v => { ratingFilter.value = v; }, RATING_OPTIONS.map(item => [item.value, item.label]))),
          row("隐藏 AI 图片", h("input", { type: "checkbox", checked: hideAi.value, onChange: e => { hideAi.value = e.target.checked; } }), "在响应后过滤，不占用匿名 API 的标签额度"),
          h("button", { class: "dbs-btn", onClick: testDanbooru }, "测试连接"),
        ]),
        section("词库同步节奏", [
          row("请求基础间隔（秒）", numberInput(libraryRequestInterval.value, v => { libraryRequestInterval.value = Math.max(2, Math.min(60, v || 2)); }, 2, 60, 0.5), "每次元数据请求之间至少等待该时间"),
          row("随机抖动（秒）", numberInput(libraryRequestJitter.value, v => { libraryRequestJitter.value = Math.max(0, Math.min(30, v || 0)); }, 0, 30, 0.5), "用于平滑多个客户端同时请求，不用于规避识别"),
          row("每隔多少页长休息", numberInput(libraryPauseEveryPages.value, v => { libraryPauseEveryPages.value = Math.max(0, Math.min(1000, v || 0)); }, 0, 1000), "0 表示关闭周期性长休息"),
          row("长休息秒数", numberInput(libraryPauseSeconds.value, v => { libraryPauseSeconds.value = Math.max(0, Math.min(600, v || 0)); }, 0, 600, 1)),
          row("完整刷新提醒（天）", numberInput(libraryRefreshDays.value, v => { libraryRefreshDays.value = Math.max(1, Math.min(365, v || 30)); }, 1, 365), "只提醒，不会在打开节点时自动联网"),
        ], "推荐保持默认：3–4 秒一次、每 25 页额外休息约 15 秒。修改后先保存，再启动首次初始化。"),
      ];
      else if (activeTab.value === "search") panel = [
        section("搜索与排序", [
          row("搜索模式", select(searchMode.value, v => { searchMode.value = v; }, [["direct", "直接标签"], ["semantic", "语义搜索"], ["hybrid", "混合搜索"]])),
          row("Top K", numberInput(searchTopK.value, v => { searchTopK.value = Math.max(1, Math.min(200, v || 1)); }, 1, 200)),
          row("结果上限", numberInput(searchResultLimit.value, v => { searchResultLimit.value = Math.max(10, Math.min(200, v || 10)); }, 10, 200, 10)),
          row("热度权重", numberInput(searchPopularityWeight.value, v => { searchPopularityWeight.value = Math.max(0, Math.min(1, v || 0)); }, 0, 1, 0.05)),
          row("标签类型", h("div", { class: "dbs-setting-checks" }, ["General", "Artist", "Copyright", "Character", "Meta"].map(type => h("label", {}, [h("input", { type: "checkbox", checked: searchTagTypes.value.includes(type), onChange: e => { searchTagTypes.value = e.target.checked ? [...new Set([...searchTagTypes.value, type])] : searchTagTypes.value.filter(v => v !== type); } }), type])))),
        ], "直接搜索不加载模型；语义/混合搜索才按需加载语义编码器。"),
      ];
      else if (activeTab.value === "data") panel = [
        h(TagLibraryPanel, { node: props.node }),
        section("本地检索数据源", [
          h("div", { class: "dbs-status-card" }, tagDataStatus.value?.tags?.exists ? [
            h("strong", {}, `SQLite ${Number(tagDataStatus.value?.library?.tags || 0).toLocaleString()} 条 · CSV 种子可用`),
            h("span", {}, `数据库丰富条目 ${Number(tagDataStatus.value?.library?.enriched || 0).toLocaleString()} · 已审核 ${Number(tagDataStatus.value?.library?.approved || 0).toLocaleString()}`),
            h("span", {}, `当前向量候选 ${Number(tagDataStatus.value?.semantic_catalog?.rows || 0).toLocaleString()} 条${tagDataStatus.value?.semantic_catalog_dirty ? " · 等待更新" : ""}`),
            h("code", { title: tagDataStatus.value.tags.path }, tagDataStatus.value.tags.path),
          ] : "未找到 tags_enhanced.csv"),
          row("SQLite 加入向量索引", h("input", { type: "checkbox", checked: semanticUseLibrary.value, onChange: e => { semanticUseLibrary.value = e.target.checked; } }), "关闭时仅使用随附 CSV"),
          row("向量候选上限", numberInput(semanticLibraryLimit.value, v => { semanticLibraryLimit.value = Math.max(1000, Math.min(250000, v || 60000)); }, 1000, 250000, 1000), "默认 60,000；完整数据库仍可直接查找"),
          row("英文标签最低热度", numberInput(semanticLibraryMinPostCount.value, v => { semanticLibraryMinPostCount.value = Math.max(0, v || 0); }, 0, 1000000, 10), "有中文、释义或审核分类的标签不受此门槛影响"),
          h("button", { class: "dbs-btn", disabled: reloadingTags.value, onClick: reloadTagData }, reloadingTags.value ? "合并中…" : "刷新 SQLite + CSV 向量数据源"),
        ], "直接检索会查询完整 tags.sqlite3；语义检索使用数据库优先的有界快照，CSV 只负责补缺。限制候选数是为了避免四路 1024 维向量耗尽内存/显存。"),
        section("语义编码器（只用于语义搜索）", [
          row("已扫描模型", select(modelPath.value, v => { modelPath.value = v; }, [["", "默认 BAAI/bge-m3"], ...localModels.value.filter(model => model.semantic).map(model => [model.name, model.name])])),
          row("自定义路径", h("input", { class: "dbs-input-line", value: modelPath.value, placeholder: "models/LLM/...、models/text_encoders/... 或绝对路径", onInput: e => { modelPath.value = e.target.value; } })),
          h("div", { class: "dbs-setting-actions" }, [
            h("button", { class: "dbs-btn primary", disabled: testingSemantic.value, onClick: testSemanticModel }, testingSemantic.value ? "检测中…" : "检测中英向量模型"),
            h("button", { class: "dbs-btn danger", onClick: () => unloadModel("semantic") }, "卸载语义模型"),
          ]),
          semanticTestStatus.value ? h("p", { class: "dbs-setting-desc", role: "status" }, semanticTestStatus.value) : null,
        ], "检测会验证模型能否产生有限、归一化的中英文文本向量，并显示维度与跨语言相似度；不会在检测时重建完整标签索引。纯 CLIP/T5 通常不兼容 SentenceTransformer。"),
      ];
      else if (activeTab.value === "gacha") panel = [
        section("智能组合规划", [
          row("分配方式", select(gachaAllocationMode.value, v => { gachaAllocationMode.value = v; }, [
            ["smart", "智能自适应（推荐）"], ["exact", "高级精确数量"],
          ]), gachaAllocationMode.value === "smart" ? "每次按语境与密度在范围内动态分配，不机械凑满每个分类" : "用于严格复现旧工作流或专项数据测试"),
          gachaAllocationMode.value === "smart" ? row("提示词密度", select(gachaDensity.value, v => { gachaDensity.value = v; }, [
            ["compact", "精简 · 约 4–6 个"], ["balanced", "均衡 · 约 7–10 个"], ["rich", "丰富 · 约 11–15 个"],
          ]), "这是复杂度范围，不是强制精确数量") : null,
          gachaAllocationMode.value === "smart" ? h("div", { class: "dbs-gacha-intent" }, [
            h("div", { class: "dbs-gacha-intent-head" }, [h("strong", {}, "大类意图"), h("small", {}, "点击循环：自动 → 必选 → 禁用")]),
            h("div", { class: "dbs-gacha-mode-grid" }, Object.entries(PROMPT_KIND_LABELS).map(([kind, label]) => {
              const mode = gachaCategoryModes.value[kind] || "auto";
              return h("button", { class: ["dbs-gacha-mode", "mode-" + mode], onClick: () => cycleGachaCategory(kind) }, [
                h("span", {}, label), h("small", {}, GACHA_MODE_LABELS[mode] || "自动"),
              ]);
            })),
          ]) : null,
          gachaAllocationMode.value === "smart" ? row("生成式模型参与规划", h("input", { type: "checkbox", checked: gachaModelPlanning.value, onChange: e => { gachaModelPlanning.value = e.target.checked; } }), "仅在总开关、enable_language_model 与左侧 local_model/api_config 同时启用时使用；语义向量模型仍只负责检索") : null,
        ], "规则规划器会根据人物描述、画面密度、必选/禁用类别计算动态范围；生成式模型可进一步处理服装、动作、场景和镜头之间的兼容性。"),
        gachaAllocationMode.value === "smart" ? section("细分类偏好", [
          h("div", { class: "dbs-gacha-facet-tabs" }, GACHA_FACET_GROUPS.map(group => h("button", {
            class: selectedGachaFacetGroups.value.includes(group.key) ? "active" : "",
            onClick: () => { toggleGachaFacetGroup(group.key); },
          }, (selectedGachaFacetGroups.value.includes(group.key) ? "✓ " : "") + group.label))),
          selectedGachaFacetGroups.value.length
            ? h("div", { class: "dbs-gacha-facet-blocks" }, selectedGachaFacetGroups.value.map(groupKey => {
                const group = GACHA_FACET_GROUPS.find(item => item.key === groupKey);
                const facets = facetsForGroup(groupKey);
                return h("div", { class: "dbs-gacha-facet-block", key: groupKey }, [
                  h("div", { class: "dbs-gacha-facet-group-title" }, group?.label || groupKey),
                  h("div", { class: "dbs-gacha-facet-grid" }, facets.length
                    ? facets.map(([key, label]) => {
                        const mode = gachaFacetModes.value[key] || "";
                        const shortLabel = String(label).split("/").slice(1).join("/") || label;
                        return h("button", { class: ["dbs-gacha-facet", mode ? "mode-" + mode : ""], onClick: () => cycleGachaFacet(key), title: label }, [
                          h("span", {}, shortLabel), h("small", {}, GACHA_FACET_MODE_LABELS[mode]),
                        ]);
                      })
                    : [h("span", { class: "dbs-settings-note" }, "该组尚无已审核细分类；完成词库分类审核后会自动出现。")]),
                ]);
              }))
            : h("div", { class: "dbs-settings-note", style: "padding:10px 12px" }, "未选择细分类大类：将完全由智能规划器自动分配。"),
          h("div", { class: "dbs-setting-actions" }, [
            h("span", { class: "dbs-settings-note" }, "上方大类可多选并参与规划权重；下方细项点击循环：自动 → 偏好 → 必选 → 禁用。角色特征已连接时仍跳过人物身份类。"),
            h("button", { class: "dbs-btn small", onClick: () => { gachaFacetModes.value = {}; selectedGachaFacetGroups.value = []; } }, "清空偏好"),
          ]),
        ]) : null,
        section("抽卡来源", [
          row("生成方式", select(gachaProvider.value, v => { gachaProvider.value = v; }, [
            ["database", "本地 SQLite 词库 · 智能组合（零网络）"],
            ["danbooru_random", "Danbooru 真实共现组合（零模型）"],
            ["gallery", "已选画廊图片（可选来源）"],
            ["api_profile", "生成式 LLM · API Profile", !enableModelCalls.value],
            ["local_openai", "生成式 LLM · 本地兼容服务", !enableModelCalls.value],
            ["comfyui_model", "生成式 LLM · ComfyUI 本地模型", !enableModelCalls.value],
          ])),
          gachaProvider.value === "danbooru_random" ? row("在线基础标签", h("input", { class: "dbs-input-line", value: gachaOnlineQuery.value, placeholder: "可留空；匿名访问建议最多填写 1 个标签", onInput: e => { gachaOnlineQuery.value = e.target.value; } })) : null,
          row("最低标签热度", numberInput(gachaMinPostCount.value, v => { gachaMinPostCount.value = Math.max(0, v || 0); }, 0, 1000000, 100), "仅影响本地标签库，过滤冷门噪声标签"),
          row("避免近期重复", h("input", { type: "checkbox", checked: gachaAvoidDuplicates.value, onChange: e => { gachaAvoidDuplicates.value = e.target.checked; } })),
          row("随机种子", numberInput(gachaSeed.value, v => { gachaSeed.value = Number.isFinite(v) ? v : -1; }, -1, 2147483647), "-1 每次随机；固定值便于复现"),
        ], "运行时统一从 tags.sqlite3 取词；随附 CSV 只负责首次播种及数据库不可用时回退。真实共现保留同一作品中的自然搭配；生成式 LLM 规划后仍由本地词库校验。"),
        gachaAllocationMode.value === "exact" ? section("高级精确配额", [
          h("details", { open: true, class: "dbs-gacha-exact" }, [
            h("summary", {}, "大类精确数量"),
            h("div", { class: "dbs-gacha-counts" }, Object.entries(PROMPT_KIND_LABELS).map(([kind, label]) => h("label", {}, [
              h("span", {}, label), numberInput(gachaCounts.value[kind] ?? 0, v => { gachaCounts.value = { ...gachaCounts.value, [kind]: Math.max(0, Math.min(5, v || 0)) }; }, 0, 5),
            ]))),
          ]),
          h("details", { class: "dbs-gacha-exact" }, [
            h("summary", {}, `已审核细分类数量 · ${Object.keys(libraryFacetLabels).length} 项`),
            h("div", { class: "dbs-gacha-facet-counts" }, Object.entries(libraryFacetLabels).map(([key, label]) => h("label", {}, [
              h("span", { title: label }, label), numberInput(gachaFacetCounts.value[key] || 0, v => { gachaFacetCounts.value = { ...gachaFacetCounts.value, [key]: Math.max(0, Math.min(10, v || 0)) }; }, 0, 10),
            ]))),
          ]),
          h("button", { class: "dbs-btn", onClick: () => { gachaFacetCounts.value = {}; } }, "清空细分类精确数量"),
        ], "只有精确模式读取这些数字；任意细分类数量大于 0 时沿用旧行为并替代大类数量。") : null,
      ];
      else if (activeTab.value === "models") panel = [
        section("调用总开关", [
          row("允许 LLM / API", h("input", { type: "checkbox", checked: enableModelCalls.value, onChange: e => { enableModelCalls.value = e.target.checked; } }), "工作流执行时还必须把节点 enable_language_model 端口设为 true"),
          row("显存互斥", h("input", { type: "checkbox", checked: exclusiveModelMemory.value, onChange: e => { exclusiveModelMemory.value = e.target.checked; } }), "加载本地生成模型前释放语义模型；开始语义搜索前释放生成模型"),
        ]),
        section("Eagle API Profiles", [
          h("div", { class: "dbs-profile-list" }, gachaProfiles.value.length ? gachaProfiles.value.map(profile => h("div", { class: "dbs-profile-row" }, [h("strong", {}, profile.name), h("span", {}, profile.model || "未填写模型"), h("small", {}, profile.base_url || "")])) : [h("div", { class: "dbs-settings-note" }, "api_config.json 中没有 LLM Profile")]),
          row("抽卡 Profile", select(gachaApiProfile.value, v => { gachaApiProfile.value = v; }, [["", "使用当前激活 LLM"], ...gachaProfiles.value.map(profile => [profile.name, profile.name + (profile.model ? " · " + profile.model : "")])])),
        ], "这里只读取 api_config.json 的安全摘要；新增、编辑和删除仍由 Eagle API 配置加载器统一同步。"),
        section("本地服务与 ComfyUI 生成模型", [
          h("button", { class: "dbs-btn", onClick: scanOllama }, "检测本机 Ollama / 列出模型"),
          ollamaModels.value.length ? row("Ollama 模型", select(gachaLocalModel.value, v => { gachaLocalModel.value = v; }, [["", "请选择"], ...ollamaModels.value.map(model => [model.name, model.name])])) : null,
          row("服务 URL", h("input", { class: "dbs-input-line", value: gachaLocalUrl.value, onInput: e => { gachaLocalUrl.value = e.target.value; } })),
          row("服务模型名", h("input", { class: "dbs-input-line", value: gachaLocalModel.value, onInput: e => { gachaLocalModel.value = e.target.value; } })),
          row("ComfyUI 模型", select(gachaComfyModel.value, v => { gachaComfyModel.value = v; }, [["", "请选择本地生成模型"], ...localModels.value.filter(model => model.generative).map(model => [model.name, model.name])])),
          h("div", { class: "dbs-inline-settings" }, [row("设备", select(gachaComfyDevice.value, v => { gachaComfyDevice.value = v; }, [["auto", "auto"], ["cuda", "cuda"], ["cpu", "cpu"]])), row("精度", select(gachaComfyDtype.value, v => { gachaComfyDtype.value = v; }, [["bf16", "bf16"], ["fp16", "fp16"], ["fp32", "fp32"]]))]),
        ], "本节只保留给自动 AI 抽卡等旧设置流程。词库翻译/细分类改用 Danbooru 节点左侧 local_model 或 api_config 端口；Ollama 可在 API 配置加载器中使用 http://127.0.0.1:11434/v1，API Key 可留空。"),
      ];
      else panel = [
        section("工作区", [
          row("历史上限", numberInput(historyLimit.value, v => { historyLimit.value = Math.max(10, Math.min(500, v || 10)); }, 10, 500, 10)),
          h("div", { class: "dbs-setting-actions" }, [
            h("button", { class: "dbs-btn", onClick: exportSettings }, "导出设置"),
            h("button", { class: "dbs-btn", onClick: () => importInput.value?.click() }, "导入设置"),
            h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: importSettings }),
          ]),
        ]),
        section("性能", [
          row("缩略图并发", numberInput(thumbnailConcurrency.value, v => { thumbnailConcurrency.value = Math.max(1, Math.min(16, v || 1)); }, 1, 16)),
          row("缩略图懒加载", h("input", { type: "checkbox", checked: lazyLoadImages.value, onChange: e => { lazyLoadImages.value = e.target.checked; } }), "只在进入可视区时加载图片，降低节点展开时的带宽和内存占用"),
        ]),
      ];

      return h("div", { class: "dbs-modal-backdrop", onClick: props.onClose }, [
        h("div", {
          class: "dbs-modal dbs-settings-modal",
          onClick: e => e.stopPropagation(),
        }, [
          h("div", { class: "dbs-settings-head" }, [h("div", {}, [h("h3", {}, "⚙ Danbooru 标签搜索设置"), h("small", {}, "搜索、抽卡、模型与工作区资源独立管理")]), h("button", { class: "dbs-btn", onClick: props.onClose }, "×")]),
          h("div", { class: "dbs-settings-shell" }, [
            h("nav", { class: "dbs-settings-nav" }, tabs.map(tab => h("button", { class: activeTab.value === tab[0] ? "active" : "", onClick: () => { activeTab.value = tab[0]; } }, tab[1]))),
            h("main", { class: "dbs-settings-content" }, panel),
          ]),
          errorMsg.value ? h("div", { class: ["dbs-settings-message", errorMsg.value.startsWith("✅") ? "ok" : ""] }, errorMsg.value) : null,
          h("div", { class: "dbs-modal-actions dbs-settings-footer" }, [
            h("button", { class: "dbs-btn", onClick: props.onClose }, "取消"),
            h("button", {
              class: "dbs-btn primary",
              onClick: saveSettings,
            }, saving.value ? "保存中…" : "保存"),
          ]),
        ]),
      ]);
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════════════════

const DanbooruSearchApp = {
  name: "DanbooruSearchApp",
  props: {
    node: { type: Object, required: true },
  },
  setup(props) {
    const selectedGalleryTags = ref("");
    const selectedPosts = ref([]);
    const selectedOutputTags = ref([]);
    const settingsOpen = ref(false);
    const settingsTab = ref("general");
    const libraryBootstrap = ref(null);
    const galleryCollapsed = ref(false);
    const lastGachaCard = ref("");
    const gachaLoading = ref(false);
    const gachaStatus = ref("");
    const autoGacha = ref(false);
    const gachaContext = ref("");
    const gachaContentLevel = ref(0);
    const gachaHoldingMode = ref("none");
    const gachaExcludedTags = ref("");
    const releaseModelAfterOutput = ref(false);
    const modelReleaseRequest = ref("");

    const contentLevelLabels = ["SFW 安全", "SFW 轻微", "NSFW 成人", "NSFW 明确"];

    function inputConnected(name) {
      const input = (props.node?.inputs || []).find(item => item?.name === name);
      return !!input && (input.link != null || (Array.isArray(input.links) && input.links.length > 0));
    }

    function addOutputTags(items, defaults = {}) {
      selectedOutputTags.value = mergeTagItems(selectedOutputTags.value, items, defaults);
      syncSelection();
    }

    function addSearchOutput(items) {
      addOutputTags(items, { source: "semantic", kind: "semantic" });
    }

    function searchGallery(items) {
      const value = (items || []).map(item => item.tag).filter(Boolean).join(" ");
      if (!value) return;
      if (selectedGalleryTags.value === value) {
        selectedGalleryTags.value = "";
        setTimeout(() => { selectedGalleryTags.value = value; }, 0);
      } else {
        selectedGalleryTags.value = value;
      }
    }

    function onGallerySelectionChange(selections) {
      selectedPosts.value = selections;
      syncSelection();
    }

    function removeSelection(id) {
      selectedPosts.value = selectedPosts.value.filter(p => String(p.id) !== String(id));
      syncSelection();
    }

    function clearSelection() {
      selectedPosts.value = [];
      syncSelection();
    }

    function updateOutputTags(items) {
      selectedOutputTags.value = (items || []).map(item => normalizeTagItem(item)).filter(Boolean);
      syncSelection();
    }

    async function drawGacha() {
      if (gachaLoading.value) return;
      gachaLoading.value = true;
      gachaStatus.value = "";
      try {
        const currentContext = selectedOutputTags.value
          .filter(item => item.enabled !== false && !isGachaItem(item))
          .map(item => item.tag).join(", ");
        const response = await fetch("/danbooru_search/gacha", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            character_tags: [gachaContext.value, currentContext].filter(Boolean).join(", "),
            selections: selectedPosts.value,
            gacha_context: gachaContext.value,
            gacha_content_level: gachaContentLevel.value,
            gacha_holding_mode: gachaHoldingMode.value,
            gacha_excluded_tags: gachaExcludedTags.value,
          }),
        });
        const raw = await response.text();
        let data;
        try {
          data = JSON.parse(raw);
        } catch (_) {
          throw new Error("服务返回了非 JSON 内容：" + (raw || "空响应").slice(0, 180));
        }
        if (!response.ok || !data.success) throw new Error(data.error || ("HTTP " + response.status));
        lastGachaCard.value = data.name || "新组合";
        const kept = selectedOutputTags.value.filter(item => !isGachaItem(item));
        selectedOutputTags.value = mergeTagItems(kept, data.tags || [], { source: "gacha" });
        const providerLabels = { database: "本地 SQLite 标签库", danbooru_random: "Danbooru 在线共现", gallery: "已选画廊标签组合", rules: "旧版规则卡" };
        const sourceLabels = { sqlite: "SQLite 数据库", csv: "随附 CSV 回退", parquet: "Parquet 回退" };
        const source = sourceLabels[data.data_source] ? ` · 来源：${sourceLabels[data.data_source]}` : "";
        gachaStatus.value = data.warning ? data.warning + source : (providerLabels[data.provider] || "生成式模型智能编排") + source;
        syncSelection();
      } catch (error) {
        gachaStatus.value = "抽卡失败：" + error.message;
      } finally {
        gachaLoading.value = false;
      }
    }

    function clearGacha() {
      selectedOutputTags.value = selectedOutputTags.value.filter(item => !isGachaItem(item));
      lastGachaCard.value = "";
      gachaStatus.value = "";
      syncSelection();
    }

    async function requestModelRelease() {
      if (!inputConnected("local_model")) {
        gachaStatus.value = "未连接 local_model；API 服务模型由服务端管理，Danbooru 节点不能远程卸载。";
        return;
      }
      modelReleaseRequest.value = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      syncSelection();
      try {
        await app.queuePrompt(0);
        modelReleaseRequest.value = "";
        syncSelection();
        gachaStatus.value = "已提交本地生成模型释放请求；本次节点执行完成后释放显存。";
      } catch (error) {
        gachaStatus.value = "提交释放请求失败：" + error.message;
      }
    }

    function syncSelection() {
      const nodeId = String(props.node.id);

      const payload = {
        node_id: nodeId,
        selections: selectedPosts.value,
        selected_tags: selectedOutputTags.value,
        gallery_collapsed: galleryCollapsed.value,
        auto_gacha: autoGacha.value,
        gacha_context: gachaContext.value,
        gacha_content_level: gachaContentLevel.value,
        gacha_holding_mode: gachaHoldingMode.value,
        gacha_excluded_tags: gachaExcludedTags.value,
        release_model_after_output: releaseModelAfterOutput.value,
        model_release_request: modelReleaseRequest.value,
      };

      fetch("/danbooru_search/cache_selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});

      const widget = (props.node.widgets || []).find(w => w.name === "selection_data");
      if (widget) {
        let controls = {};
        try { controls = JSON.parse(widget.value || "{}"); } catch (_) { controls = {}; }
        widget.value = JSON.stringify({
          selections: selectedPosts.value,
          selected_tags: selectedOutputTags.value,
          gallery_collapsed: galleryCollapsed.value,
          auto_gacha: autoGacha.value,
          gacha_context: gachaContext.value,
          gacha_content_level: gachaContentLevel.value,
          gacha_holding_mode: gachaHoldingMode.value,
          gacha_excluded_tags: gachaExcludedTags.value,
          release_model_after_output: releaseModelAfterOutput.value,
          model_release_request: modelReleaseRequest.value,
          // Settings-panel workflow controls live in the same hidden widget.
          // Preserve them when the editor changes tags or image selections.
          library_enrichment_enabled: !!controls.library_enrichment_enabled,
          library_enrichment_batch: Math.min(50, Math.max(1, Number(controls.library_enrichment_batch) || 20)),
        });
        if (typeof widget.callback === "function") widget.callback(widget.value, widget, props.node);
        if (props.node.graph) {
          props.node.graph.change?.();
          props.node.graph.setDirtyCanvas(true, true);
        }
      }
    }

    function restoreSelection() {
      const nodeId = String(props.node.id);
      let workflowPayload = null;

      // 服务端缓存重启后会丢失，先从工作流隐藏 widget 恢复。
      try {
        const widget = (props.node.widgets || []).find(w => w.name === "selection_data");
        const saved = JSON.parse(widget?.value || "{}");
        if (saved && typeof saved === "object" && (
          Array.isArray(saved.selections) || Array.isArray(saved.selected_tags) ||
          Object.prototype.hasOwnProperty.call(saved, "gallery_collapsed") ||
          Object.prototype.hasOwnProperty.call(saved, "auto_gacha") ||
          Object.prototype.hasOwnProperty.call(saved, "gacha_context") ||
          Object.prototype.hasOwnProperty.call(saved, "gacha_content_level") ||
          Object.prototype.hasOwnProperty.call(saved, "gacha_holding_mode")
        )) workflowPayload = saved;
        if (Array.isArray(saved.selections)) selectedPosts.value = saved.selections;
        if (Array.isArray(saved.selected_tags)) selectedOutputTags.value = saved.selected_tags.map(item => normalizeTagItem(item)).filter(Boolean);
        galleryCollapsed.value = !!saved.gallery_collapsed;
        autoGacha.value = !!saved.auto_gacha;
        if (autoGacha.value) selectedOutputTags.value = selectedOutputTags.value.filter(item => !isGachaItem(item));
        gachaContext.value = saved.gacha_context || "";
        gachaContentLevel.value = Math.max(0, Math.min(3, Number(saved.gacha_content_level) || 0));
        gachaHoldingMode.value = ["none", "daily", "weapon", "any"].includes(saved.gacha_holding_mode) ? saved.gacha_holding_mode : "none";
        gachaExcludedTags.value = saved.gacha_excluded_tags || "";
        releaseModelAfterOutput.value = !!saved.release_model_after_output;
        modelReleaseRequest.value = saved.model_release_request || "";
      } catch (_) {
        // 旧工作流值损坏时忽略，仍继续尝试服务端缓存。
      }

      // 工作流内的值必须优先于按 node_id 保存的进程内缓存。不同工作流可以
      // 复用相同节点编号；如果让缓存覆盖，切换工作流时就会串到另一份状态。
      if (workflowPayload) {
        fetch("/danbooru_search/cache_selection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            node_id: nodeId,
            selections: selectedPosts.value,
            selected_tags: selectedOutputTags.value,
            gallery_collapsed: galleryCollapsed.value,
            auto_gacha: autoGacha.value,
            gacha_context: gachaContext.value,
            gacha_content_level: gachaContentLevel.value,
            gacha_holding_mode: gachaHoldingMode.value,
            gacha_excluded_tags: gachaExcludedTags.value,
            release_model_after_output: releaseModelAfterOutput.value,
            model_release_request: modelReleaseRequest.value,
          }),
        }).catch(() => {});
        return;
      }

      fetch("/danbooru_search/cache_selection?node_id=" + encodeURIComponent(nodeId))
        .then(r => readJsonResponse(r, "节点状态缓存接口"))
        .then(data => {
          if (data.success && data.found !== false) {
            if (Array.isArray(data.selections)) selectedPosts.value = data.selections;
            if (Array.isArray(data.selected_tags)) selectedOutputTags.value = data.selected_tags.map(item => normalizeTagItem(item)).filter(Boolean);
            galleryCollapsed.value = !!data.gallery_collapsed;
            if (typeof data.auto_gacha === "boolean") autoGacha.value = data.auto_gacha;
            if (autoGacha.value) selectedOutputTags.value = selectedOutputTags.value.filter(item => !isGachaItem(item));
            if (typeof data.gacha_context === "string") gachaContext.value = data.gacha_context;
            if (Number.isFinite(Number(data.gacha_content_level))) gachaContentLevel.value = Math.max(0, Math.min(3, Number(data.gacha_content_level)));
            if (["none", "daily", "weapon", "any"].includes(data.gacha_holding_mode)) gachaHoldingMode.value = data.gacha_holding_mode;
            if (typeof data.gacha_excluded_tags === "string") gachaExcludedTags.value = data.gacha_excluded_tags;
            if (typeof data.release_model_after_output === "boolean") releaseModelAfterOutput.value = data.release_model_after_output;
            if (typeof data.model_release_request === "string") modelReleaseRequest.value = data.model_release_request;
          }
        })
        .catch(() => {});
    }

    props.node._eagleRestoreUiState = restoreSelection;

    onMounted(async () => {
      try {
        const [settingsResponse, libraryResponse] = await Promise.all([
          fetch("/danbooru_search/settings"),
          fetch("/danbooru_search/library"),
        ]);
        const data = await readJsonResponse(settingsResponse, "设置接口");
        if (settingsResponse.ok && data.success && data.settings) {
          applyDanbooruUiSettings(data.settings);
          gachaContentLevel.value = Math.max(0, Math.min(3, Number(data.settings.gacha_content_level) || 0));
          gachaHoldingMode.value = ["none", "daily", "weapon", "any"].includes(data.settings.gacha_holding_mode) ? data.settings.gacha_holding_mode : "none";
          gachaExcludedTags.value = data.settings.gacha_excluded_tags || "";
        }
        const libraryData = await readJsonResponse(libraryResponse, "词库接口");
        if (libraryResponse.ok && libraryData.success) libraryBootstrap.value = libraryData.bootstrap || null;
      } catch (_) {
        // 设置读取失败不阻断节点加载，使用模块内默认值。
      }
      setTimeout(restoreSelection, 500);
    });

    onBeforeUnmount(() => {
      if (props.node._eagleRestoreUiState === restoreSelection) {
        delete props.node._eagleRestoreUiState;
      }
    });

    return () => {
      return h("div", { class: "dbs-root" }, [
        h("div", { class: ["dbs-preview-bar", galleryCollapsed.value ? "collapsed" : ""] }, [
          h(TagEditor, {
            tags: selectedOutputTags.value,
            collapsed: galleryCollapsed.value,
            onChange: updateOutputTags,
            onAdd: items => addOutputTags(items, { source: "manual", kind: "manual" }),
            onToggleCollapse: () => { galleryCollapsed.value = !galleryCollapsed.value; syncSelection(); },
            onGacha: drawGacha,
            onClearGacha: clearGacha,
            onOpenSettings: () => { settingsTab.value = "general"; settingsOpen.value = true; },
            gachaName: lastGachaCard.value,
            gachaLoading: gachaLoading.value,
            autoGacha: autoGacha.value,
            onAutoGacha: value => {
              autoGacha.value = value;
              if (value) {
                selectedOutputTags.value = selectedOutputTags.value.filter(item => !isGachaItem(item));
                lastGachaCard.value = "";
                gachaStatus.value = "已启用：每次执行根据 character_tags 动态生成，界面不显示过期抽卡标签";
              }
              syncSelection();
            },
            onClearAll: () => { selectedOutputTags.value = []; lastGachaCard.value = ""; gachaStatus.value = ""; syncSelection(); },
          }),
        ]),

        libraryBootstrap.value && !libraryBootstrap.value.ready ? h("div", { class: "dbs-first-run-banner" }, [
          h("strong", {}, "本地标签库尚未完成首次初始化"),
          h("span", {}, `已保存官方标签 ${libraryBootstrap.value.tag_records || 0} 条；可以继续使用现有词表，也可后台续传完整元数据。`),
          h("button", { class: "dbs-btn primary", onClick: () => { settingsTab.value = "data"; settingsOpen.value = true; } }, "打开首次初始化"),
        ]) : null,

        galleryCollapsed.value ? h("div", { class: "dbs-collapsed-tools" }, [
          h("section", { class: "dbs-collapsed-panel" }, [
            h("div", { class: "dbs-collapsed-title" }, "标签检索与同步"),
            h(TagSearchPanel, { onAddOutput: addSearchOutput, onSearchGallery: searchGallery }),
          ]),
          h("section", { class: "dbs-collapsed-panel dbs-gacha-context" }, [
            h("div", { class: "dbs-collapsed-title" }, "抽卡匹配约束"),
            h("textarea", {
              class: "dbs-query-input",
              value: gachaContext.value,
              placeholder: "可选语义要求：补充画风、题材与搭配偏好。仅连接生成式模型时理解自由文本；硬排除请使用下方控件。",
              onInput: e => { gachaContext.value = e.target.value; },
              onChange: syncSelection,
            }),
            h("div", { class: "dbs-runtime-constraints" }, [
              h("label", { class: "dbs-runtime-field" }, [
                h("span", {}, `内容尺度 · ${contentLevelLabels[gachaContentLevel.value]}`),
                h("input", {
                  type: "range", min: 0, max: 3, step: 1, value: gachaContentLevel.value,
                  onInput: e => { gachaContentLevel.value = Number(e.target.value); }, onChange: syncSelection,
                }),
              ]),
              h("label", { class: "dbs-runtime-field" }, [
                h("span", {}, "手持物品"),
                h("select", { value: gachaHoldingMode.value, onChange: e => { gachaHoldingMode.value = e.target.value; syncSelection(); } }, [
                  h("option", { value: "none" }, "不增加持物"),
                  h("option", { value: "daily" }, "仅生活道具"),
                  h("option", { value: "weapon" }, "仅武器"),
                  h("option", { value: "any" }, "不限（按搭配）"),
                ]),
              ]),
              h("label", { class: "dbs-runtime-field grow" }, [
                h("span", {}, "硬排除标签 / 通配符"),
                h("input", {
                  class: "dbs-input-line", value: gachaExcludedTags.value,
                  placeholder: "例如：holding_*, knife, weapon",
                  onInput: e => { gachaExcludedTags.value = e.target.value; }, onChange: syncSelection,
                }),
              ]),
            ]),
            h("div", { class: "dbs-runtime-model" }, [
              h("label", {}, [h("input", {
                type: "checkbox", checked: releaseModelAfterOutput.value,
                onChange: e => { releaseModelAfterOutput.value = e.target.checked; syncSelection(); },
              }), " 输出后自动卸载本地 LLM"]),
              h("button", { class: "dbs-btn danger small", onClick: requestModelRelease }, "立即卸载本地 LLM"),
              h("span", { class: "dbs-settings-note" }, inputConnected("reference_image")
                ? "参考图已连接：VLM 会读取图像；纯文本模型只读取角色提示词。"
                : "可连接 reference_image；图像会从 image_passthrough 原样输出。"),
            ]),
            h(TagCategoryManager, { tags: selectedOutputTags.value, onChange: updateOutputTags }),
            h("div", { class: "dbs-settings-note" }, "character_tags 中已有身份、体型、造型、服装和物品会作为锁定条件；本地 SQLite 严格执行尺度、持物、禁用分类与标签通配符，生成式模型额外理解上方自由文本。"),
            gachaStatus.value ? h("div", { class: ["dbs-gacha-status", gachaStatus.value.startsWith("抽卡失败") ? "error" : ""] }, gachaStatus.value) : null,
          ]),
        ]) : h("div", { class: "dbs-layout" }, [
          h("div", { class: "dbs-left" }, [
            h(TagSearchPanel, {
              onAddOutput: addSearchOutput,
              onSearchGallery: searchGallery,
            }),
          ]),

          h("div", { class: "dbs-right" }, [
            h(GalleryPanel, {
              initialTags: selectedGalleryTags.value,
              initialSelections: selectedPosts.value,
              onSelectionChange: onGallerySelectionChange,
              onAddTags: items => addOutputTags(items, { source: "detail", kind: "detail" }),
            }),
          ]),

          h("div", { class: "dbs-selected-side" }, [
            h(SelectionBar, { selections: selectedPosts.value, onRemove: removeSelection, onClear: clearSelection }),
          ]),
        ]),

        settingsOpen.value
          ? h(SettingsDialog, {
              visible: true,
              initialTab: settingsTab.value,
              node: props.node,
              onClose: () => { settingsOpen.value = false; },
              onSaved: applyDanbooruUiSettings,
            })
          : null,
      ]);
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// CSS 样式
// ════════════════════════════════════════════════════════════════════════════

const CSS = `
/* ── 根容器 ──────────────────────────────────────────────────────────── */
.dbs-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: #1a1a1e;
  color: #ddd;
  font-family: sans-serif;
  font-size: 12px;
  overflow: hidden;
}

.dbs-preview-bar {
  padding: 8px 12px;
  background: #1e1e22;
  border-bottom: 1px solid #333;
  min-height: 72px;
  max-height: 250px;
  /* 大批量标签必须留在自己的面板内，不能越过分隔线盖住画廊。 */
  overflow: hidden;
  flex-shrink: 0;
}

.dbsb-empty {
  color: #666;
  text-align: center;
  padding: 16px;
  font-size: 11px;
}

.dbsb-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 100%;
}
.dbs-preview-bar.collapsed { flex:0 0 auto; max-height:280px; min-height:0; }
.dbs-first-run-banner { display:flex; align-items:center; gap:9px; padding:7px 12px; flex:0 0 auto; border-bottom:1px solid #5b4929; background:#2a2418; color:#d9c59c; }
.dbs-first-run-banner strong { color:#f1d79f; white-space:nowrap; }
.dbs-first-run-banner span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.dbsb-wrap.vertical { flex-direction: column; align-items: stretch; gap: 8px; height: auto; }
.dbsb-title { font-weight: 700; color: #eee; padding: 4px 2px; }
.dbsb-wrap.vertical .dbsb-list { flex-direction: column; overflow-y: auto; overflow-x: hidden; }
.dbsb-wrap.vertical .dbsb-item { width: auto; height: 58px; display: flex; align-items: center; gap: 8px; padding: 5px; overflow: visible; }
.dbsb-wrap.vertical .dbsb-thumb { width: 48px; height: 48px; border-radius: 4px; }
.dbsb-name { flex: 1; overflow: hidden; text-overflow: ellipsis; color: #bbb; }
.dbsb-wrap.vertical .dbsb-remove { opacity: 1; position: static; margin-left: auto; }

.dbs-selected-side {
  width: 190px; min-width: 170px; max-width: 260px; padding: 8px;
  background: #1e1e22; border-left: 1px solid #333; overflow: hidden;
}

.dbte { display: flex; flex-direction: column; gap: 7px; min-height: 55px; }
.dbte.expanded { min-height: 0; }
.dbte-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.dbte-body { min-width:0; display:block; }
.dbte-body.has-inspector { display:grid; grid-template-columns:minmax(0,1fr) minmax(340px,.55fr); gap:8px; align-items:start; }
.dbte-tags-pane { min-width:0; display:flex; flex-direction:column; gap:6px; }
.dbte-spacer { flex: 1; min-width: 8px; }
.dbte-auto { display:flex; align-items:center; gap:3px; color:#b9b9c2; white-space:nowrap; }
.dbte-tip { color: #7f8794; font-size: 10px; white-space: nowrap; padding: 0 4px; }
.dbte-add { display: flex; align-items:center; gap: 6px; }
.dbte-add .dbs-input-line { margin: 0; min-width: 160px; flex:1; }
.dbte-taxonomy { display:flex; flex-direction:column; gap:5px; padding:5px 6px; background:#15171c; border:1px solid #30343d; border-radius:6px; }
.dbte-major-tabs,.dbte-sub-tabs { display:flex; align-items:center; flex-wrap:wrap; gap:4px; }
.dbte-taxonomy button { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border:1px solid #3e434d; border-radius:999px; background:#24272e; color:#aeb5c1; font-size:10px; cursor:pointer; }
.dbte-taxonomy button:hover { border-color:#6081ae; color:#fff; }
.dbte-taxonomy button.active { border-color:#4b87cb; background:#294b78; color:#fff; }
.dbte-sub-tabs { padding-top:4px; border-top:1px solid #292d35; }
.dbte-sub-tabs button { background:#1c2026; }
.dbte-taxonomy button span { min-width:15px; padding:0 4px; border-radius:8px; background:#101216; color:#8e99a9; text-align:center; }
.dbte-list { position:relative; display:flex; flex-wrap:wrap; align-items:flex-start; align-content:flex-start; gap:5px; max-height:145px; overflow-y:auto; overflow-x:hidden; scrollbar-width:thin; scrollbar-color:#465262 transparent; }
.dbte-list::-webkit-scrollbar { width:6px; }
.dbte-list::-webkit-scrollbar-thumb { background:#465262; border-radius:4px; }
.dbte-empty { color: #666; padding: 6px; }
.dbte-chip { position:relative; display: inline-flex; align-items: center; gap: 4px; min-height:31px; border: 1px solid #466985; background: #203746; border-radius: 5px; padding: 3px 6px; cursor:grab; user-select:none; }
.dbte-chip:active { cursor:grabbing; }
.dbte-chip.dragging { opacity:.28; transform:scale(.96); }
.dbte-chip.drop-target { outline:2px solid #77aaff; outline-offset:2px; }
.dbte-chip.group-selected { outline:2px solid #8fb8ff; outline-offset:1px; box-shadow:0 0 0 2px #17243c inset; }
.dbte-selection-count { color:#9dc0ff; font-size:10px; white-space:nowrap; }
.dbte-marquee { position:absolute; z-index:30; pointer-events:none; border:1px solid #6aa3ff; background:rgba(75,132,225,.2); border-radius:3px; }
.dbte-drag-handle { color:#9aa1ae; font-size:13px; line-height:1; }
.dbte-drag-note { color:#7f8795; font-size:10px; margin-right:auto; }
.dbte-chip.kind-outfit { background:#3b3152; border-color:#775da2; }
.dbte-chip.kind-action { background:#264936; border-color:#4c8b69; }
.dbte-chip.kind-expression { background:#4a2f3d; border-color:#985c78; }
.dbte-chip.kind-scene { background:#423b24; border-color:#8e7d3f; }
.dbte-chip.kind-environment { background:#24453f; border-color:#4f8c7f; }
.dbte-chip.kind-composition { background:#263d51; border-color:#4e7898; }
.dbte-chip.kind-lighting { background:#4b3523; border-color:#9b6a3d; }
.dbte-chip.kind-quality { background:#4c294c; border-color:#965696; }
.dbte-chip.kind-semantic { background:#233d55; border-color:#497da5; }
.dbte-chip.kind-detail { background:#24463f; border-color:#4d8c7e; }
.dbte-chip.kind-manual { background:#3c3c43; border-color:#696974; }
.dbte-chip.disabled { opacity:.4; filter:grayscale(1); }
.dbte-text { display:flex; flex-direction:column; min-width:0; line-height:1.15; }
.dbte-name { color:#eee; white-space:nowrap; }
.dbte-cn { color:#a7c7b0; font-size:9px; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dbte-weight-badge { align-self:flex-start; background:#111a; color:#eee; border-radius:3px; padding:1px 3px; font-size:9px; }
.dbte-inspector { display:flex; flex-direction:column; align-items:stretch; gap:6px; padding:7px; background:#111318; border:1px solid #3e4655; border-radius:6px; box-shadow:0 3px 10px #0007; }
.dbte-inspector.pinned { border-color:#6a5790; }
.dbte-pop-head,.dbte-pop-row { display:flex; align-items:center; gap:7px; }
.dbte-pop-head strong { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; color:#eee; }
.dbte-source { color:#7f8794; font-size:9px; }
.dbte-pop-row label { display:flex; align-items:center; gap:4px; color:#aaa; }
.dbte-pop-row.actions { flex-wrap:wrap; }
.dbte-kind-select { background:#090a0c; color:#eee; border:1px solid #555; border-radius:3px; padding:2px 4px; }
.dbte-translation { display:flex; align-items:center; gap:5px; color:#aaa; }
.dbte-translation input { flex:1; min-width:0; background:#090a0c; color:#eee; border:1px solid #555; border-radius:3px; padding:3px 5px; }
.dbte-toggle,.dbte-remove { border:1px solid #555; border-radius:3px; background:#282b31; color:#ddd; cursor:pointer; padding:2px 5px; }
.dbte-remove { color:#ff8a8a; }
.dbte-kind { color:#aaa; font-size:9px; }
.dbte-weight { min-width:3.6ch; max-width:6ch; background:#090a0c; color:#eee; border:1px solid #555; border-radius:3px; padding:1px 2px; }
.dbs-btn.gacha { background:#5a3f72; border-color:#8d61b3; }
.dbs-btn.danger { color:#ff9a9a; border-color:#704343; }
.dbs-gacha-name { color:#d9b6f2; font-size:10px; }
.dbs-collapsed-tools { flex:1; min-height:0; overflow:auto; display:grid; grid-template-columns:minmax(300px,.9fr) minmax(320px,1.1fr); gap:8px; padding:8px 12px 12px; background:#18181c; }
.dbs-collapsed-panel { min-width:0; min-height:0; overflow:auto; border:1px solid #333743; border-radius:6px; background:#1e1e23; padding:8px; }
.dbs-collapsed-panel .dbs-panel { height:auto; min-height:360px; overflow:visible; }
.dbs-collapsed-panel .dbs-results { min-height:150px; max-height:260px; }
.dbs-collapsed-title { font-weight:700; color:#ddd; margin-bottom:7px; }
.dbs-gacha-context { display:flex; flex-direction:column; gap:7px; }
.dbs-gacha-context .dbs-query-input { flex:0 0 92px; min-height:92px; }
.dbs-runtime-constraints { display:grid; grid-template-columns:minmax(150px,.75fr) minmax(130px,.55fr) minmax(220px,1.2fr); gap:7px; }
.dbs-runtime-field { display:flex; flex-direction:column; gap:4px; min-width:0; color:#aeb5c1; font-size:10px; }
.dbs-runtime-field input[type="range"] { width:100%; accent-color:#4f91df; }
.dbs-runtime-field select,.dbs-runtime-field .dbs-input-line { width:100%; min-width:0; box-sizing:border-box; }
.dbs-runtime-model { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:6px 7px; border:1px solid #303641; border-radius:6px; background:#171a20; }
.dbs-runtime-model label { display:flex; align-items:center; gap:5px; color:#b8bec8; white-space:nowrap; }
.dbs-runtime-model .dbs-settings-note { margin:0; flex:1; min-width:220px; }
.dbs-gacha-status { color:#76c99a; padding:6px; border-radius:4px; background:#173124; overflow-wrap:anywhere; }
.dbs-gacha-status.error { color:#ff8c8c; background:#351b1b; }
.dbs-settings-separator { margin:15px 0 8px; padding-top:10px; border-top:1px solid #3b3b43; font-weight:700; color:#d7b4ed; }
.dbs-settings-note { margin-top:6px; color:#8b8b96; font-size:10px; line-height:1.45; }
.dbs-bootstrap-card { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:10px 12px; padding:9px 10px; border:1px solid #5c4c2f; border-radius:7px; background:#292318; }
.dbs-bootstrap-card.ready { border-color:#376348; background:#192a20; }
.dbs-bootstrap-card strong { color:#f0d59a; }
.dbs-bootstrap-card.ready strong { color:#92d4aa; }
.dbs-bootstrap-card span { flex:1; min-width:260px; color:#aeb4c0; }
.dbs-library-progress { margin:8px 12px; padding:7px 9px; border-radius:5px; background:#16263a; color:#8dc2ff; font-family:Consolas,monospace; overflow-wrap:anywhere; }
.dbs-tag-data-row { display:flex; align-items:center; gap:8px; margin-top:8px; }
.dbs-tag-data-row .dbs-settings-note { margin:0; }
.dbs-data-path { margin-top:5px; color:#6f7683; font:9px/1.4 Consolas,monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dbs-inline-settings { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
.dbs-model-master-switch { display:flex !important; align-items:center; gap:8px; margin:0 0 10px !important; padding:9px; border:1px solid #52416a; border-radius:6px; background:#292235; }
.dbs-model-master-switch span { display:flex; flex-direction:column; gap:2px; }
.dbs-model-master-switch strong { color:#eee; }
.dbs-model-master-switch small { color:#9a91a5; }
@media (max-width: 900px) { .dbte-body.has-inspector { grid-template-columns:1fr; } }
@media (max-width: 760px) { .dbs-collapsed-tools { grid-template-columns:1fr; } .dbs-runtime-constraints { grid-template-columns:1fr; } .dbte-tip { display:none; } }

.dbsb-list {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  flex: 1;
  scrollbar-width: thin;
  scrollbar-color: #333 transparent;
}

.dbsb-list::-webkit-scrollbar { height: 4px; }
.dbsb-list::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

.dbsb-item {
  position: relative;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #333;
  background: #000;
  transition: transform 0.1s, border-color 0.2s;
}

.dbsb-item:hover {
  transform: scale(1.1);
  border-color: #4a7de0;
  z-index: 5;
}

.dbsb-thumb { width: 100%; height: 100%; object-fit: cover; }

.dbsb-remove {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 18px;
  height: 18px;
  background: rgba(229, 85, 85, 0.95);
  color: #fff;
  border: none;
  border-radius: 50%;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.2s;
}

.dbsb-item:hover .dbsb-remove { opacity: 1; }

.dbsb-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #999;
  white-space: nowrap;
  flex-shrink: 0;
}

.dbsb-btn {
  padding: 3px 8px;
  background: #333;
  border: 1px solid #444;
  border-radius: 4px;
  color: #ddd;
  font-size: 10px;
  cursor: pointer;
}

.dbsb-btn:hover { background: #3a3a40; }

.dbs-layout {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.dbs-left {
  width: 320px;
  min-width: 280px;
  max-width: 400px;
  border-right: 1px solid #333;
  background: #1e1e22;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dbs-right {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #16161a;
}

/* 左侧：标签搜索面板 */
.dbs-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.dbs-search-box { padding: 8px; border-bottom: 1px solid #333; flex-shrink: 0; }

.dbs-input {
  width: 100%;
  box-sizing: border-box;
  background: #111;
  color: #ddd;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 6px;
  font-size: 12px;
  resize: vertical;
  min-height: 56px;
  font-family: inherit;
}

.dbs-input:focus { outline: none; border-color: #4a7de0; }

.dbs-toolbar { display: flex; gap: 6px; align-items: center; margin-top: 6px; flex-wrap: wrap; }

.dbs-select {
  background: #222;
  color: #ddd;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 11px;
  cursor: pointer;
}

.dbs-check { display: flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; }

.dbs-btn {
  background: #2a2a30;
  color: #ddd;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.dbs-btn:hover { background: #35353c; }
.dbs-btn.primary { background: #3a6ea5; border-color: #4a7eb5; color: #fff; }
.dbs-btn.primary:hover { background: #4a7eb5; }
.dbs-btn.small { padding: 3px 8px; font-size: 10px; }

.dbs-keywords { margin-top: 6px; font-size: 10px; color: #888; }

.dbs-results { flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0; padding: 4px; }

.dbs-table { display: flex; flex-direction: column; }

.dbs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.dbs-row:hover { background: #25252b; }
.dbs-row.selected { background: #2a3a4a; }

.dbs-tag {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #7fb4ff;
}

.dbs-cn {
  width: 90px;
  flex-shrink: 0;
  color: #aaa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.dbs-cat {
  width: 60px;
  flex-shrink: 0;
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  text-align: center;
  background: #333;
}

.dbs-cat-character { background: #4a3a5a; }
.dbs-cat-copyright { background: #3a4a5a; }

.dbs-count { width:52px; flex:0 0 auto; text-align:right; color:#7f8794; font-size:9px; }
.dbs-score { width: 36px; flex-shrink: 0; text-align: right; color: #888; font-size: 10px; }

.dbs-empty, .dbs-empty-small, .dbs-error {
  color: #777;
  text-align: center;
  padding: 20px 8px;
  font-size: 11px;
}

.dbs-error { color: #e77; }

.dbs-selected {
  border-top: 1px solid #333;
  display: flex;
  flex-direction: column;
  max-height: 35%;
  min-height: 80px;
  overflow: hidden;
  flex-shrink: 0;
}

.dbs-selected-header {
  padding: 6px 8px;
  font-size: 11px;
  color: #999;
  border-bottom: 1px solid #2a2a2a;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.dbs-selected-header span:first-child { flex: 1; }

.dbs-chips {
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
}

.dbs-chip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #2a2a30;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 11px;
}

.dbs-chip span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dbs-chip-del { cursor: pointer; color: #e55; flex-shrink: 0; margin-left: 6px; }

.dbs-related {
  border-top: 1px solid #333;
  display: flex;
  flex-direction: column;
  max-height: 30%;
  min-height: 60px;
  overflow: hidden;
  flex-shrink: 0;
}

.dbs-related-header { padding: 6px 8px; font-size: 11px; color: #999; border-bottom: 1px solid #2a2a2a; flex-shrink: 0; }
.dbs-related-list { flex: 1; overflow-y: auto; padding: 4px; min-height: 0; }

.dbs-related-row {
  display: flex;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  align-items: center;
  transition: background 0.15s;
}

.dbs-related-row:hover { background: #25252b; }

/* 右侧：图库浏览面板 */
.dbg-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.dbg-search-bar {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 12px;
  background: #1e1e22;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.dbg-input {
  flex: 1;
  min-width: 200px;
  padding: 5px 8px;
  background: #111;
  color: #ddd;
  border: 1px solid #333;
  border-radius: 4px;
  font-size: 12px;
}

.dbg-input:focus { outline: none; border-color: #4a7de0; }

.dbg-select {
  background: #222;
  color: #ddd;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 11px;
  cursor: pointer;
}

.dbg-btn {
  background: #2a2a30;
  color: #ddd;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  padding: 5px 12px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.dbg-btn:hover { background: #35353c; }
.dbg-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dbg-btn.primary { background: #3a6ea5; border-color: #4a7eb5; color: #fff; }
.dbg-btn.primary:hover { background: #4a7eb5; }

.dbg-page-info { font-size: 11px; color: #888; }
.dbg-filter-bar {
  display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px;
  padding:5px 12px; border-bottom:1px solid #2d2f36; background:#191a1f;
  color:#8f96a3; font-size:10px; flex:0 0 auto;
}
.dbg-filter-bar label { display:flex; align-items:center; gap:5px; white-space:nowrap; }
.dbg-filter-bar > span { flex:1; min-width:180px; text-align:right; }
.dbg-number {
  width:64px; padding:3px 5px; border:1px solid #343842; border-radius:4px;
  background:#101116; color:#ddd; font-size:10px;
}
.dbg-number:focus { outline:none; border-color:#4a7de0; }
.dbg-pool-search { position:relative; display:flex; align-items:center; gap:5px; }
.dbg-pool-input {
  width:120px; min-width:90px; padding:3px 5px; border:1px solid #343842;
  border-radius:4px; background:#101116; color:#ddd; font-size:10px;
}
.dbg-pool-input:focus { outline:none; border-color:#4a7de0; }
.dbg-pool-results {
  position:absolute; z-index:80; top:calc(100% + 5px); left:0; width:260px;
  max-height:220px; overflow:auto; padding:4px; border:1px solid #464c58;
  border-radius:6px; background:#15171d; box-shadow:0 8px 24px #000a;
}
.dbg-pool-results button {
  width:100%; display:flex; align-items:center; gap:8px; padding:6px 7px;
  border:0; border-radius:4px; background:transparent; color:#d4d8e0;
  text-align:left; cursor:pointer;
}
.dbg-pool-results button:hover { background:#273448; }
.dbg-pool-results button span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dbg-pool-results button small { color:#8993a3; }

.dbg-grid {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  grid-auto-rows: 180px;
  gap: 12px;
  align-content: start;
}

.dbg-grid::-webkit-scrollbar { width: 8px; }
.dbg-grid::-webkit-scrollbar-track { background: transparent; }
.dbg-grid::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }

.dbg-card {
  position: relative;
  background: #1a1a22;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  height: 180px;
}

.dbg-card:hover {
  border-color: #4a7de0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.dbg-card.selected {
  border-color: #4a7de0;
  background: #1e2a40;
  box-shadow: inset 0 0 0 1px #4a7de0;
}

.dbg-img-box {
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #000;
}

.dbg-img { width: 100%; height: 100%; object-fit: cover; display: block; }

.dbg-edit-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  border: 1px solid #4a7de0;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4;
  opacity: 0;
  transition: opacity 0.2s;
  padding: 0;
}

.dbg-card:hover .dbg-edit-btn { opacity: 1; }
.dbg-edit-btn:hover { background: #3a6ea5; }

.dbg-info {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 2;
}

.dbg-size {
  padding: 2px 5px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-size: 9px;
  border-radius: 3px;
  font-family: monospace;
  backdrop-filter: blur(2px);
}

.dbg-rating { padding: 2px 5px; color: #fff; font-size: 9px; font-weight: 600; border-radius: 3px; }

.dbg-stats {
  position: absolute;
  bottom: 4px;
  left: 4px;
  right: 4px;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  z-index: 2;
}

.dbg-check {
  position: absolute;
  inset: 0;
  background: rgba(74, 125, 224, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  pointer-events: none;
}

.dbg-check::after {
  content: '✓';
  width: 32px;
  height: 32px;
  background: #4a7de0;
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
  border: 2px solid #fff;
}

.dbg-loading, .dbg-empty, .dbg-error {
  grid-column: 1 / -1;
  text-align: center;
  padding: 40px;
  color: #666;
  font-size: 13px;
}

.dbg-error { color: #e66; }

.dbg-load-more {
  grid-column: 1 / -1;
  text-align: center;
  padding: 16px;
  color: #666;
  font-size: 12px;
}

/* 已编辑徽章 */
.dbs-edited-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  background: #7B68EE;
  color: white;
  padding: 2px 6px;
  font-size: 9px;
  border-radius: 4px;
  z-index: 6;
  font-weight: 600;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

/* 设置 / 详情弹窗 */
.dbs-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dbs-modal {
  background: #222;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 20px;
  width: 380px;
  max-width: 90%;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
}

.dbs-modal h3 { margin: 0 0 16px; font-size: 14px; color: #eee; }
.dbs-modal label { display: block; margin-bottom: 4px; font-size: 11px; color: #aaa; }

.dbs-input-line {
  width: 100%;
  padding: 6px 8px;
  background: #111;
  border: 1px solid #333;
  border-radius: 4px;
  color: #eee;
  font-size: 12px;
  box-sizing: border-box;
  margin-bottom: 8px;
}

.dbs-input-line:focus { outline: none; border-color: #4a7de0; }

.dbs-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #333;
}

/* 详情 / 编辑弹窗 */
.dbs-detail-modal {
  width: min(1180px, 94vw) !important;
  height: min(820px, 90vh);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}
.dbs-settings-modal { width:min(980px,94%); height:min(720px,88%); max-height:88%; overflow:hidden; box-sizing:border-box; padding:0; display:flex; flex-direction:column; }
.dbs-settings-head { min-height:58px; padding:12px 16px; border-bottom:1px solid #373741; display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
.dbs-settings-head h3 { margin:0 0 3px; }
.dbs-settings-head small { color:#777f8e; }
.dbs-settings-shell { display:grid; grid-template-columns:180px minmax(0,1fr); flex:1; min-height:0; }
.dbs-settings-nav { padding:10px 8px; border-right:1px solid #373741; background:#1c1d22; display:flex; flex-direction:column; gap:4px; overflow-y:auto; }
.dbs-settings-nav button { text-align:left; color:#aeb3be; background:transparent; border:1px solid transparent; border-radius:6px; padding:9px 10px; cursor:pointer; }
.dbs-settings-nav button:hover { background:#292b32; color:#eee; }
.dbs-settings-nav button.active { background:#294b79; border-color:#477fbd; color:#fff; }
.dbs-settings-content { min-width:0; min-height:0; padding:14px; overflow-y:auto; background:#202126; }
.dbs-setting-section { border:1px solid #393b45; border-radius:8px; background:#1b1c21; margin-bottom:12px; overflow:hidden; }
.dbs-setting-section h4 { margin:0; padding:10px 12px; color:#e4e7ed; border-bottom:1px solid #343640; font-size:12px; }
.dbs-setting-desc { margin:0; padding:8px 12px; color:#858c9b; background:#1e2026; line-height:1.45; }
.dbs-setting-row { display:grid; grid-template-columns:150px minmax(0,1fr); gap:12px; align-items:start; padding:9px 12px; border-top:1px solid #2c2e36; }
.dbs-setting-row:first-of-type { border-top:0; }
.dbs-setting-label { color:#b9bec8; padding-top:6px; }
.dbs-setting-control { min-width:0; }
.dbs-setting-control .dbs-input-line { margin:0; }
.dbs-setting-control small { display:block; color:#747c8b; margin-top:5px; line-height:1.4; }
.dbs-setting-checks { display:flex; flex-wrap:wrap; gap:10px; padding:5px 0; }
.dbs-setting-checks label { display:flex; align-items:center; gap:4px; margin:0; }
.dbs-status-card { margin:10px 12px; padding:9px; border:1px solid #344b42; border-radius:6px; background:#1c2b25; display:flex; flex-direction:column; gap:4px; }
.dbs-status-card code { color:#778397; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dbs-setting-section > .dbs-btn,.dbs-setting-section > .dbs-setting-actions { margin:0 12px 10px; }
.dbs-gacha-counts { display:grid; grid-template-columns:repeat(4,minmax(110px,1fr)); gap:8px; padding:10px 12px; }
.dbs-gacha-counts label { display:flex; align-items:center; gap:6px; margin:0; color:#bbb; }
.dbs-gacha-counts label span { flex:1; }
.dbs-gacha-counts .dbs-input-line { width:54px; margin:0; }
.dbs-gacha-intent { margin:10px 12px; padding:10px; border:1px solid #343945; border-radius:7px; background:#181a20; }
.dbs-gacha-intent-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
.dbs-gacha-intent-head small { color:#777f8e; }
.dbs-gacha-facet-blocks { display:flex; flex-direction:column; gap:8px; padding:8px 12px; }
.dbs-gacha-facet-block { border:1px solid #343945; border-radius:7px; background:#171a20; overflow:hidden; }
.dbs-gacha-facet-group-title { padding:7px 10px; border-bottom:1px solid #303540; color:#9fc7f2; font-weight:650; }
.dbs-gacha-facet-block .dbs-gacha-facet-grid { padding:8px; }
.dbs-gacha-mode-grid { display:grid; grid-template-columns:repeat(4,minmax(92px,1fr)); gap:7px; }
.dbs-gacha-mode,.dbs-gacha-facet { min-width:0; display:flex; align-items:center; justify-content:space-between; gap:7px; padding:7px 9px;
  border:1px solid #414651; border-radius:6px; background:#262930; color:#d7dbe4; cursor:pointer; }
.dbs-gacha-mode small,.dbs-gacha-facet small { color:#8e96a5; white-space:nowrap; }
.dbs-gacha-mode.mode-required,.dbs-gacha-facet.mode-required { background:#23466a; border-color:#4d90cf; color:#fff; }
.dbs-gacha-mode.mode-required small,.dbs-gacha-facet.mode-required small { color:#a9d7ff; }
.dbs-gacha-mode.mode-off { opacity:.62; background:#292326; border-color:#5a4147; text-decoration:line-through; }
.dbs-gacha-facet.mode-prefer { background:#303823; border-color:#668443; }
.dbs-gacha-facet-tabs { display:flex; flex-wrap:wrap; gap:6px; padding:10px 12px 8px; border-bottom:1px solid #30323a; }
.dbs-gacha-facet-tabs button { padding:6px 11px; border:1px solid #414651; border-radius:6px; background:#25282f; color:#c9ced8; cursor:pointer; }
.dbs-gacha-facet-tabs button.active { background:#315b91; border-color:#5791d3; color:#fff; }
.dbs-gacha-facet-grid { display:grid; grid-template-columns:repeat(4,minmax(110px,1fr)); gap:7px; max-height:210px; overflow:auto; padding:10px 12px; }
.dbs-gacha-facet { font-size:11px; }
.dbs-gacha-exact { margin:10px 12px; border:1px solid #363a44; border-radius:6px; background:#181a20; }
.dbs-gacha-exact > summary { padding:9px 11px; color:#cbd1db; cursor:pointer; }
.dbs-gacha-facet-counts { display:grid; grid-template-columns:repeat(3,minmax(150px,1fr)); gap:7px; max-height:300px; overflow:auto; padding:9px; border-top:1px solid #30333b; }
.dbs-gacha-facet-counts label { min-width:0; display:grid; grid-template-columns:minmax(0,1fr) 52px; gap:6px; align-items:center; padding:6px 7px; border:1px solid #30343d; border-radius:5px; color:#aeb5c1; }
.dbs-gacha-facet-counts label span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dbs-gacha-facet-counts .dbs-input-line { width:52px; margin:0; }
.dbcm { margin-top:10px; border:1px solid #3a3d46; border-radius:8px; background:#18191e; overflow:hidden; }
.dbcm-head { display:flex; align-items:baseline; gap:10px; padding:9px 11px; border-bottom:1px solid #30323a; }
.dbcm-head strong { color:#e4e8ef; }
.dbcm-head span { color:#7f8796; font-size:11px; }
.dbcm-tabs { display:flex; flex-wrap:wrap; gap:5px; padding:8px 10px; border-bottom:1px solid #2d2f36; }
.dbcm-tabs button { display:inline-flex; align-items:center; gap:6px; padding:5px 9px; border:1px solid #444955; border-radius:5px; background:#282a31; color:#c6cbd4; cursor:pointer; }
.dbcm-tabs button.active { background:#315b91; border-color:#5791d3; color:#fff; }
.dbcm-tabs small { min-width:17px; padding:0 4px; border-radius:9px; background:rgba(255,255,255,.1); text-align:center; }
.dbcm-tools { display:flex; align-items:center; flex-wrap:wrap; gap:7px; padding:8px 10px; background:#1e2026; }
.dbcm-tools > span { color:#8d95a3; font-size:11px; }
.dbcm-tools .dbs-select { min-width:125px; }
.dbcm-tags { display:flex; flex-wrap:wrap; gap:6px; max-height:190px; overflow:auto; padding:10px; }
.dbcm-tag { padding:5px 8px; border:1px solid #444955; border-radius:5px; background:#292b32; color:#d7dbe3; cursor:pointer; text-align:left; }
.dbcm-tag:hover { border-color:#668cc1; }
.dbcm-tag.selected { border-color:#67a9ff; background:#24466f; box-shadow:inset 0 0 0 1px #67a9ff; }
.dbcm-tag.major-character { border-left:3px solid #6fa8dc; }
.dbcm-tag.major-styling { border-left:3px solid #b989c9; }
.dbcm-tag.major-action { border-left:3px solid #d8a35c; }
.dbcm-tag.major-world { border-left:3px solid #65aa82; }
.dbcm-tag.major-visual { border-left:3px solid #65b7c2; }
.dbcm-empty { color:#777f8e; padding:8px; }
.dbs-profile-list { margin:10px 12px; border:1px solid #343742; border-radius:6px; overflow:hidden; }
.dbs-profile-row { display:grid; grid-template-columns:160px 1fr 1.3fr; gap:8px; padding:7px 9px; border-top:1px solid #30323b; }
.dbs-profile-row:first-child { border-top:0; }
.dbs-profile-row span,.dbs-profile-row small { color:#8c94a3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dbs-setting-actions { display:flex; gap:8px; }
.dbs-settings-message { padding:7px 14px; color:#ff9a9a; background:#351e22; border-top:1px solid #53343a; flex-shrink:0; }
.dbs-settings-message.ok { color:#82d8a6; background:#183326; border-color:#295440; }
.dbs-settings-footer { margin:0; padding:10px 14px; flex-shrink:0; background:#1c1d22; }
@media (max-width:760px) { .dbs-settings-shell { grid-template-columns:130px minmax(0,1fr); } .dbs-setting-row { grid-template-columns:1fr; gap:4px; } .dbs-gacha-counts,.dbs-gacha-mode-grid,.dbs-gacha-facet-grid,.dbs-gacha-facet-counts { grid-template-columns:repeat(2,1fr); } }

.dbs-detail-body { display:grid; grid-template-columns:minmax(300px, 44%) minmax(0, 1fr); gap:14px; flex:1; min-height:0; overflow:hidden; }

.dbs-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.dbs-detail-header h3 { margin: 0; }

.dbs-detail-preview {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: #000;
  border-radius: 6px;
  overflow: auto;
  margin-bottom: 0;
  min-height: 0;
}
.dbs-detail-preview img { display:block; width:auto; max-width:100%; height:auto; object-fit:contain; }
.dbs-detail-side { min-width:0; min-height:0; display:flex; flex-direction:column; overflow:hidden; }

.dbs-detail-tags {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 0;
  min-height: 0;
  padding-right: 6px;
  scrollbar-gutter: stable;
}
.dbs-detail-footer { flex-shrink:0; padding-top:9px; background:#222228; border-top:1px solid #33343b; }

.dbs-tag-section { margin-bottom: 12px; }

.dbs-tag-section-title {
  font-size: 11px;
  font-weight: 600;
  color: #aaa;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dbs-tag-group { display: flex; flex-wrap: wrap; gap: 4px; }

.dbs-tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.dbs-tag-chip:hover { transform: scale(1.05); filter: brightness(1.1); }
.dbs-tag-chip.highlighted { box-shadow:0 0 0 2px #4a9eff,0 0 10px #4a9eff77; transform:translateY(-1px); }

/* 标签分类配色 */
.dbs-tag-category-artist    { background-color: #FFF3CD; color: #664D03; border: 1px solid #FFE69C; }
.dbs-tag-category-copyright { background-color: #F8D7DA; color: #58151D; border: 1px solid #F5C2C7; }
.dbs-tag-category-character { background-color: #D4EDDA; color: #155724; border: 1px solid #C3E6CB; }
.dbs-tag-category-general   { background-color: #D1ECF1; color: #0C5460; border: 1px solid #BEE5EB; }
.dbs-tag-category-meta      { background-color: #F8F9FA; color: #383D41; border: 1px solid #DFE2E5; }

.dbs-add-tag-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.dbs-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid #333;
  flex-shrink: 0;
}

.dbs-detail-btn {
  flex: 1 1 120px;
  padding: 8px 12px;
  background: #2a2a30;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  color: #ddd;
  font-size: 12px;
  cursor: pointer;
}

@media (max-width:760px) {
  .dbs-detail-modal { height:min(900px,94vh); }
  .dbs-detail-body { grid-template-columns:1fr; grid-template-rows:minmax(180px,38vh) minmax(0,1fr); }
}

.dbs-detail-btn:hover { background: #35353c; }
.dbs-detail-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dbs-detail-btn.primary { background: #3a6ea5; border-color: #4a7eb5; color: #fff; }
.dbs-detail-btn.primary:hover { background: #4a7eb5; }

/* 标签右键菜单 */
.dbs-tag-context-menu {
  position: fixed;
  background: #2a2a30;
  border: 1px solid #444;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  z-index: 10002;
  padding: 6px;
  min-width: 130px;
}

.dbs-tag-context-menu-item {
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.2s;
  font-size: 12px;
  color: #ddd;
  user-select: none;
}

.dbs-tag-context-menu-item:hover { background: rgba(74, 125, 224, 0.3); }
`;

// ════════════════════════════════════════════════════════════════════════════
// ComfyUI 扩展注册
// ════════════════════════════════════════════════════════════════════════════

app.registerExtension({
  name: "EagleSuite.DanbooruSearchVue",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DanbooruVueSearchNode") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);

      if (this._dbsInit || this._dbsMounting) return;
      this._dbsMounting = true;

      this.setSize([1200, 700]);

      const hideWidget = (node) => {
        const w = (node.widgets || []).find(x => x.name === "selection_data");
        if (!w) return false;
        w.type = "hidden";
        w.computeSize = () => [0, -4];
        w.hidden = true;
        w.draw = () => {};
        node.setDirtyCanvas(true, true);
        return true;
      };

      setTimeout(() => {
        if (!hideWidget(this)) {
          setTimeout(() => hideWidget(this), 500);
        }
      }, 300);

      let container = null;
      let vueApp = null;
      try {
        // Always refresh this node's scoped stylesheet. This also fixes stale
        // CSS left behind by a frontend hot reload without touching ComfyUI's
        // global theme or any other Vue node.
        let style = document.getElementById("dbs-style");
        if (!style) {
          style = document.createElement("style");
          style.id = "dbs-style";
          document.head.appendChild(style);
        }
        style.textContent = CSS;

          container = document.createElement("div");
          container.style.cssText = "width:1180px;max-width:none;min-width:0;height:100%;min-height:0;box-sizing:border-box;overflow:hidden;position:relative;";

        const widget = this.addDOMWidget("danbooru_search_vue", "div", container, {
          serialize: false,
          // This is a full canvas application, not an editable parameter.
          // ComfyUI 1.49's right panel otherwise mounts WidgetLegacy and writes
          // its narrow sidebar width back to widget.width, clipping the canvas UI.
          canvasOnly: true,
        });
        widget.width = undefined;
        this._dbsWidget = widget;

        vueApp = createApp(DanbooruSearchApp, { node: this });
        vueApp.config.errorHandler = (error, instance, info) => {
          console.error("[Eagle Suite] Danbooru Vue render error:", info, error);
        };
        vueApp.mount(container);
        this._vueApp = vueApp;
        this._dbsContainer = container;
        this._dbsInit = true;

          const syncWidgetLayout = (size) => {
            const currentSize = size || this.size || [1200, 700];
            const nodeWidth = Math.max(640, Number(currentSize[0]) || 1200);
            const nodeHeight = Math.max(480, Number(currentSize[1]) || 700);
            const width = Math.max(620, nodeWidth - 20);
            // 标题和四个输入端口属于 LiteGraph 原生区域。DOM 只占剩余
            // 视口；内部三栏各自滚动，内容量不能反向改变节点高度。
            const hgt = Math.max(300, nodeHeight - 150);

            container.style.width = width + "px";
            container.style.maxWidth = "none";
            container.style.minWidth = "0";
            container.style.height = hgt + "px";

            const host = container.parentElement;
            if (host) {
              host.style.width = width + "px";
              host.style.maxWidth = "none";
              host.style.minWidth = "0";
              host.style.height = hgt + "px";
              host.style.maxHeight = hgt + "px";
              host.style.boxSizing = "border-box";
              host.style.overflow = "hidden";
            }
            return hgt;
          };
          // Do not derive computeSize from node.size. New ComfyUI measures every
          // DOM widget while laying out the graph; feeding node height back as
          // widget height makes the native input-row height accumulate forever.
          // The fixed container/host height above is the measurement boundary.
          this._dbsSyncLayout = syncWidgetLayout;
          syncWidgetLayout(this.size);
          requestAnimationFrame(() => syncWidgetLayout(this.size));
          setTimeout(() => syncWidgetLayout(this.size), 250);

          const onResize = this.onResize;
          this.onResize = function (size) {
            onResize?.apply(this, arguments);
            this._dbsSyncLayout?.(size);
          };

          const onConfigure = this.onConfigure;
          this.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            this.properties = this.properties || {};
            if (Number(this.properties.eagle_dbs_layout_version || 0) < 2) {
              // Recover old workflows whose feedback loop already persisted a
              // several-thousand-pixel height. This runs once; later deliberate
              // user resizing is preserved by the version marker.
              const restoredWidth = Math.max(640, Number(this.size?.[0]) || 1200);
              const restoredHeight = Number(this.size?.[1]) || 700;
              if (restoredHeight > 1200) this.setSize([restoredWidth, 760]);
              this.properties.eagle_dbs_layout_version = 2;
            }
            hideWidget(this);
            requestAnimationFrame(() => this._dbsSyncLayout?.(this.size));
          };
      } catch (error) {
        try { vueApp?.unmount(); } catch (_) {}
        this._vueApp = null;
        this._dbsInit = false;
        console.error("[Eagle Suite] Danbooru Vue mount failed:", error);
        if (container) {
          container.replaceChildren();
          const errorBox = document.createElement("div");
          errorBox.className = "dbs-mount-error";
          errorBox.style.cssText = "padding:16px;color:#ff8b8b;white-space:pre-wrap;";
          errorBox.textContent = "Danbooru 界面加载失败。请刷新 ComfyUI 前端；详细错误已写入浏览器控制台。\n" + String(error?.message || error);
          container.appendChild(errorBox);
        }
      } finally {
        this._dbsMounting = false;
      }
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._vueApp) {
        this._vueApp.unmount();
        this._vueApp = null;
      }
      this._dbsInit = false;
      this._dbsMounting = false;
          this._dbsContainer = null;
          this._dbsWidget = null;
          this._dbsSyncLayout = null;
      onRemoved?.apply(this, arguments);
    };
  },
});
