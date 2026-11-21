# Contributing

Use Node.js 22 and npm. Run `npm ci`, `npm run check`, `npm run lint`, `npm test`, `npm run build` and `npm run check:release`. Run `node scripts/package.mjs` for the manual-install ZIP. CI uses the same gates. Lint applies all recommended Obsidian-specific rules plus the source safety checks reported by the Community review. TypeScript strict checking runs separately.

Test a disposable vault before using originals. The Community installer supplies only main.js, manifest.json and styles.css: never depend on runtime assets in another folder. Keep third-party notices in the build banner. GitHub release assets must be the three plugin files; the optional ZIP and checksums are stored separately as a workflow artifact. Keep plugin/package/versions metadata aligned and use plain semver tags without a `v` prefix.

For integration changes, repeat current-note/unsaved context, exact sources, reviewed edits, backup/stale/Undo, screenshot/PDF, web, excluded paths, cancellation and process shutdown checks. Layouts must fit 240, 280, 360 and 600 px panes. Use Obsidian’s CLI against an explicitly named test vault. Never collect a contributor’s full vault or account state.

Report bugs through the **Bug report** form on GitHub Issues — it asks for plugin/Obsidian/provider versions, OS version, steps and a minimal disposable example. Remove account identifiers, tokens, private note text, local paths and screenshots containing personal data. Never post data.json, Codex credentials, raw quota payloads or work/ logs without sanitising them. Quota and authentication failures can be tested deterministically without changing a real account.

See COMMUNITY-RELEASE.md for release and submission steps. Do not publish an untested build or claim Community approval before it is granted.

## OWLA-RC branch

`OWLA-RC` is where all new features and fixes are developed; `main` is the stable line. Commit new work directly to `OWLA-RC`.

- **One-way merges.** `OWLA-RC` is merged **into** `main` through a pull request whose head is `OWLA-RC` and whose base is `main`. Nothing is merged **into** `OWLA-RC`: the `RC branch guard` workflow fails any pull request whose base branch is `OWLA-RC`, and its `Block merges into OWLA-RC` check is a required status check in the `OWLA-RC` branch ruleset.
- **Version numbers are bumped here.** `manifest.json`, `package.json`, `package-lock.json` and `versions.json` carry the next version on `OWLA-RC`, with a matching `CHANGELOG.md` and `RELEASE-NOTES.md` entry, so the merge into `main` is release-ready. `RELEASE-NOTES.md` is the release log: add the new `# OWLA Butler <version>` section at the top. Each GitHub release shows only its own section (`scripts/release-notes.mjs`) plus a link to the full changelog, and `npm run check:release` fails if the section is missing.
- **CI runs on every push to `OWLA-RC`** as well as on pull requests, with the same gates as `main`.
- **Stable releases are tagged on `main`** after the merge, with a plain semver tag (no `v` prefix), following COMMUNITY-RELEASE.md.
