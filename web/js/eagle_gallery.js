/**
 * Eagle Gallery Vue — 无限滚动懒加载 + 已选图像预览条
 */
import { app } from "../../../scripts/app.js";
import { createApp, h, ref, computed, onMounted } from "../../lib/vue.esm-browser.js";

// ============================================================
// 文件夹树
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
    function filterFolders(list) {
      var q = (props.query || "").trim().toLowerCase();
      if (!q) return list;
      return list.filter(function(f) {
        if (matchQuery(f.name)) return true;
        return anyChildMatch(f);
      });
    }
    function renderNode(folder, level) {
      var q = (props.query || "").trim().toLowerCase();
      if (q && !matchQuery(folder.name) && !anyChildMatch(folder)) return null;
      var hasKids = folder.children && folder.children.length > 0;
      var isOpen = expanded.value[folder.id] || (q && anyChildMatch(folder)); // 搜索时自动展开含匹配子项的父级
      var isSel = props.selectedId === folder.id;
      var indent = level * 16;
      var arrow = hasKids ? "\u25B6" : "";
      var arrCls = hasKids ? "ft-arr" + (isOpen ? " open" : "") : "ft-arr-place";
      var row = [
        h("span", { class: arrCls, onClick: function(e) { e.stopPropagation(); toggle(folder); } }, arrow),
        h("span", { class: "ft-nm" }, folder.name || "")
      ];
      var children = [h("div", {
        class: "ft-r" + (isSel ? " sel" : ""), style: "padding-left:" + (6 + indent) + "px;",
        onClick: function() { props.onSelect(folder); }
      }, row)];
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
      var list = filterFolders(props.folders || []);
      return h("div", { class: "ft-wrap" },
        list.length === 0 ? h("div", { class: "ft-empty" }, "\u65E0\u5339\u914D\u6587\u4EF6\u5939") :
          list.map(function(f) { return renderNode(f, 0); })
      );
    };
  }
};

// ============================================================
// 图片网格（无限滚动）
// ============================================================
var ImageGrid = {
  name: "ImageGrid",
  props: { items: Array, selectedIds: Array, onSelect: Function, thumbUrl: Function, onLoadMore: Function, hasMore: Boolean, loading: Boolean, ratio: String },
  setup: function(props) {
    function onScroll(e) {
      if (!props.hasMore || props.loading) return;
      var el = e.target;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) props.onLoadMore();
    }
    return function() {
      var list = props.items || [];
      if (list.length === 0 && !props.loading) {
        return h("div", { class: "g-empty" }, "\u6682\u65E0\u56FE\u7247");
      }
      var cards = list.map(function(item, idx) {
        var sel = props.selectedIds && props.selectedIds.indexOf(item.id) >= 0;
        var src = props.thumbUrl ? props.thumbUrl(item.id) : "";
        var cardStyle = props.ratio && props.ratio !== "auto" ? "aspect-ratio:" + props.ratio + ";" : "";
        
        return h("div", {
          key: item.id,
          class: "g-card" + (sel ? " sel" : ""),
          style: cardStyle,
          onClick: function(e) { props.onSelect(item, idx, e); }
        }, [
          h("div", { class: "g-img-box" }, [
            h("img", { src: src, class: "g-img",
              onError: function(e) {
                if (e.target._errFixed) return;
                e.target._errFixed = true;
                e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='75'%3E%3Crect width='100' height='75' fill='%23333'/%3E%3Ctext x='50' y='40' text-anchor='middle' fill='%23666' font-size='10'%3E无缩略图%3C/text%3E%3C/svg%3E";
              }
            })
          ]),
          h("div", { class: "g-idx-tag" }, "#" + idx),
          h("div", { class: "g-size" }, (item.width || "?") + " \u00D7 " + (item.height || "?")),
          item.star > 0 ? h("div", { class: "g-star" }, "\u2605".repeat(item.star)) : null,
          sel ? h("div", { class: "g-check" }) : h("div")
        ]);
      });
      if (props.loading) {
        cards.push(h("div", { class: "g-load-more", key: "_loader" }, "\u52A0\u8F7D\u4E2D\u2026"));
      }
      return h("div", { class: "g-wrap", onScroll: onScroll }, cards);
    };
  }
};

// ============================================================
// 已选图像预览条
// ============================================================
var SelectionBar = {
  name: "SelectionBar",
  props: { items: Array, selectedIds: Array, onRemove: Function, onClear: Function },
  setup: function(props) {
    return function() {
      var selected = [];
      props.items.forEach(function(item) {
        if (props.selectedIds && props.selectedIds.indexOf(item.id) >= 0) {
          selected.push(item);
        }
      });
      if (selected.length === 0) return h("div");

      return h("div", { class: "sb-wrap" }, [
        h("div", { class: "sb-list" }, selected.map(function(item) {
          var src = item.id ? "/eagle_gallery/thumbnail?id=" + encodeURIComponent(item.id) : "";
          return h("div", { class: "sb-item", key: item.id }, [
            h("img", { src: src, class: "sb-thumb" }),
            h("button", { class: "sb-remove", onClick: function() { props.onRemove(item); }, title: "\u79FB\u9664" }, "\u2715")
          ]);
        })),
        h("div", { class: "sb-info" }, [
          h("span", {}, "\u5DF2\u9009 " + selected.length + " \u5F20"),
          h("button", { class: "eg-btn sb-clear", onClick: props.onClear }, "\u6E05\u9664")
        ])
      ]);
    };
  }
};

// ============================================================
// 颜色下拉
// ============================================================
var ColorDropdown = {
  name: "ColorDropdown",
  props: { modelValue: String, onChange: Function },
  setup: function(props) {
    var open = ref(false);
    var palette = [
      "#ffffff", "#f5f5f5", "#dcdcdc", "#8c8c8c", "#434343", "#000000",
      "#f5222d", "#fa541c", "#fa8c16", "#faad14", "#fadb14", "#a0d911", "#52c41a", "#13c2c2",
      "#1890ff", "#2f54eb", "#722ed1", "#eb2f96", "#9254de", "#f759ab",
      "#b7eb8f", "#87e8de", "#91d5ff", "#adc6ff", "#d3adf7", "#ffadd2", "#ffd666", "#ffa940"
    ].slice(0, 20); // 强制限制为 20 色 Ant Design 风格
    function toggle(e) { e.stopPropagation(); open.value = !open.value; }
    function pick(c) { props.onChange(props.modelValue === c ? "" : c); }
    return function() {
      var label = props.modelValue
        ? h("span", { class: "cl-dot", style: "background:" + props.modelValue + ";border:1px solid #555" })
        : h("span", {}, "\u2631 \u5168\u90E8\u989C\u8272");
      var popup = null;
      if (open.value) {
        popup = h("div", { class: "cl-pop" }, [
          h("div", { class: "cl-grd" }, palette.map(function(c) {
            var active = props.modelValue === c;
            return h("span", { key: c, class: "cl-c" + (active ? " on" : ""), style: "background:" + c + ";", onClick: function() { pick(c); } });
          })),
          h("div", { class: "cl-clr", onClick: function() { props.onChange(""); open.value = false; } }, "\u00D7 \u6E05\u9664")
        ]);
      }
      return h("div", { class: "cl-wrap" }, [
        h("div", { class: "cl-trig" + (open.value ? " open" : ""), onClick: toggle }, [
          label, h("span", { class: "cl-arr" }, "\u25BC")
        ]),
        popup ? popup : h("div")
      ]);
    };
  }
};

// ============================================================
// 设置弹窗
// ============================================================
var SettingsDialog = {
  name: "SettingsDialog",
  props: { visible: Boolean, apiUrl: String, onClose: Function, onSave: Function },
  setup: function(props) {
    var url = ref(props.apiUrl || "");
    return function() {
      if (!props.visible) return h("div");
      return h("div", { class: "sd-over", onClick: props.onClose }, [
        h("div", { class: "sd-box", onClick: function(e) { e.stopPropagation(); } }, [
          h("div", { class: "sd-hd" }, [h("span", {}, "\u2699 \u8BBE\u7F6E"), h("button", { class: "sd-x", onClick: props.onClose }, "\u2715")]),
          h("div", { class: "sd-bd" }, [
            h("label", { class: "sd-lbl" }, "Eagle API URL (含 Token)"), 
            h("input", { 
              class: "sd-inp", 
              type: "text", 
              value: url.value, 
              placeholder: "http://localhost:41595?token=...",
              onInput: function(e) { url.value = e.target.value; } 
            }),
            h("div", { style: "font-size:10px;color:#666;margin-top:8px;line-height:1.4" }, [
              h("p", {}, "\u63D0\u793A\uFF1A\u8BF7\u8F93\u5165\u5305\u542B token \u7684\u5B8C\u6574\u94FE\u63A5\u3002"),
              h("p", {}, "\u4F8B\u5982: http://127.0.0.1:41595?token=your_token")
            ])
          ]),
          h("div", { class: "sd-ft" }, [
            h("button", { class: "eg-btn", onClick: function() { props.onSave(url.value); } }, "\u4FDD\u5B58"),
            h("button", { class: "eg-btn", onClick: props.onClose }, "\u53D6\u6D88")
          ])
        ])
      ]);
    };
  }
};

// ============================================================
// 标签筛选弹窗
// ============================================================
var TagFilterDialog = {
  name: "TagFilterDialog",
  props: { visible: Boolean, tags: Array, selectedTags: Array, onClose: Function, onChange: Function, loading: Boolean },
  setup: function(props) {
    var tagQuery = ref("");
    function toggleTag(tagName) {
      var sels = (props.selectedTags || []).slice();
      var idx = sels.indexOf(tagName);
      if (idx >= 0) sels.splice(idx, 1);
      else sels.push(tagName);
      props.onChange(sels);
    }
    function clearAll() { props.onChange([]); }
    function groupedTags() {
      var q = (tagQuery.value || "").trim().toLowerCase();
      var list = (props.tags || []).filter(function(t) {
        if (!q) return true;
        return (t.name || "").toLowerCase().indexOf(q) >= 0;
      });
      var groups = {};
      list.forEach(function(t) {
        var name = t.name || "";
        var first = name.charAt(0).toUpperCase();
        if (!first || !/[A-Z\u4e00-\u9fa5]/.test(first)) first = "#";
        if (!groups[first]) groups[first] = [];
        groups[first].push(t);
      });
      var keys = Object.keys(groups).sort();
      return keys.map(function(k) { return { key: k, tags: groups[k] }; });
    }
    return function() {
      if (!props.visible) return h("div");
      var selected = props.selectedTags || [];
      return h("div", { class: "sd-over", onClick: props.onClose }, [
        h("div", { class: "sd-box tg-box", onClick: function(e) { e.stopPropagation(); } }, [
          h("div", { class: "sd-hd" }, [
            h("span", {}, "\u{1F3F7} \u6807\u7B7E\u7B5B\u9009"),
            h("button", { class: "sd-x", onClick: props.onClose }, "\u2715")
          ]),
          h("div", { class: "tg-hd" }, [
            h("input", { class: "sd-inp", placeholder: "\u641C\u7D22\u6807\u7B7E...", value: tagQuery.value,
              onInput: function(e) { tagQuery.value = e.target.value; }
            }),
            selected.length > 0 ? h("button", { class: "eg-btn tg-clr", onClick: clearAll }, "\u6E05\u9664 (" + selected.length + ")") : null
          ]),
          h("div", { class: "tg-sel" }, selected.length === 0 ? h("span", { class: "tg-sel-empty" }, "\u672A\u9009\u6807\u7B7E") :
            selected.map(function(t) {
              return h("span", { class: "tg-chip", key: t, onClick: function() { toggleTag(t); } }, [t, h("b", {}, " \u2715")]);
            })
          ),
          h("div", { class: "tg-bd" }, props.loading ? h("div", { class: "tg-loading" }, "\u52A0\u8F7D\u4E2D...") :
            groupedTags().map(function(g) {
              return h("div", { class: "tg-grp", key: g.key }, [
                h("div", { class: "tg-grp-h" }, g.key + " (" + g.tags.length + ")"),
                h("div", { class: "tg-list" }, g.tags.map(function(t) {
                  var active = selected.indexOf(t.name) >= 0;
                  return h("div", { class: "tg-it" + (active ? " on" : ""), key: t.name, onClick: function() { toggleTag(t.name); } }, [
                    h("span", { class: "tg-nm" }, t.name),
                    h("span", { class: "tg-cnt" }, t.count || 0)
                  ]);
                }))
              ]);
            })
          ),
          h("div", { class: "sd-ft" }, [
            h("button", { class: "eg-btn", onClick: props.onClose }, "\u5B8C\u6210")
          ])
        ])
      ]);
    };
  }
};

// ============================================================
// 主组件
// ============================================================
var EagleGallery = {
  name: "EagleGallery",
  props: { node: { type: Object, required: true } },
  setup: function(props) {
    // 修复：之前完全靠 document.querySelector(".eg-root") / 遍历
    // app.graph._nodes 来猜自己属于哪个节点，画布上放两个 Eagle Gallery
    // 节点时必定串数据。现在节点实例直接作为 prop 传进来，永远用
    // props.node.id，准确且不用做 DOM 探测。
    var rootElRef = null;
    var query = ref("");
    var folderId = ref("_all");
    var star = ref("全部");
    var shape = ref("全部");
    var ratioMode = ref("16/9");
    var color = ref("");
    var outMode = ref("rgb");
    var seqIdx = ref(0);

    // 新增：分辨率 / 格式 / 标签筛选
    var resolution = ref("全部");
    var format = ref("全部");
    var selectedTags = ref([]);
    var tagPopupVisible = ref(false);
    var allTags = ref([]);
    var tagsLoading = ref(false);

    // 新增：文件夹搜索
    var folderQuery = ref("");

    // 新增：整夹输出状态
    var wholeFolderOutput = ref(false);

    var items = ref([]);
    var folders = ref([]);
    var selectedIds = ref([]);
    var selectedItems = ref({}); // id -> item 全局缓存，已选项跨文件夹保持可见
    var loading = ref(false);
    var total = ref(0);
    var err = ref("");
    var setVis = ref(false);
    var apiUrl = ref("http://localhost:41595");
    var apiToken = ref("");
    var offset = ref(0);
    var hasMore = ref(true);

    function thumbUrl(id) {
      // 主 URL: 通过 ComfyUI 代理
      var url = "/eagle_gallery/thumbnail?id=" + encodeURIComponent(String(id));
      return url;
    }

    // ── API ──
    function loadSettings() {
      fetch("/eagle_gallery/settings").then(function(r){return r.json()}).then(function(d){
        if(d.success&&d.settings){ apiUrl.value=d.settings.eagle_url||"http://localhost:41595"; }
      }).catch(function(){});
    }
    function saveSettings(u){
      fetch("/eagle_gallery/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eagle_url:u})})
        .then(function(r){return r.json()}).then(function(d){
          if(d.success){apiUrl.value=u;setVis.value=false;resetAndLoad();}
        }).catch(function(e){err.value="save: "+e.message;});
    }
    function loadFolders(){
      fetch("/eagle_gallery/folders").then(function(r){return r.json()}).then(function(d){
        if(d.success&&d.folders){
          var f=d.folders;
          if(Array.isArray(f)&&f.length>0&&f[0].id!=="_all") f.unshift({id:"_all",name:"\u5168\u90E8",children:[]});
          folders.value=f;
        }
      }).catch(function(e){});
    }

    // 重置并加载
    function resetAndLoad() {
      items.value = []; offset.value = 0; hasMore.value = true;
      loadFolders(); loadMore();
    }

    // 加载更多（无限滚动）
    function loadMore() {
      if (loading.value || !hasMore.value) return;
      loading.value = true; err.value = "";

      fetch("/eagle_gallery/items", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: offset.value,
          limit: 100,
          folderId: folderId.value === "_all" ? "" : folderId.value,
          keywords: query.value, star: star.value, shape: shape.value,
          color: color.value || "",
          resolution: resolution.value,
          format: format.value,
          tags: selectedTags.value
        })
      }).then(function(r){return r.json()}).then(function(d){
        loading.value = false;
        if (d.success) {
          var newItems = d.items || [];
          items.value = items.value.concat(newItems);
          offset.value = offset.value + newItems.length;
          total.value = d.total || items.value.length;
          hasMore.value = newItems.length >= 100;
          if (newItems.length > 0 && !window._egLogged) {
            window._egLogged = true;
            console.log("[EG] first item keys:", Object.keys(newItems[0]), "| thumbnail:", newItems[0].thumbnail, "| id:", newItems[0].id);
          }
        } else { err.value = d.error || "fail"; }
      }).catch(function(e){ loading.value = false; err.value = e.message; });
    }

    // 加载标签列表（按使用数量排序）
    function loadTags() {
      tagsLoading.value = true;
      fetch("/eagle_gallery/tags", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: folderId.value === "_all" ? "" : folderId.value,
          keywords: query.value
        })
      }).then(function(r){return r.json();}).then(function(d){
        tagsLoading.value = false;
        if (d.success && Array.isArray(d.tags)) {
          allTags.value = d.tags;
        }
      }).catch(function(){ tagsLoading.value = false; });
    }

    // 重新搜索
    function doSearch() {
      items.value = []; offset.value = 0; hasMore.value = true; err.value = "";
      loadTags(); loadMore();
    }

    function onFolder(f) { folderId.value = f.id; doSearch(); }

    // 将当前选中状态同步到后端缓存
    function syncSelection(customSelections) {
      var nodeId = String(props.node.id);
      if (!nodeId) return;

      var sels = [];
      var srcSels = customSelections || [];
      srcSels.forEach(function(sel) {
        sels.push(sel);
      });
      // 未传自定义时使用当前选中：优先从全局已选缓存取，其次从当前 items 查找
      if (srcSels.length === 0) {
        selectedIds.value.forEach(function(sid) {
          var cached = selectedItems.value[sid];
          if (cached) {
            sels.push({
              id: sid,
              filePath: cached.filePath || cached.thumbnail || "",
              tags: cached.tags || [],
              name: cached.name || "",
              ext: cached.ext || "",
              width: cached.width || 0,
              height: cached.height || 0,
            });
            return;
          }
          for (var i = 0; i < items.value.length; i++) {
            if (items.value[i].id === sid) {
              sels.push({
                id: sid,
                filePath: items.value[i].filePath || items.value[i].thumbnail || "",
                tags: items.value[i].tags || [],
                name: items.value[i].name || "",
                ext: items.value[i].ext || "",
                width: items.value[i].width || 0,
                height: items.value[i].height || 0,
              });
              break;
            }
          }
        });
      }

      fetch("/eagle_gallery/cache_selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_id: nodeId,
          selections: sels,
          output_mode: outMode.value,
          selections_data: JSON.stringify({ selections: sels }),
          sequence_index: seqIdx.value
        })
      }).catch(function(){});

      // 同步到 ComfyUI 原生 widget（用于工作流保存时持久化选择数据）。
      // 注意：不调用 setDirtyCanvas，避免每次选图都触发 ComfyUI 重绘节点，
      // 重绘会把 DOM widget 宽度重新计算，导致画面被压缩。
      try {
        var widget = (props.node.widgets || []).find(function(w) { return w.name === "selection_data"; });
        if (widget) {
          widget.value = JSON.stringify({ selections: sels, output_mode: outMode.value, sequence_index: seqIdx.value });
        }
      } catch (e) {}
    }

      // 整夹输出：将当前筛选结果下已加载的全部图片作为选中项
    function selectAllForOutput() {
      var sels = [];
      items.value.forEach(function(item) {
        sels.push({
          id: item.id,
          filePath: item.filePath || item.thumbnail || "",
          tags: item.tags || [],
          name: item.name || "",
          ext: item.ext || "",
          width: item.width || 0,
          height: item.height || 0,
        });
        selectedItems.value[item.id] = item;
      });
      selectedIds.value = sels.map(function(s){ return s.id; });
      syncSelection(sels);
    }

    function onImg(item, index, e) {
      e = e || window.event;
      if (e && e.shiftKey && selectedIds.value.length > 0) {
        // 实现 Shift 连选逻辑
        var lastId = selectedIds.value[selectedIds.value.length - 1];
        var lastIdx = -1;
        for(var k=0; k<items.value.length; k++) if(items.value[k].id === lastId) { lastIdx = k; break; }
        if (lastIdx !== -1) {
          var start = Math.min(lastIdx, index);
          var end = Math.max(lastIdx, index);
          for (var j = start; j <= end; j++) {
            var id = items.value[j].id;
            if (selectedIds.value.indexOf(id) === -1) selectedIds.value.push(id);
          }
          syncSelection();
          return;
        }
      }
      var i = selectedIds.value.indexOf(item.id);
      if (i >= 0) {
        selectedIds.value.splice(i, 1);
        delete selectedItems.value[item.id];
      } else {
        selectedIds.value.push(item.id);
        // 全局缓存完整 item，使切换目录后已选预览条仍能找到数据
        selectedItems.value[item.id] = item;
      }
      syncSelection();
    }

    function jumpTo(idx) {
      // 修复：改用节点自己的根元素查找 .g-wrap，而不是全局
      // document.querySelector（画布上多个节点时会永远找到第一个）。
      var grid = rootElRef ? rootElRef.querySelector(".g-wrap") : null;
      if (!grid) return;
      var cards = grid.querySelectorAll(".g-card");
      if (cards[idx]) {
        cards[idx].scrollIntoView({ behavior: "smooth", block: "center" });
        cards[idx].classList.add("jump-hit");
        setTimeout(function(){ cards[idx].classList.remove("jump-hit"); }, 2000);
      }
    }

    // 根据编号（支持单个、逗号分隔、或 始-终 范围）选中对应图片
    function selectByIndex(input) {
      if (!input) return;
      var list = [];
      var part = String(input).trim().replace(/[\[\]\s]/g, "");
      if (!part) return;

      part.split(",").forEach(function(seg) {
        if (!seg) return;
        if (seg.indexOf("-") >= 0) {
          var range = seg.split("-");
          var start = parseInt(range[0], 10) || 0;
          var end = parseInt(range[1], 10);
          if (isNaN(end)) end = start;
          for (var i = Math.min(start, end); i <= Math.max(start, end); i++) {
            list.push(i);
          }
        } else {
          var n = parseInt(seg, 10);
          if (!isNaN(n)) list.push(n);
        }
      });

      if (list.length === 0) return;

      list.forEach(function(idx) {
        if (idx >= 0 && idx < items.value.length) {
          var item = items.value[idx];
          var id = item.id;
          if (selectedIds.value.indexOf(id) === -1) {
            selectedIds.value.push(id);
            selectedItems.value[id] = item;
          }
        }
      });

      // 滚动到最后选中的项
      jumpTo(list[list.length - 1]);
      syncSelection();
    }

    function removeSelected(item) {
      var i = selectedIds.value.indexOf(item.id);
      if (i >= 0) selectedIds.value.splice(i, 1);
      delete selectedItems.value[item.id];
      syncSelection();
    }

    function clearSel() { selectedIds.value = []; selectedItems.value = {}; syncSelection(); }

    function onColor(c) { color.value = c; doSearch(); }

    // 修复：不再依赖前面通过 DOM CustomEvent 转发的恢复数据（那套逻辑
    // 挂在 document 上查找 .eg-root，多节点场景下会拿错），直接用
    // props.node.id 请求一次缓存的选中数据。
    function restoreSelection() {
      var nodeId = String(props.node.id);
      fetch("/eagle_gallery/cache_selection?node_id=" + encodeURIComponent(nodeId))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success && d.selections && d.selections.length > 0) {
            var ids = [];
            d.selections.forEach(function(s) {
              ids.push(s.id);
              // 用后端缓存的完整数据回填全局已选缓存
              if (s.id && (s.filePath || s.name || s.thumbnail)) {
                selectedItems.value[s.id] = s;
              }
            });
            selectedIds.value = ids;
            outMode.value = d.output_mode || "rgb";
            seqIdx.value = d.sequence_index || 0;
          }
        }).catch(function() {});
    }

    onMounted(function() {
      loadSettings(); loadFolders(); loadMore();
      // ComfyUI 节点创建之初 id 可能还是临时 id，稍等一下再按最终 id 恢复
      setTimeout(restoreSelection, 500);
    });

    return function() {
      var mainKids = [];
      if (err.value) mainKids.push(h("div", { class: "eg-err" }, err.value));
      mainKids.push(h(ImageGrid, {
        items: items.value, selectedIds: selectedIds.value, onSelect: onImg,
        thumbUrl: thumbUrl, onLoadMore: loadMore, hasMore: hasMore.value, loading: loading.value,
        ratio: ratioMode.value
      }));

      return h("div", { class: "eg-root", ref: function(el) { rootElRef = el; } }, [
        setVis.value ? h(SettingsDialog, { visible: true, apiUrl: apiUrl.value,
          onClose: function() { setVis.value = false; }, onSave: saveSettings
        }) : h("div"),

        // ═══ 工具栏 ═══
        h("div", { class: "eg-bar" }, [
          h("input", { class: "eg-srch", type: "text", value: query.value, placeholder: "\u641C\u7D22\u2026",
            onInput: function(e) { query.value = e.target.value; },
            onKeyup: function(e) { if (e.key === "Enter") doSearch(); }
          }),
          h("button", { class: "eg-btn eg-btn-primary", onClick: doSearch, title: "\u641C\u7D22" }, "\u641C\u7D22"),
          h(ColorDropdown, { modelValue: color.value, onChange: onColor }),
          h("select", { class: "eg-sel", value: shape.value,
            onChange: function(e) { shape.value = e.target.value; doSearch(); }
          }, [
            h("option", { value: "\u5168\u90E8" }, "\u25A1 \u5168\u90E8\u5F62\u72B6"),
            h("option", { value: "\u6A2A\u5411" }, "\u25AC \u6A2A\u5411"),
            h("option", { value: "\u7EB5\u5411" }, "\u25AE \u7EB5\u5411"),
            h("option", { value: "\u65B9\u5F62" }, "\u25A0 \u65B9\u5F62")
          ]),
          h("select", { class: "eg-sel", value: star.value,
            onChange: function(e) { star.value = e.target.value; doSearch(); }
          }, [
            h("option", { value: "\u5168\u90E8" }, "\u2605 \u5168\u90E8\u8BC4\u5206"),
            h("option", { value: "5" }, "\u2605\u2605\u2605\u2605\u2605"),
            h("option", { value: "4" }, "\u2605\u2605\u2605\u2605"),
            h("option", { value: "3" }, "\u2605\u2605\u2605"),
            h("option", { value: "2" }, "\u2605\u2605"),
            h("option", { value: "1" }, "\u2605")
          ]),
          h("select", { class: "eg-sel", value: resolution.value,
            onChange: function(e) { resolution.value = e.target.value; doSearch(); }
          }, [
            h("option", { value: "\u5168\u90E8" }, "\u5168\u90E8\u5206\u8FA8\u7387"),
            h("option", { value: "<720p" }, "<720p"),
            h("option", { value: "720p-1080p" }, "720p-1080p"),
            h("option", { value: "1080p-2k" }, "1080p-2K"),
            h("option", { value: "2k-4k" }, "2K-4K"),
            h("option", { value: ">4k" }, ">4K")
          ]),
          h("select", { class: "eg-sel", value: format.value,
            onChange: function(e) { format.value = e.target.value; doSearch(); }
          }, [
            h("option", { value: "\u5168\u90E8" }, "\u5168\u90E8\u683C\u5F0F"),
            h("option", { value: "jpg" }, "JPEG"),
            h("option", { value: "png" }, "PNG"),
            h("option", { value: "webp" }, "WEBP"),
            h("option", { value: "gif" }, "GIF"),
            h("option", { value: "bmp" }, "BMP")
          ]),
          h("button", { class: "eg-btn" + (selectedTags.value.length > 0 ? " on" : ""), onClick: function() { tagPopupVisible.value = true; } },
            "\u{1F3F7} \u6807\u7B7E" + (selectedTags.value.length > 0 ? "(" + selectedTags.value.length + ")" : "")
          ),
          // 合并 #索引 / 跳转：输入编号直接选中对应图片；支持单个数字、逗号分隔、或 始-终 范围
          h("div", { class: "eg-idx" }, [
            h("label", { class: "eg-idl" }, "# \u9009\u62E9"),
            h("input", { class: "eg-idi", type: "text", placeholder: "# / #-#",
              onKeyup: function(e) {
                if (e.key !== "Enter") return;
                selectByIndex(e.target.value);
                e.target.value = "";
              }
            })
          ]),
          h("button", { class: "eg-btn eg-alpha" + (outMode.value === "rgba" ? " on" : ""), onClick: function() { outMode.value = (outMode.value === "rgba" ? "rgb" : "rgba"); syncSelection(); }, title: "Alpha \u901A\u9053" }, "\u03B1 Alpha"),
          h("div", { class: "eg-idx" }, [
            h("label", { class: "eg-idl" }, "\u8D77\u59CB:"),
            h("input", { class: "eg-idi", type: "number", min: "0", value: seqIdx.value,
              onInput: function(e) { seqIdx.value = parseInt(e.target.value) || 0; syncSelection(); }
            })
          ]),
          h("button", { class: "eg-btn eg-bt1", onClick: doSearch, title: "\u5237\u65B0" }, "\u21BB"),
          h("button", { class: "eg-btn eg-bt1", onClick: clearSel, title: "\u6E05\u9664\u9009\u4E2D" }, "\u2715"),
          h("button", { class: "eg-btn eg-bt1", onClick: function() { setVis.value = true; }, title: "\u8BBE\u7F6E" }, "\u2699")
        ]),

        // ═══ 状态栏：已选图像预览条 + 总数 + 整夹输出（移到工具栏下方，方便预览） ═══
        // 预览条优先从全局已选缓存取 item，使切换文件夹后仍能看到已选图像
        var selectedBarItems = selectedIds.value.map(function(sid) {
          return selectedItems.value[sid] || items.value.find(function(it) { return it.id === sid; });
        }).filter(function(it) { return it; });
        h("div", { class: "eg-foot" }, [
          h("button", { class: "eg-btn eg-folder-out", onClick: selectAllForOutput, title: "\u8F93\u51FA\u5F53\u524D\u6587\u4EF6\u5939/\u7B5B\u9009\u7ED3\u679C\u7684\u5168\u90E8\u56FE\u7247" }, "\u6574\u5939\u8F93\u51FA"),
          h(SelectionBar, {
            items: selectedBarItems, selectedIds: selectedIds.value,
            onRemove: removeSelected, onClear: clearSel
          }),
          h("div", { class: "eg-sta" }, "\u5171 " + total.value + " \u5F20 \u2502 \u9009\u4E2D " + selectedIds.value.length + " \u5F20")
        ]),

        // 标签筛选弹窗
        tagPopupVisible.value ? h(TagFilterDialog, {
          visible: true, tags: allTags.value, selectedTags: selectedTags.value,
          loading: tagsLoading.value,
          onClose: function() { tagPopupVisible.value = false; },
          onChange: function(sels) { selectedTags.value = sels; doSearch(); }
        }) : h("div"),

        // ═══ 主体 ═══
        h("div", { class: "eg-body" }, [
          h("div", { class: "eg-side" }, [
            h("div", { class: "eg-folder-hd" }, [
              h("input", { class: "eg-folder-srch", type: "text", value: folderQuery.value, placeholder: "\u641C\u7D22\u6587\u4EF6\u5939...",
                onInput: function(e) { folderQuery.value = e.target.value; }
              })
            ]),
            h(FolderTree, { folders: folders.value, selectedId: folderId.value, onSelect: onFolder, query: folderQuery.value })
          ]),
          h("div", { class: "eg-main" }, mainKids)
        ])
      ]);
    };
  }
};

// ============================================================
// CSS
// ============================================================
var CSS = [
  ".eg-root{display:flex;flex-direction:column;height:100%;background:#121216;color:#bbb;font:12px/1.5 system-ui}",
  ".eg-bar{display:flex;gap:6px;padding:6px 8px;background:#1a1a22;border-bottom:1px solid #2a2a32;align-items:center;flex-wrap:wrap}",
  ".eg-srch{flex:1;min-width:100px;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px}",
  ".eg-srch:focus{outline:none;border-color:#4a7de0}",
  ".eg-sel{padding:5px 6px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;cursor:pointer}",
  ".eg-mode{display:flex;border:1px solid #333;border-radius:4px;overflow:hidden;height:26px}",
  ".eg-mo{padding:4px 9px;border:none;background:#0e0e12;color:#777;font-size:10px;cursor:pointer;line-height:16px}",
  ".eg-mo.on{background:#4a7de0;color:#fff;font-weight:600}",
  ".eg-idx{display:flex;align-items:center;gap:3px}",
  ".eg-idl{font-size:10px;color:#777}",
  ".eg-idi{width:36px;padding:3px;border:1px solid #333;border-radius:3px;background:#0e0e12;color:#c8c8cc;font-size:10px;text-align:center}",
  ".eg-btn{padding:5px 12px;border:1px solid #333;border-radius:6px;background:#1c1c26;color:#c8c8cc;font-size:11px;cursor:pointer;transition:all .2s;box-shadow:0 1px 2px rgba(0,0,0,0.2)}",
  ".eg-btn:hover{background:#2a2a36;border-color:#4a7de0;color:#fff;transform:translateY(-1px)}",
  ".eg-bt1{padding:5px 8px;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center}",
  /* 颜色下拉优化 */
  ".cl-wrap{position:relative;display:inline-block;min-width:90px}",
  ".cl-trig{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 10px;border:1px solid #333;border-radius:6px;background:#0e0e12;cursor:pointer;user-select:none;transition:border-color .2s}",
  ".cl-trig:hover{border-color:#555;background:#16161e}",
  ".cl-trig.open{border-color:#4a7de0;background:#16161e}",
  ".cl-dot{width:14px;height:14px;border-radius:50%;display:inline-block;box-shadow:0 0 4px rgba(0,0,0,0.5)}",
  ".cl-arr{font-size:8px;color:#666;transition:transform .2s}",
  ".cl-trig.open .cl-arr{transform:rotate(180deg)}",
  ".cl-pop{position:absolute;top:100%;left:0;margin-top:8px;background:#1a1a24;border:1px solid #333;border-radius:10px;padding:12px;z-index:1000;box-shadow:0 8px 24px rgba(0,0,0,0.7);animation:clFadeIn .2s ease-out}",
  "@keyframes clFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}",
  ".cl-grd{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;width:150px}",
  ".cl-c{width:24px;height:24px;border-radius:6px;cursor:pointer;border:1px solid rgba(255,255,255,.05);display:inline-block;box-sizing:border-box;transition:all .15s;position:relative}",
  ".cl-c:hover{transform:scale(1.15);border-color:rgba(255,255,255,.3);z-index:2;box-shadow:0 4px 8px rgba(0,0,0,0.3)}",
  ".cl-c.on{border:2px solid #fff;box-shadow:0 0 10px rgba(255,255,255,0.6);transform:scale(1.05)}",
  ".cl-c.on::after{content:'\u2714';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;text-shadow:0 1px 2px rgba(0,0,0,0.8)}",
  ".cl-clr{margin-top:10px;padding:6px;font-size:11px;color:#888;cursor:pointer;text-align:center;border-radius:4px;background:rgba(255,255,255,0.03);transition:all .2s}",
  ".cl-clr:hover{color:#fff;background:rgba(255,255,255,0.08)}",
  /* 主体 */
  ".eg-body{display:flex;flex:1;overflow:hidden;background:#0e0e12}",
  ".eg-side{width:220px;min-width:180px;max-width:280px;border-right:1px solid #2a2a32;background:#16161e;overflow:auto;padding:8px 0;scrollbar-width:thin;flex-shrink:0}",
  ".ft-wrap{user-select:none}",
  ".ft-empty{padding:12px;color:#555;font-size:11px;text-align:center}",
  ".ft-r{display:flex;align-items:center;padding:6px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;border-radius:0 20px 20px 0;margin:1px 0;transition:all .15s;font-size:11px;color:#999;position:relative}",
  ".ft-r:hover{background:rgba(255,255,255,0.05);color:#ccc}",
  ".ft-r.sel{background:linear-gradient(90deg, #3a5a8a, #4a7de0);color:#fff;font-weight:600;box-shadow:0 2px 4px rgba(0,0,0,0.2)}",
  ".ft-arr,.ft-arr-place{width:18px;font-size:10px;color:#555;text-align:center;flex-shrink:0;transition:transform .25s}",
  ".ft-arr.open{transform:rotate(90deg);color:#999}",
  ".ft-ico{flex-shrink:0;margin:0 6px;font-size:12px}",
  ".ft-nm{overflow:hidden;text-overflow:ellipsis;flex:1}",
  ".eg-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:400px;background:#0f0f14;position:relative}",
  ".eg-err{padding:12px;color:#f66;font-size:12px;text-align:center;background:rgba(255,0,0,0.05)}",
  /* 图片网格 - 响应式列数，最小160px，使用 auto-fill 确保列数随宽度变化 */
  ".g-wrap{display:grid;grid-template-columns:repeat(auto-fill, minmax(160px, 1fr));gap:12px;padding:16px;overflow-y:auto;flex:1;align-content:start;width:100%;box-sizing:border-box;min-height:0}",
  ".g-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#555;font-size:14px;gap:10px}",
  ".g-card{position:relative;border-radius:10px;overflow:hidden;cursor:pointer;border:2px solid transparent;background:#1a1a24;transition:all .2s;display:flex;flex-direction:column;width:100%;min-height:80px;box-shadow:0 4px 12px rgba(0,0,0,0.3)}",
  ".g-card.jump-hit{box-shadow:0 0 15px 3px #4a7de0;border-color:#4a7de0;transform:scale(1.02)}",
  ".g-idx-tag{position:absolute;top:6px;left:6px;padding:2px 5px;background:rgba(74,125,224,0.85);color:#fff;font-size:10px;border-radius:4px;font-weight:bold;z-index:5}",
  ".g-star{position:absolute;bottom:6px;left:6px;color:#fc0;font-size:10px;text-shadow:0 1px 2px rgba(0,0,0,0.8);z-index:5}",
  ".g-card:hover{border-color:#4a7de0;transform:translateY(-4px);box-shadow:0 8px 20px rgba(0,0,0,0.5);z-index:10}",
  ".g-card.sel{border-color:#4a7de0;background:#1e2a40;box-shadow:inset 0 0 0 2px #4a7de0}",
  ".g-img-box{position:relative;width:100%;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000}",
  ".g-img{width:100%;height:100%;object-fit:cover;display:block;background:#222;transition:opacity .3s ease}",
  ".g-badge{position:absolute;top:6px;left:6px;background:linear-gradient(135deg, #4a7de0, #2a4a8a);color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;line-height:1;box-shadow:0 2px 4px rgba(0,0,0,0.3);z-index:2}",
  ".g-size{position:absolute;top:6px;right:6px;padding:2px 6px;background:rgba(0,0,0,0.8);color:#fff;font-size:10px;border-radius:4px;z-index:5;pointer-events:none;backdrop-filter:blur(2px);font-family:monospace}",
  ".g-check{position:absolute;inset:0;background:rgba(74,125,224,0.3);display:flex;align-items:center;justify-content:center;z-index:6;pointer-events:none;animation:checkPop .2s cubic-bezier(0.175, 0.885, 0.32, 1.275)}",
  "@keyframes checkPop{from{transform:scale(0.8);opacity:0}to{transform:scale(1);opacity:1}}",
  ".g-check::after{content:'\u2714';width:32px;height:32px;background:#4a7de0;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:bold;box-shadow:0 4px 10px rgba(0,0,0,0.4);border:2px solid #fff}",
  ".g-load-more{padding:30px;color:#777;font-size:13px;text-align:center;grid-column:1/-1;background:linear-gradient(transparent, rgba(26,26,36,0.8));border-radius:0 0 10px 10px}",
  /* 已选图像预览条 */
  ".eg-foot{display:flex;align-items:center;padding:4px 8px;border-bottom:1px solid #2a2a32;background:#1a1a22;min-height:56px;box-shadow:0 4px 10px rgba(0,0,0,.2);z-index:100}",
  ".sb-wrap{display:flex;align-items:center;flex:1;overflow:hidden;gap:12px;padding:0 4px}",
  ".sb-list{display:flex;gap:6px;overflow-x:auto;flex:1;padding:6px 0;scrollbar-width:thin;mask-image: linear-gradient(to right, black 95%, transparent);}",
  ".sb-list::-webkit-scrollbar {height:4px;}",
  ".sb-list::-webkit-scrollbar-thumb {background:#333;border-radius:2px;}",
  ".sb-item{position:relative;flex-shrink:0;width:48px;height:48px;border-radius:6px;overflow:hidden;border:1px solid #333;background:#000;transition:transform .1s, border-color .2s;box-shadow:0 2px 5px rgba(0,0,0,0.5)}",
  ".sb-item:hover{transform:scale(1.1);border-color:#4a7de0;z-index:5}",
  ".sb-thumb{width:100%;height:100%;object-fit:cover}",
  ".sb-remove{position:absolute;top:-2px;right:-2px;width:18px;height:18px;background:rgba(229,85,85,0.95);color:#fff;border:none;border-radius:50%;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;z-index:10;border:1.5px solid #1a1a22;opacity:0;transition:opacity 0.2s}",
  ".sb-item:hover .sb-remove{opacity:1}",
  ".sb-info{display:flex;align-items:center;gap:10px;font-size:11px;color:#999;white-space:nowrap;flex-shrink:0;border-left:1px solid #333;padding-left:12px}",
  ".sb-clear{padding:3px 7px;font-size:10px}",
  ".eg-sta{font-size:10px;color:#777;white-space:nowrap;padding:0 8px}",
  /* 搜索按钮、Alpha 开关、标签按钮 */
  ".eg-btn-primary{background:#2a4a8a;border-color:#4a7de0;color:#fff}",
  ".eg-btn-primary:hover{background:#3a5a9a;border-color:#5a8df0;color:#fff}",
  ".eg-alpha{min-width:48px;background:#1c1c26}",
  ".eg-alpha.on{background:#4a7de0;border-color:#4a7de0;color:#fff}",
  ".eg-btn.on{background:#2a3a5a;border-color:#4a7de0;color:#fff}",
  /* 文件夹搜索 */
  ".eg-folder-hd{padding:8px 10px;border-bottom:1px solid #2a2a32}",
  ".eg-folder-srch{width:100%;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;box-sizing:border-box}",
  ".eg-folder-srch:focus{outline:none;border-color:#4a7de0}",
  /* 整夹输出 */
  ".eg-folder-out{flex-shrink:0;margin-right:8px;background:#2a3a2a;border-color:#4a8a5a}",
  ".eg-folder-out:hover{background:#3a4a3a;border-color:#5a9a6a}",
  /* 标签弹窗 */
  ".tg-box{width:520px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column}",
  ".tg-hd{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid #333}",
  ".tg-hd .sd-inp{flex:1}",
  ".tg-clr{padding:5px 10px;font-size:11px}",
  ".tg-sel{display:flex;flex-wrap:wrap;gap:6px;min-height:34px;padding:10px 16px;border-bottom:1px solid #2a2a32;background:rgba(255,255,255,0.02)}",
  ".tg-sel-empty{font-size:11px;color:#666;align-self:center}",
  ".tg-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:12px;background:#2a3a5a;color:#c8d8ff;font-size:11px;cursor:pointer;border:1px solid #3a4a7a}",
  ".tg-chip:hover{background:#3a4a6a}",
  ".tg-bd{flex:1;overflow:auto;padding:12px 16px;scrollbar-width:thin}",
  ".tg-loading{padding:40px;color:#777;text-align:center}",
  ".tg-grp{margin-bottom:16px}",
  ".tg-grp-h{font-size:12px;font-weight:700;color:#4a7de0;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #2a3a4a}",
  ".tg-list{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}",
  ".tg-it{display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:4px;background:#0e0e12;border:1px solid #2a2a32;cursor:pointer;font-size:11px;color:#bbb}",
  ".tg-it:hover{background:#1a1a24;border-color:#555}",
  ".tg-it.on{background:#2a3a5a;border-color:#4a7de0;color:#fff}",
  ".tg-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px}",
  ".tg-cnt{color:#777;font-size:10px;margin-left:4px}",
  ".tg-it.on .tg-cnt{color:#aac8ff}",
  /* 设置弹窗 */
  ".sd-over{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:9999}",
  ".sd-box{background:#1c1c26;border:1px solid #444;border-radius:7px;width:340px;max-width:90vw;box-shadow:0 6px 24px rgba(0,0,0,.6)}",
  ".sd-hd{display:flex;justify-content:space-between;align-items:center;padding:11px 16px;border-bottom:1px solid #333;font-size:14px;font-weight:600;color:#ddd}",
  ".sd-x{background:none;border:none;color:#777;font-size:18px;cursor:pointer}.sd-x:hover{color:#fff}",
  ".sd-bd{padding:16px}",
  ".sd-lbl{display:block;margin-bottom:4px;margin-top:10px;font-size:11px;color:#999}.sd-lbl:first-child{margin-top:0}",
  ".sd-inp{width:100%;padding:6px 9px;border:1px solid #444;border-radius:4px;background:#0e0e12;color:#ccc;font-size:12px;box-sizing:border-box}",
  ".sd-inp:focus{outline:none;border-color:#4a7de0}",
  ".sd-ft{display:flex;justify-content:flex-end;gap:6px;padding:10px 16px;border-top:1px solid #333}"
].join("\n");

// ============================================================
app.registerExtension({
  // 修复：统一只保留这一个注册名/一份前端文件。之前 eagle_gallery.js（旧版）
  // 和 eagle_gallery_vue.js 两份脚本会同时给 EagleGalleryNode 挂
  // onNodeCreated，各自创建一个 DOM widget、一个 Vue 实例，画面上叠出两个
  // 画廊、高度互相打架——这也是节点会"无限往下长"的原因之一。
  // web/js 目录下现在应当只放这一份文件。
  name: "EagleSuite.EagleGallery",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleGalleryNode") return;

    // 隐藏原生 widgets：trigger（隐藏触发用）/ selection_data（由本组件写入，
    // 无需展示）。用 setTimeout 重试而不是依赖 onDrawBackground 硬压 y/height，
    // 后者只是不画出来，widget 占的布局空间还在，容易和 DOM widget 高度计算打架。
    var hideWidgets = function(node) {
      if (!node.widgets || !node.widgets.length) return false;
      var names = ["trigger", "selection_data"];
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var w = node.widgets[i];
        if (names.indexOf(w.name) === -1) continue;
        w.type = "hidden";
        w.computeSize = function () { return [0, -4]; };
        w.hidden = true;
        w.draw = function () {};
        found = true;
      }
      if (found) node.setDirtyCanvas(true, true);
      return found;
    };

    var orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      if (orig) orig.apply(this, arguments);
      if (this._egInit) return; // 防止同一节点被重复初始化
      this._egInit = true;

      this.setSize([960, 760]);
      setTimeout(function (node) {
        return function () { if (!hideWidgets(node)) setTimeout(function () { hideWidgets(node); }, 500); };
      }(this), 300);

      if (!document.getElementById("eg-style")) {
        var s = document.createElement("style"); s.id = "eg-style"; s.textContent = CSS; document.head.appendChild(s);
      }

      var el = document.createElement("div");
      el.style.cssText = "width:100%;height:100%;overflow:hidden;";

      var widget = this.addDOMWidget("eagle_gallery", "div", el, { serialize: false });

      // 高度应用：ComfyUI 的 DOM widget 父容器未必有确定高度，这里给 el 一个
      // 明确的像素高度，避免内容多高容器就撑多高，导致节点无限往下增长。
      // 宽度不设置 computeSize / 不监听 domElem，避免选择图像后触发重绘时
      // 把宽度锁死在很小的初始值上。
      var applyHeight = function (nodeHeight) {
        var h = Math.max(400, nodeHeight - 100);
        el.style.height = h + "px";
        return h;
      };
      applyHeight(this.size[1]); // 创建时立刻定死高度

      var nodeRef = this;
      try {
        // 修复：把节点实例作为 prop 传进去，组件内部直接用 props.node.id，
        // 不再需要靠 document.querySelector(".eg-root") 或遍历 graph 去猜
        // "我是哪个节点"——画布上放多个 Eagle Gallery 节点时不会再串数据。
        var appInstance = createApp(EagleGallery, { node: nodeRef });
        appInstance.mount(el);
        this._vueApp = appInstance;
      } catch (e) {
        console.error("[EagleGallery] mount failed:", e);
        el.innerHTML = '<div style="padding:30px;color:#e55">Error: ' + e.message + '</div>';
      }

      var onResize = this.onResize;
      this.onResize = function (size) {
        if (onResize) onResize.apply(this, arguments);
        applyHeight(size[1]);
      };
    };

    // 修复：之前完全没有 onRemoved，节点删除后 Vue 实例不会被清理，
    // 长时间在画布上增删节点会有内存泄漏。
    var onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  }
});
