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
    };
  }
});
