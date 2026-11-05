<p align="center"><img src="assets/bird.svg" alt="OWLA Butler bird" width="64" height="64"></p>

# OWLA Butler

A native Obsidian assistant powered by your installed, signed-in Codex CLI. Ask naturally, attach screenshots or PDFs, work with your open note and review suggested changes. There are no chat modes to select.

## Requirements and cost

- **Desktop Obsidian 1.14.5 or newer.** This release is tested on macOS (8 GB M2 Air). Windows, Linux and mobile are not supported by this release.
- **Codex CLI 0.162.1 or newer**, installed separately, and an eligible ChatGPT/Codex account. An internet connection is required for answers, sign-in, model discovery and quota checks.
- OWLA is free and MIT licensed. OpenAI may require a paid plan or credits for your chosen model or usage; access and limits depend on your account. The tested account was ChatGPT Plus. There is no OWLA subscription or API-key billing integration. Check [current Codex access and pricing](https://learn.chatgpt.com/docs/pricing).

OWLA is an independent project, unaffiliated with Obsidian or OpenAI. Install **OWLA Butler** from Community plugins, or use the three files from the [latest GitHub release](https://github.com/pilafdob/owla-butler/releases/latest).

## Features

- Chat with your open note, including unsaved text, selections and additional notes.
- Paste screenshots, attach images and select individual PDF pages.
- Search allowed vault notes and the web, with source details.
- Accept or decline provisional note edits in the chat, with an optional source diff.
- Choose Codex models and reasoning effort; see provider-reported usage limits.
- Keep the same chat while the backend automatically stops between replies.

## Setup

1. Install Codex CLI 0.162.1 or newer and sign in with ChatGPT. If Codex already works in your terminal, no additional account setup is needed. [Official Codex authentication](https://developers.openai.com/codex/auth).
2. Search for **OWLA Butler** in Settings → Community plugins, install and enable it. For manual installation, create `<vault>/.obsidian/plugins/owla-butler/` and copy **main.js**, **manifest.json** and **styles.css** from the same release into it. Alternatively, unzip the distribution and move its `owla-butler` folder there. Restart Obsidian or reload Community plugins, then enable OWLA Butler.
3. Open Settings → OWLA Butler → **Connect Codex**. OWLA detects the CLI, reuses the existing login and loads the model/reasoning options. No API key is requested. A green dot means your Codex login is ready, even while the backend process is sleeping; red means disconnected or not authenticated. A signed-out account can use **Sign in** to open Codex’s browser login.
4. Open the bird sidebar and send a message. Subsequent connection/startup is automatic. A red status dot can also be clicked to reconnect; green means connected. The dot has a tooltip and accessible label.

OWLA checks common install directories and its inherited PATH. If detection fails, choose the Codex executable in settings. OWLA does not run a login shell to discover it or install or update Codex. This release supports macOS desktop and was tested on an 8 GB M2 Air. It uses the official Codex app-server protocol over local process pipes. Codex handles hosted inference and authentication; OWLA does not read/copy credentials or use a separately billed API key. Codex subscription limits and account/workspace policies apply.

## Everyday use

The sidebar starts with a clean message area. Choose the **model** and **reasoning effort** beside the composer; options come from Codex, not a hard-coded list. Reply headings say **OWLA**. Send with Enter; Shift–Enter inserts a newline. Sending clears the text and attachments from the composer immediately. Use the copy icon beside a sent message or OWLA reply. Vault links in replies open in Obsidian. Stop or a failed request restores the original draft and attachments if the composer is empty. If you have started a newer draft, **Restore draft** on the failed reply lets you recover the earlier one after sending or clearing the newer draft.

Your current Markdown note includes unsaved editor text and the captured cursor/selection. Focus stays associated with that note when you move into chat. Right-click selected text → **Add selection to OWLA Butler**, use **Add note**, or name another note in your request. Codex can search/read allowed Markdown notes itself and cite exact paths. To search, OWLA lists Markdown notes through Obsidian, filters excluded paths and scans eligible notes up to 250 KB locally. The search result returns up to five matching paths and short excerpts from the top two. No vault-wide upload or index is created.

Attach/paste/drop PNG, JPEG or WebP images (up to two, 10 MB each); images are resized locally to 1024 px on the long edge. PDFs up to 20 MB open a physical-page picker: attach extracted text or a rendered page image. Up to two text pages per message; long page text is shortened. Codex chooses how to use the attachments. For transcription, ask it to preserve visible symbols and mark uncertainty. Whole-document/automatic multi-page and password-protected PDF handling are unsupported.

Web search is enabled by default so Codex can check current facts when needed. Turn it off in settings if unwanted. Selected note contents, attachments and recent chat are processed by OpenAI; web queries may draw on that context. Responses expose readable activity, used note/page sources and linked web references. Source links do not guarantee that every interpretation is correct.

## Privacy, network access and files outside the vault

**This is a cloud-backed assistant.** On sending a message, your current note snapshot (including unsaved text), explicit selections/attachments, bounded recent chat and any allowed notes requested by Codex are sent to OpenAI through Codex. It does not upload the whole vault. Web search is on by default; queries can include supplied context. Disable it in settings when needed. Provider processing, retention and account controls follow [OpenAI’s Codex data guidance](https://developers.openai.com/codex/security).

OWLA makes no separate telemetry or advertising requests. It explicitly disables optional Codex analytics, feedback uploads and OpenTelemetry exporters for its own child process and checks the effective settings before starting a conversation. This does not disable the network traffic needed to provide Codex authentication, model discovery, quota reporting, inference and optional web search. Global Codex settings are left unchanged.

OWLA uses Node/Electron to check executable paths, launch the Codex CLI directly with fixed arguments, and verify that note paths resolve inside the vault. The assistant cannot supply shell commands or access native files. The plugin reads note contents and applies approved edits through Obsidian’s API. Clipboard access is limited to an explicit copy action and attachments supplied in a paste event; OWLA does not inspect the clipboard in the background. The CLI uses its own account/configuration/application files, normally under `~/.codex`; OWLA does not read or copy credentials. Browser sign-in opens the URL returned by Codex. OWLA does not install or update Codex or other software.

OWLA writes saved chats, pending edit decisions and pre-edit recovery snapshots **outside the vault**, by default under `~/Library/Application Support/OWLA Butler/vaults/<vault-id>/`. A storage folder retained from an earlier build remains in use. Private per-vault working directories are also created there for ephemeral Codex sessions. Plugin preferences live in Obsidian’s plugin `data.json`. No vault notes are moved. These files can contain note text: review them before sharing, syncing or deleting them. Codex may separately maintain its own diagnostic/application state; ephemeral agent conversations are requested by OWLA.

## Actual usage limits

Settings → OWLA Butler shows the account quota windows returned by Codex: percentage used/remaining, reset times and any reported available reset count. These are provider-reported limits, not a guessed message/token counter. The tracker refreshes after responses, when settings opens and with **Refresh usage**. It shows the report timestamp and preserves a clearly labelled last snapshot if refresh fails. Unavailable data stays unavailable rather than becoming “0% used.” No background polling, automatic purchases or reset redemption occur. [Codex quota protocol](https://developers.openai.com/codex/app-server).

## Edits and recovery

Ask OWLA to make the changes you want in the note. Once the reply finishes, OWLA groups changes by note and applies each group provisionally. **Accept** keeps the current text, **Decline** restores the previous snapshot, and **View diff** shows the exact Markdown additions and removals. The composer unlocks after you decide on every pending group. Insert and append buttons also create provisional changes.

OWLA stores each pending decision and a private recovery snapshot before writing. Pending decisions return when you reopen the sidebar or restart Obsidian. Decline only restores a note that still matches the applied text. If you edit the note while deciding, you can accept the current text. The Undo command for an accepted edit also checks the applied snapshot before restoring. Snapshots retain at most 20 entries within 5 MB per vault. The pending record is capped at 10 MB.

Hidden/configuration files, excluded paths, traversal and symlinks escaping the vault are denied. Configure excluded vault-relative folders in settings. Codex shell execution, native filesystem access, inherited MCP integrations/connectors and direct writes are disabled for OWLA sessions. File tools currently support Markdown reads, searches and provisional updates, not arbitrary move/rename/delete or Bases/Canvas editing.

## Chat and resources

New chat clears transient conversation and attachments. Save/open/delete recent chats through the chat menu or command palette. Chats are saved only when you choose Save recent chat. New saves include the source note path used to resolve relative links. Saves contain the last three exchanges, without images/attachments or edit buttons; at most 20 saves, with confirmed deletion. Runtime chat context uses up to six recent exchanges / 64,000 text characters and the two most recent images; shortening is announced. Recent PDF-page/selection/attached-note context and images stay in memory for follow-up questions across backend shutdowns, so you do not need to attach them again. Raw attachments are excluded from saved-chat files; quoted material in the saved answer remains ordinary chat text.

Saved chats and recovery files live under `<storage>/vaults/<vault-id>/`. Earlier storage and recovery files are preserved during migration. A chosen folder can be synced by other software. Codex manages its own authentication and application state; OWLA uses ephemeral agent conversations.

There are no downloaded models, Ollama servers or native OCR runtimes. OWLA starts its own Codex process on demand, then shuts down the whole owned process group after every response. The next message automatically restores recent chat context in a new backend process; no new chat or manual reconnect is needed. Stop, disabling the plugin and closing the chat terminate/interrupt only OWLA-owned work; your terminal or desktop Codex sessions are left running.

## Skills and verification

Original Obsidian Markdown, Bases and JSON Canvas skills, all references and licence are bundled. OWLA PDF, MathJax and image/transcription guidance is also retained and available through read_reference. These are instructions, not model training.

See CAPABILITY-CHECKLIST.md and TESTING.md for the eight requested checks, real question results and limits. AUDIT.md and RELEASE-CANDIDATE.md identify the candidate and release gate.

## Examples

- “Compare my biology notes with Exam Plan; cite the exact paths and separate evidence from your suggested schedule.”
- “What information is missing from this note? Don’t invent it.”
- “Improve this paragraph without changing its citation keys, links or meaning.”
- Attach an equation: “Transcribe this faithfully and prepare an insertion below Worked example.”
- Attach a PDF page: “Summarise this page with its filename and page reference.”
- “Check the official documentation for current Obsidian callout syntax and link the source.”

## Update, stop and uninstall

Disable OWLA, copy updated packaged files into the existing plugin folder, preserve `data.json`, then re-enable. For earlier local-inference development builds → 1.0, settings migrate to Codex and retain exclusions/storage; local-model configuration is removed. Original backups and saved work are preserved.

Stop cancels the request. Disconnect is also available in settings. To uninstall, disable and remove the plugin folder. Keep or separately remove external saved chats/recovery files after reviewing them. OWLA does not uninstall Codex, erase its login or change global Codex configuration.

## Development

```sh
npm ci
npm run check
npm run lint
npm test
npm run build
npm run check:release
node scripts/package.mjs
```

The generated ZIP includes an `owla-butler/` root, required plugin files, guides, skills and licences. The three Community installation files also contain the icon, skills/references and required licence notices. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks, [CHANGELOG.md](CHANGELOG.md) for changes and [COMMUNITY-RELEASE.md](COMMUNITY-RELEASE.md) for the maintainer submission checklist. Starting with 1.0.1, GitHub release attachments contain only the three files Obsidian installs. The optional ZIP and checksum list are stored separately with the release workflow run; you can also generate them locally with the commands above.

## Licence and credits

OWLA Butler: [MIT](LICENSE). The bird icon is from [Phosphor Icons](https://github.com/phosphor-icons/core) (MIT). The original Obsidian Markdown, Bases and Canvas skills are from [Steph Ango’s Obsidian Skills](https://github.com/kepano/obsidian-skills) (MIT). Reviewed diffs use [jsdiff](https://github.com/kpdecker/jsdiff) (BSD-3-Clause). Complete notices are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), the assets folder and the built plugin. Obsidian and Codex are separate products with their own terms.
