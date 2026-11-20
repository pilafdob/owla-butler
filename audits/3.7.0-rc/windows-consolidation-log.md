# Windows pass (round 2) — orchestrator consolidation log

Working log of cross-file work applied serially by the orchestrator after/while
agents ran. Feeds the final REVIEW-windows-hardening-pass.md.

## O1 — npm-shim → direct node launch for Claude (win-stream X1/D1 × win-failure WF1) — APPLIED

Problem: WF1's fail-closed control-char guard in spawnCli (correct — cmd.exe
truncates /c lines at CR/LF, probe-proven by both agents) refuses multi-line
--system-prompt through npm's claude.cmd shim; main.ts always appends \n
guidance, so most Claude turns via the npm install shape would throw.

Fix (root cause, conservative): src/claude.ts gains windowsShimScript() +
shimLaunch() — recognise ONLY the standard npm cmd-shim layout (quoted
"%~dp0\….js" target, node invocation, single unambiguous script, plain relative
path: no %, no drive letter, no .., no control chars, script must exist as a
file). Resolve → spawn node (local node.exe if present, else PATH node) with
[script,...args] — no cmd.exe, arguments verbatim. Anything unrecognised →
null → the existing guarded shim path (fail-closed refusal preserved).
Wired at all three launch sites: start() probes, handshake(), run().
Native claude.exe path unchanged; POSIX unchanged (platform-gated).
win-stream's absolute-path .mjs fake shim deliberately does NOT resolve, so
their cmd.exe mechanism coverage stays intact.

Tests: tests/audit-win-claude-shim.test.ts (6 tests: resolution, local node
preference, case-dedup, fail-closed matrix incl. traversal/%/drive/spanning
lines/missing/dir-target/no-node/non-shim/off-platform/unreadable, verbatim
multi-line argv mechanism probe, end-to-end ClaudeBridge.run through a real
npm-layout shim delivering the WHOLE 3-line prompt). All pass on this host.
win-stream's mechanism-agnostic regression stays green (now via delivery,
not refusal).

Residual risk (for the review doc): shim-layout drift across npm/Claude
versions falls back to the guarded refusal (safe, actionable error); not
verified against the real installed claude.cmd — live-vault check recommended
before release. Codex/OpenCode/Hermes pass no free text in argv (JSON-escaped
config / stdin / HTTP), so Claude was the only exposed provider.

## O2 — PDF cache wiring + binary-read retries + CRLF review display (win-attachments X-1/X-2/X-3) — APPLIED

Both owners (win-attachments: pdf.ts; win-perf: main.ts) finished; applied
their exact proposals serially to src/main.ts:
- X-1: `pdfCache=new PdfDocumentCache(2)` on ButlerView; `withPdfDocument`
  now lease-based (cache.open → read → release); `pdfCacheKey` (TFile
  path+size+mtime; external File identity); key threaded through readPdfPage
  and all three read_pdf call sites; destroyAll on newChat/stop/onClose;
  vault.on('modify') invalidation registered in onOpen (closes Windows
  same-ms/same-size mtime aliasing). Behaviour note: abort during a parse no
  longer cancels the parse instantly — it completes and is discarded on
  release (stop() invalidates); per-page abort checks unchanged.
- X-2: `readBinaryRetry` (≤3 attempts, 25/75 ms, only EBUSY/EPERM/EACCES)
  wired at readPdfBytes, addAttachments TFile branch, AND the annotation
  modal's freshness read (extra site found during application, same class).
- X-3: reviewText normalises via the existing tested noteText helper (CRLF
  canvas/excalidraw diff display); revealInNote compares noteText(text) so a
  CRLF file picks the right scroll version. LF inputs byte-identical.
- One TS fix during application: closure narrowing of this.file in the
  annotation modal → local const target.

Tests: NEW tests/audit-win-pdf-wiring.test.ts (7): continuation reuse (1 parse
for 2 reads), mtime miss, stop() destroys, external-File identity reuse,
password failure actionable + not cached, EBUSY retry (3 attempts), ENOENT
immediate (1 attempt). 7/7 pass; main-related suite 69/69 (security-main,
long-notes, visual-context, audit-win-perf, audit-win-main, pdf, pdf-cache);
tsc + eslint clean. The modify-event registration line is covered by the 13
cache unit tests + review (full onOpen needs DOM the stub lacks) — flag for
live verification.

## O3 — win-tools P1–P5 + win-perf P1/P4 + win-providers X1 — APPLIED

All owning agents finished; applied serially:
- main.ts P1: currentText resolves NTFS/APFS case-fold aliases ONLY when the
  filesystem itself resolves the path (statSync gate) AND the host is
  win32/darwin — on case-sensitive hosts a fold match could pick a different
  file. Canonical Obsidian spelling used for the read; exclusions stay
  fold-based (checked before resolution).
- main.ts P2: search_vault folder arg — backslash hint, leading/trailing
  slash trim, case-alias resolution via getAllFolders (same host gate),
  scoping by canonical prefix. Explicit `let folder:string` annotation
  (TS narrowing quirk on destructured let from Record<string,unknown>).
- main.ts P3: read_note metadata cache used ONLY on byte-exact saved===text.
  RECONCILIATION: win-perf F3 had added noteText(saved)===text to keep the
  cache fast path for CRLF notes; win-tools showed cache offsets may describe
  the RAW CRLF file, so slicing normalized LF text with them can misalign
  sections. Correctness wins for the RC: CRLF notes use the CRLF-safe pure
  finders (findSection/findBlock, fixed by win-tools F1); LF notes keep the
  fast path. win-perf's test updated to assert exact sections + no raw-offset
  slicing. Follow-up: verify Obsidian's offset convention live; if LF-based,
  the fast path can be restored.
- main.ts P4: 2 MB read-size cap before parse for read_note, read_canvas,
  read_base, read_excalidraw (staged previews exempt). Messages adjusted to
  be honest (heading reads also load the whole file, so "split the file"
  rather than "read a section").
- main.ts P5: propose_organization/propose_deletion reasons capped at 300
  chars (plugin-api convention; journal/UI token-leak surface).
- organization.ts (win-perf P1): open-note "Save open changes" comparisons
  normalize CRLF/lone-CR on both sides (deletion preview + organization
  review) — Windows CRLF open notes no longer false-positive.
- core.ts (win-perf P4): excludedCache bounded FIFO (32 entries).
- cli.ts (win-providers X1): findCliExecutable/defaultCliDirectories win32
  branches use win32.join (cross-host purity; runtime unchanged).

Tooling: the patch transport corrupted \r escapes in organization.ts regexes
again (real CR split the literals); repaired byte-exactly via a scratch Node
transform (4 literals, verified 0 stray CRs). Escape-sensitive edits should
avoid \r in patch parameters entirely.

Tests: NEW tests/audit-win-tools-wiring.test.ts (9): case-alias currentText
(host-gated), excluded-alias refusal, backslash hint, alias scoping, excluded
folder alias, read_note/read_canvas 2 MB caps, both reason caps. Batch run
128/128 (incl. updated audit-win-main, security-main, core, cli, organization,
providers-env, pdf-wiring); tsc + eslint (full src) clean.

## O4 — win-security P-W1..P-W5 + win-auto P1/P2 + win-failure X1 — APPLIED

All owners finished; final serial batch:
- validation.ts: untrustedToolText moved here from hermes.ts (byte-exact Node
  transform; hermes re-exports so existing imports/tests hold). Shared by all
  four bridges — no import cycle.
- cli.ts (P-W1): UNSAFE_EXECUTION_ENV += PATHEXT, PSModulePath (Windows
  resolution hijacks; unset falls back to system defaults). windir/SystemRoot
  deliberately kept (Windows APIs need them; validated separately).
- codex.ts (P-W2): redactDetail now delegates to shared redactErrorDetail
  (Windows home spellings/UNC redaction for ALL providers' pass-through
  errors). (P-W3): inheritedInstructions canonicalizes via realpathSync.native
  (junction ancestors can no longer hide an instruction file). (P-W4): tool
  results wrapped in untrustedToolText.
- claude.ts (P-W4): toolContent text blocks wrapped. opencode.ts (P-W4): /tool
  response text wrapped; (P-W5): both 32 MiB caps count UTF-8 BYTES
  (Buffer.byteLength), not UTF-16 units.
- main.ts (P-W4): standing untrusted_content rule appended to the shared
  instructions; hermes.ts's own append made idempotent (skips when the
  instructions already carry the rule) so Hermes never sees it twice.
- main.ts (win-auto P1): trimSelectionsForWindow wired into BOTH auto branches
  (cross-provider after relaxation; single-provider after candidates
  relaxation). Trim mutates the turn's selection copy + routingContext, replaces
  the SELECTED TEXT block in the payload, emits activity line + Notice.
  attachedContext (chat replay) captured pre-trim — bounded by the 64k replay
  cap, conservative (win-auto §4 follow-up). Fixed a typo in the proposal
  snippet (trim.e...ens → trim.estimatedTokens).
- hermes.ts (win-auto P2): hermesModelContextWindow accessor (models.dev
  limit.context, namespaced-id bare-key fallback, fail-closed on malformed)
  + context field in the model builder; routing already consumes
  model.context??200_000 (pinned by win-auto's test). (win-failure X1):
  sameMirrorPath case-fold comparison for mirror links (win32 only).

Test updates (P-W4 impact): claude.test.ts toolContent expectations now assert
the wrapper + an embedded-closing-tag escape regression; codex.test.ts NEW
receive()-level wrapper+escape test; opencode-bridge + audit-providers-opencode-
lifecycle echo regexes assert the full wrapper. One TS quirk: indexed access
on toolContent's union return needed a map/'text' in block rewrite.

## Final gates (post-O4, tree static)

- npm run check ✓ · npm run lint ✓
- Full suite ×2: run 1 738/736/1 fail (audit-providers-opencode-lifecycle
  "stopping during session creation" — 9/9 green isolated, load flake);
  run 2 **738 tests, 737 pass, 0 fail, 1 skip** (the designed Developer-Mode
  file-symlink assertion in security-vault).
- npm run build ✓ **990.9 KB** · npm run check:release ✓ · npm run guard:test ✓
- Baseline was 479 tests / 467 pass / 12 fail → +259 tests, all 12 baseline
  symlink-EPERM failures fixed, zero regressions.
- macOS preservation: git diff src/ocr.ts src/visual.ts = EMPTY (zero changes);
  darwin branches in attachments/cli/hermes untouched; FM routing intact
  (win-auto W6 spy-probed never spawned on win32; macOS wording byte-identical).

## O5 — independent-review fix cycle — APPLIED

Reviewer verdict on the full diff: passed=false, 0 security concerns, 6 logic
errors (security overhaul verified sound). All six fixed + S1 redaction
improvements; 12 new regressions in tests/audit-win-review-fixes.test.ts:
1. trimSelectionsForWindow: position-pinned splice (attachedStart passed at
   both call sites, slice-equality verified) + function-replacement fallback —
   vault-controlled $&/$'/$` can no longer undo the trim or duplicate prompt
   sections; decoy blocks in the active note cannot become the site.
2. writeEdit prepare: CRLF normalization gated to plain Markdown; raw-byte
   types (drawings/canvas/base) keep the EXACT freshness comparison so an
   open LF editor can never apply raw-CRLF offsets (fails safe as pre-diff).
3. chats.ts retryLocked: Atomics.wait (throws on Electron renderer main
   thread — Obsidian's home) → bounded Date.now busy-wait ≤2×25 ms.
4. noteGraph: alias fallback additionally requires the exact spelling to be
   unindexed (linkless indexed notes keep their own graph; case twins can't
   leak); notes() stays lazy for the scan-count contract.
5. Butler.resolvedVaultFile/resolvedVaultFolder shared by currentText, both
   2 MB cap sites and search_vault scoping (alias can't bypass a cap);
   organization.list() alias fallback gained the win32/darwin host gate.
6. findBlock: overlapping blank-line scan restores lastIndexOf('\n\n')
   ranges on odd runs (LF and CRLF), all platforms.
S1: UNC redaction (?<!:) keeps http(s) URLs readable; access_token/
refresh-token assignments redacted. S2/S3/S5/S6 deferred with designs
(review doc §5). Two CR-escape corruptions during this batch (note-tools
regex, writeEdit comment) repaired byte-exactly via scratch transforms.

Gates after O5: check ✓ lint ✓ **750 tests / 749 pass / 0 fail / 1 designed
skip** · build ✓ 991.5 KB · check:release ✓ · guard:test ✓. New test file
EOL-normalized to CRLF. Independent reviewer re-verifying the fixes (round 2).

## O6 — reviewer round-2 verdict + closing fixes — APPLIED

Round-2 verdict: **passed=true** (0 security concerns, 0 logic errors; all six
fixes verified in source and by execution; reviewer's own full-suite run
matched; non-fix diffs byte-stable; S2/S3/S5/S6 deferrals accepted).
Two new non-blocking suggestions closed immediately:
1. validation.ts: URL exemption moved to the '//' side only —
   /(?:\\\\|(?<!:)\/\/)…/ — colon-adjacent backslash UNC paths redact again.
2. main.ts trimSelectionsForWindow: fail-closed — if neither splice lands,
   payload/selections/estimate all stay untouched (compute next BEFORE any
   state mutation; trimSelectionsToWindow is pure, so reordering is safe).
2 regressions added (fix-cycle file now 14 tests).

FINAL GATES: check ✓ · lint ✓ · **752 tests / 751 pass / 0 fail / 1 designed
skip** · build ✓ 991.5 KB · check:release ✓ · guard:test ✓.
Handoff finalized: REVIEW-windows-hardening-pass.md §9 filled; root pointer
updated. Nothing committed.