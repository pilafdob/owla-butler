# Changelog

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
