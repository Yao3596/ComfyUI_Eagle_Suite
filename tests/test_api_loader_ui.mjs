import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../web/js/api_key_input.js', import.meta.url), 'utf8');
assert.match(source, /检查连通并读取模型/);
assert.match(source, /remoteSelect\.addEventListener\('change'/);
assert.match(source, /inputs\.model\.value = remoteSelect\.value/);
assert.match(source, /profile_name: initial\.source_profile/);
assert.match(source, /不会发送聊天或生图请求/);
assert.match(source, /已保存引用失效/);
assert.doesNotMatch(source, /initial\.lockName/);
console.log('API loader edit/model-switch UI: PASS');
