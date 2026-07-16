/**
 * Eagle Suite - Image Browser (Vue 3)
 * 移植自 HugoTools，采用 Eagle Gallery 同款 Vue 风格
 */
import { app } from "../../../scripts/app.js";
import { createApp, h, ref, onMounted } from "../lib/vue.esm-browser.js";

var ImageBrowser = {
  name: "ImageBrowser",
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
    var selectOptions = ref([]);
    var imageDirectory = ref("");
    var selectedPath = ref("");

    function setPathWidget(val) {
      try {
        var w = (props.node.widgets || []).find(function(x) { return x.name === "image_path"; });
        if (w) w.value = val || "";
      } catch (e) {}
    }

    function readPathWidget() {
      try {
        var w = (props.node.widgets || []).find(function(x) { return x.name === "image_path"; });
        if (w && w.value) selectedPath.value = String(w.value);
      } catch (e) {}
    }

    function loadList(targetPage) {
      if (loading.value) return;
      loading.value = true;
      page.value = targetPage || 1;
      var url = "/EagleImageList/loadImageList?page=" + page.value
        + "&page_size=" + pageSize.value
        + "&sort_option=" + encodeURIComponent(sortOption.value)
        + "&sort_direction=" + encodeURIComponent(sortDir.value)
        + (query.value ? "&keyword=" + encodeURIComponent(query.value) : "");
      fetch(url).then(function(r) { return r.json(); }).then(function(d) {
        loading.value = false;
        if (d.success) {
          items.value = d.data.list_data || [];
          totalPages.value = d.data.total_pagenum || 1;
          selectOptions.value = d.data.select_options || [];
          imageDirectory.value = d.data.image_directory || "";
        }
      }).catch(function(e) {
        loading.value = false;
        console.error("[ImageBrowser] load failed", e);
      });
    }

    function doSearch() { page.value = 1; loadList(1); }

    function selectItem(item) {
      selectedPath.value = item.path || "";
      setPathWidget(selectedPath.value);
    }

    function deleteItem(item, ev) {
      if (ev) ev.stopPropagation();
      if (!confirm("删除图片：" + item.name + " ?")) return;
      fetch("/EagleImageList/deleteImage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_path: item.path })
      }).then(function() { loadList(page.value); }).catch(function(e) { console.error(e); });
    }

    function renameItem(item, ev) {
      if (ev) ev.stopPropagation();
      var name = prompt("重命名为:", item.name);
      if (!name) return;
      fetch("/EagleImageList/renameImage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_path: item.path, new_name: name })
      }).then(function() { loadList(page.value); }).catch(function(e) { console.error(e); });
    }

    function onUpload(ev) {
      var files = ev.target.files;
      if (!files || !files.length) return;
      var fd = new FormData();
      for (var i = 0; i < files.length; i++) fd.append("files", files[i]);
      fetch("/EagleImageList/upload", { method: "POST", body: fd })
        .then(function() { loadList(1); })
        .catch(function(e) { console.error(e); });
    }

    function changeDir(dir) {
      fetch("/EagleImageList/changeDir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: dir })
      }).then(function() { loadList(1); }).catch(function(e) { console.error(e); });
    }

    function clearCache() {
      fetch("/EagleImageList/clearCache", { method: "POST" })
        .then(function() { loadList(1); }).catch(function(e) { console.error(e); });
    }

    onMounted(function() {
      readPathWidget();
      loadList(1);
    });

    return function() {
      var cards = items.value.map(function(item) {
        var sel = selectedPath.value === item.path;
        return h("div", {
          key: item.id,
          class: "ib-card" + (sel ? " sel" : ""),
          onClick: function() { selectItem(item); }
        }, [
          h("div", { class: "ib-img-box" }, [
            h("img", { src: item.src, class: "ib-img", loading: "lazy" })
          ]),
          h("div", { class: "ib-name", title: item.name }, item.name),
          h("div", { class: "ib-actions" }, [
            h("button", { class: "ib-btn-sm", onClick: function(e) { renameItem(item, e); } }, "重命名"),
            h("button", { class: "ib-btn-sm ib-danger", onClick: function(e) { deleteItem(item, e); } }, "删除")
          ])
        ]);
      });

      return h("div", { class: "ib-root" }, [
        h("div", { class: "ib-bar" }, [
          h("input", { class: "ib-srch", type: "text", value: query.value, placeholder: "搜索图片...",
            onInput: function(e) { query.value = e.target.value; },
            onKeyup: function(e) { if (e.key === "Enter") doSearch(); }
          }),
          h("button", { class: "ib-btn", onClick: doSearch }, "搜索"),
          h("select", { class: "ib-sel", value: sortOption.value, onChange: function(e) { sortOption.value = e.target.value; doSearch(); } }, [
            h("option", { value: "name" }, "按名称"),
            h("option", { value: "created_time" }, "按时间")
          ]),
          h("button", { class: "ib-btn", onClick: function() { sortDir.value = sortDir.value === "asc" ? "desc" : "asc"; doSearch(); } }, sortDir.value === "asc" ? "升序" : "降序"),
          h("select", { class: "ib-sel", value: imageDirectory.value, onChange: function(e) { changeDir(e.target.value); } },
            selectOptions.value.map(function(d) { return h("option", { value: d }, d); })
          ),
          h("label", { class: "ib-btn ib-upload" }, [
            "上传",
            h("input", { type: "file", multiple: true, accept: "image/*", style: "display:none", onChange: onUpload })
          ]),
          h("button", { class: "ib-btn", onClick: clearCache }, "刷新缓存")
        ]),
        h("div", { class: "ib-grid" }, loading.value ? [h("div", { class: "ib-loading" }, "加载中...")] : cards),
        h("div", { class: "ib-pager" }, [
          h("button", { class: "ib-btn", onClick: function() { if (page.value > 1) loadList(page.value - 1); } }, "上一页"),
          h("span", { class: "ib-page" }, page.value + " / " + totalPages.value),
          h("button", { class: "ib-btn", onClick: function() { if (page.value < totalPages.value) loadList(page.value + 1); } }, "下一页")
        ])
      ]);
    };
  }
};

var CSS = [
  ".ib-root{display:flex;flex-direction:column;height:100%;background:#121216;color:#bbb;font:12px/1.5 system-ui;overflow:hidden}",
  ".ib-bar{display:flex;gap:6px;padding:6px 8px;background:#1a1a22;border-bottom:1px solid #2a2a32;align-items:center;flex-wrap:wrap}",
  ".ib-srch{flex:1;min-width:80px;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px}",
  ".ib-sel{padding:5px 6px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;cursor:pointer}",
  ".ib-btn{padding:5px 10px;border:1px solid #333;border-radius:6px;background:#1c1c26;color:#c8c8cc;font-size:11px;cursor:pointer;transition:all .2s}",
  ".ib-btn:hover{background:#2a2a36;border-color:#4a7de0;color:#fff}",
  ".ib-upload{cursor:pointer}",
  ".ib-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(110px, 1fr));gap:8px;padding:10px;overflow-y:auto;flex:1;align-content:start}",
  ".ib-card{position:relative;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid transparent;background:#1a1a24;transition:all .2s}",
  ".ib-card:hover{border-color:#4a7de0}",
  ".ib-card.sel{border-color:#4a7de0;background:#1e2a40;box-shadow:inset 0 0 0 2px #4a7de0}",
  ".ib-img-box{position:relative;width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000}",
  ".ib-img{width:100%;height:100%;object-fit:cover;display:block}",
  ".ib-name{padding:5px 6px;font-size:10px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".ib-actions{display:flex;gap:4px;padding:0 6px 6px}",
  ".ib-btn-sm{flex:1;padding:3px 0;border:1px solid #333;border-radius:4px;background:#16161e;color:#bbb;font-size:9px;cursor:pointer}",
  ".ib-btn-sm:hover{border-color:#4a7de0;color:#fff}",
  ".ib-danger:hover{border-color:#e55;color:#e55}",
  ".ib-loading{grid-column:1/-1;padding:30px;color:#777;text-align:center}",
  ".ib-pager{display:flex;gap:8px;align-items:center;justify-content:center;padding:6px;border-top:1px solid #2a2a32;background:#1a1a22}",
  ".ib-page{font-size:11px;color:#999}"
].join("\n");

app.registerExtension({
  name: "EagleSuite.ImageBrowser",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleImageList") return;

    var hideWidgets = function(node) {
      if (!node.widgets || !node.widgets.length) return false;
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var w = node.widgets[i];
        if (w.name !== "image_path") continue;
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
      if (this._ibInit) return;
      this._ibInit = true;

      this.setSize([620, 520]);
      setTimeout(function(node) {
        return function() { if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500); };
      }(this), 300);

      if (!document.getElementById("ib-style")) {
        var s = document.createElement("style"); s.id = "ib-style"; s.textContent = CSS; document.head.appendChild(s);
      }

      var el = document.createElement("div");
      el.style.cssText = "width:100%;height:100%;overflow:hidden;border-radius:0 0 8px 8px;background:#121216;";
      this.addDOMWidget("image_browser", "div", el, { serialize: false });

      var applyHeight = function(h) { el.style.height = Math.max(300, h - 64) + "px"; };
      applyHeight(this.size[1]);

      var nodeRef = this;
      try {
        var appInstance = createApp(ImageBrowser, { node: nodeRef });
        appInstance.mount(el);
        this._vueApp = appInstance;
      } catch (e) {
        console.error("[ImageBrowser] mount failed:", e);
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
