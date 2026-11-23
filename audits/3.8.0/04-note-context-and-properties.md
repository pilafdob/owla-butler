# Handoff 4 (wave 2) — Richer note context; edit outline and properties through the diff system

Start only after handoffs 1 and 3 have written their reports (they also edit `src/main.ts`). Run `git status` first and read their reports.

Proposal items:
- "give OWLA more context on current note like links going to and from the note, outline of the note and file properties (YAML)."
- "also the ability to edit outlines and file properties should be shipped in this new update, and also be part of the diff/decline system."

## Current state (read first)
- `activeNoteContext(path,text)` in `src/main.ts` (~L849–853): sends up to 20k chars of the active note, else headings outline via `headingOutline` (`src/note-tools.ts`).
- `src/note-tools.ts`: `frontmatterBlock`, `updateProperties(text,set,remove,yaml)`, `linkTargets`, `noteHeadings`, `findSection`, `headingOutline`.
- `src/vault-graph.ts`: `noteGraph(source,path)` (links/backlinks) and the `query_vault_graph` tool (`src/main.ts` ~L1663).
- Edits go through `propose_edit`/`propose_note` with snapshots, pending-edit batches and the accept/decline diff UI. Note: is there already a property-edit tool? grep `updateProperties` usage in `src/main.ts` before designing; extend rather than duplicate.

## Required work
1. **Context block.** Add to the active-note context (compact, capped, excluded-folder safe): file properties as parsed YAML (keys/values, long values truncated), outline (headings with levels, always included, not only when the note is long), outgoing links (resolved paths, plus unresolved ones flagged), backlinks (paths only, cap ~30 with "… N more"). Source data from `noteGraph`/metadataCache; no extra disk scans per keystroke — compute at send time. Make sure total added context is bounded (~2–3k chars) and counted in `contextChars` stats.
2. **Edit properties.** Ensure the model can set/remove/rename properties with a dedicated tool (e.g. `propose_properties {path,set,remove,reason}`) that stages a normal diff of just the frontmatter block, validates YAML (reject invalid, keep types: lists, dates, checkboxes), preserves key order and comments where possible, and shows in the existing accept/decline UI. If a tool already exists, harden it to the same bar instead.
3. **Edit outline.** Tool for structural outline edits: rename heading, change heading level (promote/demote with children), move a section up/down or under another heading, insert a heading. Implement as pure functions in `src/note-tools.ts` over `noteHeadings` (reuse `findSection`), producing new note text; stage via the same diff path. Warn on broken links to renamed headings using existing `brokenLinks`/`linkWarning` (heading renames can break `[[note#Heading]]` links — surface it in the proposal result).
4. **Wire the tools** in `baseToolSpecs`, the dispatcher, the provider tool lists (check OpenCode/Codex/Claude/Hermes registration so the new tools are exposed everywhere the other propose tools are; `tests/provider-isolation.test.ts` must still pass), and the system-prompt line that lists tools.
5. Revert/decline must restore the exact prior text (CRLF-safe — see `tests/audit-win-tools-crlf.test.ts`).

## Tests
Pure-function tests for outline ops (promote/demote, move, rename, nested, duplicate titles, code-fence headings, CRLF) and property ops; wiring tests following existing `audit-win-tools-wiring.test.ts`; context-size bound test.

## Out of scope
Canvas/base/excalidraw tools, PDF.

## Report
Worker: Claude (Opus 5.5), 2026-11-23. Started the pure-function work while handoffs 1 and 3 were still running; touched `src/main.ts` only after both reports were filled in. Nothing committed.

### Files changed
- `src/note-tools.ts`:
  - `updateProperties` hardened. It now edits block-style frontmatter line by line, so untouched entries, comments, key order and raw values (dates, quoting) stay byte for byte. It also accepts a new `rename` argument.
  - Values are validated: finite numbers, text up to 10k characters, nesting up to 4 levels, no functions.
  - Existing types are kept: a checkbox, number or list sent as text stays that type, and the change is reported in `notes`.
  - Date text is written unquoted.
  - The edited block is parsed back and compared with the intended properties (same keys, same order). On any mismatch, or for flow-style YAML, it falls back to the old full re-serialization (`preserved:false`). Invalid YAML is refused with the parser message.
  - New functions: `matchHeadings`, `resolveHeading` (nested `Parent#Child`, an exact title containing `#`, 1-based `occurrence` for duplicates), `editOutline` (rename / level / move up·down·before·after·under / insert), `lostHeadings`, `headingLinkBreaks`, `headingLinkWarning`, `noteContextBlock` and `NOTE_CONTEXT_LIMIT` (2,500 characters).
- `src/main.ts`:
  - `graphSource()` factored out of `query_vault_graph` and reused.
  - `noteContext(path,text)` builds the context block. Properties are parsed from the captured text, so unsaved edits count. Links come from `noteGraph` (cache only, no disk reads), inside `withPathCheckCache`.
  - The block is sent before the active note text, and its length goes to routing as `noteContextChars`.
  - `propose_properties` spec and dispatcher gain `rename`. The result reports kept types and the fallback.
  - New `propose_outline` spec and dispatcher. Same snapshot and plain-Markdown guards as `propose_properties` (shared `markdownSnapshot`). It goes through `stageProposal`, applies the `assertNoteTitle` guard like `propose_edit`, reports cancel-outs and stacks on the staged preview.
  - `headingLinkCheck` reports `[[#H]]` self-links and inbound `[[note#H]]` links from allowed notes, via `resolvedLinks` and the file cache, capped at 500 sources.
  - `minimalReplacement` stages only the changed lines, widened until unique. This also fixes a bug: adding properties to a note with no frontmatter used to stage the whole note and failed above the 24k proposal cap.
  - System prompt sentence updated.
- `src/routing.ts`: optional `noteContextChars` input, added to the active-note figure in `estimateContextTokens`.
- `src/provider.ts`: `propose_outline` added to `OWLA_TOOL_NAMES`, so OpenCode, Claude and Hermes get the prefixed names. Tools are offered to every provider from `buildToolSpecs`; there is no other per-provider list.
- Tests:
  - New `tests/note-outline-properties.test.ts` (20 tests): properties, outline (promote/demote, move, rename, nested, duplicates, code fences, CRLF), and the context bound.
  - New `tests/note-outline-wiring.test.ts` (8 tests): schemas and provider names, CRLF stage → apply → revert byte-exact, stacking and cancel-out, refusals, rename through the dispatcher with comments kept, a note larger than the cap, a bounded context block that leaves out excluded folders, and the top-title guard.
  - New `tests/helpers/mini-yaml.ts` (a block-YAML test stand-in).
  - `propose_outline` added to the list in `tests/audit-providers-registry.test.ts`.

### Verification (real results, 2026-11-23 ~18:10)
- `npm run check`: exit 0, no diagnostics.
- `npm run lint`: 0 errors, 10 warnings (8 in `src/main.ts` UI strings / `instanceof`, 2 in handoff 5's `src/pdf-export-run.ts`). None are in code added here.
- `npm test`: 873 tests, 867 pass, 0 fail, 6 skipped. Includes `provider-isolation`, `audit-win-tools-crlf`, `note-tools` and `audit-win-main`.
- `npm run build`: NOT run. Handoff 5 is still active (`src/pdf-export*.ts` appeared during this work), so I am not the last worker.

### Not verified
- Live Obsidian: real `parseYaml`/`stringifyYaml`. Tests use a stand-in. The parse-back check means an unexpected real-YAML result falls back to full re-serialization rather than corrupting anything, but whether the line edit takes effect with real js-yaml (dates parsed as `Date`, quoting) is unverified.
- The rendered diff of an outline move in the accept/decline modal.
- Real models choosing `propose_outline`.
- Heading-link warnings use `textHasSubpath` (last part of a nested link). A link to a duplicate heading title that still exists elsewhere in the note is not reported.

### Open questions for the lead
- `move under` makes the section the target's **last** subsection. Should it be the first?
- The context block is sent even for short notes, where the outline repeats headings already in the text (about 2.5k characters at most), because the handoff asked for it always. Drop the outline for short notes?
