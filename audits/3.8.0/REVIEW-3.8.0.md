# REVIEW 3.8.0 — independent review (Opus reviewer, 2026-11-23)

Scope: the uncommitted working tree on branch `OWLA-RC` (base `7b414f2`) holding handoffs 1–5, including the lead's post-review fixes recorded in the handoff Reports. `git pull` reported "Already up to date". Nothing was committed, staged or pushed. Source files were mutated only for the mutation checks below; each was restored from a byte copy and checked with `cmp`.

## Verdicts

| # | Handoff | Verdict |
|---|---------|---------|
| 1 | Excalidraw robustness | **PASS WITH NOTES** |
| 2 | Obsidian guide skill | **PASS** |
| 3 | PDF selection + hidden page image | **PASS WITH NOTES** |
| 4 | Note context, properties, outline | **PASS WITH NOTES** |
| 5 | PDF export | **FAIL** (pure helpers only; the feature is not wired) |

**Release readiness: not ready.** PDF export is one of the 3.8.0 proposal items, and it is not reachable by any model or user. If the lead decides to ship 3.8.0 without PDF export, it becomes **ready after the listed should-fixes**: S1 at least, S2–S3 recommended.

## Findings (ranked)

### Blocker

**B1 — `export_pdf` is not implemented (handoff 5).**
- `src/pdf-export.ts` and `src/pdf-export-run.ts` are imported nowhere. `grep -n "export_pdf\|pdf-export" src/*.ts` outside those two files returns nothing, so esbuild drops them from `main.js`.
- Required-work status:
  - Item 1 (feasibility): **done**, and documented well.
  - Item 2 (`export_pdf` tool with confirmation, allowed-path and collision checks): **missing**. Only the pure `pdfOutputPath` exists.
  - Item 3 (layout-fix helpers): **done as pure functions**. They are not reachable: nothing tells the model to stage `insertPageBreaks` output, and no tool returns layout issues.
  - Item 4 (read-back verification loop): **missing** in `main.ts`. `pdfLayoutIssues`/`issuesFromPdf` exist but are unused.
  - Item 5 (skill text, provider wiring, `OWLA_TOOL_NAMES`): **missing**. `assets/skills/owla-pdf/SKILL.md` is unchanged and still says "OWLA cannot run that export itself", which is at least consistent with the current build.
- The Report section is still "(worker fills in)" plus an interim "Prep" section whose "Remaining" list is exactly the missing work.
- Failure scenario: a user asks "export this note as PDF and fix the title placement". No tool exists, and the model can only point the user to the command palette.
- Docs honesty: the feasibility finding is stated truthfully. Route B (internal print modal, no dialog) is described as undocumented internals, route A as dialog-only, and live behaviour is marked unverified. Nothing is claimed as verified that wasn't.

### Should-fix

**S1 — `read_note` and `search_vault` refuse ordinary notes that mention `excalidraw-plugin:` (handoff 1).**
- Locations: `src/main.ts:2055` and `src/main.ts:1928` now gate on `isExcalidrawText`, where the old hint used the stricter `isExcalidrawNote`.
- Cause: `isExcalidrawText` (`src/excalidraw.ts:37`) uses `/^---[\s\S]*?excalidraw-plugin:/m` over the first 2,000 chars. With the `m` flag, any `---` line (a horizontal rule, or the closing frontmatter fence) followed by the words `excalidraw-plugin:` anywhere, including a code block, counts as a drawing.
- Reproduced with a probe:
  - `"# Notes…\n\n---\n\nTo make a drawing, set \`excalidraw-plugin: parsed\`…"` → `isExcalidrawText=true`, `isExcalidrawNote=false`.
  - A note with normal frontmatter and a fenced `excalidraw-plugin: parsed` example gives the same result.
- Failure scenario: a user's how-to note about Excalidraw becomes unreadable through `read_note` (every offset, heading and block). Because of that it also gets no read snapshot, so `propose_edit` refuses it. `search_vault` replaces its source text with the drawing redirect.
- Fix direction: in the two read paths, redirect on `isExcalidrawNote(text) || isExcalidrawJson(text) || DRAWING.test(text)` (real frontmatter key, JSON scene, or a `## Drawing` data fence), or anchor the regex to the frontmatter block. Add a regression test with the two probe notes above.

**S2 — The PDF-selection wiring in `main.ts` has no behavioural test (handoff 3).**
- What I mutated, both at once:
  - In `src/main.ts:2786`, the page image was sent to every model, whatever its `inputModalities`.
  - In `src/main.ts:1627`, the `allowedPdf` check in `addPdfSelection` was removed.
- Result: `npm test` reported 867 pass, 0 fail.
- `tests/pdf-selection.test.ts` covers only the pure helpers. `tests/pdf-selection-trim.test.ts` covers only the trim splice.
- Untested branches worth a `loadMain` test:
  - per-attempt text-only swap (`readsImages`);
  - `dropPdfSelectionImages` when no vision model fits;
  - `needsImage`/routing attachments counting the page image;
  - `addPdfSelection` refusing an excluded PDF;
  - `renderPdfSelectionImages` dropping a failed page with a Notice and without blocking the send;
  - the LRU cap of 8.

**S3 — Ink clustering is too coarse to "keep the same structure" on the real evidence drawing (handoff 1).**
- On the sample (`Bildung der Demokratie durch Militär 1.md`, decompressed in memory, read-only), 272 of 274 strokes merge into a single `c1` at `(-473,-269) 749×484`. The 160 px grid cells chain (`INK_CELL`, `src/excalidraw.ts:81`).
- Token and cleanup goals are met: 2,385 chars, and two `delete_cluster` operations remove all 274 strokes.
- But the model gets a single bounding box for all the handwriting, so it can't place replacement `add_text` per word or line as the skill advises ("reuse positions of the ink clusters"). That was the user's actual request in the failing session.
- Fix direction: a smaller cell (around 40–60 px), or splitting clusters by vertical gaps (lines), checked against the sample. Keep names stable within a proposal, as the lead's fix already does.

### Nits

- **N1 (H3)** — When `trimSelectionsForWindow` drops a PDF selection completely, its page image is still attached for that turn. The lead already documented this as a known limit. It costs tokens but doesn't leak anything: the image is of an allowed PDF the user picked.
- **N2 (H2)** — `"Wie sieht das besser aus?"` doesn't trigger the guide (`aussehen` is listed, but `sieht … aus` isn't). "Diagramme nebeneinander" routes to the guide, not mermaid; this is test-pinned and documented.
- **N3 (H4)** — Real `parseYaml`/`stringifyYaml` (js-yaml dates as `Date`, quoting) are untested. Tests use `tests/helpers/mini-yaml.ts`. The parse-back check falls back to full re-serialization, which is safe but drops comments. This needs a live check.
- **N4 (H4)** — The worker's two open questions are still undecided: `move under` places the section as the last subsection, and the outline is repeated for short notes (up to about 2.5k chars per turn).
- **N5 (pre-existing, `assets/skills/owla-pdf/SKILL.md`)** — The skill says "Obsidian saves the exported PDF next to the note by default". Handoff 5 found that the export always opens an OS save dialog. Revise this when B1 lands.

## Gate results (run by me, real output)

| Command | Outcome |
|---|---|
| `npm run check` | `tsc --noEmit`, exit 0, no diagnostics |
| `npm run lint` | exit 0, `✖ 8 problems (0 errors, 8 warnings)`. All 8 are in `src/main.ts`: 5 sentence-case UI strings, 3 `instanceof` (lines 1034, 1443, 3173). The 3173 one is in handoff 3's new `pdfSelectionRangePages` (`node instanceof Element`, a popout-window concern). The others predate 3.8.0. |
| `npm test` | `tests 873 · pass 867 · fail 0 · skipped 6`, exit 0 |
| `npm run build` | `main.js 1.0mb`, `Done in 59ms`, exit 0 (`main.js` is untracked/ignored; `git status` unchanged) |
| `npm run guard:test` | `vault guard tests ok`, exit 0 |
| `npm run check:release` (extra) | `Release checks passed: owla-butler 3.7.2; three-file bundle and full notices verified.` (version not bumped, as required) |

## Per-handoff required work

**H1 Excalidraw.**
1. Compact summary: **done**. Clusters are built in `inkClusters`/`describeElements` (`src/excalidraw.ts`), with a 6,000-char budget and an "… N more" line. On the sample it went from about 16k to 2,385 chars and 18 lines. Granularity is S3.
2. Bulk ops: **done**. `delete_many` validates first and names unknown ids. `delete_cluster` resolves names against the starting scene (lead fix). The schema exposes both (lead fix).
3. Limits: **done**. `EXCALIDRAW_MAX_OPS_PER_PROPOSAL=200`, `EXCALIDRAW_RENDER_LIMIT=1500`, and the messages name the bulk alternative.
4. No blob: **done**. Mutation-checked: disabling the redirect fails the `read_note` test. Over-broad detection is S1.
5. Skill and pack: **done**. The pack entry matches `SKILL.md` byte-for-byte.
6. Typed-ink fallback line: **done**.

Out of scope respected.

**H2 Guide.**
1. Skill: **done**.
2. `SKILL_IDS`/`SKILL_FALLBACK` registered, pack appended, first key stays `json-canvas`: **done**.
3. Triggers: **done**. Precedence is mermaid → guide → formatting. Mutation-checked: removing the guide branch fails 2 tests.
4. Providers derive the list from `SKILL_IDS`. The two hard-coded lists in `main.ts` were updated by the lead.
5. Paging: the side-by-side table is inside the first passage (test-pinned).

**H3 PDF selection.**
1. Command `add-pdf-selection` and context-menu item: **done**. The menu is gated by `allowedPdf` (`src/main.ts:198`), and the selection must be inside that PDF view.
2. Selection as a distinct kind (`SelectionItem.pdf`) with a chip: **done**.
3. Hidden page image: **done**. It is cached by `(path,size,mtime,page)` with an LRU of 8, counted in `needsImage` and routing attachments, and swapped to text-only for non-vision routes. Re-render goes through `pdfReader`, which re-checks `allowedPdf` (`src/main.ts:1670`).
4. Context text with the misread warning: **done** (`selectionContextBlock`). The trim was fixed by the lead.
5. Failure modes: a Notice is shown and the send is never blocked; spans are capped at 2 pages with a Notice.

All of this is **untested in `main.ts`** (S2).

**H4 Note context and properties.**
1. Context block: **done**. It is capped at 2,500 chars (`NOTE_CONTEXT_LIMIT`), and `noteContextChars` is counted in routing. Backlinks and outgoing links are filtered by `allowed` in `noteGraph`, the counts too (`src/vault-graph.ts:115-118`). The source is the metadata cache only.
2. `propose_properties` hardened, with `rename`: **done**.
3. `propose_outline`: **done**, with heading-link warnings.
4. Wiring: **done**. There is one name list (`OWLA_TOOL_NAMES`, `src/provider.ts:119`), the spec is in `buildToolSpecs`, the dispatcher handles it, and the system-prompt sentence is updated. The registry test lists `propose_outline`, and `provider-isolation` passes.
5. CRLF revert: **done**. Mutation-checked: forcing `eolOf` to `\n` fails 1 test.

**H5 PDF export.** See B1.

## Cross-worker integration (`src/main.ts`, edited by workers 1, 3, 4 and the lead)

- No lost or duplicated edits. Imports are all used (`tsc` and ESLint are clean).
- Each tool is registered once.
- Tool names are consistent across `baseToolSpecs`/`buildToolSpecs`, the dispatcher, `OWLA_TOOL_NAMES` and the system prompt. There are no other hard-coded per-provider lists: `grep -rln propose_properties src tests scripts` finds only `main.ts`, `note-tools.ts`, `provider.ts` and tests.
- Codex gets the specs directly. OpenCode, Claude and Hermes get the prefixed names from `OWLA_TOOL_NAMES`.
- The `read_reference` name list and the prompt line include `owla-obsidian-guide`.
- `query_vault_graph` was refactored onto `graphSource()` with no behaviour change, and its tests pass.
- Because handoff 5 never touched `main.ts`, there is no conflict there, and no wiring either.

## Safety review

- **New write paths.**
  - `propose_properties` and `propose_outline` both go through `markdownSnapshot` (needs a read snapshot; refuses non-`.md`, drawings, canvases and bases), `stageProposal` with `excludedFolders`, and the accept/decline batch.
  - `propose_outline` also applies `assertNoteTitle`.
  - `minimalReplacement` stages a unique line-widened range. That keeps large notes under the proposal cap and needs no exclusion checks of its own.
  - PDF export has no write path because it doesn't exist.
- **New context.** The note block is bounded and excluded-folder safe; the test asserts an excluded backlink is absent. PDF selection images come only from allowed PDFs, re-checked at render time. Excalidraw summaries are bounded.
- **Decline/revert.** The CRLF stage → apply → revert byte-exact test exists and fails under mutation. Excalidraw bulk delete reverts via `revertExcalidraw` (tested).
- **Personal data.** No `/Users/…`, user names, emails or sample-drawing content in the new skills, fixtures, tests or source (grep over the new files). The Excalidraw tests use synthetic scenes.
- **Vault guard.** No bypass found. The inert guard self-test passes.

## Behavioural verification against the evidence

- **Excalidraw failure** (session `…10-46-57`): I decompressed the sample in memory with a local LZ-string decoder in a scratchpad probe; the file was read-only and nothing was copied into the repo.
  - Result: `289 elements (274 freedraw, 2 line, 7 text, 5 arrow, 1 rectangle)`.
  - Summary: 2,385 chars, no base64 run of 200+ chars.
  - Clusters: `c1:272 c2:2`.
  - `[delete_cluster c1, delete_cluster c2]` → 0 live freedraw, so the cleanup takes **2 operations** (target met).
  - The synthetic 300-stroke scene and the `read_note` offset 0/120000/heading/block redirect are covered by `tests/excalidraw-ink.test.ts`, whose redirect test I mutation-checked.
- **Guide trigger** (session `…15-41-01`):
  - These trigger `owla-obsidian-guide`: "Can pictures sit side by side?", "How do I put two images next to each other?", "Können die Bilder nebeneinander stehen?", "Kann ich Bilder nebeneinander anordnen?", "Mach das Dokument professioneller", "Make this look professional", "improve the formatting".
  - "describe the attached image" → null (correct). "Wie sieht das besser aus?" → null (N2).

## Test quality

- New tests are mostly behavioural:
  - `excalidraw-ink` (13; 2 source reads, only for schema presence);
  - `note-outline-properties` (20) and `note-outline-wiring` (8, real dispatcher via `loadMain`);
  - `pdf-export` (16), `pdf-export-run` (7), `pdf-selection` (15), `pdf-selection-trim` (1);
  - `knowledge` (+ triggers).
- Mutation spot-checks. Each mutation was applied once, run, and restored exactly (`cmp` OK):

| Mutation | Result |
|---|---|
| `read_note` drawing redirect disabled | 1 test fails ✓ |
| Guide branch removed from `taskReference` | 2 fail ✓ |
| `eolOf` forced to `\n` (outline CRLF) | 1 fails ✓ |
| Fence check removed from `insertPageBreaks` | 1 fails ✓ |
| PDF image sent to text-only models + `allowedPdf` removed from `addPdfSelection` | **0 fail** ✗ (S2) |

- Gap: the `pdf-export*.ts` tests pass but test code that isn't shipped (B1).

## Not verified

- Live Obsidian behaviour of every feature: PDF context menu and command palette, chip, page image reaching a vision model, encrypted-PDF Notice, accept/decline modal rendering of outline moves, real js-yaml round-trips, Excalidraw rendering limit in the plugin.
- Real PDF export (route A or B), the page-break div surviving Obsidian's print renderer, and the accuracy of the pagination heuristic.
- Real models choosing `propose_outline`, `delete_cluster` or the guide.
- Hermes and Claude live sessions. Exposure is checked by the registry and isolation tests only.

## Trivial fixes applied

None. Every finding above is left for the lead to route back.

## Addendum — resolution (lead, 2026-11-23)

- **B1 resolved:**
  - `export_pdf` (estimate plus a chat card, then a confirmation dialog; route B with fallback to route A; read-back findings sent with the next message; at most 2 fix rounds) and `propose_page_breaks` (diff-reviewed markers only) are wired in `src/main.ts`, `OWLA_TOOL_NAMES`, the system prompt and the `owla-pdf` skill.
  - Tests: `tests/pdf-export-wiring.test.ts`. Verified live in Agentbrain (`TESTING.md`, 3.8.0).
- **S1 resolved:** `isExcalidrawText` now requires the drawing's own frontmatter key, a JSON scene or a `## Drawing` fence. Regression test in `excalidraw-ink.test.ts`.
- **S2 resolved:** the per-attempt image choice moved to the pure `pdfSelectionAttempt`. The view methods are tested in `pdf-export-wiring.test.ts`, and the earlier surviving mutations now fail 2 tests.
- **S3 resolved:** clusters larger than 240×120 px are split into position tiles, giving 13 located clusters on the evidence drawing. `delete_cluster {cluster:"all"}` keeps a full clean-up to one operation.
- **N3 and N5 resolved:**
  - N3: real-YAML property edits were verified live.
  - N5: the `owla-pdf` skill text was rewritten.
- **Also fixed:** an outline move dropped the blank line before the next heading (found live).
- **N1, N2 and N4 remain** (minor and documented).
