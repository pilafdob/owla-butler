# OWLA Butler 3.1.1

- Assistant settings are now kept separately on each computer. If you sync a vault between a Mac and a Windows PC, turning on **Automatic** mode or picking a provider, model, fallback or executable on one no longer changes the other. Both start from your current settings. Excluded folders and other vault settings stay shared.
- The README now explains where OWLA keeps its working folders, why they come back after deletion while OWLA is in use, and how to clear a storage folder left over from an earlier build (`storageRoot` in `data.json`).

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually. Install and sign in to the provider CLI separately.
