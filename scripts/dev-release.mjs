// Dev-release verification and changelog for the Developer-Prerelease branch.
// Run by .github/workflows/release.yml after the release gates, with
// RELEASE_TAG set and origin/main fetched. This branch never bumps versions
// and never publishes a "latest" release: tags are <stable>-dev.<n>, the
// stable version of record comes from main's manifest.json, and the
// changelog's first line is fixed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const tag = process.env.RELEASE_TAG || '';
const match = tag.match(/^(\d+\.\d+\.\d+)-dev\.([1-9]\d*)$/);
if (!match) {
  console.error(`Invalid dev tag "${tag}". Developer-Prerelease publishes prereleases tagged <stable>-dev.<n> (for example 3.7.0-dev.1); version numbers are not bumped on this branch. Plain semver releases are tagged on main, which keeps its own release workflow.`);
  process.exit(1);
}
const [, base, devNumber] = match;
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const versions = JSON.parse(read('versions.json'));
assert.equal(manifest.version, base, 'manifest version must stay at the stable version (no bump on Developer-Prerelease)');
assert.equal(pkg.version, base, 'package version must stay at the stable version (no bump on Developer-Prerelease)');
assert.equal(versions[base], manifest.minAppVersion, 'minimum version mismatch');
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  assert.ok(statSync(resolve(root, file)).size > 0, `missing ${file}`);
}
// The stable version of record is main's manifest, not this branch's copy.
const stableManifest = JSON.parse(execFileSync('git', ['show', 'origin/main:manifest.json'], { cwd: root, encoding: 'utf8' }));
const stable = stableManifest.version;
assert.equal(base, stable, `dev base ${base} differs from main's stable version ${stable}; merge main into Developer-Prerelease before releasing`);
const repo = process.env.GITHUB_REPOSITORY || 'pilafdob/owla-butler';
const notes = [
  'Dev build of the latest stable version. No new features are included in this build.',
  '',
  `- Stable version: **${stable}** (read from \`manifest.json\` on \`main\`)`,
  `- Dev build: \`${tag}\` from \`Developer-Prerelease\` (prerelease, never "latest")`,
  `- Stable release: https://github.com/${repo}/releases/tag/${stable}`,
  '',
  'Development build for testing only. Version numbers are not bumped on `Developer-Prerelease`; the branch only receives updates from `main` and is never merged back. To try it, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/owla-butler/`, keeping your existing `data.json`.',
  '',
].join('\n');
const out = process.env.DEV_NOTES_PATH || resolve(root, 'DEV-RELEASE-NOTES.md');
writeFileSync(out, notes);
console.log(`Dev release verified: ${tag} (stable ${stable}, dev build ${devNumber}); changelog written to ${out}`);
