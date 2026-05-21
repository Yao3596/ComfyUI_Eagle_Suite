/**
 * Eagle Gallery - Eagle 图片浏览器节点
 * 融合 Wallhaven Gallery（即时提交、预览条）+ Danbooru Gallery（设置弹窗、丰富筛选）
 */
import { app } from "../../../scripts/app.js";

// Eagle Gallery 一次性加载全部（本地库无需分页）

function eg$el(tag, attrs, children) {
    let cls = "";
    if (typeof tag === "string" && tag.includes(".")) {
        const parts = tag.split(".");
        tag = parts[0];
        cls = parts.slice(1).join(" ");
    }
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
        for (const [k, v] of Object.entries(attrs)) {
            if (k === "style") {
                if (typeof v === "string") el.style.cssText = v;
                else if (typeof v === "object") { for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv); }
            }
            else if (k === "textContent") el.textContent = v;
            else if (k === "innerHTML") el.innerHTML = v;
            else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
            else el.setAttribute(k, v);
        }
    }
    if (children != null) {
        const arr = Array.isArray(children) ? children : [children];
        for (const child of arr) {
            if (child == null) continue;
            el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
        }
    }
    return el;
}

const CSS = `
.eg-container{display:flex;flex-direction:column;width:100%;height:100%;background:#1a1a1e;font-size:12px;color:#ddd;box-sizing:border-box;font-family:sans-serif;overflow:hidden}
.eg-preview{display:flex;gap:6px;padding:8px 10px;background:#1e1e22;border-bottom:1px solid #333;min-height:70px;max-height:90px;overflow-x:auto;overflow-y:hidden;flex-shrink:0}
.eg-preview::-webkit-scrollbar{height:4px}
.eg-preview::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.eg-preview-thumb{flex-shrink:0;width:80px;height:60px;border-radius:4px;overflow:hidden;border:1px solid #444;position:relative;background:#25252a}
.eg-preview-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.eg-preview-empty{color:#666;font-size:11px;display:flex;align-items:center;justify-content:center;width:100%}
.eg-toolbar{padding:6px 10px;background:#25252a;border-bottom:1px solid #333;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.eg-search{flex:1;min-width:100px;padding:4px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;outline:none}
.eg-search:focus{border-color:#5a8fe0}
.eg-btn{padding:4px 10px;background:#333;border:1px solid #444;border-radius:4px;color:#ddd;font-size:11px;cursor:pointer;white-space:nowrap}
.eg-btn:hover{background:#3a3a40}
.eg-btn.primary{background:#4a7de0;border-color:#4a7de0;color:#fff}
.eg-btn.primary:hover{background:#5a8fe0}
.eg-btn.active{background:#2a4a8a;border-color:#4a7de0}
.eg-main{flex:1;display:flex;overflow:hidden}
.eg-sidebar{width:180px;background:#1e1e22;border-right:1px solid #333;overflow-y:auto;flex-shrink:0;padding:6px}
.eg-sidebar::-webkit-scrollbar{width:4px}
.eg-sidebar::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.eg-folder-item{padding:4px 6px;border-radius:3px;cursor:pointer;font-size:11px;color:#aaa;display:flex;align-items:center;gap:4px}
.eg-folder-item:hover{background:#2a2a30;color:#ddd}
.eg-folder-item.active{background:#2a4a8a;color:#fff}
.eg-folder-icon{font-size:10px}
.eg-folder-children{padding-left:14px;border-left:1px solid #333;margin-left:6px}
.eg-grid{flex:1;overflow-y:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));grid-auto-rows:100px;gap:8px;align-content:start;background:#1a1a1e}
.eg-grid::-webkit-scrollbar{width:6px}
.eg-grid::-webkit-scrollbar-track{background:transparent}
.eg-grid::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
.eg-thumb{position:relative;background:#222;border-radius:4px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color .15s,transform .1s;height:100px}
.eg-thumb:hover{border-color:#5a8fe0;transform:translateY(-1px)}
.eg-thumb.selected{border-color:#4a7de0;box-shadow:0 0 0 1px #4a7de0}
.eg-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.eg-thumb-info{position:absolute;bottom:0;left:0;right:0;padding:3px 6px;background:linear-gradient(transparent,rgba(0,0,0,.85));font-size:10px;color:#aaa;display:flex;justify-content:space-between;gap:4px}
.eg-thumb-star{position:absolute;top:3px;left:40px;color:#fc0;font-size:10px;text-shadow:0 1px 2px rgba(0,0,0,.8);z-index:1}
.eg-thumb-res{position:absolute;top:3px;right:3px;padding:1px 4px;border-radius:2px;font-size:9px;background:rgba(0,0,0,.6);color:#ccc}
.eg-thumb-index{position:absolute;top:3px;left:3px;padding:1px 5px;border-radius:2px;font-size:10px;background:rgba(74,125,224,.85);color:#fff;font-weight:700;z-index:2}
.eg-footer{padding:5px 10px;background:#25252a;border-top:1px solid #333;display:flex;align-items:center;gap:8px;flex-shrink:0}
.eg-pageinfo{flex:1;text-align:center;color:#888;font-size:11px}
.eg-empty{text-align:center;padding:40px;color:#666;font-size:13px}
.eg-loading{text-align:center;padding:40px;color:#888}
.eg-error{text-align:center;padding:40px;color:#e66}
.eg-settings-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;align-items:center;justify-content:center}
.eg-settings-backdrop.show{display:flex}
.eg-settings-panel{background:#25252a;border:1px solid #444;border-radius:8px;padding:20px;width:360px;box-shadow:0 8px 24px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:12px}
.eg-settings-panel h3{margin:0 0 4px;color:#eee;font-size:14px}
.eg-settings-panel label{display:block;margin-bottom:4px;color:#aaa;font-size:12px}
.eg-settings-panel input{width:100%;padding:6px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;box-sizing:border-box}
.eg-settings-panel input:focus{border-color:#5a8fe0;outline:none}
.eg-settings-hint{color:#888;font-size:11px;margin-top:4px;line-height:1.4}
.eg-settings-hint code{background:#1e1e22;padding:1px 4px;border-radius:3px;color:#aaa;font-family:monospace}
.eg-settings-footer{margin-top:8px;padding-top:12px;border-top:1px solid #333;display:flex;align-items:center;justify-content:space-between;gap:8px}
.eg-settings-github{display:inline-flex;align-items:center;gap:6px;color:#aaa;font-size:12px;text-decoration:none;padding:5px 10px;background:#1e1e22;border:1px solid #333;border-radius:4px;transition:.15s}
.eg-settings-github:hover{color:#eee;border-color:#555}
.eg-settings-author{color:#666;font-size:11px}
.eg-settings-panel .eg-settings-row{display:flex;gap:8px;justify-content:flex-end}
.eg-preview-del{position:absolute;top:2px;right:2px;width:16px;height:16px;background:rgba(0,0,0,.7);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s;z-index:2}
.eg-preview-thumb:hover .eg-preview-del{opacity:1}
.eg-preview-del:hover{background:rgba(200,0,0,.8)}
select.eg-btn{-webkit-appearance:none;-moz-appearance:none;appearance:none;background:#333 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath fill='%23aaa' d='M0 0h8L4 4z'/%3E%3C/svg%3E") no-repeat right 8px center;padding-right:22px}
`;

app.registerExtension({
    name: "EagleSuite.EagleGallery",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "EagleGalleryNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.setSize([960, 720]);

            // 隐藏 selection_data 文本 widget（已有输出端口，不需要显示）
            const _hideSel = (node) => {
                const w = node.widgets?.find(x => x.name === "selection_data");
                if (!w) return false;
                w.type = "hidden";
                w.computeSize = () => [0, -4];
                w.hidden = true;
                w.draw = () => {};   // 彻底阻止绘制
                node.setDirtyCanvas(true, true);
                return true;
            };
            // 延迟重试：widget 可能在 onNodeCreated 之后才注册
            setTimeout(() => {
                if (!_hideSel(this)) setTimeout(() => _hideSel(this), 500);
            }, 300);

            if (!document.getElementById("eg-style")) {
                document.head.appendChild(eg$el("style", { id: "eg-style", textContent: CSS }));
            }

            const state = {
                query: "",
                folderId: "",
                star: "全部",
                shape: "全部",
                items: [],
                total: 0,
                loading: false,
                selected: new Set(),
                selectedItems: [],    // 完整选中数据列表，不依赖 state.items
                folders: [],
                sidebarVisible: true,
            };

            const container = eg$el("div.eg-container");
            buildUI(container, state, this);
            this.addDOMWidget("eagle_gallery", "div", container, { serialize: false });

            // 延迟加载文件夹树
            setTimeout(function () { loadFolders(state); }, 100);
        };
    },
});

function buildUI(container, state, node) {
    state._node = node;

    // ── 预览条 ──
    var previewArea = eg$el("div.eg-preview");
    previewArea.innerHTML = '<div class="eg-preview-empty">选中图片将显示在这里</div>';
    state._previewArea = previewArea;
    // 鼠标滚轮横向滚动
    previewArea.addEventListener("wheel", function (e) {
        if (e.deltaY !== 0) {
            e.preventDefault();
            previewArea.scrollLeft += e.deltaY;
        }
    }, { passive: false });
    container.appendChild(previewArea);

    // ── 工具栏 ──
    var toolbar = eg$el("div.eg-toolbar");

    var searchInput = eg$el("input.eg-search", { type: "text", placeholder: "搜索关键词..." });
    searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { loadItems(state); }
    });
    state._searchInput = searchInput;

    var searchBtn = eg$el("button.eg-btn.primary", { textContent: "\u{1F50D} 搜索" });
    searchBtn.onclick = function () { loadItems(state); };

    // 索引跳转
    var jumpInput = eg$el("input.eg-search", {
        type: "number",
        placeholder: "# 索引",
        style: "min-width:60px;max-width:80px;flex:0",
        title: "输入数字跳转到对应索引（0起）",
    });
    jumpInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") jumpToIndex(state, parseInt(jumpInput.value, 10) || 0);
    });
    state._jumpInput = jumpInput;

    var jumpBtn = eg$el("button.eg-btn", { textContent: "↗ 跳转", title: "跳转到指定索引" });
    jumpBtn.onclick = function () { jumpToIndex(state, parseInt(jumpInput.value, 10) || 0); };
    state._jumpBtn = jumpBtn;

    var totalBadge = eg$el("span", {
        textContent: "共 0 张",
        style: "color:#888;font-size:11px;white-space:nowrap",
    });
    state._totalBadge = totalBadge;

    // 文件夹下拉
    var folderSelect = eg$el("select.eg-btn", { style: "min-width:120px" });
    folderSelect.appendChild(eg$el("option", { value: "", textContent: "📁 全部文件夹" }));
    folderSelect.addEventListener("change", function () {
        state.folderId = folderSelect.value;
        loadItems(state);
    });
    state._folderSelect = folderSelect;

    // 评分筛选
    var starSelect = eg$el("select.eg-btn", { style: "min-width:80px" });
    ["全部", "未评分", "1星", "2星", "3星", "4星", "5星"].forEach(function (s) {
        starSelect.appendChild(eg$el("option", { value: s, textContent: s === "全部" ? "⭐ 全部" : "⭐ " + s }));
    });
    starSelect.addEventListener("change", function () {
        state.star = starSelect.value;
        loadItems(state);
    });

    // 形状筛选
    var shapeSelect = eg$el("select.eg-btn", { style: "min-width:80px" });
    [
        { value: "全部", label: "全部比例" },
        { value: "横向", label: "▬ 横向" },
        { value: "纵向", label: "▮ 纵向" },
        { value: "方形", label: "■ 方形" },
    ].forEach(function (s) {
        shapeSelect.appendChild(eg$el("option", { value: s.value, textContent: s.label }));
    });
    shapeSelect.addEventListener("change", function () {
        state.shape = shapeSelect.value;
        loadItems(state);
    });

    // 侧边栏切换
    var sidebarBtn = eg$el("button.eg-btn", { textContent: "📂", title: "切换文件夹树" });
    sidebarBtn.onclick = function () {
        state.sidebarVisible = !state.sidebarVisible;
        if (sidebar) sidebar.style.display = state.sidebarVisible ? "block" : "none";
    };

    // 设置按钮
    var settingsBtn = eg$el("button.eg-btn", { textContent: "⚙️", title: "设置" });
    settingsBtn.onclick = function (e) {
        e.stopPropagation();
        openSettings(state);
    };

    toolbar.append(searchInput, searchBtn, jumpInput, jumpBtn, totalBadge, folderSelect, starSelect, shapeSelect, sidebarBtn, settingsBtn);
    container.appendChild(toolbar);

    // ── 主体区域 ──
    var main = eg$el("div.eg-main");

    // 文件夹树侧边栏
    var sidebar = eg$el("div.eg-sidebar");
    sidebar.innerHTML = '<div class="eg-empty">加载中...</div>';
    state._sidebar = sidebar;
    main.appendChild(sidebar);

    // 图片网格
    var grid = eg$el("div.eg-grid");
    grid.innerHTML = '<div class="eg-empty">选择文件夹或输入关键词搜索</div>';
    state._grid = grid;
    main.appendChild(grid);

    container.appendChild(main);

    // ── 页脚 ──
    var footer = eg$el("div.eg-footer");
    var pageInfo = eg$el("span.eg-pageinfo", { textContent: "就绪" });
    state._pageInfo = pageInfo;
    footer.appendChild(pageInfo);
    container.appendChild(footer);

    // ── 设置弹窗 ──
    function openSettings(state) {
        var backdrop = document.querySelector(".eg-settings-backdrop");
        if (!backdrop) {
            backdrop = eg$el("div.eg-settings-backdrop", { onclick: function (e) { if (e.target === backdrop) backdrop.classList.remove("show"); } });
            var panel = eg$el("div.eg-settings-panel");
            panel.innerHTML = '<h3>设置</h3>' +
                '<label>Eagle API URL</label>' +
                '<input type="text" id="eg-api-url" placeholder="http://localhost:41595">' +
                '<div class="eg-settings-hint">支持在 URL 末尾添加 <code>?token=xxx</code> 进行认证，如 <code>http://localhost:41595/?token=abc123</code></div>' +
                '<div class="eg-settings-footer">' +
                '<a class="eg-settings-github" href="https://github.com/Yao3596/ComfyUI_Eagle_Suite" target="_blank" rel="noopener">' +
                '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> GitHub' +
                '</a>' +
                '<span class="eg-settings-author">Yao3596 / ComfyUI_Eagle_Suite</span>' +
                '</div>' +
                '<div class="eg-settings-row">' +
                '<button class="eg-btn" id="eg-settings-cancel">取消</button>' +
                '<button class="eg-btn primary" id="eg-settings-save">保存</button>' +
                '</div>';
            backdrop.appendChild(panel);
            document.body.appendChild(backdrop);

            document.getElementById("eg-settings-cancel").onclick = function () { backdrop.classList.remove("show"); };
            document.getElementById("eg-settings-save").onclick = function () {
                var url = document.getElementById("eg-api-url").value.trim();
                fetch("/eagle_gallery/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ eagle_url: url || "http://localhost:41595" }),
                }).then(function () {
                    backdrop.classList.remove("show");
                });
            };
        }
        // 加载当前设置
        fetch("/eagle_gallery/settings")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var input = backdrop.querySelector("#eg-api-url");
                if (input && data.settings) input.value = data.settings.eagle_url || "";
            })
            .catch(function () {});
        backdrop.classList.add("show");
    }
}

// ── 加载文件夹树 ──
async function loadFolders(state) {
    try {
        var res = await fetch("/eagle_gallery/folders");
        var data = await res.json();
        if (data.success && data.folders) {
            state.folders = data.folders;
            renderFolderTree(state);
            // 同时填充工具栏下拉
            populateFolderSelect(state);
        } else {
            state._sidebar.innerHTML = '<div class="eg-error">获取文件夹失败</div>';
        }
    } catch (e) {
        state._sidebar.innerHTML = '<div class="eg-error">连接 Eagle 失败<br>请确认 Eagle 已启动</div>';
    }
}

function renderFolderTree(state) {
    var sidebar = state._sidebar;
    sidebar.innerHTML = "";

    function buildTree(folders, parent) {
        folders.forEach(function (f) {
            var item = eg$el("div.eg-folder-item");
            var hasChildren = f.children && f.children.length > 0;
            var icon = hasChildren ? "📂" : "📁";
            item.innerHTML = '<span class="eg-folder-icon">' + icon + '</span> ' + escapeHtml(f.name || "未命名");

            item.onclick = function () {
                // 清除其他 active
                sidebar.querySelectorAll(".eg-folder-item.active").forEach(function (el) { el.classList.remove("active"); });
                item.classList.add("active");
                state.folderId = f.id;
                // 同步更新下拉
                if (state._folderSelect) state._folderSelect.value = f.id;
                loadItems(state);
            };

            parent.appendChild(item);

            if (hasChildren) {
                var childrenWrap = eg$el("div.eg-folder-children");
                buildTree(f.children, childrenWrap);
                parent.appendChild(childrenWrap);
            }
        });
    }

    if (!state.folders || !state.folders.length) {
        sidebar.innerHTML = '<div class="eg-empty">无文件夹</div>';
        return;
    }

    buildTree(state.folders, sidebar);
}

function populateFolderSelect(state) {
    var select = state._folderSelect;
    if (!select) return;
    // 保留第一个 option（全部文件夹）
    while (select.children.length > 1) {
        select.removeChild(select.lastChild);
    }

    function addOptions(folders, prefix) {
        folders.forEach(function (f) {
            var label = prefix + (f.name || "未命名");
            select.appendChild(eg$el("option", { value: f.id, textContent: label }));
            if (f.children && f.children.length) {
                addOptions(f.children, prefix + "  ");
            }
        });
    }

    addOptions(state.folders, "");
}

// ── 加载图片列表 ──
async function loadItems(state) {
    if (state.loading) return;
    state.loading = true;
    state._grid.innerHTML = '<div class="eg-loading">🔄 加载中...</div>';

    try {
        var body = {
            folderId: state.folderId,
            keywords: state._searchInput.value.trim(),
            star: state.star,
            shape: state.shape,
            all: true,
        };

        var res = await fetch("/eagle_gallery/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        var data = await res.json();

        if (data.success) {
            state.items = data.items || [];
            state.total = data.total || 0;
            renderGrid(state);
            updateFooter(state);
        } else {
            state._grid.innerHTML = '<div class="eg-error">加载失败: ' + (data.error || "未知错误") + '</div>';
        }
    } catch (e) {
        state._grid.innerHTML = '<div class="eg-error">请求失败: ' + e.message + '</div>';
    } finally {
        state.loading = false;
    }
}

// ── 渲染网格 ──
function renderGrid(state) {
    var grid = state._grid;
    grid.innerHTML = "";

    if (!state.items.length) {
        grid.innerHTML = '<div class="eg-empty">暂无结果</div>';
        return;
    }

    state.items.forEach(function (item, i) {
        var globalIndex = i;
        var itemId = item.id;
        var name = item.name || "未命名";
        var width = item.width || 0;
        var height = item.height || 0;
        var star = item.star || 0;
        var tags = item.tags || [];
        var resText = width && height ? width + "x" + height : "";

        var card = eg$el("div.eg-thumb", { "data-id": itemId, "data-index": globalIndex });
        if (state.selected.has(itemId)) card.classList.add("selected");

        // 缩略图
        var thumbSrc = "/eagle_gallery/thumbnail?id=" + encodeURIComponent(itemId);
        var img = eg$el("img", {
            src: thumbSrc,
            loading: "lazy",
            alt: name,
        });
        img.onerror = function () {
            // 备用：如果 item 自带 thumbnail 路径，直接尝试加载
            var fallback = item.thumbnail || item.thumbnailPath || "";
            if (fallback && img.src !== fallback) {
                img.src = fallback;
            } else {
                img.style.display = "none";
            }
        };

        // 信息栏
        var info = eg$el("div.eg-thumb-info", [
            eg$el("span", { textContent: tags.length ? "🏷 " + tags.length : "" }),
            eg$el("span", { textContent: name.length > 12 ? name.slice(0, 12) + "..." : name }),
        ]);

        // 评分
        var starBadge = null;
        if (star > 0) {
            starBadge = eg$el("span.eg-thumb-star", { textContent: "★".repeat(star) });
        }

        // 分辨率
        var resBadge = null;
        if (resText) {
            resBadge = eg$el("span.eg-thumb-res", { textContent: resText });
        }

        // 全局序号
        var indexBadge = eg$el("span.eg-thumb-index", { textContent: "#" + globalIndex });

        card.appendChild(img);
        card.appendChild(info);
        card.appendChild(indexBadge);
        if (starBadge) card.appendChild(starBadge);
        if (resBadge) card.appendChild(resBadge);

        // 点击选择（维护 selectedItems 不依赖当前页）
        card.onclick = function () {
            if (state.selected.has(itemId)) {
                state.selected.delete(itemId);
                state.selectedItems = state.selectedItems.filter(function (s) { return s.id !== itemId; });
                card.classList.remove("selected");
            } else {
                state.selected.add(itemId);
                state.selectedItems.push({
                    id: itemId,
                    name: item.name || "",
                    filePath: item.filePath || "",
                    tags: item.tags || [],
                    width: item.width || 0,
                    height: item.height || 0,
                    star: item.star || 0,
                    ext: item.ext || "",
                });
                card.classList.add("selected");
            }
            updatePreview(state);
            confirmSelection(state, state._node);
        };

        // 双击跳转：填充索引输入框并选中该图
        card.ondblclick = function () {
            if (state._jumpInput) state._jumpInput.value = globalIndex;
            if (!state.selected.has(itemId)) {
                state.selected.add(itemId);
                state.selectedItems.push({
                    id: itemId,
                    name: item.name || "",
                    filePath: item.filePath || "",
                    tags: item.tags || [],
                    width: item.width || 0,
                    height: item.height || 0,
                    star: item.star || 0,
                    ext: item.ext || "",
                });
                card.classList.add("selected");
                updatePreview(state);
                confirmSelection(state, state._node);
            }
        };

        grid.appendChild(card);
    });
}

// ── 更新页脚 ──
function updateFooter(state) {
    state._pageInfo.textContent = "共 " + state.total + " 张";
    if (state._totalBadge) state._totalBadge.textContent = "共 " + state.total + " 张";
}

// ── 跳转到指定索引 ──
async function jumpToIndex(state, targetIndex) {
    if (!state.total || targetIndex < 0) {
        alert("索引无效或暂无数据");
        return;
    }
    if (targetIndex >= state.total) targetIndex = state.total - 1;

    var cards = state._grid.querySelectorAll(".eg-thumb");
    var card = cards[targetIndex];
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.style.transition = "none";
    card.style.boxShadow = "0 0 12px 2px #4a7de0";
    setTimeout(function () {
        card.style.transition = "border-color .15s,transform .1s,box-shadow .6s";
        card.style.boxShadow = "";
    }, 1200);
}

// ── 更新预览条 ──
function updatePreview(state) {
    var preview = state._previewArea;
    if (state.selectedItems.length === 0) {
        preview.innerHTML = '<div class="eg-preview-empty">选中图片将显示在这里</div>';
        return;
    }
    preview.innerHTML = "";

    // 遍历完整选中列表，不依赖 state.items
    state.selectedItems.forEach(function (sel) {
        var thumbEl = eg$el("div.eg-preview-thumb");
        var img = eg$el("img", {
            src: "/eagle_gallery/thumbnail?id=" + encodeURIComponent(sel.id),
            title: sel.name || "",
        });
        img.onerror = function () { img.style.display = "none"; };

        var delBtn = eg$el("div.eg-preview-del", { textContent: "×" });
        delBtn.onclick = function (e) {
            e.stopPropagation();
            state.selected.delete(sel.id);
            state.selectedItems = state.selectedItems.filter(function (s) { return s.id !== sel.id; });
            // 同步网格中的选中框
            var gridCard = state._grid.querySelector('.eg-thumb[data-id="' + sel.id + '"]');
            if (gridCard) gridCard.classList.remove("selected");
            updatePreview(state);
            confirmSelection(state, state._node);
        };

        thumbEl.append(img, delBtn);
        preview.appendChild(thumbEl);
    });

    // 清除全部按钮
    var clearBtn = eg$el("button.eg-btn", {
        textContent: "清除",
        style: "flex-shrink:0;height:60px;align-self:center;margin-left:4px",
        title: "清除全部",
    });
    clearBtn.onclick = function (e) {
        e.stopPropagation();
        state.selected.clear();
        state.selectedItems = [];
        state._grid.querySelectorAll(".eg-thumb.selected").forEach(function (el) { el.classList.remove("selected"); });
        updatePreview(state);
        confirmSelection(state, state._node);
    };
    preview.appendChild(clearBtn);
}

// ── 确认选择并提交 ──
function confirmSelection(state, node) {
    // 遍历完整选中列表，不依赖 state.items（修复翻页后数据丢失）
    var selections = state.selectedItems.slice();
    var selectionJson = JSON.stringify({ selections: selections });

    if (node) {
        // 与 Wallhaven 版本对齐：先查 widgets，再查 inputs，最后 fallback
        var widget = node.widgets ? node.widgets.find(function (w) { return w.name === "selection_data"; }) : null;
        if (widget) {
            widget.value = selectionJson;
        } else {
            var input = node.inputs ? node.inputs.find(function (inp) { return inp.name === "selection_data"; }) : null;
            if (input) {
                input.value = selectionJson;
            } else {
                node._selection_data = selectionJson;
            }
        }
        node.setDirtyCanvas(true, true);
        if (node.graph) {
            node.graph.change();
        }
    }
}

// ── 工具函数 ──
function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
