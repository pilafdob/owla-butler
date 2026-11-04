# OWLA Butler 1.0.0

Chat with your open Obsidian note, selections, screenshots, PDF pages and allowed vault notes using your existing Codex ChatGPT login. Review every suggested edit before applying it, with a backup and guarded Undo.

- Automatic chat with model/reasoning controls, linked sources and optional web search.
- Obsidian Markdown, Bases, Canvas, PDF, MathJax and image-transcription guidance included.
- Provider-reported usage limits in settings.
- Backend stops after each reply; follow-up messages keep the recent chat automatically.

**Requirements:** macOS, Obsidian 1.14.5+, Codex CLI 0.162.1+ installed separately, internet and an eligible ChatGPT/Codex account. OWLA is free; provider plan/usage charges and limits may apply. It does not support API-key login or local inference. Note context and attachments are processed by OpenAI. See the README’s requirements and privacy disclosures before enabling.

**Manual install:** copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/owla-butler/`, then enable the plugin. The ZIP is an alternative that also includes guides and licences. Preserve `data.json` when updating.

This release has representative automated and live macOS testing; Windows, Linux and mobile are unsupported. Selected PDF pages are supported, not automatic whole-document processing. AI answers and transcriptions still need review. Full results and limitations: TESTING.md and CAPABILITY-CHECKLIST.md.
