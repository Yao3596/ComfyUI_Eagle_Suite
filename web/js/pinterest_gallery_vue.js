/**
 * Pinterest Gallery Vue — Pinterest 图片浏览器节点（Vue 3 版本）
 *
 * 从 Vanilla JS (pinterest_gallery.js) 迁移到 Vue 3 Composition API + ESM 直引模式
 * CSS 前缀: pgv- (Pinterest Gallery Vue)
 * API 路径: 复用 /pinterest_gallery/* 系列路由
 *
 * 支持三种模式:
 *   1. 抓取模式（scrape）— 不需要 API Token，直接抓取 Pinterest 页面
 *   2. API 搜索模式（api_search）— 需要 Access Token，使用 Pinterest API v5
 *   3. API Boards 模式（api_boards）— 需要 Access Token，浏览用户 Board Pins
 */
import { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, defineComponent, inject } from "../lib/vue.esm-browser.js";
import { app } from "../../../scripts/app.js";

// ── 共享组件 ─────────────────────────────────────────────────────────────────
import { PreviewBar } from "../vue/gallery-common/components/PreviewBar.js";
import { ImageGrid } from "../vue/gallery-common/components/ImageGrid.js";
import { SettingsDialog } from "../vue/gallery-common/components/SettingsDialog.js";
import { FolderTree } from "../vue/gallery-common/components/FolderTree.js";
// ── 共享 composables ────────────────────────────────────────────────────────
import { useSelection } from "../vue/gallery-common/composables/useSelection.js";
import { useComfyNode } from "../vue/gallery-common/composables/useComfyNode.js";
import { useServerCache } from "../vue/gallery-common/composables/useServerCache.js";

// ── 常量 ─────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 24;

// ── Pinterest 品牌色覆盖样式（pgv- 前缀） ──────────────────────────────────
const CSS = `
:root {
    --gal-primary: #bd081c;
    --gal-primary-hover: #e60023;
    --gal-primary-active: #8a1a2a;
}
.pgv-root{display:flex;flex-direction:column;width:100%;height:640px;background:#1a1a1e;font-size:12px;color:#ddd;box-sizing:border-box;font-family:sans-serif;overflow:hidden}
.pgv-mode-bar{padding:4px 10px;background:#1e1e22;border-bottom:1px solid #2a2a2e;display:flex;gap:4px;align-items:center;flex-shrink:0}
.pgv-mode-bar .pgv-mode-label{color:#888;font-size:10px;margin-right:4px}
.pgv-header{padding:6px 10px;background:#25252a;border-bottom:1px solid #333;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pgv-search{flex:1;min-width:100px;padding:4px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;outline:none}
.pgv-search:focus{border-color:#bd081c}
.pgv-btn{padding:4px 10px;background:#333;border:1px solid #444;border-radius:4px;color:#ddd;font-size:11px;cursor:pointer;white-space:nowrap}
.pgv-btn:hover{background:#3a3a40}
.pgv-btn.primary{background:#bd081c;border-color:#bd081c;color:#fff}
.pgv-btn.primary:hover{background:#e60023}
.pgv-btn.active{background:#8a1a2a;border-color:#bd081c;color:#fff}
.pgv-btn.green{background:#2a6e3f;border-color:#2a6e3f;color:#fff}
.pgv-btn.green:hover{background:#3a8e4f}
.pgv-btn.green.active{background:#1a5e2f;border-color:#2a6e3f;color:#fff}
.pgv-main{flex:1;display:flex;overflow:hidden}
.pgv-sidebar{width:180px;background:#1e1e22;border-right:1px solid #333;overflow-y:auto;flex-shrink:0;padding:6px}
.pgv-sidebar::-webkit-scrollbar{width:4px}
.pgv-sidebar::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.pgv-footer{padding:5px 10px;background:#25252a;border-top:1px solid #333;display:flex;align-items:center;gap:8px;flex-shrink:0}
.pgv-pageinfo{flex:1;text-align:center;color:#888;font-size:11px}
select.pgv-btn{-webkit-appearance:none;-moz-appearance:none;appearance:none;background:#333 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath fill='%23aaa' d='M0 0h8L4 4z'/%3E%3C/svg%3E") no-repeat right 8px center;padding-right:22px}
`;

// ── 注入共享样式和品牌覆盖 ─────────────────────────────────────────────────
if (!document.getElementById("gal-gallery-theme")) {
    const linkEl = document.createElement("link");
    linkEl.id = "gal-gallery-theme";
    linkEl.rel = "stylesheet";
    linkEl.href = "/extensions/ComfyUI_Eagle_Suite/vue/gallery-common/styles/gallery-theme.css";
    document.head.appendChild(linkEl);
}

if (!document.getElementById("pgv-style")) {
    const styleEl = document.createElement("style");
    styleEl.id = "pgv-style";
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
}

// ── 辅助函数：获取 Pin 缩略图 URL ──────────────────────────────────────────
function getPinThumbUrl(item) {
    // 抓取模式数据已有 thumb_url / image_url 字段
    if (item.thumb_url) return item.thumb_url;
    // API v5 格式: media.images.{size}.url
    var images = item?.media?.images;
    if (images) {
        return images["236x"]?.url || images["170x"]?.url || images["150x150"]?.url ||
               images["600x"]?.url || images["400x300"]?.url || "";
    }
    // API v5 images 字段
    if (item?.images && typeof item.images === "object") {
        for (var size of ["236x", "170x", "150x150"]) {
            if (item.images[size]?.url) return item.images[size].url;
        }
    }
    return "";
}

// ── 辅助函数：获取 Pin 原图 URL ────────────────────────────────────────────
function getPinOriginalUrl(pin) {
    if (pin.image_url) return pin.image_url;
    var images = pin?.media?.images;
    if (!images) {
        images = pin?.images;
    }
    if (!images || typeof images !== "object") return "";
    return images["originals"]?.url || images["1200x"]?.url || images["736x"]?.url ||
           images["600x"]?.url || "";
}

// ── 辅助函数：获取 Pin 完整图片 URL（原图优先，回退缩略图） ───────────────
function getPinImageUrl(pin) {
    if (pin.image_url) return pin.image_url;
    var images = pin?.media?.images;
    if (!images) {
        images = pin?.images;
    }
    if (!images || typeof images !== "object") return "";
    return images["originals"]?.url || images["1200x"]?.url || images["736x"]?.url ||
           images["600x"]?.url || images["400x300"]?.url || "";
}

// ── 辅助函数：检查 Token 并加载 Boards ─────────────────────────────────────
async function checkAuthAndLoadBoards(token) {
    if (!token) return false;
    try {
        var res = await fetch("/pinterest_gallery/check_auth?token=" + encodeURIComponent(token));
        var data = await res.json();
        return data.success && data.valid;
    } catch (e) {
        return false;
    }
}

// ── 工具函数：HTML 转义 ─────────────────────────────────────────────────────
function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// ── Vue 主组件 ───────────────────────────────────────────────────────────────
const PinterestGalleryVue = defineComponent({
    name: "PinterestGalleryVue",
    components: {
        PreviewBar,
        ImageGrid,
        SettingsDialog,
        FolderTree,
    },

    setup() {
        // ── 共享 composables 初始化 ───────────────────────────────────
        const selectionComposable = useSelection();
        const comfyComposable = useComfyNode();
        const serverCache = useServerCache("/eagle_gallery/cache_selection");

        // ── 响应式状态 ──────────────────────────────────────────────
        const query = ref("");
        const mode = ref("scrape");          // "scrape" | "api_search" | "api_boards"
        const boardId = ref("");
        const boards = ref([]);
        const bookmark = ref("");
        const results = ref([]);
        const total = ref(0);
        const loading = ref(false);
        const errorMsg = ref("");
        const showSettings = ref(false);

        // ── Access Token 状态 ─────────────────────────────────────────
        const accessToken = ref(localStorage.getItem("pinterest_access_token") || "");

        // ── 设置弹窗字段定义 ─────────────────────────────────────────
        const settingsFields = reactive([{
            key: "access_token",
            label: "Access Token <span style='color:#666;font-size:10px'>(仅 API 模式需要)</span>",
            placeholder: "粘贴 Pinterest Access Token",
            type: "text",
            value: "",
            hint: "获取方法：developers.pinterest.com &rarr; Create app &rarr; 生成 Token<br>抓取模式无需 Token，直接搜索或粘贴 URL 即可",
        }]);

        // ── 计算属性 ────────────────────────────────────────────────
        const totalText = computed(() => "已加载 " + results.value.length + " 个");

        /** 是否有更多数据可加载 */
        const hasMore = computed(() => !!bookmark.value);

        /** 是否显示侧边栏（仅在 api_boards 模式下显示 Board 列表） */
        const sidebarVisible = computed(() => mode.value === "api_boards");

        /** 搜索框占位文字 */
        const searchPlaceholder = computed(function () {
            if (mode.value === "scrape") {
                return "搜索关键词或粘贴 Pinterest URL...";
            }
            return "搜索 Pinterest...";
        });

        /** 网格空状态提示文本 */
        const emptyText = computed(function () {
            return "输入关键词或粘贴 Pinterest URL";
        });

        /** 预览条缩略图 URL 函数 */
        function thumbPreviewUrlFn(item) {
            if (item.thumb_url) {
                return "/pinterest_gallery/image_proxy?url=" + encodeURIComponent(item.thumb_url);
            }
            return "";
        }

        /** 网格缩略图 URL 函数（通过代理加载） */
        function thumbGridUrlFn(item) {
            var url = getPinThumbUrl(item);
            if (url) {
                return "/pinterest_gallery/image_proxy?url=" + encodeURIComponent(url);
            }
            // 回退到原图代理
            var origUrl = getPinOriginalUrl(item);
            if (origUrl) {
                return "/pinterest_gallery/image_proxy?url=" + encodeURIComponent(origUrl);
            }
            return "";
        }

        /** 将 Boards 数据转换为 FolderTree 的扁平格式（Board 无子节点） */
        const flatBoards = computed(function () {
            return boards.value.map(function (b) {
                return { id: b.id, name: b.name || "未命名" };
            });
        });

        // ── 搜索 / 加载方法 ─────────────────────────────────────────

        /**
         * 统一搜索入口 — 根据当前模式分发到对应的搜索函数
         */
        async function doSearch() {
            if (loading.value) return;

            var q = query.value.trim();

            if (mode.value === "scrape") {
                await scrapeSearch(q);
            } else if (mode.value === "api_search") {
                await apiSearchPins(q);
            } else if (mode.value === "api_boards") {
                if (boardId.value) {
                    await loadBoardPins(boardId.value);
                } else {
                    await loadBoards();
                }
            }
        }

        /**
         * 抓取模式搜索
         * 支持 URL（粘贴 Pinterest URL）或关键词搜索
         */
        async function scrapeSearch(q) {
            if (loading.value) return;
            if (!q) {
                errorMsg.value = "请输入搜索关键词或 Pinterest URL";
                results.value = [];
                return;
            }

            loading.value = true;
            errorMsg.value = "";

            try {
                var params = new URLSearchParams();
                // 判断是 URL 还是关键词
                if (/^https?:\/\//i.test(q)) {
                    params.set("url", q);
                } else {
                    params.set("q", q);
                }

                var res = await fetch("/pinterest_gallery/scrape?" + params.toString());
                var data = await res.json();

                if (data.success && data.items && data.items.length > 0) {
                    results.value = data.items;
                    total.value = data.total || data.items.length;
                    bookmark.value = data.bookmark || "";
                } else {
                    var errMsg = data.error || "未找到图片";
                    errorMsg.value = escapeHtml(errMsg);
                    results.value = [];
                    bookmark.value = "";
                }
            } catch (e) {
                errorMsg.value = "请求失败: " + e.message;
                results.value = [];
                bookmark.value = "";
            } finally {
                loading.value = false;
            }
        }

        /**
         * API v5 搜索 Pins
         * 需要 Access Token
         */
        async function apiSearchPins(q) {
            if (loading.value) return;
            loading.value = true;
            errorMsg.value = "";

            // 新搜索时清空结果
            if (!bookmark.value) {
                results.value = [];
            }

            try {
                var token = localStorage.getItem("pinterest_access_token") || "";
                if (!token) {
                    errorMsg.value = "API 模式需要 Access Token，请在设置中配置<br><br><span style=\"color:#888\">或切换到抓取模式无需 Token</span>";
                    loading.value = false;
                    return;
                }

                var params = new URLSearchParams({
                    q: q || query.value.trim(),
                    page_size: String(PAGE_SIZE),
                });
                if (bookmark.value) {
                    params.set("bookmark", bookmark.value);
                }
                if (token) {
                    params.set("token", token);
                }

                var res = await fetch("/pinterest_gallery/search?" + params.toString());
                var data = await res.json();

                if (data.items) {
                    if (!bookmark.value) {
                        results.value = [];
                    }
                    results.value = results.value.concat(data.items);
                    bookmark.value = data.bookmark || "";
                } else if (data.auth_error) {
                    errorMsg.value = "Access Token 无效，请在设置中更新";
                } else {
                    errorMsg.value = "搜索失败: " + (data.error || "未知错误");
                }
            } catch (e) {
                errorMsg.value = "请求失败: " + e.message;
            } finally {
                loading.value = false;
            }
        }

        /**
         * 加载用户 Boards 列表（API）
         */
        async function loadBoards() {
            var token = localStorage.getItem("pinterest_access_token") || "";
            if (!token) {
                boards.value = [];
                errorMsg.value = "请先在设置中输入 Access Token";
                return;
            }

            loading.value = true;
            errorMsg.value = "";

            try {
                var res = await fetch("/pinterest_gallery/boards?token=" + encodeURIComponent(token));
                var data = await res.json();
                if (data.items) {
                    boards.value = data.items;
                } else if (data.auth_error) {
                    errorMsg.value = "Token 无效，请重新设置";
                } else {
                    errorMsg.value = "加载 Boards 失败";
                }
            } catch (e) {
                errorMsg.value = "请求失败: " + e.message;
            } finally {
                loading.value = false;
            }
        }

        /**
         * 加载指定 Board 的 Pins（API）
         */
        async function loadBoardPins(bid) {
            if (loading.value) return;
            if (!bid) return;

            loading.value = true;
            errorMsg.value = "";

            // 新加载时清空结果
            if (!bookmark.value) {
                results.value = [];
            }

            try {
                var token = localStorage.getItem("pinterest_access_token") || "";
                var params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
                if (bookmark.value) {
                    params.set("bookmark", bookmark.value);
                }
                if (token) {
                    params.set("token", token);
                }

                var res = await fetch("/pinterest_gallery/boards/" + encodeURIComponent(bid) + "/pins?" + params.toString());
                var data = await res.json();

                if (data.items) {
                    if (!bookmark.value) {
                        results.value = [];
                    }
                    results.value = results.value.concat(data.items);
                    bookmark.value = data.bookmark || "";
                } else {
                    errorMsg.value = "加载失败: " + (data.error || "未知错误");
                }
            } catch (e) {
                errorMsg.value = "请求失败: " + e.message;
            } finally {
                loading.value = false;
            }
        }

        // ── 模式切换 ────────────────────────────────────────────────
        function setMode(newMode) {
            mode.value = newMode;
            // 切换时重置分页和选择
            bookmark.value = "";
            results.value = [];
            boardId.value = "";
            errorMsg.value = "";
        }

        /**
         * 切换到 API Boards 模式时自动加载 Boards
         */
        function setApiBoardsMode() {
            mode.value = "api_boards";
            bookmark.value = "";
            results.value = [];
            boardId.value = "";
            errorMsg.value = "";
            // 如果已有 Token 且 Boards 为空，自动加载
            var token = localStorage.getItem("pinterest_access_token") || "";
            if (token && boards.value.length === 0) {
                loadBoards();
            }
        }

        // ── 选择管理事件处理 ────────────────────────────────────────

        /**
         * 网格点击选中/取消
         */
        function onGridSelect(payload) {
            var item = payload.item;
            var index = payload.index;
            var itemId = item.id;
            var title = item.title || "";
            var description = item.description || "";
            var thumbUrl = getPinThumbUrl(item);
            var origUrl = getPinOriginalUrl(item);

            if (selectionComposable.isSelected(itemId)) {
                // 取消选中
                selectionComposable.removeFromSelection({ id: itemId });
            } else {
                // 选中 — 构建 Pinterest 格式的选择数据
                selectionComposable.selectedItems.value = [
                    ...selectionComposable.selectedItems.value,
                    {
                        id: itemId,
                        image_url: origUrl || thumbUrl || "",
                        thumb_url: thumbUrl || origUrl || "",
                        title: title,
                        description: description,
                        pin_id: itemId,
                        tags: title + (description ? ", " + description : ""),
                    },
                ];
            }

            confirmSelectionData();
        }

        /**
         * 网格双击
         */
        function onGridDblClick(payload) {
            var item = payload.item;
            // 双击时如果未选中则先选中
            if (!selectionComposable.isSelected(item.id)) {
                onGridSelect(payload);
            }
        }

        /**
         * 预览条删除单个选中项
         */
        function removeFromSelection(selItem) {
            selectionComposable.removeFromSelection(selItem);
            confirmSelectionData();
        }

        /**
         * 清除全部选中
         */
        function clearSelection() {
            selectionComposable.clearSelection();
            confirmSelectionData();
        }

        // ── 确认选择并提交到 ComfyUI 节点 ────────────────────────────
        async function confirmSelectionData() {
            var node = comfyComposable.comfyNode;
            if (!node) return;

            // Pinterest 格式的 selections 数据
            var selections = selectionComposable.selectedItems.value.map(function (s) {
                return {
                    id: s.id,
                    image_url: s.image_url,
                    thumb_url: s.thumb_url,
                    title: s.title,
                    description: s.description,
                    pin_id: s.pin_id,
                    tags: s.tags,
                };
            });

            var selectionJson = JSON.stringify({ selections: selections });

            // 写入 ComfyUI widget、input 和内部属性
            var widget = node.widgets ? node.widgets.find(function (w) { return w.name === "selection_data"; }) : null;
            if (widget) {
                widget.value = selectionJson;
            }

            var input = node.inputs ? node.inputs.find(function (inp) { return inp.name === "selection_data"; }) : null;
            if (input) {
                input.value = selectionJson;
            }

            node._selection_data = selectionJson;

            // POST 到服务端缓存（与 Eagle 共享端点）
            await serverCache.postSelection({
                node_id: node.id,
                selection_data: selectionJson,
            });

            node.setDirtyCanvas(true, true);
            if (node.graph) {
                node.graph.change();
            }
        }

        // ── 设置弹窗 ────────────────────────────────────────────────

        /** 打开设置弹窗前加载当前值 */
        function openSettings() {
            showSettings.value = true;
            // 同步当前 Token 到设置字段
            var savedToken = localStorage.getItem("pinterest_access_token") || "";
            settingsFields[0].value = savedToken;

            // 如果本地没有但后端可能有，尝试从后端获取脱敏信息
            if (!savedToken) {
                fetch("/pinterest_gallery/settings")
                    .then(function (r) { return r.json(); })
                    .then(function (d) {
                        if (d.success && d.settings && d.settings.access_token) {
                            settingsFields[0].value = ""; // 不显示实际值
                            settingsFields[0].placeholder = "已保存 Token（后端）";
                        }
                    })
                    .catch(function () {});
            }
        }

        /** 保存设置 */
        async function onSaveSettings(data) {
            var token = (data.access_token || "").trim();
            if (token) {
                localStorage.setItem("pinterest_access_token", token);
                accessToken.value = token;
            } else {
                localStorage.removeItem("pinterest_access_token");
                accessToken.value = "";
            }

            // 同步到后端
            try {
                await fetch("/pinterest_gallery/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ access_token: token }),
                });
            } catch (e) { /* 静默失败 */ }

            showSettings.value = false;

            // 如果有新 Token 且在 api_boards 模式，自动检查有效性并加载 Boards
            if (token && mode.value === "api_boards") {
                var valid = await checkAuthAndLoadBoards(token);
                if (valid) {
                    loadBoards();
                }
            }
        }

        // ── Board 选择事件 ─────────────────────────────────────────
        function onBoardSelect(boardIdValue) {
            boardId.value = boardIdValue;
            bookmark.value = "";
            results.value = [];
            errorMsg.value = "";
            if (boardIdValue) {
                loadBoardPins(boardIdValue);
            }
        }

        // ── 搜索快捷键 ────────────────────────────────────────────
        function onSearchKeydown(e) {
            if (e.key === "Enter") {
                bookmark.value = ""; // 重置分页
                doSearch();
            }
        }

        // ── 生命周期 ──────────────────────────────────────────────
        onMounted(function () {
            // 自动加载 Pinterest 首页
            setTimeout(function () {
                query.value = "https://www.pinterest.com/";
                scrapeSearch("https://www.pinterest.com/");
            }, 600);
        });

        onBeforeUnmount(function () {
            // 清理逻辑（如需要）
        });

        // ── 返回模板绑定数据 ───────────────────────────────────────
        return {
            // 状态
            query, mode, boardId, boards, results, total, loading, errorMsg,
            showSettings, settingsFields, accessToken,

            // 计算属性
            totalText, hasMore, sidebarVisible, searchPlaceholder, emptyText,
            flatBoards, thumbPreviewUrlFn, thumbGridUrlFn,

            // 选择相关（来自 composable）
            selectedItems: selectionComposable.selectedItems,
            selectedIds: selectionComposable.selectedIds,
            isSelected: selectionComposable.isSelected,

            // 方法
            doSearch, setMode, setApiBoardsMode,
            onGridSelect, onGridDblClick,
            removeFromSelection, clearSelection,
            openSettings, onSaveSettings,
            onBoardSelect, onSearchKeydown,
            escapeHtml,
        };
    },

    template: `
    <div class="pgv-root gal-root">
        <!-- ══ 预览条 ══ -->
        <PreviewBar :selected-items="selectedItems"
                     :thumbnail-url-fn="thumbPreviewUrlFn"
                     @remove="removeFromSelection" @clear="clearSelection" />

        <!-- ══ 模式切换栏 ══ -->
        <div class="pgv-mode-bar">
            <span class="pgv-mode-label">模式:</span>
            <button class="pgv-btn green" :class="{ active: mode === 'scrape' }"
                    @click="setMode('scrape')" title="抓取模式 - 无需 Token">&#127760; 抓取</button>
            <button class="pgv-btn" :class="{ active: mode === 'api_search' }"
                    @click="setMode('api_search')" title="API 搜索模式 - 需要 Token">&#128269; API 搜索</button>
            <button class="pgv-btn" :class="{ active: mode === 'api_boards' }"
                    @click="setApiBoardsMode()" title="API Boards 模式 - 需要 Token">&#128247; API Boards</button>
        </div>

        <!-- ══ 工具栏 ══ -->
        <div class="pgv-header">
            <input class="pgv-search" type="text" v-model="query"
                   :placeholder="searchPlaceholder" @keydown="onSearchKeydown" />
            <button class="pgv-btn primary" @click="doSearch">&#128269; 搜索</button>

            <!-- Board 下拉选择器（仅 api_boards 模式可见） -->
            <select v-show="sidebarVisible" class="pgv-btn" v-model="boardId"
                    @change="onBoardSelect(boardId)" style="min-width:120px">
                <option value="">选择 Board...</option>
                <option v-for="b in flatBoards" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>

            <!-- 设置按钮 -->
            <button class="pgv-btn" @click="openSettings" title="设置 Access Token">&#9881;&#65039;</button>
        </div>

        <!-- ══ 主体区域 ══ -->
        <div class="pgv-main gal-main">
            <!-- Board 列表侧边栏（仅 api_boards 模式显示） -->
            <div v-show="sidebarVisible" class="pgv-sidebar gal-sidebar">
                <template v-if="errorMsg && boards.length === 0">
                    <div class="gal-error" v-html="errorMsg"></div>
                </template>
                <template v-else-if="loading && boards.length === 0">
                    <div class="gal-loading">加载中...</div>
                </template>
                <template v-else-if="boards.length === 0">
                    <div class="gal-empty">登录后查看 Boards</div>
                </template>
                <template v-else>
                    <!-- 使用 FolderTree 组件以 flat 模式显示 Board 列表（每个 Board 无 children） -->
                    <FolderTree :folders="flatBoards" :active-id="boardId"
                                item-class="gal-sidebar-item" iconFolder="&#128193;"
                                @select="onBoardSelect($event)">
                    </FolderTree>
                </template>
            </div>

            <!-- 图片网格 -->
            <ImageGrid :items="results" :selected-ids="selectedIds"
                       :loading="loading" :error-msg="errorMsg"
                       :thumbnail-url-fn="thumbGridUrlFn"
                       :show-index="false"
                       :empty-text="emptyText"
                       @select="onGridSelect" @dblclick="onGridDblClick" />
        </div>

        <!-- ══ 页脚（加载更多按钮） ══ -->
        <div class="pgv-footer gal-footer">
            <span class="pgv-pageinfo">{{ totalText }}</span>
            <button class="pgv-btn" :disabled="!hasMore || loading"
                    @click="doSearch">
                {{ hasMore ? '&#128260; 加载更多' : '已到底部' }}
            </button>
        </div>

        <!-- ══ 设置弹窗 ══ -->
        <SettingsDialog :visible="showSettings" @update:visible="showSettings = $event"
                         title="Pinterest 设置" :fields="settingsFields" @save="onSaveSettings" />
    </div>
    `,
});

// ── ComfyUI 扩展注册 ─────────────────────────────────────────────────────────
app.registerExtension({
    name: "EagleSuite.PinterestGalleryVue",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PinterestGalleryNode") return;

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

            // ── 创建挂载容器 ──
            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.height = "640px";
            container.style.maxHeight = "640px";
            container.style.minHeight = "400px";
            container.style.position = "relative";
            container.style.overflow = "hidden";

            const widget = this.addDOMWidget("pinterest_gallery_vue", "div", container, { serialize: false });
            widget.computeSize = function (width) {
                return [width, 640];
            };

            // ── 创建并挂载 Vue 应用 ──
            const vueApp = createApp(PinterestGalleryVue);
            vueApp.component("PreviewBar", PreviewBar);
            vueApp.component("ImageGrid", ImageGrid);
            vueApp.component("SettingsDialog", SettingsDialog);
            vueApp.component("FolderTree", FolderTree);
            vueApp.provide("comfyNode", this);
            const vm = vueApp.mount(container);

            this._vueApp = vueApp;
            this._vm = vm;

            // ── 节点缩放时同步更新容器尺寸 ──
            const onResize = this.onResize;
            this.onResize = function (size) {
                onResize?.apply(this, arguments);
                // 限制最大高度，防止节点无限拉伸撑满屏幕
                const maxHeight = 640;
                const newH = Math.min(Math.max(400, size[1] - 80), maxHeight);
                if (container) {
                    container.style.height = newH + "px";
                }
                if (widget) {
                    widget.computeSize = function (width) {
                        return [width, newH];
                    };
                }
                // 同步更新内部 root 高度
                const rootEl = container.querySelector(".pgv-root");
                if (rootEl) {
                    rootEl.style.height = newH + "px";
                }
                // 同步更新侧边栏最大高度
                const sidebarEl = container.querySelector(".pgv-sidebar");
                if (sidebarEl) {
                    sidebarEl.style.maxHeight = (newH - 100) + "px";
                }
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
