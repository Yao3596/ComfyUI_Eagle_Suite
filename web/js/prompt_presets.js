import { app } from "../../../scripts/app.js";
import { createApp, h, ref, reactive, computed, onMounted, watch } from "../lib/vue.esm-browser.js";

// ============ 工具函数 ============
function generateId() {
  return 'tpl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function extractVariables(text) {
  const matches = text.match(/\{\{(\w+)\}\}/g) || [];
  return matches.map(m => m.replace(/\{\{|\}\}/g, ''));
}

function templateCoverUrl(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  return "/eaglePromptPresets/cover?path=" + encodeURIComponent(raw);
}

// ============ 子组件：模板编辑器 ============
var TemplateEditor = {
  name: "TemplateEditor",
  props: {
    visible: Boolean,
    template: Object,
    onClose: Function,
    onSave: Function
  },
  setup: function(props) {
    var coverInput = ref(null);
    var coverUploading = ref(false);
    var form = reactive({
      id: '',
      Label: '',
      Instruction: '',
      example: '',
      category: '图片编辑 (kontext)',
      tags: [],
      cover: ''
    });

    var variables = computed(function() {
      return extractVariables(form.Instruction);
    });

    watch(() => props.template, function(newVal) {
      if (newVal) {
        Object.assign(form, {
          id: '', Label: '', Instruction: '', example: '',
          category: '图片编辑 (kontext)', tags: [], cover: '', source: 'user'
        }, newVal);
      } else {
        Object.assign(form, {
          id: '',
          Label: '',
          Instruction: '',
          example: '',
          category: '图片编辑 (kontext)',
          tags: [],
          cover: ''
        });
      }
    }, { immediate: true });

    function handleSave() {
      if (!form.Label || !form.Instruction) {
        alert('请填写标签名称和指令模板');
        return;
      }
      props.onSave({ ...form });
    }

    async function uploadCover(file) {
      if (!file || !String(file.type || "").startsWith("image/")) {
        alert("请拖入或选择图片文件");
        return;
      }
      coverUploading.value = true;
      try {
        var body = new FormData();
        body.append("file", file, file.name || "cover.png");
        var response = await fetch("/eaglePromptPresets/upload_cover", { method: "POST", body: body });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "封面上传失败");
        form.cover = data.path;
      } catch (error) {
        alert(error.message || String(error));
      } finally {
        coverUploading.value = false;
        if (coverInput.value) coverInput.value.value = "";
      }
    }

    return function() {
      if (!props.visible) return null;

      return h("div", { class: "pp-modal-backdrop", onClick: props.onClose }, [
        h("div", {
          class: "pp-modal",
          onClick: function(e) { e.stopPropagation(); }
        }, [
          // 标题栏
          h("div", { class: "pp-modal-header" }, [
            h("span", { class: "pp-modal-title" }, props.template?.id ? "✏️ 编辑模板" : "➕ 新建模板"),
            h("button", { class: "pp-modal-close", onClick: props.onClose }, "×")
          ]),

          // 表单内容
          h("div", { class: "pp-modal-body" }, [
            // 标签名称
            h("div", { class: "pp-form-group" }, [
              h("label", { class: "pp-form-label" }, "标签名称"),
              h("input", {
                class: "pp-form-input",
                type: "text",
                value: form.Label,
                placeholder: "例：移除物体",
                onInput: function(e) { form.Label = e.target.value; }
              })
            ]),

            // 分类
            h("div", { class: "pp-form-group" }, [
              h("label", { class: "pp-form-label" }, "分类"),
              h("input", {
                class: "pp-form-input",
                type: "text",
                value: form.category,
                placeholder: "例：图片编辑",
                onInput: function(e) { form.category = e.target.value; }
              })
            ]),

            h("div", { class: "pp-form-group" }, [
              h("label", { class: "pp-form-label" }, [
                "小封面 ", h("span", { class: "pp-hint" }, "(可选：URL 或已配置模板目录内的本地图片)")
              ]),
              h("div", {
                class: ["pp-cover-editor", coverUploading.value ? "uploading" : ""],
                onDragover: function(e) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
                onDrop: function(e) { e.preventDefault(); uploadCover(e.dataTransfer.files && e.dataTransfer.files[0]); }
              }, [
                form.cover ? h("img", { src: templateCoverUrl(form.cover), onError: function(e) { e.currentTarget.style.visibility = "hidden"; } }) : h("span", { class: "pp-cover-fallback" }, (form.Label || "P").slice(0, 1)),
                h("div", { class: "pp-cover-fields" }, [
                  h("input", { class: "pp-form-input", type: "text", value: form.cover || "", placeholder: "拖入图片，或填写 URL / 本地路径", onInput: function(e) { form.cover = e.target.value; } }),
                  h("div", { class: "pp-cover-actions" }, [
                    h("button", { class: "pp-btn", disabled: coverUploading.value, onClick: function() { coverInput.value && coverInput.value.click(); } }, coverUploading.value ? "上传中…" : "选择封面"),
                    h("span", { class: "pp-hint" }, "支持 PNG / JPG / WebP / GIF，最大 8 MB"),
                    h("input", { ref: coverInput, type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", style: "display:none", onChange: function(e) { uploadCover(e.target.files && e.target.files[0]); } })
                  ])
                ])
              ])
            ]),

            // 指令模板
            h("div", { class: "pp-form-group" }, [
              h("label", { class: "pp-form-label" }, [
                "指令模板 ",
                h("span", { class: "pp-hint" }, "(使用 {{变量名}} 作为占位符)")
              ]),
              h("textarea", {
                class: "pp-form-textarea",
                value: form.Instruction,
                placeholder: "例：remove the {{target}} from {{position}}",
                rows: 3,
                onInput: function(e) { form.Instruction = e.target.value; }
              }),
              variables.value.length > 0 && h("div", { class: "pp-variables" }, [
                h("span", { class: "pp-var-label" }, "检测到变量："),
                ...variables.value.map(function(v) {
                  return h("span", { class: "pp-var-tag" }, "{{" + v + "}}");
                })
              ])
            ]),

            // 示例
            h("div", { class: "pp-form-group" }, [
              h("label", { class: "pp-form-label" }, "示例"),
              h("textarea", {
                class: "pp-form-textarea",
                value: form.example,
                placeholder: "例：remove the grapes from the left side",
                rows: 2,
                onInput: function(e) { form.example = e.target.value; }
              })
            ])
          ]),

          // 底部按钮
          h("div", { class: "pp-modal-footer" }, [
            h("button", { class: "pp-btn pp-btn-cancel", onClick: props.onClose }, "取消"),
            h("button", { class: "pp-btn pp-btn-primary", onClick: handleSave }, "保存")
          ])
        ])
      ]);
    };
  }
};

// ============ 子组件：导入对话框 ============
var ImportDialog = {
  name: "ImportDialog",
  props: {
    visible: Boolean,
    onClose: Function,
    onImported: Function
  },
  setup: function(props) {
    var fileInput = ref(null);
    var importing = ref(false);

    function handleImport() {
      if (!fileInput.value) return;
      fileInput.value.click();
    }

    function handleFileChange(e) {
      var file = e.target.files[0];
      if (!file) return;

      importing.value = true;
      var formData = new FormData();
      formData.append('file', file);

      fetch('/eaglePromptPresets/import_file', {
        method: 'POST',
        body: formData
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        importing.value = false;
        if (d.success) {
          alert('✅ 成功导入 ' + d.imported_count + ' 个模板');
          props.onImported();
          props.onClose();
        } else {
          alert('❌ 导入失败：' + d.error);
        }
      })
      .catch(function(e) {
        importing.value = false;
        alert('❌ 导入出错：' + e.message);
      });
    }

    return function() {
      if (!props.visible) return null;

      return h("div", { class: "pp-modal-backdrop", onClick: props.onClose }, [
        h("div", {
          class: "pp-modal pp-modal-sm",
          onClick: function(e) { e.stopPropagation(); }
        }, [
          h("div", { class: "pp-modal-header" }, [
            h("span", { class: "pp-modal-title" }, "📁 导入模板文件"),
            h("button", { class: "pp-modal-close", onClick: props.onClose }, "×")
          ]),

          h("div", { class: "pp-modal-body" }, [
            h("input", {
              ref: fileInput,
              type: "file",
              accept: ".json,.txt",
              style: "display:none",
              onChange: handleFileChange
            }),

            h("div", { class: "pp-import-info" }, [
              h("div", { class: "pp-import-icon" }, "📄"),
              h("p", {}, "支持的文件格式："),
              h("ul", {}, [
                h("li", {}, "JSON - 结构化模板数据"),
                h("li", {}, "TXT - 纯文本提示词（每行一条）")
              ]),
              h("button", {
                class: "pp-btn pp-btn-primary pp-btn-block",
                onClick: handleImport,
                disabled: importing.value
              }, importing.value ? "导入中..." : "选择文件")
            ])
          ])
        ])
      ]);
    };
  }
};

// 设置组件在文件后部赋值；主组件通过闭包在实际渲染时读取。
var SettingsDialog = null;

// ============ 主组件 ============
var PromptPresets = {
  name: "PromptPresets",
  props: { node: { type: Object, required: true } },
  components: { TemplateEditor, ImportDialog },

  setup: function(props) {
    var query = ref("");
    var category = ref("");
    var categories = ref([]);
    var variables = reactive({});
    var activeVariable = ref("");
    var allItems = ref([]);
    var selectedId = ref("");
    var visibleLimit = ref(120);
    var loading = ref(false);
    var errorMsg = ref("");

    // 编辑器状态
    var editorVisible = ref(false);
    var editingTemplate = ref(null);

    // 导入对话框
    var importVisible = ref(false);
    var settingsVisible = ref(false);

    var items = computed(function() {
      var kw = query.value.trim().toLowerCase();
      return allItems.value.filter(function(item) {
        if (category.value && item.category !== category.value) return false;
        if (!kw) return true;
        var tagText = Array.isArray(item.tags) ? item.tags.join(" ") : String(item.tags || "");
        return [item.Label, item.Instruction, item.example, tagText]
          .some(function(value) { return String(value || "").toLowerCase().indexOf(kw) >= 0; });
      });
    });

    var visibleItems = computed(function() { return items.value.slice(0, visibleLimit.value); });

    watch(function() { return [query.value, category.value]; }, function() { visibleLimit.value = 120; });

    var selectedTemplate = computed(function() {
      return items.value.find(function(item) { return String(item.id) === String(selectedId.value); }) || items.value[0] || null;
    });

    var selectedVariables = computed(function() {
      return selectedTemplate.value ? Array.from(new Set(extractVariables(selectedTemplate.value.Instruction || ""))) : [];
    });

    watch(selectedVariables, function(values) {
      if (!values.length) activeVariable.value = "";
      else if (values.indexOf(activeVariable.value) < 0) activeVariable.value = values[0];
    }, { immediate: true });

    var renderedPrompt = computed(function() {
      return renderTemplate(selectedTemplate.value);
    });

    function renderTemplate(item) {
      if (!item) return "";
      var text = item.Instruction || "";
      Array.from(new Set(extractVariables(item.Instruction || ""))).forEach(function(v) {
        text = text.replace(new RegExp("\\{\\{" + v + "\\}\\}", "g"), variables[v] || "{{" + v + "}}");
      });
      return text;
    }

    function setPromptWidget(val) {
      try {
        var w = (props.node.widgets || []).find(function(x) { return x.name === "prompt"; });
        if (w) w.value = val || "";
      } catch (e) {}
    }

    // 一次载入模板集合，关键词与分类在前端即时过滤。
    function loadList() {
      if (loading.value) return;
      loading.value = true;
      errorMsg.value = "";
      var url = "/eaglePromptPresets/search_template";

      fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(d) {
          loading.value = false;
          if (d.success) {
            allItems.value = d.data.list_data || [];
            if (d.data.categories) categories.value = d.data.categories;
            if (!selectedId.value || !allItems.value.some(function(item) { return String(item.id) === String(selectedId.value); })) {
              selectedId.value = allItems.value[0] ? allItems.value[0].id : "";
            }
          } else {
            errorMsg.value = d.error || "模板加载失败";
          }
        })
        .catch(function(e) {
          loading.value = false;
          errorMsg.value = e.message || String(e);
        });
    }

    function apply(item) {
      if (!item) return;
      setPromptWidget(renderTemplate(item));
    }

    function openEditor(template) {
      editingTemplate.value = template ? { ...template } : null;
      editorVisible.value = true;
    }

    function closeEditor() {
      editorVisible.value = false;
      editingTemplate.value = null;
    }

    function saveTemplate(template) {
      fetch('/eaglePromptPresets/save_template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: template })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) {
          alert('✅ 保存成功');
          closeEditor();
          selectedId.value = d.data && d.data.id ? d.data.id : selectedId.value;
          loadList();
        } else {
          alert('❌ 保存失败：' + d.error);
        }
      })
      .catch(function(e) {
        alert('❌ 保存出错：' + e.message);
      });
    }

    function deleteTemplate(template) {
      if (!confirm('确定要删除模板「' + template.Label + '」吗？')) return;

      fetch('/eaglePromptPresets/delete_template?id=' + template.id, {
        method: 'DELETE'
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) {
          alert('✅ 删除成功');
          selectedId.value = "";
          loadList();
        } else {
          alert('❌ 删除失败：' + d.error);
        }
      });
    }

    onMounted(function() {
      loadList();
    });

    return function() {
      var current = selectedTemplate.value;
      var currentSource = current && current.source || "built-in";
      var editable = current && currentSource !== "built-in" && currentSource !== "obsidian";

      return h("div", { class: "pp-root" }, [
        h("div", { class: "pp-toolbar" }, [
          h("select", {
            class: "pp-sel",
            value: category.value,
            onChange: function(e) { category.value = e.target.value; }
          }, [h("option", { value: "" }, "全部分类")].concat(categories.value.map(function(c) {
            return h("option", { value: c }, c);
          }))),

          h("input", {
            class: "pp-srch",
            type: "text",
            value: query.value,
            placeholder: "搜索名称、指令、示例或标签…",
            onInput: function(e) { query.value = e.target.value; },
          }),
          h("span", { class: "pp-count" }, items.value.length + " / " + allItems.value.length),

          h("div", { class: "pp-toolbar-right" }, [
            h("button", { class: "pp-btn pp-btn-icon", onClick: loadList, title: "刷新模板" }, "↻"),
            h("button", {
              class: "pp-btn pp-btn-icon",
              onClick: function() { importVisible.value = true; },
              title: "导入模板"
            }, "📁"),
            h("button", {
              class: "pp-btn pp-btn-primary",
              onClick: function() { openEditor(null); }
            }, "＋ 新建"),
            h("button", { class: "pp-btn pp-btn-icon", onClick: function() { settingsVisible.value = true; }, title: "模板来源设置" }, "⚙")
          ])
        ]),

        h("div", { class: "pp-workbench" }, [
          h("aside", { class: "pp-master", onScroll: function(e) {
            var el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100 && visibleLimit.value < items.value.length) visibleLimit.value += 120;
          } }, [
            loading.value ? h("div", { class: "pp-loading compact" }, "加载中…")
              : errorMsg.value ? h("div", { class: "pp-error" }, errorMsg.value)
              : items.value.length === 0 ? h("div", { class: "pp-empty" }, "没有匹配模板")
              : visibleItems.value.map(function(item) {
                var vars = extractVariables(item.Instruction || "");
                return h("button", {
                  class: ["pp-master-item", String(current && current.id) === String(item.id) ? "active" : ""],
                  key: item.id,
                  onClick: function() { selectedId.value = item.id; },
                  onDblclick: function() { selectedId.value = item.id; apply(item); },
                }, [
                  item.cover ? h("img", { class: "pp-master-cover", src: templateCoverUrl(item.cover), loading: "lazy", onError: function(e) { e.currentTarget.style.display = "none"; } })
                    : h("span", { class: "pp-master-cover fallback" }, (item.Label || "P").slice(0, 1)),
                  h("span", { class: "pp-master-copy" }, [
                    h("span", { class: "pp-master-label" }, item.Label || "未命名模板"),
                    h("span", { class: "pp-master-meta" }, [
                      h("span", {}, item.category || "未分类"),
                      vars.length ? h("span", { class: "pp-var-count" }, vars.length + " 变量") : null,
                    ]),
                  ]),
                ]);
              }),
          ]),

          h("main", { class: "pp-detail" }, current ? [
            h("div", { class: "pp-detail-head" }, [
              h("div", { class: "pp-detail-identity" }, [
                current.cover ? h("img", { class: "pp-detail-cover", src: templateCoverUrl(current.cover), onError: function(e) { e.currentTarget.style.display = "none"; } }) : h("span", { class: "pp-detail-cover fallback" }, (current.Label || "P").slice(0, 1)),
                h("div", {}, [h("h3", {}, current.Label), h("div", { class: "pp-detail-meta" }, (current.category || "未分类") + " · " + (currentSource === "built-in" ? "内置" : currentSource === "obsidian" ? "Obsidian" : "自定义"))]),
              ]),
              h("div", { class: "pp-card-actions" }, [
                h("button", { class: "pp-btn", title: currentSource === "built-in" || currentSource === "obsidian" ? "只读来源会另存为自定义模板" : "编辑当前模板", onClick: function() { openEditor(current); } }, "✏ 编辑"),
                h("button", { class: "pp-btn", onClick: function() { openEditor({ ...current, id: "", source: "user", Label: current.Label + " 副本" }); } }, "另存副本"),
                editable ? h("button", { class: "pp-icon-btn pp-icon-btn-danger", title: "删除", onClick: function() { deleteTemplate(current); } }, "🗑") : null,
              ]),
            ]),
            h("section", { class: "pp-template-source" }, [
              h("div", { class: "pp-section-label" }, "指令模板"),
              h("pre", {}, current.Instruction || ""),
              current.example ? h("div", { class: "pp-ex" }, "示例：" + current.example) : null,
            ]),
            selectedVariables.value.length ? h("section", { class: "pp-vars-editor" }, [
              h("div", { class: "pp-section-label pp-var-heading" }, [
                h("span", {}, "变量"),
                h("span", { class: "pp-hint" }, "也可从左侧 variables 端口输入 JSON 或每行 key=value")
              ]),
              h("div", { class: "pp-var-switcher" }, [
                h("select", { class: "pp-var-select", value: activeVariable.value, onChange: function(e) { activeVariable.value = e.target.value; } },
                  selectedVariables.value.map(function(v) { return h("option", { value: v, key: v }, "{{" + v + "}}"); })),
                h("input", {
                  class: "pp-var-input",
                  value: variables[activeVariable.value] || "",
                  placeholder: activeVariable.value ? "输入 " + activeVariable.value : "选择变量",
                  onInput: function(e) { if (activeVariable.value) variables[activeVariable.value] = e.target.value; }
                })
              ]),
              h("div", { class: "pp-var-tabs" }, selectedVariables.value.map(function(v) {
                return h("button", { class: ["pp-var-tag", activeVariable.value === v ? "active" : ""], onClick: function() { activeVariable.value = v; } }, v);
              })),
            ]) : null,
            h("section", { class: "pp-preview" }, [
              h("div", { class: "pp-section-label" }, "输出预览"),
              h("textarea", { readOnly: true, value: renderedPrompt.value }),
            ]),
            h("div", { class: "pp-detail-actions" }, [
              h("button", { class: "pp-btn", onClick: function() { navigator.clipboard?.writeText(renderedPrompt.value).catch(function() {}); } }, "复制"),
              h("button", { class: "pp-btn pp-btn-apply", onClick: function() { apply(current); } }, "应用到节点输出"),
            ]),
          ] : [h("div", { class: "pp-empty" }, "选择或新建模板")]),
        ]),

        // 编辑器弹窗
        h(TemplateEditor, {
          visible: editorVisible.value,
          template: editingTemplate.value,
          onClose: closeEditor,
          onSave: saveTemplate
        }),

        // 导入对话框
        h(ImportDialog, {
          visible: importVisible.value,
          onClose: function() { importVisible.value = false; },
          onImported: loadList
        }),
        h(SettingsDialog, { visible: settingsVisible.value, onClose: function() { settingsVisible.value = false; } })
      ]);
    };
  }
};

// ============ CSS 样式 ============
var CSS = `
/* 基础样式 */
.pp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #121216;
  color: #bbb;
  font: 12px/1.5 system-ui;
  overflow: hidden;
}

/* 工具栏 */
.pp-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: #1a1a22;
  border-bottom: 1px solid #2a2a32;
  align-items: center;
  flex-wrap: wrap;
}

.pp-toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.pp-count { color:#73737e; font-size:10px; white-space:nowrap; }

/* 无分页主从工作台：列表只创建轻量行，变量和预览只渲染当前模板。 */
.pp-workbench { flex:1; min-height:0; display:grid; grid-template-columns:minmax(180px,34%) minmax(0,1fr); }
.pp-master { min-height:0; overflow-y:auto; padding:7px; border-right:1px solid #2a2a32; background:#15151b; }
.pp-master-item { width:100%; display:flex; flex-direction:row; align-items:center; gap:8px; padding:7px 8px; margin-bottom:4px; border:1px solid transparent; border-radius:6px; background:transparent; color:#bbb; text-align:left; cursor:pointer; }
.pp-master-item:hover { background:#20202a; }
.pp-master-item.active { background:#24344d; border-color:#4776bb; }
.pp-master-cover,.pp-detail-cover { flex:0 0 auto; width:34px; height:34px; border-radius:6px; object-fit:cover; background:#282833; border:1px solid #3c3c47; }
.pp-master-cover.fallback,.pp-detail-cover.fallback,.pp-cover-fallback { display:inline-flex; align-items:center; justify-content:center; color:#d9d9e2; background:linear-gradient(135deg,#4a3c69,#24445e); font-weight:700; }
.pp-master-copy { min-width:0; display:flex; flex:1; flex-direction:column; gap:3px; }
.pp-detail-identity { min-width:0; display:flex; align-items:center; gap:9px; }
.pp-detail-cover { width:42px; height:42px; }
.pp-cover-editor { display:flex; align-items:center; gap:8px; padding:6px; border:1px dashed #454555; border-radius:8px; transition:border-color .15s,background .15s; }
.pp-cover-editor:hover,.pp-cover-editor.uploading { border-color:#668bd1; background:#202535; }
.pp-cover-editor img,.pp-cover-fallback { width:48px; height:48px; flex:0 0 48px; object-fit:cover; border-radius:7px; border:1px solid #3b3b47; }
.pp-cover-fields { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
.pp-cover-editor .pp-form-input { width:100%; min-width:0; }
.pp-cover-actions { display:flex; align-items:center; gap:7px; }
.pp-master-label { color:#eee; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
.pp-master-meta { display:flex; gap:7px; color:#777d89; font-size:9px; overflow:hidden; }
.pp-master-meta > span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pp-var-count { margin-left:auto; color:#8aa8d8; white-space:nowrap; }
.pp-detail { min-width:0; min-height:0; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
.pp-detail-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
.pp-detail-head h3 { margin:0; color:#fff; font-size:15px; }
.pp-detail-meta { color:#777d89; font-size:10px; margin-top:3px; }
.pp-section-label { color:#8f96a4; font-size:10px; margin-bottom:5px; font-weight:600; }
.pp-template-source,.pp-vars-editor,.pp-preview { padding:9px; border:1px solid #2d2d37; border-radius:7px; background:#17171e; }
.pp-var-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.pp-var-switcher { display:grid; grid-template-columns:minmax(120px,.36fr) minmax(0,1fr); gap:7px; }
.pp-var-select,.pp-var-input { min-width:0; border:1px solid #3a3a47; background:#101016; color:#e5e5eb; border-radius:5px; padding:7px 8px; }
.pp-var-tabs { display:flex; flex-wrap:wrap; gap:5px; margin-top:7px; }
.pp-var-tabs .pp-var-tag { cursor:pointer; border:1px solid #44485a; background:#272936; color:#b9bfd0; border-radius:4px; padding:3px 7px; }
.pp-var-tabs .pp-var-tag.active { border-color:#668bd1; background:#263c63; color:#fff; }
.pp-template-source pre { margin:0; color:#d2d2d8; font:11px/1.55 Consolas,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
.pp-preview textarea { width:100%; min-height:84px; box-sizing:border-box; resize:vertical; border:1px solid #34343e; border-radius:5px; background:#0d0d11; color:#b8d6b7; padding:8px; font:11px/1.5 Consolas,monospace; }
.pp-detail-actions { margin-top:auto; display:flex; justify-content:flex-end; gap:7px; }
.pp-error { padding:12px; color:#ff8b8b; overflow-wrap:anywhere; }
.pp-loading.compact { padding:20px 8px; }
@media (max-width:620px) { .pp-workbench { grid-template-columns:1fr; grid-template-rows:minmax(150px,36%) minmax(0,1fr); } .pp-master { border-right:0; border-bottom:1px solid #2a2a32; } }

.pp-srch {
  flex: 1;
  min-width: 120px;
  padding: 6px 10px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #0e0e12;
  color: #c8c8cc;
  font-size: 12px;
  transition: all 0.2s;
}

.pp-srch:focus {
  outline: none;
  border-color: #4a7de0;
  background: #16161e;
}

.pp-sel {
  padding: 6px 8px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #0e0e12;
  color: #c8c8cc;
  font-size: 11px;
  cursor: pointer;
}

.pp-btn {
  padding: 6px 12px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #1c1c26;
  color: #c8c8cc;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.pp-btn:hover:not(:disabled) {
  background: #2a2a36;
  border-color: #4a7de0;
  color: #fff;
}

.pp-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pp-btn-primary {
  background: linear-gradient(135deg, #4a7de0, #3d6bd9);
  border-color: #4a7de0;
  color: #fff;
  font-weight: 500;
}

.pp-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #5a8df0, #4d7be9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(74, 125, 224, 0.3);
}

.pp-btn-icon {
  padding: 6px 10px;
  font-size: 14px;
}

/* 变量面板 */
.pp-variables-panel {
  padding: 10px;
  background: #16161e;
  border-bottom: 1px solid #2a2a32;
}

.pp-var-title {
  font-size: 11px;
  color: #888;
  margin-bottom: 8px;
  font-weight: 500;
}

.pp-var-inputs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}

.pp-var-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pp-var-name {
  font-size: 11px;
  color: #999;
  min-width: 60px;
}

.pp-var-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #333;
  border-radius: 4px;
  background: #0e0e12;
  color: #c8c8cc;
  font-size: 11px;
}

/* 模板列表 */
.pp-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pp-card {
  background: #1a1a24;
  border: 1px solid #2a2a32;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
}

.pp-card:hover {
  border-color: #4a7de0;
  box-shadow: 0 2px 8px rgba(74, 125, 224, 0.2);
}

.pp-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: #1e1e2a;
  border-bottom: 1px solid #2a2a32;
}

.pp-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pp-card-label {
  font-size: 13px;
  color: #fff;
  font-weight: 600;
}

.pp-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
}

.pp-badge-user {
  background: #2a4a7d;
  color: #8ab4f8;
}

.pp-badge-imported {
  background: #4a2a7d;
  color: #c8a8f8;
}

.pp-card-actions {
  display: flex;
  gap: 4px;
}

.pp-icon-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  font-size: 12px;
}

.pp-icon-btn:hover {
  background: #2a2a36;
}

.pp-icon-btn-danger:hover {
  background: #4a2a2a;
}

.pp-card-body {
  padding: 10px 12px;
}

.pp-ins {
  font-size: 11px;
  color: #ccc;
  margin-bottom: 6px;
  font-family: 'Consolas', monospace;
}

.pp-ex {
  font-size: 10px;
  color: #888;
  font-style: italic;
  margin-bottom: 6px;
}

.pp-vars {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}

.pp-vars-label {
  font-size: 10px;
  color: #666;
}

.pp-var-tag {
  padding: 2px 6px;
  background: #2a2a36;
  border-radius: 4px;
  font-size: 9px;
  color: #8ab4f8;
  font-family: 'Consolas', monospace;
}

.pp-card-footer {
  padding: 8px 12px;
  background: #16161e;
  border-top: 1px solid #2a2a32;
  display: flex;
  justify-content: flex-end;
}

.pp-btn-apply {
  background: linear-gradient(135deg, #2a7d4a, #238a3d);
  border-color: #2a7d4a;
  color: #fff;
  font-weight: 500;
}

.pp-btn-apply:hover {
  background: linear-gradient(135deg, #3a8d5a, #339a4d);
  transform: translateY(-1px);
}

/* 空状态 */
.pp-empty {
  padding: 60px 20px;
  text-align: center;
  color: #666;
}

.pp-empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

/* 加载状态 */
.pp-loading {
  padding: 60px 20px;
  text-align: center;
  color: #888;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.pp-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #2a2a32;
  border-top-color: #4a7de0;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 弹窗背景 */
.pp-modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

/* 弹窗容器 */
.pp-modal {
  background: #1a1a24;
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  border: 1px solid #2a2a32;
}

.pp-modal-sm {
  max-width: 480px;
}
.pp-modal-lg { max-width:760px; }
.pp-settings { display:flex; flex-direction:column; gap:12px; }
.pp-section { border:1px solid #2d2d37; border-radius:8px; overflow:hidden; background:#17171e; }
.pp-section-header,.pp-section-title { display:flex; align-items:center; justify-content:space-between; margin:0; padding:10px 12px; color:#ddd; border-bottom:1px solid #2d2d37; font-size:12px; }
.pp-section-body { padding:12px; }
.pp-path-list { display:flex; flex-direction:column; gap:5px; margin-bottom:8px; }
.pp-path-item,.pp-path-add { display:flex; align-items:center; gap:7px; }
.pp-path-text { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#aaa; }
.pp-path-add .pp-form-input { flex:1; }
.pp-test-area { display:flex; align-items:center; gap:8px; }
.pp-test-result { color:#9ab9e8; }
.pp-switch { display:flex; align-items:center; }
.pp-switch input { accent-color:#4a7de0; }

.pp-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #2a2a32;
  background: #1e1e2a;
}

.pp-modal-title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.pp-modal-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #888;
  font-size: 24px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
  line-height: 1;
}

.pp-modal-close:hover {
  background: #2a2a36;
  color: #fff;
}

.pp-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.pp-modal-footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid #2a2a32;
  background: #16161e;
}

/* 表单 */
.pp-form-group {
  margin-bottom: 16px;
}

.pp-form-label {
  display: block;
  font-size: 12px;
  color: #999;
  margin-bottom: 6px;
  font-weight: 500;
}

.pp-hint {
  font-size: 10px;
  color: #666;
  font-weight: 400;
}

.pp-form-input, .pp-form-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #333;
  border-radius: 6px;
  background: #0e0e12;
  color: #c8c8cc;
  font-size: 12px;
  font-family: inherit;
  transition: all 0.2s;
}

.pp-form-textarea {
  resize: vertical;
  min-height: 60px;
  font-family: 'Consolas', monospace;
}

.pp-form-input:focus, .pp-form-textarea:focus {
  outline: none;
  border-color: #4a7de0;
  background: #16161e;
}

.pp-variables {
  margin-top: 8px;
  padding: 8px 12px;
  background: #16161e;
  border-radius: 6px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.pp-var-label {
  font-size: 10px;
  color: #666;
}

.pp-btn-cancel {
  background: #2a2a32;
  border-color: #2a2a32;
}

.pp-btn-cancel:hover {
  background: #3a3a42;
}

.pp-btn-block {
  width: 100%;
  margin-top: 16px;
}

/* 导入区域 */
.pp-import-info {
  text-align: center;
  padding: 20px;
}

.pp-import-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.7;
}

.pp-import-info p {
  margin-bottom: 12px;
  color: #999;
  font-size: 12px;
}

.pp-import-info ul {
  list-style: none;
  padding: 0;
  margin: 0 0 20px 0;
  color: #888;
  font-size: 11px;
}

.pp-import-info li {
  padding: 4px 0;
}

/* 滚动条 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: #0e0e12;
}

::-webkit-scrollbar-thumb {
  background: #2a2a32;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #3a3a42;
}
`;

// ============ 注册扩展 ============
app.registerExtension({
  name: "EagleSuite.PromptPresets",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "EaglePromptPresets") return;

    var hideWidgets = function(node) {
      if (!node.widgets || !node.widgets.length) return false;
      var found = false;
      for (var i = 0; i < node.widgets.length; i++) {
        var w = node.widgets[i];
        if (w.name !== "prompt") continue;
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
      if (this._ppInit) return;
      this._ppInit = true;

      this.setSize([560, 600]);
      setTimeout(function(node) {
        return function() {
          if (!hideWidgets(node)) setTimeout(function() { hideWidgets(node); }, 500);
        };
      }(this), 300);

      if (!document.getElementById("pp-style")) {
        var s = document.createElement("style");
        s.id = "pp-style";
        s.textContent = CSS;
        document.head.appendChild(s);
      }

      var el = document.createElement("div");
      el.style.cssText = "width:100%;height:100%;overflow:hidden;border-radius:0 0 8px 8px;background:#121216;";
      this.addDOMWidget("prompt_presets", "div", el, { serialize: false });

      var applyHeight = function(h) { el.style.height = Math.max(400, h - 64) + "px"; };
      applyHeight(this.size[1]);

      var nodeRef = this;
      try {
        var appInstance = createApp(PromptPresets, { node: nodeRef });
        appInstance.mount(el);
        this._vueApp = appInstance;
      } catch (e) {
        console.error("[PromptPresets] mount failed:", e);
        el.innerHTML = '<div style="padding:30px;color:#e55">Error: ' + e.message + "</div>";
      }

      var onResize = this.onResize;
      this.onResize = function(size) {
        if (onResize) onResize.apply(this, arguments);
        applyHeight(size[1]);
      };
    };

    var onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function() {
      if (this._vueApp) { this._vueApp.unmount(); this._vueApp = null; }
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  }
});
// 新增：设置对话框组件
SettingsDialog = {
  name: "SettingsDialog",
  props: {
    visible: Boolean,
    onClose: Function
  },
  setup: function(props) {
    var config = ref({
      obsidian: {
        enabled: false,
        api_url: "https://127.0.0.1:27124",
        api_key: "",
        vault_path: "",
        prompts_folder: "ComfyUI/Prompts"
      },
      local_paths: [],
      auto_sync: true
    });

    var testing = ref(false);
    var testResult = ref("");
    var loading = ref(false);
    var newPath = ref("");

    function loadConfig() {
      loading.value = true;
      fetch('/eaglePromptPresets/config')
        .then(function(r) { return r.json(); })
        .then(function(d) {
          loading.value = false;
          if (d.success) {
            config.value = d.data;
          }
        })
        .catch(function(e) {
          loading.value = false;
          alert('加载配置失败: ' + e.message);
        });
    }

    function saveConfig() {
      fetch('/eaglePromptPresets/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: config.value })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) {
            alert('✅ 配置已保存');
            props.onClose();
          } else {
            alert('❌ 保存失败: ' + d.error);
          }
        })
        .catch(function(e) {
          alert('❌ 保存出错: ' + e.message);
        });
    }

    function testConnection() {
      testing.value = true;
      testResult.value = "";

      fetch('/eaglePromptPresets/test_obsidian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_url: config.value.obsidian.api_url,
          api_key: config.value.obsidian.api_key,
          vault_path: config.value.obsidian.vault_path,
          prompts_folder: config.value.obsidian.prompts_folder
        })
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          testing.value = false;
          if (d.success) {
            testResult.value = "✅ " + d.message;
          } else {
            testResult.value = "❌ " + d.error;
          }
        })
        .catch(function(e) {
          testing.value = false;
          testResult.value = "❌ 连接失败: " + e.message;
        });
    }

    function addPath() {
      if (newPath.value && config.value.local_paths.indexOf(newPath.value) < 0) {
        config.value.local_paths.push(newPath.value);
        newPath.value = "";
      }
    }

    function removePath(index) {
      config.value.local_paths.splice(index, 1);
    }

    watch(() => props.visible, function(val) {
      if (val) loadConfig();
    });

    return function() {
      if (!props.visible) return null;

      return h("div", { class: "pp-modal-backdrop", onClick: props.onClose }, [
        h("div", {
          class: "pp-modal pp-modal-lg",
          onClick: function(e) { e.stopPropagation(); }
        }, [
          h("div", { class: "pp-modal-header" }, [
            h("span", { class: "pp-modal-title" }, "⚙️ 设置"),
            h("button", { class: "pp-modal-close", onClick: props.onClose }, "×")
          ]),

          h("div", { class: "pp-modal-body pp-settings" }, [
            // Obsidian 集成
            h("div", { class: "pp-section" }, [
              h("div", { class: "pp-section-header" }, [
                h("h3", {}, "🗒️ Obsidian 集成"),
                h("label", { class: "pp-switch" }, [
                  h("input", {
                    type: "checkbox",
                    checked: config.value.obsidian.enabled,
                    onChange: function(e) { config.value.obsidian.enabled = e.target.checked; }
                  }),
                  h("span", { class: "pp-switch-slider" })
                ])
              ]),

              config.value.obsidian.enabled && h("div", { class: "pp-section-body" }, [
                h("div", { class: "pp-form-group" }, [
                  h("label", { class: "pp-form-label" }, [
                    "API URL ",
                    h("span", { class: "pp-hint" }, "(可选；Local REST API 常用 HTTPS 27124)")
                  ]),
                  h("input", {
                    class: "pp-form-input",
                    type: "text",
                    value: config.value.obsidian.api_url,
                    placeholder: "https://127.0.0.1:27124",
                    onInput: function(e) { config.value.obsidian.api_url = e.target.value; }
                  })
                ]),

                h("div", { class: "pp-form-group" }, [
                  h("label", { class: "pp-form-label" }, "API Key"),
                  h("input", {
                    class: "pp-form-input",
                    type: "password",
                    value: config.value.obsidian.api_key,
                    placeholder: "输入 API Key",
                    onInput: function(e) { config.value.obsidian.api_key = e.target.value; }
                  })
                ]),

                h("div", { class: "pp-form-group" }, [
                  h("label", { class: "pp-form-label" }, ["本地 Vault / 提示词目录 ", h("span", { class: "pp-hint" }, "(可选；填写后直接读取，不依赖 REST API)")]),
                  h("input", {
                    class: "pp-form-input",
                    type: "text",
                    value: config.value.obsidian.vault_path || "",
                    placeholder: "D:\\知识仓库\\提示词库",
                    onInput: function(e) { config.value.obsidian.vault_path = e.target.value; }
                  })
                ]),

                h("div", { class: "pp-form-group" }, [
                  h("label", { class: "pp-form-label" }, "Vault 内提示词相对目录（API 模式）"),
                  h("input", {
                    class: "pp-form-input",
                    type: "text",
                    value: config.value.obsidian.prompts_folder,
                    placeholder: "ComfyUI/Prompts",
                    onInput: function(e) { config.value.obsidian.prompts_folder = e.target.value; }
                  }),
                  h("div", { class: "pp-hint" }, "这里不能填写 D:\\... 绝对路径；绝对路径请填上面的本地目录。")
                ]),

                h("div", { class: "pp-test-area" }, [
                  h("button", {
                    class: "pp-btn",
                    onClick: testConnection,
                    disabled: testing.value
                  }, testing.value ? "测试中..." : "测试连接"),
                  testResult.value && h("span", { class: "pp-test-result" }, testResult.value)
                ])
              ])
            ]),

            // 本地路径管理
            h("div", { class: "pp-section" }, [
              h("h3", { class: "pp-section-title" }, "📁 本地模板路径"),
              h("div", { class: "pp-section-body" }, [
                h("div", { class: "pp-path-list" },
                  config.value.local_paths.map(function(path, index) {
                    return h("div", { class: "pp-path-item", key: index }, [
                      h("span", { class: "pp-path-text" }, path),
                      h("button", {
                        class: "pp-icon-btn pp-icon-btn-danger",
                        onClick: function() { removePath(index); }
                      }, "🗑️")
                    ]);
                  })
                ),

                h("div", { class: "pp-path-add" }, [
                  h("input", {
                    class: "pp-form-input",
                    type: "text",
                    value: newPath.value,
                    placeholder: "输入文件夹路径",
                    onInput: function(e) { newPath.value = e.target.value; }
                  }),
                  h("button", { class: "pp-btn", onClick: addPath }, "➕ 添加")
                ])
              ])
            ])
          ]),

          h("div", { class: "pp-modal-footer" }, [
            h("button", { class: "pp-btn pp-btn-cancel", onClick: props.onClose }, "取消"),
            h("button", { class: "pp-btn pp-btn-primary", onClick: saveConfig }, "保存")
          ])
        ])
      ]);
    };
  }
};
