/**
 * useComfyNode — ComfyUI 节点交互 composable
 *
 * 封装 ComfyUI widget 操作、Vue 应用挂载/卸载等通用逻辑
 */
import { inject } from "../../lib/vue.esm-browser.js";

export function useComfyNode() {
    const _comfyNode = inject("comfyNode", null);

    /**
     * 隐藏 selection_data 文本 widget
     * @param {object} node - ComfyUI 节点实例
     */
    function hideSelectionWidget(node) {
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
            if (!hide(node)) setTimeout(() => hide(node), 500);
        }, 300);
    }

    /**
     * 确认选择并写入 ComfyUI 节点
     * @param {object} data - { selections, outputMode, folderId, ... }
     */
    function confirmSelection(data) {
        const node = _comfyNode;
        if (!node) return;

        const selectionJson = JSON.stringify(data);

        const widget = node.widgets?.find(w => w.name === "selection_data");
        if (widget) widget.value = selectionJson;

        const input = node.inputs?.find(inp => inp.name === "selection_data");
        if (input) input.value = selectionJson;

        node._selection_data = selectionJson;

        node.setDirtyCanvas(true, true);
        if (node.graph) node.graph.change();
    }

    /**
     * 同步 widget 值到 ComfyUI 节点
     * @param {string} widgetName - widget 名称
     * @param {*} value - 值
     */
    function setWidgetValue(widgetName, value) {
        const node = _comfyNode;
        if (!node) return;
        const widget = node.widgets?.find(w => w.name === widgetName);
        if (widget) widget.value = value;
    }

    return {
        comfyNode: _comfyNode,
        hideSelectionWidget,
        confirmSelection,
        setWidgetValue,
    };
}

/**
 * 创建 Vue 应用挂载到 ComfyUI 节点
 * @param {object} nodeType - ComfyUI 节点类型
 * @param {string} nodeName - 节点名称（用于匹配）
 * @param {object} vueComponent - Vue 根组件
 * @param {object} options - { widgetName, defaultSize, maxHeight, minHeight }
 */
export function registerVueGallery(nodeType, nodeName, vueComponent, options = {}) {
    const {
        widgetName = "gallery_vue",
        defaultSize = [960, 720],
        height = 640,
        minHeight = 400,
    } = options;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        onNodeCreated?.apply(this, arguments);
        this.setSize(defaultSize);

        // 隐藏 selection_data widget
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

        // 创建挂载容器
        const container = document.createElement("div");
        container.style.width = "100%";
        container.style.height = height + "px";
        container.style.maxHeight = height + "px";
        container.style.minHeight = minHeight + "px";
        container.style.position = "relative";
        container.style.overflow = "hidden";

        const widget = this.addDOMWidget(widgetName, "div", container, { serialize: false });
        widget.computeSize = function (width) {
            return [width, height];
        };

        // 创建并挂载 Vue 应用
        const { createApp } = requireVue();
        const vueApp = createApp(vueComponent);
        vueApp.provide("comfyNode", this);
        const vm = vueApp.mount(container);

        this._vueApp = vueApp;
        this._vm = vm;

        // 节点缩放同步
        const onResize = this.onResize;
        this.onResize = function (size) {
            onResize?.apply(this, arguments);
            const newH = Math.min(Math.max(minHeight, size[1] - 80), height);
            if (container) container.style.height = newH + "px";
            if (widget) widget.computeSize = (w) => [w, newH];
            const rootEl = container.querySelector(".gal-root");
            if (rootEl) rootEl.style.height = newH + "px";
            const sidebarEl = container.querySelector(".gal-sidebar");
            if (sidebarEl) sidebarEl.style.maxHeight = (newH - 100) + "px";
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
}

/**
 * 动态导入 Vue createApp（避免循环依赖）
 */
let _vue = null;
function requireVue() {
    if (!_vue) {
        // 各 Gallery 文件会在顶层 import Vue，这里无法直接 import
        // 所以这个函数仅用于 registerVueGallery 的辅助，实际 Vue import 在各 Gallery 文件中完成
        throw new Error("registerVueGallery should only be used from files that import Vue themselves");
    }
    return _vue;
}
