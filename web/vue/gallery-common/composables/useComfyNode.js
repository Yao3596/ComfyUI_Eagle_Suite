/**
 * useComfyNode — ComfyUI 节点交互 composable
 * 封装 widget/input 操作和 Vue Gallery 注册
 */
import { inject } from "../../../lib/vue.esm-browser.js";

export function useComfyNode() {
  const comfyNode = inject("comfyNode", null);

  /** 隐藏 selection_data 文本 widget */
  function hideSelectionWidget(node) {
    const target = node || comfyNode;
    if (!target || !target.widgets) return;
    const w = target.widgets.find(w => w.name === "selection_data");
    if (w) {
      w.hidden = true;
      w.computeSize = () => [0, -4];
    }
  }

  /** 将选中数据写入 widget/input */
  function confirmSelection(data) {
    const node = comfyNode;
    if (!node) return;

    const selectionJson = JSON.stringify({ selections: data });

    // 优先写入 widget
    const widget = node.widgets
      ? node.widgets.find(w => w.name === "selection_data")
      : null;
    if (widget) {
      widget.value = selectionJson;
    } else {
      // 尝试写入 input
      const input = node.inputs
        ? node.inputs.find(i => i.name === "selection_data")
        : null;
      if (input) {
        input.value = selectionJson;
      } else {
        node._selection_data = selectionJson;
      }
    }

    // 标记画布脏
    if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
    if (node.graph) node.graph.change();
  }

  /** 同步 widget 值 */
  function setWidgetValue(widgetName, value) {
    const node = comfyNode;
    if (!node || !node.widgets) return;
    const w = node.widgets.find(w => w.name === widgetName);
    if (w) w.value = value;
  }

  return {
    comfyNode,
    hideSelectionWidget,
    confirmSelection,
    setWidgetValue,
  };
}
