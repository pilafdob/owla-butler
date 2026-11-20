# 3.7.0 RC — Windows failure handling & process lifecycle (win-failure)

Domain: cross-spawn `.cmd`/`.bat` shim launch, ComSpec/env case-insensitivity,
process kill & PID recycling, CRLF/stdio failure semantics, Codex detection &
connect-time death reporting, private-home links on Windows, recovery-journal
fs behaviour under Windows locks/attributes.

Scope of edits (ownership): `src/cli.ts`, `src/codex.ts`, `src/recovery.ts`;
tests `cli/codex/recovery/audit-failure-codex/audit-rc-cli/audit-rc-codex/
cli-security-audit` plus new `tests/audit-win-failure-{cli,codex,recovery}.test.ts`.
Read-only tracing: `src/main.ts` (clearPendingEdits, onload), `src/hermes.ts`
(mirror logic), `src/stream.ts` (RecordSplitter), installed
`node_modules/cross-spawn` (parse/escape/resolveCommand/readShebang/enoent),
`which`, `isexe`, `path-key`.

Method: full read of the round-1 failure-resilience report (F1–F17 verified
against current code before claiming anything) and REVIEW §4.5/§5; source read
of the installed cross-spawn chain; scratch probes on this Windows 11 host
(Node v24.14.0, Developer Mode OFF) under
`C:/Users/filip/AppData/Local/hermes/cache/scratch/win-failure/` — link
semantics, env-key casing, shim argument injection/truncation, kill semantics,
read-only rename, old-logic evidence. No live model turns, no provider daemon
contact, no vault mutations, read-only git, no build.

---

## Findings & fixes applied (owned files)

### WF1 — HIGH — CR/LF in a `.cmd`/`.bat` shim argument silently truncates the whole command line
- **File:** `src/cli.ts:243-255` (`spawnCli`). General bug, Windows-only path.
- **Evidence (probe-inject2.mjs):** cross-spawn wraps a shim as
  `cmd /d /s /c "<shim> <args>"` with `windowsVerbatimArguments`; its
  `escape.argument` (`node_modules/cross-spawn/lib/util/escape.js`) escapes
  cmd metacharacters but **not CR/LF**. An argument `x\ncmd /c echo injected >
  marker` arrived at the child as `x` — everything after the first CR/LF of the
  wrapped `/c` string is dropped (markers never created: truncation, not
  execution, on this host). For Codex the argv carries the `-c` isolation
  overrides; any future/unescaped value with a newline would silently drop the
  overrides after it. `integrationOverrides` JSON-escapes names today, so this
  is a latent fail-open in the shared launcher, not a live bypass.
- **Fix:** fail closed — on Windows shims, reject file/args containing C0
  control characters except tab (`SHIM_CONTROL_CHARS`, NUL is already rejected
  by Node). Platform-gated; POSIX argv (newlines legal) untouched.
- **Regression tests:** `audit-win-failure-cli` — “a Windows shim refuses
  control characters cmd.exe would misread” (LF/CR/CRLF/NUL/0x1F in args and
  file name; tab round-trips), “runCli rejects, never throws synchronously, on
  a corrupted shim argument”, “POSIX arguments with newlines still pass through
  untouched”.

### WF2 — MEDIUM — SystemRoot/ComSpec helpers miss uppercase keys in copied envs
- **File:** `src/cli.ts:135-147,189-199`.
- **Evidence (probe-links.mjs):** `Object.keys(process.env)` on this host
  yields `COMSPEC`, `SYSTEMROOT`, `WINDIR`, `PATH` (all uppercase).
  `process.env` itself is case-insensitive, but a **spread copy is not**:
  `sanitizedEnv` → `trustedComSpecPath(result)` → `windowsSystemDirectory`
  indexed `env.SystemRoot||env.windir` and missed `SYSTEMROOT`, falling back to
  `C:\Windows`. On default installs that aliases the real directory by luck;
  on a non-default Windows directory the pinned ComSpec/taskkill would point
  at a nonexistent path (shims fail, tree-kill degrades to the direct child).
  `shimInterpreterTrusted` indexed `env.ComSpec||env.comspec`, so a copied env
  carrying `COMSPEC=<hijack>` read as *unset → trusted*.
- **Fix:** case-insensitive key scans (the existing `envPath` rule), preserving
  SystemRoot-over-windir precedence and empty-is-unset semantics.
- **Regression tests:** “Windows system-directory and ComSpec rules read any
  key casing” (every host), “a copied Windows environment still pins ComSpec to
  the real system interpreter” (fails pre-fix on this host: pinned
  `C:\Windows\…` ≠ real `C:\WINDOWS\…`).

### WF3 — HIGH — private home keeps a hard link planted to another credential
- **File:** `src/codex.ts:155-180` (`ensureCodexPrivateHome`). Windows-specific:
  without Developer Mode, file symlinks are EPERM (probe-confirmed) and the
  product’s own fallback is `linkSync`, so hard links are the *normal* link
  shape in the private home — and `lstat` sees them as regular files.
- **Evidence (evidence-old-home.mjs):** the old logic (`!isSymbolicLink() →
  keep`) kept a hard link planted to `elsewhere`:
  `{"oldLogicKeptWrongCredential":true,"content":"attacker-credential",
  "sameIdentityAsUserSignin":false}`. The private home would sign in with the
  wrong credential.
- **Fix:** a regular file with `nlink>1` must share the user sign-in’s file
  identity (`ino`+`dev`, probe-verified stable on NTFS); otherwise it is
  unlinked and re-linked. `nlink===1` stays “OWLA’s own sign-in: keep”. A
  vanished/replaced source (stale hard link) is likewise replaced. POSIX
  behaviour is strictly stronger (planted hard links were kept there too).
- **Regression tests:** `audit-win-failure-codex` — “a hard link planted to
  another credential is replaced, never kept”; the adapted baseline test
  (below) exercises the same refusal through its EPERM fallback.

### WF4 — MEDIUM — case-fold aliases churned (and could drop) the sign-in link
- **File:** `src/codex.ts:159` (`samePath`).
- **Evidence:** NTFS resolves paths case-insensitively (probe: `AUTH.JSON`
  alias → same `ino`). The old `readlinkSync(target)===from` string equality
  unlinked/re-created a valid link whenever the stored casing differed (e.g.
  `CODEX_HOME` casing drift between connects). If re-creation then failed
  (EPERM symlink + EXDEV cross-volume hard link) the sign-in link was lost.
- **Fix:** on win32 compare `win32.normalize(...).toLowerCase()`; POSIX keeps
  exact equality. Junctions planted as auth files already met the
  `isSymbolicLink` branch (probe: junction `lstat` reports symlink, `readlink`
  names the dir ≠ the file path → replaced; `unlink` leaves the target intact).
- **Regression tests:** “a case-fold alias of the sign-in path does not churn
  the link”, “the hard-link fallback keeps one rotating credential” (rotation
  through the user’s file reaches the private name; second ensure keeps the
  same `ino`), “a junction planted as a sign-in file is replaced by the real
  link” (runs on both platforms).

### WF5 — HIGH — journal stat failure read as empty → recovery deletes the journal
- **File:** `src/recovery.ts:37-52,66-75` (`readPendingRecord`,
  `loadPendingEdits`). The round-1 F3 data-loss class re-entering through a
  Windows lock: `existsSync` true + `statSync` EBUSY/EPERM (Defender/OneDrive/
  indexer) → old `catch{return []}` → `main.ts:727-743` `clearPendingEdits`
  sees zero entries, takes the success branch and **deletes the journal**
  (traced read-only in main.ts). `loadPendingEdits` also let raw stat errors
  escape unworded.
- **Fix:** stat-first; `ENOENT` → `[]` (missing is normal, incl. a vanished
  file race); any other error throws “The pending edit record could not be
  read: <cause>” — fail closed, file preserved for manual recovery. Parse
  behaviour unchanged (corrupt JSON → `[]` in the raw reader, round-1 decision).
- **Regression tests:** `audit-win-failure-recovery` — “an unreadable journal
  fails closed instead of reading as empty” (POSIX EACCES via chmod 0o000; the
  branch is shared with the Windows lock codes — an ACL-denial fixture is the
  Windows analogue, noted), “a missing journal reads as empty on every host”,
  “the oversized journal still fails closed and survives” (F3 guard re-proven).

### WF6 — MEDIUM — journal save fails on a read-only target (OneDrive/sync attribute)
- **File:** `src/recovery.ts:103-115` (`savePendingEdits`).
- **Evidence (probe):** `renameSync` onto a read-only file → **EPERM** on
  Windows (onto a directory also EPERM; onto a writable file ok). The journal
  is rewritten on every edit decision, so a sync tool setting the read-only
  attribute would block all pending-edit saves.
- **Fix:** win32-gated single retry: on EPERM/EACCES clear the attribute
  (`chmodSync(file,0o666)`) and rename once; any retry failure rethrows the
  **original** error; temp cleanup and wrapping unchanged. POSIX path
  byte-identical (rename there ignores the target’s mode).
- **Regression tests:** “a read-only journal is still replaced atomically”
  (fails pre-fix on Windows), “a journal locked against replacement keeps the
  cause and no temp file”.

### WF7 — LOW — log rotation throws on a locked/undeletable previous log
- **File:** `src/recovery.ts:15-26` (`rotateLog`).
- **Evidence:** `unlinkSync` of `.previous` throws EPERM/EISDIR/EBUSY when it
  is a directory or held by an indexer/AV; rotation runs at runtime start and
  must never fail it. (No src caller today — exported API; fixed defensively.)
- **Fix:** best-effort try/catch; success path unchanged.
- **Regression test:** “log rotation never fails the runtime when the previous
  log is undeletable” (directory `.previous`; current log preserved). Existing
  rotation test still green.

### WF8 — LOW — tree-kill fallback re-checks exit state; killer unref’d
- **File:** `src/cli.ts:279-291` (`terminateProcessTree`).
- **Evidence (probe-kill.mjs):** `child.kill` after exit returns `false`
  (handle-based — no PID-recycling hazard); `taskkill /PID` on a verified-free
  PID exits **128** “process not found” → the fallback fires; SIGTERM on
  Windows terminates unconditionally (handler never ran; `signal:'SIGTERM'`).
  The entry guard already skips exited children; the fallback could still run
  after the child exited while taskkill was in flight.
- **Fix:** fallback re-checks `exitCode/signalCode` before `child.kill`;
  `killer.unref()` (fire-and-forget). Entry guard, validated
  `trustedTaskkillPath`, `existsSync` gate, sync-throw guard (F16) and the
  POSIX group-kill branch unchanged.
- **Regression tests:** “terminateProcessTree never targets an exited child,
  even via the fallback” (fake exited/signaled children, every host), “without
  a usable taskkill PID the direct child is the fallback”; existing real
  Windows tree-kill + POSIX detached-group tests still green.

### BASELINE FIX — tests/codex.test.ts:440 (the 12-failure root cause, my share)
“Codex runs in a private home linked only to the user’s sign-in” failed EPERM
on the file-symlink fixture. Applied the brief’s recipe:
- link assertions now accept **symlink-naming-source OR hard-link identity**
  (`nlink>1`, same `ino`/`dev`) — the property “linked, never copied” is
  asserted on every host, nothing skipped;
- the planted “link elsewhere” fixture attempts `symlinkSync` and on EPERM
  plants a **hard link to a different real file** — which additionally
  exercises WF3’s refusal;
- every other assertion (own-sign-in keep, AGENTS.md plant, `userCodexHome`
  rules) runs unchanged; POSIX assertions not weakened.

### Windows coverage enabled — tests/audit-rc-codex.test.ts
The four process tests (exhaustion record/clear, start-rejection, cross-page
dedup) were `if(process.platform==='win32')return;` skips with a `#!/bin/sh`
fake. The fake now launches through a **`.cmd` shim on Windows** (npm’s shim
shape, same harness as audit-failure-codex) and the skips are removed — all
four execute on Windows (17/17 in that file group).

---

## Audited and found sound (no change)

- **cross-spawn ComSpec resolution:** `parse.js:58`
  `process.env.comspec || 'cmd.exe'` — the PARENT’s env, case-insensitive via
  Node’s proxy. `withPinnedShimInterpreter` pins the validated system cmd.exe
  when unset/empty and restores it; a hijacked ComSpec refuses the shim before
  spawn. End-to-end tests: “a hijacked ComSpec refuses the shim end-to-end;
  unset or empty is pinned”.
- **PATHEXT:** `which` resolves an absolute shim with `pathEnv=['']` (no PATH
  search) and the second `resolveCommand` attempt bypasses the extension
  check, so a hijacked PATHEXT can neither redirect nor break shim launch;
  OWLA discovery uses its own fixed `.com/.exe/.bat/.cmd` list. Test: “a
  hijacked PATHEXT neither redirects nor breaks shim discovery and launch”.
- **CRLF intake:** `RecordSplitter('\n')` + `line.trim()` handles `\r\n` and
  lone `\r`; `stderrCause` trims; version `.trim()`. Proven with a CRLF fake
  app-server: “CRLF protocol lines complete the Codex handshake”, “CRLF stderr
  keeps the bounded last-error cause without stray carriage returns”.
- **Connect-time death reporting (F2) under Windows spawn errors:** a shim
  whose target is missing rejects with the real cause (`Cannot find module`),
  never “cancelled” — new test on both platforms; exit-stderr/silent-exit/
  bad-json/turn-exit already run through `.cmd` shims (audit-failure-codex).
- **stdio error classes (F1):** default listeners in `spawnCli`; EPIPE mid-write
  test green on Windows; bounded 4000-char stderr tail intact.
- **OEM code pages:** Node’s `TextDecoder` lacks `ibm437` (probe: unsupported);
  `windows-1252` exists. UTF-8 `setEncoding` maps invalid OEM bytes to U+FFFD —
  bounded, never crashes; Rust CLIs emit UTF-8 when piped. See D3.
- **recovery:** atomic temp+rename, best-effort retention (F14), oversized
  fail-closed (F3) all re-verified; journal names are short and Node/libuv
  handles long paths transparently (a >32k-char probe tree was created but is
  impractically slow to delete on Windows — no product change warranted).
- **main.ts:** `loadPendingEdits` throw handled at onload (`main.ts:108-112` →
  `pendingLoadError`); `clearPendingEdits` rejection surfaces via Notice
  (`main.ts:2086-2088`). No change needed.

## Cross-file proposals (orchestrator applies serially) — 1

### X1 — LOW — `src/hermes.ts:537`: case-fold mirror-link comparison
Same class as WF4 (churn only — Hermes’ copy fallback prevents link loss, and
its `unlinkMirror` already refuses `nlink>1`, so no credential-confusion gap).
`win32` is already imported. Old:
```ts
      if(readlinkSync(target)===source)kept=true;
```
New (module-scope helper near `unlinkMirror`, then use it):
```ts
const sameMirrorPath=(a:string,b:string)=>process.platform==='win32'?win32.normalize(a).toLowerCase()===win32.normalize(b).toLowerCase():a===b;
// …
      if(sameMirrorPath(readlinkSync(target),source))kept=true;
```
Rationale: a `HERMES_HOME`/user-home casing drift between connects currently
unlinks/re-mirrors every entry (junctions/copies included). Test impact:
existing hermes private-home tests unchanged; add a win32 case-fold alias test
mirroring “a case-fold alias of the sign-in path does not churn the link”.

## Deferred items (risk tier + design)

- **D1 — TMPDIR/TEMP/TMP pinning (CAREFUL, behaviour change; round-1 §4.5
  deferral upheld).** Windows `%TEMP%`/`%TMP%` are already per-user; the L9
  concern is a redirected temp choosing where a child writes scratch files.
  Design: in `sanitizedEnv`, when `keepCredentials=false`, create
  `<defaultStorageDirectory()>/tmp/<provider>` (0o700) and set
  `TMPDIR`+`TEMP`+`TMP` to it; destroy on unload. Risks that keep this out of
  this pass: CLIs use temp for IPC/lockfiles (Claude, git), cross-volume EXDEV
  when a tool moves temp→home, and cleanup of a running child’s scratch. Needs
  live-CLI verification per provider, not a unit-test-only change.
- **D2 — bounded retry for transient EBUSY journal locks (CAREFUL).** WF6
  covers the deterministic read-only case; a true sharing-violation retry
  needs a delay, and the sync APIs cannot sleep without blocking the renderer
  (`Atomics.wait`). Design: async `savePendingEditsAsync` (3 attempts, 50/150 ms
  backoff on EBUSY/EPERM/ENOTEMPTY) with `main.ts` callers migrated, or a
  caller-side retry in the edit-accept flow. API-change decision required.
- **D3 — OEM-codepage stderr decoding (LOW).** Node lacks `ibm437`/`cp850`
  TextDecoder support; a hand-rolled 256-byte cp437 map (no new deps) could
  decode cmd.exe’s own OEM messages when the UTF-8 tail is mostly U+FFFD.
  Current behaviour is safe and bounded; diagnostic polish only.
- **D4 — PID-recycling race window (residual, inherent).** Between the entry
  guard and taskkill’s `TerminateProcess` the child can exit and Windows can
  reuse the PID. Mitigated by entry + fallback exit re-checks and the
  handle-based `child.kill`; closing it fully needs a handle-based tree kill
  (not available via taskkill; tree-kill shares the semantics). Documented.

## Verification (final tree state)

| Gate | Result |
|---|---|
| `npm run lint` (eslint src) | ✓ clean |
| `npm run check` (tsc --noEmit) | ✓ my files clean; residual errors only in sibling WIP (`src/canvas.ts` run 1, `src/pdf.ts` runs 2–3 — fluctuating, not owned) |
| Owned + new test files (10) | ✓ **125/125** |
| Full suite run 1 | 678 tests, 669 pass, **8 fail** — all sibling-owned |
| Full suite run 2 (final) | 700 tests, 687 pass, **12 fail** — all sibling-owned |
| `npm run build` | not run — orchestrator builds |

Residual failures attributed (run 2; the set changed between runs — active
sibling WIP, re-run per brief rule 7): `audit-rc-opencode` (foreign session
events, silent-early-death retry, disconnect-during-startup retry),
`audit-win-providers-lifecycle` / `audit-win-stream-claude` (oversized
CRLF/handshake reap), `audit-win-tools-crlf` (findBlock ×2, noteHeadings),
`audit-win-tools-graph` (150-huge-values property query),
`audit-win-tools-organization` (case-fold list/preview ×2), `security-vault`
(case-fold alias; file mid-rewrite by its owner — a targeted re-run showed a
different, larger failure set minutes earlier). **None in owned files.**

Baseline status: the 12 fan-out symlink failures are converging —
`codex.test.ts:440` fixed here; `security-main`/`hermes` private-home tests no
longer fail in full runs (owners landed fixes); `security-vault` is mid-fix by
its owner. No owned test was weakened; all round-1 fixes (F1–F17) verified
present and green before this pass’s changes.

Files modified: `src/cli.ts`, `src/codex.ts`, `src/recovery.ts`,
`tests/codex.test.ts`, `tests/audit-rc-codex.test.ts`
(115 insertions / 28 deletions). Files created:
`tests/audit-win-failure-cli.test.ts`, `tests/audit-win-failure-codex.test.ts`,
`tests/audit-win-failure-recovery.test.ts`, this report. Scratch probes
(links/inject/kill/mock/evidence) ran under the agent scratch dir only; the
long-path probe residue was removed; nothing probe-related remains in the repo.

Not verified live: no running-Obsidian exercise (no build per instructions);
fake-CLI process tests cover spawn/exit/protocol paths, not the rendered UI.
The shim-truncation probe showed discard, not execution, on this host — other
cmd.exe parsing contexts could differ, which is why WF1 fails closed on all
C0 controls rather than only the demonstrated pair.
