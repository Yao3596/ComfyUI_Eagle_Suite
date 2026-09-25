/**
 * Eagle 图片保存节点 - 参数中文标签
 */
import { app } from "../../../scripts/app.js";

const LABEL_MAP = {
  "eagle_folder": "Eagle 文件夹",
  "local_save_path": "本地保存路径",
  "filename_prefix": "文件名前缀",
  "filename_separator": "文件名分隔符",
  "filename_number_padding": "编号位数",
  "filename_number_start": "起始编号",
  "file_extension": "文件格式",
  "dpi": "DPI",
  "quality": "质量",
  "optimize_image": "启用优化",
  "high_quality_webp": "高质量 WebP",
  "overwrite": "覆盖已有文件",
  "save_metadata_in_png": "PNG 嵌入元数据",
  "save_metadata_json": "输出 JSON 元数据",
  "tags": "标签",
  "star": "评分",
  "annotation": "注释"
};

function getWidget(node, name) {
  return (node.widgets || []).find(function(widget) { return widget.name === name; });
}

var STAR_LABELS = [
  "0 ☆☆☆☆☆", "1 ★☆☆☆☆", "2 ★★☆☆☆",
  "3 ★★★☆☆", "4 ★★★★☆", "5 ★★★★★"
];

function normalizeRating(widget) {
  if (!widget) return;
  var parsed = parseInt(String(widget.value == null ? "0" : widget.value).trim().split(/\s+/)[0], 10);
  parsed = Math.max(0, Math.min(5, Number.isFinite(parsed) ? parsed : 0));
  widget.value = STAR_LABELS[parsed];
}

function applyLabels(node) {
  if (!node.widgets) return;
  node.widgets.forEach(function(w) {
    if (w.name && LABEL_MAP[w.name]) w.label = LABEL_MAP[w.name];
  });
  var tagsWidget = getWidget(node, "tags");
  var annotationWidget = getWidget(node, "annotation");
  var starWidget = getWidget(node, "star");
  if (tagsWidget && tagsWidget.inputEl) tagsWidget.inputEl.placeholder = "Eagle 标签：用逗号或换行分隔";
  if (annotationWidget && annotationWidget.inputEl) annotationWidget.inputEl.placeholder = "Eagle 注释";
  normalizeRating(starWidget);
  node.setDirtyCanvas?.(true, true);
}

function migrateLegacyWidgetOrder(node) {
  var starWidget = getWidget(node, "star");
  var tagsWidget = getWidget(node, "tags");
  if (!starWidget || !tagsWidget) return;
  var isRating = function(value) {
    return /^[0-5](?:\s|$)/.test(String(value == null ? "" : value).trim());
  };
  // 更旧的工作流可能以 tags → star 位置保存。现在后端实际声明
  // star → tags → annotation，不再靠前端移动 widget，因此同时稳定
  // ComfyUI 1.0 位置数组和 2.0 按名字恢复。
  if (!isRating(starWidget.value) && isRating(tagsWidget.value)) {
    var oldTags = starWidget.value;
    var oldStar = tagsWidget.value;
    starWidget.value = oldStar;
    tagsWidget.value = oldTags;
  }
}

app.registerExtension({
  name: "EagleSuite.EagleSaverLabels",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    var targetNodes = ["EagleSaver", "EagleImagesToVideo", "EagleVideoConverter"];
    if (targetNodes.indexOf(nodeData.name) < 0) return;
    var isImageSaver = nodeData.name === "EagleSaver";

    var orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      if (orig) orig.apply(this, arguments);
      applyLabels(this);
    };

    var origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function(info) {
      if (origConfigure) origConfigure.apply(this, arguments);
      if (isImageSaver) migrateLegacyWidgetOrder(this);
      applyLabels(this);
    };
  }
});
