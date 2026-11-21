# OWLA Butler 3.7.1

- **PDF page links are links again:** **Copy link to page** copies a link such as `[[Biology/ebooks/Kernbereiche Biologie 6.pdf#page=18|Kernbereiche Biologie 6,p.18]]`, which shows the citation and opens the page.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually.

# OWLA Butler 3.7.0

- **Tables to chat:** right-click a Markdown table and choose **Add table to OWLA Butler** to attach it, or use **Select table** to select it.
- **PDF page citations:** **Copy link to page** copies a citation like `Kernbereiche Biologie 6,p.15`.
- **Handwriting in drawings (macOS):** reading a Canvas or Excalidraw drawing also returns the handwriting recognised by macOS Vision. Requires Xcode or its command line tools; otherwise only the picture is used.
- **Better model choice for drawings:** Hermes models report their real image support, and requests about an open drawing go to a model that can see it.
- **More relevant vault search:** whole-word matching and a relevance floor keep unrelated notes out of answers.
- **Reliability and security:** provider failures show their real cause, Codex usage limits are tracked like the other providers, a Hermes usage limit is reported in seconds instead of a long silent wait, a provider pipe error can no longer crash Obsidian, and Hermes, Claude Code and OpenCode are confined more tightly.
- **Windows hardening:** safer provider launchers and private homes, better error redaction, CRLF-safe reviewed edits and inline diffs (Windows line endings are kept), UTF-16/Windows-1252 text attachments, bounded vault-graph results, and more resilient handling of transient file locks and provider limits.
- **Less repeated work:** parsed PDFs are reused for continuation reads (up to 64 MB kept between reads), review rendering is coalesced, and large routing histories prune without repeatedly serializing the whole file. Oversized attached selections can be shortened with an explicit continuation hint.
- **Platform scope:** macOS Vision OCR and Apple Foundation Models support remain intact; Automatic selection is still macOS-only. The Windows changes passed the full automated suite on Windows and a live check in Obsidian on macOS; a live pass on Windows is still to come (see `TESTING.md`).
- **Smaller download:** `main.js` is now minified (about 1 MB).

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and connect the provider CLI separately.

# OWLA Butler 3.6.3

This is a security patch. Please update.

- **Hermes stays in OWLA's sandbox.** OWLA's private Hermes home linked your running Hermes daemon, and a transport bug hid OWLA's tools. A Hermes turn could therefore use your own shell and file tools and write without review. OWLA now starts its own Hermes daemon with only OWLA's tools, answers Hermes' tool discovery, filters `HERMES_*` keys out of the mirrored `.env` and environment, and never writes through a leftover link into `~/.hermes`.
- **Codex no longer reads your global instructions.** Codex runs in a private `CODEX_HOME` that holds only links to your sign-in, so `~/.codex/AGENTS.md`, your skills and your config stay out of OWLA's sessions. Your Codex sign-in keeps working, and token refreshes stay shared.
- **Excluded folders:** a capital sharp s (`ẞ`) can no longer reach a folder excluded as `Straße`.
- **Remembered model refusals:** models your plan or privacy regions refuse are remembered across restarts. Settings has a button to reset the list.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and connect the provider CLI separately.

# OWLA Butler 3.6.2

This is a source-review patch for the Community listing. It removes the blanket lint suppression in the Hermes bridge and validates its JSON-RPC messages, model list and streamed updates at the boundary, like the other providers. There is no change to chat, tools, models or the review flow.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and connect the provider CLI separately.

# OWLA Butler 3.6.1

This is a Windows compatibility and security patch. No changes to chat, providers, models or the review flow.

- **Hermes discovery and sign-in on Windows:** the inherited PATH is now read whether Windows stores it as `Path` or `PATH`, and the child PATH uses the Windows `;` separator, so Hermes and its helpers are found. Sign-in and state are mirrored into OWLA's private home with a copy fallback when Windows refuses a symbolic link (no Developer Mode needed).
- **Command launchers:** a `.cmd`/`.bat` assistant launcher always runs through the system's own Command Prompt, even when `ComSpec` is unset; a redirected `SystemRoot` can no longer choose the interpreter or the process-termination tool.
- **Excluded folders:** folders entered with Windows backslashes now exclude correctly.
- **Credentials:** Windows provider processes no longer inherit unrelated GitHub, AWS, npm and similar tokens; OpenCode still keeps the provider keys it reads by design.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and connect the provider CLI separately.

# OWLA Butler 3.6.0

- **Hermes Agent is a fourth provider.** Connect it once per vault in Settings, then use its connected providers (OpenRouter, Anthropic, Nous, OpenAI Codex, Ollama, custom endpoints and more) with OWLA's tools, skills and review flow. Hermes runs in a private configuration home; your global Hermes configuration, plugins, skills, memory and session history are not read.
- **Automatic mode** weighs Hermes models like OpenCode's. When the same model is available on both, a failure or exhausted plan moves it to the other source before switching models. A reported Hermes usage limit temporarily excludes that provider.
- **Excalidraw drawings** in all three file forms (`.excalidraw.md`, `.excalidraw` and plain `.md` notes with `excalidraw-plugin` frontmatter) can be read, seen and changed. A drawing note opened in Excalidraw is recognised as the active file and gets an image-capable model.
- Hermes does not expose its connected providers' quota percentages to OWLA; no invented usage numbers are shown.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and connect the provider CLI separately.

# OWLA Butler 3.5.1

- A text selection you add now stays in the composer as a chip and is shown on the sent message as a card with the excerpt it carries, so you can see that it went with the prompt.
- A selection added while a reply is still running is marked **next message** and waits for the message after that.
- Automatic mode now lists OpenCode models from all connected providers, not only the CLI default store, and the selection shortlist no longer lets one source with hundreds of models crowd out the others.
- Automatic routing knows about the 3.5.0 Canvas, Excalidraw and Bases features: reading and editing them is treated as structural work, and the one-message override offers only image-capable models when a canvas or drawing is open.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.

# OWLA Butler 3.5.0

- Canvas, Bases and Excalidraw under **Plugin Interconnectivity**. OWLA can read, see and change canvases, bases and Excalidraw drawings, and create new ones. Every change is a proposal you accept or decline in chat.
- Canvas: OWLA looks at a canvas as Obsidian draws it, using a quick background screenshot noted in Sources & activity. Turn **Background screenshots** off to keep Canvas text-only.
- Bases: Obsidian's own Bases engine checks every base OWLA reads or proposes and shows the rows it will list. Bases with errors are never staged.
- Excalidraw: OWLA reads shapes, text and arrows, sees the drawing as Excalidraw renders it, and builds new elements with Excalidraw's own scripting API. Changes stay correct while a drawing is open, and Decline restores it.
- Automatic selection picks a model that can read images for canvases and drawings.
- Fixes for the Obsidian Community review findings.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.

# OWLA Butler 3.4.0

- Security and vault-confinement fixes on top of the working 3.2.0 code. Chat, toolbar and web-search behaviour are unchanged: the **Allow web search** setting is still the only switch.
- Excluded folders can no longer be reached through other spellings of their names (`ſecret` for `Secret`), and hardlinked files are refused.
- Codex runs without notify commands, hooks or extra capability features for OWLA's session, while your own Codex configuration stays unchanged. Stock Codex 0.169.0, including setups with `hooks.json`, connects normally.
- Every provider can run only the tools offered for the current message.
- Replies are cleaned after rendering, so injected HTML cannot load remote content or run anything. Task lists, Mermaid and math still render.
- Long notes: OWLA reads them in parts and lists every heading, and reads after a proposal now show the section asked for. A reply that keeps repeating the same tool call is stopped instead of running for minutes.
- German edit requests are recognised by automatic selection, and large-note edits are no longer sent to free models.
- Split diff view no longer has per-change or per-line buttons; Accept or Decline in chat decides the whole batch. It now opens scrolled to the first change, and clicking a diff line takes the note to that line.
- If the pending edit record cannot be loaded, a recovery button restores provisional edits safely.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.

# OWLA Butler 3.3.2

- Restores the working 3.2.0 build exactly. The 3.3.0 and 3.3.1 updates were broken and have been withdrawn from the release channel.
- The only change from 3.2.0 is the version number, so Obsidian offers this release as an update and returns installs stuck on 3.3.0 or 3.3.1 to normal.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.

# OWLA Butler 3.2.0

- Split diff view now lets you accept or decline individual changed hunks, and individual lines within a hunk, with floating check and X icons.
- Partial accepts merge into the accepted note text; whole-batch Accept and Decline remain in chat.
- Split diff hunks and line decisions keep the note text correct across mixed, adjacent, insert-only, delete-only and append changes.

Fixed:

- Routing no longer crashes when attachment details are missing.
- Automatic selection records the task type on every provider path, so a thin reply can still escalate properly.
- Automatic selection keeps its context-size filter on the fallback path.
- Retry selection no longer mixes model lists or ignores model size limits.
- Disconnected or unavailable models are recognised for Codex and Claude as well as OpenCode.
- Disconnecting a provider clears its temporary unavailability and switches OWLA off that provider.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.

# OWLA Butler 3.1.9

- OpenCode Go paid models now weigh only their own Go meters for automatic selection; console budgets no longer make them look nearly used up or push selection away from them.
- The one-message override keeps listing OpenCode console models even when Go meters are exhausted.
- Other connected providers and free/limited-time free models remain unaffected.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.

# OWLA Butler 3.1.7

- Automatic selection settles clear-cut requests locally and asks Apple’s on-device model only when the request is nuanced.
- New settings: selection priority (Cost, Balanced or Intelligence), thorough selection, privacy mode and routing details under each reply.
- Apple’s model is loaded while you type, so selection on Send is faster.
- Note edits stay on models with proven tool use unless Cost mode is on or paid plans are nearly used up.
- Short answers to simple questions are no longer re-sent to a stronger model.
- Selection learns from outcomes and latency in each vault.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.
