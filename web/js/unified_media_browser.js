/**
 * Eagle Suite - 统一媒体浏览器 (原生 JS 版本)
 * 支持图片/视频混合加载，滑动双栏文件树，懒加载
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
.umb-list-path{max-width:36%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#666;font-size:10px}
.umb-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:14px}
.umb-loading{grid-column:1/-1;padding:30px;color:#777;text-align:center}
.umb-card{position:relative;width:100%;height:120px;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid transparent;background:#1a1a24;transition:border-color .16s,box-shadow .16s;display:flex;flex-direction:column;box-shadow:0 3px 10px rgba(0,0,0,0.28)}
.umb-card:hover{border-color:#4a7de0;box-shadow:0 5px 14px rgba(0,0,0,0.42);z-index:10}
.umb-card.sel{border-color:#4a7de0;background:#1e2a40;box-shadow:inset 0 0 0 2px #4a7de0}
.umb-img-box{position:relative;width:100%;height:80px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;flex-shrink:0}
.umb-img{width:100%;height:100%;object-fit:cover;display:block;background:#111}
.umb-card-info{position:relative;flex:1;background:#16161e;padding:4px 6px}
.umb-name{font-size:11px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.umb-size-badge{position:absolute;top:4px;right:4px;z-index:4;padding:2px 5px;border-radius:4px;background:rgba(0,0,0,0.7);color:#ddd;font-size:9px;font-weight:600}
.umb-type-badge{position:absolute;top:4px;left:4px;z-index:4;padding:2px 5px;border-radius:4px;background:rgba(200,80,200,0.85);color:#fff;font-size:11px}
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

function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ── 主应用类 ────────────────────────────────────────────
class UnifiedMediaBrowser {
  constructor(container, node) {
    this.container = container;
    this.node = node;

    // 状态
    this.state = {
      directory: "",
      currentDirectory: "",
      mediaType: "all",
      recursive: true,
      viewMode: "grid",
      fallbackMode: "sequential",
      batchCount: 1,
      startIndex: 0,
      randomSeed: -1,
      aspectRatio: "all",
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
    };

    this.restoreStateFromNode();
    this.init();
  }

  getWidget(name) {
    return this.node.widgets?.find(widget => widget.name === name);
  }

  restoreStateFromNode() {
    const directory = String(this.getWidget("directory")?.value || "").trim();
    const mediaType = String(this.getWidget("media_type")?.value || "all");
    const recursiveValue = this.getWidget("recursive")?.value;
    const viewMode = String(this.getWidget("view_mode")?.value || "grid");
    const fallbackMode = String(this.getWidget("fallback_mode")?.value || "sequential");
    this.state.directory = directory;
    this.state.currentDirectory = directory;
    this.state.mediaType = ["all", "image", "video"].includes(mediaType) ? mediaType : "all";
    this.state.recursive = recursiveValue === undefined ? true : Boolean(recursiveValue);
    this.state.viewMode = viewMode === "list" ? "list" : "grid";
    this.state.fallbackMode = fallbackMode === "random" ? "random" : "sequential";
    this.state.batchCount = Math.max(1, Number(this.getWidget("batch_count")?.value || 1));
    this.state.startIndex = Math.max(0, Number(this.getWidget("start_index")?.value || 0));
    this.state.randomSeed = Number(this.getWidget("random_seed")?.value ?? -1);
    this.state.aspectRatio = String(this.getWidget("aspect_ratio")?.value || "all");

    try {
      const saved = JSON.parse(this.getWidget("selection_data")?.value || "[]");
      if (Array.isArray(saved)) {
        saved.forEach(item => {
          if (item?.id && item?.path) this.state.selectedItems.set(item.id, item);
        });
      }
    } catch (_) {
      // 工作流中的旧值损坏时仅忽略，不影响浏览器挂载。
    }
  }

  syncBrowserSettings() {
    const values = {
      directory: this.state.directory,
      media_type: this.state.mediaType,
      recursive: this.state.recursive,
      view_mode: this.state.viewMode,
      active_directory: this.state.currentDirectory || this.state.directory,
      fallback_mode: this.state.fallbackMode,
      batch_count: this.state.batchCount,
      start_index: this.state.startIndex,
      random_seed: this.state.randomSeed,
      aspect_ratio: this.state.aspectRatio,
    };
    Object.entries(values).forEach(([name, value]) => {
      const widget = this.getWidget(name);
      if (widget) widget.value = value;
    });
  }

  init() {
    this.render();
    this.renderSelected();
    this.updateCounts();
    // 延迟绑定事件，等待 DOM 完全渲染
    setTimeout(() => this.attachEvents(), 50);
  }

  render() {
    this.container.innerHTML = `
      <div class="umb-root">
        <div class="umb-bar">
          <input type="text" class="umb-path" data-input="directory" value="${escapeHtml(this.state.directory)}" placeholder="粘贴媒体目录路径，回车加载...">
          <button class="umb-btn primary" data-action="load-dir">加载目录</button>
          <button class="umb-btn ${this.state.recursive ? 'active' : ''}" data-action="recursive">
            ${this.state.recursive ? '✅ 递归子文件夹' : '⬜ 递归子文件夹'}
          </button>
          <button class="umb-btn" data-action="view-mode">
            ${this.state.viewMode === 'grid' ? '📋 列表（省资源）' : '🖼️ 缩略图'}
          </button>
          <div class="umb-mode-toggle">
            <span data-mode="all" class="${this.state.mediaType === 'all' ? 'active' : ''}">全部</span>
            <span data-mode="image" class="${this.state.mediaType === 'image' ? 'active' : ''}">图片</span>
            <span data-mode="video" class="${this.state.mediaType === 'video' ? 'active' : ''}">视频</span>
          </div>
          <input type="text" class="umb-search" placeholder="搜索文件名..." data-input="search">
          <select class="umb-sel" data-input="sort">
            <option value="name:asc">名称 ↑</option>
            <option value="name:desc">名称 ↓</option>
            <option value="modified:desc">最新</option>
            <option value="modified:asc">最旧</option>
            <option value="size:desc">最大</option>
            <option value="size:asc">最小</option>
          </select>
          <select class="umb-sel" data-input="fallback" title="未手动选择文件时的输出方式">
            <option value="sequential" ${this.state.fallbackMode === 'sequential' ? 'selected' : ''}>未选：顺序批次</option>
            <option value="random" ${this.state.fallbackMode === 'random' ? 'selected' : ''}>未选：随机批次</option>
          </select>
          <span class="umb-badge">数量</span><input class="umb-num" type="number" min="1" max="64" value="${this.state.batchCount}" data-input="batch-count" title="未选择时的批次数；视频输出为单个 VIDEO，图像可组成批次">
          <span class="umb-badge">起始</span><input class="umb-num" type="number" min="0" value="${this.state.startIndex}" data-input="start-index" title="顺序批次起始索引">
          <select class="umb-sel" data-input="aspect" title="宽高比例筛选">
            ${[['all','全部比例'],['landscape','横向'],['portrait','竖向'],['square','方形'],['1:1','1:1'],['4:3','4:3'],['3:4','3:4'],['16:9','16:9'],['9:16','9:16']].map(([value,label]) => `<option value="${value}" ${this.state.aspectRatio === value ? 'selected' : ''}>${label}</option>`).join('')}
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
    const root = this.container.querySelector(".umb-root");
    if (!root) {
      console.error("[UnifiedMediaBrowser] 根元素未找到，延迟重试");
      setTimeout(() => this.attachEvents(), 100);
      return;
    }

    // 目录使用持久化路径框；浏览器不能可靠返回本机绝对路径，因此回车/按钮加载最稳定。
    const directoryInput = root.querySelector('[data-input="directory"]');
    const applyDirectory = () => {
      const directory = String(directoryInput?.value || "").trim().replace(/^['"]|['"]$/g, "");
      if (!directory) return;
      this.state.directory = directory;
      this.state.currentDirectory = directory;
      this.state.selectedFolder = "";
      this.state.offset = 0;
      this.state.items = [];
      this.syncBrowserSettings();
      this.loadFolders();
      this.loadItems();
    };
    root.querySelector('[data-action="load-dir"]')?.addEventListener("click", applyDirectory);
    directoryInput?.addEventListener("keydown", event => {
      if (event.key === "Enter") applyDirectory();
    });

    // 是否递归扫描当前目录。关闭后只列出当前层文件，可显著降低大目录扫描量。
    const recursiveBtn = root.querySelector('[data-action="recursive"]');
    if (recursiveBtn) {
      recursiveBtn.addEventListener("click", () => {
        this.state.recursive = !this.state.recursive;
        recursiveBtn.classList.toggle("active", this.state.recursive);
        recursiveBtn.textContent = this.state.recursive ? "✅ 递归子文件夹" : "⬜ 递归子文件夹";
        this.state.offset = 0;
        this.state.items = [];
        this.syncBrowserSettings();
        if (this.state.directory) this.loadItems();
      });
    }

    // 列表模式完全不创建缩略图 <img>，用于大目录低资源浏览。
    const viewModeBtn = root.querySelector('[data-action="view-mode"]');
    if (viewModeBtn) {
      viewModeBtn.addEventListener("click", () => {
        this.state.viewMode = this.state.viewMode === "grid" ? "list" : "grid";
        viewModeBtn.textContent = this.state.viewMode === "grid" ? "📋 列表（省资源）" : "🖼️ 缩略图";
        this.syncBrowserSettings();
        this.renderItems();
      });
    }

    // 模式切换
    root.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        root.querySelectorAll('[data-mode]').forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        this.state.mediaType = e.target.dataset.mode;
        this.state.offset = 0;
        this.state.items = [];
        this.syncBrowserSettings();
        this.loadItems();
      });
    });

    // 搜索
    const searchInput = root.querySelector('[data-input="search"]');
    if (searchInput) {
      searchInput.addEventListener("input", debounce((e) => {
        this.state.keyword = e.target.value.trim();
        this.state.offset = 0;
        this.state.items = [];
        this.loadItems();
      }, 300));
    }

    const folderSearch = root.querySelector('[data-input="folder-search"]');
    if (folderSearch) {
      folderSearch.addEventListener("input", debounce((event) => {
        const keyword = event.target.value.trim().toLowerCase();
        root.querySelectorAll('.ft-r:not([data-action="show-all-files"])').forEach(row => {
          row.style.display = !keyword || row.textContent.toLowerCase().includes(keyword) ? "flex" : "none";
        });
      }, 120));
    }

    // 排序
    const sortSelect = root.querySelector('[data-input="sort"]');
    if (sortSelect) {
      sortSelect.addEventListener("change", (e) => {
        const [sortBy, sortDir] = e.target.value.split(":");
        this.state.sortBy = sortBy;
        this.state.sortDir = sortDir;
        this.state.offset = 0;
        this.state.items = [];
        this.loadItems();
      });
    }

    // 滚动加载更多
    const grid = root.querySelector('[data-container="grid"]');
    if (grid) {
      grid.addEventListener("scroll", debounce(() => {
        if (this.state.loading || !this.state.hasMore) return;
        if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 200) {
          this.loadItems(true);
        }
      }, 200));
    }

    root.querySelector('[data-input="fallback"]')?.addEventListener("change", event => {
      this.state.fallbackMode = event.target.value === "random" ? "random" : "sequential";
      this.syncBrowserSettings();
    });
    root.querySelector('[data-input="batch-count"]')?.addEventListener("change", event => {
      this.state.batchCount = Math.max(1, Math.min(64, Number(event.target.value || 1)));
      event.target.value = this.state.batchCount;
      this.syncBrowserSettings();
    });
    root.querySelector('[data-input="start-index"]')?.addEventListener("change", event => {
      this.state.startIndex = Math.max(0, Number(event.target.value || 0));
      event.target.value = this.state.startIndex;
      this.syncBrowserSettings();
    });
    root.querySelector('[data-input="aspect"]')?.addEventListener("change", event => {
      this.state.aspectRatio = event.target.value || "all";
      this.state.offset = 0;
      this.state.items = [];
      this.syncBrowserSettings();
      this.loadItems();
    });

    // 重新打开工作流时恢复保存的目录和浏览设置。
    if (this.state.directory) {
      this.loadFolders();
      this.loadItems();
    }
  }

  async loadFolders() {
    if (!this.state.directory) return;

    try {
      const res = await fetch(`/unified_media_browser/folders?directory=${encodeURIComponent(this.state.directory)}`);
      const data = await res.json();

      if (data.success) {
        this.state.folders = data.folders;
        this.renderFolders();
      }
    } catch (err) {
      console.error("[UnifiedMediaBrowser] 加载文件夹失败:", err);
    }
  }

  renderFolders() {
    const container = this.container.querySelector('[data-container="folders"]');
    if (!container) return;

    // 保留"全部文件"按钮
    const allFilesBtn = `
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

    // 绑定"全部文件"点击
    const allFilesRow = container.querySelector('[data-action="show-all-files"]');
    if (allFilesRow) {
      allFilesRow.addEventListener("click", () => {
        container.querySelectorAll('.ft-r').forEach(r => r.classList.remove("sel"));
        allFilesRow.classList.add("sel");

        this.state.selectedFolder = "";
        this.state.currentDirectory = this.state.directory;
        this.state.offset = 0;
        this.state.items = [];
        this.syncBrowserSettings();
        this.loadItems();
      });
    }

    // 绑定文件夹点击事件
    container.querySelectorAll('.ft-r:not([data-action="show-all-files"])').forEach(row => {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const path = row.dataset.path;

        container.querySelectorAll('.ft-r').forEach(r => r.classList.remove("sel"));
        row.classList.add("sel");

        const arrow = row.querySelector('.ft-arr');
        if (arrow) {
          arrow.classList.toggle("open");
          const children = row.nextElementSibling;
          if (children) children.style.display = arrow.classList.contains("open") ? "block" : "none";
        }

        this.state.selectedFolder = path;
        this.state.currentDirectory = path;
        this.state.offset = 0;
        this.state.items = [];
        this.syncBrowserSettings();
        this.loadItems();
      });
    });
  }


  buildFolderTree(folders, level = 0) {
    return folders.map(f => {
      const hasChildren = f.children && f.children.length > 0;
      const arrow = hasChildren ? '<span class="ft-arr">▶</span>' : '<span class="ft-arr-place"></span>';

      let html = `
        <div class="ft-r" data-path="${escapeHtml(f.path)}" style="padding-left:${8 + level * 16}px">
          ${arrow}
          <span class="ft-nm" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span>
        </div>
      `;

      if (hasChildren) {
        html += `<div style="display:none">${this.buildFolderTree(f.children, level + 1)}</div>`;
      }

      return html;
    }).join('');
  }

  async loadItems(append = false) {
    const scanDirectory = this.state.currentDirectory || this.state.directory;
    if (!scanDirectory || this.state.loading) return;

    this.state.loading = true;
    const grid = this.container.querySelector('[data-container="grid"]');
    if (!grid) {
      this.state.loading = false;
      return;
    }

    if (!append) {
      grid.innerHTML = '<div class="umb-loading">加载中...</div>';
    } else {
      const loading = document.createElement("div");
      loading.className = "umb-loading";
      loading.textContent = "加载更多...";
      grid.appendChild(loading);
    }

    try {
      const res = await fetch("/unified_media_browser/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: scanDirectory,
          media_type: this.state.mediaType,
          recursive: this.state.recursive,
          aspect_ratio: this.state.aspectRatio,
          keyword: this.state.keyword,
          sort_by: this.state.sortBy,
          sort_dir: this.state.sortDir,
          offset: this.state.offset,
          limit: this.state.limit,
        }),
      });

      const data = await res.json();

      if (data.success) {
        if (append) {
          this.state.items.push(...data.items);
        } else {
          this.state.items = data.items;
        }

        this.state.total = data.total;
        this.state.offset = data.offset + data.items.length;
        this.state.hasMore = data.has_more;

        this.renderItems();
        this.updateCounts();
      } else {
        grid.innerHTML = `<div class="umb-empty">错误: ${data.error}</div>`;
      }
    } catch (err) {
      console.error("[UnifiedMediaBrowser] 加载失败:", err);
      grid.innerHTML = `<div class="umb-empty">加载失败</div>`;
    } finally {
      this.state.loading = false;
    }
  }

  renderItems() {
    const grid = this.container.querySelector('[data-container="grid"]');
    if (!grid) return;

    grid.classList.toggle("list-mode", this.state.viewMode === "list");

    if (!this.state.items.length) {
      grid.innerHTML = '<div class="umb-empty">无文件</div>';
      return;
    }

    if (this.state.viewMode === "list") {
      // 省资源模式：此分支没有任何 <img>，因此浏览器不会发起缩略图请求。
      grid.innerHTML = this.state.items.map(item => {
        const isSelected = this.state.selectedItems.has(item.id);
        return `
          <div class="umb-list-row ${isSelected ? 'sel' : ''}" data-item-id="${encodeURIComponent(item.id)}">
            <span class="umb-list-check">${isSelected ? '☑' : '☐'}</span>
            <span class="umb-list-kind">${item.type === 'video' ? 'VIDEO' : 'IMAGE'}</span>
            <span class="umb-list-name" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</span>
            <span class="umb-list-path" title="${escapeHtml(item.rel)}">${escapeHtml(item.rel)}</span>
            <span class="umb-list-size">${formatSize(item.size)}</span>
          </div>
        `;
      }).join('');
    } else {
      grid.innerHTML = this.state.items.map(item => {
        const isSelected = this.state.selectedItems.has(item.id);
        const thumbUrl = `/unified_media_browser/thumbnail?path=${encodeURIComponent(item.path)}&size=256`;
        const typeIcon = item.type === "video" ? '<span class="umb-type-badge">🎬</span>' : '';

        return `
          <div class="umb-card ${isSelected ? 'sel' : ''}" data-item-id="${encodeURIComponent(item.id)}">
            <div class="umb-img-box">
              <img class="umb-img" src="${thumbUrl}" loading="lazy" alt="${escapeHtml(item.name)}">
              ${typeIcon}
              <span class="umb-size-badge">${formatSize(item.size)}</span>
            </div>
            <div class="umb-card-info">
              <div class="umb-name" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</div>
            </div>
            ${isSelected ? '<div class="umb-check"></div>' : ''}
          </div>
        `;
      }).join('');
    }

    grid.querySelectorAll('[data-item-id]').forEach(element => {
      element.addEventListener("click", () => {
        const id = decodeURIComponent(element.dataset.itemId);
        const item = this.state.items.find(i => i.id === id);
        if (!item) return;

        if (this.state.selectedItems.has(id)) {
          this.state.selectedItems.delete(id);
        } else {
          this.state.selectedItems.set(id, item);
        }

        element.classList.toggle("sel");
        if (element.classList.contains("umb-list-row")) {
          const check = element.querySelector(".umb-list-check");
          if (check) check.textContent = this.state.selectedItems.has(id) ? "☑" : "☐";
        } else {
          const check = element.querySelector(".umb-check");
          if (check) check.remove();
          else element.insertAdjacentHTML("beforeend", '<div class="umb-check"></div>');
        }

        this.renderSelected();
        this.updateNodeData();
      });
    });
  }

  renderSelected() {
    const container = this.container.querySelector('[data-container="selected"]');
    if (!container) return;

    const items = Array.from(this.state.selectedItems.values());

    if (!items.length) {
      container.innerHTML = '<div class="umb-sel-empty">未选择文件</div>';
      this.updateCounts();
      return;
    }

    container.innerHTML = items.map(item => {
      const thumbUrl = `/unified_media_browser/thumbnail?path=${encodeURIComponent(item.path)}&size=96`;
      return `
        <div class="umb-sel-item" data-id="${encodeURIComponent(item.id)}">
          <img class="umb-sel-thumb" src="${thumbUrl}" loading="lazy" alt="${escapeHtml(item.name)}">
          <div class="umb-sel-info">
            <div class="umb-sel-name" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</div>
            <div class="umb-sel-type">${escapeHtml(item.type)} • ${formatSize(item.size)}</div>
          </div>
          <button class="umb-sel-remove" data-remove="${encodeURIComponent(item.id)}">×</button>
        </div>
      `;
    }).join('');

    // 绑定移除按钮
    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = decodeURIComponent(btn.dataset.remove);
        this.state.selectedItems.delete(id);
        this.renderSelected();
        this.renderItems();
        this.updateNodeData();
      });
    });

    this.updateCounts();
  }

  updateCounts() {
    const countEl = this.container.querySelector('[data-display="count"]');
    const selCountEl = this.container.querySelector('[data-display="selected-count"]');

    if (countEl) countEl.textContent = `${this.state.total} 项`;
    if (selCountEl) selCountEl.textContent = this.state.selectedItems.size;
  }

  updateNodeData() {
    const selections = Array.from(this.state.selectedItems.values()).map(item => ({
      id: item.id,
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size,
    }));

    const widget = this.getWidget("selection_data");
    if (widget) {
      widget.value = JSON.stringify(selections);
    }
    this.syncBrowserSettings();
    this.node.setDirtyCanvas?.(true, true);
  }
}

// ── ComfyUI 注册 ────────────────────────────────────────
app.registerExtension({
  name: "EagleSuite.UnifiedMediaBrowser",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "UnifiedMediaBrowser") return;

    const HIDDEN_WIDGETS = [
      "selection_data", "directory", "active_directory", "media_type", "recursive", "view_mode",
      "fallback_mode", "batch_count", "start_index", "random_seed", "aspect_ratio"
    ];

    const hideWidgets = (node) => {
      if (!node.widgets) return false;
      let found = false;
      for (const w of node.widgets) {
        if (HIDDEN_WIDGETS.includes(w.name)) {
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

    // 旧工作流会序列化旧输出槽；按名称从后向前移除，LiteGraph 会同步调整后续槽位。
    const normalizeOutputSlots = (node) => {
      if (!Array.isArray(node.outputs)) return;
      for (let index = node.outputs.length - 1; index >= 0; index--) {
        if (["file_paths", "selection_data"].includes(node.outputs[index]?.name)) {
          node.removeOutput(index);
        }
      }
    };

    const orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      if (orig) orig.apply(this, arguments);
      if (this._umbInit) return;
      this._umbInit = true;
      normalizeOutputSlots(this);

      this.setSize([960, 640]);
      setTimeout(() => {
        if (!hideWidgets(this)) {
          setTimeout(() => hideWidgets(this), 500);
        }
      }, 300);

      if (!document.getElementById("umb-style")) {
        const style = document.createElement("style");
        style.id = "umb-style";
        style.textContent = CSS;
        document.head.appendChild(style);
      }

      const el = document.createElement("div");
      el.style.cssText = "width:940px;max-width:none;min-width:0;height:100%;box-sizing:border-box;overflow:hidden;border-radius:0 0 8px 8px;background:#121216;";

      this.addDOMWidget("unified_media_browser", "div", el, { serialize: false });

      const nodeRef = this;
      const applyFrame = (size) => {
        const nodeWidth = Number(size?.[0]) || 960;
        const nodeHeight = Number(size?.[1]) || 640;
        const w = Math.max(320, nodeWidth - 20);
        const h = Math.max(300, nodeHeight - 140);
        el.style.width = w + "px";
        el.style.height = h + "px";
        return [w, h];
      };
      // 保留 ComfyUI 自带的 DOM widget 测量。不能从 node.size 反推 computeSize，
      // 否则全图重新布局时节点标题/插槽高度会被反复累加。
      this._umbApplyFrame = applyFrame;
      applyFrame(this.size);

      try {
        this._umbApp = new UnifiedMediaBrowser(el, this);
      } catch (e) {
        console.error("[UnifiedMediaBrowser] 初始化失败:", e);
        el.innerHTML = `<div style="padding:30px;color:#e55">错误: ${e.message}</div>`;
      }

      const onResize = this.onResize;
      this.onResize = function(size) {
        if (onResize) onResize.apply(this, arguments);
        applyFrame(size);
        this.setDirtyCanvas(true, true);
      };

      // 兼容旧工作流：节点保存宽度可能在 onNodeCreated 之后才恢复。
      setTimeout(() => applyFrame(nodeRef.size), 0);
      setTimeout(() => applyFrame(nodeRef.size), 250);
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = onConfigure?.apply(this, arguments);
      normalizeOutputSlots(this);
      const nodeRef = this;
      setTimeout(() => nodeRef._umbApplyFrame?.(nodeRef.size), 0);
      return result;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function() {
      if (this._umbApp) {
        this._umbApp = null;
      }
      this._umbApplyFrame = null;
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  }
});
