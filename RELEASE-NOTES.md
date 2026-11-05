# OWLA Butler 1.0.1

Sending a message clears the composer and attachment chips immediately. **Copy** on a sent message copies its text, including in reopened saved chats. Stop or a failed request restores the draft and attachments. If you have started another draft, recover the earlier one using **Restore draft** on the failed reply.

PDF page images can render when Obsidian is in the background. This patch also validates Codex and saved chat data, removes shell-based executable discovery, and applies the source checks flagged by Obsidian’s review. It keeps the same Codex login and storage and preserves saved chats and settings.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json`. The optional manual-install ZIP and checksums are stored separately in the release workflow run. Requirements remain macOS desktop, Obsidian 1.14.5+, Codex CLI 0.162.1+ and an eligible ChatGPT account.
