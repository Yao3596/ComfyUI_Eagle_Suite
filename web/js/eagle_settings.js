import { app } from "../../../scripts/app.js";

export const EAGLE_SETTING_IDS = {
  blockSkillDownstream: "EagleSuite.H3.BlockSkillDownstream",
  unloadAfterSkillBatch: "EagleSuite.H3.UnloadAfterSkillBatch",
};

export function getEagleSetting(id, fallback) {
  try {
    const value = app?.ui?.settings?.getSettingValue?.(id);
    if (value !== undefined && value !== null) return value;
  } catch (_) {}
  try {
    const raw = localStorage.getItem("Comfy.Settings." + id);
    if (raw !== null) return JSON.parse(raw);
  } catch (_) {}
  return fallback;
}

app.registerExtension({
  name: "Eagle Suite Settings",
  setup() {
    app.ui.settings.addSetting({
      id: EAGLE_SETTING_IDS.blockSkillDownstream,
      name: "🦅 Eagle Suite · 导演 Skill 生成时阻断视频下游",
      type: "boolean",
      defaultValue: true,
      tooltip: "避免台本/分镜批量生成尚未完成时提前运行 H3 条件、采样和保存节点。",
    });
    app.ui.settings.addSetting({
      id: EAGLE_SETTING_IDS.unloadAfterSkillBatch,
      name: "🦅 Eagle Suite · 导演 Skill 批量完成后卸载本地 LLM",
      type: "boolean",
      defaultValue: true,
      tooltip: "最后一个场景返回后释放 Eagle transformers/llama.cpp 句柄与 CUDA 缓存，为 H3 视频模型腾出显存。",
    });
  },
});
