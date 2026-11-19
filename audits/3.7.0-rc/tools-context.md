# 3.7.0 RC — Tool calls, context assembly & features audit

Scope: owned tool/context modules (fixed) + read-only audit of `src/main.ts` prompt/context
assembly & tool dispatch, `src/note-tools.ts`, and README feature coverage (proposed only).
Branch `3.7.0-RC`. Shared working tree; sibling agents edited concurrently throughout.

## Verification (final)

- `npm run check` — **clean** (no errors).
- `npm run lint` — **clean** (no errors).
- Owned + new audit tests: **86/86 pass** (`pdf, pdf-tools, excalidraw-workflow, visual-context,
  visual-files, visual-availability, attachments, search, vault-graph, knowledge, plugin-api,
  long-notes` + `tests/audit-tools-*.test.ts`).
- Full `npm test`: 459 tests, 458 pass, **1 fail — unowned & flaky**: `Hermes refuses instruction
  files above the session folder, below home` (`tests/hermes.test.ts`). It **passes in isolation**;
  fails only under full-suite parallel load. `src/hermes.ts`/`tests/hermes.test.ts` carry ~222/~213
  lines of sibling changes; not touched here. Noted only, per task rules.
- Real-vault probes (read-only, scratch, deleted): 3 real `.canvas` files round-trip
  **byte-identically** with 0 problems after the serializer fix; a real 388-element `.excalidraw`
  JSON drawing round-trips byte-identically and edit→revert restores original text. Compressed
  `.excalidraw.md` drawings correctly require the plugin decoder (expected, not a bug).
- Baseline at start: check ✓ lint ✓ 342/342 ✓. Mid-run sibling edits briefly broke
  `claude.ts`/`hermes.ts`/`codex`/`cli` (unowned); they converged before the final run.
- Per task constraint the Agentbrain vault note (skill step 7) was **intentionally not written**.

## Concurrent work respected (not re-done)

- `src/search.ts` + `tests/search.test.ts` were **already hardened by a sibling agent** during this
  audit (word-boundary term matcher with cached regexes, empty-query guard `if(!words.length)return 0`,
  relevance floor for long queries). Verified live via probe (`searchScore('…','…paragraph…','graph')===0`,
  empty query → 0). **Left untouched.** This covers the "search.ts correctness/perf" item.
- `src/ocr.ts`, `tests/ocr.test.ts`, `final Review Audits/`, and the scratch `owla-auto-*` /
  `owla-worker-excalidraw.md` / `owla-baseline/` artifacts are other agents' work — read-only, untouched.

---

## FIXED (owned modules)

### F1 — HIGH — `src/canvas.ts` `summarizeCanvas` crashed on damaged canvases
- Evidence: `summarizeCanvas(parseCanvas('{"nodes":[null],"edges":[]}'))` →
  `TypeError: Cannot read properties of null (reading 'type')`; null edge → same on `'id'`.
  `read_canvas` (main.ts) calls `summarizeCanvas(parseCanvas(text))` with **no** `canvasProblems`
  gate, so a malformed `.canvas` returned an opaque crash to the model.
- Fix: guard non-object node/edge entries; describe them as `- invalid node #N (not an object)` /
  `- invalid edge #N …`; guard `groups`/`byId`/`inside`. Valid-canvas output is unchanged.
- Test: `tests/audit-tools-canvas.test.ts` (damaged summary + valid summary unchanged).

### F2 — HIGH — `src/canvas.ts` `serializeCanvas` did not match Obsidian's format (round-trip integrity)
- Evidence: real `Overview.canvas` / `Learning Map.canvas` / `Kinematik.canvas` use Obsidian's canonical
  format — tab-indented top-level keys, **no space after colon**, each node/edge a **compact single-line
  object**, no trailing newline. Old `JSON.stringify(data,null,indent)` emitted standard pretty JSON
  (`"nodes": [`, multi-line objects): untouched round-trip **false**, and every proposal reformatted the
  whole file (unusable review diff).
- Fix: serialize in Obsidian's canonical format; preserve a trailing newline only if the source had one.
  All 3 real canvases now round-trip **byte-identically**; a one-card change alters exactly one line.
- Test: `tests/audit-tools-canvas.test.ts` (byte-identity, minimal diff, newline preservation, empty canvas).
- Intentional owned-test change: `tests/visual-files.test.ts` `canvasText` fixture converted from pretty
  JSON to the canonical compact format so its round-trip assertion matches the corrected serializer.

### F3 — HIGH — `src/excalidraw.ts` parse/summary crashed on damaged drawings
- Evidence: `elements:[null]` parsed fine then `summarizeExcalidraw` → `TypeError … 'isDeleted'`;
  `boundElements:"oops"` → `element.boundElements?.find is not a function`; `groupIds:"bad"` → `.join` crash.
- Fix: `sceneOf()` rejects non-object elements with an actionable error ("…not an object; the file may be
  damaged."); `boundList()` tolerates non-array `boundElements` in `textOf`/`move`/`delete`; `groupIds`
  guarded with `Array.isArray`. Valid drawings unaffected (real 388-element file verified).
- Test: `tests/audit-tools-excalidraw.test.ts`.

### F4 — MED — `src/excalidraw.ts` non-positive sizes accepted for new shapes/frames
- Evidence: `add_shape width:-50` → accepted (`-50`); `add_frame width:0,height:0` → accepted. `resize`
  already required positive sizes — inconsistent.
- Fix: `add_shape`/`add_frame` require `width>0 && height>0` ("the size must be positive.").
- Test: `tests/audit-tools-excalidraw.test.ts`.

### F5 — MED — huge model arguments unbounded (canvas + excalidraw)
- Evidence: `add_text` with 500,000-char text accepted; canvas `add_node` 500,000-char text accepted;
  no aggregate bound on operations (200 ops × large payload).
- Fix: `EXCALIDRAW_TEXT_LIMIT=10_000` per text (`add_text`/`update_text`/`add_shape` text/`add_arrow` label);
  `EXCALIDRAW_OPERATIONS_LIMIT=100_000` and `CANVAS_OPERATIONS_LIMIT=100_000` on the serialized operations
  payload, with actionable "too long"/"too large" errors. Bounds model-supplied deltas, not existing files.
- Test: `tests/audit-tools-excalidraw.test.ts`, `tests/audit-tools-canvas.test.ts`.

### F6 — MED — `src/bases.ts` recursion overflow on deeply nested filters
- Evidence: 3000-deep `{"and":[…]}` filter → `Maximum call stack size exceeded` in `filterProblems`
  (and `baseReferences.scan`).
- Fix: depth guard (>64) in `filterProblems` (reports "is nested too deeply") and `baseReferences.scan`.
- Test: `tests/audit-tools-bases.test.ts` (deep nesting + ordinary nesting still validates).

### F7 — HIGH — `src/vault-graph.ts` `noteGraph` result unbounded (token leak)
- Evidence: a note with 3000 outgoing + 3000 unresolved links and a 200,000-char property →
  `JSON.stringify(noteGraph(...))` = **263,893 bytes** returned to the model in one tool result.
- Fix: `outgoing`/`unresolved` capped to `PAGE=100` with `outgoingCount`/`unresolvedCount` totals;
  `tags` capped to 100; property values truncated via `shortValue` (strings >500 chars, arrays >20,
  object keys >40, depth >8). Property-query display values truncated too (matching still on raw value).
  Result now <60 KB. Existing array shapes preserved for small graphs (back-compatible).
- Test: `tests/audit-tools-vault-graph.test.ts`.

### F8 — MED — `src/vault-graph.ts` `decodeGraphQuery` offset not validated
- Evidence: `offset` accepted as any number (NaN/Infinity/negative/fractional reached `queryGraph`).
- Fix: require `Number.isSafeInteger(offset) && offset>=0` ("offset must be a nonnegative integer.").
- Test: `tests/audit-tools-vault-graph.test.ts`.

### F9 — MED — `src/plugin-api.ts` padded colour rejected as "invalid preview"
- Evidence: `validValue` colour accepts `'  #ff0000  '` (regex on `.trim()`), but a real companion plugin
  returns the trimmed `after`, so `after!==value` threw the opaque "returned an invalid preview".
- Fix: normalise colour values (`.trim()`) before `prepare`/comparison/display.
- Test: `tests/audit-tools-plugin-api.test.ts` (padded colour stages trimmed; plain colour unchanged).

### F10 — MED — `src/pdf-tools.ts` opaque pdf-lib error for damaged/encrypted PDFs
- Evidence: `validatePdfComments(garbageBytes,…)` threw pdf-lib's
  `Failed to parse PDF document … No PDF header found` (encrypted PDFs similarly suggest `ignoreEncryption`).
- Fix: `loadPdf()` wraps `PDFDocument.load` → "The PDF could not be opened; it may be damaged or
  password-protected. Attach an unlocked, valid PDF." Used by `validatePdfComments` and `annotatePdf`.
- Test: `tests/audit-tools-pdf-tools.test.ts`.

### F11 — MED (perf) — `src/organization.ts` double vault-read per note (N+1)
- Evidence: `previewRemoval` and `preview` did `await this.read(entry)` **and** `await this.app.vault.read(note)`
  for every Markdown note. For closed notes `currentText` already equals the saved file → redundant read
  (a 1000-note folder preview = 2000 reads).
- Fix: `openNotePaths()` collects open Markdown-editor paths once; the saved-file comparison runs only for
  open notes (the only ones that can hold unsaved changes). Closed notes skip the redundant read entirely
  in `previewRemoval`. The unsaved-changes guard is preserved for open editors.
- Test: `tests/audit-tools-organization.test.ts` (closed note: 0 reads; open unsaved: blocks, 1+1 reads;
  open saved-matching: passes, 1+1 reads). Uses `stubObsidian()` + a temp dir; never touches a real vault.

## Reviewed, no change needed (owned)

- `src/pdf.ts` — `readPdfTextRange` (64 KB budget, 32-page window, offsets validated), `searchPdfText`
  (≤200-char needle, 64-page/8-match cap, bounded excerpts), `pdfPageNumber`/`pdfSource` already hardened.
- `src/attachments.ts` — 512 MB file cap, 32 MB archive budget (zip-bomb guard via `originalSize`),
  64 KB text bound, 256 KB text sample, native-conversion timeouts, temp copies `0o600` and removed.
  DOM/native paths are live-only; no unit-testable defect found.
- `src/visual.ts` — temporary-leaf capture/inspect with save disabled, `within()` timeouts, `invalidExpressions`
  cycle/depth guards, row/cell bounds. Live-only (Obsidian engines); no unit-testable defect found.
- `src/knowledge.ts` — `readReference` offset validated, 1400-char windows with continuation; sound.
- `src/editor-diff.ts` — decorations gated on exact `after` match and 200 KB cap; sound.
- `src/organization.ts` dependency safety — overlap/case-fold destination checks, symlink/hardlink refusal,
  fingerprint + checkpoint journaling, rollback with `assertFresh`, recoverable-trash requirement: intact.

---

## READ-ONLY findings — proposed patches (NOT applied; `main.ts`/`note-tools.ts` are sibling-owned)

Line numbers are as observed during the audit; sibling edits to `main.ts` may shift them. Cite by tool/function.

### R1 — MED (perf) — `main.ts` `read_note` re-reads the whole file to validate the cache
- Where: `read_note` handler, `const cache=!pending&&file&&await this.app.vault.read(file)===text?…` (~line 1793).
- Problem: `currentText(path)` already read the file; for a **closed** note the second `vault.read` is redundant.
- Proposed patch:
  ```ts
  const openView=this.app.workspace.getLeavesOfType('markdown')
    .some(l=>(l.view as MarkdownView).file?.path===path);
  const cache=!pending&&file&&(!openView||await this.app.vault.read(file)===text)
    ?this.app.metadataCache.getFileCache(file):null;
  ```
  Closed notes trust `text===saved`; only open editors (possible unsaved text) trigger the comparison.

### R2 — MED (perf) — `main.ts` `search_vault` re-reads the top two matches
- Where: `search_vault` handler, `for(const result of found.slice(0,2)){const content=await this.tool('read_note',…)}` (~line 1692).
- Problem: the worker loop already read each file (`cachedRead`/open editor); the top two are read again via
  `read_note`. Note the `read_note` call also sets `this.snapshots` (needed so a later `propose_edit` works).
- Proposed patch: capture scanned text during the worker loop (`const scanned=new Map<string,string>()`,
  `scanned.set(file.path,text)`), then for the top two set the snapshot from the scanned text and clip it,
  instead of a second read:
  ```ts
  for(const result of found.slice(0,2)){
    const text=scanned.get(result.path)??'';
    if(!this.snapshots.has(result.path))this.snapshots.set(result.path,text);
    sources.push({path:result.path,content:clip(text,750)});
  }
  ```
  Preserves the snapshot side effect; removes two redundant reads.

### R3 — MED (missing context) — captured cursor selection text is not sent
- Where: `send()` context assembly, `ACTIVE NOTE … Captured cursor offset: X; selected end: Y` (~line 2207).
- Problem: `capture()` returns `start`/`end`; when the user has an active selection (`start!==end`) the context
  prints only the offsets, **not the selected passage**. README advertises "selections"; explicit "Add selection"
  chips work, but the implicit cursor selection is invisible to the model unless it guesses to `read_note`.
- Proposed patch (after the ACTIVE NOTE line):
  ```ts
  const sel=captured.start!==captured.end?captured.text.slice(captured.start,captured.end):'';
  if(sel)context+='\nSELECTED PASSAGE (cursor selection):\n'+clip(sel,3000);
  ```

### R4 — LOW (perf) — `main.ts` `search_vault` sorts on every match
- Where: worker loop `found.push(...);found.sort(...);if(found.length>5)found.pop();` (~line 1688).
- Problem: O(n log n) sort per matching file. Proposed: insert in sorted position (or sort once after the scan)
  and keep the top 5. Minor.

### R5 — `src/note-tools.ts` — reviewed, no defect
- `noteHeadings` (fence/frontmatter skip, CRLF-safe offsets), `findSection`, `findBlock` (escaped id),
  `updateProperties` (case-insensitive keys, body preserved), `linkTargets`/`brokenLinks` (code-fence aware),
  `tableAt` (fence skip + delimiter requirement) are sound. Sibling's staged table feature; report-only.

### R6 — LOW (security note) — `src/plugin-api.ts` event contract cannot authenticate the responder
- `discover()` verifies the plugin is in `enabledPlugins`, requires exactly one reply (fail-closed on duplicates),
  checks self-declared `id`/`pluginId`, and re-checks identity on `apply`. But any **enabled** plugin can listen to
  another's `pilafdob:<id>:api:v1` event and reply with a matching id — workspace events carry no sender identity.
  Inherent to the transport; no fix without provider-side authentication. Documented as an open trust boundary.

---

## Missing-feature / documentation gap list (README vs implementation)

Verified **present and wired**: current note incl. unsaved text (`capture`/`currentText`), explicit selection
chips, heading outlines (`headingOutline`), excluded-folder enforcement (`allowedPath` + `realpathSync.native`
on every gate: capture, visualContext, read_note, search, graph, organization), attachments/conversion, vault +
web search, reviewed edits/moves/deletions with dependency `requires`, properties edits, block reads, Canvas/
Bases/Excalidraw read+propose+visual, PDF read/search/visual/annotation, companion-plugin tools, automatic
provider/model routing, usage limits, saved chats, editor/split diff.

Gaps (all LOW, documentation or the R3 context item):
- **G1** — README tagline (line 6), "Why OWLA" (line 26) and Requirements (line 42) omit **Hermes Agent**, though
  it is a supported provider (lines 22, 57, 69). Proposed: add Hermes to the tagline and requirements list.
- **G2** — README line 159 "disabled for OWLA sessions on **both** providers" — there are now four. Proposed:
  "on every provider".
- **G3** — README lines 243/251 use Codex-specific wording ("Codex can request…", "give Codex access") for
  multi-provider features. Proposed: generalize to "the assistant".
- **G4** — the substantive missing-context item is **R3** (captured cursor selection text not sent), versus the
  README "selections" promise.

## Open questions

1. Canvas serializer: confirmed Obsidian's canonical compact format on 3 real files; if a future Obsidian
   changes its writer, `serializeCanvas` should be re-probed against real files (byte-identity is the bar).
2. Excalidraw `move` does not re-route arrows bound to the moved shape (only the shape + its bound text move).
   Excalidraw re-routes on load in the editor; staged pictures may show a detached arrow until reload. Left as-is
   (geometry re-routing is out of scope for this pass); flag for a follow-up if visual fidelity matters.
3. R6 responder authentication — accept the workspace-event trust boundary or add a provider-side handshake?
4. The flaky unowned Hermes instruction-file test passes in isolation; worth a sibling look at test isolation.

## Files changed by this audit

- Source (owned): `src/canvas.ts`, `src/bases.ts`, `src/excalidraw.ts`, `src/vault-graph.ts`,
  `src/plugin-api.ts`, `src/pdf-tools.ts`, `src/organization.ts`.
- Owned test updated (intentional): `tests/visual-files.test.ts` (canvas fixture → canonical format).
- New tests: `tests/audit-tools-{canvas,bases,excalidraw,vault-graph,plugin-api,pdf-tools,organization}.test.ts`.
- No commits/stages/pushes; no build run; no real vault mutated; scratch probes deleted.
