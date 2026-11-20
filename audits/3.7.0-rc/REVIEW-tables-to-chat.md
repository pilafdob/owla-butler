# Review request: tables selectable & addable to chat

**Author:** Hermes (coding agent)
**Branch:** `3.7.0-RC`
**Scope:** new feature — Obsidian Markdown tables can be selected and added to the OWLA chat.
**Status:** implemented, gates green, staged (not committed).

## What to review

Only these three files are mine. The shared working tree also has another agent's
staged files (`.github/ISSUE_TEMPLATE/*`, `CONTRIBUTING.md`) — **do not touch them.**

- `src/note-tools.ts` — new pure helper `tableAt()`
- `src/main.ts` — wiring: two commands, editor-menu item, new `table()` method
- `tests/note-tools.test.ts` — 3 new unit tests

## Intent

The existing "Add selection to chat" only works when the editor has a text
selection. Tables in Obsidian are awkward to select as raw text (Live Preview
renders them as HTML widgets). This adds a way to grab the whole table under the
cursor — as raw Markdown — and attach it to the chat, plus a command to select
the table as a normal editor selection.

## Change-by-change

### 1. `tableAt(text, line)` in `src/note-tools.ts`

Pure function: given note text and a 0-based line number, returns
`{start, end, text}` (raw table source) or `null`.

Rules it enforces:
- A table is a run of **contiguous lines starting with `|`** (after optional
  indentation) that **includes a delimiter row** (`| --- | --- |`, `|:---:|`,
  `---:` alignments).
- **Fenced code blocks are skipped** — a line inside ``` / ~~~ fences is never
  treated as a table, even if it looks like one.
- Returns `null` when the line isn't inside a table.

Reviewer focus:
- Delimiter regex `TABLE_DELIMITER` — confirm it matches real Obsidian tables
  (aligned colons, optional outer pipes) and does **not** match ordinary rows.
- Fence tracking mirrors the existing `noteHeadings` fence logic — check for
  divergence (unclosed fences, `~~~`, nested indentation).
- Boundary walk stops at fence lines, so a table adjacent to a code fence is
  not over-extended.

### 2. Wiring in `src/main.ts`

- Command `select-table` ("Select table") — `editorCheckCallback`; on invoke,
  selects the whole table via `editor.setSelection(...)`. Returns silently if
  the cursor isn't in a table.
- Command `add-table` ("Add table to chat") — `editorCallback` → `this.table(...)`.
- `editor-menu` handler — when there is **no** text selection but the cursor is
  inside a table, adds "Add table to OWLA Butler" (icon `table`).
- New `Butler.table(editor, file)` — mirrors the existing `selection()` method;
  pushes the raw table into `v.selections`, clipped to 3000 chars.

Reviewer focus:
- The chip/card label reuses the generic "Selection · path" wording. Is a
  dedicated "Table · path" label wanted? (Currently intentionally minimal —
  reuses the existing selection pipeline end-to-end.)
- `select-table` uses `editorCheckCallback` returning `true` in checking mode,
  so it is always listed in the editor. Acceptable, or should it be hidden
  when not in a table?
- Confirm the editor-menu branch doesn't regress the existing selection item.

### 3. Tests in `tests/note-tools.test.ts`

- `tableAt` returns the full raw table from any row; `null` outside it.
- Fenced code that looks like a table is skipped.
- Pipe-only lines without a delimiter row are not a table.

## Verification performed

- `npm run check` — clean
- `npm run lint` — clean
- `npm test` — **342 pass** (3 new)
- `npm run build` — bundles clean
- New tests also run individually via `node --import tsx --test tests/note-tools.test.ts`

## Not verified / gaps for the reviewer

- **No live Obsidian run.** The helper and wiring are unit-tested, but the
  editor-menu item and both commands have not been exercised inside a running
  vault. In particular, confirm `editor.getCursor().line` lands on a table row
  when right-clicking a rendered table in Live Preview (the cursor may not
  move into the table on right-click in all Obsidian versions).
- **Selection label** — table attachments currently appear as "Selection";
  decide whether a distinct label is worth the type change to the selections
  array / Draft / sentCards.
- **Large tables** — clipped at 3000 chars like other selections; no special
  handling. Confirm that's the desired behavior for wide/long tables.

## Suggested next steps

1. Install the build in a test vault; right-click inside a table and run both
   commands; verify the chip appears and the raw Markdown reaches the model.
2. Decide on the "Table" vs "Selection" label.
3. If live behavior is good, this is ready to fold into the next release.