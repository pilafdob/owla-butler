# OWLA Butler — Windows test & audit report

Host: Windows 11, Obsidian 1.15.1, vault `C:\Users\filip\Documents\Coding\Test`.
Date: 2026-11-17. Plugin version audited: 3.6.0, released as patch 3.6.1.

## 1. Bottom line

The original report — "Excalidraw support and canvas view not working on Windows" —
is **not a code defect**. The test vault had OWLA **3.1.2** installed, which
predates those features entirely: Canvas/Bases/Excalidraw were added in **3.5.0**.
Upgrading the vault to 3.6.0 and enabling Plugin Interconnectivity makes the
features available; three independent audits of the visual code against the real
Obsidian `app.js` found no Windows-specific bug.

The audit did, however, uncover **genuine Windows bugs elsewhere**, now fixed.

## 2. What was tested

- Full static suite: `tsc --noEmit`, `eslint src`, `esbuild` build, vault-guard
  self-test, release check — all clean.
- Full test suite: 320 tests, 302 pass, 18 fail. The 18 failures are identical to
  the untouched tree (311/293/18): every one is an `EPERM` from `symlinkSync` in
  a test `before()` hook (Windows needs Developer Mode/admin for symlinks). They
  fail before any assertion and are test-fixture issues, not product bugs.
- Live app: upgraded the disposed test vault from 3.1.2 to the rebuilt 3.6.0
  (`main.js`/`manifest.json`/`styles.css`), reloaded Obsidian, confirmed the new
  bundle is what the app executes (`3.6.0` present in the runtime copy), enabled
  Plugin Interconnectivity and Background screenshots (persisted in `data.json`),
  and created a JSON Canvas with nodes and an edge for the read path.
- Environment facts verified directly: `opencode v2.2.7`, `codex-cli 0.147.0`
  installed; `hermes` present; Canvas + Bases core plugins enabled; Excalidraw
  community plugin not installed (so its feature is correctly gated off).

## 3. Findings and fixes

### Not a bug — Canvas / Excalidraw (the original report)
3.1.2 contained zero occurrences of `read_canvas`/`read_excalidraw`/`visualFeatures`;
3.6.0 contains them. `internalPlugins.plugins[id].enabled` is exactly what
Obsidian 1.15.1's own `getEnabledPluginById` checks. My initial change to
`internalPlugins.config[id]` was wrong and was reverted; a regression test
(`tests/visual-availability.test.ts`) now pins the correct shape.

### Real bugs fixed
1. **Hermes PATH separator** (`src/hermes.ts`): hard-coded `:` broke Windows;
   now uses `extendedPath` (`;` on Windows, `:` elsewhere).
2. **Hermes PATH casing** (`src/cli.ts`, `src/hermes.ts`): Windows often stores
   PATH as `Path`; a spread of `process.env` is case-sensitive, so `env.PATH` was
   undefined. New `envPath()` reads it case-insensitively.
3. **Hermes private home** (`src/hermes.ts`): mirroring auth/state via
   `symlinkSync` silently failed with EPERM on ordinary Windows, so Hermes
   appeared signed out. Now falls back to a bounded, link-safe copy.
4. **Unset ComSpec** (`src/cli.ts`): cross-spawn reads `process.env.comspec` in
   the parent; an unset value fell back to a PATH-resolved `cmd.exe`. Now pinned
   to the validated system interpreter for the synchronous spawn and restored.
5. **Redirected SystemRoot** (`src/cli.ts`): the system directory used to locate
   cmd.exe and taskkill.exe is now validated (absolute, no traversal, real
   cmd.exe present), with a safe `C:\Windows` fallback.
6. **Unrelated credentials** (`src/cli.ts`): Windows children drop GitHub/AWS/npm
   and similar tokens. Other platforms and OpenCode's `keepCredentials` are
   unchanged.
7. **Excluded folders with backslashes** (`src/core.ts`): a Windows-entered
   `Private\Sub` silently failed to exclude; the setting is now normalised to
   forward slashes.

Regression tests added for the detection shape, `envPath`, and backslash
exclusions. `CHANGELOG.md` and `AUDIT.md` updated.

### Known limits left unchanged
- Storage defaults to `%LOCALAPPDATA%\OWLA Butler`; a redirected profile folder
  on a network share also receives saved chats (which contain sent vault text).
- `foldPath` applies APFS-style Unicode folding on every platform, so on NTFS
  distinct folders `Straße` and `Strasse` can both be excluded — conservative
  over-exclusion, not a containment escape.
- `isPathInside(root, file, platform)` resolves non-`win32` branches with the
  host's `node:path`; an explicit foreign platform on Windows is mishandled, but
  no production caller passes it.

## 4. Files changed
`src/cli.ts`, `src/core.ts`, `src/hermes.ts`, `tests/cli.test.ts`,
`tests/core.test.ts`, `tests/visual-availability.test.ts` (new), `AUDIT.md`,
`CHANGELOG.md`. The test vault's old build is backed up in
`.obsidian/plugins/owla-butler/_backup_3.1.2/`.
