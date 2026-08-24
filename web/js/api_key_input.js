/**
 * Eagle API Key Input - 密码输入控件与 API 配置加载器前端
 * - EagleAPIKeyNode: 密码输入，ENC:Base64 混淆存储
 * - EagleAPILoader: 从唯一的 api_config.json 统一管理大语言/生图 API 模型
 */

import { app } from "../../../scripts/app.js";

// ── 混淆工具（Base64，防止明文直接暴露）─────────────────────────
const _ENC_PREFIX = 'ENC:'
const _MODEL_TYPE_LABELS = {
  llm: '大语言模型 (LLM)',
  image: '生图模型 (Image)',
}
const _profileNodes = new Set()
let _profileRevision = null
let _profilePollTimer = null
let _profilePollBusy = false

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
 * 将 ComfyUI 的 STRING widget 替换为 COMBO 下拉列表，并保留当前值。
 */
function _replaceWithCombo(node, originalWidget, values) {
    if (!originalWidget || !node.widgets) return null;
    const idx = node.widgets.indexOf(originalWidget);
    if (idx < 0) return null;

    const previous = String(originalWidget.value || '').trim();
    const safeValues = Array.isArray(values) && values.length ? values : [''];
    const initialValue = previous && safeValues.includes(previous) ? previous : safeValues[0];

    // 创建新的 COMBO widget，名字和原 widget 相同，这样序列化时键值不会丢
    const comboWidget = node.addWidget('combo', originalWidget.name, initialValue, function (v) {
        // 同步到原 STRING widget 的序列化位置（如果还在）
        if (originalWidget) originalWidget.value = v;
        node.setDirtyCanvas(true, true);
    }, {
        values: safeValues,
    });

    // 把原 widget 隐藏/删除：先移除，再把新 widget 移到原位置
    node.widgets.splice(idx, 1); // 移除原 STRING widget
    const newIdx = node.widgets.indexOf(comboWidget);
    if (newIdx >= 0) {
        node.widgets.splice(newIdx, 1);
        node.widgets.splice(idx, 0, comboWidget);
    }

    // 修正序列化索引：ComfyUI 按 widgets 数组顺序序列化，需要让 comboWidget 占原位置
    // 这里把原 widget 从数组里拿掉后，序列化数组长度会少一位；
    // 通过给 comboWidget 加一个 serialize_value 钩子保持导出/导入兼容。
    comboWidget._originalIndex = idx;
    comboWidget.serialize_value = () => comboWidget.value;

    node.setDirtyCanvas(true, true);
    return comboWidget;
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

async function _callApi(path, body = {}) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (res.status === 405) {
        throw new Error('后端路由未注册，请重启 ComfyUI 后重试');
    }
    if (!res.ok) {
        const data = await _safeJson(res);
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return _safeJson(res);
}

async function _refreshProfileOptions(node, preferredName = '') {
    let modelWidget = node._eagleProfileCombo || node.widgets?.find(w => w.name === 'model_name');
    if (!modelWidget) return;

    try {
        const data = await _callApi('/api_loader/profiles');
        if (!data.success) {
            console.warn('[EagleAPILoader] 读取 Profile 失败:', data.error);
            if (modelWidget.options) modelWidget.options.values = [];
            node.setDirtyCanvas(true, true);
            return;
        }

        const profiles = Array.isArray(data.profiles) ? data.profiles : [];
        _profileRevision = data.config_revision || _profileRevision;
        const previous = String(modelWidget.value || '').trim();
        const preferred = String(preferredName || '').trim();
        const nextValue = preferred && profiles.includes(preferred)
            ? preferred
            : (previous && profiles.includes(previous)
                ? previous
                : (data.active_profile && profiles.includes(data.active_profile)
                    ? data.active_profile
                    : (profiles[0] || '')));

        node._eagleProfileItems = Array.isArray(data.items) ? data.items : [];

        if (modelWidget.type === 'combo') {
            modelWidget.options.values = profiles.length ? profiles : [''];
            modelWidget.value = nextValue;
            modelWidget.callback?.(nextValue, modelWidget);
        } else {
            // 第一次：把 STRING widget 替换成真正的 COMBO widget
            const combo = _replaceWithCombo(node, modelWidget, profiles);
            if (combo) {
                node._eagleProfileCombo = combo;
                modelWidget = combo;
                modelWidget.value = nextValue;
                modelWidget.callback?.(nextValue, modelWidget);
            }
        }

        console.log('[EagleAPILoader] 已加载', profiles.length, '个 Profile:', profiles);
        node.setDirtyCanvas(true, true);
    } catch (e) {
        console.warn('[EagleAPILoader] 刷新 Profile 列表失败:', e);
    }
}

async function _checkProfileFileChange() {
    if (_profilePollBusy || _profileNodes.size === 0) return;
    _profilePollBusy = true;
    try {
        const data = await _callApi('/api_loader/profiles');
        if (!data.success) return;
        const revision = data.config_revision || '';
        if (_profileRevision === null) {
            _profileRevision = revision;
        } else if (revision && revision !== _profileRevision) {
            _profileRevision = revision;
            console.log('[EagleAPILoader] 检测到 api_config.json 外部修改，正在同步模型列表');
            await _syncProfileNodes();
        }
    } catch (e) {
        // 文件处于编辑中的短暂 JSON 错误不清空当前下拉列表，下次轮询再试。
        console.warn('[EagleAPILoader] 监听 api_config.json 失败:', e.message || e);
    } finally {
        _profilePollBusy = false;
    }
}

function _startProfileWatcher() {
    if (_profilePollTimer) return;
    _profilePollTimer = setInterval(_checkProfileFileChange, 2000);
}

function _stopProfileWatcherIfIdle() {
    if (_profileNodes.size > 0 || !_profilePollTimer) return;
    clearInterval(_profilePollTimer);
    _profilePollTimer = null;
    _profileRevision = null;
}

async function _syncProfileNodes(sourceNode = null, preferredName = '') {
    const nodes = [..._profileNodes].filter(node => node?.widgets);
    await Promise.all(nodes.map(node =>
        _refreshProfileOptions(node, node === sourceNode ? preferredName : '')
    ));
}

async function _getProfile(name) {
    if (!name) return null;
    try {
        const data = await _callApi('/api_loader/profile', { name });
        return data.success ? data.profile : null;
    } catch (e) {
        console.warn('[EagleAPILoader] 获取 Profile 详情失败:', e);
        return null;
    }
}

function _showProfileDialog(title, initial = {}, onSave) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999; font-family: system-ui, sans-serif;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: #1e1e24; border: 1px solid #444; border-radius: 10px;
        width: 420px; max-width: 90vw; padding: 20px; color: #ddd;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    `;

    const heading = document.createElement('h3');
    heading.textContent = title;
    heading.style.cssText = 'margin: 0 0 16px 0; font-size: 15px; font-weight: 600;';
    box.appendChild(heading);

    const fields = [
        {
            key: 'model_type',
            label: '模型类型',
            type: 'select',
            value: initial.model_type || 'llm',
            options: Object.entries(_MODEL_TYPE_LABELS),
        },
        { key: 'api_key', label: 'API Key', type: 'password', value: _decodeKey(initial.api_key || '') },
        { key: 'base_url', label: 'Base URL', type: 'text', value: initial.base_url || '' },
        { key: 'model', label: '模型名称（同时作为 api_config 根键）', type: 'text', value: initial.model || '' },
    ];

    const inputs = {};
    fields.forEach(f => {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom: 12px;';
        const lbl = document.createElement('label');
        lbl.textContent = f.label;
        lbl.style.cssText = 'display:block;font-size:12px;color:#aaa;margin-bottom:5px;';
        const inp = document.createElement(f.type === 'select' ? 'select' : 'input');
        if (f.type !== 'select') inp.type = f.type;
        if (f.type === 'select') {
            f.options.forEach(([value, label]) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                inp.appendChild(option);
            });
        }
        inp.value = f.value;
        inp.style.cssText = `
            width: 100%; padding: 8px 10px; border: 1px solid #444; border-radius: 5px;
            background: #121216; color: #e0e0e0; font-size: 13px; box-sizing: border-box;
        `;
        if (f.key === 'model' && initial.lockName) {
            inp.disabled = true;
            inp.style.opacity = '0.6';
        }
        row.appendChild(lbl);
        row.appendChild(inp);
        box.appendChild(row);
        inputs[f.key] = inp;
    });

    const ft = document.createElement('div');
    ft.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px;';

    const btnSave = document.createElement('button');
    btnSave.textContent = '保存';
    btnSave.style.cssText = `
        padding: 7px 18px; border: none; border-radius: 5px; background: #2a4a8a;
        color: #fff; font-size: 13px; cursor: pointer;
    `;

    const btnCancel = document.createElement('button');
    btnCancel.textContent = '取消';
    btnCancel.style.cssText = `
        padding: 7px 18px; border: 1px solid #444; border-radius: 5px;
        background: #2a2a32; color: #ccc; font-size: 13px; cursor: pointer;
    `;

    ft.appendChild(btnCancel);
    ft.appendChild(btnSave);
    box.appendChild(ft);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    return new Promise(resolve => {
        btnCancel.addEventListener('click', () => {
            overlay.remove();
            resolve(null);
        });
        btnSave.addEventListener('click', () => {
            const result = {};
            Object.keys(inputs).forEach(k => result[k] = inputs[k].value.trim());
            // 当前版本使用模型名作为 Profile 键，兼容既有工作流下拉值。
            result.name = result.model;
            overlay.remove();
            resolve(result);
        });
        overlay.addEventListener('click', e => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(null);
            }
        });
    }).then(async result => {
        if (!result) return false;
        return onSave(result);
    });
}

// ── 远端模型分类与选择弹窗 ────────────────────────────────────

const _MODEL_CATEGORY_LABELS = {
    all: '全部',
    llm: '大语言 / 对话',
    image: '生图 / 视觉生成',
    vision: '视觉理解 (VLM)',
    embedding: '文本嵌入',
    audio: '语音 / 音频',
    other: '其他',
};

function _guessModelCategory(name) {
    const lower = String(name || '').toLowerCase();
    if (/dall[e\-]|midjourney|stable.diffusion|sdxl|flux|kolors|ideogram|recraft|seedream|gpt.image|imagen|kling|wan|hunyuan|cogview|image.?gen|text.to.image|t2i/.test(lower)) {
        return 'image';
    }
    if (/embed|text.embedding|bge/.test(lower)) {
        return 'embedding';
    }
    if (/whisper|tts|speech|audio/.test(lower)) {
        return 'audio';
    }
    if(/\bvl\b|vision/.test(lower)) {
        return 'vision';
    }
    if (/gpt|claude|qwen|qwq|deepseek|llama|gemini|mistral|yi|glm|baichuan|chat/.test(lower)) {
        return 'llm';
    }
    return 'other';
}

function _showModelPickerDialog(models, profile) {
    const categories = {};
    models.forEach(m => {
        const cat = _guessModelCategory(m);
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(m);
    });
    Object.keys(categories).forEach(cat => categories[cat].sort());

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        display: flex; align-items: center; justify-content: center;
        z-index: 9999; font-family: system-ui, sans-serif;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: #1e1e24; border: 1px solid #444; border-radius: 10px;
        width: 460px; max-width: 92vw; padding: 20px; color: #ddd;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    `;

    const heading = document.createElement('h3');
    heading.textContent = `🔄 从 API 选择模型 (${models.length} 个)`;
    heading.style.cssText = 'margin: 0 0 16px 0; font-size: 15px; font-weight: 600;';
    box.appendChild(heading);

    const info = document.createElement('div');
    info.textContent = `Base URL: ${profile.base_url || ''}`;
    info.style.cssText = 'font-size: 11px; color: #888; margin-bottom: 14px; word-break: break-all;';
    box.appendChild(info);

    const inputs = {};

    function _makeRow(label, element) {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom: 12px;';
        const lbl = document.createElement('label');
        lbl.textContent = label;
        lbl.style.cssText = 'display:block;font-size:12px;color:#aaa;margin-bottom:5px;';
        element.style.cssText = `
            width: 100%; padding: 8px 10px; border: 1px solid #444; border-radius: 5px;
            background: #121216; color: #e0e0e0; font-size: 13px; box-sizing: border-box;
        `;
        row.appendChild(lbl);
        row.appendChild(element);
        box.appendChild(row);
        return row;
    }

    // 分类筛选
    const categorySelect = document.createElement('select');
    const allCats = ['all', ...Object.keys(categories).sort()];
    allCats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = _MODEL_CATEGORY_LABELS[cat] || cat;
        categorySelect.appendChild(opt);
    });
    _makeRow('模型分类', categorySelect);
    inputs.category = categorySelect;

    // 模型下拉
    const modelSelect = document.createElement('select');
    modelSelect.style.maxHeight = '260px';
    _makeRow('选择模型', modelSelect);
    inputs.model = modelSelect;

    function _refreshModelOptions(category) {
        const current = modelSelect.value;
        modelSelect.innerHTML = '';
        const list = category === 'all'
            ? models.slice()
            : (categories[category] || []);
        list.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        });
        if (list.includes(current)) {
            modelSelect.value = current;
        } else if (list.length) {
            modelSelect.value = list[0];
        }
    }

    categorySelect.addEventListener('change', () => {
        _refreshModelOptions(categorySelect.value);
    });
    _refreshModelOptions('all');

    // 模型类型
    const typeSelect = document.createElement('select');
    Object.entries(_MODEL_TYPE_LABELS).forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        typeSelect.appendChild(opt);
    });
    typeSelect.value = profile.model_type || 'llm';
    _makeRow('模型类型', typeSelect);
    inputs.model_type = typeSelect;

    // API Key
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.value = _decodeKey(profile.api_key || '');
    _makeRow('API Key', keyInput);
    inputs.api_key = keyInput;

    // Base URL
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = profile.base_url || '';
    _makeRow('Base URL', urlInput);
    inputs.base_url = urlInput;

    const ft = document.createElement('div');
    ft.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px;';

    const btnSave = document.createElement('button');
    btnSave.textContent = '保存';
    btnSave.style.cssText = `
        padding: 7px 18px; border: none; border-radius: 5px; background: #2a4a8a;
        color: #fff; font-size: 13px; cursor: pointer;
    `;

    const btnCancel = document.createElement('button');
    btnCancel.textContent = '取消';
    btnCancel.style.cssText = `
        padding: 7px 18px; border: 1px solid #444; border-radius: 5px;
        background: #2a2a32; color: #ccc; font-size: 13px; cursor: pointer;
    `;

    ft.appendChild(btnCancel);
    ft.appendChild(btnSave);
    box.appendChild(ft);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    return new Promise(resolve => {
        btnCancel.addEventListener('click', () => {
            overlay.remove();
            resolve(null);
        });
        btnSave.addEventListener('click', () => {
            const result = {
                model: String(inputs.model.value || '').trim(),
                model_type: inputs.model_type.value,
                api_key: _encodeKey(String(inputs.api_key.value || '').trim()),
                base_url: String(inputs.base_url.value || '').trim(),
                name: String(inputs.model.value || '').trim(),
            };
            overlay.remove();
            resolve(result);
        });
        overlay.addEventListener('click', e => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(null);
            }
        });
    });
}

async function _addProfile(node) {
    const savedName = await _showProfileDialog('➕ 添加 API 模型', {
        model_type: 'llm',
    }, async result => {
        if (!result.model || !result.base_url) {
            alert('模型名称和 Base URL 不能为空');
            return false;
        }
        result.name = result.model;
        try {
            const data = await _callApi('/api_loader/save_profile', result);
            if (!data.success) {
                alert('保存失败：' + (data.error || '未知错误'));
                return false;
            }
            return data.profile_name || result.name;
        } catch (e) {
            alert('保存失败：' + e.message);
            return false;
        }
    });

    if (savedName) {
        await _syncProfileNodes(node, savedName);
    }
}

async function _editProfile(node) {
    const modelWidget = node._eagleProfileCombo || node.widgets?.find(w => w.name === 'model_name');
    const currentName = modelWidget?.value;
    if (!currentName) {
        alert('请先选择一个模型');
        return;
    }

    const profile = await _getProfile(currentName);
    if (!profile) {
        alert('无法获取当前模型配置');
        return;
    }

    const ok = await _showProfileDialog('✏️ 编辑 API 模型', {
        api_key: profile.api_key,
        base_url: profile.base_url,
        model: profile.model,
        model_type: profile.model_type || 'llm',
        lockName: true,
    }, async result => {
        if (!result.base_url || !result.model) {
            alert('Base URL 和 Model 不能为空');
            return false;
        }
        result.name = currentName;
        result.original_name = currentName;
        try {
            const data = await _callApi('/api_loader/save_profile', result);
            if (!data.success) {
                alert('保存失败：' + (data.error || '未知错误'));
                return false;
            }
            return data.profile_name || currentName;
        } catch (e) {
            alert('保存失败：' + e.message);
            return false;
        }
    });

    if (ok) {
        await _syncProfileNodes(node, ok);
    }
}

async function _deleteProfile(node) {
    const modelWidget = node._eagleProfileCombo || node.widgets?.find(w => w.name === 'model_name');
    if (!modelWidget || !modelWidget.value) return;
    const deletedName = modelWidget.value;
    if (!confirm(`确认删除模型 "${deletedName}" 吗？\n此操作会同步修改本地 api_config.json。`)) return;
    try {
        const data = await _callApi('/api_loader/delete_profile', { name: deletedName });
        if (!data.success) {
            alert('删除失败：' + (data.error || '未知错误'));
            return;
        }
        await _syncProfileNodes();
        console.log('[EagleAPILoader] 已从 api_config.json 删除 Profile:', deletedName);
    } catch (e) {
        console.warn('[EagleAPILoader] 删除 Profile 失败:', e);
        alert('删除失败：' + e.message);
    }
}

async function _fetchModelsFromApi(node) {
    const modelWidget = node._eagleProfileCombo || node.widgets?.find(w => w.name === 'model_name');
    const profileName = modelWidget?.value;
    if (!profileName) {
        alert('请先选择一个模型');
        return;
    }
    try {
        const data = await _callApi('/api_loader/fetch_models', { profile_name: profileName });
        if (!data.success) {
            alert('从 API 拉取模型失败：' + (data.error || '未知错误'));
            return;
        }

        if (!data.models || data.models.length === 0) {
            alert('API 未返回任何模型');
            return;
        }

        const profile = await _getProfile(profileName);
        if (!profile) {
            alert('无法获取当前模型配置');
            return;
        }

        // 使用 Vue 风格弹窗选择模型，支持分类过滤
        const result = await _showModelPickerDialog(data.models, {
            api_key: profile.api_key,
            base_url: profile.base_url,
            model_type: data.model_type || profile.model_type || 'llm',
        });

        if (!result || !result.model) return;

        try {
            const saveRes = await _callApi('/api_loader/save_profile', result);
            if (!saveRes.success) {
                alert('保存失败：' + (saveRes.error || '未知错误'));
                return;
            }
            await _syncProfileNodes(node, saveRes.profile_name || result.name);
            console.log('[EagleAPILoader] 已从 API 写入 api_config.json:', saveRes.profile_name || result.name);
        } catch (e) {
            alert('保存失败：' + e.message);
        }
    } catch (e) {
        console.warn('[EagleAPILoader] 从 API 拉取模型失败:', e);
        alert('从 API 拉取模型失败：' + e.message);
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

          // 第一次：把 STRING widget 替换成真正的 COMBO 下拉框
          const combo = _replaceWithCombo(node, modelWidget, []);
          if (combo) node._eagleProfileCombo = combo;
          _profileNodes.add(node);
          _startProfileWatcher();

          const previousOnRemoved = node.onRemoved;
          node.onRemoved = function () {
            _profileNodes.delete(node);
            _stopProfileWatcherIfIdle();
            return previousOnRemoved?.apply(this, arguments);
          };

          // ── 📂 加载本地 Profile ───────────────────────────────────
          node.addWidget('button', '📂 加载本地配置', null, async () => {
            await _syncProfileNodes(node);
          });

          // ── ➕ 添加模型配置 ───────────────────────────────────────
          node.addWidget('button', '➕ 添加模型配置', null, async () => {
            await _addProfile(node);
          });

          // ── ✏️ 编辑当前模型配置 ──────────────────────────────────
          node.addWidget('button', '✏️ 编辑当前模型配置', null, async () => {
            await _editProfile(node);
          });

          // ── ➖ 删除当前模型配置 ──────────────────────────────────
          node.addWidget('button', '➖ 删除当前模型配置', null, async () => {
            await _deleteProfile(node);
          });

          // ── 🔄 从 API 拉取模型 ───────────────────────────────────
          node.addWidget('button', '🔄 从 API 刷新模型', null, async () => {
            await _fetchModelsFromApi(node);
          });

          // 节点首次加载时自动刷新 Profile 列表
          setTimeout(() => _refreshProfileOptions(node), 500);
        }, 200);
      };
    }
  },
})
