# OWLA Butler 3.3.2

- Restores the working 3.2.0 build exactly. The 3.3.0 and 3.3.1 updates were broken and have been withdrawn from the release channel.
- The only change from 3.2.0 is the version number, so Obsidian offers this release as an update and returns installs stuck on 3.3.0 or 3.3.1 to normal.

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
