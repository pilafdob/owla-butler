# Community release and updates — OWLA Butler

Prepared 2026-11-04. This is a maintainer checklist, not proof of Community acceptance. Public release was authorized after preparation. Verify the [1.0.0 GitHub release](https://github.com/pilafdob/owla-butler/releases/tag/1.0.0) and the checks below before submitting. Community account linking and submission remain the owner’s steps.

## Updating the existing listing

The 1.0.0 release and initial listing instructions below are historical. The composer and review fixes are in the [1.0.1 release](https://github.com/pilafdob/owla-butler/releases/tag/1.0.1). For an update, verify the current build, push the matching tag without a `v` prefix, then verify and publish the draft. Starting with 1.0.1, attach only `main.js`, `manifest.json` and `styles.css`; the optional manual ZIP and checksums are a separate workflow artifact. Keep executable asset attestations. Use **Check for new releases** in the existing Community entry if the update is not detected. There is no need to submit a duplicate listing.

The 1.0.0 review’s filesystem/process/vault enumeration/clipboard notices reflect the features documented in the README. The patch removes shell-based discovery and uses the review’s source checks as a lint gate. These checks do not substitute for a new automated review of the published patch.

## 3.8.1 — release status

3.8.1 fixes the Community review of 3.8.0, which failed on disabled
`obsidianmd/prefer-file-manager-trash-file` rules. Export copies are now
removed through the vault adapter, and the review's TypeScript and `!important`
warnings are fixed. It goes through a pull request into `main`; the merge
commit gets the plain `3.8.1` tag, then the tag workflow, the asset hash
comparison and `gh attestation verify`, as for 3.8.0. Details are in
`TESTING.md` ("3.8.1 — Community review fixes").

## 3.8.0 — release status

The version bump is on `main`. On 2026-11-25 the macOS gates and live checks
passed, Siri AI was fixed to fall back to the on-device model (Apple's `fm`
serves Private Cloud Compute only to Terminal), and the owner confirmed the
Windows checks and approved the release. Details are in `TESTING.md` ("3.8.0 —
release check on `main`"). The merge commit of the fix pull request gets the
plain `3.8.0` tag, followed by the tag workflow, the asset hash comparison
against a local build and `gh attestation verify`, as for 3.7.2.

Verified so far (details in `TESTING.md`):
- macOS live release-candidate check on 2026-11-23 (before the export-copy
  and Private-Cloud-Compute-only changes), including a real Codex turn with
  the new PDF tools.
- Windows 11 audit and live check on 2026-11-25 on the final export code, as a
  non-root user, without a provider or model turn: 925 tests, 924 pass,
  0 fail, 1 designed skip.
- Linux release-preparation gates on the release tree (cloud, root; not a
  release verification).

Required before tagging: the local macOS and Windows runs and live checks in
CLAUDE.md ("Before any release") on the merged tree, recorded in
`TESTING.md`; then the tag workflow, the asset hash comparison against a local
build and `gh attestation verify`, as for 3.7.2. Open review question: whether
Community review accepts the scoped `Modal.prototype.open` capture used by the
PDF export.

## 3.7.2 — release status

3.7.2 is a patch release: Codex calls OWLA's vault tools again. Codex's
fetched model catalog had set `tool_mode: "code_mode_only"` on every model,
which routes all tools through Code Mode; OWLA keeps Code Mode off, so every
tool call failed and Codex replied that note access was unavailable. OWLA now
passes its private Codex session a copy of that catalog with `tool_mode`
cleared (`model_catalog_json`), renewed hourly. Pull request #9 merged
`OWLA-RC` (`21788f6`) into `main` as `b68ff34`, and the plain `3.7.2` tag
points at that commit.

Verified on 2026-11-22:
- Live Codex 0.169.0 probe through `CodexBridge`: before the fix
  `gpt-5.6-terra` made no tool calls; after it `gpt-6-luna` and
  `gpt-5.6-terra` both call `propose_edit`.
- Local gates on `OWLA-RC` at `21788f6`: `npm run check`, `lint`, `test`
  (784 pass, 0 fail, 6 Windows-only skips), `build`, `check:release` (also
  with `RELEASE_TAG=3.7.2`), `guard:test`.
- Pull request checks passed (`check`, `Block merges into OWLA-RC`,
  `Block merges from Developer-Prerelease`), as did `main` CI on `b68ff34`.
- The tag workflow passed and created a draft with only `main.js`,
  `manifest.json` and `styles.css`. All three are byte-identical (SHA-256) to a
  local build of the tag, the manifest says `3.7.2`, and
  `gh attestation verify` accepts `main.js`. The draft was then published as
  Latest.

Not yet verified: a Codex turn inside a running Obsidian. Unchanged: Codex
0.169 also offers its own `spawn_agent` with direct tools; OWLA's ThreadItem
guard stops the turn if a model calls it.

## 3.7.1 — release status

3.7.1 is a patch release: **Copy link to page** copies a page wikilink again
(a PDF path containing wikilink syntax falls back to the plain citation). It is
the first release made through `OWLA-RC`: pull request #5 merged `OWLA-RC` into
`main` as `7c8908c`, and the plain `3.7.1` tag points at that commit.

Verified on 2026-11-21:
- Local gates on the merged tree (identical to `OWLA-RC` at `3b50848`):
  `npm run check`, `lint`, `test` (777 pass, 0 fail, 6 Windows-only skips),
  `build`, `check:release`.
- Pull request checks passed (`check`, `Block merges into OWLA-RC`,
  `Block merges from Developer-Prerelease`), as did `main` CI on `7c8908c`.
- The tag workflow passed and created a draft with only `main.js`,
  `manifest.json` and `styles.css`. All three are byte-identical (SHA-256) to a
  local build of the same tree, the manifest says `3.7.1`, and
  `gh attestation verify` accepts `main.js`. The draft was then published as
  Latest.

Not yet verified: copying a page link from a running Obsidian PDF viewer.

## 3.7.0 — release status

3.7.0 is released from `main` through the tag workflow. The automated suite
passed on Windows 11 and macOS, and a live check in a running Obsidian on macOS
covered Claude Code and Hermes turns, Automatic selection, CRLF review flows,
path guards and the PDF cache ([`TESTING.md`](TESTING.md)). Not yet verified:
a running-Obsidian pass on Windows, Codex and OpenCode model turns (usage
limits at release time) and Windows Automatic selection, which stays
macOS-only. Security and data-integrity scope is in [`AUDIT.md`](AUDIT.md) and
`audits/3.7.0-rc/`.

## Initial listing information (1.0.0)

| Field | Value |
| --- | --- |
| Plugin ID | `owla-butler` |
| Display name | OWLA Butler |
| Author | Filip (@pilafdob) |
| Repository | `pilafdob/owla-butler` |
| Version / tag | `1.0.0` (no `v` prefix) |
| Minimum Obsidian | `1.14.5` |
| Platforms | Desktop only; this release supports macOS |
| Licence | MIT |
| Payment category | **Optional payment**: free plugin with an external service whose models/usage may require payment |
| Support | GitHub Issues in the repository |

Description (matches manifest):

> Chat with an AI assistant in your sidebar using Codex, OpenCode, Claude Code or Hermes Agent: ask about your open note, attach images and PDFs, search your vault and the web, and review every edit.

Suggested repository description:

> AI assistant sidebar for Obsidian, powered by Codex, OpenCode, Claude Code or Hermes Agent: current note context, attachments, vault search and reviewed edits.

Suggested topics: `obsidian-plugin`, `obsidian`, `ai`, `ai-assistant`, `ai-chat`, `chatbot`, `sidebar`, `copilot`, `llm`, `agent`, `codex`, `opencode`, `claude-code`, `hermes-agent`, `markdown`.

Listing screenshots (1200×800 window captured at 2x, so 2400×1600 files; light theme, disposable demo vault): `assets/screenshots/01-chat.png` to `07-slash-commands.png`; README demo: `assets/demo.gif`.

## Preparation checks

- Root manifest, README, MIT licence, changelog and release notes are present; package/versions metadata agree.
- README discloses the separate Codex installation, account/possible provider payment, internet requirements, hosted note processing, optional web search and outside-vault storage/access.
- No runtime/model installation, self-update, advertising or OWLA telemetry. Child Codex optional analytics/feedback/OTEL are disabled and verified. Normal provider requests are disclosed.
- Three-file installation contains the bird, original skills/references and full redistribution notices; no assets folder or node_modules needed at runtime.
- CI runs strict TypeScript, Community-specific lint, tests, build and release checks. The tag workflow attests assets and creates a **draft** release for final review.
- Representative live macOS capability/permissions/editing/layout/lifecycle tests are documented in TESTING.md. Community-specific smoke results are recorded in the preparation report.

## Release and submission checklist

1. Review the prepared source and disclosures, including supported platforms (desktop macOS and Windows; Linux and mobile are unsupported) and external account costs. Run the full suite locally on macOS and on Windows as a non-root, non-Administrator user (`npm ci`, then `npm run check`, `lint`, `test`, `guard:test`, `build`, `check:release`), confirm the platform-gated tests ran instead of being skipped, and complete the live checks in a disposable test vault listed in CONTRIBUTING.md and TESTING.md (including "Windows release checks still required"), as CLAUDE.md ("Before any release") requires. Record the results in TESTING.md. A cloud or Linux run alone is not enough. Commit the complete tested changes to the default branch; do not include work/, node_modules, data.json, account payloads or private notes.
2. Make the repository public when ready. Verify anonymous access to root README.md, LICENSE, manifest.json and source. This is a deliberate owner action, authorized for this release.
3. Push the plain `1.0.0` tag from the reviewed commit. The release workflow verifies matching metadata, creates attestations and a draft with separate **main.js**, **manifest.json**, **styles.css**, ZIP and checksums. Run the workflow only after the exact source passes CI.
4. Check the workflow result, download and install the actual draft assets in a disposable vault, compare their hashes and verify the three-file install again. Review RELEASE-NOTES.md. Only then publish the non-draft release. The local preflight does not establish that remote Actions or release downloads work.
5. Sign in to [Obsidian Community](https://community.obsidian.md/), link the repository owner’s GitHub account and use **Submit plugin**. Enter the listing details above. Use **Optional payment** and clearly disclose the Codex dependency. Submission uses the Community form, not a pull request to the old directory JSON.
6. Use the directory’s **Review branch** check, resolve actual scanner/reviewer findings, and submit the release for review. Verify the public default branch manifest version and attached release files match. Do not claim a listed/approved status until confirmed.
7. After acceptance, update the README’s installation section and record the Community entry/review result. Future versions follow the same tested source → matching tag → verified assets process.

The preparation pass did not publish anything. The subsequent authorized release pass handles repository visibility and GitHub publication, verifying workflow and downloaded assets before giving the submission go-ahead. Owner account linking and Community submission are not performed by the release workflow.

## References

- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Community payment categories and local lint checks](https://docs.obsidian.md/community-directory/faq)
- [Set up and claim an entry](https://docs.obsidian.md/community-directory/set-up-and-claim)

Checked against the official documentation on 2026-11-04. Directory acceptance remains the reviewer’s decision.
