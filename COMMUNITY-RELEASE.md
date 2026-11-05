# Community release and updates — OWLA Butler

Prepared 2026-11-04. This is a maintainer checklist, not proof of Community acceptance. Public release was authorized after preparation. Verify the [1.0.0 GitHub release](https://github.com/pilafdob/owla-butler/releases/tag/1.0.0) and the checks below before submitting. Community account linking and submission remain the owner’s steps.

## Updating the existing listing

The 1.0.0 release and initial listing instructions below are historical. The composer and review fixes are in the [1.0.1 release](https://github.com/pilafdob/owla-butler/releases/tag/1.0.1). For an update, verify the current build, push the matching tag without a `v` prefix, then verify and publish the draft. Starting with 1.0.1, attach only `main.js`, `manifest.json` and `styles.css`; the optional manual ZIP and checksums are a separate workflow artifact. Keep executable asset attestations. Use **Check for new releases** in the existing Community entry if the update is not detected. There is no need to submit a duplicate listing.

The 1.0.0 review’s filesystem/process/vault enumeration/clipboard notices reflect the features documented in the README. The patch removes shell-based discovery and uses the review’s source checks as a lint gate. These checks do not substitute for a new automated review of the published patch.

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

> Chat with Codex using your open note, selected text, images and vault context. Review edits before applying them.

Suggested repository description:

> Codex-powered Obsidian assistant with current-note context, images, PDF pages and reviewed edits.

Suggested topics: `obsidian-plugin`, `obsidian`, `codex`, `markdown`, `ai-assistant`.

## Preparation checks

- Root manifest, README, MIT licence, changelog and release notes are present; package/versions metadata agree.
- README discloses the separate Codex installation, account/possible provider payment, internet requirements, hosted note processing, optional web search and outside-vault storage/access.
- No runtime/model installation, self-update, advertising or OWLA telemetry. Child Codex optional analytics/feedback/OTEL are disabled and verified. Normal provider requests are disclosed.
- Three-file installation contains the bird, original skills/references and full redistribution notices; no assets folder or node_modules needed at runtime.
- CI runs strict TypeScript, Community-specific lint, tests, build and release checks. The tag workflow attests assets and creates a **draft** release for final review.
- Representative live macOS capability/permissions/editing/layout/lifecycle tests are documented in TESTING.md. Community-specific smoke results are recorded in the preparation report.

## Release and submission checklist

1. Review the prepared source and disclosures, including unsupported Windows/Linux/mobile and external account costs. Commit the complete tested changes to the default branch; do not include work/, node_modules, data.json, account payloads or private notes.
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
