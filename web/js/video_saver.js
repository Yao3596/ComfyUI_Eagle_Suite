/**
 * 🦅 Eagle Video Saver Suite - 前端兼容层
 *
 * 保存/转换节点只保留原生 ComfyUI widget，不再插入会污染
 * widgets_values 的橙色“分类标题”。自定义宽高仅在 resolution=custom
 * 时显示，普通工作流不再被两个冗余尺寸框撑高。
 */
import { app } from "../../../scripts/app.js";

const TARGET_NODES = new Set(["EagleImagesToVideo", "EagleVideoConverter"]);
const PREVIEW_NODE = "EagleVideoGifPreviewNode";
const VIDEO_WIDGET_ORDER = {
  EagleImagesToVideo: [
    "eagle_folder", "local_save_path", "filename_prefix", "format", "fps", "quality",
    "size_mode", "resolution", "frame_skip", "frame_limit", "crf", "custom_width",
    "custom_height", "tags", "annotation", "star",
  ],
  EagleVideoConverter: [
    "eagle_folder", "local_save_path", "filename_prefix", "format", "quality", "size_mode",
    "resolution", "fps", "frame_limit", "speed", "target_fps", "custom_width",
    "custom_height", "tags", "annotation", "star",
  ],
};
const LEGACY_SEPARATOR_INDEXES = {
  EagleImagesToVideo: new Set([0, 5, 10, 19]),
  EagleVideoConverter: new Set([0, 5, 9, 19]),
};

function findWidget(node, name) {
  return (node.widgets || []).find((widget) => widget.name === name);
}

function setWidgetVisible(node, widget, visible) {
  if (!widget) return;
  if (!widget._eagleVideoOriginal) {
    widget._eagleVideoOriginal = {
      type: widget.type,
      computeSize: widget.computeSize,
      draw: widget.draw,
      options: { ...(widget.options || {}) },
    };
  }
  const original = widget._eagleVideoOriginal;
  if (visible) {
    widget.type = original.type;
    widget.computeSize = original.computeSize;
    widget.draw = original.draw;
    widget.options = { ...original.options };
    widget.hidden = false;
    if (widget.inputEl) widget.inputEl.style.display = "";
  } else {
    widget.type = "hidden";
    widget.computeSize = () => [0, -4];
    widget.draw = () => {};
    widget.hidden = true;
    widget.options = { ...(widget.options || {}), hidden: true, vueNode: "never", hideInPanel: true };
    if (widget.inputEl) widget.inputEl.style.display = "none";
  }
  // ComfyUI 2.0 keeps widgets in a shallowReactive array, so nested option
  // changes alone do not re-run its visibility filter.
  const index = node?.widgets?.indexOf(widget) ?? -1;
  if (index >= 0) node.widgets.splice(index, 1, widget);
}

function removeLegacySeparators(node) {
  if (!node.widgets) return;
  node.widgets = node.widgets.filter((widget) => !String(widget?.name || "").startsWith("__sep__"));
}

function normalizeLegacyVideoWorkflowInfo(info, nodeName) {
  if (!info || !VIDEO_WIDGET_ORDER[nodeName]) return false;
  const order = VIDEO_WIDGET_ORDER[nodeName];
  const named = info.widgets_values_named;
  const separatorKeys = named && typeof named === "object"
    ? Object.keys(named).filter((key) => key.startsWith("__sep__"))
    : [];
  if (separatorKeys.length) {
    // Rebuild the positional payload from stable names before ComfyUI's native
    // onConfigure consumes it. This repairs workflows saved while the old
    // orange pseudo-widgets occupied four serialized positions.
    info.widgets_values = order.map((name) => named[name]);
    for (const key of separatorKeys) delete named[key];
    return true;
  }

  const values = info.widgets_values;
  const legacyIndexes = LEGACY_SEPARATOR_INDEXES[nodeName];
  if (!Array.isArray(values) || values.length !== order.length + legacyIndexes.size) return false;
  info.widgets_values = values.filter((_value, index) => !legacyIndexes.has(index));
  return true;
}

function syncCustomDimensions(node) {
  removeLegacySeparators(node);
  const resolution = findWidget(node, "resolution");
  const showCustom = String(resolution?.value || "").toLowerCase() === "custom";
  setWidgetVisible(node, findWidget(node, "custom_width"), showCustom);
  setWidgetVisible(node, findWidget(node, "custom_height"), showCustom);
  node.setDirtyCanvas?.(true, true);
}

function installVideoNodeUi(node) {
  removeLegacySeparators(node);
  const resolution = findWidget(node, "resolution");
  if (resolution && !resolution._eagleVideoVisibilityBound) {
    resolution._eagleVideoVisibilityBound = true;
    const originalCallback = resolution.callback;
    resolution.callback = function () {
      const result = originalCallback?.apply(this, arguments);
      syncCustomDimensions(node);
      return result;
    };
  }
  syncCustomDimensions(node);
}

app.registerExtension({
  name: "ComfyUI_Eagle_Suite.VideoNodes",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (TARGET_NODES.has(nodeData.name)) {
      const onNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const result = onNodeCreated?.apply(this, arguments);
        installVideoNodeUi(this);
        setTimeout(() => syncCustomDimensions(this), 0);
        return result;
      };

      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function (info) {
        normalizeLegacyVideoWorkflowInfo(info, nodeData.name);
        const result = onConfigure?.apply(this, arguments);
        setTimeout(() => syncCustomDimensions(this), 0);
        return result;
      };
    }

    // 视频/GIF 预览节点：让 video 和 images 端口同时接受 IMAGE 与 VIDEO。
    if (nodeData.name === PREVIEW_NODE) {
      const inputDefs = nodeData.input || nodeData.inputs;
      const optional = (inputDefs && inputDefs.optional) || {};
      ["video", "images"].forEach((name) => {
        if (optional[name]) optional[name] = ["IMAGE", "VIDEO"];
      });
    }
  },
});

export { normalizeLegacyVideoWorkflowInfo };
