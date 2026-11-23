# Handoff 6 — Independent review of the 3.8.0 work (Opus reviewer)

Run only after handoffs 1–5 have filled in their "Report" sections. You are the reviewer, not a builder: do not rewrite features. Fix only trivial slips (typos, missing test import) and list every fix you made. Anything bigger goes in the findings list for the user.

## Rules (from `AGENTS.md`)
- `git pull`/`git status` first. Never run `git checkout --`, `restore`, `reset`, `clean`, `stash`, `commit` or any `push`. Do not commit. Changes you did not make belong to the workers.
- Do not bump the version or edit `CHANGELOG.md`/`RELEASE-NOTES.md`.
- The working tree holds all five workers' uncommitted changes; use `git diff` (and `git status` for new files, e.g. `src/pdf-export.ts`) to see them.

## Inputs
- `audits/3.8.0/README.md` and `01`–`05` handoffs (scope, required work, tests, out of scope) with each worker's Report.
- Proposal: `Change Proposal 3.8.0.md` (user's Obsidian vault, `Creative Project Notes/Coding/Obsidian/OWLA Butler/`).
- Evidence sessions: `~/Downloads/owla-session-2026-11-23T10-46-57-824Z.json` (Excalidraw failure) and `~/Downloads/owla-session-2026-11-23T15-41-01-156Z.json` (image layout answer); sample drawing `~/Downloads/Bildung der Demokratie durch Militär 1.md` (read-only).

## What to do
1. **Gates, yourself, not from the reports:** `npm run check`, `npm run lint`, `npm test`, `npm run build`, `npm run guard:test`. Paste real results. A worker claiming green is not evidence.
2. **Per handoff, check every "Required work" item** against the diff: done, partly done, missing. Quote file:line. Check the "Out of scope" lists were respected and no files outside a worker's list changed without a note.
3. **Cross-worker integration** (the highest-risk area): `src/main.ts` was edited by workers 1, 3, 4, 5. Look for lost edits, duplicated tool registrations, conflicting names, merge-style breakage, stale imports, and tool lists that differ between `baseToolSpecs`, the dispatcher, the system-prompt tool line, and the OpenCode/Codex/Claude/Hermes registrations. `tests/provider-isolation.test.ts` must still pass and the new tools must be exposed on all four providers.
4. **Safety review:**
   - Every new write path (propose_properties/outline tools, PDF export, edit-before-export) goes through the diff/accept-decline system or explicit user confirmation; excluded folders and `allowedPath` checks apply to source and output paths; no vault-guard bypass.
   - New context (properties, links, backlinks, PDF selection, page screenshots) never includes excluded-folder content and is bounded in size.
   - Decline/revert restores exact text, CRLF-safe.
   - No secrets, absolute personal paths or personal vault content added to fixtures, skills or reference pack.
5. **Behavioural verification against the evidence:** reproduce the Excalidraw failure with a synthetic ~300-stroke scene (or a stripped copy of the sample): confirm the read output is compact, `read_note` returns no compressed blob at any offset, and a bulk cleanup fits in one or two operations. Confirm the guide skill triggers for the side-by-side-images phrasing in EN and DE.
6. **Test quality:** each worker added real regression tests. Flag tests that only assert source-text regexes where behaviour could be tested, and any untested branch worth testing. Spot-check that tests fail when the feature is broken (mutate once, then restore exactly).
7. **Reference pack / skills:** `assets/reference-pack.json` regenerated with the repo's mechanism, not hand-edited inconsistently; new skill id registered everywhere `SKILL_IDS` flows.
8. **Docs honesty:** the PDF-export feasibility finding (handoff 5) must be stated truthfully (dialog-only vs programmatic). Flag anything claimed verified that was not.

## Output
Write `audits/3.8.0/REVIEW-3.8.0.md` with:
- Verdict per handoff: PASS / PASS WITH NOTES / FAIL.
- Findings ranked by severity (blocker, should-fix, nit), each with file:line, failure scenario, and the handoff it belongs to.
- Gate results (verbatim command + outcome).
- What you verified and how, and what you could not verify (e.g. live Obsidian behaviour, real PDF export).
- Trivial fixes you applied, listed.
- Release-readiness call: ready / ready after listed fixes / not ready.

Then stop. Do not start fixes for blockers; the lead will route them back to workers.

## Report
2026-11-23: gates green (873 tests, 0 fail). H1 PASS WITH NOTES, H2 PASS, H3 PASS WITH NOTES, H4 PASS WITH NOTES, H5 FAIL (export_pdf not wired). Not ready; see `REVIEW-3.8.0.md` (B1, S1–S3).
