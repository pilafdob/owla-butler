# REVIEW-3.7.0-RC — moved

The review handoffs for the 3.7.0-RC multi-agent hardening passes live at their
version-pinned canonical location (repo convention, see `audits/README.md`):

- **Round 2 (Windows-focused, current):**
  [`audits/3.7.0-rc/REVIEW-windows-hardening-pass.md`](audits/3.7.0-rc/REVIEW-windows-hardening-pass.md)
  — eight agents' changes, orchestrator consolidation O1–O6, and the subsequent
  independent follow-up (§11) that superseded the original approval. The 752-test
  gate and PASSED verdict are historical: the follow-up found and fixed fourteen
  further defects. Final gates (**774 tests / 0 fail / 1 designed skip**) are in
  `TESTING.md`; cumulative scope in `AUDIT.md`. Live-release checks, optional ZIP
  packaging and §5 product decisions still remain explicit.
  Per-agent evidence: `windows-*.md` in the same directory; cross-file work:
  `windows-consolidation-log.md`. Consolidated change/fix report:
  [`windows-independent-followup.md`](audits/3.7.0-rc/windows-independent-followup.md).
- **Round 1 (general):**
  [`audits/3.7.0-rc/REVIEW-rc-hardening-pass.md`](audits/3.7.0-rc/REVIEW-rc-hardening-pass.md)
  — seven agents + orchestrator pass; its pending batch (§2) was applied and
  committed in `81540fb` before round 2 began.