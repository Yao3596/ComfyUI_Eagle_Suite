// ComfyUI Eagle Suite - VIDEO、MASK、AUDIO 类型定义
// VIDEO: 绿色连接线
// MASK: 灰色连接线
// AUDIO: 紫色连接线

(function() {
    'use strict';

    const TYPE_COLORS = {
        'VIDEO': '#00FF00',  // 绿色
        'MASK': '#888888',   // 灰色
        'AUDIO': '#AA55FF',  // 紫色
    };

    // 等待 app 加载
    function waitForApp(callback) {
        if (window.app && window.app.registerExtension) {
            callback();
        } else {
            setTimeout(function() { waitForApp(callback); }, 500);
        }
    }

    waitForApp(function() {
        console.log('[Eagle Suite] 注册 VIDEO/MASK/AUDIO 类型扩展');

        // 注册扩展
        window.app.registerExtension({
            name: 'ComfyUI_Eagle_Suite.TypeColors',

            // 扩展初始化
            setup: function() {
                console.log('[Eagle Suite] 类型颜色扩展初始化完成');
            },

            // 在节点创建前
            beforeRegisterNodeDef: function(nodeType, nodeData, app) {
                // 可以在此预处理节点定义
            },

            // 节点创建后 - 设置端口颜色
            nodeCreated: function(node, app) {
                // 设置输出端口颜色
                if (node.outputs) {
                    for (var i = 0; i < node.outputs.length; i++) {
                        var output = node.outputs[i];
                        var color = TYPE_COLORS[output.type];
                        if (color) {
                            output.color = color;
                            output.borderColor = color;
                            // 标记已处理
                            output.processedByEagle = true;
                        }
                    }
                }

                // 设置输入端口颜色
                if (node.inputs) {
                    for (var j = 0; j < node.inputs.length; j++) {
                        var input = node.inputs[j];
                        var color = TYPE_COLORS[input.type];
                        if (color) {
                            input.color = color;
                            input.borderColor = color;
                            // 标记已处理
                            input.processedByEagle = true;
                        }
                    }
                }
            }
        });

        // 添加 CSS 样式
        var styleEl = document.createElement('style');
        styleEl.id = 'eagle-suite-type-colors';
        styleEl.textContent = [
            '/* VIDEO 类型连接线 - 绿色 */',
            '.link_type_VIDEO {',
            '    stroke: #00FF00 !important;',
            '}',
            '',
            '/* MASK 类型连接线 - 灰色 */',
            '.link_type_MASK {',
            '    stroke: #888888 !important;',
            '}',
            '',
            '/* AUDIO 类型连接线 - 紫色 */',
            '.link_type_AUDIO {',
            '    stroke: #AA55FF !important;',
            '}',
            '',
            '/* 端口标记颜色 - VIDEO */',
            '.node .output .link_marker.type_VIDEO,',
            '.node .output.link_type_VIDEO .link_marker,',
            '.node .input .link_marker.type_VIDEO,',
            '.node .input.link_type_VIDEO .link_marker {',
            '    background-color: #00FF00 !important;',
            '}',
            '',
            '/* 端口标记颜色 - MASK */',
            '.node .output .link_marker.type_MASK,',
            '.node .output.link_type_MASK .link_marker,',
            '.node .input .link_marker.type_MASK,',
            '.node .input.link_type_MASK .link_marker {',
            '    background-color: #888888 !important;',
            '}',
            '',
            '/* 端口标记颜色 - AUDIO */',
            '.node .output .link_marker.type_AUDIO,',
            '.node .output.link_type_AUDIO .link_marker,',
            '.node .input .link_marker.type_AUDIO,',
            '.node .input.link_type_AUDIO .link_marker {',
            '    background-color: #AA55FF !important;',
            '}',
            '',
            '/* 高亮效果 */',
            '.link_type_VIDEO:hover,',
            '.link_type_MASK:hover,',
            '.link_type_AUDIO:hover {',
            '    stroke-width: 3px !important;',
            '}'
        ].join('\n');
        document.head.appendChild(styleEl);

        console.log('[Eagle Suite] VIDEO/MASK/AUDIO 类型扩展加载完成');
    });
})();
