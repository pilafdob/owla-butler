import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
const versions = JSON.parse(readFileSync(join(root, 'versions.json')));
if (pkg.version !== manifest.version || versions[manifest.version] !== manifest.minAppVersion) throw Error('Release metadata differs.');
for (const name of ['assets/bird.svg', 'assets/PHOSPHOR-LICENSE']) {
  const file = join(root, name);
  if (!existsSync(file) || !statSync(file).size) throw Error(`Missing Phosphor attribution asset: ${name}`);
}
if (!readFileSync(join(root, 'main.js'), 'utf8').includes('Copyright (c) 2023 Phosphor Icons')) {
  throw Error('Built main.js lacks the Phosphor license notice.');
}
const output = resolve(process.argv[2] || join(root, 'dist', `owla-butler-${manifest.version}.zip`));
const staging = mkdtempSync(join(tmpdir(), 'owla-package-'));
try {
  const folder = join(staging, 'owla-butler');
  mkdirSync(folder);
  for (const name of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'README.md', 'TESTING.md', 'AUDIT.md', 'RELEASE-CANDIDATE.md', 'CAPABILITY-CHECKLIST.md', 'CHANGELOG.md', 'RELEASE-NOTES.md', 'THIRD-PARTY-NOTICES.md', 'COMMUNITY-RELEASE.md', 'assets']) {
    const source = join(root, name);
    if (!existsSync(source) || (statSync(source).isFile() && !statSync(source).size)) throw Error(`Missing package content: ${name}`);
    cpSync(source, join(folder, name), { recursive: true });
  }
  const entries = [];
  function walk(folder, prefix) {
    for (const name of readdirSync(folder).sort()) {
      if (name === '.DS_Store') continue;
      if (name.startsWith('.')) throw Error(`Unexpected hidden package file: ${name}`);
      const path = join(folder, name), relative = `${prefix}/${name}`;
      if (statSync(path).isDirectory()) walk(path, relative); else entries.push(relative);
    }
  }
  walk(folder, 'owla-butler');
  // A release ZIP is public even when the source repository is still private.
  // Fail closed on common credential shapes and machine-specific home paths.
  const sensitive = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AIza[0-9A-Za-z_-]{30,})\b/,
    /\/Users\/[^/\s"`<>]+/,
  ];
  for (const relative of entries) {
    const body = readFileSync(join(staging, relative), 'utf8');
    if (sensitive.some(pattern => pattern.test(body))) throw Error(`Possible private data in package: ${relative}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  execFileSync('zip', ['-X', '-q', output, ...entries], { cwd: staging });
  const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
  writeFileSync(`${output}.sha256`, `${sha256}  ${output.split('/').at(-1)}\n`);
  const sums = ['main.js', 'manifest.json', 'styles.css'].map(name => createHash('sha256').update(readFileSync(join(root, name))).digest('hex') + '  ' + name);
  sums.push(sha256 + '  ' + output.split('/').at(-1));
  writeFileSync(join(dirname(output), `owla-butler-${manifest.version}-SHA256SUMS.txt`), sums.join('\n') + '\n');
  console.log(JSON.stringify({ output, sha256, files: entries.length, bytes: statSync(output).size }));
} finally { rmSync(staging, { recursive: true, force: true }); }
