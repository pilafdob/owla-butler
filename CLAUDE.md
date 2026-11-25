# OWLA Butler — agent instructions

Follow CONTRIBUTING.md for the toolchain, gates and branch rules (`OWLA-RC` is the development line; nothing merges into it).

## Cloud sessions are for writing code, not for release verification

Cloud sessions run on Linux, as root, without Obsidian. Linux is not an officially supported platform, so a green run here does not show that a change works for users.

What a cloud session can verify: `npm run check`, `npm run lint`, `npm test`, `npm run guard:test`, `npm run build` and `npm run check:release` (the CI gates). The tests run against stubs and fake providers (`tests/helpers/obsidian-stub.cjs`, `tests/fixtures/fake-*.mjs`); passing them only means the code behaves correctly against those fakes.

What a cloud session cannot verify, and so must never report as tested:

- Anything in a running Obsidian app: UI, layout at 240/280/360/600 px panes, Electron, editor diffs, reviewed edits, Undo, real vault behaviour, process lifecycle.
- Real provider connections (Codex, OpenCode, Claude Code, Hermes Agent), tool turns, cancellation and reconnect.
- macOS- and Windows-specific behaviour. These tests are skipped on Linux and only run on those hosts:
  - case-insensitive filesystem / NTFS case folding (case-alias reads, `read_note` size cap via alias, `search_vault` canonical folder, private-home sharing, saved-chat duplication);
  - Windows npm-shim resolution (multi-line Claude prompts, `node.cmd` lookup), `SystemRoot` trust, Windows launcher discovery and `PATH` probing.
- The unreadable-journal recovery test in `tests/audit-win-failure-recovery.test.ts`, which is skipped when running as root (root ignores permission bits).

## Before any release

Before a new release is tagged or published, the full test suite and the checks above must be run locally on macOS and on Windows: `npm test` on each host (so the platform-gated tests actually execute, as a non-root user), plus the live checks in a disposable test vault listed in CONTRIBUTING.md, TESTING.md (including "Windows release checks still required") and COMMUNITY-RELEASE.md. Record the results in TESTING.md. A cloud or Linux run alone is never sufficient for a release.
