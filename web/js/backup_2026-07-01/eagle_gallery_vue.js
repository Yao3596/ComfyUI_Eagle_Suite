/**
 * Eagle Gallery - Eagle 图片浏览器节点
 * 融合 Wallhaven Gallery（即时提交、预览条）+ Danbooru Gallery（设置弹窗、丰富筛选）
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

// --- CSS 样式保留并优化 ---
const CSS = `
.eg-vue-root { width: 100%; height: 100%; display: flex; flex-direction: column; background: #1a1a1e; color: #ddd; font-family: sans-serif; overflow: hidden; }
.eg-layout { flex: 1; display: flex; overflow: hidden; }
.eg-sidebar { width: 220px; border-right: 1px solid #333; overflow-y: auto; background: #1e1e22; flex-shrink: 0; }
.eg-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.eg-filter-bar { padding: 6px 12px; background: #25252a; border-bottom: 1px solid #333; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.eg-search-input { flex: 1; min-width: 150px; background: #1a1a1e; border: 1px solid #444; color: #eee; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
.eg-search-input:focus { border-color: #4a7de0; outline: none; }
.eg-header { flex-shrink: 0; }
.eg-v-separator { width: 1px; height: 20px; background: #444; margin: 0 4px; }
.eg-mode-controls { display: flex; gap: 4px; align-items: center; }
.eg-select { background: #1a1a1e; border: 1px solid #444; color: #eee; padding: 2px 4px; border-radius: 4px; font-size: 11px; cursor: pointer; }
.eg-select:focus { border-color: #4a7de0; outline: none; }
.eg-btn { background: #333; border: 1px solid #444; color: #eee; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: background 0.2s; }
.eg-btn:hover { background: #444; }
/* 适配已有的 Common 样式 */
.gal-sidebar-toggle { cursor: pointer; padding: 0 4px; color: #666; transition: color 0.2s; }
.gal-sidebar-toggle:hover { color: #aaa; }
.gal-sidebar-children { padding-left: 12px; }
.gal-sidebar-item { padding: 4px 8px; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 6px; font-size: 11px; color: #999; }
.gal-sidebar-item:hover { background: #2a2a30; color: #ddd; }
.gal-sidebar-item.active { background: #2a4a8a; color: #fff; }
`;

// --- Vue 主组件 ---
const EagleGalleryApp = {
    props: ["node"],
    components: { FolderTree, DropdownFilter, ImageGrid, PreviewBar, SettingsDialog },
    setup(props) {
        const { selection, selectedItems, addSelection, removeSelection, clearSelection } = useSelection();
        const { confirmSelection } = useComfyNode();

        // 状态定义
        const folders = ref([]);
        const items = ref([]);
        const total = ref(0);
        const loading = ref(false);
        const searchQuery = ref("");
        const selectedFolderId = ref("");
        
        // 筛选器状态
        const filters = reactive({
            star: "", // 全部/未评分/1-5
            shape: "", // 全部/横向/纵向/方形
            ext: [], // 格式
            tags: [], // 标签
            colors: [] // 颜色
        });

        // 输出模式与顺序设置
        const outputSettings = reactive({
            outputMode: "selection", // selection / folder
            sequenceMode: "all_at_once", // all_at_once / sequential
            sequenceIndex: 0
        });

        // 筛选器选项 (从 Eagle API 获取)
        const filterOptions = reactive({
            exts: [
                { value: "jpg", label: "JPG" }, { value: "png", label: "PNG" }, 
                { value: "webp", label: "WebP" }, { value: "gif", label: "GIF" },
                { value: "mp4", label: "MP4" }
            ],
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
        const openDropdown = ref(""); // 控制哪个下拉框打开

        // 数据加载
        const loadFolders = async () => {
            try {
                const res = await fetch("/eagle_gallery/folders");
                const data = await res.json();
                if (data.success) folders.value = data.folders || [];
            } catch (e) { console.error("Load folders failed", e); }
        };

        const loadTags = async () => {
            try {
                const res = await fetch("/eagle_gallery/tags");
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
                    ext: filters.ext,
                    tags: filters.tags,
                    colors: filters.colors.join(","),
                    all: true
                };
                const res = await fetch("/eagle_gallery/items", {
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
            fetch("/eagle_gallery/cache_selection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    selections: selectedItems.value,
                    outputMode: outputSettings.outputMode,
                    folderId: selectedFolderId.value
                })
            }).catch(err => console.error("Cache selection failed", err));
            
            confirmSelection(node, selectedItems.value);
        };

        // 监听变化自动加载
        watch([selectedFolderId, () => filters.star, () => filters.shape, () => filters.ext, () => filters.tags, () => filters.colors], () => {
            loadItems();
        });

        // 监听选中项变化同步到节点
        watch([selectedItems, () => outputSettings.outputMode, () => outputSettings.sequenceMode], () => {
            syncToNode();
        }, { deep: true });

        onMounted(() => {
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

        const onImageClick = (item) => {
            const id = item.id;
            if (selection.value.has(id)) {
                removeSelection(id);
            } else {
                addSelection({
                    id, name: item.name, filePath: item.filePath,
                    width: item.width, height: item.height, ext: item.ext,
                    tags: item.tags || []
                });
            }
            // syncToNode 会在 watch 选中项时触发
        };

        return {
            folders, items, total, loading, searchQuery, selectedFolderId,
            filters, filterOptions, isSettingsOpen, openDropdown,
            selection, selectedItems, outputSettings,
            handleSelectFolder, onImageClick, clearSelection, loadItems,
            confirmSelection: syncToNode
        };
    },
    template: `
    <div class="eg-vue-root" @click="openDropdown = ''">
        <!-- 预览条 -->
        <PreviewBar :items="selectedItems" @remove="onImageClick" @clear="clearSelection" />

        <!-- 工具栏与筛选器 -->
        <div class="eg-header">
            <div class="eg-filter-bar">
                <input type="text" class="eg-search-input" v-model="searchQuery" 
                       placeholder="搜索关键字 (Enter)..." @keydown.enter="loadItems">
                
                <DropdownFilter label="评分" :options="filterOptions.stars" v-model="filters.star" 
                                :multiple="false" :is-open="openDropdown === 'star'" 
                                @update:is-open="openDropdown = $event ? 'star' : ''" />

                <DropdownFilter label="形状" :options="filterOptions.shapes" v-model="filters.shape" 
                                :multiple="false" :is-open="openDropdown === 'shape'" 
                                @update:is-open="openDropdown = $event ? 'shape' : ''" />

                <DropdownFilter label="格式" :options="filterOptions.exts" v-model="filters.ext" 
                                :multiple="true" :is-open="openDropdown === 'ext'" 
                                @update:is-open="openDropdown = $event ? 'ext' : ''" />

                <DropdownFilter label="标签" :options="filterOptions.tags" v-model="filters.tags" 
                                :multiple="true" :searchable="true" :is-open="openDropdown === 'tags'" 
                                @update:is-open="openDropdown = $event ? 'tags' : ''" />

                <DropdownFilter label="颜色" :options="filterOptions.colors" v-model="filters.colors" 
                                :multiple="true" :is-open="openDropdown === 'colors'" 
                                @update:is-open="openDropdown = $event ? 'colors' : ''" />

                <div class="eg-v-separator"></div>

                <!-- 输出模式控制 -->
                <div class="eg-mode-controls">
                    <select class="eg-select" v-model="outputSettings.outputMode">
                        <option value="selection">输出选中</option>
                        <option value="folder">输出文件夹</option>
                    </select>
                    <select class="eg-select" v-model="outputSettings.sequenceMode">
                        <option value="all_at_once">批量 (Batch)</option>
                        <option value="sequential">顺序 (Index)</option>
                    </select>
                </div>

                <button class="eg-btn" @click="loadItems">🔄 刷新</button>
                <button class="eg-btn" @click="isSettingsOpen = true">⚙️</button>
            </div>
        </div>

        <div class="eg-layout">
            <!-- 侧边栏：可折叠文件夹树 -->
            <div class="eg-sidebar">
                <FolderTree :folders="folders" :active-id="selectedFolderId" @select="handleSelectFolder" />
            </div>

            <!-- 主内容：网格 -->
            <div class="eg-content">
                <ImageGrid :items="items" :selection="selection" :loading="loading"
                           :thumbnail-url-func="id => '/eagle_gallery/thumbnail?id=' + id"
                           @item-click="onImageClick" />
                
                <div style="padding:4px 10px; font-size:10px; color:#666; border-top:1px solid #333;">
                    共 {{ total }} 张图片 | 选中 {{ selection.size }} 张
                </div>
            </div>
        </div>

        <SettingsDialog v-if="isSettingsOpen" @close="isSettingsOpen = false" 
                        api-path="/eagle_gallery/settings" />
    </div>
    `
};

app.registerExtension({
    name: "EagleSuite.EagleGalleryVue",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "EagleGalleryNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
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

            // 注入 CSS
            if (!document.getElementById("eg-vue-style")) {
                const style = document.createElement("style");
                style.id = "eg-vue-style";
                style.textContent = CSS;
                document.head.appendChild(style);
            }

            // 挂载 Vue App
            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.height = "100%";
            this.addDOMWidget("eagle_gallery_vue", "div", container, { serialize: false });

            const vueApp = createApp(EagleGalleryApp, { node: this });
            vueApp.mount(container);
            this._vueApp = vueApp;
        };
    }
});
