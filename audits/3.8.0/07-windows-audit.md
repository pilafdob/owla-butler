# 3.8.0 — Windows performance, security and data-loss audit (2026-11-25)

Scope: `main` at `47e233f` after `git pull` (3.8.0 work: PDF export, Siri AI,
route picker, note properties/outline, Excalidraw), run on Windows 11 as a
non-root user so the platform-gated tests execute. No live Obsidian, provider
or model turn was used; nothing below is a live-app verification.

## Baseline gates (before fixes)

| Gate | Result |
|---|---|
| `npm run check` | pass |
| `npm run lint` | 0 errors, 7 warnings |
| `npm test` | **911 tests, 908 pass, 2 fail**, 1 skip |
| `guard:test`, `build`, `check:release` | pass |

## Findings and fixes

| # | Area | Finding | Fix and regression |
|---|---|---|---|
| W1 | Gates | `siriSocketPath` used the host `path.join`, so on Windows it produced `\var\…` and `tests/siri.test.ts` failed. CI runs only on Ubuntu, so no Windows-gated test runs before merge. | `posix.join` (the path is always a macOS socket path). CI gains a `platform-tests` job on `windows-latest` and `macos-latest`; the existing `check` job is unchanged. |
| W2 | Data loss | `exportPdf` used the output path chosen when the card was confirmed. A file created there afterwards (another export, sync) would be overwritten by Obsidian's exporter and then removed by a fix round. | `exportPdf` refuses when the path is taken (index, adapter, or a case-variant on NTFS via `existsSync`). Regression in `tests/pdf-export-wiring.test.ts`: RED before, GREEN after. |
| W3 | Data integrity (Windows) | The organization journal and pending-edit journal replaced their files with a bare `renameSync`. A transient Defender/OneDrive/indexer lock (EBUSY/EPERM/EACCES) between two moves aborted the whole organization batch and rolled it back. Saved chats and routing history already retried. | Shared `src/fs-retry.ts` `retryLocked` (two bounded 25 ms spins, no `Atomics.wait`), used by chats, the organization journal and the pending-edit journal. Read-only-attribute fallback kept. `tests/audit-win-journal-locks.test.ts`: 6 of 7 RED before, all GREEN after. |
| W4 | Data loss (Windows) | `allowedPath` refused `:`, trailing dots and spaces, but not Win32 device names. `NUL.md` or `Notes/CON.pdf` opens the device on Windows 10, so a write vanishes. | Device names (`CON`, `PRN`, `AUX`, `NUL`, `COM0-9`, `LPT0-9`, `CONIN$`, `CONOUT$`, with any extension, in any segment) are refused on win32 only. Regression in `tests/audit-win-tools-paths.test.ts`. |
| W5 | Quality (popouts) | Three `instanceof Element/HTMLElement` checks fail for nodes of a popout window (separate realm): reveal-line highlight, the reply checkbox guard, and PDF-selection page lookup. | `elementOf()` uses `nodeType`. Lint drops from 7 to 4 warnings (the remaining 4 are sentence-case strings that predate this audit). |

## Reviewed, no change

- Performance: streaming text is batched at 50 ms with one rAF scroll. The vault-wide `getFiles()` scan in `resolvedVaultFile` runs only on an index miss that the filesystem resolves as a case alias. Picker items are cached per modal.
- Siri AI: gated to `darwin`. Its socket and `fm serve` are cleaned up on disconnect.
- PDF export path checks: `..`, `.`, backslash, colon (NTFS ADS) and excluded/hidden folders are refused.

## Follow-up pass: open items and live check (same day)

| # | Area | Finding | Fix and evidence |
|---|---|---|---|
| W6 | Data hygiene | A crash or quit during an export left a `… (OWLA PDF export).md` copy in the vault. | `src/export-copies.ts`: the copy's path and SHA-256 are recorded in private vault storage before it is created and after each fix round. The next load deletes only recorded copies whose text is unchanged. Copies that were edited or never recorded are kept; nothing is deleted by name pattern. A failed delete is retried on the next load. Unit and wiring tests, plus the live reload check in TESTING.md. |
| W7 | Quality (popouts) | Live, in a popout window: "Add PDF selection to OWLA" was unavailable and the OWLA PDF context menu never appeared. `pdfSelectionTarget` read only the main `window.getSelection()`, and the context-menu listener was registered only on the main window. | Each PDF leaf reads its own window's selection. The context-menu handler is registered on the main window and on every `window-open` popout. Live before/after in TESTING.md, plus a wiring test (RED before, GREEN after). |
| W8 | Pipeline (Windows) | `scripts/package.mjs` shelled out to a `zip` binary that Windows lacks, so the manual-install ZIP could not be built there. Its checksum files used `output.split('/')`, which would have written the whole Windows path. Its private-data guard caught only macOS `/Users/…` home paths. | ZIP built with `fflate` (already a dependency), with a fixed timestamp so it is reproducible. Checksum files use `basename`. The guard also catches `C:\Users\…`. Verified on Windows: 44 files, the same hash twice, Windows' ZIP reader opens it. |
| W9 | Gates (flaky test) | `tests/audit-win-providers-lifecycle.test.ts` failed in 3 of 25 full Windows runs with `EPERM` on temp-folder cleanup. The bridge's `taskkill /T` runs detached, so under load the fake server (a cmd.exe grandchild) holds the folder for seconds after `closing` resolves. No process was orphaned: none was left in 6 checked isolated runs. | The test waits for the folder, bounded at about 10 s, and leaves a still-held temp folder to the OS instead of failing. Then 10 of 10 consecutive full runs were green. |
| W10 | Gates (flaky test) | The ComSpec shim flake (`echo.cmd exited with code 1`, empty stderr) appeared 1 time in 25 full runs and never in isolation. | Not masked. The test now names the failing step and the `ComSpec`/`SystemRoot` values, so the new Windows CI job can diagnose it if it recurs. |

## Final gates

`check` pass · `lint` 0 errors / 4 warnings · `npm test` **925 tests, 924 pass, 0 fail, 1 designed skip**, 10 consecutive green full runs · `guard:test`, `build`, `check:release`, `node scripts/package.mjs` pass. The live results are in TESTING.md under "3.8.0 — Windows audit and live check".
