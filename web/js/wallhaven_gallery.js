/**
 * Wallhaven Gallery - 完整版
 */
import { app } from "../../../scripts/app.js";

const PAGE_SIZE = 24;

function whg$el(tag, attrs, children) {
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

function createDropdown(labelText, options, stateKey, state, onChange) {
    const wrap = whg$el("div.whg-dropdown");
    const btn = whg$el("button.whg-btn", { textContent: labelText + " \u25BC" });
    const menu = whg$el("div.whg-dropdown-menu");

    options.forEach(function (opt) {
        const item = whg$el("div.whg-dropdown-item");
        const label = whg$el("label");
        const cb = whg$el("input", { type: "checkbox" });
        if (state[stateKey].includes(opt.value)) cb.checked = true;
        cb.addEventListener("change", function () {
            if (cb.checked) {
                if (!state[stateKey].includes(opt.value)) state[stateKey].push(opt.value);
            } else {
                state[stateKey] = state[stateKey].filter(function (v) { return v !== opt.value; });
            }
            onChange();
        });
        label.append(cb, opt.label);
        item.appendChild(label);
        menu.appendChild(item);
    });

    btn.addEventListener("click", function (e) {
        e.stopPropagation();
        document.querySelectorAll(".whg-dropdown-menu").forEach(function (m) { m.classList.remove("show"); });
        menu.classList.add("show");
    });

    wrap.append(btn, menu);
    return wrap;
}

const CSS = `
.whg-container{display:flex;flex-direction:column;width:100%;height:100%;background:#1a1a1e;font-size:12px;color:#ddd;box-sizing:border-box;font-family:sans-serif;overflow:hidden}
.whg-preview{display:flex;gap:6px;padding:8px 10px;background:#1e1e22;border-bottom:1px solid #333;min-height:70px;max-height:90px;overflow-x:auto;overflow-y:hidden;flex-shrink:0}
.whg-preview::-webkit-scrollbar{height:4px}
.whg-preview::-webkit-scrollbar-thumb{background:#444;border-radius:2px}
.whg-preview-thumb{flex-shrink:0;width:80px;height:60px;border-radius:4px;overflow:hidden;border:1px solid #444;position:relative;background:#25252a}
.whg-preview-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.whg-preview-empty{color:#666;font-size:11px;display:flex;align-items:center;justify-content:center;width:100%}
.whg-header{padding:6px 10px;background:#25252a;border-bottom:1px solid #333;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.whg-search{flex:1;min-width:100px;padding:4px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;outline:none}
.whg-search:focus{border-color:#5a8fe0}
.whg-btn{padding:4px 10px;background:#333;border:1px solid #444;border-radius:4px;color:#ddd;font-size:11px;cursor:pointer;white-space:nowrap}
.whg-btn:hover{background:#3a3a40}
.whg-btn.primary{background:#4a7de0;border-color:#4a7de0;color:#fff}
.whg-btn.primary:hover{background:#5a8fe0}
.whg-btn.active{background:#2a4a8a;border-color:#4a7de0}
.whg-dropdown{position:relative;display:inline-block}
.whg-dropdown-menu{display:none;position:absolute;top:100%;left:0;z-index:1000;background:#2a2a30;border:1px solid #444;border-radius:4px;padding:5px 0;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,.5)}
.whg-dropdown-menu.show{display:block}
.whg-dropdown-item{padding:5px 12px;cursor:pointer;font-size:11px;color:#ccc;white-space:nowrap}
.whg-dropdown-item:hover{background:#3a3a45}
.whg-dropdown-item label{display:flex;align-items:center;gap:5px;cursor:pointer}
.whg-dropdown-item input{margin:0}
.whg-grid{flex:1;overflow-y:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-auto-rows:100px;gap:8px;align-content:start}
.whg-grid::-webkit-scrollbar{width:6px}
.whg-grid::-webkit-scrollbar-track{background:transparent}
.whg-grid::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
.whg-thumb{position:relative;background:#222;border-radius:4px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color .15s,transform .1s;height:100px}
.whg-thumb:hover{border-color:#5a8fe0;transform:translateY(-1px)}
.whg-thumb.selected{border-color:#4a7de0;box-shadow:0 0 0 1px #4a7de0}
.whg-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.whg-thumb-info{position:absolute;bottom:0;left:0;right:0;padding:3px 6px;background:linear-gradient(transparent,rgba(0,0,0,.85));font-size:10px;color:#aaa;display:flex;justify-content:space-between}
.whg-thumb-purity{position:absolute;top:3px;right:3px;padding:1px 4px;border-radius:2px;font-size:9px;font-weight:600}
.p-sfw{background:#1a5e1a;color:#7f7}
.p-sketchy{background:#5e4a10;color:#fc0}
.p-nsfw{background:#5e1a1a;color:#f88}
.whg-footer{padding:5px 10px;background:#25252a;border-top:1px solid #333;display:flex;align-items:center;gap:8px;flex-shrink:0}
.whg-pageinfo{flex:1;text-align:center;color:#888;font-size:11px}
.whg-empty{text-align:center;padding:40px;color:#666;font-size:13px}
.whg-loading{text-align:center;padding:40px;color:#888}
.whg-error{text-align:center;padding:40px;color:#e66}
.whg-select-bar{padding:5px 10px;background:rgba(74,125,224,.15);border-top:1px solid rgba(74,125,224,.3);display:flex;align-items:center;gap:10px;font-size:11px;flex-shrink:0}
.whg-select-bar button{padding:3px 10px;background:#4a7de0;border:none;border-radius:4px;color:#fff;font-size:11px;cursor:pointer}
.whg-select-bar button:hover{background:#5a8fe0}
.whg-settings-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;align-items:center;justify-content:center}
.whg-settings-backdrop.show{display:flex}
.whg-settings-panel{background:#25252a;border:1px solid #444;border-radius:8px;padding:20px;width:360px;box-shadow:0 8px 24px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:12px}
.whg-settings-panel h3{margin:0 0 4px;color:#eee;font-size:14px}
.whg-settings-panel label{display:block;margin-bottom:4px;color:#aaa;font-size:12px}
.whg-settings-panel input{width:100%;padding:6px 8px;background:#1e1e22;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;box-sizing:border-box}
.whg-settings-panel input:focus{border-color:#5a8fe0;outline:none}
.whg-settings-hint{color:#888;font-size:11px;margin-top:4px;line-height:1.4}
.whg-settings-hint a{color:#6a9de0;text-decoration:none}
.whg-settings-hint a:hover{text-decoration:underline}
.whg-settings-footer{margin-top:8px;padding-top:12px;border-top:1px solid #333;display:flex;align-items:center;justify-content:space-between;gap:8px}
.whg-settings-github{display:inline-flex;align-items:center;gap:6px;color:#aaa;font-size:12px;text-decoration:none;padding:5px 10px;background:#1e1e22;border:1px solid #333;border-radius:4px;transition:.15s}
.whg-settings-github:hover{color:#eee;border-color:#555}
.whg-settings-author{color:#666;font-size:11px}
.whg-settings-panel .whg-settings-row{display:flex;gap:8px;justify-content:flex-end}
select.whg-btn{-webkit-appearance:none;-moz-appearance:none;appearance:none;background:#333 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath fill='%23aaa' d='M0 0h8L4 4z'/%3E%3C/svg%3E") no-repeat right 8px center;padding-right:22px}
.whg-color-swatch{width:14px;height:14px;border-radius:3px;border:1px solid #555;display:inline-block;flex-shrink:0;background:transparent}
.whg-preview-del{position:absolute;top:2px;right:2px;width:16px;height:16px;background:rgba(0,0,0,.7);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s;z-index:2}
.whg-preview-thumb:hover .whg-preview-del{opacity:1}
.whg-preview-del:hover{background:rgba(200,0,0,.8)}
`;

app.registerExtension({
    name: "EagleSuite.WallhavenGallery",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "WallhavenGalleryNode") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            this.setSize([900, 720]);

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

            if (!document.getElementById("whg-style")) {
                document.head.appendChild(whg$el("style", { id: "whg-style", textContent: CSS }));
            }

            const state = {
                query: "",
                categories: ["general", "anime", "people"],
                purities: ["sfw"],
                sorting: "date_added",
                order: "desc",
                page: 1,
                results: [],
                total: 0,
                loading: false,
                selected: new Set(),
                selectedItems: [],   // 完整选中数据列表，不依赖 state.results
            };

            const container = whg$el("div.whg-container");
            buildUI(container, state, this);
            this.addDOMWidget("wallhaven_gallery", "div", container, { serialize: false });

            setTimeout(function () { search(state, container); }, 100);
        };
    },
});

function buildUI(container, state, node) {
    state._node = node;
    var previewArea = whg$el("div.whg-preview");
    previewArea.innerHTML = '<div class="whg-preview-empty">\u9009\u4E2D\u56FE\u7247\u5C06\u663E\u793A\u5728\u8FD9\u91CC</div>';
    state._previewArea = previewArea;
    // 鼠标滚轮横向滚动
    previewArea.addEventListener("wheel", function (e) {
        if (e.deltaY !== 0) {
            e.preventDefault();
            previewArea.scrollLeft += e.deltaY;
        }
    }, { passive: false });
    container.appendChild(previewArea);

    var header = whg$el("div.whg-header");

    var searchInput = whg$el("input.whg-search", { type: "text", placeholder: "\u641C\u7D22\u5173\u952E\u8BCD..." });
    searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { state.page = 1; search(state, container); }
    });
    state._searchInput = searchInput;

    var searchBtn = whg$el("button.whg-btn.primary", { textContent: "\u{1F50D} \u641C\u7D22" });
    searchBtn.onclick = function () { state.page = 1; search(state, container); };

    var catDropdown = createDropdown("\u5206\u7C7B", [
        { label: "General", value: "general" },
        { label: "Anime", value: "anime" },
        { label: "People", value: "people" },
    ], "categories", state, function () { state.page = 1; search(state, container); });

    var purityDropdown = createDropdown("\u7EAF\u5EA6", [
        { label: "SFW", value: "sfw" },
        { label: "Sketchy", value: "sketchy" },
        { label: "NSFW", value: "nsfw" },
    ], "purities", state, function () { state.page = 1; search(state, container); });

    // 排序下拉选择器（单选）
    var sortLabel = whg$el("span", { textContent: "\u6392\u5E8F:", style: "font-size:11px;color:#aaa;margin-right:4px" });
    var sortSelect = whg$el("select.whg-btn", { style: "min-width:80px" });
    var sortModes = [
        { key: "date_added", label: "\u6700\u65B0" },
        { key: "relevance", label: "\u76F8\u5173" },
        { key: "random", label: "\u968F\u673A" },
        { key: "views", label: "\u70ED\u95E8" },
        { key: "favorites", label: "\u6536\u85CF" },
        { key: "toplist", label: "\u699C\u5355" },
    ];
    sortModes.forEach(function(m) {
        var opt = whg$el("option", { value: m.key, textContent: m.label });
        sortSelect.appendChild(opt);
    });
    sortSelect.addEventListener("change", function() {
        state.sorting = sortSelect.value;
        // 切换到 toplist 时自动设置时间范围
        if (state.sorting === "toplist" && !state.topRange) {
            state.topRange = "1M";
        }
        state.page = 1;
        search(state, container);
    });
    state._sortSelect = sortSelect;

    var settingsBtn = whg$el("button.whg-btn", { textContent: "\u2699\uFE0F", title: "\u8BBE\u7F6E" });
    settingsBtn.onclick = function (e) {
        e.stopPropagation();
        openSettings();
    };

    // 高级筛选按钮
    var advancedBtn = whg$el("button.whg-btn", { textContent: "\u270F\uFE0F \u7B5B\u9009", title: "\u9AD8\u7EA7\u7B5B\u9009" });
    var advancedVisible = false;
    var advancedRow = null;
    advancedBtn.onclick = function (e) {
        e.stopPropagation();
        advancedVisible = !advancedVisible;
        if (advancedVisible) {
            if (!advancedRow) buildAdvancedFilters(state, container);
            advancedRow.style.display = "flex";
            advancedBtn.classList.add("active");
        } else {
            if (advancedRow) advancedRow.style.display = "none";
            advancedBtn.classList.remove("active");
        }
    };

    header.append(searchInput, searchBtn, catDropdown, purityDropdown, sortLabel, sortSelect, advancedBtn, settingsBtn);
    container.appendChild(header);

    function buildAdvancedFilters(state, container) {
        advancedRow = whg$el("div.whg-header", { style: "display:none;padding-top:4px" });

        // 颜色筛选 - 完整 36 色（API 原色值，无 # 号）
        var colorLabel = whg$el("span", { textContent: "\u989C\u8272:", style: "font-size:11px;color:#aaa;margin-right:4px" });
        var colorSwatch = whg$el("span.whg-color-swatch");
        var colorSelect = whg$el("select.whg-btn", { style: "min-width:80px" });
        var colors = [
            { value: "", label: "\u5168\u90E8" },
            { value: "660000", label: "\u6D45\u7EA2" },
            { value: "990000", label: "\u7EA2" },
            { value: "cc0000", label: "\u8D63\u7EA2" },
            { value: "cc3333", label: "\u6D45\u7C89" },
            { value: "ea4c88", label: "\u7C89\u7D2B" },
            { value: "993399", label: "\u7D2B\u7D2B" },
            { value: "663399", label: "\u6DF1\u7D2B" },
            { value: "333399", label: "\u85AF\u7D2B" },
            { value: "0066cc", label: "\u7EBD\u84DD" },
            { value: "0099cc", label: "\u5929\u84DD" },
            { value: "66cccc", label: "\u6D45\u84DD" },
            { value: "77cc33", label: "\u8349\u7EFF" },
            { value: "669900", label: "\u6A59\u7EFF" },
            { value: "336600", label: "\u6DF1\u7EFF" },
            { value: "666600", label: "\u6A59\u7EFF" },
            { value: "999900", label: "\u6A59\u9EC4" },
            { value: "cccc33", label: "\u9EC4\u7EFF" },
            { value: "ffff00", label: "\u9EC4" },
            { value: "ffcc33", label: "\u6D45\u9EC4" },
            { value: "ff9900", label: "\u6A59" },
            { value: "ff6600", label: "\u6DF1\u6A59" },
            { value: "cc6633", label: "\u68D5\u6A59" },
            { value: "996633", label: "\u68D5" },
            { value: "663300", label: "\u6DF1\u68D5" },
            { value: "000000", label: "\u9ED1" },
            { value: "999999", label: "\u7070" },
            { value: "cccccc", label: "\u94C1\u7070" },
            { value: "ffffff", label: "\u767D" },
            { value: "424153", label: "\u84DD\u7070" },
        ];
        colors.forEach(function(c) {
            var opt = whg$el("option", { value: c.value, textContent: c.label });
            colorSelect.appendChild(opt);
        });
        function updateColorSwatch() {
            var val = colorSelect.value;
            if (val) colorSwatch.style.backgroundColor = "#" + val;
            else colorSwatch.style.backgroundColor = "transparent";
        }
        colorSelect.addEventListener("change", function() {
            state.color = colorSelect.value;
            updateColorSwatch();
            state.page = 1;
            search(state, container);
        });
        updateColorSwatch();
        state._colorSelect = colorSelect;

        // 尺寸比例筛选
        var ratioLabel = whg$el("span", { textContent: "\u6BD4\u4F8B:", style: "font-size:11px;color:#aaa;margin-right:4px" });
        var ratioSelect = whg$el("select.whg-btn", { style: "min-width:80px" });
        var ratios = [
            { value: "", label: "\u5168\u90E8" },
            { value: "16x9", label: "16:9" },
            { value: "16x10", label: "16:10" },
            { value: "21x9", label: "21:9" },
            { value: "1x1", label: "1:1" },
            { value: "9x16", label: "9:16" },
            { value: "4x3", label: "4:3" },
            { value: "3x2", label: "3:2" },
        ];
        ratios.forEach(function(r) {
            var opt = whg$el("option", { value: r.value, textContent: r.label });
            ratioSelect.appendChild(opt);
        });
        ratioSelect.addEventListener("change", function() {
            state.ratio = ratioSelect.value;
            state.page = 1;
            search(state, container);
        });
        state._ratioSelect = ratioSelect;

        // 最小分辨率筛选
        var atleastLabel = whg$el("span", { textContent: "\u6700\u4F4E:", style: "font-size:11px;color:#aaa;margin-right:4px" });
        var atleastSelect = whg$el("select.whg-btn", { style: "min-width:100px" });
        var atleastOptions = [
            { value: "", label: "\u65E0" },
            { value: "1920x1080", label: "1080p" },
            { value: "2560x1440", label: "1440p" },
            { value: "3840x2160", label: "4K" },
            { value: "5120x2880", label: "5K" },
            { value: "7680x4320", label: "8K" },
        ];
        atleastOptions.forEach(function(a) {
            var opt = whg$el("option", { value: a.value, textContent: a.label });
            atleastSelect.appendChild(opt);
        });
        atleastSelect.addEventListener("change", function() {
            state.atleast = atleastSelect.value;
            state.page = 1;
            search(state, container);
        });
        state._atleastSelect = atleastSelect;

        // 精确分辨率筛选（支持多选）
        var resLabel = whg$el("span", { textContent: "\u5206\u8FA8\u7387:", style: "font-size:11px;color:#aaa;margin-right:4px" });
        var resSelect = whg$el("select.whg-btn", { style: "min-width:100px" });
        var resOptions = [
            { value: "", label: "\u65E0" },
            { value: "1920x1080", label: "1920x1080" },
            { value: "1920x1200", label: "1920x1200" },
            { value: "2560x1440", label: "2560x1440" },
            { value: "2560x1600", label: "2560x1600" },
            { value: "3840x2160", label: "3840x2160" },
            { value: "3840x2400", label: "3840x2400" },
        ];
        resOptions.forEach(function(r) {
            var opt = whg$el("option", { value: r.value, textContent: r.label });
            resSelect.appendChild(opt);
        });
        resSelect.addEventListener("change", function() {
            state.resolutions = resSelect.value;
            state.page = 1;
            search(state, container);
        });
        state._resSelect = resSelect;

        // 热门时间范围（仅 toplist 排序时生效）
        var topRangeLabel = whg$el("span", { textContent: "\u699C\u5355:", style: "font-size:11px;color:#aaa;margin-right:4px" });
        var topRangeSelect = whg$el("select.whg-btn", { style: "min-width:80px" });
        var topRanges = [
            { value: "1d", label: "1\u5929" },
            { value: "3d", label: "3\u5929" },
            { value: "1w", label: "1\u5468" },
            { value: "1M", label: "1\u6708" },
            { value: "3M", label: "3\u6708" },
            { value: "6M", label: "6\u6708" },
            { value: "1y", label: "1\u5E74" },
        ];
        topRanges.forEach(function(r) {
            var opt = whg$el("option", { value: r.value, textContent: r.label });
            topRangeSelect.appendChild(opt);
        });
        topRangeSelect.value = state.topRange || "1M";
        topRangeSelect.addEventListener("change", function() {
            state.topRange = topRangeSelect.value;
            state.page = 1;
            search(state, container);
        });
        state._topRangeSelect = topRangeSelect;

        advancedRow.append(colorLabel, colorSwatch, colorSelect, ratioLabel, ratioSelect, atleastLabel, atleastSelect, resLabel, resSelect, topRangeLabel, topRangeSelect);
        container.appendChild(advancedRow);
    }

    var grid = whg$el("div.whg-grid");
    grid.innerHTML = '<div class="whg-empty">\u8F93\u5165\u5173\u952E\u8BCD\u70B9\u51FB\u641C\u7D22</div>';
    state._grid = grid;
    container.appendChild(grid);


    var footer = whg$el("div.whg-footer");
    var prevBtn = whg$el("button.whg-btn", { textContent: "\u25C0 \u4E0A\u4E00\u9875" });
    var nextBtn = whg$el("button.whg-btn", { textContent: "\u4E0B\u4E00\u9875 \u25B6" });
    var pageInfo = whg$el("span.whg-pageinfo", { textContent: "\u5C31\u7EEA" });
    prevBtn.onclick = function () { if (state.page > 1) { state.page--; search(state, container); } };
    nextBtn.onclick = function () { state.page++; search(state, container); };
    state._pageInfo = pageInfo;
    state._prevBtn = prevBtn;
    state._nextBtn = nextBtn;
    footer.append(prevBtn, pageInfo, nextBtn);
    container.appendChild(footer);

    function openSettings() {
        var backdrop = document.querySelector(".whg-settings-backdrop");
        if (!backdrop) {
            backdrop = whg$el("div.whg-settings-backdrop", { onclick: function (e) { if (e.target === backdrop) backdrop.classList.remove("show"); } });
            var panel = whg$el("div.whg-settings-panel");
            panel.innerHTML = '<h3>\u8BBE\u7F6E</h3>' +
                '<label>Wallhaven API Key</label>' +
                '<input type="text" id="whg-api-key" placeholder="\u53EF\u9009\uFF0C\u7528\u4E8E NSFW \u548C\u9AD8\u7EA7\u641C\u7D22">' +
                '<div class="whg-settings-hint">在 <a href="https://wallhaven.cc/settings/account" target="_blank" rel="noopener">wallhaven.cc/settings/account</a> 获取 API Key</div>' +
                '<div class="whg-settings-footer">' +
                '<a class="whg-settings-github" href="https://github.com/Yao3596/ComfyUI_Eagle_Suite" target="_blank" rel="noopener">' +
                '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> GitHub' +
                '</a>' +
                '<span class="whg-settings-author">Yao3596 / ComfyUI_Eagle_Suite</span>' +
                '</div>' +
                '<div class="whg-settings-row">' +
                '<button class="whg-btn" id="whg-settings-cancel">\u53D6\u6D88</button>' +
                '<button class="whg-btn primary" id="whg-settings-save">\u4FDD\u5B58</button>' +
                '</div>';
            backdrop.appendChild(panel);
            document.body.appendChild(backdrop);

            document.getElementById("whg-settings-cancel").onclick = function () { backdrop.classList.remove("show"); };
            document.getElementById("whg-settings-save").onclick = function () {
                var key = document.getElementById("whg-api-key").value.trim();
                if (key) localStorage.setItem("wallhaven_api_key", key);
                else localStorage.removeItem("wallhaven_api_key");
                // 同步到后端设置文件
                fetch("/wallhaven_gallery/settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ api_key: key }),
                }).catch(function () {});
                backdrop.classList.remove("show");
            };
        }
        var saved = localStorage.getItem("wallhaven_api_key") || "";
        var input = backdrop.querySelector("#whg-api-key");
        if (input && !saved) {
            // localStorage 为空时，从后端设置加载
            fetch("/wallhaven_gallery/settings")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success && data.settings && data.settings.api_key) {
                        // 后端返回的是脱敏 key (前4位+****)，无法恢复原始值
                        // 只在后端有 key 且前端没有时提示用户
                        if (!input.value) input.placeholder = "已保存 API Key（后端）";
                    }
                })
                .catch(function () {});
        }
        if (input && saved) input.value = saved;
        backdrop.classList.add("show");
    }
}

document.addEventListener("click", function () {
    document.querySelectorAll(".whg-dropdown-menu").forEach(function (m) { m.classList.remove("show"); });
});

async function search(state, container) {
    if (state.loading) return;
    state.loading = true;
    state._grid.innerHTML = '<div class="whg-loading">\u{1F504} \u52A0\u8F7D\u4E2D...</div>';

    try {
        var params = new URLSearchParams({
            q: state._searchInput.value.trim(),
            categories: ["general", "anime", "people"].map(function (k) { return state.categories.includes(k) ? "1" : "0"; }).join(""),
            purity: ["sfw", "sketchy", "nsfw"].map(function (k) { return state.purities.includes(k) ? "1" : "0"; }).join(""),
            sorting: state.sorting,
            order: state.order,
            page: state.page,
        });

        // 添加高级筛选参数
        if (state.color) params.set("colors", state.color);
        if (state.ratio) params.set("ratios", state.ratio);
        if (state.atleast) params.set("atleast", state.atleast);
        if (state.resolutions) params.set("resolutions", state.resolutions);
        if (state.sorting === "toplist" && state.topRange) params.set("topRange", state.topRange);

        var apiKey = localStorage.getItem("wallhaven_api_key");

        var res = await fetch("/wallhaven_gallery/search?" + params.toString(), {
            headers: apiKey ? { "X-API-Key": apiKey } : {},
        });
        var data = await res.json();

        if (data.data) {
            state.results = data.data;
            state.total = data.meta ? (data.meta.total || 0) : 0;
            renderGrid(state);
            updateFooter(state);
        } else {
            state._grid.innerHTML = '<div class="whg-error">\u641C\u7D22\u5931\u8D25: ' + (data.error || "\u672A\u77E5\u9519\u8BEF") + '</div>';
        }
    } catch (e) {
        state._grid.innerHTML = '<div class="whg-error">\u8BF7\u6C42\u5931\u8D25: ' + e.message + '</div>';
    } finally {
        state.loading = false;
    }
}

function renderGrid(state) {
    var grid = state._grid;
    grid.innerHTML = "";

    if (!state.results.length) {
        grid.innerHTML = '<div class="whg-empty">\u6682\u65E0\u7ED3\u679C</div>';
        return;
    }

    state.results.forEach(function (item) {
        var thumb = (item.thumbs && item.thumbs.small) || (item.thumbs && item.thumbs.original) || "";
        var purity = item.purity || "sfw";
        var pClass = purity === "sfw" ? "p-sfw" : purity === "sketchy" ? "p-sketchy" : "p-nsfw";

        var card = whg$el("div.whg-thumb", { "data-id": item.id });
        if (state.selected.has(item.id)) card.classList.add("selected");

        var img = whg$el("img", { src: "/wallhaven_gallery/image_proxy?url=" + encodeURIComponent(thumb), loading: "lazy" });
        img.onerror = function () { img.style.display = "none"; };

        var info = whg$el("div.whg-thumb-info", [
            whg$el("span", { textContent: item.resolution || "" }),
            whg$el("span", { textContent: "\u2665 " + (item.favorites || 0) }),
        ]);

        var badge = whg$el("span.whg-thumb-purity." + pClass, { textContent: purity.toUpperCase() });

        card.append(img, info, badge);

        card.onclick = function () {
            if (state.selected.has(item.id)) {
                state.selected.delete(item.id);
                state.selectedItems = state.selectedItems.filter(function (s) { return s.id !== item.id; });
                card.classList.remove("selected");
            } else {
                state.selected.add(item.id);
                state.selectedItems.push({
                    id: item.id,
                    image_url: item.path,
                    thumb_url: (item.thumbs && item.thumbs.small) || (item.thumbs && item.thumbs.original) || "",
                    tags: (item.tags || []).map(function (t) { return t.name; }).join(", "),
                    wallpaper_id: item.id,
                    resolution: item.resolution,
                });
                card.classList.add("selected");
            }
            updatePreview(state);
            confirmSelection(state, state._node);
        };

        grid.appendChild(card);
    });
}

function updateFooter(state) {
    var totalPages = Math.ceil(state.total / PAGE_SIZE) || 1;
    state._pageInfo.textContent = "\u7B2C " + state.page + " / " + totalPages + " \u9875 (\u5171 " + state.total + " \u5F20)";
    state._prevBtn.disabled = state.page <= 1;
    state._nextBtn.disabled = state.page >= totalPages;
}

function updatePreview(state) {
    var preview = state._previewArea;
    if (state.selectedItems.length === 0) {
        preview.innerHTML = '<div class="whg-preview-empty">\u9009\u4E2D\u56FE\u7247\u5C06\u663E\u793A\u5728\u8FD9\u91CC</div>';
        return;
    }
    preview.innerHTML = "";
    // 遍历完整选中列表，不依赖 state.results（修复翻页后预览丢失）
    state.selectedItems.forEach(function (sel) {
        var thumbEl = whg$el("div.whg-preview-thumb");
        // 优先使用缩略图 URL（性能），fallback 到原图 URL
        var previewUrl = sel.thumb_url || sel.image_url || "";
        var img = whg$el("img", {
            src: previewUrl ? "/wallhaven_gallery/image_proxy?url=" + encodeURIComponent(previewUrl) : "",
            alt: sel.wallpaper_id || "",
        });
        img.onerror = function () { img.style.display = "none"; };

        var delBtn = whg$el("div.whg-preview-del", { textContent: "\u00D7" });
        delBtn.onclick = function (e) {
            e.stopPropagation();
            state.selected.delete(sel.id);
            state.selectedItems = state.selectedItems.filter(function (s) { return s.id !== sel.id; });
            var gridCard = state._grid.querySelector('.whg-thumb[data-id="' + sel.id + '"]');
            if (gridCard) gridCard.classList.remove("selected");
            updatePreview(state);
            confirmSelection(state, state._node);
        };

        thumbEl.append(img, delBtn);
        preview.appendChild(thumbEl);
    });

    var clearBtn = whg$el("button.whg-btn", {
        textContent: "\u6E05\u9664",
        style: "flex-shrink:0;height:60px;align-self:center;margin-left:4px",
        title: "\u6E05\u9664\u5168\u90E8"
    });
    clearBtn.onclick = function (e) {
        e.stopPropagation();
        clearSelection(state);
        confirmSelection(state, state._node);
    };
    preview.appendChild(clearBtn);
}

function clearSelection(state) {
    state.selected.clear();
    state.selectedItems = [];
    document.querySelectorAll(".whg-thumb.selected").forEach(function (el) { el.classList.remove("selected"); });
    updatePreview(state);
}

function confirmSelection(state, node) {
    // 遍历完整选中列表，不依赖 state.results（修复翻页后数据丢失）
    var selections = state.selectedItems.slice();

    var selectionJson = JSON.stringify({ selections: selections });

    if (node) {
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
