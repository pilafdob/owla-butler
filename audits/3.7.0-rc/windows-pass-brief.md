# Windows hardening pass (round 2) — shared agent brief

Read this fully before doing anything. You are one of 8 parallel agents hardening
OWLA Butler 3.7.0-RC for **Windows**. Your spawn context names your domain, owned
files and report path. This brief is the common contract.

## Project & state

- Repo: `C:\Users\filip\Documents\Coding\owla-butler` — Obsidian sidebar plugin
  bridging four agent CLIs: Codex, OpenCode, Claude Code, Hermes. TypeScript,
  esbuild bundle, `node --test` + tsx, eslint (incl. eslint-plugin-obsidianmd).
- Branch `3.7.0-RC`, base commit `81540fb` (clean at fan-out). Round 1 (7 general
  audit agents + orchestrator pass) already landed in that commit. Read
  `audits/3.7.0-rc/REVIEW-rc-hardening-pass.md` §5 (deferred follow-ups) and your
  domain's round-1 report (named in your spawn context). Do NOT redo landed
  fixes; verify against current code before claiming anything.
- Host: Windows 11, **git-bash** shell (POSIX syntax; native tools like
  node/git/rg need `C:/...` forward-slash paths, not `/c/...`). Node v24.14.0,
  npm 11.9.0, node_modules installed. **Developer Mode is OFF**: creating file
  symlinks fails EPERM; directory **junctions** (`symlinkSync(target,path,'junction')`)
  and **hard links** (`linkSync`, same volume) work unprivileged.

## Baseline gates (measured at fan-out)

- `npm run check` ✓ · `npm run lint` ✓ · `npm run build` ✓ (975.3 KB; orchestrator-only).
- Full suite: **479 tests, 467 pass, 12 fail**. ALL 12 failures are the same
  pre-existing Windows root cause: test fixtures call `fs.symlinkSync` on FILES
  in before-hooks → EPERM without Developer Mode. Affected:
  `tests/security-vault.test.ts` (hook kills whole file), `tests/security-main.test.ts`
  (9 tests, hook at line ~45), `tests/codex.test.ts:440` ("Codex runs in a private
  home linked only to the user's sign-in"), `tests/hermes.test.ts:239` ("Hermes
  private home … planted link"). Owners of those files fix them (see below).
  Until then, treat exactly these as pre-existing, not regressions.

## Mission

Find and FIX Windows-specific bugs, plus general bugs that bite on Windows, in
your owned files. Where round-1 §5 deferred items fall in your domain and are
safely doable, do them; otherwise leave a concrete design. Every fix gets a
regression test. Prefer small, surgical, well-tested changes; risky/large items
go in your report as deferred with a design, not half-applied.

Windows angles to check where relevant to your domain:
- CRLF (`\r\n`) in streams, protocols, notes, diffs; lone `\r`; chunk boundaries.
- Paths: backslashes, drive letters, UNC, `>260` chars, spaces in user names,
  OneDrive-redirected Documents, case-insensitive NTFS (case-fold aliases!),
  `path.win32` vs `path.posix` misuse, URI/URL encoding of Windows paths.
- Process launch: cross-spawn `.cmd`/`.bat` shims use the PARENT's
  `process.env.comspec || 'cmd.exe'` (read installed `node_modules/cross-spawn`
  source to confirm); Windows env vars are CASE-INSENSITIVE (`ComSpec`/`comspec`);
  `PATHEXT`, `.exe` vs `.cmd` vs npm shims, PATH search order.
- Process kill: no real SIGTERM on Windows (Node terminates unconditionally);
  `taskkill /T /F` tree kill; **PID recycling — never target a PID after its
  child exited**; detached groups vs Windows semantics; zombie handles.
- fs: EBUSY/EPERM/ENOTEMPTY (Defender/OneDrive/indexer locks), retry semantics,
  junctions vs symlinks (`lstat`/`readlink` behaviour on junctions), hard links
  (`nlink>1`), alternate data streams, read-only attributes.
- Env sanitization: Windows hijack vectors (ComSpec, PATHEXT, PSModulePath,
  windir/SystemRoot casing, `GIT_*`, etc.); keep provider credentials that are
  read from env by design (documented contracts in tests/provider-isolation.test.ts).
- Network: loopback binding, Windows excluded port ranges
  (`netsh interface ipv4 show excludedportrange protocol=tcp`), firewall prompts,
  EADDRINUSE races.
- Console/code page: UTF-8 vs OEM code page output from CLIs; smart quotes.

## Hard rules

1. **Never remove or degrade macOS-specific functions or supporting code**:
   macOS Vision OCR (`src/ocr.ts`), Apple Foundation Models (`fm`) routing,
   darwin branches, POSIX process-group kills. Keep both platforms working.
   Windows fixes must be platform-gated or platform-parameterized; where you
   touch shared logic, add/keep a test proving POSIX behaviour is unchanged.
   In platform-parameterized helpers derive separators from the `platform`
   PARAMETER, never `path.sep`/`path.delimiter`/`process.platform` (host leaks
   into cross-host assertions).
2. Read-only git: `status/diff/log/show` only. NO add/commit/push/stash/checkout/
   reset/restore. The orchestrator handles staging.
3. Do NOT run `npm run build` (orchestrator builds). Allowed gates:
   `npm run check`, `npm run lint`, tests.
4. No live model turns, no real provider daemon contact, no Obsidian vault
   mutations. Read-only probes of real files are OK. Process probes only with
   harmless local commands (node -e, cmd /c echo, fake CLI scripts you write)
   under your scratch dir `C:/Users/filip/AppData/Local/hermes/cache/scratch/<yourname>/`.
5. Never read/print `.env` or credential files. In tests build fake secrets by
   concatenation (`'oc-'+'key'`) — a secret scrubber mangles `KEY=***` literals
   in tool arguments.
6. **Ownership**: edit ONLY your owned src files, your owned test files, and new
   files you create (new tests: `tests/audit-win-<domain>*.test.ts`, new report:
   your named path). `src/main.ts` is REPORT-ONLY for everyone except the
   perf/main agent. `tests/helpers/*` are report-only for everyone. Any change
   needed elsewhere → exact proposal (file, location, old/new snippet, rationale,
   test impact) in your report; the orchestrator applies cross-file work serially.
7. Siblings edit other files concurrently. Transient check/test failures from
   sibling WIP happen: re-run before concluding, and report final state honestly.
   If a file you don't own breaks your run, note it and move on.
8. Match existing code style (dense, compact TS in places). No drive-by
   refactors, renames or reformatting. No new dependencies.
9. Do not edit this brief, other agents' reports, or living root docs
   (CHANGELOG/README/etc.) — orchestrator-owned.

## Symlink-fixture fix recipe (for owners of the 4 affected test files)

Goal: security assertions still EXECUTE on Windows, not skip.
- Replace file-symlink fixtures with hard links (`fs.linkSync`) where the test
  is about hard-link/alias refusal — same security property, unprivileged.
- For directory-link cases use junctions (`symlinkSync(target, path, 'junction')`).
- Where a genuine FILE SYMLINK is the property under test, attempt it and on
  EPERM fall back to a junction-to-dir variant or mark that one assertion
  `{skip: 'needs Windows Developer Mode'}` — but keep every other assertion
  running. Never weaken what is asserted on POSIX.
- ALSO check the PRODUCT code those tests exercise: does the refusal/validation
  logic actually catch Windows junctions and hard links (lstat on junctions,
  `nlink>1`, case-fold aliases on NTFS)? Fix product gaps in your owned src
  files with tests; propose cross-file gaps.

## Verification protocol (before finishing)

1. `npm run check` and `npm run lint` — must be clean for YOUR files (siblings'
   transient errors: re-run, then note).
2. Targeted: `node --import tsx --test tests/<file>.test.ts` for each touched/new file.
3. Full suite, compact:
   `node --import tsx --test --test-reporter=tap tests/*.test.ts 2>&1 | grep -E '^# (tests|pass|fail)|^not ok'`
   Expected end state: 0 failures except known sibling-WIP transients (re-run)
   and the pre-existing symlink failures until their owners land fixes.
4. Record counts + any residual failures with attribution in your report.

## Report (your deliverable besides code)

Write `audits/3.7.0-rc/<your report filename>` with:
- Scope & method; what you read from round 1.
- Findings: severity, `file:line`, why Windows-specific (or general), evidence
  (probe output, measurements, repro).
- Fixes applied: per-fix rationale + regression test name; behaviour preserved.
- Cross-file proposals: exact patches for files you don't own (incl. main.ts).
- Deferred items: risk tier + concrete design.
- Verification: gate results, test counts, residual failures attributed.
Final answer back to orchestrator: concise summary — fixes count, headline
fixes, gate status, report path, cross-file proposal count. Keep it under ~300
words; the detail lives in your report.