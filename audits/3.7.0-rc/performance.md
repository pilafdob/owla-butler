# OWLA Butler 3.7.0-RC — read-only performance audit

Status: **audit only, no source changed.** The single repo write is this file.
Branch `3.7.0-RC`. Baseline reported green by the orchestrator (check ✓ lint ✓
342/342 tests ✓ build ✓ guard:test ✓); this audit did not re-run the full suite
while sibling agents were editing the shared tree.

**Method.** Scratch-only probes under `~/.hermes/cache/scratch/owla-perf/`
run with `node --import tsx`, importing pure modules from `src/` and timing hot
functions on realistic synthetic inputs (5,000-note graphs, 200 KB notes, 2,000
stream chunks, 20 MB PDF byte stand-ins). No live model turns, no daemon contact,
no vault mutation. Bundle load measured by requiring `main.js` with the
Obsidian/Electron/CodeMirror externals stubbed (same method as the prior
`work/perf-bundle-load.mjs`). Minify potential verified with a scratch-only
esbuild build (output to scratch, `main.js` never touched). Probes deleted after.

**Caveats.**
- The working tree is being edited live by sibling agents; `file:line` below are a
  snapshot at audit time and drift. Exact `old`/`new` snippets are given so a patch
  can be re-located by content. Re-verify each site before applying.
- The real Agentbrain vault is small; large-vault numbers come from synthetic
  5,000-note / 200 KB inputs and scale ~linearly with note count.
- DOM-level costs (sanitize, renderPendingEdits) use a faithful stand-in or the
  measured cost of the underlying pure ops, not a running Obsidian renderer.
- pdf.js parse cost is **not** measurable outside Obsidian (`loadPdfJs` is a host
  module); the PDF finding measures the byte-read/copy portion and cites the
  per-call `getDocument` structure for the parse portion.

**Relation to the 2026-11-13 `PERFORMANCE-AUDIT.md`.** Most of its findings are now
fixed in-tree (vault-root cache + pass-scoped path memo, note-picker cache,
`RecordSplitter` in codex/claude/opencode, `cachedRead`+bounded concurrency in
`search_vault`, `Set` dedupe in `linkTargets`, OpenCode event-stream timeout,
OpenCode workspace digest, Claude parsed-object source walk, Codex source cap+Set,
Codex completion-callback instead of 100 Hz poll, quota-probe TTL, rAF scroll).
This audit re-verified those and reports what **remains** plus **new** regressions.
The headline new result: the **Hermes bridge reintroduced the quadratic stdout
buffer** that Finding 3 fixed in the other three bridges.

---

## Top 10 (ranked by impact × confidence)

### 1. Hermes stdout buffer is quadratic and unbounded (P0) — `src/hermes.ts:532`
`handleStdout` uses `this.jsonBuffer+=chunk; indexOf('\n'); slice(...)` — the exact
shape `PERFORMANCE-AUDIT.md` Finding 3 fixed elsewhere via `RecordSplitter`. The
Hermes bridge (added later) never adopted it, and unlike Codex it has **no size
limit** on a single message.

**Measured** (exact replica, one large JSON-RPC line arriving in 16 KiB chunks):

| single line | current Hermes | `RecordSplitter` | speedup |
|---|---|---|---|
| 1 MiB | 12.6 ms | 0.3 ms | 42× |
| 4 MiB | 83.5 ms | 1.1 ms | 76× |
| 8 MiB | **361.4 ms** | **2.0 ms** | **180×** |

8 MiB in 64 KiB chunks: 77.2 ms. Doubling 4→8 MiB multiplies time ~4.3× (quadratic).
Typical small-chunk streaming (2,000 lines, 1/chunk) is fine (0.2 ms) — the freeze
is the large-single-message regime, which ACP allows (a big `tool_call_update` or
`agent_message_chunk`). A single large message can block the renderer ~0.36 s, and
there is no cap to stop a runaway buffer growing without bound.

**Fix:** adopt `RecordSplitter('\n', 16*1024*1024)` exactly as codex/claude/opencode.
**Risk: SAFE** (proven pattern, three bridges already use it; behaviour identical).
**Gain:** 180× on an 8 MiB message; removes an unbounded-memory path.

### 2. Bundle is unminified; 58% is PDF-only weight (P1) — `esbuild.config.mjs:11`
The esbuild config sets `bundle:true` but **no `minify`**. Measured contributors of
the 1,721,537-byte snapshot: `pdf-lib` 668,174 (38.8%) + `@pdf-lib/standard-fonts`
140,680 (8.2%) + `pako` 129,307 (7.5%) + `@pdf-lib/upng` 54,179 (3.1%) + pdf-lib
tslib 10,389 = **1,002,729 bytes (58.2%) PDF-only**. `src` 601,269 (34.9%),
embedded `assets/reference-pack.json` 59,101 (3.4%).

**Measured minify win** (scratch esbuild build, `minify:true`, banner kept):
**990,494 bytes vs 1,738,772 current = −748,278 bytes (−43.0%)**. License banner
retained, all 12 license names present, reference-pack still embedded. Bundle
load (parse+eval, externals stubbed): median **11.3 ms → 9.6 ms**.

**Fix:** add `minify:true` to the esbuild build. **Risk: SAFE** (build-config only,
reversible; re-run release gates; licenses/banner preserved as verified). Note the
community-reviewer readability tradeoff is a policy choice, not a technical blocker.
**Gain:** ~43% smaller download/parse on every install.
**Larger structural option (not recommended for this RC):** lazy-load `pdf-lib`
(only `pdf-tools.ts` writes annotations; reading uses Obsidian's own pdf.js). That
would drop ~1 MB eager weight but needs a 4th shipped asset / release-policy change
(prior Finding 16). `pdfLink()` is pure and could be split out to enable it later.

### 3. `Organization.preview` re-folds every path per comparison (P1) — `src/organization.ts:252`
The affected-note scan calls `under(note.path,move.from)` and
`under(target,move.from)` for every note × move × resolved link. `under`/`key`
(`:34-35`) call `foldPath` = `normalize('NFC').toLowerCase().toUpperCase().toLowerCase()`
— four string ops — on **every** comparison, re-folding the same move roots and
link targets thousands of times.

**Measured** (5,000 notes × 10 moves × 20 links, replica of the `under` branch):
**479.6 ms current → 45.6 ms** with move-roots/note-keys/link-keys pre-folded once
(**10.5×**). `foldPath` alone: 17.0 ms per 100k calls. This runs on every
`propose_organization` preview **and again** in `accept()` (`:319` fresh preview)
and `refresh()` (`:272`), so one proposal pays it 2–3×. The `references.some(...)`
branch adds `parseLinktext`+`short()` (another `foldPath`) per reference on top.

**Fix:** pre-compute folded move roots, note keys and link-target keys once per
preview, then compare with `===`/`startsWith`. Semantics identical (`foldPath` is
deterministic; `under` is equality-or-`root+'/`-prefix). **Risk: CAREFUL**
(security-sensitive path comparison — preserve exact matching). **Gain:** ~10× on
large-vault organization previews; removes ~0.5 s main-thread block per proposal.

### 4. `query_vault_graph` pays per-note `realpath` on every query (P1) — `src/main.ts:1560`
The graph source wires `allowed:path=>this.butler.allowedNote(path)` (`:1567`),
a full `allowedVaultFile` (`statSync` + `realpathSync.native`). Unlike
`search_vault` (`:1677`) and `NotePicker` (`:792`), the graph tool is **not** wrapped
in `withPathCheckCache`, so every query re-resolves every note. `queryGraph`
itself is cheap; the path checks dominate.

**Measured:** `queryGraph` on a 5,000-note graph = 0.9–4.8 ms (tags/orphans/tag/
property/backlinks/unresolved). But `statSync`+`realpathSync.native` × 5,000 =
**69.6 ms** (realpath 59.5 + stat 10.6). The `orphans` report calls `allowed()`
once per note **and** once per `resolvedLinks` entry (`vault-graph.ts:63,82`) ≈
2× → ~140 ms at 5k. A single note's backlinks query (`noteGraph`) filters every
`resolvedLinks` entry by `allowed(from)` → ~70 ms even for one note. Repeated graph
queries in one turn each re-pay.

**Fix:** wrap the call in the existing pass cache:
`return this.butler.withPathCheckCache(()=>JSON.stringify(queryGraph(source,decodeGraphQuery(args))));`
`queryGraph` is synchronous, so this is exactly the intended bounded-pass use; the
symlink guard is unchanged across passes. **Risk: SAFE.** **Gain:** ~70–140 ms →
~1 ms steady-state per query at 5k notes (memo hit 0.8 ms/5,000 measured).

### 5. `read_pdf` re-reads and re-parses the whole PDF on every call (P1) — `src/main.ts:1478,2705`
`readPdfBytes` (`:1478`) does a fresh `vault.readBinary`/`file.arrayBuffer` per call;
`withPdfDocument` (`:2705`) does `loadPdfJs().getDocument({data:new Uint8Array(bytes)})`
per call and `destroy()`s it in `finally`. There is **no byte cache and no document
cache**. A whole-document read follows continuation ranges (`readPdfTextRange` caps
32 pages / 64,000 chars per call), so covering a long PDF takes N calls = **N full
file reads + N pdf.js parses + N `Uint8Array` copies** of the same file.

**Measured** (20 MB byte stand-in, warm cache): one read 4.6 ms; **7 reads 22.9 ms**;
7 `new Uint8Array(20MB)` copies 2.3 ms. The pdf.js `getDocument` parse is additional
and not measurable here, but it is repeated per call by construction and typically
dominates (hundreds of ms to seconds for a 20 MB document).

**Fix:** cache the parsed `PdfDocument` (or at least the bytes) keyed by
path/name + size+mtime in a tiny LRU (1–2 docs), destroyed on `newChat`/`onClose`/
attachment-epoch change/abort. **Risk: CAREFUL** (pdf.js lifecycle, abort handling,
memory cap). **Gain:** eliminates (N−1)×(full read + parse + copy) for multi-range
PDF reads — the common whole-PDF attachment case.

### 6. `read_note` does a second full disk read just to validate the cache (P2) — `src/main.ts:1797`
`const cache=!pending&&file&&await this.app.vault.read(file)===text?...` performs a
**second fresh full-file read** purely to confirm the metadata cache describes the
text already read by `currentText`. For a closed note that is 2 full reads + 2
`allowedEditable` (each a `statSync`+`realpath`) + 2 leaf-tree walks per `read_note`.

**Measured:** 8 KB note read ×2 ×500 = **51.6 ms vs 27.1 ms** single-read (I/O only;
the realpath/leaf overhead is additional). Scales with note size and read count.

**Fix:** validate against `vault.cachedRead(file)` (the same cached content the
metadata cache indexes) or a `stat.mtime` comparison instead of a second fresh
`vault.read`. **Risk: CAREFUL** (cache-freshness semantics — `cachedRead` is the
content Obsidian's cache describes, so this is equivalent-or-safer). **Gain:** ~half
the read I/O per `read_note` of a closed note.

### 7. `currentText` uses `vault.read`, double-checks allowed, walks leaves per call (P2) — `src/main.ts:544`
`currentText` (the read path for `read_note`/organization) calls `allowedEditable`
at `:545` **and again** at `:550`, walks `getLeavesOfType('markdown')` per call
(`:546`), and falls back to `vault.read(f)` (`:558`) — a fresh disk read.
`search_vault` already uses `cachedRead`; `currentText` does not.

**Measured:** `allowedPath` ×5,000 = 2.5 ms; the realpath pair dominates
(~14 µs/call, see Finding 4). Double `allowedEditable` doubles that per read; the
leaf walk is repeated per file.

**Fix:** use `vault.cachedRead(f)`; hoist the single `allowedEditable` decision;
reuse one leaf scan where a caller reads many paths. **Risk: SAFE/CAREFUL**
(`cachedRead` returns the cached saved content; open-editor branch already returns
unsaved text first). **Gain:** removes a redundant realpath pair + a fresh disk read
per closed-note read.

### 8. `renderReply` re-sanitizes the whole reply on every mutation; listeners accumulate (P2) — `src/main.ts:1292`
Each reply registers a `MutationObserver` (`subtree:true`) that calls
`sanitizeRenderedReply(content)` on **every** mutation batch, plus a click handler;
both live for the view's lifetime (`this.register`). MathJax/Mermaid typeset
incrementally, so one math-heavy reply triggers many full re-sanitize passes. The
feed DOM is never trimmed (history is capped at 12, the rendered DOM is not).

**Measured** (stand-in DOM, exact per-element work): sanitize of a ~4,680-element
math reply = **0.37–0.52 ms/pass**; ~30 mutation batches during typeset ≈ **11 ms
CPU per reply**. N replies → N live observers + handlers; a late mutation on any
reply re-sanitizes that reply's whole subtree.

**Fix:** coalesce sanitize into a single `requestAnimationFrame`/short-timeout
pass per frame instead of per mutation batch; optionally disconnect the observer
after a conservative quiet period (keep the initial sanitize). Do **not** weaken
what is sanitized. **Risk: CAREFUL** (security — late MathJax/Mermaid injection must
still be caught). **Gain:** ~one sanitize per frame instead of per mutation batch;
bounds per-reply observer work in long math-heavy sessions.

### 9. `renderPendingEdits` rebuilds the whole review area + broadcasts a diff refresh (P2) — `src/main.ts:1993`
Every call does `refreshEditorDiff()` (a window event → **every** open editor
recomputes decorations), then `pendingArea.empty()` and rebuilds every card. ~19
call sites; several fire in sequence within one user action (send's `finally`,
`addFiles`×2, `applyPluginChange`×2, `resolveEdit`, …). `syncSplitDiff` is now gated
to `diffView==='split'` (improved), but the rebuild + broadcast remain.

**Measured:** the underlying per-editor ops are small — `diffLines(200KB)` 0.45–0.5 ms,
`doc.toString()` 0.07 ms — but they multiply by open editors × call sites, plus the
full DOM rebuild each time.

**Fix:** skip the rebuild when neither the pending set nor organization state
changed (dirty flag); coalesce sequential calls into one microtask/rAF; only
broadcast `refreshEditorDiff` when the pending set actually changed.
**Risk: CAREFUL.** **Gain:** removes redundant full rebuilds + editor-wide diff
recomputation during multi-step actions.

### 10. `noteHeadings` end-range mapping is O(H²) (P3) — `src/note-tools.ts:109`
`headings.map((item,index)=>{const next=headings.slice(index+1).find(...)})` slices
and scans the remainder for every heading. Runs on every `read_note` at offset 0
(`headingOutline`), `activeNoteContext` for notes >20 KB, and `findSection`.

**Measured** (200 KB heading-dense note, 3,907 headings): `noteHeadings` 3.2 ms;
the end-mapping alone **4.82 ms (slice+find) vs 2.94 ms (linear stack)**. On a
100 KB / 1,974-heading note: 2.43 ms vs 1.26 ms. Quadratic in heading count.

**Fix:** single backward/stack pass to assign each heading's end (O(H)).
**Risk: SAFE** (pure function, existing tests). **Gain:** ~1.6–2× on heading-dense
large notes; removes an O(H²) allocation pattern.

---

## Smaller items (not top-10)

- **Hermes `ensurePrivateHome` rewrites config + 11 skills per connect, no digest**
  (`src/hermes.ts:281`). ~12 synchronous writes + `skillDefinitions()` (concatenates
  all reference text) on every (re)connect. OpenCode fixed the identical pattern with
  a content digest (`opencode.ts:404`). **SAFE** to add a digest gate. Low–medium.
- **Duplicate `autoEntries` call** (`src/main.ts:2292`):
  `if(!entries.length)entries=autoEntries(offers,needsImg,routingContext.estimatedTokens);`
  re-runs the identical call with identical args — guaranteed the same empty result.
  Dead work; likely intended a different fallback (e.g. drop the token filter).
  **SAFE** to remove or correct intent. Low.
- **`Organization.accept` checkpoint is O(M×N)** (`src/organization.ts:299,333-349`):
  each move re-reads all affected notes + full tree stats before and after, and
  rewrites the journal (up to 10 MB) per step. Batch ops are rare; recovery integrity
  is safety-critical. **RISKY** to redesign; flag only. Low–medium.
- **`excludedCache` unbounded** (`src/core.ts:146`): keyed by the excluded-folders
  string, never evicted. Only grows when the setting changes; theoretical. Low.
- **`countFoundationModelTokens` is dead code** (`src/routing.ts:70`): no callers in
  `src/`; its `tokenCountCache` is keyed by full text. Cleanup opportunity. Low.
- **`backupEdit` synchronous I/O per accepted edit** (`src/recovery.ts:6`): writes the
  full before-text JSON + `readdirSync`/`statSync` per backup on the UI thread. Small.

## Checked and found healthy (do not re-audit)
- Streaming text accumulation + single-`Text`-node append + rAF scroll (`main.ts:2375`).
- `RecordSplitter` in codex/claude/opencode; bounded stderr; Codex completion-callback.
- `replayHistory` bounded (12 msgs / 64,000 chars); `history` capped at 12.
- `search_vault`: `cachedRead` + pass-cached path checks + 8-worker concurrency +
  hoisted open-editor map; `searchScore` already uses `toLowerCase` (not locale).
- `linkTargets` `Set` dedupe; OpenCode event-stream timeout + workspace digest;
  Claude parsed-object source walk; Codex source cap+`Set`; quota-probe TTL.
- `editCards` is a `WeakMap` (no leak); `snapshots`/`turnSources`/`sourceLinks` cleared
  per turn; `tokenCountCache` capped at 256 (but see dead-code note).
- Per-turn routing/context assembly is cheap: `buildRoutingContext`(200 KB note,
  12 msgs) 1.4 ms, `heuristicTaskClass` 0.01 ms, `summarizeRoutingContext` 0.01 ms,
  `activeNoteContext`(200 KB) 2.05 ms. Not a bottleneck.
- `diffLines`/`doc.toString()` are fast (≤0.5 ms / 0.07 ms at 200 KB); the editor-diff
  per-keystroke path is not a significant cost on its own.

## Verification status
- Every number above was produced by a scratch probe (p1–p10) or a direct source
  read; raw outputs were kept beside the probes and deleted with them.
- No production source file was modified; the only repo write is this report.
  `git status` shows sibling agents' in-progress edits, untouched by this audit.
- DOM-level claims (8, 9) and the pdf.js parse portion (5) are inferred from the
  measured cost of the underlying operations plus the code structure; confirm with
  an in-app profile before treating as release-blocking.
- Findings were not exercised inside a running Obsidian instance (no live turns).
