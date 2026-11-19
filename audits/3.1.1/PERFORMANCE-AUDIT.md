# OWLA Butler performance audit — 2026-11-13

Status: audit only. No production source was changed. Baseline before the audit
was green: `npm run check` (strict TypeScript), `npm run lint` (0 warnings, 0
errors) and `npm test` (140 tests, 0 failures).

**Headline results, all measured:**

| # | finding | measured | proposed fix |
|---|---|---|---|
| 1 | `allowedVaultFile()` re-resolves the vault root per call | 57.6 ms per 2,000 notes, 88% of it `realpathSync` | 1.7× (root cached) → 57× (memoised) |
| 2 | Note picker re-checks the whole vault per keystroke | 51.2 ms per keystroke | **66× faster** (0.9 ms) |
| 3 | Provider stream buffers are quadratic | **298 ms** for one 16 MiB message | **135× faster** (2.2 ms) |
| 4 | `search_vault` reads every note serially, uncached | 164 ms of path checking before any disk read | `cachedRead` + hoisted scan + bounded concurrency |
| 5 | `Organization.safeSource()` re-stats shared ancestors | 44 µs per entry | 3.4× faster |
| 6 | `linkTargets()` dedupes with a linear scan | 10.5 ms at 1,600 links | `Set` → O(L) |
| 7 | `query_vault_graph` pays the path check per note | ~58 ms per query | free via Finding 1's memo |
| 8 | `probePrimaryQuota()` round-trips per message while a fallback is engaged | one connect + usage call per message | TTL on the known `resetsAt` |
| 9 | OpenCode event stream has no request timeout | a hang, not a slowdown | add the timeout `call()` already has |
| 10 | Codex source collection uncapped + linearly scanned | 6.1 ms per 1,000 annotations | `Set` + the existing 20-item cap |
| 11 | Claude Code re-serialises every tool result to scan it | stringify per tool result | walk the parsed object |
| 12 | Codex polls at 100 Hz while a request is outstanding | up to 2,000 timer wakeups | resolve on completion |
| 13 | OpenCode writes ~12 files synchronously per connect | ~105 KiB of sync I/O | write once, reuse on digest match |
| 14 | `renderPendingEdits()` rebuilds the whole review area | 19 call sites | update in place |
| 15 | Streaming flush forces a synchronous layout | up to 20 forced layouts/sec | `requestAnimationFrame` |
| 16 | 69% of the bundle is PDF-only weight | 1.0 MB of 1.46 MB | only if the release can ship a 4th file |
| 17 | Smaller items | — | — |

**One conclusion was reversed during the audit.** The Codex stdout buffer was
first recorded as healthy and is now Finding 3, the most severe result in the
document. The correction is recorded in full under "Checked and found healthy".

## How this was measured

Three harnesses were added under `work/` and are re-runnable:

- `work/perf-bench.mjs` — builds a synthetic vault (2,000 notes, 40 folders,
  depth 3, ~8 KB each), then measures the real functions the plugin runs on the
  main thread: `allowedPath`/`allowedVaultFile`, `searchScore`, `linkTargets`,
  and the `Organization.safeSource` lstat walk.
- `work/perf-bundle-load.mjs` — loads the esbuild bundle with the Obsidian,
  Electron and CodeMirror externals stubbed, to measure plugin-enable cost.
- `work/perf-bridge-buffers.mjs` — replicates the exact `receiveChunk` code
  from `src/codex.ts` and measures both buffer regimes, current and fixed.

Raw output: `work/perf-audit-result.txt`. Host: Apple M2, Node v24.15.0.

**Caveat on scale.** The real Agentbrain vault holds 46 notes, which is too
small to expose any of the findings below. All numbers therefore come from the
synthetic 2,000-note vault, which is a realistic size for a long-lived personal
vault. Percentages are stable across runs; absolute milliseconds scale roughly
linearly with note count.

**Caveat on the baseline vault.** The synthetic vault is flat and regular, so
it understates path-depth cost. The `Organization.safeSource` measurement is
called out separately because it is depth-sensitive and the synthetic vault
only has depth 3.

---

## Finding 1 — `allowedVaultFile()` re-resolves the vault root on every call (P0)

**Location:** `src/main.ts:403`

```ts
allowedVaultFile(path:string,extension:string|null=null){
  if(!allowedPath(path,this.prefs.excludedFolders,extension))return false;
  try{
   const base=this.vaultBasePath();
   if(!base)return false;
   const root=realpathSync(base),file=realpathSync(join(base,path));
   ...
```

**Measured** (2,000 notes, one full pass):

| step | cost |
|---|---|
| `allowedVaultFile` × 2000 | **57.6 ms** |
| of which: `allowedPath` × 2000 | 1.1 ms |
| of which: 2 × `realpathSync` × 2000 | 50.8 ms |

`realpathSync` is **47× the cost of the pure string checks**. The whole
function is 98% syscall.

Two separate problems:

1. `realpathSync(base)` resolves the **vault root** on every call. The root
   cannot change while the plugin is loaded — it is the same string every time.
   This alone is half the syscall cost.
2. `realpathSync(join(base,path))` resolves each candidate path. This one is
   load-bearing: it is the guard that refuses to follow a symlink out of the
   vault (`isPathInside(root, file)`). It should **not** be removed.

**Proposed fix:** cache the resolved vault root on the plugin instance
(invalidated on vault rename), and memoise the per-path resolution result
keyed by path, invalidated on Obsidian's `modify` / `create` / `delete` /
`rename` vault events. The symlink guard stays intact — it is just no longer
recomputed for a path whose result is already known.

**Projected effect** (measured against the same synthetic vault):

| variant | cost | vs current |
|---|---|---|
| current | 57.6 ms | — |
| root cached, per-path realpath kept | 34.5 ms | **1.7× faster** |
| root cached + per-path memoised (steady state) | 1.0 ms | **57× faster** |
| no `realpath` at all *(not recommended — drops the guard)* | 1.1 ms | 52× faster |

---

## Finding 2 — the note picker re-checks the whole vault on every keystroke (P0)

**Location:** `src/main.ts:549`

```ts
class NotePicker extends FuzzySuggestModal<TFile>{
  ...
  getItems(){return this.app.vault.getMarkdownFiles().filter(f=>this.butler.allowedNote(f.path));}
```

`FuzzySuggestModal.getSuggestions(query)` is the source of the suggestion list
(`node_modules/obsidian/obsidian.d.ts:4952`, with `abstract getItems()` at
`:4990`). Obsidian calls it **on every input event**, so `getItems()` — and
therefore the whole `getMarkdownFiles()` scan plus one `allowedVaultFile()` per
note — runs again for **every keystroke**.

**Measured:** 51.2 ms per keystroke at 2,000 notes. At a normal 10 keystrokes
per second that is **~576 ms of blocked main thread per second** of typing.

**Proposed fix:** compute the filtered list once when the modal opens and
cache it on the instance; invalidate on vault `modify`/`create`/`delete`/
`rename`. With the memo from Finding 1 the steady-state cost drops from
51.2 ms to **0.9 ms per keystroke — 66× faster** (measured).

This is the single worst UX problem found: the picker visibly stutters on
large vaults.

---

## Finding 3 — the provider stream buffers are quadratic on the UI thread (P0)

> **Correction.** An earlier pass of this audit recorded the Codex stdout buffer
> as healthy, on the reasoning that V8's `SlicedString` makes `slice` O(1).
> That was wrong, and the error is instructive: it was based on measuring only
> one of the two regimes the pattern has. Both regimes exist, and only one is
> safe.

**Location:** `src/codex.ts:114-130`, `src/claude.ts:222-238`,
`src/claude.ts:348-356`, `src/opencode.ts:458-472` — all four use the same
shape:

```ts
buffer+=chunk;
let index=buffer.indexOf('\n');
while(index>=0){
  const line=buffer.slice(0,index);
  buffer=buffer.slice(index+1);
  ...
  index=buffer.indexOf('\n');
}
```

**Regime A — many complete lines in one chunk: fine.** V8 represents the
`slice` result as a `SlicedString`, so no copy happens. Measured: 500 lines
1.9 ms, 8,000 lines 7.3 ms, 32,000 lines 15.0 ms. Linear.

**Regime B — one large line arriving in many chunks: quadratic.** Here
`buffer+=chunk` builds a `ConsString` tree, and the next `indexOf` must
**flatten** it — copying the whole accumulated buffer. With no newline in the
chunk, the buffer is *not* trimmed, so every chunk triggers a full re-copy of
everything so far. This is the case the protocol explicitly allows: the
message limit at `src/codex.ts:117` is 16 MiB, so a single 16 MiB message is
permitted.

**Measured** (exact replica of `receiveChunk`, one large line):

| single line | 64 KiB chunks | 16 KiB chunks |
|---|---|---|
| 1 MiB | 5.0 ms | 4.9 ms |
| 4 MiB | 22.3 ms | 73.9 ms |
| 8 MiB | 78.5 ms | 266.7 ms |
| 16 MiB | **298.4 ms** | — |

Doubling 8 → 16 MiB multiplies the time by 4.0 — quadratic, confirmed. **A
single large protocol message can freeze the Obsidian renderer for ~0.3 s**, and
the subagent's 16 KiB-chunk run reaches 267 ms at only 8 MiB.

**The fix is a one-line shape change**, and it turns O(n²) into O(n): scan for
newlines *inside the incoming chunk* (a chunk-local O(chunk) scan) and only
concatenate the pending tail when a line actually completes. The pending tail
then stays a `ConsString` until that one moment, so the accumulated message is
flattened exactly once instead of once per chunk.

**Measured with that fix:**

| single line (64 KiB chunks) | current | fixed | speedup |
|---|---|---|---|
| 1 MiB | 5.0 ms | 0.2 ms | 25× |
| 4 MiB | 22.3 ms | 0.5 ms | 45× |
| 8 MiB | 78.5 ms | 0.9 ms | 87× |
| 16 MiB | **298.4 ms** | **2.2 ms** | **135×** |

The fixed version scales linearly (1 → 16 MiB = 11× for 16× the data); the
current one scales quadratically (60× for 16× the data).

`src/opencode.ts:464` additionally does `block.split('\n')`, materialising an
array of every line in the block, and `src/claude.ts:225,351` call `.trim()`
on each line (an extra copy).

**Applies to all four sites.** `src/claude.ts:358`
(`stderr=(stderr+chunk).slice(-4000)`) is **not** affected — the `.slice(-4000)`
keeps it bounded, so it stays linear. Same for `src/opencode.ts:119`.

## Finding 4 — `search_vault` reads every note serially, with no cache (P1)

**Location:** `src/main.ts:1275-1276`

```ts
const files=this.app.vault.getMarkdownFiles().filter(f=>(!folder||f.path.startsWith(folder+'/'))&&this.butler.allowedNote(f.path));
for(let i=0;i<files.length;i++){
  if(this.controller?.signal.aborted)throw Error('Stopped.');
  const file=files[i];
  if(file.stat.size>250000)continue;
  const text=await this.butler.currentText(file.path),score=searchScore(file.path,text,query);
  ...
  if(i%25===0)await new Promise(r=>nodeTimeout(r,0));
}
```

Four separate costs stack up here:

1. **Serial I/O.** The `await` is inside the loop, so 2,000 notes means 2,000
   sequential awaits. There is no concurrency limit; it is fully serial.
2. **No read cache.** `currentText` (`src/main.ts:404`) uses `vault.read()`, a
   fresh disk read every time. Obsidian's `vault.cachedRead()` exists for
   exactly this and is used **nowhere in the codebase** (verified by grep).
3. **`allowedNote` is called three times per note** — once in the filter at
   `:1275`, then twice more inside `currentText` at `:404` (once on entry,
   once in the `!(f instanceof TFile)||!this.allowedNote(path)` check). Each
   call is a full `allowedVaultFile()`, so a closed note costs **6 ×
   `realpathSync`**. Measured for the whole 2,000-note scan: **153.1 ms of
   pure path checking before a single byte is read from disk.**
4. **`getLeavesOfType('markdown')` per note.** `currentText` scans the
   workspace leaf tree to find an open editor for the path, and does it once
   per file — so the leaf tree is walked 2,000 times per search.

**Also:** `searchScore` (`src/search.ts:2`) lowercases the entire body of
every note with `toLocaleLowerCase()`, which is the locale-aware (slower) form.
Measured: 6.8 ms of CPU for the scoring pass, 3.3 ms of which is the
lowercasing alone.

**Proposed fix:**
- Use `vault.cachedRead()` in `currentText`.
- Hoist the `getLeavesOfType('markdown')` scan out of the loop — build the
  path→view map once per search.
- Read the allowed-path decision once per file and pass it through, instead
  of re-deriving it inside `currentText`.
- Bounded concurrency (e.g. 8 at a time) instead of fully serial reads.
- `toLowerCase()` instead of `toLocaleLowerCase()` for the search index.

---

## Finding 5 — `Organization.safeSource()` stats the same ancestors repeatedly (P1)

**Location:** `src/organization.ts:134-140`, called from `list()` at `:122`

```ts
private safeSource(path:string){
  if(!this.allowed(path))return false;
  for(let current=path;current;current=parent(current)){
   if(this.stat(current)?.isSymbolicLink())return false;
  }
  return true;
}
```

`stat()` is `lstatSync` (`:131`). For every child entry, the **entire ancestor
chain is re-stat'd** — so for 500 children in a depth-3 folder, the same three
ancestors are stat'd 500 times each.

**Measured:** 44 µs per entry, all synchronous. A 500-entry folder listing is
~22 ms of blocked main thread, and `list()` is a *model-facing* tool — it can
be called mid-turn, while the user is watching.

**Proposed fix:** memoise the ancestor symlink check per directory within a
single `list()` call. Measured effect on the same workload: 2.1 ms → 0.6 ms
(**3.4× faster**).

---

## Finding 6 — `linkTargets()` is quadratic in link count (P1)

**Location:** `src/note-tools.ts:49`

```ts
if(!found.some(item=>item.link===target))found.push({link:target,path,subpath});
```

The dedupe is a linear scan of the array for every link, so the function is
O(L²) in the number of links.

**Measured:**

| links | time |
|---|---|
| 100 | 0.4 ms |
| 400 | 0.7 ms |
| 1,600 | **10.5 ms** |

4× the links → ~13× the time. Quadratic behaviour confirmed.

This runs on **every** `propose_edit`, because `brokenLinks()` calls
`linkTargets()` twice — once on the before text and once on the after text
(`src/note-tools.ts:63-64`).

**Proposed fix:** use a `Set` for the seen-links check alongside the array.
O(L), and the array order is preserved.

---

## Finding 7 — `query_vault_graph` pays the `realpath` cost per note (P1)

**Location:** `src/main.ts:1162-1165`, `src/vault-graph.ts:63` and `:82`

```ts
notes:()=>this.app.vault.getMarkdownFiles().map(file=>file.path),
...
allowed:path=>this.butler.allowedNote(path),
```

```ts
const notes=source.notes().filter(source.allowed).sort();
```

Every graph query calls `allowed()` once per note, and the `orphans` report
additionally calls `allowed(from)` for **every entry in `resolvedLinks`**
(`src/vault-graph.ts:82`). Each of those is a full `allowedVaultFile()` call.

A `report: 'tags'` query over a 2,000-note vault therefore triggers ~2,000
`allowedVaultFile()` calls ≈ 58 ms, on top of the tag scan.

**Proposed fix:** the memo from Finding 1 resolves this automatically, since
these are repeated checks over the same path set.

---

## Finding 8 — `probePrimaryQuota()` costs a full round-trip per message while a fallback is engaged (P1)

**Location:** `src/main.ts:268-279`, called from `send()` at `src/main.ts:1644`

```ts
if(this.butler.fallbackActive){
  await this.butler.probePrimaryQuota();
  this.butler.applyFallback();
}
```

```ts
async probePrimaryQuota():Promise<void>{
  ...
  await bridge.connect(this.providerExecutable('codex'),this.providerSessionDirectory('codex'),this.prefs.webSearch);
  await bridge.readUsage();
```

**Scope, stated precisely:** `fallbackActive` is `this.fallbackProvider!==null`
(`src/main.ts:230`), and `fallbackProvider` is only set when the primary
provider is exhausted and the fallback is serving (`src/main.ts:256-259`). So
this cost is paid **once per message only while the primary provider is out of
usage** — not on every message in the normal case. While a user is on a
depleted plan, every message pays a connect + usage round-trip to the primary
provider before the turn starts, purely to notice that the quota has reset.

**Proposed fix:** the exhaustion record already carries `resetsAt`
(`src/main.ts:225-243`). Cache the probe result and only re-probe when
`Date.now()` passes the known reset time, rather than on every message. The
same reasoning applies to the `readUsage` call in `automaticOffers`
(`src/main.ts:302`), which already has a 10-minute staleness check — the
primary-provider path has no equivalent.

---

## Finding 9 — the OpenCode event stream has no request timeout (P1, reliability)

**Location:** `src/opencode.ts:129-141`, used at `src/opencode.ts:421`

Every other HTTP call in this module sets a timeout:

```ts
request.setTimeout(options.timeout??20000,()=>{request.destroy(new Error('OpenCode timed out.'));});
```
(`src/opencode.ts:123`)

`openEventStream` does not. If the server accepts the socket but never sends
response headers, `await openEventStream(...)` in `prompt()` never settles —
the turn hangs indefinitely, the `hold()` is never released, and the OpenCode
child process stays alive.

This is a hang, not a slowdown, so it is listed separately from the other
performance findings — but it has the same root cause class: a missing bound on
an unbounded wait on the UI thread.

**Proposed fix:** give `openEventStream` the same timeout treatment. Note that
the timeout must cover *connection establishment*, not the stream lifetime —
the SSE stream is expected to stay open for the whole turn.

---

## Finding 10 — Codex source collection is uncapped and scans linearly (P2)

**Location:** `src/codex.ts:198` and `src/codex.ts:201`

```ts
for(const value of list(item.annotations)){... if(...&&!sources.some(s=>s.url===url))sources.push({url,title:...});}
```

Line 201 caps `sources` at 20 (`if(sources.length<20&&...)`) but **line 198 has
no cap at all**, and both use a linear `sources.some()` scan for every
candidate URL.

**Measured:** 1,000 annotations with the linear scan → 6.1 ms, and `sources`
grows to 1,000 entries. A reply with 2,000 links and 1,000 annotation URLs
would perform ~2 M string comparisons. The array also survives for the whole
turn.

**Proposed fix:** keep a `Set<string>` of seen URLs alongside the array, and
apply the same 20-item cap to the annotation branch.

---

## Finding 11 — Claude Code re-serialises every tool result to scan it (P2)

**Location:** `src/claude.ts:326-329`

```ts
const raw=typeof block.content==='string'?block.content:JSON.stringify(block.content??'');
for(const match of raw.matchAll(/"title":"([^"]{1,200})","url":"(https?:\/\/[^"]+)"/g))sources.set(match[2],match[1]);
```

Every `user` message — i.e. every tool result — is serialised back to JSON
purely so a regex can be run over it looking for web-search links. The parsed
object is already available; it does not need to be turned back into a string.

`src/claude.ts:263` also allocates `const sources=new Map<string,string>()`
that is never trimmed for the turn (one entry per web-search result URL).

**Proposed fix:** walk the already-parsed `block.content` structure instead of
re-serialising it.

---

## Finding 12 — Codex polls at 100 Hz while a request is outstanding (P2)

**Location:** `src/codex.ts:224-226`

```ts
while(!this.connecting&&this.child===owner&&!this.holders.size&&!this.active&&!this.idle&&this.pending.size){
 await new Promise<void>(resolve=>setTimeout(resolve,10));
}
```

This wakes the event loop every 10 ms until the in-flight request map drains —
up to 2,000 wakeups against the 20 s request timeout at `src/codex.ts:112`.

It is not a true idle poll (it only runs while a request is outstanding), but
it is a poll where a completion callback would do, and it competes with
rendering during exactly the window where the user is waiting on a reply.

**Proposed fix:** resolve the waiter when `pending` becomes empty rather than
polling for it.

---

## Finding 13 — the OpenCode connect path does ~12 synchronous file writes (P2)

**Location:** `src/opencode.ts:295-314` (`writeWorkspace`)

Every (re)connect writes the plugin source, 8 × `SKILL.md`, `owla-skills.json`
(which embeds every skill's full text a second time), `owla-tools.json` and
`opencode.json` — ~105 KiB across 12 synchronous calls, on the renderer thread.

**Proposed fix:** write the workspace once and reuse it when the content
digest is unchanged. The content is derived from the bundled skills and the
tool specs, both of which are stable for the life of the plugin.

---

## Finding 14 — `renderPendingEdits()` rebuilds the whole review area (P2)

**Location:** `src/main.ts:1458`, with **19 call sites** in `main.ts`

Every call does: `refreshEditorDiff()` → `this.butler.syncSplitDiff()` (which
itself calls `getLeavesOfType()` twice) → `pendingArea.empty()` → rebuild
every card from scratch.

It is invoked from `send()`'s `finally`, `addFiles()` (twice),
`applyPluginChange()` (twice), `resolveEdit()`, `finishRemoval()`,
`organizationDecided()`, and the PDF annotation flow. Several of these fire in
sequence within a single user action.

**Proposed fix:** keep the DOM, update only what changed. At minimum, skip the
rebuild when neither the pending set nor the organization state changed, and
only call `syncSplitDiff()` when `diffView === 'split'` (it already early-returns
in that case, but the call itself still walks the leaf tree).

---

## Finding 15 — the streaming flush forces a synchronous layout (P2)

**Location:** `src/main.ts:1783`

```ts
streamNode.appendData(pendingText);
pendingText='';
this.feed.scrollTop=this.feed.scrollHeight;
```

Appending to a single `Text` node is the right choice and is already
efficient — the earlier streaming stress test recorded 3 text changes for
2,000 chunks. The remaining cost is that reading `scrollHeight` forces a
synchronous layout, and it runs on every 50 ms flush — up to 20 forced
layouts per second while a reply streams.

**Proposed fix:** coalesce the scroll into `requestAnimationFrame`, so it is
tied to the display refresh rate rather than the flush timer. Low risk.

---

## Finding 16 — 69% of the bundle is PDF-only weight, loaded eagerly (P3)

**Location:** `src/main.ts:25` → `src/pdf-tools.ts:1` → `pdf-lib`

```ts
import {annotatePdf,validatePdfComments,pdfLink,PdfComment} from './pdf-tools';
```

`pdf-lib` is used **only** by `src/pdf-tools.ts`, which is only needed to
*write* PDF annotations. Reading PDFs uses Obsidian's own bundled pdf.js via
`loadPdfJs()` — a completely separate dependency that OWLA does not pay for.

**Measured:** 1,009,203 of 1,460,302 bundle bytes (**69%**) is
`pdf-lib` + `pako` + `UPNG` + `fflate`. A bundle built without `pdf-lib` is
456,596 bytes.

**Honest impact:** the plugin-enable cost difference is **~9–12 ms median with
pdf-lib vs ~3–5 ms without** — a real but modest saving, plus ~1 MB less to
download and parse. (A cold-process `require` of pdf-lib measured 548 ms, but
that is a cold filesystem-cache artifact of a fresh Node process, not
representative of Obsidian's load. It is not counted here.)

**Why it is ranked low:** the project ships a **three-file** Community release
(`main.js`, `manifest.json`, `styles.css`), so a separate lazily-loaded chunk
would need an extra shipped asset and a release-policy change. The gain does
not justify that on its own.

**Option if wanted:** `pdfLink()` is a pure function used on the hot path;
splitting it into its own module and lazy-loading `pdf-tools` would let the
build drop `pdf-lib` from the eager bundle.

---

## Finding 17 — smaller, lower-impact items (P2/P3)

- **`allowedPath` re-parses the excluded-folder list on every call**
  (`src/core.ts:101`): `excluded.split('\n').map(...).filter(Boolean)` — three
  array allocations per call. It is only 1.1 ms per 2,000 calls, but it is
  trivially cacheable: the excluded list changes only when the setting changes.
- **`buildToolSpecs()` rebuilds every tool schema on every turn**
  (`src/main.ts:205-216`): ~10 objects with full JSON-Schema literals allocated
  per message. Pure garbage; the specs are static except for the plugin-turn
  additions.
- **`capture()` walks the leaf tree twice** (`src/main.ts:392-393`).
- **`searchScore` uses `toLocaleLowerCase()`** (`src/search.ts:2`) where
  `toLowerCase()` would do — the locale-aware form is measurably slower.
- **`save()` deep-clones the whole settings object** (`src/main.ts:398`) on
  every save. The object is small, so this is minor.

---

## Checked and found healthy

These were investigated and are **not** problems. Recording them so the next
audit does not repeat the work:

- **Streaming text accumulation** (`src/main.ts:1680`): `text+=delta` on a
  string is a rope in V8, and the flush appends to a single `Text` node rather
  than re-rendering HTML. This is the correct pattern; the earlier stress test
  recorded 3 DOM text changes for 2,000 chunks / 62,000 characters.
- **`replayHistory`** (`src/codex.ts:14`) is bounded to 12 messages / 64,000
  characters. No unbounded growth.
- **Process lifecycle**: no idle polling `setInterval` was found in the
  provider bridges; processes start on demand and are shut down after each
  response.
- **Bounded stderr accumulation** (`src/claude.ts:358`):
  `stderr=(stderr+chunk).slice(-4000)` stays linear because the `.slice(-4000)`
  caps the string. Same for `src/opencode.ts:119`, where the body length is
  only read (O(1) on a `ConsString`) and bounded by a 32 MiB check.
- **No listener leaks** in the provider bridges: each stdout has exactly one
  `data` listener, `codex.ts` uses a `Map` for in-flight requests with timers
  cleared on both resolve and disconnect, and the OpenCode SSE stream is
  explicitly destroyed. `receiveChunk` early-returns when the child is no
  longer the owner (`src/codex.ts:115`).
- **No unbounded cross-turn growth** in any bridge: `models` is replaced
  wholesale, `pending` holds only in-flight requests, and the OpenCode
  `sources` list is capped at 20 (`src/opencode.ts:496`).
- **`vault.read()` vs `cachedRead()`**: covered by Finding 4 — `cachedRead` is
  simply not used anywhere yet.

> **Previously mis-stated here.** An earlier revision of this section listed
> the Codex stdout buffer as healthy, reasoning that V8's `SlicedString` makes
> `slice` O(1). That reasoning holds only when many complete lines arrive in a
> single chunk. It does **not** hold when one large line arrives in many
> chunks, because `buffer+=chunk` builds a `ConsString` that the next
> `indexOf` must flatten. That case is quadratic and is now **Finding 3**. The
> lesson for the next audit: this pattern has two regimes and only one of them
> is safe.

---

## Suggested order of work

1. **Finding 3** — the provider stream buffers. Four sites, one shape change
   each, and the measured win is 135× on a 16 MiB message with no behaviour
   change. This is the only finding that can freeze the UI for a third of a
   second, so it goes first despite being newer than the others.
2. **Finding 1 + 2** — cache the vault root, memoise path resolution, cache the
   note picker list. Highest user-visible win, contained change.
3. **Finding 9** — give the OpenCode event stream a connection timeout. Small
   change, but it removes a hang that wedges a whole turn.
4. **Finding 4** — `cachedRead`, hoisted leaf scan, bounded read concurrency.
5. **Finding 6** — `Set`-based dedupe in `linkTargets`. One-line change.
6. **Finding 5** — memoise the ancestor symlink check within `list()`.
7. **Finding 8** — TTL the primary-quota probe.
8. **Finding 10, 11** — cap and de-duplicate source collection in both bridges.
9. **Finding 12, 13** — replace the Codex poll with a callback; write the
   OpenCode workspace once.
10. **Finding 14 + 15** — DOM and scroll micro-optimisations.
11. **Finding 16** — only if the release policy can ship an extra asset.

Findings 1–13 are independent of each other and can be done in any order.
Findings 1 and 2 should be landed together, since the picker's win depends on
the memo. Finding 3 should be landed across all four bridge sites at once, so
the pattern does not linger in three of them.

---

## Verification status

- Baseline confirmed green before the audit: `npm run check`, `npm run lint`,
  `npm test` (140 passing). Re-confirmed green after the audit.
- Every number in this document was produced by `work/perf-bench.mjs`,
  `work/perf-bundle-load.mjs` or `work/perf-bridge-buffers.mjs`; raw output is
  in `work/perf-audit-result.txt` and `work/perf-bridge-buffers.mjs`.
- **No production source file was modified.** The only new files are the three
  benchmark harnesses under `work/` and this document. `git status` shows one
  untracked file: `PERFORMANCE-AUDIT.md`. (`work/` is git-ignored, which is
  where this project keeps its evidence.)
- The findings were **not** verified inside a running Obsidian instance. The
  DOM-level claims (Findings 14, 15) and the per-keystroke claim in
  Finding 2 are inferred from the Obsidian API contract in
  `node_modules/obsidian/obsidian.d.ts` plus the measured cost of the
  underlying operations. They should be confirmed with an in-app profile
  before being treated as release-blocking.
- Finding 3's buffer measurements use an exact replica of the
  `receiveChunk` code, not the live process. The replica was checked against
  the source line by line, and the *shape* of the fix was measured, but the
  fix has **not** been applied to the plugin.
- Finding 16's bundle-size numbers are exact (esbuild metafile); its
  plugin-enable saving is measured but small.
- **One conclusion was reversed during the audit.** The Codex stdout buffer was
  initially recorded as healthy and is now Finding 3. The correction and the
  reasoning error behind it are recorded in "Checked and found healthy" so the
  mistake is not repeated.
- Findings 9–13 were identified in a parallel review of the provider bridges
  and independently re-verified here by reading the cited lines and measuring
  the `sources` scan (Finding 10, 6.1 ms for 1,000 annotations).
