# Handoff 3 — Add highlighted PDF text to OWLA, with the page screenshot as hidden context

Proposal item: "make it possible to add selection to OWLA from highlighted pdf text. OWLA gets the text and whole page attached as a screenshot in the background as context, in case text has been badly read by on-board OCR."

## Current state (read first)
- `src/main.ts` ~L169–200: context menus. Editor selection → "Add selection to OWLA Butler"; PDF viewer already has a page context menu ("Add page to OWLA", uses `pdfPageReference`) and reads `window.getSelection()` at ~L196. Study exactly what it does today.
- `Draft.selections:{path;text}[]` and `ButlerView.selections` carry text selections; `selected` text is appended as `SELECTED TEXT from …` in the turn context (~L2385).
- PDF page rendering/screenshot code: `src/pdf.ts` (`PdfDocumentCache`, `PdfPage`, render tasks), `src/attachments.ts`, `src/ocr.ts`, `src/visual.ts`. Reuse the existing page-to-image path used by "Add page to OWLA"; do not write a second renderer.

## Required work
1. **Command + menu.** When text is highlighted inside an Obsidian PDF viewer, offer "Add selection to OWLA" (right-click menu in the PDF view, plus a command-palette command that works when a PDF leaf is active and has a selection). Must respect `allowedPdf(path)` / excluded folders exactly like the existing page action.
2. **Selection attachment.** Add a PDF selection to the draft as a distinct kind (extend `selections` with an optional `pdf:{page:number}` or a new array — pick the least invasive). Show it in the draft UI as a chip labelled e.g. `Name.pdf · p. 4 · "first words…"`, removable like other attachments.
3. **Hidden page screenshot.** At send time, render the selection's page to an image (same scale/limits as existing page attachments) and attach it as background context for vision-capable models only; non-vision routes just get text. It must NOT appear as a separate visible chip clutter (a small "page image attached" note on the chip is fine). Cache by `(path,page,mtime)` so repeated sends do not re-render. Respect the privacy/routing rules that apply to image attachments (check how `needsImage`, `attachmentSizeBucket` and routing treat images and make the screenshot count toward them honestly).
4. **Context text.** Build the turn context as: source citation via existing `pdfSource`/`pdfPageReference`, the selected text verbatim, and one instruction line: the selected text comes from the PDF text layer and may be misread; compare with the attached page image and prefer the image when they disagree. Keep selections capped (`selectionsTrimmed` accounting exists — keep it working).
5. **Failure modes.** Encrypted/password PDF, huge page, selection spanning pages (attach each page up to a small cap, say 2, and say so), render failure (fall back to text only with a Notice, never block the send).

## Tests
Pure logic into `src/pdf.ts` or a new `src/pdf-selection.ts` so it is unit-testable (chip label, context string, page-cap, cache key). Add `tests/pdf-selection.test.ts`. Extend `tests/audit-win-pdf-wiring.test.ts` style wiring tests if the repo asserts wiring by source regexes.

## Out of scope
OCR engine changes, PDF export (handoff 5), annotate-PDF tool.

## Report
The Hermes worker stopped mid-task without filling this in. Filled by the lead after review (2026-11-23).

**Landed (worker):** `src/pdf-selection.ts` (chip label, context block, span note, render-page cap of 2 per selection, `(path,size,mtime,page)` cache key, text-only swap); `SelectionItem` with optional `pdf:{page,pages}` threaded through `src/core.ts` (sent cards), `src/routing.ts` (trim keeps the marker) and `src/main.ts` (command `add-pdf-selection`, PDF context-menu item, chip, `renderPdfSelectionImages` reusing `withPdfDocument`/`renderPdfImage`, LRU of 8, images counted in routing attachments and `needsImage`, dropped with a text-only note when no vision model exists, per-attempt text-only context for non-vision routes, Notice on render failure, never blocks send).

**Lead fixes:**
- **Bug fixed:** `trimSelectionsForWindow` (`src/main.ts`) rebuilt the old `SELECTED TEXT from <path>` shape, which never matches a PDF selection block, so any PDF selection silently disabled the context-window trim. It now splices with `selectionContextBlock`. Regression test `tests/pdf-selection-trim.test.ts` (mutation-checked).
- The context menu offered "Add selection to OWLA" for text highlighted anywhere in the window and cited it to the right-clicked PDF; now only when the selection is inside that PDF view.
- `tests/pdf-selection.test.ts` did not typecheck (wrong `item()` call shapes) and two tests failed (unescaped `[`/`.` in `new RegExp`). Fixed call shapes and replaced the regexes with exact prefix checks. 15/15 pass.

**Not verified:** live behaviour in Obsidian (menu, command palette, chip, rendered page image reaching a vision model, encrypted PDF Notice).
**Known limit:** if the trim drops a PDF selection entirely, its page image is still attached for that turn.
