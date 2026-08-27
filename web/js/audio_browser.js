/**
 * Eagle Suite - Audio Browser（统一媒体浏览器风格）
 * 支持目录树、网格/列表浏览、搜索、排序、多选、重命名、播放预览
 */
import { app } from "../../../scripts/app.js";

// ── CSS ────────────────────────────────────────────────────
var CSS = `
.umb-root{display:flex;flex-direction:column;width:100%;min-width:0;height:100%;box-sizing:border-box;background:#121216;color:#bbb;font:13px/1.5 system-ui;overflow:hidden;border-radius:0 0 8px 8px}
.umb-bar{display:flex;gap:6px;padding:6px 8px;background:#1a1a22;border-bottom:1px solid #2a2a32;align-items:center;flex-wrap:wrap}
.umb-search{flex:1;min-width:100px;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:12px}
.umb-search:focus{outline:none;border-color:#4a7de0}
.umb-path{flex:1 1 420px;min-width:220px;padding:5px 8px;border:1px solid #3b4355;border-radius:5px;background:#0e0e12;color:#d8d8dc;font-size:11px}
.umb-path:focus{outline:none;border-color:#4a7de0}
.umb-num{width:62px;padding:5px 6px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px}
.umb-sel{padding:5px 6px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;cursor:pointer}
.umb-btn{padding:5px 12px;border:1px solid #333;border-radius:6px;background:#1c1c26;color:#c8c8cc;font-size:11px;cursor:pointer;transition:all .2s;border:none}
.umb-btn:hover{background:#2a2a36;border-color:#4a7de0;color:#fff}
.umb-btn.primary{background:#2a4a8a;border-color:#4a7de0;color:#fff}
.umb-btn.primary:hover{background:#3a5a9a;border-color:#5a8df0}
.umb-btn.active{background:#2a5a3a;border-color:#4a9a62;color:#fff}
.umb-badge{color:#888;font-size:11px;white-space:nowrap}
.umb-mode-toggle{display:inline-flex;border:1px solid #333;border-radius:4px;overflow:hidden;font-size:11px}
.umb-mode-toggle span{padding:3px 10px;cursor:pointer;background:#1c1c26;color:#aaa;transition:.15s;font-size:10px}
.umb-mode-toggle span.active{background:#4a7de0;color:#fff}
.umb-mode-toggle span:hover:not(.active){background:#2a2a36}
.umb-body{flex:1;display:flex;overflow:hidden}
.umb-side{width:180px;background:#16161e;border-right:1px solid #2a2a32;overflow-y:auto;flex-shrink:0;padding:8px 0}
.umb-side::-webkit-scrollbar{width:4px}
.umb-side::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.umb-folder-hd{padding:8px 10px;border-bottom:1px solid #2a2a32}
.umb-folder-srch{width:100%;padding:5px 8px;border:1px solid #333;border-radius:4px;background:#0e0e12;color:#c8c8cc;font-size:11px;box-sizing:border-box}
.umb-folder-srch:focus{outline:none;border-color:#4a7de0}
.umb-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:200px;background:#0f0f14}
.umb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));grid-auto-rows:120px;gap:8px;padding:10px;overflow-y:auto;flex:1;align-content:start}
.umb-grid::-webkit-scrollbar{width:8px}
.umb-grid::-webkit-scrollbar-track{background:transparent}
.umb-grid::-webkit-scrollbar-thumb{background:#3a3a45;border-radius:4px}
.umb-grid::-webkit-scrollbar-thumb:hover{background:#4a4a55}
.umb-grid.list-mode{display:block;padding:6px;overflow-y:auto}
.umb-list-row{display:flex;align-items:center;gap:8px;padding:7px 9px;margin-bottom:3px;border:1px solid transparent;border-radius:5px;background:#17171e;color:#bbb;cursor:pointer}
.umb-list-row:hover{background:#20202a;border-color:#343442;color:#eee}
.umb-list-row.sel{background:#23365b;border-color:#4a7de0;color:#fff}
.umb-list-check{width:18px;text-align:center;color:#7da8ff;flex-shrink:0}
.umb-list-kind{width:42px;color:#9a9aa8;font-size:10px;text-transform:uppercase;flex-shrink:0}
.umb-list-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.umb-list-size{width:72px;text-align:right;color:#777;font-size:10px;flex-shrink:0}
.umb-list-meta{width:72px;text-align:right;color:#aaa;font-size:10px;flex-shrink:0}
.umb-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:14px}
.umb-loading{grid-column:1/-1;padding:30px;color:#777;text-align:center}
.umb-card{position:relative;width:100%;height:120px;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid transparent;background:#1a1a24;transition:border-color .16s,box-shadow .16s;display:flex;flex-direction:column;box-shadow:0 3px 10px rgba(0,0,0,0.28)}
.umb-card:hover{border-color:#4a7de0;box-shadow:0 5px 14px rgba(0,0,0,0.42);z-index:10}
.umb-card.sel{border-color:#4a7de0;background:#1e2a40;box-shadow:inset 0 0 0 2px #4a7de0}
.umb-img-box{position:relative;width:100%;height:80px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;flex-shrink:0}
.umb-img{width:100%;height:100%;object-fit:cover;display:block;background:#111}
.umb-card-info{position:relative;flex:1;background:#16161e;padding:4px 6px;display:flex;flex-direction:column;justify-content:center}
.umb-name{font-size:11px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.umb-size-badge{position:absolute;top:4px;right:4px;z-index:4;padding:2px 5px;border-radius:4px;background:rgba(0,0,0,0.7);color:#ddd;font-size:9px;font-weight:600}
.umb-type-badge{position:absolute;top:4px;left:4px;z-index:4;padding:2px 5px;border-radius:4px;background:rgba(200,80,200,0.85);color:#fff;font-size:11px}
.umb-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:5;opacity:0;transition:opacity .2s;background:rgba(0,0,0,0.25)}
.umb-card:hover .umb-play{opacity:1}
.umb-play-btn{width:34px;height:34px;border-radius:50%;border:none;background:#4a7de0;color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.4)}
.umb-check{position:absolute;inset:0;background:rgba(74,125,224,0.25);display:flex;align-items:center;justify-content:center;z-index:6;pointer-events:none}
.umb-check::after{content:'✔';width:32px;height:32px;background:#4a7de0;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:bold;box-shadow:0 4px 10px rgba(0,0,0,0.4);border:2px solid #fff}
.umb-selected{width:200px;border-left:1px solid #2a2a32;background:#16161e;overflow:hidden;display:flex;flex-direction:column;flex-shrink:0}
.umb-sel-hd{padding:8px 10px;font-weight:600;border-bottom:1px solid #2a2a32;background:#1a1a22;color:#ddd}
.umb-sel-empty{padding:20px 10px;color:#666;text-align:center;font-size:11px}
.umb-sel-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}
.umb-sel-item{display:flex;align-items:center;gap:8px;padding:6px;background:#1a1a24;border-radius:6px;border:1px solid #2a2a32}
.umb-sel-thumb{width:40px;height:40px;border-radius:4px;object-fit:cover;background:#000;flex-shrink:0}
.umb-sel-info{flex:1;min-width:0}
.umb-sel-name{font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.umb-sel-type{font-size:9px;color:#888;margin-top:2px}
.umb-sel-remove{width:20px;height:20px;border-radius:50%;border:none;background:#e55;color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.umb-player{height:40px;width:100%;background:#1a1a22;border-top:1px solid #2a2a32}
.umb-root .ft-wrap{user-select:none}
.umb-root .ft-empty{padding:12px;color:#555;font-size:11px;text-align:center}
.umb-root .ft-r{display:flex;align-items:center;padding:6px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;border-radius:0 20px 20px 0;margin:1px 0;transition:all .15s;font-size:11px;color:#999}
.umb-root .ft-r:hover{background:rgba(255,255,255,0.05);color:#ccc}
.umb-root .ft-r.sel{background:linear-gradient(90deg,#3a5a8a,#4a7de0);color:#fff;font-weight:600}
.umb-root .ft-arr,.umb-root .ft-arr-place{width:18px;font-size:10px;color:#555;text-align:center;flex-shrink:0;transition:transform .25s}
.umb-root .ft-arr.open{transform:rotate(90deg);color:#999}
.umb-root .ft-nm{overflow:hidden;text-overflow:ellipsis;flex:1}
`;

// ── 工具函数 ────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "--:--";
  var m = Math.floor(seconds / 60);
  var s = Math.floor(seconds % 60);
  var h = Math.floor(m / 60);
  if (h) return h + ":" + String(m % 60).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  return m + ":" + String(s).padStart(2, "0");
}

function debounce(fn, delay) {
  var timer = null;
  return function() {
    var args = arguments;
    var self = this;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(self, args); }, delay);
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── 主应用类 ────────────────────────────────────────────
class AudioBrowser {
  constructor(container, node) {
    this.container = container;
    this.node = node;
    this.apiPrefix = "/EagleAudioList";

    this.state = {
      directory: "",
      currentDirectory: "",
      recursive: true,
      viewMode: "grid",
      keyword: "",
      sortBy: "name",
      sortDir: "asc",
      items: [],
      total: 0,
      offset: 0,
      limit: 50,
      hasMore: true,
      loading: false,
      folders: [],
      selectedFolder: "",
      selectedItems: new Map(),
      playingPath: "",
    };

    setTimeout(function(self) {
      return function() {
        self.restoreStateFromNode();
        self.init();
      };
    }(this), 0);
  }

  getWidget(name) {
    return (this.node.widgets || []).find(function(w) { return w.name === name; });
  }

  restoreStateFromNode() {
    if (!this.node.widgets || !this.node.widgets.length) {
      setTimeout(function(self) { return function() { self.restoreStateFromNode(); }; }(this), 50);
      return;
    }

    var directory = String(this.getWidget("directory")?.value || "").trim();
    var recursiveValue = this.getWidget("recursive")?.value;
    var viewMode = String(this.getWidget("view_mode")?.value || "grid");

    this.state.directory = directory;
    this.state.currentDirectory = directory;
    this.state.recursive = recursiveValue === undefined ? true : Boolean(recursiveValue);
    this.state.viewMode = viewMode === "list" ? "list" : "grid";

    try {
      var saved = JSON.parse(this.getWidget("selection_data")?.value || "[]");
      if (Array.isArray(saved)) {
        saved.forEach(function(item) {
          if (item && item.id && item.path) this.state.selectedItems.set(item.id, item);
        }, this);
      }
    } catch (error) {
      console.warn("[AudioBrowser] 恢复选择数据失败:", error);
    }
  }

  syncBrowserSettings() {
    var values = {
      directory: this.state.directory,
      active_directory: this.state.currentDirectory || this.state.directory,
      recursive: this.state.recursive,
      view_mode: this.state.viewMode,
    };
    for (var name in values) {
      var widget = this.getWidget(name);
      if (widget) widget.value = values[name];
    }
  }

  init() {
    this.render();
    this.renderSelected();
    this.updateCounts();
    setTimeout(function(self) {
      return function() {
        self.attachEvents();
        if (self.state.directory) {
          self.authorizeAndLoadDirectory();
        }
      };
    }(this), 100);
  }

  render() {
    this.container.innerHTML = `
      <div class="umb-root">
        <div class="umb-bar">
          <input type="text" class="umb-path" data-input="directory" value="${escapeHtml(this.state.directory)}" placeholder="粘贴音频目录路径，回车加载...">
          <button class="umb-btn primary" data-action="load-dir">加载目录</button>
          <button class="umb-btn ${this.state.recursive ? 'active' : ''}" data-action="recursive">
            ${this.state.recursive ? '✅ 递归子文件夹' : '⬜ 递归子文件夹'}
          </button>
          <button class="umb-btn" data-action="view-mode">
            ${this.state.viewMode === 'grid' ? '📋 列表（省资源）' : '🖼️ 缩略图'}
          </button>
          <input type="text" class="umb-search" placeholder="搜索文件名..." data-input="search">
          <select class="umb-sel" data-input="sort">
            <option value="name:asc">名称 ↑</option>
            <option value="name:desc">名称 ↓</option>
            <option value="modified:desc">最新</option>
            <option value="modified:asc">最旧</option>
            <option value="size:desc">最大</option>
            <option value="size:asc">最小</option>
            <option value="duration:desc">最长</option>
            <option value="duration:asc">最短</option>
          </select>
          <span class="umb-badge" data-display="count">0 项</span>
        </div>
        <div class="umb-body">
          <div class="umb-side">
            <div class="umb-folder-hd">
              <input type="text" class="umb-folder-srch" placeholder="筛选文件夹..." data-input="folder-search">
            </div>
            <div class="ft-wrap" data-container="folders">
              <div class="ft-r sel" data-path="" data-action="show-all-files" style="padding-left:8px">
                <span class="ft-arr-place"></span>
                <span class="ft-nm">📁 全部文件</span>
              </div>
            </div>
          </div>
          <div class="umb-main">
            <div class="umb-grid" data-container="grid">
              <div class="umb-empty">请先选择目录</div>
            </div>
          </div>
          <div class="umb-selected">
            <div class="umb-sel-hd">已选 <span data-display="selected-count">0</span></div>
            <div class="umb-sel-list" data-container="selected"></div>
          </div>
        </div>
      </div>
    `;
  }

  attachEvents() {
    var root = this.container.querySelector(".umb-root");
    if (!root) {
      setTimeout(function(self) { return function() { self.attachEvents(); }; }(this), 100);
      return;
    }

    var self = this;
    var directoryInput = root.querySelector('[data-input="directory"]');
    var applyDirectory = function() {
      var directory = String(directoryInput?.value || "").trim().replace(/^['"]|['"]$/g, "");
      if (!directory) return;
      self.state.directory = directory;
      self.state.currentDirectory = directory;
      self.state.selectedFolder = "";
      self.state.offset = 0;
      self.state.items = [];
      self.syncBrowserSettings();
      self.authorizeAndLoadDirectory();
    };
    root.querySelector('[data-action="load-dir"]')?.addEventListener("click", applyDirectory);
    directoryInput?.addEventListener("keydown", function(event) {
      if (event.key === "Enter") applyDirectory();
    });

    var recursiveBtn = root.querySelector('[data-action="recursive"]');
    if (recursiveBtn) {
      recursiveBtn.addEventListener("click", function() {
        self.state.recursive = !self.state.recursive;
        recursiveBtn.classList.toggle("active", self.state.recursive);
        recursiveBtn.textContent = self.state.recursive ? "✅ 递归子文件夹" : "⬜ 递归子文件夹";
        self.state.offset = 0;
        self.state.items = [];
        self.syncBrowserSettings();
        if (self.state.directory) self.loadItems();
      });
    }

    var viewModeBtn = root.querySelector('[data-action="view-mode"]');
    if (viewModeBtn) {
      viewModeBtn.addEventListener("click", function() {
        self.state.viewMode = self.state.viewMode === "grid" ? "list" : "grid";
        viewModeBtn.textContent = self.state.viewMode === "grid" ? "📋 列表（省资源）" : "🖼️ 缩略图";
        self.syncBrowserSettings();
        self.renderItems();
      });
    }

    var searchInput = root.querySelector('[data-input="search"]');
    if (searchInput) {
      searchInput.addEventListener("input", debounce(function(e) {
        self.state.keyword = e.target.value.trim();
        self.state.offset = 0;
        self.state.items = [];
        self.loadItems();
      }, 300));
    }

    var folderSearch = root.querySelector('[data-input="folder-search"]');
    if (folderSearch) {
      folderSearch.addEventListener("input", debounce(function(event) {
        var keyword = event.target.value.trim().toLowerCase();
        root.querySelectorAll('.ft-r:not([data-action="show-all-files"])').forEach(function(row) {
          row.style.display = !keyword || row.textContent.toLowerCase().includes(keyword) ? "flex" : "none";
        });
      }, 120));
    }

    var sortSelect = root.querySelector('[data-input="sort"]');
    if (sortSelect) {
      sortSelect.addEventListener("change", function(e) {
        var parts = e.target.value.split(":");
        self.state.sortBy = parts[0];
        self.state.sortDir = parts[1];
        self.state.offset = 0;
        self.state.items = [];
        self.loadItems();
      });
    }

    var grid = root.querySelector('[data-container="grid"]');
    if (grid) {
      grid.addEventListener("scroll", debounce(function() {
        if (self.state.loading || !self.state.hasMore) return;
        if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 200) {
          self.loadItems(true);
        }
      }, 200));
    }
  }

  async authorizeAndLoadDirectory() {
    if (!this.state.directory) return false;
    var grid = this.container.querySelector('[data-container="grid"]');
    if (grid) grid.innerHTML = '<div class="umb-loading">正在验证音频目录...</div>';
    try {
      var response = await fetch(this.apiPrefix + "/authorize_root", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: this.state.directory }),
      });
      var data = await response.json();
      if (!response.ok || !data.success) {
        if (grid) grid.innerHTML = '<div class="umb-empty">错误: ' + escapeHtml(data.error || "目录授权失败") + '</div>';
        return false;
      }
      await Promise.all([this.loadFolders(), this.loadItems()]);
      return true;
    } catch (error) {
      console.error("[AudioBrowser] 目录授权失败:", error);
      if (grid) grid.innerHTML = '<div class="umb-empty">目录授权失败</div>';
      return false;
    }
  }

  loadFolders() {
    if (!this.state.directory) return;
    var self = this;
    fetch(this.apiPrefix + "/folders?directory=" + encodeURIComponent(this.state.directory))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          self.state.folders = data.folders;
          self.renderFolders();
        }
      })
      .catch(function(err) { console.error("[AudioBrowser] 加载文件夹失败:", err); });
  }

  renderFolders() {
    var container = this.container.querySelector('[data-container="folders"]');
    if (!container) return;

    var allFilesBtn = `
      <div class="ft-r ${this.state.selectedFolder ? '' : 'sel'}" data-path="" data-action="show-all-files" style="padding-left:8px">
        <span class="ft-arr-place"></span>
        <span class="ft-nm">📁 全部文件</span>
      </div>
    `;

    if (!this.state.folders.length) {
      container.innerHTML = allFilesBtn + '<div class="ft-empty">无子文件夹</div>';
    } else {
      container.innerHTML = allFilesBtn + this.buildFolderTree(this.state.folders);
    }

    var self = this;
    var allFilesRow = container.querySelector('[data-action="show-all-files"]');
    if (allFilesRow) {
      allFilesRow.addEventListener("click", function() {
        container.querySelectorAll('.ft-r').forEach(function(r) { r.classList.remove("sel"); });
        allFilesRow.classList.add("sel");
        self.state.selectedFolder = "";
        self.state.currentDirectory = self.state.directory;
        self.state.offset = 0;
        self.state.items = [];
        self.syncBrowserSettings();
        self.loadItems();
      });
    }

    container.querySelectorAll('.ft-r:not([data-action="show-all-files"])').forEach(function(row) {
      row.addEventListener("click", function(e) {
        e.stopPropagation();
        var path = row.dataset.path;
        container.querySelectorAll('.ft-r').forEach(function(r) { r.classList.remove("sel"); });
        row.classList.add("sel");

        var arrow = row.querySelector('.ft-arr');
        if (arrow) {
          arrow.classList.toggle("open");
          var children = row.nextElementSibling;
          if (children) children.style.display = arrow.classList.contains("open") ? "block" : "none";
        }

        self.state.selectedFolder = path;
        self.state.currentDirectory = path;
        self.state.offset = 0;
        self.state.items = [];
        self.syncBrowserSettings();
        self.loadItems();
      });
    });
  }

  buildFolderTree(folders, level) {
    level = level || 0;
    var self = this;
    return folders.map(function(f) {
      var hasChildren = f.children && f.children.length > 0;
      var arrow = hasChildren ? '<span class="ft-arr">▶</span>' : '<span class="ft-arr-place"></span>';
      var html = `
        <div class="ft-r" data-path="${escapeHtml(f.path)}" style="padding-left:${8 + level * 16}px">
          ${arrow}
          <span class="ft-nm" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span>
        </div>
      `;
      if (hasChildren) {
        html += '<div style="display:none">' + self.buildFolderTree(f.children, level + 1) + '</div>';
      }
      return html;
    }).join('');
  }

  loadItems(append) {
    var scanDirectory = this.state.currentDirectory || this.state.directory;
    if (!scanDirectory || this.state.loading) return;

    var self = this;
    this.state.loading = true;
    var grid = this.container.querySelector('[data-container="grid"]');
    if (!grid) {
      this.state.loading = false;
      return;
    }

    if (!append) {
      grid.innerHTML = '<div class="umb-loading">加载中...</div>';
    } else {
      var loading = document.createElement("div");
      loading.className = "umb-loading";
      loading.textContent = "加载更多...";
      grid.appendChild(loading);
    }

    fetch(this.apiPrefix + "/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directory: scanDirectory,
        recursive: this.state.recursive,
        keyword: this.state.keyword,
        sort_by: this.state.sortBy,
        sort_dir: this.state.sortDir,
        offset: this.state.offset,
        limit: this.state.limit,
      }),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          if (append) {
            data.items.forEach(function(item) { self.state.items.push(item); });
          } else {
            self.state.items = data.items;
          }
          self.state.total = data.total;
          self.state.offset = data.offset + data.items.length;
          self.state.hasMore = data.has_more;
          self.renderItems();
          self.updateCounts();
        } else {
          grid.innerHTML = '<div class="umb-empty">错误: ' + escapeHtml(data.error || "未知") + '</div>';
        }
      })
      .catch(function(err) {
        console.error("[AudioBrowser] 加载失败:", err);
        grid.innerHTML = '<div class="umb-empty">加载失败</div>';
      })
      .finally(function() {
        self.state.loading = false;
      });
  }

  renderItems() {
    var grid = this.container.querySelector('[data-container="grid"]');
    if (!grid) return;

    grid.classList.toggle("list-mode", this.state.viewMode === "list");

    if (!this.state.items.length) {
      grid.innerHTML = '<div class="umb-empty">无音频文件</div>';
      return;
    }

    var self = this;

    if (this.state.viewMode === "list") {
      grid.innerHTML = this.state.items.map(function(item) {
        var isSelected = self.state.selectedItems.has(item.id);
        return `
          <div class="umb-list-row ${isSelected ? 'sel' : ''}" data-item-id="${escapeHtml(item.id)}">
            <span class="umb-list-check">${isSelected ? '☑' : '☐'}</span>
            <span class="umb-list-kind">AUDIO</span>
            <span class="umb-list-name" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</span>
            <span class="umb-list-path" title="${escapeHtml(item.rel)}">${escapeHtml(item.rel)}</span>
            <span class="umb-list-meta">${formatDuration(item.duration)}</span>
            <span class="umb-list-size">${formatSize(item.size)}</span>
          </div>
        `;
      }).join('');
    } else {
      grid.innerHTML = this.state.items.map(function(item) {
        var isSelected = self.state.selectedItems.has(item.id);
        var thumbUrl = self.apiPrefix + "/thumbnail?path=" + encodeURIComponent(item.path) + "&size=256";
        return `
          <div class="umb-card ${isSelected ? 'sel' : ''}" data-item-id="${escapeHtml(item.id)}">
            <div class="umb-img-box">
              <img class="umb-img" src="${thumbUrl}" loading="lazy" alt="${escapeHtml(item.name)}">
              <span class="umb-type-badge">♪</span>
              <span class="umb-size-badge">${formatSize(item.size)}</span>
              <div class="umb-play" data-play="${escapeHtml(item.path)}">
                <button class="umb-play-btn" title="预览播放">▶</button>
              </div>
            </div>
            <div class="umb-card-info">
              <div class="umb-name" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</div>
              <div style="font-size:10px;color:#888">${formatDuration(item.duration)}</div>
            </div>
            ${isSelected ? '<div class="umb-check"></div>' : ''}
          </div>
        `;
      }).join('');
    }

    grid.querySelectorAll('[data-item-id]').forEach(function(element) {
      element.addEventListener("click", function(e) {
        // 播放按钮点击不触发选择
        if (e.target.closest('[data-play]')) return;
        var id = decodeURIComponent(element.dataset.itemId);
        var item = self.state.items.find(function(i) { return i.id === id; });
        if (!item) return;

        if (self.state.selectedItems.has(id)) {
          self.state.selectedItems.delete(id);
        } else {
          self.state.selectedItems.set(id, item);
        }

        element.classList.toggle("sel");
        if (element.classList.contains("umb-list-row")) {
          var check = element.querySelector(".umb-list-check");
          if (check) check.textContent = self.state.selectedItems.has(id) ? "☑" : "☐";
        } else {
          var check = element.querySelector(".umb-check");
          if (check) check.remove();
          else element.insertAdjacentHTML("beforeend", '<div class="umb-check"></div>');
        }

        self.renderSelected();
        self.updateNodeData();
      });
    });

    // 播放按钮
    grid.querySelectorAll('[data-play]').forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        self.state.playingPath = btn.dataset.play;
        self.renderPlayer();
      });
    });
  }

  renderSelected() {
    var container = this.container.querySelector('[data-container="selected"]');
    if (!container) return;

    var items = Array.from(this.state.selectedItems.values());
    var self = this;

    if (!items.length) {
      container.innerHTML = '<div class="umb-sel-empty">未选择文件</div>';
      this.updateCounts();
      return;
    }

    container.innerHTML = items.map(function(item) {
      var thumbUrl = self.apiPrefix + "/thumbnail?path=" + encodeURIComponent(item.path) + "&size=96";
      return `
        <div class="umb-sel-item" data-id="${escapeHtml(item.id)}">
          <img class="umb-sel-thumb" src="${thumbUrl}" loading="lazy" alt="${escapeHtml(item.name)}">
          <div class="umb-sel-info">
            <div class="umb-sel-name" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</div>
            <div class="umb-sel-type">${formatDuration(item.duration)} • ${formatSize(item.size)}</div>
          </div>
          <button class="umb-sel-remove" data-remove="${escapeHtml(item.id)}">×</button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-remove]').forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        var id = decodeURIComponent(btn.dataset.remove);
        self.state.selectedItems.delete(id);
        self.renderSelected();
        self.renderItems();
        self.updateNodeData();
      });
    });

    this.updateCounts();
  }

  renderPlayer() {
    var root = this.container.querySelector(".umb-root");
    if (!root) return;
    var existing = root.querySelector(".umb-player");
    if (existing) existing.remove();
    if (!this.state.playingPath) return;

    var audio = document.createElement("audio");
    audio.className = "umb-player";
    audio.src = this.apiPrefix + "/stream?path=" + encodeURIComponent(this.state.playingPath);
    audio.controls = true;
    audio.autoplay = true;
    root.appendChild(audio);
  }

  updateCounts() {
    var countEl = this.container.querySelector('[data-display="count"]');
    var selCountEl = this.container.querySelector('[data-display="selected-count"]');
    if (countEl) countEl.textContent = this.state.total + " 项";
    if (selCountEl) selCountEl.textContent = this.state.selectedItems.size;
  }

  updateNodeData() {
    var selections = Array.from(this.state.selectedItems.values()).map(function(item) {
      return {
        id: item.id,
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        duration: item.duration,
      };
    });

    var widget = this.getWidget("selection_data");
    if (widget) widget.value = JSON.stringify(selections);

    var audioWidget = this.getWidget("audio_path");
    if (audioWidget) {
      audioWidget.value = selections.length ? selections[0].path : "";
    }

    this.syncBrowserSettings();
    if (this.node.setDirtyCanvas) this.node.setDirtyCanvas(true, true);
  }
}

// ── ComfyUI 注册 ────────────────────────────────────────
app.registerExtension({
  name: "EagleSuite.AudioBrowser",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleAudioList") return;

    var HIDDEN_WIDGETS = [
      "directory", "active_directory", "recursive", "view_mode", "selection_data", "audio_path"
    ];

    var hideWidgets = function(node) {
      if (!node.widgets) return false;
      var found = false;
      node.widgets.forEach(function(w) {
        if (HIDDEN_WIDGETS.includes(w.name)) {
          w.type = "hidden";
          w.computeSize = function() { return [0, -4]; };
          w.draw = function() {};
          found = true;
        }
      });
      if (found) node.setDirtyCanvas(true, true);
      return found;
    };

    var orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      if (orig) orig.apply(this, arguments);
      if (this._abInit) return;
      this._abInit = true;

      this.setSize([960, 640]);
      setTimeout(function(node) {
        return function() {
          if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500);
        };
      }(this), 300);

      if (!document.getElementById("eagle-audio-browser-style")) {
        var style = document.createElement("style");
        style.id = "eagle-audio-browser-style";
        style.textContent = CSS;
        document.head.appendChild(style);
      }

      var el = document.createElement("div");
      el.style.cssText = "width:940px;max-width:none;min-width:0;height:100%;box-sizing:border-box;overflow:hidden;border-radius:0 0 8px 8px;background:#121216;";
      this.addDOMWidget("audio_browser", "div", el, { serialize: false });

      var nodeRef = this;
      var applyFrame = function(size) {
        var nodeWidth = Number(size && size[0]) || 960;
        var nodeHeight = Number(size && size[1]) || 640;
        var w = Math.max(320, nodeWidth - 20);
        var h = Math.max(300, nodeHeight - 80);
        el.style.width = w + "px";
        el.style.height = h + "px";
        return [w, h];
      };
      this._abApplyFrame = applyFrame;
      applyFrame(this.size);

      try {
        this._abApp = new AudioBrowser(el, this);
      } catch (e) {
        console.error("[AudioBrowser] 初始化失败:", e);
        el.replaceChildren();
        var errorBox = document.createElement("div");
        errorBox.style.cssText = "padding:30px;color:#e55";
        errorBox.textContent = "错误: " + (e && e.message ? e.message : "初始化失败");
        el.appendChild(errorBox);
      }

      var onResize = this.onResize;
      this.onResize = function(size) {
        if (onResize) onResize.apply(this, arguments);
        applyFrame(size);
        if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
      };

      setTimeout(function() { applyFrame(nodeRef.size); }, 0);
      setTimeout(function() { applyFrame(nodeRef.size); }, 250);
    };

    var onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      var result = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      var nodeRef = this;
      setTimeout(function() {
        if (nodeRef._abApplyFrame) nodeRef._abApplyFrame(nodeRef.size);
      }, 0);
      return result;
    };

    var onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function() {
      if (this._abApp) { this._abApp = null; }
      this._abApplyFrame = null;
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  }
});
