import { app } from "../../scripts/app.js";

/**
 * EagleRandomLine 动态输入端口扩展
 * 参考 kj 的多重字符串节点，允许通过 input_count widget 改变实际可见的 text_N 输入端口数量。
 */

const NODE_NAME = "EagleRandomLine";

function isInputSlot(slot) {
    return slot && slot.type === "STRING" && slot.name && /^text_\d+$/.test(slot.name);
}

function updateInputs(node, targetCount) {
    targetCount = Math.max(1, Math.min(16, targetCount));
    const inputs = node.inputs || [];
    // 保留非 text_N 输入
    const existingTextInputs = inputs.filter(isInputSlot);
    const otherInputs = inputs.filter(s => !isInputSlot(s));
    const currentCount = existingTextInputs.length;

    if (currentCount === targetCount) return;

    // 先移除所有现有 text_N 输入（LiteGraph 添加/删除顺序较简单）
    for (let i = inputs.length - 1; i >= 0; i--) {
        if (isInputSlot(inputs[i])) {
            node.removeInput(i);
        }
    }

    // 重新添加目标数量的输入端口
    for (let i = 1; i <= targetCount; i++) {
        node.addInput(`text_${i}`, "STRING", { widget: null, removable: false, nameLocked: true });
    }

    node.setSize(node.computeSize());
    node.setDirtyCanvas(true, true);
}

app.registerExtension({
    name: "ComfyUI_Eagle_Suite.RandomLineInputs",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            const widget = this.widgets && this.widgets.find(w => w.name === "input_count");
            if (widget) {
                const originalCallback = widget.callback;
                widget.callback = (value) => {
                    const v = parseInt(value, 10);
                    if (!Number.isNaN(v)) {
                        updateInputs(this, v);
                    }
                    if (originalCallback) originalCallback(value);
                };
                // 初始化一次
                updateInputs(this, widget.value);
            }
            return r;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (o) {
            const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
            const widget = this.widgets && this.widgets.find(w => w.name === "input_count");
            if (widget) {
                updateInputs(this, widget.value);
            }
            return r;
        };
    },
});
