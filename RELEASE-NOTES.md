# OWLA Butler 3.1.6

- OpenCode’s separate billing sources are now treated independently, so one running dry leaves the others available.
- Refusals are remembered per pool, model or account and retried after their reported reset.
- OpenCode Go meter usage is reported and Go’s paid models are blocked when a meter is full.
- Automatic selection retries up to four more times when a model fails before answering or using a tool, naming the failed model and reason.
- A connected but exhausted provider is named in the one-message override with its reset time instead of being hidden.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.
