# OWLA Butler 3.3.0

- Language support: the plugin now follows the language set in Obsidian. The full interface — settings, command palette, chat view, split-diff controls, notices and dialogs — ships in English and German; other languages fall back to English. AI replies default to Obsidian's language unless you write in or ask for another. Dates use Obsidian's language.
- Automatic selection skips unchanged review rebuilds and refreshes the split-diff view only when open; route and model caches are bounded, so large vaults and long sessions stay responsive.
- Split-diff, routing and provider bridges were cleaned up: shared block-grouping for hunks, chunked CLI output, cached open-note scans, and unused exports removed.
- Security and vault confinement: Codex no longer inherits notify hooks, shell features, MCP servers or plugins; sandbox and approval settings are pinned; Unicode/case-fold path bypasses, hardlinks, symlinked folders and excluded-folder spelling tricks are blocked; pending-edit paths are re-validated on load; temp files are written with restrictive permissions; CI actions are pinned to commit SHAs. Companion-plugin identity is checked. Web search asks before searching when it is enabled, with Allow once, Allow for this chat and Don't allow; the choice resets for a new or restored chat. The chat shows which provider and model will answer before you send.
- Web search is an outbound channel: when enabled, search queries may include supplied note context. Only trusted companion plugins should be enabled.

Fixed:

- Excluded folders can no longer be bypassed through Unicode case folding or look-alike spellings.
- Codex no longer runs inherited notify programs, hooks, or capability features outside the vault.
- Pending review records are validated against the vault before they are restored.
- Temporary conversion files are created with mode 0o600.
- Automatic selection keeps its context-size filter on the fallback path.

Known issues (planned for 3.3.1):

- In Automatic provider mode, the pre-send provider indicator can show the previous turn's route instead of the route that will actually be used, because routing happens at send time.
- A few interface strings are still English-only: the new-chat confirmation prompt and its buttons, some settings section names and descriptions, model and effort labels, the connecting status text, activity and change-card strings, and Codex activity strings. German covers the rest of the interface.
- Task checkboxes in rendered replies are only preserved when they carry a disabled attribute; if Obsidian's renderer omits it, the checkbox is removed. Mermaid, MathJax and Markdown-link handling in the rendered reply are verified only against a minimal DOM, not the live Obsidian renderer.
- If restoring fails while clearing a pending edit record, deferred and new-note entries are dropped from the kept record; on success, entries for excluded paths are removed without a notice.
- Automatic provider selection can trigger one extra provider reconnect because three non-turn connections read the web-search setting directly instead of the effective flag. This is not a consent leak.
- Unverified without an in-app Obsidian run: the in-app language switch, companion-plugin API shape, Obsidian renderer output against the sanitizer, Codex default feature flags, and AGENTS.md disabling at runtime.
- Warning: if your Codex config enables extra feature flags, OWLA refuses to start Codex and names the flag in the error ("Codex could not isolate OWLA tools: feature <name> is enabled. Disable it in Codex settings and retry."). Turn that flag off in your Codex config (for example ~/.codex/config.toml) or use another provider until 3.3.1.

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
