# Audits and review reports

Version-pinned audit and review reports, organized by the version they targeted.
Historical reports were moved here from the repo root on 2026-11-19 and are kept
byte-identical; only pointers in living documents were updated.

- `1.0.0/CAPABILITY-CHECKLIST.md` — historical 1.0.0 capability checklist (the
  eight requested checks; superseded by later releases).
- `1.0.1/RELEASE-CANDIDATE.md` — 1.0.1 patch-candidate report (published as 1.0.1).
- `3.1.1/PERFORMANCE-AUDIT.md` — 2026-11-13 performance audit on the 3.1.1 tree;
  findings fixed in 3.1.2 (see root `AUDIT.md`). Superseded by the 3.7.0-RC
  performance audit.
- `3.6.1/WINDOWS-AUDIT-REPORT.md` — 2026-11-17 Windows test/audit of the 3.6.0
  tree; fixes released as 3.6.1.
- `3.6.2/SECURITY-AUDIT-3.6.2.md` — agent-confinement security audit; fixes
  released in 3.6.3. Its finding IDs (H1, H2, M9, L15, …) are cited by name in
  `src/` and `tests/` comments.
- `3.7.0-rc/` — active 3.7.0-RC audit and review workspace. General-pass entry:
  [`REVIEW-rc-hardening-pass.md`](3.7.0-rc/REVIEW-rc-hardening-pass.md).
  Windows-pass entry: [`REVIEW-windows-hardening-pass.md`](3.7.0-rc/REVIEW-windows-hardening-pass.md),
  with eight `windows-*.md` area reports, the shared pass brief and serial
  `windows-consolidation-log.md`. Consolidated change/fix report:
  [`windows-independent-followup.md`](3.7.0-rc/windows-independent-followup.md)
  (everything modified, changed and fixed, with verification evidence and
  remaining limits). Fresh verification is recorded in the root
  `TESTING.md` and `AUDIT.md`; historical intermediate gate counts remain
  snapshots, not claims about the current tree.

Living documents stay at the repo root: `AUDIT.md` (cumulative audit log),
`TESTING.md` (verification log), `CHANGELOG.md`, `RELEASE-NOTES.md` (used by the
release workflow), `COMMUNITY-RELEASE.md`, `THIRD-PARTY-NOTICES.md`.
`scripts/package.mjs` ships the 1.0.0/1.0.1 reports from their new paths.
