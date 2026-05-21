/**
 * FolderTree — 文件夹树组件（递归）
 * Props: folders, activeId, itemClass, iconFolder, iconParent
 * Emits: select(folder)
 */
import { defineComponent, h } from "../../../lib/vue.esm-browser.js";

const FolderTree = defineComponent({
  name: "FolderTree",
  props: {
    folders: { type: Array, default: () => [] },
    activeId: { type: String, default: "" },
    iconFolder: { type: String, default: "\u{1F4C1}" },
    iconParent: { type: String, default: "\u{1F4C2}" },
  },
  emits: ["select"],
  setup(props, { emit }) {
    function renderFolder(f) {
      const hasChildren = f.children && f.children.length > 0;
      const icon = hasChildren ? props.iconParent : props.iconFolder;

      const itemChildren = [
        h("span", { class: "gal-folder-icon" }, icon + " "),
        h("span", {}, f.name || "未命名"),
      ];

      const item = h("div", {
        class: ["gal-folder-item", f.id === props.activeId ? "active" : ""],
        onClick: (e) => { e.stopPropagation(); emit("select", f); },
      }, itemChildren);

      const result = [item];

      if (hasChildren) {
        result.push(h("div", { class: "gal-folder-children" },
          f.children.map(child => renderFolder(child))
        ));
      }

      return result;
    }

    return () => {
      if (!props.folders || !props.folders.length) {
        return h("div", { class: "gal-empty" }, "无文件夹");
      }

      const allItems = [];
      props.folders.forEach(f => {
        allItems.push(...renderFolder(f));
      });
      return h("div", {}, allItems);
    };
  },
});

export { FolderTree };
