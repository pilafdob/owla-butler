# 3.7.0 RC Windows pass — tool calls, vault context & features (win-tools)

Scope: owned tool/context modules — `src/canvas.ts`, `src/bases.ts`, `src/excalidraw.ts`,
`src/vault-graph.ts`, `src/plugin-api.ts`, `src/pdf-tools.ts`, `src/organization.ts`,
`src/note-tools.ts`, `src/knowledge.ts`, `src/search.ts` — plus their tests. Everything
else read-only; cross-file work proposed below. Branch `3.7.0-RC`, base `81540fb`.
Shared contract: `windows-pass-brief.md`. Round-1 inputs read: `tools-context.md`
(F1–F11, R1–R6) and `REVIEW-rc-hardening-pass.md` §4.8 (pre-folded `under()`) and
§5 item 9 (checkpoint O(M×N), RISKY — design only, honoured).

Method: code review of every owned entry point + real Windows probes (scratch
`…/hermes/cache/scratch/win-tools/`, junctions/hard links created unprivileged,
read-only elsewhere) + regression tests. No builds, no git writes, no vault mutations,
no provider contact. Sibling WIP (8 agents) present throughout; final gates re-run
after convergence.

## Verification (final)

- `npm run check` — **exit 0, zero TS errors**.
- `npm run lint` — **clean** (`eslint src`, no output).
- Owned + new tests (18 files): **96/96 pass**.
- Full suite: **714 tests, 713 pass, 0 fail, 1 skip**. The skip is
  `tests/security-vault.test.ts` "symlinks to hardlinked files do not pass" —
  win-security's runtime `{skip: 'needs Windows Developer Mode'}` for the one genuine
  FILE-symlink assertion. All 12 fan-out baseline symlink failures were fixed by their
  owners during the pass; none remain.
- New tests: `tests/audit-win-tools-crlf.test.ts` (14), `tests/audit-win-tools-graph.test.ts`
  (11), `tests/audit-win-tools-organization.test.ts` (9), `tests/audit-win-tools-paths.test.ts`
  (3) — 37 tests. Organization fixtures use junctions + hard links (work without
  Developer Mode; on POSIX the junction type argument is ignored and a symlink is
  created, exercising the same refusal). Case-alias tests self-adapt via
  `statSync(alias)` so they assert the right behaviour on case-sensitive filesystems too.

## Findings & fixes applied (9)

### F1 — HIGH — `src/note-tools.ts:146` `findBlock` returned the whole CRLF note
- Windows/general: paragraph boundaries were found with `indexOf('\n\n')` /
  `lastIndexOf('\n\n')`. A CRLF note separates paragraphs with `\r\n\r\n`, which that
  search never finds. Probe: `findBlock('Intro\n\nPara one ^blk\n\nPara two\n')` →
  `{start:7,end:20}`; the CRLF variant → `{start:0,end:36}` — `read_note block=^blk`
  handed the model the entire note instead of the paragraph (and offsets past the
  block leaked unrelated content into the turn).
- Fix: one `/\r?\n\r?\n/g` gap scan assigns start/end. LF ranges are byte-for-byte
  identical (proved by the POSIX guard test); CRLF now returns `{start:9,end:22}` =
  `'Para one ^blk'`. Mixed endings (`\r\n\n`, `\n\r\n`) also work.
- Tests: "findBlock returns the paragraph, not the whole note, on CRLF text",
  "findBlock LF ranges are unchanged (POSIX regression guard)", "findBlock handles
  first and last paragraphs and mixed endings".

### F2 — HIGH — `src/vault-graph.ts` result cap not enforced; frontmatter could exhaust memory
- Round-1 F7 claimed "<60 KB" but nothing enforced it. Measured on the round-1 code:
  - 200 huge tags (3000 chars each): **300,633 bytes**.
  - moderately nested frontmatter (branch 3, depth 5): **180,572 bytes**.
  - anchor-expanded frontmatter (shared references, as js-yaml produces for YAML
    anchors — verified: a **116-byte** YAML doc parses to shared refs): baseline
    `noteGraph` + `JSON.stringify` emitted **64,919,121 bytes (≈65 MB)** from a few
    hundred references; deeper non-shared trees exhaust the heap outright (probe
    aborted at 4 GB). A small hostile note could freeze the renderer or leak a
    megabyte-scale tool result into the next turn.
  - 300-character paths (Windows allows >260; probe wrote/read a 464-char path fine)
    × 300 links push past 60 KB once outgoing+unresolved+backlinks combine.
- Fix (three layers, `vault-graph.ts:26-72,95-150`):
  1. `shortValue` now threads a shared `Budget` (`PROPERTY_BUDGET=4_000`); every
     emitted node charges it (strings by length, object keys by length, placeholders
     too), so construction itself is bounded — no expansion blow-up.
  2. `shortText` caps displayed tags, unresolved-link text and query echoes
     (`tag`/`property`/`value`) at 500 chars + marker.
  3. `boundGraph` hard-caps the serialized result at `RESULT_LIMIT=60_000`: halves the
     longest lists (`items/backlinks/unresolved/outgoing/tags`), then empties
     `properties` as a last resort. Counts (`outgoingCount`, `total`, …) keep
     describing the full graph. Normal results pass through untouched.
  - Property queries now page first, then truncate the displayed page with one shared
    budget; matching still runs on raw values (round-1 contract preserved).
- After: huge tags 51,743; nested 5,441; anchor DAG **6,227 bytes / 0 ms**; property
  query 150×5000-char values 8,486; long-path graphs ≤60 KB with counts intact.
- Tests: "noteGraph stays under 60 KB with 300-character Windows paths", "noteGraph
  bounds huge tag strings", "anchor-expanded frontmatter cannot balloon or exhaust
  the result", "a property query with 150 huge values stays bounded and matches raw
  values", "unresolved and orphans reports stay bounded with long links and paths",
  "huge query echoes are truncated, not mirrored into the result". Round-1 tests
  (`audit-tools-vault-graph`) still pass unchanged.

### F3 — MED — `src/canvas.ts:166` serializer reformatted CRLF canvases to LF
- Round-1 F2 made LF canvases round-trip byte-identically, but a CRLF `.canvas`
  (Windows editors, git autocrlf) failed: probe `serializeCanvas(parseCanvas(crlf),crlf)
  === crlf` → **false**; every proposal rewrote the whole file. The sibling main.ts
  normalization explicitly keeps canvas bytes exact, so this was the missing half.
- Fix: derive `eol` from the original (`original.includes('\r\n')` — raw CRLF in valid
  canvas JSON can only be line endings, since `JSON.stringify` escapes control chars
  inside strings); emit all structural newlines with it and preserve a trailing
  newline in the source's style. LF output is byte-identical to before.
- Tests: "serializeCanvas round-trips a CRLF canvas byte-identically", "serializeCanvas
  LF round-trip is unchanged (POSIX regression guard)", "a one-card change in a CRLF
  canvas alters exactly one line".

### F4 — MED — `src/note-tools.ts:38` `updateProperties` rewrote CRLF frontmatter with LF
- Probe: a CRLF note's frontmatter came back `---\n…\n---\n` while the body stayed
  CRLF — mixed endings in one file and a diff showing every property line changed.
- Fix: `eol` from the existing block (or the note when adding frontmatter); the
  stringified YAML is normalized then re-emitted with that EOL. LF behaviour is
  byte-identical (guard test). Body untouched, `before`/`after` contract unchanged.
- Tests: "updateProperties keeps a CRLF frontmatter in CRLF and the body
  byte-identical", "updateProperties LF output is unchanged (POSIX regression guard)",
  "updateProperties adds frontmatter in the note's CRLF style and removes it cleanly".

### F5 — MED — `src/vault-graph.ts:95` case-fold alias silently returned an empty graph
- NTFS/APFS resolve `notes/a.md` to `Notes/A.md`, and `allowedNote` accepts the alias
  (statSync+realpath+fold), but Obsidian's cache keys use the exact spelling:
  `resolvedLinks['notes/a.md']` is undefined → the model got an empty graph with no
  error and no hint. Probe: case-alias stat/realpath resolve on this machine.
- Fix: when neither cache has the exact key, resolve the alias via `foldPath` over
  `source.notes()` and use the canonical spelling everywhere (result `path` included,
  so follow-up calls use the exact form). On case-sensitive filesystems `allowed()`
  already refuses aliases (statSync ENOENT), so the fallback never fires there —
  POSIX behaviour preserved and tested. Exclusion semantics unchanged: `allowedPath`
  folds, so an alias is allowed iff its canonical is.
- Tests: "noteGraph resolves a case-fold alias to the exact vault spelling",
  "noteGraph folds Unicode aliases the way the filesystem does" (Straße/STRAẞE/strasse),
  "a case-sensitive allowed() still refuses aliases (POSIX preserved)", "exact paths
  skip the alias scan and small graphs keep their shape".

### F6 — MED — `src/organization.ts:119` `list` refused case-fold folder aliases
- `list_vault_paths` with `notes` when the folder is `Notes` failed on NTFS even
  though the folder exists — a common model guess on Windows.
- Fix: when the exact lookup misses, fall back **only if the filesystem itself
  resolves the alias to a real directory** (`lstat` isDirectory && !isSymbolicLink —
  junctions/symlinks never qualify) and list the canonical Obsidian spelling.
  Exclusion check runs first and is fold-based, so an excluded alias is still refused;
  mobile (no `base()`) behaviour unchanged; junction children stay filtered by
  `safeSource`.
- Tests: "list resolves a case-fold alias only when the filesystem resolves it",
  "list still refuses excluded folders through case and Unicode aliases", "list never
  falls back through a junction, and filters junction entries".

### F7 — LOW — `src/note-tools.ts:224` `tableAt` capture ended with a dangling `\r`
- CRLF tables were captured correctly (round-1 delimiter fixes verified: single
  hyphen `|-|:-:|`, one-column `| - |`, fences skipped, CRLF delimiter rows), but the
  joined text kept the last line's `\r` half-terminator, differing from the editor
  selection the `select-table` command makes (`getLine` drops it).
- Fix: strip one trailing `\r` from the capture; inner CRLFs stay raw. LF unchanged.
- Tests: "tableAt captures a CRLF table raw, without a dangling half-terminator",
  "tableAt CRLF single-hyphen delimiters, one-column tables and fences", "tableAt LF
  capture is unchanged (POSIX regression guard)".

### F8/F9 — LOW — forward-slash hints for backslash path arguments
- `organization.ts:44` `decodeMoves` and `plugin-api.ts:127` `checkTarget` refused
  `Notes\A.md` with generic messages. On Windows the model frequently tries
  backslashes; the error now says: "Use forward slashes in vault paths, as Obsidian
  writes them (Folder/Note.md)." Generic validation unchanged for everything else.
- Tests: "decodeMoves explains forward slashes for backslash path arguments",
  "plugin tools explain forward slashes for backslash vault paths", "graph and path
  gates refuse Windows absolute, UNC and backslash forms".
- The same hint for `read_note`/`search_vault` lives in main.ts → proposal P2.

## Verified against Windows reality — no change needed

- **Junction/hardlink refusal (organization)**: probe on this machine —
  `lstatSync(junction).isSymbolicLink()===true` (isDirectory false), `statSync`
  follows, `realpathSync` resolves outside; hard link `nlink===2`. So `tree()`,
  `safeSource()`, `ancestorSymlink()`, `hardlinked()` and `assertAllowedDestination()`
  all refuse junctions and hard links on NTFS exactly as on POSIX. New tests exercise
  this with unprivileged fixtures (junction source trees, hardlinked files, junction
  destination ancestors). win-security's `security-vault` junction fixture landed
  during the pass and covers the `allowedVaultFile` realpath gate — consistent.
- **Pre-folded `under()` (§4.8, security-sensitive)**: the optimization at
  `organization.ts:274` is semantically identical to `under()` — verified by 40,000
  randomized comparisons over case aliases, ß/ẞ/ſ/ς and NFC/NFD spellings
  (0 mismatches), plus new behavioural tests: a link spelled `NOTES/a.md` or
  `STRAẞE/a.md` still marks its note affected by a move of `Notes/a.md` /
  `Straße/a.md`; sibling folders (`Notes2`) do not overlap; genuine containment is
  refused. Case-fold destination refusals re-asserted with Windows-runnable fixtures.
- **Token-leak caps at every owned entry point**: excalidraw 10k/text + 100k/ops,
  canvas 100k/ops (round-1 F5) present; `propose_base` content ≤24k (main.ts);
  plugin-api icon ≤128, search 12×(128+100), reason ≤300, path ≤1024, drafts ≤8;
  pdf-tools comments ≤100×4000; knowledge 1400-char windows + offset validation;
  noteChunk 12k + headingOutline 200; search_vault query ≤200, files >250 KB skipped,
  top-2 clips 750 (main.ts). vault-graph was the only unbounded one → F2.
- **CRLF readers**: `noteHeadings` offsets correct on CRLF (test added);
  `parseExcalidraw`/`serializeExcalidraw` keep a CRLF wrapper parseable and preserved
  (test added); `parseBase`/YAML CRLF fine; `DRAWING`/`TEXT_SECTION` regexes already
  `\r?\n`-aware.
- **Long paths / spaces / UNC**: Node fs handled a 464-char path; `allowedPath`
  refuses drive letters, UNC, backslashes, control chars, `~` segments, and
  trailing-dot/space segments on win32 only (platform-parameterized, tested).
- `knowledge.ts`, `search.ts`, `pdf-tools.ts`, `bases.ts` guards (depth 64, damaged
  YAML messages): sound, no Windows-specific defect found.

## Interaction with sibling WIP (win-main `noteText`)

main.ts now normalizes CRLF→LF for plain-Markdown reads (`noteText`,
`currentText`/`search_vault`/`assertFresh`), explicitly keeping drawings/canvases/bases
byte-exact. My fixes complement that: the pure note-tools functions stay CRLF-safe for
raw-text callers (staged previews, organization reads, any future caller), and the
canvas serializer is the piece that keeps CRLF canvases byte-identical now that main.ts
deliberately does not normalize them. One residual issue in that WIP → proposal P3.

## Cross-file proposals (5) — orchestrator applies serially

### P1 — MED — `src/main.ts` `currentText` (~line 573): resolve case-fold aliases
On NTFS a model path `notes/a.md` passes `allowedNote` but
`getAbstractFileByPath` misses → opaque "This file is not available."
```ts
// old
const f=this.app.vault.getAbstractFileByPath(path);
// new
let f=this.app.vault.getAbstractFileByPath(path);
if(!f&&this.vaultBasePath()){
 // NTFS/APFS case alias: only when the filesystem itself resolves the path.
 const{statSync}=await import('node:fs'); // or the existing top-level fs import
 const disk=statSync(join(this.vaultBasePath(),path),{throwIfNoEntry:false});
 if(disk?.isFile()){
  const folded=foldPath(path);
  f=this.app.vault.getFiles().find(file=>foldPath(file.path)===folded)??null;
 }
}
```
(`foldPath` already exported from `./core`; use the existing static fs import.)
Read-only resolution; exclusion semantics unchanged (fold-based). POSIX: `statSync`
misses → no fallback. Test impact: add a case-alias read test with a real temp vault.

### P2 — MED — `src/main.ts` `search_vault` folder arg (~lines 1733-1737)
Backslash folder args and case aliases fail with a generic error; the scope filter is
exact-prefix. Normalize, resolve, then scope by the canonical spelling:
```ts
// old
const {folder=''}=args;
if(typeof folder!=='string'||(folder&&(!this.butler.allowedVaultFile(folder)||!this.app.vault.getFolderByPath(folder))))throw Error('Choose an allowed vault folder.');
…filter(f=>(!folder||f.path.startsWith(folder+'/'))&&…)
// new
let {folder=''}=args;
if(typeof folder!=='string')throw Error('Choose an allowed vault folder.');
if(folder.includes('\\'))throw Error('Use forward slashes in vault paths, as Obsidian writes them (Folder/Note.md).');
folder=folder.replace(/^\/+|\/+$/g,'');
let scope=this.app.vault.getFolderByPath(folder);
if(folder&&!scope){
 const folded=foldPath(folder);
 scope=this.app.vault.getAllFolders().find(f=>foldPath(f.path)===folded)??null;
}
if(folder&&(!this.butler.allowedVaultFile(folder)||!scope))throw Error('Choose an allowed vault folder.');
const prefix=scope?scope.path+'/':'';
…filter(f=>(!prefix||f.path.startsWith(prefix))&&…)
```
Fold-based `allowedVaultFile` keeps exclusions intact; listing/scoping uses the
canonical spelling. Test impact: backslash hint, alias scoping, excluded alias refusal.

### P3 — MED — `src/main.ts` `read_note` cache offsets vs normalized text (~line 1869)
The WIP accepts `noteText(saved)===text` for the cache, but metadataCache offsets
describe the **saved** file. For a CRLF file, slicing normalized LF text with
CRLF-based offsets misaligns heading/block ranges. (Verify against Obsidian's cache
offset convention first; if offsets are raw-file offsets, this is a live bug.)
Safe fix — use the cache only on exact equality, otherwise fall back to the pure
finders (which are CRLF-safe as of F1):
```ts
// old
const cache=file&&saved!==null&&(saved===text||noteText(saved)===text)?this.app.metadataCache.getFileCache(file):null;
// new
const cache=file&&saved!==null&&saved===text?this.app.metadataCache.getFileCache(file):null;
```
Coordinate with win-main (their `noteText` batch). Test impact: CRLF note read by
heading/block returns the exact section.

### P4 — MED — `src/main.ts` read handlers (~line 1774, and `read_note`): size cap before parse
`read_canvas`/`read_base`/`read_excalidraw`/`read_note` parse the whole file with no
size bound (search skips >250 KB; these do not). A multi-hundred-MB `.canvas` or note
OOMs `JSON.parse`/YAML in the renderer. Suggested guard after the path gate:
```ts
const file=this.app.vault.getFileByPath(path);
if(!pending&&file&&file.stat.size>2_000_000)throw Error('This file is too large to read whole (>2 MB). Read a section by heading, or split the file.');
```
(2 MB matches the proposal-size scale; drawings/canases that big are unusable in
Obsidian anyway.) Test impact: oversized fixture refused with the actionable message.

### P5 — LOW — `src/main.ts` organization/deletion reason caps (~lines 1639, 1648)
`args.reason` is unbounded; it is stored in the journal (10 MB cap catches only
extremes) and echoed in review UI. Match plugin-api's convention:
```ts
if(typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>300)throw Error('Provide a short reason for the path changes (up to 300 characters).');
```
Same for `propose_deletion`'s reason. Test impact: overlong reason refused.

## Deferred items (designs, not applied)

### D1 — RISKY — organization checkpoint O(M×N) (`organization.ts:317`, round-1 §5.9)
`accept()` calls `checkpoint()` 2× per move + per created folder; each call re-reads
every affected note and rebuilds `tree()` for every move path — O(M×N) reads and
O(M²) tree scans, plus a journal save each time. Design (recovery-journal integrity
first, do separately with live verification):
- Cache per-move subtree fingerprints keyed by `(path,dev,ino,size,mtimeMs)`;
  `tree()` already records exactly these — reuse unchanged subtrees between
  checkpoints and rescan only paths whose stat changed.
- Cache affected-note text keyed by path+mtime; Obsidian link updates touch only
  notes whose links changed, so most reads disappear after the first move.
- Keep the digest over the FULL state (cached values included) and keep writing the
  journal at every step boundary — rollback/`assertFresh` semantics unchanged.
- Expected: checkpoint cost drops to O(changed entries); journal format unchanged.

### D2 — CAREFUL — journal save EBUSY/EPERM retry (`organization.ts:105`)
Windows Defender/OneDrive/indexer can briefly hold `pending-organization.json`,
making `renameSync` fail EBUSY/EPERM mid-accept; the failure cascades into rollback.
Design: retry only the rename step, ≤3 attempts with 50/150 ms backoff, gated on
`error.code∈{EBUSY,EPERM}` and `process.platform==='win32'`; keep temp-write+rename
atomicity and the `finally` cleanup. Not applied: recovery-journal adjacent, needs
fault-injection tests (mock fs rename) and a live lock repro.

### D3 — LOW — `serializeExcalidraw` writes an LF drawing header into a CRLF wrapper
(`excalidraw.ts:243`). Parse/serialize keep the wrapper sections' CRLF (tested), but
the replaced `## Drawing\n```json\n` head is LF until the plugin re-saves. Design:
derive the head EOL from the original like F3. Low priority: the Excalidraw plugin
normalizes on its next save and byte-identity is not the bar for drawings (round 1).

### D4 — LOW — `tableAt` pipeless one-column delimiter (`| a |` / `---` / `| b |`)
Not recognized (delimiter must contain a pipe). GFM allows pipeless delimiter rows,
but `---` under a paragraph is also a setext heading; Obsidian's live parser behaviour
needs verification before changing. Current behaviour is conservative and tested.

## Files changed by this audit

- Source (owned): `src/note-tools.ts`, `src/canvas.ts`, `src/vault-graph.ts`,
  `src/organization.ts`, `src/plugin-api.ts`.
- New tests (owned): `tests/audit-win-tools-{crlf,graph,organization,paths}.test.ts`
  (37 tests).
- No commits/stages; no build run; no real vault mutated; probes confined to the
  scratch dir; macOS/POSIX paths guarded by explicit regression tests in every fix.
