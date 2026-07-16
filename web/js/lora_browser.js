/**
 * Eagle Suite - LoRA Browser (Vue 3)
 * 移植自 HugoTools，采用 Eagle Gallery 同款 Vue 风格
 */
import { app } from "../../../scripts/app.js";
import { createApp, h, ref, onMounted } from "../lib/vue.esm-browser.js";

var LoraBrowser = {
  name: "LoraBrowser",
  props: { node: { type: Object, required: true } },
  setup: function(props) {
    var query = ref("");
    var sortOption = ref("name");
    var sortDir = ref("asc");
    var page = ref(1);
    var pageSize = ref(30);
    var totalPages = ref(1);
    var items = ref([]);
    var loading = ref(false);
    var selectedPath = ref("");
    var loraDirectory = ref("");

    function setPathWidget(val) {
      try {
        var w = (props.node.widgets || []).find(function(x) { return x.name === "lora_path"; });
        if (w) w.value = val || "";
      } catch (e) {}
    }

    function readPathWidget() {
      try {
        var w = (props.node.widgets || []).find(function(x) { return x.name === "lora_path"; });
        if (w && w.value) selectedPath.value = String(w.value);
      } catch (e) {}
    }

    function formatSize(bytes) {
      if (!bytes) return "0 B";
      var units = ["B", "KB", "MB", "GB"];
      var i = 0;
      var size = bytes;
      while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
      return size.toFixed(i === 0 ? 0 : 1) + " " + units[i];
    }

    function loadList(targetPage) {
      if (loading.value) return;
      loading.value = true;
      page.value = targetPage || 1;
      var url = "/EagleLoraList/loadLoraList?page=" + page.value
        + "&page_size=" + pageSize.value
        + "&sort_option=" + encodeURIComponent(sortOption.value)
        + "&sort_direction=" + encodeURIComponent(sortDir.value)
        + (query.value ? "&keyword=" + encodeURIComponent(query.value) : "");
      fetch(url).then(function(r) { return r.json(); }).then(function(d) {
        loading.value = false;
        if (d.success) {
          items.value = d.data.list_data || [];
          totalPages.value = d.data.total_pagenum || 1;
          loraDirectory.value = d.data.lora_directory || "";
        }
      }).catch(function(e) {
        loading.value = false;
        console.error("[LoraBrowser] load failed", e);
      });
    }

    function doSearch() { page.value = 1; loadList(1); }

    function selectItem(item) {
      selectedPath.value = item.path || "";
      setPathWidget(selectedPath.value);
    }

    function deleteItem(item, ev) {
      if (ev) ev.stopPropagation();
      if (!confirm("删除模型：" + item.name + " ?")) return;
      fetch("/EagleLoraList/deleteLora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lora_path: item.path })
      }).then(function() { loadList(page.value); }).catch(function(e) { console.error(e); });
    }

    function renameItem(item, ev) {
      if (ev) ev.stopPropagation();
      var name = prompt("重命名为:", item.name);
      if (!name) return;
      fetch("/EagleLoraList/rename_lora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lora_path: item.path, new_name: name })
      }).then(function() { loadList(page.value); }).catch(function(e) { console.error(e); });
    }

    function clearCache() {
      fetch("/EagleLoraList/clearCache", { method: "POST" })
        .then(function() { loadList(1); }).catch(function(e) { console.error(e); });
    }

    function thumbSrc(item) {
      if (!item.name) return "";
      return "/eagle/lora/" + item.name.replace(/\\/g, "/");
    }

    onMounted(function() {
      readPathWidget();
      loadList(1);
    });

    return function() {
      var cards = items.value.map(function(item) {
        var sel = selectedPath.value === item.path;
        return h("div", {
          key: item.name,
          class: "lb-card" + (sel ? " sel" : ""),
          onClick: function() { selectItem(item); }
        }, [
          h("div", { class: "lb-img-box" }, [
            h("img", { src: thumbSrc(item), class: "lb-img", loading: "lazy",
              onError: function(e) {
                if (e.target._err) return;
                e.target._err = true;
                e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%231a1a24'/%3E%3Ctext x='50' y='55' text-anchor='middle' fill='%23555' font-size='10'%3E无预览%3C/text%3E%3C/svg%3E";
              }
            }),
            h("span", { class: "lb-size" }, formatSize(item.size))
          ]),
          h("div", { class: "lb-name", title: item.name }, item.name),
          h("div", { class: "lb-actions" }, [
            h("button", { class: "lb-btn-sm", onClick: function(e) { renameItem(item, e); } }, "重命名"),
            h("button", { class: "lb-btn-sm lb-danger", onClick: function(e) { deleteItem(item, e); } }, "删除")
          ])
        ]);
      });

      return h("div", { class: "lb-root" }, [
        h("div", { class: "lb-bar" }, [
          h("input", { class: "lb-srch", type: "text", value: query.value, placeholder: "搜索 LoRA...",
            onInput: function(e) { query.value = e.target.value; },
            onKeyup: function(e) { if (e.key === "Enter") doSearch(); }
          }),
          h("button", { class: "lb-btn", onClick: doSearch }, "搜索"),
          h("select", { class: "lb-sel", value: sortOption.value, onChange: function(e) { sortOption.value = e.target.value; doSearch(); } }, [
            h("option", { value: "name" }, "按名称"),
            h("option", { value: "size" }, "按大小"),
            h("option", { value: "modified_time" }, "按时间")
          ]),
          h("button", { class: "lb-btn", onClick: function() { sortDir.value = sortDir.value === "asc" ? "desc" : "asc"; doSearch(); } }, sortDir.value === "asc" ? "升序" : "降序"),
          h("button", { class: "lb-btn", onClick: clearCache }, "刷新缓存")
        ]),
        h("div", { class: "lb-grid" }, loading.value ? [h("div", { class: "lb-loading" }, "加载中...")] : cards),
        h("div", { class: "lb-pager" }, [
          h("button", { class: "lb-btn", onClick: function() { if (page.value > 1) loadList(page.value - 1); } }, "上一页"),
          h("span", { class: "lb-page" }, page.value + " / " + totalPages.value),
          h("button", { class: "lb-btn", onClick: function() { if (page.value < totalPages.value) loadList(page.value + 1); } }, "下一页")
        ])
      ]);
    };
  }
};

var CSS = [
  ".lb-root{display:flex;flex-direction:column;height:100%;background:#121216;color:#bbb;font:12px/1.5 system-ui;overflow:hidden}",
  ".lb-bar{display:flex;gap:6px;padding:6px 8px;background:#1a1a22;border-bottom:1px solid #2a2a32;align-items:center;flex-wrap:wrap}",
  ".lb-srch{flex:1;min-width:80px;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px}",
  ".lb-sel{padding:5px 6px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;cursor:pointer}",
  ".lb-btn{padding:5px 10px;border:1px solid #333;border-radius:6px;background:#1c1c26;color:#c8c8cc;font-size:11px;cursor:pointer;transition:all .2s}",
  ".lb-btn:hover{background:#2a2a36;border-color:#4a7de0;color:#fff}",
  ".lb-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(120px, 1fr));gap:10px;padding:10px;overflow-y:auto;flex:1;align-content:start}",
  ".lb-card{position:relative;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid transparent;background:#1a1a24;transition:all .2s}",
  ".lb-card:hover{border-color:#4a7de0}",
  ".lb-card.sel{border-color:#4a7de0;background:#1e2a40;box-shadow:inset 0 0 0 2px #4a7de0}",
  ".lb-img-box{position:relative;width:100%;aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000}",
  ".lb-img{width:100%;height:100%;object-fit:cover;display:block}",
  ".lb-size{position:absolute;top:4px;right:4px;padding:2px 5px;border-radius:4px;background:rgba(0,0,0,0.65);color:#ddd;font-size:9px;font-weight:600}",
  ".lb-name{padding:5px 6px;font-size:10px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".lb-actions{display:flex;gap:4px;padding:0 6px 6px}",
  ".lb-btn-sm{flex:1;padding:3px 0;border:1px solid #333;border-radius:4px;background:#16161e;color:#bbb;font-size:9px;cursor:pointer}",
  ".lb-btn-sm:hover{border-color:#4a7de0;color:#fff}",
  ".lb-danger:hover{border-color:#e55;color:#e55}",
  ".lb-loading{grid-column:1/-1;padding:30px;color:#777;text-align:center}",
  ".lb-pager{display:flex;gap:8px;align-items:center;justify-content:center;padding:6px;border-top:1px solid #2a2a32;background:#1a1a22}",
  ".lb-page{font-size:11px;color:#999}"
].join("\n");

app.registerExtension({
  name: "EagleSuite.LoraBrowser",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleLoraList") return;

    var hideWidgets = function(node) {
      if (!node.widgets || !node.widgets.length) return false;
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var w = node.widgets[i];
        if (w.name !== "lora_path") continue;
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
      if (this._lbInit) return;
      this._lbInit = true;

      this.setSize([680, 560]);
      setTimeout(function(node) {
        return function() { if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500); };
      }(this), 300);

      if (!document.getElementById("lb-style")) {
        var s = document.createElement("style"); s.id = "lb-style"; s.textContent = CSS; document.head.appendChild(s);
      }

      var el = document.createElement("div");
      el.style.cssText = "width:100%;height:100%;overflow:hidden;border-radius:0 0 8px 8px;background:#121216;";
      this.addDOMWidget("lora_browser", "div", el, { serialize: false });

      var applyHeight = function(h) { el.style.height = Math.max(300, h - 64) + "px"; };
      applyHeight(this.size[1]);

      var nodeRef = this;
      try {
        var appInstance = createApp(LoraBrowser, { node: nodeRef });
        appInstance.mount(el);
        this._vueApp = appInstance;
      } catch (e) {
        console.error("[LoraBrowser] mount failed:", e);
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
