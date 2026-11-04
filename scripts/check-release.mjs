import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const versions = JSON.parse(read('versions.json'));
assert.match(manifest.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, manifest.version, 'package version mismatch');
assert.equal(versions[manifest.version], manifest.minAppVersion, 'minimum version mismatch');
assert.equal(manifest.isDesktopOnly, true);
assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
assert.ok(manifest.name && manifest.author && manifest.authorUrl);
if (process.env.RELEASE_TAG) assert.equal(process.env.RELEASE_TAG, manifest.version, 'tag must equal manifest version (no v prefix)');
for (const path of ['main.js', 'manifest.json', 'styles.css', 'README.md', 'LICENSE', 'CHANGELOG.md', 'RELEASE-NOTES.md', 'COMMUNITY-RELEASE.md', 'THIRD-PARTY-NOTICES.md']) {
  assert.ok(statSync(resolve(root, path)).size > 0, `missing ${path}`);
}
const main = read('main.js');
for (const path of ['LICENSE', 'assets/PHOSPHOR-LICENSE', 'assets/skills/OBSIDIAN-SKILLS-LICENSE', 'assets/DIFF-LICENSE']) {
  assert.ok(main.includes(read(path).trim().replace(/\*\//g, '* /')), `built bundle lacks full notice: ${path}`);
}
for (const name of ['obsidian-markdown', 'obsidian-bases', 'json-canvas', 'owla-pdf', 'owla-math', 'owla-ocr']) assert.ok(main.includes(name), `missing embedded guide: ${name}`);
const referencePack = JSON.parse(read('assets/reference-pack.json'));
const literal = main.match(/var reference_pack_default = (\{[\s\S]*?\n\});/);
assert.ok(literal, 'embedded reference table missing');
const embedded = runInNewContext('(' + literal[1] + ')', Object.create(null), { timeout: 1000 });
for (const [name, content] of Object.entries(referencePack)) {
  assert.equal(embedded[name], content, `reference not fully embedded: ${name}`);
}
// Only the Obsidian host, Electron and Node built-ins may be required at runtime.
for (const [, module] of main.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
  assert.ok(module === 'obsidian' || module === 'electron' || module.startsWith('node:'), `unbundled runtime dependency: ${module}`);
}
assert.ok(!/readFileSync\([^\n]*reference-pack/.test(main), 'references must not require a runtime asset directory');
console.log(`Release checks passed: ${manifest.id} ${manifest.version}; three-file bundle and full notices verified.`);
