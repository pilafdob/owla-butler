# REPORT — 3.7.0-RC Windows work: changes, fixes and verification

Date: 2026-11-20 · Branch: `3.7.0-RC` · Base commit: `81540fb` (Prepare 3.7.0
release with features and hardening)
Host: Windows 11 (build 26300), Node 24.14.0, npm 11.9.0
Companion documents: [`REVIEW-windows-hardening-pass.md`](REVIEW-windows-hardening-pass.md)
(round-2 handoff + its superseded verdict), root `AUDIT.md` (cumulative log),
root `TESTING.md` (verification log).

This report consolidates **everything modified, changed and fixed** in the
uncommitted 3.7.0-RC working tree: the original eight-agent Windows hardening
pass, its orchestrator consolidation, and the later independent follow-up that
superseded the first "PASSED" verdict. Nothing here was committed, tagged or
published.

---

## 1. Summary

- The round-2 Windows pass was handed off as independently reviewed and **PASSED**
  (`REVIEW-windows-hardening-pass.md` §9). A fresh read-only review did **not**
  uphold that verdict: it reproduced **fourteen further defects**, including
  data-loss, launch-hijack, credential-copy and data-integrity bugs.
- All fourteen were fixed, each with a regression test (key ones observed RED
  before and GREEN after). A delegated fix team was cut short by the account's
  daily model-usage limit mid-task; the orchestrator finished the remaining fixes
  directly and re-verified.
- Final gates: **`npm run check`** ✓ · **`npm run lint`** (0 problems) ✓ ·
  **`npm test` 774 total / 773 pass / 0 fail / 1 designed skip** ✓ ·
  **`npm run build`** 993.2 kb ✓ · **`npm run check:release`** ✓ ·
  **`npm run guard:test`** ✓ · **`git diff --check`** ✓ ·
  `npm audit --omit=dev` **0 advisories**.
- macOS-only code preserved: `src/ocr.ts`, `src/visual.ts` and
  `src/model-profiles.ts` have **zero diff** against the base.

---

## 2. What the working tree contains (uncommitted)

### 2.1 Source (`src/`) — 24 modified files

Original Windows pass (details in the `windows-*.md` reports):
`canvas.ts`, `chats.ts`, `codex.ts`, `core.ts`, `editor-diff.ts`, `exhaustion.ts`,
`note-tools.ts`, `opencode-availability.ts`, `opencode.ts`, `organization.ts`,
`plugin-api.ts`, `routing.ts`, `usage.ts`, `validation.ts`.

Independent follow-up (this report):
`attachments.ts`, `auto-route.ts`, `claude.ts`, `cli.ts`, `hermes.ts`,
`main.ts`, `pdf.ts`, `recovery.ts`, `routing-history.ts`, `vault-graph.ts`.

### 2.2 Tests (`tests/`)

New round-2 suite (31 files): `tests/audit-win-*.test.ts`, including six
follow-up files added in this review:

- `audit-win-followup-recovery.test.ts`
- `audit-win-followup-routing.test.ts`
- `audit-win-followup-history.test.ts`
- `audit-win-followup-data.test.ts`
- `audit-win-followup-providers.test.ts`
- `audit-win-followup-vault-graph.test.ts`

Modified existing tests: `hermes.test.ts` (+333), `codex.test.ts`,
`claude.test.ts`, `security-main.test.ts`, `security-render.test.ts`,
`security-vault.test.ts`, `opencode-bridge.test.ts`,
`audit-rc-codex.test.ts`, `audit-providers-opencode-lifecycle.test.ts`,
plus precise updates to `audit-win-auto.test.ts`,
`audit-win-attachments-pdf-cache.test.ts`, `audit-win-pdf-wiring.test.ts`,
`audit-win-perf.test.ts`, `audit-win-claude-shim.test.ts`.

Tracked diff: **40 files changed, 1,776 insertions(+), 326 deletions(-)**.

### 2.3 Documentation

New in `audits/3.7.0-rc/`: `REVIEW-windows-hardening-pass.md`,
`windows-pass-brief.md`, the eight `windows-<area>.md` reports,
`windows-consolidation-log.md`, and this report.
Modified at root: `AUDIT.md`, `TESTING.md`, `CHANGELOG.md`, `RELEASE-NOTES.md`,
`COMMUNITY-RELEASE.md`, `REVIEW-3.7.0-RC.md`, `audits/README.md`.

---

## 3. Independent follow-up findings → fixes

Each row names the code anchor and the regression that proves it.

| # | Finding (reproduced) | Fix | Anchor |
|---|---|---|---|
| 1 | `readPendingRecord` stat succeeded but a read failure became `[]`; `clearPendingEdits` then deleted the unread journal | Read I/O failures throw and preserve the journal; tolerant malformed-JSON recovery unchanged | `src/recovery.ts:46` |
| 2 | Claude shim's bare `node` fallback let a session-local `node.cmd` hijack launch (Windows `which` searches cwd first) | Resolve a validated absolute Node (bundled/local, current binary if Node, else PATH lookup); otherwise keep the guarded shim | `src/claude.ts:55` |
| 3 | A stale copied Hermes `vault/` directory survived excluded-entry cleanup and kept the user's secrets/Fernet key | `sweepExcludedPrivateEntries` removes user-data dirs on every connect; gateway-owned runtime dirs survive reconnect | `src/hermes.ts:106`, `:261`, `:594` |
| 4 | `.env` assignments after a lone CR bypassed the filter (python-dotenv splits on CR too) | Filter splits on LF/CRLF/CR | `src/hermes.ts:189` |
| 5 | A planted directory containing only `System32\cmd.exe` was trusted as the system directory | Also require core system DLLs; cmd.exe-only falls back to default | `src/cli.ts:173` |
| 6 | CRLF proposal offsets corrupted Markdown apply **and** decline/rollback | Normalize both proposal sides for plain-Markdown editor operations; structured formats keep byte-exact guards | `src/main.ts:664` |
| 7 | Distinct external `File` objects sharing name/size/time reused one PDF parse (wrong document) | Stable per-object identity (WeakMap of UUIDs) keys external Files | `src/main.ts:2912` |
| 8 | Byte-trimmed graph pages lost their continuation, skipping notes forever | Recompute `nextOffset` to the first unreturned note; set `truncated`; flag non-paginated lists too | `src/vault-graph.ts:60` |
| 9 | A UTF-8 sample split mid-character falsely triggered the ANSI fallback | Streaming decode for a non-final sample; an incomplete **final** file stays refused | `src/attachments.ts:101` |
| 10 | Case-alias reads missed unsaved open-editor content | `currentText`/`writeEdit` resolve the canonical path before view/target lookups | `src/main.ts:593`, `:664` |
| 11 | Per-reply unload closures kept observers/content reachable until view close | One view-level cleanup drains all observers; `replyCleanupRegistered` guard | `src/main.ts:1024`, `:1391` |
| 12 | After trimming for the largest window, smaller-window candidates were still selectable | Both automatic branches refilter by the post-trim estimate; heuristic scorer enforces capacity | `src/main.ts:2467`, `:2515`, `src/auto-route.ts:574` |
| 13 | History save fell back to an in-place truncating write, destroying old history on partial failure | Atomic rename only, bounded retry for transient sharing codes; a failed save leaves old bytes intact | `src/routing-history.ts:153` |
| 14 | PDF cache temporary overflow only shrank on another `open()` | Returning a lease evicts idle overflow immediately | `src/pdf.ts:138` |

### Regression coverage by file

- Recovery: `audit-win-followup-recovery.test.ts` (stat-success/read-failure via real `clearPendingEdits`, three error codes, byte-identical journal preserved).
- Routing: `audit-win-followup-routing.test.ts` (post-trim selection, cross-provider heuristic, empty-window refusal, both send-branch wiring).
- History: `audit-win-followup-history.test.ts` (transient rename succeeds; persistent failure preserves old bytes and cleans temp; no `Atomics.wait`).
- Data integrity: `audit-win-followup-data.test.ts` (UTF-8 boundary; CRLF apply→decline).
- Providers/security: `audit-win-followup-providers.test.ts` (cwd `node.cmd` never runs; lone-CR filter; vault sweep on reconnect; runtime dirs kept; first-mirror sweep; planted SystemRoot rejected).
- Vault/graph: `audit-win-followup-vault-graph.test.ts` (page continuation, non-paginated truncation, case-alias unsaved read).
- Cache: updated/added `audit-win-attachments-pdf-cache.test.ts` and `audit-win-pdf-wiring.test.ts` cases (lease-release eviction, distinct File identity).
- UI lifecycle: `audit-win-perf.test.ts` now asserts a single registered observer cleanup.
- Obsolete assertions corrected: `audit-win-claude-shim.test.ts` (bare `node` → absolute interpreter).

---

## 4. Original Windows pass (context, already reviewed)

Eight area reports plus the shared brief and serial consolidation log cover the
earlier work; headlines:

- **Failure/process:** shim control-char refusal, copied-env casing, Codex
  credential-link identity, journal stat/read-only handling, exit-aware tree kill.
- **Streams/lifecycle:** chat lock retries, failed-spawn timer/listener cleanup,
  handshake cleanup, CRLF splitting.
- **Security/privacy:** Windows Hermes home discovery, credential-vault exclusion,
  hard-link/dangling-entry cleanup, filtered `.env`, Windows/UNC error redaction,
  canonical instruction refusal, reconnect rewrite gating.
- **Auto/context:** linear history prune, classifier basename privacy, selection
  trimming, CRLF cache keys, macOS-only routing gate.
- **Providers/usage:** OpenCode bind/startup retry with takeover protection,
  finite reset-time validation, shared limit matching, CRLF JSON/fence parsing.
- **Tools/context:** CRLF block/table/property handling, enforced graph budget,
  case-alias scoping, hardlink/junction refusal, Canvas formatting.
- **Attachments/PDF:** editor-normalized inline diffs, BOM UTF-16 / conservative
  Windows-1252 decoding, PDF citations, leased PDF document cache, OCR no-op.
- **Main/UI:** coalesced review rebuilds, detached observer cleanup, normalized
  Markdown reads with raw-format guards, redacted chat errors, Markdown-only
  property proposals.

Orchestrator consolidation O1–O6 (`windows-consolidation-log.md`) resolved the
cross-area interactions, including direct Node launch for npm Claude shims, PDF
cache wiring, shared case-alias/size guards, untrusted-tool-output wrappers for
all four providers, catalogue context windows and literal fail-closed trims.

---

## 5. Verification evidence

- **Gates (final tree):** see §1. Commands run on the host above; results are
  reproducible with `npm run check && npm run lint && npm test && npm run build
  && npm run check:release && npm run guard:test && git diff --check`.
- **RED→GREEN:** the recovery read-failure test was observed failing
  (`Missing expected exception`) before the fix and passing after; focused
  suites then passed (recovery 17/17; follow-up batch 51/51).
- **Flake hardening:** the only intermittent full-suite failure observed was an
  `audit-providers-opencode-lifecycle` scratch-folder teardown hitting a
  transient Windows EPERM under parallel load (not a product assertion). Its
  cleanup now retries on EPERM/EBUSY/EACCES; subsequent full runs were green.
- **macOS preservation:** `git diff HEAD -- src/ocr.ts src/visual.ts
  src/model-profiles.ts` is empty; darwin branches and FM routing remain gated
  and spy-probed never to spawn on win32.
- **Skip accounting:** the single visible skip is the genuine file-symlink test
  requiring Windows Developer Mode. Some pre-existing tests return early off
  their platform; a green runner total is not proof those bodies executed.

### Two self-inflicted defects caught during the work (for honesty)

1. A patch tool mangled `\r`/`\n` escapes inside a regex literal and a
   `\u000D`-style edit; repaired with escape-free/verified Node transforms and a
   `tsc` check immediately after.
2. A transform wrote `'C:\Windows'` where `'C:\\Windows'` was required (JS `\W`
   collapses to `W`); lint flagged it (`no-useless-escape`) and a pinned test
   now asserts the exact fallback literal.
3. An initial system-directory fix used the protected `System32\config\SYSTEM`
   hive as a probe, which throws EPERM even to stat on a normal user account;
   replaced with statable core DLLs and documented why the hive cannot serve.

---

## 6. Not verified / remaining limits

- **No running-Obsidian live pass.** Obsidian was not running and no debug
  endpoint was available on the checked ports. Unit and fake-protocol evidence
  is not a live-vault certification. Still required before release: install the
  exact three files in the disposable Test vault, exercise accept/decline,
  installed-provider connect/tool/cancel/reconnect (including a real npm Claude
  multiline turn and a Hermes private-home connect), PDF cache flows in-app, and
  the Windows Automatic-mode gate staying unavailable.
- **Optional ZIP packaging** needs an external `zip` executable, absent here;
  the three-file release check is separate and passes. Remote CI/release assets
  were not exercised.
- **Second independent fix review incomplete:** the account's daily usage limit
  stopped the delegated reviewers mid-task. The orchestrator finished and
  verified the fixes itself; this is not a fresh-context independent re-review.
- **Residual risk notes:** `SystemRoot`-derived trust now requires core DLLs but
  a privileged attacker who can also plant/read those and control the process
  environment remains out of scope; delimiters are defense in depth, not a
  prompt-injection enforcement boundary. Scoped backlog and designs stay in
  `REVIEW-windows-hardening-pass.md` §5.

---

## 7. Staging

Nothing was committed. Suggested staging when approved:

```
git add src/ tests/ audits/3.7.0-rc/ AUDIT.md TESTING.md CHANGELOG.md \
        RELEASE-NOTES.md COMMUNITY-RELEASE.md REVIEW-3.7.0-RC.md audits/README.md
git status   # confirm nothing unexpected; main.js is a build artifact
```

Review `git diff --cached` before committing. Do not publish until the §6 live
checks pass and the owner accepts the §5 product decisions (Windows Automatic
selection stays macOS-only unless explicitly changed).
