# Auto-mode efficiency & model routing audit — 3.7.0 RC

- Branch: `3.7.0-RC` · Working tree shared with concurrent agents (their `needsImage` additions in `src/auto-route.ts`/`src/routing.ts` and their codex/hermes work were preserved untouched).
- Baseline at start: `npm run check` ✓, `npm run lint` ✓, 345/345 tests ✓ (task quoted 342; siblings had already added 3).
- Method: source audit of the owned routing modules + deterministic scratch probes (`node --import tsx`, fixtures only, no live model turns, no daemon contact, no vault mutations; probes deleted afterwards). Every fix has a regression test; the pre-fix behavior was demonstrated by probe before fixing.
- Owned files edited: `src/auto-route.ts`, `src/routing.ts`, `src/model-profiles.ts`, `src/routing-history.ts`, `tests/auto-route.test.ts`, `tests/routing-eval.test.ts`, new `tests/audit-auto-mode.test.ts`, new `tests/audit-auto-routing-history.test.ts`.
- **No public settings contract changed.** `routing-history.json` (private vault storage) gains an optional additive `lastUsedAt` field; old files load unchanged.

## Findings fixed in this pass

### F1 — HIGH — Routing history silently stops persisting past 1 MB, then wipes on reload
`src/routing-history.ts` (old lines 23–30, 62–64). Model keys are never pruned; catalog churn (pinned OpenCode/Hermes ids come and go) grows the file unboundedly. Once `JSON.stringify(history) > 1_000_000`, `saveRoutingHistory` returned without writing (silent), and `loadRoutingHistory` returned `{}` for any file over the limit — total loss of personalization/latency evidence, permanently.
**Evidence (probe):** 800 models × 10 kinds × 20 latency samples = 1,211,904 bytes → `saveRoutingHistory wrote file? false`; oversized file on disk → `loadRoutingHistory returns providers: 0`.
**Fix:** `pruneRoutingHistory()` (src/routing-history.ts:46) drops least-recently-used models (deterministic ties: sample count, then key) until the serialization fits; `saveRoutingHistory` prunes instead of skipping; `loadRoutingHistory` salvages legacy oversized files (read cap raised to 16 MB, then prune) instead of discarding; `recordRoutingOutcome` stamps `lastUsedAt` (optional `now` param for tests); model keys capped at 256 chars on load.
**Tests:** `tests/audit-auto-routing-history.test.ts` (5 tests: prune-and-save, legacy salvage, LRU order + ties, `lastUsedAt` stamping/legacy load, key bounds).

### F2 — MEDIUM — Route cache ignores routing history; serves decisions stale evidence can flip
`src/auto-route.ts` `computeCacheKey` (old line 831). Personalization (±0.4) and latency (≤0.5) score entries, but the cache key omitted `history`, so within the 5-minute TTL a route scored before new outcomes was served after them.
**Evidence (probe):** close matchup haiku vs luna (margin 0.1): without history → `claude:haiku`; after 10 recorded haiku failures → direct `pickRoute` chooses `gpt-6-luna`, but the cache kept returning `haiku` (`fmCalls: 1`, stale: true).
**Fix:** `historyFingerprint()` (src/auto-route.ts:887) — model count + total outcomes — added to the cache key; every recorded outcome changes it.
**Test:** `tests/audit-auto-mode.test.ts` "a cached route is invalidated when new routing history changes the scoring" (asserts the flip and 2 FM calls).

### F3 — MEDIUM — Context estimate misses ~5–6k tokens of fixed turn overhead, replayed images, and PDF size
`src/routing.ts` `estimateContextTokens` (old line 320). The estimate counted only user content. Measured from `src/main.ts`: instructions ≈1,667 tokens (lines 2220–2227), 19 tool schemas ≈3,218 tokens, conditional references (ocr+pdf+formatting) ≈1,183 tokens. Replayed images (`previousImages`, up to 2) were uncounted; every PDF was a flat 8,000 chars regardless of a 1 MB+ file. Small-window models passed the `context >= estimate*1.15` filter and then overflowed on the real prompt; whole-PDF tasks were badly under-estimated.
**Fix:** `ROUTING_CONTEXT_OVERHEAD_TOKENS = 3_000` (src/routing.ts:330) added to every estimate (deliberately partial — the 1.15× headroom covers the remainder, so large-window models are not excluded needlessly); `previousImages` counted at 1,000 tokens each; `buildRoutingContext` weights PDFs by `sizeBucket` (small 4k / medium 8k / large 24k chars) via new `attachedPdfChars` input.
**Tests:** `tests/audit-auto-mode.test.ts` "the context estimate carries the fixed turn overhead, replayed images and size-weighted PDFs" (exact values).
**Note:** this makes window filtering stricter and more accurate; the cross-provider overflow path it exposes is F6/P1.

### F4 — MEDIUM — Classifier inventory can exceed its token budget; FM call can exceed the 4k hardware window
`src/routing.ts` `summarizeRoutingContext` (old lines 437–448) and budgets in `classifyInstructions` / `routeWithFoundationModels`.
(a) The trim loop only shrank the three preview fields; with a small budget (long request → 500-token floor) the base inventory alone overshot. **Evidence:** 12 named PDF attachments, budget 500 → 716 tokens.
(b) Budgets subtracted only the prompt, not the instructions/catalog themselves. **Evidence:** 12k-char prompt → instructions 1,897 + prompt 3,429 = 5,326 tokens vs the documented 4k–8k on-device window; mid-size prompts (~1,500 tokens) could reach ~4.1k.
**Fix:** (a) deterministic base trim after the preview loop (src/routing.ts:468): names → topics → attachment items (totals/counts kept, `omittedItems` updated) → features; applies in privacy mode too. (b) Both instruction builders now subtract their own serialized size from the inventory budget (src/auto-route.ts:272, src/routing.ts:716), keeping the 500 floor.
**Tests:** "a tiny inventory budget is enforced even without previews to trim" (500 enforced, totals survive, privacy variant, default 3000 still holds); "FM instructions budget their own overhead…" and "single-provider FM selection budgets the catalog and instructions too" (request+instructions ≤3,100 tokens for a 1,500-token prompt; both would fail pre-fix).

### F5 — MEDIUM — Long requests fail even when the local classifier can settle them (always on Windows/Linux)
`src/auto-route.ts` `routeAcrossProviders` (old line 877): the 12,000-char guard threw before the heuristic and before the no-CLI fallback.
**Evidence (probe):** 14,027-char "Fix the typo in this note. …" with FM CLI unavailable → throws "The request is too long for automatic selection." although `heuristicTaskClass` returns `edit`.
**Fix:** length guard moved to the FM branch only (src/auto-route.ts:996); heuristic and no-CLI fallback paths handle any length. Long nuanced requests still throw the same error (main.ts fallback unchanged).
**Test:** "long clear-cut requests route locally; only the on-device path keeps the length guard" (no-CLI route, zero FM calls with CLI present, guard still fires for unclassifiable long prompts).

### F6 — MEDIUM (UX dead end) — Cross-provider context overflow fails with a misleading error
`src/main.ts:2291–2292` (unowned) repeats the identical `autoEntries` call when the first returns empty, then every owned fallback throws the generic "No connected provider has a compatible model." although the real cause is the context estimate. The single-provider path has a relaxation (main.ts:2337–2338); the cross-provider path does not.
**Evidence (probe):** 300k estimate vs 200k windows → `entries: 0`, `routeAcrossProviders` and `autoFallbackRoute` both throw the generic error.
**Fix (owned part):** `routeAcrossProviders` empty-entries error now names the estimate (src/auto-route.ts:954); `autoFallbackRoute` accepts optional `estimatedTokens` and gives an actionable message (src/auto-route.ts:783, 795). **Proposed main.ts patch: P1 below.**
**Tests:** "context overflow reports the estimate instead of a generic no-model error"; eval case asserts `autoEntries(evalOffers,false,300_000).length===0`.

### F7 — LOW/MEDIUM — Unbounded route cache
`src/auto-route.ts` (old line 825): TTL was only checked when the same key was requested again; expired entries were never swept and nothing capped the map.
**Fix:** `rememberRoute()` (src/auto-route.ts:867) sweeps expired entries on every write and evicts the oldest beyond 64 entries; `routingCacheSizeForTests()` export.
**Test:** "the route cache stays bounded and sweeps expired entries" (70 distinct prompts → ≤64; one write past TTL → size 1).

### F8 — LOW — A just-reset plan is penalised as unknown usage
`src/auto-route.ts` `remainingUsage` (old line 220): windows with `resetsAt <= now` were filtered out; an expired 100% window made the whole snapshot "unknown" → scarcity 1.3 on a plan that is full again (inconsistent with `claudeExhaustion`, which treats passed resets as usable).
**Fix:** expired windows map to `remaining: 100` (src/auto-route.ts:220); an expired window never masks a tighter open one.
**Intentional owned-test update:** `tests/auto-route.test.ts` "remaining plan usage…" previously asserted `null` for the expired window; now asserts 100 plus the mixed-window case (documented in the test).
**Test:** "a plan whose window just reset is preferred over an unknown plan" (routing flips toward the reset plan; pre-fix it lost).

### F9 — LOW — Hermes model ids dedupe incompletely
`src/model-profiles.ts` `currentModels` dedupe (old line 150): `nous:anthropic/claude-sonnet-5` and `nous:claude-sonnet-5` produced different keys, offering the same model twice.
**Evidence (probe):** `currentModels('hermes',[both])` kept both.
**Fix:** strip the `provider:` prefix before deriving the dedupe key (src/model-profiles.ts:152). OpenCode behavior unchanged.
**Test:** "Hermes colon-prefixed ids dedupe with their bare forms; OpenCode dedupe is unchanged" (also pins cheaper-source-wins for OpenCode).

### F10 — MEDIUM gap — Single-provider auto selection ignores plan usage
`quickPerProviderRoute` / `heuristicPerProviderRoute` built offers with `usage:null`, so scarcity and the <15% eligibility rule never applied within one provider (cross-provider mode does weigh them). Call sites are in unowned `src/main.ts`.
**Fix (owned part):** both functions accept optional `usage` (src/auto-route.ts:746, 767), backward compatible. **Wiring proposed: P2 below.**
**Test:** "single-provider routes weigh the plan meters when the caller passes them" (OpenCode Go paid vs console-paid twin: full Go → Go model; drained Go (<15%) → console model; without usage the old behavior stands).

## Context passed: auto vs manual (audit question)

The turn payload is identical in both modes: `history + 'REQUEST: ' + prompt + '\n\n' + context` (main.ts:2380) with the same images/tools. Differences are only in what the *classifier* sees, and they are deliberate: summarized inventory (counts, size buckets, outline ≤400 chars, previews only in thorough mode, topics ≤8), never raw selection text. Gaps found and addressed: the classifier call itself could exceed the on-device window (F4), the token estimate used for window filtering under-counted the real payload (F3), and retry routing drops the context entirely (P3). `replayHistory` (src/codex.ts:18, read-only) enforces 12 messages / 64,000 chars newest-first; `estimateContextTokens` caps chat at the same 64k and the active note at the same 20k main.ts sends — bounds are consistent. Selection text is the one uncapped input (by design; overflow handling is P1/F6).

## Proposed patches — unowned files (not applied)

**P1 — main.ts:2291–2292: relax the window filter on overflow (mirror the single-provider path) and pass the estimate to the fallback error.**
```ts
// replace the duplicated identical call:
let entries=autoEntries(offers,needsImg,routingContext.estimatedTokens);
if(!entries.length){
 entries=autoEntries(offers,needsImg); // relax context filter, keep image/effort compatibility
 if(entries.length)activity.createDiv({text:'No model window fits the estimated context; trying the largest offered windows.',cls:'owla-activity'});
}
// main.ts:2312 and the pickRetryRoute fallback (~2647):
choice=autoFallbackRoute(offers,entries,[home,...PROVIDER_IDS.filter(id=>id!==home)],routingContext.estimatedTokens);
```
**P2 — main.ts:2342, 2353: wire plan usage into single-provider auto routes.**
```ts
const quick=quickPerProviderRoute(prompt,candidates,provider,routingContext,this.butler.routingHistory,bridge.usage);
const heur=heuristicPerProviderRoute(prompt,candidates,provider,routingContext,this.butler.routingHistory,bridge.usage);
```
(Consider refreshing stale usage first, as `automaticOffers` does for Codex.)
**P3 — main.ts:2641 (+ opts type ~2624 and both call sites ~2419/~2470): retries lose continuity and large-note penalties because `pickRetryRoute` passes `undefined` as context.**
```ts
// opts: add context?:RoutingContext; call sites: add context:routingContext
if(task)return pickRoute(entries,offers,task,home,Date.now()/1000,opts.context,this.butler.prefs.routingMode,this.butler.routingHistory);
```

## Verification

- `npm run check` ✓ · `npm run lint` ✓ (after last source edit).
- Targeted owned tests: **77/77 pass** (`tests/audit-auto-mode.test.ts`, `tests/audit-auto-routing-history.test.ts`, `tests/routing-eval.test.ts`, `tests/auto-route.test.ts`, `tests/routing.test.ts`, `tests/model-unavailability.test.ts`), including the 30-prompt eval suite (FM kind ≥95%, heuristic ≥85% thresholds unchanged) and the siblings' new `needsImage` tests.
- Full `npm test` after last edit: **459/459 pass** (final run). An intermediate run showed 451/456 with 5 failures, all in sibling-owned, concurrently-edited files and unrelated to this work; the siblings brought them green before the final run. For the record, the intermediate failures were:
  - `tests/audit-failure-codex.test.ts` "malformed protocol output disconnects with a quoted snippet" (new untracked sibling file) and `tests/codex.test.ts` "disconnect during connection discovery cannot start a background agent" — both hit the sibling's in-flight `src/codex.ts` launch/protocol refactor (`git diff src/codex.ts` showed the exact `generation`/`protocolFailure` lines being rewritten; error surfaced: "Codex connection cancelled."). `src/codex.ts` imports nothing from the owned modules.
  - `tests/hermes.test.ts` ".env is a filtered copy…", ".env filter also drops execution-hijack…", "refuses instruction files…" — tested the sibling's rewritten `hermesFilteredEnv`/`hermesInheritedInstructions` (`git diff src/hermes.ts`: +220 lines). The hermes tests that do use owned functions (`canonicalModelKey`, `sameModelRoute`) passed throughout.
- Post-fix probe re-run: all 7 demonstrated bugs now behave correctly (overflow message names estimate; budget 500 → 479 tokens; oversized history saved ≤1 MB and salvaged on load; long edit routes locally; cache flips with history). Probes deleted.
- **Not verified live:** no FM classification, provider turn, or Obsidian in-app flow was run (quota/daemon constraints). On-device window behavior (F4) is verified by token arithmetic against the documented 4k–8k window, not by a live `fm` call.

## Open questions

1. Overhead constant: 3,000 tokens is deliberately below the measured ~4.9k (instructions+specs) so the 1.15× headroom covers the rest without excluding models that actually fit. Confirm against live small-window free models (32k–128k) that filtering is now right-sized, not over-strict.
2. FM floor: with a 12k-char prompt the call still totals ~5k tokens (prompt alone is 3.4k). Should OWLA send a bounded prompt excerpt to the classifier instead of relying on the heuristic fallback? Needs an eval run.
3. `remainingUsage` expired→100 assumes provider resets are trustworthy at `resetsAt` (matches `claudeExhaustion`). Confirm Codex weekly-window semantics live.
4. Canvas/Excalidraw visual turns (`needsImage`, sibling feature): rendered-image reads during the turn are not in the estimate; only attached images are. Worth counting when visual features are on?
5. `routing-history.json` now persists `lastUsedAt`; the clear-history command and settings reset already wipe it — no migration needed. OK to keep LRU (vs sample-count) pruning as the policy?

## Further auto-mode improvements (too large for this pass, prioritized)

1. **Graceful context overflow instead of a dead end** — when the estimate exceeds every window, trim selection text / chat replay to the best window with an explicit notice (selections are currently uncapped in the turn payload). Needs UX decision + main.ts/note-tools work; pairs with P1.
2. **Real context windows for Hermes** — `src/hermes.ts` leaves `context` undefined (assumed 200k); the models.dev catalog it already reads carries context lengths. Wire them so window filtering is accurate for Hermes (coordinate with the sibling owning hermes.ts).
3. **Calibrated token estimation** — validate the 3.5 chars/token divisor and the 3,000 overhead against measured real turns per provider; optionally use `fm count-tokens` for the classifier prompt (already implemented for FM inputs) instead of the estimate.
4. **History decay** — success/fail counters are lifetime; a provider-side model update never fades old evidence. Add time-decay or a sliding window (format change + eval re-run).
5. **Kind-normalized latency penalty** — `latencyPenalty` compares raw p50 across kinds; reasoning turns are inherently slower than lookups, so slow-but-appropriate models are penalised. Normalize per kind before penalising.
6. **Cross-source dedupe by canonical model** — `github-copilot/claude-sonnet-5` and `openrouter/anthropic/claude-sonnet-5` both occupy shortlist slots today; dedupe on `canonicalModelKey` while keeping source diversity rules.
7. **Cache-hit explainability** — cached routes skip `recordRoutingDecision`, so the B11 routing-details log undercounts turns; store the decision record in the cache entry.
8. **Selection-content signal for the classifier** — a bounded, privacy-gated selection excerpt would let FM classify "fix the typo in the selected paragraph" by content, not counts alone; measure against the eval suite first.
9. **Effort cost-awareness** — effort is set purely by classification; on drained paid plans a lower default effort would stretch the plan further. Quality trade-off needs eval fixtures before changing.
10. **Per-turn paid-attempt budget** — retries/escalation can chain up to 4 paid attempts (MAX_AUTO_RETRIES) plus an escalation; a user-visible cost ceiling option would make auto mode predictable for budget-conscious users (settings contract change — flag first).