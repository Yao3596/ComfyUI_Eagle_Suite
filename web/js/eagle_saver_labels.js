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

function moveRatingBeforeText(node) {
  if (!node.widgets) return;
  var starIndex = node.widgets.findIndex(function(widget) { return widget.name === "star"; });
  var tagsIndex = node.widgets.findIndex(function(widget) { return widget.name === "tags"; });
  if (starIndex < 0 || tagsIndex < 0 || starIndex < tagsIndex) return;
  var starWidget = node.widgets.splice(starIndex, 1)[0];
  tagsIndex = node.widgets.findIndex(function(widget) { return widget.name === "tags"; });
  node.widgets.splice(tagsIndex, 0, starWidget);
}

function migrateLegacyWidgetOrder(node) {
  var starWidget = getWidget(node, "star");
  var tagsWidget = getWidget(node, "tags");
  if (!starWidget || !tagsWidget) return;
  // 旧工作流保存顺序为 tags → star；新版视觉顺序为 star → tags。
  // 如果加载后类型明显反转，则交换回对应字段，避免旧工作流串值。
  if (typeof starWidget.value === "string" && typeof tagsWidget.value === "number") {
    var oldTags = starWidget.value;
    var oldStar = tagsWidget.value;
    starWidget.value = Math.max(0, Math.min(5, Number(oldStar) || 0));
    tagsWidget.value = oldTags;
  }
}

app.registerExtension({
  name: "EagleSuite.EagleSaverLabels",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleSaver") return;

    var orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      if (orig) orig.apply(this, arguments);
      var node = this;
      if (!node.widgets) return;
      node.widgets.forEach(function(w) {
        if (w.name && LABEL_MAP[w.name]) {
          w.label = LABEL_MAP[w.name];
        }
      });
      var tagsWidget = getWidget(node, "tags");
      var annotationWidget = getWidget(node, "annotation");
      var starWidget = getWidget(node, "star");
      if (tagsWidget && tagsWidget.inputEl) tagsWidget.inputEl.placeholder = "Eagle 标签：用逗号或换行分隔";
      if (annotationWidget && annotationWidget.inputEl) annotationWidget.inputEl.placeholder = "Eagle 注释";
      if (starWidget && (starWidget.value === undefined || starWidget.value === null || starWidget.value === "")) starWidget.value = 0;
      moveRatingBeforeText(node);
      node.setDirtyCanvas(true, true);
    };

    var origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function(info) {
      if (origConfigure) origConfigure.apply(this, arguments);
      migrateLegacyWidgetOrder(this);
      moveRatingBeforeText(this);
      this.setDirtyCanvas(true, true);
    };
  }
});
