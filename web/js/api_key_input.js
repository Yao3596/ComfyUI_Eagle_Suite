/**
 * Eagle API Key Input - 密码输入控件
 */

app.registerExtension({
  name: 'Eagle.APIKeyInput',

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    // 用 class name（NODE_CLASS_MAPPINGS 的 key），不是 display name
    if (nodeData.name !== 'EagleAPIKeyNode') return

    const onConfigure = nodeType.prototype.onConfigure
    nodeType.prototype.onConfigure = function (widgets_values) {
      onConfigure?.apply(this, arguments)
      if (widgets_values?.length > 0) {
        const savedKey = (widgets_values[0] || '').trim()
        if (savedKey && this._eagleKeyInput) {
          this._eagleKeyInput.value = savedKey
        }
      }
    }

    const origNodeCreated = nodeType.prototype.onNodeCreated
    nodeType.prototype.onNodeCreated = function () {
      origNodeCreated?.apply(this, arguments)

      const node = this

      // 隐藏原始 api_key 文本 widget，但保留它用于序列化
      const originalWidget = node.widgets?.find(w => w.name === 'api_key')
      if (originalWidget) {
        originalWidget.type = 'hidden'
        originalWidget.computeSize = () => [0, -4]
      }

      // 创建密码输入框容器
      const container = document.createElement('div')
      container.style.cssText = `
        position: absolute;
        pointer-events: auto;
        z-index: 10;
      `
      document.body.appendChild(container)

      // 创建密码输入框
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

      // 从 localStorage 恢复
      const storageKey = 'eagle_api_key'
      const nodeId = String(node.id)
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
        if (saved[nodeId]) {
          ip.value = saved[nodeId]
          if (originalWidget) originalWidget.value = saved[nodeId]
        }
      } catch (e) {}

      // 输入变化时同步
      ip.addEventListener('input', () => {
        const val = ip.value
        if (originalWidget) originalWidget.value = val
        try {
          const data = JSON.parse(localStorage.getItem(storageKey) || '{}')
          data[nodeId] = val
          localStorage.setItem(storageKey, JSON.stringify(data))
        } catch (e) {}
      })

      // 自定义 widget：负责在 draw 时更新 DOM 位置
      const posWidget = {
        type: 'custom_password',
        name: 'api_key_display',
        computeSize: () => [200, 36],
        draw(ctx, node, widget_width, y, widget_height) {
          // 将 canvas 坐标转换为屏幕坐标
          const canvas = app.canvas
          const rect = canvas.canvas.getBoundingClientRect()
          const transform = canvas.ds  // DragAndScale

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

      // 节点删除时清理 DOM
      const onRemoved = node.onRemoved
      node.onRemoved = () => {
        container.remove()
        return onRemoved?.call(node)
      }

      node.serialize_widgets = true
    }
  },
})
