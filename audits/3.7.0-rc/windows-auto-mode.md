# Windows hardening pass (round 2) — auto mode, model efficiency & context limits

- Agent: `win-auto` · Branch `3.7.0-RC` · Base `81540fb` · Host: Windows 11, git-bash, Node v24.14.0.
- Owned src: `src/auto-route.ts`, `src/routing.ts`, `src/model-profiles.ts`, `src/routing-history.ts`.
- Owned tests: the six round-1 files + new `tests/audit-win-auto.test.ts` (15 tests).
- Read from round 1: `auto-mode-efficiency.md` (F1–F10, proposals P1–P3, improvements 1–3),
  `REVIEW-rc-hardening-pass.md` §4.7 (P1/P2/P3 landed in main.ts) and §5 items 4, 5, 8
  (deferred: graceful overflow trimming, real Hermes context windows, `countFoundationModelTokens`).
- Method: source audit of the owned modules + read-only review of `main.ts`/`hermes.ts`/`core.ts`
  call sites; deterministic scratch probes under `…/scratch/win-auto/` (fixtures only, one held
  file handle to simulate an indexer lock, one read-only fetch of the public models.dev API to
  confirm the catalogue schema). No live model turns, no daemon contact, no vault mutations,
  no builds, read-only git. Every fix has a regression test; pre-fix behaviour was probed first.

## 1. Findings & fixes applied (7)

### W1 — HIGH (general, bites hardest on Windows) — routing-history prune was quadratic: 35 s of blocked UI
`src/routing-history.ts` `pruneRoutingHistory` (round-1 F1). Two quadratic terms:
`JSON.stringify(next)` per deletion, and `{...providerMap}` spread per deletion.
**Evidence (probe):** 800 models × 10 kinds × 20 samples (1.41 MB) → 1,812 ms;
3,000 models (5.30 MB) → **34,973 ms**. `loadRoutingHistory` salvages up to 16 MB at plugin
onload, so a churned OneDrive-synced vault could block Obsidian's main thread for minutes.
**Fix:** per-entry serialized cost measured once (`stringify(kinds)+stringify(model)+2`,
conservative: ignores the provider shell freed with its last model), one working copy per
provider with O(1) deletes tracked by per-provider counts, exact final measurement as a
safety net. LRU order and tie-breaks unchanged.
**Post-fix probe:** same 5.30 MB fixture → **62 ms** (≈564×), 998,369 bytes, newest kept,
oldest dropped, deterministic; emoji/CRLF keys land byte-exact under a 20 KB limit.
**Tests:** `pruning a multi-megabyte history is linear, LRU-ordered and byte-exact`
(<5 s bound fails the old behaviour even under parallel load); all 5 round-1 history tests unchanged.

### W2 — MEDIUM (Windows-specific) — locked history file dropped the turn's outcome; long temp path
`src/routing-history.ts` `saveRoutingHistory`. **Evidence (probe):** with an open handle on
`routing-history.json` (indexer/OneDrive/Defender simulation), `renameSync` fails **EPERM** on
Windows and immediate retries do not help; a direct `writeFileSync` to the target **succeeds**
under both `r` and `r+` handles. The old code let the rename error escape, so the outcome was
not persisted (main.ts swallows it; next turn retries, but a one-shot vault loses it).
**Fix:** on rename failure, fall back to a direct write (history is non-critical personalization
data; a crash mid-write only risks what `loadRoutingHistory` already tolerates — a damaged file
loads empty). Temp suffix shortened from `.`+UUID(36)+`.tmp` (41 chars) to `.tmp-`+8 hex
(13 chars) for MAX_PATH headroom on deep OneDrive paths; temp unlink guarded (EBUSY on a
just-written temp file must not mask the save or throw). POSIX keeps the atomic rename path.
**Test:** `a locked history file still persists on Windows and leaves no temp files`
(held handle → save → load round-trip; no `.tmp` leftovers; second save exercises the atomic path).

### W3 — MEDIUM (Windows-specific, privacy) — Windows paths leaked whole into the classifier inventory
`src/routing.ts` `sanitizeBasename` split only on `/`. **Evidence (probe):**
`C:\Users\filip\OneDrive\Documents\My Vault\Attachments\scan.pdf` entered the FM inventory as
`items[0].name` and `names[0]` verbatim (72-char slice) — username, OneDrive layout and folder
structure ride to the classifier although the field is meant to be a basename; POSIX paths
reduced correctly. **Fix:** split `\` and `/` only for genuinely Windows-shaped names
(`/^[A-Za-z]:[\\/]|^\\\\/` — drive or UNC); a POSIX file whose name contains a literal
backslash keeps its full name on macOS (hard rule 1). Control-char strip and 72-char cap unchanged.
**Tests:** `Windows drive and UNC attachment names reduce to basenames; POSIX names are unchanged`
(drive/UNC/mixed-slash → basename, `a\b.md` untouched, no `filip|OneDrive` in the serialized
inventory, privacy mode still name-free, cap + control chars).

### W4 — MEDIUM (round-1 deferred §5.4, owned part) — graceful context-overflow trimming
Selections are the one uncapped turn-payload input: each is clipped to 3,000 chars at capture
(main.ts:483/496) but their **count** is unbounded. **Evidence (probe):** 40 selections →
120,000 chars → **37,293-token estimate**; with only small-window models offered, round-1's
relaxation (main.ts:2344–2350) picks the largest window and the real prompt then overflows it.
**Fix (owned):** `trimSelectionsToWindow(selections, estimatedTokens, windowTokens)` +
`bestContextWindow(models)` in `src/routing.ts`. Conservative, deterministic, platform-neutral:
target = `floor(window/1.15)` (matches `routingModels`); shorten the **largest** selections first,
each keeping its path, ≥300 chars (`SELECTION_TRIM_MIN_KEEP_CHARS`) and the standard `clip()`
marker ("Context shortened. Read a specific passage if needed."); drop selections (largest first)
only when shortening cannot recover enough room; original order preserved. The returned estimate
subtracts `floor(cutChars/3.5)` — provably never below the recomputed payload estimate
(`ceil(C/3.5)−ceil((C−R)/3.5) ≥ floor(R/3.5)`) and ≤ target once the excess is covered, so the
relaxed filter cannot be fooled. Returns a **user-visible notice string** naming the window,
counts and `read_note`. When selections cannot cover the excess the estimate stays honest and the
estimate-aware overflow error (round-1 F6) remains the backstop. **main.ts wiring is proposal P1.**
**Tests (6):** identity when fitting/invalid window/no selections; 40×3000 → 13 shortened,
estimate lands exactly at 27,826 = floor(32000/1.15), marker/order/paths; partial excess touches
only the largest; drop-largest-first + tiny-selection removal + honest residual estimate;
conservative-estimate property across CRLF/umlaut fixtures and three windows.

### W5 — LOW/MEDIUM (Windows-relevant efficiency) — CRLF split the route cache
`src/auto-route.ts` `computeCacheKey`. Windows pastes/notes carry CRLF (or lone CR); the same
request with different line endings hashed to different keys, duplicating cache entries and
re-running classification. **Fix:** `normalizeLineEndings()` recursively normalizes `\r\n`/`\r`
→ `\n` in the payload **before** `JSON.stringify` (JSON escapes control chars, so a post-hoc
replace on the serialized string would miss them — first attempt probed failing, then corrected).
LF-only payloads (macOS/Linux) serialize byte-identically to before.
**Test:** `CRLF and lone-CR prompts share one cache entry with their LF twin` (thorough FM path:
3 line-ending variants → 1 FM call, cache size 1; a distinct request still gets its own entry).

### W6 — LOW (Windows clarity) — FM-unavailable reporting is platform-aware; gate is parameterized
`src/routing.ts`. Verified: on win32 `hasFoundationModelsCLI()` is false, `prewarmFoundationModels`
is a no-op, `routeAcrossProviders` settles via heuristic/fallback, `routeWithFoundationModels`
throws "Apple Foundation Models CLI is unavailable." — **zero fm spawns on every path** (probe +
tests with a throwing ask-spy). Auto mode itself is intentionally macOS-only at the product level
(`disableAutomaticSelectionOutsideMac`, core.ts:118; per-OS settings, core.ts:126) — see §4.
**Fix:** `hasFoundationModelsCLI(platform=process.platform)` and
`checkFoundationModelsHealth(signal?,platform=process.platform)` are now platform-parameterized
(cross-host assertions per the brief); the unavailable message on non-darwin reads
"Apple Foundation Models requires macOS. On this platform automatic selection uses local heuristics."
The macOS wording is byte-identical. Override precedence unchanged.
**Tests:** `FM stays macOS-only…` (win32/linux gate false on any host; real-host check on win32)
and `with the CLI unavailable the routing paths never call fm and report cleanly`
(prewarm no-op, heuristic route, FM-path refusal, both health messages, fmCalls=0 throughout).

### W7 — cleanup decision (round-1 §5.8) — `countFoundationModelTokens` REMOVED
Zero callers in src and tests (re-verified by grep; also flagged dead in `performance.md`).
**Decision: remove, not wire.** Wiring it as the classifier's calibration input would change
macOS FM budget arithmetic, which this pass cannot verify live (no FM calls allowed/possible on
this host) — against the spirit of hard rule 1. The planned calibration work (round-1 open
question 3) should reintroduce it **together with its caller and tests**; git history preserves
the implementation. A comment at the removal site records the decision. macOS fm routing
(`askFoundationModels`, `routeWithFoundationModels`, warmth, license handling) is untouched.
**Test:** `the dead fm count-tokens helper stays removed until calibration wires it with tests`
(export-absence pin; update it when calibration legitimately reintroduces the helper).

## 2. Verified round-1 items (no re-work needed)

- **Estimate arithmetic (F3):** +3,000 overhead, 1,000/replayed image, PDF size buckets
  (4k/8k/24k), 20k active-note and 64k chat caps — exact-value tests still green.
  **CRLF angle (probe):** a 400-line CRLF note inflates the estimate by +114 tokens on 18,688
  chars (~0.6%, one char per line) — always **conservative** (never optimistic), bounded by
  `ceil(lines/3.5)`; pinned by `CRLF note text inflates the estimate only conservatively…`.
  Path lengths: inventory names are capped at 72 chars (W3); temp-file path shortened (W2).
- **Classifier inventory budget (F4):** base-trim + instruction/catalog overhead tests green.
- **Estimate-aware overflow errors (F6):** `routeAcrossProviders`/`autoFallbackRoute` messages
  name the estimate; tests green. Trim (W4) now prevents most of these dead ends.
- **Route cache 64/TTL + history fingerprint (F2/F7):** bounded/sweep/invalidation tests green;
  W5 adds CRLF hit-rate on top.
- **Focus 5 — missing context in auto decisions (round-1 P1/P2/P3, landed §4.7), verified in main.ts:**
  context-filter relaxation + activity notice (2344–2350); `estimatedTokens` passed to
  `autoFallbackRoute` (2370, 2700); `bridge.usage` wired into `quickPerProviderRoute` /
  `heuristicPerProviderRoute` (2400, 2411); `pickRetryRoute` threads `context:routingContext`
  (2477, 2528 → 2699 `pickRoute(...,opts.context,...)`) so retries keep continuity and
  large-note penalties; retry/escalation `needsImage` includes `visual.needsImage` (2465, 2528).
  Just-reset plan → `remaining:100` (auto-route.ts:220) with its round-1 test green.
- **Hermes dedupe (F9)** and single-provider usage tests green; `model-profiles.ts` needed no
  change this pass — the catalogue-window **consumption** contract is pinned by the new test
  `real catalogue context windows drive eligibility; unknown windows keep the safe fallback`
  (8k window excluded at 10k estimate, included at 5k; undefined keeps the 200k assumption).

## 3. Cross-file proposals (2 — orchestrator applies serially)

### P1 — `src/main.ts`: wire graceful trimming into both auto branches (pairs with the landed relaxation)
Owned functions `trimSelectionsToWindow` / `bestContextWindow` are ready and tested.
**(a) import line 14** — add to the existing `./routing` import list:
`trimSelectionsToWindow,bestContextWindow,`
**(b) new private helper on `ButlerView`** (place near `pickRetryRoute`, ~line 2682):
```ts
 private trimSelectionsForWindow(selected:{path:string;text:string}[],routingContext:RoutingContext,models:{context?:number}[],context:string,activity:HTMLElement):string{
  const trim=trimSelectionsToWindow(selected,routingContext.estimatedTokens??0,bestContextWindow(models));
  if(!trim.notice)return context;
  // The selection section was appended verbatim at ~2266; replace it as one block.
  const oldSection=selected.map(item=>'\nSELECTED TEXT from '+item.path+'\n'+item.text).join('');
  selected.splice(0,selected.length,...trim.selections);
  const newSection=trim.selections.map(item=>'\nSELECTED TEXT from '+item.path+'\n'+item.text).join('');
  routingContext.selectedChars=trim.selections.reduce((sum,item)=>sum+item.text.length,0);
  routingContext.selections=trim.selections.length;
  routingContext.estimatedTokens=trim.e...ens;
  activity.createDiv({text:trim.notice,cls:'owla-activity'});
  new Notice(trim.notice);
  return oldSection?context.replace(oldSection,newSection):context;
 }
```
**(c) cross-provider branch** — insert immediately after the relaxation block (after line 2350,
before `const home=this.butler.prefs.provider;`):
```ts
  context=this.trimSelectionsForWindow(selected,routingContext,entries.map(entry=>entry.model),context,activity);
```
**(d) single-provider automatic branch** — insert after the candidates relaxation (after line
2395, before `autoCandidates=candidates;`):
```ts
  context=this.trimSelectionsForWindow(selected,routingContext,candidates,context,activity);
```
Rationale: trims only when the estimate exceeds the best offered window; the turn payload
(`history+'REQUEST: '+prompt+'\n\n'+context`, line 2438), the retry/escalation filters
(`routingContext.estimatedTokens` read at call time) and the classifier all see the trimmed
values. The user-message chips (`sentCards`, 2245) intentionally still show the original
attachments; the Notice + activity line explain the trim. `context` is `let` (2262) ✓.
Notes: `attachedContext` (captured 2275, pre-trim) rides into chat history untrimmed — bounded
by the 64k replay cap and conservative for future estimates; acceptable, optional follow-up in §4.
Test impact: none existing (no test drives `send()` end-to-end); the pure function is covered by
6 tests in `tests/audit-win-auto.test.ts`. Verify in a test vault: attach ~40 long selections
with only a small-window provider connected → expect the trim notice and a successful turn.

### P2 — `src/hermes.ts`: real context windows from the models.dev catalogue (round-1 deferred §5.5)
Schema confirmed against the live public API (`https://models.dev/api.json`): entries carry
`limit.context` as a number (e.g. `claude-haiku-4-5` → 200000, `gpt-5-nano` → 400000).
`loadModelsDevCatalog` (hermes.ts:213) already mirrors/caches the file per private home.
**(a) new accessor after `hermesModelModalities` (~line 252):**
```ts
/**
 * Real context window from the models.dev catalog (limit.context), the same
 * capability source Hermes itself uses. undefined when absent or unknown;
 * routing then keeps its safe 200k assumption. Namespaced ids
 * (`nous:anthropic/claude-sonnet-5`) also try the bare catalogue key.
 */
export function hermesModelContextWindow(providerID:string,modelID:string,home:string):number|undefined{
 const catalog=loadModelsDevCatalog(home);
 if(!catalog)return undefined;
 const bare=modelID.split('/').pop()??modelID;
 const providers=[providerID,...Object.keys(catalog).filter(key=>key!==providerID)];
 for(const provider of providers){
  const models=record(record(catalog[provider]).models);
  const entry=models[modelID]??models[bare];
  if(entry!==undefined){
   const context=record(record(entry).limit).context;
   return typeof context==='number'&&Number.isFinite(context)&&context>0?Math.floor(context):undefined;
  }
 }
 return undefined;
}
```
**(b) model builder (~line 715)** — add one field to the `models.push({...})` object:
```ts
    inputModalities:hermesModelModalities(providerID,modelID,home),
    context:hermesModelContextWindow(providerID,modelID,home),
```
Consumption needs no owned change: `routingModels`/`currentModels` already filter on
`model.context??200_000` (pinned by the new test above). Malformed catalogue values fail closed
(non-number/≤0 → undefined → 200k assumption; a genuinely tiny window excludes the model, which
is correct). Coordinate with the hermes owner; suggested fixture test in `tests/hermes.test.ts`:
catalogue with `limit.context:8192` → `models[].context===8192`; absent catalogue → undefined.

## 4. Deferred items (risk tier + design)

1. **P1/P2 application** (LOW once applied): orchestrator serial work; both are additive and
   covered by owned tests on the consumption side.
2. **Auto mode on Windows as a product decision** (MEDIUM — UX/product, not a bug): the engine
   is fully Windows-ready (heuristic classifier, fallback, degradation notice — all tested), but
   `disableAutomaticSelectionOutsideMac` (core.ts:118) and the `supportsAutomaticSelection()`
   gates in main.ts (79, 85, 2903, 3088, 3139, 3151, 3158, 3165) intentionally keep Automatic
   macOS-only; synced settings are disabled per-OS. If the user wants heuristic auto on Windows:
   gate the *FM-specific* UI (thorough/privacy/health) on `supportsAutomaticSelection()` but allow
   the provider dropdown + `automaticRouting` everywhere, relabel ("Automatic (local heuristics)"
   on non-darwin), keep `prewarmFoundationModels` gated as today, and run the 30-prompt eval suite
   in heuristic-only mode before shipping. Do NOT change this silently — it alters the settings
   contract and the feature's branding.
3. **Live FM calibration of token budgets** (MEDIUM, macOS-only): reintroduce
   `countFoundationModelTokens` with its caller (e.g. `routeWithFoundationModels` prompt budget)
   plus live measurement; removed here per W7.
4. **Trim before history capture** (LOW): move P1's trim ahead of `attachedContext` capture
   (main.ts:2275) so replayed context is trimmed too; needs care because the estimate is built
   later (2298). Current behaviour is conservative and bounded (64k replay cap).
5. **`remainingUsage` reset semantics** (LOW, carried from round-1 open question 3): confirm
   Codex weekly-window resets live; expired→100 matches `claudeExhaustion`.

## 5. Verification

- `npm run check`: **zero errors in owned files** (re-ran; residual at measurement time:
  `src/pdf.ts(126)` TS2454 ×2 — sibling WIP, not owned; an earlier
  `tests/audit-win-attachments-files.test.ts` error converged on re-run).
- `npm run lint`: **zero problems in owned files** (residual: `src/cli.ts:242` `no-control-regex`
  — sibling WIP, not owned).
- Targeted owned suite (7 files): **92/92 pass** — 77 round-1 tests unchanged + 15 new
  (`tests/audit-win-auto.test.ts`), including the 30-prompt eval suite with its ≥95%/≥85%
  thresholds and the siblings' `needsImage` tests.
- Full suite (mid-pass run): **663 tests, 643 pass, 20 fail** — count grew from the 479 baseline
  because siblings are landing new files concurrently. **All 20 failures attributed to sibling
  WIP, none in owned files:**
  - `tests/security-main.test.ts` (10) — hook `TransformError`:
    `src/main.ts:825:52: Unterminated regular expression` (win-main agent mid-edit; the same
    regex-escape hazard this pass hit and fixed in its own files).
  - `tests/security-vault.test.ts` (9) — same transform/WIP class against concurrently edited
    `src/core.ts`/`src/organization.ts` (owners are converting the symlink fixtures per the brief).
  - `tests/audit-win-attachments-diff.test.ts` (1, "lone CR line endings…") — new sibling file
    against mid-edit `src/editor-diff.ts`/`src/attachments.ts`.
  The baseline's pre-existing symlink failures in `codex.test.ts:440` / `hermes.test.ts:239` no
  longer fail (owners landed fixes). Final re-run result recorded below.
- Probes: all pre-fix behaviours demonstrated before fixing (W1–W5 evidence above); post-fix
  probe re-run green; probe scripts remain in `…/scratch/win-auto/` (scratch, not repo).
- **Not verified live:** no FM call, provider turn or Obsidian in-app flow (constraints).
  P1's UX and P2's catalogue read need the orchestrator's application + a test-vault pass.

### Final full-suite re-run (after last edit)
- `npm run check`: ✓ **clean, zero errors** (siblings converged; the earlier `src/pdf.ts` and
  test-file errors are gone).
- `npm run lint`: ✓ **clean, zero problems** (the earlier `src/cli.ts:242` error is gone).
- Targeted owned suite re-run: **92/92 pass**.
- Full suite: **709 tests, 703 pass, 5 fail**. All 5 residual failures are in the win-tools
  sibling's brand-new files against its in-flight src edits — none in owned files:
  `tests/audit-win-tools-crlf.test.ts` (findBlock CRLF ×2, noteHeadings CRLF offsets),
  `tests/audit-win-tools-graph.test.ts` (150-huge-value property query bound),
  `tests/audit-win-tools-organization.test.ts` (preview case-fold alias refusal).
  The mid-pass 20 failures (security-main/security-vault transform errors from the win-main
  agent's broken `main.ts:825` regex, attachments-diff lone-CR) all converged as owners landed.