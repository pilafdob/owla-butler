# 3.7.0 RC audit — multi-provider handling & usage limits

Scope: provider registry consistency across the four bridges (Codex/OpenCode/Claude/Hermes),
exhaustion detection, usage-meter accuracy and reset handling, fallback behavior, OpenCode
resident-server lifecycle, settings-migration safety, model dedup / selectableModels.

Owned files edited: `src/exhaustion.ts`, `src/usage.ts`, `src/opencode-availability.ts`,
`src/opencode.ts`, `src/core.ts`, `tests/usage.test.ts`, `tests/core.test.ts`,
`tests/opencode.test.ts`, `tests/opencode-availability.test.ts`, new
`tests/audit-providers-registry.test.ts`, `tests/audit-providers-opencode-lifecycle.test.ts`.
`src/provider.ts` audited, no change needed (registry complete; tool-name shapes verified by test).
All other files READ-ONLY; unowned problems are proposals below.

Baseline on arrival: `npm run check` ✓, `npm run lint` ✓, 351/351 tests ✓ (task said 342; the
shared tree had grown). Sibling agents edited the same tree concurrently throughout.

## Fixed (owned files)

### P1 — HIGH — Codex exhaustion ignored reset times; auto mode could stay stuck after a reset
`src/exhaustion.ts:27` (was 21). `codexExhaustion` returned exhausted on the first window ≥100%
forever, even after its `resetsAt` passed, and reported the *first* full window's reset when
several were full. `main.ts:302` exempts codex from the time-based expiry that the other
providers get (it relies on fresh meters), and in Automatic mode nothing re-reads Codex usage
once it is excluded (`automaticOffers` only connects candidates; `probePrimaryQuota` runs only
when a manual fallback is active). Net effect: after a Codex limit reset, Codex stayed out of
automatic selection until a manual turn or reconnect.
Fix: windows whose reset passed no longer block; the latest full reset decides; non-finite
percentages are unknown, not full; added optional `error` + `now` parameters (Claude pattern).
A limit error without a readable window now yields a bounded retry (`now + 15 min`, mirroring
Hermes' `HERMES_LIMIT_RETRY_SECONDS`) instead of an unbounded block.
Evidence: scratch probe — stale full window (`resetsAt: now-60`) → `exhausted:false`;
two full windows → `resetsAt = now+7200` (latest); `rate_limit_exceeded` with no meters →
`{exhausted:true, resetsAt:now+900}`.
Regression: `tests/opencode.test.ts` ("a Codex window whose reset has passed…", "a Codex limit
error without a readable window…").
Note: the `error` parameter is not yet passed by any caller — see U1 for the one-line wiring
proposal in `main.ts`/`codex.ts`. Current callers are unaffected (signature backward compatible).

### P2 — HIGH — sparse usage reports dropped other windows/buckets
`src/usage.ts:6-14`. `updateUsage` merged `rateLimitsByLimitId` by whole-bucket replacement:
a partial bucket (only `primary`) erased the previously reported `secondary` and any fields the
report omitted. The `rateLimits` path already merged per bucket, and `tests/usage.test.ts:3`
codifies "without fabricating or losing other windows" — the `rateLimitsByLimitId` path
violated that intent. Codex `account/rateLimits/updated` events merge with `replace=false`
(`src/codex.ts:423`), so a sparse event lost windows.
Fix: per-bucket merge `{...existing, ...incoming}`; an explicit `null` window still clears;
`replace=true` still starts fresh.
Evidence: probe — Claude unified report (five_hour 90%, seven_day 40%) then a legacy
single-window `rate_limit_event` (five_hour rejected) keeps both windows:
`[['5-hour window',100],['Weekly window',40]]`, exhaustion still true.
Regression: `tests/usage.test.ts` ("a sparse bucket report keeps the windows and buckets it
does not mention").

### P3 — HIGH — OpenCode concurrent-run race corrupted session/tool state
`src/opencode.ts:520-575`. `run()` set `this.active` only *after* the async session create, and
set `toolHandler`/`toolNames` before the busy check. Two overlapping runs could both pass the
`if(this.active)` check; the second overwrote `sessionId`/`toolHandler`, and the first's
`finally` then cleared the second's handler mid-turn ("OWLA is not ready for tool calls") and
skipped session cleanup. Hermes reserves synchronously; OpenCode did not.
Fix: the turn slot is reserved synchronously (`this.active=turn` before the first await);
`toolHandler`/`toolNames`/`lastFailure` are set only after the reservation; cleanup deletes the
session only when a session id was actually created (also removes a bogus `DELETE /api/session/`
with an empty id when creation failed). The redundant pre-connect tools-digest disconnect was
removed — `connect()` already re-keys on the tools digest and guards active/holders.
Regression: `tests/audit-providers-opencode-lifecycle.test.ts` ("a second concurrent run is
refused without disturbing the first turn") — fake server delays session creation 400 ms; the
second run rejects with "already responding", the first completes with its tool callback intact.

### P4 — MEDIUM — abort during OpenCode session creation waited up to 30 s
`src/opencode.ts:546`. The session POST did not carry the turn's abort signal; Stop only took
effect once the event stream opened.
Fix: `signal:controller.signal` on the session create; any error while aborted surfaces as
`Stopped.` (matches the Codex bridge convention).
Regression: lifecycle test "stopping during session creation ends the turn promptly" — 5 s
session delay, abort at 150 ms, rejects `/Stopped/` in <2 s.

### P5 — MEDIUM — OpenCode `rest()` cancelled an in-flight connect
`src/opencode.ts:695-708`. `rest()` disconnected when `this.connecting` was set (no child yet),
bumping the generation and failing the connect with "OpenCode connection cancelled." Reachable
when a hold release (warmup expiry, probe release) lands while a connect is starting.
Fix: rest waits for the in-flight connect, then re-checks holders/active/connecting and rests
only if nothing took over; it never cancels a connect.
Regression: lifecycle test "a rest waits for an in-flight connect instead of cancelling it".
(The Codex bridge has the same pattern — see U4.)

### P6 — MEDIUM — no stale-server detection for the resident OpenCode server
`src/opencode.ts:329-352`. A child process whose HTTP server died/hung stayed "connected":
`ready` is `!!child`, and every turn spent its 30 s session timeout on a dead endpoint.
Fix: on the reuse path (`child` + same connection key, no active turn) `connect()` probes
`/api/info` (2 s timeout); a non-answer disconnects and starts a fresh server once. The probe is
deduplicated through `this.connecting` like a connect, so concurrent connects still share one
server. Cost: one loopback GET per turn.
Regression: lifecycle test "a resident server that stopped answering is detected and restarted"
— fake server closes its HTTP listener after the catalogue read while the process lives;
the next connect replaces it (different pid).

### P7 — MEDIUM — "Verify connection" was a no-op for a resident OpenCode server
`src/opencode.ts:362`. `main.ts:396` calls `bridge.recheck?.()`; Codex and Claude implement it,
OpenCode did not, so verify returned the cached connection without re-probing.
Fix: `recheck(){if(!this.connecting)this.connectionKey='';}` (Claude pattern) — the next connect
starts a fresh server and re-reads the catalogue; an active reply is never stopped.
Regression: lifecycle test "verify connection restarts a healthy resident server".

### P8 — MEDIUM — OpenCode model catalogue was not deduplicated
`src/opencode.ts:508-518`. `readModels` mapped every entry; a repeated `providerID/modelID`
produced duplicate models (duplicate picker entries, inflated `selectableModels` counts).
Claude dedups (`src/claude.ts:63-69`); OpenCode did not. `currentModels` dedups by name for
routing, but the manual picker and `resolveModel` see the raw list.
Fix: dedup by `model.id`, first entry wins.
Regression: lifecycle test "a duplicated catalogue entry is offered once".
(Codex pagination and Hermes model list lack dedup too — see U5.)

### P9 — MEDIUM — limit-error wording gaps (OpenCode + Codex shapes)
`src/exhaustion.ts:54-56`, `src/opencode.ts:113`. `opencodeExhaustion` matched only
`rate limit` (space), bare `429` anywhere, and missed `quota`/`too many requests`/`limit reached`;
`friendlyOpencodeError` missed `usage limit`/`limit reached` and matched `429` inside longer
numbers. `classifyOpencodeFailure` already used the wider shape — the three readers disagreed.
Fix: aligned all three on `usage limit|rate.?limit|quota|\b429\b|too many requests|limit reached`
(free-limit detection unchanged and still first).
Regression: `tests/opencode.test.ts` ("OpenCode limit errors are recognised across their wordings").

### P10 — LOW — NaN percentages counted as full meters
`src/exhaustion.ts:77` (claudeExhaustion), `src/opencode-availability.ts:140` (applyUsage).
`NaN < 100` is false, so a non-finite percentage was treated as a full window → false block.
The decoders filter non-finite values, but both functions accept hand-built snapshots.
Fix: explicit `typeof number && Number.isFinite` guards (codexExhaustion got the same in P1).
Regression: `tests/opencode-availability.test.ts` ("a non-finite Go meter percentage…"),
`tests/opencode.test.ts` NaN case.

### P11 — MEDIUM — settings migration dropped data on unknown/future schema versions
`src/core.ts:70-78,131-136`. `modern` matched only `schemaVersion===2||===3`: data written by a
newer version (or a numeric-string version) fell to the legacy path and lost every connection
flag, executable, fallback and auto-mode toggle; `readSettings` also lost the platform block's
modern fields when the top-level `schemaVersion` was missing (sync corruption) even though a
`platforms` block is only ever written by schema 3+.
Fix: `modern` accepts any finite version ≥2 (number or numeric string; all modern reads are
strict `===true`/`!==false`/`string()` checks, so consent semantics are unchanged);
`readSettings` infers schema 3 from the presence of a `platforms` block when the top-level
version is absent. Hermes model prefs parsing simplified to the same shape as the other three
providers (was a double `record()` cast).
Regression: `tests/core.test.ts` ("migration keeps saved fields from a newer schema version…",
"a platforms block keeps modern settings readable when the top-level version was lost").
Coordination note: the legacy top-level `model` (no schema version, ollama era) intentionally
stays OUT of the Codex record — `tests/codex.test.ts:4` ("migration removes inference
configuration…") codifies that contract and was used as the authority after it flipped
mid-task (see Open questions).

### Registry consistency — audited, verified by test, no change needed
`src/provider.ts`: `PROVIDER_IDS`/`PROVIDER_NAMES` complete for all four bridges;
`toolName`/`prefixToolNames` produce `read_note` / `owla_read_note` / `mcp__owla__read_note`
correctly and are idempotent (no double prefix on mid-turn provider switches, which re-derive
from unprefixed `baseInstructions` at `main.ts:2369`). All four bridges start with an identical
empty contract (status/ready/running/models/selectableModels/usage/resolveModel/hold/disconnect).
New `tests/audit-providers-registry.test.ts` (5 tests) locks this in, including hold/release and
idempotent disconnect on unconnected bridges and independent per-bridge state.

## Proposed (unowned files — exact patches, not applied)

### U1 — HIGH — Codex limit errors never set exhaustion (main.ts + codex.ts)
`src/main.ts:297-299` computes codex exhaustion from meters only; a 429/usage-limit turn failure
with meters <100% (or no report) records nothing, so manual fallback never triggers and auto
mode keeps retrying Codex. Claude/Hermes store error-based exhaustion on the bridge; Codex has
no equivalent. `codexExhaustion(usage, error?, now?)` (P1) is ready for this wiring.
Proposed patch (codex.ts): add a stored field and set it on limit failures, clear on success:
```ts
// CodexBridge field, next to usage:
exhaustion:ProviderExhaustion|null=null;
// in run(), turn/completed error path (src/codex.ts:407-408) and turn/start rejection (~415-419):
const message=typeof turn.error?.message==='string'?turn.error.message:'';
if(/rate.?limit|usage limit|limit reached|429|quota|too many requests/i.test(message))
 this.exhaustion=codexExhaustion(this.usage,message);
// on a completed turn (turn.status==='completed'): this.exhaustion=null;
```
Proposed patch (main.ts:297-302): prefer the stored error exhaustion while it is live, and let
codex expire by reset like the others:
```ts
let state=provider==='codex'
 ?(this.codexBridge.exhaustion?.exhausted?this.codexBridge.exhaustion:codexExhaustion(this.codexBridge.usage))
 :(provider==='opencode'?this.opencodeBridge.exhaustion:provider==='hermes'?this.hermesBridge.exhaustion:this.claudeBridge.exhaustion)??fresh;
if(state.exhausted&&state.resetsAt!==null&&state.resetsAt<=Date.now()/1000)state=fresh;
```
(The bounded retry reset from P1 guarantees the error-based state expires even without a new
meter report; `probePrimaryQuota` already re-probes when `resetsAt` is null or passed.)

### U2 — MEDIUM — Claude partial rate_limit_event replaces the whole snapshot (claude.ts)
`src/claude.ts:251,405` use `updateUsage(this.usage,snapshot,true)`. Older Claude reports carry
only the triggering window (`decodeClaudeRateLimit` fallback, `src/usage.ts:114`), so a
single-window event drops the other plan windows until the next full report. With P2's merge,
`replace=false` is safe: stale full windows cannot cause false exhaustion (reset-time filtered)
and within-window percentages only grow.
Proposed patch: `this.usage=updateUsage(this.usage,snapshot);` in `acceptRateLimit` (line 251).
Keep `replace=true` in `acceptUsage` (get_usage reports are complete).

### U3 — MEDIUM — Claude connect coalesces different-key connects (claude.ts)
`src/claude.ts:173`: `if(this.connecting)return this.connecting;` — no key comparison, unlike
Codex/OpenCode/Hermes which throw "Wait for the current … connection to finish." A connect with
a different executable/cwd silently returns the old connection's promise.
Proposed patch:
```ts
if(this.connecting){
 if(this.connectionKey!==key)throw Error('Wait for the current Claude Code connection to finish.');
 return this.connecting;
}
```

### U4 — MEDIUM — Codex rest() can cancel an in-flight connect (codex.ts)
`src/codex.ts:425-442`: same pattern as P5 — `rest()` with `connecting` set and no child falls
through to `close()`, cancelling the connect. Proposed patch mirrors P5:
```ts
async rest(){
 if(this.holders.size||this.active||this.idle)return;
 if(this.connecting){try{await this.connecting;}catch{}
  const connecting=this.connecting as Promise<void>|null;
  if(this.holders.size||this.active||this.idle||connecting)return;}
 if(!this.child)return;
 // …existing drain/close logic unchanged…
}
```

### U5 — LOW — model-list dedup missing in Codex pagination and Hermes (codex.ts, hermes.ts)
`src/codex.ts:267-270`: cursor loop guards repeated *pages* but not repeated model ids across
pages. `src/hermes.ts:488-503`: `availableModels` entries are not deduped by `modelId`.
Proposed: a `seen` Set keyed by `model.id` (Codex) / `id` (Hermes), first entry wins — the
pattern now used in `readModels` (P8) and `decodeClaudeModels`.

### U6 — MEDIUM — Hermes disconnect leaves stale models/accountType (hermes.ts)
`src/hermes.ts:608-621`: `disconnect()` keeps `this.models` and `accountType='hermes'`, so
`selectableModels` still lists models and `needsSignIn` stays false while disconnected —
Claude clears both (`src/claude.ts:415-421`). `main.ts:459` masks accountType on explicit
disconnect, but `fail()`/`rest()` paths do not.
Proposed patch: in `disconnect()`, add `this.models=[];this.accountType='';` (needsSignIn then
reports true via `!models.length`, matching the "connect a provider first" guidance).

### U7 — MEDIUM — Hermes stdout buffer is unbounded (hermes.ts)
`src/hermes.ts:387-392`: `this.jsonBuffer+=chunk` with no size cap; Codex uses a 16 MiB
RecordSplitter and OpenCode a 32 MiB cap. A faulty/malicious ACP peer can grow Obsidian memory
without limit. Proposed: replace the manual buffer with `new RecordSplitter('\n',16*1024*1024)`
(the Codex pattern, `src/codex.ts:10`), closing the connection on overflow.

### U8 — MEDIUM — Hermes silently runs the wrong model when set_model fails (hermes.ts)
`src/hermes.ts:558`: `try{await this.sendRpc('session/set_model',…);}catch{/* ignore */}` — a
refused model switch runs the turn on the session default while OWLA reports the chosen model.
Proposed: remove the catch (fail the turn with the RPC error), or rethrow as
`Error('Hermes could not select the chosen model. Reconnect and retry.')`.

### U9 — LOW — Hermes rest() sleeps 100 ms instead of awaiting process exit (hermes.ts)
`src/hermes.ts:599-606`: a fixed 100 ms wait can overlap the next connect with the dying
process tree (OpenCode/Codex await a `closing` promise with SIGKILL escalation). Proposed:
track a `closing` promise in `disconnect()` as OpenCode does (`src/opencode.ts:722-735`) and
await it in `rest()`/`connect()`.

### U10 — LOW — applyFallback reads stale stored exhaustion (main.ts)
`src/main.ts:309-328` reads `this.exhaustion[primary]`/`[fallback]` without refreshing; a
fallback whose reset passed stays "exhausted" until some other path calls `recordExhaustion`.
Proposed: `this.recordExhaustion(primary);if(fallback!=='none')this.recordExhaustion(fallback);`
at the top of `applyFallback()` (after the automaticProvider early return).

### U11 — LOW — Claude kill escalation missing (claude.ts)
`src/claude.ts:381,411-413`: the 2 s stuck-process timer re-sends SIGTERM (`kill()`), never
SIGKILL; a Claude process ignoring SIGTERM lingers. Codex/OpenCode escalate to SIGKILL after
2 s. Proposed: `this.kill(child,'SIGKILL')` in the timer (parameterize `kill`).

### U12 — INFO — permanent model refusal on bare 403/404 (opencode-availability.ts)
`classifyOpencodeFailure` (`src/opencode-availability.ts:81`) maps any `403/404/permission
denied/not found` to a permanent model refusal, persisted via `SessionModelAvailability`. A
transient gateway 404 would mark a model unavailable until the user resets the memory. Existing
tests codify the current behavior and real OpenCode refusals name the model, so this was left
as-is; a future narrowing could require model context for bare status codes.

## Verification

- `npm run check` ✓ (after last edit)
- `npm run lint` ✓ (after last edit)
- `npm run guard:test` ✓
- Owned scope: 163/163 ✓ — usage, core, opencode, opencode-availability, opencode-go-recognition,
  opencode-bridge, claude, codex, model-unavailability + the two new audit files (14 new tests).
- Full `npm test` after last edit: 456 tests, 451 pass, 5 fail — all five in sibling-owned files
  being edited concurrently, none importing the changed behavior:
  - `tests/cli.test.ts` "runCli abort kills the child…" (src/cli.ts modified by sibling)
  - `tests/hermes.test.ts` 3 failures (.env filter ×2, instruction files) (src/hermes.ts modified by sibling)
  - `tests/audit-failure-codex.test.ts` "malformed protocol output…" — passes 5/5 in isolation;
    load/timing flake in the full parallel run (sibling's new file).
- Scratch probe (node --import tsx, deleted after): P1/P2/P10 evidence quoted above.
- NOT verified live: no model turns, no daemon contact, no Obsidian runtime. The fake-server
  lifecycle tests exercise the real bridge code against a local HTTP stand-in, not the installed
  OpenCode CLI; accept/decline inside Obsidian remains untested here.

## Open questions / coordination

1. **Migration semantics flipped mid-task.** `tests/codex.test.ts:4` was rewritten by the codex
   sibling to expect the legacy top-level model KEPT, then reverted to expect it DROPPED. The
   final tree state (drop, matching the test name "migration removes inference configuration")
   is what `src/core.ts` now implements. If the sibling flips again, the one-line change is
   `legacyModel=string('model')` vs `modern?string('model'):''` in `migrateSettings`.
2. **U1 wiring** needs the codex/main sibling to apply the proposed patches; until then the
   `error` parameter of `codexExhaustion` is unused by callers (deliberate, backward compatible).
3. **OpenCode version gate** pins major 2 (`supportedOpencodeVersion`, src/opencode.ts:91-96);
   OpenCode 3.x will be refused. Intentional per the tested-protocol comment — confirm before
   the 3.7.0 release notes claim broader support.
4. **`decodeClaudeUsage` treats any `locked_reason` as rejected (100%)** (src/usage.ts:106).
   Could not verify against a live Claude `get_usage` response (no daemon contact allowed);
   if `locked_reason` can appear below 100% utilization, this overstates scarcity.
5. Sibling WIP failures listed above should be re-checked by their owners before the RC gate;
   they are unrelated to this audit's changes.
