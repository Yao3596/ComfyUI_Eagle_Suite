/**
 * SettingsDialog — 设置弹窗组件
 * Props: visible, title, fields
 * Emits: update:visible, save
 */
import { defineComponent, h, ref, watch } from "../../../lib/vue.esm-browser.js";

export const SettingsDialog = defineComponent({
  name: "SettingsDialog",
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: "设置" },
    fields: { type: Array, default: () => [] },
    // fields: [{ key, label, type: "text"|"password"|"select", placeholder?, options? }]
  },
  emits: ["update:visible", "save"],
  setup(props, { emit }) {
    const form = ref({});

    // 当弹窗打开时，初始化表单值
    watch(() => props.visible, (v) => {
      if (v) {
        const init = {};
        props.fields.forEach(f => { init[f.key] = f.value || ""; });
        form.value = init;
      }
    });

    function close() {
      emit("update:visible", false);
    }

    function save() {
      emit("save", { ...form.value });
      close();
    }

    return () => {
      if (!props.visible) return null;

      const panelChildren = [
        h("h3", {}, props.title),
      ];

      props.fields.forEach(f => {
        panelChildren.push(h("label", {}, f.label));
        if (f.type === "select") {
          const opts = (f.options || []).map(o =>
            h("option", { value: o.value }, o.label)
          );
          panelChildren.push(h("select", {
            value: form.value[f.key] || "",
            onChange: (e) => { form.value[f.key] = e.target.value; },
          }, opts));
        } else {
          panelChildren.push(h("input", {
            type: f.type || "text",
            value: form.value[f.key] || "",
            placeholder: f.placeholder || "",
            onInput: (e) => { form.value[f.key] = e.target.value; },
          }));
        }
      });

      panelChildren.push(
        h("div", { class: "gal-settings-row" }, [
          h("button", { class: "gal-btn", onClick: close }, "取消"),
          h("button", { class: "gal-btn primary", onClick: save }, "保存"),
        ]),
        h("a", {
          class: "gal-settings-link",
          href: "https://github.com/AlexOcegueda/ComfyUI_Eagle_Suite",
          target: "_blank",
        }, "ComfyUI_Eagle_Suite \u00B7 GitHub"),
      );

      return h("div", {
        class: "gal-settings-backdrop show",
        onClick: (e) => { if (e.target === e.currentTarget) close(); },
      }, [
        h("div", { class: "gal-settings-panel" }, panelChildren),
      ]);
    };
  },
});
