// api_unified.js - Eagle API 节点前端扩展（稳定版 v3.3）
// 功能：API Key 密码框、右键菜单显示/隐藏切换、安全保存、连线状态提示

import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "ComfyUI_Eagle_Suite.APIUnified",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "EagleAPIUnifiedNode") return;

        console.log("[EagleAPI] 注册节点:", nodeData.name);

        const originalNodeCreated = nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function() {
            if (originalNodeCreated) {
                originalNodeCreated.apply(this, arguments);
            }

            // 设置节点颜色
            this.color = "#2D4A22";
            this.bgcolor = "#1a2e12";

            // 添加显示/隐藏状态
            this._showApiKey = false;

            // ── 监听 api_config 输入端口连接状态 ──────────────────
            // 当用户连线或断开 api_config 复合端口时，刷新 widget 提示
            this.onConnectionsChange = function(type, index, connected, link_info) {
                const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
                if (origOnConnectionsChange) {
                    origOnConnectionsChange?.apply(this, arguments);
                }
                try {
                    // api_config 是 optional 端口，索引在 required 端口数之后
                    const apiConfigSlot = this.inputs?.findIndex(i => i.name === 'api_config');
                    if (apiConfigSlot >= 0) {
                        const isConnected = this.inputs[apiConfigSlot].link != null;
                        this._apiConfigConnected = isConnected;
                        this.setDirtyCanvas(true, true);
                    }
                } catch (e) { /* 忽略 */ }
            };

            console.log("[EagleAPI] 节点已创建:", this.id);
        };

        // 添加自定义菜单选项
        const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function(_, options) {
            if (originalGetExtraMenuOptions) {
                originalGetExtraMenuOptions.apply(this, arguments);
            }

            const apiKeyWidget = this.widgets.find(w => w.name === "api_config_key");
            if (apiKeyWidget) {
                // 添加分隔线
                options.push(null);

                // 添加显示/隐藏选项
                options.push({
                    content: this._showApiKey ? "🔒 隐藏 API Key" : "👁️ 显示 API Key",
                    callback: () => {
                        this._showApiKey = !this._showApiKey;

                        // 更新输入框类型
                        try {
                            const widgetElement = apiKeyWidget.inputEl || apiKeyWidget.element;
                            if (widgetElement && widgetElement.tagName === "INPUT") {
                                widgetElement.type = this._showApiKey ? "text" : "password";
                            }
                        } catch (e) {
                            console.log("[EagleAPI] 切换显示失败:", e);
                        }

                        this.setDirtyCanvas(true, true);
                    }
                });
            }
        };
    },

    async nodeCreated(node) {
        if (node.comfyClass !== "EagleAPIUnifiedNode") return;

        console.log("[EagleAPI] 配置节点:", node.id);

        // 延迟执行以确保 widgets 已创建
        setTimeout(() => {
            this._setupNode(node);
        }, 100);
    },

    _setupNode(node) {
        if (!node.widgets) {
            console.log("[EagleAPI] 节点没有 widgets");
            return;
        }

        // 查找 API Key widget（后端字段名为 api_config_key）
        const apiKeyWidget = node.widgets.find(w => w.name === "api_config_key");

        if (apiKeyWidget) {
            this._setupPasswordField(node, apiKeyWidget);
            this._setupSecureSave(node, apiKeyWidget);
        } else {
            console.log("[EagleAPI] 未找到 api_config_key widget，可用 widgets:",
                node.widgets.map(w => w.name));
        }

        // ── 添加诊断按钮：检查当前数据源 ──────────────────────
        node.addWidget("button", "🔍 检查配置源", null, () => {
            this._diagnoseConfigSource(node);
        });

        console.log("[EagleAPI] 节点设置完成:", node.id);
    },

    _diagnoseConfigSource(node) {
        const apiConfigSlot = node.inputs?.findIndex(i => i.name === 'api_config');
        const apiConfigConnected = apiConfigSlot >= 0 && node.inputs[apiConfigSlot].link != null;

        const keyWidget = node.widgets.find(w => w.name === 'api_config_key');
        const urlWidget = node.widgets.find(w => w.name === 'api_config_url');
        const modelWidget = node.widgets.find(w => w.name === 'api_config_model');

        const lines = [];
        lines.push("=== 🦅 Eagle API 配置诊断 ===");
        lines.push(`api_config 复合端口: ${apiConfigConnected ? '✅ 已连接' : '❌ 未连接'}`);
        lines.push("");
        lines.push("独立字段状态:");
        lines.push(`  api_config_key:  ${keyWidget?.value ? '✅ ' + keyWidget.value.slice(0, 8) + '***' : '❌ 空'}`);
        lines.push(`  api_config_url:  ${urlWidget?.value ? '✅ ' + urlWidget.value : '❌ 空'}`);
        lines.push(`  api_config_model:${modelWidget?.value ? '✅ ' + modelWidget.value : '❌ 空'}`);
        lines.push("");
        lines.push("数据优先级：");
        if (apiConfigConnected) {
            lines.push("  1️⃣  api_config 复合端口（来自配置加载器）");
            lines.push("  2️⃣  独立字段（仅当复合端口字段为空时回退）");
        } else {
            lines.push("  1️⃣  独立字段（直接填写）");
            lines.push("  2️⃣  api_config.json 中保存的上一次配置");
        }
        lines.push("");
        lines.push("提示：");
        lines.push("  • 推荐连接 API 配置加载器 → 集中管理多模型");
        lines.push("  • 复合端口字段为空时自动回退到独立字段");
        lines.push("  • 字段值以 ENC: 前缀开头为编码格式（运行时自动解码）");

        const msg = lines.join("\n");
        console.log("[EagleAPI] 配置诊断:\n" + msg);
        alert(msg);
    },

    _setupPasswordField(node, widget) {
        console.log("[EagleAPI] 设置 API Key 密码框");

        const setPasswordType = () => {
            try {
                const widgetElement = widget.inputEl || widget.element;
                if (widgetElement && widgetElement.tagName === "INPUT") {
                    // 根据显示状态设置类型
                    widgetElement.type = node._showApiKey ? "text" : "password";
                    widgetElement.autocomplete = "off";
                    if (!widgetElement.placeholder) {
                        widgetElement.placeholder = "输入您的 API Key";
                    }
                }
            } catch (e) {
                console.log("[EagleAPI] 设置密码框失败:", e);
            }
        };

        // 多次尝试设置
        setPasswordType();
        setTimeout(setPasswordType, 100);
        setTimeout(setPasswordType, 500);

        // 监听值变化
        const originalCallback = widget.callback;
        widget.callback = function(value) {
            setTimeout(setPasswordType, 10);
            if (originalCallback) originalCallback(value);
        };

        // 添加 tooltip
        widget.tooltip = "右键点击节点可切换显示/隐藏 API Key";
    },

    _setupSecureSave(node, apiKeyWidget) {
        if (!apiKeyWidget) return;

        // 在序列化时清空 API Key（防止随工作流分享）
        const originalSerialize = node.serialize;
        node.serialize = function() {
            try {
                const data = originalSerialize ? originalSerialize.apply(this, arguments) : {};

                if (data.widgets_values && apiKeyWidget) {
                    const idx = this.widgets.indexOf(apiKeyWidget);
                    if (idx !== -1 && idx < data.widgets_values.length) {
                        console.log("[EagleAPI] 保存前清空 API Key");
                        data.widgets_values[idx] = "";
                    }
                }

                return data;
            } catch (e) {
                console.log("[EagleAPI] 序列化失败:", e);
                return originalSerialize ? originalSerialize.apply(this, arguments) : {};
            }
        };
    }
});

