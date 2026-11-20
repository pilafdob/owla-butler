# Review request: PDF "Copy link to page" uses name,p.page citation format

**Author:** Hermes (coding agent)
**Branch:** `3.7.0-RC`
**Scope:** behavior change — the PDF viewer context menu's "Copy link to page" copies plain citation text (`Kernbereiche Biologie 6,p.15`) instead of an Obsidian wikilink.
**Status:** implemented, PDF tests green, staged (not committed). Full-repo gates have pre-existing failures from another agent's WIP — evidence below.

## What to review

Only these three files are mine. The shared working tree also has another agent's
unstaged OCR work in `src/main.ts` / `src/ocr.ts` and their staged issue-form files
(`.github/ISSUE_TEMPLATE/*`, `CONTRIBUTING.md`) — **do not touch them.** The staged
table-feature hunks in `src/main.ts` belong to `REVIEW-tables-to-chat.md`.

- `src/pdf.ts` — new pure helper `pdfPageReference()` (+2 lines)
- `src/main.ts` — two one-line changes: import + context-menu link (only these two hunks staged)
- `tests/pdf.test.ts` — 1 new test, 4 assertions

## Intent

User request (with screenshots of the School vault PDF viewer): links copied from
PDFs via OWLA should use the custom format `{PDF_NAME}{,p.PDF_PAGE}`, example
`Kernbereiche Biologie 6,p.15` — for citing textbook pages in study notes.

Before: `[[School/Bio/Kernbereiche Biologie 6.pdf#page=15]]` (full vault path wikilink).
After: `Kernbereiche Biologie 6,p.15` (plain text; file name without folders or
extension, then `,p.` and the page number — **no spaces**, per the user's literal example).

## Change-by-change

### 1. `pdfPageReference(path, page)` in `src/pdf.ts`

Inserted directly after `pdfSource` (line 12):

```ts
/** Clipboard citation for a PDF page: file name without folders or extension, then ',p.' and the page number. */
export function pdfPageReference(path:string,page:number):string{const name=(path.split('/').pop()||path).replace(/\.pdf$/i,'').replace(/\p{Cc}/gu,' ');return name+',p.'+page;}
```

Rules:
- Basename only (`split('/').pop()`), `.pdf` stripped case-insensitively.
- Control characters replaced with spaces — same sanitization as `pdfSource`.
- Page number appended verbatim; the caller already validates `Number.isInteger(number) && number >= 1`.

Reviewer focus:
- Deliberately **not** reusing `pdfSource` — that produces the spaced chat-citation
  format `name, p. N`. Two citation formats now coexist (chat labels vs clipboard).
  Confirm that's acceptable, or whether both should converge on one format.
- A file literally named `.pdf` yields an empty name (`,p.15`). No special case —
  confirm that's fine (such files are effectively unnameable anyway).
- PDF names containing commas (`Bio, Chapter 3.pdf` → `Bio, Chapter 3,p.15`) make
  the format ambiguous to parse back. Matches the user's spec; flag if a consumer
  needs to round-trip it.

### 2. Wiring in `src/main.ts`

Import (line 26): `pdfPageReference` added to the existing `./pdf` import list.

Context-menu handler (line 188), inside the `window` `contextmenu` registration:

```diff
-   const menu=new Menu().setUseNativeMenu(false),link='[['+path+'#page='+number+']]';
+   const menu=new Menu().setUseNativeMenu(false),link=pdfPageReference(path,number);
```

Reviewer focus:
- The copied text is now **plain text, not a clickable wikilink** — pasting into a
  note no longer creates a link to the PDF. This follows the user's literal format;
  confirm it's the intended trade-off (alternative: `[name,p.N](path#page=N)`
  markdown link would keep clickability with the same display text).
- "Add page to OWLA" is unchanged — still attaches `path+'#page='+number`.
- This is the **only** PDF copy-link path: `clipboard.writeText` occurs exactly
  twice in `src/` — this menu item and the chat message-copy button (line ~1186,
  copies message text, unrelated). Chat source chips open the PDF on click; they
  have no copy action.
- No settings toggle was added; the format is hard-coded per the request.

### 3. Test in `tests/pdf.test.ts`

```ts
test('copied PDF page links use the name,p.page format without folders or extension',()=>{assert.equal(pdfPageReference('Kernbereiche Biologie 6.pdf',15),'Kernbereiche Biologie 6,p.15');assert.equal(pdfPageReference('School/Bio/Kernbereiche Biologie 6.pdf',15),'Kernbereiche Biologie 6,p.15');assert.equal(pdfPageReference('Study.PDF',3),'Study,p.3');assert.equal(pdfPageReference('a\nb.pdf',2),'a b,p.2');});
```

Covers the user's exact example, nested folders, uppercase extension, control chars.

## Verification performed

- `npm run lint` — clean.
- `node --import tsx --test tests/pdf.test.ts` — **6/6 pass** (1 new test).
- `npm run build` — bundles clean; `pdfPageReference` present in `main.js` and
  referenced by the menu handler (perl-mined the bundle).
- `npm run check` — **fails, but not on my files**: 7 × TS2559, all in untracked
  `tests/audit-stream-claude.test.ts` (another agent's new file). `tsc --noEmit`
  output filtered of that file is empty.
- `npm test` — **430 tests, 420 pass, 10 fail**; every failure in
  `tests/hermes.test.ts`, `tests/codex.test.ts`, `tests/cli.test.ts`,
  `tests/audit-failure-codex.test.ts`, `tests/audit-stream-claude.test.ts` —
  all files the other agent is modifying/adding.
- **Pre-existence proof:** copied the repo to scratch, reverted exactly my three
  edits (verified zero `pdfPageReference` occurrences remained), re-ran the five
  failing files: 106 tests, 8 fail baseline vs 7 fail with my change (flaky
  bridge tests — one Hermes MCP test flips between runs). Failure set with my
  change ⊆ failure set without it; **no failure is introduced by this change.**

## Not verified / gaps for the reviewer

- **No live Obsidian run.** The right-click → "Copy link to page" flow has not been
  exercised inside a running vault with the new build. The handler closure is
  registered at `onload`, so it can't be monkey-patched via `obsidian eval` without
  a reload — a real install/reload is needed (check for in-progress chats and
  pending approvals first, per the School-install procedure).
- Clipboard behavior on the user's OS (macOS) is assumed standard
  `navigator.clipboard.writeText`; unchanged mechanism, only the payload differs.
- Whether the user wants the spaced chat format (`name, p. N`) and the clipboard
  format (`name,p.N`) to stay different is unconfirmed — implemented literally as
  requested.

## Suggested next steps

1. Install the build in School (or a test vault), right-click a PDF page, copy,
   paste into a note — expect `Kernbereiche Biologie 6,p.15`.
2. Decide plain text vs markdown-link variant if clickability is missed.
3. Re-run the full gates once the other agent's Hermes/Codex/audit WIP settles;
   this change itself is gate-clean.