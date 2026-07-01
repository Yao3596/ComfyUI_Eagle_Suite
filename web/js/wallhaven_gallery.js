/**
 * Wallhaven Gallery - Wallhaven 壁纸浏览器节点（Vue 3 重构版）
 * 单文件、自包含，仅依赖 ../lib/vue.esm-browser.js（官方 Vue 3 生产构建）
 *
 * 后端接口（wallhaven_gallery.py）：
 *   GET  /wallhaven_gallery/settings                GET/POST 读写 api_key
 *   GET  /wallhaven_gallery/search?q=&categories=&purity=&sorting=&order=&page=
 *                                    &colors=&ratios=&atleast=&resolutions=&topRange=
 *   GET  /wallhaven_gallery/image_proxy?url=         图片代理
 *
 * selection_data 直接写入节点原生 widget（WallhavenGalleryNode.get_selected_data
 * 直接从 widget kwarg 读取，不走服务端全局缓存，与 Eagle/Pinterest 不同）。
 */
import { app } from "../../../scripts/app.js";
import { createApp, reactive, ref, onMounted } from "../lib/vue.esm-browser.js";

const PAGE_SIZE = 24;

const CSS = `
.whg-root{display:flex;flex-direction:column;width:100%;height:100%;background:#1a1a1e;font-size:12px;color:#ddd;box-sizing:border-box;font-family:sans-serif;overflow:hidden}
.whg-preview{display:flex;gap:6px;padding:8px 10px;background:#1e1e22;border-bottom:1px solid #333;min-height:70px;max-height:90px;overflow-x:auto;overflow-y:hidden;flex-shrink:0}
.whg-preview::-webkit-scrollbar{height:4px}
.whg-preview::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.whg-preview-thumb{flex-shrink:0;width:80px;height:60px;border-radius:4px;overflow:hidden;border:1px solid #444;position:relative;background:#25252a}
.whg-preview-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.whg-preview-empty{color:#666;font-size:11px;display:flex;align-items:center;justify-content:center;width:100%}
.whg-header{padding:6px 10px;background:#25252a;border-bottom:1px solid #333;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.whg-search{flex:1;min-width:100px;padding:4px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;outline:none}
.whg-search:focus{border-color:#5a8fe0}
.whg-btn{padding:4px 10px;background:#333;border:1px solid #444;border-radius:4px;color:#ddd;font-size:11px;cursor:pointer;white-space:nowrap}
.whg-btn:hover{background:#3a3a40}
.whg-btn.primary{background:#4a7de0;border-color:#4a7de0;color:#fff}
.whg-btn.primary:hover{background:#5a8fe0}
.whg-btn.active{background:#2a4a8a;border-color:#4a7de0}
select.whg-btn{-webkit-appearance:none;-moz-appearance:none;appearance:none;background:#333 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath fill='%23aaa' d='M0 0h8L4 4z'/%3E%3C/svg%3E") no-repeat right 8px center;padding-right:22px}
.whg-dropdown{position:relative;display:inline-block}
.whg-dropdown-menu{display:none;position:absolute;top:100%;left:0;z-index:1000;background:#2a2a30;border:1px solid #444;border-radius:4px;padding:5px 0;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,.5)}
.whg-dropdown-menu.show{display:block}
.whg-dropdown-item{padding:5px 12px;cursor:pointer;font-size:11px;color:#ccc;white-space:nowrap}
.whg-dropdown-item:hover{background:#3a3a45}
.whg-dropdown-item label{display:flex;align-items:center;gap:5px;cursor:pointer}
.whg-dropdown-item input{margin:0}
.whg-grid{flex:1;overflow-y:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-auto-rows:100px;gap:8px;align-content:start}
.whg-grid::-webkit-scrollbar{width:6px}
.whg-grid::-webkit-scrollbar-track{background:transparent}
.whg-grid::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
.whg-thumb{position:relative;background:#222;border-radius:4px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color .15s,transform .1s;height:100px}
.whg-thumb:hover{border-color:#5a8fe0;transform:translateY(-1px)}
.whg-thumb.selected{border-color:#4a7de0;box-shadow:0 0 0 1px #4a7de0}
.whg-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.whg-thumb-info{position:absolute;bottom:0;left:0;right:0;padding:3px 6px;background:linear-gradient(transparent,rgba(0,0,0,.85));font-size:10px;color:#aaa;display:flex;justify-content:space-between}
.whg-thumb-purity{position:absolute;top:3px;right:3px;padding:1px 4px;border-radius:2px;font-size:9px;font-weight:600}
.p-sfw{background:#1a5e1a;color:#7f7}
.p-sketchy{background:#5e4a10;color:#fc0}
.p-nsfw{background:#5e1a1a;color:#f88}
.whg-footer{padding:5px 10px;background:#25252a;border-top:1px solid #333;display:flex;align-items:center;gap:8px;flex-shrink:0}
.whg-pageinfo{flex:1;text-align:center;color:#888;font-size:11px}
.whg-empty{text-align:center;padding:40px;color:#666;font-size:13px}
.whg-loading{text-align:center;padding:40px;color:#888}
.whg-error{text-align:center;padding:40px;color:#e66}
.whg-settings-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center}
.whg-settings-panel{background:#25252a;border:1px solid #444;border-radius:8px;padding:20px;width:360px;box-shadow:0 8px 24px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:12px}
.whg-settings-panel h3{margin:0 0 4px;color:#eee;font-size:14px}
.whg-settings-panel label{display:block;margin-bottom:4px;color:#aaa;font-size:12px}
.whg-settings-panel input{width:100%;padding:6px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;box-sizing:border-box}
.whg-settings-panel input:focus{border-color:#5a8fe0;outline:none}
.whg-settings-hint{color:#888;font-size:11px;margin-top:4px;line-height:1.4}
.whg-settings-hint a{color:#6a9de0;text-decoration:none}
.whg-settings-hint a:hover{text-decoration:underline}
.whg-settings-footer{margin-top:8px;padding-top:12px;border-top:1px solid #333;display:flex;align-items:center;justify-content:space-between;gap:8px}
.whg-settings-github{display:inline-flex;align-items:center;gap:6px;color:#aaa;font-size:12px;text-decoration:none;padding:5px 10px;background:#1e1e22;border:1px solid #333;border-radius:4px;transition:.15s}
.whg-settings-github:hover{color:#eee;border-color:#555}
.whg-settings-author{color:#666;font-size:11px}
.whg-settings-row{display:flex;gap:8px;justify-content:flex-end}
.whg-color-swatch{width:14px;height:14px;border-radius:3px;border:1px solid #555;display:inline-block;flex-shrink:0;background:transparent}
.whg-preview-del{position:absolute;top:2px;right:2px;width:16px;height:16px;background:rgba(0,0,0,.7);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s;z-index:2}
.whg-preview-thumb:hover .whg-preview-del{opacity:1}
.whg-preview-del:hover{background:rgba(200,0,0,.8)}
.whg-advanced{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding-top:4px;width:100%}
`;

const CATEGORY_OPTIONS = [{ label: "General", value: "general" }, { label: "Anime", value: "anime" }, { label: "People", value: "people" }];
const PURITY_OPTIONS = [{ label: "SFW", value: "sfw" }, { label: "Sketchy", value: "sketchy" }, { label: "NSFW", value: "nsfw" }];
const SORT_OPTIONS = [
    { key: "date_added", label: "最新" }, { key: "relevance", label: "相关" },
    { key: "random", label: "随机" }, { key: "views", label: "热门" },
    { key: "favorites", label: "收藏" }, { key: "toplist", label: "榜单" },
];
const COLOR_OPTIONS = [
    { value: "", label: "全部" }, { value: "660000", label: "浅红" }, { value: "990000", label: "红" },
    { value: "cc0000", label: "赤红" }, { value: "cc3333", label: "浅粉" }, { value: "ea4c88", label: "粉紫" },
    { value: "993399", label: "紫紫" }, { value: "663399", label: "深紫" }, { value: "333399", label: "藏紫" },
    { value: "0066cc", label: "纽蓝" }, { value: "0099cc", label: "天蓝" }, { value: "66cccc", label: "浅蓝" },
    { value: "77cc33", label: "草绿" }, { value: "669900", label: "橄绿" }, { value: "336600", label: "深绿" },
    { value: "666600", label: "橄黄" }, { value: "999900", label: "橄黄2" }, { value: "cccc33", label: "黄绿" },
    { value: "ffff00", label: "黄" }, { value: "ffcc33", label: "浅黄" }, { value: "ff9900", label: "橙" },
    { value: "ff6600", label: "深橙" }, { value: "cc6633", label: "棕橙" }, { value: "996633", label: "棕" },
    { value: "663300", label: "深棕" }, { value: "000000", label: "黑" }, { value: "999999", label: "灰" },
    { value: "cccccc", label: "铁灰" }, { value: "ffffff", label: "白" }, { value: "424153", label: "蓝灰" },
];
const RATIO_OPTIONS = [
    { value: "", label: "全部" }, { value: "16x9", label: "16:9" }, { value: "16x10", label: "16:10" },
    { value: "21x9", label: "21:9" }, { value: "1x1", label: "1:1" }, { value: "9x16", label: "9:16" },
    { value: "4x3", label: "4:3" }, { value: "3x2", label: "3:2" },
];
const ATLEAST_OPTIONS = [
    { value: "", label: "无" }, { value: "1920x1080", label: "1080p" }, { value: "2560x1440", label: "1440p" },
    { value: "3840x2160", label: "4K" }, { value: "5120x2880", label: "5K" }, { value: "7680x4320", label: "8K" },
];
const RES_OPTIONS = [
    { value: "", label: "无" }, { value: "1920x1080", label: "1920x1080" }, { value: "1920x1200", label: "1920x1200" },
    { value: "2560x1440", label: "2560x1440" }, { value: "2560x1600", label: "2560x1600" },
    { value: "3840x2160", label: "3840x2160" }, { value: "3840x2400", label: "3840x2400" },
];
const TOPRANGE_OPTIONS = [
    { value: "1d", label: "1天" }, { value: "3d", label: "3天" }, { value: "1w", label: "1周" },
    { value: "1M", label: "1月" }, { value: "3M", label: "3月" }, { value: "6M", label: "6月" }, { value: "1y", label: "1年" },
];

const WallhavenGalleryApp = {
    props: { node: { type: Object, required: true } },
    setup(props) {
        const node = props.node;

        const query = ref("");
        const categories = reactive(new Set(["general", "anime", "people"]));
        const purities = reactive(new Set(["sfw"]));
        const sorting = ref("date_added");
        const order = ref("desc");
        const page = ref(1);
        const total = ref(0);
        const results = ref([]);
        const loading = ref(false);
        const errorMsg = ref("");

        const color = ref("");
        const ratio = ref("");
        const atleast = ref("");
        const resolutions = ref("");
        const topRange = ref("1M");
        const advancedVisible = ref(false);

        const openDropdown = ref("");
        const selected = reactive(new Set());
        const selectedItems = ref([]);

        const isSettingsOpen = ref(false);
        const apiKey = ref(localStorage.getItem("wallhaven_api_key") || "");
        const savedKeyHint = ref("");

        function proxied(url) {
            return url ? "/wallhaven_gallery/image_proxy?url=" + encodeURIComponent(url) : "";
        }

        function toggleDropdown(name) {
            openDropdown.value = openDropdown.value === name ? "" : name;
        }
        function toggleSet(set, value) {
            if (set.has(value)) set.delete(value); else set.add(value);
        }

        async function search() {
            if (loading.value) return;
            loading.value = true;
            errorMsg.value = "";
            try {
                const params = new URLSearchParams({
                    q: query.value.trim(),
                    categories: ["general", "anime", "people"].map(k => categories.has(k) ? "1" : "0").join(""),
                    purity: ["sfw", "sketchy", "nsfw"].map(k => purities.has(k) ? "1" : "0").join(""),
                    sorting: sorting.value,
                    order: order.value,
                    page: page.value,
                });
                if (color.value) params.set("colors", color.value);
                if (ratio.value) params.set("ratios", ratio.value);
                if (atleast.value) params.set("atleast", atleast.value);
                if (resolutions.value) params.set("resolutions", resolutions.value);
                if (sorting.value === "toplist" && topRange.value) params.set("topRange", topRange.value);

                const res = await fetch("/wallhaven_gallery/search?" + params.toString(), {
                    headers: apiKey.value ? { "X-API-Key": apiKey.value } : {},
                });
                const data = await res.json();
                if (data.data) {
                    results.value = data.data;
                    total.value = data.meta ? (data.meta.total || 0) : 0;
                } else {
                    errorMsg.value = "搜索失败: " + (data.error || "未知错误");
                }
            } catch (e) {
                errorMsg.value = "请求失败: " + e.message;
            } finally {
                loading.value = false;
            }
        }

        function doSearch() { page.value = 1; search(); }
        function onFilterChange() { page.value = 1; search(); }
        function onSortChange() {
            if (sorting.value === "toplist" && !topRange.value) topRange.value = "1M";
            page.value = 1;
            search();
        }
        function prevPage() { if (page.value > 1) { page.value--; search(); } }
        function nextPage() { page.value++; search(); }

        function toggleSelect(item) {
            const id = item.id;
            if (selected.has(id)) {
                selected.delete(id);
                selectedItems.value = selectedItems.value.filter(s => s.id !== id);
            } else {
                selected.add(id);
                selectedItems.value.push({
                    id,
                    image_url: item.path,
                    thumb_url: (item.thumbs && (item.thumbs.small || item.thumbs.original)) || "",
                    tags: (item.tags || []).map(t => t.name).join(", "),
                    wallpaper_id: item.id,
                    resolution: item.resolution,
                });
            }
            confirmSelection();
        }

        function removeSelection(id) {
            selected.delete(id);
            selectedItems.value = selectedItems.value.filter(s => s.id !== id);
            confirmSelection();
        }

        function clearSelection() {
            selected.clear();
            selectedItems.value = [];
            confirmSelection();
        }

        function confirmSelection() {
            const selectionJson = JSON.stringify({ selections: selectedItems.value.slice() });
            const widget = node.widgets ? node.widgets.find(w => w.name === "selection_data") : null;
            if (widget) widget.value = selectionJson;
            const input = node.inputs ? node.inputs.find(i => i.name === "selection_data") : null;
            if (input) input.value = selectionJson;
            node._selection_data = selectionJson;
            node.setDirtyCanvas(true, true);
            if (node.graph) node.graph.change();
        }

        async function openSettings() {
            isSettingsOpen.value = true;
            savedKeyHint.value = "";
            if (!apiKey.value) {
                try {
                    const res = await fetch("/wallhaven_gallery/settings");
                    const data = await res.json();
                    if (data.success && data.settings && data.settings.api_key) {
                        savedKeyHint.value = "已保存 API Key（后端）";
                    }
                } catch (e) { /* 忽略 */ }
            }
        }
        async function saveSettings() {
            const key = apiKey.value.trim();
            if (key) localStorage.setItem("wallhaven_api_key", key);
            else localStorage.removeItem("wallhaven_api_key");
            try {
                await fetch("/wallhaven_gallery/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ api_key: key }),
                });
            } catch (e) { /* 忽略 */ }
            isSettingsOpen.value = false;
        }

        const totalPages = () => Math.ceil(total.value / PAGE_SIZE) || 1;

        onMounted(() => { search(); });

        return {
            query, categories, purities, sorting, order, page, total, results, loading, errorMsg,
            color, ratio, atleast, resolutions, topRange, advancedVisible,
            openDropdown, selected, selectedItems, isSettingsOpen, apiKey, savedKeyHint,
            CATEGORY_OPTIONS, PURITY_OPTIONS, SORT_OPTIONS, COLOR_OPTIONS, RATIO_OPTIONS,
            ATLEAST_OPTIONS, RES_OPTIONS, TOPRANGE_OPTIONS,
            proxied, toggleDropdown, toggleSet, doSearch, onFilterChange, onSortChange,
            prevPage, nextPage, toggleSelect, removeSelection, clearSelection,
            openSettings, saveSettings, totalPages,
        };
    },
    template: `
    <div class="whg-root" @click="openDropdown = ''">
        <!-- 预览条 -->
        <div class="whg-preview">
            <template v-if="selectedItems.length === 0">
                <div class="whg-preview-empty">选中图片将显示在这里</div>
            </template>
            <template v-else>
                <div class="whg-preview-thumb" v-for="sel in selectedItems" :key="sel.id">
                    <img :src="proxied(sel.thumb_url || sel.image_url)" :alt="sel.wallpaper_id" @error="$event.target.style.display='none'">
                    <div class="whg-preview-del" @click.stop="removeSelection(sel.id)">×</div>
                </div>
                <button class="whg-btn" style="flex-shrink:0;height:60px;align-self:center;margin-left:4px" @click.stop="clearSelection">清除</button>
            </template>
        </div>

        <!-- 工具栏 -->
        <div class="whg-header" @click.stop>
            <input class="whg-search" type="text" v-model="query" placeholder="搜索关键词..." @keydown.enter="doSearch">
            <button class="whg-btn primary" @click="doSearch">🔍 搜索</button>

            <div class="whg-dropdown">
                <button class="whg-btn" @click.stop="toggleDropdown('cat')">分类 ▼</button>
                <div class="whg-dropdown-menu" :class="{show: openDropdown==='cat'}" @click.stop>
                    <div class="whg-dropdown-item" v-for="c in CATEGORY_OPTIONS" :key="c.value">
                        <label><input type="checkbox" :checked="categories.has(c.value)" @change="toggleSet(categories, c.value); onFilterChange()"> {{ c.label }}</label>
                    </div>
                </div>
            </div>

            <div class="whg-dropdown">
                <button class="whg-btn" @click.stop="toggleDropdown('purity')">纯度 ▼</button>
                <div class="whg-dropdown-menu" :class="{show: openDropdown==='purity'}" @click.stop>
                    <div class="whg-dropdown-item" v-for="p in PURITY_OPTIONS" :key="p.value">
                        <label><input type="checkbox" :checked="purities.has(p.value)" @change="toggleSet(purities, p.value); onFilterChange()"> {{ p.label }}</label>
                    </div>
                </div>
            </div>

            <span style="font-size:11px;color:#aaa;margin-right:-2px">排序:</span>
            <select class="whg-btn" v-model="sorting" @change="onSortChange" style="min-width:80px">
                <option v-for="s in SORT_OPTIONS" :key="s.key" :value="s.key">{{ s.label }}</option>
            </select>

            <button class="whg-btn" :class="{active: advancedVisible}" @click.stop="advancedVisible = !advancedVisible">✏️ 筛选</button>
            <button class="whg-btn" @click.stop="openSettings" title="设置">⚙️</button>

            <div class="whg-advanced" v-show="advancedVisible">
                <span style="font-size:11px;color:#aaa">颜色:</span>
                <span class="whg-color-swatch" :style="{background: color ? '#'+color : 'transparent'}"></span>
                <select class="whg-btn" v-model="color" @change="onFilterChange" style="min-width:80px">
                    <option v-for="c in COLOR_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
                </select>

                <span style="font-size:11px;color:#aaa">比例:</span>
                <select class="whg-btn" v-model="ratio" @change="onFilterChange" style="min-width:80px">
                    <option v-for="r in RATIO_OPTIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
                </select>

                <span style="font-size:11px;color:#aaa">最低:</span>
                <select class="whg-btn" v-model="atleast" @change="onFilterChange" style="min-width:100px">
                    <option v-for="a in ATLEAST_OPTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
                </select>

                <span style="font-size:11px;color:#aaa">分辨率:</span>
                <select class="whg-btn" v-model="resolutions" @change="onFilterChange" style="min-width:100px">
                    <option v-for="r in RES_OPTIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
                </select>

                <template v-if="sorting === 'toplist'">
                    <span style="font-size:11px;color:#aaa">榜单:</span>
                    <select class="whg-btn" v-model="topRange" @change="onFilterChange" style="min-width:80px">
                        <option v-for="t in TOPRANGE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
                    </select>
                </template>
            </div>
        </div>

        <!-- 网格 -->
        <div class="whg-grid">
            <div class="whg-loading" v-if="loading">🔄 加载中...</div>
            <div class="whg-error" v-else-if="errorMsg">{{ errorMsg }}</div>
            <div class="whg-empty" v-else-if="!results.length">暂无结果</div>
            <template v-else>
                <div class="whg-thumb" v-for="item in results" :key="item.id"
                     :class="{selected: selected.has(item.id)}" @click="toggleSelect(item)">
                    <img :src="proxied((item.thumbs && (item.thumbs.small || item.thumbs.original)) || '')" loading="lazy" @error="$event.target.style.display='none'">
                    <div class="whg-thumb-info">
                        <span>{{ item.resolution || '' }}</span>
                        <span>♥ {{ item.favorites || 0 }}</span>
                    </div>
                    <span class="whg-thumb-purity" :class="'p-' + (item.purity || 'sfw')">{{ (item.purity || 'sfw').toUpperCase() }}</span>
                </div>
            </template>
        </div>

        <div class="whg-footer">
            <button class="whg-btn" :disabled="page<=1" @click="prevPage">◀ 上一页</button>
            <span class="whg-pageinfo">第 {{ page }} / {{ totalPages() }} 页 (共 {{ total }} 张)</span>
            <button class="whg-btn" :disabled="page>=totalPages()" @click="nextPage">下一页 ▶</button>
        </div>

        <!-- 设置弹窗 -->
        <div class="whg-settings-backdrop" v-if="isSettingsOpen" @click.self="isSettingsOpen = false">
            <div class="whg-settings-panel">
                <h3>设置</h3>
                <label>Wallhaven API Key</label>
                <input type="text" v-model="apiKey" :placeholder="savedKeyHint || '可选，用于 NSFW 和高级搜索'">
                <div class="whg-settings-hint">在 <a href="https://wallhaven.cc/settings/account" target="_blank" rel="noopener">wallhaven.cc/settings/account</a> 获取 API Key</div>
                <div class="whg-settings-footer">
                    <a class="whg-settings-github" href="https://github.com/Yao3596/ComfyUI_Eagle_Suite" target="_blank" rel="noopener">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> GitHub
                    </a>
                    <span class="whg-settings-author">Yao3596 / ComfyUI_Eagle_Suite</span>
                </div>
                <div class="whg-settings-row">
                    <button class="whg-btn" @click="isSettingsOpen = false">取消</button>
                    <button class="whg-btn primary" @click="saveSettings">保存</button>
                </div>
            </div>
        </div>
    </div>
    `,
};

// ── ComfyUI 扩展注册 ─────────────────────────────────────────────────────────
app.registerExtension({
    name: "EagleSuite.WallhavenGallery",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WallhavenGalleryNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.setSize([900, 760]);

            const hideSel = (node) => {
                const w = node.widgets?.find(x => x.name === "selection_data");
                if (!w) return false;
                w.type = "hidden";
                w.computeSize = () => [0, -4];
                w.hidden = true;
                w.draw = () => {};
                node.setDirtyCanvas(true, true);
                return true;
            };
            setTimeout(() => { if (!hideSel(this)) setTimeout(() => hideSel(this), 500); }, 300);

            if (!document.getElementById("whg-style")) {
                const style = document.createElement("style");
                style.id = "whg-style";
                style.textContent = CSS;
                document.head.appendChild(style);
            }

            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.height = "100%";
            const widget = this.addDOMWidget("wallhaven_gallery", "div", container, { serialize: false });
            widget.computeSize = (w) => [w, 660];

            const vueApp = createApp(WallhavenGalleryApp, { node: this });
            vueApp.mount(container);
            this._vueApp = vueApp;

            const onResize = this.onResize;
            this.onResize = function (size) {
                onResize?.apply(this, arguments);
                const h = Math.max(400, size[1] - 100);
                container.style.height = h + "px";
                widget.computeSize = (w) => [w, h];
            };
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
            onRemoved?.apply(this, arguments);
        };
    },
});
