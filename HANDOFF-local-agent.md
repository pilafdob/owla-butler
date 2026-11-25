# Handoff: finish the switch from OWLA-RC to main

You are a local agent on the maintainer's own machine (macOS or Windows) with their GitHub login. A cloud session prepared two commits but could not change GitHub settings, could not push outside its own branch, and could not run anything on macOS, Windows or Obsidian. Your job is to finish those parts.

**Ground rules**
- Ask the maintainer before any action marked **[ASK]**. These change shared state and are hard to undo.
- Check every claim below against the live repository before acting on it. The cloud session could not see rulesets or repository settings.
- Report each step as done, skipped (and why), or blocked (and on what). Never report a step as tested if you did not run it.

## State at handoff (2026-11-25)

Repository: `pilafdob/owla-butler`. Branch `claude/lucid-wright-st1ab6`, based on `main` at `7b414f2`, carries:

- `63e7020`: skips the unreadable-journal test (`tests/audit-win-failure-recovery.test.ts`) when running as root, and adds `CLAUDE.md` (what cloud sessions can and cannot verify, plus the rule that a release needs local macOS and Windows checks).
- `e8b8b25`: moves development to `main`. It deletes `.github/workflows/rc-branch-guard.yml`, runs CI on pushes to `main` only (pull requests still run CI), and rewrites the branch sections in `CONTRIBUTING.md`, `README.md`, `CLAUDE.md` and `.github/pull_request_template.md`. New rule: version bumps go only in the release commit, right before tagging. `Developer-Prerelease` and `dev-branch-guard.yml` are unchanged.

Cloud results on Linux, as root: `check`, `lint` (0 errors, 7 warnings), `test` (779 passed, 0 failed, 11 skipped), `guard:test`, `build` and `check:release` all passed. None of this has run on GitHub Actions yet.

`OWLA-RC` holds 3 commits that are not on `main`: `8667a92`, `6cf271d` and `78987fc`. They are the 3.8.0 work and include a version bump to 3.8.0.

## Tasks

### 1. Look before changing anything
```bash
git fetch origin main OWLA-RC Developer-Prerelease claude/lucid-wright-st1ab6
```
```bash
git log --oneline origin/main..origin/OWLA-RC
```
```bash
gh api repos/pilafdob/owla-butler/rulesets
```
```bash
gh api repos/pilafdob/owla-butler --jq '{default_branch, delete_branch_on_merge, allow_merge_commit, allow_squash_merge}'
```
For each ruleset, get its details with `gh api repos/pilafdob/owla-butler/rulesets/<id>`. Record:
- which branches it targets;
- whether it requires pull requests;
- which status checks it requires;
- whether anything still requires `Block merges into OWLA-RC`.

### 2. [ASK] What happens to the 3.8.0 work on OWLA-RC
Show the maintainer the 3 commits and offer these options:
- (a) Release 3.8.0 now: merge `OWLA-RC` into `main` and follow the release steps (task 6) before tagging.
- (b) Bring the work over without releasing: put the commits on a feature branch from `main`, remove the 3.8.0 version bump from `manifest.json`, `package.json`, `package-lock.json` and `versions.json` (keep the `CHANGELOG.md` and `RELEASE-NOTES.md` text for later), then open a pull request into `main`.
- (c) Leave it on `OWLA-RC` for now.

Do not delete `OWLA-RC` until this is settled and the commits are confirmed to be on `main`, or the maintainer says to drop them.

### 3. [ASK] Land the cloud branch on main
Open a pull request from `claude/lucid-wright-st1ab6` into `main`. Wait for `check` and `Block merges from Developer-Prerelease` to pass. If a ruleset requires a check that no longer exists (for example `Block merges into OWLA-RC` on `main`), report it; do not work around it. After the merge, confirm that the CI run on `main` passes.

If you chose option (b) in task 2, expect conflicts in `CONTRIBUTING.md`, `README.md` and the pull request template when you rebase that work onto the new `main`. Keep the new wording from `e8b8b25`.

### 4. [ASK] Make GitHub match the new docs
- Delete the ruleset that targets `OWLA-RC`, but only after task 2 is settled.
- If the maintainer wants direct commits to `main` (as `CONTRIBUTING.md` now says), check whether the `Main` ruleset blocks them. If it does, either change the ruleset or tell the cloud-side docs to say "pull requests only". Do not leave the docs and the ruleset disagreeing.
- Turn on automatic deletion of merged branches:
  ```bash
  gh api -X PATCH repos/pilafdob/owla-butler -F delete_branch_on_merge=true
  ```
- Delete the `OWLA-RC` branch last:
  ```bash
  git push origin --delete OWLA-RC
  ```
- `Developer-Prerelease` still has its own copies of `rc-branch-guard.yml` and of a `ci.yml` that names `OWLA-RC`. The maintainer asked for that branch to stay as it is, so do not edit it. The next normal merge from `main` into it will carry the deletion over. Just report this.

### 5. Local files that are not in git
`AGENTS.md`, `opencode.json`, `.opencode/` and `scripts/vault-guard/` are in `.gitignore`, so the cloud session could not see them. Search them for `OWLA-RC` and for the old rule that versions are bumped on `OWLA-RC`. Report what you find, and **[ASK]** before editing them.

### 6. Platform verification the cloud session cannot do
Run the full suite on macOS and on Windows, as a normal (non-root, non-Administrator) user:
```bash
npm ci
```
```bash
npm run check && npm run lint && npm test && npm run guard:test && npm run build && npm run check:release
```
In the `npm test` output, confirm that these tests actually ran instead of being skipped:
- **Both hosts:** `an unreadable journal fails closed instead of reading as empty`. On Windows it returns early by design; record that.
- **macOS (case-insensitive file system):** the case-alias tests:
  - `read_note cannot bypass the 2 MB cap via a case alias`
  - `currentText resolves a case-fold alias…`
  - `search_vault scopes by the canonical spelling…`
  - `a case alias reads the open editor unsaved content…`
- **Windows:**
  - the npm-shim tests (`a Claude turn through an npm shim…` and `resolved npm shim never searches the session cwd…`)
  - `a planted foreign SystemRoot is not trusted…`
  - `Windows discovery probes launcher extensions…`
  - the NTFS case-folding tests (`case-fold aliases of one vault share one physical private home…` and `NTFS case-folding cannot duplicate a saved chat`)

Any test still marked `# SKIP` on the host it targets is a finding. Report it with the skip reason.

Live Obsidian checks are needed before a release, not for this change. They are listed in `CONTRIBUTING.md`, in `TESTING.md` (including "Windows release checks still required") and in `COMMUNITY-RELEASE.md`. Run them only if the maintainer chose option (a) in task 2, in a disposable test vault and never in a real vault. Record the results in `TESTING.md`.

### 7. [ASK] Release checklist wording
`CLAUDE.md` now requires local macOS and Windows checks before every release, but the human checklist in `COMMUNITY-RELEASE.md` ("Release and submission checklist") does not mention them. Step 1 of that checklist also still calls Windows unsupported, which contradicts the new requirement. Offer to add the requirement there and to correct the support statement. Change it only if the maintainer agrees.

## Final report
Write a short report with:
- the status of each task (done, skipped or blocked);
- the ruleset changes you made;
- where the 3.8.0 commits ended up;
- the test totals on each host, plus any test skipped on the platform it targets;
- anything that still disagrees between the docs and the GitHub settings.
