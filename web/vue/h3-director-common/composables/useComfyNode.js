/**
 * useComfyNode — 修复版节点挂载助手。
 *
 * 注意：gallery-common 里的 registerVueGallery() 因 requireVue() 缺陷是死代码，
 * 这里直接照搬 eagle_gallery.js 的内联写法并抽成可复用函数。必须从调用方传入
 * createApp（避免循环依赖），且 CSS 由 styles/h3-director-theme.js 注入。
 */
import { createApp } from "../../../lib/vue.esm-browser.js";
import { H3D_CSS } from "../styles/h3-director-theme.js";

console.log("[EagleH3Director] useComfyNode.js loaded");

export function mountH3Director(nodeType, vueComponent, options = {}) {
    const {
        widgetName = "h3_director",
        defaultSize = [1280, 760],
        minHeight = 420,
    } = options;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (onNodeCreated) onNodeCreated.apply(this, arguments);
        if (this._h3Init) return;
        this._h3Init = true;

        this.setSize(defaultSize);

        const hideWidgets = (node) => {
            if (!node.widgets || !node.widgets.length) return false;
            let found = false;
            for (const w of node.widgets) {
                if (w.name === "h3_state") {
                    w.type = "hidden";
                    w.computeSize = () => [0, -4];
                    w.hidden = true;
                    w.draw = () => {};
                    found = true;
                }
            }
            if (found) node.setDirtyCanvas(true, true);
            return found;
        };
        setTimeout(() => {
            if (!hideWidgets(this)) setTimeout(() => hideWidgets(this), 500);
        }, 300);

        if (!document.getElementById("h3d-style")) {
            const s = document.createElement("style");
            s.id = "h3d-style";
            s.textContent = H3D_CSS;
            document.head.appendChild(s);
        }

        const el = document.createElement("div");
        el.style.cssText = `width:100%;height:100%;min-height:${minHeight}px;overflow:hidden;position:relative;`;

        const widget = this.addDOMWidget(widgetName, "div", el, { serialize: false });

        const applyHeight = (nodeHeight) => {
            const h = Math.max(minHeight, (nodeHeight || minHeight) - 100);
            el.style.height = h + "px";
            if (widget) widget.lastHeight = h;
            return h;
        };
        applyHeight(this.size ? this.size[1] : minHeight);

        if (widget) {
            widget.computeSize = function (width) {
                return [width, widget.lastHeight || minHeight];
            };
        }

        const nodeRef = this;
        console.log("[EagleH3Director] mounting Vue app on node", nodeRef.id);
        try {
            const appInstance = createApp(vueComponent, { node: nodeRef });
            appInstance.mount(el);
            this._vueApp = appInstance;
            console.log("[EagleH3Director] Vue app mounted");
        } catch (e) {
            el.replaceChildren();
            const errorBox = document.createElement("div");
            errorBox.style.cssText = "padding:30px;min-height:120px;color:#ff6b6b;background:#1a0b0b;border:1px solid #ff6b6b;border-radius:8px";
            errorBox.textContent = "H3 Director 加载失败: " + (e && e.message ? e.message : "unknown error");
            el.appendChild(errorBox);
            console.error("[EagleH3Director] mount failed:", e);
        }

        const onResize = this.onResize;
        this.onResize = function (size) {
            if (onResize) onResize.apply(this, arguments);
            applyHeight(size[1]);
        };
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        if (this._vueApp) {
            this._vueApp.unmount();
            this._vueApp = null;
        }
        if (onRemoved) onRemoved.apply(this, arguments);
    };
}
