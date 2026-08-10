/**
 * Local Video Loader - 本地视频文件夹加载器
 * 复用 gallery-common 组件，但去掉文件夹树，换成手动路径输入 + 递归开关。
 * 缩略图/列表两种视图模式可切换，列表模式不加载缩略图，省资源（同 LoRA 画廊思路）。
 */
import { app } from "../../../scripts/app.js";
import { createApp, ref, reactive, onMounted, watch } from "../lib/vue.esm-browser.js";
import { ImageGrid, PreviewBar, useSelection, useComfyNode } from "../vue/gallery-common/index.js";

const CSS = `
.lvl-root { width: 100%; height: 100%; display: flex; flex-direction: column; background: #1a1a1e; color: #ddd; font-family: sans-serif; overflow: hidden; }
.lvl-toolbar { flex-shrink: 0; padding: 8px 10px; background: #25252a; border-bottom: 1px solid #333; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.lvl-path-input { flex: 1; min-width: 220px; background: #1a1a1e; border: 1px solid #444; color: #eee; padding: 5px 8px; border-radius: 4px; font-size: 12px; font-family: monospace; }
.lvl-path-input:focus { border-color: #4a7de0; outline: none; }
.lvl-btn { background: #333; border: 1px solid #444; color: #eee; padding: 5px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: background 0.15s; white-space: nowrap; }
.lvl-btn:hover { background: #444; }
.lvl-btn.active { background: #2a4a8a; border-color: #4a7de0; color: #fff; }
.lvl-btn.primary { background: #2a5a3a; border-color: #3a7a4a; }
.lvl-btn.primary:hover { background: #357a48; }
.lvl-status { padding: 4px 10px; font-size: 10px; color: #777; border-bottom: 1px solid #292933; background: #1c1c20; }
.lvl-status.error { color: #e57373; }
.lvl-body { flex: 1; display: flex; overflow: hidden; min-height: 0; }
.lvl-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
.lvl-list { flex: 1; overflow-y: auto; padding: 4px; }
.lvl-list-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; color: #bbb; }
.lvl-list-row:hover { background: #24242a; }
.lvl-list-row.selected { background: #2a4a8a; color: #fff; }
.lvl-list-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lvl-list-size { color: #777; font-size: 10px; flex-shrink: 0; }
.lvl-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #666; font-size: 12px; text-align: center; padding: 20px; }
.lvl-video-badge { position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,.75); color: #4a9eff; font-size: 9px; padding: 1px 5px; border-radius: 3px; z-index: 2; }
.lvl-footer { flex-shrink: 0; padding: 4px 10px; font-size: 10px; color: #666; border-top: 1px solid #333; }
`;

const LocalVideoLoaderApp = {
    props: ["node"],
    components: { ImageGrid, PreviewBar },
    setup(props) {
        const { selectedItems, selectedIds, toggleSelect, clearSelection } = useSelection();
        const { confirmSelection: sendSelectionToNode } = useComfyNode();

        const folderPath = ref("");
        const recursive = ref(false);
        const viewMode = ref("grid"); // 'grid' | 'list' —— list 模式不请求缩略图，省资源
        const items = ref([]);
        const loading = ref(false);
        const errorMsg = ref("");
        const hasScanned = ref(false);

        // 扫描文件夹（只在用户主动触发时调用，不做自动 watch）
        const scanFolder = async () => {
            const path = folderPath.value.trim();
            if (!path) {
                items.value = [];
                errorMsg.value = "";
                hasScanned.value = false;
                return;
            }
            loading.value = true;
            errorMsg.value = "";
            try {
                const res = await fetch("/local_video_loader/list", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folderPath: path, recursive: recursive.value }),
                });
                const data = await res.json();
                if (data.success) {
                    items.value = data.items || [];
                } else {
                    items.value = [];
                    errorMsg.value = data.error || "扫描失败";
                }
            } catch (e) {
                items.value = [];
                errorMsg.value = "请求失败: " + e.message;
            } finally {
                loading.value = false;
                hasScanned.value = true;
            }
        };

        const toggleRecursive = () => {
            recursive.value = !recursive.value;
            if (hasScanned.value) scanFolder(); // 已经扫描过一次才自动重扫，避免"默认不加载"被绕过
        };

        const toggleViewMode = () => {
            viewMode.value = viewMode.value === "grid" ? "list" : "grid";
        };

        const onItemClick = (item) => {
            toggleSelect({
                id: item.id,
                name: item.name,
                filePath: item.filePath,
                ext: item.ext,
                size: item.size,
            });
        };

        const isSelected = (id) => selectedIds.value?.has(id) || false;

        const formatSize = (bytes) => {
            if (!bytes) return "";
            const mb = bytes / (1024 * 1024);
            return mb >= 1 ? mb.toFixed(1) + " MB" : (bytes / 1024).toFixed(0) + " KB";
        };

        // 同步选中数据到节点（隐藏 widget + 服务端缓存），与 eagle_video_gallery 同一套路
        const syncToNode = () => {
            const node = props.node;
            if (!node) return;

            const selWidget = node.widgets?.find((w) => w.name === "selection_data");
            if (selWidget) selWidget.value = JSON.stringify(selectedItems.value);

            const pathWidget = node.widgets?.find((w) => w.name === "folder_path");
            if (pathWidget) pathWidget.value = folderPath.value;

            fetch("/local_video_loader/cache_selection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ selections: selectedItems.value }),
            }).catch((err) => console.error("[LocalVideoLoader] cache_selection failed", err));

            sendSelectionToNode({ selections: selectedItems.value });
        };

        watch(selectedItems, syncToNode, { deep: true });
        watch(folderPath, () => {
            const node = props.node;
            const pathWidget = node?.widgets?.find((w) => w.name === "folder_path");
            if (pathWidget) pathWidget.value = folderPath.value;
        });

        onMounted(() => {
            // 从节点恢复已保存的路径（工作流重新打开时），但依然不自动扫描——
            // 只是把输入框内容填回去，符合"默认不加载"的要求。
            const pathWidget = props.node?.widgets?.find((w) => w.name === "folder_path");
            if (pathWidget?.value) folderPath.value = pathWidget.value;
        });

        return {
            folderPath, recursive, viewMode, items, loading, errorMsg, hasScanned,
            selectedItems, selectedIds, scanFolder, toggleRecursive, toggleViewMode,
            onItemClick, isSelected, clearSelection, formatSize,
            thumbnailUrlFn: (item) => "/local_video_loader/thumbnail?path=" + encodeURIComponent(item.filePath),
        };
    },
    template: `
    <div class="lvl-root">
        <PreviewBar :selected-items="selectedItems" :thumbnail-url-fn="thumbnailUrlFn"
                    @remove="onItemClick" @clear="clearSelection" />

        <div class="lvl-toolbar">
            <input type="text" class="lvl-path-input" v-model="folderPath"
                   placeholder="粘贴本地视频文件夹路径，回车扫描..." @keydown.enter="scanFolder">
            <button class="lvl-btn primary" @click="scanFolder">{{ loading ? '扫描中...' : '🔍 扫描' }}</button>
            <button class="lvl-btn" :class="{ active: recursive }" @click="toggleRecursive">
                {{ recursive ? '✅ 递归子文件夹' : '⬜ 递归子文件夹' }}
            </button>
            <button class="lvl-btn" @click="toggleViewMode">
                {{ viewMode === 'grid' ? '📋 切换列表(省资源)' : '🖼️ 切换缩略图' }}
            </button>
        </div>

        <div v-if="errorMsg" class="lvl-status error">{{ errorMsg }}</div>
        <div v-else-if="hasScanned" class="lvl-status">共 {{ items.length }} 个视频 | 已选 {{ selectedItems.length }} 个</div>

        <div class="lvl-body">
            <div class="lvl-content">
                <div v-if="!hasScanned" class="lvl-empty">在上方输入本地文件夹路径，回车或点击"扫描"开始浏览</div>
                <div v-else-if="items.length === 0 && !loading" class="lvl-empty">该路径下没有找到视频文件</div>

                <ImageGrid v-else-if="viewMode === 'grid'"
                           :items="items" :selected-ids="selectedIds" :loading="loading"
                           :thumbnail-url-fn="thumbnailUrlFn"
                           @select="({item}) => onItemClick(item)">
                    <template #thumb-overlay="{ item }">
                        <span class="lvl-video-badge">▶ {{ item.ext?.toUpperCase() }}</span>
                    </template>
                </ImageGrid>

                <div v-else class="lvl-list">
                    <div v-for="item in items" :key="item.id" class="lvl-list-row"
                         :class="{ selected: isSelected(item.id) }" @click="onItemClick(item)">
                        <span>{{ isSelected(item.id) ? '☑' : '☐' }}</span>
                        <span class="lvl-list-name">{{ item.name }}</span>
                        <span class="lvl-list-size">{{ formatSize(item.size) }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `,
};

app.registerExtension({
    name: "EagleSuite.LocalVideoLoaderVue",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "EagleLocalVideoLoaderNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            if (this._lvlInit) return;
            this._lvlInit = true;

            this.setSize([900, 650]);

            // 隐藏 selection_data（folder_path 保留可见，方便直接在节点上看/改路径）
            const hideWidget = (name) => {
                const w = this.widgets?.find((x) => x.name === name);
                if (w) {
                    w.type = "hidden";
                    w.computeSize = () => [0, -4];
                    w.draw = () => {};
                }
            };
            setTimeout(() => hideWidget("selection_data"), 100);

            if (!document.getElementById("gal-theme-style")) {
                const link = document.createElement("link");
                link.id = "gal-theme-style";
                link.rel = "stylesheet";
                link.href = new URL("../vue/gallery-common/styles/gallery-theme.css", import.meta.url).href;
                document.head.appendChild(link);
            }
            if (!document.getElementById("lvl-vue-style")) {
                const style = document.createElement("style");
                style.id = "lvl-vue-style";
                style.textContent = CSS;
                document.head.appendChild(style);
            }

            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.boxSizing = "border-box";
            container.style.overflow = "hidden";

            const widget = this.addDOMWidget("local_video_loader_vue", "div", container, { serialize: false });

            // 高度计算：标题栏 + folder_path 原生 widget(可见) + 4 行输出 socket + padding，
            // 实测大约 170~190px，参照 eagle_video_gallery 那次"无限增高"的教训，
            // 宁可预留多一点，也不要低估——低估会和 computeSize 互相抬高陷入死循环。
            const applyHeight = (nodeHeight) => {
                const h = Math.max(400, nodeHeight - 190);
                container.style.height = h + "px";
                widget.computeSize = (w) => [w, h];
                return h;
            };
            applyHeight(this.size[1]);

            const vueApp = createApp(LocalVideoLoaderApp, { node: this });
            vueApp.provide("comfyNode", this);
            vueApp.mount(container);
            this._vueApp = vueApp;

            const onResize = this.onResize;
            this.onResize = function (size) {
                onResize?.apply(this, arguments);
                applyHeight(size[1]);
            };
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
            onRemoved?.apply(this, arguments);
        };
    },
});
