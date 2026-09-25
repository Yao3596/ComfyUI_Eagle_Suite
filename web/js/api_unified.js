// api_unified.js - Eagle API 节点前端扩展（稳定版 v3.4）
// 功能：API Key 密码框、旧版 ENC:Base64 读取、右键菜单显示/隐藏切换、运行时密钥、连线状态提示

import { app } from "../../../scripts/app.js";
import { redactSecretWidgetFromWorkflow } from "./workflow_secret_redaction.js";

// ── 与 Python decode_api_key 对应的编码/解码工具 ─────────────────────
const _ENC_PREFIX = "ENC:";
const _SUPPORTED_API_NODES = new Set([
    "EagleAPIUnifiedNode",
    "EagleAPIImageNode",
]);

function _decodeKey(str) {
    if (!str) return "";
    if (typeof str !== "string") str = String(str);
    if (!str.startsWith(_ENC_PREFIX)) return str;
    try { return decodeURIComponent(atob(str.slice(_ENC_PREFIX.length))); } catch { return str; }
}

app.registerExtension({
    name: "ComfyUI_Eagle_Suite.APIUnified",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (!_SUPPORTED_API_NODES.has(nodeData.name)) return;

        console.log("[EagleAPI] 注册节点:", nodeData.name);

        const inputDefs = nodeData?.input || nodeData?.inputs;
        for (const groupName of ["required", "optional"]) {
            const definition = inputDefs?.[groupName]?.api_config_key;
            if (!Array.isArray(definition)) continue;
            definition[1] = { ...(definition[1] || {}), hidden: true, vueNode: "never", hideInPanel: true };
        }

        if (nodeData.name === "EagleAPIImageNode") {
            const previousConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function() {
                const result = previousConfigure?.apply(this, arguments);
                const mode = this.widgets?.find(widget => widget.name === "output_resize_mode");
                // Old workflows can have the diagnostic button's null value in
                // this newly appended slot. Do not overwrite a valid selection.
                if (mode && !["适应留边", "裁剪填满", "拉伸", "保留API原图", "尺寸不符时报错"].includes(mode.value)) {
                    mode.value = "适应留边";
                }
                return result;
            };
            const previousExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function(data) {
                previousExecuted?.apply(this, arguments);
                const text = Array.isArray(data?.text) ? data.text.join("\n") : data?.text;
                if (text && this._eagleImageSizeStatus) {
                    this._eagleImageSizeStatus.textContent = String(text);
                    this.setDirtyCanvas?.(true, true);
                }
            };
        }

        const originalNodeCreated = nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function() {
            if (originalNodeCreated) {
                originalNodeCreated.apply(this, arguments);
            }

            // 对话节点使用绿色，生图节点使用紫色。
            const isImageNode = nodeData.name === "EagleAPIImageNode";
            this.color = isImageNode ? "#4A2D55" : "#2D4A22";
            this.bgcolor = isImageNode ? "#2A1833" : "#1a2e12";

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
                            const widgetElement = this._eagleApiKeyInput || apiKeyWidget.inputEl || apiKeyWidget.element;
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
        if (!_SUPPORTED_API_NODES.has(node.comfyClass)) return;

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
        if (node.comfyClass === "EagleAPIImageNode" && !node._eagleImageSizeStatus) {
            const status = document.createElement("div");
            status.style.cssText = "box-sizing:border-box;width:100%;min-height:72px;padding:8px;background:#171321;color:#dbd5e8;border:1px solid #564061;border-radius:6px;font:12px/1.5 sans-serif;white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere";
            status.textContent = "尺寸诊断：等待执行。比例/分辨率仅在 size=比例预设时生效；4K 长边=3840。input_resize_mode 只控制上传参考图。";
            node.addDOMWidget("eagle_image_size_status", "div", status, { serialize: false, hideInPanel: true, hideOnZoom: false });
            node._eagleImageSizeStatus = status;
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
        lines.push(`  api_config_key:  ${keyWidget?.value ? '✅ 已填写（值不显示）' : '❌ 空'}`);
        lines.push(`  api_config_url:  ${urlWidget?.value ? '✅ ' + urlWidget.value : '❌ 空'}`);
        lines.push(`  api_config_model:${modelWidget?.value ? '✅ ' + modelWidget.value : '❌ 空'}`);
        lines.push("");
        lines.push("数据优先级：");
        if (apiConfigConnected) {
            lines.push("  1️⃣  api_config 复合端口（来自配置加载器）");
            lines.push("  2️⃣  独立字段（仅当复合端口字段为空时回退）");
        } else {
            lines.push("  1️⃣  独立字段（直接填写）");
            lines.push("  2️⃣  api_config.json 中的第一组配置");
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
        if (node._eagleApiKeyInput) return;
        // The native STRING editor can be remounted as plain text by Vue
        // Nodes 2.0. Keep its serializable runtime value, but display only a
        // node-owned password DOM widget in both node renderers.
        widget.hidden = true;
        widget.options ||= {};
        Object.assign(widget.options, { hidden: true, vueNode: "never", hideInPanel: true });
        const widgetIndex = node.widgets?.indexOf(widget) ?? -1;
        if (widgetIndex >= 0) node.widgets.splice(widgetIndex, 1, widget);
        const container = document.createElement("div");
        container.style.cssText = "box-sizing:border-box;width:100%;padding:8px;background:#171321;border:1px solid #564061;border-radius:6px;color:#dbd5e8;font:12px sans-serif";
        const label = document.createElement("label");
        label.textContent = "API Key";
        label.style.cssText = "display:block;margin-bottom:5px";
        const input = document.createElement("input");
        input.type = "password";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.placeholder = "输入您的 API Key";
        input.style.cssText = "box-sizing:border-box;width:100%;min-height:30px;padding:5px;color:#eee;background:#20202b;border:1px solid #56566a;border-radius:4px";
        input.value = _decodeKey(widget.value);
        input.addEventListener("input", () => {
            widget.value = input.value;
            widget.callback?.(input.value);
        });
        container.appendChild(label);
        container.appendChild(input);
        node.addDOMWidget("eagle_api_key_password", "div", container,
                          { serialize: false, hideInPanel: true, hideOnZoom: false });
        node._eagleApiKeyInput = input;

        // Legacy workflow restore and external widget updates must refresh the
        // password field without exposing the native STRING editor.
        const originalCallback = widget.callback;
        widget.callback = function(value) {
            if (input.value !== String(value ?? "")) input.value = _decodeKey(value);
            if (originalCallback) originalCallback(value);
        };
        widget.tooltip = "API Key 在节点内使用密码框编辑；工作流导出会剔除密钥";
    },

    _setupSecureSave(node, apiKeyWidget) {
        if (!apiKeyWidget) return;

        // 加载工作流时：如果值是 ENC:xxx，解码回明文显示给用户
        const originalOnConfigure = node.onConfigure;
        node.onConfigure = function(config) {
            if (originalOnConfigure) {
                originalOnConfigure.apply(this, arguments);
            }
            try {
                const idx = this.widgets.indexOf(apiKeyWidget);
                const val = config?.widgets_values_named?.[apiKeyWidget.name]
                    ?? (config?.widgets_values && idx >= 0 ? config.widgets_values[idx] : undefined);
                if (val && typeof val === "string" && val.startsWith(_ENC_PREFIX)) {
                    apiKeyWidget.value = _decodeKey(val);
                    // The shared named-value restore hook may run after this hook.
                    queueMicrotask(() => {
                        if (typeof apiKeyWidget.value === "string" && apiKeyWidget.value.startsWith(_ENC_PREFIX)) {
                            apiKeyWidget.value = _decodeKey(apiKeyWidget.value);
                        }
                    });
                    console.log("[EagleAPI] 工作流加载时解码旧版 API Key");
                }
                if (this._eagleApiKeyInput) {
                    this._eagleApiKeyInput.value = _decodeKey(apiKeyWidget.value);
                }
            } catch (e) {
                console.log("[EagleAPI] 解码工作流 API Key 失败:", e);
            }
        };

        // Exported workflows must contain no API key; ENC:Base64 is reversible.
        const originalSerialize = node.serialize;
        node.serialize = function() {
            const data = originalSerialize ? originalSerialize.apply(this, arguments) : {};
            return redactSecretWidgetFromWorkflow(data, this, apiKeyWidget);
        };
    }
});

