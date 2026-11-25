# OWLA Butler verification

## 3.8.0 — release check on `main` (2026-11-25, macOS and Windows)

Not tagged: the Windows checks listed under "Still required" below are missing, and Siri AI does not connect on macOS (see "Found").

- **Tree:** `main` at `35875f2` (PR #20; contains `a559c3a`, the Codex `web.run` fix). `origin/main` then moved to `42b5d07` (PR #22). That commit changes only `site/`, `.github/pages-preview/`, `.github/workflows/pages.yml` and `scripts/site-assets.mjs`: no plugin source, build input or version file.
- **macOS gates** (macOS 27.3, Node 24.15.0, normal user, not root): `npm ci`, `npm run check`, `npm run lint` (0 errors, 4 sentence-case warnings, the same as before), `npm test` (**927 tests / 921 pass / 0 fail / 6 skipped**; every skip is Windows- or NTFS-only, and the case-insensitive tests ran, e.g. the case-alias unsaved read and the `read_note` 2 MB cap via a case alias), `npm run guard:test`, `npm run build` (`main.js` 1,105,391 bytes, SHA-256 `3f658a67…7c82f`) and `RELEASE_TAG=3.8.0 npm run check:release` pass.
- **macOS live setup:** Obsidian 1.15.1. A new disposable vault, `OWLA-Release-Test-3.8.0`, outside iCloud, with invented notes only, was opened through Obsidian's own vault-open call. No owner vault was used. The three built files were installed together. The running plugin reports 3.8.0 and the console showed no errors after all checks. The driver was `obsidian eval` against the real `ButlerView.send`, `decideEdit`, `stop` and `exportPdf`, plus the `undo-latest-edit` command.
- **Codex 0.169.0, `gpt-6.2-sol` (low), web search ON for every turn:**
  - Open note: the budget total (€1,950) and the open question were correct (8 s).
  - Web search: it searched the web (shown in Sources & activity) and cited the Obsidian changelog for 1.15.1. No `web.run` error, so the `a559c3a` fix holds on macOS (15 s).
  - Attached PNG: the shape and colours were described correctly (8 s).
  - Vault search: the order code and the ingredient from two other notes, each with a note citation (11 s).
  - Staged edit, Diff view "None" (the fresh-vault default): one line changed, with an Accept/Decline card. Accept kept only that line changed. **Undo** restored the note byte for byte (same SHA-1).
  - Staged edit, Diff view "Highlights in editor": the removed and added highlights marked exactly the changed line. **Decline** cleared the highlights and left the note byte-identical.
  - Stop during a turn: stopped in 0.8 s, "Draft restored · Stopped.", and no OWLA-owned Codex process was left. The next turn reconnected and answered correctly (10 s).
- **Claude Code** (`opus`, medium): connected, and a `read_note` tool turn answered correctly (5 s).
- **Settings:** all seven tabs render with their settings and no console errors: General (11 items), Codex, Claude, OpenCode, Hermes (4 each), Siri AI and Automatic (1 each).
- **PDF export copy (final code):** `Harbour Mural.pdf` saved in 2.7 s (1 page, PDF 1.4). The temporary copy was removed, the note was unchanged, and the command palette still opens, so `Modal.prototype.open` was restored. Exporting to the case variant `harbour mural.PDF` is refused.
- **Found — Siri AI does not connect on macOS:** with Siri AI turned on, Connect fails with "Siri AI: Private Cloud Compute is unavailable: Private Cloud Compute is not available in this context. Please use the Terminal app." `/usr/bin/fm quota-usage --model pcc` run from a non-Terminal shell gives the same refusal. On this Mac, Apple's `fm` serves Private Cloud Compute only to processes started from Terminal. Since 3.8.0 made Siri AI Private-Cloud-Compute-only, Siri AI cannot connect from Obsidian here. OWLA shows the cause clearly, and nothing crashes. The owner needs to decide on this before release.
- **Windows evidence (reported by the Windows session, 2026-11-25, Windows 11, non-root, Obsidian 1.15.1):** on the PR #20 tip `a559c3a`, whose tree matches `main` `35875f2`: `npm test` 926 pass, 1 skipped, plus `check`, `lint`, `build` and `check:release`. CI `platform-tests` (windows-latest, macos-latest) and `check` passed on `35875f2`. Live in a disposable vault with Codex `gpt-6.2-sol`, web search off: chat about the open note, an attached image, vault search with cited notes, a staged edit shown as editor highlights with Accept and with Decline (Decline restored the note), the General and Codex settings tabs, and Connect Codex. A separate session reproduced the `web.run` bug and confirmed the fix live with `codex-cli 0.171.0` on Windows 11.
- **Still required on Windows before tagging** (from "Windows release checks still required" and the release-preparation entry above; not covered by the evidence above):
  - Codex cancellation and reconnect.
  - Claude Code connect, tool turn, cancellation and reconnect, including multi-line instructions through a real npm `claude.cmd` shim.
  - OpenCode connect, tool turn, cancellation and reconnect.
  - Hermes connect, tool turn, cancellation and reconnect, and confirming that Hermes uses its private home.
  - Undo of an accepted edit.
  - Detached-view cleanup, and raw drawing/Canvas/Base safety in the running app.
  - PDF continuation reuse, external modification, Stop/new chat/close, and password/failure paths in the running app.
- **Not verified on macOS here:** OpenCode and Hermes turns, Automatic selection, layouts at 240/280/360/600 px, and a screenshot of the editor highlights. The highlights were checked through the DOM, because the background window did not repaint for `dev:screenshot`.

## 3.8.0 — release preparation (2026-11-25, Linux cloud container, root)

This run is **not release verification**: it ran on Linux as root, without Obsidian, providers or a vault. It only shows that the release tree passes the CI gates against the test stubs.

- **Changes on the release tree:** version 3.8.0 in `manifest.json`, `package.json`, `package-lock.json` and `versions.json`; `obsidian` type package pinned to `1.14.4` (the lockfile already resolved it); one system-prompt sentence about `propose_page_breaks` corrected, with a regression test that fails on the old text; documentation.
- **Gates:** `npm ci`, `npm run check`, `npm run lint` (0 errors, 4 sentence-case warnings), `npm test` (**926 tests / 915 pass / 0 fail / 11 skipped**: the Windows- and macOS-gated tests and the unreadable-journal test, which root cannot exercise), `npm run guard:test`, `npm run build` (`main.js` 1,105,347 bytes), `RELEASE_TAG=3.8.0 npm run check:release`, `node scripts/package.mjs` (44 files, the same SHA-256 on two runs) and `git diff --check` pass. `npm audit` finds 0 vulnerabilities.
- **Found by this run:** the first `scripts/package.mjs` run refused the new changelog because it quoted a Windows home-folder path pattern; the wording was changed. The tag workflow's package step would otherwise have failed.
- **Still required before tagging (CLAUDE.md, "Before any release"):** `npm test` on macOS and on Windows as a non-root, non-Administrator user on this exact tree; the live checks in a disposable vault, in particular a macOS pass of the final export-copy code and Siri AI, real provider connect, tool turn, cancellation and reconnect on Windows, and Claude Code, OpenCode and Hermes turns with the new tools. The `platform-tests` CI job runs the suite on GitHub's Windows and macOS runners, but those runners' accounts have administrator rights and no Obsidian, so it does not replace these checks.

## 3.8.0 — Windows audit and live check (2026-11-25, Windows 11, disposable Test vault)

- **Setup:** Obsidian 1.15.1 (the app's own signed updater) in an isolated profile that registers only `Documents/Coding/Test`, so no iCloud vault was opened. The built `main.js`, `manifest.json` and `styles.css` were installed together and reloaded. The checks ran against the executed plugin copy, driven over the DevTools protocol. No provider connection, model turn or account was used.
- **PDF export (internal route):** a 5-page CRLF note exported in 0.85 s. The copy got 1 page break, the read-back found no stranded heading, the copy was deleted, the note was unchanged and the export-copy record was cleared.
- **Taken output:** exporting to an existing `Export Test.pdf`, or to its case variant `export test.PDF`, is refused and the file stays byte-identical. The next free name is `Export Test 1.pdf`. `NUL` and `con.pdf` are refused as output names.
- **Crash leftovers:** an unchanged recorded copy is deleted after a real plugin reload. A recorded copy the user edited is kept. The record is cleared.
- **Organization journal:** a 40-move batch (about 80 journal rewrites under real Defender) finished in 2.5 s. No temp files were left and links were updated.
- **Popout window:** text selected in a PDF in a popout. Before the fix, "Add PDF selection to OWLA" was unavailable there. After it, the command is offered, the selection is added with its page, and the OWLA context menu appears (Add page, Copy link, Add selection, Copy selected text). The main window still works (page 2).
- **CRLF reviewed edits:** `read_note` → `propose_edit` → apply on a closed CRLF note keeps CRLF. Decline restores the exact bytes. A note changed after the proposal is refused and not written. With the note open, the edit goes through the editor. Obsidian then saves that note as LF, as it does for any editor edit.
- **Guards:** a case-alias `read_note` works on NTFS. An excluded folder and its case variant are refused, `NUL.md` is refused, and search does not return excluded text. Settings show no Automatic option and no Siri AI tab on Windows.
- **Packaging:** `node scripts/package.mjs` builds the ZIP on Windows (44 files). The build is reproducible (same SHA-256 twice), Windows' ZIP reader opens it, and `main.js` inside matches.
- **Gates:** `check`, `lint` (0 errors, 4 sentence-case warnings that predate this work), `guard:test`, `build` and `check:release` pass. `npm test` gives 925 tests, 924 pass, 0 fail, 1 designed skip, and 10 consecutive full runs were green. Details: [audits/3.8.0/07-windows-audit.md](audits/3.8.0/07-windows-audit.md).
- **Still required before a stable release:** real provider connect, tool turn, cancellation and reconnect on Windows, plus the macOS run.

## 3.8.0 — release candidate (2026-11-23, macOS, Agentbrain)

Prepared, not committed, tagged or pushed. Review: `audits/3.8.0/REVIEW-3.8.0.md` (B1 and S1–S3 resolved, see its addendum).

- **Local gates (final tree):**
  - `npm run check`, `npm run lint` (0 errors, 8 warnings, the same as before), `npm test` (**884 total / 878 pass / 0 fail / 6 skipped**, the Windows-only tests), `npm run build` (1.0 MB), `npm run guard:test`, `RELEASE_TAG=3.8.0 npm run check:release` and `git diff --check` all pass. `npm audit --omit=dev` finds 0 vulnerabilities.
  - `node scripts/package.mjs` produced a 44-file ZIP (`7d56d7d1…`), 3.7.0's 43 files plus the new `owla-obsidian-guide` skill. It contains no sources, tests or `data.json`.
- **Install:** `main.js` (SHA-256 `855c0ce4…be50fade1d9`), `manifest.json` and `styles.css` were installed in Agentbrain. The previous 3.7.0 files and `data.json` were backed up first. The plugin was reloaded with `obsidian plugin:reload`: version 3.8.0, no console errors, and `data.json` unchanged (same SHA-1) after all checks.
- **Driver:** `obsidian eval` called the real `ButlerView.tool`, `exportPdf`, `decideEdit` and `send`. Fixtures are in `OWLA Butler Test/3.8.0 live/`.
- **PDF export (Obsidian 1.15.1):**
  - Route B (Obsidian's own exporter, no dialog) saved `Export Layout.pdf` (43 KB, 2 pages) at the exact path in 2.4 s. The temporary tab was closed, and `Modal.prototype.open` was restored: the command palette still opens.
  - The read-back found the stranded heading that the pre-export estimate predicted.
  - With the `propose_page_breaks` edit accepted, the second export (`Export Layout 1.pdf`, collision suffix) had no stranded heading. So Obsidian's print renderer honours the `owla-page-break` div.
  - Revert restored the note.
  - Excluded notes and excluded or hidden output folders are refused.
- **Card and confirmation:** the chat card opens the confirmation dialog. Cancel writes nothing. While the note's edit is pending, Export is refused with a notice; after Accept, the export saved `Export Layout 2.pdf` with a clean read-back.
- **Real model turn:** Codex `gpt-5.6-sol` (low), 41 s. It called `export_pdf`, staged the page break with `propose_page_breaks`, re-checked the estimate on the staged preview, and left both for review.
- **PDF selection:**
  - A real page render produced a JPEG data URL of 22 KB, and a second request reused the cache.
  - The password-protected `locked.pdf` was dropped with a notice, without blocking.
  - An excluded PDF selection was refused.
- **Properties and outline with real YAML:**
  - Set, rename and checkbox changes kept the comment, the date value and the key order, and `done` stayed a checkbox.
  - A section move keeps blank-line spacing. This was found live and fixed, with a regression test.
- **Excalidraw:**
  - The 124-stroke handwriting drawing lists located ink clusters, and `read_note` at offset 5000 returns the redirect, not drawing data.
  - A plain note that mentions `excalidraw-plugin:` reads normally (S1).
  - On the original 289-element evidence drawing (decompressed in memory, read-only), the summary is 3,125 chars with 13 located clusters, and `delete_cluster {cluster:"all"}` removes all 274 strokes in one operation.
- **Not verified:** a Windows live pass; Claude Code, OpenCode and Hermes model turns for the new tools (exposure is checked by unit tests only); route A (dialog fallback) in the real app (unit-tested only); and whether Community review accepts the scoped `Modal.prototype.open` capture used by route B.

## 3.7.0 — GitHub release (2026-11-20)

- **Source:** tag `3.7.0` on `main` at `a1e4f27` (PR #2 merged the RC, PR #3 the
  release notes). "Check plugin" CI passed on that commit; the `3.7.0-RC` branch
  was deleted after it was fully merged.
- **Local gates on that tree (macOS):** check, lint, `npm test` (782 / 776 pass /
  0 fail / 6 Windows-only skips), guard:test, build, `RELEASE_TAG=3.7.0
  check:release`, the workflow's metadata check, ZIP packaging (43 files) and
  `npm audit --omit=dev` (0 vulnerabilities).
- **Release workflow:** passed and created a draft with only `main.js`,
  `manifest.json` and `styles.css`. The downloaded assets match the local build
  by SHA-256 (`main.js` `e6a53c76…adbbf2`), and `gh attestation verify` passed
  for all three (signed by `.github/workflows/release.yml` at `refs/tags/3.7.0`).
- **Installed draft assets:** copied into Agentbrain and reloaded: version 3.7.0,
  no console errors, `data.json` unchanged; one Automatic turn read a note and
  answered correctly through Claude Code (23 s).
- **Published:** non-draft, marked Latest; asset downloads and the default-branch
  `manifest.json` (3.7.0) are publicly reachable.
- **Not verified:** Windows live pass, Codex and OpenCode model turns (usage
  limits), and that the Community directory has picked up the update.

## 3.7.0 RC — macOS live release checks (2026-11-20, Agentbrain test vault)

The post-review checks from `audits/3.7.0-rc/windows-independent-followup.md`
§6, run on macOS against the installed build in the running app.

- **Host and install:** macOS, Obsidian 1.15.1, Node 24.15.0. The exact
  `main.js`, `manifest.json` and `styles.css` were installed in Agentbrain
  (previous files and `data.json` backed up first), the plugin was reloaded
  with `obsidian plugin:reload`, and the running copy was confirmed by its
  SHA-256 and the new PDF cache budget (`maxBytes` 67,108,864). No console errors.
- **Driver:** `obsidian eval` called the real `ButlerView.send`, `tool`,
  `decideEdit` and `stop`. Fixtures are in `OWLA Butler Test/3.7.0 live/`.
- **Providers (connect, one read_note tool turn, Stop mid-reply, disconnect and
  reconnect):**
  - Claude Code 2.1.328 (Claude Pro): all pass. Tool turn 7 s, reconnect 3 s,
    no Claude child left after Stop or turn end.
  - Hermes, via its private home with `nous:anthropic/claude-haiku-5.5`: all
    pass. 141 models, 97 with image input, 132 with a models.dev context
    window. The user's `~/.hermes/sessions` was not written; the private home
    has no `vault/` entry and its `.env` has no PATH/ComSpec/PATHEXT lines.
    The user's Hermes default (`opencode-go:qwen/qwen4-max:free`) was refused
    by OpenCode Go (HTTP 400); OWLA showed the provider's cause.
  - Codex: connect and reconnect pass; no model turn possible (usage limit,
    reset 22/11/2026), reported correctly.
  - OpenCode: connect (74 models) and reconnect pass, no server left running;
    no model turn possible (paid balance empty, free models at the shared limit).
  - Automatic selection (macOS): one real turn routed to OpenCode, survived two
    provider refusals by retrying, and answered correctly in 13.6 s.
- **CRLF Markdown (closed and open note):** highlights mark exactly the changed
  line with no stray `\r`. **Found and fixed live:** for a closed CRLF note the
  provisional apply wrote LF, so a proposal that was then declined still
  rewrote every line ending. Closed CRLF notes now keep their CRLF (`writeEdit`).
  Re-verified live: Decline and Undo leave the file byte-identical (same
  SHA-1), Accept changes one line and keeps CRLF, and a note changed on disk
  after the proposal refuses the decline ("your newer text was preserved"). An
  open note goes through Obsidian's editor, which saves LF itself.
- **Path guards:** a case alias (`owla butler test/readme.md`) reads the real
  file. Excluded folders, also through aliases, are refused, as is `../`
  traversal. Backslash folders get the forward-slash hint. A CRLF canvas reads
  correctly and stays byte-identical.
- **PDF cache:** continuation reads reuse one parsed document; an external
  rewrite invalidates it (re-parse on the next read); Stop and New chat empty
  it; the 111 MB `Annotation QA.pdf` is read but not kept; a damaged PDF
  ("Invalid PDF structure") and a qpdf AES-256 password PDF ("The PDF is
  password-protected…") fail clearly and are not cached.
- **View lifecycle:** closing and reopening the OWLA view left no observers and
  no errors.
- **Gates (final tree):** `npm run check`, `npm run lint`, `npm test`
  (**782 total / 776 pass / 0 fail / 6 skipped**, the Windows-only tests, run
  twice), `npm run build` (993.2 kb), `npm run check:release`,
  `npm run guard:test`, `git diff --check` pass. `node scripts/package.mjs`
  produced a 43-file ZIP whose `main.js` matches the build; no sources, tests or
  secrets inside.
- **Settings:** test turns persisted temporary provider overrides into
  `data.json`; the backup was restored byte-identically and reloaded. A
  model-refusal record the Automatic turn wrote (`groq/allam-2-7b` rejects
  reasoning settings) was kept, since OWLA uses it to skip that model.
- **Not verified here:** everything that needs Windows hardware (npm `claude.cmd`
  multiline turn, Automatic staying unavailable on Windows, NTFS/junction
  behaviour), Codex and OpenCode model turns (account limits), and the remote
  CI/release assets.

## 3.7.0 RC — Windows independent verification (2026-11-20)

This entry supersedes Windows gate assertions from the earlier hardening
pass, without changing the historical macOS live-check record below.

- **Host:** Windows 11 (build 26300), Node 24.14.0, npm 11.9.0; branch
  `3.7.0-RC`, base `81540fb`. Dependencies already installed; no lockfile or
  dependency update was required. Ubuntu CI/release workflows use Node 22, so
  this run does not establish identical behavior under that runtime.
- **Final gates (after the follow-up fixes):** `npm run check`, `npm run lint`
  (0 problems), `npm test` (**774 total / 773 pass / 0 fail / 1 skipped**),
  `npm run build` (**993.2 kb**, esbuild display), `npm run check:release`,
  `npm run guard:test` and `git diff --check` passed. The full suite was run
  repeatedly; the only intermittent failure observed was an opencode-lifecycle
  scratch-folder teardown hitting a transient Windows EPERM under parallel
  load, not a product assertion — its cleanup now retries on
  EPERM/EBUSY/EACCES and subsequent runs were green.
- **Follow-up fixes:** every defect from the independent review was fixed with a
  regression — recovery-journal read-failure preservation (observed RED then
  GREEN), absolute Node resolution for npm shims, stale Hermes
  credential-directory sweep, lone-CR `.env` filtering, system-directory
  artifact validation, CRLF apply/rollback offsets, external-PDF cache identity,
  graph pagination continuation, UTF-8 sample-boundary decoding, case-alias
  unsaved reads, single view-level observer cleanup, post-trim routing
  eligibility, atomic history persistence and PDF lease-release eviction.
  Findings, fixes and file references are tabulated in `AUDIT.md`.
- **Dependency scan:** `npm audit --omit=dev --json` returned **0 advisories**
  across all severities. This scans production dependency advisories, not
  arbitrary application vulnerabilities or development dependencies.
- **Skip accounting:** the visible runner skip is the genuine file-symlink
  test requiring Windows Developer Mode. Some pre-existing tests also return
  early on unsupported platforms; a green runner total is not evidence those
  opposite-platform bodies executed. Hard-link and junction containment tests
  do execute on this Windows host.
- **Optional ZIP packaging:** `node scripts/package.mjs <scratch-output.zip>`
  passed metadata/content preflight but failed at `spawnSync zip ENOENT`. The
  external `zip` executable is absent here. This is distinct from the passing
  three-file release check. The Ubuntu release workflow runs packaging; its
  result and downloaded artifacts have not been verified by this local run.
- **Live availability:** desktop discovery reports Obsidian not running; no
  existing Obsidian debugging endpoint was available on the checked local
  ports. Unit/fake-protocol evidence must not be labelled a live-vault pass.

### Windows release checks still required

- Install the exact final `main.js`, `manifest.json` and `styles.css` together
  in the disposable Test vault, keeping prior plugin files and `data.json`;
  reload and verify the executed runtime copy, not merely the source file.
- Exercise actual installed Codex/OpenCode/Claude/Hermes connect, one tool turn,
  cancellation and reconnect. In particular, test multiline instructions
  through a real npm Claude shim and confirm Hermes uses its private home.
  Do not induce real quota exhaustion or log credentials.
- Exercise CRLF Markdown proposal highlights, Accept/Decline and stale-text
  refusal; preserve raw drawing/Canvas/Base safety and excluded/case-alias
  guards. Verify detached-view cleanup and that Automatic stays unavailable
  on Windows.
- Exercise PDF continuation reuse, external modification, Stop/new-chat/close
  and password/failure paths in the running app. Snapshot-consistent cache
  identity and immediate in-flight parse cancellation remain scoped follow-ups.
- Re-run optional ZIP packaging with its `zip` prerequisite, inspect the ZIP,
  and verify remote CI/release assets before publication.

Evidence map: [Windows handoff](audits/3.7.0-rc/REVIEW-windows-hardening-pass.md),
[consolidation log](audits/3.7.0-rc/windows-consolidation-log.md),
`tests/audit-win-*.test.ts`, and the cumulative 3.7.0 RC entry in `AUDIT.md`.


## 3.7.0 — live release check (2026-11-19, Agentbrain test vault)

- **Gates (final tree):** `npm run check`, `npm run lint` (0 problems), `npm test` (488 pass, 0 fail), `npm run build`, `RELEASE_TAG=3.7.0 npm run check:release`, `npm run guard:test` and `node scripts/package.mjs` (43 files) pass.
- **Install:** the 3.7.0 build was installed in Agentbrain (previous plugin files backed up first) and reloaded with no console errors. Test files live in `OWLA Butler Test/3.7.0 live/`: a table note and a copy of the real 124-stroke handwriting drawing from the original incident.
- **Tables:** in the running editor, **Select table** is offered only inside a table, selects the whole table (including a `|-|:-:|` delimiter and a one-column table) and ignores a table look-alike in fenced code; **Add table to chat** attaches it as a chip and shows a notice outside a table. A trusted right-click (DevTools protocol) on a rendered Live Preview table showed that the editor menu comes from the cell's own editor, so the menu item never appeared; fixed by mapping the cell back to its table, then verified: "Add table to OWLA Butler" appears beside Obsidian's Row/Column items and attaches the whole table.
- **PDF:** right-click on a rendered page → **Copy link to page** put `alpha,p.1` on the clipboard.
- **Handwriting OCR:** `read_excalidraw` with `visual:true` returned the picture plus OCR containing `742, 16km/h` (2.9 s cold, 1.6 s warm). The OCR binary build was separately verified on this Mac (one shared build for parallel calls, no partial file).
- **Live turns:** "add a graph, describing this calculation" on the drawing routed automatically to a vision-capable model (Claude Code Haiku), took 3 tool steps (read, render + OCR) instead of the original 22 rounds, read the values correctly and proposed a new note. Accept created it; an edit to an existing note was accepted and undone byte-identically; a second proposal was declined and left the note unchanged.
- **Hermes, found and fixed live:** (1) every connect deleted the private home's own `state.db`/`processes.json`, so the private gateway refused `session/new` from the second connect on ("state.db was replaced underneath the gateway"); the stale-copy cleanup now runs once per private home. Three consecutive connects then succeeded (141 models, 99 image-capable from the models.dev catalogue). (2) A failed connect left the `hermes acp` child half-connected, so the next connect silently did nothing. (3) A provider usage limit made Hermes retry for up to 3 × 600 s while OWLA showed "responding…"; the private config now makes one attempt. (4) Hermes reported the failure only as "Internal error"/`admitted_turn_failed`; OWLA now shows the streamed cause and marks the limit. Verified live: the turn ended in 8 s with the 429 explanation, Hermes was marked limited, and the next automatic turn skipped it.
- **Not fixed, noted:** with Codex and Hermes limited, automatic selection chose a free OpenCode vision model for a one-sentence question about the drawing; that model looped through about 50 tool calls until the existing 40/50-call guard stopped it, and then misreported that the path was rejected. Every tool call had succeeded. This is model behaviour plus routing preference, not a regression; model-profile tuning is a follow-up.
- **Not verified:** Windows, Codex turns (usage limit until 22/11/2026), a successful Hermes model turn (its routed provider was rate-limited), and Community-review readability of the minified bundle.

## 3.6.0 — Hermes Agent and Excalidraw file forms (2026-11-17)

- **Gates (final tree, after all source edits):** `npm run check`, `npm run lint` (0 errors, 0 warnings), `npm test` (311 pass, 0 fail), `npm run build`, `npm run check:release` (version 3.6.0, three-file bundle, full notices and embedded reference pack) and `npm run guard:test` pass.
- **Protocol, without inference:** a local fake `hermes acp` peer exercised the real `HermesBridge` against its HTTP MCP endpoint. `session/new` received the loopback MCP URL and bearer token; `tools/list` exposed the single offered tool; `tools/call` returned `TEST_TOOL_OK`, which streamed back as the answer; OWLA's instructions were present in the prompt. This covers tool registration, MCP authentication and the streaming path.
- **Live turn (Agentbrain vault, final build):** after reload, `Connect Hermes` discovered 153 models from the user's connected providers. A short prompt sent through the bridge's actual `run()` with a free NVIDIA model answered exactly `LIVE HERMES OK`; the bridge returned to its resting state. The Nous provider was out of its daily included usage during this session (HTTP 402), so no Nous turn was possible.
- **Isolation:** the private Hermes config now reports `platform_toolsets.acp: [web]` while **Allow web search** is on, with plugins, MCP servers, memory and user profile disabled. `sessions/`, `state.db*`, logs, history, plugins, hooks, memory, persona and gateway state are excluded from the mirror of the user's Hermes home; `auth.json` and `.env` stay reachable. A local probe re-checked the config and protocol after this change.
- **Cross-provider routing:** six tests in `tests/hermes.test.ts` cover tool naming, private config and exclusions, error messages, settings migration, canonical model keys and switching to the same model on another provider.
- **Excalidraw work (other agent, reviewed here):** staged source changes handle `.excalidraw.md`, `.excalidraw` JSON and plain `.md` drawings, and recognise a drawing note opened in Excalidraw as the active file. Its tests (`tests/visual-files.test.ts`, `tests/visual-context.test.ts`) pass; the previous agent verified the context path live in School. Accept/decline on a plain `.md` or `.excalidraw` drawing was not exercised live here.
- **Not verified:** a live tool call using a real Hermes model, web search through Hermes, a real usage-limit recovery, Windows, and accept/decline of Excalidraw drawings. No commit, tag or push was made.

## Selection attachment card — 2026-11-16

- **What changed.** A text selection added to the chat now appears under the sent message as an attachment card, like an attached note: the text-select icon, the vault path and the excerpt it carries. Before this, the selection only existed as a composer chip and vanished on send, so it was impossible to tell that it went with the prompt. A selection added while a reply is still running is marked **next message**, because it waits for the message after the running one.
- **Unit tests.** Two tests in `tests/core.test.ts` cover `sentCards` and `selectionExcerpt` in `src/core.ts`: the card list keeps the selection first with the `text-select` icon, the label `Selection · <path>` and the collapsed excerpt, and the preview collapses whitespace, clips at 140 characters and ends with an ellipsis.
- **Live check (macOS, School vault).** An isolated bundle was built from release 3.5.0 plus only this change (`git archive HEAD` plus the patch, so another agent's in-flight work stayed out), installed in the School vault and the plugin reloaded. With every provider bridge stubbed (`bridge.run` returned a fixture answer) and the visible feed swapped for a detached node, one send produced exactly one `.owla-sent-attachment` card: label `Selection · Latin/studying/Studying for Latin Exam 1-26.md`, excerpt `den Ebenfalls und mehr`, icon present. The request the bridge received contained `SELECTED TEXT from Latin/studying/Studying for Latin Exam 1-26.md` and the excerpt, the composer and selection list were cleared after the send, and the turn was recorded in the chat history. The composer chip read `Selection · …next message` while a turn was running and `Selection · …` when idle. The visible chat was restored afterwards: feed, composer, selections, history and the automatic-selection preferences are back to their earlier values.
- **Layout.** The card was rendered with the plugin's own `styles.css` in a headless browser: the icon sits on the label's line, the excerpt wraps under the label in faint italic, and the attached-note card is unchanged.
- **Gates.** `npm run check`, `npm run lint`, `npm test` (294 pass, 0 fail at the time of the run) and `npm run build` pass. `npm run check:release` failed only because another agent had bumped `package.json` to 3.5.1 without updating `package-lock.json`; that release work was left untouched.
- **Not verified.** No real provider turn was made with the card (the bridge was stubbed), and the tooltip with the longer excerpt was not exercised live.

## Windows parity hardening — 2026-11-13

All verification ran on macOS; no Windows machine was available this session and no real Windows CLI was spawned. Nothing touched a vault.

- **Method.** The Windows rules in `src/cli.ts` (`isCliExecutable`, `findCliExecutable`, `defaultCliDirectories`, `windowsSystemDirectory`/`taskkillPath`/`comSpecPath`, `shimInterpreterTrusted`, the `ComSpec` pin in `sanitizedEnv`, `terminateProcessTree`) take the platform as a parameter, so `tests/cli.test.ts` runs the same assertions on every host. On this Mac they ran against the simulated Windows rules (`platform: 'win32'`); on Windows they will run for real. Previously every Windows test early-returned off Windows, so none of these rules was checked on this machine before.
- **Termination tests spawn real processes.** With `platform: 'win32'` the Windows taskkill path does not exist on macOS, which exercised the documented fallback (the direct child): a held child was killed within the 5 s deadline (30 ms in the run). A second, already-exited child was then passed to the Windows path and nothing was targeted, matching the PID-reuse guard. A POSIX test confirmed the detached process group is still killed after the refactor.
- **cross-spawn behavior.** Verified by reading the installed `node_modules/cross-spawn/lib/parse.js`: a command whose file does not end in `.com`/`.exe` is re-run as `cmd.exe /d /s /c "…"` with `parsed.command = process.env.comspec || 'cmd.exe'`, read from the parent's environment. This is the basis for the `ComSpec` trust check and the environment pin.
- **Line endings.** Verified by inspection that every protocol reader trims records before `JSON.parse`, so CRLF output from a Windows CLI cannot break a Codex, Claude Code or OpenCode connection. No change was needed.
- **Gates on this Mac.** `npm run check` (strict TypeScript), `npm run lint`, `npm run build`, `npm run guard:test`, and `node --import tsx --test` over every test file except `tests/auto-route.test.ts`: **144 pass, 0 fail**, including the eight new Windows tests. The excluded file and `src/model-profiles.ts` carried another agent's uncommitted in-flight changes (three failures about OpenCode model profiles, files modified 17:36 during this session) and were left untouched per AGENTS.md; `auto-route.test.ts` imports none of the files this work changed (`src/cli.ts`, `src/opencode.ts` launcher discovery, `tests/cli.test.ts`).
- **Still open on Windows hardware:** re-run the suite on the Windows test machine from the 2026-11-12 follow-up; confirm the `ComSpec` pin inside a real assistant's environment; connect one `.cmd`-shim CLI (an npm-installed assistant) normally, and once with a deliberately redirected `ComSpec` to confirm the refusal message and that no other interpreter runs.

## OpenCode live tool turn — 2026-11-13 (3.1.2 release blocker)

- **Result:** blocked by OpenCode's shared free-model usage limit. The bridge connected to **OpenCode 2.3.0** and reported **75 models**; the script selected the free model `opencode/iceman-free` (zero input/output cost). The single allowed turn failed with "OpenCode usage limit reached. Wait for the reported reset time." before any tool call, so the exact-name permission rule (`owla_read_note`) was not exercised live. No retry was made.
- **Ancestor plugin check:** not reached; the usage limit occurred during the turn, after connect, so the ancestor-plugin-did-not-run assertion was not evaluated. The unit tests in `tests/opencode.test.ts` still cover the permission rule.
- **Version:** OpenCode 2.3.0 (bridge reported `opencode v2.3.0`).
- **Model ID:** `opencode/iceman-free`.
- **Action taken:** recorded here per `HANDOFF.md` Task 1. The release waits on the owner's decision (ship with this limitation stated in `AUDIT.md`, or run the check once the free-model limit resets). No code change was made.

## Windows support follow-up — 2026-11-12

- **139 automated tests** pass on Windows on top of 3.0.2, including `.cmd` PATH discovery and argument preservation, Windows storage defaults, case-insensitive vault containment, macOS-only Automatic routing, the fake OpenCode bridge and the 3.0.1/3.0.2 main-branch updates. TypeScript, lint, build and three-file release checks also pass.
- The freshly built `main.js`, `manifest.json` and `styles.css` were installed in the Test vault and SHA-256 verified against the build; the enabled plugin list was unchanged. Obsidian was updated from 1.12.7 to 1.15.1 so it meets the plugin minimum of 1.14.5. After approving the vault's first-open prompt, OWLA's ribbon command appeared, confirming the plugin loaded.
- In the live Windows settings, the provider selector offered Codex, OpenCode and Claude Code, with no Automatic option. Deterministic tests also cover hiding Apple Foundation Models automatic-model settings outside macOS. The settings review exposed a Mac-specific executable-detection message; the final build changes it to device-neutral copy and is installed in the vault, but still needs an Obsidian restart to become the running copy.
- Installed the signed OpenCode 2.2.7 Windows CLI at `%LOCALAPPDATA%\Programs\OpenCode`, added the folder to the per-user `PATH`, and verified `opencode --version` from Command Prompt. OWLA auto-detected the same executable and its live bridge loaded 12 models.
- All 12 catalog entries reported zero input/output cost. The single approved live prompt selected `opencode/big-pickle` and was rejected by OpenCode with its shared free-model usage-limit response; no answer completed and no retry was made. OpenCode displayed a reset of 13 November 2026 at 01:00.
- `opencode auth list` reported no saved credentials on Windows, and `OPENCODE_API_KEY` was unset. No sign-in was attempted. The exhausted response is therefore not evidence that Windows was logged into the Mac account; it came from OpenCode's server-side free-model limit. The exact cross-device quota identity is controlled by OpenCode.
- OpenCode security checks verify deny-by-default session permissions, an allowlist limited to OWLA tools, bundled skills and optionally enabled web search, removal of native shell/file/MCP tools, and preservation of the user's normal auth data path and provider environment variables while global config/plugins remain isolated.
- Earlier provider checks below are historical and were not repeated.
- `npm run guard` and `npm run guard:test` could not execute because their referenced `scripts/vault-guard.mjs` and `scripts/vault-guard.test.mjs` files are absent from this checkout.

## 3.0.0 provider framework and OpenCode — 2026-11-12

The provider layer was built as one shared contract, so every assistant behaves the same and a new one only needs its own bridge. The OpenCode path was verified against the installed **OpenCode 2.2.7** binary and against a deterministic fake server. Every check ran with OpenCode's data, config, state and cache directories redirected into `/tmp`, so the machine's real OpenCode state was never read or written. No vault, note or user credential was touched. The shipped bridge redirects only the config folder; OpenCode's global `opencode.db` holds OWLA sessions until the end-of-turn delete. Do not delete history.

**Live checks against the installed binary**

- OWLA started OpenCode with its own random password, waited for the API to answer, and read the catalogue: **12 models**, all reported with their price, accepted input modalities, context window and reasoning variants. The `opencode` provider models report zero cost and image input, which is what the automatic router weighs.
- The private session directory contained the configuration, the tool payload, the skill payload and the plugin. The configuration denied everything and pointed at the plugin directory.
- The bundled plugin **loaded** (`owla.butler` reported active in the plugin registry), and the bundled skill `owla-formatting` appeared in the registered skill list. The session rules applied: the agent's effective permissions contained the deny-all entry.
- The registry was empty until the location was activated. This was found during the check: OpenCode fills the plugin and skill registry when the location's services boot, which happens on the first session in that directory. OWLA creates the session in the same directory it starts the server in, so the tools and skills are in place before the first turn.

**Deterministic checks**

- **128 automated tests** pass, strict TypeScript passes, and the Community source lint rules report zero errors and zero warnings. New coverage: the OpenCode version gate, executable discovery, model decoding, the permission ruleset, skill adaptation, usage decoding, the exhaustion rules and the instruction text.
- The bridge test drives the real bridge code against a fake OpenCode server: it starts the process, writes the workspace, loads the catalogue, creates a session, streams the answer, **calls back into OWLA over the loopback endpoint**, returns the tool result to the model, reads the usage limits and tears the process down. The tool call and its arguments were observed on the OWLA side.
- A separate end-to-end check with a mock OpenAI-compatible provider confirmed the shape of the whole loop: the model was offered exactly the OWLA tool and the skill tool, the tool ran, and its result reached the answer.

**Limits, stated plainly**

- **No live model turn completed.** OpenCode's free models are currently exhausted on this machine and answer with `provider.free-limit`, a typed error that carries the reset time. The free limit is global across the free models, not per model; that was confirmed by trying three different models. The provider was therefore not able to answer, and OWLA reports that honestly rather than as a made-up quota.
- The exhaustion rules are covered by unit tests against recorded provider reports, not by a real exhausted account.
- **New Obsidian tools and the Automatic provider are covered by unit tests only.** `query_vault_graph`, `propose_properties`, link checks on proposals, block reads and the automatic provider decision have deterministic tests; none was exercised in a live Obsidian vault or with a live model turn in this record. The Codex **Verify connection** button and the settings dividers were checked by type-check, lint and build, not by opening settings.
- **Claude Code was not verified end to end in this record.** Unit tests cover the version gate, argument building, model decoding, tool naming, image and tool content, plan-limit decoding, exhaustion, cited web sources and error wording. A source comment records that with Claude Code 2.1.322 the telemetry switches hide the live model list, which is why OWLA no longer sets them; that observation is not otherwise evidenced here. A live headless turn with OWLA's tools has not been recorded.
- OpenCode's own API is documented as experimental. OWLA pins it to the tested 2.2 line and refuses anything older, so an upstream change surfaces as a clear message rather than a broken chat.
## 1.0.1 composer and Community review regression — 2026-11-05

The three runtime files were backed up and installed in a test vault via Obsidian CLI. Existing data.json was preserved. The School vault and the user’s clipboard were left untouched.

- **55 automated tests**, strict TypeScript, the reported Community source lint rules (zero errors/warnings), build and release metadata/licence/reference checks passed. New cases cover malformed persisted settings/chats, malformed quota data, unknown inherited integration config and executable discovery without a shell. No dependency versions changed.
- **15 in-app composer checks** passed against a controlled backend: immediate text/chip clearing, sent image and outbound attachment preservation, preserving a matching newer draft, Stop/error recovery, no overwrite on restore, New chat cancellation, sent and saved-chat copy, selectable text, and 240 px copy control. Copy used a clipboard test double in Obsidian; the real system clipboard was not overwritten.
- **10 live integration checks** passed on Codex CLI 0.162.1. A synthetic PDF was extracted as text and rendered with visible content while Obsidian was hidden. Display rendering stalled in the hidden window before the fix; the attachment snapshot now uses PDF.js print intent. A synthetic screenshot and PDF were sent together: immediate clearing, dynamic guide call, correct screenshot code and exact quote/page reference, shutdown, same-chat follow-up and actual provider quota decoding passed. Response samples were 12.15 s and 4.66 s.
- Release workflow config keeps attestations for the three runtime files and ZIP, stores ZIP/checksums separately, and attaches only main.js, manifest.json and styles.css to the GitHub release. The 1.0.1 remote workflow and new Community scan have not run; the patch is not published.

Local evidence: `work/review-unit-tests.log`, `work/review-draft-result.txt`, `work/review-live-result.txt` and `work/review-patch-install.json`. The sections below retain historical 1.0.0 evidence.


## Community preparation — 2026-11-04

The exact three-file Community installation (main.js, manifest.json, styles.css; existing data.json preserved) was loaded and tested in a test vault through Obsidian CLI. No assets folder or node_modules was installed. All six guide tools worked. A live Codex request consulted owla-math and correctly produced 17/12 in Obsidian display LaTeX; the follow-up recalled the supplied test code across backend shutdown. Responses took 11.23 s and 7.62 s in this sample. Both ended with the process sleeping; the final OS process check found zero OWLA-owned agents.

Effective child configuration confirmed analytics and feedback disabled, all three OTEL exporters disabled, shell disabled and connectors disabled. The model catalog and existing ChatGPT login worked. Seven searchable setting definitions rendered through Obsidian’s native settings renderer, with Connect/Sign in/Disconnect/executable/usage controls and two real quota cards. Opening/refreshing settings also returned to sleep. No Obsidian errors were captured. One test-harness attempt could not import the Obsidian host module from CLI eval; it was corrected to use the host’s own settings renderer and the full smoke test was repeated successfully.

Current gates: **50 automated tests**, strict TypeScript, Community-specific ESLint (zero errors and warnings), build, full embedded-reference/licence checks and ZIP checks. Production dependency audit: zero known advisories. The lint-only development dependency tree currently reports 13 moderate advisories through its toolchain; those packages are not bundled or installed with the plugin. This is recorded separately from production dependencies rather than applying incompatible forced overrides.

README, changelog, release notes, package/manifest metadata, notices, contribution guide and COMMUNITY-RELEASE.md now describe the Codex-only product, separate CLI/account requirements, possible provider payments, network/context processing and outside-vault files. The build embeds complete OWLA/Phosphor/Obsidian-skills/jsdiff redistribution notices in main.js. Release automation checks metadata/assets, supplies checksums and notes, attests assets and creates a draft. Remote Actions, public release downloads and Community review have not been run by this local preflight.

At preparation time, the repository description/homepage/topics were updated while the repository remained private with no release published. Owner actions remain: review and commit the prepared source, make it public, tag 1.0.0, verify the built draft assets, publish, link the owner’s GitHub account at community.obsidian.md and submit through the current Community form. Optional payment is the proposed listing category for the external Codex service. See COMMUNITY-RELEASE.md for official policy links and the exact checklist.

Evidence: work/community-smoke-result.txt, work/community-unit-tests.log and work/community-production-audit.json. Public summaries omit raw account identifiers and private vault content. This supplements the broader representative capability matrix below; it does not claim that every previous scenario was re-run for documentation-only changes.


## V1 performance and usage gate — 2026-11-04

The v1 lifecycle replaces the earlier idle timeout with immediate owned-process shutdown after each response. The next message transparently recreates the backend and replays bounded recent context. A graceful process-group shutdown is awaited, with a bounded force-stop fallback, so both the launcher and native server are covered. Disconnecting during discovery cannot launch a late background agent.

Actual two-message test: first response 6.03 s; second response 4.95 s. Both ended with **zero owned Codex processes**. The second answer correctly recalled the project code from the first message; four visible history messages remained, distinct backend PIDs were observed and the ready dot stayed green. No chat restart or manual reconnection was used. The initial 250 ms shutdown probe exposed a still-closing process group; shutdown was changed to await exit and the test repeated successfully.

Settings rendered **two actual Codex quota windows** from account/rateLimits/read, with the exact server-reported used percentages, remaining percentages and Unix reset times. Quota updates arrive during requests and are refreshed after responses, on opening settings or manually. No periodic idle polling or local usage estimation. Missing/partial/multiple-bucket/over-limit data has explicit deterministic coverage; no quota reset or purchase was invoked. Green means authenticated/ready, not that an idle agent is resident.

Streaming now batches plain-text DOM changes every 50 ms and appends only new text. A synthetic test used the real Obsidian rendering path with 2,000 chunks / 62,000 characters: 3 streaming text changes, 538 ms total, complete final answer and no inference process. This is a rendering stress test, not model latency.

Final checks: TypeScript/build, **49 automated tests**, whitespace validation and artifact agreement. The earlier nine real automatic capability scenarios, six live skill reads, 22 lifecycle/layout checks, math rendering and final source/edit regression remain relevant functional evidence; the v1-specific shutdown/continuity/quota gate was tested separately on the v1 build. The one-time history-shortening notice and streaming/shutdown changes do not remove any retained skills or file safeguards.


Attachment continuity was also checked through OWLA’s actual send/replay path with a deterministic backend: a follow-up received the prior PDF page text, exact page reference and image without reattachment. Raw images and attachment-context fields were absent from the saved-chat payload. This verifies transport/context retention separately from the earlier live image/PDF understanding tests. Sources & activity identifies replayed attachment context. Recent images are bounded to two, and text context to 64,000 characters; explicit saves remain plain text only.

V1 evidence: work/v1-lifecycle-result.txt, work/v1-stream-stress-result.txt, work/v1-unit-tests.log, plus the retained Codex capability evidence listed below. Account identifiers and opaque reset-credit IDs must be removed from shareable evidence. Candidate is prepared for v1 release review; no tag, public release or repository visibility change was made.


Date: 2026-11-04. Test vault: disposable vault. Obsidian 1.14.5, Codex CLI 0.162.1, ChatGPT login, GPT-6.1 Sol / low reasoning. No API key or local inference. Native screen automation was not used.

## Checks

TypeScript, production build and 49 automated tests pass. Tests cover exact/stale edits, YAML insertion boundaries, citations/links, private bounded recovery/chats, skills/reference integrity, source search, CLI version/migration, model/effort validation, denied RPC requests, cancellation, quota/authentication errors and web-search truthfulness. Dependency audit and artifact hashes are recorded separately.

22/22 actual Obsidian lifecycle/layout assertions pass: reference access, excluded-open-note refusal, invalid YAML/CRLF refusal, exact apply/metadata preservation/Undo/stale refusal, recovery files, chat roundtrip/image stripping, absence of local setup/modes, four responsive sizes and fixture restoration. Additional filesystem testing denied an outside-vault symlink and its read. Final new-chat DOM is empty, with no welcome cards or modes.

## Real model scenarios, automatic tool choice

| Scenario | Seconds | Result |
| --- | ---: | --- |
| compare | 14.60 | Pass |
| science | 4.97 | Pass |
| missing | 5.09 | Pass |
| math | 5.12 | Pass |
| edit | 9.53 | Pass |
| pdf | 4.34 | Pass |
| image | 3.69 | Pass |
| web | 14.56 | Pass |
| boundary | 9.64 | Pass |

All nine cases returned without plugin errors and left fixture notes unchanged. Human checks confirmed exact source paths and citation key preservation; correct revision dates with proposals separated from evidence; correct axial-tilt explanation; missing email admitted; 17/12 plus quadratic roots 2 and 3; the intended active-recall replacement; Triangle.pdf p. 1 citation; faithful printed-equation transcription; actual web-search activity and linked official callout guidance; and denied hidden/outside paths and shell access.

Codex separately read all six retained skill packages through actual read_reference calls, then produced valid Markdown/YAML/wikilink/citation/math content. Its real fraction/quadratic answer rendered using OWLA’s Obsidian rendering path: four math containers, zero MathJax errors. Rendering was tested separately using the captured actual answer, not counted as another inference benchmark.

Live cancellation of a started turn preserved the draft, stopped the owned process and allowed automatic reconnection. The OWLA heading, green connected dot, red disconnected dot and absence of modes were verified. Signed-out/API-key/quota handling was simulated deterministically; shared account logout or actual quota exhaustion was not induced.

## Final regression and resources

After filesystem-boundary protection, the exact candidate repeated real source comparison and edit proposal tasks successfully. The process family was sampled each second during those tasks: peak 207.78 MiB; no critical memory-pressure sample. This excludes Obsidian/shared OS memory and is a sample, not a hard RAM guarantee. No local model weights are loaded.

Known allocated installation footprint: 4,599,787,520 bytes (about 4.60 GB), including preserved original vault backups, Obsidian, existing Codex CLI, source/dependencies, logs and current external storage. The verified OWLA runtime removal freed 633,782,272 allocated bytes; the model directory was already absent. All 19 preserved chat/recovery files matched hashes across cleanup. Original vault backups were untouched.

## Corrections and limits

Initial Codex tests exposed inherited integration configuration, disabled native web search, a restrictive web instruction and narrow-pane layout problems; these were corrected and the affected scenarios repeated. Failed intermediate records are kept locally, not counted as passes. The earlier 0.1 tiny-local-model failures remain historical; the 0.2 source/skill/image/math results are new Codex tests.

Skills are instructions rather than training. These are representative tests, not guarantees for every scientific claim, mathematical proof, handwriting or complex layout. PDF handling is selected-page only. Markdown file updates are reviewed; arbitrary rename/move/delete and Base/Canvas file editing are unsupported. Additional Codex versions/models, other platforms, exhaustive accessibility/themes and long-term quota/network behavior have not all been certified.

Evidence in source work/: codex-auto-qa-results.json, codex-skills-qa-results.json, codex-lifecycle-result.json, codex-cancel-reconnect-result.txt, codex-math-render-result.json, codex-final-regression-results.json, codex-final-resources.json, codex-final-storage.json, codex-cleanup-record.json and codex-unit-tests.log. Sanitized user-facing evidence and checksums accompany the ZIP. Real-model tests preceded the final one-time history-shortening notice; that UI-only addition passed the final build/check/test run.


## Attachment conversion and PDF review local verification

65 automated tests pass with typecheck, lint, build and three-file release checks. Obsidian CLI tests used disposable fixtures and no screen automation.

Fourteen attachment/editor assertions covered real Word DOCX and Pages content, PowerPoint slide XML, spreadsheet shared strings, a 12 MB BMP, unsupported status, unrestricted file selection, text drops, grouped edits, editor overlays and Accept/Decline cleanup. Four more assertions verified cancellation within five seconds, no late attachments after reset, multiple documents and no horizontal overflow. Native Pages, Keynote and Numbers exports returned the expected codes, and hashes of all four original Office/iWork fixtures stayed unchanged. A real Codex answer correctly identified all four codes with file citations.

Fourteen PDF assertions covered all text pages, page wikilinks, scanned page rendering, grouping comments, zero writes before acceptance, the composer lock, accepted annotation objects in a separate copy, unchanged source hashes, Decline, stale-source rejection, excluded files, a PDF over 20 MB, the context menu and adding its actual page. No Obsidian errors were captured.

The first live scanned-PDF question returned an unclear result from a dynamic page image. Automatic scanned-page images were then prepared before inference. The final live answer correctly returned SCAN-314 on page 2 and END-982 on page 3 with citations. Automatic page images are capped at 12 per attachment batch. More pages can be selected explicitly. General handwriting and layout accuracy remains model-dependent.

Conversion bounds are explicit. Prepared text is capped at 64,000 characters per document, Office archive content at 32 MB, and non-PDF conversion inputs at 512 MB. Native conversions have timeouts and cancellation. Quick Look previews are labelled as partial. Office text extraction does not preserve every diagram or chart. Apple app export requires installed apps and may request Automation permission. Original iWork documents are copied before native opening.

The PDF page menu uses an Obsidian DOM menu with Add page, Copy page link and Copy selected text. PDF annotation proposals remain in memory until resolved or plugin unload. They use standard PDF text comments, with source freshness checks and a separate output file on acceptance. No OCR layer is written into the PDF. The experimental editor overlay is temporary, uses theme colors and is hidden on stale text. Tests cover the default theme on this Mac, rather than every theme and PDF layout.

Evidence is in work/attachments-live-result.txt, work/attachments-model-result.txt, work/attachment-final-qa-result.txt, work/pdf-live-qa-result.txt, work/pdf-model-result.txt and work/pdf-features-unit.log.

### Muted experimental diff styling

Removed the added/removed emoji widgets. Additions and removals now use 12% theme-green/theme-red backgrounds. Removed text uses the normal text color. Typecheck, lint, build and release checks passed. A live test-vaultain disposable-note check confirmed no diff emojis, both translucent colors, normal text color and preservation of the existing chat. The installed files and running stylesheet were updated without restarting the chat. Evidence is in work/muted-diff-live-result.txt and work/muted-diff-style-result.txt.

### Diff selector, normal workspace split and per-hunk review

The Diff view setting offers Highlights in editor, None and Split diff view. Legacy enabled toggles migrate to highlights, disabled toggles to none. All 66 automated tests, typecheck, lint, build and release checks passed. Eight live test-vault assertions verified one normal workspace leaf to the right of the note, source Markdown rendering, exact match to the modal diff, mutually exclusive editor highlights, switching modes and Accept in chat closing the resolved pane. The initial acceptance check ran before the asynchronous UI update finished. Waiting for the composer to unlock verified the completed behavior. No Obsidian errors were captured. Evidence is in work/split-diff-qa-result.txt and work/split-diff-unit.log.

### 1.3.0 release build

The exact 1.3.0 build passed 66 automated tests, eight workspace split checks, fourteen PDF checks and a send-path regression check confirming that all three current image attachments reached the Codex bridge. No Obsidian errors were captured. Previous image history remains bounded separately from the current attachments. Evidence is in work/release-1.3.0-*.
