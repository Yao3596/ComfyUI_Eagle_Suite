// api_unified.js - Eagle API 节点前端扩展（稳定版 v3.2）
// 功能：API Key 密码框、右键菜单显示/隐藏切换、安全保存

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
            
            console.log("[EagleAPI] 节点已创建:", this.id);
        };
        
        // 添加自定义菜单选项
        const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function(_, options) {
            if (originalGetExtraMenuOptions) {
                originalGetExtraMenuOptions.apply(this, arguments);
            }
            
            const apiKeyWidget = this.widgets.find(w => w.name === "api_key");
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

        // 查找 API Key widget
        const apiKeyWidget = node.widgets.find(w => w.name === "api_key");

        if (apiKeyWidget) {
            this._setupPasswordField(node, apiKeyWidget);
            this._setupSecureSave(node, apiKeyWidget);
        }

        // 注：system_prompt / user_prompt 保持 ComfyUI 原生 multiline 行为
        // 不添加任何自定义样式，让节点拖拽自由控制宽高

        console.log("[EagleAPI] 节点设置完成:", node.id);
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
