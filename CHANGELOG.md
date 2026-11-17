# Changelog

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
