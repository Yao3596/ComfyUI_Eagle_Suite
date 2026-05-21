/**
 * Wallhaven Gallery Vue — Vue 3 ESM rewrite
 * Brand color: --gal-primary: #4a7de0 (Wallhaven blue)
 */
import { app } from "../../scripts/app.js";
import { createApp, ref, computed, h, onMounted } from "../lib/vue.esm-browser.js";

import { useSelection } from "../vue/gallery-common/composables/useSelection.js";
import { useComfyNode } from "../vue/gallery-common/composables/useComfyNode.js";
import { PreviewBar } from "../vue/gallery-common/components/PreviewBar.js";
import { ImageGrid } from "../vue/gallery-common/components/ImageGrid.js";
import { SettingsDialog } from "../vue/gallery-common/components/SettingsDialog.js";
import { DropdownFilter } from "../vue/gallery-common/components/DropdownFilter.js";

const PAGE_SIZE = 24;

/* ── 常量 ─────────────────────────────────────────────────── */

const COLOR_OPTIONS = [
  { value: "", label: "全部" },
  { value: "660000", label: "浅红" }, { value: "990000", label: "红" },
  { value: "cc0000", label: "绯红" }, { value: "cc3333", label: "浅粉" },
  { value: "ea4c88", label: "粉紫" }, { value: "993399", label: "紫紫" },
  { value: "663399", label: "深紫" }, { value: "333399", label: "薯紫" },
  { value: "0066cc", label: "纽蓝" }, { value: "0099cc", label: "天蓝" },
  { value: "66cccc", label: "浅蓝" }, { value: "77cc33", label: "草绿" },
  { value: "669900", label: "橙绿" }, { value: "336600", label: "深绿" },
  { value: "666600", label: "橄榄" }, { value: "999900", label: "橙黄" },
  { value: "cccc33", label: "黄绿" }, { value: "ffff00", label: "黄" },
  { value: "ffcc33", label: "浅黄" }, { value: "ff9900", label: "橙" },
  { value: "ff6600", label: "深橙" }, { value: "cc6633", label: "棕橙" },
  { value: "996633", label: "棕" }, { value: "663300", label: "深棕" },
  { value: "000000", label: "黑" }, { value: "999999", label: "灰" },
  { value: "cccccc", label: "铁灰" }, { value: "ffffff", label: "白" },
  { value: "424153", label: "蓝灰" },
];

const RATIO_OPTIONS = [
  { value: "", label: "全部" }, { value: "16x9", label: "16:9" },
  { value: "16x10", label: "16:10" }, { value: "21x9", label: "21:9" },
  { value: "1x1", label: "1:1" }, { value: "9x16", label: "9:16" },
  { value: "4x3", label: "4:3" }, { value: "3x2", label: "3:2" },
];

const ATLEAST_OPTIONS = [
  { value: "", label: "无" }, { value: "1920x1080", label: "1080p" },
  { value: "2560x1440", label: "1440p" }, { value: "3840x2160", label: "4K" },
  { value: "5120x2880", label: "5K" }, { value: "7680x4320", label: "8K" },
];

const RESOLUTION_OPTIONS = [
  { value: "", label: "无" }, { value: "1920x1080", label: "1920x1080" },
  { value: "1920x1200", label: "1920x1200" }, { value: "2560x1440", label: "2560x1440" },
  { value: "2560x1600", label: "2560x1600" }, { value: "3840x2160", label: "3840x2160" },
  { value: "3840x2400", label: "3840x2400" },
];

const TOP_RANGE_OPTIONS = [
  { value: "1d", label: "1天" }, { value: "3d", label: "3天" },
  { value: "1w", label: "1周" }, { value: "1M", label: "1月" },
  { value: "3M", label: "3月" }, { value: "6M", label: "6月" },
  { value: "1y", label: "1年" },
];

const SORT_OPTIONS = [
  { value: "date_added", label: "最新" }, { value: "relevance", label: "相关" },
  { value: "random", label: "随机" }, { value: "views", label: "热门" },
  { value: "favorites", label: "收藏" }, { value: "toplist", label: "榜单" },
];

const CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "anime", label: "Anime" },
  { value: "people", label: "People" },
];

const PURITY_OPTIONS = [
  { value: "sfw", label: "SFW" },
  { value: "sketchy", label: "Sketchy" },
  { value: "nsfw", label: "NSFW" },
];

const ALL_CATEGORIES = ["general", "anime", "people"];
const ALL_PURITIES = ["sfw", "sketchy", "nsfw"];

/* ── 缩略图代理 URL ─────────────────────────────────────── */

function thumbProxyUrl(item) {
  const url = item.image_url || item.thumb_url || "";
  return url ? `/wallhaven_gallery/image_proxy?url=${encodeURIComponent(url)}` : "";
}

function gridThumbUrl(item) {
  const url = (item.thumbs && item.thumbs.small) || (item.thumbs && item.thumbs.original) || "";
  return url ? `/wallhaven_gallery/image_proxy?url=${encodeURIComponent(url)}` : "";
}

/* ── WallhavenGallery 根组件 ───────────────────────────────── */

const WallhavenGallery = {
  name: "WallhavenGallery",
  setup() {
    const { selectedItems, selectedIds, toggleSelect, removeFromSelection, clearSelection } = useSelection();
    const { comfyNode, confirmSelection, hideSelectionWidget } = useComfyNode();

    // 搜索与筛选
    const query = ref("");
    const categories = ref(["general", "anime", "people"]);
    const purities = ref(["sfw"]);
    const sorting = ref("date_added");
    const order = ref("desc");
    const page = ref(1);
    const results = ref([]);
    const total = ref(0);
    const loading = ref(false);
    const errorMsg = ref("");

    // 高级筛选
    const color = ref("");
    const ratio = ref("");
    const atleast = ref("");
    const resolutions = ref("");
    const topRange = ref("1M");
    const advancedVisible = ref(false);

    // 下拉菜单开关
    const catOpen = ref(false);
    const purityOpen = ref(false);

    // 设置
    const settingsVisible = ref(false);

    // 分页
    const totalPages = computed(() => Math.ceil(total.value / PAGE_SIZE) || 1);

    function encodeFlagList(all, active) {
      return all.map(k => active.value.includes(k) ? "1" : "0").join("");
    }

    async function doSearch() {
      if (loading.value) return;
      loading.value = true;
      errorMsg.value = "";

      try {
        const params = new URLSearchParams({
          q: query.value.trim(),
          categories: encodeFlagList(ALL_CATEGORIES, categories),
          purity: encodeFlagList(ALL_PURITIES, purities),
          sorting: sorting.value,
          order: order.value,
          page: String(page.value),
        });

        if (color.value) params.set("colors", color.value);
        if (ratio.value) params.set("ratios", ratio.value);
        if (atleast.value) params.set("atleast", atleast.value);
        if (resolutions.value) params.set("resolutions", resolutions.value);
        if (sorting.value === "toplist" && topRange.value) params.set("topRange", topRange.value);

        const apiKey = localStorage.getItem("wallhaven_api_key");
        const headers = {};
        if (apiKey) headers["X-API-Key"] = apiKey;

        const res = await fetch(`/wallhaven_gallery/search?${params.toString()}`, { headers });
        const data = await res.json();

        if (data.data) {
          results.value = data.data;
          total.value = data.meta ? (data.meta.total || 0) : 0;
        } else {
          errorMsg.value = "搜索失败: " + (data.error || "未知错误");
          results.value = [];
          total.value = 0;
        }
      } catch (e) {
        errorMsg.value = "请求失败: " + e.message;
        results.value = [];
        total.value = 0;
      } finally {
        loading.value = false;
      }
    }

    function triggerSearch() {
      page.value = 1;
      doSearch();
    }

    function onCategoryChange(val) {
      categories.value = val;
      triggerSearch();
    }

    function onPurityChange(val) {
      purities.value = val;
      triggerSearch();
    }

    function onSortChange() {
      if (sorting.value === "toplist" && !topRange.value) {
        topRange.value = "1M";
      }
      triggerSearch();
    }

    // 选中处理 — 标准化选中对象
    function handleSelect(item) {
      const standardized = {
        id: item.id,
        image_url: item.path,
        thumb_url: (item.thumbs && item.thumbs.small) || "",
        tags: (item.tags || []).map(t => t.name).join(", "),
        wallpaper_id: item.id,
        resolution: item.resolution,
        purity: item.purity,
      };
      toggleSelect(standardized);
      confirmSelection(selectedItems.value);
    }

    function handleRemove(id) {
      removeFromSelection(id);
      confirmSelection(selectedItems.value);
    }

    function handleClear() {
      clearSelection();
      confirmSelection(selectedItems.value);
    }

    function onSettingsSave(formData) {
      const key = (formData.wallhaven_api_key || "").trim();
      if (key) {
        localStorage.setItem("wallhaven_api_key", key);
      } else {
        localStorage.removeItem("wallhaven_api_key");
      }
    }

    function prevPage() {
      if (page.value > 1) { page.value--; doSearch(); }
    }

    function nextPage() {
      if (page.value < totalPages.value) { page.value++; doSearch(); }
    }

    onMounted(() => {
      hideSelectionWidget();
      doSearch();
    });

    return {
      // state
      query, categories, purities, sorting, order, page, results, total, loading, errorMsg,
      color, ratio, atleast, resolutions, topRange, advancedVisible,
      catOpen, purityOpen, settingsVisible, totalPages,
      // selection
      selectedItems, selectedIds,
      // methods
      doSearch, triggerSearch, onCategoryChange, onPurityChange, onSortChange,
      handleSelect, handleRemove, handleClear, onSettingsSave,
      prevPage, nextPage, thumbProxyUrl, gridThumbUrl,
    };
  },

  render() {
    const {
      query, categories, purities, sorting, page, results, total, loading, errorMsg,
      color, ratio, atleast, resolutions, topRange, advancedVisible,
      catOpen, purityOpen, settingsVisible, totalPages,
      selectedItems, selectedIds,
      triggerSearch, onCategoryChange, onPurityChange, onSortChange,
      handleSelect, handleRemove, handleClear, onSettingsSave,
      prevPage, nextPage, thumbProxyUrl, gridThumbUrl,
    } = this;

    const colorSwatchStyle = color
      ? { backgroundColor: `#${color}` }
      : { backgroundColor: "transparent" };

    return h("div", { class: "gal-container" }, [
      // ── 预览条 ──
      h(PreviewBar, {
        selectedItems: selectedItems.value,
        thumbnailUrlFn: thumbProxyUrl,
        onRemove: handleRemove,
        onClear: handleClear,
      }),

      // ── 工具栏 ──
      h("div", { class: "gal-toolbar" }, [
        h("input", {
          class: "gal-search", type: "text", placeholder: "搜索关键词...",
          value: query.value,
          onInput: (e) => { query.value = e.target.value; },
          onKeydown: (e) => { if (e.key === "Enter") triggerSearch(); },
        }),
        h("button", { class: "gal-btn primary", onClick: triggerSearch }, "\u{1F50D} 搜索"),

        // 分类下拉
        h(DropdownFilter, {
          label: "分类", options: CATEGORY_OPTIONS,
          modelValue: categories.value, multiple: true, isOpen: catOpen.value,
          "onUpdate:modelValue": onCategoryChange,
          "onUpdate:isOpen": (v) => { catOpen.value = v; },
        }),

        // 纯度下拉
        h(DropdownFilter, {
          label: "纯度", options: PURITY_OPTIONS,
          modelValue: purities.value, multiple: true, isOpen: purityOpen.value,
          "onUpdate:modelValue": onPurityChange,
          "onUpdate:isOpen": (v) => { purityOpen.value = v; },
        }),

        // 排序
        h("span", { style: "font-size:11px;color:var(--gal-text-dim);margin-right:4px" }, "排序:"),
        h("select", {
          class: "gal-btn", style: "min-width:80px",
          value: sorting.value,
          onChange: (e) => { sorting.value = e.target.value; onSortChange(); },
        }, SORT_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

        // 高级筛选
        h("button", {
          class: ["gal-btn", advancedVisible.value ? "active" : ""],
          onClick: () => { advancedVisible.value = !advancedVisible.value; },
        }, "\u270F\uFE0F 筛选"),

        // 设置
        h("button", {
          class: "gal-btn",
          onClick: (e) => { e.stopPropagation(); settingsVisible.value = true; },
        }, "\u2699\uFE0F"),
      ]),

      // ── 高级筛选行 ──
      advancedVisible.value
        ? h("div", { class: "gal-toolbar" }, [
            h("span", { style: "font-size:11px;color:var(--gal-text-dim);margin-right:4px" }, "颜色:"),
            h("span", { class: "gal-color-swatch", style: colorSwatchStyle }),
            h("select", {
              class: "gal-btn", style: "min-width:80px", value: color.value,
              onChange: (e) => { color.value = e.target.value; triggerSearch(); },
            }, COLOR_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

            h("span", { style: "font-size:11px;color:var(--gal-text-dim);margin-right:4px" }, "比例:"),
            h("select", {
              class: "gal-btn", style: "min-width:80px", value: ratio.value,
              onChange: (e) => { ratio.value = e.target.value; triggerSearch(); },
            }, RATIO_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

            h("span", { style: "font-size:11px;color:var(--gal-text-dim);margin-right:4px" }, "最低:"),
            h("select", {
              class: "gal-btn", style: "min-width:100px", value: atleast.value,
              onChange: (e) => { atleast.value = e.target.value; triggerSearch(); },
            }, ATLEAST_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

            h("span", { style: "font-size:11px;color:var(--gal-text-dim);margin-right:4px" }, "分辨率:"),
            h("select", {
              class: "gal-btn", style: "min-width:100px", value: resolutions.value,
              onChange: (e) => { resolutions.value = e.target.value; triggerSearch(); },
            }, RESOLUTION_OPTIONS.map(o => h("option", { value: o.value }, o.label))),

            h("span", { style: "font-size:11px;color:var(--gal-text-dim);margin-right:4px" }, "榜单:"),
            h("select", {
              class: "gal-btn", style: "min-width:80px", value: topRange.value,
              onChange: (e) => { topRange.value = e.target.value; triggerSearch(); },
            }, TOP_RANGE_OPTIONS.map(o => h("option", { value: o.value }, o.label))),
          ])
        : null,

      // ── 图片网格 ──
      h(ImageGrid, {
        items: results.value,
        selectedIds: selectedIds.value,
        loading: loading.value,
        errorMsg: errorMsg.value,
        emptyText: results.value.length === 0 && !loading.value && !errorMsg.value ? "输入关键词点击搜索" : "暂无结果",
        thumbnailUrlFn: gridThumbUrl,
        onSelect: handleSelect,
      }, {
        "thumb-overlay": ({ item }) =>
          h("span", {
            class: `gal-thumb-purity gal-p-${item.purity || "sfw"}`,
          }, (item.purity || "sfw").toUpperCase()),
      }),

      // ── 页脚 ──
      h("div", { class: "gal-footer" }, [
        h("button", {
          class: "gal-btn", disabled: page.value <= 1, onClick: prevPage,
        }, "\u25C0 上一页"),
        h("span", { class: "gal-pageinfo" },
          `第 ${page.value} / ${totalPages.value} 页 (共 ${total.value} 张)`),
        h("button", {
          class: "gal-btn", disabled: page.value >= totalPages.value, onClick: nextPage,
        }, "下一页 \u25B6"),
      ]),

      // ── 设置弹窗 ──
      h(SettingsDialog, {
        visible: settingsVisible.value,
        title: "设置",
        fields: [{
          key: "wallhaven_api_key",
          label: "Wallhaven API Key",
          type: "password",
          placeholder: "可选，用于 NSFW 和高级搜索",
          value: localStorage.getItem("wallhaven_api_key") || "",
        }],
        "onUpdate:visible": (v) => { settingsVisible.value = v; },
        onSave: onSettingsSave,
      }),
    ]);
  },
};

/* ── CSS 注入 ──────────────────────────────────────────────── */

function injectCSS() {
  if (!document.getElementById("gal-theme-css")) {
    const link = document.createElement("link");
    link.id = "gal-theme-css";
    link.rel = "stylesheet";
    link.href = "/extensions/ComfyUI_Eagle_Suite/vue/gallery-common/styles/gallery-theme.css";
    document.head.appendChild(link);
  }
}

/* ── ComfyUI 注册 ─────────────────────────────────────────── */

app.registerExtension({
  name: "EagleSuite.WallhavenGalleryVue",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "WallhavenGalleryNode") return;

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origOnNodeCreated?.apply(this, arguments);
      this.setSize([900, 720]);

      injectCSS();

      // 创建挂载点
      const mountEl = document.createElement("div");
      mountEl.style.cssText = "width:100%;height:100%;--gal-primary:#4a7de0";

      const vueApp = createApp(WallhavenGallery);
      vueApp.provide("comfyNode", this);
      vueApp.mount(mountEl);

      this.addDOMWidget("wallhaven_gallery", "div", mountEl, { serialize: false });

      // 节点删除时清理
      const origOnRemoved = this.onRemoved;
      this.onRemoved = function () {
        vueApp.unmount();
        origOnRemoved?.apply(this, arguments);
      };
    };
  },
});
