/**
 * Eagle Suite - LoRA Gallery Node (Vue 3)
 * 高性能 LoRA 视觉加载器：文件夹树、搜索、分页、多选、权重、触发词、Civitai 链接
 */
import { app } from "../../../scripts/app.js";
import { createApp, h, ref, onMounted, onBeforeUnmount } from "../lib/vue.esm-browser.js";
import "./eagle_vue_theme.js";

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
    var rootElRef = null;

    var folders = ref([]);
    var folderId = ref("_all");
    var folderQuery = ref("");

    var query = ref("");
    var items = ref([]);
    var page = ref(1);
    var pageSize = ref(32);
    var total = ref(0);
    var hasMore = ref(true);
    var loading = ref(false);

    var selectedIds = ref([]);
    var weights = ref({});
    // “已选择”与“本次应用”是两个独立状态。关闭后仍保留顺序、权重和触发词，
    // 便于临时做 LoRA A/B，而不是只能把模型从列表中删除。
    var enabledMap = ref({});
    var selectedItems = ref({}); // id -> item 全局缓存，已选项跨文件夹保持可见
    var sortBy = ref("name");
    var sortDir = ref("asc");
    var apiKey = ref("");
    var showSettings = ref(false);
    var showTriggerEditor = ref(false);
    var triggerEditorTarget = ref(null); // {id, name, words}
    var civitaiWords = ref({});  // id -> [words...]
    var showDetails = ref(false);
    var detailsLoading = ref(false);
    var detailsError = ref("");
    var detailsData = ref(null);
    var detailsTarget = ref(null);
    var thumbRevision = ref({});
    var manualTriggers = ref("");
    var sideWidth = ref(160);
    var selectedWidth = ref(200);
    var collapseStorageKey = "eagle_lora_gallery_collapsed_" + String(props.node.id);
    var galleryCollapsed = ref(localStorage.getItem(collapseStorageKey) === "1");
    var showQuickPicker = ref(false);
    var quickLoading = ref(false);
    var quickError = ref("");
    var quickQuery = ref("");
    var quickItems = ref([]);
    var quickPath = ref([]);
    var quickHoverItem = ref(null);
    var quickLoaded = false;
    var documentClickHandler = null;
    var autoPreviewEnabled = ref(localStorage.getItem("eagle_lora_auto_preview") !== "0");
    var autoPreviewQueue = [];
    var autoPreviewQueued = {};
    var autoPreviewRunning = false;
    var destroyed = false;

    function thumbUrl(id) {
      var revision = thumbRevision.value[id] || "0";
      return "/lora_gallery/thumbnail?id=" + encodeURIComponent(String(id)) + "&_v=" + encodeURIComponent(revision);
    }

    function fetchJson(url, options) {
      return fetch(url, options).then(function(response) {
        return response.text().then(function(text) {
          if (!text) {
            if (response.status === 404) {
              throw new Error("模型信息后端路由尚未加载，请重启 ComfyUI 后再试");
            }
            throw new Error("服务器返回空响应（HTTP " + response.status + "）");
          }
          try {
            var data = JSON.parse(text);
            if (!response.ok && !data.error) data.error = "HTTP " + response.status;
            return data;
          } catch (error) {
            throw new Error("服务器返回了非 JSON 响应（HTTP " + response.status + "）");
          }
        });
      });
    }

    function loadFolders() {
      fetch("/lora_gallery/folders").then(function(r) { return r.json(); }).then(function(d) {
        if (d.success && Array.isArray(d.folders)) {
          var list = d.folders.slice();
          list.unshift({ id: "_all", name: "全部", children: [] });
          folders.value = list;
        }
      }).catch(function(e) { console.error("[LoraGallery] load folders failed", e); });
    }

    function loadQuickItems(force) {
      if (quickLoading.value || (quickLoaded && !force)) return;
      quickLoading.value = true;
      quickError.value = "";
      fetchJson("/lora_gallery/quick_list").then(function(d) {
        quickLoading.value = false;
        if (!d.success) {
          quickError.value = d.error || "模型树加载失败";
          return;
        }
        quickItems.value = Array.isArray(d.items) ? d.items : [];
        if (force) quickPath.value = [];
        quickLoaded = true;
        quickItems.value.forEach(function(item) {
          if (selectedIds.value.indexOf(item.id) >= 0) selectedItems.value[item.id] = item;
        });
      }).catch(function(e) {
        quickLoading.value = false;
        quickError.value = e && e.message ? e.message : "模型树加载失败";
      });
    }

    function toggleQuickPicker(e) {
      if (e) e.stopPropagation();
      showQuickPicker.value = !showQuickPicker.value;
      if (!showQuickPicker.value) quickHoverItem.value = null;
      if (showQuickPicker.value) loadQuickItems(false);
    }

    function buildQuickTree(list) {
      var root = { name: "全部模型", path: "", children: {}, items: [] };
      var libraries = {};
      (list || []).forEach(function(item) { if (item.library) libraries[item.library] = true; });
      var showLibraryRoot = Object.keys(libraries).length > 1;
      (list || []).forEach(function(item) {
        var current = root;
        var parts = String(item.folderPath || "").replace(/\\/g, "/").split("/").filter(function(part) { return part; });
        if (showLibraryRoot && item.library) parts.unshift(item.library);
        var pathParts = [];
        parts.forEach(function(part) {
          pathParts.push(part);
          if (!current.children[part]) {
            current.children[part] = { name: part, path: pathParts.join("/"), children: {}, items: [] };
          }
          current = current.children[part];
        });
        current.items.push(item);
      });
      return root;
    }

    function addQuickItem(item) {
      if (!item || selectedIds.value.indexOf(item.id) >= 0) return;
      selectedIds.value.push(item.id);
      if (!(item.id in weights.value)) weights.value[item.id] = 1.0;
      enabledMap.value[item.id] = true;
      selectedItems.value[item.id] = item;
      syncSelection();
    }

    function setGalleryCollapsed(value) {
      galleryCollapsed.value = !!value;
      localStorage.setItem(collapseStorageKey, galleryCollapsed.value ? "1" : "0");
      if (galleryCollapsed.value) {
        autoPreviewQueue = [];
        autoPreviewQueued = {};
        items.value = [];
        page.value = 1;
        total.value = 0;
        hasMore.value = true;
      } else {
        items.value = [];
        page.value = 1;
        hasMore.value = true;
        loadItems(1, false);
      }
    }

    function loadItems(targetPage, append) {
      var p = targetPage || page.value || 1;
      if (galleryCollapsed.value || loading.value || !hasMore.value) return;
      loading.value = true;
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
        if (galleryCollapsed.value) return;
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
          scheduleAutoPreviews(newItems);
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
      if (galleryCollapsed.value) {
        quickQuery.value = query.value;
        showQuickPicker.value = true;
        loadQuickItems(false);
        return;
      }
      items.value = [];
      page.value = 1;
      hasMore.value = true;
      autoPreviewQueue = [];
      autoPreviewQueued = {};
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
        delete enabledMap.value[item.id];
        delete selectedItems.value[item.id];
      } else {
        selectedIds.value.push(item.id);
        if (!(item.id in weights.value)) weights.value[item.id] = 1.0;
        enabledMap.value[item.id] = true;
        // 缓存完整 item，使右侧已选面板跨文件夹可见
        selectedItems.value[item.id] = item;
      }
      syncSelection();
    }

    function setWeight(id, w) {
      weights.value[id] = parseFloat(w) || 0.0;
      syncSelection();
    }

    function toggleEnabled(id) {
      enabledMap.value[id] = enabledMap.value[id] === false;
      syncSelection();
    }

    function removeSelected(id) {
      var idx = selectedIds.value.indexOf(id);
      if (idx >= 0) selectedIds.value.splice(idx, 1);
      delete weights.value[id];
      delete enabledMap.value[id];
      delete selectedItems.value[id];
      syncSelection();
    }

    function clearSelection() {
      selectedIds.value = [];
      weights.value = {};
      enabledMap.value = {};
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
          weight: weights.value[id] !== undefined ? weights.value[id] : 1.0,
          enabled: enabledMap.value[id] !== false,
          name: item ? item.name : "",
        };
      });

      var payload = { selections: sels, weights: weights.value, enabled: enabledMap.value };
      var payloadStr = JSON.stringify(payload);

      fetch("/lora_gallery/cache_selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: nodeId, selections: sels, weights: weights.value, enabled: enabledMap.value })
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

      // 兜底：直接读 selection_data widget 自身的值——工作流保存/恢复时这个
      // 原生 widget 会跟着正常序列化，不依赖服务端内存缓存，刷新浏览器后
      // 理论上应该还在。服务端缓存 GET 拿不到数据时（node_id 没对上、请求
      // 失败、服务端还没这条记录）就用这个兜底，双保险。
      function restoreFromWidget() {
        try {
          var widget = (props.node.widgets || []).find(function(w) { return w.name === "selection_data"; });
          if (!widget || !widget.value || widget.value === "[]") return false;
          var data = JSON.parse(widget.value);
          var sels = data.selections || data;
          if (!Array.isArray(sels) || sels.length === 0) return false;
          var ids = [];
          sels.forEach(function(s) {
            ids.push(s.id);
            if (s.weight !== undefined) weights.value[s.id] = s.weight;
            enabledMap.value[s.id] = s.enabled !== false && (!data.enabled || data.enabled[s.id] !== false);
            if (s.name) selectedItems.value[s.id] = s;
          });
          selectedIds.value = ids;
          return true;
        } catch (e) { return false; }
      }

      fetch("/lora_gallery/cache_selection?node_id=" + encodeURIComponent(nodeId))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success && d.selections && d.selections.length > 0) {
            var ids = [];
            d.selections.forEach(function(s) {
              ids.push(s.id);
              if (s.weight !== undefined) weights.value[s.id] = s.weight;
              enabledMap.value[s.id] = s.enabled !== false && (!d.enabled || d.enabled[s.id] !== false);
              // 恢复时尽量保留 name，若后端未返回则从当前 items 查找
              if (s.name) {
                selectedItems.value[s.id] = s;
              }
            });
            selectedIds.value = ids;
          } else {
            restoreFromWidget();
          }
        }).catch(function() { restoreFromWidget(); });
    }

    function openCivitai(url) {
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    }

    function mergeResolvedInfo(item, civitai) {
      if (!item || !civitai) return;
      if (civitai.modelId) item.civitaiId = String(civitai.modelId);
      if (civitai.url) item.civitaiUrl = civitai.url;
      if (Array.isArray(civitai.trainedWords) && civitai.trainedWords.length) {
        civitaiWords.value[item.id] = civitai.trainedWords;
        item.triggerWords = civitai.trainedWords.slice();
      }
    }

    function openDetails(item) {
      if (!item) return;
      detailsTarget.value = item;
      detailsData.value = null;
      detailsError.value = "";
      detailsLoading.value = true;
      showDetails.value = true;
      fetchJson("/lora_gallery/model_details?id=" + encodeURIComponent(item.id) + "&api_key=" + encodeURIComponent(apiKey.value))
        .then(function(d) {
          detailsLoading.value = false;
          if (!d.success) {
            detailsError.value = d.error || "读取模型信息失败";
            return;
          }
          detailsData.value = d;
          mergeResolvedInfo(item, d.civitai);
        })
        .catch(function(e) {
          detailsLoading.value = false;
          detailsError.value = e && e.message ? e.message : "读取模型信息失败";
        });
    }

    function closeDetails() {
      showDetails.value = false;
      detailsData.value = null;
      detailsTarget.value = null;
      detailsError.value = "";
    }

    function setAutoPreviewEnabled(value) {
      autoPreviewEnabled.value = !!value;
      localStorage.setItem("eagle_lora_auto_preview", autoPreviewEnabled.value ? "1" : "0");
      if (autoPreviewEnabled.value) scheduleAutoPreviews(items.value);
    }

    var batchFilling = ref(false);
    var batchFillDone = ref(0);
    var batchFillTotal = ref(0);

    function runBatchFillCovers() {
      if (batchFilling.value) return;
      var targets = items.value.filter(function(it) { return it && !it.hasPreview; }).map(function(it) { return it.id; });
      if (!targets.length) return;
      batchFilling.value = true;
      batchFillDone.value = 0;
      batchFillTotal.value = targets.length;

      function step(index) {
        if (index >= targets.length || destroyed) {
          batchFilling.value = false;
          return;
        }
        downloadPreview(targets[index], true).finally(function() {
          batchFillDone.value = index + 1;
          setTimeout(function() { step(index + 1); }, 700);
        });
      }
      step(0);
    }

    function scheduleAutoPreviews(newItems) {
      if (galleryCollapsed.value || !autoPreviewEnabled.value || destroyed || !Array.isArray(newItems)) return;
      newItems.forEach(function(item) {
        if (!item || item.hasPreview || autoPreviewQueued[item.id]) return;
        autoPreviewQueued[item.id] = true;
        autoPreviewQueue.push(item.id);
      });
      if (!autoPreviewRunning && autoPreviewQueue.length) {
        var start = function() { runAutoPreviewQueue(); };
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(start, { timeout: 1800 });
        } else {
          setTimeout(start, 800);
        }
      }
    }

    function runAutoPreviewQueue() {
      if (galleryCollapsed.value || destroyed || !autoPreviewEnabled.value || autoPreviewRunning) return;
      var id = autoPreviewQueue.shift();
      if (!id) return;
      var item = items.value.find(function(entry) { return entry.id === id; });
      if (!item || item.hasPreview) {
        setTimeout(runAutoPreviewQueue, 80);
        return;
      }
      autoPreviewRunning = true;
      downloadPreview(id, true).finally(function() {
        autoPreviewRunning = false;
        if (!galleryCollapsed.value && !destroyed && autoPreviewEnabled.value && autoPreviewQueue.length) {
          setTimeout(runAutoPreviewQueue, 900);
        }
      });
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
          if (d.success) {
            var words = Array.isArray(d.apiWords) ? d.apiWords : [];
            if (words.length > 0) civitaiWords.value[id] = words;
            var item = selectedItems.value[id] || items.value.find(function(entry) { return entry.id === id; });
            if (item) {
              if (words.length > 0) item.triggerWords = words.slice();
              if (d.civitaiId) item.civitaiId = String(d.civitaiId);
              if (d.civitaiUrl) item.civitaiUrl = d.civitaiUrl;
            }
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

    var settingCover = ref(""); // 正在设置封面的图片 URL，用于按钮显示 loading 态
    var setCoverError = ref("");

    function setPreviewFromImage(imageUrl) {
      if (!detailsTarget.value || settingCover.value) return;
      var id = detailsTarget.value.id;
      settingCover.value = imageUrl;
      setCoverError.value = "";
      fetch("/lora_gallery/set_preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, image_url: imageUrl, api_key: apiKey.value })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
          var it = items.value.find(function(x) { return x.id === id; });
          if (it) it.hasPreview = true;
          thumbRevision.value[id] = String(Date.now());
          thumbRevision.value = Object.assign({}, thumbRevision.value);
        } else {
          setCoverError.value = d.error || "设为封面失败（原因未知）";
          console.warn("[LoraGallery] set preview failed", d.error);
        }
      }).catch(function(e) {
        setCoverError.value = "请求失败: " + (e && e.message ? e.message : e);
        console.error("[LoraGallery] set preview error", e);
      }).finally(function() {
        settingCover.value = "";
      });
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

    function downloadPreview(id, silent) {
      return fetch("/lora_gallery/download_preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, api_key: apiKey.value })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
          var item = items.value.find(function(it) { return it.id === id; });
          if (item) {
            item.hasPreview = true;
            if (d.civitaiId) item.civitaiId = String(d.civitaiId);
            if (d.civitaiUrl) item.civitaiUrl = d.civitaiUrl;
            if (Array.isArray(d.triggerWords) && d.triggerWords.length) {
              civitaiWords.value[id] = d.triggerWords;
            }
          }
          thumbRevision.value[id] = String(Date.now());
          thumbRevision.value = Object.assign({}, thumbRevision.value);
        } else if (!silent) {
          console.warn("[LoraGallery] download preview failed", d.error);
        }
        return d;
      }).catch(function(e) {
        if (!silent) console.error("[LoraGallery] download preview error", e);
        return { success: false, error: e && e.message ? e.message : "network error" };
      });
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

    function formatDate(value) {
      if (!value) return "未知";
      var date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
      return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    onMounted(function() {
      readApiKeyFromWidget();
      readManualTriggersFromWidget();
      loadFolders();
      if (!galleryCollapsed.value) loadItems(1, false);
      documentClickHandler = function() { showQuickPicker.value = false; };
      document.addEventListener("click", documentClickHandler);
      setTimeout(restoreSelection, 500);
    });

    onBeforeUnmount(function() {
      destroyed = true;
      autoPreviewQueue = [];
      if (documentClickHandler) document.removeEventListener("click", documentClickHandler);
    });

    return function() {
      var gridCards = items.value.map(function(item) {
        var sel = selectedIds.value.indexOf(item.id) >= 0;
        var cardWords = (civitaiWords.value[item.id] && civitaiWords.value[item.id].length) ? civitaiWords.value[item.id] : (item.triggerWords || []);
        return h("div", {
          key: item.id,
          class: "lg-card" + (sel ? " sel" : ""),
          onClick: function() { toggleSelect(item); },
          onContextmenu: function(e) { e.preventDefault(); e.stopPropagation(); openDetails(item); }
        }, [
          h("div", { class: "lg-img-box" }, [
            h("img", { src: thumbUrl(item.id), class: "lg-img", loading: "lazy", decoding: "async", onError: function(e) {
              if (e.target._err) return;
              e.target._err = true;
              e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect width='128' height='128' fill='%231a1a24'/%3E%3Ctext x='64' y='67' text-anchor='middle' fill='%23555' font-size='10'%3E无预览%3C/text%3E%3C/svg%3E";
            }}),
            h("div", { class: "lg-size-badge" }, formatSize(item.size)),
            h("button", { class: "lg-edit-btn", title: "编辑触发词", onClick: function(e) { e.stopPropagation(); openTriggerEditor(item); } }, "T"),
            !item.hasPreview ? h("button", { class: "lg-dl-btn", title: "从 civitai.red 识别并获取封面", onClick: function(e) { e.stopPropagation(); downloadPreview(item.id); } }, "⬇") : null
          ]),
          h("div", { class: "lg-card-info" }, [
            h("div", { class: "lg-name", title: item.name }, item.name),
            h("div", { class: "lg-card-trigger", title: cardWords.join(", ") }, cardWords.length ? cardWords.join(", ") : "未设置触发词"),
            h("button", { class: "lg-civ-btn", title: "读取 civitai.red 模型信息", onClick: function(e) { e.stopPropagation(); openDetails(item); } }, "Civitai")
          ]),
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
        var enabled = enabledMap.value[id] !== false;
        selectedList.push(h("div", {
          class: "lg-sel-item" + (enabled ? " enabled" : " disabled"), key: id,
          title: enabled ? "已启用；点击条目临时忽略此 LoRA" : "已忽略；点击条目重新启用此 LoRA",
          onClick: function() { toggleEnabled(id); }
        }, [
          h("img", { src: thumbUrl(id), class: "lg-sel-thumb", loading: "lazy", decoding: "async" }),
          h("div", { class: "lg-sel-info" }, [
            h("div", { class: "lg-sel-name", title: item.name }, item.name),
            h("div", { class: "lg-sel-trigger" }, (function() {
              var words = (civitaiWords.value[id] && civitaiWords.value[id].length) ? civitaiWords.value[id] : (item.triggerWords || []);
              return words.length > 0 ? "触发词: " + words.join(", ") : "点击 T 读取并保存 Civitai 触发词";
            })())
          ]),
          h("button", { class: "lg-sel-civ", title: "读取并保存 Civitai 触发词", onClick: function(e) { e.stopPropagation(); refreshCivitaiWords(id); } }, "T"),
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

      function quickNodeCount(node) {
        var count = (node.items || []).length;
        Object.keys(node.children || {}).forEach(function(name) { count += quickNodeCount(node.children[name]); });
        return count;
      }

      function findQuickNode(root, path) {
        if (!path) return root;
        var current = root;
        var parts = String(path).split("/").filter(function(part) { return part; });
        for (var i = 0; i < parts.length; i++) {
          current = current.children && current.children[parts[i]];
          if (!current) return null;
        }
        return current;
      }

      function openQuickFolder(path, columnIndex) {
        quickPath.value = quickPath.value.slice(0, columnIndex).concat([path]);
        quickHoverItem.value = null;
      }

      function jumpQuickBreadcrumb(pathLength) {
        quickPath.value = quickPath.value.slice(0, pathLength);
        quickHoverItem.value = null;
      }

      function renderQuickModel(item, showFolder) {
        var selected = selectedIds.value.indexOf(item.id) >= 0;
        var words = item.triggerWords || [];
        return h("button", {
          key: "model-" + item.id,
          class: "lg-quick-model" + (selected ? " selected" : ""),
          title: item.folderPath ? item.folderPath + "/" + item.fileName : item.fileName,
          onMouseenter: function() { quickHoverItem.value = item; },
          onClick: function(e) { e.stopPropagation(); addQuickItem(item); }
        }, [
          h("span", { class: "lg-quick-file-icon" }, "L"),
          h("span", { class: "lg-quick-model-name" }, item.name),
          showFolder && item.folderPath ? h("span", { class: "lg-quick-model-path" }, item.folderPath) : null,
          words.length ? h("span", { class: "lg-quick-trigger-mark", title: words.join(", ") }, "T") : null,
          h("span", { class: "lg-quick-model-state" }, selected ? "✓" : "+")
        ]);
      }

      function renderQuickColumn(node, columnIndex, activeFolderPath) {
        var childNames = Object.keys(node.children || {}).sort(function(a, b) { return a.localeCompare(b); });
        var rows = childNames.map(function(name) {
          var child = node.children[name];
          var active = activeFolderPath === child.path;
          return h("button", {
            key: "folder-" + child.path,
            class: "lg-quick-folder" + (active ? " active" : ""),
            title: child.path,
            onMouseenter: function() { quickHoverItem.value = null; },
            onClick: function(e) { e.stopPropagation(); openQuickFolder(child.path, columnIndex); }
          }, [
            h("span", { class: "lg-quick-folder-icon" }, "▰"),
            h("span", { class: "lg-quick-folder-name" }, child.name),
            h("span", { class: "lg-quick-count" }, String(quickNodeCount(child))),
            h("span", { class: "lg-quick-chevron" }, "›")
          ]);
        });
        node.items.slice().sort(function(a, b) { return a.name.localeCompare(b.name); }).forEach(function(item) {
          rows.push(renderQuickModel(item, false));
        });
        if (!rows.length) rows.push(h("div", { class: "lg-quick-state" }, "此目录没有 LoRA"));
        return h("div", { key: "column-" + (node.path || "root"), class: "lg-quick-column" }, [
          h("div", { class: "lg-quick-column-title", title: node.path || "LoRA 根目录" }, node.path ? node.name : "LoRA"),
          h("div", { class: "lg-quick-column-list" }, rows)
        ]);
      }

      var normalizedQuickQuery = quickQuery.value.trim().toLowerCase();
      var quickPickerBody = null;
      var quickBreadcrumb = null;
      if (quickLoading.value) {
        quickPickerBody = h("div", { class: "lg-quick-state" }, "正在读取模型目录...");
      } else if (quickError.value) {
        quickPickerBody = h("div", { class: "lg-quick-state lg-quick-error" }, quickError.value);
      } else if (normalizedQuickQuery) {
        var matchedQuickItems = quickItems.value.filter(function(item) {
          return [item.name, item.fileName, item.folderPath].join(" ").toLowerCase().indexOf(normalizedQuickQuery) >= 0;
        });
        var visibleQuickItems = matchedQuickItems.slice(0, 300);
        quickPickerBody = h("div", { class: "lg-quick-column lg-quick-search-column" }, [
          h("div", { class: "lg-quick-column-title" }, "搜索结果 " + matchedQuickItems.length),
          h("div", { class: "lg-quick-column-list" }, visibleQuickItems.length ? visibleQuickItems.map(function(item) { return renderQuickModel(item, true); }) : h("div", { class: "lg-quick-state" }, "未找到匹配的 LoRA")),
          matchedQuickItems.length > visibleQuickItems.length ? h("div", { class: "lg-quick-limit" }, "仅显示前 300 项，请继续输入关键词缩小范围") : null
        ]);
      } else {
        var quickRoot = buildQuickTree(quickItems.value);
        var allQuickColumns = [quickRoot];
        for (var quickIndex = 0; quickIndex < quickPath.value.length; quickIndex++) {
          var quickNode = findQuickNode(quickRoot, quickPath.value[quickIndex]);
          if (!quickNode) break;
          allQuickColumns.push(quickNode);
        }
        var firstVisibleColumn = Math.max(0, allQuickColumns.length - 2);
        quickPickerBody = allQuickColumns.slice(firstVisibleColumn).map(function(node, visibleIndex) {
          var absoluteColumnIndex = firstVisibleColumn + visibleIndex;
          return renderQuickColumn(node, absoluteColumnIndex, quickPath.value[absoluteColumnIndex] || "");
        });
        var breadcrumbButtons = [h("button", {
          class: "lg-quick-crumb" + (!quickPath.value.length ? " current" : ""),
          onClick: function(e) { e.stopPropagation(); jumpQuickBreadcrumb(0); }
        }, "LoRA")];
        quickPath.value.forEach(function(path, index) {
          var node = findQuickNode(quickRoot, path);
          breadcrumbButtons.push(h("span", { class: "lg-quick-crumb-sep", key: "sep-" + path }, "›"));
          breadcrumbButtons.push(h("button", {
            key: "crumb-" + path,
            class: "lg-quick-crumb" + (index === quickPath.value.length - 1 ? " current" : ""),
            title: path,
            onClick: function(e) { e.stopPropagation(); jumpQuickBreadcrumb(index + 1); }
          }, node ? node.name : path.split("/").pop()));
        });
        quickBreadcrumb = h("div", { class: "lg-quick-breadcrumb" }, breadcrumbButtons);
      }

      var quickPreview = quickHoverItem.value ? h("div", { class: "lg-quick-preview" }, [
        h("img", {
          class: "lg-quick-preview-img",
          src: thumbUrl(quickHoverItem.value.id),
          decoding: "async",
          onError: function(e) { e.target.style.display = "none"; }
        }),
        h("div", { class: "lg-quick-preview-name", title: quickHoverItem.value.name }, quickHoverItem.value.name),
        h("div", { class: "lg-quick-preview-path", title: quickHoverItem.value.folderPath || "根目录" }, quickHoverItem.value.folderPath || "根目录"),
        h("div", { class: "lg-quick-preview-meta" }, formatSize(quickHoverItem.value.size)),
        h("div", { class: "lg-quick-preview-words" }, (quickHoverItem.value.triggerWords || []).length ? "T · " + quickHoverItem.value.triggerWords.join(", ") : "暂无触发词")
      ]) : null;

      var quickPicker = h("div", { class: "lg-quick-wrap", onClick: function(e) { e.stopPropagation(); } }, [
        h("button", { class: "lg-btn lg-quick-toggle", onClick: toggleQuickPicker }, "▾ LoRA 模型树"),
        showQuickPicker.value ? h("div", { class: "lg-quick-popup" }, [
          h("div", { class: "lg-quick-head" }, [
            h("input", {
              class: "lg-quick-search",
              type: "text",
              value: quickQuery.value,
              placeholder: "搜索模型或文件夹...",
              onInput: function(e) { quickQuery.value = e.target.value; }
            }),
            h("button", { class: "lg-btn", title: "重新读取模型目录", onClick: function(e) { e.stopPropagation(); loadQuickItems(true); } }, "刷新")
          ]),
          h("div", { class: "lg-quick-summary" }, "共 " + quickItems.value.length + " 个模型 · 点击模型直接加入右侧列表"),
          quickBreadcrumb,
          h("div", { class: "lg-quick-browser" }, [
            h("div", { class: "lg-quick-columns" }, Array.isArray(quickPickerBody) ? quickPickerBody : [quickPickerBody]),
            quickPreview
          ])
        ]) : null
      ]);

      function onScroll(e) {
        if (!hasMore.value || loading.value) return;
        var el = e.target;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMore();
      }

      var detailsModal = null;
      if (showDetails.value && detailsTarget.value) {
        var detailContent = null;
        if (detailsLoading.value) {
          detailContent = h("div", { class: "lg-details-state" }, "正在通过文件哈希查询 civitai.red 模型信息...");
        } else if (detailsError.value) {
          detailContent = h("div", { class: "lg-details-state lg-details-error" }, detailsError.value);
        } else if (detailsData.value) {
          var civitai = detailsData.value.civitai || {};
          var images = (civitai.images || []).map(function(image, index) {
            var isSetting = settingCover.value === image.url;
            return h("div", { key: image.url || index, class: "lg-details-image-wrap" }, [
              h("img", {
                class: "lg-details-image",
                src: image.url,
                loading: "lazy",
                decoding: "async",
                title: (image.width || "?") + " × " + (image.height || "?")
              }),
              h("button", {
                class: "lg-details-image-setcover",
                disabled: !!settingCover.value,
                title: "把这张图设为封面（会覆盖当前封面）",
                onClick: function(e) { e.stopPropagation(); setPreviewFromImage(image.url); }
              }, isSetting ? "设置中…" : "★ 设为封面")
            ]);
          });
          var stats = civitai.versionStats || civitai.stats || {};
          var fileInfo = (civitai.files || [])[0] || {};
          var fileMetadata = fileInfo.metadata || {};
          var words = civitai.trainedWords || [];
          if (!civitai.found) {
            detailContent = h("div", { class: "lg-details-state" }, "civitai.red 未找到与该模型文件哈希匹配的版本");
          } else {
            detailContent = h("div", { class: "lg-details-layout" }, [
              images.length ? h("div", { class: "lg-details-images" }, images) : h("div", { class: "lg-details-no-image" }, "civitai.red 暂无示例图"),
              setCoverError.value ? h("div", { class: "lg-details-cover-error" }, "设为封面失败: " + setCoverError.value) : null,
              h("div", { class: "lg-details-sections" }, [
                h("section", { class: "lg-detail-section" }, [
                  h("h4", "civitai.red 模型属性"),
                  h("div", { class: "lg-detail-row" }, [h("span", { class: "lg-detail-label" }, "模型名称"), h("span", { class: "lg-detail-value" }, civitai.name || "未知")]),
                  h("div", { class: "lg-detail-row" }, [h("span", { class: "lg-detail-label" }, "版本名称"), h("span", { class: "lg-detail-value" }, civitai.versionName || "未知")]),
                  h("div", { class: "lg-detail-row" }, [h("span", { class: "lg-detail-label" }, "模型 / 版本 ID"), h("span", { class: "lg-detail-value" }, String(civitai.modelId || "未知") + " / " + String(civitai.versionId || "未知"))]),
                  h("div", { class: "lg-detail-row" }, [h("span", { class: "lg-detail-label" }, "类型 / 基础模型"), h("span", { class: "lg-detail-value" }, (civitai.type || "未知") + " / " + (civitai.baseModel || "未知"))]),
                  h("div", { class: "lg-detail-row" }, [h("span", { class: "lg-detail-label" }, "作者"), h("span", { class: "lg-detail-value" }, civitai.creator || "未知")]),
                  h("div", { class: "lg-detail-row" }, [h("span", { class: "lg-detail-label" }, "发布日期"), h("span", { class: "lg-detail-value" }, formatDate(civitai.createdAt))]),
                  h("div", { class: "lg-detail-row" }, [h("span", { class: "lg-detail-label" }, "下载 / 评分"), h("span", { class: "lg-detail-value" }, String(stats.downloadCount || 0) + " / " + String(stats.rating || "无"))]),
                  h("div", { class: "lg-detail-row" }, [h("span", { class: "lg-detail-label" }, "文件参数"), h("span", { class: "lg-detail-value" }, [fileMetadata.fp, fileMetadata.size, fileMetadata.format].filter(Boolean).join(" · ") || "未知")]),
                  h("div", { class: "lg-detail-row" }, [h("span", { class: "lg-detail-label" }, "安全扫描"), h("span", { class: "lg-detail-value" }, [fileInfo.pickleScanResult, fileInfo.virusScanResult].filter(Boolean).join(" / ") || "未知")]),
                  h("div", { class: "lg-detail-tags" }, (civitai.tags || []).slice(0, 24).map(function(tag) { return h("span", { key: tag }, tag); }))
                ]),
                h("section", { class: "lg-detail-section" }, [
                  h("h4", "训练触发词"),
                  h("div", { class: "lg-detail-words" }, words.length ? words.join(", ") : "civitai.red 未提供触发词")
                ]),
                (civitai.description || civitai.versionDescription) ? h("section", { class: "lg-detail-section" }, [
                  h("h4", "模型说明"),
                  h("div", { class: "lg-detail-description" }, civitai.description || civitai.versionDescription)
                ]) : null
              ])
            ]);
          }
        }
        detailsModal = h("div", { class: "lg-modal", onClick: closeDetails }, [
          h("div", { class: "lg-modal-box lg-details-box", onClick: function(e) { e.stopPropagation(); } }, [
            h("div", { class: "lg-modal-hd lg-details-hd" }, [
              h("span", "civitai.red 模型信息 · " + ((detailsData.value && detailsData.value.civitai && detailsData.value.civitai.name) || detailsTarget.value.name)),
              h("button", { class: "lg-modal-close", onClick: closeDetails }, "×")
            ]),
            h("div", { class: "lg-modal-body lg-details-body" }, detailContent),
            h("div", { class: "lg-modal-ft" }, [
              detailsData.value && detailsData.value.civitai && detailsData.value.civitai.url ? h("button", { class: "lg-btn lg-btn-primary", onClick: function() { openCivitai(detailsData.value.civitai.url); } }, "打开 civitai.red") : null,
              h("button", { class: "lg-btn", onClick: function() { openTriggerEditor(detailsTarget.value); closeDetails(); } }, "编辑触发词"),
              h("button", { class: "lg-btn", onClick: closeDetails }, "关闭")
            ])
          ])
        ]);
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
            h("label", { class: "lg-auto-preview" }, [
              h("input", { type: "checkbox", checked: autoPreviewEnabled.value, onChange: function(e) { setAutoPreviewEnabled(e.target.checked); } }),
              h("span", "空闲时自动补全无封面模型（单任务低速）")
            ]),
            h("div", { class: "lg-modal-tip" }, "API Key 仅保存在当前节点 widget 中；自动补全优先读取旁车信息，必要时会计算并向 civitai.red 发送模型文件 SHA256 以识别版本。")
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

      var selectedPanel = h("div", {
        class: "lg-selected" + (galleryCollapsed.value ? " lg-selected-full" : ""),
        style: galleryCollapsed.value ? "" : "width:" + selectedWidth.value + "px"
      }, [
        !galleryCollapsed.value ? h("div", { class: "lg-resizer-right", onMousedown: makeDragHandler("x", selectedWidth, 160, 360, true), title: "拖拽调整宽度" }) : null,
        h("div", { class: "lg-sel-hd" }, [
          h("span", "已选 LoRA (" + selectedIds.value.length + " / 启用 " + selectedIds.value.filter(function(id) { return enabledMap.value[id] !== false; }).length + ")"),
          galleryCollapsed.value ? h("span", { class: "lg-sel-hd-tip" }, "画廊已折叠，可用顶部模型树继续添加") : null
        ]),
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
        selectedList.length === 0 ? h("div", { class: "lg-sel-empty" }, galleryCollapsed.value ? "通过顶部「LoRA 模型树」添加模型" : "点击左侧缩略图选择 LoRA") :
          h("div", { class: "lg-sel-list" }, selectedList)
      ]);

      var galleryBody = galleryCollapsed.value ? [selectedPanel] : [
        h("div", { class: "lg-side", style: "width:" + sideWidth.value + "px" }, [
          h("div", { class: "lg-resizer", onMousedown: makeDragHandler("x", sideWidth, 110, 260), title: "拖拽调整宽度" }),
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
        selectedPanel
      ];

      return h("div", { class: "lg-root", ref: function(el) { rootElRef = el; } }, [
        h("div", { class: "lg-bar" }, [
          h("input", { class: "lg-srch", type: "text", value: query.value, placeholder: "搜索 LoRA...",
            onInput: function(e) { query.value = e.target.value; },
            onKeyup: function(e) { if (e.key === "Enter") doSearch(); }
          }),
          h("button", { class: "lg-btn lg-btn-primary", onClick: doSearch }, "搜索"),
          quickPicker,
          h("button", {
            class: "lg-btn lg-collapse-btn" + (galleryCollapsed.value ? " active" : ""),
            title: galleryCollapsed.value ? "重新加载缩略图画廊" : "卸载缩略图并暂停自动补封面",
            onClick: function() { setGalleryCollapsed(!galleryCollapsed.value); }
          }, galleryCollapsed.value ? "展开画廊" : "折叠画廊"),
          h("select", { class: "lg-sel", value: sortBy.value, onChange: function(e) { sortBy.value = e.target.value; doSearch(); } }, [
            h("option", { value: "name" }, "按名称"),
            h("option", { value: "modified" }, "按修改时间"),
            h("option", { value: "size" }, "按大小")
          ]),
          h("button", { class: "lg-btn", onClick: function() { sortDir.value = sortDir.value === "asc" ? "desc" : "asc"; doSearch(); } }, sortDir.value === "asc" ? "升序" : "降序"),
          h("button", { class: "lg-btn", onClick: function() {
            fetch("/lora_gallery/clear_cache", {method:"POST"}).then(function() {
              quickLoaded = false;
              quickItems.value = [];
              loadFolders();
              if (showQuickPicker.value) loadQuickItems(true);
              if (!galleryCollapsed.value) doSearch();
            });
          } }, "刷新缓存"),
          h("button", { class: "lg-btn", onClick: clearSelection }, "清除选择"),
          h("button", {
            class: "lg-btn",
            disabled: batchFilling.value,
            title: "立即为所有没有封面的模型批量获取 civitai.red 封面（不受折叠状态影响）",
            onClick: runBatchFillCovers
          }, batchFilling.value ? ("补全中 " + batchFillDone.value + "/" + batchFillTotal.value) : "补全无封面"),
          h("button", { class: "lg-btn", onClick: function() { showSettings.value = true; } }, "设置")
        ]),

        h("div", { class: "lg-body" + (galleryCollapsed.value ? " collapsed" : "") }, galleryBody),
        settingsModal,
        triggerEditorModal,
        detailsModal
      ]);
    };
  }
};

// ============================================================
// CSS
// ============================================================
var CSS = [
  ".lg-root{position:relative;display:flex;flex-direction:column;width:100%;min-width:0;height:100%;box-sizing:border-box;background:#121216;color:#bbb;font:13px/1.5 system-ui;overflow:hidden;border-radius:0 0 8px 8px}",
  ".lg-bar{position:relative;display:flex;gap:6px;padding:6px 8px;background:#1a1a22;border-bottom:1px solid #2a2a32;align-items:center;flex-wrap:wrap;z-index:30}",
  ".lg-srch{flex:1;min-width:100px;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px}",
  ".lg-srch:focus{outline:none;border-color:#4a7de0}",
  ".lg-sel{padding:5px 6px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;cursor:pointer}",
  ".lg-btn{padding:5px 12px;border:1px solid #333;border-radius:6px;background:#1c1c26;color:#c8c8cc;font-size:11px;cursor:pointer;transition:all .2s}",
  ".lg-btn:hover{background:#2a2a36;border-color:#4a7de0;color:#fff}",
  ".lg-btn-primary{background:#2a4a8a;border-color:#4a7de0;color:#fff}",
  ".lg-btn-primary:hover{background:#3a5a9a;border-color:#5a8df0}",
  ".lg-collapse-btn.active{background:#254d3a;border-color:#49a775;color:#d9ffea}",
  ".lg-quick-wrap{position:static;display:inline-flex;flex-shrink:0}",
  ".lg-quick-toggle{white-space:nowrap;border-color:#405b8c;color:#dbe7ff}",
  ".lg-quick-popup{position:absolute;top:calc(100% + 6px);left:8px;right:8px;width:auto;height:min(520px,70vh);display:flex;flex-direction:column;background:#15151d;border:1px solid #3a4252;border-radius:8px;box-shadow:0 16px 42px rgba(0,0,0,.65);overflow:hidden;z-index:200}",
  ".lg-quick-head{display:flex;gap:6px;padding:8px;border-bottom:1px solid #2c2c37;background:#1b1b24}",
  ".lg-quick-search{flex:1;min-width:0;padding:6px 8px;border:1px solid #343440;border-radius:5px;background:#0e0e13;color:#d2d2d8;font-size:11px}",
  ".lg-quick-search:focus{outline:none;border-color:#4a7de0}",
  ".lg-quick-summary{padding:5px 9px;color:#737b8b;font-size:9px;border-bottom:1px solid #25252e}",
  ".lg-quick-breadcrumb{display:flex;align-items:center;gap:4px;min-height:31px;padding:4px 8px;border-bottom:1px solid #292933;background:#17171f;overflow-x:auto;box-sizing:border-box}",
  ".lg-quick-crumb{max-width:180px;padding:3px 7px;border:0;border-radius:4px;background:transparent;color:#8490a5;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}",
  ".lg-quick-crumb:hover{background:#252b39;color:#d7dbe4}",
  ".lg-quick-crumb.current{color:#dce6fb;background:#29354b}",
  ".lg-quick-crumb-sep{color:#535c6c;font-size:13px}",
  ".lg-quick-browser{position:relative;flex:1;display:flex;min-height:0;overflow:hidden}",
  ".lg-quick-columns{flex:1;display:flex;min-width:0;overflow:hidden;background:#121219}",
  ".lg-quick-column{width:auto;min-width:0;flex:1 1 50%;height:100%;display:flex;flex-direction:column;border-right:1px solid #2c2c36;background:#15151d;box-sizing:border-box}",
  ".lg-quick-search-column{width:100%;min-width:0;flex-basis:100%}",
  ".lg-quick-column-title{height:30px;padding:7px 10px;box-sizing:border-box;border-bottom:1px solid #292933;color:#7f8797;font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#181820}",
  ".lg-quick-column-list{flex:1;min-height:0;overflow-y:auto;padding:5px}",
  ".lg-quick-folder,.lg-quick-model{width:100%;min-height:34px;padding:5px 7px;border:0;border-radius:5px;background:transparent;color:#b9bbc3;display:flex;align-items:center;gap:7px;text-align:left;cursor:pointer;box-sizing:border-box}",
  ".lg-quick-folder:hover,.lg-quick-model:hover,.lg-quick-folder.active{background:#272d3b;color:#fff}",
  ".lg-quick-folder.active{box-shadow:inset 2px 0 #4a7de0}",
  ".lg-quick-folder{font-weight:600;color:#a7adba}",
  ".lg-quick-folder-icon{width:16px;color:#6caee8;font-size:13px;transform:scaleX(1.15)}",
  ".lg-quick-file-icon{width:16px;height:16px;display:flex;align-items:center;justify-content:center;border:1px solid #53627d;border-radius:3px;color:#9eb6e1;font-size:8px;font-weight:700;flex-shrink:0}",
  ".lg-quick-folder-name,.lg-quick-model-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".lg-quick-model-name{flex:1}",
  ".lg-quick-model-path{max-width:105px;color:#667085;font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".lg-quick-count{margin-left:auto;color:#5f6878;font-size:9px}",
  ".lg-quick-chevron{width:10px;color:#697386;font-size:16px;line-height:1;text-align:right}",
  ".lg-quick-model-state{margin-left:auto;color:#7195d8;font-size:12px;white-space:nowrap}",
  ".lg-quick-trigger-mark{width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:3px;background:#4f3d78;color:#decaff;font-size:9px;font-weight:700;flex-shrink:0}",
  ".lg-quick-model.selected{color:#7fa991;background:rgba(47,93,68,.2);cursor:default}",
  ".lg-quick-model.selected .lg-quick-model-state{color:#69b087}",
  ".lg-quick-preview{position:absolute;left:12px;top:10px;width:230px;max-height:calc(100% - 20px);padding:10px;box-sizing:border-box;border:1px solid #3a3d49;border-radius:8px;background:#181820;overflow:auto;box-shadow:0 12px 32px rgba(0,0,0,.62);z-index:20;pointer-events:none}",
  ".lg-quick-preview-img{width:100%;height:250px;display:block;object-fit:contain;border-radius:7px;background:#0c0c11;box-shadow:0 5px 18px rgba(0,0,0,.35)}",
  ".lg-quick-preview-name{margin-top:9px;color:#e0e1e7;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".lg-quick-preview-path{margin-top:3px;color:#737b8b;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".lg-quick-preview-meta{margin-top:5px;color:#8a93a4;font-size:9px}",
  ".lg-quick-preview-words{margin-top:8px;padding:7px;border-radius:5px;background:#111118;color:#bba9dd;font-size:9px;line-height:1.5;overflow-wrap:anywhere}",
  ".lg-quick-state{padding:24px 12px;text-align:center;color:#737b88;font-size:11px}",
  ".lg-quick-error{color:#e98282}",
  ".lg-quick-limit{padding:8px;text-align:center;color:#9a7b55;font-size:9px}",
  ".lg-body{display:flex;flex:1;overflow:hidden;position:relative}",
  ".lg-side{position:relative;width:160px;min-width:110px;max-width:260px;border-right:1px solid #2a2a32;background:#16161e;overflow:auto;padding:8px 0;flex-shrink:0}",
  ".lg-resizer{position:absolute;top:0;right:0;width:6px;height:100%;cursor:col-resize;background:transparent;z-index:10}",
  ".lg-resizer:hover{background:rgba(74,125,224,0.35)}",
  ".lg-folder-hd{padding:8px 10px;border-bottom:1px solid #2a2a32}",
  ".lg-folder-srch{width:100%;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;box-sizing:border-box}",
  ".lg-folder-srch:focus{outline:none;border-color:#4a7de0}",
  ".lg-main{flex:1 1 auto;display:flex;flex-direction:column;overflow:hidden;min-width:200px;background:#0f0f14;min-height:0}",
  ".lg-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:224px;gap:8px;padding:10px;overflow-y:auto;flex:1;width:100%;box-sizing:border-box;align-content:start;min-height:0}",
  ".lg-grid::-webkit-scrollbar{width:8px}",
  ".lg-grid::-webkit-scrollbar-track{background:transparent}",
  ".lg-grid::-webkit-scrollbar-thumb{background:#3a3a45;border-radius:4px}",
  ".lg-grid::-webkit-scrollbar-thumb:hover{background:#4a4a55}",
  ".lg-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:14px}",
  ".lg-loading{grid-column:1/-1;padding:30px;color:#777;text-align:center}",
  ".lg-card{position:relative;width:100%;min-width:0;height:224px;box-sizing:border-box;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid transparent;background:#1a1a24;transition:border-color .16s,box-shadow .16s;display:flex;flex-direction:column;box-shadow:0 3px 10px rgba(0,0,0,0.28)}",
  ".lg-card:hover{border-color:#4a7de0;box-shadow:0 5px 14px rgba(0,0,0,0.42);z-index:10}",
  ".lg-card.sel{border-color:#4a7de0;background:#1e2a40;box-shadow:inset 0 0 0 2px #4a7de0}",
  ".lg-img-box{position:relative;width:100%;height:140px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;flex-shrink:0}",
  ".lg-img{width:100%;height:100%;object-fit:cover;display:block;background:#111}",
  ".lg-card-info{position:relative;min-width:0;flex:1;background:#16161e;padding-bottom:24px}",
  ".lg-civ-btn{position:absolute;right:5px;bottom:4px;height:18px;padding:0 6px;border-radius:4px;border:1px solid rgba(90,145,255,.5);background:rgba(38,76,145,.82);color:#dce8ff;font-size:9px;font-weight:600;cursor:pointer;z-index:7;opacity:.86;transition:opacity .15s,background .15s}",
  ".lg-civ-btn:hover{opacity:1;background:#315ca5}",
  ".lg-dl-btn{position:absolute;top:6px;right:30px;width:22px;height:22px;border-radius:4px;border:none;background:rgba(60,180,100,0.9);color:#fff;font-size:10px;font-weight:bold;cursor:pointer;z-index:5;opacity:0;transition:opacity .2s}",
  ".lg-card:hover .lg-dl-btn{opacity:1}",
  ".lg-edit-btn{position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:4px;border:none;background:rgba(120,80,200,0.9);color:#fff;font-size:10px;font-weight:bold;cursor:pointer;z-index:5;opacity:0;transition:opacity .2s}",
  ".lg-card:hover .lg-edit-btn{opacity:1}",
  ".lg-name{padding:5px 6px 1px;font-size:11px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".lg-card-trigger{padding:0 6px;color:#7f8796;font-size:9px;line-height:14px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;word-break:break-all}",
  ".lg-size-badge{position:absolute;top:6px;right:6px;z-index:4;padding:2px 5px;border-radius:4px;background:rgba(0,0,0,0.65);color:#ddd;font-size:9px;font-weight:600;pointer-events:none}",
  ".lg-check{position:absolute;inset:0;background:rgba(74,125,224,0.25);display:flex;align-items:center;justify-content:center;z-index:6;pointer-events:none;animation:checkPop .2s cubic-bezier(0.175, 0.885, 0.32, 1.275)}",
  ".lg-check::after{content:'\u2714';width:32px;height:32px;background:#4a7de0;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:bold;box-shadow:0 4px 10px rgba(0,0,0,0.4);border:2px solid #fff}",
  "@keyframes checkPop{from{transform:scale(0.8);opacity:0}to{transform:scale(1);opacity:1}}",
  ".lg-selected{position:relative;width:200px;min-width:160px;max-width:360px;border-left:1px solid #2a2a32;background:#16161e;overflow:hidden;display:flex;flex-direction:column;flex-shrink:0}",
  ".lg-selected-full{width:100%!important;min-width:0;max-width:none;border-left:0;flex:1 1 auto}",
  ".lg-resizer-right{position:absolute;top:0;left:0;width:6px;height:100%;cursor:col-resize;background:transparent;z-index:10}",
  ".lg-resizer-right:hover{background:rgba(74,125,224,0.35)}",
  ".lg-sel-hd{padding:8px 10px;font-weight:600;border-bottom:1px solid #2a2a32;background:#1a1a22;color:#ddd;display:flex;align-items:center;justify-content:space-between;gap:12px}",
  ".lg-sel-hd-tip{font-size:9px;font-weight:400;color:#71809b}",
  ".lg-sel-manual{padding:10px;border-bottom:1px solid #2a2a32;background:#16161e}",
  ".lg-sel-manual-label{font-size:11px;color:#999;margin-bottom:6px}",
  ".lg-sel-manual-input{width:100%;min-height:46px;padding:6px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;resize:vertical;box-sizing:border-box}",
  ".lg-sel-manual-input:focus{outline:none;border-color:#4a7de0}",
  ".lg-sel-empty{padding:20px 10px;color:#666;text-align:center;font-size:11px}",
  ".lg-sel-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px;min-height:0}",
  ".lg-selected-full .lg-sel-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));grid-auto-rows:min-content;align-content:start;padding:12px;gap:10px}",
  ".lg-sel-item{display:flex;align-items:center;gap:8px;padding:6px;background:#1a1a24;border-radius:6px;border:1px solid #2a2a32;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}",
  ".lg-sel-item.enabled{border-color:#3b73d1;background:#223554;box-shadow:inset 3px 0 #4a86eb}",
  ".lg-sel-item.enabled:hover{background:#294266;border-color:#5593ef}",
  ".lg-sel-item.disabled{opacity:.58;border-style:dashed;background:#14141a}",
  ".lg-sel-item.disabled:hover{opacity:.78;border-color:#596173}",
  ".lg-sel-item.disabled .lg-sel-thumb{filter:grayscale(1)}",
  ".lg-sel-thumb{width:40px;height:40px;border-radius:4px;object-fit:cover;background:#000;flex-shrink:0}",
  ".lg-sel-info{flex:1;min-width:0}",
  ".lg-sel-name{font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".lg-sel-trigger{font-size:9px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}",
  ".lg-sel-weight{width:50px;padding:3px;border:1px solid #333;border-radius:3px;background:#0e0e12;color:#c8c8cc;font-size:11px;text-align:center}",
  ".lg-sel-remove{width:20px;height:20px;border-radius:50%;border:none;background:#e55;color:#fff;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
  ".lg-sel-civ{width:22px;height:22px;border-radius:4px;border:none;background:rgba(74,125,224,0.85);color:#fff;font-size:10px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
  ".lg-modal{position:absolute;inset:0;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;z-index:10000}",
  ".lg-modal-box{width:360px;background:#1a1a22;border:1px solid #333;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,0.6);overflow:hidden}",
  ".lg-modal-hd{padding:12px 16px;font-size:14px;font-weight:600;border-bottom:1px solid #2a2a32;background:#121216;color:#ddd}",
  ".lg-modal-body{padding:16px}",
  ".lg-modal-row{display:flex;flex-direction:column;gap:6px}",
  ".lg-modal-label{font-size:12px;color:#999}",
  ".lg-modal-input{width:100%;padding:8px 10px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px;box-sizing:border-box}",
  ".lg-modal-input:focus{outline:none;border-color:#4a7de0}",
  ".lg-modal-tip{font-size:11px;color:#666;margin-top:10px}",
  ".lg-modal-ft{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #2a2a32;background:#121216}",
  ".lg-auto-preview{display:flex;align-items:center;gap:8px;margin-top:14px;color:#bbb;font-size:11px;cursor:pointer}",
  ".lg-details-box{width:min(780px,calc(100% - 28px));max-height:calc(100% - 28px);display:flex;flex-direction:column}",
  ".lg-details-hd{display:flex;align-items:center;justify-content:space-between;gap:12px}",
  ".lg-modal-close{border:0;background:transparent;color:#aaa;font-size:22px;line-height:1;cursor:pointer}",
  ".lg-details-body{padding:12px;overflow:auto;min-height:120px}",
  ".lg-details-state{padding:36px;text-align:center;color:#8f98a8}",
  ".lg-details-error{color:#e98282}",
  ".lg-details-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:12px;align-items:start}",
  ".lg-details-images{display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:520px;overflow:auto}",
  ".lg-details-image{width:100%;height:150px;object-fit:cover;border-radius:6px;background:#0b0b0f}",
  ".lg-details-image-wrap{position:relative}",
  ".lg-details-image-setcover{position:absolute;left:4px;right:4px;bottom:4px;padding:4px 0;font-size:10px;border:none;border-radius:4px;background:rgba(20,20,26,.85);color:#f0c040;cursor:pointer;opacity:0;transition:opacity .15s}",
  ".lg-details-image-wrap:hover .lg-details-image-setcover{opacity:1}",
  ".lg-details-image-setcover:disabled{cursor:default;opacity:1;color:#888}",
  ".lg-details-cover-error{grid-column:1/-1;color:#e77;font-size:11px;padding:6px 8px;background:rgba(200,60,60,.12);border-radius:4px}",
  ".lg-details-no-image{height:180px;display:flex;align-items:center;justify-content:center;border:1px dashed #34343e;border-radius:6px;color:#666}",
  ".lg-details-sections{display:flex;flex-direction:column;gap:8px;min-width:0}",
  ".lg-detail-section{padding:9px 10px;border:1px solid #2e2e38;border-radius:7px;background:#15151c}",
  ".lg-detail-section h4{margin:0 0 7px;color:#d9d9df;font-size:12px}",
  ".lg-detail-row{display:grid;grid-template-columns:112px minmax(0,1fr);gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.035);font-size:10px}",
  ".lg-detail-label{color:#777f8d}",
  ".lg-detail-value{color:#c8c8cf;overflow-wrap:anywhere;white-space:pre-wrap}",
  ".lg-hash{font-family:ui-monospace,monospace;font-size:9px}",
  ".lg-detail-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}",
  ".lg-detail-tags span{padding:2px 6px;border-radius:10px;background:#263452;color:#aebfe4;font-size:9px}",
  ".lg-detail-words{padding:7px;border-radius:5px;background:#101016;color:#d3c08d;line-height:1.6;overflow-wrap:anywhere}",
  ".lg-detail-description{max-height:130px;overflow:auto;color:#a9a9b2;font-size:10px;line-height:1.6;white-space:pre-wrap}",
  ".lg-detail-empty{color:#666;font-size:10px;padding:4px 0}",
  "@media(max-width:760px){.lg-details-layout{grid-template-columns:1fr}.lg-details-images{grid-template-columns:repeat(4,1fr);max-height:150px}.lg-details-image{height:120px}}",
  ".lg-root .ft-wrap{user-select:none}",
  ".lg-root .ft-empty{padding:12px;color:#555;font-size:11px;text-align:center}",
  ".lg-root .ft-r{display:flex;align-items:center;padding:6px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;border-radius:0 20px 20px 0;margin:1px 0;transition:all .15s;font-size:11px;color:#999;position:relative}",
  ".lg-root .ft-r:hover{background:rgba(255,255,255,0.05);color:#ccc}",
  ".lg-root .ft-r.sel{background:linear-gradient(90deg, #3a5a8a, #4a7de0);color:#fff;font-weight:600}",
  ".lg-root .ft-arr,.lg-root .ft-arr-place{width:18px;font-size:10px;color:#555;text-align:center;flex-shrink:0;transition:transform .25s}",
  ".lg-root .ft-arr.open{transform:rotate(90deg);color:#999}",
  ".lg-root .ft-nm{overflow:hidden;text-overflow:ellipsis;flex:1}"
].join("\n");

// ============================================================
app.registerExtension({
  name: "EagleSuite.LoraGallery",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleLoraGalleryNode") return;

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
      // DOM widget 的百分比宽度会受创建时布局缓存影响。节点变宽后改用实时像素宽度，
      // 避免 Vue 画廊仍停留在旧宽度并被挤在节点左侧。
      el.style.cssText = "width:940px;max-width:none;min-width:0;height:100%;box-sizing:border-box;overflow:hidden;border-radius:0 0 8px 8px;background:#121216;";

      this.addDOMWidget("lora_gallery", "div", el, { serialize: false });

      var applyFrame = function(size) {
        var nodeWidth = Number(size && size[0]) || 960;
        var nodeHeight = Number(size && size[1]) || 720;
        var w = Math.max(320, nodeWidth - 20);
        // 标题、插槽和两个原生 widget 会占用约 170px；保留余量避免 DOM 越出节点底框。
        var h = Math.max(300, nodeHeight - 180);
        el.style.width = w + "px";
        el.style.height = h + "px";
        return [w, h];
      };
      var nodeRef = this;
      // 不覆盖 DOM widget.computeSize。ComfyUI 会在创建/拖入任意节点时重新测量
      // 所有 widget；若这里用当前 node.size 反推控件高度，就会在每次测量时把
      // LiteGraph 的标题/插槽高度重复加回节点，造成画廊持续增高。
      this._lgApplyFrame = applyFrame;
      applyFrame(this.size);

      // 强制重新计算 ComfyUI 节点尺寸，消除隐藏 widget 留下的空隙
      try { nodeRef.setDirtyCanvas(true, true); } catch (e) {}

      try {
        var appInstance = createApp(LoraGallery, { node: nodeRef });
        appInstance.mount(el);
        this._vueApp = appInstance;
      } catch (e) {
        console.error("[LoraGallery] mount failed:", e);
        el.replaceChildren();
        var errorBox = document.createElement("div");
        errorBox.style.cssText = "padding:30px;color:#e55";
        errorBox.textContent = "Error: " + (e && e.message ? e.message : "mount failed");
        el.appendChild(errorBox);
      }

      var onResize = this.onResize;
      this.onResize = function(size) {
        if (onResize) onResize.apply(this, arguments);
        applyFrame(size);
        try { nodeRef.setDirtyCanvas(true, true); } catch (e) {}
      };

      // 工作流恢复尺寸发生在 onNodeCreated 之后时，补一次异步同步。
      setTimeout(function() { applyFrame(nodeRef.size); }, 0);
      setTimeout(function() { applyFrame(nodeRef.size); }, 250);
    };

    var onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      var result = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      var nodeRef = this;
      setTimeout(function() {
        if (nodeRef._lgApplyFrame) nodeRef._lgApplyFrame(nodeRef.size);
      }, 0);
      return result;
    };

    var onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function() {
      if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
      this._lgApplyFrame = null;
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  }
});
