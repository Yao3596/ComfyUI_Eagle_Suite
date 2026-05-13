/**
 * Eagle API Key Input - 密码输入控件（混淆存储）
 * localStorage / 工作流 JSON 存 ENC:base64，执行时传明文给 Python
 */

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

// ────────────────────────────────────────────────────────────────
app.registerExtension({
  name: 'Eagle.APIKeyInput',

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== 'EagleAPIKeyNode') return

    // ── 加载工作流时解码 ─────────────────────────────────────
    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (widgets_values) {
      // 解码后再走原始流程
      let decoded_values = widgets_values
      if (Array.isArray(widgets_values) && widgets_values.length > 0) {
        decoded_values = [...widgets_values]
        decoded_values[0] = _decodeKey(widgets_values[0])
      }
      onConfigure?.apply(this, [decoded_values])

      const plain = (decoded_values?.[0] || '').trim()
      if (plain) {
        const w = this.widgets?.find(w => w.name === 'api_key')
        if (w) w.value = plain          // widget 存明文，执行时直接用
        if (this._eagleKeyInput) this._eagleKeyInput.value = plain
      }
    }

    // ── 节点创建 ─────────────────────────────────────────────
    const origNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      origNodeCreated?.apply(this, arguments)
      const node = this

      // 隐藏原始 widget，保留用于序列化和执行
      const originalWidget = node.widgets?.find(w => w.name === 'api_key')
      if (originalWidget) {
        originalWidget.type = 'hidden'
        originalWidget.computeSize = () => [0, -4]
      }

      // ── 序列化时编码（保存工作流 JSON 时触发）────────────
      const origSerialize = node.serialize?.bind(node)
      node.serialize = function () {
        const data = origSerialize ? origSerialize() : {}
        if (data.widgets_values && originalWidget) {
          const idx = node.widgets.indexOf(originalWidget)
          if (idx >= 0) {
            // 工作流 JSON 里存编码值
            data.widgets_values[idx] = _encodeKey(originalWidget.value || '')
          }
        }
        return data
      }

      // ── DOM：密码输入框 ───────────────────────────────────
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

      // ── localStorage 恢复（存的是编码值，读出来解码）────
      const STORAGE_KEY = 'eagle_api_key'
      const nodeId = String(node.id)
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
        if (saved[nodeId]) {
          const plain = _decodeKey(saved[nodeId])
          ip.value = plain
          if (originalWidget) originalWidget.value = plain  // 明文给执行用
        }
      } catch (e) {}

      // ── 输入同步 ──────────────────────────────────────────
      ip.addEventListener('input', () => {
        const val = ip.value
        // originalWidget 始终存明文 → Python 收到明文，无需改 Python 侧
        if (originalWidget) originalWidget.value = val
        // localStorage 存编码值
        try {
          const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
          data[nodeId] = _encodeKey(val)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
        } catch (e) {}
      })

      // ── 位置 widget（负责跟随节点移动）──────────────────
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
  },
})
