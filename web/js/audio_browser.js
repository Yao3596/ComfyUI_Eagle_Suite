/**
 * Eagle Suite - Audio Browser (Vue 3)
 * 移植自 HugoTools，采用 Eagle Gallery 同款 Vue 风格
 */
import { app } from "../../../scripts/app.js";
import { createApp, h, ref, onMounted } from "../lib/vue.esm-browser.js";

var AudioBrowser = {
  name: "AudioBrowser",
  props: { node: { type: Object, required: true } },
  setup: function(props) {
    var query = ref("");
    var page = ref(1);
    var pageSize = ref(30);
    var totalPages = ref(1);
    var items = ref([]);
    var loading = ref(false);
    var selectedPath = ref("");
    var playingSrc = ref("");

    function setPathWidget(val) {
      try {
        var w = (props.node.widgets || []).find(function(x) { return x.name === "audio_path"; });
        if (w) w.value = val || "";
      } catch (e) {}
    }

    function readPathWidget() {
      try {
        var w = (props.node.widgets || []).find(function(x) { return x.name === "audio_path"; });
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
      var url = "/EagleAudioList/search_audio?page=" + page.value
        + "&page_size=" + pageSize.value
        + (query.value ? "&keyword=" + encodeURIComponent(query.value) : "");
      fetch(url).then(function(r) { return r.json(); }).then(function(d) {
        loading.value = false;
        if (d.success) {
          items.value = d.data.list_data || [];
          totalPages.value = d.data.total_pagenum || 1;
        }
      }).catch(function(e) {
        loading.value = false;
        console.error("[AudioBrowser] load failed", e);
      });
    }

    function doSearch() { page.value = 1; loadList(1); }

    function selectItem(item) {
      selectedPath.value = item.path || "";
      setPathWidget(selectedPath.value);
    }

    function play(item, ev) {
      if (ev) ev.stopPropagation();
      playingSrc.value = item.src || "";
    }

    function renameItem(item, ev) {
      if (ev) ev.stopPropagation();
      var name = prompt("重命名为:", item.name);
      if (!name) return;
      fetch("/EagleAudioList/rename_audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, new_name: name })
      }).then(function() { loadList(page.value); }).catch(function(e) { console.error(e); });
    }

    onMounted(function() {
      readPathWidget();
      loadList(1);
    });

    return function() {
      var rows = items.value.map(function(item) {
        var sel = selectedPath.value === item.path;
        return h("div", {
          key: item.id,
          class: "ab-row" + (sel ? " sel" : ""),
          onClick: function() { selectItem(item); }
        }, [
          h("span", { class: "ab-name", title: item.name }, item.name),
          h("span", { class: "ab-size" }, formatSize(item.size)),
          h("button", { class: "ab-icon", onClick: function(e) { play(item, e); }, title: "播放" }, "▶"),
          h("button", { class: "ab-icon", onClick: function(e) { renameItem(item, e); }, title: "重命名" }, "✎")
        ]);
      });

      return h("div", { class: "ab-root" }, [
        h("div", { class: "ab-bar" }, [
          h("input", { class: "ab-srch", type: "text", value: query.value, placeholder: "搜索音频...",
            onInput: function(e) { query.value = e.target.value; },
            onKeyup: function(e) { if (e.key === "Enter") doSearch(); }
          }),
          h("button", { class: "ab-btn", onClick: doSearch }, "搜索"),
          h("button", { class: "ab-btn", onClick: function() { loadList(1); } }, "刷新")
        ]),
        h("div", { class: "ab-list" }, loading.value ? [h("div", { class: "ab-loading" }, "加载中...")] : rows),
        h("div", { class: "ab-pager" }, [
          h("button", { class: "ab-btn", onClick: function() { if (page.value > 1) loadList(page.value - 1); } }, "上一页"),
          h("span", { class: "ab-page" }, page.value + " / " + totalPages.value),
          h("button", { class: "ab-btn", onClick: function() { if (page.value < totalPages.value) loadList(page.value + 1); } }, "下一页")
        ]),
        playingSrc.value ? h("audio", { class: "ab-player", src: playingSrc.value, controls: true, autoplay: true }) : null
      ]);
    };
  }
};

var CSS = [
  ".ab-root{display:flex;flex-direction:column;height:100%;background:#121216;color:#bbb;font:12px/1.5 system-ui;overflow:hidden}",
  ".ab-bar{display:flex;gap:6px;padding:6px 8px;background:#1a1a22;border-bottom:1px solid #2a2a32;align-items:center}",
  ".ab-srch{flex:1;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px}",
  ".ab-btn{padding:5px 10px;border:1px solid #333;border-radius:6px;background:#1c1c26;color:#c8c8cc;font-size:11px;cursor:pointer;transition:all .2s}",
  ".ab-btn:hover{background:#2a2a36;border-color:#4a7de0;color:#fff}",
  ".ab-list{flex:1;overflow-y:auto;padding:8px}",
  ".ab-row{display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;cursor:pointer;border:1px solid transparent}",
  ".ab-row:hover{background:#1a1a24}",
  ".ab-row.sel{background:#1e2a40;border-color:#4a7de0}",
  ".ab-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}",
  ".ab-size{font-size:10px;color:#888;width:60px;text-align:right}",
  ".ab-icon{width:24px;height:24px;border:none;border-radius:4px;background:#2a2a36;color:#ccc;cursor:pointer}",
  ".ab-icon:hover{background:#4a7de0;color:#fff}",
  ".ab-loading{padding:30px;color:#777;text-align:center}",
  ".ab-pager{display:flex;gap:8px;align-items:center;justify-content:center;padding:6px;border-top:1px solid #2a2a32;background:#1a1a22}",
  ".ab-page{font-size:11px;color:#999}",
  ".ab-player{width:100%;height:36px;background:#1a1a22}"
].join("\n");

app.registerExtension({
  name: "EagleSuite.AudioBrowser",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleAudioList") return;

    var hideWidgets = function(node) {
      if (!node.widgets || !node.widgets.length) return false;
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var w = node.widgets[i];
        if (w.name !== "audio_path") continue;
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
      if (this._abInit) return;
      this._abInit = true;

      this.setSize([520, 420]);
      setTimeout(function(node) {
        return function() { if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500); };
      }(this), 300);

      if (!document.getElementById("ab-style")) {
        var s = document.createElement("style"); s.id = "ab-style"; s.textContent = CSS; document.head.appendChild(s);
      }

      var el = document.createElement("div");
      el.style.cssText = "width:100%;height:100%;overflow:hidden;border-radius:0 0 8px 8px;background:#121216;";
      this.addDOMWidget("audio_browser", "div", el, { serialize: false });

      var applyHeight = function(h) { el.style.height = Math.max(260, h - 64) + "px"; };
      applyHeight(this.size[1]);

      var nodeRef = this;
      try {
        var appInstance = createApp(AudioBrowser, { node: nodeRef });
        appInstance.mount(el);
        this._vueApp = appInstance;
      } catch (e) {
        console.error("[AudioBrowser] mount failed:", e);
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
