/**
 * Eagle Gallery Vue — Eagle 图片浏览器节点（Vue 3 版本）
 *
 * 使用 Vue 3 Composition API + ESM 直引模式重写
 * CSS 前缀: egv- (Eagle Gallery Vue)
 * API 路由: 复用 /eagle_gallery/* 系列路由
 */
import { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick, defineComponent, inject } from "../lib/vue.esm-browser.js";
import { app } from "../../../scripts/app.js";

// ── CSS 样式（egv- 前缀，避免与原版 eg- 冲突） ────────────────────────────────
const CSS = `
.egv-root{display:flex;flex-direction:column;width:100%;height:100%;background:#1a1a1e;font-size:12px;color:#ddd;box-sizing:border-box;font-family:sans-serif;overflow:hidden}
.egv-preview{display:flex;gap:6px;padding:8px 10px;background:#1e1e22;border-bottom:1px solid #333;min-height:70px;max-height:90px;overflow-x:auto;overflow-y:hidden;flex-shrink:0;align-items:center}
.egv-preview::-webkit-scrollbar{height:4px}
.egv-preview::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.egv-preview-empty{color:#666;font-size:11px;display:flex;align-items:center;justify-content:center;width:100%}
.egv-preview-thumb{flex-shrink:0;width:80px;height:60px;border-radius:4px;overflow:hidden;border:1px solid #444;position:relative;background:#25252a}
.egv-preview-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.egv-preview-del{position:absolute;top:2px;right:2px;width:16px;height:16px;background:rgba(0,0,0,.7);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s;z-index:2}
.egv-preview-thumb:hover .egv-preview-del{opacity:1}
.egv-preview-del:hover{background:rgba(200,0,0,.8)}
.egv-toolbar{padding:6px 10px;background:#25252a;border-bottom:1px solid #333;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.egv-search{flex:1;min-width:100px;padding:4px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;outline:none}
.egv-search:focus{border-color:#5a8fe0}
.egv-btn{padding:4px 10px;background:#333;border:1px solid #444;border-radius:4px;color:#ddd;font-size:11px;cursor:pointer;white-space:nowrap}
.egv-btn:hover{background:#3a3a40}
.egv-btn.primary{background:#4a7de0;border-color:#4a7de0;color:#fff}
.egv-btn.primary:hover{background:#5a8fe0}
.egv-btn.active{background:#2a4a8a;border-color:#4a7de0}
.egv-main{flex:1;display:flex;overflow:hidden}
.egv-sidebar{width:180px;background:#1e1e22;border-right:1px solid #333;overflow-y:auto;flex-shrink:0;padding:6px}
.egv-sidebar::-webkit-scrollbar{width:4px}
.egv-sidebar::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.egv-folder-item{padding:4px 6px;border-radius:3px;cursor:pointer;font-size:11px;color:#aaa;display:flex;align-items:center;gap:4px}
.egv-folder-item:hover{background:#2a2a30;color:#ddd}
.egv-folder-item.active{background:#2a4a8a;color:#fff}
.egv-folder-icon{font-size:10px}
.egv-folder-children{padding-left:14px;border-left:1px solid #333;margin-left:6px}
.egv-grid{flex:1;overflow-y:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));grid-auto-rows:100px;gap:8px;align-content:start;background:#1a1a1e}
.egv-grid::-webkit-scrollbar{width:6px}
.egv-grid::-webkit-scrollbar-track{background:transparent}
.egv-grid::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
.egv-thumb{position:relative;background:#222;border-radius:4px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color .15s,transform .1s;height:100px}
.egv-thumb:hover{border-color:#5a8fe0;transform:translateY(-1px)}
.egv-thumb.selected{border-color:#4a7de0;box-shadow:0 0 0 1px #4a7de0}
.egv-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.egv-thumb-info{position:absolute;bottom:0;left:0;right:0;padding:3px 6px;background:linear-gradient(transparent,rgba(0,0,0,.85));font-size:10px;color:#aaa;display:flex;justify-content:space-between;gap:4px}
.egv-thumb-star{position:absolute;top:3px;left:40px;color:#fc0;font-size:10px;text-shadow:0 1px 2px rgba(0,0,0,.8);z-index:1}
.egv-thumb-res{position:absolute;top:3px;right:3px;padding:1px 4px;border-radius:2px;font-size:9px;background:rgba(0,0,0,.6);color:#ccc}
.egv-thumb-index{position:absolute;top:3px;left:3px;padding:1px 5px;border-radius:2px;font-size:10px;background:rgba(74,125,224,.85);color:#fff;font-weight:700;z-index:2}
.egv-footer{padding:5px 10px;background:#25252a;border-top:1px solid #333;display:flex;align-items:center;gap:8px;flex-shrink:0}
.egv-pageinfo{flex:1;text-align:center;color:#888;font-size:11px}
.egv-empty{text-align:center;padding:40px;color:#666;font-size:13px}
.egv-loading{text-align:center;padding:40px;color:#888}
.egv-error{text-align:center;padding:40px;color:#e66}
select.egv-btn{-webkit-appearance:none;-moz-appearance:none;appearance:none;background:#333 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath fill='%23aaa' d='M0 0h8L4 4z'/%3E%3C/svg%3E") no-repeat right 8px center;padding-right:22px}
.egv-settings-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;align-items:center;justify-content:center}
.egv-settings-backdrop.show{display:flex}
.egv-settings-panel{background:#25252a;border:1px solid #444;border-radius:8px;padding:20px;width:360px;box-shadow:0 8px 24px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:12px}
.egv-settings-panel h3{margin:0 0 4px;color:#eee;font-size:14px}
.egv-settings-panel label{display:block;margin-bottom:4px;color:#aaa;font-size:12px}
.egv-settings-panel input{width:100%;padding:6px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;box-sizing:border-box}
.egv-settings-panel input:focus{border-color:#5a8fe0;outline:none}
.egv-settings-hint{color:#888;font-size:11px;margin-top:4px;line-height:1.4}
.egv-settings-hint code{background:#1e1e22;padding:1px 4px;border-radius:3px;color:#aaa;font-family:monospace}
.egv-settings-footer{margin-top:8px;padding-top:12px;border-top:1px solid #333;display:flex;align-items:center;justify-content:space-between;gap:8px}
.egv-settings-github{display:inline-flex;align-items:center;gap:6px;color:#aaa;font-size:12px;text-decoration:none;padding:5px 10px;background:#1e1e22;border:1px solid #333;border-radius:4px;transition:.15s}
.egv-settings-github:hover{color:#eee;border-color:#555}
.egv-settings-author{color:#666;font-size:11px}
.egv-settings-row{display:flex;gap:8px;justify-content:flex-end}
.egv-jump-input{min-width:60px;max-width:80px;flex:0;padding:4px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;outline:none}
.egv-jump-input:focus{border-color:#5a8fe0}
.egv-badge{color:#888;font-size:11px;white-space:nowrap}
`;

// ── 注入样式 ──────────────────────────────────────────────────────────────────
if (!document.getElementById("egv-style")) {
    const styleEl = document.createElement("style");
    styleEl.id = "egv-style";
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
}

// ── Vue 组件 ──────────────────────────────────────────────────────────────────
const EagleGalleryVue = defineComponent({
    name: "EagleGalleryVue",

    setup() {
        // ── 响应式状态 ──────────────────────────────────────────────
        const query = ref("");
        const folderId = ref("");
        const star = ref("全部");
        const shape = ref("全部");
        const items = ref([]);
        const total = ref(0);
        const loading = ref(false);
        const selectedItems = ref([]);   // 唯一数据源：完整的选中项列表
        const folders = ref([]);
        const sidebarVisible = ref(true);
        const jumpIndex = ref("");
        const showSettings = ref(false);
        const settingsUrl = ref("http://localhost:41595");
        const errorMsg = ref("");
        const gridEl = ref(null);
        // 通过 provide/inject 获取 ComfyUI 节点引用（避免静态属性多实例冲突）
        const _comfyNode = inject("comfyNode", null);

        // ── 计算属性 ────────────────────────────────────────────────
        const totalText = computed(() => `共 ${total.value} 张`);

        // 基于 selectedItems 的快速查找集合（替代 reactive(Set)，避免响应式追踪问题）
        const selectedIds = computed(() => new Set(selectedItems.value.map(s => s.id)));

        function isSelected(id) {
            return selectedIds.value.has(id);
        }

        const starOptions = ["全部", "未评分", "1星", "2星", "3星", "4星", "5星"];
        const shapeOptions = [
            { value: "全部", label: "全部比例" },
            { value: "横向", label: "▬ 横向" },
            { value: "纵向", label: "▮ 纵向" },
            { value: "方形", label: "■ 方形" },
        ];

        // ── 文件夹树扁平化（用于下拉选择） ────────────────────────
        const flatFolders = computed(() => {
            const result = [];
            function walk(list, prefix) {
                if (!list) return;
                for (const f of list) {
                    result.push({ id: f.id, name: prefix + (f.name || "未命名") });
                    if (f.children && f.children.length) {
                        walk(f.children, prefix + "  ");
                    }
                }
            }
            walk(folders.value, "");
            return result;
        });

        // ── API 调用 ──────────────────────────────────────────────
        async function loadFolders() {
            try {
                const res = await fetch("/eagle_gallery/folders");
                const data = await res.json();
                if (data.success && data.folders) {
                    folders.value = data.folders;
                } else {
                    errorMsg.value = "获取文件夹失败";
                }
            } catch (e) {
                errorMsg.value = "连接 Eagle 失败，请确认 Eagle 已启动";
            }
        }

        async function loadItems() {
            if (loading.value) return;
            loading.value = true;
            errorMsg.value = "";
            try {
                const body = {
                    folderId: folderId.value,
                    keywords: query.value.trim(),
                    star: star.value,
                    shape: shape.value,
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
                    errorMsg.value = data.error || "未知错误";
                }
            } catch (e) {
                errorMsg.value = e.message;
            } finally {
                loading.value = false;
            }
        }

        async function fetchSettings() {
            try {
                const res = await fetch("/eagle_gallery/settings");
                const data = await res.json();
                if (data.success && data.settings) {
                    settingsUrl.value = data.settings.eagle_url || "http://localhost:41595";
                }
            } catch (e) { /* ignore */ }
        }

        async function saveSettings() {
            await fetch("/eagle_gallery/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eagle_url: settingsUrl.value || "http://localhost:41595" }),
            });
            showSettings.value = false;
        }

        // ── 选择管理 ──────────────────────────────────────────────
        function toggleSelect(item, index) {
            const itemId = item.id;
            if (isSelected(itemId)) {
                selectedItems.value = selectedItems.value.filter(s => s.id !== itemId);
            } else {
                selectedItems.value = [...selectedItems.value, {
                    id: itemId,
                    name: item.name || "",
                    filePath: item.filePath || "",
                    tags: item.tags || [],
                    width: item.width || 0,
                    height: item.height || 0,
                    star: item.star || 0,
                    ext: item.ext || "",
                }];
            }
            confirmSelection();
        }

        function removeFromSelection(selItem) {
            selectedItems.value = selectedItems.value.filter(s => s.id !== selItem.id);
            confirmSelection();
        }

        function clearSelection() {
            selectedItems.value = [];
            confirmSelection();
        }

        function confirmSelection() {
            // 通知 ComfyUI 节点更新 selection_data
            const node = _comfyNode;
            if (!node) return;

            const selections = selectedItems.value.slice();
            const selectionJson = JSON.stringify({ selections });

            // 与 Wallhaven/DOM版对齐：先查 widgets，再查 inputs，最后 fallback
            const widget = node.widgets ? node.widgets.find(w => w.name === "selection_data") : null;
            if (widget) {
                widget.value = selectionJson;
            } else {
                const input = node.inputs ? node.inputs.find(inp => inp.name === "selection_data") : null;
                if (input) {
                    input.value = selectionJson;
                } else {
                    node._selection_data = selectionJson;
                }
            }
            node.setDirtyCanvas(true, true);
            if (node.graph) {
                node.graph.change();
            }
        }

        // ── 跳转到指定索引 ────────────────────────────────────────
        function jumpToIndex() {
            const idx = parseInt(jumpIndex.value, 10);
            if (isNaN(idx) || idx < 0 || !total.value) return;
            const targetIdx = Math.min(idx, total.value - 1);
            if (!gridEl.value) return;
            const cards = gridEl.value.querySelectorAll(".egv-thumb");
            const card = cards[targetIdx];
            if (!card) return;
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.style.transition = "none";
            card.style.boxShadow = "0 0 12px 2px #4a7de0";
            setTimeout(() => {
                card.style.transition = "border-color .15s,transform .1s,box-shadow .6s";
                card.style.boxShadow = "";
            }, 1200);
        }

        // ── 双击跳转 ──────────────────────────────────────────────
        function onDblClick(item, index) {
            jumpIndex.value = String(index);
            if (!isSelected(item.id)) {
                toggleSelect(item, index);
            }
        }

        // ── 工具函数 ──────────────────────────────────────────────
        function escapeHtml(text) {
            const div = document.createElement("div");
            div.textContent = text;
            return div.innerHTML;
        }

        function truncate(text, maxLen) {
            return text && text.length > maxLen ? text.slice(0, maxLen) + "..." : (text || "");
        }

        function thumbnailUrl(id) {
            return "/eagle_gallery/thumbnail?id=" + encodeURIComponent(id);
        }

        // ── 搜索处理 ──────────────────────────────────────────────
        function onSearchKeydown(e) {
            if (e.key === "Enter") loadItems();
        }

        function onJumpKeydown(e) {
            if (e.key === "Enter") jumpToIndex();
        }

        // ── 预览条滚轮横向滚动 ──────────────────────────────────────
        function onPreviewWheel(e) {
            if (e.deltaY !== 0) {
                e.preventDefault();
                e.currentTarget.scrollLeft += e.deltaY;
            }
        }

        // ── 生命周期 ──────────────────────────────────────────────
        onMounted(() => {
            loadFolders();
            fetchSettings();
            loadItems(); // 自动加载全部图片
        });

        return {
            // 状态
            query, folderId, star, shape, items, total, loading,
            selectedItems, folders, sidebarVisible,
            jumpIndex, showSettings, settingsUrl, errorMsg, gridEl,
            // 计算属性
            totalText, flatFolders, starOptions, shapeOptions, selectedIds,
            // 方法
            isSelected,
            loadFolders, loadItems, fetchSettings, saveSettings,
            toggleSelect, removeFromSelection, clearSelection,
            jumpToIndex, onDblClick,
            onSearchKeydown, onJumpKeydown, onPreviewWheel,
            escapeHtml, truncate, thumbnailUrl,
        };
    },

    template: `
    <div class="egv-root">
        <!-- 预览条 -->
        <div class="egv-preview" @wheel="onPreviewWheel">
            <div v-if="selectedItems.length === 0" class="egv-preview-empty">选中图片将显示在这里</div>
            <template v-for="sel in selectedItems" :key="sel.id">
                <div class="egv-preview-thumb">
                    <img :src="thumbnailUrl(sel.id)" :title="sel.name" @error="$event.target.style.display='none'" />
                    <div class="egv-preview-del" @click.stop="removeFromSelection(sel)">&times;</div>
                </div>
            </template>
            <button v-if="selectedItems.length > 0" class="egv-btn" style="flex-shrink:0;height:60px;align-self:center;margin-left:4px" @click.stop="clearSelection" title="清除全部">清除</button>
        </div>

        <!-- 工具栏 -->
        <div class="egv-toolbar">
            <input class="egv-search" type="text" placeholder="搜索关键词..." v-model="query" @keydown="onSearchKeydown" />
            <button class="egv-btn primary" @click="loadItems">&#128269; 搜索</button>
            <input class="egv-jump-input" type="number" placeholder="# 索引" title="输入数字跳转到对应索引（0起）" v-model="jumpIndex" @keydown="onJumpKeydown" />
            <button class="egv-btn" @click="jumpToIndex" title="跳转到指定索引">↗ 跳转</button>
            <span class="egv-badge">{{ totalText }}</span>
            <select class="egv-btn" style="min-width:120px" v-model="folderId" @change="loadItems">
                <option value="">&#128193; 全部文件夹</option>
                <option v-for="f in flatFolders" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
            <select class="egv-btn" style="min-width:80px" v-model="star" @change="loadItems">
                <option v-for="s in starOptions" :key="s" :value="s">{{ s === '全部' ? '⭐ 全部' : '⭐ ' + s }}</option>
            </select>
            <select class="egv-btn" style="min-width:80px" v-model="shape" @change="loadItems">
                <option v-for="s in shapeOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
            <button class="egv-btn" @click="sidebarVisible = !sidebarVisible" title="切换文件夹树">&#128194;</button>
            <button class="egv-btn" @click="showSettings = true" title="设置">&#9881;&#65039;</button>
        </div>

        <!-- 主体区域 -->
        <div class="egv-main">
            <!-- 文件夹树侧边栏 -->
            <div v-show="sidebarVisible" class="egv-sidebar">
                <template v-if="errorMsg && folders.length === 0">
                    <div class="egv-error" v-html="escapeHtml(errorMsg)"></div>
                </template>
                <template v-else-if="folders.length === 0">
                    <div class="egv-empty">加载中...</div>
                </template>
                <template v-else>
                    <folder-tree :folders="folders" :active-id="folderId" @select="id => { folderId = id; loadItems(); }"></folder-tree>
                </template>
            </div>

            <!-- 图片网格 -->
            <div class="egv-grid" ref="gridEl">
                <div v-if="loading" class="egv-loading">&#128260; 加载中...</div>
                <div v-else-if="errorMsg" class="egv-error">{{ errorMsg }}</div>
                <div v-else-if="items.length === 0" class="egv-empty">选择文件夹或输入关键词搜索</div>
                <template v-else>
                    <div v-for="(item, i) in items" :key="item.id"
                         class="egv-thumb" :class="{ selected: isSelected(item.id) }"
                         :data-id="item.id" :data-index="i"
                         @click="toggleSelect(item, i)"
                         @dblclick="onDblClick(item, i)">
                        <img :src="thumbnailUrl(item.id)" loading="lazy" :alt="item.name"
                             @error="onImgError($event, item)" />
                        <div class="egv-thumb-info">
                            <span>{{ item.tags && item.tags.length ? '&#127991; ' + item.tags.length : '' }}</span>
                            <span>{{ truncate(item.name, 12) }}</span>
                        </div>
                        <span class="egv-thumb-index">#{{ i }}</span>
                        <span v-if="item.star > 0" class="egv-thumb-star">{{ '&#9733;'.repeat(item.star) }}</span>
                        <span v-if="item.width && item.height" class="egv-thumb-res">{{ item.width }}x{{ item.height }}</span>
                    </div>
                </template>
            </div>
        </div>

        <!-- 页脚 -->
        <div class="egv-footer">
            <span class="egv-pageinfo">{{ totalText }}</span>
        </div>

        <!-- 设置弹窗 -->
        <div class="egv-settings-backdrop" :class="{ show: showSettings }" @click.self="showSettings = false">
            <div class="egv-settings-panel">
                <h3>设置</h3>
                <label>Eagle API URL</label>
                <input type="text" v-model="settingsUrl" placeholder="http://localhost:41595" @focus="$event.target.style.borderColor='#5a8fe0'" @blur="$event.target.style.borderColor='#444'" />
                <div class="egv-settings-hint">支持在 URL 末尾添加 <code>?token=xxx</code> 进行认证，如 <code>http://localhost:41595/?token=abc123</code></div>
                <div class="egv-settings-footer">
                    <a class="egv-settings-github" href="https://github.com/Yao3596/ComfyUI_Eagle_Suite" target="_blank" rel="noopener">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                        GitHub
                    </a>
                    <span class="egv-settings-author">Yao3596 / ComfyUI_Eagle_Suite</span>
                </div>
                <div class="egv-settings-row">
                    <button class="egv-btn" @click="showSettings = false">取消</button>
                    <button class="egv-btn primary" @click="saveSettings">保存</button>
                </div>
            </div>
        </div>
    </div>
    `,

    methods: {
        onImgError(event, item) {
            const img = event.target;
            const fallback = item.thumbnail || item.thumbnailPath || "";
            if (fallback && img.src !== fallback) {
                img.src = fallback;
            } else {
                img.style.display = "none";
            }
        },
    },
});

// ── 递归文件夹树子组件 ─────────────────────────────────────────────────────────
const FolderTree = defineComponent({
    name: "FolderTree",
    props: {
        folders: { type: Array, default: () => [] },
        activeId: { type: String, default: "" },
    },
    emits: ["select"],
    template: `
    <div>
        <div v-for="f in folders" :key="f.id">
            <div class="egv-folder-item" :class="{ active: activeId === f.id }" @click="$emit('select', f.id)">
                <span class="egv-folder-icon">{{ f.children && f.children.length ? '&#128194;' : '&#128193;' }}</span>
                {{ f.name || '未命名' }}
            </div>
            <div v-if="f.children && f.children.length" class="egv-folder-children">
                <folder-tree :folders="f.children" :active-id="activeId" @select="$emit('select', $event)"></folder-tree>
            </div>
        </div>
    </div>
    `,
});

// ── ComfyUI 扩展注册 ─────────────────────────────────────────────────────────
app.registerExtension({
    name: "EagleSuite.EagleGalleryVue",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "EagleGalleryVueNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.setSize([960, 720]);

            // 隐藏 selection_data 文本 widget
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
            setTimeout(() => {
                if (!hideSel(this)) setTimeout(() => hideSel(this), 500);
            }, 300);

            // ── 创建挂载容器（显式高度，让 Vue 能正确计算 flex 布局） ──
            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.height = "640px";   // 给 .egv-root 的 height:100% 一个明确参照
            container.style.minHeight = "400px";
            container.style.position = "relative";
            container.style.overflow = "hidden";

            const widget = this.addDOMWidget("eagle_gallery_vue", "div", container, { serialize: false });

            // 覆盖 computeSize，让 LiteGraph 给 widget 分配足够垂直空间
            widget.computeSize = function (width) {
                return [width, 640];
            };

            // ── 创建并挂载 Vue 应用 ──
            const vueApp = createApp(EagleGalleryVue);
            vueApp.component("FolderTree", FolderTree);
            // 通过 provide 注入 ComfyUI 节点引用（避免静态属性多实例冲突）
            vueApp.provide("comfyNode", this);
            const vm = vueApp.mount(container);

            // 保存 Vue 实例引用（清理用）
            this._vueApp = vueApp;
            this._vm = vm;

            // ── 节点缩放时同步更新容器尺寸 ──
            const onResize = this.onResize;
            this.onResize = function (size) {
                onResize?.apply(this, arguments);
                if (container) {
                    const newH = Math.max(400, size[1] - 80); // 减去标题栏+输出区约 80px
                    container.style.height = newH + "px";
                }
                // 同步更新 widget 的 computeSize，防止 LiteGraph 重新计算时压缩
                if (widget) {
                    const newH = Math.max(400, size[1] - 80);
                    widget.computeSize = function (width) {
                        return [width, newH];
                    };
                }
            };
        };

        // 节点删除时卸载 Vue，防止内存泄漏
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
