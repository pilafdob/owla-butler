# OWLA Butler 3.1.4

- The one-message model override now lists every model from every connected provider, including previous generations and all OpenCode models.
- Automatic selection prefers continuing with the model that served the previous turn when the new request fits it.
- Automatic selection weighs the real size of a request when choosing a model and reasoning effort.
- OpenCode models hosted outside the workspace’s allowed privacy regions are detected, explained once, and skipped in automatic selection.
- Automatic selection retries with another model or provider when the chosen one is out of usage or unavailable in the workspace’s privacy regions.
- Windows performance and reliability changes are merged into main: cached vault file access checks, Codex source deduplication, and case-insensitive Codex instruction discovery.
- Claude Code bridge robustness improvements: case-insensitive PATH handling and trimmed JSON parsing.
- Note link target deduplication and consistent case folding in vault search.
- Cached organization symlink checks and PDF export guidance in the reference pack.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.
