# Contributing

Use Node.js 22 and npm. Run `npm ci`, `npm run check`, `npm run lint`, `npm test`, `npm run build` and `npm run check:release`. Run `node scripts/package.mjs` for the manual-install ZIP. CI uses the same gates. Lint applies all recommended Obsidian-specific rules plus the source safety checks reported by the Community review. TypeScript strict checking runs separately.

Test a disposable vault before using originals. The Community installer supplies only main.js, manifest.json and styles.css: never depend on runtime assets in another folder. Keep third-party notices in the build banner. GitHub release assets must be the three plugin files; the optional ZIP and checksums are stored separately as a workflow artifact. Keep plugin/package/versions metadata aligned and use plain semver tags without a `v` prefix.

For integration changes, repeat current-note/unsaved context, exact sources, reviewed edits, backup/stale/Undo, screenshot/PDF, web, excluded paths, cancellation and process shutdown checks. Layouts must fit 240, 280, 360 and 600 px panes. Use Obsidian’s CLI against an explicitly named test vault. Never collect a contributor’s full vault or account state.

Report bugs through the **Bug report** form on GitHub Issues — it asks for plugin/Obsidian/provider versions, OS version, steps and a minimal disposable example. Remove account identifiers, tokens, private note text, local paths and screenshots containing personal data. Never post data.json, Codex credentials, raw quota payloads or work/ logs without sanitising them. Quota and authentication failures can be tested deterministically without changing a real account.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md), never in a public issue. Accessibility support and known limitations are in [ACCESSIBILITY.md](ACCESSIBILITY.md). Pull requests use the template in `.github/pull_request_template.md`.

See COMMUNITY-RELEASE.md for release and submission steps. Do not publish an untested build or claim Community approval before it is granted.

## Developer-Prerelease branch

`Developer-Prerelease` is the prerelease testing line, `OWLA-RC` is where new features and fixes are made, and `main` is the stable line. Updates merge **into** this branch from `OWLA-RC` and `main`; nothing merges out of it. A verified dev prerelease means `OWLA-RC` can be merged straight into `main`, without any dev flags.

- **No features are developed or committed on this branch.** It receives only merges of `OWLA-RC` and `main`. A direct commit may touch only dev-flag code (`src/dev-*.ts` and its tests), release tooling (`scripts/dev-release.mjs`, `.github/workflows/`) and documentation. A merge may not change files that the merged branch did not change, so feature code cannot ride in on one. `scripts/dev-release.mjs` checks this for every first-parent commit since the rules baseline, and the release fails otherwise.
- **Versions come from `OWLA-RC` or `main`, never bumped here.** A version ahead of `main`'s stable one is allowed only when it is `OWLA-RC`'s version. Dev releases are tagged `<version>-dev` (for example `3.8.0-dev`); a further build of the same version may use `<version>-dev.<n>` from 2 up (`3.8.0-dev.2`). The workflow rejects any other tag shape.
- **Releases are prereleases, never latest.** The release workflow on this branch creates every GitHub Release with `prerelease: true` and `make_latest: false` (`gh release create --draft --prerelease --latest=false`). Do not mark a dev release as latest.
- **No merges from this branch.** No pull request may use `Developer-Prerelease` as its head branch. The `Dev branch guard` workflow fails any such pull request, and its `Block merges from Developer-Prerelease` check is a required status check in the `Main` branch ruleset. Pull requests **targeting** this branch are allowed.
- **Dev changelog.** `scripts/dev-release.mjs` writes it. A dev build of `main`'s stable version starts with the exact line "Dev build of the latest stable version. No new features are included in this build." A prerelease of `OWLA-RC`'s newer version starts with "Dev prerelease of OWLA Butler <version> from `OWLA-RC`…" and carries that version's section of `RELEASE-NOTES.md`.
- Dev prereleases are for testing only and are never submitted to the Obsidian Community directory; stable releases follow COMMUNITY-RELEASE.md.

## OWLA-RC branch

`OWLA-RC` is where all new features and fixes are developed; `main` is the stable line. Commit new work directly to `OWLA-RC`.

- **One-way merges.** `OWLA-RC` is merged **into** `main` through a pull request whose head is `OWLA-RC` and whose base is `main`. Nothing is merged **into** `OWLA-RC`: the `RC branch guard` workflow fails any pull request whose base branch is `OWLA-RC`, and its `Block merges into OWLA-RC` check is a required status check in the `OWLA-RC` branch ruleset.
- **Version numbers are bumped here.** `manifest.json`, `package.json`, `package-lock.json` and `versions.json` carry the next version on `OWLA-RC`, with a matching `CHANGELOG.md` and `RELEASE-NOTES.md` entry, so the merge into `main` is release-ready. `RELEASE-NOTES.md` is the release log: add the new `# OWLA Butler <version>` section at the top. Each GitHub release shows only its own section (`scripts/release-notes.mjs`) plus a link to the full changelog, and `npm run check:release` fails if the section is missing.
- **CI runs on every push to `OWLA-RC`** as well as on pull requests, with the same gates as `main`.
- **Stable releases are tagged on `main`** after the merge, with a plain semver tag (no `v` prefix), following COMMUNITY-RELEASE.md.
