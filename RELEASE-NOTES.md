# OWLA Butler 3.1.2

- OpenCode no longer loads configuration or plugins from folders above OWLA's session folder, such as `~/.opencode/plugins`; OWLA's OpenCode settings now live in their own private folder.
- Each OWLA tool is allowed in OpenCode by its exact name, and calls OWLA did not offer this turn are refused.
- Module preload, library injection and TLS-disabling variables are kept away from every assistant, and API keys and endpoint overrides away from Codex and Claude Code.
- Codex's isolation is checked before every reply, and connecting is refused when project instructions sit above OWLA's storage folder.
- Excluded folders are matched regardless of letter case and Unicode form.
- An OpenCode reply now fails instead of waiting forever when its event stream does not open or closes early.
- Long assistant messages are read without blocking Obsidian, and the note picker stays responsive in large vaults.
- OpenCode Go and other providers connected in the OpenCode terminal app are now recognised, with their models rated by family, offered to Automatic selection, and usable as one-message overrides; a free-tier limit no longer marks OpenCode as exhausted when paid models still work.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.