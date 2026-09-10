/** 多重 Latent 随机切换：按“输入数量”动态显示 LATENT 端口。 */
import { app } from "../../../scripts/app.js";

const MAX_INPUTS = 9;
const PREFIX = "latent_";

function syncInputs(node) {
  const countWidget = node.widgets?.find((widget) => widget.name === "输入数量");
  const count = countWidget
    ? Math.max(1, Math.min(MAX_INPUTS, Number.parseInt(countWidget.value, 10) || 1))
    : 4;
  const inputs = (node.inputs || []).filter((input) => input.name.startsWith(PREFIX));

  if (inputs.length < count) {
    for (let index = inputs.length + 1; index <= count; index += 1) {
      node.addInput(`${PREFIX}${index}`, "LATENT");
    }
  } else if (inputs.length > count) {
    for (let index = inputs.length; index > count; index -= 1) {
      const slot = node.inputs.findIndex((input) => input.name === `${PREFIX}${index}`);
      if (slot === -1) continue;
      if (node.inputs[slot].link != null) {
        console.warn(`[EagleLatentSwitchMulti] latent_${index} 仍有连线，请先断开再减少输入数量`);
        continue;
      }
      node.removeInput(slot);
    }
  }

  const computed = node.computeSize();
  node.setSize([Math.max(node.size[0], computed[0]), computed[1]]);
  node.graph?.change?.();
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "EagleSuite.LatentSwitchMulti",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleLatentSwitchMulti") return;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      originalCreated?.apply(this, arguments);
      const node = this;
      setTimeout(() => syncInputs(node), 30);
      node.addWidget("button", "更新输入", null, () => syncInputs(node));
    };
  },
});
