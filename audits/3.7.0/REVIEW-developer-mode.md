# REVIEW — Developer mode (2026-11-21, Developer-Prerelease, local, staged, not committed)

Feature: a **Developer mode** toggle in settings that records the current chat
(messages, every tool call/command with args/result/duration, guard and loss
events) and unlocks session save/download plus a full diagnostics report
download. Version stays **3.7.0** (user instruction: no version bumps outside
release preparation). Branch model: `Developer-Prerelease` is never merged into
`main`; it only receives updates from `main` (README → Development → Branches
and prereleases).

## Gate status (orchestrator, after all fixes)

- `npm run check` ✓ (tsc --noEmit, 0 errors)
- `npm run lint` ✓ (0 errors, 0 warnings)
- `npm test` ✓ **838 tests / 832 pass / 0 fail / 6 skipped** (baseline before the
  feature: 782 / 0 fail; +56 new: 26 journal, 22 report, 8 integration)
- `npm run build` ✓ (main.js ≈ 1024 KB)
- `npm run guard:test` ✓

## Files

New: `src/dev-types.ts` (shared contract + bounds + totals/percentile),
`src/dev-journal.ts` (DevJournal), `src/dev-report.ts` (report builder, markdown
renderer, classifier), `tests/dev-journal.test.ts`, `tests/dev-report.test.ts`,
`tests/developer-mode.test.ts`, this review + the two audit reports.
Modified: `src/core.ts` (developerMode setting, shared across platforms),
`src/main.ts` (all wiring), `src/validation.ts` (shared `redactSensitive`),
`tests/helpers/load-main.ts` (fake plugin carries a real DevJournal — class
fields do not initialize on `Object.create(Butler.prototype)`), `README.md`.

## Audit findings → remediation

Audits: `DEVELOPER-MODE-CORRECTNESS.md` (DM-01…16), `DEVELOPER-MODE-SECURITY.md`
(F1…F10). Every high/medium and all actionable low findings were fixed by the
orchestrator and pinned by regression tests:

- **F1 (high)** provider status/version/plan/accountType carried raw CLI error
  text (friendlyClaudeError/friendlyOpencodeError fall through to the raw
  message) → all four fields redacted in `buildDiagnosticsReport`; markdown
  renders the redacted report. Test: F1 regression.
- **F2 (med)** redaction gaps → `redactSensitive` moved to `validation.ts`
  (shared with the journal) and extended: JWT (eyJ…三段), AWS AKIA, Google AIza,
  xoxe-, unquoted client_secret/consumer_secret/private_key/session_token/
  auth_token. Word boundaries kept so prose (task-/monkey-) survives.
- **F3 (med)** unbounded retention scan → `pruneSessions` caps candidates at
  100 (arbitrary excess evicted without reading), reads ≤ 30, sorts by parsed
  savedAt with mtime fallback, and **never evicts the just-written session**
  (keepId read first + unconditional keep in the eviction loop). Two bugs found
  while fixing (keep file dropped from candidates; mtime ties) were caught by
  the hostile-directory regression test and a scratch probe.
- **F4/DM-12 (low)** >1 MB journal silently skipped persistence → `save()` now
  prunes the persisted copy (oldest turns, then events; linear cost estimate,
  routing-history pattern) until it fits; memory keeps the full rings.
- **F5 (low)** session exports unredacted → `exportSession` redacts turn
  errors, tool errors and event details (in-memory journal keeps raw text).
- **F6/DM-04 (low)** developer-mode-disabled event was dead code →
  `setDeveloperMode` records the marker before closing the gate.
- **F7 (info)** loose UUID regex → strict 8-4-4-4-12 hex pattern.
- **F8 (low)** symlink following → `lstatSync` + skip in list/read/prune;
  clear/remove only ever unlink the link itself.
- **DM-01 (med)** turns interrupted by newChat/view-close/disable stayed
  "running" forever → catch closes the turn before the epoch/closing early
  return; `endTurn`/`toolEnd` treat closing an already-recorded entry as
  cleanup (runs even when disabled mid-turn; nothing NEW is recorded).
- **DM-02 (med)** emptyReplies double-counted (event + failed turn) → counts
  the failed turn only; test expectation corrected.
- **DM-03 (med)** 60-call recording cap vs per-attempt budget resets →
  two-tier recording: 60 full calls, then compact calls (name, ≤200-char args,
  outcome, no result text) up to 250; every command stays visible, bounded.
- **DM-05 (low)** events after mid-turn chat rotation misattributed → events
  with a turnId inherit that turn's chatId.
- **DM-06 (low)** edit-conflict kind never emitted → proposal catch emits
  `edit-conflict` for stale-snapshot messages, `proposal-rejected` otherwise.
- **DM-07 (low)** pre-routing failures invisible → catch starts a late turn
  when none exists, so connect/classifier failures land in loss.quality.
- **DM-08 (low)** phantom attempts → escalation/retry counters increment only
  after the replacement model connects successfully.
- **DM-15 (info)** double chatId rotation in openSavedChat → removed.

Accepted/documented, no code change:
- DM-09: durationMs includes toolQueue wait (documented semantics).
- DM-10/DM-11/DM-16: verified correct by the auditor (token estimate composed
  once; export history bounded to the retained 12 messages; nested reads
  attributed to the outer call).
- DM-13: `clearDeveloperData` intentionally works regardless of the toggle
  (deleting recorded data is always legitimate); UI reach is gated + ConfirmModal.
- DM-14: with DM-01 fixed, dispatched calls are closed on every path; calls
  beyond the 250 compact ceiling are not recorded (documented bound).
- F9/F10: bounded reads when off; save ≤1 MB + ≤2×25 ms spin before releaseReply.

## Review focus order

1. `src/main.ts` send() hooks (turn lifecycle, tool-callback wrapper — the
   wrapper preserves error identity and toolQueue ordering; verified by audit).
2. `src/dev-journal.ts` pruneSessions/save pruning (newest code, hostile-dir test).
3. `src/validation.ts` redactSensitive (shared surface; bridges unaffected —
   redactErrorDetail unchanged).
4. Settings UI rows (dynamic saved-session list, ConfirmModal flows).

## Not verified live

Unit tests and scratch probes do not exercise the real Obsidian renderer:
settings toggle rendering/update(), the Blob/anchor download in Electron,
clipboard copy, a real provider turn through send(), Windows file-lock retries,
vault-sync races on data.json. Install the build in a vault and run one real
turn with Developer mode on, save + download a session, download the diagnostics
report, then clear developer data — before calling this release-ready.

## Staging (shared tree — explicit files only, no commit)

```sh
git add src/core.ts src/main.ts src/validation.ts src/dev-types.ts src/dev-journal.ts src/dev-report.ts \
  tests/dev-journal.test.ts tests/dev-report.test.ts tests/developer-mode.test.ts tests/helpers/load-main.ts \
  README.md audits/3.7.0/DEVELOPER-MODE-CORRECTNESS.md audits/3.7.0/DEVELOPER-MODE-SECURITY.md audits/3.7.0/REVIEW-developer-mode.md
```

## Second-pass verification (2026-11-21, follow-up session)

Independent re-review of both staged change sets found four more defects; each
was reproduced RED-first, fixed, and pinned in `tests/dev-review-regressions.test.ts`:

- **R1 (med)** `pruneSessions` keep-slot off-by-one: when the new session sorts
  last (clock moved backwards / future-dated files), the protected file was
  counted twice, leaving 11 files and evicting nothing. Fix: reserve the keep
  file's slot before the eviction loop (`src/dev-journal.ts`).
- **R2 (med, privacy)** `redactSensitive` missed JSON-quoted credential keys
  (`"api_key":"…"`): the assignment patterns require `[:=]` directly after the
  key, but JSON has a closing quote first. CLI errors embed JSON, so credentials
  could reach exports. Fix: `JSON_VALUE_RE` handles quoted keys and escaped
  values (`src/validation.ts`).
- **R3 (low)** the `developer-mode-disabled` marker was recorded but never
  persisted: `setDeveloperMode` closed the journal gate before `save()`, whose
  enabled check then skipped the write. Fix: flush before closing the gate
  (`src/main.ts`).
- **R4 (low)** diagnostics `obsidianVersion` was always empty: `app.appVersion`
  does not exist (verified live via `obsidian eval` → undefined). Fix: use the
  obsidian module's public `apiVersion` export, with the old lookup as fallback;
  test stub now exposes `apiVersion` (`src/main.ts`, `tests/helpers/obsidian-stub.cjs`).

Gates after fixes: check ✓, lint ✓, **842 tests / 836 pass / 0 fail / 6 skipped**
(+4 regressions), build ✓ (~1.0 MB), guard:test ✓, check:release ✓. All fixes
staged alongside the original change set; nothing committed or pushed.