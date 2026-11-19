# OWLA Butler 3.7.0-RC — stream & resource leak audit (stream/chats/claude)

Status: **fixed in owned files** (`src/stream.ts`, `src/chats.ts`, `src/claude.ts` +
owned/new tests). Unowned problems carry exact proposed patches for the orchestrator.
Branch `3.7.0-RC`. No git mutations, no build, no live model turns, no daemon contact,
no vault mutation. Probes scratch-only, deleted after.

**Method.** Read every exit path of the Claude per-turn bridge (spawn → handshake →
turn → abort/error/result → finally → disconnect/unload), compared against the Codex
and Hermes reference patterns in the same tree, and proved each fix with a regression
test. End-to-end tests run fake `claude` CLIs (shell wrapper + generated `.mjs` in
`mkdtemp` under TMPDIR/scratch) that speak the real stream-json control protocol —
no model turn. Child reaping verified by polling `process.kill(pid,0)` until ESRCH.

**Caveats.** Sibling agents edited the shared tree live during this audit; `file:line`
for unowned files are a snapshot and drift — re-locate proposed patches by content.
`npm run check` was transiently red twice from siblings' in-progress edits
(`opencode.ts` rest(), `codex.ts` processFailure); both cleared by them before the
final green run. POSIX-only for the process-group tests (Windows group semantics differ).

---

## Fixed findings (owned files)

### F1 · HIGH · Unbounded protocol buffer in both Claude parsers — FIXED
`src/claude.ts:223,276` (was 220,269). Both `handshake()` and `run()` used
`new RecordSplitter('\n')` with the default `limit=Infinity`. A CLI emitting bytes
without a newline (crash loop, corrupted stdout, hostile binary) grew memory without
bound. Codex caps lines at 16 MiB (`codex.ts:10`), OpenCode blocks at 32 MiB
(`opencode.ts:170`); Claude was the only unlimited parser.
Evidence: scratch probe pushed 64 MiB in 64 KiB chunks → `overflow=false`.
Fix: `MAX_CLAUDE_LINE=16*1024*1024` (`claude.ts:38`) passed to both splitters; on
`lines.overflow` the turn/handshake finishes with
`'Claude Code sent a protocol message that was too large.'` and the child is reaped.
Tests: `audit-stream-claude.test.ts` — oversized turn line and oversized handshake
line both reject with /too large/ and the flooded child dies (SIGTERM via stopChild).

### F2 · HIGH · No SIGKILL escalation — orphan processes after cancel/disconnect/unload — FIXED
`src/claude.ts` old 381 (run grace timer), old 221 (handshake finish), old 411–417
(`kill()` + `disconnect()`). Every kill path sent a single SIGTERM. A CLI that ignores
or blocks SIGTERM survived forever — and since `run()`/`handshake()` untrack the child
before killing, `disconnect()` (plugin unload, provider switch) could never reach it
again. Codex (`codex.ts:449`) and Hermes (`hermes.ts:764–768`) already escalate
SIGTERM→SIGKILL after 2 s; Claude did not.
Fix: `private stopChild(child)` (`claude.ts:446`): if already exited, one group sweep
for lingering members (Windows PID-reuse guard inside `terminateProcessTree`); else
SIGTERM now + `setTimeout(SIGKILL,2000)` cleared on 'exit'. Used by the run grace
timer, handshake finish, and `disconnect()`.
Tests: a SIGTERM-trapping fake child is SIGKILLed ~4.4 s after abort (2 s grace +
ignored SIGTERM + 2 s force) instead of orphaned; disconnect reaps a hanging
handshake child and fails the connect.

### F3 · HIGH · Stream handlers kept running after settle — post-cancel UI writes, vault tool calls, state mutation — FIXED
`src/claude.ts` run(): after `finish()` (abort/error/result) the stdout 'data'
handler kept parsing and calling `handle()`: `options.onText` fired into a finished
view, `answerMcp` started **new vault tool calls after cancel**, `acceptRateLimit`
and the 'exit' handler mutated bridge state post-turn, and `streamed` kept growing
while the child lingered. Codex guards every event with `if(settled)return` and its
tool wrapper with `signal.aborted||settled` (`codex.ts:382–383`); Claude had neither.
Fix:
- `if(settled)return` at the data handler (`:380`), `handle()` (`:314`) and the
  'exit' handler (`:393`).
- `answerMcp` refuses `tools/call` when `settled||options.signal.aborted` (`:302–304`).
- `send()` moved inside the executor and guarded `settled||destroyed||writableEnded`
  (`:277`) — no write-after-end, no responses for a dead turn.
- `finish()` removes stdout/stderr 'data' listeners and clears
  `streamed/lastAssistant/stderr/sources` (`:279–287`), releasing the turn's buffers
  and the closures that capture `options` (chat history, vault context, base64 images).
- Already-aborted signal at registration settles at once (`:293`, mirrors codex:410).
Test: fake streams a delta and a second `tools/call` 300 ms after abort — neither
reaches `onText` nor the tool handler; only the pre-abort delta and first call appear.

### F4 · MEDIUM · RecordSplitter missed delimiters straddling ≥3 chunks — FIXED
`src/stream.ts:29` (old). The straddle check only looked at the **last** part:
`(last.slice(1-delimiter.length)+chunk.slice(0,delimiter.length-1))`. A delimiter of
≥3 chars spread over three or more chunks was never noticed until some later chunk
happened to contain a delimiter — records were silently delayed (and with a limit,
pending could overflow on a record that should already have been emitted).
Evidence (pre-fix probe): `'Xab'+'c'+'dY'` with delimiter `abcd` → `[]` (expected
`['X']`); SSE `'data: 1\r'+'\n'+'\r'+'\ndata: 2'` with `\r\n\r\n` → `[]`.
No current caller hit it (codex/claude use `\n`, opencode `\n\n` — both ≤2 chars),
but the splitter is a general utility and the audit scope is chunk boundaries.
Fix: a bounded `tail` (last `delimiter.length-1` chars of pending, `stream.ts:20`)
replaces the last-part check; updated on append and after each split, cleared on
overflow. O(delimiter length) per chunk — the linear-time guarantee is preserved.
Tests: `audit-stream-splitter.test.ts` — 3-chunk `abcd`, 4-chunk CRLF, one-char-per-
chunk `\n\n`, surrogate-pair splits, overflow terminality, 8 MiB record in 2048
chunks still <250 ms. All four pre-existing stream tests pass unchanged.

### F5 · MEDIUM · Handshake child not detached — group kill degraded to single kill — FIXED
`src/claude.ts:218` (old). `run()` spawns `detached:process.platform!=='win32'` but
`handshake()` did not. On POSIX `terminateProcessTree` tries `process.kill(-pid)`;
without detachment the child shares the parent's group, so the group kill throws
ESRCH and falls back to killing only the direct child — any grandchildren orphan.
Fix: handshake spawns detached like a turn (`:220`). Covered by the disconnect and
handshake-oversize reap tests (group kill now reaches the whole tree).

### F6 · MEDIUM · Grace timer scheduled after child exit — dead listener + 2 s closure retention — FIXED
`src/claude.ts:381–382` (old). The finally block always scheduled the 2 s kill timer
and cleared it on `child.once('exit')` — but when the child had **already** exited
(the exit-handler error path), 'exit' never fires again: the timer lingered 2 s per
failed turn holding the child closure, and the once-listener was never removed.
Fix: branch on `exitCode/signalCode` (`:405–410`): already exited → immediate
`stopChild` sweep, no timer; alive → grace timer cleared on exit.

### F7 · LOW · Unbounded web-source map — FIXED
`src/claude.ts:264` (old). `sources` collected every search-result URL for the whole
turn with no cap (the bridge must not rely on the caller's tool budget). Fix:
`addSource` caps at 500 entries, existing keys still update (`:271,357,360`).
`webSources` falls back to the link text for a cited URL whose title was dropped,
so citations stay intact.

### F8 · LOW · ChatStore.list read every candidate file — FIXED
`src/chats.ts:11–12` (old). `list()` (also called by every `save()`) stat+read **all**
UUID-named files in `saved-chats/` before slicing to 20. The folder lives in vault
storage (`main.ts:1319` → `vaultStorage()`); a damaged or sync-conflicted folder with
many ≤100 KB candidates meant unbounded transient memory/IO per call.
Fix: read budget `maxReads=100` (constructor param, `chats.ts:6,16`). Oversized files
are skipped by stat **before** the budget check, so junk over the 100 KB cap never
hides a real chat. Healthy folders (≤20 files) are unaffected.
Tests: `audit-stream-chats.test.ts` — budget=1 lists exactly 1 of 3; 150 oversized
junk files + 1 real chat still lists the real chat in any readdir order; default
budget lists all 20.

## Verified sound (owned scope, no change needed)

- **Chat persistence caps** (`chats.ts`): 20 chats × 6 messages × 6000 chars,
  100 KB/file cap, title ≤80, sourcePath ≤1024, roles filtered, atomic `wx`+rename
  with temp cleanup in `finally`, modes 0700/0600. Existing tests cover all of it.
- **Multi-byte UTF-8 across chunks**: both Claude stdout paths use
  `setEncoding('utf8')` (StringDecoder reassembles split code points). End-to-end
  test writes a result line as 3-byte pipe slices with delays — text arrives intact.
- **stderr consumption**: consumed in both paths (no pipe-buffer stall); run stderr
  bounded to the last 4000 chars.
- **AbortSignal listener**: removed in `finish()`; `{once:true}` + explicit removal,
  no accumulation on long-lived signals.
- **DOM streaming batching** (read-only `main.ts:2375`): 50 ms `streamTimer` batch +
  rAF scroll + `epoch`/`closing` guard; timer cleared in finally (`:2617`), quality
  escalation (`:2431`), retry (`:2483`) and success (`:2509`). Sound as-is.

## Proposed patches — UNOWNED files (orchestrator applies serially)

### U1 · HIGH · Hermes stdout buffer is unbounded AND quadratic — PROPOSED
`src/hermes.ts:532–537` (snapshot). `handleStdout` does `jsonBuffer+=chunk` then
repeated `indexOf`/`slice` — the exact quadratic pattern `RecordSplitter` was built
to fix (PERFORMANCE-AUDIT finding 3; also flagged in `audits/3.7.0-rc/performance.md`),
with **no size cap**: a newline-free flood grows `jsonBuffer` without bound.
Proposed patch (re-locate by content; sibling edits drift):

old:
```ts
 private jsonBuffer='';
```
new:
```ts
 private lines=new RecordSplitter('\n',16*1024*1024);
```
old:
```ts
 private handleStdout(chunk:string):void{
  this.jsonBuffer+=chunk;
  let idx;
  while((idx=this.jsonBuffer.indexOf('\n'))>=0){
   const line=this.jsonBuffer.slice(0,idx).trim();
   this.jsonBuffer=this.jsonBuffer.slice(idx+1);
   if(!line)continue;
```
new:
```ts
 private handleStdout(chunk:string):void{
  for(const raw of this.lines.push(chunk)){
   const line=raw.trim();
   if(!line)continue;
```
(and close the `for` where the `while` closed; after the loop add
`if(this.lines.overflow)this.fail(Error('Hermes sent a protocol message that was too large.'));`)
old:
```ts
  this.pending.clear();this.jsonBuffer='';
```
new:
```ts
  this.pending.clear();this.lines=new RecordSplitter('\n',16*1024*1024);
```
plus `import {RecordSplitter} from './stream';` next to the other imports.
Note: the rest of `handleStdout`'s body is unchanged; only the loop header/footer
and the buffer declaration move. `fail()` already disconnects and reaps.

### U2 · LOW · Hermes per-request timeout timers never cleared — PROPOSED
`src/hermes.ts:528` (snapshot). `sendRpc` schedules a timeout but never clears it when
the response arrives or on disconnect; each timer holds its closure up to `timeout`
(default 30 s) after the request settled. Transient, but proportional to request count.
Proposed patch:
old (`:300`):
```ts
 private pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void}>();
```
new:
```ts
 private pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer?:ReturnType<typeof setTimeout>}>();
```
old (`:526–528`):
```ts
   this.pending.set(id,{resolve,reject});
   try{this.child!.stdin.write(payload);}catch(error){this.pending.delete(id);reject(error instanceof Error?error:Error(String(error)));}
   if(timeout!==null)setTimeout(()=>{const entry=this.pending.get(id);if(entry){this.pending.delete(id);entry.reject(Error('Hermes timed out.'));}},timeout);
```
new:
```ts
   const timer=timeout!==null?setTimeout(()=>{const entry=this.pending.get(id);if(entry){this.pending.delete(id);entry.reject(Error('Hermes timed out.'));}},timeout):undefined;
   this.pending.set(id,{resolve,reject,timer});
   try{this.child!.stdin.write(payload);}catch(error){this.pending.delete(id);if(timer)clearTimeout(timer);reject(error instanceof Error?error:Error(String(error)));}
```
old (`:544`, response path):
```ts
    if(p){this.pending.delete(id);const failure=record(msg.error);
```
new:
```ts
    if(p){this.pending.delete(id);if(p.timer)clearTimeout(p.timer);const failure=record(msg.error);
```
old (`:760`, disconnect):
```ts
  for(const entry of this.pending.values())entry.reject(Error('Hermes disconnected.'));
```
new:
```ts
  for(const entry of this.pending.values()){if(entry.timer)clearTimeout(entry.timer);entry.reject(Error('Hermes disconnected.'));}
```

### U3 · INFO · cli.ts hardening already landed by sibling — VERIFIED, no action
`spawnCli` now attaches default no-op error listeners to all three stdio streams
(an unhandled EPIPE used to be able to crash the plugin host), `runCli` ends stdin
immediately, guards `collect` with `settled`, and names the command in errors.
These close the residual cli.ts items this audit would otherwise have proposed.
`terminateProcessTree` semantics unchanged — the fixes above rely on them.

### U4 · LOW · runCli probe children are not detached — OBSERVATION only
`src/cli.ts` `runCli` spawns without `detached`, so its SIGKILL-on-timeout reaches
only the direct child on POSIX (group kill falls back). Used for `--version`/`auth`
probes that spawn no subprocesses, so the orphan risk is theoretical; making runCli
detached would change every bridge's probe semantics — orchestrator's call.

## Verification summary

- `npm run check` ✓ · `npm run lint` ✓ · `npm run guard:test` ✓ (final run, after
  siblings' transient breakages cleared).
- Targeted: `node --import tsx --test tests/stream.test.ts tests/chats.test.ts
  tests/claude.test.ts tests/audit-stream-splitter.test.ts tests/audit-stream-chats.test.ts
  tests/audit-stream-claude.test.ts` → **35/35 pass** (19 pre-existing owned + 16 new).
- Full `npm test` → **459 tests, 456 pass, 3 fail** — all 3 in `tests/hermes.test.ts`
  (`.env` filtering ×2, instruction-file containment ×1), the sibling's in-progress
  domain, untouched by this audit. Re-ran once: identical 3 failures, consistent
  (not flaky). Every stream/chats/claude test, owned or new, passes in the full run.
- No owned existing test needed modification — no intentional behavior change to
  documented contracts (splitter API, ChatStore default behavior, Claude protocol).
- `git status` checked before/after; only owned files touched; no add/commit/push.
- Build intentionally not run (task constraint). Not verified live in Obsidian:
  real Claude CLI turn/unload behavior (unit fakes speak the protocol but are not
  the installed CLI).

## Open questions

1. **In-flight vault tool at abort**: `ProviderRunOptions.tool` carries no signal,
   so a tool already executing when the user stops runs to completion (its response
   is now discarded, and no new tool starts). Cancelling mid-tool needs a contract
   change across all bridges + main.ts toolQueue — orchestrator decision.
2. **Splitter limit units**: `limit` counts UTF-16 code units, not bytes (a 16 MiB
   cap admits up to ~48 MB of 3-byte UTF-8). Consistent with codex's existing
   semantics; a byte-exact cap would be a cross-bridge behavior change.
3. **Hermes U1/U2** sit in a file the sibling is actively rewriting (212-line diff,
   3 red tests). Apply after their work settles, or hand the patches to them.
4. Grandchildren outliving a direct child that exits *during* the run grace window
   are not swept (timer cleared on exit). With `--tools ''` Claude spawns no
   subprocesses, so this is theoretical; codex/hermes share the same edge.
