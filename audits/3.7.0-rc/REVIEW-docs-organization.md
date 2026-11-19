# REVIEW — root documentation organization (2026-11-19)

Status: **changes staged, not committed.** Docs/packaging-only change for a reviewer
to verify. No `src/` or `tests/` file was touched. Branch `3.7.0-RC`, level with
`origin/main` (`c8c6dbd`) at start; shared working tree with concurrent agents —
their staged set and this folder's other files were left untouched. This file is
the only addition made here by the documentation pass.

Trigger: user request to clean up old, non-current root `.md` documentation by
moving it into existing folders first (new folders only if needed).

## 1. Moves (5 git renames, all R100 — content byte-identical)

| Old root path | New path | Why it is stale |
|---|---|---|
| `CAPABILITY-CHECKLIST.md` | `audits/1.0.0/CAPABILITY-CHECKLIST.md` | Self-described "historical 1.0.0 checks"; Nov 4 evidence. |
| `RELEASE-CANDIDATE.md` | `audits/1.0.1/RELEASE-CANDIDATE.md` | 1.0.1 patch-candidate report; 1.0.1 shipped Nov 5, 15+ releases ago. |
| `PERFORMANCE-AUDIT.md` | `audits/3.1.1/PERFORMANCE-AUDIT.md` | 2026-11-13 audit on the 3.1.1 tree (per root `AUDIT.md`); findings fixed in 3.1.2; superseded by `audits/3.7.0-rc/performance.md`. |
| `WINDOWS-AUDIT-REPORT.md` | `audits/3.6.1/WINDOWS-AUDIT-REPORT.md` | One-off 2026-11-17 report; audited 3.6.0, fixes released as 3.6.1. |
| `SECURITY-AUDIT-3.6.2.md` | `audits/3.6.2/SECURITY-AUDIT-3.6.2.md` | Version-pinned confinement audit; fixes released in 3.6.3. Filename kept because ~15 `src/`/`tests/` comments cite its finding IDs (H1, H2, M9, L15, …). |

Destination convention: `audits/<version>/`, matching the existing
`audits/3.7.0-rc/` workspace. No top-level folder was invented. New index:
`audits/README.md` (staged, `A`).

## 2. Kept at root, with the constraint that pins each file

- `RELEASE-NOTES.md` — `.github/workflows/release.yml:60` uses `--notes-file RELEASE-NOTES.md`; also required by `scripts/check-release.mjs:23`. Current top entry: 3.6.3.
- `README.md`, `CHANGELOG.md`, `COMMUNITY-RELEASE.md`, `THIRD-PARTY-NOTICES.md` — required by `scripts/check-release.mjs:23`.
- `AUDIT.md` — living cumulative audit log; newest section is the 3.6.3 audit (2026-11-18). Bundled by `package.mjs`.
- `TESTING.md` — living verification log; newest section 2026-11-17. Bundled by `package.mjs`; cited as a release gate by `COMMUNITY-RELEASE.md:43`.
- `CONTRIBUTING.md` — carries another agent's staged edit; not touched.
- `AGENTS.md` — local operating rules (gitignored); one pointer updated, see §3.

## 3. Pointer edits (living files only; archived reports kept byte-identical)

1. `scripts/package.mjs:24` — package list entries changed:
   - `'RELEASE-CANDIDATE.md'` → `'audits/1.0.1/RELEASE-CANDIDATE.md'`
   - `'CAPABILITY-CHECKLIST.md'` → `'audits/1.0.0/CAPABILITY-CHECKLIST.md'`
   Nothing else in the script changed; the ZIP ships the same documents from the new paths.
2. `README.md:199` — both references in the "Skills and verification" paragraph now carry the `audits/…` paths.
3. `AUDIT.md` — line 87 and line 96: `PERFORMANCE-AUDIT.md` → `audits/3.1.1/PERFORMANCE-AUDIT.md` (2 occurrences); line 228: `CAPABILITY-CHECKLIST.md` → `audits/1.0.0/CAPABILITY-CHECKLIST.md`.
4. `AGENTS.md` (Publishing section, line 60) — `RELEASE-CANDIDATE.md` → `audits/1.0.1/RELEASE-CANDIDATE.md`. Gitignored file; edit is a pointer fix only, no rule changed.

## 4. Knowledge-base updates (outside the repo)

- Agentbrain vault `Obsidian/OWLA Butler Plugin.md`: 8 evidence pointers updated to the new paths (lines 48, 443, 464, 671, 681, 1041, 1056, 1080); new section `## Repo documentation organization — 2026-11-19` appended (line 1082). The line-1080 review-handoff pointer was later re-pointed to `audits/3.7.0-rc/REVIEW-handwriting-vision-routing.md` after the concurrent agent renamed that file.
- Vault `Obsidian/README.md:18` — audit pointer updated + one-line note about the archive convention.
- Vault `Obsidian/Central Index.md:113` — new section link added.
- Hermes skill `owla-butler-development` — audit-report path fixed; convention added: new version-pinned audit reports go to `audits/<version>/`, living logs and pipeline docs stay at root.

## 5. Verification already performed

- `git diff --cached -M --summary` → all five renames at **100% similarity**; staged set is exactly: 5 renames + `AUDIT.md`, `README.md`, `scripts/package.mjs` (M) + `audits/README.md` (A). No other agent's staged entry altered.
- `npm run check:release` → **passed** ("owla-butler 3.6.3; three-file bundle and full notices verified").
- `node scripts/package.mjs` → **passed**: `dist/owla-butler-3.6.3.zip`, 43 files, 547,228 bytes, sha256 `1cb07f7063566d55d76d44b078830e999efee47ef12474aa4dc6c45661202983`. `unzip -l` confirms `owla-butler/audits/1.0.0/CAPABILITY-CHECKLIST.md` (4295 B) and `owla-butler/audits/1.0.1/RELEASE-CANDIDATE.md` (6089 B) inside; the fail-closed sensitive-data scan passed.
- Grep over living repo files (`README.md AUDIT.md TESTING.md CHANGELOG.md COMMUNITY-RELEASE.md RELEASE-NOTES.md CONTRIBUTING.md AGENTS.md scripts/*.mjs .github/workflows/*.yml`) → zero references to the old root paths.
- Vault note full-file grep → every occurrence of each moved filename carries its `audits/<version>/` prefix.

## 6. Reviewer checklist

1. Re-run `npm run check:release` and `node scripts/package.mjs`; confirm the ZIP contains the two moved reports at the new paths and nothing else changed in the file list.
2. `git diff --cached -M --summary` — expect exactly five `R100` renames; `git diff --cached -- scripts/package.mjs README.md AUDIT.md` — expect only the pointer substitutions in §3.
3. Confirm `.github/workflows/release.yml` still resolves every file it names (`RELEASE-NOTES.md` at root; `package.mjs` list now self-consistent).
4. Confirm `AGENTS.md` Publishing paragraph reads coherently with the new path.
5. Confirm the vault wikilink `[[OWLA Butler Plugin#Repo documentation organization — 2026-11-19]]` resolves (heading text must match exactly, em dash included).
6. Judgment call — frozen cross-references inside archived reports were deliberately NOT edited (byte-identical move): e.g. `audits/1.0.1/RELEASE-CANDIDATE.md:39` still says "See README.md, TESTING.md, AUDIT.md and CAPABILITY-CHECKLIST.md", and `audits/3.6.1/WINDOWS-AUDIT-REPORT.md` refers to `AUDIT.md` at root (still correct). Decide whether historical prose deserves an archival header note; this pass chose pure moves.
7. Judgment call — `src/` and `tests/` comments cite `PERFORMANCE-AUDIT.md` / `SECURITY-AUDIT-3.6.2` by name or finding ID, not path (e.g. `src/stream.ts:7`, `src/main.ts:792`, `tests/hermes.test.ts`). Left untouched (files are mid-edit by other agents; names remain searchable and `audits/README.md` maps them). Confirm that is acceptable.

## 7. Risks / not verified

- **CI release workflow not run** — requires a push; none made. `package.mjs` is exercised locally (above), which is the same script CI runs (`.github/workflows/release.yml:36`).
- **`npm test` / `lint` / `build` not re-run** — no `src/` touched, and the shared tree is mid-edit by concurrent agents; a full-suite run would report their in-flight state, not this change.
- **Sensitive-scan landmine for future packaging changes:** `audits/3.6.2/SECURITY-AUDIT-3.6.2.md:13` contained an absolute home-folder scratch path (since removed). It is NOT in the `package.mjs` list, so today's ZIP is clean — but adding `audits/` wholesale to the package list would trip the fail-closed `/\/Users\/.../` scan (`scripts/package.mjs:44`). Same caveat for this folder's `performance.md`.
- `work/` scratch `.md` files (gitignored) were left as-is: already organized per-task, invisible to git, and referenced as evidence by the living logs.
- Nothing committed, nothing pushed; the commit decision stays with the user per AGENTS.md. To undo without destructive git commands: reverse the five `git mv`s, reverse-apply the four pointer patches in §3, and remove `audits/README.md` and this file.
