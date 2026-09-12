export const REVIEW_WORKSPACE_SCHEMA_VERSION = 2;
export const H3_LENGTH_BASE = 5;
export const H3_LENGTH_STRIDE = 17;
export const H3_LENGTH_MAX = 3592;

const DEFAULT_WORKSPACE = Object.freeze({
  version: REVIEW_WORKSPACE_SCHEMA_VERSION,
  selectedTakeKey: "",
  retryPrompt: "",
  retrySeed: -1,
  retryLength: 0,
  assemblePartial: true,
  timeoutMinutes: 0,
  unloadModels: false,
  autoplay: false,
});

/** @param {unknown} value @param {number} [fallback] */
function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** @param {unknown} value @returns {Record<string, any>} */
function parseObject(value) {
  if (value && typeof value === "object") return /** @type {Record<string, any>} */ (value);
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** Return the nearest legal H3 model length: 0 or 17k+5. @param {unknown} value */
export function snapRetryLength(value) {
  const number = Math.trunc(finite(value, 0));
  if (number <= 0) return 0;
  const clamped = Math.min(H3_LENGTH_MAX, Math.max(H3_LENGTH_BASE, number));
  return H3_LENGTH_BASE
    + H3_LENGTH_STRIDE * Math.round((clamped - H3_LENGTH_BASE) / H3_LENGTH_STRIDE);
}

/** @param {unknown} value */
export function isValidRetryLength(value) {
  const number = Number(value);
  return Number.isInteger(number)
    && (number === 0
      || (number >= H3_LENGTH_BASE
        && number <= H3_LENGTH_MAX
        && (number - H3_LENGTH_BASE) % H3_LENGTH_STRIDE === 0));
}

/** Migrate legacy keys without retaining the path. @param {unknown} value */
export function normalizeTakeKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const compact = text.match(/^s?(\d+):r?(\d+)/i);
  if (!compact) return "";
  return `${Number(compact[1])}:${Number(compact[2])}`;
}

/** Require an explicit positive resolution acknowledgement. @param {unknown} body */
export function assertResolvedDecision(body) {
  if (!body || typeof body !== "object") throw new Error("审片接口未返回 JSON 对象");
  const result = /** @type {Record<string, any>} */ (body);
  if (result.resolved === false || result.resolved_success === false) {
    throw new Error(String(result.error || result.message || "审片 token 尚未成功解析"));
  }
  if (result.resolved !== true && result.resolved_success !== true) {
    throw new Error("审片接口未确认 resolved=true");
  }
  return result;
}

/** @param {unknown} value @returns {Record<string, any>} */
export function normalizeWorkspace(value) {
  const raw = parseObject(value);
  const retry = raw.retry && typeof raw.retry === "object" ? raw.retry : raw;
  const options = raw.options && typeof raw.options === "object" ? raw.options : raw;
  return {
    version: REVIEW_WORKSPACE_SCHEMA_VERSION,
    selectedTakeKey: normalizeTakeKey(raw.selectedTakeKey || raw.selected_take_key || ""),
    retryPrompt: String(retry.prompt ?? retry.retryPrompt ?? ""),
    retrySeed: Math.trunc(finite(retry.seed ?? retry.retrySeed, -1)),
    retryLength: snapRetryLength(retry.length ?? retry.retryLength),
    assemblePartial: Boolean(options.assemblePartial ?? options.assemble_partial ?? true),
    timeoutMinutes: Math.max(0, finite(options.timeoutMinutes ?? options.timeout_minutes, 0)),
    unloadModels: Boolean(options.unloadModels ?? options.unload_models ?? false),
    autoplay: Boolean(options.autoplay ?? false),
  };
}

/** @param {unknown} value @returns {string} */
export function serializeWorkspace(value) {
  const state = normalizeWorkspace(value);
  return JSON.stringify({
    version: state.version,
    selectedTakeKey: state.selectedTakeKey,
    retry: {
      prompt: state.retryPrompt,
      seed: state.retrySeed,
      length: state.retryLength,
    },
    options: {
      assemblePartial: state.assemblePartial,
      timeoutMinutes: state.timeoutMinutes,
      unloadModels: state.unloadModels,
      autoplay: state.autoplay,
    },
  });
}

/** @param {Record<string, any> | null | undefined} take */
export function takeKey(take) {
  if (!take || typeof take !== "object") return "";
  return `${Math.trunc(finite(take.index, 0))}:${Math.trunc(finite(take.revision, 1))}`;
}

/** @param {unknown} value @returns {Record<string, any>} */
export function normalizeReview(value) {
  const raw = value && typeof value === "object"
    ? /** @type {Record<string, any>} */ (value)
    : {};
  const history = Array.isArray(raw.history)
    ? raw.history
      .filter((/** @type {unknown} */ item) => item && typeof item === "object")
      .map((/** @type {Record<string, any>} */ item) => ({ ...item }))
    : [];
  if (!history.length && (raw.preview_clip || raw.clip_path)) {
    history.push({
      index: finite(raw.current_index, 0),
      revision: finite(raw.revision, 1),
      clip_path: String(raw.preview_clip || raw.clip_path),
      prompt: String(raw.prompt || ""),
      seed: finite(raw.seed, -1),
      length: finite(raw.length, 0),
    });
  }
  return { ...raw, history };
}

/** @param {Record<string, any> | null | undefined} review */
export function reviewPhase(review) {
  if (!review || typeof review !== "object" || !Object.keys(review).length) return "waiting";
  if (review.awaiting_review) return "reviewing";
  const decision = String(review.decision || "").toLowerCase();
  if (decision === "approve_stop") return "stopped";
  if (decision === "retry" || decision === "reroll" || decision === "resume") return "retrying";
  if (decision === "approve") return "approved";
  if (decision === "error") return "error";
  return "ready";
}

export function defaultWorkspace() {
  return { ...DEFAULT_WORKSPACE };
}
