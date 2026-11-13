<p align="center"><img src="assets/bird.svg" alt="OWLA Butler bird" width="88" height="88"></p>

<h1 align="center">OWLA Butler</h1>

<p align="center">
  <strong>Your Codex, OpenCode or Claude Code assistant, inside Obsidian.</strong><br>
  Chat with your open note, attach images and PDFs, search your vault and the web,<br>
  and review every edit before it lands.
</p>

<p align="center">
  <a href="https://github.com/pilafdob/owla-butler/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/pilafdob/owla-butler?label=release&color=blue"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://obsidian.md"><img alt="Obsidian 1.14.5+" src="https://img.shields.io/badge/Obsidian-1.14.5%2B-7c3aed"></a>
  <img alt="macOS and Windows" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> · <a href="#features">Features</a> · <a href="#how-it-works">How it works</a> · <a href="https://github.com/pilafdob/owla-butler/releases/latest">Download</a>
</p>

OWLA Butler is a native Obsidian sidebar assistant that runs on an assistant CLI you already installed and signed in to — **Codex**, **OpenCode** or **Claude Code**. There are no chat modes to pick and no separate OWLA account: it reuses your existing login, models and plan limits. Every change it proposes is applied provisionally and waits for your **Accept** or **Decline**.

### Why OWLA Butler?

- **Works with what you have.** Reuses Codex, OpenCode or Claude Code instead of adding another API key or subscription.
- **Vault-aware, not vault-wide.** Reads your open note (including unsaved text), selections, attachments and allowed notes on demand. No background index, no whole-vault upload.
- **Review before write.** Edits, moves, renames and deletions are staged for approval, with diffs and recovery snapshots.
- **Same flow everywhere.** Switch providers without learning a new interface; the review flow and bundled Obsidian skills stay the same.

## Quick start

1. **Install a provider CLI** — Codex 0.162.1+, OpenCode 2.2+ or Claude Code 2.1.322+ — and sign in. If it works in your terminal, OWLA can use it.
2. **Install OWLA Butler** from Obsidian's Community plugins, or copy `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/pilafdob/owla-butler/releases/latest).
3. **Open Settings → OWLA Butler**, pick your provider, then open the bird sidebar and send a message.

> Desktop Obsidian 1.14.5+ on macOS or Windows. Linux and mobile are not supported yet.

## Requirements and cost

- **Desktop Obsidian 1.14.5 or newer on macOS or Windows.** Linux and mobile are not yet supported.
- **Codex CLI 0.162.1 or newer, OpenCode 2.2 or newer, or Claude Code 2.1.322 or newer**, installed separately, and an eligible account. An internet connection is required for answers, sign-in, model discovery and quota checks.
- OWLA is free and MIT licensed. OpenAI may require a paid plan or credits for your chosen model or usage; access and limits depend on your account. OpenCode may serve free models and may charge for the providers you connect there. Anthropic applies the limits of your Claude plan. There is no OWLA subscription or API-key billing integration. Check [current Codex access and pricing](https://learn.chatgpt.com/docs/pricing).

OWLA is an independent project, unaffiliated with Obsidian, OpenAI, OpenCode or Anthropic. Install **OWLA Butler** from Community plugins, or use the three files from the [latest GitHub release](https://github.com/pilafdob/owla-butler/releases/latest).

## Features

- Chat with your open note, including unsaved text, selections and additional notes.
- Paste screenshots and attach images, documents, whole PDFs or individual PDF pages.
- Search allowed vault notes and the web, with source details.
- Accept or decline provisional note edits in the chat, with an optional source diff.
- Review file and folder moves or renames as one batch, including new folders and affected links.
- Choose models and reasoning effort; see provider-reported usage limits.
- Ask about your vault's structure: backlinks, broken links, orphan notes, tags and properties come straight from Obsidian's own metadata, without reading every note.
- Change properties as a reviewed edit that leaves the note body untouched. Proposed links that would not resolve are caught before you review them, and cited blocks (`[[note#^id]]`) can be read exactly.
- Switch between Codex, OpenCode and Claude Code, with the same features, skills and review flow on all of them.
- Keep the same chat while the backend automatically stops between replies.

## Setup

1. Install the assistant you want. For Codex, install Codex CLI 0.162.1 or newer and sign in with ChatGPT. For OpenCode, install OpenCode 2.2 or newer and connect a provider there. For Claude Code, install Claude Code 2.1.322 or newer and sign in. If the tool already works in your terminal, no additional account setup is needed.
   - On Windows, use the [official standalone OpenCode CLI](https://opencode.ai/docs/) and put `opencode.exe` in `%LOCALAPPDATA%\Programs\OpenCode`. OWLA detects it there; add that directory to your user `PATH` if you also want `opencode` available in Command Prompt or PowerShell. Restart open terminals after changing `PATH`.
2. Search for **OWLA Butler** in Settings → Community plugins, install and enable it. For manual installation, create `<vault>/.obsidian/plugins/owla-butler/` and copy **main.js**, **manifest.json** and **styles.css** from the same release into it. Alternatively, unzip the distribution and move its `owla-butler` folder there. Restart Obsidian or reload Community plugins, then enable OWLA Butler.
3. Open Settings → OWLA Butler. The first setting is **Assistant provider**. Choose Codex, OpenCode or Claude Code. The other providers' settings stay hidden until you select one.
   - **Codex**: choose **Connect Codex** once per vault. OWLA waits for this action before starting Codex. It detects the CLI, reuses the existing ChatGPT login and loads the available models. If Codex is signed out, choose **Sign in** when it appears and complete the browser login.
   - **OpenCode**: nothing else is needed. OWLA detects the installed OpenCode, starts it on demand and reads the models and providers you connected there. Choose **Verify connection** to check it early.
   - **Claude Code**: nothing else is needed. OWLA detects the installed Claude Code, reuses your Claude login and reads the models your plan allows. Choose **Verify connection** to check it early.
4. Open the bird sidebar and send a message. OWLA remembers the connection across reloads and starts the assistant on demand. A green sidebar dot means the assistant's process is running in the background; it turns grey again when the process rests. Claude Code runs only while a reply or check is under way. Hover over the dot for its status.

The assistant settings are kept separately for each operating system: the provider, **Automatic** mode, automatic model and reasoning effort, the fallback, each provider's model and effort, web search, the Codex connection and the executable paths. When a vault is synced between a Mac and a Windows PC, changing them on one computer leaves the other unchanged. Each computer starts from the settings saved before 3.1.1. Excluded folders, the storage folder, the review view and Plugin Interconnectivity stay shared by the vault.

OWLA checks common install directories and its inherited PATH. If detection fails, choose the executable in settings. OWLA does not run a login shell to discover it, and it does not install or update any of these tools. For Codex it uses the official app-server protocol over private process pipes. For OpenCode it starts a private local server with its own password, and reaches the vault only through OWLA's own tools. For Claude Code it runs the CLI headless in safe mode and offers only OWLA's tools through a private in-process MCP server. Each assistant handles hosted inference and authentication; OWLA does not read or copy credentials and does not use a separately billed API key. Codex subscription limits, OpenCode's own plan and provider limits, and your Claude plan limits apply.

On Windows, OWLA can discover and launch native executables and npm `.cmd` launchers from PATH or common install folders. The default OWLA data folder is `%LOCALAPPDATA%\OWLA Butler`; existing saved work remains in its previously chosen folder.

## Everyday use

The sidebar starts with a clean message area. Choose the **model** and **reasoning effort** beside the composer; options come from the selected provider, not a hard-coded list. Reply headings say **OWLA**. Send with Enter; Shift–Enter inserts a newline. Sending clears the text and attachments from the composer immediately. Expand **Working** for details during a reply. Afterward, the **Copy Markdown** icon sits beside **Sources & activity**. You can also copy your sent messages. Vault links in replies open in Obsidian. Stop or a failed request restores the original draft and attachments if the composer is empty. If you have started a newer draft, **Restore draft** on the failed reply lets you recover the earlier one after sending or clearing the newer draft.

Your current Markdown note includes unsaved editor text and the captured cursor/selection. Focus stays associated with that note when you move into chat. Right-click selected text → **Add selection to OWLA Butler**, use **Add note**, or name another note in your request. The assistant can search and read allowed Markdown notes itself and cite exact paths. To search, OWLA lists Markdown notes through Obsidian, filters excluded paths and scans eligible notes up to 250 KB locally. The search result returns up to five matching paths and short excerpts from the top two. No vault-wide upload or index is created.

Paste screenshots, drop files or use **Attach**. Add whole PDFs from the file explorer or chat. The assistant reads the relevant text or renders specific scanned pages on demand. Use **Add page to OWLA** in the PDF viewer to attach a specific page. For transcription, ask it to preserve visible symbols and mark uncertainty.

Web search is enabled by default so the assistant can check current facts when needed. Turn it off in settings if unwanted. Selected note contents, attachments and recent chat are processed by the selected provider; web queries may draw on that context. Responses expose readable activity, used note/page sources and linked web references. Source links do not guarantee that every interpretation is correct.

### Automatic provider

On macOS, choose **Automatic** as the assistant provider to let OWLA pick the provider, model and reasoning effort for each message. Apple’s on-device model classifies the request on your Mac (difficulty, kind of work, whether vault tools are needed). OWLA then weighs every connected provider's current models by what they are good and bad at, their cost on your plans and how much usage is left, and shows the choice and the reason under the reply. Exhausted providers are skipped. If the chosen model fails before it has answered or used a vault tool, OWLA resends the message through the next choice, up to four more times, and notes under the reply which model failed and why. Each message is sent to the one provider it was routed to.

OpenCode combines several separate sources of usage, and one of them running dry leaves the others available. An empty OpenCode console balance rules out only the console's paid models. A depleted OpenCode Go plan rules out only Go's paid models: the console's free models and Go's limited-time free models stay available. A model that another provider signed in to OpenCode lists but your plan there does not include, for example a Claude Opus model on a GitHub Copilot plan without it, is ruled out on its own after its first refusal. Plan refusals are remembered until OWLA reloads; limits and balances are tried again once their reported reset passes, or after 30 minutes.

**Why a connected provider can be missing from the one-message override.** The override lists only models that can take a message now. A connected provider that is out of usage, such as Codex after its limit is reached, is left out until its limit resets, and so is a provider that could not be reached. The override window names each provider it left out, with the reason and, for a reached limit, the reset time. Before choosing, OWLA reads a provider's usage again when its last report is older than ten minutes. With Automatic selected, the per-provider **Automatic model and reasoning effort** setting is not needed and is shown as on. **Automatic provider selection is not available on Windows or Linux.**

### Automatic model and reasoning effort

On a supported macOS 27 Mac, open Terminal and run `fm license`. Review and accept Apple’s Foundation Models terms when prompted. You can check your acceptance with `fm license --status`. Then enable **Automatic model and reasoning effort** in OWLA settings. This Apple Foundation Models option is hidden on Windows and Linux.

OWLA replaces the manual selectors with the model and effort chosen for each turn. The on-device router receives your original prompt, the compatible model catalog of the selected provider, and a short inventory of attachment names, types, and selected PDF page numbers. It uses counts for earlier context. The router weighs model strengths and usage. For Codex it uses the published roles, including efficient Luna models for focused work, Terra for writing and visual interpretation, Sol for multi-step work, and Astra for demanding analysis. For OpenCode it weighs the facts OpenCode reports: the price of each model, the input modalities it accepts, its context window and its available reasoning levels, so free models are preferred unless the request clearly needs a paid one. For Claude Code it weighs the model families your plan allows, from the least costly that can do the work. File contents, note text, image data and conversation history stay out of the routing request. The provider receives your original prompt for the answer. If local selection is unavailable or times out, OWLA shows the compatible fallback it used. Click the automatic selection text to choose a model and reasoning effort for one message. The next message after that returns to automatic selection. Turn the setting off to restore manual selection. [OpenAI model guidance](https://learn.chatgpt.com/docs/models)

The router runs on your own Mac through Apple’s Foundation Models CLI, never in the cloud. It receives your prompt text, a list of the models the provider currently offers, and a small inventory of what you attached — names, types and selected PDF page numbers. Your note text, image data, file contents and the conversation are not part of that request. OpenAI’s model guidance is used for Codex; for OpenCode, whose models come from many providers with no published roles, the router only weighs what OpenCode itself reports, and never assumes a quality the catalogue does not state.

## How it works

### What happens when you send a message

1. **Context.** OWLA collects the note you are looking at, including unsaved text, the cursor position or selected passage, any images, PDFs, notes and folders you attached, and the last exchanges of this chat. Nothing else is added.
2. **The assistant starts.** If the selected provider is not already running, OWLA starts it in a private working directory of its own and asks for the model you chose, or the one the local router selected.
3. **The assistant works.** It reads and searches only through OWLA’s tools. It is never given a shell, a file path outside the vault, or your credentials.
4. **The answer streams back.** Text appears while it is written, and the activity behind it is available under **Working**. Any change it proposes to a note is applied provisionally and waits for your **Accept** or **Decline**.
5. **The assistant stops.** After the reply, OWLA reads the usage limits the provider reported, stops the process, and keeps the chat context so the next message continues naturally.

### How the assistant reaches your vault

**With Codex**, OWLA starts the Codex CLI and talks to it over pipes with the official app-server protocol. The session runs with a read-only sandbox, approvals switched off, and Codex’s shell, code, MCP and multi-agent features disabled. It receives a fixed list of OWLA tools and nothing else.

**With OpenCode**, OWLA starts a private OpenCode server with a random password, in a private working directory that contains nothing of yours. OpenCode’s own shell, file editing, search, subagent and web-fetch tools are removed for that session and replaced with the same OWLA tools. The session rules deny everything that is not one of those tools, and inherited MCP servers are removed. The bundled Obsidian skills are registered as OpenCode skills, so the guidance is available in the same place on both providers.

**With Claude Code**, OWLA starts the installed CLI in headless mode and offers it the same vault tools through a private in-process MCP server. The CLI runs in safe mode with permissions set not to ask, and only OWLA's tools are allowed, so it cannot run commands, read files or write anything on its own.

**In every case** the assistant can only reach your vault by asking OWLA. OWLA applies the same path rules, excluded folders and vault-containment checks to every request, and every note change is proposed for review rather than written directly.

### What runs in the background

- A short-lived assistant process while you are typing and while a reply is running. It stops 20 seconds after you stop typing, when the draft is cleared, and after every reply.
- Nothing else. OWLA does not poll usage limits, does not keep a background index of your vault, sends no telemetry, and does not upload anything on its own. Your notes are read when you send a message, and the search scans them locally at that moment.
- The only files OWLA writes outside your vault are saved chats, pending review records, recovery snapshots and private working directories. By default they are under `%LOCALAPPDATA%\OWLA Butler\vaults\<vault-id>\` on Windows and `~/Library/Application Support/OWLA Butler/vaults/<vault-id>/` on macOS. Review them before sharing, syncing or deleting them.
- The provider keeps its own application state, as it does in your terminal. OWLA never reads or copies it.

## Privacy, network access and files outside the vault

**This is a cloud-backed assistant.** Sending a message shares your current note snapshot (including unsaved text), selections, images, attachment references and bounded recent chat with the selected provider. The assistant can request allowed note text, document excerpts and PDF pages as needed. It does not upload the whole vault. Web search is on by default; queries can include supplied context. Disable it in settings when needed. With Codex, provider processing, retention and account controls follow [OpenAI’s Codex data guidance](https://developers.openai.com/codex/security).

OWLA makes no separate telemetry or advertising requests. For Codex it explicitly disables optional analytics, feedback uploads and OpenTelemetry exporters for its own child process and checks the effective settings before starting a conversation. This does not disable the network traffic needed for Codex authentication, model discovery, quota reporting, inference and optional web search. Global Codex settings are left unchanged. For Claude Code, OWLA turns off error reports and self-updates for its own child process but keeps your own Claude Code telemetry setting, because Claude Code's telemetry switches also hide the live model list. OWLA also removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and the Bedrock and Vertex switches from that process, so replies always use your Claude login.

OWLA uses Node/Electron to check executable paths, launch the selected assistant directly with fixed arguments, and verify that note paths resolve inside the vault. The assistant cannot supply shell commands or access native files. The plugin reads note contents and applies approved edits through Obsidian’s API. Clipboard access is limited to an explicit copy action and attachments supplied in a paste event; OWLA does not inspect the clipboard in the background. Each assistant uses its own account, configuration and application files; OWLA does not read or copy credentials. Browser sign-in opens the URL returned by Codex. OWLA does not install or update Codex, OpenCode or other software.

With OpenCode, OWLA starts a private server with a random password and a workspace of its own, and replaces OpenCode's shell, file editing, search and subagent tools with OWLA's own. With Claude Code, OWLA runs the CLI headless in safe mode with only OWLA's tools allowed. In both cases the assistant cannot run commands or touch files on your computer, and the vault is reached only through the tools OWLA offers. None of the three assistants gets the plugins or MCP servers you set up in it: Codex runs with them switched off, Claude Code runs in safe mode (also without your CLAUDE.md, skills and hooks), and OpenCode starts with a private configuration folder, so your global OpenCode configuration and Claude Code skills are not read. Your sign-ins and connected providers keep working; providers defined only in your global OpenCode configuration file are not available in OWLA.

OWLA writes saved chats, pending review journals and pre-edit recovery snapshots **outside the vault**, by default under `%LOCALAPPDATA%\OWLA Butler\vaults\<vault-id>\` on Windows or `~/Library/Application Support/OWLA Butler/vaults/<vault-id>/` on macOS. Private per-vault working directories are also created there for ephemeral Codex, OpenCode and Claude Code sessions (`codex-session`, `opencode-session`, `claude-session`), next to `edit-backups` and `pending-edits.json`. OWLA recreates these folders whenever it starts an assistant or records an edit, so deleting them while OWLA is in use does not remove them for good.

A vault can instead keep a storage folder chosen by an earlier build. It is stored as `storageRoot` in the vault's `.obsidian/plugins/owla-butler/data.json`, has no field in the settings and stays in use until it is cleared; OWLA then creates `OWLA Butler/vaults/<vault-id>/` inside that folder. If a folder keeps coming back somewhere unexpected, such as in Downloads, quit Obsidian, set `"storageRoot": ""` in that file, reopen Obsidian and then delete the old folder. Move its `edit-backups` to the default location first if you may still want to undo those edits. Plugin preferences live in Obsidian’s plugin `data.json`. These files can contain note text: review them before sharing, syncing or deleting them. Each assistant may separately maintain its own diagnostic and application state; ephemeral agent conversations are requested by OWLA.

## Actual usage limits

Settings → OWLA Butler shows the usage limits reported by the selected provider: percentage used/remaining, reset times and any reported available reset count. For Codex these are the account quota windows; for OpenCode they are the plan meters and budgets it reports; for Claude Code they are the plan windows it reports, read through its control interface without sending a message. These are provider-reported limits, not a guessed message/token counter. The tracker refreshes after responses, when settings opens and with **Refresh usage**. It shows the report timestamp and preserves a clearly labelled last snapshot if refresh fails. Unavailable data stays unavailable rather than becoming “0% used.” No background polling, automatic purchases or reset redemption occur. [Codex quota protocol](https://developers.openai.com/codex/app-server).

### When a provider runs out of usage

If the assistant you are using reports that its usage limit is reached, OWLA explains it in the chat instead of failing silently. **Fallback provider** in settings chooses what happens next: leave it on **None** to be told instead of switched, or pick another provider to serve the next messages until the limit resets. OWLA then switches back on its own as soon as the provider reports that the limit has reset, and your choice of provider in settings is never overwritten: the switch is temporary and is shown as such. If every connected provider is exhausted at once, the chat says so and lists each provider with its reset time.

## Edits and recovery

Ask OWLA to make the changes you want in the note. Once the reply finishes, OWLA groups changes by note and applies each group provisionally. **Accept** keeps the current text, **Decline** restores the previous snapshot, and **View diff** shows the exact Markdown additions and removals. Vault sources in **Sources & activity** open the exact PDF page or note heading when OWLA has one. Change cards above **Sources & activity** show affected files and folders. Open an existing file, reveal a folder in File Explorer, or preview a new note draft. The composer unlocks after you decide on every pending group. Insert and append buttons also create provisional changes.

OWLA stores each pending decision and a private recovery snapshot before writing. Pending decisions return when you reopen the sidebar or restart Obsidian. Decline only restores a note that still matches the applied text. If you edit the note while deciding, you can accept the current text. The Undo command for an accepted edit also checks the applied snapshot before restoring. Snapshots retain at most 20 entries within 5 MB per vault. The pending record is capped at 10 MB.

Hidden/configuration files, excluded paths, traversal and symlinks escaping the vault are denied. Configure excluded vault-relative folders in settings. Shell execution, native filesystem access, inherited MCP integrations/connectors and direct writes are disabled for OWLA sessions on both providers.

### Organize files and folders

Ask OWLA to move or rename files and folders. Open **Review paths** to see each old and new path, the folders to create, and Markdown notes whose links may change. **Accept** runs the batch through Obsidian’s file manager. **Decline** clears the proposal. Organization always needs a path review, regardless of the Markdown Diff view setting. Related note changes, moves and deletions can appear in one review. Each note and deletion is approved individually, and a move batch retains its own approval. Related edits wait for approval before writing. A deletion stays blocked until its required changes are accepted and their paths exist. Proposed new notes always count as prerequisites for deletions in the same review. OWLA can also suggest deleting files and folders. Review the target, folder contents, and known backlinks, then choose **Move to trash** or **Decline**. The proposal stays in the open chat until you decide or close it.

Turn on **Automatically update internal links** in Obsidian’s Files and links settings to accept a batch. OWLA refuses conflicting, overlapping or excluded paths and batches that could update links in an excluded Markdown note. If relevant files or links changed after review, reopen the preview. OWLA records progress and backs up affected Markdown before applying. If a partial failure cannot be safely reversed, the chat shows the recovery record so you can inspect the paths before continuing.

For reviewed deletions, set **Deleted files** in Obsidian’s Files and links settings to a trash option. OWLA follows that choice and requires recoverable trash.

### Companion plugins

Turn on **Plugin Interconnectivity** in OWLA settings to use **Nicons 1.4.6+**, **Pinup 1.0.5+**, and **Folder and Graphs Plus 4.4.4+** enabled in the same vault. The setting starts off and is saved per vault. Ask OWLA to find an icon and change or clear a file or folder icon override, pin or unpin a file or folder, or configure supported options in the bundled Folder2Graph graph. Graph options include folder and heading visibility, descendant weighting, and default node colours. OWLA stages changes for your review before applying them.

OWLA shows each plugin proposal with its current and proposed value in the existing review. Use **Accept** or **Decline** for each change. Note changes and deletion dependencies keep their own approvals in the same review. Request icon and pin changes for an existing path after any move or deletion affecting that path has been resolved.

The integration uses versioned Obsidian workspace events inside the vault. OWLA sends the assistant the scoped option values and icon names it requests for the conversation. Plugin writes happen locally after approval, using the companion plugin’s existing save and refresh code. Turning the setting off discards unapproved plugin proposals.

## Chat and resources

**New chat** asks before clearing an existing conversation, draft or attachments. **Save and start new** saves recent messages before clearing the chat. Save, open and delete recent chats through the chat menu or command palette. Chats are saved only when you choose Save recent chat. New saves include the source note path used to resolve relative links. Saves contain the last three exchanges, without images/attachments or edit buttons; at most 20 saves, with confirmed deletion. Runtime chat context uses up to six recent exchanges / 64,000 text characters and the two most recent images; shortening is announced. Recent PDF-page/selection/attached-note context and images stay in memory for follow-up questions across backend shutdowns, so you do not need to attach them again. Raw attachments are excluded from saved-chat files; quoted material in the saved answer remains ordinary chat text.

Saved chats and recovery files live under `<storage>/vaults/<vault-id>/`. Earlier storage and recovery files are preserved during migration. A chosen folder can be synced by other software. Each provider manages its own authentication and application state; OWLA uses ephemeral agent conversations.

There are no downloaded models, Ollama servers or native OCR runtimes. Typing in the focused composer starts the selected assistant after a short debounce. An unused warm process stops after 20 seconds without input, when the draft is cleared, or when you leave the window or close the sidebar. Sending takes over the warm startup if it is still running. OWLA shuts down its process after the reply and any concurrent account check finish. The next message automatically restores recent chat context in a new backend process; no new chat or manual reconnect is needed. Stop, disabling the plugin and closing the chat terminate or interrupt only OWLA-owned work; your terminal or desktop sessions of either provider are left running.

## Skills and verification

Original Obsidian Markdown, Bases and JSON Canvas skills, all references and licence are bundled. OWLA also includes guidance for Mermaid diagrams and native note formatting, including coloured highlights. OWLA PDF, MathJax and image/transcription guidance is also retained and available through read_reference. These are instructions, not model training. Codex reads them through the read_reference tool; OpenCode receives the same content as registered skills, and Claude Code receives the same content through the bundled tools, so every provider works from identical guidance.

See CAPABILITY-CHECKLIST.md and TESTING.md for the eight requested checks, real question results and limits. AUDIT.md and RELEASE-CANDIDATE.md identify the candidate and release gate.

## Examples

- “Compare my biology notes with Exam Plan; cite the exact paths and separate evidence from your suggested schedule.”
- “What information is missing from this note? Don’t invent it.”
- “Improve this paragraph without changing its citation keys, links or meaning.”
- Attach an equation: “Transcribe this faithfully and prepare an insertion below Worked example.”
- Attach a PDF page: “Summarise this page with its filename and page reference.”
- “Check the official documentation for current Obsidian callout syntax and link the source.”

## Update, stop and uninstall

Disable OWLA, copy updated packaged files into the existing plugin folder, preserve `data.json`, then re-enable. For earlier local-inference development builds → 1.0, settings migrate to Codex and retain exclusions/storage; local-model configuration is removed. From 3.0 the chosen provider, its executable, its model and the exhaustion fallback are kept, and each provider keeps its own model and reasoning effort. Original backups and saved work are preserved.

Stop cancels the request. Disconnect is also available in settings. To uninstall, disable and remove the plugin folder. Keep or separately remove external saved chats/recovery files after reviewing them. OWLA does not uninstall Codex, OpenCode or Claude Code, erase their logins or change their global configuration.

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

Right-click a folder or a multi-file selection in the File Explorer and choose **Add folder to OWLA chat** or **Add files to OWLA chat**. A folder appears as one attachment. Codex can list it or search allowed notes within it and its subfolders. You can also drop multiple files from Obsidian, Finder or Windows Explorer into chat.

Drop files into chat or use Attach. PDFs and vault folders appear immediately as references. OWLA prepares images and converts other documents locally. PNG/JPEG/WebP images are resized on Windows and macOS, including images over 10 MB. Windows uses browser image decoding for other image formats; macOS also uses native conversion for formats such as HEIC, TIFF and BMP. Whole-PDF attachments also accept larger PDFs.

Word DOCX, PowerPoint PPTX, Excel XLSX and OpenDocument files provide extracted text. On macOS, Pages, Keynote and Numbers use an installed Apple app to export a temporary copy to Office format. macOS may request Automation permission. The original file is never opened for conversion. Temporary copies and exports are deleted afterward. If full extraction fails, an embedded or Quick Look preview is labelled **Preview only**. Unsupported files stay attached with **Content unavailable**, so the assistant can explain the limitation. Audio, video and arbitrary binary formats do not gain full understanding from an attachment alone.

Extraction retains paragraph, slide and sheet source names. It does not preserve every diagram, chart or page layout. Text is bounded and explicitly labelled when shortened. Large originals are converted locally. Codex can request the prepared text when needed. Screenshots and document previews use Codex image input.

Choose **Highlights in editor**, **None** or **Split diff view** in the Diff view setting. Highlights in editor shows temporary subtle green additions and red removed-text blocks in the Markdown editor. Split diff view opens the same source diff as View diff in a normal Obsidian split to the right of the note. Accept and Decline remain in chat, and resolving the last pending edit closes the diff pane. The overlay uses theme colors, clears on Accept/Decline, and hides when the pending text changes. It never writes markers into the Markdown. Source View diff remains available in chat.

Ask OWLA to create a note from the conversation. If you leave the location unspecified, OWLA follows Obsidian’s new-note location setting. You can also name an existing folder or request the vault root. Use **View diff** to review the draft, then **Accept** to create it or **Decline** to discard it. Existing files are protected.

### PDFs

Attach or drop a PDF to give Codex access to the whole document. Each PDF appears as a file chip. Codex can search the PDF’s text layer, read page ranges or request a rendered image of a scan or diagram. For a single page, use **Add page to OWLA** in the PDF viewer or include a reference such as `[[Books/Study.pdf#page=3]]`. OCR uses Codex’s visual input and leaves the PDF unchanged.

Right-click a PDF page in the Obsidian viewer to add it to OWLA, copy its page link, or copy selected text. This plugin menu provides those actions for PDF pages. The ordinary PDF toolbar remains available.

PDF comments follow a stricter review path than Markdown. Suggested comments are grouped per PDF and shown with page numbers. Review and accept them to create a separate annotated copy, or Decline to discard them. No PDF annotations are applied before acceptance. The source bytes are checked again before saving. Resolve PDF proposals before sending the next message. Annotation proposals stay in memory until resolved or the plugin is unloaded. Comments use standard PDF text annotations. They do not yet support arbitrary ink drawings, redactions or editing PDF text.
