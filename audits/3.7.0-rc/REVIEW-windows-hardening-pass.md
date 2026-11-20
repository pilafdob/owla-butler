# REVIEW — 3.7.0-RC Windows hardening pass (round 2), for the next reviewing agent

Date: 2026-11-19 · Branch: `3.7.0-RC` · Base commit: `81540fb` (3.7.0 release prep, clean)
Orchestrator: Hermes (desktop session). Eight parallel Windows-focused audit-and-fix
agents with disjoint file ownership, plus serial orchestrator consolidation (O1–O6)
and an independent fail-closed review (§9). This document is the review entry point.
Canonical location: `audits/3.7.0-rc/REVIEW-windows-hardening-pass.md` (root pointer:
`REVIEW-3.7.0-RC.md`). Round 1's handoff stays at `REVIEW-rc-hardening-pass.md`.

Per-agent reports (evidence, probes, file:line, exact proposals) in this directory:
`windows-failure-process.md`, `windows-stream-leaks.md`, `windows-security-leaks.md`,
`windows-auto-mode.md`, `windows-providers-usage.md`, `windows-tools-context.md`,
`windows-attachments-vision.md`, `windows-performance-main.md`.
Orchestrator cross-file work: `windows-consolidation-log.md`. Shared agent contract:
`windows-pass-brief.md`.

**Scope note:** this round targeted Windows behaviour (the dev/host platform).
macOS-specific functions and supporting code were preserved by hard rule:
`src/ocr.ts` (macOS Vision OCR) and `src/visual.ts` have **zero diff**; darwin
branches in attachments/cli/hermes are untouched; Apple Foundation Models routing
is intact and spy-probed never to spawn on win32 (macOS wording byte-identical).

---

## 1. Gate status

| Gate | Baseline (at fan-out) | Final (post-consolidation) |
|---|---|---|
| `npm run check` (tsc --noEmit) | ✓ | ✓ |
| `npm run lint` (eslint src) | ✓ | ✓ |
| Full suite (`node --import tsx --test tests/*.test.ts`) | **479 tests, 467 pass, 12 fail** | **752 tests, 751 pass, 0 fail, 1 designed skip** |
| `npm run build` | ✓ 975.3 KB | ✓ **991.5 KB** |
| `npm run check:release` | ✓ | ✓ |
| `npm run guard:test` | ✓ | ✓ |

The 12 baseline failures were ALL one root cause: security test fixtures created
file symlinks, which need Windows Developer Mode (EPERM here). Fixed by their
owners with hard-link/junction fixtures so the security assertions EXECUTE on
Windows unprivileged; POSIX assertions unchanged; exactly one sanctioned skip
remains (the genuine file-symlink property in `security-vault.test.ts`, labelled
"needs Windows Developer Mode"). +273 regression tests this round (including
the 14-test independent-review fix cycle).

One load flake observed and attributed: `audit-providers-opencode-lifecycle`
"stopping during session creation ends the turn promptly" failed once under
full-suite parallel load, 9/9 green isolated, and the clean full re-run had 0
failures. Port/lifecycle timing under load — not a regression; watch it.

## 2. The eight agents (ownership disjoint; shared tree stayed safe)

| # | Agent | Owned src | Fixes | Report |
|---|---|---|---|---|
| 1 | win-failure | cli, recovery, codex | 8 | windows-failure-process.md |
| 2 | win-stream | stream, chats, claude | 4 | windows-stream-leaks.md |
| 3 | win-security | hermes, render-sanitize, validation, tool-guard | 12 | windows-security-leaks.md |
| 4 | win-auto | auto-route, routing, model-profiles, routing-history | 7 | windows-auto-mode.md |
| 5 | win-providers | provider, exhaustion, usage, opencode*, core | 5 | windows-providers-usage.md |
| 6 | win-tools | canvas, bases, excalidraw, vault-graph, plugin-api, pdf-tools, organization, note-tools, knowledge, search | 9 | windows-tools-context.md |
| 7 | win-attachments | attachments, visual, ocr, editor-diff, pdf | 4 | windows-attachments-vision.md |
| 8 | win-perf | main.ts (sole owner) | 6 | windows-performance-main.md |

Rules enforced: read-only git, no agent builds, no live model turns/daemon
contact/vault mutations, scratch-only probes, main.ts report-only for 1–7,
cross-file needs as exact proposals. All proposals applied serially by the
orchestrator (§3) once BOTH owners finished.

### Headlines per domain

**Failure/process (8):** CR/LF in `.cmd`/`.bat` shim argv silently truncates
cross-spawn's wrapped `cmd /c` line (probe-proven) → spawnCli fails closed on C0
controls (tab exempt), POSIX untouched; uppercase `COMSPEC`/`SYSTEMROOT` in spread
env copies missed by the trust helpers → case-insensitive scans; **hard link
planted to another credential kept by the Codex private home** → nlink>1 must
share the sign-in's ino/dev; NTFS case-fold alias churn → win32-normalized
comparison; **journal stat failure (EBUSY/EPERM) read as [] → clearPendingEdits
deleted the journal** → fail closed except ENOENT; read-only journal rename EPERM
→ win32-gated chmod+retry; log rotation best-effort; tree-kill fallback re-checks
exit state (PID recycling), killer unref'd. Baseline codex fixture fixed; 4
Windows-skipped process tests now run via .cmd shims.

**Stream/leaks (4):** ChatStore save/remove ride out transient Defender/OneDrive
locks (bounded 3-attempt retry, other errors instant); no kill/grace timers for
never-spawned children (POSIX dead-timer leak); spawn errors worded; handshake
settle releases stderr listener + guards stdin.end. Verified sound under CRLF:
RecordSplitter cap counts \r and fails closed at limit+1, ≥3-chunk straddle fix
holds, taskkill /T /F reaps shim+grandchild, cmd metacharacter escaping intact,
env strip case-insensitive, auth JSON UTF-8 regardless of cp850.

**Security (12, four HIGH):** Hermes **credential vault (vault/: encrypted
autofill secrets + Fernet key) was mirrored on Windows** → excluded (real-home
probe: 60 entries → 50 excluded/10 mirrored = exact keep list); mirror read
`~/.hermes` but the Windows CLI uses `%LOCALAPPDATA%\hermes` → platform-
parameterized hermesUserHome; **hard links bypassed planted-link validation**
(read-as-auth / write-through) → replaced every pass; **excluded names absent
from the real home were never swept** (dangling gateway.sock/state.db plants
survived to receive the gateway's first write) → private-home sweep. Plus:
.env blocklist blocks ComSpec/PATHEXT/PSModulePath/windir/SystemRoot/SystemDrive/
PATH re-injection; error redaction catches Windows home spellings (slashes/case/
\\?\/8.3/other users) + UNC, and the RPC turn-error path (was unredacted);
instruction refusal .MDC case fold + realpath canonicalization; junction fallback
replaces truncated 8 MiB directory copies; **round-1 §5.3 DONE** (reconnect
rewrite gate, validation never skipped); **round-1 §5.6 DONE Hermes-side**
(<untrusted_content> wrapper + escape + standing rule). MCP loopback verified:
IPv4-only bind, constant-time token, UTF-8 byte cap (live 413), post-disconnect
guard. All 12 baseline symlink failures repaired (20 test-level failures in
owned files).

**Auto mode/efficiency (7):** **routing-history prune was quadratic** (3,000-
model/5.3 MB history blocked the UI 35 s, probed) → linear per-entry byte
accounting, 62 ms (~564×), LRU order + byte limit preserved; rename over an
indexer-held handle EPERM → direct-write fallback (probed) + MAX_PATH temp
suffix; **full OneDrive paths leaked into the FM classifier inventory** →
sanitizeBasename (POSIX names unchanged); **round-1 §5.4 owned part DONE**:
trimSelectionsToWindow + bestContextWindow (largest-first, read_note marker,
notice, provably non-optimistic estimate; wired by orchestrator O4); CRLF prompts
no longer split the 64-entry route cache; FM never spawned on win32 (spy-probed,
clean unavailable message); §5.8 decision: dead countFoundationModelTokens
removed (zero callers; export-absence pinned; reintroduce with live FM
calibration).

**Providers/usage (5):** **round-1 M7 freePort bind race closed** — probe retry
for Windows excluded port ranges + bounded 3-attempt startup retry with
generation/takeover guards (a user disconnect is never resurrected); **NaN
resetsAt created permanent provider blocks** (probe: a Go pool block persisting
10 years) → isFinite guards across decoders/exhaustion/applyUsage; limit readers
unified on LIMIT_ERROR ('too many requests' missed, '14293' false-positive);
core.ts stripFence unwraps CRLF fences, parseJsonLine survives '[DONE]\r'.
Verified: env casing no bypass/credentials kept, binary detection shapes,
9/9 process-runner probes, DST/offset reset epochs.

**Tools/context (9, two HIGH):** **findBlock returned the whole CRLF note**
instead of the paragraph → fixed, LF ranges byte-identical; **vault-graph 60 KB
cap was unenforced** (300 KB tags, 180 KB nested frontmatter, and a 65 MB result
from a 116-byte YAML-anchor note measured on round-1 code) → budgeted shortValue
+ hard boundGraph (anchor case now 6,227 bytes); canvas serializer CRLF
round-trip byte-identical; updateProperties keeps CRLF frontmatter style;
noteGraph resolves NTFS case aliases to canonical spelling (POSIX refusal
preserved); organization list() case-fold fallback only when the filesystem
resolves it (junctions never qualify); tableAt trailing \r stripped;
forward-slash hints for backslash args. Verified: junction/hardlink refusal on
real NTFS, pre-folded under() exact semantics (40,000 randomized case/Unicode
comparisons, 0 mismatches), all other entry-point caps.

**Attachments/vision (4):** **CRLF notes never showed inline diff highlights**
(CodeMirror normalizes to \n; the guard never matched and ranges were \r-count
off) → testable diffDecorations with editor-exact normalization, LF pinned
byte-identical; **Windows Notepad UTF-16 (LE/BE BOM) and ANSI prose attachments
refused as binary** → attachmentTextEncoding (BOM detection + gated windows-1252
with control-byte refusal); attachment text CRLF-normalized so line endings
don't inflate the 64k budget; pdfPageReference accepts backslash paths;
**round-1 §5.1 DONE**: PdfDocumentCache (2-doc LRU, path+size+mtime key,
refcounted leases, deferred destroy never tears down an in-flight read, failed
loads uncached, no file handles held; 13 lifecycle tests) — wired by O2.
**ocr.ts: ZERO code changes**; Windows skip verified clean (no fs writes, no
compiler probe, picture still returned); macOS helper pinned by tests.

**Performance/main (6):** **round-1 §5.2 DONE**: renderPendingEdits coalescing —
all 19 call sites surveyed, one microtask rebuild per tick, dirty-signature skip,
editor-wide broadcast gated to pending-set changes, H2 sync semantics preserved
verbatim (cross-verified against the real security-main assertions); reply
sanitize observers discarded on newChat (detached DOM no longer retained);
CRLF/lone-CR normalization of Markdown reads (currentText/search snapshots/
read_note validation) matching CodeMirror semantics, canvas/base/drawing bytes
exact; writeEdit freshness compares content not line endings; friendlyError
redaction at 3 raw ChatStore surfaces; propose_properties guarded to plain
Markdown (could prepend YAML to canvas/base JSON or strip a drawing's plugin
key). Round-1 top-10: 9/10 verified landed; item 5 landed via O2.

## 3. Orchestrator consolidation (serial; details in windows-consolidation-log.md)

- **O1 — npm-shim → direct node launch for Claude.** win-failure's fail-closed
  control-char guard (correct: cmd.exe truncates /c lines at CR/LF) × main.ts's
  always-multi-line instructions would have refused most Claude turns via npm's
  claude.cmd shim. Root-cause fix: `windowsShimScript`/`shimLaunch` in claude.ts
  recognise ONLY the standard npm cmd-shim layout (quoted %~dp0 .js target, node
  invocation, single unambiguous script, plain relative path — no %, drive
  letter, .., control chars; script must exist) and spawn node directly
  (arguments verbatim, no cmd.exe). Anything else keeps the guarded shim path.
  All 3 launch sites wired. 6 new tests incl. end-to-end multi-line delivery.
- **O2 — PDF cache wiring + read retries + CRLF review display** (win-attachments
  X-1/X-2/X-3): lease-based withPdfDocument, pdfCacheKey, destroyAll on
  newChat/stop/onClose, vault.on('modify') invalidation (Windows ms-granularity
  mtime aliasing); readBinaryRetry (≤3, EBUSY/EPERM/EACCES only) at readPdfBytes,
  addAttachments AND the annotation-modal freshness read (extra site found);
  reviewText/revealInNote normalize via noteText. 7 new wiring tests.
- **O3 — win-tools P1–P5 + win-perf P1/P4 + win-providers X1:** currentText
  case-alias resolution (win32/darwin + filesystem-resolved + exclusion-first),
  search_vault folder normalization/canonical scoping, read_note cache
  exact-equality (see §4), 2 MB read caps, 300-char reason caps, organization
  CRLF open-note comparisons, excludedCache FIFO(32), cli win32.join purity.
  9 new wiring tests.
- **O4 — win-security P-W1..P-W5 + win-auto P1/P2 + win-failure X1:**
  untrustedToolText moved to validation.ts (hermes re-exports); PATHEXT/
  PSModulePath stripped from all provider spawn envs; codex redactDetail →
  shared redactErrorDetail; codex instruction walk realpath-canonicalized;
  tool results wrapped in <untrusted_content> for Codex/Claude/OpenCode (+
  standing rule in shared instructions; Hermes's own append made idempotent);
  OpenCode 32 MiB caps count UTF-8 bytes; selection trimming wired into BOTH
  auto branches; hermesModelContextWindow (models.dev limit.context) + context
  field in the Hermes model builder; sameMirrorPath case-fold. Wrapper
  assertions updated per bridge + escape regressions (claude toolContent,
  codex receive-level, opencode echo regexes).
- **O5 — independent-review fix cycle (6 logic errors, 0 security concerns).**
  The fail-closed reviewer (§9) verified the security overhaul sound but blocked
  on six logic errors; all fixed with regressions in
  `tests/audit-win-review-fixes.test.ts` (12 tests):
  1. **$-pattern injection in the trim splice** (probe-verified by the reviewer):
     `context.replace(oldSection,newSection)` interpreted `$&`/`$'`/``$` `` from
     vault-controlled selection text — silently undoing the trim while the
     estimate claimed it happened. Now splices at the known append position
     (attachedStart, verified by slice equality) with a function-replacement
     fallback; decoy blocks in the active note cannot become the site.
  2. **CRLF drawing offsets in writeEdit**: the F4 freshness relaxation let
     raw-CRLF drawing/canvas/base snapshots apply at LF-editor offsets via
     commonChange (silent corruption; pre-diff code failed safe). Normalization
     now gates to plain Markdown only; raw-byte types keep the exact comparison.
  3. **Atomics.wait in chats.ts retryLocked throws on Electron's renderer main
     thread** (where Obsidian plugins run) — the lock retry was inert on the
     target platform. Replaced with a bounded Date.now busy-wait (≤2×25 ms,
     rare path); regression simulates the TypeError.
  4. **noteGraph alias fallback misfired for linkless indexed notes** (empty
     link caches ≠ absent note) — a case-twin's graph could be returned on
     case-sensitive hosts. Trigger now also requires the exact spelling to be
     unindexed; notes() stays lazy (scan-count test preserved).
  5. **2 MB read caps bypassable via case aliases** (getFileByPath is
     case-sensitive while currentText resolves aliases). New
     Butler.resolvedVaultFile/resolvedVaultFolder (exact lookup + win32/darwin
     statSync-gated fold fallback) shared by currentText, both cap sites and
     search_vault scoping; organization.list() gained the host gate.
  6. **findBlock drifted from old LF ranges on odd blank-line runs**
     ('para\n\n\n^id' start 6 vs old 7). The scan now overlaps
     (lastIndex=index+1), restoring lastIndexOf semantics exactly.
  Plus suggestion S1: UNC redaction no longer eats http(s) URLs ((?<!:) gate);
  access_token/refresh-token assignments now redacted.
- **O6 — reviewer round-2 suggestions closed.** (a) The URL exemption moved to
  the '//' side only (`(?:\\\\|(?<!:)\/\/)`) so a colon-adjacent BACKSLASH UNC
  ('path:\\server\…') is redacted again; (b) trimSelectionsForWindow is now
  fail-closed: if neither the position splice nor the literal fallback lands,
  payload, selections and estimate ALL stay untouched (no optimistic estimate
  against future context-assembly edits). 2 more regressions (14 total in the
  fix-cycle file). Final gates: 752/751/0/1, build 991.5 KB.

## 4. Conflicts & interactions reconciled (review these decisions)

1. **read_note metadata cache vs CRLF offsets.** win-perf F3 kept the cache fast
   path for CRLF notes via noteText(saved)===text; win-tools P3 showed cache
   offsets may describe the RAW CRLF file, so slicing normalized LF text with
   them can misalign sections. Decision: correctness first — cache only on
   byte-exact saved===text; CRLF notes use the CRLF-safe pure finders. win-perf's
   test updated to assert exact sections. Follow-up: verify Obsidian's offset
   convention live; if LF-based, restore the fast path.
2. **Control-char guard × multi-line prompts** — resolved by O1 (mechanism fix,
   guard NOT weakened). win-stream's mechanism-agnostic regression stays green
   (now via delivery, not refusal).
3. **Proposal snippet typo** `trim.e...ens` → `trim.estimatedTokens` (caught by
   tsc during O4; the report snippet carried it).
4. **Tooling hazard (documented for future passes):** the patch transport can
   land `\r` escapes as real CRs, splitting regex literals. Hit claude.ts,
   organization.ts and two agents' WIP; all repaired byte-exactly via scratch
   Node transforms and verified (tsc + stray-CR scan). Escape-sensitive edits
   should avoid `\r` in patch parameters or use verified transforms.

## 5. Deferred backlog (risk tiers; designs in the per-agent reports)

**CAREFUL — needs live verification before applying:**
- TMPDIR/TEMP/TMP pinning for child envs (win-failure D1; CLIs use temp for
  IPC/lockfiles, EXDEV risk).
- M7 full elimination via `opencode serve --port 0` + bound-URL parsing
  (win-providers; needs live daemon).
- Organization checkpoint O(M×N) redesign (win-tools D1; recovery-journal
  integrity first; fingerprint-cache design ready).
- Journal-save EBUSY/EPERM retry (win-tools D2; fault-injection tests needed).
- Async startup loads (win-perf D2; onload ordering is lifecycle-sensitive).
- vaultStorageKey case canonicalization (win-security P-W6; alias-spelled
  storage dirs would orphan — needs a migration step; isolation itself holds).
- Excalidraw export size cap (win-attachments D-1; uncapped createPNGBase64
  data URLs reach providers; needs DOM, live verify).
- Windows auto-mode enablement (win-auto §4.2) — **product decision, do NOT
  change silently**: engine is Windows-ready but disableAutomaticSelectionOutsideMac
  intentionally keeps Automatic macOS-only; design + eval-suite requirement documented.

**LOW / cosmetic / carried:**
- PDF-cache torn snapshot (reviewer S2): bytes and key are separate snapshots;
  a OneDrive hydration completing after a stat update could cache old bytes
  under a new key (the modify event fired before the entry existed). Design:
  per-path modify epoch in the key, or key from the same snapshot. Rare race.
- PDF-cache in-flight parse cancel (reviewer S3): abort during a parse
  completes-then-discards (O2 trade-off); store the loading task synchronously
  on the cache entry so stop()/destroyAll can cancel promptly.
- sameMirrorPath realpath comparison (reviewer S5): case-fold equality could
  accept a planted link under per-directory case sensitivity (WSL fsutil flag
  on the private home) — exotic prerequisite, not a realistic threat today.
- hermesModelContextWindow cross-provider bare-key fallback (reviewer S6) can
  borrow a same-named model's window when the actual provider's catalog lacks
  the id (matches the existing modalities pattern); live-verify before release.
- EBUSY retry needs async API for recovery journal (win-failure D2 design).
- OEM cp437 stderr decoding (Node TextDecoder lacks ibm437; cosmetic mojibake
  in probe-error text only).
- taskkill PID TOCTOU microsecond window (inherent; exitCode re-check mitigates;
  eliminating needs native handle duplication).
- opencodeDataHome Windows desktop path unverified (no desktop app on host).
- Excalidraw LF drawing header in CRLF wrapper (win-tools D3; plugin normalizes
  on next save).
- Pipeless one-column table delimiter (win-tools D4; setext-heading ambiguity,
  needs live parser check).
- Trim before history capture (win-auto §4.4; attachedContext replay is pre-trim,
  bounded by the 64k cap, conservative).
- Live FM token calibration (macOS; reintroduce countFoundationModelTokens with
  its caller + measurement).
- remainingUsage Codex weekly-reset semantics (round-1 open question).
- displayMarkdown lone-\r line separation (cosmetic; DOM sanitizer is the
  fetch boundary).
- NTFS mode bits nominal (0o700 ignored; user-profile ACL is the real protection;
  icacls hardening would be a behaviour change — document, don't apply).
- UNC instruction-refusal live check (needs an SMB share/admin).
- Windows Firewall prompt absence for loopback bind (platform property; bind
  address test-verified, prompt absence not).

## 6. Verification evidence

- Gates: §1. Full suite run twice post-consolidation (static tree): 738/736/1
  (load flake, green isolated) then **738/737/0/1 skip**.
- Real-home Hermes mirror probe (read-only, names only): 60 entries → 50
  excluded / 10 mirrored = exact keep list; `~/.hermes` absent on this host
  (proves the Windows home-path bug was live).
- Quadratic-prune probe: 3,000-model/5.3 MB history 35 s → 62 ms.
- YAML-anchor vault-graph probe: 65 MB result on round-1 code → 6,227 bytes now.
- 40,000 randomized case/Unicode comparisons of pre-folded under() vs the
  original: 0 mismatches.
- cmd.exe truncation, taskkill tree-reap (shim + grandchild), ComSpec casing,
  read-only rename EPERM, hard-link plant, NaN decade-block: all probe-proven
  pre-fix and regression-tested post-fix (per-agent reports).
- macOS preservation: `git diff src/ocr.ts src/visual.ts` empty; OCR helper
  source/version pinned by tests; FM never spawned on win32 (spy probe);
  POSIX LF behaviour pinned byte-identical in every CRLF fix.
- Containment: junction/hardlink fixtures run unprivileged on Windows;
  security-vault/security-main assertions execute (not skipped) after the
  fixture repair.

## 7. NOT verified live (name the gaps before release)

- No running-Obsidian exercise: no accept/decline UI, no real provider turn,
  no real `hermes acp` connect through the per-vault home, no PDF-cache
  modify-event flow in a live vault (unit/fake-CLI level only).
- The npm-shim → node resolution was tested against fake npm-layout shims, not
  the installed claude.cmd; shim-layout drift falls back to the guarded refusal
  (safe) but verify one real npm-installed Claude turn on Windows.
- Real Hermes context windows: accessor schema confirmed against the live
  public models.dev API, but no live Hermes connect consumed it.
- OpenCode/Claude/Codex/Hermes fakes speak the real protocols but are not the
  installed CLIs; version drift remains a release-gate candidate (round-1 M6/L14).
- Windows: this host IS Windows 11 (code + process probes real); macOS/Linux
  paths are platform-parameterized tests only.
- Before calling 3.7.0 release-ready: install the build in the test vault
  (C:\Users\filip\Documents\Coding\Test) and run the live flows per TESTING.md.

## 8. Review focus (hardest looks, in order)

1. `src/hermes.ts` mirror overhaul (exclusions/sweep/hardlink/junction/rewrite
   gate) — security-critical; the 79-entry round-1 completeness probe evolved
   (60-entry real-home probe this round); re-run both mentally against the keep list.
2. `src/main.ts` O1–O4 wiring: pdf-cache lease lifecycle (abort during parse now
   completes-then-discards instead of instant cancel — bounded, but confirm),
   trimSelectionsForWindow payload replacement (oldSection must match the
   appended block exactly), case-alias gates (host + filesystem + exclusion order).
3. `src/claude.ts` windowsShimScript fail-closed matrix (ambiguous targets,
   traversal, %-expansion, drive letters, control chars, missing script).
4. `src/cli.ts` guard + ComSpec pinning + env casing (shared launcher; every
   provider rides it).
5. `src/validation.ts` redactErrorDetail Windows regexes (over-redaction?
   missed shapes? catastrophic backtracking?) + untrustedToolText escape.
6. `src/routing.ts` trimSelectionsToWindow non-optimistic estimate guarantee;
   `src/routing-history.ts` linear prune LRU/byte-limit preservation.
7. `src/organization.ts` CRLF comparisons + case-fold list fallback (junctions
   never qualify) — security-sensitive semantics.
8. Test fixture repairs: confirm no assertion was weakened (one sanctioned skip).
9. Bundle: 990.9 KB minified (round-1 policy choice stands).

## 9. Independent review verdict

**Round 1 (full diff):** fail-closed reviewer, fresh context, diff-only.
Verdict: `passed=false` — **0 security concerns, 6 logic errors**. The security
overhaul itself was verified hard (Hermes vault/ exclusion, %LOCALAPPDATA% home,
nlink>1 replacement, absent-name sweep, junction fallback, reconnect gate never
skipping validation; .env hijack blocking in every casing; ComSpec strip+pin;
shim guard; windowsShimScript fail-closed matrix; codex realpath + hardlink
identity; redaction regexes linear/ReDoS-free; untrustedToolText escaping with
the idempotent standing rule; opencode generation/takeover guards traced — a
user disconnect is never resurrected; UTF-8 byte caps; linear LRU prune;
non-optimistic trim estimate; fixtures preserve/strengthen every assertion).
The six logic errors were fixed in orchestrator batch O5 (§3) with 12 new
regressions; gates re-run green (750/749/0/1, build 991.5 KB).

**Round 2 (fix verification):** **PASSED.** The same independent reviewer
re-examined all six fixes in source AND by execution, independently re-ran the
full suite (matching gates), and confirmed every non-fix diff byte-stable
versus round 1. Verdict: `passed=true`, 0 security concerns, 0 logic errors.
Deferral of S2/S3/S5/S6 (§5) accepted as non-blocking with designs recorded.
Two new non-blocking suggestions came with the verdict (colon-adjacent UNC
redaction gap; fail-closed estimate on a hypothetical splice miss) — BOTH
closed in O6 with regressions; final gates re-run green (752/751/0/1).

**Superseded by the 2026-11-20 independent follow-up:** the earlier PASSED
verdict above describes O1–O6 only, not approval of the current candidate.
Fresh independent source reviews found additional security/data-integrity
issues; their remediation and final gate evidence are recorded in §11 and
in the living `AUDIT.md` / `TESTING.md`. The live-verification gaps in §7
and product decisions in §5 remain. Nothing was committed.

## 10. Staging notes (user approves commits; nothing was committed)

Everything in the working tree is THIS pass's work (base 81540fb was clean;
round-1's external-WIP concern no longer applies). 33 modified files + new
tests/reports. Suggested explicit staging:

```
git add src/ tests/ audits/3.7.0-rc/
git status   # confirm nothing unexpected; main.js is a build artifact (gitignored or stage per release workflow)
```

Review `git diff --cached` before committing. Do NOT commit until §9 is filled
and the owner accepts the §5 product decisions (Windows auto mode stays
macOS-only unless explicitly changed).

## 11. Independent follow-up — 2026-11-20

Three fresh read-only reviewers traced the working diff and executed synthetic
reproductions on Windows. Their focused passing suites did **not** invalidate
the additional defects they reproduced. The original §9 approval is therefore
superseded; the candidate is not release-certified by that verdict.

| Finding | Consequence / remediation scope |
|---|---|
| Recovery stat succeeds but read fails | Empty-array fallback lets clear delete the unread journal; separate I/O failure from tolerant malformed-JSON recovery. RED/GREEN regression now exercises actual clear and all three sharing/permission codes. |
| Claude bare Node fallback | Windows cwd-first executable resolution can run a session-directory `node.cmd`; use a validated absolute Node executable. |
| Stale Hermes credential directory | Normal copied `vault/` directories survive excluded-link cleanup; remove stale excluded copies without removing live private runtime state. |
| Lone-CR dotenv assignments | Python dotenv recognizes blocked variables after CR that the filter did not split; align line parsing. |
| System-directory trust | A supplied directory containing fake `System32/cmd.exe` is not proof of the Windows installation; establish trust independently of caller env. Pre-existing weakness. |
| Plain-Markdown CRLF editor offsets | Normalized freshness plus raw proposal offsets corrupts apply/rollback; normalize both proposal sides for editor operations only. |
| External PDF identity | Different File objects sharing filename/size/mtime reuse the wrong document; stable object identity is required. |
| Graph pagination after byte limiting | Removed page items lose their continuation and become unreachable; continue from the first unreturned source item and expose truncation. |
| UTF-8 sample boundary | Partial terminal multibyte characters falsely trigger ANSI decoding; use non-final streaming semantics. |
| Alias reads and unsaved content | Canonical resolution occurs after open-view lookup; resolve first and retain canonical proposal identity. |
| Per-reply unload closures | Disconnected observers remain reachable through registered callbacks; use one view-level draining callback. |
| Post-trim routing eligibility | Smaller windows remain in relaxed candidates; refilter both send branches and enforce the budget in heuristic scoring. Four routing regressions pass. |
| History fallback atomicity | In-place fallback can destroy all old history after partial-write failure; preserve the old file with bounded rename retry instead. |
| PDF lease-release capacity | Temporary concurrent overflow must shrink when leases return, not wait for another open. |

All fourteen findings were fixed with regressions (key ones observed RED then
GREEN) and the tree was re-verified end to end: `npm run check`, `npm run lint`,
`npm test` (**774 total / 773 pass / 0 fail / 1 designed skip**), `npm run build`
(993.2 kb), `npm run check:release`, `npm run guard:test` and `git diff --check`.
A second independent fix review of every remediation could not be completed:
the account's daily model usage was exhausted mid-task, so the delegated agents
stopped after applying partial edits and the parent finished the remaining fixes
itself, verifying each with its regression. Final evidence is in root
`TESTING.md` (gates and remaining live checks) and `AUDIT.md` (cumulative scope).
No real credential contents or model turns were used. Optional Windows ZIP
packaging is blocked by a missing external `zip`; this is separate from the
passing three-file release gate.
