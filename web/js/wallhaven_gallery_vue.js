/**
 * Wallhaven Gallery Vue — Wallhaven 壁纸搜索节点（Vue 3 版本）
 *
 * 使用 Vue 3 Composition API + 共享组件库重写
 * CSS: 共享 gal- 主题 + 品牌色覆盖
 * API 路由: /wallhaven_gallery/*
 */
import { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, defineComponent, inject } from "../lib/vue.esm-browser.js";
import { app } from "../../../scripts/app.js";

import { PreviewBar } from "../vue/gallery-common/components/PreviewBar.js";
import { ImageGrid } from "../vue/gallery-common/components/ImageGrid.js";
import { SettingsDialog } from "../vue/gallery-common/components/SettingsDialog.js";
import { DropdownFilter } from "../vue/gallery-common/components/DropdownFilter.js";
import { useSelection } from "../vue/gallery-common/composables/useSelection.js";
import { useComfyNode } from "../vue/gallery-common/composables/useComfyNode.js";
import { useServerCache } from "../vue/gallery-common/composables/useServerCache.js";

// ── 注入共享样式 ──────────────────────────────────────────────────────────
if (!document.getElementById("gal-gallery-theme")) {
    const linkEl = document.createElement("link");
    linkEl.id = "gal-gallery-theme";
    linkEl.rel = "stylesheet";
    linkEl.href = "/extensions/ComfyUI_Eagle_Suite/vue/gallery-common/styles/gallery-theme.css";
    document.head.appendChild(linkEl);
}

// ── Wallhaven 特有样式 ──────────────────────────────────────────────────
const WALLHAVEN_CSS = `
.gal-root.whg-root { --gal-primary: #4a7de0; --gal-primary-hover: #5a8fe0; --gal-primary-active: #2a4a8a; }
`;
if (!document.getElementById("whg-extra-style")) {
    const s = document.createElement("style");
    s.id = "whg-extra-style";
    s.textContent = WALLHAVEN_CSS;
    document.head.appendChild(s);
}

const PAGE_SIZE = 24;

// ── Vue 主组件 ─────────────────────────────────────────────────────────────
const WallhavenGalleryVue = defineComponent({
    name: "WallhavenGalleryVue",
    components: { PreviewBar, ImageGrid, SettingsDialog, DropdownFilter },

    setup() {
        // ── Composables ──────────────────────────────────────────────
        const { selectedItems, selectedIds, isSelected, toggleSelect, removeFromSelection, clearSelection } = useSelection();
        const { comfyNode, confirmSelection: comfyConfirm, setWidgetValue } = useComfyNode();
        const { postSelection } = useServerCache("/eagle_gallery/cache_selection");

        // ── 响应式状态 ──────────────────────────────────────────────
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
        const showSettings = ref(false);
        const openDropdown = ref("");
        const advancedVisible = ref(false);

        // 高级筛选
        const color = ref("");
        const ratio = ref("");
        const atleast = ref("");
        const resolutions = ref("");
        const topRange = ref("1M");

        // ── 选项配置 ────────────────────────────────────────────────
        const categoryOptions = [
            { value: "general", label: "General" },
            { value: "anime", label: "Anime" },
            { value: "people", label: "People" },
        ];
        const purityOptions = [
            { value: "sfw", label: "SFW" },
            { value: "sketchy", label: "Sketchy" },
            { value: "nsfw", label: "NSFW" },
        ];
        const sortOptions = [
            { value: "date_added", label: "最新" },
            { value: "relevance", label: "相关" },
            { value: "random", label: "随机" },
            { value: "views", label: "热门" },
            { value: "favorites", label: "收藏" },
            { value: "toplist", label: "榜单" },
        ];
        const colorOptions = [
            { value: "", label: "全部" },
            { value: "660000", label: "浅红" }, { value: "990000", label: "红" },
            { value: "cc0000", label: "赪红" }, { value: "cc3333", label: "浅粉" },
            { value: "ea4c88", label: "粉紫" }, { value: "993399", label: "紫紫" },
            { value: "663399", label: "深紫" }, { value: "333399", label: "薯紫" },
            { value: "0066cc", label: "纽蓝" }, { value: "0099cc", label: "天蓝" },
            { value: "66cccc", label: "浅蓝" }, { value: "77cc33", label: "草绿" },
            { value: "669900", label: "橙绿" }, { value: "336600", label: "深绿" },
            { value: "999900", label: "橙黄" }, { value: "cccc33", label: "黄绿" },
            { value: "ffff00", label: "黄" }, { value: "ffcc33", label: "浅黄" },
            { value: "ff9900", label: "橙" }, { value: "ff6600", label: "深橙" },
            { value: "996633", label: "棕" }, { value: "000000", label: "黑" },
            { value: "999999", label: "灰" }, { value: "ffffff", label: "白" },
        ];
        const ratioOptions = [
            { value: "", label: "全部" }, { value: "16x9", label: "16:9" },
            { value: "16x10", label: "16:10" }, { value: "21x9", label: "21:9" },
            { value: "1x1", label: "1:1" }, { value: "9x16", label: "9:16" },
            { value: "4x3", label: "4:3" }, { value: "3x2", label: "3:2" },
        ];
        const atleastOptions = [
            { value: "", label: "无" }, { value: "1920x1080", label: "1080p" },
            { value: "2560x1440", label: "1440p" }, { value: "3840x2160", label: "4K" },
        ];
        const topRangeOptions = [
            { value: "1d", label: "1天" }, { value: "3d", label: "3天" },
            { value: "1w", label: "1周" }, { value: "1M", label: "1月" },
            { value: "3M", label: "3月" }, { value: "6M", label: "6月" },
            { value: "1y", label: "1年" },
        ];

        // ── 计算属性 ────────────────────────────────────────────────
        const totalPages = computed(() => Math.ceil(total.value / PAGE_SIZE) || 1);
        const pageText = computed(() => `第 ${page.value} / ${totalPages.value} 页 (共 ${total.value} 张)`);

        // ── 缩略图 URL 函数 ─────────────────────────────────────────
        function thumbGridUrlFn(item) {
            const thumb = (item.thumbs && (item.thumbs.small || item.thumbs.original)) || "";
            return thumb ? "/wallhaven_gallery/image_proxy?url=" + encodeURIComponent(thumb) : "";
        }
        function thumbPreviewUrlFn(item) {
            const url = item.thumb_url || item.image_url || "";
            return url ? "/wallhaven_gallery/image_proxy?url=" + encodeURIComponent(url) : "";
        }

        // ── 设置弹窗字段 ────────────────────────────────────────────
        const settingsFields = computed(() => [{
            key: "api_key",
            label: "Wallhaven API Key",
            placeholder: "可选，用于 NSFW 和高级搜索",
            hint: "在 <a href='https://wallhaven.cc/settings/account' target='_blank' rel='noopener'>wallhaven.cc/settings/account</a> 获取 API Key",
            value: localStorage.getItem("wallhaven_api_key") || "",
        }]);

        // ── API 调用 ──────────────────────────────────────────────
        async function search() {
            if (loading.value) return;
            loading.value = true;
            errorMsg.value = "";
            try {
                const params = new URLSearchParams({
                    q: query.value.trim(),
                    categories: ["general", "anime", "people"].map(k => categories.value.includes(k) ? "1" : "0").join(""),
                    purity: ["sfw", "sketchy", "nsfw"].map(k => purities.value.includes(k) ? "1" : "0").join(""),
                    sorting: sorting.value,
                    order: order.value,
                    page: page.value,
                });
                if (color.value) params.set("colors", color.value);
                if (ratio.value) params.set("ratios", ratio.value);
                if (atleast.value) params.set("atleast", atleast.value);
                if (resolutions.value) params.set("resolutions", resolutions.value);
                if (sorting.value === "toplist" && topRange.value) params.set("topRange", topRange.value);

                const apiKey = localStorage.getItem("wallhaven_api_key") || "";
                const res = await fetch("/wallhaven_gallery/search?" + params.toString(), {
                    headers: apiKey ? { "X-API-Key": apiKey } : {},
                });
                const data = await res.json();
                if (data.data) {
                    results.value = data.data;
                    total.value = (data.meta && data.meta.total) || 0;
                } else {
                    errorMsg.value = data.error || "未知错误";
                }
            } catch (e) {
                errorMsg.value = e.message;
            } finally {
                loading.value = false;
            }
        }

        // ── 选择处理 ──────────────────────────────────────────────
        function onGridSelect({ item, index }) {
            if (isSelected(item.id)) {
                removeFromSelection(selectedItems.value.find(s => s.id === item.id) || { id: item.id });
            } else {
                // Wallhaven 特有的选择数据
                selectedItems.value = [...selectedItems.value, {
                    id: item.id,
                    image_url: item.path,
                    thumb_url: (item.thumbs && (item.thumbs.small || item.thumbs.original)) || "",
                    tags: (item.tags || []).map(t => t.name).join(", "),
                    wallpaper_id: item.id,
                    resolution: item.resolution,
                }];
            }
            confirmSelection();
        }

        function onGridDblClick({ item, index }) {
            if (!isSelected(item.id)) onGridSelect({ item, index });
        }

        async function confirmSelection() {
            const node = comfyNode;
            if (!node) return;

            const selections = selectedItems.value.map(s => ({
                id: s.id,
                image_url: s.image_url,
                thumb_url: s.thumb_url,
                tags: s.tags,
                wallpaper_id: s.wallpaper_id,
                resolution: s.resolution,
            }));
            const selectionJson = JSON.stringify({ selections });

            const widget = node.widgets?.find(w => w.name === "selection_data");
            if (widget) widget.value = selectionJson;
            const input = node.inputs?.find(inp => inp.name === "selection_data");
            if (input) input.value = selectionJson;
            node._selection_data = selectionJson;

            await postSelection({ selections, outputMode: "selection" });
            node.setDirtyCanvas(true, true);
            if (node.graph) node.graph.change();
        }

        // ── 分页 ──────────────────────────────────────────────────
        function prevPage() {
            if (page.value > 1) { page.value--; search(); }
        }
        function nextPage() {
            page.value++; search();
        }

        // ── 搜索触发 ──────────────────────────────────────────────
        function onSearchKeydown(e) {
            if (e.key === "Enter") { page.value = 1; search(); }
        }
        function doSearch() { page.value = 1; search(); }
        function onFilterChange() { page.value = 1; search(); }

        // ── 下拉菜单控制 ────────────────────────────────────────────
        function toggleDropdown(name) {
            openDropdown.value = openDropdown.value === name ? "" : name;
        }

        // ── 全局点击关闭下拉菜单 ──────────────────────────────────────
        function onGlobalClick() {
            if (openDropdown.value) openDropdown.value = "";
        }

        // ── 设置保存 ──────────────────────────────────────────────
        async function onSaveSettings(data) {
            const key = data.api_key || "";
            if (key) localStorage.setItem("wallhaven_api_key", key);
            else localStorage.removeItem("wallhaven_api_key");
            try {
                await fetch("/wallhaven_gallery/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ api_key: key }),
                });
            } catch (e) { /* ignore */ }
            showSettings.value = false;
        }

        // ── 生命周期 ──────────────────────────────────────────────
        onMounted(() => {
            search();
            document.addEventListener("click", onGlobalClick);
        });
        onBeforeUnmount(() => {
            document.removeEventListener("click", onGlobalClick);
        });

        return {
            // 状态
            query, categories, purities, sorting, order, page,
            results, total, loading, errorMsg,
            showSettings, openDropdown, advancedVisible,
            color, ratio, atleast, resolutions, topRange,
            // 选择
            selectedItems, selectedIds, isSelected,
            removeFromSelection, clearSelection,
            // 选项
            categoryOptions, purityOptions, sortOptions, colorOptions,
            ratioOptions, atleastOptions, topRangeOptions,
            // 计算
            totalPages, pageText, settingsFields,
            // 方法
            thumbGridUrlFn, thumbPreviewUrlFn,
            search, doSearch, onSearchKeydown, onFilterChange,
            onGridSelect, onGridDblClick,
            prevPage, nextPage,
            toggleDropdown,
            onSaveSettings,
        };
    },

    template: `
    <div class="gal-root whg-root">
        <PreviewBar :selected-items="selectedItems"
                    :thumbnail-url-fn="thumbPreviewUrlFn"
                    @remove="removeFromSelection" @clear="clearSelection" />

        <div class="gal-toolbar">
            <div style="display:flex;gap:4px;align-items:center;width:100%;margin-bottom:3px">
                <input class="gal-search" type="text" placeholder="搜索关键词..."
                       v-model="query" @keydown="onSearchKeydown"
                       style="font-size:11px;padding:3px 8px" />
                <button class="gal-btn primary" style="padding:3px 8px" @click="doSearch">&#128269;</button>
                <span class="gal-badge" style="font-size:10px">{{ pageText }}</span>
            </div>
            <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;width:100%">
                <DropdownFilter label="分类" :options="categoryOptions" v-model="categories"
                                :is-open="openDropdown === 'cat'"
                                @update:is-open="toggleDropdown('cat')"
                                @change="onFilterChange" />
                <DropdownFilter label="纯度" :options="purityOptions" v-model="purities"
                                :is-open="openDropdown === 'purity'"
                                @update:is-open="toggleDropdown('purity')"
                                @change="onFilterChange" />

                <select class="gal-btn" style="min-width:80px;font-size:10px" v-model="sorting"
                        @change="onFilterChange" title="排序">
                    <option v-for="s in sortOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
                </select>

                <button class="gal-btn" :class="{ active: advancedVisible }"
                        style="font-size:10px" @click="advancedVisible = !advancedVisible"
                        title="高级筛选">&#9999; 筛选</button>
                <button class="gal-btn" style="font-size:10px;padding:3px 6px"
                        @click="showSettings = true" title="设置">&#9881;&#65039;</button>
            </div>

            <!-- 高级筛选行 -->
            <div v-if="advancedVisible" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;width:100%;padding-top:4px">
                <select class="gal-btn" style="min-width:80px;font-size:10px" v-model="color"
                        @change="onFilterChange" title="颜色">
                    <option v-for="c in colorOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
                </select>
                <select class="gal-btn" style="min-width:80px;font-size:10px" v-model="ratio"
                        @change="onFilterChange" title="比例">
                    <option v-for="r in ratioOptions" :key="r.value" :value="r.value">{{ r.label }}</option>
                </select>
                <select class="gal-btn" style="min-width:100px;font-size:10px" v-model="atleast"
                        @change="onFilterChange" title="最低分辨率">
                    <option v-for="a in atleastOptions" :key="a.value" :value="a.value">{{ a.label }}</option>
                </select>
                <select v-if="sorting === 'toplist'" class="gal-btn" style="min-width:80px;font-size:10px"
                        v-model="topRange" @change="onFilterChange" title="时间范围">
                    <option v-for="t in topRangeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
                </select>
            </div>
        </div>

        <ImageGrid :items="results" :selected-ids="selectedIds"
                   :loading="loading" :error-msg="errorMsg"
                   :thumbnail-url-fn="thumbGridUrlFn"
                   :show-index="false"
                   empty-text="输入关键词点击搜索"
                   @select="onGridSelect" @dblclick="onGridDblClick">
            <template #thumb-overlay="{ item }">
                <span v-if="item.purity" class="gal-thumb-badge"
                      :class="'gal-badge-' + item.purity">{{ item.purity.toUpperCase() }}</span>
                <div class="gal-thumb-info">
                    <span>{{ item.resolution || '' }}</span>
                    <span>&#9829; {{ item.favorites || 0 }}</span>
                </div>
            </template>
        </ImageGrid>

        <div class="gal-footer">
            <button class="gal-btn" :disabled="page <= 1" @click="prevPage">&#9664; 上一页</button>
            <span class="gal-pageinfo">{{ pageText }}</span>
            <button class="gal-btn" :disabled="page >= totalPages" @click="nextPage">下一页 &#9654;</button>
        </div>

        <SettingsDialog :visible="showSettings" @update:visible="showSettings = $event"
                        title="设置" :fields="settingsFields" @save="onSaveSettings" />
    </div>
    `,
});

// ── ComfyUI 扩展注册 ─────────────────────────────────────────────────────────
app.registerExtension({
    name: "EagleSuite.WallhavenGallery",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WallhavenGalleryNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.setSize([900, 720]);

            // 隐藏 selection_data 文本 widget
            const hide = (n) => {
                const w = n.widgets?.find(x => x.name === "selection_data");
                if (!w) return false;
                w.type = "hidden";
                w.computeSize = () => [0, -4];
                w.hidden = true;
                w.draw = () => {};
                n.setDirtyCanvas(true, true);
                return true;
            };
            setTimeout(() => {
                if (!hide(this)) setTimeout(() => hide(this), 500);
            }, 300);

            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.height = "640px";
            container.style.maxHeight = "640px";
            container.style.minHeight = "400px";
            container.style.position = "relative";
            container.style.overflow = "hidden";

            const widget = this.addDOMWidget("wallhaven_gallery", "div", container, { serialize: false });
            widget.computeSize = function (width) { return [width, 640]; };

            const vueApp = createApp(WallhavenGalleryVue);
            vueApp.provide("comfyNode", this);
            const vm = vueApp.mount(container);

            this._vueApp = vueApp;
            this._vm = vm;

            const onResize = this.onResize;
            this.onResize = function (size) {
                onResize?.apply(this, arguments);
                const newH = Math.min(Math.max(400, size[1] - 80), 640);
                if (container) container.style.height = newH + "px";
                if (widget) widget.computeSize = (w) => [w, newH];
                const rootEl = container.querySelector(".gal-root");
                if (rootEl) rootEl.style.height = newH + "px";
            };
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this._vueApp) {
                this._vueApp.unmount();
                this._vueApp = null;
                this._vm = null;
            }
            onRemoved?.apply(this, arguments);
        };
    },
});
