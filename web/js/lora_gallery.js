/**
 * Eagle Suite - LoRA Gallery Node (Vue 3)
 * 高性能 LoRA 视觉加载器：文件夹树、搜索、分页、多选、权重、触发词、Civitai 链接
 */
import { app } from "../../../scripts/app.js";
import { createApp, h, ref, onMounted } from "../lib/vue.esm-browser.js";

console.log("[LoraGallery] module loaded");

// ============================================================
// 文件夹树（复用 Eagle Gallery 逻辑）
// ============================================================
var FolderTree = {
  name: "FolderTree",
  props: { folders: Array, selectedId: String, onSelect: Function, query: String },
  setup: function(props) {
    var expanded = ref({});
    function toggle(f) { expanded.value[f.id] = !expanded.value[f.id]; }
    function matchQuery(name) {
      var q = (props.query || "").trim().toLowerCase();
      if (!q) return true;
      return (name || "").toLowerCase().indexOf(q) >= 0;
    }
    function anyChildMatch(folder) {
      if (!folder.children || folder.children.length === 0) return false;
      for (var i = 0; i < folder.children.length; i++) {
        var c = folder.children[i];
        if (matchQuery(c.name) || anyChildMatch(c)) return true;
      }
      return false;
    }
    function renderNode(folder, level) {
      var q = (props.query || "").trim().toLowerCase();
      if (q && !matchQuery(folder.name) && !anyChildMatch(folder)) return null;
      var hasKids = folder.children && folder.children.length > 0;
      var isOpen = expanded.value[folder.id] || (q && anyChildMatch(folder));
      var isSel = props.selectedId === folder.id;
      var indent = level * 16;
      var arrow = hasKids ? "\u25B6" : "";
      var arrCls = hasKids ? "ft-arr" + (isOpen ? " open" : "") : "ft-arr-place";
      var children = [h("div", {
        class: "ft-r" + (isSel ? " sel" : ""), style: "padding-left:" + (6 + indent) + "px;",
        onClick: function() { props.onSelect(folder); }
      }, [
        h("span", { class: arrCls, onClick: function(e) { e.stopPropagation(); toggle(folder); } }, arrow),
        h("span", { class: "ft-nm" }, folder.name || "")
      ])];
      if (hasKids && isOpen) {
        var cn = [];
        folder.children.forEach(function(c) {
          var node = renderNode(c, level + 1);
          if (node) cn.push(node);
        });
        if (cn.length > 0) children.push(h("div", cn));
      }
      return h("div", { key: folder.id }, children);
    }
    return function() {
      var list = props.folders || [];
      return h("div", { class: "ft-wrap" },
        list.length === 0 ? h("div", { class: "ft-empty" }, "无文件夹") :
          list.map(function(f) { return renderNode(f, 0); })
      );
    };
  }
};

// ============================================================
// 主组件
// ============================================================
var LoraGallery = {
  name: "LoraGallery",
  props: { node: { type: Object, required: true } },
  setup: function(props) {
    console.log("[LoraGallery] setup", props.node.id);
    var rootElRef = null;

    var folders = ref([]);
    var folderId = ref("_all");
    var folderQuery = ref("");

    var query = ref("");
    var items = ref([]);
    var page = ref(1);
    var pageSize = ref(50);
    var total = ref(0);
    var hasMore = ref(true);
    var loading = ref(false);

    var selectedIds = ref([]);
    var weights = ref({});
    var selectedItems = ref({}); // id -> item 全局缓存，已选项跨文件夹保持可见
    var sortBy = ref("name");
    var sortDir = ref("asc");
    var apiKey = ref("");
    var showSettings = ref(false);
    var showTriggerEditor = ref(false);
    var triggerEditorTarget = ref(null); // {id, name, words}
    var civitaiWords = ref({});  // id -> [words...]
    var manualTriggers = ref("");
    var sideWidth = ref(200);
    var selectedWidth = ref(220);

    function thumbUrl(id) {
      return "/lora_gallery/thumbnail?id=" + encodeURIComponent(String(id));
    }

    function loadFolders() {
      console.log("[LoraGallery] loadFolders");
      fetch("/lora_gallery/folders").then(function(r) { return r.json(); }).then(function(d) {
        console.log("[LoraGallery] folders response", d);
        if (d.success && Array.isArray(d.folders)) {
          var list = d.folders.slice();
          list.unshift({ id: "_all", name: "全部", children: [] });
          folders.value = list;
        }
      }).catch(function(e) { console.error("[LoraGallery] load folders failed", e); });
    }

    function loadItems(targetPage, append) {
      var p = targetPage || page.value || 1;
      if (loading.value || !hasMore.value) return;
      loading.value = true;
      console.log("[LoraGallery] loadItems page", p);
      fetch("/lora_gallery/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: folderId.value,
          keyword: query.value,
          page: p,
          pageSize: pageSize.value,
          sortBy: sortBy.value,
          sortDir: sortDir.value,
        })
      }).then(function(r) { return r.json(); }).then(function(d) {
        loading.value = false;
        console.log("[LoraGallery] list response", d);
        if (d.success) {
          var newItems = d.items || [];
          if (append) {
            items.value = items.value.concat(newItems);
          } else {
            items.value = newItems;
          }
          total.value = d.total || 0;
          page.value = d.page || 1;
          hasMore.value = newItems.length >= pageSize.value;
        }
      }).catch(function(e) {
        loading.value = false;
        console.error("[LoraGallery] load items failed", e);
      });
    }

    function loadMore() {
      if (!hasMore.value || loading.value) return;
      loadItems(page.value + 1, true);
    }

    function doSearch() {
      items.value = [];
      page.value = 1;
      hasMore.value = true;
      loadItems(1, false);
    }

    function onFolder(f) {
      folderId.value = f.id;
      doSearch();
    }

    function toggleSelect(item) {
      var idx = selectedIds.value.indexOf(item.id);
      if (idx >= 0) {
        selectedIds.value.splice(idx, 1);
        delete weights.value[item.id];
        delete selectedItems.value[item.id];
      } else {
        selectedIds.value.push(item.id);
        if (!(item.id in weights.value)) weights.value[item.id] = 1.0;
        // 缓存完整 item，使右侧已选面板跨文件夹可见
        selectedItems.value[item.id] = item;
      }
      syncSelection();
    }

    function setWeight(id, w) {
      weights.value[id] = parseFloat(w) || 0.0;
      syncSelection();
    }

    function removeSelected(id) {
      var idx = selectedIds.value.indexOf(id);
      if (idx >= 0) selectedIds.value.splice(idx, 1);
      delete weights.value[id];
      delete selectedItems.value[id];
      syncSelection();
    }

    function clearSelection() {
      selectedIds.value = [];
      weights.value = {};
      selectedItems.value = {};
      syncSelection();
    }

    function syncSelection() {
      var nodeId = String(props.node.id);
      if (!nodeId) return;

      var sels = selectedIds.value.map(function(id) {
        var item = selectedItems.value[id] || items.value.find(function(it) { return it.id === id; });
        return {
          id: id,
          weight: weights.value[id] || 1.0,
          name: item ? item.name : "",
        };
      });

      var payload = { selections: sels, weights: weights.value };
      var payloadStr = JSON.stringify(payload);

      fetch("/lora_gallery/cache_selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: nodeId, selections: sels, weights: weights.value })
      }).catch(function() {});

      try {
        var widget = (props.node.widgets || []).find(function(w) { return w.name === "selection_data"; });
        if (widget) {
          widget.value = payloadStr;
          // 触发 ComfyUI 的 widget change 回调，使节点标记为 dirty 并重算
          if (typeof widget.callback === "function") {
            widget.callback(payloadStr, widget);
          }
          props.node.setDirtyCanvas(true, true);
        }
      } catch (e) {}
    }

    function restoreSelection() {
      var nodeId = String(props.node.id);
      console.log("[LoraGallery] restoreSelection", nodeId);
      fetch("/lora_gallery/cache_selection?node_id=" + encodeURIComponent(nodeId))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          console.log("[LoraGallery] restore response", d);
          if (d.success && d.selections) {
            var ids = [];
            d.selections.forEach(function(s) {
              ids.push(s.id);
              if (s.weight !== undefined) weights.value[s.id] = s.weight;
              // 恢复时尽量保留 name，若后端未返回则从当前 items 查找
              if (s.name) {
                selectedItems.value[s.id] = s;
              }
            });
            selectedIds.value = ids;
          }
        }).catch(function() {});
    }

    function openCivitai(url) {
      if (url) window.open(url, "_blank");
    }

    function setApiKeyToWidget(val) {
      try {
        var widget = (props.node.widgets || []).find(function(w) { return w.name === "civitai_api_key"; });
        if (widget) widget.value = val || "";
      } catch (e) {}
    }

    function readApiKeyFromWidget() {
      try {
        var widget = (props.node.widgets || []).find(function(w) { return w.name === "civitai_api_key"; });
        if (widget && widget.value) apiKey.value = String(widget.value);
      } catch (e) {}
    }

    function setManualTriggersToWidget(val) {
      try {
        var widget = (props.node.widgets || []).find(function(w) { return w.name === "manual_triggers"; });
        if (widget) widget.value = val || "";
      } catch (e) {}
    }

    function readManualTriggersFromWidget() {
      try {
        var widget = (props.node.widgets || []).find(function(w) { return w.name === "manual_triggers"; });
        if (widget && widget.value) manualTriggers.value = String(widget.value);
      } catch (e) {}
    }

    function refreshCivitaiWords(id) {
      fetch("/lora_gallery/civitai_info?id=" + encodeURIComponent(id) + "&api_key=" + encodeURIComponent(apiKey.value))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success && d.apiWords && d.apiWords.length > 0) {
            civitaiWords.value[id] = d.apiWords;
          }
        }).catch(function(e) { console.error("[LoraGallery] refresh civitai words failed", e); });
    }

    function openTriggerEditor(item) {
      triggerEditorTarget.value = {
        id: item.id,
        name: item.name,
        words: ((civitaiWords.value[item.id] && civitaiWords.value[item.id].length) ? civitaiWords.value[item.id] : (item.triggerWords || [])).slice()
      };
      showTriggerEditor.value = true;
    }

    function closeTriggerEditor() {
      showTriggerEditor.value = false;
      triggerEditorTarget.value = null;
    }

    function saveTriggerEditor() {
      var target = triggerEditorTarget.value;
      if (!target) return;
      fetch("/lora_gallery/save_trigger_words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, words: target.words })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
          var item = items.value.find(function(it) { return it.id === target.id; });
          if (item) item.triggerWords = d.triggerWords || target.words;
          civitaiWords.value[target.id] = target.words;
          closeTriggerEditor();
        } else {
          console.warn("[LoraGallery] save trigger words failed", d.error);
        }
      }).catch(function(e) { console.error("[LoraGallery] save trigger words error", e); });
    }

    function downloadPreview(id) {
      fetch("/lora_gallery/download_preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, api_key: apiKey.value })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
          // 刷新缩略图：给 id 加时间戳避免缓存
          var item = items.value.find(function(it) { return it.id === id; });
          if (item) item.hasPreview = true;
        } else {
          console.warn("[LoraGallery] download preview failed", d.error);
        }
      }).catch(function(e) { console.error("[LoraGallery] download preview error", e); });
    }

    function makeDragHandler(axis, refVar, min, max, invert) {
      return function(e) {
        e.preventDefault();
        var start = axis === "x" ? e.clientX : e.clientY;
        var startVal = refVar.value;
        function onMove(ev) {
          var delta = (axis === "x" ? ev.clientX : ev.clientY) - start;
          if (invert) delta = -delta;
          var next = startVal + delta;
          refVar.value = Math.max(min, Math.min(max, next));
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      };
    }

    function formatSize(bytes) {
      if (!bytes) return "0 B";
      var units = ["B", "KB", "MB", "GB"];
      var i = 0;
      var size = bytes;
      while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
      return size.toFixed(i === 0 ? 0 : 1) + " " + units[i];
    }

    onMounted(function() {
      console.log("[LoraGallery] onMounted");
      readApiKeyFromWidget();
      readManualTriggersFromWidget();
      loadFolders();
      loadItems(1, false);
      setTimeout(restoreSelection, 500);
    });

    return function() {
      var gridCards = items.value.map(function(item) {
        var sel = selectedIds.value.indexOf(item.id) >= 0;
        return h("div", {
          key: item.id,
          class: "lg-card" + (sel ? " sel" : ""),
          onClick: function() { toggleSelect(item); }
        }, [
          h("div", { class: "lg-img-box" }, [
            h("img", { src: thumbUrl(item.id) + "&_t=" + Date.now(), class: "lg-img", loading: "lazy", onError: function(e) {
              if (e.target._err) return;
              e.target._err = true;
              e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect width='128' height='128' fill='%231a1a24'/%3E%3Ctext x='64' y='67' text-anchor='middle' fill='%23555' font-size='10'%3E无预览%3C/text%3E%3C/svg%3E";
            }}),
            h("div", { class: "lg-size-badge" }, formatSize(item.size)),
            h("button", { class: "lg-edit-btn", title: "编辑触发词", onClick: function(e) { e.stopPropagation(); openTriggerEditor(item); } }, "T"),
            item.civitaiUrl ? h("button", { class: "lg-civ-btn", title: "打开 Civitai", onClick: function(e) { e.stopPropagation(); openCivitai(item.civitaiUrl); } }, "C") : null,
            (!item.hasPreview && item.civitaiId) ? h("button", { class: "lg-dl-btn", title: "从 Civitai 下载预览图", onClick: function(e) { e.stopPropagation(); downloadPreview(item.id); } }, "⬇") : null
          ]),
          h("div", { class: "lg-name", title: item.name }, item.name),
          sel ? h("div", { class: "lg-check" }) : null
        ]);
      });

      if (loading.value) {
        gridCards.push(h("div", { class: "lg-loading", key: "_loader" }, "加载中..."));
      }

      var selectedList = [];
      selectedIds.value.forEach(function(id) {
        // 优先从全局已选缓存取，其次从当前 items 查找
        var item = selectedItems.value[id] || items.value.find(function(it) { return it.id === id; });
        if (!item) return;
        selectedList.push(h("div", { class: "lg-sel-item", key: id }, [
          h("img", { src: thumbUrl(id), class: "lg-sel-thumb" }),
          h("div", { class: "lg-sel-info" }, [
            h("div", { class: "lg-sel-name", title: item.name }, item.name),
            h("div", { class: "lg-sel-trigger" }, (function() {
              var words = (civitaiWords.value[id] && civitaiWords.value[id].length) ? civitaiWords.value[id] : (item.triggerWords || []);
              return words.length > 0 ? "触发词: " + words.join(", ") : (item.civitaiId ? "点击 C 获取 Civitai 触发词" : "无触发词");
            })())
          ]),
          item.civitaiId ? h("button", { class: "lg-sel-civ", title: "从 Civitai 刷新触发词", onClick: function(e) { e.stopPropagation(); refreshCivitaiWords(id); } }, "C") : null,
          h("input", {
            class: "lg-sel-weight",
            type: "number",
            step: "0.05",
            min: "-10",
            max: "10",
            value: weights.value[id] !== undefined ? weights.value[id] : 1.0,
            onClick: function(e) { e.stopPropagation(); },
            onInput: function(e) { setWeight(id, e.target.value); }
          }),
          h("button", { class: "lg-sel-remove", onClick: function(e) { e.stopPropagation(); removeSelected(id); } }, "\u2715")
        ]));
      });

      function onScroll(e) {
        if (!hasMore.value || loading.value) return;
        var el = e.target;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMore();
      }

      var settingsModal = showSettings.value ? h("div", { class: "lg-modal" }, [
        h("div", { class: "lg-modal-box" }, [
          h("div", { class: "lg-modal-hd" }, "Civitai API 设置"),
          h("div", { class: "lg-modal-body" }, [
            h("div", { class: "lg-modal-row" }, [
              h("label", { class: "lg-modal-label" }, "API Key"),
              h("input", {
                class: "lg-modal-input",
                type: "password",
                value: apiKey.value,
                placeholder: "可选，用于获取触发词",
                onInput: function(e) { apiKey.value = e.target.value; }
              })
            ]),
            h("div", { class: "lg-modal-tip" }, "Key 仅保存在当前节点 widget 中，不会上传到服务器。")
          ]),
          h("div", { class: "lg-modal-ft" }, [
            h("button", { class: "lg-btn lg-btn-primary", onClick: function() { setApiKeyToWidget(apiKey.value); showSettings.value = false; } }, "保存"),
            h("button", { class: "lg-btn", onClick: function() { showSettings.value = false; } }, "取消")
          ])
        ])
      ]) : null;

      var triggerEditorModal = showTriggerEditor.value && triggerEditorTarget.value ? h("div", { class: "lg-modal" }, [
        h("div", { class: "lg-modal-box" }, [
          h("div", { class: "lg-modal-hd" }, "修改触发词"),
          h("div", { class: "lg-modal-body" }, [
            h("div", { class: "lg-modal-tip", style: "margin-bottom:10px;color:#aaa;" }, triggerEditorTarget.value.name),
            h("textarea", {
              class: "lg-modal-input",
              rows: 4,
              placeholder: "输入触发词，用逗号或换行分隔",
              value: (triggerEditorTarget.value.words || []).join(", "),
              onInput: function(e) {
                triggerEditorTarget.value.words = e.target.value.split(/[,，\n]/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
              }
            })
          ]),
          h("div", { class: "lg-modal-ft" }, [
            h("button", { class: "lg-btn lg-btn-primary", onClick: saveTriggerEditor }, "保存"),
            h("button", { class: "lg-btn", onClick: closeTriggerEditor }, "取消")
          ])
        ])
      ]) : null;

      return h("div", { class: "lg-root", ref: function(el) { rootElRef = el; } }, [
        h("div", { class: "lg-bar" }, [
          h("input", { class: "lg-srch", type: "text", value: query.value, placeholder: "搜索 LoRA...",
            onInput: function(e) { query.value = e.target.value; },
            onKeyup: function(e) { if (e.key === "Enter") doSearch(); }
          }),
          h("button", { class: "lg-btn lg-btn-primary", onClick: doSearch }, "搜索"),
          h("select", { class: "lg-sel", value: sortBy.value, onChange: function(e) { sortBy.value = e.target.value; doSearch(); } }, [
            h("option", { value: "name" }, "按名称"),
            h("option", { value: "modified" }, "按修改时间"),
            h("option", { value: "size" }, "按大小")
          ]),
          h("button", { class: "lg-btn", onClick: function() { sortDir.value = sortDir.value === "asc" ? "desc" : "asc"; doSearch(); } }, sortDir.value === "asc" ? "升序" : "降序"),
          h("button", { class: "lg-btn", onClick: function() { fetch("/lora_gallery/clear_cache", {method:"POST"}).then(function(){doSearch();}); } }, "刷新缓存"),
          h("button", { class: "lg-btn", onClick: clearSelection }, "清除选择"),
          h("button", { class: "lg-btn", onClick: function() { showSettings.value = true; } }, "设置")
        ]),

        h("div", { class: "lg-body" }, [
          h("div", { class: "lg-side", style: "width:" + sideWidth.value + "px" }, [
            h("div", { class: "lg-resizer", onMousedown: makeDragHandler("x", sideWidth, 140, 320), title: "拖拽调整宽度" }),

            h("div", { class: "lg-folder-hd" }, [
              h("input", { class: "lg-folder-srch", type: "text", value: folderQuery.value, placeholder: "搜索文件夹...",
                onInput: function(e) { folderQuery.value = e.target.value; }
              })
            ]),
            h(FolderTree, { folders: folders.value, selectedId: folderId.value, onSelect: onFolder, query: folderQuery.value })
          ]),

          h("div", { class: "lg-main" }, [
            items.value.length === 0 && !loading.value ? h("div", { class: "lg-empty" }, "未找到 LoRA") :
              h("div", { class: "lg-grid", onScroll: onScroll }, gridCards)
          ]),

          h("div", { class: "lg-selected", style: "width:" + selectedWidth.value + "px" }, [
            h("div", { class: "lg-resizer-right", onMousedown: makeDragHandler("x", selectedWidth, 160, 360, true), title: "拖拽调整宽度" }),
            h("div", { class: "lg-sel-hd" }, "已选 LoRA (" + selectedIds.value.length + ")"),
            h("div", { class: "lg-sel-manual" }, [
              h("div", { class: "lg-sel-manual-label" }, "手动触发词"),
              h("textarea", {
                class: "lg-sel-manual-input",
                rows: 2,
                placeholder: "输入额外触发词，用逗号或换行分隔",
                value: manualTriggers.value,
                onInput: function(e) { manualTriggers.value = e.target.value; setManualTriggersToWidget(e.target.value); }
              })
            ]),
            selectedList.length === 0 ? h("div", { class: "lg-sel-empty" }, "点击左侧缩略图选择 LoRA") :
              h("div", { class: "lg-sel-list" }, selectedList)
          ])
        ]),
        settingsModal,
        triggerEditorModal
      ]);
    };
  }
};

// ============================================================
// CSS
// ============================================================
var CSS = [
  ".lg-root{display:flex;flex-direction:column;height:100%;background:#121216;color:#bbb;font:13px/1.5 system-ui;overflow:hidden;border-radius:0 0 8px 8px}",
  ".lg-bar{display:flex;gap:6px;padding:6px 8px;background:#1a1a22;border-bottom:1px solid #2a2a32;align-items:center;flex-wrap:wrap}",
  ".lg-srch{flex:1;min-width:100px;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px}",
  ".lg-srch:focus{outline:none;border-color:#4a7de0}",
  ".lg-sel{padding:5px 6px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;cursor:pointer}",
  ".lg-btn{padding:5px 12px;border:1px solid #333;border-radius:6px;background:#1c1c26;color:#c8c8cc;font-size:11px;cursor:pointer;transition:all .2s}",
  ".lg-btn:hover{background:#2a2a36;border-color:#4a7de0;color:#fff}",
  ".lg-btn-primary{background:#2a4a8a;border-color:#4a7de0;color:#fff}",
  ".lg-btn-primary:hover{background:#3a5a9a;border-color:#5a8df0}",
  ".lg-body{display:flex;flex:1;overflow:hidden;position:relative}",
  ".lg-side{position:relative;width:200px;min-width:140px;max-width:320px;border-right:1px solid #2a2a32;background:#16161e;overflow:auto;padding:8px 0;flex-shrink:0}",
  ".lg-resizer{position:absolute;top:0;right:0;width:6px;height:100%;cursor:col-resize;background:transparent;z-index:10}",
  ".lg-resizer:hover{background:rgba(74,125,224,0.35)}",
  ".lg-folder-hd{padding:8px 10px;border-bottom:1px solid #2a2a32}",
  ".lg-folder-srch{width:100%;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;box-sizing:border-box}",
  ".lg-folder-srch:focus{outline:none;border-color:#4a7de0}",
  ".lg-main{flex:1 1 auto;display:flex;flex-direction:column;overflow:hidden;min-width:200px;background:#0f0f14;min-height:0}",
  ".lg-grid{display:grid;grid-template-columns:repeat(auto-fill, 120px);grid-auto-rows:190px;gap:6px;padding:16px;overflow-y:auto;flex:1;width:100%;box-sizing:border-box;align-content:start;min-height:0}",
  ".lg-grid::-webkit-scrollbar{width:8px}",
  ".lg-grid::-webkit-scrollbar-track{background:transparent}",
  ".lg-grid::-webkit-scrollbar-thumb{background:#3a3a45;border-radius:4px}",
  ".lg-grid::-webkit-scrollbar-thumb:hover{background:#4a4a55}",
  ".lg-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:14px}",
  ".lg-loading{grid-column:1/-1;padding:30px;color:#777;text-align:center}",
  ".lg-card{position:relative;width:120px;height:190px;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid transparent;background:#1a1a24;transition:all .2s;display:flex;flex-direction:column;box-shadow:0 4px 12px rgba(0,0,0,0.3)}",
  ".lg-card:hover{border-color:#4a7de0;transform:translateY(-3px);box-shadow:0 6px 16px rgba(0,0,0,0.45);z-index:10}",
  ".lg-card.sel{border-color:#4a7de0;background:#1e2a40;box-shadow:inset 0 0 0 2px #4a7de0}",
  ".lg-img-box{position:relative;width:120px;height:140px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;flex-shrink:0}",
  ".lg-img{width:100%;height:100%;object-fit:cover;display:block;background:#111}",
  ".lg-civ-btn{position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:4px;border:none;background:rgba(74,125,224,0.9);color:#fff;font-size:10px;font-weight:bold;cursor:pointer;z-index:5;opacity:0;transition:opacity .2s}",
  ".lg-card:hover .lg-civ-btn{opacity:1}",
  ".lg-dl-btn{position:absolute;top:6px;right:30px;width:22px;height:22px;border-radius:4px;border:none;background:rgba(60,180,100,0.9);color:#fff;font-size:10px;font-weight:bold;cursor:pointer;z-index:5;opacity:0;transition:opacity .2s}",
  ".lg-card:hover .lg-dl-btn{opacity:1}",
  ".lg-edit-btn{position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:4px;border:none;background:rgba(120,80,200,0.9);color:#fff;font-size:10px;font-weight:bold;cursor:pointer;z-index:5;opacity:0;transition:opacity .2s}",
  ".lg-card:hover .lg-edit-btn{opacity:1}",
  ".lg-name{padding:6px 8px;font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#16161e}",
  ".lg-size-badge{position:absolute;top:6px;right:6px;z-index:4;padding:2px 5px;border-radius:4px;background:rgba(0,0,0,0.65);color:#ddd;font-size:9px;font-weight:600;pointer-events:none}",
  ".lg-check{position:absolute;inset:0;background:rgba(74,125,224,0.25);display:flex;align-items:center;justify-content:center;z-index:6;pointer-events:none;animation:checkPop .2s cubic-bezier(0.175, 0.885, 0.32, 1.275)}",
  ".lg-check::after{content:'\u2714';width:32px;height:32px;background:#4a7de0;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:bold;box-shadow:0 4px 10px rgba(0,0,0,0.4);border:2px solid #fff}",
  "@keyframes checkPop{from{transform:scale(0.8);opacity:0}to{transform:scale(1);opacity:1}}",
  ".lg-selected{position:relative;width:220px;min-width:160px;max-width:360px;border-left:1px solid #2a2a32;background:#16161e;overflow:hidden;display:flex;flex-direction:column;flex-shrink:0}",
  ".lg-resizer-right{position:absolute;top:0;left:0;width:6px;height:100%;cursor:col-resize;background:transparent;z-index:10}",
  ".lg-resizer-right:hover{background:rgba(74,125,224,0.35)}",
  ".lg-sel-hd{padding:8px 10px;font-weight:600;border-bottom:1px solid #2a2a32;background:#1a1a22;color:#ddd}",
  ".lg-sel-manual{padding:10px;border-bottom:1px solid #2a2a32;background:#16161e}",
  ".lg-sel-manual-label{font-size:11px;color:#999;margin-bottom:6px}",
  ".lg-sel-manual-input{width:100%;min-height:46px;padding:6px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;resize:vertical;box-sizing:border-box}",
  ".lg-sel-manual-input:focus{outline:none;border-color:#4a7de0}",
  ".lg-sel-empty{padding:20px 10px;color:#666;text-align:center;font-size:11px}",
  ".lg-sel-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px;min-height:0}",
  ".lg-sel-item{display:flex;align-items:center;gap:8px;padding:6px;background:#1a1a24;border-radius:6px;border:1px solid #2a2a32}",
  ".lg-sel-thumb{width:40px;height:40px;border-radius:4px;object-fit:cover;background:#000;flex-shrink:0}",
  ".lg-sel-info{flex:1;min-width:0}",
  ".lg-sel-name{font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".lg-sel-trigger{font-size:9px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}",
  ".lg-sel-weight{width:50px;padding:3px;border:1px solid #333;border-radius:3px;background:#0e0e12;color:#c8c8cc;font-size:11px;text-align:center}",
  ".lg-sel-remove{width:20px;height:20px;border-radius:50%;border:none;background:#e55;color:#fff;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
  ".lg-sel-civ{width:22px;height:22px;border-radius:4px;border:none;background:rgba(74,125,224,0.85);color:#fff;font-size:10px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
  ".lg-modal{position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000}",
  ".lg-modal-box{width:360px;background:#1a1a22;border:1px solid #333;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,0.6);overflow:hidden}",
  ".lg-modal-hd{padding:12px 16px;font-size:14px;font-weight:600;border-bottom:1px solid #2a2a32;background:#121216;color:#ddd}",
  ".lg-modal-body{padding:16px}",
  ".lg-modal-row{display:flex;flex-direction:column;gap:6px}",
  ".lg-modal-label{font-size:12px;color:#999}",
  ".lg-modal-input{width:100%;padding:8px 10px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px;box-sizing:border-box}",
  ".lg-modal-input:focus{outline:none;border-color:#4a7de0}",
  ".lg-modal-tip{font-size:11px;color:#666;margin-top:10px}",
  ".lg-modal-ft{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #2a2a32;background:#121216}",
  ".ft-wrap{user-select:none}",
  ".ft-empty{padding:12px;color:#555;font-size:11px;text-align:center}",
  ".ft-r{display:flex;align-items:center;padding:6px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;border-radius:0 20px 20px 0;margin:1px 0;transition:all .15s;font-size:11px;color:#999;position:relative}",
  ".ft-r:hover{background:rgba(255,255,255,0.05);color:#ccc}",
  ".ft-r.sel{background:linear-gradient(90deg, #3a5a8a, #4a7de0);color:#fff;font-weight:600}",
  ".ft-arr,.ft-arr-place{width:18px;font-size:10px;color:#555;text-align:center;flex-shrink:0;transition:transform .25s}",
  ".ft-arr.open{transform:rotate(90deg);color:#999}",
  ".ft-nm{overflow:hidden;text-overflow:ellipsis;flex:1}"
].join("\n");

// ============================================================
app.registerExtension({
  name: "EagleSuite.LoraGallery",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleLoraGalleryNode") return;
    console.log("[LoraGallery] beforeRegisterNodeDef");

    var HIDDEN_WIDGETS = ["selection_data", "civitai_api_key", "manual_triggers"];

    var hideWidgets = function(node) {
      if (!node.widgets || !node.widgets.length) return false;
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var w = node.widgets[i];
        if (HIDDEN_WIDGETS.indexOf(w.name) < 0) continue;
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
      console.log("[LoraGallery] onNodeCreated");
      if (orig) orig.apply(this, arguments);
      if (this._lgInit) return;
      this._lgInit = true;

      this.setSize([960, 720]);
      setTimeout(function(node) {
        return function() { if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500); };
      }(this), 300);

      if (!document.getElementById("lg-style")) {
        var s = document.createElement("style"); s.id = "lg-style"; s.textContent = CSS; document.head.appendChild(s);
      }

      var el = document.createElement("div");
      el.style.cssText = "width:100%;height:100%;overflow:hidden;border-radius:0 0 8px 8px;background:#121216;";

      var widget = this.addDOMWidget("lora_gallery", "div", el, { serialize: false });
      console.log("[LoraGallery] DOM widget added", widget);

      var applyHeight = function(nodeHeight) {
        var h = Math.max(300, nodeHeight - 64);
        el.style.height = h + "px";
        return h;
      };
      applyHeight(this.size[1]);

      // 强制重新计算 ComfyUI 节点尺寸，消除隐藏 widget 留下的空隙
      try { node.setDirtyCanvas(true, true); } catch (e) {}

      var nodeRef = this;
      try {
        var appInstance = createApp(LoraGallery, { node: nodeRef });
        appInstance.mount(el);
        this._vueApp = appInstance;
        console.log("[LoraGallery] Vue mounted");
      } catch (e) {
        console.error("[LoraGallery] mount failed:", e);
        el.innerHTML = '<div style="padding:30px;color:#e55">Error: ' + e.message + '</div>';
      }

      var onResize = this.onResize;
      this.onResize = function(size) {
        if (onResize) onResize.apply(this, arguments);
        applyHeight(size[1]);
        try { node.setDirtyCanvas(true, true); } catch (e) {}
      };
    };

    var onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function() {
      if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  }
});
