# OWLA Butler 3.1.3

- One-message model overrides can now switch providers mid-reply; the override picker lists models from every connected provider.
- Excluded-folder checks, vault search and note reading stay responsive in large vaults.
- Unchanged OpenCode workspaces are no longer rewritten.
- Claude Code web-search sources are collected from structured tool results as well as text matches.
- Codex disconnect races while requests are pending are prevented, and source lists are deduplicated.
- Additional non-OWLA tools are removed from OpenCode sessions.
- The split diff view syncs only when split diff is enabled.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.
