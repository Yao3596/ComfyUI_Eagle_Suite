/**
 * DropdownFilter — 下拉筛选组件
 * Props: label, options, modelValue, searchable, multiple, isOpen
 * Emits: update:modelValue, update:isOpen, change
 */
import { defineComponent, h, ref, watch, onMounted, onBeforeUnmount } from "../../../lib/vue.esm-browser.js";

export const DropdownFilter = defineComponent({
  name: "DropdownFilter",
  props: {
    label: { type: String, default: "" },
    options: { type: Array, default: () => [] },
    // options: [{ value, label }]
    modelValue: { type: [Array, String], default: () => [] },
    searchable: { type: Boolean, default: false },
    multiple: { type: Boolean, default: true },
    isOpen: { type: Boolean, default: false },
  },
  emits: ["update:modelValue", "update:isOpen", "change"],
  setup(props, { emit }) {
    const searchText = ref("");

    function toggleOpen() {
      emit("update:isOpen", !props.isOpen);
    }

    function close() {
      emit("update:isOpen", false);
      searchText.value = "";
    }

    function handleSelect(opt) {
      if (props.multiple) {
        const current = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
        const idx = current.indexOf(opt.value);
        if (idx >= 0) {
          current.splice(idx, 1);
        } else {
          current.push(opt.value);
        }
        emit("update:modelValue", current);
        emit("change", current);
      } else {
        emit("update:modelValue", opt.value);
        emit("change", opt.value);
        close();
      }
    }

    const filtered = () => {
      if (!props.searchable || !searchText.value) return props.options;
      const q = searchText.value.toLowerCase();
      return props.options.filter(o => o.label.toLowerCase().includes(q));
    };

    // 点击外部关闭
    function onDocClick(e) {
      if (props.isOpen) close();
    }

    onMounted(() => document.addEventListener("click", onDocClick));
    onBeforeUnmount(() => document.removeEventListener("click", onDocClick));

    return () => {
      const wrapChildren = [
        h("button", {
          class: "gal-btn",
          onClick: (e) => { e.stopPropagation(); toggleOpen(); },
        }, `${props.label} \u25BC`),
      ];

      if (props.isOpen) {
        const menuChildren = [];

        // 搜索框
        if (props.searchable) {
          menuChildren.push(h("input", {
            class: "gal-dropdown-search",
            type: "text",
            placeholder: "搜索...",
            value: searchText.value,
            onInput: (e) => { e.stopPropagation(); searchText.value = e.target.value; },
            onClick: (e) => e.stopPropagation(),
          }));
        }

        filtered().forEach(opt => {
          const isChecked = props.multiple
            ? (Array.isArray(props.modelValue) && props.modelValue.includes(opt.value))
            : props.modelValue === opt.value;

          if (props.multiple) {
            menuChildren.push(h("div", {
              class: "gal-dropdown-item",
              onClick: (e) => { e.stopPropagation(); handleSelect(opt); },
            }, [
              h("label", {}, [
                h("input", { type: "checkbox", checked: isChecked }),
                opt.label,
              ]),
            ]));
          } else {
            menuChildren.push(h("div", {
              class: ["gal-dropdown-item", isChecked ? "active" : ""],
              onClick: (e) => { e.stopPropagation(); handleSelect(opt); },
            }, opt.label));
          }
        });

        wrapChildren.push(h("div", {
          class: "gal-dropdown-menu show",
          onClick: (e) => e.stopPropagation(),
        }, menuChildren));
      }

      return h("div", { class: "gal-dropdown" }, wrapChildren);
    };
  },
});
