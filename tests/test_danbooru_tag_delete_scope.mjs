import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../web/js/danbooru_search_vue.js', import.meta.url), 'utf8');
const start = source.indexOf('function shouldConsumeTagDelete(');
const end = source.indexOf('\nconst TagEditor = ', start);
assert.ok(start >= 0 && end > start, 'scoped Delete predicate must exist');
const shouldConsumeTagDelete = Function(`${source.slice(start, end)}\nreturn shouldConsumeTagDelete;`)();
const protectStart = source.indexOf('function shouldProtectDanbooruEditing(');
const protectEnd = source.indexOf('\nconst TagEditor = ', protectStart);
assert.ok(protectStart >= 0 && protectEnd > protectStart);
const shouldProtectDanbooruEditing = Function(`${source.slice(protectStart, protectEnd)}\nreturn shouldProtectDanbooruEditing;`)();

const region = { isConnected: true };
const plain = (key = 'Delete', target = {}) => ({ key, target });
assert.equal(shouldConsumeTagDelete(plain(), 1, region, region), true,
  'selected chip claims plain Delete ahead of ComfyUI node deletion');
assert.equal(shouldConsumeTagDelete(plain('Backspace'), 2, region, region), true);
assert.equal(shouldConsumeTagDelete(plain(), 0, region, region), false);
assert.equal(shouldConsumeTagDelete(plain(), 1, {}, region), false,
  'a different Danbooru node must not consume Delete');
assert.equal(shouldConsumeTagDelete(plain(), 1, region, { isConnected: false }), false,
  'removed widgets must release their keyboard ownership');
assert.equal(shouldConsumeTagDelete(plain('Escape'), 1, region, region), false);
assert.equal(shouldConsumeTagDelete({ ...plain(), ctrlKey: true }, 1, region, region), false);
assert.equal(shouldConsumeTagDelete({ ...plain(), isComposing: true }, 1, region, region), false);

for (const selector of ['input', 'textarea', 'select', '[contenteditable]']) {
  const editable = { closest: query => query.includes(selector) ? {} : null };
  assert.equal(shouldConsumeTagDelete(plain('Delete', editable), 1, region, region), false,
    `${selector} keeps native text/form Delete behavior`);
}
assert.equal(shouldConsumeTagDelete(plain('Delete', { isContentEditable: true }), 1, region, region), false);

const input = { closest: selector => selector.includes('input') ? {} : null };
const otherInput = { closest: input.closest };
const danbooruRoot = { isConnected: true, contains: target => target === input };
assert.equal(shouldProtectDanbooruEditing(plain('Delete', input), danbooruRoot), true,
  'Delete inside a Danbooru textbox is isolated from the graph shortcut');
assert.equal(shouldProtectDanbooruEditing(plain('Backspace', input), danbooruRoot), true);
assert.equal(shouldProtectDanbooruEditing(plain('Delete', otherInput), danbooruRoot), false,
  'editable controls in unrelated nodes keep their own event routing');
assert.equal(shouldProtectDanbooruEditing(plain('Home', input), danbooruRoot), false);
assert.equal(shouldProtectDanbooruEditing(plain('Delete', input), { ...danbooruRoot, isConnected: false }), false);

assert.match(source, /window\.addEventListener\("keydown", deleteSelectedTags, true\)/,
  'output chips must capture before the graph-wide shortcut');
assert.match(source, /window\.removeEventListener\("keydown", deleteSelectedTags, true\)/,
  'output chips must release the listener on unmount');
assert.match(source, /window\.addEventListener\("keydown", deleteSelected, true\)/,
  'category manager must use the same scoped capture');
assert.match(source, /window\.removeEventListener\("keydown", deleteSelected, true\)/);
assert.match(source, /function selectVisible\(\)\s*\{[\s\S]*?activeTagDeleteOwner = selected\.size \? listElement\.value : null;/,
  'category-manager Select Visible also activates scoped Delete');
assert.match(source, /event\.stopImmediatePropagation\?\.\(\);[\s\S]*?event\.stopPropagation\(\)/,
  'claimed Delete must not reach ComfyUI node deletion');
assert.match(source, /window\.addEventListener\("pointerdown", releaseDeleteOwner, true\)/,
  'clicking outside the editor clears ownership without changing ComfyUI shortcuts');
assert.match(source, /window\.addEventListener\("focusin", releaseDeleteOwner, true\)/,
  'keyboard focus outside the editor also clears ownership');
assert.match(source, /window\.addEventListener\("keydown", protectNativeEditing, true\)/,
  'the Danbooru root protects text editing before ComfyUI node shortcuts');
assert.match(source, /window\.removeEventListener\("keydown", protectNativeEditing, true\)/,
  'the root listener must be released on unmount');
assert.match(source, /function protectNativeEditing\(event\)\s*\{[\s\S]*?event\.stopImmediatePropagation\?\.\(\);[\s\S]*?event\.stopPropagation\(\);/,
  'native editing stops propagation but not default text deletion');
const nativeEditing = source.slice(source.indexOf('function protectNativeEditing('), source.indexOf('\n    function inputConnected(', source.indexOf('function protectNativeEditing(')));
assert.doesNotMatch(nativeEditing, /preventDefault/, 'do not prevent the browser from deleting input text');
assert.doesNotMatch(source, /class: "dbs-root", onContextmenu:/,
  'right-clicking blank Danbooru space remains a native node action');

console.log('Danbooru selected-tag Delete isolation: PASS');
