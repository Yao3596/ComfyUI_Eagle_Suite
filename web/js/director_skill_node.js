import { app } from "../../../scripts/app.js";
import { createApp, h, ref, reactive, computed, onMounted, watch } from "../lib/vue.esm-browser.js";

console.log("[Eagle Suite] director_skill_node.js module loaded", new Date().toISOString());

// ──────────────────────────────────────────────────────────────
// 导演技能库节点：从提示词预设剥离出的独立节点。
// 复用 /eaglePromptPresets/director_skills 后端存储（共享同一技能库）。
// 选中/编辑的技能内容实时写入 director_skill 输出端口，供 H3 导演台等连线使用。
// ──────────────────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return "";
  var html = String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, function (_, code) { return '<pre class="pp-md-code">' + code.trim() + "</pre>"; })
    .replace(/`([^`]+)`/g, "<code class='pp-md-icode'>$1</code>")
    .replace(/^### (.+)$/gm, "<h4 class='pp-md-h'>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3 class='pp-md-h'>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2 class='pp-md-h'>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^&gt; (.+)$/gm, "<blockquote class='pp-md-quote'>$1</blockquote>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href='$2' target='_blank' rel='noopener'>$1</a>")
    .replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");
  return html;
}

function loadStyles() {
  if (document.getElementById("eagle-director-skill-style")) return;
  var style = document.createElement("style");
  style.id = "eagle-director-skill-style";
  style.textContent = `
    .eagle-director-skill-root { background:#1e1e1e; color:#d4d4d4; font-size:13px; }
    .eagle-director-skill-root .ppui-toolbar {
      display:flex; align-items:center; gap:6px; padding:8px 10px;
      background:#252526; border-bottom:1px solid #3a3a3a; flex-shrink:0;
    }
    .eagle-director-skill-root .ppui-btn {
      background:#333; color:#d4d4d4; border:1px solid #444; border-radius:4px;
      padding:4px 10px; cursor:pointer; font-size:12px;
    }
    .eagle-director-skill-root .ppui-btn:hover { background:#3c3c3c; }
    .eagle-director-skill-root .ppui-btn.primary { background:#2f6fd1; border-color:#2f6fd1; color:#fff; }
    .eagle-director-skill-root .ppui-btn.primary:hover { background:#3a7ee0; }
    .eagle-director-skill-root .ppui-btn-sm { padding:3px 8px; }
    .eagle-director-skill-root .pp-director-layout { display:flex; min-height:0; flex:1 1 auto; }
    .eagle-director-skill-root .pp-director-sidebar {
      width:230px; flex-shrink:0; border-right:1px solid #3a3a3a; overflow-y:auto;
      background:#232323; padding:8px;
    }
    .eagle-director-skill-root .pp-sidebar-head {
      display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;
    }
    .eagle-director-skill-root .pp-skills-list { display:flex; flex-direction:column; gap:6px; }
    .eagle-director-skill-root .pp-skill-item {
      text-align:left; background:#2c2c2c; color:#d4d4d4; border:1px solid #3a3a3a;
      border-radius:6px; padding:8px 10px; cursor:pointer;
    }
    .eagle-director-skill-root .pp-skill-item:hover { background:#343434; }
    .eagle-director-skill-root .pp-skill-item.active { border-color:#2f6fd1; background:#29384d; }
    .eagle-director-skill-root .pp-skill-name { font-weight:600; }
    .eagle-director-skill-root .pp-skill-meta { color:#8a8a8a; font-size:11px; margin-top:2px; }
    .eagle-director-skill-root .pp-director-main { flex:1 1 auto; min-width:0; overflow-y:auto; padding:12px; }
    .eagle-director-skill-root .pp-director-section { margin-bottom:14px; }
    .eagle-director-skill-root .pp-director-section > label { display:block; margin-bottom:6px; color:#aaa; font-size:12px; }
    .eagle-director-skill-root .pp-director-editor {
      width:100%; min-height:280px; resize:vertical; font-family:monospace;
      background:#1a1a1a; color:#d4d4d4; border:1px solid #3a3a3a; border-radius:6px; padding:8px;
    }
    .eagle-director-skill-root .pp-filmstrip-grid {
      display:flex; flex-wrap:wrap; gap:8px; min-height:60px; padding:8px;
      border:1px dashed #444; border-radius:6px;
    }
    .eagle-director-skill-root .pp-filmstrip-item { position:relative; }
    .eagle-director-skill-root .pp-filmstrip-item img {
      width:88px; height:88px; object-fit:cover; border-radius:6px; display:block;
    }
    .eagle-director-skill-root .pp-filmstrip-remove {
      position:absolute; top:-6px; right:-6px; width:20px; height:20px; border-radius:50%;
      border:none; background:#e06c5a; color:#fff; cursor:pointer; line-height:18px; padding:0;
    }
    .eagle-director-skill-root .pp-filmstrip-add {
      width:88px; height:88px; display:flex; align-items:center; justify-content:center;
      border:1px dashed #555; border-radius:6px; color:#8a8a8a; cursor:pointer; font-size:12px; text-align:center;
    }
    .eagle-director-skill-root .pp-preview-markdown {
      background:#1a1a1a; border:1px solid #3a3a3a; border-radius:6px; padding:10px; min-height:80px;
      line-height:1.6;
    }
    .eagle-director-skill-root .pp-preview-markdown h2,
    .eagle-director-skill-root .pp-preview-markdown h3,
    .eagle-director-skill-root .pp-preview-markdown h4 { color:#fff; margin:6px 0; }
    .eagle-director-skill-root .pp-preview-markdown pre { background:#000; padding:8px; border-radius:4px; overflow:auto; }
    .eagle-director-skill-root .pp-preview-markdown code { background:#000; padding:1px 4px; border-radius:3px; }
    .eagle-director-skill-root .pp-preview-markdown blockquote {
      border-left:3px solid #4a9eff; margin:6px 0; padding-left:8px; color:#9fb3c8;
    }
  `;
  document.head.appendChild(style);
}

var DirectorSkillApp = {
  name: "DirectorSkillApp",
  props: { node: Object },
  setup: function (props) {
    function nodeWidget(name) {
      var widgets = props.node && Array.isArray(props.node.widgets) ? props.node.widgets : [];
      return widgets.find(function (w) { return w.name === name; });
    }

    var skills = ref([]);
    var selectedSkillId = ref("");
    var skillContent = ref("");
    var skillFilmstrip = ref([]);
    var filmstripUploading = ref(false);
    var errorMsg = ref("");
    var infoMsg = ref("");
    var storagePath = ref("");
    var exportInput = ref(null);

    function exportSkills() {
      try {
        var blob = new Blob([JSON.stringify(skills.value, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "eagle_director_skills.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        window.alert("❌ 导出失败：" + e.message);
      }
    }

    function importSkills(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function () {
        try {
          var list = JSON.parse(reader.result);
          if (!Array.isArray(list)) throw new Error("文件格式应为技能数组 JSON");
          var last = null;
          for (var i = 0; i < list.length; i++) {
            var s = list[i];
            if (!s.id) s.id = undefined;
            var skill = { id: s.id, name: s.name || "导入的技能", content: s.content || "", filmstrip: s.filmstrip || [] };
            var resp = await fetch("/eaglePromptPresets/director_skills", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ skill: skill })
            });
            var data = await resp.json();
            if (data.success) last = data.data.id;
          }
          await loadSkills();
          if (last) selectSkill(skills.value.find(function (x) { return x.id === last; }) || skills.value[0]);
          window.alert("✅ 已导入 " + list.length + " 个技能");
        } catch (e) {
          window.alert("❌ 导入失败：" + e.message);
        }
      };
      reader.readAsText(file);
    }

    var selectedSkill = computed(function () {
      return skills.value.find(function (s) { return s.id === selectedSkillId.value; }) || null;
    });

    function persistUiState() {
      var w = nodeWidget("ui_state");
      if (w) w.value = JSON.stringify({ selectedSkillId: selectedSkillId.value });
      props.node.setDirtyCanvas(true, true);
    }

    function pushToOutput() {
      var w = nodeWidget("director_skill");
      if (w) {
        w.value = skillContent.value;
        props.node.setDirtyCanvas(true, true);
      }
    }

    async function loadSkills() {
      try {
        var resp = await fetch("/eaglePromptPresets/director_skills");
        var data = await resp.json();
        if (!data.success) throw new Error(data.error || "加载失败");
        skills.value = data.data || [];
        storagePath.value = data.storage_path || storagePath.value;
        errorMsg.value = "";

        if (!skills.value.length) {
          // 空库是正常状态，给友好提示，不当作错误
          infoMsg.value = "暂无导演技能，点击「+ 新建」创建第一个技能。";
          selectedSkillId.value = "";
          skillContent.value = "";
          skillFilmstrip.value = [];
          pushToOutput();
          return;
        }
        infoMsg.value = "";

        var st = {};
        try {
          var uw = nodeWidget("ui_state");
          st = uw && uw.value ? JSON.parse(uw.value) : {};
        } catch (e) { st = {}; }
        var restoredId = st.selectedSkillId;
        if (restoredId && skills.value.some(function (s) { return s.id === restoredId; })) {
          selectSkill(skills.value.find(function (s) { return s.id === restoredId; }));
        } else if (skills.value[0]) {
          selectSkill(skills.value[0]);
        }
      } catch (e) {
        console.error("加载导演技能失败:", e);
        infoMsg.value = "";
        errorMsg.value = "加载技能失败：" + (e.message || "未知错误") + "\n请检查 ComfyUI 后端日志。";
        skills.value = [];
      }
    }

    function selectSkill(skill) {
      if (!skill) return;
      selectedSkillId.value = skill.id;
      skillContent.value = skill.content || "";
      skillFilmstrip.value = skill.filmstrip || [];
      pushToOutput();
      persistUiState();
    }

    // 新建技能：真正调用后端创建（修复原提示词预设内「+ 新建」无效的问题）
    async function createSkill() {
      var name = window.prompt("请输入新技能名称：", "新技能");
      if (!name) return;
      try {
        var resp = await fetch("/eaglePromptPresets/director_skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skill: { id: undefined, name: name, content: "", filmstrip: [] } })
        });
        var data = await resp.json();
        if (!data.success) throw new Error(data.error || "新建失败");
        await loadSkills();
        var created = skills.value.find(function (s) { return s.id === data.data.id; });
        if (created) selectSkill(created);
        window.alert("✅ 已新建技能：" + name);
      } catch (e) {
        window.alert("❌ 新建出错：" + e.message);
      }
    }

    async function saveSkill() {
      if (!selectedSkill.value && !window.prompt) return;
      var name = selectedSkill.value ? selectedSkill.value.name : window.prompt("请输入技能名称：", "新技能");
      if (!name) return;
      var skill = {
        id: selectedSkillId.value || undefined,
        name: name,
        content: skillContent.value,
        filmstrip: skillFilmstrip.value
      };
      try {
        var resp = await fetch("/eaglePromptPresets/director_skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skill: skill })
        });
        var data = await resp.json();
        if (!data.success) throw new Error(data.error || "保存失败");
        selectedSkillId.value = data.data.id;
        await loadSkills();
        selectSkill(skills.value.find(function (s) { return s.id === data.data.id; }) || skills.value[0]);
        window.alert("✅ 已保存导演技能");
      } catch (e) {
        window.alert("❌ 保存出错：" + e.message);
      }
    }

    async function deleteSkill() {
      if (!selectedSkill.value) return;
      if (!window.confirm("确定删除技能「" + selectedSkill.value.name + "」吗？")) return;
      try {
        var resp = await fetch("/eaglePromptPresets/director_skills?id=" + encodeURIComponent(selectedSkill.value.id), {
          method: "DELETE"
        });
        var data = await resp.json();
        if (!data.success) throw new Error(data.error || "删除失败");
        selectedSkillId.value = "";
        skillContent.value = "";
        skillFilmstrip.value = [];
        pushToOutput();
        await loadSkills();
      } catch (e) {
        window.alert("❌ 删除出错：" + e.message);
      }
    }

    async function uploadFilmstripImage(file) {
      if (!file || !String(file.type || "").startsWith("image/")) {
        window.alert("请拖入或选择图片文件");
        return;
      }
      filmstripUploading.value = true;
      try {
        var body = new FormData();
        body.append("file", file, file.name || "filmstrip.png");
        var resp = await fetch("/eaglePromptPresets/upload_filmstrip", { method: "POST", body: body });
        var data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || "上传失败");
        skillFilmstrip.value.push(data.path);
      } catch (err) {
        window.alert(err.message || String(err));
      } finally {
        filmstripUploading.value = false;
      }
    }

    function removeFilmstripImage(index) { skillFilmstrip.value.splice(index, 1); }

    function applyToOutput() {
      pushToOutput();
      window.alert("✅ 已输出到 director_skill 端口");
    }

    // 编辑时实时同步到输出端口（供 H3 导演台等连线消费）
    watch(skillContent, function () { pushToOutput(); });

    function coverUrl(path) {
      if (!path) return "";
      if (path.startsWith("http") || path.startsWith("data:") || path.startsWith("/")) return path;
      return "/eaglePromptPresets/cover/" + encodeURIComponent(path);
    }

    onMounted(function () {
      loadStyles();
      loadSkills();
    });

    return function () {
      return h("div", {
        class: "ppui-root eagle-director-skill-root",
        style: "height:100%;display:flex;flex-direction:column;overflow:hidden;"
      }, [
        h("div", { class: "ppui-toolbar" }, [
          h("h3", { style: { margin: "0 8px 0 0", fontSize: "14px" } }, "🎬 导演技能库"),
          h("button", { class: "ppui-btn ppui-btn-sm primary", onClick: createSkill }, "+ 新建"),
          h("button", { class: "ppui-btn", onClick: saveSkill }, "💾 保存"),
          selectedSkill.value && h("button", {
            class: "ppui-btn",
            style: { background: "#e06c5a", color: "#fff", border: "1px solid #e06c5a" },
            onClick: deleteSkill
          }, "删除"),
          h("button", { class: "ppui-btn primary", onClick: applyToOutput }, "输出到端口"),
          h("span", { style: { flex: "1 1 auto" } }),
          h("button", { class: "ppui-btn", onClick: exportSkills }, "⬇ 导出"),
          h("button", { class: "ppui-btn", onClick: function () { if (exportInput.value) exportInput.value.click(); } }, "⬆ 导入"),
          h("input", {
            ref: exportInput, type: "file", accept: "application/json,.json", style: "display:none",
            onChange: function (e) { importSkills(e.target.files && e.target.files[0]); }
          })
        ]),

        errorMsg.value
          ? h("div", { style: { padding: "10px", color: "#e06c5a", whiteSpace: "pre-wrap" } }, errorMsg.value)
          : h("div", { style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: "0" } }, [
              infoMsg.value
                ? h("div", { style: { padding: "10px", color: "#61afef", background: "#1e2a3a", borderBottom: "1px solid #2f455a" } }, infoMsg.value)
                : null,
              h("div", { class: "pp-director-layout" }, [
                h("aside", { class: "pp-director-sidebar" }, [
                  h("div", { class: "pp-skills-list" },
                  skills.value.map(function (skill) {
                    return h("button", {
                      type: "button",
                      class: ["pp-skill-item", selectedSkillId.value === skill.id ? "active" : ""],
                      onClick: function () { selectSkill(skill); }
                    }, [
                      h("div", { class: "pp-skill-name" }, skill.name || "未命名技能"),
                      h("div", { class: "pp-skill-meta" }, [
                        (skill.filmstrip ? skill.filmstrip.length : 0) + " 个素材",
                        " · ",
                        skill.updated_at ? new Date(skill.updated_at).toLocaleDateString() : ""
                      ])
                    ]);
                  })
                )
              ]),
              h("div", { class: "pp-director-main" }, [
                h("div", { class: "pp-director-section" }, [
                  h("label", {}, "📄 技能文档（Markdown）"),
                  h("textarea", {
                    class: "ppui-search pp-director-editor",
                    value: skillContent.value,
                    placeholder: "输入导演技能说明，支持 Markdown 格式...",
                    onInput: function (e) { skillContent.value = e.target.value; }
                  })
                ]),
                h("div", { class: "pp-director-section" }, [
                  h("label", {}, "🎞️ 素材胶片"),
                  h("div", {
                    class: "pp-filmstrip-grid",
                    onDragover: function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
                    onDrop: function (e) {
                      e.preventDefault();
                      uploadFilmstripImage(e.dataTransfer.files && e.dataTransfer.files[0]);
                    }
                  }, [
                    skillFilmstrip.value.map(function (path, index) {
                      return h("div", { class: "pp-filmstrip-item" }, [
                        h("img", { src: coverUrl(path), loading: "lazy" }),
                        h("button", {
                          class: "pp-filmstrip-remove",
                          onClick: function () { removeFilmstripImage(index); }
                        }, "×")
                      ]);
                    }),
                    h("label", { class: "pp-filmstrip-add" }, [
                      filmstripUploading.value ? "上传中..." : "+ 添加素材",
                      h("input", {
                        type: "file",
                        accept: "image/*",
                        style: "display:none",
                        onChange: function (e) { uploadFilmstripImage(e.target.files && e.target.files[0]); }
                      })
                    ])
                  ])
                ]),
                h("div", { class: "pp-director-section" }, [
                  h("label", {}, "👁️ Markdown 预览"),
                  h("div", {
                    class: "pp-preview-markdown",
                    innerHTML: renderMarkdown(skillContent.value)
                  })
                ])
              ])
            ]),
        h("div", {
          class: "ppui-statusbar",
          style: { padding: "6px 10px", borderTop: "1px solid #2f455a", color: "#8a8a8a", fontSize: "11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "0 0 auto" },
          title: storagePath.value
        }, "📁 存储路径：" + (storagePath.value || "（未知）"))
      ]);
    };
  }
};

app.registerExtension({
  name: "EagleSuite.DirectorSkill",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EagleDirectorSkillNode") return;

    var HIDDEN_WIDGETS = ["director_skill", "ui_state"];

    var hideWidgets = function (node) {
      if (!node.widgets || !node.widgets.length) return false;
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var widget = node.widgets[i];
        if (HIDDEN_WIDGETS.indexOf(widget.name) < 0) continue;
        widget.type = "hidden";
        widget.computeSize = function () { return [0, -4]; };
        widget.hidden = true;
        widget.draw = function () {};
        found = true;
      }
      if (found) node.setDirtyCanvas(true, true);
      return found;
    };

    var originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      console.log("[Eagle Suite] DirectorSkill onNodeCreated", this.id, this.type);
      if (originalOnNodeCreated) originalOnNodeCreated.apply(this, arguments);
      if (this._dsInit || this._dsMounting) return;
      this._dsMounting = true;

      var node = this;
      this.setSize([840, 640]);
      hideWidgets(this);

      setTimeout(function () {
        if (!hideWidgets(node)) setTimeout(function () { hideWidgets(node); }, 500);
      }, 300);

      try {
        loadStyles();
        this.serialize_widgets = true;

        var container = document.createElement("div");
        container.className = "eagle-director-skill-root";
        container.style.cssText = "width:100%;max-width:100%;min-width:0;overflow:hidden;";

        var domWidget = this.addDOMWidget("preview", "div", container, {
          serialize: false,
          hideOnZoom: false
        });
        this._dsWidget = domWidget;

        var vueApp = createApp({
          render: function () {
            return h(DirectorSkillApp, { node: node });
          }
        });

        vueApp.mount(container);
        this._dsVueApp = vueApp;
        this._dsContainer = container;
        this._dsInit = true;
        this._dsMounting = false;

        var syncLayout = function (target, size) {
          if (!target || !target._dsContainer) return;
          var currentSize = size || target.size || [840, 640];
          var nodeHeight = Math.max(440, Number(currentSize[1]) || 640);
          var height = Math.max(360, nodeHeight - 96);
          var root = target._dsContainer;
          root.style.width = "100%";
          root.style.maxWidth = "100%";
          root.style.minWidth = "0";
          root.style.height = height + "px";
          root.style.overflow = "hidden";
          var host = root.parentElement;
          if (host) {
            host.style.width = "100%";
            host.style.maxWidth = "100%";
            host.style.minWidth = "0";
            host.style.boxSizing = "border-box";
            host.style.overflow = "hidden";
          }
        };
        this._dsSyncLayout = function (size) {
          syncLayout(this, size || this.size);
        };

        var previousOnResize = this.onResize;
        this.onResize = function (size) {
          if (previousOnResize) previousOnResize.apply(this, arguments);
          this._dsSyncLayout?.(size);
        };
        this.onResize(this.size);
        requestAnimationFrame(function () { this._dsSyncLayout?.(this.size); }.bind(this));

        var previousOnConfigure = this.onConfigure;
        this.onConfigure = function () {
          if (previousOnConfigure) previousOnConfigure.apply(this, arguments);
          hideWidgets(this);
          requestAnimationFrame(function () {
            hideWidgets(this);
            this._dsSyncLayout?.(this.size);
          }.bind(this));
        };

        var previousOnRemoved = this.onRemoved;
        this.onRemoved = function () {
          if (this._dsVueApp) this._dsVueApp.unmount();
          this._dsVueApp = null;
          this._dsContainer = null;
          this._dsWidget = null;
          this._dsSyncLayout = null;
          this._dsInit = false;
          this._dsMounting = false;
          if (previousOnRemoved) previousOnRemoved.apply(this, arguments);
        };
      } catch (error) {
        this._dsInit = false;
        this._dsMounting = false;
        hideWidgets(this);
        var errText = "[Eagle Suite] Director Skill Vue mount failed: " + (error && error.stack ? error.stack : String(error));
        console.error(errText);
        try { window.alert(errText); } catch (_) {}
        if (container) {
          container.className = "eagle-director-skill-root";
          container.style.cssText = "height:100%;padding:16px;overflow:auto;";
          container.textContent = "Director Skill UI failed to initialize. Check the browser console and refresh after fixing the extension error.";
        }
      }
    };
  }
});
