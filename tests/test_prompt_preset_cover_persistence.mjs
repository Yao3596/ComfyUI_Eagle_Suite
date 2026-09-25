import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../web/js/prompt_presets.js", import.meta.url), "utf8");
const helperStart = source.indexOf("function coverValueFromResponse");
const helperEnd = source.indexOf("// ... 其他工具函数保持不变 ...", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "cover persistence helpers exist");

const requests = [];
class FakeFormData {
  constructor() { this.values = []; }
  append(name, value, filename) { this.values.push([name, value, filename]); }
}

const context = vm.createContext({
  FormData: FakeFormData,
  File: class FakeFile {},
  fetch: async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return url.endsWith("/upload_cover")
          ? { success: true, path: "covers/uploaded.png", cover: "covers/uploaded.png" }
          : { success: true, path: "covers/imported.png", cover: "covers/imported.png", url: "/eaglePromptPresets/cover?path=covers%2Fimported.png" };
      },
    };
  },
  console,
});
vm.runInContext(source.slice(helperStart, helperEnd), context);

assert.equal(
  vm.runInContext('coverValueFromResponse({cover:"covers/new.png",path:"legacy.png"})', context),
  "covers/new.png",
  "the canonical cover field wins while path stays backward-compatible",
);
assert.equal(vm.runInContext('isPersistentCoverReference("covers/existing.webp")', context), true);
assert.equal(vm.runInContext('isPersistentCoverReference("eagle-user://prompt-presets/covers/cover_0123456789abcdef0123456789abcdef.webp")', context), true);
assert.equal(vm.runInContext('isPersistentCoverReference("eagle-user://prompt-presets/covers/not-a-cover.webp")', context), false);
assert.equal(vm.runInContext('isPersistentCoverReference("eagle-user://prompt-presets/covers/../../secret.png")', context), false);
assert.equal(vm.runInContext('isPersistentCoverReference("/eaglePromptPresets/cover?path=covers%2Fx.png")', context), true);
assert.equal(vm.runInContext('isPersistentCoverReference("C:\\\\art\\\\cover.png")', context), false);
assert.equal(
  vm.runInContext('resolveTemplateCoverSource("images/cover.png", "C:\\\\vault\\\\prompts\\\\sample.md")', context),
  "C:\\vault\\prompts\\images\\cover.png",
  "Markdown-relative covers resolve beside their source document",
);

const managed = await vm.runInContext(
  'persistCoverSource("eagle-user://prompt-presets/covers/cover_0123456789abcdef0123456789abcdef.png", "tpl")',
  context,
);
assert.equal(managed, "eagle-user://prompt-presets/covers/cover_0123456789abcdef0123456789abcdef.png");
assert.equal(requests.length, 0, "managed user-data covers must not be imported again on every save");

const remote = await vm.runInContext('persistCoverSource("https://example.invalid/cover.png", "tpl")', context);
assert.equal(remote, "https://example.invalid/cover.png", "remote URLs remain external and never reach the server importer");
assert.equal(requests.length, 0);

const imported = await vm.runInContext('persistCoverSource("C:\\\\art\\\\cover.png", "tpl")', context);
assert.equal(imported, "covers/imported.png");
assert.equal(requests[0].url, "/eaglePromptPresets/import_cover");
assert.equal(requests[0].options.headers["Content-Type"], "application/json");
assert.deepEqual(JSON.parse(requests[0].options.body), { source: "C:\\art\\cover.png" });

const uploaded = await vm.runInContext('uploadPersistentCover({name:"chosen.png"}, "tpl-1")', context);
assert.equal(uploaded, "covers/uploaded.png");
assert.equal(requests[1].url, "/eaglePromptPresets/upload_cover");
assert.deepEqual(requests[1].options.body.values.map(row => row[0]), ["file", "template_id"]);

assert.equal(
  vm.runInContext('JSON.stringify(templatePreviewImages({cover:"legacy.png"}))', context),
  '["legacy.png"]',
  "legacy single-cover templates must upgrade to one preview image",
);
assert.equal(
  vm.runInContext('JSON.stringify(templatePreviewImages({cover:"legacy.png",preview_images:[]}))', context),
  '[]',
  "an explicit empty preview list must clear the legacy cover",
);
assert.equal(
  vm.runInContext('var t={cover:"stale.png",preview_images:["first.png","second.png","first.png"]}; assignTemplatePreviewImages(t,t.preview_images); JSON.stringify(t)', context),
  '{"cover":"first.png","preview_images":["first.png","second.png"]}',
  "the ordered preview list must be canonical and mirror its first item to cover",
);

assert.match(source, /for \(var previewSource of templatePreviewImages\(form\)\)/);
assert.match(source, /assignTemplatePreviewImages\(form, persistedPreviews\)/);
assert.match(source, /await props\.onSave\(\{ \.\.\.form \}\)/);
assert.match(source, /coverUploading\.value \? "处理封面…" : "保存"/);
assert.ok((source.match(/loading: "eager"/g) || []).length >= 2, "master and detail covers load eagerly");
assert.match(source, /decoding: "async"/);
assert.match(source, /_eagle_cover_retry=/);
assert.match(source, /state\.attempts >= 2 \? "" : url/);
assert.match(source, /coverDisplay\(template, "master"\)/);
assert.match(source, /coverDisplay\(template, "detail"\)/);
assert.match(source, /handleCoverLoadError\(template, "master"\)/);
assert.match(source, /handleCoverLoadError\(template, "detail"\)/);
assert.match(source, /pp-cover-placeholder/);
assert.match(source, /multiple: true/);
assert.match(source, /pp-template-preview-grid/);
assert.match(source, /pp-detail-preview-strip/);
assert.match(source, /templatePreviewImages\(template\)/);
assert.match(source, /"Markdown"\)[\s\S]{0,700}?"源码"\)[\s\S]{0,300}?onClick: copyPrompt[\s\S]{0,300}?onClick: applySelected/,
  "copy/apply controls must sit beside the Markdown/source switches");
assert.ok(!source.includes('class: "pp-detail-actions"'), "the obsolete bottom action row must be removed");
console.log("Prompt preset cover persistence: PASS");
