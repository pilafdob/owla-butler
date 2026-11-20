# Windows hardening pass (round 2) — multi-provider handling & usage limits

Agent: `win-providers`. Branch `3.7.0-RC`, base `81540fb`. Host: Windows 11,
git-bash, Node v24.14.0, OpenCode v2.2.7 installed as a Go `.exe`
(`%LOCALAPPDATA%\Programs\OpenCode\opencode.exe`).

Owned src: `provider.ts`, `exhaustion.ts`, `usage.ts`, `opencode.ts`,
`opencode-availability.ts`, `opencode-plugin.ts`, `core.ts`.
Edited: `opencode.ts`, `exhaustion.ts`, `usage.ts`, `opencode-availability.ts`,
`core.ts` (5 files, +67/−26). `provider.ts` and `opencode-plugin.ts` audited,
no change needed. New tests: `tests/audit-win-providers-lifecycle.test.ts` (6),
`tests/audit-win-providers-env.test.ts` (6), `tests/audit-win-providers-usage.test.ts`
(10) — 22 new tests. Everything else read-only; one cross-file proposal below.

Read from round 1: `providers-usage.md` (P1–P11, U1–U12),
`REVIEW-rc-hardening-pass.md` §4.2/§4.4/§5 item 7 (M7), `security-leaks.md` §4
(M7 design note: "spawn `--port 0`, parse bound URL"), `windows-pass-brief.md`.
All round-1 landed fixes were verified against current code before claiming
anything; none were redone.

## Findings & fixes (owned files)

### W1 — HIGH — M7: `freePort()` bind race had no recovery; Windows excluded port ranges could refuse the probe or the child bind
`src/opencode.ts:237-247` (old), now `:237-262` (`freePort`) and `:398-424`
(`startWithRetry`), wired into both connect paths (`:372`, `:385`).

Evidence (scratch probes, this host):
- `netsh interface ipv4 show excludedportrange protocol=tcp` shows real
  reservations here: 5357, 13508, **50000–50059**, 51760. A port that looks
  free can be refused with EACCES (WSAEACCES 10013) when it falls in an
  excluded range, and ranges can grow between probe and bind (Hyper-V/WinNAT).
- Two listeners cannot hold one port on Windows: a second `listen` on a held
  port fails `EADDRINUSE` (probe `double-bind.mjs`). So "hold the reservation
  until the child binds" is impossible — the child could never bind. The
  round-1 `--port 0` design removes the race but needs live verification of
  the CLI's bound-URL output (deferred below; starting the real daemon is out
  of bounds for this pass).
- The race window is dominated by child startup, not by the probe→spawn gap:
  a `.cmd` shim needs cmd.exe → node → the Go/bun server to reach its bind
  (hundreds of ms on Windows). A second OWLA window or any local process can
  take the port in that window; the old code then spent 20 s polling a dead
  port and failed the connect with no recovery.

Fix (two layers, no CLI-output dependency):
1. `freePort(attempts=5)` retries a failed probe with a fresh OS allocation
   (covers EACCES/EADDRINUSE from excluded ranges at probe time).
2. `startWithRetry()` retries the whole startup (fresh port + fresh process)
   up to 3 attempts when the child **died before ever answering** — detected
   via the existing `connectFailure` tracking, not a fragile stderr signature
   (OpenCode does not print server logs to stderr unless `--print-logs`, so a
   bind death can be silent). The last cause is preserved and surfaced; a
   live-but-silent child keeps the single 20 s readiness budget (no blind
   retry of a slow startup). Guards: a generation check and a connect-slot
   check after `await this.closing` mean a user disconnect or a connect that
   took over during the retry wait wins — the retry never resurrects a
   disconnected bridge and never races a second connect. The connect slot
   that `fail()` released is reclaimed so dedup still holds during retries.

Behaviour preserved: healthy connects spawn exactly once (test asserts
attempts=1); the startup-crash cause contract (`Last error: …`, fast fail,
no 20 s poll) still holds — now after at most 3 fast attempts; POSIX uses the
same code path (platform-neutral recovery; the macOS/POSIX process-group kill
and detached-group semantics are untouched).

Regression: `audit-win-providers-lifecycle.test.ts` — "a port taken between
the probe and the child bind is retried with a fresh port" (fake dies with the
Windows WSAEADDRINUSE wording on attempt 1, marker file proves exactly 2
attempts), "a silent early death with no stderr cause is still retried",
"a persistent startup crash stays bounded and keeps its cause" (3 attempts,
<15 s, cause intact), "a healthy connect does not retry", "a disconnect
during a failing startup is not undone by the retry".

### W2 — HIGH — non-finite `resetsAt` became a permanent provider block
`src/usage.ts:21` (`decodeWindow`), `:48` (`decodeMeter`), `:97`
(`claudeWindow`); `src/exhaustion.ts:79` (`claudeExhaustion`);
`src/opencode-availability.ts:142` (`applyUsage`).

Round-1 P10 guarded non-finite **percentages**; the sibling field `resetsAt`
was still accepted on `typeof==='number'` alone. Evidence (probe `probe1.mts`):
- `decodeUsage({rateLimits:{primary:{usedPercent:50,resetsAt:NaN}}})` →
  `resetsAt: NaN`; same for `decodeOpencodeUsage` and `decodeClaudeRateLimit`.
- `claudeExhaustion` with a NaN reset returned `resetsAt: NaN`
  (JSON.stringify hides it as null). `main.ts` expiry
  (`state.resetsAt<=Date.now()/1000`) is false for NaN → the provider stays
  exhausted forever; `exhaustionLabel` would render `Invalid Date`.
- `applyUsage` with a NaN reset created a pool block with `until: NaN`;
  `live()`'s `until<=now` is false for NaN → probe confirmed the Go paid pool
  still blocked **10 years later**.

Fix: `Number.isFinite` guards at all three decoders (NaN → null = unknown)
and in the two readers that accept hand-built snapshots. A full window with
an unknown reset now blocks until the next report (Claude) or the bounded
30-min retry (Go meters) instead of forever. Finite values decode unchanged;
`codexExhaustion` already had the guard (round-1 P1) — untouched.

Regression: `audit-win-providers-usage.test.ts` — "non-finite reset times
decode to unknown, never to a permanent block", "a Claude window with a
non-finite reset stays bounded and readable" (no `Invalid Date`), "a Go meter
with a non-finite reset expires on the retry window".

### W3 — MEDIUM — limit-error readers disagreed again (P9 class, two gaps)
`src/exhaustion.ts:85` (`claudeExhaustion`), `src/opencode-availability.ts:84`
(`classifyOpencodeFailure`); single-sourced `opencodeExhaustion`
(`exhaustion.ts:56-58`) and `friendlyOpencodeError` (`opencode.ts:127`) on the
exported `LIMIT_ERROR`.

Evidence (probe): `claudeExhaustion(null,'too many requests')` → **not**
exhausted (wording gap); `claudeExhaustion(null,'error code 14293')` →
**exhausted** (bare `429` matched inside a longer number);
`classifyOpencodeFailure('limit reached')` → `{scope:'none',kind:'other'}`
while `friendlyOpencodeError`/`opencodeExhaustion` called it a usage limit —
so a "limit reached" refusal never blocked the pool for automatic selection.

Fix: all readers now use `LIMIT_ERROR`
(`/rate.?limit|usage limit|limit reached|\b429\b|quota|too many requests/i`).
`opencodeExhaustion` keeps its free-limit precedence (free check first);
`classifyOpencodeFailure` keeps its effort/region/free/balance/model
precedence — only the usage-limit branch changed. No import cycle
(exhaustion ← availability; exhaustion imports only provider/usage).

Regression: "every limit reader agrees on the wordings" (7 wordings × 5
readers + 3 non-limits incl. `14293`), "CRLF and lone CR in limit errors do
not hide the limit" (`429\r\n`, `429\r`, `quota\r` — `\b` boundaries survive
CR; JSON-sourced messages do not wrap mid-phrase, so no `s`-flag change was
needed). Existing `claude.test.ts:80` (`API Error: 429 rate_limit_error`)
still passes.

### W4 — MEDIUM — `stripFence` left CRLF fences in place
`src/core.ts:263`. Evidence: `stripFence('```markdown\r\n[[Note]]\r\n```')`
returned the fenced text unchanged — the opening-fence regex required `\n`
directly after the language tag. A Windows CLI reply (or a CRLF note passage)
would insert the raw fence into the vault via `insertion()`/append.
Fix: `\r?\n` at both fence boundaries; LF behaviour byte-identical.
Regression: "fenced Markdown with CRLF line endings is unwrapped" (markdown/
md/bare fences, multi-line bodies, POSIX guard, inline `$$` CRLF body).

### W5 — MEDIUM — `parseJsonLine` threw on CRLF SSE sentinels
`src/core.ts:280`. Evidence: `parseJsonLine('[DONE]\r')` and
`parseJsonLine('\r')` both threw `SyntaxError` — a CRLF stream split on `\n`
leaves `\r` on sentinel/blank lines. Fix: trim the line before the sentinel
checks (the `data:` branch already trimmed). JSON payloads were unaffected
(JSON.parse tolerates trailing CR).
Regression: "SSE sentinels survive CRLF chunk boundaries" (`[DONE]\r`, `\r`,
`data: {...}\r`, comment/event/id lines).

## Verified, no change needed (with evidence)

- **`isolatedOpencodeEnv` Windows casing (focus 3).** The strip upper-cases
  every key, so no spelling of an `OPENCODE_*` behaviour var bypasses it; a
  lower-cased copy of one of OWLA's own switches is deleted (it is not an
  exact-case member of `OPENCODE_ISOLATED_ENV`) and OWLA's upper-case `'1'`
  survives — no case-duplicate keys are forwarded. Credentials keep every
  spelling (`opencode_api_key`, `OpenCode_Auth_Token`, `OPENCODE_SECRET`);
  inherited `OPENCODE_SERVER_PASSWORD`/`_USERNAME` are stripped (spawn sets
  its own). `sanitizedEnv` strips every `COMSPEC` spelling and pins the
  validated system cmd.exe on Windows; POSIX untouched. Locked by
  `audit-win-providers-env.test.ts` (3 tests). `tests/provider-isolation.test.ts`
  (win-security owned) passes unchanged — no proposal needed.
- **Binary detection (focus 2).** `.exe` (Go), `.cmd` (npm), `.bat`,
  upper-case extensions, PATHEXT order (`.com`>`.exe`>`.bat`>`.cmd`), quoted
  PATH entries, spaces in user names, refusal of `.txt`/extensionless and
  relative entries — all verified with real temp files on this host
  ("OpenCode discovery covers the Windows install shapes"). Discovery returns
  the canonical candidate spelling (`opencode.cmd` for a planted
  `OPENCODE.CMD`); NTFS resolves it and `spawnCli`'s shim regex is
  case-insensitive — no functional gap. `defaultCliDirectories` covers every
  per-user installer incl. the actual install location on this host
  (`%LOCALAPPDATA%\Programs\OpenCode`), npm, pnpm, scoop, volta, bun; POSIX
  list unchanged. Version probe through a real `.cmd` shim emits CRLF;
  `readVersion`'s trim + `supportedOpencodeVersion` accept it (test).
- **Shared process runner under Windows (focus 5, cli.ts report-only).**
  Scratch probe `runner-probe.mts` (fake CLIs, 9 checks, all PASS):
  stdin-EOF finishes; abort kills the **whole tree** incl. a grandchild
  (`taskkill /T /F`, pid verified dead); timeout names the command
  (`slow.cmd timed out after 1200 ms`); maxBuffer enforced; EPIPE on a
  dead child swallowed by `spawnCli`'s default listeners (no uncaught
  exception); `terminateProcessTree` on an exited child is a safe no-op
  (PID-recycling guard); stderr cause surfaced. No Windows-specific error
  code gaps found (named-pipe ECONNRESET class is covered by the same
  default listeners). No cli.ts change proposed for these.
- **Lifecycle/reservations (focus 1/6).** Round-1 P3–P7 verified on Windows:
  stale-server `/api/info` probe + restart, verify-connection restart,
  rest-waits-for-connect, concurrent-connect dedup, holder resting — all
  existing lifecycle tests pass on this host. New: "two runs started together
  share the connect and the turn slot" exercises the synchronous turn
  reservation under real Windows shim timing (both runs race the same slow
  startup; second refused with `already responding`, first completes).
  `provider.ts` registry contracts: `audit-providers-registry.test.ts` 5/5 ✓;
  no change. `opencode-plugin.ts`: pure JS inside OpenCode's runtime,
  loopback fetch + env paths — no Windows surface; no change.
- **Windows path rules (core.ts).** UNC case-fold containment, drive
  case-fold, trailing dot/space refusal gated to `win32`, POSIX `Dr.`
  allowed — verified by probe and locked by "Windows path rules stay
  platform-parameterized". (An earlier probe appeared to show a UNC
  case-fold failure; it was shell-escaping mangling the backslashes — a
  clean `write_file` probe disproved it. `isPathInside` is correct.)
- **Reset epochs across TZ/DST (focus 4).** `decodeClaudeUsage` parses
  RFC3339 offsets to absolute epochs; fall-back/spring-forward/Z/+05:30
  shapes verified against `Date.UTC` constants, expiry is pure epoch math
  ("reset times parse to absolute epochs across timezone offsets and DST").
  OpenCode Go ms→s conversion keeps the epoch; `applyUsage` expiry at the
  reset second verified. Host clock/TZ cannot drift these comparisons.
- **Usage merge NaN (focus 4).** Round-1 P2 merge stays faithful; readers
  guard non-finite percentages — "a sparse merge keeps finite windows when
  an incoming percentage is non-finite" locks it.

## Cross-file proposals (not applied — 1)

### X1 — LOW — `cli.ts` platform-parameterized helpers use the host `join`
`src/cli.ts:21-38` (`findCliExecutable`) and `:40-54`
(`defaultCliDirectories`): the `win32` branches build paths with the host
`join`, so a cross-host assertion from POSIX gets mixed separators
(`C:\Users\…/.local/bin`). Runtime is correct (platform always matches the
host); existing `cli.test.ts` expectations use the host `join` too, so
nothing fails today. Brief rule 1 asks platform-parameterized helpers to
derive separators from the parameter. Proposed patch:
```ts
// findCliExecutable, after `const absolute=…`:
const joinPath=platform==='win32'?win32.join:join;
// candidate: joinPath(directory,name+extension)
// defaultCliDirectories, win32 branch: const j=win32.join; use j(...) for every dirs.push/join
```
(`defaultStorageDirectory` already does this correctly — the pattern to
copy.) Test impact: none on Windows; `cli.test.ts` expectations may switch
to `win32.join` for purity. My new tests deliberately use the host `join` on
both sides so they pass on any host either way.

No `main.ts`, `tests/helpers/*` or `provider-isolation.test.ts` changes are
needed from this domain.

## Deferred (risk tier + design)

1. **M7 full elimination via `--port 0` (CAREFUL).** Round-1's design: spawn
   `serve --port 0`, let OpenCode bind its own port, parse the bound URL from
   stdout. Removes the race entirely (no reservation to lose). Blocker: the
   startup output format is unverified across supported versions (2.2.x/2.3.x)
   and starting the real daemon is out of bounds for this pass; `serve --help`
   (read-only probe) confirms `--port integer` but not the log shape. Design:
   try `--port 0`, watch stdout for a loopback URL within the readiness
   budget, fall back to today's reservation+retry when none appears. W1's
   retry makes the race *recoverable* today; this would make it *impossible*.
2. **Excluded-range determinism (INFO).** A port that becomes excluded
   between probe and child bind is recovered by W1's retry; the probe itself
   retries allocation failures. A deterministic EACCES test would need a
   host-specific reserved range (this host: 50000–50059) — not portable, so
   the retry is tested via the bind-death fakes instead.
3. **`opencodeDataHome` on Windows (open question).** The desktop-home
   fallback is `~/.local/share/opencode-v2-home`; the app is not installed on
   this host, so the Windows desktop data location could not be verified. If
   the Windows desktop app stores its DB under `%APPDATA%`, OWLA started from
   Obsidian would not see the user's connected providers. Verify with a
   Windows desktop install before release; add the Windows path to
   `opencodeDataHome` if it differs (owned file, one-line addition + test).
4. **`formatTranscription` mid-line CRLF (INFO).** Trailing CRLF is already
   handled (trim); a `\r` at the end of a *non-final* equation line defeats
   the equation regex. The function has no production callers (tests only),
   so no change was made; normalize `\r\n`→`\n` at entry when it gains callers.
5. **Claude error-based exhaustion without a window** keeps `resetsAt:null`
   (bounded by the next report) — pre-existing design, unchanged, not
   Windows-specific.

## Verification

- `npm run lint` ✓ **fully clean** at final run (an earlier transient
  `no-control-regex` error in sibling-edited `src/cli.ts` cleared on re-run).
- `npm run check`: **zero errors in owned src files and new tests** at every
  run. Final whole-project run: 3 errors, all in sibling-owned
  `tests/audit-win-security.test.ts` (win-security WIP). Earlier runs also
  showed transient parse errors in sibling `src/editor-diff.ts`,
  `src/note-tools.ts`, `src/pdf.ts` and two sibling test files — all cleared
  or attributable to concurrent edits; none touched this domain.
- Owned scope (15 files incl. consumers `claude.test.ts`,
  `model-unavailability.test.ts`, `provider-isolation.test.ts`):
  **143/143 ✓** (baseline before edits: 106/106 on the 10 core owned files).
- New tests: **22/22 ✓** (6 lifecycle + 6 env/detection + 10 usage/limits).
- Full suite, two runs during active sibling fan-out:
  - Run 1: 662 tests, 637 pass, 25 fail.
  - Run 2: 691 tests, 624 pass, 67 fail.
  Every failure in both runs is in sibling-owned files being edited
  concurrently (main.ts CRLF normalization/render-coalescing WIP,
  editor-diff, note-tools `findBlock`/`noteHeadings`, attachments,
  security-main, security-vault, excalidraw visual, cli grace window).
  **Zero failures in owned files.** The security-vault `allowedPath` fold
  tests that failed under full-run load pass in isolation (10/12; the one
  isolated failure is `allowedVaultFile` — sibling note-tools WIP, not
  core.ts); `core.test.ts` passes 39/39 in isolation and in the owned batch.
  The failure set shifted between runs as siblings landed edits — attributed
  per brief rule 7, not regressions from this pass.
- Scratch probes (under `…/hermes/cache/scratch/win-providers/`, harmless
  local commands/fake CLIs only): `double-bind.mjs` (EADDRINUSE on second
  bind), `probe1.mts` (bug evidence quoted above), `probe3.mjs` (UNC/drive
  case-fold), `probe4.mts` (formatTranscription), `runner-probe.mts` (9/9
  process-runner checks PASS). Real-binary probes limited to
  `opencode.exe --version` / `serve --help` (no daemon started, no model
  turn, no vault mutation).
- NOT verified live: no real OpenCode server start, no model turns, no
  Obsidian runtime. Lifecycle tests exercise the real bridge code against
  local HTTP stand-ins through real Windows `.cmd` shims.
