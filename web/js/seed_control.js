import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

app.registerExtension({
    name: "eagle.seed_control",
    async nodeCreated(node) {
        // 通过 widget 检测，不依赖类名
        const ctrlWidget = node.widgets?.find(w => w.name === "control_mode");
        const idxWidget  = node.widgets?.find(w => w.name === "index");
        if (!ctrlWidget || !idxWidget) return;

        console.log(`[seed_control] 已挂载: ${node.comfyClass} #${node.id}`);

        const origOnExecuted = node.onExecuted;
        node.onExecuted = function (output) {
            origOnExecuted?.apply(this, arguments);

            const backendManaged = node.comfyClass === "LocalImageLoader";
            if (backendManaged) {
                // 本地图片加载器由后端维护批次游标。这里只根据后端真实结果显示
                // 下一次起始值，不能再盲目 +/-1，否则中断或重新排队后会漂移。
                const current = Number(output?.current_index?.[0]);
                const total = Number(output?.total?.[0]);
                if (Number.isFinite(current)) {
                    if (ctrlWidget.value === "增加") {
                        idxWidget.value = Number.isFinite(total) && total > 0
                            ? (current + 1) % total
                            : current + 1;
                    } else if (ctrlWidget.value === "减少") {
                        idxWidget.value = Number.isFinite(total) && total > 0
                            ? (current - 1 + total) % total
                            : Math.max(0, current - 1);
                    }
                }
            } else {
                switch (ctrlWidget.value) {
                    case "增加":
                        idxWidget.value += 1;
                        break;
                    case "减少":
                        idxWidget.value = Math.max(0, idxWidget.value - 1);
                        break;
                    case "随机":
                        idxWidget.value = Math.floor(Math.random() * 0x7FFFFFFF);
                        break;
                }
            }

            // 强制刷新画布，确保 index 值变化可见
            app.graph.setDirtyCanvas(true, true);

            // 图片预览
            if (output?.images?.length) {
                this.imgs = output.images.map(params => {
                    const el = new Image();
                    el.src = api.apiURL(
                        `/view?filename=${encodeURIComponent(params.filename)}` +
                        `&type=${params.type}` +
                        `&subfolder=${encodeURIComponent(params.subfolder || "")}`
                    );
                    return el;
                });
                requestAnimationFrame(() => {
                    this.setSizeForImage?.();
                });
            }
        };
    },
});
