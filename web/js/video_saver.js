/**
 * 🦅 Eagle Video Saver Suite - 前端扩展
 * 同步支持新的节点：EagleImagesToVideo, EagleVideoConverter
 */
(function () {
    "use strict";

    const TARGET_NODES = ["EagleImagesToVideo", "EagleVideoConverter"];
    
    const SECTION_DEFS = [
        { key: "核心保存",    widgets: ["images", "video", "input_video", "eagle_folder", "local_save_path", "filename_prefix"] },
        { key: "输出格式",    widgets: ["format", "fps", "quality", "crf", "speed", "target_fps"] },
        { key: "尺寸控制",    widgets: ["size_mode", "width", "height"] },
        { key: "音频/蒙版",   widgets: ["mask", "audio"] },
        { key: "Eagle元数据", widgets: ["tags", "annotation", "star"] },
    ];

    function getWidgetIndex(node, name) {
        return node.widgets ? node.widgets.findIndex(w => w.name === name) : -1;
    }

    function insertSeparator(node, insertIdx, label) {
        const widgets = node.widgets;
        const sepName = "__sep__" + label;
        if (widgets[insertIdx] && widgets[insertIdx].name === sepName) return insertIdx;

        const sep = {
            type: "text",
            name: sepName,
            value: "── " + label + " ──",
            disabled: true,
            computeSize: () => [node.width, 28],
            draw: function (ctx, node, widget_width, y, H) {
                ctx.save();
                ctx.fillStyle = "#ff9500"; // 鲜艳的 Eagle 橙
                ctx.font = "bold 12px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("── " + label + " ──", node.width / 2, y + H - 8);
                ctx.restore();
            }
        };
        widgets.splice(insertIdx, 0, sep);
        return insertIdx + 1;
    }

    function applyCollapsibleSections(node) {
        if (node._eagle_sections_applied) return;
        node._eagle_sections_applied = true;

        let offset = 0;
        for (const sec of SECTION_DEFS) {
            let firstIdx = -1;
            for (const wName of sec.widgets) {
                const idx = getWidgetIndex(node, wName);
                if (idx !== -1) { firstIdx = idx + offset; break; }
            }
            if (firstIdx === -1) continue;
            insertSeparator(node, firstIdx, sec.key);
            offset += 1;
        }
    }

    function setupVideoPreview(node) {
        // 扩展已有的 onExecuted 逻辑
        const onExecuted = node.onExecuted;
        node.onExecuted = function (output) {
            if (onExecuted) onExecuted.apply(this, arguments);
            if (!output || !output.video || !output.video[0]) return;
            
            const filename = output.video[0];
            const url = `./view?filename=${encodeURIComponent(filename)}&type=output`;
            
            if (!this._eagle_video_el) {
                const el = document.createElement("video");
                el.controls = true;
                el.loop = true;
                el.style.width = "100%";
                el.style.marginTop = "10px";
                el.style.borderRadius = "8px";
                el.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
                this._eagle_video_el = el;
                // 将元素插入到 UI
                this.addDOMWidget("video_preview", "PROVIEW", el);
            }
            this._eagle_video_el.src = url;
            this._eagle_video_el.load();
        };
    }

    if (typeof app !== "undefined" && app.registerExtension) {
        app.registerExtension({
            name: "ComfyUI_Eagle_Suite.VideoNodes",
            async nodeCreated(node) {
                if (TARGET_NODES.includes(node.type) || TARGET_NODES.includes(node.constructor.name)) {
                    applyCollapsibleSections(node);
                    setupVideoPreview(node);
                }
            },
            async beforeRegisterNodeDef(nodeType, nodeData, app) {
                if (TARGET_NODES.includes(nodeData.name)) {
                    const onNodeCreated = nodeType.prototype.onNodeCreated;
                    nodeType.prototype.onNodeCreated = function () {
                        if (onNodeCreated) onNodeCreated.apply(this, arguments);
                        applyCollapsibleSections(this);
                        setupVideoPreview(this);
                    };
                }
            },
        });
    }
})();
