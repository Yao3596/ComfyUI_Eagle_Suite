/**
 * Pinterest Gallery - Pinterest 图片浏览器节点
 * 支持两种模式:
 *   1. 抓取模式（默认）— 不需要 API Token，直接抓取 Pinterest 页面
 *   2. API 模式 — 需要 Access Token，使用 Pinterest API v5
 */
import { app } from "../../../scripts/app.js";

const PAGE_SIZE = 24;

function pg$el(tag, attrs, children) {
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
.pg-container{display:flex;flex-direction:column;width:100%;height:100%;background:#1a1a1e;font-size:12px;color:#ddd;box-sizing:border-box;font-family:sans-serif;overflow:hidden}
.pg-preview{display:flex;gap:6px;padding:8px 10px;background:#1e1e22;border-bottom:1px solid #333;min-height:70px;max-height:90px;overflow-x:auto;overflow-y:hidden;flex-shrink:0}
.pg-preview::-webkit-scrollbar{height:4px}
.pg-preview::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.pg-preview-thumb{flex-shrink:0;width:80px;height:60px;border-radius:4px;overflow:hidden;border:1px solid #444;position:relative;background:#25252a}
.pg-preview-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.pg-preview-empty{color:#666;font-size:11px;display:flex;align-items:center;justify-content:center;width:100%}
.pg-header{padding:6px 10px;background:#25252a;border-bottom:1px solid #333;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pg-search{flex:1;min-width:100px;padding:4px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;outline:none}
.pg-search:focus{border-color:#bd081c}
.pg-btn{padding:4px 10px;background:#333;border:1px solid #444;border-radius:4px;color:#ddd;font-size:11px;cursor:pointer;white-space:nowrap}
.pg-btn:hover{background:#3a3a40}
.pg-btn.primary{background:#bd081c;border-color:#bd081c;color:#fff}
.pg-btn.primary:hover{background:#e60023}
.pg-btn.active{background:#8a1a2a;border-color:#bd081c}
.pg-btn.green{background:#2a6e3f;border-color:#2a6e3f;color:#fff}
.pg-btn.green:hover{background:#3a8e4f}
.pg-btn.green.active{background:#1a5e2f;border-color:#2a6e3f}
.pg-mode-bar{padding:4px 10px;background:#1e1e22;border-bottom:1px solid #2a2a2e;display:flex;gap:4px;align-items:center;flex-shrink:0}
.pg-mode-bar .pg-mode-label{color:#888;font-size:10px;margin-right:4px}
.pg-main{flex:1;display:flex;overflow:hidden}
.pg-sidebar{width:180px;background:#1e1e22;border-right:1px solid #333;overflow-y:auto;flex-shrink:0;padding:6px}
.pg-sidebar::-webkit-scrollbar{width:4px}
.pg-sidebar::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.pg-board-item{padding:5px 6px;border-radius:3px;cursor:pointer;font-size:11px;color:#aaa;display:flex;align-items:center;gap:4px}
.pg-board-item:hover{background:#2a2a30;color:#ddd}
.pg-board-item.active{background:#8a1a2a;color:#fff}
.pg-grid{flex:1;overflow-y:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-auto-rows:100px;gap:8px;align-content:start}
.pg-grid::-webkit-scrollbar{width:6px}
.pg-grid::-webkit-scrollbar-track{background:transparent}
.pg-grid::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
.pg-thumb{position:relative;background:#222;border-radius:4px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color .15s,transform .1s;height:100px}
.pg-thumb:hover{border-color:#bd081c;transform:translateY(-1px)}
.pg-thumb.selected{border-color:#bd081c;box-shadow:0 0 0 1px #bd081c}
.pg-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.pg-thumb-info{position:absolute;bottom:0;left:0;right:0;padding:3px 6px;background:linear-gradient(transparent,rgba(0,0,0,.85));font-size:10px;color:#aaa;display:flex;justify-content:space-between;gap:4px}
.pg-thumb-title{position:absolute;top:3px;left:3px;right:3px;font-size:9px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-footer{padding:5px 10px;background:#25252a;border-top:1px solid #333;display:flex;align-items:center;gap:8px;flex-shrink:0}
.pg-pageinfo{flex:1;text-align:center;color:#888;font-size:11px}
.pg-empty{text-align:center;padding:40px;color:#666;font-size:13px}
.pg-loading{text-align:center;padding:40px;color:#888}
.pg-error{text-align:center;padding:40px;color:#e66}
.pg-settings-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;align-items:center;justify-content:center}
.pg-settings-backdrop.show{display:flex}
.pg-settings-panel{background:#25252a;border:1px solid #444;border-radius:8px;padding:20px;width:360px;box-shadow:0 8px 24px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:12px}
.pg-settings-panel h3{margin:0 0 4px;color:#eee;font-size:14px}
.pg-settings-panel label{display:block;margin-bottom:4px;color:#aaa;font-size:12px}
.pg-settings-panel input{width:100%;padding:6px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;box-sizing:border-box}
.pg-settings-panel input:focus{border-color:#bd081c;outline:none}
.pg-settings-hint{color:#888;font-size:11px;margin-top:4px;line-height:1.4}
.pg-settings-footer{margin-top:8px;padding-top:12px;border-top:1px solid #333;display:flex;align-items:center;justify-content:space-between;gap:8px}
.pg-settings-github{display:inline-flex;align-items:center;gap:6px;color:#aaa;font-size:12px;text-decoration:none;padding:5px 10px;background:#1e1e22;border:1px solid #333;border-radius:4px;transition:.15s}
.pg-settings-github:hover{color:#eee;border-color:#555}
.pg-settings-author{color:#666;font-size:11px}
.pg-settings-panel .pg-settings-row{display:flex;gap:8px;justify-content:flex-end}
.pg-preview-del{position:absolute;top:2px;right:2px;width:16px;height:16px;background:rgba(0,0,0,.7);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s;z-index:2}
.pg-preview-thumb:hover .pg-preview-del{opacity:1}
.pg-preview-del:hover{background:rgba(200,0,0,.8)}
`;

app.registerExtension({
    name: "EagleSuite.PinterestGallery",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PinterestGalleryNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.setSize([960, 720]);

            // 隐藏 selection_data 文本 widget
            const _hideSel = (node) => {
                const w = node.widgets?.find(x => x.name === "selection_data");
                if (!w) return false;
                w.type = "hidden";
                w.computeSize = () => [0, -4];
                w.hidden = true;
                w.draw = () => {};
                node.setDirtyCanvas(true, true);
                return true;
            };
            setTimeout(() => {
                if (!_hideSel(this)) setTimeout(() => _hideSel(this), 500);
            }, 300);

            if (!document.getElementById("pg-style")) {
                document.head.appendChild(pg$el("style", { id: "pg-style", textContent: CSS }));
            }

            const state = {
                query: "",
                mode: "scrape",     // "scrape" | "api_search" | "api_boards"
                boardId: "",
                boards: [],
                bookmark: "",
                results: [],
                total: 0,
                loading: false,
                selected: new Set(),
                selectedItems: [],
            };

            const container = pg$el("div.pg-container");
            buildUI(container, state, this);
            this.addDOMWidget("pinterest_gallery", "div", container, { serialize: false });

            // ── 节点创建后自动加载 Pinterest 首页 ──
            setTimeout(function () {
                state._searchInput.value = "https://www.pinterest.com/";
                scrapeSearch(state, "https://www.pinterest.com/");
            }, 600);
        };
    },
});

function buildUI(container, state, node) {
    state._node = node;

    // ── 预览条 ──
    var previewArea = pg$el("div.pg-preview");
    previewArea.innerHTML = '<div class="pg-preview-empty">\u9009\u4E2D\u56FE\u7247\u5C06\u663E\u793A\u5728\u8FD9\u91CC</div>';
    state._previewArea = previewArea;
    previewArea.addEventListener("wheel", function (e) {
        if (e.deltaY !== 0) { e.preventDefault(); previewArea.scrollLeft += e.deltaY; }
    }, { passive: false });
    container.appendChild(previewArea);

    // ── 模式切换栏 ──
    var modeBar = pg$el("div.pg-mode-bar");
    var modeLabel = pg$el("span.pg-mode-label", { textContent: "\u6A21\u5F0F:" });

    var scrapeBtn = pg$el("button.pg-btn.green.active", { textContent: "\u{1F310} \u6293\u53D6" });
    var apiSearchBtn = pg$el("button.pg-btn", { textContent: "\u{1F50D} API\u641C\u7D22" });
    var apiBoardsBtn = pg$el("button.pg-btn", { textContent: "\u{1F4F7} API Boards" });

    function setMode(newMode) {
        state.mode = newMode;
        scrapeBtn.classList.toggle("active", newMode === "scrape");
        apiSearchBtn.classList.toggle("active", newMode === "api_search");
        apiBoardsBtn.classList.toggle("active", newMode === "api_boards");
        updateSidebar(state);
        // 更新搜索框 placeholder
        if (state._searchInput) {
            if (newMode === "scrape") {
                state._searchInput.placeholder = "\u641C\u7D22\u5173\u952E\u8BCD\u6216\u7C98\u8D34 Pinterest URL...";
            } else {
                state._searchInput.placeholder = "\u641C\u7D22 Pinterest...";
            }
        }
    }

    scrapeBtn.onclick = function () { setMode("scrape"); };
    apiSearchBtn.onclick = function () { setMode("api_search"); };
    apiBoardsBtn.onclick = function () { setMode("api_boards"); if (state.boards.length === 0) loadBoards(state); };

    modeBar.append(modeLabel, scrapeBtn, apiSearchBtn, apiBoardsBtn);
    container.appendChild(modeBar);

    // ── 工具栏 ──
    var header = pg$el("div.pg-header");

    var searchInput = pg$el("input.pg-search", { type: "text", placeholder: "\u641C\u7D22\u5173\u952E\u8BCD\u6216\u7C98\u8D34 Pinterest URL..." });
    searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { state.bookmark = ""; doSearch(state); }
    });
    state._searchInput = searchInput;

    var searchBtn = pg$el("button.pg-btn.primary", { textContent: "\u{1F50D} \u641C\u7D22" });
    searchBtn.onclick = function () { state.bookmark = ""; doSearch(state); };

    // Board 下拉（API Boards 模式）
    var boardSelect = pg$el("select.pg-btn", { style: "min-width:120px;display:none" });
    boardSelect.appendChild(pg$el("option", { value: "", textContent: "\u9009\u62E9 Board..." }));
    boardSelect.addEventListener("change", function () {
        state.boardId = boardSelect.value;
        state.bookmark = "";
        if (state.boardId) loadBoardPins(state, state.boardId);
    });
    state._boardSelect = boardSelect;

    // 设置按钮
    var settingsBtn = pg$el("button.pg-btn", { textContent: "\u2699\uFE0F", title: "\u8BBE\u7F6E Access Token" });
    settingsBtn.onclick = function (e) {
        e.stopPropagation();
        openSettings(state);
    };

    header.append(searchInput, searchBtn, boardSelect, settingsBtn);
    container.appendChild(header);

    // ── 主体区域 ──
    var main = pg$el("div.pg-main");

    // Board 列表侧边栏（API Boards 模式）
    var sidebar = pg$el("div.pg-sidebar");
    sidebar.style.display = "none";
    sidebar.innerHTML = '<div class="pg-empty">\u767B\u5F55\u540E\u67E5\u770B Boards</div>';
    state._sidebar = sidebar;
    main.appendChild(sidebar);

    // Pin 网格
    var grid = pg$el("div.pg-grid");
    grid.innerHTML = '<div class="pg-empty">\u{1F310} \u6293\u53D6\u6A21\u5F0F\uFF1A\u8F93\u5165\u5173\u952E\u8BCD\u6216\u7C98\u8D34 Pinterest URL<br><br>\u{1F50D} API \u6A21\u5F0F\uFF1A\u9700\u8981\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E Access Token</div>';
    state._grid = grid;
    main.appendChild(grid);

    container.appendChild(main);

    // ── 页脚 ──
    var footer = pg$el("div.pg-footer");
    var loadMoreBtn = pg$el("button.pg-btn", { textContent: "\u{1F504} \u52A0\u8F7D\u66F4\u591A" });
    var pageInfo = pg$el("span.pg-pageinfo", { textContent: "" });
    loadMoreBtn.onclick = function () {
        doSearch(state);
    };
    state._loadMoreBtn = loadMoreBtn;
    state._pageInfo = pageInfo;
    footer.append(pageInfo, loadMoreBtn);
    container.appendChild(footer);

    // ── 设置弹窗 ──
    function openSettings(state) {
        var backdrop = document.querySelector(".pg-settings-backdrop");
        if (!backdrop) {
            backdrop = pg$el("div.pg-settings-backdrop", { onclick: function (e) { if (e.target === backdrop) backdrop.classList.remove("show"); } });
            var panel = pg$el("div.pg-settings-panel");
            panel.innerHTML = '<h3>Pinterest \u8BBE\u7F6E</h3>' +
                '<label>Access Token <span style="color:#666;font-size:10px">(\u4EC5 API \u6A21\u5F0F\u9700\u8981)</span></label>' +
                '<input type="text" id="pg-access-token" placeholder="\u7C98\u8D34 Pinterest Access Token">' +
                '<div class="pg-settings-hint">' +
                '\u83B7\u53D6\u65B9\u6CD5\uFF1Adevelopers.pinterest.com \u2192 Create app \u2192 \u751F\u6210 Token<br>' +
                '\u6293\u53D6\u6A21\u5F0F\u65E0\u9700 Token\uFF0C\u76F4\u63A5\u641C\u7D22\u6216\u7C98\u8D34 URL \u5373\u53EF' +
                '</div>' +
                '<div class="pg-settings-footer">' +
                '<a class="pg-settings-github" href="https://github.com/Yao3596/ComfyUI_Eagle_Suite" target="_blank" rel="noopener">' +
                '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> GitHub' +
                '</a>' +
                '<span class="pg-settings-author">Yao3596 / ComfyUI_Eagle_Suite</span>' +
                '</div>' +
                '<div class="pg-settings-row">' +
                '<button class="pg-btn" id="pg-settings-cancel">\u53D6\u6D88</button>' +
                '<button class="pg-btn primary" id="pg-settings-save">\u4FDD\u5B58</button>' +
                '</div>';
            backdrop.appendChild(panel);
            document.body.appendChild(backdrop);

            document.getElementById("pg-settings-cancel").onclick = function () { backdrop.classList.remove("show"); };
            document.getElementById("pg-settings-save").onclick = function () {
                var token = document.getElementById("pg-access-token").value.trim();
                if (token) localStorage.setItem("pinterest_access_token", token);
                else localStorage.removeItem("pinterest_access_token");
                // 同步到后端
                fetch("/pinterest_gallery/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ access_token: token }),
                }).catch(function () {});
                backdrop.classList.remove("show");
                if (token) checkAuthAndLoadBoards(state);
            };
        }
        var saved = localStorage.getItem("pinterest_access_token") || "";
        var input = backdrop.querySelector("#pg-access-token");
        if (input && saved) input.value = saved;
        if (input && !saved) {
            // 尝试从后端加载（脱敏的）
            fetch("/pinterest_gallery/settings")
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (d.success && d.settings && d.settings.access_token) {
                        input.placeholder = "\u5DF2\u4FDD\u5B58 Token\uFF08\u540E\u7AEF\uFF09";
                    }
                })
                .catch(function () {});
        }
        backdrop.classList.add("show");
    }
}

// ── 统一搜索入口 ────────────────────────────────────────────────────────────
function doSearch(state) {
    if (state.loading) return;

    var query = state._searchInput.value.trim();

    if (state.mode === "scrape") {
        scrapeSearch(state, query);
    } else if (state.mode === "api_search") {
        apiSearchPins(state, query);
    } else if (state.mode === "api_boards") {
        if (state.boardId) {
            loadBoardPins(state, state.boardId);
        } else {
            loadBoards(state);
        }
    }
}

// ── 抓取模式搜索 ────────────────────────────────────────────────────────────
async function scrapeSearch(state, query) {
    if (state.loading) return;
    if (!query) {
        state._grid.innerHTML = '<div class="pg-error">\u8BF7\u8F93\u5165\u641C\u7D22\u5173\u952E\u8BCD\u6216 Pinterest URL</div>';
        return;
    }
    state.loading = true;
    state._grid.innerHTML = '<div class="pg-loading">\u{1F310} \u6293\u53D6\u4E2D...</div>';

    try {
        var params = new URLSearchParams();
        // 判断是 URL 还是关键词
        if (/^https?:\/\//i.test(query)) {
            params.set("url", query);
        } else {
            params.set("q", query);
        }

        var res = await fetch("/pinterest_gallery/scrape?" + params.toString());
        var data = await res.json();

        if (data.success && data.items && data.items.length > 0) {
            state.results = data.items;
            state.total = data.total || data.items.length;
            state.bookmark = data.bookmark || "";
            renderGrid(state);
            updateFooter(state);
        } else {
            var errMsg = data.error || "\u672A\u627E\u5230\u56FE\u7247";
            state._grid.innerHTML = '<div class="pg-error">' + escapeHtml(errMsg) + '<br><br><span style="color:#888">\u63D0\u793A\uFF1A\u5C1D\u8BD5\u7C98\u8D34 Pinterest Board URL\uFF0C\u4F8B\u5982 https://pinterest.com/user/board</span></div>';
        }
    } catch (e) {
        state._grid.innerHTML = '<div class="pg-error">\u8BF7\u6C42\u5931\u8D25: ' + escapeHtml(e.message) + '</div>';
    } finally {
        state.loading = false;
    }
}

// ── API v5 搜索 ──────────────────────────────────────────────────────────────
async function apiSearchPins(state, query) {
    if (state.loading) return;
    state.loading = true;

    if (!state.bookmark) {
        state.results = [];
        state._grid.innerHTML = '<div class="pg-loading">\u{1F504} \u52A0\u8F7D\u4E2D...</div>';
    }

    try {
        var token = localStorage.getItem("pinterest_access_token") || "";
        if (!token) {
            state._grid.innerHTML = '<div class="pg-error">API \u6A21\u5F0F\u9700\u8981 Access Token\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E<br><br><span style="color:#888">\u6216\u5207\u6362\u5230\u6293\u53D6\u6A21\u5F0F\u65E0\u9700 Token</span></div>';
            return;
        }

        var params = new URLSearchParams({
            q: query || state._searchInput.value.trim(),
            page_size: String(PAGE_SIZE),
        });
        if (state.bookmark) params.set("bookmark", state.bookmark);
        if (token) params.set("token", token);

        var res = await fetch("/pinterest_gallery/search?" + params.toString());
        var data = await res.json();

        if (data.items) {
            if (!state.bookmark) state.results = [];
            state.results = state.results.concat(data.items);
            state.bookmark = data.bookmark || "";
            renderGrid(state);
            updateFooter(state);
        } else if (data.auth_error) {
            state._grid.innerHTML = '<div class="pg-error">Access Token \u65E0\u6548\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u66F4\u65B0</div>';
        } else {
            state._grid.innerHTML = '<div class="pg-error">\u641C\u7D22\u5931\u8D25: ' + (data.error || "\u672A\u77E5\u9519\u8BEF") + '</div>';
        }
    } catch (e) {
        state._grid.innerHTML = '<div class="pg-error">\u8BF7\u6C42\u5931\u8D25: ' + e.message + '</div>';
    } finally {
        state.loading = false;
    }

    updateSidebar(state);
}

// ── 辅助：获取缩略图 URL ──────────────────────────────────────────────────
function getPinThumbUrl(item) {
    // 抓取模式数据已有 thumb_url / image_url 字段
    if (item.thumb_url) return item.thumb_url;
    // API v5 格式: media.images.{size}.url
    var images = item?.media?.images;
    if (images) {
        return images["236x"]?.url || images["170x"]?.url || images["150x150"]?.url ||
               images["600x"]?.url || images["400x300"]?.url || "";
    }
    // API v5 images 字段
    if (item?.images && typeof item.images === "object") {
        for (var size of ["236x", "170x", "150x150"]) {
            if (item.images[size]?.url) return item.images[size].url;
        }
    }
    return "";
}

function getPinImageUrl(pin) {
    if (pin.image_url) return pin.image_url;
    var images = pin?.media?.images;
    if (!images) {
        images = pin?.images;
    }
    if (!images || typeof images !== "object") return "";
    return images["originals"]?.url || images["1200x"]?.url || images["736x"]?.url ||
           images["600x"]?.url || images["400x300"]?.url || "";
}

function getPinOriginalUrl(pin) {
    if (pin.image_url) return pin.image_url;
    var images = pin?.media?.images;
    if (!images) {
        images = pin?.images;
    }
    if (!images || typeof images !== "object") return "";
    return images["originals"]?.url || images["1200x"]?.url || images["736x"]?.url ||
           images["600x"]?.url || "";
}

// ── 检查 Token 并加载 Boards ──────────────────────────────────────────────
async function checkAuthAndLoadBoards(state) {
    var token = localStorage.getItem("pinterest_access_token") || "";
    if (!token) return;

    try {
        var res = await fetch("/pinterest_gallery/check_auth?token=" + encodeURIComponent(token));
        var data = await res.json();
        if (data.success && data.valid) {
            loadBoards(state);
        }
    } catch (e) {}
}

// ── 加载用户 Boards ──────────────────────────────────────────────────────
async function loadBoards(state) {
    var token = localStorage.getItem("pinterest_access_token") || "";
    if (!token) {
        state._sidebar.innerHTML = '<div class="pg-error">\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u8F93\u5165 Access Token</div>';
        return;
    }

    try {
        var res = await fetch("/pinterest_gallery/boards?token=" + encodeURIComponent(token));
        var data = await res.json();
        if (data.items) {
            state.boards = data.items;
            renderBoardList(state);
            populateBoardSelect(state);
        } else if (data.auth_error) {
            state._sidebar.innerHTML = '<div class="pg-error">Token \u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u8BBE\u7F6E</div>';
        }
    } catch (e) {
        state._sidebar.innerHTML = '<div class="pg-error">\u52A0\u8F7D Boards \u5931\u8D25</div>';
    }
}

function renderBoardList(state) {
    var sidebar = state._sidebar;
    sidebar.innerHTML = "";
    if (!state.boards.length) {
        sidebar.innerHTML = '<div class="pg-empty">\u65E0 Boards</div>';
        return;
    }
    state.boards.forEach(function (board) {
        var item = pg$el("div.pg-board-item", { textContent: board.name || "\u672A\u547D\u540D" });
        item.onclick = function () {
            sidebar.querySelectorAll(".pg-board-item.active").forEach(function (el) { el.classList.remove("active"); });
            item.classList.add("active");
            state.boardId = board.id;
            state.bookmark = "";
            if (state._boardSelect) state._boardSelect.value = board.id;
            loadBoardPins(state, board.id);
        };
        sidebar.appendChild(item);
    });
}

function populateBoardSelect(state) {
    var select = state._boardSelect;
    if (!select) return;
    while (select.children.length > 1) select.removeChild(select.lastChild);
    state.boards.forEach(function (b) {
        select.appendChild(pg$el("option", { value: b.id, textContent: b.name || "\u672A\u547D\u540D" }));
    });
}

function updateSidebar(state) {
    var showBoardSidebar = state.mode === "api_boards";
    if (state._sidebar) {
        state._sidebar.style.display = showBoardSidebar ? "block" : "none";
    }
    if (state._boardSelect) {
        state._boardSelect.style.display = showBoardSidebar ? "inline-block" : "none";
    }
}

// ── 加载 Board Pins (API) ──────────────────────────────────────────────────
async function loadBoardPins(state, boardId) {
    if (state.loading) return;
    state.loading = true;

    if (!state.bookmark) {
        state.results = [];
        state._grid.innerHTML = '<div class="pg-loading">\u{1F504} \u52A0\u8F7D\u4E2D...</div>';
    }

    try {
        var token = localStorage.getItem("pinterest_access_token") || "";
        var params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
        if (state.bookmark) params.set("bookmark", state.bookmark);
        if (token) params.set("token", token);

        var res = await fetch("/pinterest_gallery/boards/" + encodeURIComponent(boardId) + "/pins?" + params.toString());
        var data = await res.json();

        if (data.items) {
            if (!state.bookmark) state.results = [];
            state.results = state.results.concat(data.items);
            state.bookmark = data.bookmark || "";
            renderGrid(state);
            updateFooter(state);
        } else {
            state._grid.innerHTML = '<div class="pg-error">\u52A0\u8F7D\u5931\u8D25: ' + (data.error || "\u672A\u77E5\u9519\u8BEF") + '</div>';
        }
    } catch (e) {
        state._grid.innerHTML = '<div class="pg-error">\u8BF7\u6C42\u5931\u8D25: ' + e.message + '</div>';
    } finally {
        state.loading = false;
    }

    updateSidebar(state);
}

// ── 渲染网格 ─────────────────────────────────────────────────────────────────
function renderGrid(state) {
    var grid = state._grid;
    if (!state.bookmark) grid.innerHTML = "";

    if (!state.results.length) {
        grid.innerHTML = '<div class="pg-empty">\u6682\u65E0\u7ED3\u679C</div>';
        return;
    }

    state.results.forEach(function (item, index) {
        var pinId = item.id;
        var title = item.title || "";
        var thumbUrl = getPinThumbUrl(item);
        var origUrl = getPinOriginalUrl(item);
        var description = item.description || "";

        var card = pg$el("div.pg-thumb", { "data-id": pinId });
        if (state.selected.has(pinId)) card.classList.add("selected");

        // 使用缩略图 URL，性能更好
        var imgSrc = thumbUrl || origUrl || "";
        var img = pg$el("img", {
            src: imgSrc ? "/pinterest_gallery/image_proxy?url=" + encodeURIComponent(imgSrc) : "",
            loading: "lazy",
            alt: title,
        });
        img.onerror = function () { img.style.display = "none"; };

        var info = pg$el("div.pg-thumb-info", [
            pg$el("span", { textContent: title.length > 15 ? title.slice(0, 15) + "..." : title }),
        ]);

        if (title) {
            var titleBadge = pg$el("span.pg-thumb-title", { textContent: title });
            card.appendChild(titleBadge);
        }

        card.appendChild(img);
        card.appendChild(info);

        card.onclick = function () {
            if (state.selected.has(pinId)) {
                state.selected.delete(pinId);
                state.selectedItems = state.selectedItems.filter(function (s) { return s.id !== pinId; });
                card.classList.remove("selected");
            } else {
                state.selected.add(pinId);
                state.selectedItems.push({
                    id: pinId,
                    image_url: origUrl || thumbUrl || "",
                    thumb_url: thumbUrl || origUrl || "",
                    title: title,
                    description: description,
                    pin_id: pinId,
                    tags: title + (description ? ", " + description : ""),
                });
                card.classList.add("selected");
            }
            updatePreview(state);
            confirmSelection(state, state._node);
        };

        grid.appendChild(card);
    });
}

// ── 更新页脚 ─────────────────────────────────────────────────────────────────
function updateFooter(state) {
    state._pageInfo.textContent = "\u5DF2\u52A0\u8F7D " + state.results.length + " \u4E2A";
    state._loadMoreBtn.disabled = !state.bookmark;
    state._loadMoreBtn.textContent = state.bookmark ? "\u{1F504} \u52A0\u8F7D\u66F4\u591A" : "\u5DF2\u5230\u5E95";
}

// ── 更新预览条 ───────────────────────────────────────────────────────────────
function updatePreview(state) {
    var preview = state._previewArea;
    if (state.selectedItems.length === 0) {
        preview.innerHTML = '<div class="pg-preview-empty">\u9009\u4E2D\u56FE\u7247\u5C06\u663E\u793A\u5728\u8FD9\u91CC</div>';
        return;
    }
    preview.innerHTML = "";

    state.selectedItems.forEach(function (sel) {
        var thumbEl = pg$el("div.pg-preview-thumb");
        // 预览条使用缩略图，性能更好
        var previewUrl = sel.thumb_url || sel.image_url || "";
        var img = pg$el("img", {
            src: previewUrl ? "/pinterest_gallery/image_proxy?url=" + encodeURIComponent(previewUrl) : "",
            title: sel.title || "",
        });
        img.onerror = function () { img.style.display = "none"; };

        var delBtn = pg$el("div.pg-preview-del", { textContent: "\u00D7" });
        delBtn.onclick = function (e) {
            e.stopPropagation();
            state.selected.delete(sel.id);
            state.selectedItems = state.selectedItems.filter(function (s) { return s.id !== sel.id; });
            var gridCard = state._grid.querySelector('.pg-thumb[data-id="' + sel.id + '"]');
            if (gridCard) gridCard.classList.remove("selected");
            updatePreview(state);
            confirmSelection(state, state._node);
        };

        thumbEl.append(img, delBtn);
        preview.appendChild(thumbEl);
    });

    var clearBtn = pg$el("button.pg-btn", {
        textContent: "\u6E05\u9664",
        style: "flex-shrink:0;height:60px;align-self:center;margin-left:4px",
        title: "\u6E05\u9664\u5168\u90E8",
    });
    clearBtn.onclick = function (e) {
        e.stopPropagation();
        state.selected.clear();
        state.selectedItems = [];
        state._grid.querySelectorAll(".pg-thumb.selected").forEach(function (el) { el.classList.remove("selected"); });
        updatePreview(state);
        confirmSelection(state, state._node);
    };
    preview.appendChild(clearBtn);
}

// ── 确认选择并提交 ───────────────────────────────────────────────────────────
function confirmSelection(state, node) {
    var selections = state.selectedItems.slice();
    var selectionJson = JSON.stringify({ selections: selections });

    if (node) {
        // 同时写入 widget、input 和 _selection_data，确保后端多路径读取都能命中
        var widget = node.widgets ? node.widgets.find(function (w) { return w.name === "selection_data"; }) : null;
        if (widget) {
            widget.value = selectionJson;
        }

        var input = node.inputs ? node.inputs.find(function (inp) { return inp.name === "selection_data"; }) : null;
        if (input) {
            input.value = selectionJson;
        }

        node._selection_data = selectionJson;

        // 关键：POST 到服务端缓存，绕过 widget 序列化不可靠的问题
        try {
            fetch("/eagle_gallery/cache_selection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ node_id: node.id, selection_data: selectionJson }),
            }).catch(function () {});
        } catch (e) { /* 静默失败 */ }

        node.setDirtyCanvas(true, true);
        if (node.graph) node.graph.change();
    }
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────
function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
