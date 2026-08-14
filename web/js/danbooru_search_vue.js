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
  { value: "character", label: "Character" },
  { value: "copyright", label: "Copyright" },
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

const TAG_KIND_LABELS = {
  semantic: "语义", detail: "图片", manual: "手动", gacha: "抽卡",
  outfit: "服装", action: "动作", scene: "场景", composition: "构图",
  lighting: "光照", quality: "质量", general: "通用",
};

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
    source: raw.source || defaults.source || "manual",
    weight: Number.isFinite(weightValue) ? Math.max(-2, Math.min(2, weightValue)) : 1,
    enabled: raw.enabled !== false,
  };
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
  ["artist", "copyright", "character", "general"].forEach(k => {
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

        const data = await res.json();

        if (data.success) {
          results.value = data.results || [];
          keywords.value = data.keywords || [];
        } else {
          errorMsg.value = data.error || "搜索失败";
          results.value = [];
        }
      } catch (e) {
        errorMsg.value = "请求失败: " + e.message;
        results.value = [];
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

          const data = await res.json();
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
        score: item.cooc_score,
      });
      loadRelated();
    }

    function selectedItems() {
      return selected.value.map(s => ({
          tag: s.tag,
          translation: s.cn_name || "",
          category: String(s.category || "general").toLowerCase(),
          kind: "semantic",
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
            placeholder: "描述你想要的画面，例如：一个在雨中奔跑的少女",
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
                style: { maxWidth: "100%", maxHeight: "62vh", objectFit: "contain" },
              }),
            ]),

            h("div", { class: "dbs-detail-tags" }, TAG_CATEGORIES.map(cat => {
            const tags = store.value[cat.key] || [];
            if (tags.length === 0) return null;
            return h("div", { class: "dbs-tag-section", key: cat.key }, [
              h("div", { class: "dbs-tag-section-title" }, cat.label + " (" + tags.length + ")"),
              h("div", { class: "dbs-tag-group" }, tags.map(tag => {
                const cn = translationCache[tag];
                return h("div", {
                  class: ["dbs-tag-chip", "dbs-tag-category-" + cat.key, highlighted.has(tag) ? "highlighted" : ""],
                  key: tag,
                  title: cn ? (tag + " · " + cn) : tag,
                  onClick: () => toggleHighlighted(tag),
                  onContextmenu: e => showCtxMenu(e, tag, cat.key),
                }, cn ? (tag + " (" + cn + ")") : tag);
              })),
            ]);
            })),
          ]),

          // 添加标签
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
              onKeydown: e => {
                if (e.key === "Enter") { e.preventDefault(); addTag(); }
              },
            }),
            h("button", { class: "dbs-btn small", onClick: addTag }, "➕ 添加"),
          ]),

          h("div", { class: "dbs-detail-actions" }, [
            h("button", { class: "dbs-detail-btn", onClick: selectAllTags }, "全选"),
            h("button", { class: "dbs-detail-btn", onClick: () => highlighted.clear() }, "清除高亮"),
            h("button", { class: "dbs-detail-btn primary", onClick: addHighlighted }, "➕ 加入节点标签"),
            h("button", { class: "dbs-detail-btn primary", onClick: copyTags }, "📋 复制高亮标签"),
            h("button", {
              class: "dbs-detail-btn",
              disabled: !edited,
              onClick: doReset,
            }, "🔄 重置标签"),
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
            limit: PAGE_LIMIT,
            rating_filter: ratingFilter.value,
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
          hasMore.value = incoming.length >= PAGE_LIMIT;
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
        if (data.success && data.settings?.rating_filter) {
          ratingFilter.value = data.settings.rating_filter;
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

          h("button", { class: "dbg-btn primary", onClick: doSearch }, loading.value ? "搜索中…" : "🔍 搜索"),

          h("div", { class: "dbg-page-info" }, posts.value.length > 0 ? ("已加载 " + posts.value.length + " 张") : ""),
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
                }, [
                  edited ? h("div", { class: "dbs-edited-badge" }, "已编辑") : null,

                  h("div", { class: "dbg-img-box" }, [
                    h("img", {
                      class: "dbg-img",
                      src: proxiedImageUrl(post.preview_file_url || post.large_file_url),
                      loading: "lazy",
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
      const [moving] = items.splice(from, 1);
      items.splice(target, 0, moving);
      emit(items);
      if (editingIndex.value === from) editingIndex.value = target;
      else if (editingIndex.value >= 0) editingIndex.value = -1;
      hoverIndex.value = target;
    }
    function finishDrag() {
      dragIndex.value = -1;
      dropIndex.value = -1;
    }
    return () => {
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
      h("div", { class: "dbte-list" }, (props.tags || []).length ? (props.tags || []).map((item, index) => {
        const cn = resolveTranslation(item.tag, item.translation);
        const weight = Number(item.weight == null ? 1 : item.weight);
        const weightText = Number.isInteger(weight) ? weight.toFixed(1) : String(Math.round(weight * 100) / 100);
        return h("div", {
          class: ["dbte-chip", "kind-" + (item.kind || item.category || "general"), item.enabled === false ? "disabled" : "", dragIndex.value === index ? "dragging" : "", dropIndex.value === index ? "drop-target" : ""],
          key: (item.tag || "tag") + "-" + index,
          draggable: true,
          title: "按住拖拽排序；悬浮查看编辑器；右键固定；双击屏蔽/恢复输出",
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
            h("span", { class: "dbte-name" }, item.tag.replace(/_/g, " ")),
            h("span", { class: "dbte-cn" }, cn || "未翻译"),
          ]),
          Math.abs(weight - 1) > 0.0001 ? h("span", { class: "dbte-weight-badge" }, weightText) : null,
        ]);
      }) : [h("div", { class: "dbte-empty" }, "从语义搜索、图片详情高亮或角色抽卡加入标签")]),
      ]),
      inspectorItem ? h("div", { class: ["dbte-inspector", editingIndex.value >= 0 ? "pinned" : ""] }, [
        h("div", { class: "dbte-pop-head" }, [
          h("strong", {}, inspectorItem.tag),
          h("span", { class: "dbte-source" }, "来源: " + (inspectorItem.source || "manual")),
          editingIndex.value >= 0 ? h("button", { class: "dbte-toggle", onClick: () => { editingIndex.value = -1; } }, "取消固定") : h("span", { class: "dbte-source" }, "右键标签可固定"),
        ]),
        h("div", { class: "dbte-pop-row" }, [
          h("label", {}, ["用途 ", h("select", { class: "dbte-kind-select", value: inspectorItem.kind || "general", onChange: e => updateAt(inspectorIndex, { kind: e.target.value }) },
            ["general", "outfit", "action", "scene", "composition", "lighting", "quality", "manual", "semantic", "detail"].map(kind => h("option", { value: kind }, TAG_KIND_LABELS[kind] || kind))
          )]),
          h("label", {}, ["Danbooru 类型 ", h("select", { class: "dbte-kind-select", value: inspectorItem.category || "general", onChange: e => updateAt(inspectorIndex, { category: e.target.value }) },
            ["general", "character", "copyright", "artist", "meta"].map(kind => h("option", { value: kind }, kind))
          )]),
          h("label", {}, ["权重 ", h("input", { class: "dbte-weight", type: "number", min: -2, max: 2, step: 0.1, value: inspectorWeightText,
            style: { width: Math.max(3.5, inspectorWeightText.length + 1) + "ch" }, onChange: e => {
              const value = Number(e.target.value);
              updateAt(inspectorIndex, { weight: Number.isFinite(value) ? Math.max(-2, Math.min(2, value)) : 1 });
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

const SettingsDialog = {
  name: "SettingsDialog",
  props: {
    visible: Boolean,
    onClose: Function,
  },
  setup(props) {
    const modelPath = ref("");
    const username = ref("");
    const apiKey = ref("");
    const ratingFilter = ref("general");
    const hideAi = ref(true);
    const proxyUrl = ref("");
    const apiBaseUrl = ref("https://danbooru.donmai.us");
    const enableModelCalls = ref(false);
    const gachaProvider = ref("rules");
    const gachaApiProfile = ref("");
    const gachaLocalUrl = ref("http://127.0.0.1:11434/v1");
    const gachaLocalModel = ref("");
    const gachaComfyModel = ref("");
    const gachaComfyDevice = ref("auto");
    const gachaComfyDtype = ref("bf16");
    const gachaProfiles = ref([]);
    const localModels = ref([]);
    const tagDataStatus = ref(null);
    const reloadingTags = ref(false);
    const saving = ref(false);
    const errorMsg = ref("");

    async function loadSettings() {
      errorMsg.value = "";
      try {
        const res = await fetch("/danbooru_search/settings");
        const data = await res.json();

        if (data.success && data.settings) {
          modelPath.value = data.settings.model_path || "";
          username.value = data.settings.danbooru_username || "";
          apiKey.value = data.settings.danbooru_api_key || "";
          ratingFilter.value = data.settings.rating_filter || "general";
          hideAi.value = data.settings.hide_ai !== false;
          proxyUrl.value = data.settings.proxy_url || "";
          apiBaseUrl.value = data.settings.api_base_url || "https://danbooru.donmai.us";
          enableModelCalls.value = data.settings.enable_model_calls === true;
          gachaProvider.value = data.settings.gacha_provider || "rules";
          gachaApiProfile.value = data.settings.gacha_api_profile || "";
          gachaLocalUrl.value = data.settings.gacha_local_url || "http://127.0.0.1:11434/v1";
          gachaLocalModel.value = data.settings.gacha_local_model || "";
          gachaComfyModel.value = data.settings.gacha_comfy_model || "";
          gachaComfyDevice.value = data.settings.gacha_comfy_device || "auto";
          gachaComfyDtype.value = data.settings.gacha_comfy_dtype || "bf16";
        } else {
          errorMsg.value = data.error || "读取设置失败";
        }
        const profilesRes = await fetch("/danbooru_search/gacha_profiles");
        const profilesData = await profilesRes.json();
        gachaProfiles.value = profilesData.success && Array.isArray(profilesData.profiles) ? profilesData.profiles : [];
        const [modelsRes, statusRes] = await Promise.all([
          fetch("/danbooru_search/local_models"),
          fetch("/danbooru_search/tag_data_status"),
        ]);
        const modelsData = await modelsRes.json();
        const statusData = await statusRes.json();
        localModels.value = modelsData.success && Array.isArray(modelsData.models) ? modelsData.models : [];
        tagDataStatus.value = statusData.success ? statusData.data : null;
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
          body: JSON.stringify({
            model_path: modelPath.value,
            danbooru_username: username.value,
            danbooru_api_key: apiKey.value,
            rating_filter: ratingFilter.value,
            hide_ai: hideAi.value,
            proxy_url: proxyUrl.value,
            api_base_url: apiBaseUrl.value,
            enable_model_calls: enableModelCalls.value,
            gacha_provider: gachaProvider.value,
            gacha_api_profile: gachaApiProfile.value,
            gacha_local_url: gachaLocalUrl.value,
            gacha_local_model: gachaLocalModel.value,
            gacha_comfy_model: gachaComfyModel.value,
            gacha_comfy_device: gachaComfyDevice.value,
            gacha_comfy_dtype: gachaComfyDtype.value,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || ("HTTP " + res.status));
        }
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
        const res = await fetch("/danbooru_search/reload_tag_data", { method: "POST" });
        const data = await res.json();
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

    watch(() => props.visible, (visible) => {
      if (visible) loadSettings();
    }, { immediate: true });

    return () => {
      if (!props.visible) return h("div");

      return h("div", { class: "dbs-modal-backdrop", onClick: props.onClose }, [
        h("div", {
          class: "dbs-modal dbs-settings-modal",
          onClick: e => e.stopPropagation(),
        }, [
          h("h3", {}, "⚙ 设置"),

          h("label", { style: { marginTop: "12px" } }, "Danbooru 用户名（可选）"),
          h("input", {
            class: "dbs-input-line",
            value: username.value,
            placeholder: "用于访问 R-18 内容",
            onInput: e => { username.value = e.target.value; },
          }),

          h("label", { style: { marginTop: "8px" } }, "Danbooru API Key（可选）"),
          h("input", {
            class: "dbs-input-line",
            type: "password",
            value: apiKey.value,
            placeholder: "在 danbooru.donmai.us/profile 获取",
            onInput: e => { apiKey.value = e.target.value; },
          }),

          h("label", { style: { marginTop: "12px" } }, "默认评级过滤"),
          h("select", {
            class: "dbs-input-line",
            value: ratingFilter.value,
            onChange: e => { ratingFilter.value = e.target.value; },
          }, RATING_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

          h("label", { class: "dbs-check", style: { marginTop: "12px" } }, [
            h("input", {
              type: "checkbox",
              checked: hideAi.value,
              onChange: e => { hideAi.value = e.target.checked; },
            }),
            " 隐藏 AI 生成图片",
          ]),

          h("label", { style: { marginTop: "12px" } }, "本地代理地址（连不上 danbooru.donmai.us 时填这个）"),
          h("input", {
            class: "dbs-input-line",
            value: proxyUrl.value,
            placeholder: "例如 http://127.0.0.1:7890，留空则直连",
            onInput: e => { proxyUrl.value = e.target.value; },
          }),

          h("label", { style: { marginTop: "12px" } }, "Danbooru API 基址（高级）"),
          h("input", {
            class: "dbs-input-line",
            value: apiBaseUrl.value,
            placeholder: "https://danbooru.donmai.us",
            onInput: e => { apiBaseUrl.value = e.target.value; },
          }),
          h("div", {
            style: { marginTop: "5px", color: "#8b8b96", fontSize: "11px", lineHeight: "1.4" },
          }, "官方站被 Cloudflare 拦截时，可填写你信任的 Danbooru API 反代地址。"),

          h("div", { class: "dbs-settings-separator" }, "标签数据与语义模型"),
          h("label", {}, "语义搜索模型（models/text_encoders 或 models/LLM）"),
          h("select", {
            class: "dbs-input-line", value: modelPath.value,
            onChange: e => { modelPath.value = e.target.value; },
          }, [h("option", { value: "" }, "默认 BAAI/bge-m3")].concat(
            modelPath.value && !localModels.value.some(model => model.path === modelPath.value)
              ? [h("option", { value: modelPath.value }, "当前自定义路径")]
              : [],
            localModels.value.filter(model => model.semantic).map(model => h("option", { value: model.path }, model.name))
          )),
          h("label", { style: { marginTop: "8px" } }, "或手动填写 SentenceTransformer 模型路径"),
          h("input", { class: "dbs-input-line", value: modelPath.value, placeholder: "留空使用 BAAI/bge-m3", onInput: e => { modelPath.value = e.target.value; } }),
          h("div", { class: "dbs-settings-note" }, "语义搜索要求模型兼容 SentenceTransformer；纯 CLIP/T5 即使能列出，也可能不兼容。顶部路径框仍可手动填写任意本地路径。"),
          h("div", { class: "dbs-tag-data-row" }, [
            h("button", { class: "dbs-btn", disabled: reloadingTags.value, onClick: reloadTagData }, reloadingTags.value ? "重载中…" : "🔄 重新载入标签数据"),
            h("span", { class: "dbs-settings-note" }, tagDataStatus.value?.tags?.exists
              ? ((tagDataStatus.value.translations_in_memory || 0) + " 条 · " + (tagDataStatus.value.tags.modified || "时间未知"))
              : "未找到 tags_enhanced.csv"),
          ]),
          tagDataStatus.value?.tags?.path ? h("div", { class: "dbs-data-path", title: tagDataStatus.value.tags.path }, tagDataStatus.value.tags.path) : null,

          h("div", { class: "dbs-settings-separator" }, "角色外内容抽卡"),
          h("label", { class: "dbs-check dbs-model-master-switch" }, [
            h("input", { type: "checkbox", checked: enableModelCalls.value, onChange: e => { enableModelCalls.value = e.target.checked; } }),
            h("span", {}, [h("strong", {}, "允许语言模型 / API 调用"), h("small", {}, "关闭时绝不加载生成模型，也不请求 LLM API")]),
          ]),
          h("label", {}, "抽卡生成方式"),
          h("select", {
            class: "dbs-input-line",
            value: gachaProvider.value,
            onChange: e => { gachaProvider.value = e.target.value; },
          }, [
            h("option", { value: "rules" }, "本地规则引擎（推荐，零模型占用）"),
            h("option", { value: "gallery" }, "从已选画廊图片抽取标签（零模型占用）"),
            h("option", { value: "api_profile", disabled: !enableModelCalls.value }, "api_config.json 中的大语言模型"),
            h("option", { value: "local_openai", disabled: !enableModelCalls.value }, "本地 OpenAI 兼容服务"),
            h("option", { value: "comfyui_model", disabled: !enableModelCalls.value }, "ComfyUI models 中的本地生成模型"),
          ]),

          gachaProvider.value === "api_profile" ? h("div", {}, [
            h("label", { style: { marginTop: "8px" } }, "API 模型配置"),
            h("select", {
              class: "dbs-input-line",
              value: gachaApiProfile.value,
              onChange: e => { gachaApiProfile.value = e.target.value; },
            }, [h("option", { value: "" }, "使用 api_config 当前激活模型")].concat(
              gachaProfiles.value.map(p => h("option", { value: p.name }, p.name + (p.model ? " · " + p.model : "")))
            )),
          ]) : null,

          gachaProvider.value === "local_openai" ? h("div", {}, [
            h("label", { style: { marginTop: "8px" } }, "本地服务 URL"),
            h("input", {
              class: "dbs-input-line", value: gachaLocalUrl.value,
              placeholder: "Ollama / LM Studio / llama.cpp，例如 http://127.0.0.1:11434/v1",
              onInput: e => { gachaLocalUrl.value = e.target.value; },
            }),
            h("label", { style: { marginTop: "8px" } }, "模型名称或路径（作为 model 参数）"),
            h("input", {
              class: "dbs-input-line", value: gachaLocalModel.value,
              placeholder: "例如 qwen2.5:7b；由本地服务负责加载模型",
              onInput: e => { gachaLocalModel.value = e.target.value; },
            }),
          ]) : null,
          gachaProvider.value === "comfyui_model" ? h("div", {}, [
            h("label", { style: { marginTop: "8px" } }, "本地生成模型"),
            h("select", {
              class: "dbs-input-line", value: gachaComfyModel.value,
              onChange: e => { gachaComfyModel.value = e.target.value; },
            }, [h("option", { value: "" }, "请选择模型")].concat(
              localModels.value.filter(model => model.generative).map(model => h("option", { value: model.name }, model.name))
            )),
            h("div", { class: "dbs-inline-settings" }, [
              h("label", {}, ["设备", h("select", { class: "dbs-input-line", value: gachaComfyDevice.value, onChange: e => { gachaComfyDevice.value = e.target.value; } },
                ["auto", "cuda", "cpu"].map(value => h("option", { value }, value)))]),
              h("label", {}, ["精度", h("select", { class: "dbs-input-line", value: gachaComfyDtype.value, onChange: e => { gachaComfyDtype.value = e.target.value; } },
                ["bf16", "fp16", "fp32"].map(value => h("option", { value }, value)))]),
            ]),
            h("div", { class: "dbs-settings-note" }, "复用“本地大模型反推”的模型缓存。首次使用会加载模型；纯编码器不会出现在此下拉框。"),
          ]) : null,
          h("div", { class: "dbs-settings-note" }, "模型仅负责根据前置角色/风格约束编排服装、动作、场景、构图和光照。自动执行还必须把节点左侧 enable_language_model 端口设为 true；任一开关关闭都不会加载模型。"),

          errorMsg.value ? h("div", { class: "dbs-error", style: { marginTop: "10px" } }, errorMsg.value) : null,

          h("div", { class: "dbs-modal-actions" }, [
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
    const galleryCollapsed = ref(false);
    const lastGachaCard = ref("");
    const gachaLoading = ref(false);
    const gachaStatus = ref("");
    const autoGacha = ref(false);
    const gachaContext = ref("");

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
          .filter(item => item.enabled !== false && item.source !== "gacha")
          .map(item => item.tag).join(", ");
        const response = await fetch("/danbooru_search/gacha", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            character_tags: [gachaContext.value, currentContext].filter(Boolean).join(", "),
            selections: selectedPosts.value,
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
        const kept = selectedOutputTags.value.filter(item => item.source !== "gacha");
        selectedOutputTags.value = mergeTagItems(kept, data.tags || [], { source: "gacha" });
        gachaStatus.value = data.warning ? ("已回退规则卡：" + data.warning) : (data.provider === "rules" ? "本地规则卡" : data.provider === "gallery" ? "已选画廊标签组合" : "模型智能编排");
        syncSelection();
      } catch (error) {
        gachaStatus.value = "抽卡失败：" + error.message;
      } finally {
        gachaLoading.value = false;
      }
    }

    function clearGacha() {
      selectedOutputTags.value = selectedOutputTags.value.filter(item => item.source !== "gacha");
      lastGachaCard.value = "";
      gachaStatus.value = "";
      syncSelection();
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
      };

      fetch("/danbooru_search/cache_selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});

      const widget = (props.node.widgets || []).find(w => w.name === "selection_data");
      if (widget) {
        widget.value = JSON.stringify({
          selections: selectedPosts.value,
          selected_tags: selectedOutputTags.value,
          gallery_collapsed: galleryCollapsed.value,
          auto_gacha: autoGacha.value,
          gacha_context: gachaContext.value,
        });
        if (typeof widget.callback === "function") widget.callback(widget.value, widget, props.node);
        if (props.node.graph) {
          props.node.graph.setDirtyCanvas(true, true);
        }
      }
    }

    function restoreSelection() {
      const nodeId = String(props.node.id);

      // 服务端缓存重启后会丢失，先从工作流隐藏 widget 恢复。
      try {
        const widget = (props.node.widgets || []).find(w => w.name === "selection_data");
        const saved = JSON.parse(widget?.value || "{}");
        if (Array.isArray(saved.selections)) selectedPosts.value = saved.selections;
        if (Array.isArray(saved.selected_tags)) selectedOutputTags.value = saved.selected_tags.map(item => normalizeTagItem(item)).filter(Boolean);
        galleryCollapsed.value = !!saved.gallery_collapsed;
        autoGacha.value = !!saved.auto_gacha;
        if (autoGacha.value) selectedOutputTags.value = selectedOutputTags.value.filter(item => item.source !== "gacha");
        gachaContext.value = saved.gacha_context || "";
      } catch (_) {
        // 旧工作流值损坏时忽略，仍继续尝试服务端缓存。
      }

      fetch("/danbooru_search/cache_selection?node_id=" + encodeURIComponent(nodeId))
        .then(r => r.json())
        .then(data => {
          if (data.success && data.found !== false) {
            if (Array.isArray(data.selections)) selectedPosts.value = data.selections;
            if (Array.isArray(data.selected_tags)) selectedOutputTags.value = data.selected_tags.map(item => normalizeTagItem(item)).filter(Boolean);
            galleryCollapsed.value = !!data.gallery_collapsed;
            if (typeof data.auto_gacha === "boolean") autoGacha.value = data.auto_gacha;
            if (autoGacha.value) selectedOutputTags.value = selectedOutputTags.value.filter(item => item.source !== "gacha");
            if (typeof data.gacha_context === "string") gachaContext.value = data.gacha_context;
          }
        })
        .catch(() => {});
    }

    onMounted(() => {
      setTimeout(restoreSelection, 500);
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
            onOpenSettings: () => { settingsOpen.value = true; },
            gachaName: lastGachaCard.value,
            gachaLoading: gachaLoading.value,
            autoGacha: autoGacha.value,
            onAutoGacha: value => {
              autoGacha.value = value;
              if (value) {
                selectedOutputTags.value = selectedOutputTags.value.filter(item => item.source !== "gacha");
                lastGachaCard.value = "";
                gachaStatus.value = "已启用：每次执行根据 character_tags 动态生成，界面不显示过期抽卡标签";
              }
              syncSelection();
            },
            onClearAll: () => { selectedOutputTags.value = []; lastGachaCard.value = ""; gachaStatus.value = ""; syncSelection(); },
          }),
        ]),

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
              placeholder: "可选：补充画风、题材、禁用内容等。执行工作流时会优先读取左侧 character_tags 端口。",
              onInput: e => { gachaContext.value = e.target.value; },
              onChange: syncSelection,
            }),
            h("div", { class: "dbs-settings-note" }, "抽卡只生成角色固定特征以外的服装、动作、场景、构图与光照；双击标签可暂时屏蔽输出。"),
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
              onClose: () => { settingsOpen.value = false; },
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
  height: 100%;
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
  overflow: visible;
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
.dbte-list { display: flex; flex-wrap: wrap; align-items:flex-start; gap: 5px; overflow-y: auto; }
.dbte.expanded .dbte-list { align-content: flex-start; max-height:145px; }
.dbte-empty { color: #666; padding: 6px; }
.dbte-chip { position:relative; display: inline-flex; align-items: center; gap: 4px; min-height:31px; border: 1px solid #466985; background: #203746; border-radius: 5px; padding: 3px 6px; cursor:grab; user-select:none; }
.dbte-chip:active { cursor:grabbing; }
.dbte-chip.dragging { opacity:.28; transform:scale(.96); }
.dbte-chip.drop-target { outline:2px solid #77aaff; outline-offset:2px; }
.dbte-drag-handle { color:#9aa1ae; font-size:13px; line-height:1; }
.dbte-drag-note { color:#7f8795; font-size:10px; margin-right:auto; }
.dbte-chip.kind-outfit { background:#3b3152; border-color:#775da2; }
.dbte-chip.kind-action { background:#264936; border-color:#4c8b69; }
.dbte-chip.kind-scene { background:#423b24; border-color:#8e7d3f; }
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
.dbs-gacha-status { color:#76c99a; padding:6px; border-radius:4px; background:#173124; overflow-wrap:anywhere; }
.dbs-gacha-status.error { color:#ff8c8c; background:#351b1b; }
.dbs-settings-separator { margin:15px 0 8px; padding-top:10px; border-top:1px solid #3b3b43; font-weight:700; color:#d7b4ed; }
.dbs-settings-note { margin-top:6px; color:#8b8b96; font-size:10px; line-height:1.45; }
.dbs-tag-data-row { display:flex; align-items:center; gap:8px; margin-top:8px; }
.dbs-tag-data-row .dbs-settings-note { margin:0; }
.dbs-data-path { margin-top:5px; color:#6f7683; font:9px/1.4 Consolas,monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dbs-inline-settings { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
.dbs-model-master-switch { display:flex !important; align-items:center; gap:8px; margin:0 0 10px !important; padding:9px; border:1px solid #52416a; border-radius:6px; background:#292235; }
.dbs-model-master-switch span { display:flex; flex-direction:column; gap:2px; }
.dbs-model-master-switch strong { color:#eee; }
.dbs-model-master-switch small { color:#9a91a5; }
@media (max-width: 900px) { .dbte-body.has-inspector { grid-template-columns:1fr; } }
@media (max-width: 760px) { .dbs-collapsed-tools { grid-template-columns:1fr; } .dbte-tip { display:none; } }

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
  width: min(1080px, 90vw) !important;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dbs-settings-modal { width:min(760px,92%); max-height:86%; overflow-y:auto; box-sizing:border-box; }

.dbs-detail-body { display:grid; grid-template-columns:minmax(280px, 42%) 1fr; gap:14px; flex:1; min-height:0; overflow:hidden; }

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
  align-items: center;
  background: #000;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 0;
  min-height: 180px;
  flex-shrink: 0;
}

.dbs-detail-tags {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 12px;
  min-height: 0;
}

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
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #333;
  flex-shrink: 0;
}

.dbs-detail-btn {
  flex: 1;
  padding: 8px 12px;
  background: #2a2a30;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  color: #ddd;
  font-size: 12px;
  cursor: pointer;
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

      if (this._dbsInit) return;
      this._dbsInit = true;

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

      if (!document.getElementById("dbs-style")) {
        const style = document.createElement("style");
        style.id = "dbs-style";
        style.textContent = CSS;
        document.head.appendChild(style);
      }

      const container = document.createElement("div");
      container.style.cssText = "width:100%;height:100%;overflow:hidden;position:relative;";

      const widget = this.addDOMWidget("danbooru_search_vue", "div", container, {
        serialize: false,
      });

      const vueApp = createApp(DanbooruSearchApp, { node: this });
      vueApp.mount(container);
      this._vueApp = vueApp;

      const applyHeight = (nodeHeight) => {
        const hgt = Math.max(400, nodeHeight - 80);
        container.style.height = hgt + "px";
        return hgt;
      };
      applyHeight(this.size[1]);

      const onResize = this.onResize;
      this.onResize = function (size) {
        onResize?.apply(this, arguments);
        applyHeight(size[1]);
      };
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._vueApp) {
        this._vueApp.unmount();
        this._vueApp = null;
      }
      onRemoved?.apply(this, arguments);
    };
  },
});
