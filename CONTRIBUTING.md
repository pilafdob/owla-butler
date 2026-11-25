# Contributing

Use Node.js 22 and npm. Run `npm ci`, `npm run check`, `npm run lint`, `npm test`, `npm run build` and `npm run check:release`. Run `node scripts/package.mjs` for the manual-install ZIP. CI uses the same gates. Lint applies all recommended Obsidian-specific rules plus the source safety checks reported by the Community review. TypeScript strict checking runs separately.

Test a disposable vault before using originals. The Community installer supplies only main.js, manifest.json and styles.css: never depend on runtime assets in another folder. Keep third-party notices in the build banner. GitHub release assets must be the three plugin files; the optional ZIP and checksums are stored separately as a workflow artifact. Keep plugin/package/versions metadata aligned and use plain semver tags without a `v` prefix.

For integration changes, repeat current-note/unsaved context, exact sources, reviewed edits, backup/stale/Undo, screenshot/PDF, web, excluded paths, cancellation and process shutdown checks. Layouts must fit 240, 280, 360 and 600 px panes. Use Obsidian’s CLI against an explicitly named test vault. Never collect a contributor’s full vault or account state.

Report bugs through the **Bug report** form on GitHub Issues — it asks for plugin/Obsidian/provider versions, OS version, steps and a minimal disposable example. Remove account identifiers, tokens, private note text, local paths and screenshots containing personal data. Never post data.json, Codex credentials, raw quota payloads or work/ logs without sanitising them. Quota and authentication failures can be tested deterministically without changing a real account.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md), never in a public issue. Accessibility support and known limitations are in [ACCESSIBILITY.md](ACCESSIBILITY.md). Pull requests use the template in `.github/pull_request_template.md`.

See COMMUNITY-RELEASE.md for release and submission steps. Do not publish an untested build or claim Community approval before it is granted.

## Branches

`main` is both the development line and the stable line. New features and fixes may be committed directly to `main`, or made on a short-lived branch, merged into `main` through a pull request and then deleted. The `Main` branch ruleset requires a pull request for everyone except repository admins, so only admins can commit directly to `main`; everyone else opens a pull request.

- **Feature branches.** Branch from the latest `main`, open a pull request into `main`, and delete the branch once it is merged. CI runs on every pull request with the same gates as `main`.
- **CI runs on every push to `main`.** A red `main` blocks the next release; fix it before starting other work.
- **Releases are commits on `main`.** Bump `manifest.json`, `package.json`, `package-lock.json` and `versions.json` to the next version, with a matching `CHANGELOG.md` and `RELEASE-NOTES.md` entry, in the release commit only, right before tagging. COMMUNITY-RELEASE.md requires the default branch manifest version to match the published release files, so a version bump must not sit on `main` ahead of its release. `RELEASE-NOTES.md` is the release log: add the new `# OWLA Butler <version>` section at the top. Each GitHub release shows only its own section (`scripts/release-notes.mjs`) plus a link to the full changelog, and `npm run check:release` fails if the section is missing.
- **Stable releases are tagged on `main`** with a plain semver tag (no `v` prefix), following COMMUNITY-RELEASE.md, after the local macOS and Windows checks in CLAUDE.md ("Before any release").
- **Developer-Prerelease is unchanged.** It receives merges from `main` and is never merged anywhere else: the `Dev branch guard` workflow fails any pull request whose head is `Developer-Prerelease`.
