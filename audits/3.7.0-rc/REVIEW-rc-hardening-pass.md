# REVIEW — 3.7.0-RC multi-agent hardening pass, for the next reviewing agent

Date: 2026-11-19 · Branch: `3.7.0-RC` · Base commit: `c8c6dbd` (Release 3.6.3)
Orchestrator: Hermes (desktop session). Seven parallel audit-and-fix agents plus a
serial cross-file consolidation pass. This document is the review entry point:
what changed, why, what is verified, what is **pending**, and where to look hardest.
Canonical location: `audits/3.7.0-rc/REVIEW-rc-hardening-pass.md` (a pointer stays
at the repo root `REVIEW-3.7.0-RC.md`).

Per-agent full reports (evidence, probes, file:line) are in this directory:
`failure-resilience.md`, `stream-leaks.md`, `security-leaks.md`,
`auto-mode-efficiency.md`, `providers-usage.md`, `tools-context.md`, `performance.md`.

---

## 1. Gate status right now

| Gate | Result |
|---|---|
| `npm run check` (tsc --noEmit) | ✓ pass |
| `npm run lint` (eslint src) | ✗ **1 error + 2 warnings — all three from the pending batch in §2** |
| `npm test` | **480/481** — the single failure is the pending batch in §2 (ran twice, identical) |
| `npm run build` | ✓ pass — **973 KB** (was ~1.7 MB; `minify:true`, −43%) |
| `npm run check:release` | ✓ pass (gate script made minify-aware, see §4.6) |
| `npm run guard:test` | ✓ pass |

Baseline before the pass: check ✓, lint ✓, **342/342**, build ✓, guard ✓.
Test count grew 342 → 481 (agent regression tests + concurrent external features).

**Do not commit or publish until §2 is applied and all gates are green.**

## 2. PENDING — approval-blocked batch (apply first)

An approval prompt for this exact batch timed out while the user was away; the
orchestrator was instructed not to apply it or route around it. The three fixes
below are fully specified and scoped. They are the ONLY source of the current
lint error/warnings and the single test failure.

### 2.1 `src/hermes.ts` — empty catch (lint `no-empty` error, ~line 780)
In `rest()`:
```ts
// old
  if(this.connecting){try{await this.connecting;}catch{}
// new
  if(this.connecting){try{await this.connecting;}catch{/* A failed connect leaves nothing to rest. */}
```

### 2.2 `src/main.ts` — window timers (2 `obsidianmd/prefer-window-timers` warnings, ~lines 1310/1313)
In `renderReply`'s sanitize-coalescing observer:
```ts
// old
   else{sanitizeIsFrame=false;sanitizeHandle=setTimeout(run,16);}
// new
   else{sanitizeIsFrame=false;sanitizeHandle=window.setTimeout(run,16);}
// old
  this.register(()=>{observer.disconnect();if(sanitizeHandle!==null){if(sanitizeIsFrame)window.cancelAnimationFrame(sanitizeHandle as number);else clearTimeout(sanitizeHandle);sanitizeHandle=null;}});
// new
  this.register(()=>{observer.disconnect();if(sanitizeHandle!==null){if(sanitizeIsFrame)window.cancelAnimationFrame(sanitizeHandle as number);else window.clearTimeout(sanitizeHandle);sanitizeHandle=null;}});
```
(`window.setTimeout` is the established pattern in this file, see the streaming
scroll fallback in `send()`.)

### 2.3 `src/opencode.ts` — keep OpenCode provider credentials (fixes the failing test)
`isolatedOpencodeEnv`'s new generic `OPENCODE_*` strip currently also deletes
`OPENCODE_API_KEY`, violating the documented contract in
`tests/provider-isolation.test.ts:37` ("OpenCode reads provider keys from the
environment by design"). Failing test: *"OpenCode: the user's global config,
Claude Code skills and config overrides are not inherited"*.
```ts
// old
 for(const key of Object.keys(result))if(key.toUpperCase().startsWith('OPENCODE_')&&!(key in OPENCODE_ISOLATED_ENV))delete result[key];
// new
 const credentialSuffix=/(?:API_KEY|AUTH_TOKEN|API_TOKEN|SECRET)$/;
 for(const key of Object.keys(result)){
  const upper=key.toUpperCase();
  if(upper.startsWith('OPENCODE_')&&!(key in OPENCODE_ISOLATED_ENV)&&!credentialSuffix.test(upper))delete result[key];
 }
```
Also extend `tests/audit-rc-opencode.test.ts` env fixture with
`OPENCODE_API_KEY:'oc-'+'key'` and assert it survives (build fake values by
concatenation — the agent tool pipeline's secret scrubber mangles `KEY=***`
literals in transit).

After applying: re-run `npm run check && npm run lint && npm test` — expect
**481/481, zero lint problems**.

## 3. The seven agents (ownership was disjoint; shared tree stayed safe)

| # | Domain | Owned src files | Report (this directory) |
|---|---|---|---|
| 1 | Failure handling & resilience | recovery, cli, codex | failure-resilience.md |
| 2 | Stream & resource leaks | stream, chats, claude | stream-leaks.md |
| 3 | Security & data/token leakage | render-sanitize, validation, tool-guard, hermes | security-leaks.md |
| 4 | Model efficiency & auto mode | auto-route, routing, model-profiles, routing-history | auto-mode-efficiency.md |
| 5 | Multi-provider & usage limits | provider, exhaustion, usage, opencode*, core | providers-usage.md |
| 6 | Tool calls, context & features | canvas, bases, excalidraw, vault-graph, plugin-api, pdf-tools, organization, … | tools-context.md |
| 7 | Performance (READ-ONLY audit) | — (proposed patches) | performance.md |

Rules enforced: read-only git for agents, no builds (orchestrator builds), no
live model turns / daemon contact / vault mutations, scratch-only probes,
`main.ts`/`note-tools.ts` report-only (external agent's staged table feature).
All cross-file proposals were applied serially by the orchestrator (§4).

### 3.1 Headline fixes per domain (details in the reports)

**Failure/resilience (17 fixed):** default stdio `error` listeners in shared
`spawnCli` (an unhandled EPIPE could crash the Obsidian host — fixes the class
for all four providers); Codex connect-time death no longer mislabeled
"cancelled" (`lastFailure` tracking); oversized pending-edit journal now fails
closed instead of being silently deleted (data loss); bounded stderr tails
surface `Last error: …`; `runCli` async-abort/stdin-EOF/command-naming fixes;
Codex model pagination capped (`MAX_MODEL_PAGES=20`); friendly sign-in-link
error; Hermes errors no longer remapped to Codex wording; protocol parse vs
handler failures separated; journal fs errors named with cause; backup
retention can no longer fail an edit.

**Stream/resource leaks (8 fixed):** Claude parsers capped at 16 MiB (were
unbounded); SIGTERM→SIGKILL escalation on every Claude kill path (`stopChild`);
settled-guards stop post-cancel UI writes, new vault tool calls and state
mutation; `RecordSplitter` straddle fix for delimiters spanning ≥3 chunks;
handshake child detached for group kill; grace-timer dead-listener fix;
web-source map capped at 500; ChatStore read budget (100) for damaged folders.

**Security/leakage (12 fixed):** `processes.json` checkpoint excluded from the
Hermes mirror (crash recovery would adopt the user's live PIDs); 25 more
writable/state entries excluded (79-entry completeness probe frozen as a test:
65 excluded / 14 mirrored); `.env` filter now blocks execution-hijack + OTEL_*
keys (dotenv override=True re-injection); per-vault private home (cross-vault
takeover); lstat/readlink mirror validation (planted/dangling symlinks);
sanitized version probe; MCP hardening (constant-time token, 400 on malformed
bodies, byte cap, post-disconnect guard, closeAllConnections); error redaction;
**NEW:** Hermes ancestor instruction-file refusal (AGENTS.md/CLAUDE.md/
.cursorrules/.hermes.md chain — Codex already had this); **NEW:** SMIL
re-animation XSS gap closed; **NEW:** control-character scheme obfuscation
(`java&#10;script:`) closed; block-math `![` fidelity fix.

**Auto mode/efficiency (10 fixed):** routing-history >1 MB silent-save-then-wipe
→ LRU prune + salvage-on-load; route cache now keyed by history fingerprint;
context estimate +3000-token fixed overhead, replayed images, size-weighted
PDFs; classifier inventory budget enforced (base trim + instruction overhead);
12k-char guard moved to FM branch only (long clear-cut requests route locally);
estimate-aware overflow errors; route cache bounded (64, TTL sweep); just-reset
plan no longer penalized as unknown; Hermes colon-prefixed model dedup;
single-provider auto routes accept plan usage (wired in §4).

**Providers/usage (11 fixed):** `codexExhaustion` reset-aware + bounded 15-min
error retry; `updateUsage` per-bucket merge (sparse reports no longer drop
windows); OpenCode concurrent-run race (synchronous reservation); abort during
session creation; `rest()` awaits in-flight connect; stale resident-server
detection + restart; `recheck()` implemented; catalogue dedup; limit-error
regexes aligned; NaN percentages guarded; settings migration accepts future
schema versions (no data loss).

**Tools/context (11 fixed):** canvas summary crash guards; **canvas serializer
now byte-identical to Obsidian's canonical format** (verified on 3 real files —
every proposal used to reformat the whole file); excalidraw damage guards +
positive-size validation; 10k/100k argument caps (token-leak class); bases
filter depth guard; `noteGraph` result capped <60 KB (was 263 KB probe);
graph offset validation; plugin-api colour normalization; damaged-PDF actionable
error; organization preview N+1 double-read removed.

**Performance audit:** top-10 ranked findings with measurements; most of the
2026-11-13 audit re-verified fixed. Headline regression found: Hermes stdout
buffer was quadratic AND unbounded (180× slower at 8 MiB) — fixed in §4.

## 4. Orchestrator cross-file pass (applied serially, regression-tested)

New test files: `tests/audit-rc-{hermes,opencode,claude,codex,cli}.test.ts`
(22 tests, fake-CLI process level where relevant; all pass).

### 4.1 `src/hermes.ts` (16 edits)
- stdout `jsonBuffer` → `RecordSplitter('\n',16 MiB)` + overflow fails closed
  (stream U1 / perf rank 1 / providers U7 — three agents converged).
- `sendRpc` timeout timers stored and cleared on response/disconnect (U2).
- Bounded stderr tail + `Last error:` on spawn error/exit (failure P1).
- **`lastFailure` wired** (was declared but never set): connect surfaces the
  recorded cause instead of generic "Hermes disconnected." (codex F2 class).
- Model list dedup by id (U5); `session/set_model` failure fails the turn
  instead of silently running the default model (U8).
- `disconnect()` clears models/accountType (U6); `rest()` awaits the real
  process-tree exit via a `closing` promise instead of a 100 ms sleep, and never
  cancels an in-flight connect (U9 + opencode P5 class); `connect()` awaits a
  resting tree inside its synchronous reservation.
- Dead `buffer` field removed. `.env` blocklist extended with the cli prefix
  families (§4.5).
- Tests: turn+dedup+reap, refused set_model, oversize fail-closed, stderr cause,
  disconnect state, rest-awaits-exit.

### 4.2 `src/opencode.ts` (9 edits)
- Bounded stderr tail + cause; **`connectFailure` tracking** so a startup crash
  surfaces promptly with its cause instead of "cancelled" after 20 s of polling
  a dead port (`waitUntilReady` now stops when the child dies).
- Version probe runs `sanitizedEnv()` (security L1).
- `isolatedOpencodeEnv`: generic strip of inherited `OPENCODE_*` behaviour vars
  (L12) — **needs the credential-suffix keep from §2.3**.
- Event gate tightened: every handled event must name THIS turn's session
  (unscoped/foreign events can no longer stream text or settle the turn).
- Tests: env strip, prompt startup-crash cause, foreign/unscoped event gate.

### 4.3 `src/claude.ts` (6 edits)
- `env()` strips 13 backend/model/config/telemetry redirectors (M4), keeps the
  user's DISABLE_TELEMETRY choice.
- Different-key connect refused while one is in flight (U3).
- Malformed `auth status` JSON → actionable error (P3b); handshake stderr tail
  + cause (P3a).
- `acceptRateLimit` merges instead of replacing (U2 — safe after usage P2);
  `disconnect()` clears accountType (U6 class).
- U11 (SIGKILL escalation) verified already fixed by the stream agent's
  `stopChild` — no change needed.
- Tests: env strip, unreadable auth status, handshake stderr cause, key
  mismatch, partial rate-limit merge, disconnect state.

### 4.4 `src/codex.ts` + `src/exhaustion.ts` (8 edits)
- **Codex limit errors now set exhaustion** (U1): `exhaustion` field on the
  bridge, set on `turn/completed` failure and `turn/start` rejection via the
  shared `LIMIT_ERROR` regex (now exported from exhaustion.ts, `\b429\b`
  aligned), cleared on a completed turn. `main.ts` prefers the stored record
  and lets Codex expire by reset like the other providers (§4.7).
- `rest()` awaits an in-flight connect instead of cancelling it (U4).
- Model dedup across catalog pages (U5).
- `friendlyError` redacts Bearer tokens, credential assignments and home paths
  on both pass-through branches (L15 class; shared mapper used by all providers).
- Tests: limit→exhaustion (bounded ~15-min retry), start-rejection variant,
  clear-on-success, cross-page dedup, redaction.

### 4.5 `src/cli.ts` (2 edits)
- `UNSAFE_EXECUTION_ENV` += GIT_CONFIG_COUNT, GIT_SSH_COMMAND, GIT_EXEC_PATH,
  GIT_TEMPLATE_DIR, GIT_PAGER, PAGER, EDITOR, VISUAL, UV_PYTHON, VIRTUAL_ENV;
  new `UNSAFE_EXECUTION_ENV_PREFIXES` (GIT_CONFIG_KEY_/VALUE_) honoured by
  `sanitizedEnv` and `hermesEnvKeyBlocked` (L9). TMPDIR pinning deliberately
  NOT done (behaviour change — follow-up).
- Tests: strip list + enterprise proxy/CA keep; Hermes .env parity.

### 4.6 `esbuild.config.mjs` + `scripts/check-release.mjs`
- `minify:true` — bundle 1.7 MB → **973 KB** (perf rank 2; measured −43%,
  licenses/banner/reference-pack retained). Lazy-loading pdf-lib (~1 MB more)
  deferred: needs a 4th release asset / policy decision.
- `check-release.mjs` reference-pack extraction made minify-aware: locates the
  object by its first pack key, scans to the matching brace respecting
  single/double/backtick strings (esbuild renames the variable and switches
  quote styles). Same verification semantics: VM-eval + per-key byte equality.
  Legacy unminified shape still supported. **Review this scanner closely.**

### 4.7 `src/main.ts` (13 edits — external agent has concurrent WIP here, all patches targeted)
- `recordExhaustion`: prefers `codexBridge.exhaustion` while live; reset-time
  expiry now applies to Codex too (U1 main half).
- `applyFallback`: refreshes both records first (U10).
- Auto mode: duplicate identical `autoEntries` call replaced by context-filter
  relaxation + activity notice (auto P1); `estimatedTokens` passed to
  `autoFallbackRoute` at both sites; `bridge.usage` wired into
  `quickPerProviderRoute`/`heuristicPerProviderRoute` (P2); `pickRetryRoute`
  threads `context:routingContext` (P3 — retries kept losing continuity and
  large-note penalties); retry `needsImage` now includes `visual.needsImage`.
- Missing context fixed (tools R3): the captured cursor **selection text** is
  now sent (`SELECTED PASSAGE`, clipped 3000) — previously only offsets.
- Perf: `currentText` + `read_note` cache validation use `cachedRead` (halves
  closed-note read I/O); `query_vault_graph` wrapped in `withPathCheckCache`
  (~70–140 ms → ~1 ms at 5k notes); `search_vault` sorts once, reuses scanned
  text for the top two (snapshot side effect preserved; staged notes still go
  through `read_note`).
- `renderReply` observer: watches attributes/characterData too (security P1 —
  SMIL/MathJax late attribute mutations) and coalesces sanitize to one pass per
  frame (perf 8). **Pending §2.2 window-timer warnings.**
- Provider-neutral wording: "… returned no answer", "OWLA now uses the latest
  six exchanges…" (failure P4/P5).

### 4.8 `src/organization.ts`, `src/note-tools.ts`, `README.md`
- organization preview pre-folds move roots/note keys/link keys once
  (perf 3: measured 479.6 ms → 45.6 ms at 5k notes × 10 moves; exact `under()`
  semantics preserved — security-sensitive comparison, review carefully).
- `noteHeadings` end-mapping O(H²) → linear stack pass (perf 10; same ranges).
  NOTE: this file also carries the external agent's staged `tableAt` feature —
  the patch is far from it, but expect a mixed staged/unstaged state.
- README G1–G3: Hermes added to tagline/Why/Requirements; "both providers" →
  "every provider"; Codex-specific attachment/PDF wording generalized.

## 5. Deferred follow-ups (flagged, NOT applied — with risk tiers)

1. **PDF document cache** (perf 5, CAREFUL): `read_pdf` re-reads + re-parses the
   whole PDF per continuation call. Design: 1–2-doc LRU keyed by path+size+mtime,
   destroy on newChat/onClose/epoch/abort. Lifecycle-sensitive; do it with live
   verification.
2. **`renderPendingEdits` coalescing** (perf 9, CAREFUL): ~19 call sites rebuild
   the whole review area + broadcast editor-wide diff refresh. Dirty-flag or
   microtask coalescing; needs a survey of all call sites for sync-DOM assumptions.
3. **Hermes `ensurePrivateHome` digest gate** (perf minor, CAREFUL): ~12 sync
   writes + skill concat per (re)connect. Must NOT skip the planted-symlink
   validation pass — gate only the config/skills rewrites after validation.
4. **Graceful context overflow trimming** (auto-mode improvement 1): selections
   are uncapped in the turn payload; trim to the best window with a notice.
   Pairs with the §4.7 relaxation; needs UX decision.
5. **Real Hermes context windows** from the models.dev catalog (auto improvement 2).
6. Structural untrusted delimiter for tool results (security recommendation):
   wrap read results in `<untrusted_content>` with a standing rule — instruction
   text is currently the only prompt-injection defense at that boundary.
7. Carried 3.6.2 items: M5 Claude managed tier detection, M6 runtime
   effective-config assertions/version drift, M7 OpenCode `freePort()` bind race,
   L3–L8/L10/L11/L14 (see security-leaks.md §4).
8. `countFoundationModelTokens` (routing.ts:70) has zero callers — cleanup
   candidate (kept: the auto-mode report lists `fm count-tokens` as a planned
   calibration input).
9. Organization.accept checkpoint O(M×N) (perf minor, RISKY — recovery journal
   integrity; redesign separately).
10. Version bump 3.6.3 → 3.7.0 (manifest.json, package.json, package-lock.json,
    versions.json, CHANGELOG.md, RELEASE-NOTES.md) — release-prep decision for
    the user; not done in this pass.

## 6. Concurrent external work (NOT part of this pass — do not revert)

Another agent is active in the same tree: tables-to-chat (`tableAt`, staged),
OCR/vision-modality features (`src/ocr.ts`, models.dev modalities in hermes.ts),
PDF page-citation copy, audit-doc reorganization (`audits/<version>/`),
issue templates. Their staged files and `main.ts`/`README.md` WIP were preserved;
this pass only added targeted edits around them. Their review notes: the other
`REVIEW-*.md` files in this directory.

## 7. Verification log

- Baseline (pre-fan-out): check ✓ lint ✓ 342/342 ✓ build ✓ guard ✓.
- Each agent ran check/lint/targeted/full tests after its last edit; transient
  mid-flight failures were sibling WIP and converged (documented per report).
- Orchestrator final runs: check ✓; lint 1 error + 2 warnings (§2); test
  **480/481 twice** (single failure = §2.3); build ✓ 973 KB; check:release ✓;
  guard:test ✓.
- New orchestrator tests: 22/22 (fake Hermes/Claude/Codex/OpenCode CLIs speaking
  the real protocols; process reaping verified via `process.kill(pid,0)`).
- Hermes instruction-file flake (reported by tools agent under parallel load):
  NOT reproduced in 2 full-suite runs + 3 isolated runs post-fix. Monitor.
- Real-vault evidence (read-only): 3 real `.canvas` files byte-identical
  round-trip; 388-element real `.excalidraw` round-trip + edit→revert.
- Containment evidence: installed Hermes Python sources + MCP SDK reads;
  79-entry mirror completeness probe frozen as `tests/audit-security-rc.test.ts`.

## 8. Not verified live (name the gaps before release)

- No running-Obsidian exercise of any change (no accept/decline UI, no real
  provider turn, no `hermes acp` connect through the per-vault home + refusal
  path). Unit/fake-CLI level only.
- Windows: code-verified + platform-parameterized tests only.
- On-device FM window fit: token arithmetic, not a live `fm` call.
- OpenCode/Claude/Hermes fake servers speak the real protocols but are not the
  installed CLIs; version drift (M6/L14) remains a release-gate candidate.
- Before calling 3.7.0 release-ready: install the build in a test vault and run
  the live flows per `owla-butler-development` skill step 8.

## 9. Review focus (hardest looks, in order)

1. §2 pending batch — apply, then confirm 481/481 + zero lint.
2. `scripts/check-release.mjs` brace scanner (§4.6) — new parsing logic in a
   release gate; try it against both minified and unminified builds.
3. `src/hermes.ts` lifecycle rewrite (closing promise, rest/connect reservation,
   disconnect state clearing) — concurrency-sensitive; the 6 new process tests
   are the floor, not the ceiling.
4. `src/organization.ts` pre-folded path comparison — security-sensitive
   semantics; compare against `under()` definition (organization.ts:35).
5. `src/main.ts` §4.7 edits against the external agent's WIP — mixed
   staged/unstaged state; review `git diff src/main.ts` hunks individually.
6. Codex exhaustion wiring (§4.4 + §4.7) — manual fallback + auto selection
   behaviour after a limit error and after reset.
7. Minified bundle: Community-reviewer readability is a policy choice; the
   three-file gate passes, but confirm the owner accepts minification for 3.7.0.

## 10. Suggested staging (after §2 is green; user approves commits)

Stage this pass's files explicitly; do NOT `git add -A` (external WIP is mixed
into main.ts/README.md/note-tools.ts and the index already holds another
agent's staged work):

```
git add src/recovery.ts src/cli.ts src/codex.ts src/stream.ts src/chats.ts src/claude.ts \
  src/render-sanitize.ts src/hermes.ts src/auto-route.ts src/routing.ts src/model-profiles.ts \
  src/routing-history.ts src/exhaustion.ts src/usage.ts src/opencode.ts src/opencode-availability.ts \
  src/core.ts src/canvas.ts src/bases.ts src/excalidraw.ts src/vault-graph.ts src/plugin-api.ts \
  src/pdf-tools.ts src/organization.ts src/main.ts src/note-tools.ts \
  esbuild.config.mjs scripts/check-release.mjs README.md \
  tests/audit-*.test.ts tests/cli.test.ts tests/codex.test.ts tests/recovery.test.ts \
  tests/hermes.test.ts tests/security-render.test.ts tests/auto-route.test.ts tests/routing-eval.test.ts \
  tests/usage.test.ts tests/core.test.ts tests/opencode.test.ts tests/opencode-availability.test.ts \
  tests/visual-files.test.ts audits/3.7.0-rc/
```
(Review `git diff --cached` before any commit; main.ts/note-tools.ts/README.md
will include the external agent's hunks — coordinate or stage them separately.)