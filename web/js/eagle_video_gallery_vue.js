/**
 * Eagle Video Gallery - Eagle 视频浏览器节点
 * 基于 Eagle Gallery Vue 组件，适配视频文件浏览
 */
import { app } from "../../../scripts/app.js";
import { createApp, ref, reactive, onMounted, watch, computed } from "../lib/vue.esm-browser.js";
import { 
    FolderTree, 
    DropdownFilter, 
    ImageGrid, 
    PreviewBar, 
    SettingsDialog,
    useComfyNode,
    useSelection
} from "../vue/gallery-common/index.js";

// --- CSS 样式 ---
const CSS = `
.egv-vue-root { width: 100%; height: 100%; display: flex; flex-direction: column; background: #1a1a1e; color: #ddd; font-family: sans-serif; overflow: hidden; }
.egv-layout { flex: 1; display: flex; overflow: hidden; min-height: 0; min-width: 0; }
.egv-sidebar { width: 220px; border-right: 1px solid #333; overflow-y: auto; background: #1e1e22; flex-shrink: 0; }
.egv-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; min-width: 0; }
.egv-filter-bar { padding: 6px 12px; background: #25252a; border-bottom: 1px solid #333; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.egv-search-input { flex: 1; min-width: 150px; background: #1a1a1e; border: 1px solid #444; color: #eee; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
.egv-search-input:focus { border-color: #4a7de0; outline: none; }
.egv-header { flex-shrink: 0; }
.egv-v-separator { width: 1px; height: 20px; background: #444; margin: 0 4px; }
.egv-mode-controls { display: flex; gap: 4px; align-items: center; }
.egv-select { background: #1a1a1e; border: 1px solid #444; color: #eee; padding: 2px 4px; border-radius: 4px; font-size: 11px; cursor: pointer; }
.egv-select:focus { border-color: #4a7de0; outline: none; }
.egv-btn { background: #333; border: 1px solid #444; color: #eee; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: background 0.2s; }
.egv-btn:hover { background: #444; }
.egv-video-badge { position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,.75); color: #4a9eff; font-size: 9px; padding: 1px 5px; border-radius: 3px; z-index: 2; display: flex; align-items: center; gap: 3px; }
.egv-video-badge::before { content: "▶"; font-size: 8px; }
.egv-duration { position: absolute; bottom: 4px; left: 4px; background: rgba(0,0,0,.75); color: #ccc; font-size: 9px; padding: 1px 4px; border-radius: 3px; z-index: 2; }
/* 适配已有的 Common 样式 */
.gal-sidebar-toggle { cursor: pointer; padding: 0 4px; color: #666; transition: color 0.2s; }
.gal-sidebar-toggle:hover { color: #aaa; }
.gal-sidebar-children { padding-left: 12px; }
.gal-sidebar-item { padding: 4px 8px; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 6px; font-size: 11px; color: #999; }
.gal-sidebar-item:hover { background: #2a2a30; color: #ddd; }
.gal-sidebar-item.active { background: #2a4a8a; color: #fff; }
`;

// --- Vue 主组件 ---
const EagleVideoGalleryApp = {
    props: ["node"],
    components: { FolderTree, DropdownFilter, ImageGrid, PreviewBar, SettingsDialog },
    setup(props) {
        // 修复：useSelection() 实际返回的是 selectedItems / isSelected /
        // toggleSelect / removeFromSelection / clearSelection，之前解构的
        // selection / addSelection / removeSelection 这几个名字根本不存在，
        // 用到的地方全部会因为访问 undefined.value 报错。
        const { selectedItems, selectedIds, isSelected, toggleSelect, removeFromSelection, clearSelection } = useSelection();
        // useComfyNode() 靠 inject("comfyNode") 拿节点实例，必须在 mount 时
        // 用 vueApp.provide("comfyNode", node) 注入才有效（下面注册处已修）。
        const { confirmSelection: sendSelectionToNode } = useComfyNode();

        // 状态定义
        const folders = ref([]);
        const items = ref([]);
        const total = ref(0);
        const loading = ref(false);
        const searchQuery = ref("");
        const selectedFolderId = ref("");
        
        // 筛选器状态
        const filters = reactive({
            star: "",
            shape: "",
            tags: [],
            colors: []
        });

        // 输出模式与顺序设置
        const outputSettings = reactive({
            outputMode: "selection",
            sequenceMode: "all_at_once",
            sequenceIndex: 0
        });

        // 筛选器选项
        const filterOptions = reactive({
            stars: [
                { value: "", label: "⭐ 全部评分" },
                { value: "0", label: "未评分" },
                { value: "1", label: "1 星" },
                { value: "2", label: "2 星" },
                { value: "3", label: "3 星" },
                { value: "4", label: "4 星" },
                { value: "5", label: "5 星" }
            ],
            shapes: [
                { value: "", label: "📐 全部形状" },
                { value: "landscape", label: "▬ 横向" },
                { value: "portrait", label: "▮ 纵向" },
                { value: "square", label: "■ 方形" }
            ],
            tags: [],
            colors: [
                { value: "BB0000", label: "🔴 红色" }, { value: "BB5500", label: "🟠 橙色" },
                { value: "BBBB00", label: "🟡 黄色" }, { value: "00BB00", label: "🟢 绿色" },
                { value: "00BBBB", label: "🔵 青色" }, { value: "0000BB", label: "🔵 蓝色" },
                { value: "5500BB", label: "🟣 紫色" }, { value: "BB00BB", label: "🟣 品红" },
                { value: "000000", label: "⬛ 黑色" }, { value: "FFFFFF", label: "⬜ 白色" },
                { value: "888888", label: "🔘 灰色" }
            ]
        });

        const isSettingsOpen = ref(false);
        const openDropdown = ref("");
        const eagleUrl = ref("");

        // SettingsDialog 是通用组件，需要父组件自己提供字段定义和保存逻辑，
        // 它本身不知道 /eagle_video_gallery/settings 这个接口。
        const settingsFields = computed(() => [
            { key: "eagle_url", label: "Eagle 服务地址", type: "text",
              placeholder: "http://localhost:41595", value: eagleUrl.value,
              hint: "在 Eagle App 设置里开启 API 后，把带 token 的地址粘贴到这里" }
        ]);

        function loadSettings() {
            fetch("/eagle_video_gallery/settings").then(function(r) { return r.json(); })
                .then(function(d) { if (d.success && d.settings) eagleUrl.value = d.settings.eagle_url || ""; })
                .catch(function() {});
        }

        function handleSaveSettings(data) {
            fetch("/eagle_video_gallery/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eagle_url: data.eagle_url })
            }).then(function(r) { return r.json(); }).then(function(d) {
                if (d.success) { eagleUrl.value = data.eagle_url; isSettingsOpen.value = false; loadFolders(); loadItems(); }
            }).catch(function() {});
        }

        // 数据加载
        const loadFolders = async () => {
            try {
                const res = await fetch("/eagle_video_gallery/folders");
                const data = await res.json();
                if (data.success) folders.value = data.folders || [];
            } catch (e) { console.error("Load folders failed", e); }
        };

        const loadTags = async () => {
            try {
                const res = await fetch("/eagle_video_gallery/tags");
                const data = await res.json();
                if (data.success) filterOptions.tags = data.tags || [];
            } catch (e) { console.error("Load tags failed", e); }
        };

        const loadItems = async () => {
            if (loading.value) return;
            loading.value = true;
            try {
                const payload = {
                    folderId: selectedFolderId.value,
                    keywords: searchQuery.value,
                    star: filters.star,
                    shape: filters.shape,
                    tags: filters.tags,
                    colors: filters.colors.join(","),
                    all: true
                };
                const res = await fetch("/eagle_video_gallery/items", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success) {
                    items.value = data.items || [];
                    total.value = data.total || 0;
                }
            } catch (e) { console.error("Load items failed", e); }
            finally { loading.value = false; }
        };

        // 同步状态到 ComfyUI 节点
        const syncToNode = () => {
            const node = props.node;
            if (!node) return;

            // 1. 更新 selection_data widget (隐藏的 JSON)
            const selWidget = node.widgets?.find(x => x.name === "selection_data");
            if (selWidget) {
                selWidget.value = JSON.stringify({
                    selections: selectedItems.value,
                    outputMode: outputSettings.outputMode,
                    folderId: selectedFolderId.value
                });
            }

            // 2. 更新 sequence_mode widget
            const modeWidget = node.widgets?.find(x => x.name === "sequence_mode");
            if (modeWidget) {
                modeWidget.value = outputSettings.sequenceMode;
            }

            // 3. 更新缓存到后端 (cache_selection 路由)
            fetch("/eagle_video_gallery/cache_selection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    selections: selectedItems.value,
                    outputMode: outputSettings.outputMode,
                    folderId: selectedFolderId.value
                })
            }).catch(err => console.error("Cache selection failed", err));
            
            // 修复：useComfyNode().confirmSelection 的真实签名是 (data)，
            // 内部靠 inject("comfyNode") 拿节点实例，不是 (node, data)。
            // 前面 syncToNode 已经手动把 selection_data widget 写好了，这里
            // 再调用一次是为了同时触发 node.setDirtyCanvas / graph.change()。
            sendSelectionToNode({
                selections: selectedItems.value,
                outputMode: outputSettings.outputMode,
                folderId: selectedFolderId.value
            });
        };

        // 监听变化自动加载
        watch([selectedFolderId, () => filters.star, () => filters.shape, () => filters.tags, () => filters.colors], () => {
            loadItems();
        });

        // 监听选中项变化同步到节点
        watch([selectedItems, () => outputSettings.outputMode, () => outputSettings.sequenceMode], () => {
            syncToNode();
        }, { deep: true });

        onMounted(() => {
            loadSettings();
            loadFolders();
            loadTags();
            loadItems();
            
            // 初始化从节点恢复状态
            if (props.node?.widgets) {
                const modeWidget = props.node.widgets.find(x => x.name === "sequence_mode");
                if (modeWidget) outputSettings.sequenceMode = modeWidget.value || "all_at_once";
            }
        });

        // 事件处理
        const handleSelectFolder = (id) => {
            selectedFolderId.value = id;
        };

        const onVideoClick = (item) => {
            // 修复：原来用的 selection.value.has(id) / addSelection / removeSelection
            // 都是不存在的 API，点击视频卡片时会直接抛 TypeError。
            // useSelection() 真实暴露的是 toggleSelect(item)。
            toggleSelect({
                id: item.id,
                name: item.name,
                filePath: item.filePath,
                width: item.width,
                height: item.height,
                ext: item.ext,
                tags: item.tags || []
            });
        };

        return {
            folders, items, total, loading, searchQuery, selectedFolderId,
            filters, filterOptions, isSettingsOpen, openDropdown,
            selectedItems, selectedIds, isSelected, outputSettings,
            handleSelectFolder, onVideoClick, clearSelection, loadItems,
            settingsFields, handleSaveSettings,
        };
    },
    template: `
    <div class="egv-vue-root" @click="openDropdown = ''">
        <!-- 预览条 -->
        <PreviewBar :selected-items="selectedItems" :thumbnail-url-fn="item => '/eagle_video_gallery/thumbnail?id=' + item.id"
                    @remove="onVideoClick" @clear="clearSelection" />

        <!-- 工具栏与筛选器 -->
        <div class="egv-header">
            <div class="egv-filter-bar">
                <input type="text" class="egv-search-input" v-model="searchQuery" 
                       placeholder="搜索视频关键字 (Enter)..." @keydown.enter="loadItems">
                
                <DropdownFilter label="评分" :options="filterOptions.stars" v-model="filters.star" 
                                :multiple="false" :is-open="openDropdown === 'star'" 
                                @update:is-open="openDropdown = $event ? 'star' : ''" />

                <DropdownFilter label="形状" :options="filterOptions.shapes" v-model="filters.shape" 
                                :multiple="false" :is-open="openDropdown === 'shape'" 
                                @update:is-open="openDropdown = $event ? 'shape' : ''" />

                <DropdownFilter label="标签" :options="filterOptions.tags" v-model="filters.tags" 
                                :multiple="true" :searchable="true" :is-open="openDropdown === 'tags'" 
                                @update:is-open="openDropdown = $event ? 'tags' : ''" />

                <DropdownFilter label="颜色" :options="filterOptions.colors" v-model="filters.colors" 
                                :multiple="true" :is-open="openDropdown === 'colors'" 
                                @update:is-open="openDropdown = $event ? 'colors' : ''" />

                <div class="egv-v-separator"></div>

                <!-- 输出模式控制 -->
                <div class="egv-mode-controls">
                    <select class="egv-select" v-model="outputSettings.outputMode">
                        <option value="selection">输出选中</option>
                        <option value="folder">输出文件夹</option>
                    </select>
                    <select class="egv-select" v-model="outputSettings.sequenceMode">
                        <option value="all_at_once">批量 (Batch)</option>
                        <option value="sequential">顺序 (Index)</option>
                    </select>
                </div>

                <button class="egv-btn" @click="loadItems">🔄 刷新</button>
                <button class="egv-btn" @click="isSettingsOpen = true">⚙️</button>
            </div>
        </div>

        <div class="egv-layout">
            <!-- 侧边栏：可折叠文件夹树 -->
            <div class="egv-sidebar">
                <FolderTree :folders="folders" :active-id="selectedFolderId" @select="handleSelectFolder" />
            </div>

            <!-- 主内容：网格 -->
            <div class="egv-content">
                <ImageGrid :items="items" :selected-ids="selectedIds" :loading="loading"
                           :thumbnail-url-fn="item => '/eagle_video_gallery/thumbnail?id=' + item.id"
                           @select="({item}) => onVideoClick(item)" />
                
                <div style="padding:4px 10px; font-size:10px; color:#666; border-top:1px solid #333;">
                    共 {{ total }} 个视频 | 选中 {{ selectedItems.length }} 个
                </div>
            </div>
        </div>

        <SettingsDialog :visible="isSettingsOpen" title="Eagle 视频画廊设置"
                        :fields="settingsFields"
                        @update:visible="isSettingsOpen = $event"
                        @save="handleSaveSettings" />
    </div>
    `
};

app.registerExtension({
    name: "EagleSuite.EagleVideoGalleryVue",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "EagleVideoGalleryNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            if (this._egvInit) return; // 防止重复初始化
            this._egvInit = true;

            this.setSize([1000, 750]);

            // 隐藏 selection_data
            const hideWidget = (name) => {
                const w = this.widgets?.find(x => x.name === name);
                if (w) {
                    w.type = "hidden";
                    w.computeSize = () => [0, -4];
                }
            };
            setTimeout(() => hideWidget("selection_data"), 100);

            // 修复：ImageGrid/FolderTree/PreviewBar 等共享组件的模板里全是
            // .gal-grid / .gal-thumb 这些 class，但这份主题表 gallery-theme.css
            // 从来没被任何文件加载过——导致每个视频缩略图都是原始分辨率、无固定
            // 尺寸的裸元素，一张接一张往下堆，内容高度能涨到几万像素。这才是
            // "节点无限往下长"的根本原因（比 DOM widget 高度计算那层更底层）。
            // <link> 的相对路径是相对当前页面 URL 解析的，不是相对这个 JS 文件，
            // 所以要用 import.meta.url 换算出正确的绝对地址。
            if (!document.getElementById("gal-theme-style")) {
                const link = document.createElement("link");
                link.id = "gal-theme-style";
                link.rel = "stylesheet";
                link.href = new URL("../vue/gallery-common/styles/gallery-theme.css", import.meta.url).href;
                document.head.appendChild(link);
            }

            // 注入 CSS
            if (!document.getElementById("egv-vue-style")) {
                const style = document.createElement("style");
                style.id = "egv-vue-style";
                style.textContent = CSS;
                document.head.appendChild(style);
            }

            // 挂载 Vue App
            // 修复：不能用 height:100%——相对未定高的父容器在浏览器里会失效，
            // 内容多高容器就撑多高，节点会"无限往下增高"（和 eagle_gallery.js
            // 里踩过的坑一样）。改成 widget.computeSize + onResize 定死像素高度。
            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.boxSizing = "border-box";
            container.style.overflow = "hidden";

            const widget = this.addDOMWidget("eagle_video_gallery_vue", "div", container, { serialize: false });

            const applyHeight = (nodeHeight) => {
                const h = Math.max(400, nodeHeight - 180);
                container.style.height = h + "px";
                widget.computeSize = (w) => [w, h];
                return h;
            };
            applyHeight(this.size[1]);

            const vueApp = createApp(EagleVideoGalleryApp, { node: this });
            // 修复：useComfyNode() 内部用 inject("comfyNode") 拿节点实例，
            // 之前从没 provide 过，inject 永远拿到 null。
            vueApp.provide("comfyNode", this);
            vueApp.mount(container);
            this._vueApp = vueApp;

            const onResize = this.onResize;
            this.onResize = function (size) {
                onResize?.apply(this, arguments);
                applyHeight(size[1]);
            };
        };

        // 修复：之前没有 onRemoved，删除节点后 Vue 实例不会被卸载，长时间
        // 增删节点会有内存泄漏。
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
            onRemoved?.apply(this, arguments);
        };
    }
});
