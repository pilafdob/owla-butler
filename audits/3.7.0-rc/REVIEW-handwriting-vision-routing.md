# Review handoff — handwriting OCR, vision routing, and tool-call waste (2026-11-19)

**For:** the next coding agent reviewing this work.
**Author:** Hermes (desktop session), pairing with Filip.
**State:** working tree only. **Not committed, not staged by me, not pushed.** Branch `3.7.0-RC`.
**Gates at handoff:** `npm run check` ✅ · `npm run lint` ✅ · `npm run build` ✅ · `npm run check:release` ✅. **Tests:** all of *my* new/changed tests pass (ocr 6, search 3, hermes modalities 2 + config assertion, auto-route needsImage 1, routing needsImage 1). When I first ran the full suite it was **355/355 green**. The shared tree has since moved: the concurrent agent added tests and now `npm test` reports **~435 tests with ~8–10 failures**, all in *their* in-progress areas — Hermes `.env`/execution-key filtering (`hermesEnvKeyBlocked`/`hermesFilteredEnv`, e.g. `HERMES_TUI_GATEWAY_URL` currently leaks past the filter), Hermes instruction-file refusal, cli/codex/opencode protocol/abort tests, and core `migrateSettings`. **None touch my code** (`ocr.ts`, `searchScore`, `hermesModelModalities`, the `tool_search` config line, `needsImage`). I left their work untouched per the shared-tree rules; re-run the suite after they finish.

> ⚠️ **Shared working tree.** A *concurrent* agent is editing this repo at the same time. Several files below contain **both** my changes and theirs (interleaved hunks). Do **not** `git checkout/restore/reset/stash/clean` anything, and do not assume a whole-file diff is mine. My changes are the **named functions/hunks** listed in §3. Their work includes a table-selection feature (staged in `main.ts`/`note-tools.ts`) and recursion-depth hardening across `bases/canvas/cli/usage/…` plus additional edits in `hermes.ts`/`routing.ts`/`auto-route.ts`. My isolated changes pass; the full-suite failures above are theirs (see gate note).

---

## 1. The problem (real incident, diagnosed from the live transcript)

School vault, open OWLA chat. User: **"add a graph, describing this calculation"** on `Excalidraw/Drawing 2026-11-17 09.47.21.excalidraw.md` — a **124-stroke handwritten** physics drawing (vectors, |v|=√(200²+50²)·3,6=742,16 km/h, t=s/v), **zero text elements**.

The turn ran **22 tool rounds** and gave up ("I can't reliably read the handwritten strokes"). Transcript recovered from the Hermes private home `state.db` (`~/Library/Application Support/OWLA Butler/Hermes Private/state.db`, `messages` table). Root causes, each evidenced:

1. **Mis-routed to a text-only model.** Auto mode picked `opencode-go:beam-free`. `src/hermes.ts` hard-coded `inputModalities:['text','image']` for **every** Hermes model, so the `needsImage` filter in `routingModels` never excluded it. The models.dev catalog says `beam-free` is `attachment:false`, `modalities.input:['text']`. Hermes's own gate (`tools/vision_tools.py::_native_tool_result_images` → `agent/image_routing.py::decide_image_input_mode`) therefore refused to embed the rendered PNG and returned a **`MEDIA:<path>` string**. The model's reasoning literally says *"The model is beam-free which is text-only likely… I cannot read handwriting without vision."* It never saw the picture.
2. **`tool_search` ×4** hunting for an image/OCR tool that didn't exist. Hermes defers MCP tools (log: *"2 core/visible tools kept, 21 deferred"*), so schemas weren't in context → it also guessed wrong arg names (`list_vault_paths` `path` vs `folder`; `read_attachment` `path` vs `name`), each a wasted round.
3. **Irrelevant search results.** `search_vault` scored with substring `includes` (`'graph'` matches *"paragraph"*), so `function graph derivative integral parabel` surfaced **Music Theory Systems**, English/Future, Religion/Schamanismus — and `search_vault` **auto-reads its top 2**, injecting off-topic content.
4. **No way to read handwriting.** The element dump is just `freedraw [id] at (x,y) W×H`; no text. Nothing recovered the calculation.

## 2. What I changed (the four asks)

| Ask | Fix |
|---|---|
| #1 speed + tool awareness | Private Hermes config `tools.tool_search.enabled: off` → all OWLA schemas visible, no `tool_search`, no guessed args. Instructions: don't re-read unchanged files; read the drawing itself, don't hunt for an OCR tool. |
| #2 no irrelevant notes | `searchScore`: word-boundary matching + term-frequency/coverage scoring + a relevance floor (≥3-term query matched by one generic body word → 0). |
| #3 OCR excalidraw handwriting | New `src/ocr.ts`: macOS Vision via a Swift helper compiled once to a cached binary; `read_excalidraw`/`read_canvas` `visual=true` append recognized text beside the picture. |
| #4 vision-required weights | Honest Hermes modalities from `models_dev_cache.json`; `RoutingContext.needsImage` flows from `visualContext`; heuristic weighs active-drawing requests as `edit`/`vision`. |

## 3. My exact changes (isolate these from the concurrent agent's)

- **`src/ocr.ts` (NEW, entirely mine).** `ocrSupported`, `ensureOcrBinary` (compile-once to `<vaultStorage>/ocr/owla-ocr-<OCR_VERSION>` via `/usr/bin/swiftc -O`), `ocrImageFile`, `formatOcrLines` (pure reading-order sort), `ocrImageDataUrl`, `ocrSection`, `ocrSwiftSourceForTests`. Swift source is embedded as `SWIFT_SOURCE`; bump `OCR_VERSION` to force a rebuild.
- **`src/search.ts` (mine).** `SEARCH_STOP`, `escapeRegExp`, `termRegex`/`termRegexCache`, `termHits`, rewritten `searchScore`. `lookupText`/`needsLookup`/`standaloneQuestion` unchanged.
- **`src/hermes.ts` (mine = 3 hunks):**
  - `hermesModelModalities` + `loadModelsDevCatalog` + `modelsDevEntryVision` + `modelsDevCatalogCache` + `resetModelsDevCatalogCacheForTests` (the block after `hermesDefaultModel`).
  - `hermesPrivateConfig`: the `tools:\n  tool_search:\n    enabled: off` lines.
  - In `start()`'s model loop: `inputModalities:hermesModelModalities(providerID,modelID,home)` (was `['text','image']`).
  - **Everything else in this file's diff is the concurrent agent's.**
- **`src/routing.ts` (mine = 4 small hunks):** `needsImage?:boolean` on `RoutingContext`; on `BuildRoutingContextInput`; destructured `needsImage=false` in `buildRoutingContext`; `...(needsImage?{needsImage:true}:{})` in `base`. Other hunks (≈316/326/448/649/667) are the concurrent agent's.
- **`src/auto-route.ts` (mine = 1 block):** the `if(context?.needsImage){…}` rule in `heuristicTaskClass` right after the organisation rule (comment *"An active Canvas/Excalidraw drawing must be seen"*). The rest of this file's diff is theirs.
- **`src/main.ts` (mine, unstaged):** `import {ocrImageDataUrl,ocrSection} from './ocr'`; canvas visual return adds `canvasOcr`; excalidraw visual return adds `drawingOcrText` + activity line + `ocrSection`; `needsImage:visual.needsImage` in the `buildRoutingContext` call; extended visual-features instruction string. (The *staged* `main.ts` table feature is the concurrent agent's, not mine.)
- **Tests (mine):** `tests/ocr.test.ts` (new, 6); `tests/search.test.ts` (+3); `tests/hermes.test.ts` (+2 modality tests, +1 config assertion, imports); `tests/auto-route.test.ts` (+1 needsImage heuristic test); `tests/routing.test.ts` (+1 needsImage context test).

## 4. How to verify

```bash
npm run check && npm run lint && npm test && npm run build && npm run check:release
node --import tsx --test tests/ocr.test.ts tests/search.test.ts tests/hermes.test.ts tests/auto-route.test.ts tests/routing.test.ts
```

**OCR end-to-end (macOS, needs `/usr/bin/swiftc`):** render any handwriting drawing and call the tool path. Live-proven in Agentbrain by installing the build, reloading, then:
```js
// obsidian vault=<V> eval 'code=…'
const v = app.workspace.getLeavesOfType("owla-butler-chat")[0].view;
v.offeredToolNames = new Set(["read_excalidraw"]);           // tool guard
const out = await v.tool("read_excalidraw", {path:"…/drawing.excalidraw.md", visual:true}, document.createElement("div"));
// out.text ends with "[Handwriting OCR …]:\n1161\n…742, 16km/h…"; out.imageUrl is the PNG.
```
First call compiles (~3–7 s) + one-time Vision model load (tens of seconds); warm ≈0.3–0.7 s. Binary caches under `<vaultStorage>/ocr/`.

**Vision modalities vs the real catalog:**
```js
import {hermesModelModalities} from './src/hermes';
hermesModelModalities('opencode-go','beam-free','<Hermes Private home>'); // ['text']
hermesModelModalities('opencode-go','glm-5.3-flash-free',home);           // ['text','image']
```

## 5. Design decisions & trade-offs (scrutinize these)

- **OCR engine = macOS Vision via Swift, not JXA.** JXA↔Vision bridging is broken on macOS 27.3 (`NSNull`/`frameworkClass` exceptions on every options-dict variant — tried 4). Swift's bridge is reliable. Cost: requires Xcode CLT (`swiftc`); non-macOS or missing compiler → OCR silently skipped (picture still returned). **Review question:** is a silent macOS-only fallback acceptable, or should there be a setting/notice? I tied OCR to `visual=true` (no new setting) to keep surface small.
- **Classic OCR garbles math** (√→"Irl", superscripts lost). It's a *text fallback/supplement*; a vision model reads the pixels cleanly (verified). The section is labelled "verify against the picture". **Review question:** should OCR be skipped when the routed model is vision-capable (to save ~0.7 s), or always included as a text anchor? I always include it.
- **Vision capability source = `models_dev_cache.json`**, the exact catalog Hermes uses (`agent/models_dev.py::_entry_supports_vision`: explicit `modalities.input` wins, `attachment` fallback). Mirrored into the private home (not in `HERMES_PRIVATE_EXCLUDED`). Unknown model → `['text']` (fail closed; only excludes from image-required tasks). **Review questions:** (a) provider-key mismatch — I try the exact `providerID` first, then scan other providers for the model id; a name collision across providers could mis-resolve. (b) The catalog is read once and cached per home; if Hermes refreshes it mid-session, OWLA's cache is stale until reload. (c) If the catalog is absent, *all* Hermes models become text-only and Hermes can't take vision tasks — consistent with Hermes's own gate, but worth a notice.
- **`tool_search.enabled: off`** keeps ~21 schemas (~3.4k tokens) always visible. Verified Hermes `should_activate` returns False for `off`. Trade-off: more upfront tokens, far fewer round-trips. Right for OWLA's confined session whose whole point is these tools.
- **Search floor:** `words.length>=3 && distinct<2 && no path/phrase hit → 0`. Keeps the existing 2-term test (`equation balancing` → "Balance an equation") while dropping the 5-term/1-word music noise. **Review question:** could a legitimate note matching only 1 of 3+ terms be wrongly dropped? Possible; ranking still surfaces multi-term notes first.
- **Heuristic `needsImage` rule** fires only when the prompt looks drawing-related (edit verbs / deictic / visual words), so "capital of France?" with a drawing merely open stays `lookup`. The *model filter* (`routingModels` `needsImage`) is still conservative: any active drawing requires a vision-capable model regardless of kind.

## 6. NOT verified (gaps to close before release)

- **A full end-to-end model turn.** I did not run a live conversation to watch the FM router pick a vision model and count the reduced tool calls. Hermes was not connected live: its private home/daemon is **shared with School**, and connecting risked the user's running daemon (see skill's gateway/overlay traps). The routing logic is unit-tested with the exact failure prompt; OCR + search are live-verified in Agentbrain.
- **OCR cold-load latency on a fresh machine** and **non-macOS** behaviour are reasoned, not measured.
- **No new setting** for OCR; no UI notice when OCR is unavailable. Decide if needed.
- The concurrent agent's interleaved edits are **not reviewed by me**; review them separately.

## 7. Suggested next steps for the reviewer

1. Run the gates; confirm 355 pass.
2. Isolate my hunks (§3) from the concurrent agent's; review each against §5 questions.
3. Do a live turn in a vault with Hermes connected (ideally a *throwaway* private home, not the shared one): active handwriting drawing + "add a graph…", confirm a vision model is selected, OCR text present, and tool rounds ≪ 22.
4. Decide: OCR setting/notice? Skip OCR for vision models? Catalog-staleness refresh? Search-floor edge cases?
5. Only then consider staging/commit (owner approval required; shared tree).

**Vault record:** `Agentbrain/Obsidian/OWLA Butler Plugin.md` → section *"Handwriting drawings, vision routing and tool-call waste — local, unreleased (2026-11-19)"* (Central Index linked).