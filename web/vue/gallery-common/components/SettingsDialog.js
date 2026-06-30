/**
 * SettingsDialog — 设置弹窗组件
 *
 * 通用 backdrop + panel 设置对话框，支持动态表单字段
 */
import { defineComponent } from "../../lib/vue.esm-browser.js";

export const SettingsDialog = defineComponent({
    name: "SettingsDialog",
    props: {
        visible: { type: Boolean, default: false },
        title: { type: String, default: "设置" },
        fields: { type: Array, default: () => [] },
        // fields 格式: [{ key, label, type, placeholder, hint }]
    },
    emits: ["update:visible", "save"],
    setup(props, { emit }) {
        function close() {
            emit("update:visible", false);
        }

        function getFieldValue(key) {
            const el = document.getElementById("gal-field-" + key);
            return el ? el.value.trim() : "";
        }

        function save() {
            const data = {};
            props.fields.forEach(f => {
                data[f.key] = getFieldValue(f.key);
            });
            emit("save", data);
        }

        return { close, save };
    },
    template: `
    <div class="gal-settings-backdrop" :class="{ show: visible }" @click.self="close">
        <div class="gal-settings-panel">
            <h3>{{ title }}</h3>
            <template v-for="field in fields" :key="field.key">
                <label>{{ field.label }}</label>
                <input :type="field.type || 'text'"
                       :id="'gal-field-' + field.key"
                       :placeholder="field.placeholder || ''"
                       :value="field.value || ''"
                       @focus="$event.target.style.borderColor='var(--gal-primary)'"
                       @blur="$event.target.style.borderColor='var(--gal-border-light)'" />
                <div v-if="field.hint" class="gal-settings-hint" v-html="field.hint"></div>
            </template>
            <div class="gal-settings-footer">
                <a class="gal-settings-github" href="https://github.com/Yao3596/ComfyUI_Eagle_Suite" target="_blank" rel="noopener">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                    GitHub
                </a>
                <span class="gal-settings-author">Yao3596 / ComfyUI_Eagle_Suite</span>
            </div>
            <div class="gal-settings-row">
                <button class="gal-btn" @click="close">取消</button>
                <button class="gal-btn primary" @click="save">保存</button>
            </div>
        </div>
    </div>
    `,
});
