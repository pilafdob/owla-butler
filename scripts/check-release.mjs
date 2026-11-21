import assert from 'node:assert/strict';
import {isBuiltin} from 'node:module';
import { runInNewContext } from 'node:vm';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseSection } from './release-notes.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const versions = JSON.parse(read('versions.json'));
assert.match(manifest.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, manifest.version, 'package version mismatch');
assert.equal(lock.version, manifest.version, 'lockfile version mismatch');
assert.equal(lock.packages[''].version, manifest.version, 'lockfile root version mismatch');
assert.equal(versions[manifest.version], manifest.minAppVersion, 'minimum version mismatch');
assert.equal(manifest.isDesktopOnly, true);
assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
assert.ok(manifest.name && manifest.author && manifest.authorUrl);
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, manifest.version, 'tag must equal manifest version (no v prefix)');
for (const path of ['main.js', 'manifest.json', 'styles.css', 'README.md', 'LICENSE', 'CHANGELOG.md', 'RELEASE-NOTES.md', 'COMMUNITY-RELEASE.md', 'THIRD-PARTY-NOTICES.md']) {
  assert.ok(statSync(resolve(root, path)).size > 0, `missing ${path}`);
}
assert.ok(releaseSection(read('RELEASE-NOTES.md'), manifest.version), `RELEASE-NOTES.md has no "# OWLA Butler ${manifest.version}" section`);
const main = read('main.js');
for (const path of ['LICENSE', 'assets/PHOSPHOR-LICENSE', 'assets/CROSS-SPAWN-LICENSE', 'assets/skills/OBSIDIAN-SKILLS-LICENSE', 'assets/DIFF-LICENSE', 'assets/FFLATE-LICENSE', 'assets/PDF-LIB-LICENSE', 'assets/PDF-FONTS-LICENSE', 'assets/PDF-UPNG-LICENSE', 'assets/PAKO-LICENSE', 'assets/TSLIB-COPYRIGHT', 'assets/TSLIB-LICENSE']) {
  assert.ok(main.includes(read(path).trim().replace(/\*\//g, '* /')), `built bundle lacks full notice: ${path}`);
}
for (const name of ['obsidian-markdown', 'obsidian-bases', 'json-canvas', 'owla-pdf', 'owla-math', 'owla-ocr', 'owla-formatting', 'owla-mermaid', 'owla-excalidraw', 'owla-canvas', 'owla-bases']) assert.ok(main.includes(name), `missing embedded guide: ${name}`);
const referencePack = JSON.parse(read('assets/reference-pack.json'));
// Unminified builds keep the import name and pretty layout; minified builds
// rename the variable and compact the literal. Locate the object by its first
// pack key, then scan to the matching brace while respecting string literals.
let literal = null;
const legacy = main.match(/var reference_pack_default = (\{[\s\S]*?\n\});/);
if (legacy) literal = legacy[1];
else {
  const firstKey = Object.keys(referencePack)[0];
  const head = main.match(new RegExp('\\bvar\\s+[A-Za-z_$][\\w$]*=\\{' + JSON.stringify(firstKey).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':'));
  assert.ok(head, 'embedded reference table missing');
  const begin = head.index + head[0].indexOf('{'); // at the object's opening brace
  let depth = 0, quote = null, escaped = false, end = -1;
  for (let i = begin; i < main.length; i++) {
    const ch = main[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > begin, 'embedded reference table missing');
  literal = main.slice(begin, end);
}
const embedded = runInNewContext('(' + literal + ')', Object.create(null), { timeout: 1000 });
for (const [name, content] of Object.entries(referencePack)) {
  assert.equal(embedded[name], content, `reference not fully embedded: ${name}`);
}
// Obsidian supplies its editor modules alongside Electron and Node built-ins.
for (const [, module] of main.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
  assert.ok(module === 'obsidian' || module === 'electron' || module === '@codemirror/state' || module === '@codemirror/view' || isBuiltin(module), `unbundled runtime dependency: ${module}`);
}
assert.ok(!/readFileSync\([^\n]*reference-pack/.test(main), 'references must not require a runtime asset directory');
console.log(`Release checks passed: ${manifest.id} ${manifest.version}; three-file bundle and full notices verified.`);
