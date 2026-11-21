# Developer Mode — Security / Privacy / Performance Audit (3.7.0)

- **Date:** 2026-11-21 · **Branch:** `Developer-Prerelease` · **Auditor:** read-only subagent (no repo edits except this file, no git mutations, no builds, no live model turns, no network, no vault mutations, no daemon contact).
- **Scope:** uncommitted Developer mode feature — `src/dev-types.ts`, `src/dev-journal.ts`, `src/dev-report.ts`, `src/core.ts` (toggle), `src/main.ts` (wiring/UI), `tests/helpers/load-main.ts`, `README.md`, plus the three new test files.
- **Baseline gates (reported by orchestrator, not re-run here):** check/lint 0, `npm test` 830/824 pass/0 fail/6 skipped, build 0, guard:test 0. Feature tests re-run individually for this audit: `node --import tsx --test tests/dev-journal.test.ts tests/dev-report.test.ts tests/developer-mode.test.ts` → **48 tests / 48 pass / 0 fail / 0 skipped**.
- **Method:** source read of every feature file and every call site; 6 scratch probes under `/Users/filipdobric/.hermes/cache/scratch/owla-dev/` run with `node --import tsx` (credential fixtures assembled at runtime from fragments; no literal key shapes written to disk). Probe outputs quoted below are real execution results.

## Summary verdict

**Conditionally sound — fix one High redaction gap before this feature ships.** The architecture is right: OFF is effectively zero-cost and write-free, all persistence is confined to `vaultStorage()/developer/` with 0o700/0o600 modes and atomic publish, rings/clips/byte-caps are genuinely enforced, downloads are purely local object URLs, journal content never enters prompt/context assembly, destructive UI is ConfirmModal-gated with textContent rendering, the toggle is platform-shared without disturbing other platforms' AI settings, and the tool-callback wrapper preserves error identity and queue ordering exactly.

The defects are concentrated in **redaction coverage** and **one unbounded disk path**:

1. **High (confirmed):** `provider.status` (and `version`/`plan`/`accountType`) is never redacted in the diagnostics report, and Claude/OpenCode bridges can put **raw, unredacted CLI error text** into `status`. Credentials leak into both the JSON report and the Markdown summary.
2. **Medium (confirmed):** `redactSensitive` misses standalone JWTs, AWS `AKIA…`, Google `AIza…`, `xoxe-…` and `client_secret=…` (word-boundary fails after `_`), so these shapes survive in every field that *is* redacted.
3. **Medium (confirmed):** `pruneSessions` has **no read cap** (unlike `listSessions`): a hostile sessions directory makes `saveSession` read every UUID-named file — measured 683 ms for 10 000 empty files, unbounded up to ~20 GB for 10 000 × 2 MB files.

Everything else is Low/Info. No exfiltration path, no vault writes, no traversal, no renderer-blocking primitive, no UI injection, no regression in tool error propagation was found.

## Findings table

| ID | Severity | Status | Location | Evidence (probe / source) | Suggested fix (not applied) |
|----|----------|--------|----------|---------------------------|------------------------------|
| F1 | **High** | confirmed | `src/dev-report.ts:108-113` (providers map), `:227` (markdown Status); sources: `src/claude.ts:102,236`, `src/opencode.ts:131,481,784,810`; `src/main.ts:310` | Probe `probe-redact.ts`: `providers[1].status='Claude exited: sk-liveABCD1234efgh5678 client_secret=…'` → `LEAK` in report JSON **and** markdown (`FULL_MARKDOWN_LEAKS` includes `sk- key`, `client_secret= assign`, `quoted password w/ spaces`). The providers map redacts only `usageError` + `exhaustion.reason`; `...provider` spreads `status/version/plan/accountType/executable/sessionDirectory` untouched. `friendlyClaudeError` returns `text.slice(0,800)` **without** `redactErrorDetail` (claude.ts:102) and is fed to `setStatus` on connect failure (claude.ts:236); `friendlyOpencodeError` likewise (opencode.ts:131 → disconnect → setStatus 481/784/810). Codex (`friendlyError`) and Hermes (`friendlyHermesError`) *do* redact, so the gap is provider-specific. | Redact `status` (and defensively `version/plan/accountType`) with `redactSensitive` in the providers map; and/or apply `redactErrorDetail` inside `friendlyClaudeError`/`friendlyOpencodeError` at the source (the Hermes/Codex pattern). Both layers preferred. |
| F2 | Medium | confirmed | `src/dev-report.ts:36-54` (`QUOTED_VALUE_RE`, `BEARER_LEFTOVER`, `KEY_SHAPES`, `redactSensitive`) | Probe `probe-redact.ts` `STANDALONE_LEAKS`: `["xoxe- refresh","standalone JWT","AWS access key","Google API key","client_secret= assign"]`. `client_secret=…` leaks because `\b(secret)` has no word boundary after `_`; JWT/AKIA/AIza/xoxe have no shape rule. Field probe: `turn.error` leaks a standalone JWT (Bearer part *was* redacted), `loss.data.pendingLoadError` leaks AIza/AKIA. Realism: `turn.error`/`event.detail` come from `friendlyError`, which redacts Bearer/assignments but not these standalone shapes; `exhaustion.reason` is always a fixed friendly string (`src/exhaustion.ts:47,63,87` — low realism); `pendingLoadError` is a local file-read error (low realism). | Add shapes: `eyJ` JWT (3 dot-separated base64url segments), `AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z_-]{35}`, `xoxe-`; allow `client_secret`/`*_secret`/`*_token`/`*_key` by matching `(?:[a-z0-9]+[_-])?(password|secret|token|api[_-]?key|…)` instead of relying on `\b` before the keyword. |
| F3 | Medium | confirmed | `src/dev-journal.ts:290-309` (`pruneSessions`) vs `:317` (`listSessions` read cap) | Probe `probe-disk.ts`: `PRUNE_300_VALID_MS 18.2` (reads all 300), `PRUNE_10K_EMPTY_MS 683.2` (reads 10 000 UUID-named empty files during one `saveSession`). `listSessions` caps reads at `maxSavedSessions*3=30` and skips >2 MB via stat; `pruneSessions` loops **every** pattern-matching file and `readFileSync`s each ≤2 MB file with no count cap. Worst case 10 000 × 2 MB ≈ 20 GB synchronous read on the renderer thread. Exploitability low (requires write access to the 0o700 private dir outside the vault), but it contradicts the module's "bounded" contract and blocks the UI on a user-initiated save. | Cap prune reads (e.g. stat-only eviction by mtime, or read at most N newest candidates like `listSessions`); evict oversized/unreadable files by stat without reading. |
| F4 | Low | confirmed | `src/dev-journal.ts:17-38` (limits), `:272-277` (`save`) | Probe `probe-bounds.ts`: `WORST_CASE_MEMORY {bytes:24860083, mb:24.9, stringifyMs:18.7, overDiskCap:true}`; `SAVE_OVER_CAP {ms:18.8, journalWritten:false}`. Rings bound *counts* (100 turns × 60 calls × ~4 KB clipped strings) but not bytes: in-memory worst case ≈ **25 MB** while the disk cap is 1 MB. Once over cap, `save()` silently skips forever (persistence stops; data lost on reload) yet still pays ~19 ms `JSON.stringify` per save. Realistic journal (100 turns × 3 calls + 500 events) = 155 KB, save 0.8 ms — negligible in practice. | Add a byte-aware ring eviction (drop oldest turns when serialized estimate exceeds cap) or surface a one-time "journal too large, persistence paused" event; cheap length estimate before full stringify. |
| F5 | Low | confirmed | `src/dev-journal.ts:240-251` (`exportSession`), `src/main.ts:341-355` | Source: session export returns raw `turns/events` — **no** `redactSensitive` layer (the report has one). Recorded error strings are mostly pre-redacted at source (`friendlyError`), but F2 shapes and non-Error `String(error)` tool failures (main.ts:2708) pass through raw into the downloadable/saved session JSON. Same local-file threat model as the report, weaker protection. | Run the same error/detail redaction over `exportSession` output (share the report's redactor), or document that session exports are unredacted raw captures. |
| F6 | Low | confirmed | `src/main.ts:299-305` (`setDeveloperMode`) | Source: `this.devJournal.enabled=enabled` is set **before** `event(...)`. On disable, `event()` is a no-op (`dev-journal.ts:205`), so `developer-mode-disabled` is never recorded; `save()` also no-ops when disabled. The `developer-mode-disabled` event kind is dead code — the journal has no marker for when recording stopped. Probe `probe-off.ts` confirms disabled `event()` records nothing. | Record the disable event before flipping `enabled` (and persist it in the same save), or drop the dead kind. |
| F7 | Info | confirmed | `src/dev-journal.ts:22-23` | Probe `probe-disk.ts` `ID_VALIDATION`: `loosePatternAcceptsDashes:true` — `/^[a-f0-9-]{36}$/` accepts any 36 hex/dash chars (e.g. 36 dashes), not a real UUID. **Traversal-safe**: class excludes `.` and `/`, so `../`, slashes, `..` all rejected (`readTraversal/readSlash/readDotDot:true`, `removeTraversalThrows:true`). | Tighten to a canonical UUID regex if strictness is wanted; no security impact today. |
| F8 | Low | confirmed | `src/dev-journal.ts:311-338` (`listSessions`/`readSession` use `statSync`/`readFileSync`) | Probe `probe-disk.ts`: `SYMLINK_FOLLOWED true` — a `<uuid>.json` symlink to an external valid session is read and listed; symlink to >2 MB target skipped by stat; symlink-to-dir tolerated. `clear()`/`removeSession` unlink the **link**, not the target (`symlinkTargetKept:true`). Requires write access to the 0o700 private dir; no vault escape. | Optionally `lstatSync` and skip symlinks in list/prune/read. |
| F9 | Info | confirmed | `src/main.ts:129-130` (onload load), `:3511` (listSessions in definitions), `src/dev-journal.ts:279` (saveSession ungated) | OFF=zero nuances, all bounded and write-free: (a) `load()` runs when off — reads ≤1 MB prior journal into memory (probe `LOAD_WHILE_DISABLED counts:{turns:1}`, `startTurnAfter:null`, no new writes); (b) `getSettingDefinitions` evaluates `listSessions` even when the toggle is off (spread before `visible`), bounded ≤30 reads, 0.7 ms/10 sessions; (c) class `saveSession()` is not enabled-gated — probe created `developer/` while disabled by calling it directly — but **every plugin caller gates on `developerMode` and `exportSession()` returns null when disabled**, so no disabled write path exists through the plugin. | Optional: gate `load()`/`listSessions()` on the toggle for strict OFF=zero reads; gate class `saveSession` for defense in depth. |
| F10 | Info | confirmed | `src/main.ts:2952` (finally), `src/dev-journal.ts:135-154` | `journal.save` runs synchronously in `finally` **before** `await releaseReply()`. Bounded: ≤1 MB write + atomic rename + at most two 25 ms `performance.now` spins on EPERM/EBUSY/EACCES (no `Atomics.wait` anywhere in src — grep matches are comments only). Realistic 0.8 ms; worst over-cap ~19 ms stringify (F4) + ≤50 ms spin. A slow disk delays reply-lock release by that bounded amount; acceptable. | None required; keep the byte cap and spin bound. |

## Audit questions — evidence

### Q1 · OFF = ZERO — **PASS (with bounded-read nuances, F9)**
`probe-off.ts` (real output):
```
DISABLED_RESULTS {"startTurn":null,"toolStart":null,"exportSession":null,"counts":{"turns":0,"toolCalls":0,"events":0},...}
OVERHEAD_MS {"N":200000,"disabledMs":6.8,"enabledMs":996.1,"perCallDisabledUs":0.034}
LOAD_WHILE_DISABLED {"counts":{"turns":1,...},"enabled":false,"startTurnAfter":null,"saveWritesAgain":true}
```
- `startTurn`/`toolStart` return null; `toolEnd`/`event`/`endTurn`/`save`/`exportSession` no-op when disabled (`dev-journal.ts:167,183,193,205,214,241,273`).
- `send()`'s finally hook is double-gated: `if(this.butler.developerMode){try{save}catch{}}` (main.ts:2952) **and** `save()` checks `enabled` — no developer file written when off.
- Disabled hot-path overhead **0.034 µs/call** (200 000 iterations, 6.8 ms total) — negligible.
- onload `load()` when off: bounded read (≤1 MB stat-gated, ≤100 turns/500 events validated), holds prior data in memory, records nothing new, writes nothing. Acceptable; see F9. The `developer/` dir created in the probe came from a direct raw `saveSession()` call (ungated class API), not from any plugin path.

### Q2 · REDACTION — **FAIL (F1 High, F2 Medium); user-data exemption verified & documented**
`probe-redact.ts` field-by-field (real output, abridged):
```
ok-redacted | providers[0].usageError | usage failed Bearer [redacted] api_key=[redacted]
LEAK | providers[0].exhaustion.reason | limit client_secret=abcd1234efgh5678
LEAK | providers[1].status (claude raw) | Claude exited: sk-liveABCD1234efgh5678 client_secret=…
LEAK | providers[2].status (opencode raw) | model unavailable: password="***"
ok-redacted | settings.storageRoot / excludedFolders / models.codex.model   (deep redactSettings)
LEAK | turn.error | turn error Bearer [redacted] eyJhbGciOi…   (JWT shape survives)
ok-redacted | toolCall.error | tool error api_key=[redacted] [redacted]
ok-redacted | event.detail | event detail password=[redacted] api_key=[redacted]
LEAK | loss.data.pendingLoadError | pending load AIzaSy… AKIA…
ok-kept(user-data) | turn.prompt / turn.reply / toolCall.result / toolCall.args
FULL_JSON_LEAKS ["sk- key","ghp_ key","standalone JWT","AWS access key","Google API key","client_secret= assign"]
FULL_MARKDOWN_LEAKS ["sk- key","AWS access key","Google API key","client_secret= assign","quoted password w/ spaces"]
INPUT_SETTINGS_UNMUTATED true
```
- **Every string field that can carry provider error text:** `usageError` ✓, `exhaustion.reason` ✓ (but F2 shapes), `settings.*` ✓ deep, `turn.error` ✓ (F2), `toolCall.error` ✓ (F2), `event.detail` ✓ (F2), `pendingLoadError` ✓ (F2), **`provider.status` ✗ NOT REDACTED (F1)**, `version/plan/accountType` ✗ (F1, lower realism). `modelUnavailability` is structurally safe — `{provider,model,kind}` only, model regex-validated, no error text (`opencode-availability.ts:26-43`). `savedChats`/`routingHistory` carry user data / model ids, not error text.
- `classifyToolError` returns enum classes only — no text re-introduction. Markdown does **not** re-redact; it renders the built fields, so it re-surfaces the unredacted `status`/`pendingLoadError`/exhaustion text (dev-report.ts:227,233,243). The leak is upstream coverage, not the renderer.
- **Prompt/reply/tool-result/args intentionally NOT redacted** (local user data) — confirmed kept by probe; documented at `dev-report.ts:132-133` ("Turns keep the user's own prompt/reply/tool-result text untouched; only error strings are redacted") and README Developer mode section. `sk-`/`ghp_` in `FULL_JSON_LEAKS` are attributable to these intentional user-data fields **and** to F1 status; the error-field leaks are JWT/AWS/Google/client_secret (F2).
- Bearer (with/without digit), `sk-`, `key-`, `ghp_`, `github_pat_`, `xoxb-`, `xoxp-`, unquoted `api_key=`/`password=`/`access_token=`, quoted values with spaces — all redacted ✓. Ordinary prose (`task-12345678`, `monkey-12345678`, guard messages) untouched ✓ (feature test + probe).

### Q3 · NO EXFILTRATION — **PASS**
- `grep fetch(|XMLHttpRequest|http|net|sendBeacon|WebSocket|axios` over `src/dev-*.ts` → **0 matches**.
- `downloadJson` (main.ts:62-69) = `Blob` → `URL.createObjectURL` → `createEl('a')` click → `revokeObjectURL` after 1 s. Purely local object URL; no network.
- All 49 `devJournal`/`dev-report` usage sites in main.ts are recording or local export. `send()` builds `instructions` from static text and `text:history+'REQUEST: '+prompt+'\n\n'+context` where `history=replayHistory(this.history)` — **never** `devJournal.turns()/events()`. Journal/report content cannot enter prompt/instructions/context or any `bridge.run` call.
- `developerDiagnostics()` reads cached bridge state + local `ChatStore.list()` + `readdirSync(edit-backups)` — no CLI spawn, no model turn, no network. No telemetry. "Copy summary" uses `navigator.clipboard.writeText` (local, user-initiated).

### Q4 · DISK SAFETY — **PASS (F3 prune bound, F7/F8 info)**
`probe-disk.ts` (real output):
```
MODES {"developer":"700","journal":"600"}   SESSIONS_DIR_MODE 700 SESSION_FILE_MODE 600
NO_TEMP_LEFT true
RETENTION_COUNT 10 expected 10   OLDEST_EVICTED true
CLEAR {"journalGone":true,"uuidSessionsGone":true,"notesKept":true,"bakKept":true,"uppercaseKept":true,"subdirKept":true,"symlinkTargetKept":true,"devDirStillThere":true}
ID_VALIDATION {"readTraversal":true,"readSlash":true,"readDotDot":true,"removeTraversalThrows":true,"loosePatternAcceptsDashes":true,"readNonUuidHexNull":true}
HOSTILE_LIST {"count":10,"ms":7.3,...}   SYMLINK_FOLLOWED true
PRUNE_300_VALID_MS 18.2 remaining 10   PRUNE_10K_EMPTY_MS 683.2 remaining 10
```
- All developer data under `vaultStorage()/developer/` (`join(root,'developer',…)`) — outside the vault, never synced note folders. Modes 0o700 dirs / 0o600 files verified on disk. Atomic temp(`wx`)+rename, temp cleaned in finally, no leftover.
- Retention 10 enforced, oldest evicted. `clear()` removes **only** `journal.json` + lowercase-UUID session files; non-UUID files, `.bak`, uppercase-UUID, subdirectories and symlink targets all survive; no recursive rmdir, no traversal.
- `readSession`/`removeSession`/`saveSession` id validation rejects `../`, `/`, `..` (F7 loose-but-safe). `listSessions` bounded against hostile dir: 10 000 noise files + oversized/malformed/wrong-kind/symlinks → 10 metas in **7.3 ms** (30-read cap, >2 MB stat-skipped). **`pruneSessions` is the unbounded exception (F3).**

### Q5 · RENDERER SAFETY — **PASS (F4 memory note)**
`probe-bounds.ts` (real output):
```
RINGS {"turns":100,"events":500,"maxCallsPerTurn":60,...}
CLIP {"prompt":6000,"reply":6000,"error":800,"args":1500,"result":1500,"callError":800,"event":300,...}
EXOTIC_ARGS_NO_THROW true  argsSamples ["[object Object]","10","[object Object]","{\"a\":1}","undefined","Symbol(s)","{}"]
WORST_CASE_MEMORY {"bytes":24860083,"mb":24.9,"stringifyMs":18.7,"overDiskCap":true}
SAVE_OVER_CAP {"ms":18.8,"journalWritten":false}
REALISTIC_PERF {"saveMs":0.8,"loadMs":1.2,"journalBytes":155274,...}
LIST_10_SESSIONS {"count":10,"ms":0.7}
MAXIMAL_REPORT {"markdownLen":4217,"capHolds":true,"buildMs":35.1,"mdMs":0.3,"stringifyOk":true,"reportBytes":25333742,"reportStringifyMs":19.2,...}
LOAD_TOLERANCE {"oversizedCounts":{"turns":0,...},"corruptCounts":{"turns":0,...}}
```
- No `Atomics.wait` (grep: comments only). Busy-spin bounded to two 25 ms pauses, only on transient-lock rename retry (`dev-journal.ts:140-150`).
- Rings/clips enforced: 200 turns→100, 1000 events→500, 100 calls/turn→60; 10 MB strings clipped to every cap; circular/BigInt/throwing-toJSON/null-prototype/Symbol/Map args never throw (`safeArgs`).
- `JSON.stringify(report)` cannot throw on journal content (validated plain objects) — confirmed with maximal journal (25.3 MB, 19.2 ms). Markdown cap holds: maximal journal → **4217 chars ≤ 19500** (lists clipped: 20 turns/20 chats/10 violations; final slice guard).
- Sync-fs budget per call: realistic save 0.8 ms / load 1.2 ms / listSessions(10) 0.7 ms; worst-case load ≤1 MB, listSessions ≤30×2 MB, save over-cap ~19 ms stringify (F4), prune unbounded (F3).

### Q6 · UI SAFETY — **PASS**
- Destructive actions gated: delete session → `ConfirmModal` (main.ts:3524-3527); clear data → `ConfirmModal` (3530-3533). `ConfirmModal.onOpen` uses `contentEl.createEl('p',{text:this.message})` (main.ts:3542) → **textContent**, not innerHTML. `Setting` name/desc and `descEl.createDiv({text})` are textContent. `meta.title` is control-char-stripped ≤80 (`dev-journal.ts:119-124`); HTML-like titles render as text — **no injection**.
- Toggle `onChange → setDeveloperMode → this.update()` re-renders. Dev render closures register **no persistent listeners** (only per-row `onClick`); the `usageUpdaters` pattern elsewhere returns a cleanup (main.ts:3189) and is untouched by dev rows. Per Obsidian 1.13 `SettingDefinitionRender` contract (obsidian.d.ts:8923-8930) cleanup runs before teardown; dev rows need none → **no stale-listener leak**.
- `listSessions` on every `getSettingDefinitions` (called on each display + search indexing + `update()`): **0.7 ms for 10 sessions** — cheap. Runs even when toggle off (F9b), bounded.

### Q7 · PRIVACY OF THE TOGGLE — **PASS**
`probe-settings.ts` (real output):
```
WINDOWS_UNCHANGED true   TOP_DEVELOPER_MODE true   MAC_DEVELOPER_MODE_IN_OWN false   MAC_MODEL_KEPT true
OTHER_PLATFORM_KEYS ["mac","windows"]   READ_WINDOWS {"developerMode":true,"provider":"claude","model":"win-model","unavail":1}
MIGRATE_TRUE true   MIGRATE_TRUTHY_STRING false   MIGRATE_ONE false   MIGRATE_ABSENT false   DEFAULT_OFF false
```
- `developerMode` ∉ `PLATFORM_SETTINGS` (core.ts:130) → shared top-level, intended. `writeSettings` preserves other platforms `{...record(data.platforms),[platform]:own}` (core.ts:141-145): windows AI block byte-identical after a mac toggle flip; mac model kept; toggle not duplicated into per-platform block. `migrateSettings` enables only on literal `===true`; default off.

### Q8 · REGRESSION SURFACE — **PASS**
`probe-wrapper.mts` (real output, replicates main.ts:2675-2712 chain):
```
EXECUTION_ORDER ["t1","t2","t3","t4","t5"]
ERROR_IDENTITY_PRESERVED true true   (Error object and non-Error object both === original)
RESULTS [t1 ok, t2 rejected, t3 ok, t4 rejected, t5 ok]   (values unchanged)
DISABLED_startTurn_null true   DISABLED_error_identity true   DISABLED_counts {"turns":0,...}
```
- `recorded = operation.catch(error=>{toolEnd(...); throw error;})` rethrows the **same** error reference; `toolQueue=recorded.catch(()=>{})` preserves serial ordering exactly (t1…t5 in order, slow t3 does not reorder). Success-path `toolEnd(ok:true)` is inside the operation before `return output` (main.ts:2700, source-verified). No swallowed/reordered result. Disabled → no recording, propagation intact.
- `journal.save` in `finally` runs before `await releaseReply()` (main.ts:2952); bounded bytes/spin (F10) — a slow disk delays reply release by ≤~19 ms + ≤50 ms worst case, not unbounded.

## Privacy assessment

- **Confinement:** all recording persists only to `vaultStorage()/developer/` (outside the vault, 0o700/0o600). Nothing is sent to a provider; journal/report never enter prompt/context/bridge calls; downloads are local object URLs; no telemetry. Provider isolation (no shell/file tools) is unaffected — the feature only observes OWLA's own tool layer.
- **User data:** prompt/reply/tool-args/tool-result and saved-chat content are intentionally unredacted local user data (documented). Acceptable per the feature's threat model.
- **Credential exposure (the real risk):** the diagnostics report is meant to be **shared for debugging**, so any credential in it leaks on share. F1 (unredacted `status` carrying raw Claude/OpenCode CLI errors) is a confirmed leak path; F2 (standalone JWT/AWS/Google/xoxe/client_secret shapes) weakens every redacted field. Session exports (F5) have no redaction layer at all. **Fix F1+F2 (and ideally F5) before release.** Toggle-off does not delete existing data (README states "nothing new is recorded while off"); clear-data is the explicit purge — correct, but users should know off ≠ erased.

## Performance assessment

| Path | Realistic | Worst case (bounded?) |
|------|-----------|------------------------|
| Disabled hot-path call | 0.034 µs | negligible ✓ |
| `save()` (100 turns×3 calls, 155 KB) | 0.8 ms | over-cap ~19 ms stringify, write skipped (F4) ✓ bounded |
| `load()` (≤1 MB) | 1.2 ms | ≤1 MB stat-gated ✓ |
| `listSessions` (10 sessions) | 0.7 ms | ≤30 reads ×2 MB ✓ bounded |
| `listSessions` hostile 10k files | 7.3 ms | 30-read cap ✓ |
| `pruneSessions` (saveSession) | 18 ms / 300 files | **683 ms / 10k empty; unbounded reads (F3)** ✗ |
| In-memory journal | ~155 KB | **~25 MB (F4)** ✓ bounded count, not bytes |
| `buildDiagnosticsReport` + markdown | <1 ms typical | 35 ms build / 0.3 ms md (maximal) ✓ |
| `JSON.stringify(report)` download | small | 25.3 MB / 19.2 ms (maximal) ✓ |
| Lock-retry spin | 0 (no lock) | ≤2×25 ms, transient-lock only ✓ |

No `Atomics.wait`; all synchronous fs is renderer-safe and bounded **except `pruneSessions` (F3)**. The ~25 MB in-memory ceiling and over-cap silent persistence stop (F4) are the only memory/functional concerns; both are bounded and unlikely in normal use (hard tool budget is 50/turn, typical turns have few calls).

## What was NOT verified live

- **No Obsidian runtime:** settings re-render/`update()` lifecycle, ConfirmModal flow, toggle UX, object-URL download trigger, and clipboard write were verified by source + Obsidian 1.13 API contract + pure-module probes, **not** inside a running vault. The `usageUpdaters`/cleanup no-leak conclusion rests on the d.ts contract and the dev rows registering no persistent listeners.
- **No live model turn / provider bridge:** the tool-wrapper regression was proven with a faithful promise-chain simulation (`probe-wrapper.mts`) + source read, not a real `send()` against a provider. Real Claude/OpenCode connect-failure `status` content (F1) was proven by tracing `friendlyClaudeError`/`friendlyOpencodeError` → `setStatus` and injecting synthetic raw text into the report, not by triggering a live CLI auth failure.
- **No real vault / daemon:** all disk probes used scratch directories; no vault mutation, no daemon contact, no network. File modes verified on scratch (umask 022); a different umask or pre-existing loose dir is not corrected by `mkdirSync` (mode applies only to newly created dirs) — not exercised.
- **Windows lock path:** the EPERM/EBUSY/EACCES bounded spin was read-verified, not triggered (macOS host); `performance.now` spin bound is structural.
- Full `npm test`/build/lint gates were **not** re-run (read-only, no builds); the orchestrator's green baseline is assumed. Only the three feature test files were re-run (48/48).

## Probe inventory (reproduce)

All under `/Users/filipdobric/.hermes/cache/scratch/owla-dev/`, run from the repo root with `node --import tsx <file>`:
- `probe-off.ts` — OFF=zero, disabled overhead, load-when-off.
- `probe-redact.ts` — redactSensitive shapes + report field-by-field + full JSON/markdown leak scan (runtime-assembled fixtures).
- `probe-settings.ts` — platform isolation + migrate gate.
- `probe-wrapper.mts` — tool-callback error identity/ordering simulation.
- `probe-disk.ts` — modes, atomic, retention, clear scope, id validation, hostile dir, prune bounds, symlinks.
- `probe-bounds.ts` — rings, clips, exotic args, memory worst case, perf, markdown cap, stringify safety, load tolerance.

*No source files were modified by this audit. Only this report was created.*

---

**Remediation (2026-11-21, orchestrator):** F1–F8 fixed and pinned by regression tests; F9/F10 accepted as documented. See `REVIEW-developer-mode.md` (same directory). Full gates green afterwards (838 tests, 0 fail, 0 lint warnings).
