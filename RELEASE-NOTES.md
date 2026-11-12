# OWLA Butler 3.0.0

- OpenCode and Claude Code are now supported alongside Codex. The first setting in OWLA Butler chooses the assistant, and the other providers' settings stay hidden until you select one.
- Connecting needs nothing beyond the installed tool. OWLA detects it, reuses your existing login, and reads the models and providers it offers.
- Every provider now behaves the same. The vault tools, PDFs, attachments, reviewed edits, diffs, recovery, the bundled Obsidian skills and the automatic model selection all work on any of them.
- On supported Macs, the new **Automatic** provider lets Apple’s on-device model help choose the provider, model and reasoning effort for each message, based on what each model is good at, its cost and the usage you have left. The choice and the reason appear under the reply.
- Provider usage limits and budgets appear in one usage panel.
- A new **Fallback provider** setting chooses what happens when the selected provider runs out of usage: be told in the chat, or let another provider serve the next messages until the limit resets. Your chosen provider is never overwritten.
- When every connected provider is exhausted at once, the chat says so and lists each provider with its reset time.
- For OpenCode sessions, OWLA replaces OpenCode's shell, file editing, search and subagent tools with its own, denies everything else through the session rules, and removes inherited MCP servers. OWLA also starts OpenCode with a private configuration folder, so plugins from your global OpenCode configuration cannot add tools to OWLA's session. Claude Code runs headless in safe mode with only OWLA's tools allowed.
- Better at Obsidian itself: the assistant can read backlinks, broken links, orphan notes, tags and properties straight from Obsidian’s metadata, propose property changes without rewriting the note, catch links that would not resolve before you review, and cite blocks exactly with `[[note#^id]]`.
- Codex settings gain **Verify connection**, like the other providers.
- The README now explains the full process: what is sent, how the assistant reaches the vault, how the on-device router chooses a model, and what runs in the background.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually.
