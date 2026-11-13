# Changelog

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
