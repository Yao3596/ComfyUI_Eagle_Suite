/**
 * 多重文本切换 — 动态输入端口（照抄 KJNodes「合并字符串（多重）」的交互模式）
 * 后端在 INPUT_TYPES 里把 字符串_1 ~ 字符串_32 全部声明成 optional，
 * 这里负责把节点上实际显示的端口数量，同步成「输入数量」widget 的值。
 */
import { app } from "../../../scripts/app.js";

var MAX_INPUTS = 32;
var PREFIX = "字符串_";

function syncInputs(node) {
  var countWidget = node.widgets && node.widgets.find(function (w) { return w.name === "输入数量"; });
  var count = countWidget ? Math.max(1, Math.min(MAX_INPUTS, parseInt(countWidget.value) || 1)) : 4;

  var existing = (node.inputs || []).filter(function (inp) { return inp.name.indexOf(PREFIX) === 0; });
  var existingCount = existing.length;

  if (existingCount < count) {
    for (var i = existingCount + 1; i <= count; i++) {
      node.addInput(PREFIX + i, "STRING");
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
      }
    }
  }
  node.setDirtyCanvas(true, true);
  // 修复：裁掉多余端口之后节点不会自动收缩——LiteGraph 只会自动"长大"以容纳
  // 内容，内容变少时不会自己缩回去，得手动重新计算一次尺寸，不然会留一大截
  // 空白（节点创建瞬间先按 32 个端口撑到最大，裁到 4 个之后空出来的那部分）。
  var newSize = node.computeSize();
  node.setSize([Math.max(node.size[0], newSize[0]), newSize[1]]);
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "EagleSuite.TextSwitchMulti",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleTextSwitchMulti") return;

    var onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      var node = this;
      // 等 ComfyUI 把 INPUT_TYPES 里声明的全部 32 个 optional 输入端口都建好之后，
      // 再裁到「输入数量」widget 的默认值（4），不然一开始就是 32 个端口糊一脸。
      setTimeout(function () { syncInputs(node); }, 30);

      // 「更新输入」是纯前端按钮，Python 的 INPUT_TYPES 里不会有这个 widget
      // （按钮不对应任何执行时输入），要在这里自己加。
      node.addWidget("button", "更新输入", null, function () { syncInputs(node); });
    };
  },
});