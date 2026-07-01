/**
 * Eagle Gallery - Eagle 图片浏览器节点（Vue 3 重构版）
 * 单文件、自包含，仅依赖 ../lib/vue.esm-browser.js（官方 Vue 3 生产构建）
 *
 * 后端接口（eagle_gallery.py）：
 *   GET  /eagle_gallery/settings
 *   POST /eagle_gallery/settings
 *   GET  /eagle_gallery/folders
 *   GET  /eagle_gallery/tags
 *   POST /eagle_gallery/items      body: {folderId, keywords, star, shape, ext[], tags[], colors, resolution, all}
 *   GET  /eagle_gallery/thumbnail?id=
 *   POST /eagle_gallery/cache_selection  body: {selections, outputMode, folderId}
 *
 * 节点 EagleGalleryNode 的 widget：
 *   selection_data (隐藏，由本组件写入) / sequence_mode（原生 widget，保留）/ output_rgba（原生 widget，保留）
 */
import { app } from "../../../scripts/app.js";
import { createApp, reactive, ref, onMounted, computed, watch } from "../lib/vue.esm-browser.js";

// ── 样式（沿用原版 CSS class 前缀 eg-，保证视觉一致） ──────────────────────────
const CSS = `
.eg-root{display:flex;flex-direction:column;width:100%;height:100%;background:#1a1a1e;font-size:12px;color:#ddd;box-sizing:border-box;font-family:sans-serif;overflow:hidden}
.eg-preview{display:flex;gap:6px;padding:8px 10px;background:#1e1e22;border-bottom:1px solid #333;min-height:70px;max-height:90px;overflow-x:auto;overflow-y:hidden;flex-shrink:0}
.eg-preview::-webkit-scrollbar{height:4px}
.eg-preview::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.eg-preview-thumb{flex-shrink:0;width:80px;height:60px;border-radius:4px;overflow:hidden;border:1px solid #444;position:relative;background:#25252a}
.eg-preview-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.eg-preview-empty{color:#666;font-size:11px;display:flex;align-items:center;justify-content:center;width:100%}
.eg-toolbar{padding:6px 10px;background:#25252a;border-bottom:1px solid #333;display:flex;flex-wrap:wrap;gap:6px;align-items:center;position:relative}
.eg-search{flex:1;min-width:100px;padding:4px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;outline:none}
.eg-search:focus{border-color:#5a8fe0}
.eg-btn{padding:4px 10px;background:#333;border:1px solid #444;border-radius:4px;color:#ddd;font-size:11px;cursor:pointer;white-space:nowrap}
.eg-btn:hover{background:#3a3a40}
.eg-btn.primary{background:#4a7de0;border-color:#4a7de0;color:#fff}
.eg-btn.primary:hover{background:#5a8fe0}
.eg-btn.active{background:#2a4a8a;border-color:#4a7de0}
select.eg-btn{-webkit-appearance:none;-moz-appearance:none;appearance:none;background:#333 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath fill='%23aaa' d='M0 0h8L4 4z'/%3E%3C/svg%3E") no-repeat right 8px center;padding-right:22px}
.eg-dropdown{position:relative;display:inline-block}
.eg-dropdown-menu{display:none;position:absolute;top:100%;left:0;z-index:1000;background:#2a2a30;border:1px solid #444;border-radius:4px;padding:6px;min-width:160px;max-height:220px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.5)}
.eg-dropdown-menu.show{display:block}
.eg-dropdown-search{width:100%;box-sizing:border-box;margin-bottom:4px;padding:3px 6px;background:#1a1a1e;border:1px solid #444;border-radius:3px;color:#eee;font-size:11px}
.eg-dropdown-item{padding:4px 6px;cursor:pointer;font-size:11px;color:#ccc;white-space:nowrap;border-radius:3px}
.eg-dropdown-item:hover{background:#3a3a45}
.eg-dropdown-item label{display:flex;align-items:center;gap:5px;cursor:pointer}
.eg-dropdown-item input{margin:0}
.eg-color-dot{width:12px;height:12px;border-radius:50%;border:1px solid #555;display:inline-block;flex-shrink:0}
.eg-main{flex:1;display:flex;overflow:hidden}
.eg-sidebar{width:180px;background:#1e1e22;border-right:1px solid #333;overflow-y:auto;flex-shrink:0;padding:6px}
.eg-sidebar::-webkit-scrollbar{width:4px}
.eg-sidebar::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.eg-folder-item{padding:4px 6px;border-radius:3px;cursor:pointer;font-size:11px;color:#aaa;display:flex;align-items:center;gap:4px}
.eg-folder-item:hover{background:#2a2a30;color:#ddd}
.eg-folder-item.active{background:#2a4a8a;color:#fff}
.eg-folder-item.all{font-weight:bold;color:#eee}
.eg-folder-icon{font-size:10px;cursor:pointer;padding:1px 3px;border-radius:3px;transition:background .15s}
.eg-folder-icon:hover{background:#3a3a45;color:#fff}
.eg-folder-children{padding-left:14px;border-left:1px solid #333;margin-left:6px}
.eg-folder-mode-bar{padding:4px 8px;border-top:1px solid #333;display:flex;align-items:center;gap:4px;font-size:10px;color:#888}
.eg-grid{flex:1;overflow-y:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));grid-auto-rows:100px;gap:8px;align-content:start;background:#1a1a1e}
.eg-grid::-webkit-scrollbar{width:6px}
.eg-grid::-webkit-scrollbar-track{background:transparent}
.eg-grid::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
.eg-thumb{position:relative;background:#222;border-radius:4px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color .15s,transform .1s;height:100px}
.eg-thumb:hover{border-color:#5a8fe0;transform:translateY(-1px)}
.eg-thumb.selected{border-color:#4a7de0;box-shadow:0 0 0 1px #4a7de0}
.eg-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.eg-thumb-info{position:absolute;bottom:0;left:0;right:0;padding:3px 6px;background:linear-gradient(transparent,rgba(0,0,0,.85));font-size:10px;color:#aaa;display:flex;justify-content:space-between;gap:4px}
.eg-thumb-star{position:absolute;top:3px;left:40px;color:#fc0;font-size:10px;text-shadow:0 1px 2px rgba(0,0,0,.8);z-index:1}
.eg-thumb-res{position:absolute;top:3px;right:3px;padding:1px 4px;border-radius:2px;font-size:9px;background:rgba(0,0,0,.6);color:#ccc}
.eg-thumb-index{position:absolute;top:3px;left:3px;padding:1px 5px;border-radius:2px;font-size:10px;background:rgba(74,125,224,.85);color:#fff;font-weight:700;z-index:2}
.eg-footer{padding:5px 10px;background:#25252a;border-top:1px solid #333;display:flex;align-items:center;gap:8px;flex-shrink:0}
.eg-pageinfo{flex:1;text-align:center;color:#888;font-size:11px}
.eg-empty{text-align:center;padding:40px;color:#666;font-size:13px}
.eg-loading{text-align:center;padding:40px;color:#888}
.eg-error{text-align:center;padding:40px;color:#e66}
.eg-settings-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center}
.eg-settings-panel{background:#25252a;border:1px solid #444;border-radius:8px;padding:20px;width:360px;box-shadow:0 8px 24px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:12px}
.eg-settings-panel h3{margin:0 0 4px;color:#eee;font-size:14px}
.eg-settings-panel label{display:block;margin-bottom:4px;color:#aaa;font-size:12px}
.eg-settings-panel input{width:100%;padding:6px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;box-sizing:border-box}
.eg-settings-panel input:focus{border-color:#5a8fe0;outline:none}
.eg-settings-hint{color:#888;font-size:11px;margin-top:4px;line-height:1.4}
.eg-settings-hint code{background:#1e1e22;padding:1px 4px;border-radius:3px;color:#aaa;font-family:monospace}
.eg-settings-footer{margin-top:8px;padding-top:12px;border-top:1px solid #333;display:flex;align-items:center;justify-content:space-between;gap:8px}
.eg-settings-github{display:inline-flex;align-items:center;gap:6px;color:#aaa;font-size:12px;text-decoration:none;padding:5px 10px;background:#1e1e22;border:1px solid #333;border-radius:4px;transition:.15s}
.eg-settings-github:hover{color:#eee;border-color:#555}
.eg-settings-author{color:#666;font-size:11px}
.eg-settings-row{display:flex;gap:8px;justify-content:flex-end}
.eg-preview-del{position:absolute;top:2px;right:2px;width:16px;height:16px;background:rgba(0,0,0,.7);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s;z-index:2}
.eg-preview-thumb:hover .eg-preview-del{opacity:1}
.eg-preview-del:hover{background:rgba(200,0,0,.8)}
`;

// ── 常量选项（与后端约定的取值保持一致，见 eagle_gallery.py items_route） ──────
const STAR_OPTIONS = ["全部", "未评分", "1星", "2星", "3星", "4星", "5星"];
const SHAPE_OPTIONS = [
    { value: "全部", label: "全部比例" },
    { value: "横向", label: "▬ 横向" },
    { value: "纵向", label: "▮ 纵向" },
    { value: "方形", label: "■ 方形" },
];
const RESOLUTION_OPTIONS = [
    { value: "全部", label: "全部分辨率" },
    { value: "4K", label: "≥4K" },
    { value: "2K", label: "≥2K" },
    { value: "1080p", label: "≥1080p" },
    { value: "720p", label: "≥720p" },
];
const EXT_OPTIONS = ["jpg", "png", "webp", "gif", "mp4", "bmp", "psd", "tiff"];
const COLOR_OPTIONS = [
    { value: "F04A4A", label: "红" }, { value: "F0954A", label: "橙" },
    { value: "F0E24A", label: "黄" }, { value: "6FCB4A", label: "绿" },
    { value: "4AC6CB", label: "青" }, { value: "4A7DE0", label: "蓝" },
    { value: "8A4AE0", label: "紫" }, { value: "E04AC6", label: "品红" },
    { value: "222222", label: "黑" }, { value: "FFFFFF", label: "白" },
    { value: "999999", label: "灰" },
];

const EagleGalleryApp = {
    props: { node: { type: Object, required: true } },
    setup(props) {
        const node = props.node;

        const searchQuery = ref("");
        const jumpIndex = ref("");
        const folders = ref([]);
        const items = ref([]);
        const total = ref(0);
        const loading = ref(false);
        const errorMsg = ref("");
        const sidebarVisible = ref(true);
        const openDropdown = ref("");
        const tagSearch = ref("");

        const filters = reactive({
            folderId: "",
            star: "全部",
            shape: "全部",
            resolution: "全部",
            ext: [],
            tags: [],
            colors: [],
        });

        const folderOutputMode = ref(false); // true = 整文件夹输出，忽略 selected

        const selected = reactive(new Set());
        const selectedItems = ref([]);

        const availableTags = ref([]);

        const isSettingsOpen = ref(false);
        const eagleUrl = ref("");

        const filteredTags = computed(() => {
            const q = tagSearch.value.trim().toLowerCase();
            if (!q) return availableTags.value;
            return availableTags.value.filter(t => (t.name || "").toLowerCase().includes(q));
        });

        function thumbUrl(id) {
            return "/eagle_gallery/thumbnail?id=" + encodeURIComponent(id);
        }

        // ── 数据加载 ──────────────────────────────────────────────────────
        async function loadFolders() {
            try {
                const res = await fetch("/eagle_gallery/folders");
                const data = await res.json();
                if (data.success) folders.value = data.folders || [];
            } catch (e) { /* 静默，侧边栏会显示空态 */ }
        }

        async function loadTags() {
            try {
                const res = await fetch("/eagle_gallery/tags");
                const data = await res.json();
                if (data.success) availableTags.value = data.tags || [];
            } catch (e) { /* 忽略 */ }
        }

        async function loadItems() {
            if (loading.value) return;
            loading.value = true;
            errorMsg.value = "";
            try {
                const body = {
                    folderId: filters.folderId,
                    keywords: searchQuery.value.trim(),
                    star: filters.star,
                    shape: filters.shape,
                    resolution: filters.resolution,
                    ext: filters.ext,
                    tags: filters.tags,
                    colors: filters.colors.join(","),
                    all: true,
                };
                const res = await fetch("/eagle_gallery/items", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                const data = await res.json();
                if (data.success) {
                    items.value = data.items || [];
                    total.value = data.total || 0;
                } else {
                    errorMsg.value = "加载失败: " + (data.error || "未知错误");
                    items.value = [];
                }
            } catch (e) {
                errorMsg.value = "请求失败: " + e.message;
                items.value = [];
            } finally {
                loading.value = false;
            }
        }

        // ── 选择 ──────────────────────────────────────────────────────────
        function toggleSelect(item) {
            const id = item.id;
            if (selected.has(id)) {
                selected.delete(id);
                selectedItems.value = selectedItems.value.filter(s => s.id !== id);
            } else {
                selected.add(id);
                selectedItems.value.push({
                    id,
                    name: item.name || "",
                    filePath: item.filePath || "",
                    tags: item.tags || [],
                    width: item.width || 0,
                    height: item.height || 0,
                    star: item.star || 0,
                    ext: item.ext || "",
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

        function jumpToIndex() {
            const idx = parseInt(jumpIndex.value, 10);
            if (isNaN(idx) || idx < 0 || !total.value) return;
            const target = Math.min(idx, total.value - 1);
            requestAnimationFrame(() => {
                const grid = node._egGridEl;
                if (!grid) return;
                const card = grid.querySelectorAll(".eg-thumb")[target];
                if (!card) return;
                card.scrollIntoView({ behavior: "smooth", block: "center" });
                card.style.boxShadow = "0 0 12px 2px #4a7de0";
                setTimeout(() => { card.style.boxShadow = ""; }, 1200);
            });
        }

        // ── 同步选中数据到节点（widget + 服务端缓存） ───────────────────────
        function confirmSelection() {
            const payload = {
                selections: selectedItems.value,
                outputMode: folderOutputMode.value ? "folder" : "selection",
                folderId: filters.folderId,
            };
            const selectionJson = JSON.stringify(payload);

            const widget = node.widgets ? node.widgets.find(w => w.name === "selection_data") : null;
            if (widget) widget.value = selectionJson;
            const input = node.inputs ? node.inputs.find(i => i.name === "selection_data") : null;
            if (input) input.value = selectionJson;
            node._selection_data = selectionJson;

            fetch("/eagle_gallery/cache_selection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }).catch(() => {});

            node.setDirtyCanvas(true, true);
            if (node.graph) node.graph.change();
        }

        // ── 设置弹窗 ──────────────────────────────────────────────────────
        async function openSettings() {
            isSettingsOpen.value = true;
            try {
                const res = await fetch("/eagle_gallery/settings");
                const data = await res.json();
                if (data.success && data.settings) eagleUrl.value = data.settings.eagle_url || "";
            } catch (e) { /* 忽略 */ }
        }
        async function saveSettings() {
            try {
                await fetch("/eagle_gallery/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ eagle_url: eagleUrl.value.trim() || "http://localhost:41595" }),
                });
            } catch (e) { /* 忽略 */ }
            isSettingsOpen.value = false;
        }

        // ── 下拉筛选辅助 ──────────────────────────────────────────────────
        function toggleDropdown(name) {
            openDropdown.value = openDropdown.value === name ? "" : name;
        }
        function toggleArrayValue(arr, value) {
            const idx = arr.indexOf(value);
            if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
        }

        function selectFolder(id) {
            filters.folderId = id;
        }

        // 折叠文件夹树的展开状态
        const collapsedFolders = reactive(new Set());
        function toggleFolderCollapse(id) {
            if (collapsedFolders.has(id)) collapsedFolders.delete(id);
            else collapsedFolders.add(id);
        }

        function collectFolderIds(nodes, ids = new Set()) {
            for (const node of nodes) {
                ids.add(node.id);
                if (node.children && node.children.length) collectFolderIds(node.children, ids);
            }
            return ids;
        }

        function collapseAllFolders() {
            collapsedFolders.clear();
            collectFolderIds(folders.value, collapsedFolders);
        }

        function expandAllFolders() {
            collapsedFolders.clear();
        }

        // 默认折叠子文件夹（保留顶层文件夹展开），初次加载数据后自动应用
        watch(folders, (newFolders) => {
            collapsedFolders.clear();
            for (const folder of newFolders) {
                if (folder.children && folder.children.length) {
                    collectFolderIds(folder.children, collapsedFolders);
                }
            }
        }, { immediate: true });

        watch(() => [filters.folderId, filters.star, filters.shape, filters.resolution, filters.ext.slice(), filters.tags.slice(), filters.colors.slice()],
            () => { loadItems(); }, { deep: false });

        onMounted(() => {
            loadFolders();
            loadTags();
            loadItems();
        });

        return {
            searchQuery, jumpIndex, folders, items, total, loading, errorMsg,
            sidebarVisible, openDropdown, tagSearch, filters, filteredTags,
            folderOutputMode, selected, selectedItems, isSettingsOpen, eagleUrl,
            STAR_OPTIONS, SHAPE_OPTIONS, RESOLUTION_OPTIONS, EXT_OPTIONS, COLOR_OPTIONS,
            thumbUrl, loadItems, toggleSelect, removeSelection, clearSelection,
            jumpToIndex, openSettings, saveSettings, toggleDropdown, toggleArrayValue,
            selectFolder, collapsedFolders, toggleFolderCollapse, collapseAllFolders, expandAllFolders,
            setGridEl: (el) => { node._egGridEl = el; },
        };
    },
    template: `
    <div class="eg-root" @click="openDropdown = ''">
        <!-- 预览条 -->
        <div class="eg-preview">
            <template v-if="selectedItems.length === 0">
                <div class="eg-preview-empty">选中图片将显示在这里</div>
            </template>
            <template v-else>
                <div class="eg-preview-thumb" v-for="sel in selectedItems" :key="sel.id">
                    <img :src="thumbUrl(sel.id)" :title="sel.name" @error="$event.target.style.display='none'">
                    <div class="eg-preview-del" @click.stop="removeSelection(sel.id)">×</div>
                </div>
                <button class="eg-btn" style="flex-shrink:0;height:60px;align-self:center;margin-left:4px" @click.stop="clearSelection">清除</button>
            </template>
        </div>

        <!-- 工具栏 -->
        <div class="eg-toolbar" @click.stop>
            <input class="eg-search" type="text" v-model="searchQuery" placeholder="搜索关键词..." @keydown.enter="loadItems">
            <button class="eg-btn primary" @click="loadItems">🔍 搜索</button>

            <input class="eg-search" type="number" v-model="jumpIndex" placeholder="# 索引" style="min-width:60px;max-width:80px;flex:0" title="输入数字跳转到对应索引（0起）" @keydown.enter="jumpToIndex">
            <button class="eg-btn" @click="jumpToIndex" title="跳转到指定索引">↗ 跳转</button>

            <span style="color:#888;font-size:11px;white-space:nowrap">共 {{ total }} 张</span>

            <select class="eg-btn" v-model="filters.star" style="min-width:80px">
                <option v-for="s in STAR_OPTIONS" :key="s" :value="s">{{ s === '全部' ? '⭐ 全部' : '⭐ ' + s }}</option>
            </select>

            <select class="eg-btn" v-model="filters.shape" style="min-width:80px">
                <option v-for="s in SHAPE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>

            <select class="eg-btn" v-model="filters.resolution" style="min-width:90px">
                <option v-for="r in RESOLUTION_OPTIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>

            <!-- 格式（多选） -->
            <div class="eg-dropdown">
                <button class="eg-btn" :class="{active: filters.ext.length}" @click.stop="toggleDropdown('ext')">格式{{ filters.ext.length ? '('+filters.ext.length+')' : '' }} ▼</button>
                <div class="eg-dropdown-menu" :class="{show: openDropdown==='ext'}" @click.stop>
                    <div class="eg-dropdown-item" v-for="ex in EXT_OPTIONS" :key="ex">
                        <label><input type="checkbox" :checked="filters.ext.includes(ex)" @change="toggleArrayValue(filters.ext, ex)"> {{ ex.toUpperCase() }}</label>
                    </div>
                </div>
            </div>

            <!-- 标签（多选+搜索） -->
            <div class="eg-dropdown">
                <button class="eg-btn" :class="{active: filters.tags.length}" @click.stop="toggleDropdown('tags')">标签{{ filters.tags.length ? '('+filters.tags.length+')' : '' }} ▼</button>
                <div class="eg-dropdown-menu" :class="{show: openDropdown==='tags'}" @click.stop>
                    <input class="eg-dropdown-search" type="text" v-model="tagSearch" placeholder="搜索标签...">
                    <div class="eg-dropdown-item" v-for="t in filteredTags" :key="t.name">
                        <label><input type="checkbox" :checked="filters.tags.includes(t.name)" @change="toggleArrayValue(filters.tags, t.name)"> {{ t.name }} <span style="color:#666">({{ t.count }})</span></label>
                    </div>
                    <div v-if="!filteredTags.length" style="color:#666;padding:4px 6px">无匹配标签</div>
                </div>
            </div>

            <!-- 颜色（多选） -->
            <div class="eg-dropdown">
                <button class="eg-btn" :class="{active: filters.colors.length}" @click.stop="toggleDropdown('colors')">颜色{{ filters.colors.length ? '('+filters.colors.length+')' : '' }} ▼</button>
                <div class="eg-dropdown-menu" :class="{show: openDropdown==='colors'}" @click.stop>
                    <div class="eg-dropdown-item" v-for="c in COLOR_OPTIONS" :key="c.value">
                        <label><input type="checkbox" :checked="filters.colors.includes(c.value)" @change="toggleArrayValue(filters.colors, c.value)">
                        <span class="eg-color-dot" :style="{background:'#'+c.value}"></span> {{ c.label }}</label>
                    </div>
                </div>
            </div>

            <button class="eg-btn" @click="sidebarVisible = !sidebarVisible" title="切换文件夹树">📂</button>
            <button class="eg-btn" @click="collapseAllFolders" title="折叠全部文件夹">📁➖</button>
            <button class="eg-btn" @click="expandAllFolders" title="展开全部文件夹">📁➕</button>
            <button class="eg-btn" :class="{active: folderOutputMode}" @click="folderOutputMode = !folderOutputMode; confirmSelection()" title="开启后输出整个文件夹，而非仅选中项">📦 整夹输出</button>
            <button class="eg-btn" @click="openSettings" title="设置">⚙️</button>
        </div>

        <!-- 主体 -->
        <div class="eg-main">
            <div class="eg-sidebar" v-show="sidebarVisible">
                <div class="eg-folder-item all" :class="{active: filters.folderId===''}" @click="selectFolder('')">
                    <span class="eg-folder-icon">📁</span> 全部文件夹
                </div>
                <template v-if="folders.length">
                    <FolderNode v-for="f in folders" :key="f.id" :folder="f" :active-id="filters.folderId"
                                :collapsed="collapsedFolders" @select="selectFolder" @toggle="toggleFolderCollapse" />
                </template>
                <div class="eg-empty" v-else>{{ folders.length === 0 ? '加载中或无文件夹' : '' }}</div>
            </div>

            <div class="eg-grid" :ref="setGridEl">
                <div class="eg-loading" v-if="loading">🔄 加载中...</div>
                <div class="eg-error" v-else-if="errorMsg">{{ errorMsg }}</div>
                <div class="eg-empty" v-else-if="!items.length">暂无结果</div>
                <template v-else>
                    <div class="eg-thumb" v-for="(item, i) in items" :key="item.id"
                         :class="{selected: selected.has(item.id)}"
                         @click="toggleSelect(item)">
                        <img :src="thumbUrl(item.id)" loading="lazy" :alt="item.name" @error="$event.target.style.display='none'">
                        <span class="eg-thumb-index">#{{ i }}</span>
                        <span class="eg-thumb-star" v-if="item.star">{{ '★'.repeat(item.star) }}</span>
                        <span class="eg-thumb-res" v-if="item.width && item.height">{{ item.width }}x{{ item.height }}</span>
                        <div class="eg-thumb-info">
                            <span>{{ item.tags && item.tags.length ? '🏷 ' + item.tags.length : '' }}</span>
                            <span>{{ (item.name || '未命名').slice(0, 12) }}</span>
                        </div>
                    </div>
                </template>
            </div>
        </div>

        <div class="eg-footer">
            <span class="eg-pageinfo">共 {{ total }} 张 | 选中 {{ selected.size }} 张{{ folderOutputMode ? ' | 整夹输出模式' : '' }}</span>
        </div>

        <!-- 设置弹窗 -->
        <div class="eg-settings-backdrop" v-if="isSettingsOpen" @click.self="isSettingsOpen = false">
            <div class="eg-settings-panel">
                <h3>设置</h3>
                <label>Eagle API URL</label>
                <input type="text" v-model="eagleUrl" placeholder="http://localhost:41595">
                <div class="eg-settings-hint">支持在 URL 末尾添加 <code>?token=xxx</code> 进行认证，如 <code>http://localhost:41595/?token=abc123</code></div>
                <div class="eg-settings-footer">
                    <a class="eg-settings-github" href="https://github.com/Yao3596/ComfyUI_Eagle_Suite" target="_blank" rel="noopener">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> GitHub
                    </a>
                    <span class="eg-settings-author">Yao3596 / ComfyUI_Eagle_Suite</span>
                </div>
                <div class="eg-settings-row">
                    <button class="eg-btn" @click="isSettingsOpen = false">取消</button>
                    <button class="eg-btn primary" @click="saveSettings">保存</button>
                </div>
            </div>
        </div>
    </div>
    `,
};

// ── 文件夹树子组件（递归） ─────────────────────────────────────────────────
const FolderNode = {
    name: "FolderNode",
    props: { folder: Object, activeId: String, collapsed: Object },
    emits: ["select", "toggle"],
    template: `
    <div>
        <div class="eg-folder-item" :class="{active: activeId === folder.id}" @click="$emit('select', folder.id)">
            <span class="eg-folder-icon" v-if="folder.children && folder.children.length"
                  @click.stop="$emit('toggle', folder.id)">{{ collapsed.has(folder.id) ? '📁' : '📂' }}</span>
            <span class="eg-folder-icon" v-else>📄</span>
            {{ folder.name || '未命名' }}
        </div>
        <div class="eg-folder-children" v-if="folder.children && folder.children.length && !collapsed.has(folder.id)">
            <FolderNode v-for="c in folder.children" :key="c.id" :folder="c" :active-id="activeId"
                        :collapsed="collapsed" @select="$emit('select', $event)" @toggle="$emit('toggle', $event)" />
        </div>
    </div>
    `,
};
EagleGalleryApp.components = { FolderNode };

// ── ComfyUI 扩展注册 ─────────────────────────────────────────────────────────
app.registerExtension({
    name: "EagleSuite.EagleGallery",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "EagleGalleryNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.setSize([960, 760]);

            // 隐藏 selection_data 文本 widget（数据通过本组件写入，无需展示）
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

            if (!document.getElementById("eg-style")) {
                const style = document.createElement("style");
                style.id = "eg-style";
                style.textContent = CSS;
                document.head.appendChild(style);
            }

            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.height = "660px";
            container.style.overflow = "hidden";
            const widget = this.addDOMWidget("eagle_gallery", "div", container, { serialize: false });
            widget.computeSize = (w) => [w, 660];

            const vueApp = createApp(EagleGalleryApp, { node: this });
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
