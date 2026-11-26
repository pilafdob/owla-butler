# Changelog

## Unreleased

- **Composer:** the toolbar is one row inside the composer frame: a **+** button, the model and effort, and Send. **+** replaces the Attach and Add note buttons and also offers Add folder, Add current selection and Commands.
- **Slash commands:** typing `/` opens a filtered list of commands (`src/slash-commands.ts`). Prompt commands insert an editable request; `/new`, `/save`, `/open`, `/undo` and `/model` run at once. Commands that cannot run are shown greyed out with the reason. New commands are added by registering them in `SlashRegistry`.
- The **Turn an image into note content** palette command uses the `/image-to-md` prompt, so the two cannot drift apart.

## 3.8.1

A patch release that fixes the Obsidian Community review of 3.8.0, which failed on its source code check. No user-visible behaviour changes.

- **Review error fixed:** the three `eslint-disable` comments for `obsidianmd/prefer-file-manager-trash-file` are gone. OWLA's own temporary PDF export copy (after an export, on unload, and in the start-up sweep of crash leftovers) is now removed with `vault.adapter.remove` instead of `Vault.delete`. It is still removed outright, not trashed, so exports leave no trashed copies.
- **Review warnings fixed:** an unbound `path.join` reference (`src/cli.ts`), a possibly non-`Error` rethrow (`src/codex.ts`), unnecessary type assertions (`src/main.ts`, `src/ocr.ts`, `src/vault-graph.ts`) and an aliased `this` (`src/pdf-export-run.ts`). The lint now runs `unbound-method`, `only-throw-error`, `no-unnecessary-type-assertion` and `no-this-alias` as errors.
- **CSS:** the canvas picture capture rule no longer uses `!important`; a more specific selector places the wrapper instead.
- **Regression tests:** no source file may disable an `obsidianmd/` rule, `styles.css` may not use `!important`, and the export tests fail if `Vault.delete` is used for an export copy.
- **Still reported, unchanged:** the CSS lint warns that `break-inside`/`break-after` in the print-only PDF export rules are partially supported by Obsidian; these are backstop rules and stay. The behaviour notices (filesystem, child processes, vault enumeration, clipboard) describe documented features.

## 3.8.0

3.8.0 collects the work of the 3.8.0 dev builds: PDF export, PDF text selections, richer note context, reviewed outline and property edits, tabbed settings with per-provider switches and an ordered fallback list, the Siri AI provider (macOS 27), Excalidraw handwriting handling, and a Windows data-safety audit. Settings from 3.7.x migrate automatically (see **Upgrade notes**). What was and was not verified is listed under **Verification** and **Known limits**.

### New features

- **Export notes to PDF:** ask OWLA for a PDF of a note and it uses Obsidian's own Export to PDF (desktop only). OWLA first estimates the print layout: a heading stranded at the bottom of a page, a title alone on page 1, a table or code block split across pages. It then offers an export card in chat, and nothing is written until you confirm it there. OWLA prints a temporary copy of the note, written next to it so links and embeds resolve the same way and deleted afterwards; the note itself is never changed for an export. Layout is fixed in that copy only: images are sized to fit inside the page border (width and height, read from the image files), the file-name title is printed once and a first heading that already matches it is not repeated, a too-tall first image under the title is made smaller so the title is not alone on page 1, and page breaks go before stranded headings and split tables or code blocks. The PDF is saved next to the note (or at another allowed vault path) and never replaces an existing file. After printing, OWLA reads the PDF back; headings that really ended up stranded get page breaks in the copy and the copy is printed again (at most twice). What remains is reported to the assistant with your next message. If Obsidian's internal exporter is unavailable, OWLA opens Obsidian's Export to PDF dialog for the note itself, without the fixes.
- **Page breaks saved in a note:** the new `propose_page_breaks` tool, for when you ask for page breaks in the note itself (an export does not need it), stages page breaks before the headings that should start a new page, through the normal accept/decline review. It only adds or removes `<div class="owla-page-break">` markers and never changes text. At most two fix rounds per note.
- **Add highlighted PDF text to OWLA:** select text in Obsidian's PDF viewer and choose **Add selection to OWLA** (right-click, or the command **Add PDF selection to OWLA**). The chip shows the file, page and first words. With the text, OWLA attaches the page as an image in the background for models that can read images, so the model can check text the PDF text layer misread. A selection across pages attaches at most two page images. Text-only models get the text with a note. A page that cannot be rendered (for example an encrypted PDF) is skipped with a notice and never blocks the message.
- **Richer note context:** every message now carries the active note's properties, full outline, outgoing links (unresolved ones flagged) and backlinks, about 2,500 characters at most. Excluded folders never appear.
- **Edit the outline through review:** the new `propose_outline` tool renames a heading, promotes or demotes it with its subsections, moves a whole section (up, down, before, after or under another heading) or inserts a heading. It reports heading links a rename would break. Every change goes through the accept/decline review and reverts exactly, CRLF included.
- **Safer property edits:** `propose_properties` can now rename properties. Untouched properties, comments, key order and values such as dates stay byte for byte. An existing checkbox, number or list keeps its type. Invalid YAML is refused.
- **Obsidian formatting guide:** a new bundled guide (`owla-obsidian-guide`) gives the model tested advice when you ask to improve how a note looks or lays out: image sizes, images side by side, captions, callouts, tables and a more professional document structure. It loads automatically for requests such as "make this look professional", "images next to each other" or "Bilder nebeneinander".

### Settings and providers

- **Tabbed settings:** the settings page is split into General, Codex, Claude, OpenCode, Hermes, Siri AI (only on macOS 27 with Apple's `fm` tool) and Automatic (macOS only). General holds the provider order, the Siri AI fallback, privacy, web search, plugin interconnectivity, screenshots, diff view, excluded folders and the model unavailability memory. Each provider tab holds that provider's connection, executable and usage limits. Usage is read only when its tab is opened.
- **Provider switches:** a **Use <provider>** switch heads every provider tab. A switched-off provider is never started, warmed up, measured or offered to Automatic selection, and is left out of the provider order; its process is stopped at once and its connection is kept for later. Turning off the primary moves Primary to the next enabled provider. At least one provider stays on. Existing providers start on, Siri AI starts off.
- **Ordered fallbacks:** the single fallback provider becomes an ordered list: Primary, Secondary, Third, Fourth, Fifth. When the providers above have reached their usage limits, OWLA serves the next messages with the first one that has usage left and returns as soon as a limit resets. An existing fallback becomes the Secondary provider (`fallbacks` in `data.json`, per platform; `fallback` stays as the first entry).
- **One Automatic switch:** the **Automatic** entry of the provider dropdown and the **Automatic model and reasoning effort** toggle are merged into that toggle on the new Automatic tab, together with the selection priority, thorough selection, privacy mode and details options. When it is on, OWLA chooses the provider, model and effort among the enabled providers, and the provider order in General is greyed out. A saved setting with either the Automatic provider or automatic model selection on turns the merged switch on.

### Siri AI (macOS 27)

- **New provider:** Siri AI uses Apple Foundation Models through the `fm` tool in macOS 27. OWLA starts a private `fm serve` on a Unix socket only you can write to, and talks to it with the Chat Completions protocol and OWLA's own vault tools. `fm` gets no file, shell, MCP or built-in tools of its own, and OWLA never uses a custom model provider from `~/.fm/config.json`. The server rests after 90 seconds without a reply.
- **Models:** chat uses `Siri AI · Private Cloud Compute` (Apple Account usage limits) where Apple allows it. Apple's `fm` serves Private Cloud Compute only to programs started from Terminal, so inside Obsidian Siri AI normally connects to the on-device model (no usage limits, small context window) and the connection status says why.
- **Global fallback:** **Siri AI as global fallback** (General) lets Siri AI answer once every other enabled provider has reached its usage limit, both with a fixed provider order and with Automatic selection. Automatic selection otherwise leaves Siri AI out.
- **Usage limits:** the Siri AI tab shows the Private Cloud Compute quota reported by `fm quota-usage`. A quota error marks Siri AI as exhausted and retries after 15 minutes.
- **Limits:** text only (attached images are not sent, with a notice), no web search, and one reasoning setting chosen by Apple.
- **Tested in a running Obsidian on macOS 27.3:** Apple refuses Private Cloud Compute to Obsidian ("not available in this context. Please use the Terminal app"); the same `fm` call from Terminal.app reports it available. A Private-Cloud-Compute-only build made in the dev cycle therefore could not connect at all; 3.8.0 keeps the on-device fallback, and Siri AI connects and answers in Obsidian with the on-device model.
- **Robust tool use:** a schema `fm` cannot express (a map with typed values, as in `propose_properties`) is sent as a free-form object instead of failing every request; a refused tool call (bad arguments, a missing heading) goes back to the model so it can correct itself instead of ending the reply; the on-device model gets the core note tools only, and its transcript stays bounded (long tool results shortened, earlier rounds collapsed). A context-size error is reported as such, not as a usage limit.
- **One-message override:** Siri AI is listed with the other providers when it is switched on and connected; Automatic selection still picks it only as the last resort.
- **One-message override picker:** the override is a search field now. Type any part of a provider, model name, model id or reasoning effort ("sonnet high", "luna") and matching choices are suggested as you type; each choice is one model with one effort, the current choice is listed first and **Automatic selection** clears the override. An override on another provider no longer fails when the provider that was active is out of usage or not connected: that provider is not contacted for the overridden message.

### Performance

- **Pictures are reused within a reply:** a repeated visual read of an unchanged canvas or drawing reuses the picture and its handwriting OCR instead of rendering again. Developer-mode recordings showed the same drawing rendered two and three times in one reply, each render holding up the calls queued behind it.
- **Repeats are refused before the work:** the third identical tool call is refused before it runs (it used to render the picture first and only then be refused). Staging a proposal resets the repeat check, because reads then show the staged preview.
- **No pointless visual checks:** after a new canvas is staged, or with Background screenshots off, the tool result no longer asks the model to check the layout with `visual=true`, which returned text only and cost the model a round.

### Excalidraw

- **Handwriting is summarised, not dumped:** `read_excalidraw` lists freehand ink as clusters with their position and size. Each covers at most about 240×120 px, so the model knows where each piece of handwriting is, instead of getting one line per stroke. On a real 289-element drawing the read went from about 16,000 to about 3,100 characters.
- **Bulk clean-up:** `propose_excalidraw` gains `delete_many {ids}` and `delete_cluster {cluster}`; `delete_cluster {cluster:"all"}` removes all freehand ink in one operation. Unknown ids or cluster names are reported instead of skipped. Limit errors name these alternatives, and drawings with more than 1,500 elements are not rendered visually.
- **No drawing data in note reads:** `read_note` and `search_vault` never return an Excalidraw drawing's compressed scene data, at any offset, heading or block. They point to `read_excalidraw` instead. Ordinary notes that only mention `excalidraw-plugin:` stay readable.

### Fixes

- Adding properties to a large note without frontmatter no longer fails at the proposal size limit: only the changed lines are staged.
- Codex with web search on works again on GPT-6.2 Sol and GPT-6.2 Astra. Every message failed with `Function 'web.run' is reserved for use by this model`: OWLA's direct-tool copy of the Codex model catalog cleared `tool_mode` but kept the models' experimental tools, and outside Code Mode Codex 0.171 sends `literature_search_query` as a `web.run` function that clashes with the model's own web tool. The copy now also clears `experimental_supported_tools` (none of them are OWLA tools). Reproduced and verified with `codex-cli 0.171.0` on Windows 11; regression test in `tests/codex.test.ts`.
- Shortening attached selections to fit a model's context window also works when a PDF selection is attached.
- A moved outline section keeps a blank line before the next heading, and the note keeps a single line break at its end.
- The system prompt no longer tells the model to stage page breaks in the note before an export. It contradicted the `export_pdf` and `propose_page_breaks` descriptions and could lead a model to propose edits to the note for an export, which fixes layout in a temporary copy. Found in the release review; regression test in `tests/pdf-export-wiring.test.ts`.

### Windows data safety and reliability

From the Windows audit of the 3.8.0 tree (`audits/3.8.0/07-windows-audit.md`, run on Windows 11 as a non-root user).

- **An export never overwrites a file:** the PDF output path is checked again when the export runs, not only when the card is confirmed. A file created there in between (another export, a sync), or a case variant of it on NTFS, is refused and left byte-identical.
- **Journals survive transient file locks:** the organization journal and the pending-edit journal replace their files with bounded retries (two 25 ms waits) when Defender, OneDrive or the indexer briefly lock them (`EBUSY`, `EPERM`, `EACCES`). One lock used to abort and roll back a whole move batch. Saved chats use the same shared helper (`src/fs-retry.ts`). Live: a 40-move batch (about 80 journal rewrites under real Defender) finished in 2.5 s with no temp files left.
- **Windows device names are refused in vault paths:** `CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9`, `CONIN$` and `CONOUT$`, with any extension and in any folder, so a write to `NUL.md` or `Notes/CON.pdf` can no longer disappear into a device. Windows only.
- **Export copies left by a crash are cleaned up safely:** the temporary export copy's path and SHA-256 are recorded in OWLA's private storage before it is created and after each fix round. On the next load, OWLA deletes only recorded copies whose text is unchanged. A copy you edited, or one OWLA never recorded, is kept; nothing is deleted by file-name pattern.
- **Popout windows:** **Add PDF selection to OWLA** and OWLA's PDF context menu work in popout windows (each PDF view reads its own window's selection, and the menu is registered on every popout). Reveal-line highlighting and the reply checkbox guard no longer fail for elements of a popout window.

### Security and privacy

- **PDF export writes nothing without confirmation and never changes the note:** the export prints a temporary copy and deletes it afterwards. Excluded notes and excluded or hidden output folders are refused, and output paths containing `..`, a backslash or a colon (NTFS alternate data streams) are refused. The internal exporter is reached through a capture of `Modal.prototype.open` that is scoped to the export and restored afterwards.
- **New context stays inside your exclusions:** the note context block (properties, outline, links, backlinks) never lists notes from excluded folders, counts included. PDF selections and their page images come only from allowed PDFs, and the PDF is checked again when the page image is rendered.
- **Siri AI is confined like the other providers:** `fm` gets no file, shell, MCP or built-in tools, reaches the vault only through OWLA's tools, and never uses a custom model provider from `~/.fm/config.json`. Its socket is removed on disconnect.
- **Every new write path is reviewed:** `propose_outline`, `propose_page_breaks` and property renames go through the same read-snapshot, excluded-folder and accept/decline checks as other note edits, and decline restores the exact bytes (CRLF included).
- **Drawing data stays out of the chat:** `read_note` and `search_vault` never return an Excalidraw drawing's compressed scene data, so it cannot fill the model's context or the chat.

### Build, CI and packaging

- **Windows and macOS tests run on every pull request:** CI gains a `platform-tests` job that runs `npm test` on `windows-latest` and `macos-latest`, so the NTFS/APFS case-folding, npm-shim, `SystemRoot` and launcher tests that are skipped on Linux now run before a merge. It found a Siri AI socket-path test that failed on Windows (`siriSocketPath` now uses POSIX paths) and four tests that compared Windows 8.3 short paths incorrectly. This job does not replace the live release checks in `TESTING.md`.
- **The manual-install ZIP builds on Windows:** `scripts/package.mjs` builds the ZIP with `fflate` (already a dependency) instead of a `zip` binary, with fixed timestamps so the same tree gives the same ZIP. Checksum files contain only file names, and the private-data guard also catches Windows home-folder paths. The ZIP has 44 files (3.7.0 had 43; the new one is the `owla-obsidian-guide` skill).
- **Flaky Windows tests:** the provider-lifecycle test waits up to about 10 s for its temp folder instead of failing with `EPERM` while a detached `taskkill` finishes (3 of 25 runs failed before, 10 of 10 passed after). The ComSpec shim test now reports which step failed and the `ComSpec`/`SystemRoot` values; that flake (1 in 25 runs) is not masked.
- **Lint:** popout-safe element checks removed the remaining `instanceof` warnings. Four sentence-case warnings on existing UI strings remain (0 errors).
- **Bundle size:** `main.js` is about 1.1 MB minified (3.7.0: about 1 MB).

### Dependencies

- `npm audit` reports 0 vulnerabilities in runtime and development dependencies. The bundled runtime dependencies (`cross-spawn` 7.0.6, `diff` 9.0.0, `fflate` 0.8.3, `pdf-lib` 1.17.1) are their latest published versions.
- The `obsidian` type package is pinned to `1.14.4` instead of `latest`, so a fresh `npm install` cannot pull a newer API package whose exact `@codemirror/*` peer versions disagree with the pinned `@codemirror/view` 6.43.13. The lockfile already resolved 1.14.4, so the build is unchanged.
- No other updates were taken. The newer versions available on 2026-11-25 (`typescript-eslint` 8.74.0, `@types/node` 22.20.7, `@codemirror/view` 6.44.0) are development-only, are not part of `main.js`, and were published zero to two days before this release. `@codemirror/view` must match Obsidian's exact peer version. TypeScript 7 is a major version and was not adopted for this release.

### Verification

Test counts are snapshots of different trees and hosts, not one progression.

- **Automated suite:** Windows 11, non-root, on the tree of the Windows audit: 925 tests, 924 pass, 0 fail, 1 designed skip, with 10 consecutive green full runs. Linux (cloud container, root) on the release tree, which adds one prompt regression test: 926 tests, 915 pass, 0 fail, 11 skipped (Windows- and macOS-gated tests, and the unreadable-journal test, which root cannot exercise). 3.7.2 had 790 tests.
- **Live, macOS (Obsidian 1.15.1, test vault, 2026-11-23, before the export-copy and Private-Cloud-Compute-only changes):** PDF export through Obsidian's own exporter (2-page PDF in 2.4 s, the predicted stranded heading found on read-back and fixed by an accepted page break), the confirmation card and Cancel, a real Codex turn that called `export_pdf` and `propose_page_breaks`, PDF selection rendering, cache reuse and the encrypted-PDF notice, real-YAML property and outline edits, and the 289-element Excalidraw drawing (13 located clusters, all 274 strokes removed in one operation).
- **Live, Windows 11 (Obsidian 1.15.1, disposable vault, 2026-11-25, final export-copy code, no provider or model turn):** a 5-page CRLF note exported in 0.85 s with the note unchanged and the copy deleted; taken and case-variant output paths refused; crash leftovers cleaned up after a real reload; the 40-move journal batch; popout PDF selection and menu; CRLF reviewed edits, Decline and stale-text refusal; case-alias, excluded-folder and device-name guards; Automatic and Siri AI absent from Windows settings; reproducible ZIP.
- Full details are in `TESTING.md`, `audits/3.8.0/REVIEW-3.8.0.md` and `audits/3.8.0/07-windows-audit.md`.

### Known limits

- Not verified live: Claude Code, OpenCode and Hermes model turns with the new tools (`export_pdf`, `propose_page_breaks`, `propose_outline`, `delete_cluster`; exposure is covered by unit tests only); any provider connect, tool turn, cancellation or reconnect on Windows; the dialog fallback for PDF export in the real app; a Siri AI turn on Private Cloud Compute inside Obsidian (Apple does not offer it there).
- Where Apple refuses Private Cloud Compute to Obsidian, as it does on macOS 27.3, Siri AI uses the on-device model, whose context window is small: long notes and many tool rounds are shortened.
- Whether Obsidian's Community review accepts the scoped `Modal.prototype.open` capture used for the internal exporter is not known.
- Automatic selection and Siri AI remain macOS-only. Linux and mobile are unsupported.
- From the 3.8.0 review, left as documented: when a PDF selection is dropped to fit the context window, its page image is still attached for that turn; "Wie sieht das besser aus?" does not trigger the formatting guide; `move under` places a section as the last subsection; the outline is included even for short notes (at most about 2,500 characters per message).

### Upgrade notes

- Update through Community plugins, or replace `main.js`, `manifest.json` and `styles.css` together and keep `data.json`.
- A single fallback provider becomes the **Secondary provider** (`fallbacks` in `data.json`, per platform; `fallback` stays as the first entry).
- A setting with either the Automatic provider or automatic model selection on turns the merged **Automatic model and reasoning effort** switch on.
- Existing providers start switched on; Siri AI starts off.

## 3.7.2

### Fixes

- **Codex can edit notes again:** Codex's model catalog now marks every model as Code Mode only, which hides all tools, OWLA's included, behind Code Mode. OWLA keeps Code Mode off, so every vault tool call failed and Codex replied that note access was unavailable instead of proposing the edit. OWLA now gives its private Codex session a copy of Codex's own catalog with direct tool calls, applied with one restart when needed and renewed hourly. Code Mode and the rest of OWLA's isolation stay unchanged.

## 3.7.1

### Fixes

- **PDF page links are links again:** **Copy link to page** in the PDF viewer copies a wikilink to the page with the citation as its label, such as `[[Biology/ebooks/Kernbereiche Biologie 6.pdf#page=18|Kernbereiche Biologie 6,p.18]]`, instead of plain text. Pasted into a note it shows `Kernbereiche Biologie 6,p.18` and opens that page.

## 3.7.0

### New features

- **Tables to chat:** right-click inside a Markdown table (also a rendered table in Live Preview) and choose **Add table to OWLA Butler**, or run **Add table to chat**, to attach the whole table as raw Markdown. **Select table** selects the table under the cursor. Tables inside fenced code are ignored.
- **PDF page citations:** **Copy link to page** in the PDF viewer now copies a citation such as `Kernbereiche Biologie 6,p.15` (file name without folders or extension) instead of a full-path wikilink.
- **Handwriting in drawings:** on macOS, reading a Canvas or Excalidraw drawing as a picture also returns the handwriting recognised by macOS Vision, labelled as a text supplement to check against the picture. It needs Xcode or its command line tools; without them OCR is skipped and the picture is still returned.
- **Vision-aware Hermes routing:** Hermes models now report their real image support from the models.dev catalogue Hermes itself uses, instead of all claiming image input. Requests about an open drawing go to an image-capable model.
- **Selected text reaches the model:** the captured cursor selection is now sent with the turn (clipped to 3000 characters), not only its position.

### Search and tool efficiency

- **Vault search relevance:** terms match whole words only (`graph` no longer matches “paragraph”), scoring weighs how many terms a note covers, and a long query matched by a single body word is dropped.
- **Hermes tools always visible:** OWLA's private Hermes configuration turns off deferred tool search, so the model sees every OWLA tool and its arguments without extra lookup rounds.

### Reliability

- An unexpected pipe error from a provider process can no longer crash Obsidian; stdio errors are handled for every provider.
- Provider start-up failures show the real cause (`Last error: …`) instead of “cancelled” or a generic disconnect, for Codex, OpenCode, Claude Code and Hermes.
- Codex usage-limit errors now mark Codex as exhausted and expire at the reported reset, like the other providers.
- Resting or switching a provider waits for the previous process to exit and no longer cancels a connection in progress.
- Claude Code processes escalate from SIGTERM to SIGKILL; stream parsers are capped at 16 MiB; the Hermes stream reader is linear and bounded.
- An oversized pending-edit journal now fails closed instead of being deleted, and backup clean-up can no longer fail an edit.
- Routing history over 1 MB is pruned instead of wiped; settings from a newer schema version are kept.
- Usage reports that list only some windows no longer erase the others.
- Hermes: reconnecting no longer deletes the private Hermes database, which made Hermes refuse every new session after the first connect.
- Hermes: a failed connection no longer leaves a half-started Hermes process that made the next connection silently do nothing.
- Hermes: a provider usage limit is reported within seconds with Hermes's own explanation, instead of up to 30 minutes of "responding…" or a bare "Internal error", and automatic selection then skips Hermes until the limit window passes.
- A bare `HTTP 429` error is now recognised as a usage limit.
- Codex: a process that dies while connecting is reported with its cause, not as "cancelled"; model catalogue paging is capped at 20 pages and deduplicated.
- OpenCode: a server that crashes at start-up is reported promptly with its cause instead of after 20 s of polling; two runs started at once no longer race; aborting while a session is being created works; a stale resident server is detected and restarted.
- Hermes: model lists are deduplicated; a refused model selection fails the turn instead of silently using the default model; disconnecting clears the old model list; request timers are cleared; the shutdown wait is bounded so a process that never reports its exit cannot block later connections.
- Shared process runner: abort, stdin end-of-file and command naming fixed; stderr tails are bounded.
- Automatic mode: the route cache is keyed by conversation history and bounded (64 entries, timed expiry); context estimates include fixed overhead, replayed images and PDF size; retries keep the conversation context and image requirement; a plan that has just reset is no longer treated as unknown.
- Stream splitting handles a delimiter split across three or more chunks; the web-source list is capped at 500 entries; reading a damaged chat folder is bounded.

### Security

- Hermes: the background-process checkpoint and 25 more writable state entries are no longer shared with your Hermes home; each vault gets its own private home; planted or dangling links in the mirror are refused; instruction files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.hermes.md`) above the session folder block connecting, as they already did for Codex.
- Child environments: more execution-hijack variables are removed (Git config and SSH command, pager, editor, `UV_PYTHON`, `VIRTUAL_ENV`, `OTEL_*`); Claude Code no longer inherits backend, model or telemetry redirectors; inherited `OPENCODE_*` behaviour variables are dropped while provider keys stay.
- OpenCode only accepts events for the current turn's session.
- Reply rendering: re-animated SVG (SMIL) attributes and control-character-obfuscated `javascript:` links are neutralised.
- Error messages redact bearer tokens, credential assignments and home-folder paths.
- The loopback MCP endpoint compares its token in constant time, caps request size and rejects malformed bodies.
- Hermes's mirror of your home is checked with `lstat`/`readlink`: planted or dangling links are replaced, never followed. A 79-entry completeness probe of the mirror is part of the tests.
- The Hermes version check runs with the cleaned environment.
- Tool arguments are capped (10,000 / 100,000 characters) so oversized arguments cannot leak tokens into logs or prompts.

### Performance

- `main.js` is minified: about 1 MB instead of 1.7 MB.
- Organization previews, vault-graph queries, heading outlines and closed-note reads are faster on large vaults.
- Canvas proposals keep Obsidian's own file format, so a small change no longer reformats the whole file.
- The Hermes stream reader was quadratic and unbounded (180× slower at 8 MiB); it is now linear and capped at 16 MiB.
- Organization previews on a 5,000-note vault: about 480 ms → 46 ms. Vault-graph queries reuse path checks (≈100 ms → ≈1 ms). Heading outlines are linear. Closed notes are read through Obsidian's cache.
- Reply sanitising is coalesced to one pass per frame and now also watches attribute changes.

### Tools and context

- Canvas and Excalidraw readers guard against damaged files and validate sizes; Bases filters have a depth limit; vault-graph results are capped below 60 KB and offsets validated; plugin colours are normalised; a damaged PDF gives an actionable error.
- OCR helper: needs Xcode or its command line tools and never opens the macOS install dialog; it is compiled once per version, shared by parallel reads, and a failed or interrupted build never leaves a broken binary.
- Hermes model image support is re-read when the models.dev catalogue file changes, so a catalogue downloaded or refreshed mid-session is used on the next connect.

### Windows hardening

- **Provider launch and teardown:** Windows environment keys are read case-insensitively; `.cmd`/`.bat` arguments with unsafe control characters fail closed. Standard npm Claude shims launch their validated JavaScript entry point directly through Node so multiline instructions arrive intact. Process-tree teardown rechecks exit state before targeting a PID, and failed launches release listeners and timers.
- **Private provider homes:** Hermes uses the Windows local-application-data home, excludes its credential vault and gateway/runtime state, removes dangling excluded entries, and replaces planted hard links. Reconnects still validate the mirror but avoid unnecessary rewrites. Codex credential links must match the intended sign-in file; instruction-file checks use canonical paths.
- **Privacy and tool boundaries:** Windows home/UNC paths and credential assignments are redacted from errors; inherited shell/PowerShell redirectors are stripped. All four providers delimit and escape untrusted tool text. These markers help separate data from instructions; they are not a guarantee against model prompt injection.
- **Windows text and reviewed edits:** CRLF block/table extraction, frontmatter and Canvas round-trips, review display, freshness comparisons and inline diff offsets are corrected. Raw drawing/Canvas/Base snapshots retain byte-exact write guards. Text attachments accept BOM-marked UTF-16 and conservatively detected Windows-1252 prose; prepared text normalizes line endings.
- **Bounded tools and reads:** vault-graph output enforces its byte budget even for expanded YAML aliases. Filesystem-confirmed case aliases share exclusion, scope and read-size checks. Tool reasons are bounded and property proposals reject non-Markdown formats.
- **Reliability:** bounded lock retries cover chat writes/deletes and binary reads; journal stat failures preserve recovery data and read-only journal replacement retries safely. OpenCode startup retries bind collisions without reviving a disconnected connection; invalid reset times cannot block a provider indefinitely, and limit detection is shared.
- **Performance and context:** parsed PDFs are reused through refcounted cache leases and invalidated on modification/stop/close; pending-review rendering is coalesced; detached reply observers are released. Routing-history pruning no longer repeatedly serializes the whole history. Context trimming uses literal, position-checked replacement and conservative estimates; Hermes reads catalogue context windows. Automatic selection remains macOS-only, and macOS Vision OCR/supporting code is preserved.
- **Release verification fixes:** a closed note with Windows (CRLF) line endings keeps them when an edit is proposed, accepted, declined or undone, so declining no longer rewrites every line. Parsed PDFs kept between reads are limited to 64 MB in total, and a cached continuation no longer reads the whole file again. Closing tags of the untrusted-content wrapper written with spaces are escaped too.

### Audits and review

- **Seven-area audit** of the 3.6.3 code: failure handling, stream and resource leaks, security and token leakage, automatic-mode efficiency, providers and usage limits, tools and context, and performance. Reports are in `audits/3.7.0-rc/` (`failure-resilience.md`, `stream-leaks.md`, `security-leaks.md`, `auto-mode-efficiency.md`, `providers-usage.md`, `tools-context.md`, `performance.md`), with the consolidated handoff in `REVIEW-rc-hardening-pass.md`.
- **Feature reviews:** tables to chat, PDF page citations, handwriting OCR and vision routing, and the documentation reorganisation each have a review note in the same folder.
- **Independent review** of all of the above found and fixed: an OpenCode isolation change that dropped `OPENCODE_API_KEY`; table delimiter rows with single hyphens or one column not being recognised; the OCR build issues above; the stale Hermes catalogue cache; the unbounded Hermes shutdown wait; and the `429` pattern that matched a literal backslash.
- **Live release check** in a test vault (details in `TESTING.md`): found and fixed the Live Preview table right-click gap and four Hermes bugs (private database deleted on every connect, half-connected process after a failed connect, 30-minute silent retry on a usage limit, bare "Internal error" message).
- **Windows round:** eight area reports (`windows-failure-process.md`, `windows-stream-leaks.md`, `windows-security-leaks.md`, `windows-auto-mode.md`, `windows-providers-usage.md`, `windows-tools-context.md`, `windows-attachments-vision.md`, `windows-performance-main.md`) plus `windows-consolidation-log.md` and `REVIEW-windows-hardening-pass.md` in `audits/3.7.0-rc/`. Consolidation O1–O6 resolved cross-area interactions and the earlier independent review's six logic findings, with regression coverage.
- **Independent follow-up (2026-11-20):** three fresh reviewers re-examined the Windows tree and reproduced fourteen further defects (recovery-journal read failures, npm-shim cwd hijack, stale Hermes credential copies, lone-CR `.env` bypass, system-directory trust, CRLF apply/rollback offsets, external-PDF cache collisions, graph pagination, UTF-8 sample boundaries, case-alias unsaved reads, observer retention, post-trim routing eligibility, history-write atomicity, PDF lease capacity). All were fixed with regressions; final gates **774 tests / 773 pass / 0 fail / 1 designed skip**, build/check/lint/release/guard checks green. A second delegated fix review was cut short by the account's daily usage limit, so the parent completed and verified the remaining fixes directly. Details in `AUDIT.md`.
- The earlier macOS release check recorded 488 passing tests; the Windows fan-out baseline separately recorded 479 tests (467 pass, 12 fixture failures). These are different snapshots, not a single test-count progression. The current independent Windows rerun and remaining release checks are recorded in `TESTING.md` and `AUDIT.md`.
- **macOS live release check (2026-11-20):** in a test vault, Claude Code and Hermes passed connect, a tool turn, Stop and reconnect; Codex and OpenCode connected and reconnected but were at their usage limits. Automatic selection, CRLF review flows, path guards and the PDF cache were exercised in the running app, and the CRLF line-ending bug above was found and fixed. Final gates **782 tests / 776 pass / 0 fail / 6 Windows-only skips**. Details in `TESTING.md`.

### Documentation

- Old version-specific reports moved from the repository root to `audits/<version>/` (1.0.0 capability checklist, 1.0.1 release candidate, 3.1.1 performance audit, 3.6.1 Windows audit, 3.6.2 security audit), with an index in `audits/README.md`. Living documents stay at the root; the package ships the two older reports from their new paths.
- New GitHub issue templates (bug report and configuration).
- README: Hermes listed as a provider throughout; provider-specific wording generalised.

### Known limits

- Not verified on Windows in a running vault (including a multi-line turn through the npm-installed Claude Code). Codex and OpenCode model turns were not run live (usage limits).
- With strong providers limited, automatic selection can pick a free model that uses many tool calls; the 40/50 tool-call guard stops it.
- The Windows round implements the previously deferred PDF cache, review render coalescing, Hermes rewrite gating, selection trimming, catalogue context-window lookup and untrusted-output delimiters. Remaining work includes a live Windows pass, prompt PDF-parse cancellation, snapshot-consistent PDF cache identity, Excalidraw export limits, organization checkpoint optimization and the other scoped items in `audits/3.7.0-rc/REVIEW-windows-hardening-pass.md` §5. No Windows Automatic-mode enablement is included.

## 3.6.3

### Hermes containment (security)

- **Hermes could run on your own Hermes daemon instead of OWLA's.** OWLA's private Hermes home linked your live gateway socket, lock and runtime files, so `hermes acp` attached to your running daemon, with your shell and file tools, MCP servers and session database. OWLA's private configuration was never read. The gateway, runtime, state and lock files are no longer linked, and links left by an earlier build are removed.
- **OWLA's tools were invisible to Hermes.** The loopback MCP endpoint treated a single JSON-RPC request as an empty batch, so `initialize` and `tools/list` got no answer. Hermes found no OWLA tools and fell back to shell searches and unreviewed writes. Single requests are answered now. OWLA's server is also registered as a native `owla` server, so the model sees the `mcp__owla__<tool>` names its instructions use.
- **Default model:** an OWLA-owned Hermes daemon needs a default model. OWLA copies only `model.default` and `model.provider` from your Hermes config, as checked scalars.
- **`.env` is filtered:** Hermes loads `<home>/.env` with override semantics, and `HERMES_TUI_GATEWAY_URL` connects straight to a remote gateway. The private home now gets a filtered copy of your `.env` with every `HERMES_*` key removed (provider keys stay), and inherited `HERMES_*` variables are removed before Hermes starts.
- **Spelling and links:** excluded Hermes entries are matched case-insensitively (`Config.yaml` is the same file as `config.yaml` on macOS and Windows). OWLA's own `config.yaml`, `.env` and `skills/` are never written through a leftover link into your Hermes home.

### Codex isolation (security)

- **Private Codex home:** Codex adds `<CODEX_HOME>/AGENTS.md` and every user skill's description to each model request (`project_doc_max_bytes` covers only project files). OWLA now runs Codex with its own `CODEX_HOME` in OWLA's storage folder. That folder holds only links to your sign-in (`auth.json` and its lock files), so your global Codex instructions, skills and config no longer reach OWLA's sessions, and Codex's state databases stay out of `~/.codex`. A link is used rather than a copy, so token refreshes stay shared with your own Codex. Where no link can be made, OWLA asks you to sign in once. Skill instructions are also turned off (`skills.include_instructions=false`).

### Vault confinement (security)

- **Capital sharp s:** `ẞ` (U+1E9E) folded to `ß` rather than `ss`, so `STRAẞE/…` could reach a folder excluded as `Straße` on APFS. Paths are now lower-cased first, and `ẞ`, `ß` and `ss` match each other.

### Other changes

- **Model unavailability memory:** models your plan refused, models outside your workspace's privacy regions, and models that reject reasoning settings are remembered across restarts. A model that only rejects reasoning settings is retried without them. **Settings → Reset OWLA model unavailability memory** clears the list. Rate and usage limits still expire on their own.
- **Child environments:** unrelated service credentials (GitHub, AWS, npm and similar) are now removed on every host, not only on Windows. More interpreter injection variables are removed too (`PYTHONHOME`, `PYTHONSTARTUP`, `PERL5OPT`, `RUBYOPT`, `RUBYLIB`, `BASH_ENV`, `ENV`, `ZDOTDIR`), and on Windows this matching ignores case.
- **Excalidraw skill:** a shorter Canvas → Excalidraw route that uses only OWLA's tools.

## 3.6.2

### Community source review

- **Hermes bridge source checks:** removed the file-wide lint suppression in `src/hermes.ts`. JSON-RPC messages, model catalogues and streamed updates are now checked at their boundaries with the same typed helpers the other providers use, so the source scanner's directive, `any` union and unnecessary-assertion findings no longer apply. No change to chat, tools, models or the review flow.


### Windows compatibility

- **Hermes executable discovery:** on Windows the inherited PATH is often stored as `Path` rather than `PATH`. Copying the environment into a plain object kept that casing, so Hermes could not see the system PATH and appeared not to be installed; the PATH is now read case-insensitively.
- **Hermes private home:** mirroring your Hermes sign-in and state used symbolic links, which Windows normally refuses without Developer Mode or an elevated process. It now falls back to a bounded copy, so Hermes keeps its existing sign-in.
- **Excluded folders:** a folder entered with Windows backslashes (`Private\Sub`) now excludes the same notes as `Private/Sub`. Previously such an entry silently excluded nothing.

### Windows security and privacy

- **Command launchers:** a Windows `.cmd`/`.bat` assistant launcher is now always interpreted by the system's own Command Prompt, even when `ComSpec` is unset. A redirected `SystemRoot`/`windir` can no longer choose that interpreter or the tool used to stop a process tree.
- **Hermes PATH separator:** the child process PATH now uses the Windows `;` separator instead of `:`, so Hermes can find its installed helpers and binaries.
- **Credentials:** provider processes on Windows no longer inherit unrelated tokens and keys (GitHub, AWS, npm and similar) from your environment. The OpenAI/Anthropic keys were already removed, and OpenCode still keeps the provider keys it reads by design.

## 3.6.0

### Hermes Agent

- **New provider: Hermes Agent.** OWLA now runs Hermes Agent like its other assistants, with the same vault tools, skills, review flow and manual first-time connection. Choose **Connect Hermes** once per vault. Hermes uses the providers you connected in Hermes (OpenRouter, Anthropic, Nous, OpenAI Codex, Ollama, custom endpoints and more), so the same underlying model can be available through both OpenCode and Hermes.
- **Auto mode:** Hermes models are weighed like OpenCode's. When a model is available through both OpenCode and Hermes, a failed attempt or an exhausted source moves to the same model on the other source before trying a different model.
- **Settings:** a Hermes Agent connection section, executable picker and usage panel, plus the provider dropdown entry. Hermes does not report its connected providers' limits over its control interface, so OWLA cannot show percentages; a reported limit keeps Hermes out of automatic selection until it is tried again.
- **Isolation:** Hermes runs with a private configuration folder and only OWLA's tools. Global configuration, skills, plugins, shell hooks, memory and persona are not read; session history and state databases are not shared with your own Hermes install. Sign-ins and connected providers keep working.
- **Web search:** when **Allow web search** is on, Hermes gets its `web` toolset; with it off, no web tools are available. Tool activity is recognised for both search and extraction.
- **Review fixes:** instructions now reach the agent in the prompt, tool specs are registered before Hermes asks for them, aborting sends `session/cancel`, MCP image results keep their real MIME type, refused Hermes requests get a protocol answer, and pending calls are rejected on disconnect.

### Excalidraw

- OWLA now reads and changes Excalidraw drawings in every form the plugin opens: `.excalidraw.md`, `.excalidraw` JSON and plain `.md` notes with `excalidraw-plugin` frontmatter. New drawings use the matching format.
- A drawing opened as a plain `.md` note is recognised as the active file by its Excalidraw view type or frontmatter, so automatic selection offers an image-capable model and the file is not named twice. Drawing notes are no longer offered to the ordinary note editor, which could damage their data.

## 3.5.1

### Selection visibility

- An added text selection now stays in the composer as a chip and is listed on the sent message as a card with the excerpt it carries, so it is visible that the selection went with the prompt instead of silently disappearing.
- A selection added while a reply is still running is marked **next message** and waits for the message after that, and the chips are re-rendered when a turn ends so the marker does not go stale.

### Automatic mode: OpenCode models from all connected providers

- **OpenCode data home:** OWLA's isolated OpenCode server now reads the data store the user's OpenCode desktop app signs into. It prefers an explicit `XDG_DATA_HOME`, otherwise falls back to `~/.local/share/opencode-v2-home` (the v2 desktop service's data home) when its `opencode/opencode.db` exists, else OpenCode's default. Previously OWLA inherited Obsidian's environment, which rarely sets `XDG_DATA_HOME`, so it read the CLI default store and only saw the OpenCode/Zen+Go models (47), missing the user's other connected providers (google, groq, nvidia, openrouter).
- **Automatic selection shortlist:** the OpenCode model pool now draws from every connected OpenCode source (opencode, openrouter, opencode-go, google, nvidia, groq), so one source — openrouter's hundreds of models — can no longer swamp the six-slot shortlist. Sources take turns, each in its own free-then-capable order, and slots a small source cannot fill go to the others, so the shortlist stays full.
- **Canvas / Excalidraw / Bases awareness (3.5.0 features):** automatic routing now treats editing a canvas, Excalidraw drawing or Bases base as structural edit work (`read_canvas`/`read_excalidraw`/`read_base` to read, `propose_canvas`/`propose_excalidraw`/`propose_base` to change), and the one-message override offers only image-capable models when a canvas or drawing is the active file.

## 3.5.0

### Canvas, Bases and Excalidraw (under Plugin Interconnectivity)

- **Canvas:** `read_canvas` lists cards, groups and edges, and with `visual=true` returns a picture of the canvas as Obsidian draws it, taken in the background (also when the window is covered) and noted in Sources & activity. `propose_canvas` stages structural operations, validated against JSON Canvas 1.0, for review; new canvases can be created.
- **Bases:** `read_base` and `propose_base` run every base through Obsidian's own Bases engine. Formula and view errors are reported, a proposal with errors is refused, and the rows the view will list are shown.
- **Excalidraw:** `read_excalidraw` summarises shapes, text, arrows (with what they connect), frames and images, and with `visual=true` returns Excalidraw's own rendering. `propose_excalidraw` stages operations, building new elements with Excalidraw's scripting API, for review; new drawings can be created. Diffs show elements instead of drawing data, and text edits to a drawing are refused.
- New **Background screenshots** setting (on by default) controls canvas pictures. The **Plugin Interconnectivity** description now covers these features.
- The review pipeline accepts `.canvas`, `.base` and `.excalidraw.md` files with format-specific validation, and the open canvas, base or drawing is named in the message context. Automatic selection requires an image-capable model when a canvas or drawing is involved.
- New bundled guides: `owla-canvas`, `owla-bases`, `owla-excalidraw`.

### Community review fixes

- Lint findings from the Obsidian Community review: described lint directives, bound method references, unnecessary type assertions removed, and safe text conversion of Claude Code message blocks.
- Excalidraw edits are safe while a drawing is open in Excalidraw: changed elements are written with a version that wins Excalidraw's merge with its own copy, and Decline or Undo writes a version-aware revert (original elements re-stamped, added elements marked deleted), so an open editor arrives at the original drawing instead of keeping the declined change.

## 3.4.0

Security and vault-confinement fixes ported onto the working 3.2.0/3.3.2 code in small steps, without the 3.3.0/3.3.1 UI changes. No web-search consent bar and no second toolbar indicator; the **Allow web search** setting stays the only switch.

### Vault confinement

- Excluded folders match the way APFS folds names, so `ſecret` or `ςοφία` cannot reach `Secret` or `Σοφία`. Paths are resolved with the OS's own realpath (`realpathSync.native`).
- Paths with NUL, `:`, control characters or a `~` segment are refused. Trailing dots and spaces are refused on Windows only; `Dr.` stays valid on macOS and Linux.
- A hardlinked file (and a symlink to one) is refused for reading, editing and organizing. Folders are not affected.
- Vault path answers are no longer cached across turns, so a symlink swapped outside Obsidian is seen at once. The note picker and vault search keep a cache for one pass only.
- Organization moves refuse a destination folder that is a case or Unicode alias of an existing folder.
- A pending edit record is checked against the excluded folders when it loads. If it cannot be loaded, **Clear pending edit record** restores provisional edits to allowed notes and keeps any record it could not restore.

### Provider isolation

- Codex starts with `notify=[]`, a read-only sandbox, no approvals, no project docs and every non-OWLA capability feature turned off. A feature turned on in your own Codex config is turned off for OWLA's session with one restart; a feature pinned by managed settings stops the connection and is named. Hooks must be off and Codex's runtime hook list must be empty. Stock Codex 0.169.0 with `hooks.json` or hook trust records connects normally. A personal `~/AGENTS.md` is never a reason to refuse.
- Codex turns stop on any activity outside an allowlist: messages, reasoning, plans, OWLA's offered tools and, when allowed, web search.
- Claude Code's MCP bridge and OWLA's own tool dispatcher run only the tools offered for the current turn.
- Module-path, preload and dynamic-library variables (Node, Bun, Python, Perl, `DYLD_*`, `LD_*`) are removed from every provider's environment.
- Pilafdob plugin APIs are accepted only from plugins Obsidian has enabled, and only when the API names that same plugin.

### Rendered replies

- Replies are sanitized after Obsidian renders them: scripts, frames, media, forms, remote images, event handlers, URL attributes, CSS that can fetch (`url()`, `image-set()`, `@import`, CSS escapes) and non-web link schemes are removed. Task checkboxes are read-only. Icons, Mermaid diagrams and MathJax are kept, and Markdown code is never rewritten.

### Long notes and runaway replies

- Fixed: after a proposal was staged, every `read_note` returned the same first 4,000 characters of the preview and ignored the heading or block asked for. A model editing a long note re-read that opening until it gave up (observed live: 50+ reads in 14 minutes on a 61,000-character note).
- `read_note` returns long notes and sections in 12,000-character parts with an exact `offset` continuation, and the first part lists every heading with its size (previously only the first 30). Heading and block reads also work on unsaved editor text and staged previews, and nested headings (`Parent#Child`) resolve.
- A long active note sent with a message says how to continue reading and includes its heading outline.
- Each reply has a tool budget. The same call returning the same result a third time is refused; after 40 calls the model is told to answer; at 50 the reply stops with a note in Sources & activity. An automatic retry on another model starts a fresh budget.
- Automatic selection recognises German edit requests ("füge … zur Liste hinzu", "ergänze die Tabelle"), which were routed like questions. Edits of a note over 20,000 characters are kept off free and tool-unproven models outside Cost mode.

### Split diff view

- The per-hunk and per-line accept/decline buttons from 3.2.0 are removed. The split view shows the pending diff; **Accept** and **Decline** in chat decide the whole batch. In live testing, partial line decisions could drop an accepted line from the note.
- When the diff opens, it and the note scroll so the first change is at the top. Clicking a diff line scrolls the note to that line and briefly highlights it. Scrolling never moves the cursor or selection, and re-renders of the same proposal keep your scroll position.

### Other

- Temporary attachment copies are readable by the user only.
- CI and release workflows pin GitHub Actions to commit SHAs and run the restored vault guard self-test.

## 3.3.2

- Restoration release: the exact 3.2.0 code after the broken, withdrawn 3.3.0 and 3.3.1 updates. Only the version metadata changes, so installs stuck on 3.3.0 or 3.3.1 receive it as an update and return to normal.

## 3.2.0

- Split diff view now supports accepting or declining individual changed hunks, and individual lines within a hunk, with floating check and X icons; partial accepts merge into the accepted note text.

### Fixed

- Calibrated routing no longer reads an undefined attachments list as a crash.
- The per-provider Foundation Models path now records its task kind for later escalation.
- Automatic selection keeps context-window filtering on its fallback path.
- The retry path no longer mixes curated and uncurated model pools or skips the token filter.
- Session model availability now recognises Codex and Claude refusal messages, not only OpenCode-shaped ones.
- Disconnecting a provider clears session availability state and moves active selection away from it.

## 3.1.9

- Scope OpenCode Go paid-model scarcity to Go's own meters in automatic selection, so a low console budget no longer makes Go paid models ineligible or skews their plan-cost weighting. Console budgets remain visible in the usage panel.
- Keep OpenCode console models visible in the one-message override selector.

## 3.1.8

- OpenCode and Claude now require an explicit Connect action, matching Codex. Fresh installs and upgrades without saved consent stay disconnected.
- Background usage refresh, automatic selection and fallback respect connection consent.
- Disconnect targets the correct provider in Automatic settings and persists across restarts.

## 3.1.7

- Settle clear-cut requests with fast local rules and use Apple’s on-device model only for nuanced ones, in Automatic provider mode and in automatic model selection for a single provider.
- Add an automatic selection priority (Cost, Balanced or Intelligence), thorough selection, a privacy mode that keeps note excerpts, outlines, chat topics and filenames out of the on-device classifier, and optional routing details under each reply.
- Load Apple’s on-device model while you type, so selection on Send runs warm (about 1.5 s instead of 4.5 s after a short idle).
- Correct the task kinds and tool needs Apple’s model misjudges, recognise chart and diagram questions, talk scripts and capitalised requests, and keep note edits off models whose tool use through OWLA is unproven unless Cost mode is on or paid plans are nearly used up.
- Run medium-effort work on free models at the higher supported effort, and skip models whose context window is too small for the request.
- Escalate an empty, uncertain or very short reply to multi-step work once to a stronger model, but keep short answers to simple questions.
- Learn from turn outcomes and latency per vault, remember models refused for region or plan reasons for the session, and add commands to clear the history and reload a calibration file from OWLA’s private storage.
- Add a Check automatic selection button in settings, and count tokens with Apple’s tokenizer.

## 3.1.6

- Treat OpenCode’s separate billing sources independently: an empty console balance blocks only its paid models, a depleted Go plan blocks only Go’s paid models, and a model missing from another signed-in provider’s plan is blocked on its own. Free and limited-time free models stay available.
- Remember refusals per pool, model or account until OWLA reloads; limits and balances become usable again after their reported reset, or after 30 minutes.
- Report OpenCode Go meter usage and block Go’s paid models when a meter is full.
- Retry automatic selection up to four more times when a model fails before answering or using a tool, naming the failed model and reason under the reply.
- Leave a connected but exhausted provider out of the one-message override, naming it and its reset time instead of hiding it.

## 3.1.5

- Let the one-message model override show every model from every connected provider, including previous generations and all OpenCode models, instead of the curated automatic-selection shortlist.
- Make automatic selection prefer continuing with the model that served the previous turn when the new request fits it.
- Weigh the real size of a request — attached notes, folders, PDFs, images, selected text, active note and recent chat — when choosing a model and reasoning effort.
- Detect OpenCode models hosted outside the workspace’s allowed privacy regions, explain the restriction once, and skip them in automatic selection while still allowing an explicit choice.
- Retry automatic selection with another model or provider when the chosen one is out of usage or unavailable in the workspace’s privacy regions.
- Reserve the highest reasoning effort for genuinely deep work and clarify the effort anchors.

## 3.1.4

- Merge the Windows-side performance and reliability changes into main: cache vault file access checks and invalidate them on vault create/modify/delete/rename, deduplicate Codex web sources, and make Codex inherited-instruction discovery case-insensitive on Windows.
- Improve Claude Code bridge robustness: case-insensitive PATH handling in the child environment and trimmed JSON line parsing.
- Deduplicate note link targets and use consistent case folding in vault search.
- Cache organization symlink checks and keep the PDF skill's export guidance in the reference pack.
- Remove the stale HANDOFF.md.

## 3.1.3

- Let a one-message model override switch providers mid-reply: the override picker now lists models from every connected provider, including OpenCode models offered by more than one provider, and choosing another provider reconnects for that turn.
- Keep excluded-folder checks, vault search and note reading responsive in large vaults: cache normalized excluded roots, search notes in parallel with cached reads, and reuse cached note text.
- Avoid rewriting unchanged OpenCode workspaces by skipping regeneration when tool and skill definitions match.
- Collect Claude Code web-search sources from structured tool results as well as text matches.
- Prevent Codex disconnect races while requests are still pending, and deduplicate source lists.
- Remove additional non-OWLA tools from OpenCode sessions (todo writes, scheduling, artifacts, image generation).
- Sync the split diff view only when split diff is enabled.

## 3.1.2

- Teach automatic mode about newly added models without code changes: an unknown OpenCode model family is now rated by its own catalogue entry (capable naming such as Pro/Max/Thinking, a large context window, accepted images) instead of counting as unproven, and the shortlist offered to Automatic selection ranks new capable free families ahead of light variants so the limit no longer crowds them out. Adding a curated family remains one line in the family list.
- Recognise OpenCode Go and other providers connected in the OpenCode terminal app: OpenAI and Anthropic models ride along with OpenCode's own, rated by their own family; the same model offered by more than one provider is offered once (cheaper first, then OpenCode Go); paid models keep half of Automatic selection's OpenCode slots so a hard task is not forced onto a free model; and a free-tier limit no longer writes off OpenCode when paid models still work. One-message model overrides now work for OpenCode models, including same-named ones across providers.
- Stop OpenCode from loading configuration and plugins from folders above OWLA's session folder, such as `~/.opencode/plugins`; OWLA's OpenCode settings now live in its private configuration folder.
- Allow each OWLA tool in OpenCode by its exact name, and refuse tool calls OWLA did not offer in the current turn.
- Keep module preload, library injection and TLS-disabling variables away from every assistant, and API keys and endpoint overrides away from Codex and Claude Code.
- Check Codex's isolation before every reply, and refuse to connect when project instructions sit above OWLA's storage folder.
- Match excluded folders regardless of letter case and Unicode form, as macOS and Windows do.
- Fail an OpenCode reply instead of waiting forever when its event stream does not open or closes early.
- Read long assistant messages without blocking Obsidian (a 16 MiB message took up to 1.4 s), and keep the note picker responsive in large vaults.
- On Windows, run command shims only through the system Command Prompt: every assistant's environment pins `ComSpec` to the Windows `cmd.exe`, and a shim is refused when the `ComSpec` variable names another program.
- On Windows, shut down an assistant's process tree more safely: a process that already exited is never targeted again (Windows reuses process IDs quickly), and the system `taskkill` is resolved explicitly before it is used.
- Find assistants on Windows in the standard per-user install folders — npm, pnpm, Scoop, Volta, Bun and Claude Code's native installer — and keep the Windows launch rules covered by automated tests on every platform.

## 3.1.1

- Keep the assistant settings separately for each operating system. With a vault synced between a Mac and a Windows PC, choosing a provider, Automatic mode, models, the fallback or executable paths on one computer no longer changes the other. Each computer starts from the settings saved before this release, and other computers' settings are kept when one saves. Vault settings such as excluded folders stay shared.
- Document where OWLA stores its working folders, that it recreates them while in use, and how to clear a storage folder kept from an earlier build.

## 3.1.0

- Add Windows desktop support for `.exe` and `.cmd` assistant launchers, per-user storage, vault path containment and process-tree cleanup.
- Keep Apple Foundation Models automatic provider and model selection available only on macOS; Windows settings omit both options.
- Resize larger supported images in Obsidian on Windows, and make the Windows synthetic CLI and OpenCode bridge checks part of the automated suite.

## 3.0.2

- Light the sidebar dot green only while the provider's process is running in the background, for Codex, OpenCode and Claude Code alike, instead of whenever the provider is connected. With the Automatic provider, the dot is green while any provider runs.

## 3.0.1

- Stop the Automatic provider from choosing frontier models and maximum effort for easy work. The on-device classification is now calibrated: each kind of work has a difficulty ceiling (only reasoning, research and coding can be rated most difficult), effort is capped by that difficulty, and maximum effort needs rigorous reasoning or research. Long writing from supplied material counts as moderate work.
- Weigh remaining plan usage more strongly in Automatic selection.
- Treat requests that read attachments or edit notes as needing vault tools.
- Retry Automatic selection once after an on-device timeout or unreadable reply, and map more task descriptions to a kind of work.

## 3.0.0

- Add OpenCode as a second provider, and Claude Code as a third. The first setting chooses the assistant, and the other providers' settings stay hidden until one is selected.
- Connect to OpenCode without extra setup: OWLA detects the installed OpenCode, starts a private server with its own password and reads the models and providers connected there.
- Give every provider the same experience. The same vault, PDF, attachment, edit and review flow, the same bundled Obsidian skills, and the same automatic model and reasoning effort selection now work on any of them.
- Add an **Automatic** provider on supported Macs: Apple’s on-device model classifies each request, and OWLA picks the provider, model and reasoning effort from the connected providers’ strengths, cost and remaining usage. Exhausted providers are skipped, and the choice and its reason are shown under the reply.
- Show provider usage limits and budgets in one usage panel.
- Add a fallback provider setting: when the selected provider reports that its usage limit is reached, OWLA serves the next messages with the fallback and returns as soon as the limit resets. With **None**, the chat explains that the provider is depleted and offers the switch instead.
- Explain in the chat when every connected provider is exhausted, and list each provider with its reset time.
- Replace OpenCode's shell, file editing, search and subagent tools with OWLA's own for the session, deny everything else through the session rules, and remove inherited MCP servers.
- Start OpenCode with a private configuration folder, so global OpenCode plugins, permissions and Claude Code skills are not loaded into OWLA's session. Sign-ins and connected providers keep working.
- Run Claude Code headless in safe mode with only OWLA's tools allowed.
- Let the assistant read Obsidian's link graph without opening notes: a note's backlinks, outgoing and broken links, tags and properties; notes by tag (including nested tags) or property value; and vault-wide reports of broken links, orphan notes and tag counts. Excluded folders stay hidden.
- Propose frontmatter property changes for review without rewriting the note body. Names match case-insensitively and other properties are kept.
- Warn the assistant when a proposed edit or new note adds a link, heading link or block link that Obsidian could not resolve, so it can fix the link before you review.
- Read a block by its ID for exact `[[note#^id]]` citations.
- Add **Verify connection** to the Codex settings, as for OpenCode and Claude Code.
- Separate each provider's settings with a line when the Automatic provider shows all of them.

## 2.0.0

- Improve automatic Codex model and reasoning effort selection with model-specific guidance and a compact inventory of attachments.
- Show how to accept the Apple Foundation Models terms with `fm license` and remove the experimental label from automatic selection.
- Add opt-in Plugin Interconnectivity to search Nicons icons and stage Pinup and Folder2Graph changes for review.

## 1.6.1

- Use Obsidian’s file manager for reviewed deletions and require a recoverable trash setting.
- Fix the PDF page action’s unnecessary `await` and the reported CSS compatibility and duplicate-declaration warnings.

## 1.6.0

- Optionally use Apple’s on-device model to choose a compatible Codex model and reasoning effort for each request. Show the chosen model and effort or the fallback in the sidebar.
- Require an explicit first connection in each vault, remember it across reloads, and show only Disconnect when connected.
- Show clickable change cards for reviewed notes, moves, deletions, and PDF annotations.
- Follow Obsidian’s new-note location for bare filenames and preview files or folders before moving them to Trash.
- Add native Markdown formatting and Mermaid guidance, including Obsidian’s colored highlights.

## 1.5.1

- Show PDFs and folders as single attachments. Read PDF pages, folder notes and converted document text on demand.
- Search PDF text by phrase and render scanned pages when requested.
- Bound image payloads and apply the Codex protocol size limit to individual messages.

## 1.5.0

- Review file and folder moves, renames and bulk organization before applying them with Obsidian’s internal link updates.
- Prewarm Codex while typing and show when OWLA’s Codex process is ready or resting.
- Show OWLA in the sidebar, collapse activity during replies, and place Copy Markdown beside Sources & activity.
- Confirm before starting a new chat, with an option to save recent messages.

## 1.4.0

- Attach whole PDFs without a page picker. Codex can fetch later page ranges automatically.
- Attach a folder or a selection of files from the File Explorer. Drag multiple vault or Finder files into chat.
- Draft new Markdown notes from chat and create them on acceptance.

## 1.3.0

- Accept arbitrary file drops and convert larger images and Office/iWork documents locally, with explicit preview or unsupported status.
- Read whole PDFs, resolve page wikilinks and add pages from the PDF viewer context menu.
- Review grouped PDF comments before accepting a separate annotated copy. Protect originals and reject stale sources.
- Choose editor highlights, no automatic diff or a normal split diff pane to the right of the note. Use muted colors without emoji markers.

## 1.2.2

- Prevent suggested edits from repeating the filename as a top Markdown heading when Obsidian shows the inline title.
- Preserve the top title during body edits if the inline title setting cannot be read.

## 1.2.1

- Apply each note’s suggested changes provisionally when the reply finishes.
- Accept or decline changes in chat and open the exact Markdown diff on demand.
- Lock the composer until all pending edits have a decision.
- Restore pending decisions on restart and protect newer note text when declining or undoing changes.

## 1.2.0

- Tighten Markdown spacing around headings, lists and quotes while keeping code indentation and wide blocks scrollable.
- Open vault links from replies in Obsidian and retain the source note path for relative links in new saved chats.
- Use Obsidian's sidebar background and divider colors, remove the current-note strip, and group completed activity with sources.
- Place copy icons inline and remove hover labels from the chat area and composer.

## 1.0.1

- Clear sent text and attachments immediately while Codex responds. Restore failed or stopped drafts without overwriting new work.
- Add Copy to sent messages, including saved chats, and make message text selectable.
- Render PDF page images even when Obsidian is in the background.
- Validate Codex responses, model settings, saved chats and PDF data. Run the source checks identified by Obsidian’s review in local lint and CI.
- Discover and launch Codex directly without a shell lookup. Keep the optional ZIP and checksums separate from the three Community release assets.

## 1.0.0 — 2026-11-04

First public release for Community submission. Replaces the earlier local-model development builds with Codex using an existing ChatGPT login.

- Native sidebar chat with current unsaved note context, selection capture, note attachments and source details.
- Image paste/upload/drop and selected-page PDF text or image attachments.
- Automatic vault tools and optional web search, without manual chat modes.
- Provider model/reasoning selection and actual Codex account usage windows in settings.
- Reviewed edit proposals, pre-edit recovery snapshots, freshness/YAML checks and guarded Undo.
- Saved chats with per-vault storage and bounded conversation replay.
- Backend shutdown after each reply with automatic continuation on the next message.
- Bundled Obsidian Markdown/Bases/Canvas skills and PDF/MathJax/image guidance.
- Phosphor bird, OWLA responder labels, accessible connection dot and responsive narrow-pane controls.
- Community installation support with skills and licence notices embedded in the three required files; searchable settings and explicit privacy/cost disclosures.

Requires macOS desktop Obsidian 1.14.5+, separately installed Codex CLI 0.162.1+, an eligible ChatGPT login and network access. No local model/runtime downloader, API-key authentication or automatic Codex installer is included. Existing development-build exclusions, storage and saved work are retained on migration.

## 0.2.0 — internal development

Transitioned the assistant from local inference to the Codex app-server protocol. Not released to the Community directory.

## 0.1.0 — internal development

Initial sidebar, context, attachments and reviewed editing. Included experimental local inference that is no longer part of this plugin. Not released to the Community directory.
