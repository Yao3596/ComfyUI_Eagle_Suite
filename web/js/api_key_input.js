/**
 * Eagle API Key Input - 密码输入控件与 API 配置加载器前端
 * - EagleAPIKeyNode: 密码输入，ENC:Base64 混淆存储
 * - EagleAPILoader: 从 api_config.json 读取模型列表，下拉切换模型
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
  return str
}

// ── 路径工具 ─────────────────────────────────────────────────
function _stripPath(val) {
  if (!val) return '';
  let s = String(val).trim();
  while (s.length > 1 && (s[0] === '"' || s[0] === "'") && (s[s.length - 1] === '"' || s[s.length - 1] === "'")) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * 将 ComfyUI 的 STRING widget 转换为 COMBO 下拉列表，并保留当前值。
 */
function _convertToCombo(node, widget, values) {
    if (!widget) return;
    widget.type = 'combo';
    widget.options = widget.options || {};
    widget.options.values = values.length ? values : [''];
    if (values.length && (!widget.value || !values.includes(widget.value))) {
        widget.value = values[0];
    }
    node.setDirtyCanvas(true, true);
}

// ── EagleAPILoader 模型列表工具 ─────────────────────────────
async function _safeJson(res) {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (e) {
        console.warn('[EagleAPILoader] 后端返回非 JSON:', text.slice(0, 200));
        return { success: false, error: '后端返回格式错误' };
    }
}

async function _refreshModelOptions(node) {
    const modelWidget = node.widgets?.find(w => w.name === 'model_name');
    if (!modelWidget) return;

    try {
        const res = await fetch('/api_loader/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (res.status === 405 || res.status === 404) {
            console.warn('[EagleAPILoader] 后端路由未注册，请重启 ComfyUI 后重试');
            return;
        }
        if (!res.ok) {
            console.warn(`[EagleAPILoader] /models HTTP ${res.status}`);
            return;
        }
        const data = await _safeJson(res);
        if (!data.success) {
            console.warn('[EagleAPILoader] 读取配置失败:', data.error);
            modelWidget.options = modelWidget.options || {};
            modelWidget.options.values = [];
            node.setDirtyCanvas(true, true);
            return;
        }

        const models = data.models || [];
        const previous = (modelWidget.value || '').trim();
        _convertToCombo(node, modelWidget, models);

        // 如果当前值仍有效则保留，否则选第一个
        if (previous && models.includes(previous)) {
            modelWidget.value = previous;
        }

        console.log('[EagleAPILoader] 已加载', models.length, '个模型:', models);
        node.setDirtyCanvas(true, true);
    } catch (e) {
        console.warn('[EagleAPILoader] 刷新模型列表失败:', e);
    }
}

// ────────────────────────────────────────────────────────────────
app.registerExtension({
  name: 'Eagle.APIKeyInput',

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    // ── EagleAPIKeyNode：密码输入控件 ────────────────────────
    if (nodeData.name === 'EagleAPIKeyNode') {
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

        setTimeout(() => {
          const modelWidget = node.widgets?.find(w => w.name === 'model_name');
          if (!modelWidget) return;

          // 强制将 model_name 转为 COMBO 下拉框
          _convertToCombo(node, modelWidget, []);

          // ── 🔄 刷新模型列表 按钮 ─────────────────────────────────
          node.addWidget('button', '🔄 刷新模型列表', null, async () => {
            await _refreshModelOptions(node);
          });

          // model_name 变化时触发节点重算，让下游 Unified 节点更新
          const origCallback = modelWidget.callback;
          modelWidget.callback = function (value) {
            origCallback?.call(this, value);
            // 通知 ComfyUI 该 widget 已变化
            const w = node.widgets.find(w => w.name === 'model_name');
            if (w && w.callback) {
              try { w.callback(value, w); } catch (e) {}
            }
            node.setDirtyCanvas(true, true);
          };

          // 节点首次加载时自动刷新模型列表
          setTimeout(() => _refreshModelOptions(node), 500);
        }, 200);
      };
    }
  },
})
