/** Move a stable key before or after another key without mutating the source. */
export function moveKey(keys, source, target, after = false) {
  const result = Array.isArray(keys) ? keys.slice() : [];
  if (source === target || !result.includes(source) || !result.includes(target)) return result;
  result.splice(result.indexOf(source), 1);
  const targetIndex = result.indexOf(target);
  result.splice(targetIndex + (after ? 1 : 0), 0, source);
  return result;
}

/** Reorder just the visible keys while hidden categories retain their slots. */
export function moveVisibleKey(allKeys, visibleKeys, source, target, after = false) {
  const all = Array.isArray(allKeys) ? allKeys.slice() : [];
  const visible = Array.isArray(visibleKeys)
    ? visibleKeys.filter((key) => all.includes(key)) : [];
  if (!visible.includes(source) || !visible.includes(target)) return all;
  const moved = moveKey(visible, source, target, after);
  const slots = new Set(visible);
  let cursor = 0;
  return all.map((key) => slots.has(key) ? moved[cursor++] : key);
}
