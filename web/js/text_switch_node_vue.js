/**
 * 多重文本切换 — 动态输入端口（照抄 KJNodes「合并字符串（多重）」的交互模式）
 * 后端在 INPUT_TYPES 里把 字符串_1 ~ 字符串_9 全部声明成 optional，
 * 这里负责把节点上实际显示的端口数量，同步成「输入数量」widget 的值。
 */
import { app } from "../../../scripts/app.js";

var MAX_INPUTS = 9;
var PREFIX = "字符串_";
var PREVIEW_PROPERTY = "eagle_text_switch_preview";
var PREVIEW_LAYOUT_VERSION = 1;

function installPreviewStyle() {
  if (document.getElementById("eagle-text-switch-preview-style")) return;
  var style = document.createElement("style");
  style.id = "eagle-text-switch-preview-style";
  style.textContent = [
    ".eagle-text-switch-preview{box-sizing:border-box;width:100%;height:100%;min-height:130px;display:flex;flex-direction:column;gap:7px;padding:8px;border:1px solid #343945;border-radius:7px;background:#141820;color:var(--fg-color,#e2e6ef);font:12px/1.4 system-ui,sans-serif;overflow:hidden;contain:layout paint style}",
    ".eagle-text-switch-preview *{box-sizing:border-box}",
    ".eagle-text-switch-preview__bar{display:flex;align-items:center;gap:7px;min-height:25px}",
    ".eagle-text-switch-preview__title{font-weight:600;white-space:nowrap}",
    ".eagle-text-switch-preview__count{margin-right:auto;color:#8b95a6;font-size:11px}",
    ".eagle-text-switch-preview__copy{padding:4px 9px;border:1px solid #45618b;border-radius:5px;background:#233b61;color:#e7f1ff;cursor:pointer;white-space:nowrap}",
    ".eagle-text-switch-preview__copy:disabled{opacity:.45;cursor:default}",
    ".eagle-text-switch-preview__text{flex:1;min-height:0;width:100%;resize:none;overflow:auto;padding:7px;border:1px solid #2c3340;border-radius:5px;background:#0e1118;color:#dce5f3;font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap}"
  ].join("\n");
  document.head.appendChild(style);
}

function previewText(node) {
  var saved = node.properties && node.properties[PREVIEW_PROPERTY];
  return typeof saved === "string" ? saved : "";
}

function showPreview(node, value) {
  var view = node._eagleTextSwitchPreview;
  if (!view) return;
  var text = String(value == null ? "" : value);
  if (view.text.value !== text) view.text.value = text;
  view.count.textContent = text.length ? text.length + " 字符" : "暂无输出";
  view.copy.disabled = !text;
}

function resizePreview(node) {
  var view = node._eagleTextSwitchPreview;
  if (!view) return;
  var width = Math.max(300, (Number(node.size && node.size[0]) || 430) - 20);
  var height = Math.max(140, Math.min(1200, (Number(node.size && node.size[1]) || 490) - 275));
  view.height = height;
  view.root.style.width = width + "px";
  view.root.style.height = height + "px";
}

function createPreview(node) {
  if (node._eagleTextSwitchPreview || typeof node.addDOMWidget !== "function") return;
  installPreviewStyle();
  var root = document.createElement("div");
  root.className = "eagle-text-switch-preview";
  var bar = document.createElement("div");
  bar.className = "eagle-text-switch-preview__bar";
  var title = document.createElement("span");
  title.className = "eagle-text-switch-preview__title";
  title.textContent = "展示文本";
  var count = document.createElement("span");
  count.className = "eagle-text-switch-preview__count";
  var copy = document.createElement("button");
  copy.type = "button";
  copy.className = "eagle-text-switch-preview__copy";
  copy.textContent = "复制全部";
  var text = document.createElement("textarea");
  text.className = "eagle-text-switch-preview__text";
  text.readOnly = true;
  text.placeholder = "执行后在这里展示输出；保存工作流后，刷新仍会保留上次结果。";
  copy.addEventListener("click", async function(event) {
    event.stopPropagation();
    var value = text.value;
    if (!value) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        text.focus();
        text.select();
        if (!document.execCommand("copy")) throw new Error("copy unavailable");
      }
      copy.textContent = "已复制";
      setTimeout(function() { if (node._eagleTextSwitchPreview) copy.textContent = "复制全部"; }, 1400);
    } catch (error) {
      copy.textContent = "复制失败，请选中文本复制";
      setTimeout(function() { if (node._eagleTextSwitchPreview) copy.textContent = "复制全部"; }, 2200);
    }
  });
  bar.append(title, count, copy);
  root.append(bar, text);
  var view = { root: root, text: text, count: count, copy: copy, height: 180 };
  node._eagleTextSwitchPreview = view;
  node.addDOMWidget("eagle_text_switch_preview", "div", root, {
    serialize: false,
    hideInPanel: true,
    getMinHeight: function() { return 140; },
    getMaxHeight: function() { return 1200; },
    getHeight: function() { return view.height; }
  });
  resizePreview(node);
  showPreview(node, previewText(node));
}

function ensurePreviewLayout(node) {
  node.properties = node.properties || {};
  if (node.properties.eagle_text_switch_preview_layout_version === PREVIEW_LAYOUT_VERSION) return;
  var width = Math.max(430, Number(node.size && node.size[0]) || 430);
  var height = Math.max(490, Number(node.size && node.size[1]) || 490);
  node.properties.eagle_text_switch_preview_layout_version = PREVIEW_LAYOUT_VERSION;
  if (width !== node.size[0] || height !== node.size[1]) node.setSize([width, height]);
  resizePreview(node);
}

function syncInputs(node, options) {
  options = options || {};
  var countWidget = node.widgets && node.widgets.find(function (w) { return w.name === "输入数量"; });
  var count = countWidget ? Math.max(1, Math.min(MAX_INPUTS, parseInt(countWidget.value) || 1)) : 4;

  var existing = (node.inputs || []).filter(function (inp) { return inp.name.indexOf(PREFIX) === 0; });
  var existingCount = existing.length;
  var changed = false;

  if (existingCount < count) {
    for (var i = existingCount + 1; i <= count; i++) {
      node.addInput(PREFIX + i, "STRING");
      changed = true;
    }
  } else if (existingCount > count) {
    // 从后往前删，避免删除过程中索引错位
    for (var j = existingCount; j > count; j--) {
      var idx = node.inputs.findIndex(function (inp) { return inp.name === PREFIX + j; });
      if (idx !== -1) {
        if (node.inputs[idx].link != null) {
          console.warn("[EagleTextSwitchMulti] " + PREFIX + j + " 还连着线，先断开连线再减少数量");
          continue;
        }
        node.removeInput(idx);
        changed = true;
      }
    }
  }
  // 修复：裁掉多余端口之后节点不会自动收缩——LiteGraph 只会自动"长大"以容纳
  // 内容，内容变少时不会自己缩回去，得手动重新计算一次尺寸，不然会留一大截
  // 空白（节点创建瞬间先按 32 个端口撑到最大，裁到 4 个之后空出来的那部分）。
  if (!options.preserveSize) {
    var newSize = node.computeSize();
    if (changed) node.setSize([Math.max(node.size[0], newSize[0]), Math.max(node.size[1], newSize[1])]);
  }
  if (changed) {
    if (options.fromUser) node.graph?.change?.();
    node.setDirtyCanvas(true, true);
  }
}

app.registerExtension({
  name: "EagleSuite.TextSwitchMulti",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleTextSwitchMulti") return;

    var onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      var node = this;
      // 等 ComfyUI 把 INPUT_TYPES 里声明的全部 9 个 optional 输入端口都建好之后，
      // 再裁到「输入数量」widget 的默认值（4）。
      setTimeout(function () { syncInputs(node, { preserveSize: Boolean(node._eagleTextSwitchConfigured) }); }, 30);

      // 「更新输入」是纯前端按钮，Python 的 INPUT_TYPES 里不会有这个 widget
      // （按钮不对应任何执行时输入），要在这里自己加。
      node.addWidget("button", "更新输入", null, function () { syncInputs(node, { fromUser: true }); });
      createPreview(node);
      setTimeout(function() {
        if (!node._eagleTextSwitchConfigured) ensurePreviewLayout(node);
      }, 40);

      var previousResize = node.onResize;
      node.onResize = function() {
        var result = previousResize?.apply(this, arguments);
        resizePreview(this);
        return result;
      };
    };

    var onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      var result = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      this._eagleTextSwitchConfigured = true;
      var node = this;
      setTimeout(function () {
        syncInputs(node, { preserveSize: true });
        ensurePreviewLayout(node);
        showPreview(node, previewText(node));
      }, 0);
      return result;
    };

    var onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (data) {
      var result = onExecuted?.apply(this, arguments);
      if (!data || !Array.isArray(data.text)) return result;
      var nextText = String(data.text[0] == null ? "" : data.text[0]);
      this.properties = this.properties || {};
      if (this.properties[PREVIEW_PROPERTY] !== nextText) {
        this.properties[PREVIEW_PROPERTY] = nextText;
        this.graph?.change?.();
      }
      showPreview(this, nextText);
      return result;
    };

    var onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._eagleTextSwitchPreview = null;
      return onRemoved?.apply(this, arguments);
    };
  },
});
