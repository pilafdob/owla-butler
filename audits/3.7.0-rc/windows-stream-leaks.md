# OWLA Butler 3.7.0-RC — Windows stream & resource leak pass (win-stream, round 2)

Status: **fixed in owned files** (`src/chats.ts`, `src/claude.ts`; `src/stream.ts`
verified sound, unchanged) + 3 new test files (29 tests). One HIGH cross-file
**interaction** flagged for the orchestrator (sibling cli.ts WIP × Claude
multi-line instructions). Branch `3.7.0-RC`, base `81540fb`. No git mutations,
no build, no live model turns, no daemon contact, no vault mutation. Probes
scratch-only (`…/hermes/cache/scratch/win-stream/`).

**Method.** Read the brief, round-1 `stream-leaks.md` (F1–F8, U1–U4) and
REVIEW §4.3/§5. Re-verified every round-1 fix against current code, then probed
each Windows angle on this host (Windows 11, git-bash, Node v24.14.0, cp850,
Developer Mode OFF): fs lock/read-only/case-fold semantics, spawn-failure event
shape, env key casing, cmd.exe shim argument escaping and LF truncation,
taskkill tree reaping through an npm-style `claude.cmd`. Process-level tests run
fake Claude CLIs speaking the real stream-json control protocol — on Windows
through a `.cmd` shim interpreted by the system cmd.exe (the npm install shape),
on POSIX through the round-1 `sh` wrapper; **every fake protocol line is CRLF**,
so CR handling is exercised on both hosts. Reaping verified by polling
`process.kill(pid,0)` until ESRCH for the direct child (cmd.exe) AND the node
grandchild.

**Caveats.** Siblings edited the tree live; `file:line` for unowned files are a
snapshot. `npm run check`/`lint` were transiently red from sibling WIP
(`pdf.ts` TS2454, `audit-win-attachments-files.test.ts` TS2769, `cli.ts:242`
no-control-regex); all cleared by their owners before the final green run.

---

## Fixes applied (owned files)

### W1 · MEDIUM · ChatStore had no retry for transient Windows file locks — FIXED
`src/chats.ts:6,42,45`. `save()`'s `renameSync(temp,target)` and `remove()`'s
`unlinkSync` propagate EBUSY/EPERM/EACCES straight to the UI Notice. On Windows
those codes are routinely **transient**: Defender real-time scanning opens a
freshly written file, OneDrive/the indexer hold brief locks. A save or delete
that fails this way loses the action (and at the 20-chat cap a failed delete
blocks saving). POSIX rename/unlink rarely see these codes, so the gap was
Windows-shaped.
Fix: `retryLocked(fn)` — up to 3 attempts, 25 ms sync wait
(`Atomics.wait`) between, **only** for EBUSY/EPERM/EACCES; every other error
propagates immediately. Applied to the rename, the temp cleanup in `finally`,
and `remove()`. Sync API preserved (main.ts call sites are sync UI handlers).
Behaviour preserved: healthy folders never retry; the permanent-lock path still
fails (after ≤3 attempts) and still cleans the temp file.
Tests (`audit-win-stream-chats.test.ts`, fs monkeypatch through the same CJS
module object the store calls — deterministic on every host):
- *save rides out transient Windows locks (EBUSY/EPERM/EACCES) with a bounded retry*
- *remove rides out a transient EPERM lock on the chat file*
- *a permanent lock fails the save after exactly three attempts and leaves no temp file*
- *a non-transient fs error propagates without retrying*

### W2 · MEDIUM · Kill/grace timers scheduled for a child that never spawned — FIXED
`src/claude.ts:424,471`. Probe E1 (scratch): on **Windows** a failed spawn emits
`error:ENOENT` + `close:-4058` and sets `exitCode=-4058` (no `exit` event) — the
existing exitCode branch already covers it. On **POSIX** a failed spawn leaves
`exitCode=null` and never emits `exit`: `run()`'s finally scheduled the 2 s
grace timer + a `once('exit')` listener that can never fire (dead timer, 2 s
closure retention per failed turn — the round-1 F6 class, residual edge), and
`stopChild` did the same for the force timer after a failed handshake spawn.
Fix: branch on `child.pid===undefined` in both places — a never-spawned child
has no tree to stop and schedules no timer. Platform-neutral; POSIX
process-group kills for live children unchanged (round-1 F2/F5/F6 intact).
Test: *a failed spawn rejects actionably and schedules no kill timer* — patches
`node:timers.setTimeout` (verified to intercept the bridge's calls) and asserts
no 2000 ms schedule; RED pre-fix on POSIX, regression guard on Windows.

### W3 · LOW · Raw spawn errors surfaced to the user — FIXED
`src/claude.ts:408`. `run()`'s `child.on('error')` finished with the raw error
(`spawn ENOENT` when the executable vanishes between connect and turn — more
likely on Windows with AV quarantine / OneDrive sync). Now wrapped:
`'Claude Code could not be started: '+error.message`, matching the handshake
wording (`:262`). Covered by the W2 test (`/could not be started/`).

### W4 · LOW · Handshake settle kept the stderr listener and unguarded stdin.end — FIXED
`src/claude.ts:236`. Round-1 F3 released stdout+stderr listeners in `run()`'s
finish, but `handshake()`'s finish removed only stdout's: the stderr-tail
closure kept accumulating up to 4000 chars while the killed child lingered
(up to 2 s SIGTERM grace + 2 s force on POSIX), and `child.stdin.end()` was
called unconditionally (ERR_STREAM_DESTROYED after death — swallowed by the
noop listener, but noisy). Fix: `child.stderr.removeAllListeners('data')` +
`if(!child.stdin.destroyed)child.stdin.end()` — symmetry with `run()`.
Test: *handshake settle releases the stdout/stderr listeners and ends stdin*
(listenerCount assertions on the captured child; stderr assertion RED pre-fix).

## Verified sound — Windows angles checked, no change needed

- **RecordSplitter under CRLF** (`src/stream.ts`, unchanged; 6 new tests in
  `audit-win-stream-splitter.test.ts`): with `\n` delimiter the `\r` stays in
  the record and both Claude parsers `trim()` before `JSON.parse`; the 16 MiB
  cap **counts the `\r`** (a MAX-content CRLF line is MAX+1 → fail-closed
  overflow; MAX−1 content + `\r` passes exactly); round-1 F4's ≥3-chunk
  straddle fix holds for `\r\n\r\n` split across 3 chunks; lone `\r` is data;
  one-char-per-chunk CRLF flood hits the cap and stays terminal; a pending
  record over the cap fails closed before any delimiter arrives.
- **Windows kill semantics** (`terminateProcessTree`, cli.ts, sibling-owned):
  probe D — `taskkill /PID <cmd> /T /F` reaped the cmd.exe shim **and** the node
  grandchild in 130 ms. The exitCode/signalCode re-check before targeting a PID
  guards Windows PID reuse; the fallback `child.kill()` is handle-based
  (reuse-safe). `stopChild`'s force timer is cleared on `exit` and re-checks
  exitCode when it fires, so it cannot target a recycled PID. On Windows the
  SIGTERM→SIGKILL escalation is a no-op beyond the timer (taskkill /F is
  unconditional) — kept for POSIX. Process tests prove: normal-turn reap,
  oversize fail-closed reap (turn + handshake), abort reap, interrupt-ignoring
  child terminated after the 2 s grace, disconnect reaping a hanging handshake.
- **CLI detection/launch**: `.com/.exe/.bat/.cmd` search order matches Windows
  PATHEXT; `.ps1`/extensionless refused; `~/.claude/local` (native installer)
  and `%APPDATA%\npm` (npm shim) both in `defaultBinDirectories`; ComSpec trust
  gate + pinning verified (cli.ts). **cmd metacharacter escaping**: probe 4 —
  `Say "hi" & stay <safe> 100% done` and `a^b|c>d` arrive byte-identical through
  cross-spawn → cmd.exe → node argv; frozen as *cmd metacharacters in the system
  prompt survive the shim intact*.
- **env() redirector strip (round-1 M4)**: the `toUpperCase()` loop strips every
  casing — new test injects lower-case spellings (`anthropic_model`,
  `claude_code_use_bedrock`, `otel_…`, `claude_config_dir`) and asserts removal
  while `DISABLE_TELEMETRY` stays. PATH rebuilt with the host delimiter;
  `process.env`'s Windows proxy handles `Path` casing.
- **auth-status JSON / OEM codepage**: Claude Code is a Node CLI — it writes
  UTF-8 to pipes regardless of the console codepage, so `JSON.parse` and the
  handshake are unaffected by cp850. CRLF stderr is trimmed by `stderrCause`;
  *a handshake death surfaces the CRLF stderr cause* passes on Windows.
  cmd.exe's **own** messages are OEM (probe: `é` = byte 0x82) and mojibake under
  utf8 decode — cosmetic only, in probe-error text; see X3.
- **ChatStore Windows fs**: read-only chat files delete fine (libuv's unlink
  clears FILE_ATTRIBUTE_READONLY — probe A2; test *a read-only saved chat can
  still be deleted*); NTFS case-folding **cannot** duplicate a chat (uppercase
  name addresses the same file, same `ino` — test); the lowercase-UUID regex
  matches exactly what the store writes; spaced/backslash roots work; the
  round-1 read budget (100) and 100 KB stat-skip hold.
- **Web-source cap 500** under CRLF: *web sources stay capped at 500 with CRLF
  tool results* — 600 search results, cited URL #0 titled from the map, cited
  URL #599 (dropped by the cap) falls back to its link text.
- **Settled-guards / abort** (round-1 F3): *abort stops later deltas and tool
  calls, and the tree is reaped* passes on Windows — no post-cancel `onText`,
  no second `tools/call`, tree reaped.
- **Full connect through the shim**: *connect runs the version/auth probes and
  the CRLF handshake through the shim* — `runCli` probes (stdin ended at once),
  initialize + get_usage handshake, models/plan/usage decoded, disconnect reap.

## Cross-file findings & proposals (unowned — orchestrator applies)

### X1 · HIGH · INTERACTION · sibling cli.ts control-char guard × Claude multi-line instructions
`src/cli.ts` (win-failure sibling WIP, `SHIM_CONTROL_CHARS` in `spawnCli`) ×
`src/claude.ts:103` (`claudeArguments` passes `--system-prompt instructions`) ×
`src/main.ts:2335–2337` (instructions **always** gain `\n` guidance: inlineTitle
branch appends `\n` for both `true` and `undefined`; images/PDFs/formatting
references append `\n` packs).
Evidence (scratch probe 7, this host): passing `--system-prompt 'line1\nline2'
--model haiku` through a `.cmd` shim via cross-spawn, the fake received
`["--system-prompt","line1"]` — **cmd.exe truncates the /c command line at the
embedded LF and silently drops everything after it**. The sibling's new guard
correctly refuses this (fail-closed beats silent loss of prompt/isolation
tail), but the consequence is: **most Claude turns on Windows via the npm
`claude.cmd` shim will now throw** "…contains a control character…". The native
installer path (`~/.claude/local/claude.exe`, searched first) is unaffected —
no cmd.exe, no truncation.
Proposed resolution (orchestrator + win-failure agent decide):
1. Short term: keep the guard; the error message already points users at the
   executable file. Document the **native Windows installer** (or selecting
   `claude.exe` in settings) as the supported Claude-on-Windows path; npm-shim
   users get an actionable refusal instead of a silently truncated prompt.
2. Follow-up (D1 below): resolve the npm shim to its `cli.js` and spawn node
   directly, removing cmd.exe from the loop entirely.
My regression test *multi-line instructions are never silently truncated by the
Windows shim* is mechanism-agnostic: it demands the WHOLE prompt or a refusal —
it stays green under either resolution and goes RED if silent truncation ever
returns.

### X2 · VERIFIED · cli.ts env-casing fix already landed by sibling — no action
Probe D1/D2 showed `windowsSystemDirectory({...process.env})` missing this
host's uppercase `SYSTEMROOT`/`WINDIR` (plain-object spread is case-sensitive;
fallback `C:\Windows` is wrong on non-C: installs). The win-failure sibling's
WIP diff already replaces the indexed reads with case-insensitive scans in
`windowsSystemDirectory` **and** `shimInterpreterTrusted` (their W4) — verified
present in the tree. This was my prepared proposal; it is now redundant.

### X3 · INFO · OEM-codepage stderr from cmd.exe itself — cosmetic, no reliable fix
`runCli` decodes output as utf8; cmd.exe's own error messages are OEM (cp850
here). Only affects probe-error wording when a shim fails before node starts
(e.g. "'claude' is not recognized…"); the Claude protocol/auth JSON is UTF-8.
`new TextDecoder('cp850')` is **unsupported** in this Node build (probe E1), and
the active console CP cannot be read without native calls (no-new-deps rule) —
no actionable patch. Observation only.

### X4 · INFO · PATHEXT/PSModulePath inherited, not stripped
Present in this host's env; `sanitizedEnv` keeps them, same class as PATH
(search-order variables deliberately kept for enterprise setups). The confined
Claude child (`--tools ''`) spawns no shell that would consult them. No change
proposed; noted for the security agent's completeness.

## Deferred items (risk tier + design)

1. **D1 · CAREFUL · npm-shim → direct node launch for Claude on Windows**
   (pairs with X1). In `claude.ts` `start()`/`run()`, when
   `process.platform==='win32' && /\.(cmd|bat)$/i.test(executable)`: read the
   shim text, locate the npm target
   (`node_modules\@anthropic-ai\claude-code\cli.js` relative to the shim's
   directory — the standard npm cmd-shim layout), verify `existsSync`, then
   spawn `join(shimDir,'node.exe')` if present else `node` (resolved through the
   child PATH by cross-spawn) with `[cliJs,...args]`. No cmd.exe → no LF
   truncation, no control-char refusal, no ComSpec dependency; arguments pass
   verbatim. Fallback: today's shim path (guard refuses unsafe args). Risks:
   shim-layout drift across npm/Claude versions; needs live verification against
   the installed CLI before release. Not half-applied here.
2. **D2 · LOW · taskkill PID TOCTOU** — between `terminateProcessTree`'s
   exitCode check and taskkill opening the PID there is an inherent microsecond
   race; Node holds the process handle until exit processing (Windows does not
   recycle a PID with an open handle), so the window is tiny. Eliminating it
   needs a duplicated process handle (native API; no-deps constraint). Accepted
   and documented; the exitCode re-check is the mitigation.
3. **Round-1 open questions still open** (unchanged): in-flight vault tool at
   abort needs a `ProviderRunOptions.tool` signal contract across bridges +
   main.ts; splitter `limit` counts UTF-16 units, not bytes (consistent with
   Codex; a byte-exact cap is a cross-bridge behaviour change).

## Verification

- `npm run check` ✓ · `npm run lint` ✓ (final run; owned files also lint-clean
  in isolation). Transient sibling reds observed mid-pass (pdf.ts TS2454 ×2,
  audit-win-attachments-files.test.ts TS2769, cli.ts:242 no-control-regex) —
  all cleared by their owners; re-ran to green.
- Targeted (10 files: 7 pre-existing owned/round-1/orchestrator + 3 new):
  **70 tests, 70 pass, 0 fail** — 41 pre-existing unchanged + 29 new
  (splitter 6, chats 9, claude 14).
- Full suite ×3 (`node --import tsx --test --test-reporter=tap tests/*.test.ts`):
  - Run 1: 709 tests, 699 pass, 9 fail — 2 mine (cleanup `rmSync` EPERM under
    parallel load: Windows briefly holds the folder after the children die —
    Defender/indexer; fixed with a bounded retry in the test cleanup, mirroring
    W1) + 7 sibling WIP (providers-lifecycle, tools-crlf ×3, tools-graph,
    tools-organization, security-vault).
  - Run 2: 709 tests, 700 pass, 8 fail — 1 mine (same cleanup class) + 7 sibling.
  - Run 3 (final): **709 tests, 708 pass, 0 fail, 1 skip** — the skip is
    `security-vault.test.ts` "symlinks to hardlinked files do not pass # SKIP
    needs Windows Developer Mode", the brief-sanctioned single-assertion skip
    (owner-managed). All sibling WIP failures cleared by their owners during
    the pass; the baseline's 12 pre-existing symlink failures are gone.
- No owned existing test needed modification; no documented contract changed
  (splitter API, ChatStore sync API + caps, Claude protocol, POSIX group kills).
- `git status` checked before/after: only `src/chats.ts`, `src/claude.ts`
  modified + 3 new `tests/audit-win-stream-*.test.ts` + this report. No
  add/commit/push. Build intentionally not run (orchestrator).
- Not verified live in Obsidian: real Claude CLI turns/unload on Windows (unit
  fakes speak the protocol through a real cmd.exe shim, but are not the
  installed CLI); the native `claude.exe` launch path shares the verified
  spawnCli/terminateProcessTree code but was not exercised with a real binary.
