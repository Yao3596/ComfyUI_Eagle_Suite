/**
 * Eagle Gallery — Vue 3 ESM 重写
 * Eagle 图片浏览器节点
 */
import { app } from "../../scripts/app.js";
import { createApp, ref, computed, onMounted, defineComponent, h } from "../lib/vue.esm-browser.js";

import { useSelection } from "../vue/gallery-common/composables/useSelection.js";
import { useComfyNode } from "../vue/gallery-common/composables/useComfyNode.js";
import { useServerCache } from "../vue/gallery-common/composables/useServerCache.js";
import { PreviewBar } from "../vue/gallery-common/components/PreviewBar.js";
import { ImageGrid } from "../vue/gallery-common/components/ImageGrid.js";
import { SettingsDialog } from "../vue/gallery-common/components/SettingsDialog.js";
import { FolderTree } from "../vue/gallery-common/components/FolderTree.js";

const PAGE_SIZE = 24;

const STAR_OPTIONS = [
  { value: "全部", label: "⭐ 全部" },
  { value: "未评分", label: "⭐ 未评分" },
  { value: "1星", label: "⭐ 1星" },
  { value: "2星", label: "⭐ 2星" },
  { value: "3星", label: "⭐ 3星" },
  { value: "4星", label: "⭐ 4星" },
  { value: "5星", label: "⭐ 5星" },
];

const SHAPE_OPTIONS = [
  { value: "全部", label: "全部比例" },
  { value: "横向", label: "▬ 横向" },
  { value: "纵向", label: "▮ 纵向" },
  { value: "方形", label: "■ 方形" },
];

const EagleGalleryApp = defineComponent({
  name: "EagleGalleryApp",
  setup() {
    // ── 状态 ──
    const query = ref("");
    const folderId = ref("");
    const star = ref("全部");
    const shape = ref("全部");
    const page = ref(1);
    const items = ref([]);
    const total = ref(0);
    const folders = ref([]);
    const sidebarVisible = ref(true);
    const loading = ref(false);
    const errorMsg = ref("");
    const settingsVisible = ref(false);
    const settingsFields = ref([
      { key: "eagle_url", label: "Eagle API URL", type: "text", placeholder: "http://localhost:41595", value: "" },
    ]);

    // ── Composables ──
    const { selectedItems, selectedIds, toggleSelect, removeFromSelection, clearSelection, setSelection } =
      useSelection();
    const { comfyNode, hideSelectionWidget, confirmSelection: confirmToNode } = useComfyNode();
    const { postSelection, getCachedSelection } = useServerCache("/eagle_gallery");

    // ── 计算属性 ──
    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
    const pageInfo = computed(() => `第 ${page.value} 页 | 本页 ${items.value.length} 张`);
    const canPrev = computed(() => page.value > 1);
    const canNext = computed(() => items.value.length >= PAGE_SIZE);

    const thumbnailUrlFn = (item) => "/eagle_gallery/thumbnail?id=" + encodeURIComponent(item.id);

    // ── API 调用 ──
    async function loadFolders() {
      try {
        const res = await fetch("/eagle_gallery/folders");
        const data = await res.json();
        if (data.success) {
          folders.value = data.folders || [];
        }
      } catch (e) {
        console.warn("[EagleGallery] 获取文件夹失败:", e);
      }
    }

    async function loadItems() {
      loading.value = true;
      errorMsg.value = "";
      try {
        const body = {
          folderId: folderId.value,
          keywords: query.value.trim(),
          star: star.value,
          shape: shape.value,
          page: page.value,
          limit: PAGE_SIZE,
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
        }
      } catch (e) {
        errorMsg.value = "请求失败: " + e.message;
      } finally {
        loading.value = false;
      }
    }

    // ── 事件处理 ──
    function onSearch() {
      page.value = 1;
      loadItems();
    }

    function onSearchEnter(e) {
      if (e.key === "Enter") {
        onSearch();
      }
    }

    function onStarChange(e) {
      star.value = e.target.value;
      page.value = 1;
      loadItems();
    }

    function onShapeChange(e) {
      shape.value = e.target.value;
      page.value = 1;
      loadItems();
    }

    function onFolderSelect(folder) {
      folderId.value = folder.id;
      page.value = 1;
      loadItems();
    }

    function onToggleSidebar() {
      sidebarVisible.value = !sidebarVisible.value;
    }

    function onPrev() {
      if (page.value > 1) {
        page.value--;
        loadItems();
      }
    }

    function onNext() {
      page.value++;
      loadItems();
    }

    function onSelect(item) {
      const stdItem = {
        id: item.id,
        name: item.name || "",
        filePath: item.filePath || "",
        tags: item.tags || [],
        width: item.width || 0,
        height: item.height || 0,
        star: item.star || 0,
        ext: item.ext || "",
      };
      toggleSelect(stdItem);
      confirmToNode(selectedItems.value);
      postSelection(selectedItems.value, comfyNode.value?.id);
    }

    function onPreviewRemove(id) {
      removeFromSelection(id);
      confirmToNode(selectedItems.value);
      postSelection(selectedItems.value, comfyNode.value?.id);
    }

    function onClearSelection() {
      clearSelection();
      confirmToNode(selectedItems.value);
      postSelection(selectedItems.value, comfyNode.value?.id);
    }

    async function onOpenSettings() {
      let currentUrl = "";
      try {
        const res = await fetch("/eagle_gallery/settings");
        const data = await res.json();
        currentUrl = data.settings?.eagle_url || "";
      } catch (e) {
        // 使用默认值
      }
      settingsFields.value = [
        { key: "eagle_url", label: "Eagle API URL", type: "text", placeholder: "http://localhost:41595", value: currentUrl },
      ];
      settingsVisible.value = true;
    }

    async function onSaveSettings(formData) {
      try {
        await fetch("/eagle_gallery/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eagle_url: formData.eagle_url || "http://localhost:41595" }),
        });
      } catch (e) {
        console.warn("[EagleGallery] 保存设置失败:", e);
      }
    }

    // ── 初始化 ──
    onMounted(() => {
      loadFolders();
      if (comfyNode.value?.id) {
        getCachedSelection(comfyNode.value.id).then((data) => {
          if (data) {
            setSelection(data);
            confirmToNode(selectedItems.value);
          }
        });
      }
      hideSelectionWidget();
    });

    // ── 渲染 ──
    return () =>
      h("div", { class: "gal-container" }, [
        // 预览条
        h(PreviewBar, {
          selectedItems: selectedItems.value,
          thumbnailUrlFn,
          showClear: true,
          onRemove: onPreviewRemove,
          onClear: onClearSelection,
        }),

        // 工具栏
        h("div", { class: "gal-toolbar" }, [
          h("input", {
            class: "gal-search",
            type: "text",
            placeholder: "搜索关键词...",
            value: query.value,
            onInput: (e) => { query.value = e.target.value; },
            onKeydown: onSearchEnter,
          }),
          h("button", { class: "gal-btn primary", onClick: onSearch }, "\u{1F50D} 搜索"),

          h("select", { class: "gal-btn", value: star.value, onChange: onStarChange },
            STAR_OPTIONS.map((o) => h("option", { value: o.value }, o.label))
          ),

          h("select", { class: "gal-btn", value: shape.value, onChange: onShapeChange },
            SHAPE_OPTIONS.map((o) => h("option", { value: o.value }, o.label))
          ),

          h("button", { class: "gal-btn", title: "切换文件夹树", onClick: onToggleSidebar }, "\u{1F4C2}"),

          h("button", { class: "gal-btn", title: "设置", onClick: onOpenSettings }, "\u2699\uFE0F"),
        ]),

        // 主体区域
        h("div", { class: "gal-main" }, [
          sidebarVisible.value &&
            h("div", { class: "gal-sidebar" },
              folders.value.length > 0
                ? [
                    h(FolderTree, {
                      folders: folders.value,
                      activeId: folderId.value,
                      iconFolder: "\u{1F4C1}",
                      iconParent: "\u{1F4C2}",
                      onSelect: onFolderSelect,
                    }),
                  ]
                : [h("div", { class: "gal-loading" }, "加载中...")]
            ),

          h(ImageGrid, {
            items: items.value,
            selectedIds: selectedIds.value,
            loading: loading.value,
            errorMsg: errorMsg.value,
            emptyText: "选择文件夹或输入关键词搜索",
            thumbnailUrlFn,
            showIndex: false,
            onSelect,
          }),
        ]),

        // 页脚
        h("div", { class: "gal-footer" }, [
          h("button", { class: "gal-btn", disabled: !canPrev.value, onClick: onPrev }, "\u25C0 上一页"),
          h("span", { class: "gal-pageinfo" }, pageInfo.value),
          h("button", { class: "gal-btn", disabled: !canNext.value, onClick: onNext }, "下一页 \u25B6"),
        ]),

        // 设置弹窗
        h(SettingsDialog, {
          visible: settingsVisible.value,
          "onUpdate:visible": (val) => { settingsVisible.value = val; },
          title: "设置",
          fields: settingsFields.value,
          onSave: onSaveSettings,
        }),
      ]);
  },
});

// ── ComfyUI 注册 ──
app.registerExtension({
  name: "EagleSuite.EagleGalleryVue",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleGalleryNode") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      this.setSize([960, 720]);

      // 注入 CSS
      if (!document.getElementById("gal-theme-css")) {
        const link = document.createElement("link");
        link.id = "gal-theme-css";
        link.rel = "stylesheet";
        link.href = "/extensions/ComfyUI_Eagle_Suite/vue/gallery-common/styles/gallery-theme.css";
        document.head.appendChild(link);
      }

      // 创建挂载点
      const mountEl = document.createElement("div");
      mountEl.style.cssText = "width:100%;height:100%;--gal-primary:#4a7de0";
      this.addDOMWidget("eagle_gallery", "div", mountEl, { serialize: false });

      // 创建 Vue 应用
      const vueApp = createApp(EagleGalleryApp);
      vueApp.provide("comfyNode", this);
      vueApp.mount(mountEl);

      // 清理
      const origOnRemoved = this.onRemoved;
      this.onRemoved = function () {
        vueApp.unmount();
        origOnRemoved?.apply(this, arguments);
      };
    };
  },
});
