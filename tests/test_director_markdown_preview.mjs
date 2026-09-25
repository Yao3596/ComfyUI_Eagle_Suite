import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "web", "js", "director_skill_node.js"), "utf8");

const rendererStart = source.indexOf("function escapeMarkdownHtml");
const rendererEnd = source.indexOf("function loadStyles", rendererStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, "director Markdown renderer must remain independently testable");

const rendererSource = source.slice(rendererStart, rendererEnd);
const renderMarkdown = Function(rendererSource + "\nreturn renderMarkdown;")();

const gfm = renderMarkdown(`# Title

> quoted **text**
> second line

## Section

**bold** and *italic* and ~~removed~~ and \`inline\`

| name | role | score |
| :--- | :---: | ---: |
| Eagle | **director** | 5 |

- item
- [x] finished

1. first
2. second

\`\`\`html
<script>alert("x")</script>
\`\`\`
`);

assert.match(gfm, /<h1 class="pp-md-h">Title<\/h1>/, "level-one headings should keep their Markdown level");
assert.match(gfm, /<h2 class="pp-md-h">Section<\/h2>/, "level-two headings should keep their Markdown level");
assert.match(gfm, /<blockquote[^>]*>quoted <strong>text<\/strong><br>second line<\/blockquote>/, "consecutive quote lines should form one block");
assert.match(gfm, /<strong>bold<\/strong>/);
assert.match(gfm, /<em>italic<\/em>/);
assert.match(gfm, /<del>removed<\/del>/);
assert.match(gfm, /<code class="pp-md-icode">inline<\/code>/);
assert.match(gfm, /<table class="pp-md-table">/, "GFM tables should render as tables instead of raw pipes");
assert.match(gfm, /<th class="pp-md-align-left">name<\/th>/);
assert.match(gfm, /<th class="pp-md-align-center">role<\/th>/);
assert.match(gfm, /<th class="pp-md-align-right">score<\/th>/);
assert.match(gfm, /<td class="pp-md-align-center"><strong>director<\/strong><\/td>/);
assert.match(gfm, /<ul><li>item<\/li><li><input class="pp-md-task" type="checkbox" disabled checked> finished<\/li><\/ul>/);
assert.match(gfm, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
assert.match(gfm, /<pre class="pp-md-code"><code data-language="html">&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;<\/code><\/pre>/);

const safe = renderMarkdown(`<img src=x onerror=alert(1)>

[safe](https://example.com/path?q=1&x=2)
[mail](mailto:test@example.com)
[relative](./guide.md)
[unsafe](javascript:alert(1))
[data](data:text/html,bad)`);

assert.ok(!safe.includes("<img"), "raw HTML must never pass through the renderer");
assert.ok(!safe.includes("<script"), "script markup must never pass through the renderer");
assert.ok(!safe.includes("javascript:"), "javascript links must be rejected");
assert.ok(!safe.includes("data:text"), "data links must be rejected");
assert.match(safe, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(safe, /href="https:\/\/example\.com\/path\?q=1&amp;x=2"/);
assert.match(safe, /href="mailto:test@example\.com"/);
assert.match(safe, /href="\.\/guide\.md"/);

const pipeCells = renderMarkdown(`| expression | note |
| --- | --- |
| \`a|b\` | escaped \\| pipe |`);
assert.match(pipeCells, /<code class="pp-md-icode">a\|b<\/code>/, "pipes inside code spans must stay in their table cell");
assert.match(pipeCells, /<td class="pp-md-align-left">escaped \| pipe<\/td>/, "escaped pipes must stay in their table cell");

assert.ok(source.includes('class: "pp-preview-markdown"'), "the scoped preview surface must remain in use");
assert.ok(source.includes("innerHTML: selectedSkillMarkdown()"), "the preview must use the safe renderer output");
assert.ok(source.includes(".eagle-director-skill-root .pp-md-table"), "table styling must stay scoped to the director node");
assert.ok(!source.includes("window.marked"), "renderer must not depend on a frontend-global Markdown package");
assert.match(source, /\.pp-director-main\s*\{[^}]*display:flex;[^}]*flex-direction:column;/,
  "the editor column must distribute later node-height changes to its sections");
assert.match(source, /\.pp-director-preview-section\s*\{[^}]*flex:1 1 180px;[^}]*min-height:180px;/,
  "the Markdown preview section must consume the remaining node height");
assert.match(source, /\.pp-preview-markdown\s*\{[^}]*flex:1 1 auto;[^}]*max-height:none;/,
  "the Markdown preview must not retain the obsolete 280px height cap");
assert.ok(source.includes('class: "pp-director-section pp-director-preview-section"'),
  "the live Markdown preview section must opt into the growable layout");
assert.doesNotMatch(source, /\.pp-preview-markdown\s*\{[^}]*max-height:280px/,
  "the fixed Markdown preview height must not return");

console.log("director Markdown preview regression checks passed");
