import { mount, unmount } from "svelte";
import H3ReviewWorkspace from "../nodes/H3ReviewWorkspace.svelte";
import { normalizeReview, normalizeWorkspace } from "../lib/contracts.js";

/**
 * @typedef {Object} ReviewMountOptions
 * @property {unknown} [review]
 * @property {unknown} [workspace]
 * @property {(path: string) => string} [resolveVideoUrl]
 * @property {(state: string) => void} [onWorkspaceChange]
 * @property {(decision: string, payload: Record<string, any>) => Promise<Record<string, any> | void>} [onDecision]
 */

/** @param {Element} target @param {ReviewMountOptions} [options] */
export function mountH3ReviewWorkspace(target, options = {}) {
  if (!(target instanceof Element)) throw new TypeError("A DOM target is required");
  const instance = mount(H3ReviewWorkspace, {
    target,
    props: {
      initialReview: normalizeReview(options.review),
      initialWorkspace: normalizeWorkspace(options.workspace),
      resolveVideoUrl: options.resolveVideoUrl,
      onWorkspaceChange: options.onWorkspaceChange,
      onDecision: options.onDecision,
    },
  });
  return {
    /** @param {unknown} value */
    setReview(value) {
      instance.setReview?.(normalizeReview(value));
    },
    /** @param {unknown} value */
    setWorkspace(value) {
      instance.setWorkspace?.(normalizeWorkspace(value));
    },
    /** @param {unknown} value */
    setBusy(value) {
      instance.setBusy?.(Boolean(value));
    },
    /** @param {unknown} value */
    setLockedToken(value) {
      instance.setLockedToken?.(value);
    },
    disposeMedia() {
      instance.disposeMedia?.();
    },
    destroy() {
      return unmount(instance);
    },
  };
}

export {
  REVIEW_WORKSPACE_SCHEMA_VERSION,
  normalizeReview,
  normalizeWorkspace,
  assertResolvedDecision,
  isValidRetryLength,
  serializeWorkspace,
  snapRetryLength,
} from "../lib/contracts.js";
