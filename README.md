<p align="center">
  <img src="assets/bird.svg" alt="OWLA Butler bird icon" width="72" height="72">
</p>

# OWLA Butler

[![CI](https://github.com/pilafdob/owla-butler/actions/workflows/ci.yml/badge.svg)](https://github.com/pilafdob/owla-butler/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Platform](https://img.shields.io/badge/Obsidian-desktop-7c3aed)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**OWLA** stands for **Obsidian Workspace Local Assistant**. OWLA Butler is a local-first AI chat sidebar for Obsidian desktop. The current Markdown note follows you into chat. Add selected text, other notes, or a screenshot, then review suggested edits before applying them.

## Features

- Right-sidebar chat with streamed Markdown and LaTeX rendering. Screenshot attachment selects a dedicated **Image → Markdown** mode with note-search tools disabled for faithful transcription.
- Current editor contents and cursor/selection captured for each request, including unsaved changes.
- Editor right-click action and command to add selected text to chat.
- Image/PDF upload, clipboard paste, and drag-and-drop; up to two PNG/JPEG/WebP images, resized locally to a 1024 px maximum edge.
- Add-note picker and read-only model tools for vault search and reading Markdown notes.
- Model-proposed exact replacements, plus insert-at-cursor / replace-selection / append actions.
- A preview is required before applying an edit. Newer edits cause an old proposal to be rejected. Applied edits have a guarded Undo action.
- Ollama and OpenAI-compatible local endpoints. Only loopback URLs are accepted.
- Installed-model picker in the composer.
- OWLA can start an existing local Ollama executable on request. It does not install Ollama or models. Each generation uses `keep_alive: 0`; OWLA unloads the selected model and stops only the server copy it started when the turn ends or is cancelled.
- A macOS memory guard: requires at least 40% reported free headroom to start, stops immediately on critical pressure or below 18% headroom, and stops after two low-headroom samples below 25%. It is a best-effort responsiveness guard, not an exact RAM cap.
- The original supplied Phosphor bird SVG is bundled in `assets/bird.svg` and registered as the plugin icon. Its licence is in `assets/PHOSPHOR-LICENSE`.

## Use

1. Enable OWLA Butler in the vault and run **OWLA Butler: Open chat**, or use its bird ribbon icon.
2. Open a Markdown note. Its path appears above the chat. The note is captured when you send a request; focusing the sidebar does not switch the edit target.
3. Ask a question, select text and choose **Add selection to OWLA Butler**, or attach an image.
4. For changes, choose **Review edit** and inspect the proposed additions/removals before **Apply edit**. Use **Undo edit** only while that note has not been changed again.

Useful prompts:

- “Explain the selected passage in the language of my note.”
- “Find related notes about [topic], read the relevant parts, and cite their exact paths.”
- “Transcribe this screenshot into Markdown and LaTeX. Mark unclear symbols and propose a small insertion into my note.”
- “Improve this paragraph while preserving the citation keys and surrounding text. Propose an edit.”

The current low-memory default is `qwen3.5:0.8b-q8_0` with a 2,048-token context. The 2B Q4 variant hit memory limits on this machine and is not recommended under the tested workload. The small default passed a current-note question and one simple printed-equation transcription earlier. A later PDF question was refused before loading because the memory admission threshold was not met. A later search trial was stopped by the memory guard; broad agent reliability is not established.

The audited 0.8B model missed a requested note-path citation and briefly reached critical memory pressure. The current guard was tightened afterward, but no repeat inference trial has established that the problem is resolved. A small local model can make mathematical, transcription and tool-use mistakes. Review the equation and the proposed edit against the source image. OWLA does not silently correct an ambiguous symbol.

## Local model setup

Install [Ollama](https://ollama.com/download) separately, then install a model in Ollama before using OWLA. For a small Apple Silicon Mac, the current default is `qwen3.5:0.8b-q8_0`; run `ollama pull qwen3.5:0.8b-q8_0` in Terminal. This model has passed a narrow active-note question and one simple printed-equation transcription on an 8 GB M2 Air. It has not passed broad autonomous search or complex OCR acceptance tests. Larger models need more memory and may be stopped by OWLA's memory guard.

In OWLA settings, select **Ollama** and set the local server address and exact installed model name. The default endpoint is `http://127.0.0.1:11434`. If Ollama is already running, OWLA connects to it and leaves the service running. The model picker lists models available from that server without loading their weights. You can also use an OpenAI-compatible server bound to localhost.

OWLA can start a separately installed Ollama executable when no service is running. Set its path in **Ollama executable** if automatic detection fails. For a manually managed server, turn off **Automatic Ollama startup**. OWLA does not download, install, or update Ollama, model weights, or plugin code. Managed service startup binds to localhost, disables Ollama cloud features, permits one model/request, and stops the server copy OWLA started when the turn ends or is cancelled. No login service is installed.

The plugin requires Obsidian 1.14.5 or newer on desktop. Process management and the memory guard have been developed for macOS; other desktop environments should use an already-running compatible local server. No exact RAM cap is guaranteed.

## OWLA instruction profile

The built-in OWLA profile guides the selected base model to preserve note structure, YAML, wikilinks, citation keys and LaTeX; distinguish evidence from inference; and mark uncertain OCR. It is instructions supplied at inference time, not a newly trained model. It does not duplicate model weights or create a misleading renamed model.

Image OCR is available through the vision model and Image → Markdown mode. PDF attachments open a page picker. Choose **Add page text** for locally extracted text or **Add as image** for scanned pages/formulas. Filename and physical page references accompany the page. Up to two PDF text pages can be attached per message; large pages are shortened for the small model. PDF files are limited to 20 MB. Password-protected documents are unsupported. Obsidian’s bundled PDF.js handles extraction/rendering; no extra runtime is downloaded. Extraction may lose column order or mathematical layout, so use the page image when those matter. Bases/Canvas guidance is present, but tools currently read/write Markdown only. Whole-document PDF synthesis, automatic multi-page OCR and task-specific reference retrieval are future work; instructions alone do not provide those tools or guarantee model accuracy.

## Privacy and safety

- Notes, selections and images are sent only to the configured localhost model service. A separately installed service controls its own downstream behavior. OWLA itself does not contact remote AI providers.
- Model-generated image embeds are displayed as links rather than automatically fetched images.
- Conversations and images are kept in memory, not saved into vault notes or a remote service automatically. New chat or plugin reload clears chat state. OWLA writes bounded pre-edit backups and local Ollama logs under Application Support/Logs outside the vault.
- Vault search uses Obsidian's vault API and reads Markdown only. Hidden paths, traversal, configuration files and user-excluded folders are rejected. There is no shell-execution tool for the model.
- Excluded folders are set in plugin settings, one vault-relative path per line. Exclusions apply to active context, added notes, search, reading, and applying edits.
- The model can propose edits but cannot apply them. The plugin never deletes, renames or moves notes.
- A proposal targets the captured file, not whichever tab happens to be open later. Every apply and Undo checks that the contents have not changed since its snapshot.
- Keep normal vault backups and Obsidian File Recovery enabled. OWLA's Undo is kept in memory and is not a persistent backup system.
- Chat history is bounded to limit memory use. Long notes and tool output are shortened; the model can request a relevant note through its read tool.

## Installation

The Community directory listing is pending review. For manual testing, copy `main.js`, `manifest.json`, and `styles.css` from the same version into `<vault>/.obsidian/plugins/owla-butler/`, then enable OWLA Butler in Obsidian's Community plugins settings. Install Ollama and a model separately before sending a message.

## Development

```sh
npm install
npm run check
npm test
npm run build
```

Install `main.js`, `manifest.json` and `styles.css` under `<vault>/.obsidian/plugins/owla-butler/`. Preserve existing `data.json` on updates. Test in a disposable vault before enabling the plugin in an important vault.

See [TESTING.md](TESTING.md) and [AUDIT.md](AUDIT.md) for measured development results and limitations. Public release readiness requires a fresh test of this Community build.

## Uninstall

Disable OWLA Butler in Obsidian; this cancels its request and stops the server it owns. Remove only the `owla-butler` plugin folder. The separately installed local model service and its models are managed independently. OWLA does not remove them. Review local pre-edit backups and logs separately before deleting them.

## Third-party material

The bird icon is derived from Phosphor Icons; see [its license](assets/PHOSPHOR-LICENSE). Bundled Obsidian skill references include material by Steph Ango; see [their license](assets/skills/OBSIDIAN-SKILLS-LICENSE). OWLA Butler itself is licensed under [MIT](LICENSE).
