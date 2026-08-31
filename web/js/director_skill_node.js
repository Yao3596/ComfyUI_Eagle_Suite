import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { createApp, h, ref, reactive, computed, onMounted, watch } from "../lib/vue.esm-browser.js";
import "./eagle_vue_theme.js";

console.log("[Eagle Suite] director_skill_node.js module loaded", new Date().toISOString());

// ──────────────────────────────────────────────────────────────
// 导演技能库节点：从提示词预设剥离出的独立节点。
// 复用 /eaglePromptPresets/director_skills 后端存储（共享同一技能库）。
// 选中/编辑的技能内容实时写入 director_skill 输出端口，供 H3 导演台等连线使用。
// ──────────────────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return "";
  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function inline(value) {
    return escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code class='pp-md-icode'>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<a href='$2' target='_blank' rel='noopener'>$1</a>");
  }

  var lines = String(text).replace(/\r/g, "").split("\n");
  var output = [];
  var paragraph = [];
  var list = [];
  var listType = "";
  var code = [];
  var inCode = false;
  function flushParagraph() {
    if (paragraph.length) output.push("<p>" + paragraph.map(inline).join("<br>") + "</p>");
    paragraph = [];
  }
  function flushList() {
    if (list.length) output.push("<" + listType + ">" + list.map(function (item) { return "<li>" + inline(item) + "</li>"; }).join("") + "</" + listType + ">");
    list = []; listType = "";
  }
  lines.forEach(function (line) {
    if (/^```/.test(line.trim())) {
      flushParagraph(); flushList();
      if (inCode) { output.push('<pre class="pp-md-code"><code>' + escapeHtml(code.join("\n")) + "</code></pre>"); code = []; }
      inCode = !inCode;
      return;
    }
    if (inCode) { code.push(line); return; }
    if (!line.trim()) { flushParagraph(); flushList(); return; }
    var heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      var level = Math.min(5, heading[1].length + 1);
      output.push("<h" + level + " class='pp-md-h'>" + inline(heading[2]) + "</h" + level + ">");
      return;
    }
    var quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushParagraph(); flushList(); output.push("<blockquote class='pp-md-quote'>" + inline(quote[1]) + "</blockquote>"); return; }
    var unordered = line.match(/^[-*+]\s+(.+)$/);
    var ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      var nextType = ordered ? "ol" : "ul";
      if (listType && listType !== nextType) flushList();
      listType = nextType; list.push((ordered || unordered)[1]); return;
    }
    if (/^([-*_])\1\1+\s*$/.test(line.trim())) { flushParagraph(); flushList(); output.push("<hr>"); return; }
    flushList();
    paragraph.push(line.trim());
  });
  if (inCode && code.length) output.push('<pre class="pp-md-code"><code>' + escapeHtml(code.join("\n")) + "</code></pre>");
  flushParagraph(); flushList();
  return output.join("");
}

function loadStyles() {
  if (document.getElementById("eagle-director-skill-style")) return;
  var style = document.createElement("style");
  style.id = "eagle-director-skill-style";
  style.textContent = `
    .eagle-director-skill-root {
      position:relative; font-size:13px;
      --ppui-theme-bg:var(--comfy-menu-bg, var(--bg-color, #1e1e1e));
      --ppui-text:var(--fg-color, #d4d4d4);
      --ppui-bg:var(--ppui-theme-bg);
      --ppui-panel:color-mix(in srgb, var(--ppui-theme-bg) 94%, var(--ppui-text) 6%);
      --ppui-surface:color-mix(in srgb, var(--ppui-theme-bg) 87%, var(--ppui-text) 13%);
      --ppui-surface-alt:color-mix(in srgb, var(--ppui-theme-bg) 80%, var(--ppui-text) 20%);
      --ppui-hover:color-mix(in srgb, var(--ppui-theme-bg) 73%, var(--ppui-text) 27%);
      --ppui-input:var(--comfy-input-bg, var(--input-bg, color-mix(in srgb, var(--ppui-theme-bg) 97%, #000 3%)));
      --ppui-border:var(--border-color, color-mix(in srgb, var(--ppui-theme-bg) 67%, var(--ppui-text) 33%));
      --ppui-muted:var(--descrip-text, color-mix(in srgb, var(--ppui-text) 62%, var(--ppui-theme-bg) 38%));
      --ppui-primary:var(--p-primary-color, #2f6fd1);
      background:var(--ppui-bg); color:var(--ppui-text);
    }
    .eagle-director-skill-root .ppui-toolbar {
      display:flex; align-items:center; gap:6px; padding:8px 10px;
      background:var(--ppui-panel); border-bottom:1px solid var(--ppui-border); flex-shrink:0;
    }
    .eagle-director-skill-root .ppui-btn {
      background:var(--ppui-surface-alt); color:var(--ppui-text); border:1px solid var(--ppui-border); border-radius:4px;
      padding:4px 10px; cursor:pointer; font-size:12px;
    }
    .eagle-director-skill-root .ppui-btn:hover { background:var(--ppui-hover); }
    .eagle-director-skill-root .ppui-btn.primary { background:var(--ppui-primary); border-color:var(--ppui-primary); color:#fff; }
    .eagle-director-skill-root .ppui-btn.primary:hover { filter:brightness(1.12); }
    .eagle-director-skill-root .ppui-btn-sm { padding:3px 8px; }
    .eagle-director-skill-root .pp-director-layout { display:flex; min-height:0; flex:1 1 auto; }
    .eagle-director-skill-root .pp-director-sidebar {
      width:230px; flex-shrink:0; border-right:1px solid var(--ppui-border); overflow-y:auto;
      background:var(--ppui-panel); padding:8px;
    }
    .eagle-director-skill-root .pp-sidebar-head {
      display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;
    }
    .eagle-director-skill-root .pp-skills-list { display:flex; flex-direction:column; gap:6px; }
    .eagle-director-skill-root .pp-skill-item {
      text-align:left; background:var(--ppui-surface); color:var(--ppui-text); border:1px solid var(--ppui-border);
      border-radius:6px; padding:8px 32px 8px 10px; cursor:pointer; position:relative;
    }
    .eagle-director-skill-root .pp-skill-item:hover { background:var(--ppui-surface-alt); }
    .eagle-director-skill-root .pp-skill-item.enabled { border-color:var(--ppui-primary); background:color-mix(in srgb, var(--ppui-primary) 28%, var(--ppui-bg) 72%); box-shadow:inset 3px 0 var(--ppui-primary); }
    .eagle-director-skill-root .pp-skill-item.enabled:hover { background:color-mix(in srgb, var(--ppui-primary) 38%, var(--ppui-bg) 62%); }
    .eagle-director-skill-root .pp-skill-item.active:not(.enabled) { border-color:#626b7a; outline:1px dashed #626b7a; outline-offset:-3px; }
    .eagle-director-skill-root .pp-skill-name { font-weight:600; }
    .eagle-director-skill-root .pp-skill-meta { color:var(--ppui-muted); font-size:11px; margin-top:2px; }
    .eagle-director-skill-root .pp-skill-delete {
      position:absolute; top:6px; right:6px; width:20px; height:20px; padding:0;
      display:flex; align-items:center; justify-content:center; border:0; border-radius:4px;
      background:transparent; color:#9aa0aa; font-size:15px; line-height:1; cursor:pointer;
      opacity:0; pointer-events:none; transition:opacity .12s ease, background .12s ease, color .12s ease;
    }
    .eagle-director-skill-root .pp-skill-item:hover .pp-skill-delete,
    .eagle-director-skill-root .pp-skill-item:focus-within .pp-skill-delete {
      opacity:1; pointer-events:auto;
    }
    .eagle-director-skill-root .pp-skill-delete:hover,
    .eagle-director-skill-root .pp-skill-delete:focus-visible {
      background:#b84a55; color:#fff; outline:none;
    }
    .eagle-director-skill-root .pp-director-main { flex:1 1 auto; min-width:0; overflow-y:auto; padding:12px; }
    .eagle-director-skill-root .pp-director-section { margin-bottom:14px; }
    .eagle-director-skill-root .pp-director-section > label { display:block; margin-bottom:6px; color:var(--ppui-muted); font-size:12px; }
    .eagle-director-skill-root .pp-director-editor {
      width:100%; min-height:280px; resize:vertical; font-family:monospace;
      background:var(--ppui-input); color:var(--ppui-text); border:1px solid var(--ppui-border); border-radius:6px; padding:8px;
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
      background:var(--ppui-input); border:1px solid var(--ppui-border); border-radius:6px; padding:10px;
      min-height:54px; max-height:280px; overflow:auto; line-height:1.5; overflow-wrap:anywhere;
    }
    .eagle-director-skill-root .pp-preview-markdown p { margin:0 0 8px; }
    .eagle-director-skill-root .pp-preview-markdown p:last-child { margin-bottom:0; }
    .eagle-director-skill-root .pp-preview-markdown ul,
    .eagle-director-skill-root .pp-preview-markdown ol { margin:5px 0 9px; padding-left:22px; }
    .eagle-director-skill-root .pp-preview-markdown li { margin:2px 0; }
    .eagle-director-skill-root .pp-preview-markdown h2,
    .eagle-director-skill-root .pp-preview-markdown h3,
    .eagle-director-skill-root .pp-preview-markdown h4,
    .eagle-director-skill-root .pp-preview-markdown h5 { color:#fff; margin:10px 0 5px; line-height:1.25; }
    .eagle-director-skill-root .pp-preview-markdown h2:first-child,
    .eagle-director-skill-root .pp-preview-markdown h3:first-child,
    .eagle-director-skill-root .pp-preview-markdown h4:first-child { margin-top:0; }
    .eagle-director-skill-root .pp-preview-markdown pre { margin:6px 0 9px; background:#000; padding:8px; border-radius:4px; overflow:auto; white-space:pre-wrap; }
    .eagle-director-skill-root .pp-preview-markdown code { background:#000; padding:1px 4px; border-radius:3px; }
    .eagle-director-skill-root .pp-preview-markdown blockquote {
      border-left:3px solid #4a9eff; margin:6px 0; padding-left:8px; color:#9fb3c8;
    }
    .eagle-director-skill-root .pp-preview-markdown hr { margin:9px 0; border:0; border-top:1px solid #3a3a3a; }
    .eagle-director-skill-root, .eagle-director-skill-root * { box-sizing:border-box; }
    .eagle-director-skill-root .ds-modal-backdrop {
      position:absolute; inset:0; z-index:80; display:flex; align-items:center; justify-content:center;
      padding:16px; background:rgba(5,7,11,.76); backdrop-filter:blur(2px);
    }
    .eagle-director-skill-root .ds-modal {
      width:min(720px,96%); max-height:calc(100% - 24px); display:flex; flex-direction:column;
      border:1px solid var(--ppui-border); border-radius:11px; background:var(--ppui-bg); box-shadow:0 20px 55px rgba(0,0,0,.55); overflow:hidden;
    }
    .eagle-director-skill-root .ds-modal.compact { width:min(430px,94%); }
    .eagle-director-skill-root .ds-modal-head { display:flex; align-items:center; gap:10px; padding:13px 16px; border-bottom:1px solid var(--ppui-border); }
    .eagle-director-skill-root .ds-modal-head h3 { margin:0; font-size:15px; color:var(--ppui-text); }
    .eagle-director-skill-root .ds-modal-head button { margin-left:auto; }
    .eagle-director-skill-root .ds-modal-body { padding:14px 16px; overflow:auto; min-height:0; }
    .eagle-director-skill-root .ds-modal-foot { display:flex; justify-content:flex-end; gap:8px; padding:11px 16px; border-top:1px solid var(--ppui-border); background:var(--ppui-panel); }
    .eagle-director-skill-root .ds-setting-card { margin-bottom:12px; padding:12px; border:1px solid var(--ppui-border); border-radius:9px; background:var(--ppui-surface); }
    .eagle-director-skill-root .ds-setting-card h4 { margin:0 0 10px; color:var(--ppui-text); }
    .eagle-director-skill-root .ds-setting-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 12px; }
    .eagle-director-skill-root .ds-field { min-width:0; display:flex; flex-direction:column; gap:5px; color:var(--ppui-muted); font-size:12px; }
    .eagle-director-skill-root .ds-field.full { grid-column:1/-1; }
    .eagle-director-skill-root .ds-input { width:100%; height:34px!important; min-height:34px!important; padding:6px 9px; color:var(--ppui-text); background:var(--ppui-input); border:1px solid var(--ppui-border); border-radius:6px; }
    .eagle-director-skill-root .ds-check { display:flex; align-items:center; gap:8px; cursor:pointer; }
    .eagle-director-skill-root .ds-message { margin-top:9px; padding:8px 10px; border-radius:6px; background:#222b38; color:#9fc5f8; white-space:pre-wrap; }
    .eagle-director-skill-root .ds-message.error { background:#3a2025; color:#ff9aa7; }
    .eagle-director-skill-root .ds-toast { position:absolute; right:14px; bottom:38px; z-index:100; max-width:420px; padding:9px 12px; border:1px solid #41628c; border-radius:7px; background:#20334d; color:#dcecff; box-shadow:0 8px 24px rgba(0,0,0,.45); }
    .eagle-director-skill-root .ds-toast.error { border-color:#8d414b; background:#45242a; color:#ffd8dc; }
    @media (max-width:700px) { .eagle-director-skill-root .ds-setting-grid { grid-template-columns:1fr; } .eagle-director-skill-root .ds-field.full { grid-column:auto; } }
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
    var enabledSkillIds = ref([]);
    var skillContent = ref("");
    var skillFilmstrip = ref([]);
    var filmstripUploading = ref(false);
    var skillsLoading = ref(false);
    var errorMsg = ref("");
    var infoMsg = ref("");
    var storagePath = ref("");
    var storageSource = ref("eagle");
    var exportInput = ref(null);
    var settingsOpen = ref(false);
    var settingsLoading = ref(false);
    var settingsSaving = ref(false);
    var settingsTesting = ref(false);
    var settingsSyncing = ref(false);
    var settingsMessage = reactive({ text: "", error: false });
    var toast = reactive({ visible: false, text: "", error: false });
    var dialog = reactive({ visible: false, mode: "text", title: "", message: "", value: "", confirmText: "确定", action: null });
    var config = reactive({
      obsidian: {
        enabled: false,
        api_url: "https://127.0.0.1:27124",
        api_key: "",
        vault_path: "",
        prompts_folder: "ComfyUI/Prompts",
        director_skills_folder: "ComfyUI/DirectorSkills",
        director_skills_file: "Eagle Director Skills.md"
      },
      director_skills: { source: "eagle", custom_path: "", filmstrip_megapixels: 1.0 },
      local_paths: [], auto_sync: true, default_category: "自定义"
    });
    var toastTimer = 0;

    function showToast(text, error) {
      toast.text = String(text || "");
      toast.error = !!error;
      toast.visible = true;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.visible = false; }, 3200);
    }

    async function readJsonResponse(response, label) {
      var text = await response.text();
      if (!text.trim()) {
        throw new Error(label + "：HTTP " + response.status + " 返回空响应，请重启 ComfyUI 后重试");
      }
      var data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error(label + "：HTTP " + response.status + " 返回了非 JSON 响应");
      }
      if (!response.ok || !data.success) {
        throw new Error(data.error || (label + "失败（HTTP " + response.status + "）"));
      }
      return data;
    }

    function openTextDialog(title, initialValue, action) {
      Object.assign(dialog, { visible: true, mode: "text", title: title, message: "", value: initialValue || "", confirmText: "确定", action: action });
    }

    function openConfirmDialog(title, message, action) {
      Object.assign(dialog, { visible: true, mode: "confirm", title: title, message: message, value: "", confirmText: "删除", action: action });
    }

    async function confirmDialog() {
      var action = dialog.action;
      var value = dialog.value.trim();
      if (dialog.mode === "text" && !value) return;
      dialog.visible = false;
      dialog.action = null;
      if (typeof action === "function") await action(value);
    }

    async function loadSettings() {
      settingsLoading.value = true;
      settingsMessage.text = "";
      try {
        var response = await api.fetchApi("/eaglePromptPresets/config");
        var data = await readJsonResponse(response, "读取设置");
        Object.assign(config, data.data || {});
        config.obsidian = Object.assign({
          enabled: false, api_url: "https://127.0.0.1:27124", api_key: "", vault_path: "",
          prompts_folder: "ComfyUI/Prompts", director_skills_folder: "ComfyUI/DirectorSkills", director_skills_file: "Eagle Director Skills.md"
        }, (data.data && data.data.obsidian) || {});
        config.director_skills = Object.assign(
          { source: "eagle", custom_path: "", filmstrip_megapixels: 1.0 },
          (data.data && data.data.director_skills) || {}
        );
        config.director_skills.filmstrip_megapixels = Math.min(
          10, Math.max(1, Number(config.director_skills.filmstrip_megapixels) || 1)
        );
      } catch (error) {
        settingsMessage.text = error.message || String(error);
        settingsMessage.error = true;
      } finally { settingsLoading.value = false; }
    }

    async function openSettings() {
      settingsOpen.value = true;
      await loadSettings();
    }

    async function saveSettings(closeAfter) {
      settingsSaving.value = true;
      settingsMessage.text = "";
      try {
        config.director_skills.filmstrip_megapixels = Math.min(
          10, Math.max(1, Number(config.director_skills.filmstrip_megapixels) || 1)
        );
        var response = await api.fetchApi("/eaglePromptPresets/config", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: config })
        });
        var data = await readJsonResponse(response, "保存设置");
        if (!response.ok || !data.success) throw new Error(data.error || "保存设置失败");
        settingsMessage.text = "设置已保存";
        settingsMessage.error = false;
        showToast("导演技能库设置已保存", false);
        await loadSkills();
        if (closeAfter) settingsOpen.value = false;
        return true;
      } catch (error) {
        settingsMessage.text = error.message || String(error);
        settingsMessage.error = true;
        return false;
      } finally { settingsSaving.value = false; }
    }

    async function testObsidian() {
      settingsTesting.value = true;
      settingsMessage.text = "";
      try {
        var payload = Object.assign({}, config.obsidian, { prompts_folder: config.obsidian.director_skills_folder });
        var response = await api.fetchApi("/eaglePromptPresets/test_obsidian", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
        var data = await readJsonResponse(response, "测试 Obsidian 连接");
        if (!response.ok || !data.success) throw new Error(data.error || "连接失败");
        settingsMessage.text = data.message || "Obsidian Vault 连接正常";
        settingsMessage.error = false;
      } catch (error) {
        settingsMessage.text = error.message || String(error);
        settingsMessage.error = true;
      } finally { settingsTesting.value = false; }
    }

    async function syncObsidian() {
      settingsSyncing.value = true;
      settingsMessage.text = "";
      try {
        if (!await saveSettings(false)) return;
        var response = await api.fetchApi("/eaglePromptPresets/director_skills/sync_obsidian", { method: "POST" });
        var data = await readJsonResponse(response, "同步 Obsidian 技能库");
        if (!response.ok || !data.success) throw new Error(data.error || "同步失败");
        settingsMessage.text = (data.message || "同步完成") + "\n" + (data.path || "");
        settingsMessage.error = false;
        await loadSkills();
        showToast("Obsidian 导演技能已同步", false);
      } catch (error) {
        settingsMessage.text = error.message || String(error);
        settingsMessage.error = true;
      } finally { settingsSyncing.value = false; }
    }

    var selectedSkill = computed(function () {
      return skills.value.find(function (s) { return s.id === selectedSkillId.value; }) || null;
    });

    function persistUiState() {
      var w = nodeWidget("ui_state");
      if (w) w.value = JSON.stringify({
        selectedSkillId: selectedSkillId.value,
        enabledSkillIds: enabledSkillIds.value.slice()
      });
      props.node.setDirtyCanvas(true, true);
    }

    function compiledSkillMarkdown() {
      var active = skills.value.filter(function (skill) {
        return enabledSkillIds.value.indexOf(skill.id) >= 0;
      });
      return active.map(function (skill) {
        var meta = [];
        if (skill.category) meta.push("category: " + skill.category);
        if (Array.isArray(skill.tasks) && skill.tasks.length) meta.push("tasks: " + skill.tasks.join(", "));
        return [
          "## " + (skill.name || "Director Skill"),
          meta.length ? "> " + meta.join(" | ") : "",
          skill.id === selectedSkillId.value ? skillContent.value : (skill.content || "")
        ].filter(Boolean).join("\n\n");
      }).join("\n\n---\n\n");
    }

    function selectedSkillMarkdown() {
      var skill = selectedSkill.value;
      var content = String(skillContent.value || "").trim();
      if (!skill && !content) return "";
      return "# " + ((skill && skill.name) || "未命名技能") + (content ? "\n\n" + content : "");
    }

    function pushToOutput() {
      var w = nodeWidget("director_skill");
      if (w) {
        w.value = compiledSkillMarkdown();
        if (typeof w.callback === "function") w.callback(w.value, w, props.node);
        if (props.node.graph) props.node.graph.change();
        props.node.setDirtyCanvas(true, true);
      }
    }

    function toggleSkill(skill) {
      var index = enabledSkillIds.value.indexOf(skill.id);
      if (index >= 0) enabledSkillIds.value.splice(index, 1);
      else enabledSkillIds.value.push(skill.id);
      pushToOutput();
      persistUiState();
    }

    async function loadSkills() {
      if (skillsLoading.value) return false;
      skillsLoading.value = true;
      try {
        var resp = await api.fetchApi("/eaglePromptPresets/director_skills");
        var data = await readJsonResponse(resp, "加载技能");
        skills.value = data.data || [];
        storagePath.value = data.storage_path || storagePath.value;
        storageSource.value = data.effective_source || data.source || "eagle";
        errorMsg.value = "";

        if (!skills.value.length) {
          // 空库是正常状态，给友好提示，不当作错误
          infoMsg.value = "暂无导演技能，点击「+ 新建」创建第一个技能。";
          selectedSkillId.value = "";
          skillContent.value = "";
          skillFilmstrip.value = [];
          pushToOutput();
          return true;
        }
        infoMsg.value = data.fallback_reason ? ("技能库已回退到 " + storageSource.value + "：" + data.fallback_reason) : "";

        var st = {};
        try {
          var uw = nodeWidget("ui_state");
          st = uw && uw.value ? JSON.parse(uw.value) : {};
        } catch (e) { st = {}; }
        enabledSkillIds.value = Array.isArray(st.enabledSkillIds)
          ? st.enabledSkillIds.filter(function (id) {
              return skills.value.some(function (skill) { return skill.id === id; });
            })
          : (skills.value[0] ? [skills.value[0].id] : []);
        var restoredId = st.selectedSkillId;
        if (restoredId && skills.value.some(function (s) { return s.id === restoredId; })) {
          selectSkill(skills.value.find(function (s) { return s.id === restoredId; }));
        } else if (skills.value[0]) {
          selectSkill(skills.value[0]);
        }
        return true;
      } catch (e) {
        console.error("加载导演技能失败:", e);
        infoMsg.value = "";
        errorMsg.value = "加载技能失败：" + (e.message || "未知错误") + "\n请检查 ComfyUI 后端日志。";
        return false;
      } finally {
        skillsLoading.value = false;
      }
    }

    async function refreshSkillsVue() {
      if (skillsLoading.value) return;
      await loadSettings();
      var loaded = await loadSkills();
      if (loaded) showToast("技能库已刷新，共 " + skills.value.length + " 项", false);
    }

    function selectSkill(skill) {
      if (!skill) return;
      selectedSkillId.value = skill.id;
      skillContent.value = skill.content || "";
      skillFilmstrip.value = skill.filmstrip || [];
      pushToOutput();
      persistUiState();
    }

    function toggleSkillFromList(skill) {
      if (!skill) return;
      selectedSkillId.value = skill.id;
      skillContent.value = skill.content || "";
      skillFilmstrip.value = skill.filmstrip || [];
      toggleSkill(skill);
    }

    function exportSkillsVue() {
      try {
        var blob = new Blob([JSON.stringify(skills.value, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement("a");
        anchor.href = url; anchor.download = "eagle_director_skills.json"; anchor.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 500);
      } catch (error) { showToast("导出失败：" + error.message, true); }
    }

    function importSkillsVue(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function () {
        try {
          var list = JSON.parse(reader.result);
          if (!Array.isArray(list)) throw new Error("文件格式应为技能数组 JSON");
          var last = null;
          for (var item of list) {
            var skill = Object.assign({ category: "custom", tasks: ["script", "shots", "dialogue"], tags: [], content: "", filmstrip: [] }, item || {});
            var response = await api.fetchApi("/eaglePromptPresets/director_skills", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill: skill })
            });
            var data = await readJsonResponse(response, "导入导演技能");
            if (!response.ok || !data.success) throw new Error(data.error || "导入失败");
            last = data.data.id;
          }
          await loadSkills();
          if (last) selectSkill(skills.value.find(function (item) { return item.id === last; }) || skills.value[0]);
          showToast("已导入 " + list.length + " 个技能", false);
        } catch (error) { showToast("导入失败：" + error.message, true); }
      };
      reader.readAsText(file);
    }

    function createSkillVue() {
      openTextDialog("新建导演技能", "新技能", async function (name) {
        try {
          var response = await api.fetchApi("/eaglePromptPresets/director_skills", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skill: { name: name, category: "custom", tasks: ["script", "shots", "dialogue"], tags: [], content: "", filmstrip: [] } })
          });
          var data = await readJsonResponse(response, "新建导演技能");
          if (!response.ok || !data.success) throw new Error(data.error || "新建失败");
          await loadSkills();
          selectSkill(skills.value.find(function (item) { return item.id === data.data.id; }) || skills.value[0]);
          showToast("已新建技能：" + name, false);
        } catch (error) { showToast("新建失败：" + error.message, true); }
      });
    }

    async function saveSkillWithNameVue(name) {
      try {
        var source = selectedSkill.value || {};
        var skill = {
          id: selectedSkillId.value || undefined, name: name, category: source.category || "custom",
          tasks: source.tasks || ["script", "shots", "dialogue"], tags: source.tags || [],
          content: skillContent.value, filmstrip: skillFilmstrip.value
        };
        var response = await api.fetchApi("/eaglePromptPresets/director_skills", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill: skill })
        });
        var data = await readJsonResponse(response, "保存导演技能");
        if (!response.ok || !data.success) throw new Error(data.error || "保存失败");
        selectedSkillId.value = data.data.id;
        await loadSkills();
        selectSkill(skills.value.find(function (item) { return item.id === data.data.id; }) || skills.value[0]);
        showToast("导演技能已保存", false);
      } catch (error) { showToast("保存失败：" + error.message, true); }
    }

    function saveSkillVue() {
      if (selectedSkill.value) saveSkillWithNameVue(selectedSkill.value.name);
      else openTextDialog("保存导演技能", "新技能", saveSkillWithNameVue);
    }

    function deleteSkillVue(skill) {
      skill = skill || selectedSkill.value;
      if (!skill) return;
      openConfirmDialog("删除导演技能", "确定删除“" + skill.name + "”吗？", async function () {
        try {
          var response = await api.fetchApi("/eaglePromptPresets/director_skills/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: skill.id })
          });
          var data = await readJsonResponse(response, "删除导演技能");
          if (!response.ok || !data.success) throw new Error(data.error || "删除失败");
          var deletedSelected = selectedSkillId.value === skill.id;
          enabledSkillIds.value = enabledSkillIds.value.filter(function (id) { return id !== skill.id; });
          if (deletedSelected) {
            selectedSkillId.value = "";
            skillContent.value = "";
            skillFilmstrip.value = [];
          }
          persistUiState();
          pushToOutput();
          await loadSkills();
          showToast("技能已删除", false);
        } catch (error) { showToast("删除失败：" + error.message, true); }
      });
    }

    async function uploadFilmstripImageVue(file) {
      if (!file || !String(file.type || "").startsWith("image/")) { showToast("请选择图片文件", true); return; }
      filmstripUploading.value = true;
      try {
        var body = new FormData();
        body.append("file", file, file.name || "filmstrip.png");
        body.append("megapixels", String(Math.min(10, Math.max(1, Number(config.director_skills.filmstrip_megapixels) || 1))));
        var response = await api.fetchApi("/eaglePromptPresets/upload_filmstrip", { method: "POST", body: body });
        var data = await readJsonResponse(response, "上传素材胶片");
        if (!response.ok || !data.success) throw new Error(data.error || "上传失败");
        skillFilmstrip.value.push(data.path);
        showToast(data.width && data.height
          ? "素材已处理为 " + data.width + "×" + data.height + "（" + Number(data.megapixels || 0).toFixed(2) + " MP）"
          : "素材已上传", false);
      } catch (error) { showToast(error.message || String(error), true); }
      finally { filmstripUploading.value = false; }
    }

    function applyToOutputVue() { pushToOutput(); showToast("已写入 director_skill 输出端口", false); }

    function removeFilmstripImage(index) { skillFilmstrip.value.splice(index, 1); }

    // 编辑时实时同步到输出端口（供 H3 导演台等连线消费）
    watch(skillContent, function () { pushToOutput(); });

    function coverUrl(path) {
      if (!path) return "";
      if (path.startsWith("http") || path.startsWith("data:") || path.startsWith("/")) return path;
      return "/eaglePromptPresets/filmstrip?path=" + encodeURIComponent(path);
    }

    onMounted(function () {
      loadStyles();
      props.node._dsReloadSkills = loadSkills;
      loadSkills();
      loadSettings();
    });

    return function () {
      return h("div", {
        class: "ppui-root eagle-director-skill-root",
        style: "height:100%;display:flex;flex-direction:column;overflow:hidden;"
      }, [
        h("div", { class: "ppui-toolbar" }, [
          h("h3", { style: { margin: "0 8px 0 0", fontSize: "14px" } }, "🎬 导演技能库"),
          h("button", { class: "ppui-btn ppui-btn-sm primary", onClick: createSkillVue }, "+ 新建"),
          h("button", { class: "ppui-btn", onClick: saveSkillVue }, "💾 保存"),
          h("span", { style: { color: "#8a8a8a", fontSize: "11px" } }, "已组合 " + enabledSkillIds.value.length + " 项"),
          h("button", { class: "ppui-btn primary", onClick: applyToOutputVue }, "输出到端口"),
          h("span", { style: { flex: "1 1 auto" } }),
          h("button", {
            class: "ppui-btn",
            disabled: skillsLoading.value,
            title: "重新读取设置来源和技能文件",
            onClick: refreshSkillsVue
          }, skillsLoading.value ? "刷新中…" : "⟳ 刷新"),
          h("button", { class: "ppui-btn", onClick: exportSkillsVue }, "⬇ 导出"),
          h("button", { class: "ppui-btn", onClick: function () { if (exportInput.value) exportInput.value.click(); } }, "⬆ 导入"),
          h("input", {
            ref: exportInput, type: "file", accept: "application/json,.json", style: "display:none",
            onChange: function (e) { importSkillsVue(e.target.files && e.target.files[0]); }
          }),
          h("button", { class: "ppui-btn", title: "设置与 Obsidian 同步", onClick: openSettings }, "⚙ 设置")
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
                    var enabled = enabledSkillIds.value.indexOf(skill.id) >= 0;
                    return h("div", {
                      role: "button",
                      tabindex: "0",
                      class: [
                        "pp-skill-item",
                        selectedSkillId.value === skill.id ? "active" : "",
                        enabled ? "enabled" : ""
                      ],
                      title: enabled ? "已启用；点击取消" : "未启用；点击加入输出",
                      onClick: function () { toggleSkillFromList(skill); },
                      onKeydown: function (event) {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleSkillFromList(skill);
                        }
                      }
                    }, [
                      h("div", { class: "pp-skill-name" }, skill.name || "未命名技能"),
                      h("div", { class: "pp-skill-meta" }, [
                        (skill.filmstrip ? skill.filmstrip.length : 0) + " 个素材",
                        " · ",
                        skill.updated_at ? new Date(skill.updated_at).toLocaleDateString() : ""
                      ]),
                      h("button", {
                        type: "button",
                        class: "pp-skill-delete",
                        title: "删除“" + (skill.name || "未命名技能") + "”",
                        "aria-label": "删除“" + (skill.name || "未命名技能") + "”",
                        onClick: function (event) {
                          event.stopPropagation();
                          deleteSkillVue(skill);
                        },
                        onKeydown: function (event) { event.stopPropagation(); }
                      }, "×")
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
                      uploadFilmstripImageVue(e.dataTransfer.files && e.dataTransfer.files[0]);
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
                        onChange: function (e) { uploadFilmstripImageVue(e.target.files && e.target.files[0]); }
                      })
                    ])
                  ])
                ]),
                h("div", { class: "pp-director-section" }, [
                  h("label", {}, "👁️ Markdown 预览"),
                  h("div", {
                    class: "pp-preview-markdown",
                    innerHTML: selectedSkillMarkdown()
                      ? renderMarkdown(selectedSkillMarkdown())
                      : '<span style="color:#777">当前技能暂无可预览内容</span>'
                  })
                ])
              ])
              ])
            ]),
        h("div", {
          class: "ppui-statusbar",
          style: { padding: "6px 10px", borderTop: "1px solid #2f455a", color: "#8a8a8a", fontSize: "11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "0 0 auto" },
          title: storagePath.value
        }, "📁 存储路径：" + (storagePath.value || "（未知）")),

        settingsOpen.value ? h("div", { class: "ds-modal-backdrop", onClick: function () { settingsOpen.value = false; } }, [
          h("div", { class: "ds-modal", onClick: function (event) { event.stopPropagation(); } }, [
            h("div", { class: "ds-modal-head" }, [
              h("h3", {}, "⚙ 导演技能库设置"),
              h("button", { class: "ppui-btn", onClick: function () { settingsOpen.value = false; } }, "×")
            ]),
            h("div", { class: "ds-modal-body" }, settingsLoading.value ? [h("div", {}, "正在读取设置…")] : [
              h("section", { class: "ds-setting-card" }, [
                h("h4", {}, "🦅 技能读取源"),
                h("label", { class: "ds-field" }, [
                  h("span", {}, "默认来源"),
                  h("select", {
                    class: "ds-input",
                    value: config.director_skills.source || "eagle",
                    onChange: function (event) { config.director_skills.source = event.target.value; }
                  }, [
                    h("option", { value: "eagle" }, "Eagle 节点技能库（默认）"),
                    h("option", { value: "obsidian" }, "Obsidian Markdown 技能库"),
                    h("option", { value: "custom" }, "自定义 JSON 文件或目录")
                  ])
                ]),
                config.director_skills.source === "custom" ? h("label", { class: "ds-field", style: { marginTop: "10px" } }, [
                  h("span", {}, "自定义技能库路径"),
                  h("input", {
                    class: "ds-input", value: config.director_skills.custom_path || "",
                    placeholder: "D:/Skills/director_skills.json（也可填写目录）",
                    onInput: function (event) { config.director_skills.custom_path = event.target.value; }
                  })
                ]) : null,
                h("div", { style: { marginTop: "8px", color: "#8f9bad", fontSize: "12px", lineHeight: 1.55 } },
                  config.director_skills.source === "obsidian"
                    ? "直接从下方配置的 Vault Markdown 文件读取；Vault 不可用时自动回退到 Eagle，不会清空本地技能。"
                    : config.director_skills.source === "custom"
                      ? "自定义源由用户自行维护；切换来源不会删除或覆盖 Eagle 技能库。"
                      : "默认读取 eagle_suite/skills/director_skills.json；导演技能、素材与 Markdown 用户模板统一归档在 skills 下。")
              ]),
              h("section", { class: "ds-setting-card" }, [
                h("h4", {}, "📓 Obsidian Vault 集成"),
                h("label", { class: "ds-check" }, [
                  h("input", { type: "checkbox", checked: !!config.obsidian.enabled, onChange: function (event) { config.obsidian.enabled = event.target.checked; } }),
                  h("span", {}, "启用导演技能 Markdown 双向同步")
                ]),
                h("div", { class: "ds-setting-grid", style: { marginTop: "11px" } }, [
                  h("label", { class: "ds-field full" }, [h("span", {}, "Vault 本地路径"), h("input", { class: "ds-input", value: config.obsidian.vault_path || "", placeholder: "D:/Obsidian/MyVault", onInput: function (event) { config.obsidian.vault_path = event.target.value; } })]),
                  h("label", { class: "ds-field" }, [h("span", {}, "技能目录（Vault 内相对路径）"), h("input", { class: "ds-input", value: config.obsidian.director_skills_folder || "", placeholder: "ComfyUI/DirectorSkills", onInput: function (event) { config.obsidian.director_skills_folder = event.target.value; } })]),
                  h("label", { class: "ds-field" }, [h("span", {}, "技能库 Markdown 文件"), h("input", { class: "ds-input", value: config.obsidian.director_skills_file || "", placeholder: "Eagle Director Skills.md", onInput: function (event) { config.obsidian.director_skills_file = event.target.value; } })]),
                  h("label", { class: "ds-field" }, [h("span", {}, "Local REST API（可选）"), h("input", { class: "ds-input", value: config.obsidian.api_url || "", onInput: function (event) { config.obsidian.api_url = event.target.value; } })]),
                  h("label", { class: "ds-field" }, [h("span", {}, "API Key（可选）"), h("input", { class: "ds-input", type: "password", value: config.obsidian.api_key || "", onInput: function (event) { config.obsidian.api_key = event.target.value; } })])
                ]),
                h("div", { style: { display: "flex", gap: "8px", marginTop: "11px", flexWrap: "wrap" } }, [
                  h("button", { class: "ppui-btn", disabled: settingsTesting.value, onClick: testObsidian }, settingsTesting.value ? "测试中…" : "测试连接"),
                  h("button", { class: "ppui-btn primary", disabled: settingsSyncing.value || !config.obsidian.enabled, onClick: syncObsidian }, settingsSyncing.value ? "同步中…" : "立即双向同步")
                ])
              ]),
              h("section", { class: "ds-setting-card" }, [
                h("h4", {}, "🎞️ 素材图像处理"),
                h("label", { class: "ds-field" }, [
                  h("span", {}, "最大百万像素（MP）"),
                  h("input", {
                    class: "ds-input", type: "number", min: "1", max: "10", step: "0.1",
                    value: config.director_skills.filmstrip_megapixels || 1,
                    onInput: function (event) { config.director_skills.filmstrip_megapixels = event.target.value; },
                    onChange: function (event) {
                      var value = Math.min(10, Math.max(1, Number(event.target.value) || 1));
                      config.director_skills.filmstrip_megapixels = value;
                      event.target.value = String(value);
                    }
                  })
                ]),
                h("div", { style: { marginTop: "7px", color: "#8f9bad", fontSize: "12px", lineHeight: 1.5 } },
                  "范围为 1–10 MP。超过目标的大图按原比例使用 Lanczos 缩小；较小图片保持原尺寸，不进行无意义放大。")
              ]),
              h("section", { class: "ds-setting-card" }, [
                h("h4", {}, "📁 当前本地技能库"),
                h("div", { style: { marginBottom: "6px", color: "#c8d5ea" } }, "来源：" + ({ eagle: "Eagle 节点", obsidian: "Obsidian", custom: "自定义 JSON" }[storageSource.value] || storageSource.value)),
                h("div", { title: storagePath.value, style: { color: "#9aa5b8", overflowWrap: "anywhere" } }, storagePath.value || "尚未加载")
              ]),
              settingsMessage.text ? h("div", { class: ["ds-message", settingsMessage.error ? "error" : ""] }, settingsMessage.text) : null
            ]),
            h("div", { class: "ds-modal-foot" }, [
              h("button", { class: "ppui-btn", onClick: function () { settingsOpen.value = false; } }, "取消"),
              h("button", { class: "ppui-btn primary", disabled: settingsSaving.value, onClick: function () { saveSettings(true); } }, settingsSaving.value ? "保存中…" : "保存")
            ])
          ])
        ]) : null,

        dialog.visible ? h("div", { class: "ds-modal-backdrop", onClick: function () { dialog.visible = false; } }, [
          h("div", { class: "ds-modal compact", onClick: function (event) { event.stopPropagation(); } }, [
            h("div", { class: "ds-modal-head" }, [h("h3", {}, dialog.title), h("button", { class: "ppui-btn", onClick: function () { dialog.visible = false; } }, "×")]),
            h("div", { class: "ds-modal-body" }, dialog.mode === "text"
              ? [h("label", { class: "ds-field" }, [h("span", {}, "名称"), h("input", { class: "ds-input", autofocus: true, value: dialog.value, onInput: function (event) { dialog.value = event.target.value; }, onKeydown: function (event) { if (event.key === "Enter") confirmDialog(); } })])]
              : [h("p", { style: { margin: 0, lineHeight: 1.6 } }, dialog.message)]),
            h("div", { class: "ds-modal-foot" }, [
              h("button", { class: "ppui-btn", onClick: function () { dialog.visible = false; } }, "取消"),
              h("button", { class: ["ppui-btn", dialog.mode === "confirm" ? "" : "primary"], style: dialog.mode === "confirm" ? { background: "#a43a3a", color: "#fff" } : {}, onClick: confirmDialog }, dialog.confirmText)
            ])
          ])
        ]) : null,

        toast.visible ? h("div", { class: ["ds-toast", toast.error ? "error" : ""] }, toast.text) : null
      ]);
    };
  }
};

function mountDirectorSkillNode(node) {
  if (!node || node._dsInit || node._dsMounting) return;
  node._dsMounting = true;
  var hiddenNames = ["director_skill", "ui_state"];
  var hide = function () {
    (node.widgets || []).forEach(function (widget) {
      if (hiddenNames.indexOf(widget.name) < 0) return;
      widget.type = "hidden";
      widget.hidden = true;
      widget.computeSize = function () { return [0, -4]; };
      widget.draw = function () {};
    });
  };
  try {
    loadStyles();
    node.serialize_widgets = true;
    node.setSize([840, 640]);
    hide();

    var container = document.createElement("div");
    container.className = "eagle-director-skill-host";
    container.style.cssText = "width:100%;max-width:100%;min-width:0;overflow:hidden;position:relative;";
    node._dsWidget = node.addDOMWidget("director_skill_ui", "div", container, {
      serialize: false,
      hideOnZoom: false
    });
    node._dsVueApp = createApp({
      render: function () { return h(DirectorSkillApp, { node: node }); }
    });
    node._dsVueApp.mount(container);
    node._dsContainer = container;

    node._dsSyncLayout = function (size) {
      var current = size || node.size || [840, 640];
      var height = Math.max(360, (Number(current[1]) || 640) - 96);
      container.style.height = height + "px";
      var host = container.parentElement;
      if (host) {
        host.style.width = "100%";
        host.style.maxWidth = "100%";
        host.style.minWidth = "0";
        host.style.boxSizing = "border-box";
        host.style.overflow = "hidden";
      }
    };

    var previousResize = node.onResize;
    node.onResize = function (size) {
      if (previousResize) previousResize.apply(this, arguments);
      this._dsSyncLayout?.(size);
    };
    var previousConfigure = node.onConfigure;
    node.onConfigure = function () {
      if (previousConfigure) previousConfigure.apply(this, arguments);
      hide();
      requestAnimationFrame(function () {
        node._dsSyncLayout?.(node.size);
        node._dsReloadSkills?.();
      });
    };
    var previousRemoved = node.onRemoved;
    node.onRemoved = function () {
      if (this._dsVueApp) this._dsVueApp.unmount();
      this._dsVueApp = null;
      this._dsContainer = null;
      this._dsReloadSkills = null;
      this._dsInit = false;
      this._dsMounting = false;
      if (previousRemoved) previousRemoved.apply(this, arguments);
    };

    node._dsInit = true;
    node._dsMounting = false;
    node._dsSyncLayout(node.size);
    requestAnimationFrame(function () { node._dsSyncLayout?.(node.size); });
    setTimeout(hide, 250);
  } catch (error) {
    node._dsInit = false;
    node._dsMounting = false;
    console.error("[Eagle Suite] Director Skill fallback mount failed:", error);
  }
}


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
            this._dsReloadSkills?.();
          }.bind(this));
        };

        var previousOnRemoved = this.onRemoved;
        this.onRemoved = function () {
          if (this._dsVueApp) this._dsVueApp.unmount();
          this._dsVueApp = null;
          this._dsContainer = null;
          this._dsWidget = null;
          this._dsSyncLayout = null;
          this._dsReloadSkills = null;
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
        if (container) {
          container.className = "eagle-director-skill-root";
          container.style.cssText = "height:100%;padding:16px;overflow:auto;";
          container.textContent = "Director Skill UI failed to initialize. Check the browser console and refresh after fixing the extension error.";
        }
      }
    };
  },

  // ComfyUI frontends do not all invoke prototype hooks in the same order.
  // Retry through the patched lifecycle after the concrete node exists.  The
  // _dsInit/_dsMounting guards make this idempotent on current frontends.
  nodeCreated(node) {
    if (!node || (node.comfyClass !== "EagleDirectorSkillNode" && node.type !== "EagleDirectorSkillNode")) return;
    setTimeout(function () { mountDirectorSkillNode(node); }, 0);
  },

  loadedGraphNode(node) {
    if (!node || (node.comfyClass !== "EagleDirectorSkillNode" && node.type !== "EagleDirectorSkillNode")) return;
    mountDirectorSkillNode(node);
    setTimeout(function () {
      node._dsSyncLayout?.(node.size);
      node._dsReloadSkills?.();
    }, 0);
  }
});

// Named exports make the Vue mount independently testable without relying on
// a particular ComfyUI frontend's internal LiteGraph globals.
export { DirectorSkillApp, mountDirectorSkillNode };
