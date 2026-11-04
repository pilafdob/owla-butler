# Contributing

Use Node.js 22 and npm. Run `npm ci`, `npm run check`, `npm run lint`, `npm test`, `npm run build` and `npm run check:release`. Run `node scripts/package.mjs` for the manual-install ZIP. CI uses the same gates. Lint applies all recommended Obsidian-specific rules; TypeScript strict checking runs separately. It does not claim to enable the unrelated full type-aware ESLint preset.

Test a disposable vault before using originals. The Community installer supplies only main.js, manifest.json and styles.css: never depend on runtime assets in another folder. Keep third-party notices in the build banner. Keep plugin/package/versions metadata aligned and use plain semver tags without a `v` prefix.

For integration changes, repeat current-note/unsaved context, exact sources, reviewed edits, backup/stale/Undo, screenshot/PDF, web, excluded paths, cancellation and process shutdown checks. Layouts must fit 240, 280, 360 and 600 px panes. Use Obsidian’s CLI against an explicitly named test vault. Never collect a contributor’s full vault or account state.

Report bugs through GitHub Issues with plugin/Obsidian/Codex versions, macOS version, steps and a minimal disposable example. Remove account identifiers, tokens, private note text, local paths and screenshots containing personal data. Never post data.json, Codex credentials, raw quota payloads or work/ logs without sanitising them. Quota and authentication failures can be tested deterministically without changing a real account.

See COMMUNITY-RELEASE.md for release and submission steps. Do not publish an untested build or claim Community approval before it is granted.
