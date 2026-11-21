// Release notes for one version. RELEASE-NOTES.md is the release log: one
// "# OWLA Butler <version>" section per release, newest first. A GitHub
// release shows only its own section, followed by a link to the full
// changelog, never the whole log.
//
// Usage: node scripts/release-notes.mjs <version> [output-file]
// Prints the notes, or writes them to output-file. Exits 1 if the log has no
// section for that version.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADING = /^# OWLA Butler (\S+)\s*$/;

/** The body of the "# OWLA Butler <version>" section (heading included), or null. */
export function releaseSection(log, version) {
  const lines = log.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => HEADING.exec(line)?.[1] === version);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('# ')) { end = i; break; }
  return lines.slice(start, end).join('\n').trim();
}

/** The GitHub release body for a version: its own section plus a changelog link. */
export function releaseNotes(log, version, repo = 'pilafdob/owla-butler') {
  const section = releaseSection(log, version);
  if (section === null) return null;
  return `${section}\n\nFull changelog: [CHANGELOG.md](https://github.com/${repo}/blob/${version}/CHANGELOG.md)\n`;
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const [version, out] = process.argv.slice(2);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const notes = version ? releaseNotes(readFileSync(resolve(root, 'RELEASE-NOTES.md'), 'utf8'), version, process.env.GITHUB_REPOSITORY || undefined) : null;
  if (notes === null) {
    console.error(`RELEASE-NOTES.md has no "# OWLA Butler ${version ?? '<version>'}" section.`);
    process.exit(1);
  }
  if (out) writeFileSync(out, notes);
  else process.stdout.write(notes);
}
