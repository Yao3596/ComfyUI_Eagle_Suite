/**
 * Eagle Suite - Prompt Presets (Vue 3)
 * 移植自 HugoTools，采用 Eagle Gallery 同款 Vue 风格
 */
import { app } from "../../../scripts/app.js";
import { createApp, h, ref, onMounted } from "../lib/vue.esm-browser.js";

var PromptPresets = {
  name: "PromptPresets",
  props: { node: { type: Object, required: true } },
  setup: function(props) {
    var query = ref("");
    var category = ref("图片编辑 (kontext)");
    var categories = ref([]);
    var target = ref("");
    var page = ref(1);
    var pageSize = ref(20);
    var totalPages = ref(1);
    var items = ref([]);
    var loading = ref(false);

    function setPromptWidget(val) {
      try {
        var w = (props.node.widgets || []).find(function(x) { return x.name === "prompt"; });
        if (w) w.value = val || "";
      } catch (e) {}
    }

    function loadCategories() {
      fetch("/eaglePromptPresets/search_template?page=1&page_size=1")
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success && d.data.categories) {
            categories.value = d.data.categories;
            if (categories.value.length && categories.value.indexOf(category.value) < 0) {
              category.value = categories.value[0];
            }
            loadList(1);
          }
        }).catch(function(e) { console.error(e); });
    }

    function loadList(targetPage) {
      if (loading.value) return;
      loading.value = true;
      page.value = targetPage || 1;
      var url = "/eaglePromptPresets/search_template?page=" + page.value
        + "&page_size=" + pageSize.value
        + "&category=" + encodeURIComponent(category.value)
        + (query.value ? "&keyword=" + encodeURIComponent(query.value) : "");
      fetch(url).then(function(r) { return r.json(); }).then(function(d) {
        loading.value = false;
        if (d.success) {
          items.value = d.data.list_data || [];
          totalPages.value = d.data.total_pagenum || 1;
          if (d.data.categories && d.data.categories.length) categories.value = d.data.categories;
        }
      }).catch(function(e) {
        loading.value = false;
        console.error("[PromptPresets] load failed", e);
      });
    }

    function doSearch() { page.value = 1; loadList(1); }

    function apply(item) {
      var instruction = item.Instruction || "";
      var text = instruction.replace(/__TARGET__/g, target.value || "");
      setPromptWidget(text);
    }

    onMounted(function() {
      loadCategories();
    });

    return function() {
      var rows = items.value.map(function(item) {
        return h("div", { class: "pp-item", key: item.Label, onClick: function() { apply(item); } }, [
          h("div", { class: "pp-label" }, item.Label),
          h("div", { class: "pp-ins" }, item.Instruction),
          item.example ? h("div", { class: "pp-ex" }, "例：" + item.example) : null
        ]);
      });

      return h("div", { class: "pp-root" }, [
        h("div", { class: "pp-bar" }, [
          h("select", { class: "pp-sel", value: category.value, onChange: function(e) { category.value = e.target.value; doSearch(); } },
            categories.value.map(function(c) { return h("option", { value: c }, c); })
          ),
          h("input", { class: "pp-srch", type: "text", value: query.value, placeholder: "搜索模板...",
            onInput: function(e) { query.value = e.target.value; },
            onKeyup: function(e) { if (e.key === "Enter") doSearch(); }
          }),
          h("button", { class: "pp-btn", onClick: doSearch }, "搜索")
        ]),
        h("div", { class: "pp-target" }, [
          h("label", { class: "pp-tl" }, "目标对象 / 替换词:"),
          h("input", { class: "pp-ti", type: "text", value: target.value,
            onInput: function(e) { target.value = e.target.value; }
          })
        ]),
        h("div", { class: "pp-list" }, loading.value ? [h("div", { class: "pp-loading" }, "加载中...")] : rows),
        h("div", { class: "pp-pager" }, [
          h("button", { class: "pp-btn", onClick: function() { if (page.value > 1) loadList(page.value - 1); } }, "上一页"),
          h("span", { class: "pp-page" }, page.value + " / " + totalPages.value),
          h("button", { class: "pp-btn", onClick: function() { if (page.value < totalPages.value) loadList(page.value + 1); } }, "下一页")
        ])
      ]);
    };
  }
};

var CSS = [
  ".pp-root{display:flex;flex-direction:column;height:100%;background:#121216;color:#bbb;font:12px/1.5 system-ui;overflow:hidden}",
  ".pp-bar{display:flex;gap:6px;padding:6px 8px;background:#1a1a22;border-bottom:1px solid #2a2a32;align-items:center;flex-wrap:wrap}",
  ".pp-srch{flex:1;min-width:80px;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px}",
  ".pp-sel{padding:5px 6px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;cursor:pointer}",
  ".pp-btn{padding:5px 10px;border:1px solid #333;border-radius:6px;background:#1c1c26;color:#c8c8cc;font-size:11px;cursor:pointer;transition:all .2s}",
  ".pp-btn:hover{background:#2a2a36;border-color:#4a7de0;color:#fff}",
  ".pp-target{display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #2a2a32;background:#16161e}",
  ".pp-tl{font-size:11px;color:#999;white-space:nowrap}",
  ".pp-ti{flex:1;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px}",
  ".pp-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px}",
  ".pp-item{padding:10px;border-radius:6px;background:#1a1a24;border:1px solid #2a2a32;cursor:pointer;transition:all .2s}",
  ".pp-item:hover{border-color:#4a7de0;background:#1e2a40}",
  ".pp-label{font-size:12px;color:#fff;font-weight:600;margin-bottom:4px}",
  ".pp-ins{font-size:11px;color:#ccc;margin-bottom:4px}",
  ".pp-ex{font-size:10px;color:#888}",
  ".pp-loading{padding:30px;color:#777;text-align:center}",
  ".pp-pager{display:flex;gap:8px;align-items:center;justify-content:center;padding:6px;border-top:1px solid #2a2a32;background:#1a1a22}",
  ".pp-page{font-size:11px;color:#999}"
].join("\n");

app.registerExtension({
  name: "EagleSuite.PromptPresets",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EaglePromptPresets") return;

    var hideWidgets = function(node) {
      if (!node.widgets || !node.widgets.length) return false;
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var w = node.widgets[i];
        if (w.name !== "prompt") continue;
        w.type = "hidden";
        w.computeSize = function() { return [0, -4]; };
        w.hidden = true;
        w.draw = function() {};
        found = true;
      }
      if (found) node.setDirtyCanvas(true, true);
      return found;
    };

    var orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      if (orig) orig.apply(this, arguments);
      if (this._ppInit) return;
      this._ppInit = true;

      this.setSize([520, 540]);
      setTimeout(function(node) {
        return function() { if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500); };
      }(this), 300);

      if (!document.getElementById("pp-style")) {
        var s = document.createElement("style"); s.id = "pp-style"; s.textContent = CSS; document.head.appendChild(s);
      }

      var el = document.createElement("div");
      el.style.cssText = "width:100%;height:100%;overflow:hidden;border-radius:0 0 8px 8px;background:#121216;";
      this.addDOMWidget("prompt_presets", "div", el, { serialize: false });

      var applyHeight = function(h) { el.style.height = Math.max(300, h - 64) + "px"; };
      applyHeight(this.size[1]);

      var nodeRef = this;
      try {
        var appInstance = createApp(PromptPresets, { node: nodeRef });
        appInstance.mount(el);
        this._vueApp = appInstance;
      } catch (e) {
        console.error("[PromptPresets] mount failed:", e);
        el.innerHTML = '<div style="padding:30px;color:#e55">Error: ' + e.message + "</div>";
      }

      var onResize = this.onResize;
      this.onResize = function(size) {
        if (onResize) onResize.apply(this, arguments);
        applyHeight(size[1]);
      };
    };

    var onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function() {
      if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  }
});
