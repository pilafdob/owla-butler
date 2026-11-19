# 3.7.0 RC — Failure Handling & Resilience Audit

Domain: provider spawn/launch failures, timeouts, retry/backoff, abort/cancel paths,
malformed/partial provider output, opaque error surfacing, crash recovery, sign-in
failure paths, reconnect logic, user-visible vs logged errors.

Scope of edits (ownership): `src/recovery.ts`, `src/cli.ts`, `src/codex.ts`,
`tests/recovery.test.ts`, `tests/cli.test.ts`, `tests/cli-security-audit.test.ts`,
`tests/codex.test.ts`, new `tests/audit-failure-codex.test.ts`.
Read-only files (`src/main.ts`, `src/hermes.ts`, `src/opencode.ts`, `src/claude.ts`, …)
were traced end-to-end; fixes for them are **proposed** below with exact snippets.

Method: full read of the owned modules plus end-to-end tracing of every error path
(bridge → `main.ts` handler → Notice/status/chat), sibling call-path comparison
(Codex/Claude/OpenCode/Hermes all share `spawnCli`/`runCli`/`terminateProcessTree`),
and scratch probes (`node --import tsx`, deleted afterwards) to verify stream-error
and abort semantics on this host (Node v24.15.0, macOS). No live model turns, no
contact with running provider daemons, no vault mutations, no credential reads.

Concurrent-agent note: several siblings edited the shared tree during this audit
(`src/core.ts`, `src/hermes.ts`, `src/main.ts`, `src/claude.ts`, `src/opencode.ts`,
new OCR/tool tests). All proposed snippets below were re-verified against the tree
state at finish. Git discipline: read-only git; no add/commit/push/checkout/reset;
no `npm run build` (orchestrator builds).

---

## Fixed findings (owned files)

### F1 — HIGH — Unhandled child-stream `error` events can crash the whole plugin
- **File:** `src/cli.ts:213-231` (`spawnCli`), affecting every bridge.
- **Evidence:** `spawnCli` creates stdio pipes but only Codex (`src/codex.ts`) and
  Claude (`src/claude.ts:249,381`) attach a stdin `error` listener. Hermes writes to
  stdin with only a synchronous `try/catch` (`src/hermes.ts` `sendRpc`/reply paths) and
  OpenCode calls `child.stdin.end()` in `disconnect` — an asynchronous EPIPE or
  ERR_STREAM_DESTROYED with no listener becomes an uncaught exception in the Obsidian
  renderer. Probe-verified: a 1 MiB write in flight while a non-reading child dies
  emits `EPIPE` on stdin (`probe-epipe.mjs`, scratch, deleted).
- **Fix (applied):** default no-op `error` listeners on stdin/stdout/stderr inside
  `spawnCli`; bridge-owned listeners still receive the event (multiple listeners).
  This fixes the bug class for all four providers at the shared launcher.
```ts
// src/cli.ts — spawnChild result, before return
 const child=shim?withPinnedShimInterpreter(spawnChild):spawnChild();
 // A pipe error (EPIPE when the child dies mid-write, ERR_STREAM_DESTROYED on
 // end after exit) is emitted asynchronously; with no listener it becomes an
 // uncaught exception and takes the whole plugin host down. Every bridge still
 // receives the event through its own listeners; this default only guarantees
 // that a stream error can never crash Obsidian.
 child.stdin.on('error',()=>{});
 child.stdout.on('error',()=>{});
 child.stderr.on('error',()=>{});
 return child;
```
- **Regression test:** `tests/cli.test.ts` — “a provider child stream error never
  crashes the host and still reaches bridge listeners” (in-flight 1 MiB write, child
  exits at 60 ms; asserts the bridge listener still fires; without the fix the test
  process dies on the unhandled EPIPE).

### F2 — HIGH — Connect-time process death/protocol failure reported as “Codex connection cancelled.”
- **File:** `src/codex.ts:283` (`launch` catch), `src/codex.ts:458-460`.
- **Evidence:** `fail()` and the protocol-intake closes call `close()`, which bumps
  `generation`. The catch treated *any* generation change as a user cancellation, so
  an app-server crash, a broken pipe or malformed JSON during connect threw
  `Codex connection cancelled.` to `main.ts` (Notice/chat error) while the real cause
  only reached the status bar. Reproduced with the fault-injecting fake codex
  (exit-stderr / silent-exit / bad-json modes) before the fix.
- **Fix (applied):** new `private lastFailure:Error|null` (line 177), set by `fail()`
  and by a new `protocolFailure()` helper, cleared at `launch` entry (line 237). The
  catch now distinguishes “this connection failed” from “the user disconnected or a
  newer connect replaced this one”:
```ts
// src/codex.ts:283
 }catch(e){if(generation!==this.generation){if(this.lastFailure)throw this.lastFailure;throw Error('Codex connection cancelled.');}this.close(friendlyError(e));throw e;}finally{if(this.startupAbort===startup)this.startupAbort=null;}
// src/codex.ts:458-460
 private fail(e:Error){this.lastFailure=e;this.close(friendlyError(e));}
 /** A protocol intake failure: recorded like fail(), but the status stays verbatim. */
 private protocolFailure(message:string){this.lastFailure=Error(message);this.close(message);}
```
  A user disconnect during the version check still yields “Codex connection
  cancelled.” (existing test preserved); a stale failure cannot leak into a later
  connect because every `launch` clears it synchronously before its first await.
- **Regression tests:** `tests/audit-failure-codex.test.ts` — exit-stderr, silent-exit,
  bad-json (all assert the real cause reaches the rejected promise, not “cancelled”).

### F3 — HIGH — Oversized pending-edit journal silently discarded by crash recovery (data loss)
- **File:** `src/recovery.ts:19-35` (`readPendingRecord`), consumed by
  `main.ts:700-721` (`clearPendingEdits`).
- **Evidence:** a >10 MB `pending-edits.json` made `readPendingRecord` return `[]`;
  `clearPendingEdits` then saw zero entries, took the success branch and **deleted the
  journal** without restoring anything — the record of which notes carry unreviewed
  provisional edits was lost. `loadPendingEdits` already refused the same file, so the
  UI offered a “Clear pending edit record” button that destroyed data.
- **Fix (applied):** fail closed with an actionable message; the file is preserved for
  manual recovery. `main.ts`’s caller handles the rejection via
  `error=>new Notice(friendlyError(error))` (verified at `main.ts:2029-2031`).
```ts
// src/recovery.ts — readPendingRecord
 if (!existsSync(file)) return [];
 let size:number;
 try { size = statSync(file).size; } catch { return []; }
 if (size > MAX_PENDING_BYTES) throw Error('The pending edit record is too large to recover automatically. Move or delete '+file+' manually, then reload OWLA Butler.');
 try {
  const data:unknown = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(data) ? data : [];
 } catch { return []; }
```
- **Regression test:** `tests/recovery.test.ts` — “an oversized pending record is
  never silently discarded by recovery” (10 MB+ file; both readers throw; file survives).

### F4 — MEDIUM — Codex app-server stderr discarded; unexpected exits opaque
- **File:** `src/codex.ts:246-253` (`launch`).
- **Evidence:** `child.stderr.on('data',()=>{})` threw away the only place a panicking
  or misconfigured app-server reports its cause; users saw “Codex disconnected. Your
  draft is preserved; reconnect to retry.” with no diagnosis (the
  `storage_unavailable`-style opacity the task names).
- **Fix (applied):** bounded 4000-char stderr tail; on unexpected exit/spawn error the
  last non-empty line (≤300 chars) is appended as `Last error: …` (fits the 800-char
  `friendlyError` budget). Intentional closes are unaffected (`this.child===child` guard).
```ts
// src/codex.ts:249-253
 let stderrTail='';child.stderr.setEncoding('utf8');child.stderr.on('data',(chunk:string)=>{stderrTail=(stderrTail+chunk).slice(-4000);});
 const stderrCause=()=>{const line=stderrTail.split('\n').map(item=>item.trim()).filter(Boolean).pop();return line?' Last error: '+line.slice(0,300):'';};
 child.on('error',e=>{if(this.child===child)this.fail(Error('Codex could not be started: '+e.message+stderrCause()));});child.stdin.on('error',()=>{if(this.child===child)this.fail(Error('Codex connection closed. Reconnect to retry.'));});child.on('exit',()=>{if(this.child===child)this.fail(Error('Codex disconnected. Your draft is preserved; reconnect to retry.'+stderrCause()));});
```
- **Regression tests:** `tests/audit-failure-codex.test.ts` — exit-stderr (connect) and
  turn-exit (mid-turn disconnect surfaces `Last error: turn worker panicked`).

### F5 — MEDIUM — `runCli` errors do not name the command; raw spawn errors
- **File:** `src/cli.ts:264-315` (`runCli`).
- **Evidence:** spawn failure rejected with raw `spawn <path> ENOENT`; non-zero exit
  with empty stderr gave “The command exited with code N.”; timeout gave “The command
  timed out after N ms.” — none say *which* command, across all four providers’
  version/auth probes.
- **Fix (applied):** `basename(file)` in timeout/exit messages; spawn errors wrapped as
  `Could not start <name>: <cause>` (cause preserved, not hidden).
```ts
// src/cli.ts
  const name=basename(file);
  ...
   finish(Error('The command '+name+' timed out after '+timeout+' ms.'));
  ...
  child.on('error',error=>finish(Error('Could not start '+name+': '+error.message)));
  child.on('close',(code,signal)=>{
   if(code===0)finish();
   else finish(Error(stderr.trim()||'The command '+name+' exited '+(signal?'after '+signal:'with code '+String(code))+'.'));
  });
```
- **Regression test:** `tests/cli.test.ts` — “runCli names the command in launch, exit
  and timeout errors” (missing file, exit 3, stderr cause, 300 ms timeout).

### F6 — MEDIUM — `runCli` throws synchronously on an already-aborted signal
- **File:** `src/cli.ts:264`.
- **Evidence:** `runCli` was a plain function returning a Promise;
  `options.signal?.throwIfAborted()` threw **synchronously**, so
  `runCli(...).catch(...)` (a natural cancel-path pattern) crashes instead of
  rejecting. Reproduced in the abort regression test (raw DOMException escaped the
  test). All current callers happen to await inside async functions, which masked it.
- **Fix (applied):** `export async function runCli(...)` — the abort now rejects the
  returned promise; spawn/timeout semantics unchanged (executor still runs
  synchronously up to the first await).
- **Regression test:** `tests/cli.test.ts` — “runCli abort kills the child and reports
  the cancel reason”, third case (pre-aborted signal → rejection matching /aborted/).

### F7 — MEDIUM — `runCli` leaves stdin open; commands reading to EOF hang to timeout
- **File:** `src/cli.ts:275`.
- **Evidence:** no `runCli` caller writes to the child, but stdin stayed open; a CLI
  that reads stdin to EOF before answering would hang until the 10–15 s timeout.
- **Fix (applied):** `child.stdin.end()` immediately after spawn (safe with F1’s
  default error listener; verified against the Windows shim argument test).
- **Regression test:** `tests/cli.test.ts` — “runCli closes stdin so a command reading
  to EOF is not left waiting” (fails with a timeout error without the fix).

### F8 — MEDIUM — Unbounded Codex model-catalog pagination
- **File:** `src/codex.ts:55,279`.
- **Evidence:** `do{…}while(cursor)` only detected *repeated* cursors; a server
  returning ever-fresh `nextCursor` values loops forever, growing `models` without
  bound and holding `connect` (each page answers fast, so the 20 s request timeout
  never fires).
- **Fix (applied):** `export const MAX_MODEL_PAGES=20` (≤2000 models — real catalogs
  are 1–2 pages); exceeding it throws “Codex returned too many model catalog pages.
  Reconnect to retry.” and the process is closed by the catch.
- **Regression test:** `tests/audit-failure-codex.test.ts` — model-loop mode; asserts
  rejection and exactly `MAX_MODEL_PAGES` requests reached the fake server.

### F9 — MEDIUM — Sign-in: raw `TypeError: Invalid URL` on a malformed auth link
- **File:** `src/codex.ts:291`.
- **Evidence:** `new URL(response.authUrl)` threw an opaque `Invalid URL` when the
  server returned a malformed link; the https-protocol check already had a friendly
  message but the parse did not.
- **Fix (applied):**
```ts
  let url:URL;try{url=new URL(response.authUrl);}catch{throw Error('Codex returned an invalid sign-in link.');}
```
- **Regression test:** `tests/codex.test.ts` — “a malformed sign-in link fails with a
  clear message, not a raw URL error” (unparseable, http-only, non-string; also asserts
  no sign-in timer is left pending).

### F10 — MEDIUM — Hermes errors remapped to Codex wording in the shared error mapper
- **File:** `src/codex.ts:24` (`friendlyError`, used by `main.ts` for **all** providers).
- **Evidence:** the pass-through only matched `/\b(?:OpenCode|Claude)\b/`; a Hermes
  error containing `429`, `quota` or `authentication` (e.g. an upstream provider limit
  surfaced through ACP) became “Codex usage limit reached…” / “Codex needs you to sign
  in again with ChatGPT.” — wrong provider, wrong recovery action. Hermes bridge
  messages name “Hermes” (verified across `src/hermes.ts`).
- **Fix (applied):** `if(/\b(?:OpenCode|Claude|Hermes)\b/.test(text))return text.slice(0,800);`
- **Regression test:** `tests/codex.test.ts` — “Hermes errors keep their own wording…”
  (plus the existing raw-error→Codex mapping assertion kept green).

### F11 — MEDIUM — Protocol intake: handler exceptions mislabeled as bad JSON; no snippet
- **File:** `src/codex.ts:302-316` (`receiveChunk`).
- **Evidence:** one `try/catch` wrapped both `JSON.parse` and `this.receive`; any
  exception inside event/tool/usage handling closed the connection as “Codex sent an
  invalid protocol message.” — hiding the real cause — and a genuinely malformed line
  was not quoted, making truncated/partial stdio undiagnosable.
- **Fix (applied):** parse and handling separated; parse failure quotes ≤80 chars of
  the offending line (`JSON.stringify`-escaped); handler failure carries its own
  message; both record via `protocolFailure` (F2) so connect reports the true cause.
```ts
    let value:unknown;
    try{value=JSON.parse(line.trim());}
    catch{this.protocolFailure('Codex sent an invalid protocol message: '+JSON.stringify(line.slice(0,80)));return;}
    // A handler failure is reported with its own cause, not as bad JSON.
    try{this.receive(value);}
    catch(e){this.protocolFailure('Codex protocol handling failed: '+(e instanceof Error?e.message:String(e)));return;}
```
- **Regression tests:** `tests/codex.test.ts` — “invalid protocol lines are quoted in
  the disconnect status; handler failures keep their cause”; process-level bad-json
  test in `tests/audit-failure-codex.test.ts`. Existing 16 MiB overflow test unchanged
  and green (overflow now also records via `protocolFailure`).

### F12 — MEDIUM — Pending journal load surfaces raw parse/fs errors
- **File:** `src/recovery.ts:53-59` (`loadPendingEdits`).
- **Evidence:** a corrupt journal threw raw `SyntaxError: Unexpected token …` into
  `pendingLoadError` (shown as “Could not load pending changes. …”) with no mention of
  the journal; fs read errors likewise.
- **Fix (applied):** wrap read+parse, keeping the cause:
```ts
 let data:unknown;
 try { data = JSON.parse(readFileSync(file, 'utf8')); }
 catch (e) { throw Error('The pending edit record could not be read: '+(e instanceof Error?e.message:String(e))); }
```
- **Regression test:** `tests/recovery.test.ts` — “a corrupt pending record reports the
  read failure with its cause”.

### F13 — MEDIUM — Pending journal save: raw fs errors, cleanup can mask the cause
- **File:** `src/recovery.ts:79-95` (`savePendingEdits`).
- **Evidence:** ENOSPC/EACCES/ENOTDIR propagated raw (user sees “ENOSPC: no space left
  on device, write” with no idea the *edit journal* failed — the edit itself may have
  applied); `mkdirSync` sat outside the try; an `unlinkSync` failure in `finally`
  could mask the original error.
- **Fix (applied):** mkdir+write+rename inside one try, wrapped as “Could not save the
  pending edit record: <cause>”; cleanup guarded:
```ts
 try {
  mkdirSync(root, {recursive:true,mode:0o700});
  writeFileSync(temp,data,{mode:0o600,flag:'wx'});
  renameSync(temp,file);
 } catch (e) {
  throw Error('Could not save the pending edit record: '+(e instanceof Error?e.message:String(e)));
 } finally {
  try { if (existsSync(temp)) unlinkSync(temp); } catch {/* Best-effort cleanup; never mask the original error. */}
 }
```
- **Regression test:** `tests/recovery.test.ts` — “pending journal write and removal
  failures name the journal and keep the cause” (root-is-a-file; rename-onto-directory
  leaves **no** `.tmp` behind).

### F14 — MEDIUM — Backup retention failure aborts the edit itself
- **File:** `src/recovery.ts:10-13` (`backupEdit`).
- **Evidence:** the retention loop’s `statSync`/`unlinkSync` could throw (file locked
  on Windows, vanished, or a directory wearing a backup name) *after* the new backup
  was written — failing `writeEdit`’s `prepare()` and refusing a perfectly safe edit.
- **Fix (applied):** per-entry try/catch; retention is best-effort once the backup exists.
- **Regression test:** `tests/recovery.test.ts` — “backup retention cannot fail an edit
  when an old backup is undeletable” (directory named like a backup; 25 edits succeed;
  newest backup content verified).

### F15 — LOW — Pending journal removal surfaces raw fs errors
- **File:** `src/recovery.ts:38-45` (`removePendingRecord`).
- **Fix (applied):** wrapped as “Could not remove the pending edit record: <cause>”.
- **Regression test:** same fs-failure test as F13 (directory in place of the journal).

### F16 — LOW — Windows taskkill spawn not guarded against synchronous throw
- **File:** `src/cli.ts:240-252` (`terminateProcessTree`).
- **Evidence:** `nativeSpawn(taskkill,…)` can throw synchronously (e.g. EMFILE);
  `terminateProcessTree` is called from `close()`/abort paths where a throw would
  propagate into connection teardown.
- **Fix (applied):** try/catch around the taskkill spawn with the existing
  `child.kill(signal)` fallback. Covered by the existing cross-platform tree-kill
  tests on real Windows hosts (the branch is Windows-only).

### F17 — LOW — `runCli` repeated kill attempts after buffer overflow
- **File:** `src/cli.ts:288` (`collect`).
- **Evidence:** after the overflow kill+finish, every further chunk re-ran
  `terminateProcessTree`/`finish` (guarded, but wasteful kill syscalls on a dead PID).
- **Fix (applied):** `if(settled)return current;` at the top of `collect`. Covered by
  the new maxBuffer regression test.

### Paths audited and found already sound (no change)
- Codex request timeouts: every JSON-RPC request is bounded (initialize/config/read/
  hooks/list/account/read/model/list 20 s, thread/start 20 s, turn/start 30 s,
  turn/interrupt 1.8 s, usage reads 1.5–8 s); sign-in idle timeout 180 s; `close()`
  force-kills after 2 s and rejects all pending waiters; `rest()` drains pending
  requests before stopping.
- Abort/cancel mid-turn: `abort → turn/interrupt (1.8 s) → forceStop (2 s) → close`;
  pre-aborted signals end before `turn/start` is sent; tool calls check the signal and
  the allowlist; `respond()` is guarded by child identity so a late tool result never
  writes to a replaced/dead process.
- Automatic-selection retry (`main.ts:2461-2492`): bounded by `MAX_AUTO_RETRIES`,
  never retries after tools ran or text streamed (no double execution), a failed
  reconnect reports the original failure; routing falls back heuristically and never
  throws the turn away.
- `RecordSplitter` overflow (16 MiB/message) closes the connection; UTF-8 chunk
  boundaries handled via `setEncoding`.
- `savePendingEdits` atomic temp+rename; `loadPendingEdits` re-validates every path
  against current exclusions; `clearPendingEdits` keeps unrestored entries on failure.

---

## Proposed patches (read-only files — orchestrator applies serially)

All snippets re-verified against the current tree at finish. P1–P3 are the same
bug class as F4 (stderr discarded → opaque disconnect) in the sibling bridges; the
crash half of that class (unhandled stdin errors) is already fixed for them by F1.

### P1 — MEDIUM — `src/hermes.ts:615-618`: surface the stderr cause on unexpected exit
Old:
```ts
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',()=>{});
  child.on('error',error=>{if(this.child===child)this.fail(error);});
  child.on('exit',()=>{if(this.child===child)this.fail(Error('Hermes disconnected.'));});
```
New:
```ts
  child.stderr.setEncoding('utf8');
  let stderrTail='';child.stderr.on('data',(chunk:string)=>{stderrTail=(stderrTail+chunk).slice(-4000);});
  const stderrCause=()=>{const line=stderrTail.split('\n').map(item=>item.trim()).filter(Boolean).pop();return line?' Last error: '+line.slice(0,300):'';};
  child.on('error',error=>{if(this.child===child)this.fail(Error('Hermes could not be started: '+error.message+stderrCause()));});
  child.on('exit',()=>{if(this.child===child)this.fail(Error('Hermes disconnected.'+stderrCause()));});
```
Note: `friendlyHermesError` passes named messages through; a stderr line containing
“rate limit” still maps to the Hermes usage wording, which is appropriate.
Minor (not patched): `sendRpc`’s timeout timer (`src/hermes.ts:383` region) is never
cleared on response — it fires into an empty pending map (no functional bug, small
timer leak); consider storing and clearing it when the entry resolves.

### P2 — MEDIUM — `src/opencode.ts:404-407`: same class
Old:
```ts
   child.stderr.setEncoding('utf8');
   child.stderr.on('data',()=>{});
   child.on('error',error=>{if(this.child===child)this.fail(error);});
   child.on('exit',()=>{if(this.child===child)this.fail(Error('OpenCode disconnected. Your draft is preserved; reconnect to retry.'));});
```
New:
```ts
   child.stderr.setEncoding('utf8');
   let stderrTail='';child.stderr.on('data',(chunk:string)=>{stderrTail=(stderrTail+chunk).slice(-4000);});
   const stderrCause=()=>{const line=stderrTail.split('\n').map(item=>item.trim()).filter(Boolean).pop();return line?' Last error: '+line.slice(0,300):'';};
   child.on('error',error=>{if(this.child===child)this.fail(Error('OpenCode could not be started: '+error.message+stderrCause()));});
   child.on('exit',()=>{if(this.child===child)this.fail(Error('OpenCode disconnected. Your draft is preserved; reconnect to retry.'+stderrCause()));});
```

### P3 — MEDIUM — `src/claude.ts`: handshake stderr + raw auth-status JSON parse
(a) `src/claude.ts:246-248` — old:
```ts
   child.stderr.on('data',()=>{});
   child.on('error',error=>finish(error));
   child.on('exit',()=>finish(Error('Claude Code exited during connection.')));
```
New:
```ts
   let stderrTail='';child.stderr.setEncoding('utf8');child.stderr.on('data',(chunk:string)=>{stderrTail=(stderrTail+chunk).slice(-4000);});
   const stderrCause=()=>{const line=stderrTail.split('\n').map(item=>item.trim()).filter(Boolean).pop();return line?' Last error: '+line.slice(0,300):'';};
   child.on('error',error=>finish(Error('Claude Code could not be started: '+error.message+stderrCause())));
   child.on('exit',()=>finish(Error('Claude Code exited during connection.'+stderrCause())));
```
(b) `src/claude.ts:193` — malformed `claude auth status` output throws raw
`SyntaxError` into the connect Notice. Old:
```ts
  const auth=record(JSON.parse(await run(['auth','status'])));
```
New:
```ts
  let authStatus:unknown;try{authStatus=JSON.parse(await run(['auth','status']));}catch{throw Error('Claude Code returned an unreadable sign-in status. Run claude in your terminal, then reconnect.');}
  const auth=record(authStatus);
```

### P4 — LOW — `src/main.ts:2582`: provider-neutral empty-answer error
Old:
```ts
 }else throw Error('Codex returned no answer. Your draft is preserved.');
```
New:
```ts
 }else throw Error(this.butler.providerName(provider)+' returned no answer. Your draft is preserved.');
```

### P5 — LOW — `src/main.ts:2602`: provider-neutral context-shortening Notice
Old (inside the long history-push line):
```ts
new Notice('Codex now uses the latest six exchanges as chat context. Earlier messages remain visible.');
```
New:
```ts
new Notice('OWLA now uses the latest six exchanges as chat context. Earlier messages remain visible.');
```

---

## Verification (final tree state)

| Gate | Result |
|---|---|
| `npm run check` (tsc --noEmit) | ✓ pass |
| `npm run lint` (eslint src) | ✓ pass |
| `tests/cli.test.ts` | ✓ 22/22 |
| `tests/recovery.test.ts` | ✓ 10/10 |
| `tests/codex.test.ts` | ✓ 54/54 |
| `tests/audit-failure-codex.test.ts` (new) | ✓ 5/5 |
| `tests/cli-security-audit.test.ts` | ✓ 5/5 (unchanged) |
| `npm test` (full) | ✓ **459/459 pass, 0 fail** |
| `npm run guard:test` | ✓ “vault guard tests ok” |
| `npm run build` | not run — orchestrator builds at the end |

Mid-audit full-suite runs showed 1–2 failures in `tests/hermes.test.ts`
(sibling-owned, `src/hermes.ts` mid-edit); per instructions they were left untouched
and re-run — the sibling settled the edit and the final full suite is green.

Existing-test updates: **none required by the fixes** (all regressions are additive).
The migration test in `tests/codex.test.ts` transiently failed while a sibling
iterated `src/core.ts` `migrateSettings` (legacy top-level model handling flipped
between two semantics mid-audit); the sibling’s final state restores the original
behavior for version-less legacy settings, so the original assertion stands and
passes. No owned test was weakened.

Files modified: `src/cli.ts`, `src/codex.ts`, `src/recovery.ts`,
`tests/cli.test.ts`, `tests/codex.test.ts`, `tests/recovery.test.ts`.
Files created: `tests/audit-failure-codex.test.ts`, this report.
Diff size: ~247 insertions / 30 deletions across the six owned files.

Not verified live: no Obsidian install/running-plugin exercise was performed (no
build per instructions); the process-level fake-codex tests cover spawn/exit/protocol
paths but not the rendered Notice UI. Scratch probes were deleted; no probe files
remain in the repo.

## Open questions
1. `MAX_MODEL_PAGES=20` (≤2000 models) is generous vs real catalogs (1–2 pages);
   lower it if a tighter connect budget is wanted.
2. Codex `account/login/completed` with `success:false` carries no documented reason
   field; the status stays “Codex sign-in did not complete.” — if the protocol adds an
   error payload, surface it like F4.
3. `runCli` now ends stdin at spawn; any future caller that needs to write stdin must
   use `spawnCli` directly (none today).
4. P1–P5 await orchestrator application; P3(b)’s wording should match the Claude
   bridge’s sign-in guidance once applied.
5. The sibling `src/core.ts` migration semantics changed twice during this audit;
   final state verified green, but re-run `tests/codex.test.ts` if core.ts changes again.