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
    onTagsSelected: Function,
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

    function applyToGallery() {
      if (props.onTagsSelected && selected.value.length > 0) {
        const tags = selected.value.map(s => s.tag).join(" ");
        props.onTagsSelected(tags);
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

        h("div", { class: "dbs-selected" }, [
          h("div", { class: "dbs-selected-header" }, [
            h("span", {}, "已选标签 (" + selected.value.length + ")"),
            selected.value.length > 0
              ? h("button", { class: "dbs-btn small", onClick: applyToGallery }, "→ 搜索图库")
              : null,
            selected.value.length > 0
              ? h("button", { class: "dbs-btn small", onClick: clearSelected }, "清除")
              : null,
          ]),
          h("div", { class: "dbs-chips" }, selected.value.length === 0
            ? [h("div", { class: "dbs-empty-small" }, "点击左侧结果勾选")]
            : selected.value.map(s => {
                return h("div", { class: "dbs-chip" }, [
                  h("span", { title: s.tag }, s.cn_name ? (s.tag + " (" + s.cn_name + ")") : s.tag),
                  h("span", { class: "dbs-chip-del", onClick: () => removeSelected(s) }, "×"),
                ]);
              }),
          ),
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
  },
  setup(props) {
    // 保证编辑副本存在
    ensureEditStore(props.post);

    const store = computed(() => editedStore[String(props.post.id)]);

    const addCategory = ref("general");
    const addValue = ref("");

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

    function copyTags() {
      const parts = [];
      ["artist", "copyright", "character", "general"].forEach(k => {
        (store.value[k] || []).forEach(t => parts.push(t.replace(/_/g, " ")));
      });
      const text = parts.join(", ");
      navigator.clipboard.writeText(text).catch(() => {});
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

          h("div", { class: "dbs-detail-preview" }, [
            h("img", {
              src: proxiedImageUrl(post.large_file_url || post.file_url || post.preview_file_url),
              style: { maxWidth: "100%", maxHeight: "320px", objectFit: "contain" },
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
                  class: "dbs-tag-chip dbs-tag-category-" + cat.key,
                  key: tag,
                  title: cn ? (tag + " · " + cn) : tag,
                  onClick: e => showCtxMenu(e, tag, cat.key),
                }, cn ? (tag + " (" + cn + ")") : tag);
              })),
            ]);
          })),

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
            h("button", { class: "dbs-detail-btn primary", onClick: copyTags }, "📋 复制标签"),
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
    onSelectionChange: Function,
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

    onMounted(() => {
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
            })
          : null,
      ]);
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 子组件：已选预览条
// ════════════════════════════════════════════════════════════════════════════

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
        return h("div", { class: "dbsb-empty" }, "选中图片将显示在这里");
      }

      return h("div", { class: "dbsb-wrap" }, [
        h("div", { class: "dbsb-list" }, selections.map(sel => {
          return h("div", { class: "dbsb-item", key: sel.id }, [
            h("img", {
              class: "dbsb-thumb",
              src: proxiedImageUrl(sel.preview_file_url || sel.large_file_url),
            }),
            h("button", {
              class: "dbsb-remove",
              onClick: () => props.onRemove && props.onRemove(sel.id),
              title: "移除",
            }, "×"),
          ]);
        })),

        h("div", { class: "dbsb-info" }, [
          h("span", {}, "已选 " + selections.length + " 张"),
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
    const saving = ref(false);

    async function loadSettings() {
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
        }
      } catch (e) {
        // 忽略
      }
    }

    async function saveSettings() {
      saving.value = true;

      try {
        await fetch("/danbooru_search/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model_path: modelPath.value,
            danbooru_username: username.value,
            danbooru_api_key: apiKey.value,
            rating_filter: ratingFilter.value,
            hide_ai: hideAi.value,
            proxy_url: proxyUrl.value,
          }),
        });

        if (props.onClose) props.onClose();
      } catch (e) {
        // 忽略
      } finally {
        saving.value = false;
      }
    }

    watch(() => props.visible, (visible) => {
      if (visible) loadSettings();
    });

    return () => {
      if (!props.visible) return h("div");

      return h("div", { class: "dbs-modal-backdrop", onClick: props.onClose }, [
        h("div", {
          class: "dbs-modal",
          onClick: e => e.stopPropagation(),
        }, [
          h("h3", {}, "⚙ 设置"),

          h("label", {}, "BGE-M3 模型本地路径（可选）"),
          h("input", {
            class: "dbs-input-line",
            value: modelPath.value,
            placeholder: "留空则自动从 HuggingFace 下载",
            onInput: e => { modelPath.value = e.target.value; },
          }),

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
    const settingsOpen = ref(false);
    const outputMode = ref("rgb");

    function onTagsSelected(tags) {
      selectedGalleryTags.value = tags;
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

    function syncSelection() {
      const nodeId = String(props.node.id);

      const payload = {
        node_id: nodeId,
        selections: selectedPosts.value,
        output_mode: outputMode.value,
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
          output_mode: outputMode.value,
        });
        if (props.node.graph) {
          props.node.graph.setDirtyCanvas(true, true);
        }
      }
    }

    function restoreSelection() {
      const nodeId = String(props.node.id);

      fetch("/danbooru_search/cache_selection?node_id=" + encodeURIComponent(nodeId))
        .then(r => r.json())
        .then(data => {
          if (data.success && data.selections && data.selections.length > 0) {
            selectedPosts.value = data.selections;
            outputMode.value = data.output_mode || "rgb";
          }
        })
        .catch(() => {});
    }

    onMounted(() => {
      setTimeout(restoreSelection, 500);
    });

    return () => {
      return h("div", { class: "dbs-root" }, [
        h("div", { class: "dbs-toolbar-main" }, [
          h("span", { class: "dbs-title" }, "🦅 Danbooru 搜索 + 图库"),

          h("label", { class: "dbs-check" }, [
            h("input", {
              type: "checkbox",
              checked: outputMode.value === "rgba",
              onChange: e => {
                outputMode.value = e.target.checked ? "rgba" : "rgb";
                syncSelection();
              },
            }),
            " α 通道",
          ]),

          h("button", {
            class: "dbs-btn",
            onClick: () => { settingsOpen.value = true; },
            title: "设置",
          }, "⚙"),
        ]),

        h("div", { class: "dbs-preview-bar" }, [
          h(SelectionBar, {
            selections: selectedPosts.value,
            onRemove: removeSelection,
            onClear: clearSelection,
          }),
        ]),

        h("div", { class: "dbs-layout" }, [
          h("div", { class: "dbs-left" }, [
            h(TagSearchPanel, {
              onTagsSelected: onTagsSelected,
            }),
          ]),

          h("div", { class: "dbs-right" }, [
            h(GalleryPanel, {
              initialTags: selectedGalleryTags.value,
              onSelectionChange: onGallerySelectionChange,
            }),
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

.dbs-toolbar-main {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #25252a;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.dbs-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: #eee;
}

.dbs-preview-bar {
  padding: 8px 12px;
  background: #1e1e22;
  border-bottom: 1px solid #333;
  min-height: 60px;
  max-height: 80px;
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
  width: 600px !important;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

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
  margin-bottom: 12px;
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
