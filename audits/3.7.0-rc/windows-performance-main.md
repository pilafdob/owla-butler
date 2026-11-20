# Windows hardening pass (round 2) — performance & main.ts integration

Agent: `win-perf` · Branch `3.7.0-RC` · Base `81540fb` · Owns `src/main.ts`
Report companion to `windows-pass-brief.md`; round-1 inputs:
`performance.md` (top-10 + smaller items), `REVIEW-rc-hardening-pass.md` §4.7
(landed main.ts edits) and §5 items 2–3 (deferred coalescing / Hermes digest).

## Scope & method

- Read the full 3,297-line `src/main.ts` plus the harness
  (`tests/helpers/load-main.ts`, `obsidian-stub.cjs`, `mini-dom.ts`) and every
  main-related sibling test (`security-main`, `long-notes`, `visual-context`).
- Surveyed all 19 `renderPendingEdits` call sites for sync-DOM assumptions
  (table below) before changing anything.
- Verified each round-1 top-10 item against current code before claiming status.
- Scratch-only probes under `…/cache/scratch/win-perf/` (Notice-interception
  probe, a hardlink-fixture copy of `security-main.test.ts` to execute its H1/H2/
  R1/A8 assertions on this Developer-Mode-OFF host, a regex-repair script).
  No live turns, no daemon contact, no vault mutations, no builds, read-only git.
- All fixes regression-tested in two NEW files: `tests/audit-win-perf.test.ts`
  (12 tests) and `tests/audit-win-main.test.ts` (14 tests). 26/26 pass.

## renderPendingEdits call-site survey (sync-DOM assumptions)

| Call site | Assumption | Preserved by |
|---|---|---|
| `onOpen` end | composer/send state correct before first paint | sync state section; rebuild flushes in a microtask (pre-paint) |
| `addFiles` start/finally | composer disabled while `converting>0` | sync `waiting` check reads `converting` live |
| `propose_pdf_annotation` ×3 | review block appears with the card | microtask flush before paint |
| `reviewRemoval` finally / `finishRemoval` | draft removed from review | signature includes `removalDrafts` keys + blockers |
| `organizationDecided` | summary cleared, review rebuilt | signature includes org review/progress/busy |
| `decideEdit` | card state + composer re-enabled | sync composer; rebuild sees post-resolve pending |
| plugin decline handler / `clearPendingEdits` finally / `discardPluginChanges` | drafts gone from area | signature includes `pluginDrafts` keys, `pendingLoadError` |
| `applyPluginChange` start/finally | buttons disabled while applying | signature includes `applyingPluginChange` |
| `applyReplyAction` start/finally | composer disabled while `applyingEdit` | sync `reviewBlocked`; rebuild at flush sees staged batch |
| `send()` finally | review state after turn | sync + signature (controller cleared) |
| `OrganizationDiff` accept catch | recovery record visible | signature includes `org.progress` completed/created/error |
| **`security-main` H2 test** | `syncSplitDiff` called **synchronously**, then `composer.disabled` set **synchronously**; `pendingSignature=''` forces re-render; highlights never syncs | kept exactly: broadcast + split sync + composer state stay synchronous; field named `pendingSignature` |
| `reviewLatest` (command) | focuses a button in `pendingArea` | now flushes the rebuild synchronously first (`rebuildPendingArea()` is signature-gated, cheap when current) |

No other test or code path reads `pendingArea` DOM synchronously after a render
call (verified by grep). `editCards`/`changeCard` updates target the reply
summary area, which is not part of the coalesced rebuild.

## Fixes applied (6)

### F1. `renderPendingEdits` coalescing + dirty signature + gated broadcasts — perf rank 9 / REVIEW §5.2 (CAREFUL → landed)
`src/main.ts` (`renderPendingEdits`, new `rebuildPendingArea`, `reviewSignature`,
`pendingEditKey`, `reviewToken`; fields `pendingSignature`, `pendingRebuildQueued`,
`lastPendingKey`, `reviewTokens`).
- Sequential calls within one tick coalesce into **one** microtask rebuild
  (`queueMicrotask`, pre-paint, no flicker). The rebuild is **skipped** when a
  signature of everything it reads is unchanged: pending batches (WeakMap
  identity tokens — staged objects are replaced, never mutated), pendingLoadError,
  organization review/progress (completed+created+error, since progress mutates
  in place)/busy/blocked/loadError, plugin/removal/annotation draft keys,
  removal blockers, related-review decisions, converting/applying/removing/busy
  flags.
- `refreshEditorDiff()` (the editor-wide decoration broadcast) fires **only when
  the pending set changed**; editors already recompute on their own `docChanged`
  (editor-diff.ts field update), and the diff-view setting handler broadcasts
  directly. `syncSplitDiff()` stays synchronous but is skipped when the pending
  set is unchanged **and** a split leaf is open (a closed split leaf is still
  reopened on any render — regression-tested).
- Sync semantics kept verbatim for H2: broadcast → split sync → composer
  disabled/placeholder → sendBtn → clearWarmup, all synchronous; only the card
  rebuild moved. `clearWarmup` condition unchanged (`awaitingReview`).
- Rebuild guards `closing`/missing `pendingArea`; `reviewLatest` flushes
  synchronously before focusing.
- Effect: the ~19 call sites no longer multiply full review-area rebuilds and
  editor-wide diff recomputes; a no-change render (e.g. `send()` finally after a
  turn with no proposals) is now O(pending) token lookups instead of a DOM
  rebuild + broadcast to every open editor.
- Tests: `coalescing: sequential renderPendingEdits calls rebuild once…`,
  `dirty flag: unchanged state skips the rebuild and the editor-wide broadcast`,
  `broadcast gating: a converting-only change rebuilds without waking every editor`,
  `H2 contract: split sync and composer state are synchronous…`,
  `a closed split leaf is reopened…`, `the rebuild sees the state at flush time…`,
  `reviewLatest flushes the rebuild synchronously…`, `a closed view never rebuilds`.
- **Cross-verified**: a scratch copy of the real `tests/security-main.test.ts`
  with the file-symlink fixture replaced by a hard link runs **9/9 green**
  against this change (H1/H2/R1/A8), and the owner has since landed the fixture
  fix — the real file now passes 10/10 in the full suite.

### F2. Reply sanitize observers discarded when the feed is cleared — perf rank 8 residual (memory)
`renderReply` registered one MutationObserver per reply, disconnected only at
view unload. After `newChat()`/`feed.empty()` the observers kept referencing
detached reply DOM, so every past reply's rendered tree was retained until the
view closed (N replies → N live observers + N retained subtrees). Now each
observer's stop closure lives in `replyStops`; `newChat()` calls
`discardReplyObservers()` before `feed.empty()`; unload cleanups stay registered
and idempotent. Security unchanged: discarded replies are never re-shown
(saved-chat replay re-renders through `renderReply` with fresh observers), and
the initial + coalesced sanitize passes are untouched.
Tests: `newChat disconnects reply observers so detached reply DOM is not retained`,
`unload cleanup cancels a pending animation frame and disconnects`.

### F3. CRLF / lone-CR normalization of the Markdown read pipeline (Windows)
Obsidian's editor (CodeMirror 6) normalizes `\r\n` and lone `\r` to `\n`, but
`vault.cachedRead` of a **closed** note returns raw disk bytes — CRLF is common
on Windows. The model then saw CRLF context while writing LF `oldText`, so
`proposal()`'s exact `indexOf` failed ("The original passage was not found")
and re-reads looped. New module helper `noteText` (`/\r\n?/g → \n`, exactly the
editor's line-break semantics) applied to:
- `currentText` closed-note branch — **only** plain `.md` (not Excalidraw
  drawings; canvas/base `getViewData` and drawing bytes stay exact);
- `search_vault` scanned text (snapshots feed `propose_edit`);
- `read_note` metadata-cache validation (`saved===text || noteText(saved)===text`
  keeps the cache fast path for CRLF notes).
Open-editor text is already LF; `capture()` offsets stay editor-based (LF).
POSIX behaviour unchanged: LF-only text passes through byte-identical (tested).
Tests: `currentText normalizes CRLF Markdown reads (Windows)`, `…keeps LF
Markdown byte-identical (POSIX unchanged)`, `…normalizes lone CR the way the
editor splits lines`, `…keeps canvas and Excalidraw bytes exact`,
`read_note + propose_edit: LF oldText matches a CRLF note end to end`,
`read_note still uses the metadata cache for a CRLF note`,
`search_vault snapshots are normalized so propose_edit matches`.

### F4. Freshness check compares content, not line endings (Windows)
`writeEdit`'s `prepare` now `assertFresh(noteText(current),noteText(edit.before))`.
A closed CRLF note matches its LF snapshot (previously every provisional apply
to a never-opened CRLF note failed with "The note changed since this proposal").
A real content change still rejects (tested). Canvas/base/drawing comparisons
normalize both sides equally, and the written `after` keeps its exact bytes
(canvas CRLF round-trip tested). Accepted edits to CRLF notes write LF — the
same normalization Obsidian itself performs on any editor save.
Tests: `writeEdit accepts an LF snapshot against a CRLF file (closed note)`,
`writeEdit still rejects a real content change despite normalization`,
`writeEdit with an open editor keeps POSIX behaviour`,
`writeEdit keeps canvas bytes exact through the freshness check`.

### F5. Error redaction at the chat-store surfaces — leak surface
`saveChat`, the saved-chat delete callback, and `openSavedChat`'s outer catch
showed raw `(e as Error).message`. ChatStore errors are fs errors carrying full
paths (home directory, OneDrive-redirected Documents) and could carry provider
detail; round-1's `friendlyError` redaction (Bearer tokens, credential
assignments, home paths) was bypassed here. All three now use `friendlyError(e)`.
Every other error surface in main.ts was audited and already routes through
`friendlyError` (incl. `automaticOffers` failed messages, `recordModelRefusal`).
Test: `openSavedChat redacts bearer tokens and home paths in storage errors`
(Notice interception via the stub exports; fake secret built by concatenation).

### F6. `propose_properties` restricted to plain Markdown notes (data integrity)
`propose_properties` had no file-kind guard: on a canvas/base snapshot
`updateProperties` prepends a `---` YAML block to JSON (corrupts the file); on
an Excalidraw `.md` drawing it can rewrite/remove the `excalidraw-plugin`
frontmatter key. Now refused unless the path is `.md` and not a drawing
(`isExcalidrawPath`/`isExcalidrawNote`), mirroring `propose_edit`'s drawing
refusal. Test: `propose_properties refuses drawings, canvases and bases`
(includes the plain-note happy path with working YAML stand-ins).

## Round-1 top-10 status (verified against current code)

| # | Item | Status |
|---|---|---|
| 1 | Hermes quadratic stdout buffer | ✅ landed (`hermes.ts:351` `RecordSplitter('\n',16 MiB)`, reset on reconnect) |
| 2 | Unminified bundle | ✅ landed (`esbuild.config.mjs:11` `minify:true`) |
| 3 | Organization.preview re-folding | ✅ landed (`organization.ts` pre-folded move roots/note keys/link keys) |
| 4 | query_vault_graph per-note realpath | ✅ landed (`withPathCheckCache` wrap) — new regression test proves the cache is active during the query and released after |
| 5 | read_pdf re-read/re-parse per call | ⏸ deferred (design below); NOTE: sibling WIP observed in `src/pdf.ts` (+69 lines) — coordinate before applying |
| 6 | read_note second full read | ✅ landed (`cachedRead` validation); F3 made the comparison CRLF-safe |
| 7 | currentText double-check/fresh read | ✅ landed (single `allowedEditable`, `cachedRead`); F3 added normalization |
| 8 | renderReply per-mutation sanitize | ✅ landed (rAF/16 ms coalescing, attributes+characterData watched, window timers per §2.2); F2 fixed the residual observer/DOM retention; coalescing correctness regression-tested (N batches → 1 pass, late mutations still caught, fallback timer path, cleanup cancels pending handle) |
| 9 | renderPendingEdits rebuild+broadcast | ✅ **landed now (F1)** |
| 10 | noteHeadings O(H²) | ✅ landed (linear stack pass in `note-tools.ts`) |

Smaller items: duplicate `autoEntries` ✅ landed (context-filter relaxation +
activity notice); `backupEdit` sync I/O and `excludedCache` unbounded → proposals
below; `countFoundationModelTokens` kept per round-1 decision (planned FM
calibration input).

## Windows integration audit (verified, no change needed)

- **Paths**: `checkVaultFile` resolves via `realpathSync.native` (case/Unicode
  aliases meet exclusions), refuses `nlink>1` hardlinks (work unprivileged on
  Windows), converts `relative()` backslashes to `/`; junctions are caught by
  `lstatSync(...).isSymbolicLink()` in `assertNewNoteDestination` (Node reports
  junctions as symlinks). Vault paths stay `/`-relative end to end;
  `vaultDropEntries` splits URI lists on `/\r?\n/` (CRLF-safe) and decodes via
  URLSearchParams. `newNotePath`/PDF-annotation output paths use the `/`
  convention and pass `allowedPath`.
- **Timers**: `node:timers` aliases (`nodeTimeout`) are deliberate — the
  `obsidianmd/prefer-window-timers` rule flags only bare globals (verified rule
  source), and Node timers are not background-throttled, which keeps the 50 ms
  stream flush and warmup debounce reliable in background/popout windows.
  UI-frame work uses `window.*` (sanitize fallback, scroll fallback, reveal
  highlight). Cleanup symmetry verified: warmup timers cleared in
  `clearWarmup`/`onClose`, `streamTimer` cleared in `send()` finally and on
  retry/escalation, sanitize handle cancelled in register cleanup (F2 keeps
  this). Two unregistered one-shots remain and are harmless: the 0 ms
  context-menu show and the 1,200 ms reveal-highlight `removeClass` on a
  possibly-detached row (registering per-click cleanups would accumulate
  closures — worse than the no-op).
- **register() symmetry**: all `registerEvent`/`registerDomEvent` auto-clean;
  per-reply click listeners die with their detached nodes once F2 releases the
  observer references; `onunload` closes owned modals, clears warmup, stops the
  view, disconnects all four bridges.
- **Provider orchestration races (main.ts side)**: hold/release symmetry holds
  on every switch path (one-message override, automatic choice, quality
  escalation, failure retry): `await releaseReply()` before the next `hold()`,
  `this.releaseReply` updated so `stop()` always releases the live hold;
  `connect()` releases in `finally`; `probePrimaryQuota`/`automaticOffers`
  hold/release per provider. Abort/epoch guards present after every await in
  tool dispatch and staging. No leak found.
- **Selection capture**: `clip(...,3000)` cap; round-1 SELECTED PASSAGE wiring
  present (`context+='SELECTED TEXT from …'`); offsets are editor/LF-based.
- **Tool-result caps at dispatch (all verified)**: read_note 12,000-char
  `noteChunk` + continuation; read_attachment 16,000; read_reference 1,400;
  read_pdf 63,000/page and 32-page/64,000-char ranges; search_vault 5 matches +
  2×750-char sources; query_vault_graph PAGE=100, VALUE_LIMIT=500, depth≤8,
  noteGraph <60 KB; list_vault_paths 50/page; base rows capped (120-char cells);
  plugin-api values ≤128/≤32 chars, search 12×(128+100), ≤8 drafts; ToolGuard
  40 soft/50 hard per attempt; history 12 messages, replay bounded, image
  budget 2.
- **Startup**: `onload` performs synchronous reads (`loadPendingEdits`,
  `loadRoutingHistory`, `reloadRoutingCalibration`, `organization.load`) — on
  Defender/OneDrive-heavy machines these add startup latency. Deferred (design
  below) because reordering onload around `registerView`/pending-load error
  surfaces is lifecycle-sensitive.

## Cross-file proposals (2 actionable + 2 minor)

### P1. `src/organization.ts` — open-note CRLF comparison (Windows bug, same class as F3/F4)
`organization.ts:213` and `:288` compare the `currentText` callback (editor text,
LF) against raw `vault.read` (CRLF on disk) for **open** notes. A CRLF note open
in the editor therefore always fails with "Save open changes…" even when nothing
is unsaved — blocking deletion previews and organization reviews on Windows.
```ts
// old (line 213)
   if(note?.extension.toLowerCase()==='md'&&open.has(entry)&&await this.read(entry)!==await this.app.vault.read(note)){
// new
   if(note?.extension.toLowerCase()==='md'&&open.has(entry)&&(await this.read(entry)).replace(/\r\n?/g,'\n')!==(await this.app.vault.read(note)).replace(/\r\n?/g,'\n')){
// old (line 288)
   if(open.has(note.path)&&text!==await this.app.vault.read(note))throw Error('Save open changes before reviewing organization: '+note.path);
// new
   if(open.has(note.path)&&text.replace(/\r\n?/g,'\n')!==(await this.app.vault.read(note)).replace(/\r\n?/g,'\n'))throw Error('Save open changes before reviewing organization: '+note.path);
```
Rationale: line endings are not content (F4 semantics); LF-only behaviour
unchanged. Test impact: add a CRLF-open-note case to the organization sibling's
Windows test file; existing assertions unaffected. (Line numbers are a snapshot;
relocate by content — the file is under sibling edit.)

### P2. `tests/security-main.test.ts` — symlink fixture (owner already landed ✅)
The brief's pre-existing 9 failures were the `symlinkSync` before-hook (line 45).
Verified during this pass: with `linkSync` in its place all 9 assertions execute
and pass against the new main.ts (scratch copy). The owner has since fixed the
fixture — the real file now runs 10/10. **No action left**; recorded so the
orchestrator does not re-attribute those failures.

### P3. `src/recovery.ts` `backupEdit` — synchronous I/O per accepted edit (minor)
Still `mkdirSync`+`writeFileSync`+`readdirSync`+`statSync` on the UI thread per
backup (retention is now fail-safe). Proposal: make `backupEdit` async
(`fs/promises`) and `await` it in `writeEdit.prepare` callers, or move retention
sweep to a debounced idle pass; keep the write-before-edit ordering (safety).
Risk: CAREFUL (ordering is the recovery guarantee). Gain: removes a sync disk
stall per accepted edit on Defender-scanned volumes.

### P4. `src/core.ts` `excludedCache` unbounded (minor)
`core.ts:155` keyed by the excluded-folders string, never evicted. Only grows on
setting changes; propose a 32-entry FIFO cap. Risk: SAFE. Gain: theoretical.

## Deferred items (risk tier + design)

### D1. PDF document cache — perf rank 5 / REVIEW §5.1 (CAREFUL)
`readPdfBytes` re-reads and `withPdfDocument` re-parses the whole PDF per
continuation call (N calls = N reads + N pdf.js parses + N copies). Design:
1–2-entry LRU keyed by `path + size + mtime` (TFile) or File identity (external
File is immutable), holding the parsed `PdfDocument`; destroy on
`newChat`/`onClose`/attachment-epoch change/abort; byte cap (e.g. 64 MB) so a
512 MB PDF never stays resident; `withPdfDocument` becomes `withCachedPdfDocument`
with the same abort/password semantics (destroy removes the entry). **Do not
apply blindly**: sibling WIP was observed in `src/pdf.ts` during this pass —
coordinate ownership first. Byte-only caching was considered and rejected as
not worth the staleness surface (reads are ~5 ms warm; the parse dominates).

### D2. Async startup loads (CAREFUL)
Move `loadRoutingHistory`/`reloadRoutingCalibration` (non-critical) behind
`onLayoutReady` or async I/O; keep `loadPendingEdits` synchronous-before-first-
render because `pendingLoadError` must surface in the first review paint.
Needs live verification of onload ordering; not done in this pass.

### D3. Hermes `ensurePrivateHome` digest gate — REVIEW §5.3 (CAREFUL, sibling file)
Unchanged from round 1: gate only the config/skills rewrites behind a content
digest **after** the planted-symlink validation pass; never skip validation.
Owned by the hermes sibling; no main.ts half applies.

## Verification

Gates (final, after all edits):
- `npm run check` ✓ clean (transient sibling errors in `pdf.ts`/`cli.ts`/
  `auto-route.ts`/`editor-diff.ts`/`note-tools.ts` observed mid-pass; converged).
- `npm run lint` ✓ clean (same transient attribution).
- Targeted: `tests/audit-win-perf.test.ts` + `tests/audit-win-main.test.ts`
  **26/26**; with `security-main` + `long-notes` + `visual-context`: **49/49**.
- Full suite: grew 654 → 709 → **711 tests** during the pass as siblings landed
  fixes. Cleanest complete run: **709 tests, 708 pass, 0 fail, 1 skipped**
  (`security-vault` Developer-Mode skip, by design per the brief's recipe).
  The two later runs (711 tests) showed 1–2 failures that rotate between
  sibling-owned, actively-edited provider/cli tests ("stopping during session
  creation…", "a duplicated catalogue entry is offered once", "a provider child
  stream error never crashes the host…"); each **passes in isolation** (9/9,
  31/31 re-runs) — sibling WIP/parallel-load transients per brief rule 7, none
  in owned files. Earlier mid-pass transients (opencode event gate, attachments
  ANSI/UTF-16, note-tools CRLF, organization case-fold) likewise converged.
- Baseline comparison: brief's fan-out baseline 479/467/12 (all 12 = symlink
  EPERM). The symlink fixtures were fixed by their owners during the pass;
  the suite grew to 709 with sibling regression tests.
- H2 cross-check: scratch hardlink-fixture copy of `security-main.test.ts`
  9/9 against the coalesced main.ts (before the owner's fixture fix landed).
- No `npm run build` run (orchestrator-only). No git writes. macOS code paths
  untouched (FM routing, OCR, darwin branches); POSIX behaviour proven by
  LF-byte-identical tests and the open-editor writeEdit regression test.

## Files

- Modified: `src/main.ts` (+72/−12 lines, all hunks listed in F1–F6).
- New: `tests/audit-win-perf.test.ts` (12 tests), `tests/audit-win-main.test.ts`
  (14 tests), this report.
- Scratch (probes, not shipped): `…/cache/scratch/win-perf/` — Notice probe,
  hardlink security-main copy, noteText repair script.
