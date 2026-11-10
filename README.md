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
- Paste screenshots and attach images, documents, whole PDFs or individual PDF pages.
- Search allowed vault notes and the web, with source details.
- Accept or decline provisional note edits in the chat, with an optional source diff.
- Review file and folder moves or renames as one batch, including new folders and affected links.
- Choose Codex models and reasoning effort; see provider-reported usage limits.
- Keep the same chat while the backend automatically stops between replies.

## Setup

1. Install Codex CLI 0.162.1 or newer and sign in with ChatGPT. If Codex already works in your terminal, no additional account setup is needed. [Official Codex authentication](https://developers.openai.com/codex/auth).
2. Search for **OWLA Butler** in Settings → Community plugins, install and enable it. For manual installation, create `<vault>/.obsidian/plugins/owla-butler/` and copy **main.js**, **manifest.json** and **styles.css** from the same release into it. Alternatively, unzip the distribution and move its `owla-butler` folder there. Restart Obsidian or reload Community plugins, then enable OWLA Butler.
3. Open Settings → OWLA Butler → **Connect Codex**. OWLA detects the CLI, reuses the existing login and loads the model/reasoning options. No API key is requested. A green dot means OWLA’s Codex process is running and ready. The dot is gray while the process starts, stops or rests. Hover to see the current state or connection error. A signed-out account can use **Sign in** to open Codex’s browser login.
4. Open the bird sidebar and send a message. Subsequent connection/startup is automatic. A red status dot can also be clicked to reconnect; green means connected. The dot has a tooltip and accessible label.

OWLA checks common install directories and its inherited PATH. If detection fails, choose the Codex executable in settings. OWLA does not run a login shell to discover it or install or update Codex. This release supports macOS desktop and was tested on an 8 GB M2 Air. It uses the official Codex app-server protocol over local process pipes. Codex handles hosted inference and authentication; OWLA does not read/copy credentials or use a separately billed API key. Codex subscription limits and account/workspace policies apply.

## Everyday use

The sidebar starts with a clean message area. Choose the **model** and **reasoning effort** beside the composer; options come from Codex, not a hard-coded list. Reply headings say **OWLA**. Send with Enter; Shift–Enter inserts a newline. Sending clears the text and attachments from the composer immediately. Expand **Working** for details during a reply. Afterward, the **Copy Markdown** icon sits beside **Sources & activity**. You can also copy your sent messages. Vault links in replies open in Obsidian. Stop or a failed request restores the original draft and attachments if the composer is empty. If you have started a newer draft, **Restore draft** on the failed reply lets you recover the earlier one after sending or clearing the newer draft.

Your current Markdown note includes unsaved editor text and the captured cursor/selection. Focus stays associated with that note when you move into chat. Right-click selected text → **Add selection to OWLA Butler**, use **Add note**, or name another note in your request. Codex can search/read allowed Markdown notes itself and cite exact paths. To search, OWLA lists Markdown notes through Obsidian, filters excluded paths and scans eligible notes up to 250 KB locally. The search result returns up to five matching paths and short excerpts from the top two. No vault-wide upload or index is created.

Paste screenshots, drop files or use **Attach**. Add whole PDFs from the file explorer or chat. OWLA extracts page-labelled text and Codex can request more pages, including rendered scans. Use **Add page to OWLA** in the PDF viewer to attach a specific page. For transcription, ask it to preserve visible symbols and mark uncertainty.

Web search is enabled by default so Codex can check current facts when needed. Turn it off in settings if unwanted. Selected note contents, attachments and recent chat are processed by OpenAI; web queries may draw on that context. Responses expose readable activity, used note/page sources and linked web references. Source links do not guarantee that every interpretation is correct.

## Privacy, network access and files outside the vault

**This is a cloud-backed assistant.** On sending a message, your current note snapshot (including unsaved text), explicit selections/attachments, bounded recent chat and any allowed notes requested by Codex are sent to OpenAI through Codex. It does not upload the whole vault. Web search is on by default; queries can include supplied context. Disable it in settings when needed. Provider processing, retention and account controls follow [OpenAI’s Codex data guidance](https://developers.openai.com/codex/security).

OWLA makes no separate telemetry or advertising requests. It explicitly disables optional Codex analytics, feedback uploads and OpenTelemetry exporters for its own child process and checks the effective settings before starting a conversation. This does not disable the network traffic needed to provide Codex authentication, model discovery, quota reporting, inference and optional web search. Global Codex settings are left unchanged.

OWLA uses Node/Electron to check executable paths, launch the Codex CLI directly with fixed arguments, and verify that note paths resolve inside the vault. The assistant cannot supply shell commands or access native files. The plugin reads note contents and applies approved edits through Obsidian’s API. Clipboard access is limited to an explicit copy action and attachments supplied in a paste event; OWLA does not inspect the clipboard in the background. The CLI uses its own account/configuration/application files, normally under `~/.codex`; OWLA does not read or copy credentials. Browser sign-in opens the URL returned by Codex. OWLA does not install or update Codex or other software.

OWLA writes saved chats, pending review journals and pre-edit recovery snapshots **outside the vault**, by default under `~/Library/Application Support/OWLA Butler/vaults/<vault-id>/`. A storage folder retained from an earlier build remains in use. Private per-vault working directories are also created there for ephemeral Codex sessions. Plugin preferences live in Obsidian’s plugin `data.json`. These files can contain note text: review them before sharing, syncing or deleting them. Codex may separately maintain its own diagnostic/application state; ephemeral agent conversations are requested by OWLA.

## Actual usage limits

Settings → OWLA Butler shows the account quota windows returned by Codex: percentage used/remaining, reset times and any reported available reset count. These are provider-reported limits, not a guessed message/token counter. The tracker refreshes after responses, when settings opens and with **Refresh usage**. It shows the report timestamp and preserves a clearly labelled last snapshot if refresh fails. Unavailable data stays unavailable rather than becoming “0% used.” No background polling, automatic purchases or reset redemption occur. [Codex quota protocol](https://developers.openai.com/codex/app-server).

## Edits and recovery

Ask OWLA to make the changes you want in the note. Once the reply finishes, OWLA groups changes by note and applies each group provisionally. **Accept** keeps the current text, **Decline** restores the previous snapshot, and **View diff** shows the exact Markdown additions and removals. The composer unlocks after you decide on every pending group. Insert and append buttons also create provisional changes.

OWLA stores each pending decision and a private recovery snapshot before writing. Pending decisions return when you reopen the sidebar or restart Obsidian. Decline only restores a note that still matches the applied text. If you edit the note while deciding, you can accept the current text. The Undo command for an accepted edit also checks the applied snapshot before restoring. Snapshots retain at most 20 entries within 5 MB per vault. The pending record is capped at 10 MB.

Hidden/configuration files, excluded paths, traversal and symlinks escaping the vault are denied. Configure excluded vault-relative folders in settings. Codex shell execution, native filesystem access, inherited MCP integrations/connectors and direct writes are disabled for OWLA sessions.

### Organize files and folders

Ask OWLA to move or rename files and folders. Open **Review paths** to see each old and new path, the folders to create, and Markdown notes whose links may change. **Accept** runs the batch through Obsidian’s file manager. **Decline** clears the proposal. Organization always needs a path review, regardless of the Markdown Diff view setting, and is submitted separately from content edits.

Turn on **Automatically update internal links** in Obsidian’s Files and links settings to accept a batch. OWLA refuses conflicting, overlapping or excluded paths and batches that could update links in an excluded Markdown note. If relevant files or links changed after review, reopen the preview. OWLA records progress and backs up affected Markdown before applying. If a partial failure cannot be safely reversed, the chat shows the recovery record so you can inspect the paths before continuing.

## Chat and resources

**New chat** asks before clearing an existing conversation, draft or attachments. **Save and start new** saves recent messages before clearing the chat. Save, open and delete recent chats through the chat menu or command palette. Chats are saved only when you choose Save recent chat. New saves include the source note path used to resolve relative links. Saves contain the last three exchanges, without images/attachments or edit buttons; at most 20 saves, with confirmed deletion. Runtime chat context uses up to six recent exchanges / 64,000 text characters and the two most recent images; shortening is announced. Recent PDF-page/selection/attached-note context and images stay in memory for follow-up questions across backend shutdowns, so you do not need to attach them again. Raw attachments are excluded from saved-chat files; quoted material in the saved answer remains ordinary chat text.

Saved chats and recovery files live under `<storage>/vaults/<vault-id>/`. Earlier storage and recovery files are preserved during migration. A chosen folder can be synced by other software. Codex manages its own authentication and application state; OWLA uses ephemeral agent conversations.

There are no downloaded models, Ollama servers or native OCR runtimes. Typing in the focused composer starts OWLA’s Codex process after a short debounce. An unused warm process stops after 20 seconds without input, when the draft is cleared, or when you leave the window or close the sidebar. Sending takes over the warm startup if it is still running. OWLA shuts down its process after the reply and any concurrent account check finish. The next message automatically restores recent chat context in a new backend process; no new chat or manual reconnect is needed. Stop, disabling the plugin and closing the chat terminate/interrupt only OWLA-owned work; your terminal or desktop Codex sessions are left running.

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


### Attachments and experimental editor diff

Right-click a folder or a multi-file selection in the File Explorer and choose **Add folder to OWLA chat** or **Add files to OWLA chat**. Folder attachments include nested files and respect exclusions. You can also drop multiple files from Obsidian or Finder into chat.

Drop files into chat or use Attach. OWLA prepares files locally before Send becomes available. PNG/JPEG/WebP images are resized, and macOS image conversion handles formats such as HEIC, TIFF and BMP, including images over 10 MB. Whole-PDF attachments also accept larger PDFs.

Word DOCX, PowerPoint PPTX, Excel XLSX and OpenDocument files provide extracted text. On macOS, Pages, Keynote and Numbers use an installed Apple app to export a temporary copy to Office format. macOS may request Automation permission. The original file is never opened for conversion. Temporary copies and exports are deleted afterward. If full extraction fails, an embedded or Quick Look preview is labelled **Preview only**. Unsupported files stay attached with **Content unavailable**, so the assistant can explain the limitation. Audio, video and arbitrary binary formats do not gain full understanding from an attachment alone.

Extraction retains paragraph, slide and sheet source names. It does not preserve every diagram, chart or page layout. Text is bounded and explicitly labelled when shortened. Large originals are converted locally, with only the prepared text/images included on Send.

Choose **Highlights in editor**, **None** or **Split diff view** in the Diff view setting. Highlights in editor shows temporary subtle green additions and red removed-text blocks in the Markdown editor. Split diff view opens the same source diff as View diff in a normal Obsidian split to the right of the note. Accept and Decline remain in chat, and resolving the last pending edit closes the diff pane. The overlay uses theme colors, clears on Accept/Decline, and hides when the pending text changes. It never writes markers into the Markdown. Source View diff remains available in chat.

Ask OWLA to create a note from the conversation. It drafts the Markdown at a new path in the vault root or an existing folder you specify. Use **View diff** to review the draft, then **Accept** to create it or **Decline** to discard it. Existing files are protected.

### PDFs

Attach or drop a PDF to give Codex access to the whole document. OWLA sends page-labelled text and prepared scan images, and Codex can fetch later page ranges automatically when the initial context budget is reached. The PDF chip shows the page count. For a single page, use Add page to OWLA in the PDF viewer. The read_pdf tool also supports visual reading of scans and diagrams. References such as [[Books/Study.pdf#page=3]] resolve through the vault. OCR uses Codex's visual input and does not rewrite the PDF.

Right-click a PDF page in the Obsidian viewer to add it to OWLA, copy its page link, or copy selected text. This plugin menu provides those actions for PDF pages. The ordinary PDF toolbar remains available.

PDF comments follow a stricter review path than Markdown. Suggested comments are grouped per PDF and shown with page numbers. Review and accept them to create a separate annotated copy, or Decline to discard them. No PDF annotations are applied before acceptance. The source bytes are checked again before saving. Resolve PDF proposals before sending the next message. Annotation proposals stay in memory until resolved or the plugin is unloaded. Comments use standard PDF text annotations. They do not yet support arbitrary ink drawings, redactions or editing PDF text.
