// Dev-release verification and changelog for the Developer-Prerelease branch.
// Run by .github/workflows/release.yml after the release gates, with
// RELEASE_TAG set and origin/main and origin/OWLA-RC fetched (full history).
//
// Branch rules (CONTRIBUTING.md, "Developer-Prerelease branch"):
// - The branch receives merges from OWLA-RC and main only. No features are
//   developed or committed here: a direct commit may touch only dev-flag code,
//   release tooling and documentation (DEV_ONLY). A merge may not change files
//   the merged branch did not change, so feature code cannot ride in on one.
//   Then OWLA-RC can be merged straight into main, without any dev flags.
// - Versions are never bumped here. A version ahead of main's stable one is
//   allowed only when it is OWLA-RC's version (the bump came from OWLA-RC).
// - Tags are <version>-dev, or <version>-dev.<n> (n >= 2) for a further build.
// - Every release is a prerelease, never "latest" (release.yml).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseSection } from './release-notes.mjs';

/** Commits on the branch's first-parent line after this one are checked (earlier history predates the rule). */
export const RULES_BASELINE = 'a208389bda18736b62e2559090d71539ebd3b5db';
/** Paths a direct commit on Developer-Prerelease may touch: dev flags, release tooling, docs. */
export const DEV_ONLY = [
  /^src\/dev-[^/]+\.ts$/,
  /^tests\/dev-[^/]+\.test\.ts$/,
  /^tests\/developer-mode\.test\.ts$/,
  /^scripts\/dev-release\.mjs$/,
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
  /^audits\//,
  /^(CONTRIBUTING|CHANGELOG|README)\.md$/,
  /^\.gitignore$/,
];
export const STABLE_LINE = 'Dev build of the latest stable version. No new features are included in this build.';

export function parseDevTag(tag) {
  const match = /^(\d+\.\d+\.\d+)-dev(?:\.([2-9]|[1-9]\d+))?$/.exec(tag);
  return match ? { base: match[1], build: match[2] ?? '1' } : null;
}
export function compareVersions(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
export const devOnly = path => DEV_ONLY.some(rule => rule.test(path));

/**
 * The version check. Returns 'stable' for a dev build of main's version, or
 * 'preview' for OWLA-RC's version ahead of main; throws otherwise.
 */
export function checkVersions({ base, manifest, pkg, versions, stable, rc }) {
  assert.equal(manifest.version, base, `manifest version ${manifest.version} does not match the tag's ${base}`);
  assert.equal(pkg.version, base, `package version ${pkg.version} does not match the tag's ${base}`);
  assert.equal(versions[base], manifest.minAppVersion, 'versions.json has no matching entry for ' + base);
  if (base === stable) return 'stable';
  assert.ok(compareVersions(base, stable) > 0, `dev base ${base} is behind main's stable ${stable}; merge main into Developer-Prerelease first`);
  assert.equal(base, rc, `version ${base} is ahead of main (${stable}) but is not OWLA-RC's version (${rc}). Versions are bumped on OWLA-RC only; merge OWLA-RC into Developer-Prerelease instead of bumping here.`);
  return 'preview';
}

/**
 * The branch-history check. commits: first-parent commits after the baseline,
 * each {sha, parents, changed (vs first parent), mergedChanged? (files the
 * merged branch changed since the merge base), fromAllowedBranch?}.
 * Returns the problems found (empty when the history follows the rules).
 */
export function historyProblems(commits) {
  const problems = [];
  for (const commit of commits) {
    if (commit.parents.length > 1) {
      if (!commit.fromAllowedBranch) { problems.push(`${commit.sha.slice(0, 7)} merges a branch other than OWLA-RC or main`); continue; }
      const extra = commit.changed.filter(path => !commit.mergedChanged.includes(path) && !devOnly(path));
      if (extra.length) problems.push(`${commit.sha.slice(0, 7)} is a merge that also changes ${extra.join(', ')}`);
      continue;
    }
    const feature = commit.changed.filter(path => !devOnly(path));
    if (feature.length) problems.push(`${commit.sha.slice(0, 7)} commits directly to Developer-Prerelease and changes ${feature.join(', ')}; develop on OWLA-RC and merge it here`);
  }
  return problems;
}

export function devNotes({ kind, tag, base, stable, repo, releaseLog }) {
  if (kind === 'stable') return [
    STABLE_LINE, '',
    `- Stable version: **${stable}** (read from \`manifest.json\` on \`main\`)`,
    `- Dev build: \`${tag}\` from \`Developer-Prerelease\` (prerelease, never "latest")`,
    `- Stable release: https://github.com/${repo}/releases/tag/${stable}`, '',
    'Development build for testing only. To try it, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/owla-butler/`, keeping your existing `data.json`.', '',
  ].join('\n');
  const section = releaseSection(releaseLog, base);
  assert.ok(section, `RELEASE-NOTES.md has no "# OWLA Butler ${base}" section`);
  return [
    `Dev prerelease of OWLA Butler ${base} from \`OWLA-RC\`, for testing before the stable release. It is not a stable release yet.`, '',
    `- Version: **${base}** (from \`OWLA-RC\`; latest stable on \`main\`: ${stable})`,
    `- Dev build: \`${tag}\` from \`Developer-Prerelease\` (prerelease, never "latest")`, '',
    section.replace(/^# OWLA Butler .*\n+/, ''), '',
    'Development build for testing only, never offered through Obsidian Community plugins. To try it, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/owla-butler/`, keeping your existing `data.json`. Back up the vault first.', '',
  ].join('\n');
}

function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const read = path => readFileSync(resolve(root, path), 'utf8');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const tag = process.env.RELEASE_TAG || '';
  const parsed = parseDevTag(tag);
  if (!parsed) {
    console.error(`Invalid dev tag "${tag}". Developer-Prerelease publishes prereleases tagged <version>-dev (for example 3.8.0-dev; a further build of the same version may use 3.8.0-dev.2). Plain semver releases are tagged on main.`);
    process.exit(1);
  }
  const { base, build } = parsed;
  const manifest = JSON.parse(read('manifest.json'));
  for (const file of ['main.js', 'manifest.json', 'styles.css']) assert.ok(statSync(resolve(root, file)).size > 0, `missing ${file}`);
  const stable = JSON.parse(git('show', 'origin/main:manifest.json')).version;
  const rc = JSON.parse(git('show', 'origin/OWLA-RC:manifest.json')).version;
  const kind = checkVersions({ base, manifest, pkg: JSON.parse(read('package.json')), versions: JSON.parse(read('versions.json')), stable, rc });

  const files = (from, to) => git('diff', '--name-only', from, to).split('\n').filter(Boolean);
  const allowed = sha => ['origin/OWLA-RC', 'origin/main'].some(ref => { try { git('merge-base', '--is-ancestor', sha, ref); return true; } catch { return false; } });
  const shas = git('rev-list', '--first-parent', `${RULES_BASELINE}..HEAD`).split('\n').filter(Boolean);
  const commits = shas.map(sha => {
    const parents = git('rev-list', '--parents', '-n', '1', sha).split(' ').slice(1);
    const commit = { sha, parents, changed: files(parents[0], sha) };
    if (parents.length > 1) Object.assign(commit, { fromAllowedBranch: allowed(parents[1]), mergedChanged: files(git('merge-base', parents[0], parents[1]), parents[1]) });
    return commit;
  });
  const problems = historyProblems(commits);
  if (problems.length) {
    console.error('Developer-Prerelease must only receive OWLA-RC and main (plus dev flags, release tooling and docs):\n- ' + problems.join('\n- '));
    process.exit(1);
  }

  const repo = process.env.GITHUB_REPOSITORY || 'pilafdob/owla-butler';
  const notes = devNotes({ kind, tag, base, stable, repo, releaseLog: read('RELEASE-NOTES.md') });
  const out = process.env.DEV_NOTES_PATH || resolve(root, 'DEV-RELEASE-NOTES.md');
  writeFileSync(out, notes);
  console.log(`Dev release verified: ${tag} (${kind === 'stable' ? 'stable ' + stable : 'OWLA-RC ' + base + ', stable ' + stable}, dev build ${build}, ${commits.length} commit(s) checked); changelog written to ${out}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
