# Windows hardening round 2 — attachments, vision/OCR, diffs, PDFs

**Agent:** `win-attachments` · **Branch:** `3.7.0-RC` · **Date:** 2026-11-19
**Owned src:** `attachments.ts`, `visual.ts`, `ocr.ts`, `editor-diff.ts`, `pdf.ts`
**Report:** `audits/3.7.0-rc/windows-attachments-vision.md`

## 1. Scope & method

Read the shared brief (`windows-pass-brief.md`) and round-1 reports
`REVIEW-handwriting-vision-routing.md` (OCR design, models.dev modalities),
`REVIEW-pdf-page-citation-copy.md` (`pdfPageReference` format),
`REVIEW-tables-to-chat.md` (selection pipeline, 3000-char clip) and
`REVIEW-rc-hardening-pass.md` §5 item 1 (deferred PDF document cache).

Method: code review of the owned files plus their call sites in `main.ts`
(read-only), real-library probes under
`C:/Users/filip/AppData/Local/hermes/cache/scratch/win-attachments/`
(`diff@8.0.4` tokenizer, CodeMirror 6 `Text.of`, Node `File.text()` on UTF-16,
`Promise.race` late-rejection semantics), and platform-parameterized unit
tests. No builds, no live vault, no provider contact, git read-only.

Tooling note: the `patch` tool converts `\r` escape sequences in its
parameters into real carriage returns, which corrupted a regex on the first
edit. All escape-sensitive edits were therefore applied through
EOL-preserving Node transform scripts and verified byte-for-byte (`od`,
`JSON.stringify`). The same corruption was observed mid-run in a sibling's
`main.ts` WIP (`noteText`, see §2 F-9); it was fixed by its owner.

## 2. Findings

| # | Severity | Where | Windows-specific? | Summary |
|---|----------|-------|-------------------|---------|
| F-1 | HIGH | `src/editor-diff.ts:20` (pre-fix) | Yes | CRLF notes never show inline diff highlights; ranges would be `\r`-count chars off |
| F-2 | HIGH | `src/attachments.ts:116` (pre-fix) | Yes | UTF-16 (Notepad "Unicode") and ANSI text attachments refused as binary |
| F-3 | MED | `src/attachments.ts` text branch | Yes | CRLF inflates the 64,000-char / 256 KB attachment budget and model tokens |
| F-4 | LOW | `src/pdf.ts:14` | Yes (latent) | `pdfPageReference` split only on `/`; a backslash path would leak folders into the citation |
| F-5 | PERF | `src/main.ts:2819` `withPdfDocument` | General | §5.1: every `read_pdf` continuation re-parses the whole PDF; doc destroyed per call |
| F-6 | verified | `src/ocr.ts` | — | Windows skip is already clean; macOS code intact (no change needed) |
| F-7 | verified | `src/visual.ts` | — | Capture paths platform-neutral; `within()` is safe; Excalidraw exports uncapped (D-1) |
| F-8 | verified | `src/attachments.ts` darwin branches | — | Native conversion untouched; spaces/long paths safe on Windows |
| F-9 | observation | `src/main.ts:825` (sibling WIP) | Yes | Sibling's `noteText` CRLF work covers Markdown reads/freshness; complements this pass |
| F-10 | MED (gap) | `src/main.ts:1533,1435` `readBinary` | Yes | No EBUSY/EPERM retry on attachment/PDF **reads** (writes got one this round) |

### Evidence

**F-1.** Probe (`probe-crlf.mjs`, real `diff@8.0.4` + `@codemirror/state`):
- `Text.of(crlf.split(/\r\n?|\n/)).toString() === crlfAfter` → **false**;
  `=== lfAfter` → **true**; `doc.length` 26 vs `crlfAfter.length` 31.
  CodeMirror normalises the document to `\n`, so the old guard
  `state.doc.toString() !== batch.edit.after` **never passes for a CRLF
  proposal** → zero highlights on Windows CRLF notes; and `offset +=
  part.value.length` counted `\r`s that do not exist in the document.
- `diffLines(CRLF before, LF after)` → one removed block + one added block
  covering the **whole file** (5/5 lines "changed") when only one line changed.
- `diffLines(CRLF, CRLF)` with one changed line → correct 1-line hunk.

**F-2.** Probe: a UTF-16 LE BOM file (`FF FE …`) gives
`sample.includes(0) === true` → old code classified it binary →
"This binary file could not be converted on this platform." on Windows.
`File.text()` (UTF-8 only) returns mojibake (`"G\u0000r\u0000…"`);
`new TextDecoder('utf-16le').decode(bytes)` returns `"Grüße\r\nWelt\r\n"`.
ANSI (windows-1252) prose fails the UTF-8 validity check the same way.

**F-3.** `clip()`/`bounded()` count characters; raw CRLF spends 2 chars per
line break. **Selection capture is NOT affected**: `selection()`, `table()`
and `capture()` all read `editor.getSelection()`/`editor.getValue()`, which
CodeMirror already normalises to `\n` (verified in `main.ts:483,496,503`).
Attachment text read from disk **was** affected → normalised in fix 2.

**F-6.** `ocrSupported(platform)` gates `ensureOcrBinary` **before** any
`existsSync`/`mkdirSync`/`execFile`; on `win32`/`linux` it resolves `null`
without touching the filesystem or probing a compiler, so no Xcode dialog is
possible (the `/usr/bin/xcode-select` shim is never reached). `main.ts:1789,1803`
then append `ocrSection(null) === ''` and still return the picture. All
platform guards are parameterized (`platform=process.platform` defaults).
**`src/ocr.ts` received zero code changes**; the Swift source, `OCR_VERSION`,
compile-once cache and reading-order sort are pinned by tests instead.

**F-7.** `within()` (`visual.ts:67`): a late `capturePage` rejection after the
timeout wins the race is **already handled** — `Promise.race` attaches
handlers to both promises at subscription (probe `probe-race.mjs`: 0
unhandled rejections). No change needed. Canvas captures are capped at
2048 px (`imageUrl`), PDF renders at 1600 px / 800 KB (`renderPdfImage` /
`imageForCodex`), user images at 2048 px / 800 KB (`addImages`). Excalidraw
`createPNGBase64(path,1)` exports are **uncapped** → deferred design D-1.
Backslash/space/OneDrive vault paths reach the Excalidraw plugin as
vault-relative forward-slash paths (`file.path`); nothing in `visual.ts`
re-splits or shell-quotes them.

**F-8.** The darwin-only branches (`iworkOffice`, `textutil`, `sips`,
`qlmanage`) are unreachable on Windows (`process.platform==='darwin'` gates)
and were not touched. `execFile` uses `shell:false` + argument arrays, so
spaces in paths are safe where those branches run. Windows temp dirs come
from `tmpdir()`; >260-char vault paths are the Obsidian adapter's concern
(reads arrive as `File` objects). `archiveParts` matches ZIP entry names with
`/` only — conformant Office writers always use `/` (D-5).

**F-9.** Mid-run, a sibling added `noteText()` in `main.ts` normalising
Markdown reads (`main.ts:585,1746`), `assertFresh(noteText(current),
noteText(edit.before))` (`main.ts:641`) and CRLF-tolerant `stripFence` /
`parseJsonLine` in `core.ts`. That covers the proposal-matching and freshness
half of the CRLF problem for Markdown (snapshots become LF, so
`proposal().indexOf(oldText)` and `commonChange` offsets line up with the
editor). Its first revision carried the same `\r`-escape corruption
(`main.ts:825` unterminated regex, repo-wide tsc blocker); the owner fixed it
during this run. The proposals below cover what remains: non-Markdown CRLF
files, diff **display**, and the PDF cache.

## 3. Fixes applied (4 code fixes, 50 new tests)

### Fix 1 — `src/editor-diff.ts`: CRLF-normalised inline diff (F-1)
Extracted the pure, testable `diffDecorations(docText, before, after)`;
normalises both sides with `/\r\n?|\n/g → '\n'` (exactly CodeMirror's
`DefaultSplit`, so lone `\r` is handled like the editor handles it) before the
document-equality guard, the size guard and `diffLines`. Removed-text widgets
now carry `\n`-only text. **LF input is a no-op → macOS/POSIX behaviour
byte-identical** (pinned by the first regression test).
Tests (`tests/audit-win-attachments-diff.test.ts`, 8):
- "LF notes keep their exact decoration ranges (POSIX behaviour unchanged)"
- "a CRLF note shows the same highlights as its LF form"
- "a CRLF note with an LF proposal diffs only the changed line, not the whole file"
- "lone CR line endings are normalised the way the editor splits them"
- "a document that does not show the proposal gets no decorations"
- "an unchanged proposal has no decorations"
- "oversized proposals stay undecorated"
- "removed text widgets never carry carriage returns into the DOM"

### Fix 2 — `src/attachments.ts`: Windows text encodings + CRLF budget (F-2, F-3)
New pure helper `attachmentTextEncoding(sample, extension, type)`:
- `FF FE` / `FE FF` BOM → `utf-16le` / `utf-16be` (checked **before** the
  NUL test, since UTF-16 always contains NULs);
- valid UTF-8 → `utf-8` (BOM stripped by `TextDecoder`, as `File.text()` did);
- invalid UTF-8 **only** for prose extensions (`.txt .md .csv .tsv .log .tex
  .bib`) and only when the windows-1252 decoding has no control bytes
  (C0 except `\t\n\r`, DEL, and the five undefined cp1252 bytes) →
  `windows-1252`;
- everything else (NUL, image types, known binary extensions) → `null`,
  exactly the previous refusal set.
The text branch now decodes the bounded 256 KB slice with the detected
encoding and normalises `\r\n → \n` so Windows line endings do not inflate
the character budget. Shortening notices unchanged.
Tests (`tests/audit-win-attachments-files.test.ts`, 19): 10 encoding cases
(LE/BE/UTF-8 BOM/plain/NUL/ANSI/prose-only/control-refusal/valid-UTF-8-controls
unchanged/image+binary refusal), 5 end-to-end `convertFile` cases (UTF-16 LE,
UTF-16 BE, ANSI, CRLF normalisation, large UTF-16 bounded+shortened),
2 `pdfPageReference` cases (fix 3), 2 `clip` contract cases (F-3: clip counts
characters; raw CRLF would carry 1000 `\r`s into a 3000-char clip — editor
selections arrive LF, so the product path is unaffected).

### Fix 3 — `src/pdf.ts`: `pdfPageReference` accepts Windows separators (F-4)
`path.split('/')` → `path.split(/[\\/]/)`. Round-1 citation format otherwise
byte-identical (vault paths, spaces, commas, uppercase `.PDF`, control chars
all pinned by tests, including the round-1 example
`Kernbereiche Biologie 6,p.15`). Commas in names stay ambiguous by design
(round-1 user spec; one-way clipboard format, not parsed back).

### Fix 4 — `src/pdf.ts`: `PdfDocumentCache` (F-5, round-1 §5.1, pdf.ts side)
Implemented the cache **in pdf.ts only** — airtight lifecycle, fully
unit-testable with fake PDF.js documents, no live vault:
- LRU (default capacity 2) keyed `path + '\u0000' + size + '\u0000' + mtime`;
  hit touches recency; a changed size/mtime misses.
- `open(key, load)` returns a **lease** (`{doc, release()}`); concurrent opens
  of one key share a single parse; `release()` is idempotent per lease.
- `invalidate(path?)` / `destroyAll()` mark entries dead and remove them from
  the map immediately; a document with live leases is destroyed **when the
  last lease returns** — an in-flight read is never torn down mid-page.
- Failed loads are not cached (entry removed on rejection; next open retries).
- Eviction only removes idle entries and runs **after** the new lease is
  counted; if every document is in use the cache temporarily overflows rather
  than breaking a live read (bounded by turn concurrency).
- No file handle is kept (bytes are read before parsing) → the cache cannot
  hold a Windows EBUSY/OneDrive lock. No abort listeners inside the cache:
  the loader owns signal handling; the cache reacts only to promise settlement
  (no dangling listeners).
- Windows mtime: `stat.mtime` is integer ms; a same-ms same-size edit could
  alias — the wiring proposal adds `vault.on('modify')` invalidation, which
  closes that hole for every change Obsidian sees (incl. OneDrive sync).
Tests (`tests/audit-win-attachments-pdf-cache.test.ts`, 13): reuse, size/mtime
miss, LRU eviction order, concurrent shared parse, invalidate idle/in-use/
pending, destroyAll, failed-load retry, in-use never evicted + idle cleanup,
idempotent release, named invalidate, key collision safety.
**Wiring into `main.ts` is proposal X-1** (main.ts is report-only for me).

### OCR — verification only, zero code changes (F-6)
`tests/audit-win-attachments-ocr.test.ts` (10 tests), host-neutral on any OS:
- "the macOS Vision helper is intact (source and version pinned)" — asserts
  `import Vision`, `VNRecognizeTextRequest`, `.accurate`, language correction,
  `OCR_VERSION === '1'` (guards against accidental removal/degradation).
- "the OCR section is omitted when OCR is unavailable (Windows tool results)".
- For each of `darwin`/`win32`/`linux`: `ocrSupported` gate; and
  `ensureOcrBinary` with a **pre-placed cached binary** — darwin returns it
  without compiling (no Swift compiler invoked on any host), win32/linux
  refuse it **before looking at the cache** (a macOS binary can never run
  there). For win32/linux additionally: no `ocr/` directory, no storage-dir
  touch, `ocrImageDataUrl` returns null (picture still returned by callers).

## 4. Cross-file proposals (3 — exact patches, orchestrator applies)

### X-1. Wire `PdfDocumentCache` into `src/main.ts` (F-5)
Lifecycle: destroy on newChat / onClose / stop(abort) / attachment epoch;
invalidate on vault modify. All hunks:

1. Import (line 26): add `PdfDocumentCache` to the `./pdf` import list.
2. `ButlerView` field (line 992, next to `conversionAbort`):
```ts
private pdfCache=new PdfDocumentCache(2);
```
3. Replace `withPdfDocument` (line 2819) with the cache-backed version:
```ts
async function withPdfDocument<T>(cache:PdfDocumentCache,key:PdfDocumentKey,bytes:ArrayBuffer,read:(doc:PdfDocument)=>Promise<T>,signal?:AbortSignal):Promise<T>{
 signal?.throwIfAborted();
 const pdf=await loadPdfJs() as PdfJs;
 signal?.throwIfAborted();
 const lease=await cache.open(key,async()=>{
  const loading=pdf.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true});
  let passwordRequired=false;
  loading.onPassword=()=>{passwordRequired=true;void loading.destroy().catch(()=>{});};
  try{const doc=await loading.promise;return {doc,loading};}
  catch(error){void loading.destroy().catch(()=>{});throw passwordRequired?Error('The PDF is password-protected. Attach an unlocked copy.'):error;}
 });
 try{signal?.throwIfAborted();return await read(lease.doc);}
 finally{lease.release();}
}
```
(Add `PdfDocumentKey` to the import. Abort during a read: the per-page
`signal?.throwIfAborted()` in `readPdfTextRange`/`searchPdfText` throws, the
lease is released, and `stop()` invalidates the cache — the doc dies on
release, never mid-page. Password/abort failures reject the shared loader, so
the entry is dropped and the next call re-parses.)
4. Key construction helper (module level, near `withPdfDocument`):
```ts
function pdfCacheKey(file:File|TFile):PdfDocumentKey{
 return file instanceof TFile?{path:file.path,size:file.stat.size,mtime:file.stat.mtime}:{path:'\u0000external:'+file.name,size:file.size,mtime:file.lastModified};
}
```
5. `readPdfPage` (line 1542): add a `key:PdfDocumentKey` parameter and pass it
through: `return withPdfDocument(this.pdfCache,key,bytes,async doc=>{…},this.controller?.signal);`
6. `read_pdf` tool (line 1688): after `const bytes=await this.readPdfBytes(file);`
add `const key=pdfCacheKey(file);` and update the three call sites:
- line ~1703 `this.readPdfPage(bytes,source,page,args.visual===true)` → `this.readPdfPage(bytes,key,source,page,args.visual===true)`
- line 1697 `withPdfDocument(bytes,doc=>searchPdfText(…),signal)` → `withPdfDocument(this.pdfCache,key,bytes,doc=>searchPdfText(…),signal)`
- line 1707 `withPdfDocument(bytes,doc=>readPdfTextRange(…),signal)` → `withPdfDocument(this.pdfCache,key,bytes,doc=>readPdfTextRange(…),signal)`
7. Invalidation:
- `newChat()` (line 1214): add `this.pdfCache.destroyAll();` next to `this.pdfAttachments.clear();` (also covers the epoch bump).
- `stop()` (line 1516): add `this.pdfCache.destroyAll();` after `this.controller?.abort();` (abort path).
- `onClose()` (line 2817): add `this.pdfCache.destroyAll();`.
- `onOpen()`: `this.registerEvent(this.app.vault.on('modify',file=>{this.pdfCache.invalidate(file.path);}));` — closes the same-ms/same-size mtime aliasing hole (Windows ms granularity) and OneDrive hydration changes.
Test impact: none of the existing tests touch `withPdfDocument`; the 13 cache
unit tests are the floor. Suggested orchestrator check: a `loadMain()`-based
test with a fake `loadPdfJs` counting `getDocument` calls across two
continuation reads (stub `obsidian.loadPdfJs` is monkey-patchable).

### X-2. Bounded retry for attachment/PDF **reads** (F-10)
Writes got `retryLocked` this round (`chats.ts:6`, `recovery.ts`); reads
still fail on the first EBUSY (Defender/OneDrive/indexer hold freshly synced
or scanned files). Mirror the established pattern async, in `main.ts`:
```ts
/** Windows Defender/OneDrive/the indexer briefly lock files (EBUSY/EPERM/
 * EACCES); a short bounded retry rides out the transient lock on reads. */
async function readBinaryRetry(read:()=>Promise<ArrayBuffer>):Promise<ArrayBuffer>{
 for(let attempt=0;;attempt++){
  try{return await read();}
  catch(e){const code=(e as NodeJS.ErrnoException)?.code;
   if(attempt>=2||(code!=='EBUSY'&&code!=='EPERM'&&code!=='EACCES'))throw e;
   await new Promise(r=>nodeTimeout(r,25*3**attempt));}
 }
}
```
(`nodeTimeout` is already imported at `main.ts:1`.) Wire two sites:
- `readPdfBytes` (line ~1533): `return this.app.vault.readBinary(file);` → `return readBinaryRetry(()=>this.app.vault.readBinary(file));`
- `addAttachments` TFile branch (line ~1435): `file=new File([await this.app.vault.readBinary(entry)],name,{type});` → `file=new File([await readBinaryRetry(()=>this.app.vault.readBinary(entry))],name,{type});`
Test impact: fake `vault.readBinary` rejecting twice with `{code:'EBUSY'}`
then resolving; assert success and that a non-lock error propagates at once.

### X-3. Diff display for non-Markdown CRLF files (F-1 remainder)
The sibling's `noteText` normalises **Markdown** snapshots; drawings,
canvases and bases "keep their exact bytes", so a CRLF `.canvas`/`.excalidraw`
still produces whole-file diff noise in the two review views, and
`revealInNote`'s `text===batch.edit.before` picks the wrong scroll version
(editor text is LF). Two one-line changes in `main.ts`:
```ts
// line 864 — display only; line counts are unchanged by normalisation
function reviewText(path:string,text:string){const body=isExcalidrawPath(path)||isExcalidrawText(text)?readableExcalidraw(text,excalidrawDecoder()):text;return body.replace(/\r\n?|\n/g,'\n');}
// line ~947 (revealInNote)
const number=Math.min(Math.max(noteText(text)===noteText(batch.edit.before)?line.beforeLine:line.afterLine,0),Math.max(editor.lineCount()-1,0));
```
Test impact: `diffLineMap`/split-view tests with CRLF canvas text; LF inputs
unchanged (no-op). My `diffDecorations` already covers the inline-highlights
view for all file types.

## 5. Deferred items (designs, not applied)

- **D-1 (MED, needs live verify): Excalidraw export size cap.**
  `excalidrawImage`/`excalidrawSceneImage` (`visual.ts:203,211`) return
  `createPNGBase64(path,1)` uncapped; a large drawing can produce a multi-MB
  data URL sent straight to the provider (`codex.ts:335`, `claude.ts:98`,
  `hermes.ts:541`, `opencode.ts:517` — no downstream cap). Design: route the
  data URL through the same downscale-to-2048px + 800 KB JPEG ladder as
  `imageForCodex` (main.ts:2845), via a shared helper; keep scale 1 for the
  OCR input on macOS. Requires DOM (`Image`+canvas) → not Node-unit-testable
  and it changes macOS output size, so it needs a live vault check and owner
  sign-off rather than a blind edit.
- **D-2 (LOW): SVG attachments on non-darwin.** `.svg` (type `image/svg+xml`)
  hits the image branch → `createImageBitmap` cannot rasterise SVG → error,
  or falls to "binary could not be converted". Design: on non-darwin only,
  read SVG source as UTF-8 text (bounded like other text); macOS keeps its
  Quick Look preview. Platform-gated to avoid changing macOS behaviour.
- **D-3 (decision, recommend no action): OCR-unavailable notice.** Round-1
  §7 asked whether Windows users need a setting/notice. Recommendation: no —
  the graceful skip is the contract (picture still returned; a vision-capable
  model reads the pixels natively; OCR is a macOS-only text supplement).
  A notice would fire on every visual read for every non-macOS user.
- **D-4 (limitation): UTF-16 without BOM / other code pages.** Not reliably
  detectable from an 8 KB sample; left refused as binary. BOM'd UTF-16 and
  cp1252 prose (the common Windows cases) are now covered.
- **D-5 (no action): backslash ZIP entry names.** `archiveParts` matches `/`
  separators only; conformant Office writers always use `/`. Non-conformant
  third-party zips would yield "preview only" — acceptable.

## 6. Verification

- `npm run check` (tsc --noEmit): **clean** at final run (mid-run blockers
  were sibling WIP: `audit-rc-codex.test.ts` syntax, then `main.ts:825`
  `noteText` regex corruption — both fixed by their owners; one TS2454 in my
  cache code was fixed here by deferring the loader start to a microtask).
- `npm run lint` (eslint src): **clean**.
- Targeted: owned + new files
  (`attachments, visual-files, visual-context, visual-availability, ocr, pdf,
  long-notes` + 4 `audit-win-attachments-*`): **93/93 pass**
  (43 pre-existing owned + 50 new).
- Full suite (first run, mid sibling WIP): **701 tests, 692 pass, 8 fail**.
  All 8 attributed to siblings' concurrent work, none in owned files:
  - `tests/audit-win-security.test.ts` (whole file; win-security WIP)
  - `tests/audit-win-tools-crlf.test.ts`: findBlock CRLF, findBlock LF guard,
    noteHeadings CRLF offsets, property-query bounded (win-tools WIP on
    `note-tools.ts`)
  - organization case-fold alias list/preview (2; win-tools WIP)
  - `tests/security-vault.test.ts` "allowedVaultFile resolves the on-disk
    name…" (win-security WIP)
  The 12 pre-existing symlink-EPERM failures from the brief are **gone** —
  their owners landed the hard-link/junction recipe.
- Full suite (final run): see §6 addendum below.
- macOS intact: `src/ocr.ts` has **zero** code changes (Swift helper,
  compile-once cache, Xcode gate, reading-order sort all pinned by tests);
  LF diff behaviour pinned byte-identical; darwin cached-binary path tested
  host-neutrally; darwin-only conversion branches untouched.

### §6 addendum — final full-suite run

**709 tests, 706 pass, 2 fail.** Both failures are transient Windows
temp-directory cleanup locks (EPERM on `rm` of
`%TEMP%\owla-audit-opencode-*` — the Defender/indexer class) in sibling-owned
files, under parallel suite load:
- `tests/audit-providers-opencode-lifecycle.test.ts` — "a duplicated catalogue entry is offered once"
- `tests/audit-rc-opencode.test.ts` — "foreign and unscoped session events cannot stream text or settle the turn"

Re-run in isolation immediately after: **12/12 pass** — confirmed transient,
not regressions, not in owned files. Sibling WIP converged during this pass:
the mid-run `hermes.ts` duplicate-export tsc/lint errors
(`redactHermesErrorDetail`) were fixed by their owner; final `npm run check`
and `npm run lint` both **clean** (exit 0), targeted owned+new tests **93/93**.

**Final gate status: check ✓ · lint ✓ · targeted 93/93 ✓ · full suite 706/709
with the 2 residuals attributed above (pass in isolation).**