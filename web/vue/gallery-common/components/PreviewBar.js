/**
 * PreviewBar — 选中预览条组件
 * Props: selectedItems, thumbnailUrlFn, modeText, showClear
 * Emits: remove, clear
 */
import { defineComponent, h, ref, onMounted } from "../../../lib/vue.esm-browser.js";

export const PreviewBar = defineComponent({
  name: "PreviewBar",
  props: {
    selectedItems: { type: Array, default: () => [] },
    thumbnailUrlFn: { type: Function, default: (item) => "" },
    modeText: { type: String, default: "" },
    showClear: { type: Boolean, default: true },
  },
  emits: ["remove", "clear"],
  setup(props, { emit }) {
    const previewEl = ref(null);

    onMounted(() => {
      // 横向滚轮滚动
      if (previewEl.value) {
        previewEl.value.addEventListener("wheel", (e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            previewEl.value.scrollLeft += e.deltaY;
          }
        }, { passive: false });
      }
    });

    return () => {
      const children = [];

      if (props.selectedItems.length === 0) {
        children.push(h("div", { class: "gal-preview-empty" }, "选中图片将显示在这里"));
      } else {
        props.selectedItems.forEach((item, idx) => {
          const thumbChildren = [
            h("img", {
              src: props.thumbnailUrlFn(item),
              loading: "lazy",
              alt: item.name || item.wallpaper_id || "",
              onError: (e) => { e.target.style.display = "none"; },
            }),
            h("div", {
              class: "gal-preview-del",
              onClick: (e) => { e.stopPropagation(); emit("remove", item.id); },
            }, "\u00D7"),
          ];
          children.push(h("div", { class: "gal-preview-thumb" }, thumbChildren));
        });

        // 文件夹模式文本
        if (props.modeText) {
          children.push(h("div", { class: "gal-preview-mode" }, props.modeText));
        }

        // 清除按钮
        if (props.showClear) {
          children.push(h("button", {
            class: "gal-btn",
            style: "flex-shrink:0;height:60px;align-self:center;margin-left:4px",
            title: "清除全部",
            onClick: (e) => { e.stopPropagation(); emit("clear"); },
          }, "清除"));
        }
      }

      return h("div", { class: "gal-preview", ref: previewEl }, children);
    };
  },
});
