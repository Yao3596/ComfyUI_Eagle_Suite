/**
 * Eagle API Key Input - 密码输入控件（混淆存储）
 * localStorage / 工作流 JSON 存 ENC:base64，执行时传明文给 Python
 */

import { app } from "../../../scripts/app.js";

// ── 混淆工具（Base64，防止明文直接暴露）─────────────────────────
const _ENC_PREFIX = 'ENC:'

function _encodeKey(str) {
  if (!str) return ''
  try { return _ENC_PREFIX + btoa(encodeURIComponent(str)) } catch { return str }
}

function _decodeKey(str) {
  if (!str) return ''
  if (typeof str === 'string' && str.startsWith(_ENC_PREFIX)) {
    try { return decodeURIComponent(atob(str.slice(_ENC_PREFIX.length))) } catch { return str }
  }
  return str  // 兼容旧版明文，平滑迁移
}

// ── 路径工具 ─────────────────────────────────────────────────
/**
 * 去除路径字符串两端空白和引号（支持 "path"、'path'、"path 等常见形式）
 */
function _stripPath(val) {
  if (!val) return '';
  let s = String(val).trim();
  // 循环去除外层引号
  while (s.length > 1 && (s[0] === '"' || s[0] === "'") && (s[s.length - 1] === '"' || s[s.length - 1] === "'")) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * 将 ComfyUI 的 STRING widget 转换为 COMBO 下拉列表。
 * 覆盖 widget.draw 渲染为原生 <select> 元素。
 */
function _convertToCombo(node, widget, values) {
    if (!widget || !values?.length) return;
    widget.type = 'combo';
    widget.options = widget.options || {};
    widget.options.values = values;
    // 强制重建 widget DOM
    node.setDirtyCanvas(true, true);
}

// ── EagleAPILoader 模型预加载工具 ─────────────────────────────
/**
 * 从配置文件读取 base_url 和 api_key，然后请求 /api_loader/models 获取模型列表，
 * 并更新 model_name 下拉 widget 的 options。
 */
async function _safeJson(res) {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (e) {
        console.warn('[EagleAPILoader] 后端返回非 JSON:', text.slice(0, 200));
        return { success: false, error: '后端返回格式错误' };
    }
}

/**
 * 读取配置文件，把所有 profile 名称填充到 model_name 下拉列表
 */
async function _refreshProfileOptions(node, configPath) {
    const modelWidget = node.widgets?.find(w => w.name === 'model_name');
    if (!modelWidget) return;

    try {
        const res = await fetch('/api_loader/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config_path: configPath || '' }),
        });
        if (res.status === 405 || res.status === 404) {
            console.warn('[EagleAPILoader] 后端路由未注册，请重启 ComfyUI 后重试');
            return;
        }
        if (!res.ok) {
            console.warn(`[EagleAPILoader] /profiles HTTP ${res.status}`);
            return;
        }
        const data = await _safeJson(res);
        if (!data.success || !data.profiles?.length) {
            console.warn('[EagleAPILoader] 配置文件中无可用 profile');
            return;
        }

        const profiles = data.profiles;
        modelWidget.options = modelWidget.options || {};
        modelWidget.options.values = profiles;

        // 如果 model_name 当前是 STRING 类型，转为 COMBO 下拉
        if (modelWidget.type === 'string' || !modelWidget.type) {
            _convertToCombo(node, modelWidget, profiles);
        }

        const current = modelWidget.value?.trim();
        if (!current || !profiles.includes(current)) {
            modelWidget.value = profiles[0];
        }

        console.log('[EagleAPILoader] 已加载', profiles.length, '个配置:', profiles);
        node.setDirtyCanvas(true, true);
    } catch (e) {
        console.warn('[EagleAPILoader] 刷新配置列表失败:', e);
    }
}

/**
 * 加载指定 profile 的详细信息（base_url / api_key / model），缓存到节点上
 */
async function _loadModelsForProfile(node, profileName) {
    if (!profileName) return;

    const configPathWidget = node.widgets?.find(w => w.name === 'config_path');
    const configPath = _stripPath(configPathWidget?.value);

    try {
        const res = await fetch('/api_loader/profile_info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile_name: profileName, config_path: configPath }),
        });
        if (!res.ok) {
            console.warn(`[EagleAPILoader] /profile_info HTTP ${res.status} — 后端未加载？`);
            return;
        }
        const data = await _safeJson(res);
        if (!data.success) return;

        // 缓存 profile 信息到节点，供其他逻辑使用
        node._profileInfo = data;
        console.log('[EagleAPILoader] 已加载配置详情:', profileName, data.base_url);
    } catch (e) {
        console.warn('[EagleAPILoader] 获取 profile 信息失败:', e);
    }
}

/**
 * 打开文件选择器并上传选中的 JSON 配置文件到后端，
 * 返回服务器端保存的文件路径。
 */
async function _selectConfigFile() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) {
                document.body.removeChild(input);
                resolve('');
                return;
            }

            // Electron 环境：直接获取完整路径
            if (file.path) {
                document.body.removeChild(input);
                resolve(file.path);
                return;
            }

            // 浏览器环境：通过后端原生对话框获取真实路径
            try {
                const res = await fetch('/api_loader/pick_file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });
                const data = await _safeJson(res);
                if (data.success && data.path) {
                    resolve(data.path);
                } else {
                    // 兜底：上传文件到临时目录
                    const formData = new FormData();
                    formData.append('file', file);
                    const res2 = await fetch('/api_loader/select_config_file', {
                        method: 'POST',
                        body: formData,
                    });
                    const data2 = await _safeJson(res2);
                    resolve(data2.success ? data2.path : '');
                }
            } catch (e) {
                console.warn('[EagleAPILoader] 文件选择失败:', e);
                resolve('');
            } finally {
                document.body.removeChild(input);
            }
        });

        input.click();
    });
}

// ────────────────────────────────────────────────────────────────
app.registerExtension({
  name: 'Eagle.APIKeyInput',

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    // ── EagleAPIKeyNode：密码输入控件 ────────────────────────
    if (nodeData.name === 'EagleAPIKeyNode') {
      // ── 加载工作流时解码 ─────────────────────────────────────
      const onConfigure = nodeType.prototype.onConfigure
      nodeType.prototype.onConfigure = function (widgets_values) {
        let decoded_values = widgets_values
        if (Array.isArray(widgets_values) && widgets_values.length > 0) {
          decoded_values = [...widgets_values]
          decoded_values[0] = _decodeKey(widgets_values[0])
        }
        onConfigure?.apply(this, [decoded_values])

        const plain = (decoded_values?.[0] || '').trim()
        if (plain) {
          const w = this.widgets?.find(w => w.name === 'api_key')
          if (w) w.value = plain
          if (this._eagleKeyInput) this._eagleKeyInput.value = plain
        }
      }

      // ── 节点创建 ─────────────────────────────────────────────
      const origNodeCreated = nodeType.prototype.onNodeCreated
      nodeType.prototype.onNodeCreated = function () {
        origNodeCreated?.apply(this, arguments)
        const node = this

        const originalWidget = node.widgets?.find(w => w.name === 'api_key')
        if (originalWidget) {
          originalWidget.type = 'hidden'
          originalWidget.computeSize = () => [0, -4]
        }

        const origSerialize = node.serialize?.bind(node)
        node.serialize = function () {
          const data = origSerialize ? origSerialize() : {}
          if (data.widgets_values && originalWidget) {
            const idx = node.widgets.indexOf(originalWidget)
            if (idx >= 0) {
              data.widgets_values[idx] = _encodeKey(originalWidget.value || '')
            }
          }
          return data
        }

        const container = document.createElement('div')
        container.style.cssText = 'position:absolute;pointer-events:auto;z-index:10;'
        document.body.appendChild(container)

        const ip = document.createElement('input')
        ip.type = 'password'
        ip.placeholder = '输入 API Key'
        ip.style.cssText = `
          width: 100%;
          padding: 6px 10px;
          border: 1px solid #555;
          border-radius: 4px;
          background: #2a2a2a;
          color: #e0e0e0;
          font-size: 12px;
          outline: none;
          box-sizing: border-box;
        `
        ip.addEventListener('focus', () => { ip.style.borderColor = '#7af' })
        ip.addEventListener('blur',  () => { ip.style.borderColor = '#555' })
        container.appendChild(ip)
        node._eagleKeyInput = ip

        const STORAGE_KEY = 'eagle_api_key'
        const nodeId = String(node.id)
        try {
          const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
          if (saved[nodeId]) {
            const plain = _decodeKey(saved[nodeId])
            ip.value = plain
            if (originalWidget) originalWidget.value = plain
          }
          // 兼容新节点：读取全局固定 key
          if (!ip.value) {
            const fixed = localStorage.getItem('eagle_api_key_fixed')
            if (fixed) {
              const plain = _decodeKey(fixed)
              ip.value = plain
              if (originalWidget) originalWidget.value = plain
            }
          }
        } catch (e) {}

        ip.addEventListener('input', () => {
          const val = ip.value
          if (originalWidget) originalWidget.value = val
          try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
            data[nodeId] = _encodeKey(val)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
            // 同步更新全局固定 key
            localStorage.setItem('eagle_api_key_fixed', _encodeKey(val))
          } catch (e) {}
        })

        const posWidget = {
          type: 'custom_password',
          name: 'api_key_display',
          computeSize: () => [200, 36],
          draw(ctx, node, widget_width, y, widget_height) {
            const canvas = app.canvas
            const rect = canvas.canvas.getBoundingClientRect()
            const transform = canvas.ds
            const scale = transform.scale
            const offsetX = transform.offset[0]
            const offsetY = transform.offset[1]
            const screenX = rect.left + (node.pos[0] + offsetX) * scale + 8 * scale
            const screenY = rect.top  + (node.pos[1] + y + offsetY) * scale
            Object.assign(container.style, {
              left:   `${screenX}px`,
              top:    `${screenY}px`,
              width:  `${(widget_width - 16) * scale}px`,
              height: `${widget_height * scale}px`,
            })
            ip.style.fontSize = `${12 * scale}px`
          },
        }

        node.addCustomWidget(posWidget)

        const onRemoved = node.onRemoved
        node.onRemoved = () => {
          container.remove()
          return onRemoved?.call(node)
        }

        node.serialize_widgets = true
      }
    }

    // ── EagleAPILoader：配置加载器 ────────────────────────────
    if (nodeData.name === 'EagleAPILoader') {
      const origNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        origNodeCreated?.apply(this, arguments);
        const node = this;

        // 延迟等待 widgets 全部就绪
        setTimeout(() => {
          const configPathWidget = node.widgets?.find(w => w.name === 'config_path');
          const modelWidget = node.widgets?.find(w => w.name === 'model_name');

          if (!configPathWidget || !modelWidget) return;

          // ── 📁 选择文件 按钮 ───────────────────────────────────
          node.addWidget('button', '📁 选择文件', null, async () => {
            const filePath = await _selectConfigFile();
            if (filePath) {
              configPathWidget.value = filePath;
              // 触发刷新
              await _refreshProfileOptions(node, _stripPath(filePath));
              const selected = modelWidget.value?.trim();
              if (selected) _loadModelsForProfile(node, selected);
            }
          });

          // ── 🔄 加载模型 按钮 ─────────────────────────────────
          node.addWidget('button', '🔄 加载模型', null, async () => {
            const configPath = _stripPath(configPathWidget.value);
            await _refreshProfileOptions(node, configPath);
            // 下拉列表刷新后，加载当前选中 profile 的详细信息
            const selected = modelWidget.value?.trim();
            if (selected) _loadModelsForProfile(node, selected);
          });

          // config_path 变化时：去引号 + 自动刷新下拉列表
          const origConfigCallback = configPathWidget.callback;
          configPathWidget.callback = function (value) {
            origConfigCallback?.call(this, value);
            const cleaned = _stripPath(value);
            setTimeout(() => _refreshProfileOptions(node, cleaned), 300);
          };

          // 节点首次加载时自动刷新配置列表（即使 config_path 为空也尝试默认路径）
          setTimeout(() => _refreshProfileOptions(node, _stripPath(configPathWidget.value)), 500);
        }, 200);
      };
    }
  },
})
