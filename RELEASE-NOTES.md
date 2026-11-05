# OWLA Butler 1.2.1

OWLA now groups suggested changes by note and applies them provisionally when the reply finishes. **Accept** keeps the current note text, **Decline** restores the previous snapshot when it is safe to do so, and **View diff** shows the exact Markdown changes.

Resolve all pending edits to unlock the composer. Pending decisions are saved locally and restored when Obsidian restarts. If the note has changed since OWLA applied the suggestions, Decline protects the newer text and leaves the decision open.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. The optional ZIP and checksums are available in the release workflow run.
