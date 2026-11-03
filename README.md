# OWLA Butler

OWLA Butler is a desktop Obsidian sidebar for chatting with a model running on your computer. It includes the open Markdown note as context, can search and read other Markdown notes in the vault, accepts selected text and screenshots, and proposes note edits for review before applying them.

## Status

Pre-release. The live Obsidian workflow and local model are still being tested. Do not use this build as a published release until those checks pass.

## Features

- Right-sidebar chat with the open note as context.
- Add a selection from the editor context menu or command palette.
- Attach up to three other Markdown notes and two pasted, dropped, or uploaded images per message.
- Search and read vault Markdown notes; exclude selected folders in settings.
- Review a proposed edit before it changes a note, with Undo when the note has not changed since the edit.
- Connect to Ollama or another OpenAI-compatible server on localhost. OWLA can start a local Ollama executable for a request and stop the server it started afterwards.

## Requirements

- Obsidian 1.7.0 or newer on desktop.
- A local model server. OWLA defaults to Ollama at `http://127.0.0.1:11434` and model `qwen3.5:2b-q4_K_M`; install the exact model name you select before chatting.

## Installation

After a public release, install through Obsidian's Community Plugins browser. During testing, copy `manifest.json`, `main.js`, and `styles.css` from one release into `<vault>/.obsidian/plugins/owla-butler/`, then enable OWLA Butler under Community plugins. Use a disposable vault for the first test.

## Setup

Open **Settings → OWLA Butler**. Select the local provider, endpoint, and exact installed model name. If using automatic Ollama startup, set the executable path if OWLA does not find it. Use **Check models** to see models available at the configured local endpoint. Set excluded folders before using vault search.

## Privacy and safety

The plugin accepts only localhost model endpoints. Note content and images are sent to that local server. A separate local server may have its own logging and data handling behavior. OWLA reads Markdown notes from the current vault, subject to excluded folders, and does not send them to a remote provider by default. Proposed edits require an explicit review and Apply action.

## Known limitations

- Desktop only; the plugin uses Node.js and local process APIs.
- Search covers Markdown notes, not arbitrary attachments.
- Chat history is held for the current sidebar session and is not synced.
- Model quality, image understanding, and memory use depend on the locally installed model and machine.

## Development

Run `npm ci`, `npm run check`, `npm test`, and `npm run build`. The production build produces `main.js` in the repository root. Release tags must match `manifest.json` version exactly, with no `v` prefix.

## License

MIT. See [LICENSE](LICENSE).
