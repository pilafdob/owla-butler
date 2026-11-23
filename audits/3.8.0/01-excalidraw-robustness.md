# Handoff 1 — Excalidraw token usage and complex freehand drawings

Proposal item: "fix Excalidraw token usage and inability for handling complex free drawings (maybe limitations are required)".

## Evidence (real failure)
Session `owla-session-2026-11-23T10-46-57`, model nvidia nemotron via OpenCode, prompt "cleanup the handwritten stuff, and make it into a proper diagram, but keep the same structure" on a drawing with 289 elements (274 `freedraw`, 2 line, 7 text, 5 arrow, 1 rectangle). Sample file: `~/Downloads/Bildung der Demokratie durch Militär 1.md` (read-only; copy it into a test fixture only if you strip personal content, otherwise synthesise an equivalent).

What went wrong:
1. `read_excalidraw` printed one line per freedraw stroke (≈16k chars, paged in 12k chunks) — pure noise; the model cannot read handwriting from stroke bounding boxes anyway.
2. The model then called `read_note` on the same file with offsets up to 120000, dumping base64 `compressed-json` (126k chars) into context. Wasted tokens, zero information. `read_note` on an Excalidraw file already prefixes a hint; it must not return the compressed blob at all.
3. `propose_excalidraw` failed with "Provide between 1 and 200 drawing operations." because the model tried to delete ~274 strokes one by one; it then retried and got staged, but ~295s and 5.4k output tokens were burned and the turn ended "Stopped".
4. Nothing tells the model that handwriting is only legible through `visual=true`.

## Required work
1. **Compact scene summary.** In `describeElements` / `summarizeExcalidraw` (`src/excalidraw.ts`), collapse freedraw (and other pure-ink) elements into clusters: group by proximity / group id / bounding region and emit one line per cluster, e.g. `ink cluster c1: 23 strokes at (-447,-270) 210×95 ids=[first..last]`. Keep ids resolvable. Keep shapes/text/arrows listed individually. Cap total output with an explicit "… N more" line. Target: the sample file's read output shrinks to well under 4k chars.
2. **Bulk operations.** Add to `applyExcalidrawOperations`: `delete_many {ids:[…]}` and `delete_cluster {cluster}` (or `delete_ink {region:{x,y,width,height}}` — pick one clean design, document it). Raise nothing blindly: keep `EXCALIDRAW_OPERATIONS_LIMIT` sane but make a 274-stroke cleanup one or two operations. Validate ids exist; report unknown ids instead of silently skipping.
3. **Hard limits (the proposal allows limitations).** Define and enforce: max elements summarised, max operations per proposal, and a clear model-facing error that names the limit and the alternative (use clusters / `delete_many`). Surface the same message when a drawing is too large to render visually.
4. **Never leak the blob.** `read_note` (and any other read path) on an Excalidraw file must return a short redirect to `read_excalidraw`, no compressed data, even with `offset`. Find the code near the existing hint (`src/main.ts` around the "This Markdown file is an Excalidraw drawing" string) and fix both first-page and offset-page cases. Test it.
5. **Skill/prompt guidance.** Update `assets/skills/owla-excalidraw` (and rebuild `assets/reference-pack.json` the way the repo already does — check `package.json`/`scripts/` for the generator; do not hand-edit the pack unless that is the only way and say so): handwriting is read with `visual=true`; replace ink with clean shapes/text via cluster delete + `add_text`/`add_shape`; keep structure by reusing positions of the ink clusters.
6. **Typed ink fallback.** If the model cannot tell what a cluster says, it should say so and ask rather than guess. Add one line to the skill.

## Tests
Extend `tests/audit-tools-excalidraw.test.ts` or add `tests/excalidraw-ink.test.ts`: synthetic 300-stroke scene → summary size bound, cluster ids round-trip, bulk delete works and is revertable via `revertExcalidraw`, limit errors are clear, `read_note` never returns compressed data.

## Out of scope
New drawing features, vision routing, other providers' code.

## Report

### What changed and was verified

| Area | Change | Verification |
|---|---|---|
| Summary / clusters | `src/excalidraw.ts`: inline freedraw strokes into proximity clusters (`ink cluster c1: 23 strokes at (x,y) W×H ids=[…]`) — one line per cluster, shapes/text/arrows still listed individually, explicit "… N more" tail at `EXCALIDRAW_SUMMARY_LIMIT` (6,000 chars) | Probe on the actual failing sample (decompressed via LZString, the plugin's `compressToBase64`): old `describeElements` = **289 lines / 15,979 chars** (matches the audit's "≈16k"); new `summarizeExcalidraw` = **2,385 chars / 18 lines** (target "well under 4k") ✓ |
| Bulk ops | `src/excalidraw.ts`: `delete_many {ids:[…]}` (validate-first: unknown ids throw a named list, nothing applied), `delete_cluster {cluster}` (re-derives membership, errors with valid cluster names) | 274-stroke cleanup = **one operation**; `revertExcalidraw` restores all strokes; unknown ids named (`"nope", "gone"`); unknown cluster names list valid ones ✓ |
| Hard limits | `EXCALIDRAW_MAX_OPS_PER_PROPOSAL=200`, `EXCALIDRAW_RENDER_LIMIT=1500`, `EXCALIDRAW_OPERATIONS_LIMIT=100000`; op/byte-limit errors name `delete_many` / `delete_cluster` as the alternative | `npm run check` green; unit tests assert every message ✓ |
| Never leak the blob | `src/main.ts` read_note: any Excalidraw drawing text redirects to `read_excalidraw` (first page, offsets, headings, blocks — no compressed data, no hint prefix); search_vault auto-read returns the same redirect | 4 `read_note` combos (offset 0 / 120000 / heading / block) all return the redirect with no `compressed-json`, no blob; `search_vault` source text is the redirect ✓ |
| Visual limit | `excalidrawRenderLimitNotice` surfaces "too large to render" (1,501 live elements) naming the bulk alternatives | Integration test on a 1,501-element scene returns the notice; no render attempted ✓ |
| Skill | `assets/skills/owla-excalidraw/SKILL.md`: ink clusters, `visual=true` for handwriting, `delete_cluster`/`delete_many` ops, typed-ink fallback line | Verified in the pack mirror below ✓ |
| Reference pack | `assets/reference-pack.json`: entry `owla-excalidraw` regenerated from the skill (gzip-safe: no trailing newline) | Value matches the skill file byte-for-byte; no generator script exists in the repo, so the pack was hand-mirrored (only way) — say so ✓ |

### Verification commands (real output, at the time of writing)
- `npm run check` — exit 0, no diagnostics (verified earlier this session; STOPPED being green after handoff 3 concurrently modified `tests/pdf-selection.test.ts`).
- `npm run lint` — exit 0 (8 pre-existing warnings, none in new code paths).
- `npm test` — 839 tests (831 pass, 2 fail): all **11 new `excalidraw-ink.test.ts` tests pass**; the 2 failures are handoff 3's pdf-selection tests (file untouched by this work; handoff 3 is still working on it).

### Not verified / open
- `npm run check` currently FAILS (TS2345 "number is not assignable to string" at tests/pdf-selection.test.ts:60 and :66) — caused by handoff 3's concurrent edit to that file, which I did not touch. It is out of scope for this handoff (pdf-selection is their file); it must be re-checked by the lead once the edit is settled.

### Lead fixes after review (2026-11-23)
- **Blocker fixed:** `propose_excalidraw` tool schema in `src/main.ts` still had `enum` without `delete_many`/`delete_cluster` and no `ids`/`cluster` properties, so models could not call the new ops through strict schemas. Added both ops, the properties, and a one-line description of them.
- **Bug fixed:** `delete_cluster` re-derived cluster names from the scene after earlier deletes in the same proposal, so `[delete_cluster c1, delete_cluster c2]` deleted the *third* group. Names now resolve against the scene the proposal starts from (`src/excalidraw.ts`, `readClusters`).
- Tests added in `tests/excalidraw-ink.test.ts`: cluster names stable across one proposal (mutation-checked: fails on the old code), schema exposes the bulk ops. 13/13 pass.
