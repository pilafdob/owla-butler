# OWLA Butler 1.2.2

Suggested edits respect Obsidian’s **Show inline title** setting. When Obsidian already displays the filename above the note, OWLA blocks proposals that would repeat it as a top Markdown heading. If OWLA can’t read the setting, it preserves the top title and still allows body edits.

The check runs when OWLA stages a suggestion and again before it changes the note. You can still accept or decline applied suggestions in chat and inspect the Markdown diff.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually.
