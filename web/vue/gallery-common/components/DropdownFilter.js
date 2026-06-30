/**
 * DropdownFilter — 下拉多选过滤组件
 *
 * 支持搜索过滤、多选、单选等模式
 */
import { defineComponent, ref, computed } from "../../lib/vue.esm-browser.js";

export const DropdownFilter = defineComponent({
    name: "DropdownFilter",
    props: {
        label: { type: String, default: "" },
        options: { type: Array, default: () => [] },
        // options 格式: [{ value, label, count? }]
        modelValue: { type: [Array, String], default: () => [] },
        searchable: { type: Boolean, default: false },
        multiple: { type: Boolean, default: true },
        searchPlaceholder: { type: String, default: "搜索..." },
        isOpen: { type: Boolean, default: false },
        maxHeight: { type: String, default: "220px" },
        minWidth: { type: String, default: "140px" },
    },
    emits: ["update:modelValue", "update:isOpen", "change"],
    setup(props, { emit }) {
        const searchQuery = ref("");

        const filteredOptions = computed(() => {
            const keyword = searchQuery.value.trim().toLowerCase();
            if (!keyword) return props.options;
            return props.options.filter(o =>
                (o.label || o.name || "").toLowerCase().includes(keyword)
            );
        });

        const countLabel = computed(() => {
            if (!props.multiple) return "";
            const arr = props.modelValue;
            if (Array.isArray(arr) && arr.length > 0) return "(" + arr.length + ")";
            return "";
        });

        function toggleOpen() {
            emit("update:isOpen", !props.isOpen);
        }

        function onCheckboxChange(opt) {
            if (!props.multiple) return;
            const arr = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
            const val = opt.value !== undefined ? opt.value : opt.name;
            const idx = arr.indexOf(val);
            if (idx >= 0) {
                arr.splice(idx, 1);
            } else {
                arr.push(val);
            }
            emit("update:modelValue", arr);
            emit("change", arr);
        }

        function onRadioChange(val) {
            emit("update:modelValue", val);
            emit("change", val);
        }

        return {
            searchQuery,
            filteredOptions,
            countLabel,
            toggleOpen,
            onCheckboxChange,
            onRadioChange,
        };
    },
    template: `
    <div class="gal-dropdown">
        <button class="gal-btn" style="font-size:10px" @click.stop="toggleOpen">
            {{ label }}{{ countLabel }} &#9660;
        </button>
        <div class="gal-dropdown-menu" :class="{ show: isOpen }"
             :style="{ maxHeight: maxHeight, minWidth: minWidth }">
            <input v-if="searchable" class="gal-dropdown-search" v-model="searchQuery"
                   :placeholder="searchPlaceholder" @click.stop />
            <div v-if="filteredOptions.length === 0" class="gal-dropdown-empty">无匹配项</div>
            <template v-if="multiple">
                <div v-for="opt in filteredOptions" :key="opt.value || opt.name" class="gal-dropdown-item">
                    <label>
                        <input type="checkbox"
                               :value="opt.value !== undefined ? opt.value : opt.name"
                               :checked="Array.isArray(modelValue) && modelValue.includes(opt.value !== undefined ? opt.value : opt.name)"
                               @change="onCheckboxChange(opt)" />
                        {{ opt.label || opt.name }}
                        <span v-if="opt.count !== undefined" style="color:#666">({{ opt.count }})</span>
                    </label>
                </div>
            </template>
            <template v-else>
                <div v-for="opt in filteredOptions" :key="opt.value" class="gal-dropdown-item"
                     @click="onRadioChange(opt.value)">
                    {{ opt.label }}
                </div>
            </template>
        </div>
    </div>
    `,
});
