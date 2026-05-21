/**
 * ImageGrid — 图片网格组件
 * Props: items, selectedIds, loading, errorMsg, emptyText, thumbnailUrlFn, showIndex
 * Emits: select(item), dblclick({ item, index })
 * Slot: thumb-overlay(item, index)
 */
import { defineComponent, h } from "../../../lib/vue.esm-browser.js";

export const ImageGrid = defineComponent({
  name: "ImageGrid",
  props: {
    items: { type: Array, default: () => [] },
    selectedIds: { type: Set, default: () => new Set() },
    loading: { type: Boolean, default: false },
    errorMsg: { type: String, default: "" },
    emptyText: { type: String, default: "暂无结果" },
    thumbnailUrlFn: { type: Function, default: (item) => "" },
    showIndex: { type: Boolean, default: false },
  },
  emits: ["select", "dblclick"],
  setup(props, { emit, slots }) {
    return () => {
      // 加载中
      if (props.loading) {
        return h("div", { class: "gal-grid" }, [
          h("div", { class: "gal-loading" }, "\u{1F504} 加载中..."),
        ]);
      }

      // 错误
      if (props.errorMsg) {
        return h("div", { class: "gal-grid" }, [
          h("div", { class: "gal-error" }, props.errorMsg),
        ]);
      }

      // 空状态
      if (!props.items.length) {
        return h("div", { class: "gal-grid" }, [
          h("div", { class: "gal-empty" }, props.emptyText),
        ]);
      }

      // 网格
      const cards = props.items.map((item, index) => {
        const isSelected = props.selectedIds.has(item.id);
        const cardChildren = [];

        // 缩略图
        cardChildren.push(h("img", {
          src: props.thumbnailUrlFn(item),
          loading: "lazy",
          alt: item.name || item.id || "",
          onError: (e) => { e.target.style.display = "none"; },
        }));

        // 信息栏
        const infoLeft = [];
        const infoRight = [];

        // 星标（Eagle）
        if (item.star > 0) {
          cardChildren.push(h("span", { class: "gal-thumb-star" }, "\u2605".repeat(item.star)));
        }

        // 分辨率
        const res = item.resolution || (item.width && item.height ? `${item.width}x${item.height}` : "");
        if (res) {
          infoRight.push(h("span", {}, res));
        }

        // 序号
        if (props.showIndex) {
          cardChildren.push(h("span", { class: "gal-thumb-index" }, `${index + 1}`));
        }

        // 标签/名称
        const label = item.name
          ? (item.name.length > 12 ? item.name.slice(0, 12) + "..." : item.name)
          : item.tags?.length ? `\u{1F3F7} ${item.tags.length}` : "";
        if (label) infoLeft.push(h("span", {}, label));

        // 收藏数（Wallhaven）
        if (item.favorites != null) {
          infoRight.push(h("span", {}, `\u2665 ${item.favorites}`));
        }

        if (infoLeft.length || infoRight.length) {
          cardChildren.push(h("div", { class: "gal-thumb-info" }, [
            h("span", {}, infoLeft),
            h("span", {}, infoRight),
          ]));
        }

        // thumb-overlay slot
        if (slots["thumb-overlay"]) {
          cardChildren.push(slots["thumb-overlay"]({ item, index }));
        }

        return h("div", {
          class: ["gal-thumb", isSelected ? "selected" : ""],
          "data-id": item.id,
          onClick: () => emit("select", item),
          onDblclick: () => emit("dblclick", { item, index }),
        }, cardChildren);
      });

      return h("div", { class: "gal-grid" }, cards);
    };
  },
});
