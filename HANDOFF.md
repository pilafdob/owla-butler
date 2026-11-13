# Handoff — OWLA Butler 3.1.2 patch release

Written 2026-11-13 for the OpenCode agents picking this up. Read `AGENTS.md` first; its rules override anything here.

## Where things stand

The security and performance audits from OpenCode sessions `ses_e2a8b00a7fferlSc9ona45OM2S` (security) and `ses_e2a8a9644ffe2UnfQDgzTFM30d` (performance) are **implemented and staged, not committed**. The work is described in `AUDIT.md` → "Security and performance hardening — 2026-11-13". The performance report is `PERFORMANCE-AUDIT.md`.

Staged files: `AUDIT.md`, `PERFORMANCE-AUDIT.md`, `src/{claude,cli,codex,core,main,opencode,organization,stream}.ts`, `tests/{codex,core,opencode-bridge,opencode,provider-isolation,stream}.test.ts`.

Gates at handoff, all green: `npm run check`, `npm run lint`, `npm test` (148 pass), `npm run build`, `npm run guard:test`, `npm run check:release` (still 3.1.1).

What changed, in one line each:

- OpenCode: project/ancestor config discovery off (`OPENCODE_DISABLE_PROJECT_CONFIG=1`); OWLA's config moved to `<session>/config/opencode/opencode.json`; the old project `opencode.json` is deleted on connect.
- OpenCode: tools allowed by exact name (`owla_read_note`, …), not `owla_*`.
- OpenCode tool callback: refuses tools not offered this turn, constant-time token check, timeouts, connection cap.
- OpenCode event stream: bounded open (20 s), cancellable, fails the turn if it closes early; replies and events capped at 32 MiB.
- Child environments (`sanitizedEnv` in `src/cli.ts`): every provider drops `NODE_OPTIONS`, `LD_PRELOAD`, etc. Codex and Claude Code also drop OpenAI/Anthropic keys and endpoint overrides; OpenCode keeps provider keys.
- Codex: re-checks isolation before every turn; refuses to connect with an `AGENTS.md` between the session folder and home.
- Excluded folders match case- and Unicode-insensitively.
- Performance: linear stream splitter (`src/stream.ts`) at all four readers; vault root resolved once; note picker checks the vault once per opening.

## Rules for this handoff

- **Never** `git push`, `git commit`, `git checkout --`, `git restore`, `git reset`, `git clean` or `git stash`. Commit and tag are the owner's steps.
- Other agents share the tree. Run `git status` before and after every edit; anything you did not change is someone else's.
- Do not touch the user's real vault. The test vault is `…/Agentbrain/OWLA Butler Test`, and only with the owner's go-ahead.
- Free OpenCode models share one limit and were **exhausted** at handoff. Keep the live check to one request. If you hit the limit, stop and report; do not retry in a loop.

## Task 1 — live OpenCode tool turn (release blocker)

**Why:** the exact-name permission rule is covered only by unit tests. If OpenCode's permission action for a plugin tool is not `owla_<tool>`, every OWLA tool is denied and OpenCode is broken for users. The old wildcard relied on the same prefix, so this is likely fine, but it is unverified.

**Do:**

```sh
node --import tsx work/live-opencode-turn.mts
```

The script (gitignored, in `work/`) starts the real bridge in a temp folder, plants a plugin above it, runs one free-model turn asking the model to call `owla_read_note`, and returns a canary string from a fake tool. It does not touch any vault.

**Pass:** prints `PASS`, i.e. the tool was called as `read_note`, the reply contains `CANARY-7f3a`, and the ancestor plugin did not run.

**If it fails with a permission denial:** look up the real action name. Run a turn with a temporary `{action:'*',resource:'*',effect:'allow'}` rule *in a local scratch copy only* and read the action name OpenCode reports, then fix `opencodePermissions` in `src/opencode.ts` and its test in `tests/opencode.test.ts`. Do not ship a wildcard.

**If it fails with a usage limit:** record that in `TESTING.md` and tell the owner. The release then waits, or ships with this limitation stated in `AUDIT.md` (owner decides).

Record the outcome, model ID and OpenCode version in `TESTING.md` under a new dated section.

## Task 2 — documentation corrections

Small, targeted edits:

1. `TESTING.md:17` says every OpenCode check ran with data, config, state and cache redirected to `/tmp`. That describes the verification harness. Add one sentence saying the shipped bridge redirects only the config folder, and that OpenCode's global `opencode.db` holds OWLA sessions until the end-of-turn delete. Do not delete history.
2. `README.md:102`: the claim that OpenCode gets none of the user's plugins or MCP servers is now true, including plugins in folders above the session folder. Check the wording still matches; no change needed if it does.
3. `README.md:73` ("never given … your credentials"): the *model* is not given credentials, which is still true. OpenCode's own process keeps provider keys by design. Leave as is unless the wording implies otherwise.

## Task 3 — prepare 3.1.2

Follow the 3.1.1 release commit (`git show 32e3d8b`) as the pattern.

1. Version bump without git: `npm version 3.1.2 --no-git-tag-version`. This updates `package.json` and `package-lock.json`. Then set `"version": "3.1.2"` in `manifest.json` and add `"3.1.2": "1.14.5"` to `versions.json` (`minAppVersion` unchanged).
2. `CHANGELOG.md`: add a `## 3.1.2` section at the top. Suggested bullets:
   - Stop OpenCode from loading configuration and plugins from folders above OWLA's session folder, such as `~/.opencode/plugins`; OWLA's OpenCode settings now live in its private configuration folder.
   - Allow each OWLA tool in OpenCode by its exact name, and refuse tool calls OWLA did not offer in the current turn.
   - Keep module preload, library injection and TLS-disabling variables away from every assistant, and API keys and endpoint overrides away from Codex and Claude Code.
   - Check Codex's isolation before every reply, and refuse to connect when project instructions sit above OWLA's storage folder.
   - Match excluded folders regardless of letter case and Unicode form, as macOS and Windows do.
   - Fail an OpenCode reply instead of waiting forever when its event stream does not open or closes early.
   - Read long assistant messages without blocking Obsidian (a 16 MiB message took up to 1.4 s), and keep the note picker responsive in large vaults.
3. `RELEASE-NOTES.md`: replace the 3.1.1 text with `# OWLA Butler 3.1.2` and a short user-facing version of the bullets above. Keep the final "Update through Obsidian Community plugins…" paragraph unchanged.
4. If a user could see a new error message, check that it reads clearly. New messages, in `src/codex.ts` and `src/opencode.ts`:
   - "Codex would read project instructions from … Remove those files or move the OWLA storage folder, then reconnect."
   - "Codex could not isolate OWLA tools from your global configuration. Reconnect to retry."
   - "OpenCode did not open its event stream in time." / "The OpenCode event stream closed."
5. Run every gate: `npm run check && npm run lint && npm test && npm run build && npm run guard:test && npm run check:release`. `check:release` must report `owla-butler 3.1.2`.
6. Optional, with the owner's go-ahead: install the built `main.js`, `manifest.json` and `styles.css` into the test vault, SHA-256 check them against the build, and send one message per provider that is signed in. Record results in `TESTING.md`.
7. `git add` the changed files by name and stop. Report to the owner: the gate output, the Task 1 result, and the list of staged files.

**Owner's steps, not yours:** commit (message pattern: `Release OWLA Butler 3.1.2`), push, push the plain tag `3.1.2` (no `v`). The tag triggers `.github/workflows/release.yml`, which creates a **draft** release with the three assets and `RELEASE-NOTES.md`. The owner verifies and publishes the draft (see `COMMUNITY-RELEASE.md`).

## Out of scope for 3.1.2 (backlog)

Do not add these to the patch. They are listed so nobody re-audits them.

Security (from the OpenCode audit; numbers match the session report):

- F-3: OWLA sessions sit in OpenCode's global `opencode.db` until deleted. **Do not** set `OPENCODE_DB` to a private path: OpenCode 2.3.0 keeps sign-in credentials in that database (`credential` table, no `auth.json`), so users would be signed out.
- F-6: `freePort()` time-of-check race; let the child choose the port.
- F-9: an orphaned OpenCode server survives if Obsidian crashes.
- F-10: an inherited skill could shadow a bundled skill ID (needs a config leak that is now closed).
- F-11: the plugin's removal list misses some 2.3.0 built-ins (`todowrite`, `opencode_schedule_*`, `opencode_artifact_*`, `opencode_image_generate`). Defence in depth only; the deny-all rule already blocks them.
- F-13: `OPENCODE_DISABLE_AUTOUPDATE` is ignored by `serve`; `update:'disable'` in the config would work, but check that 2.2.x accepts the key first.
- F-14: existing session files keep their old permission modes.
- The Claude Code bridge never had its own security audit (the subagent hit the usage limit).

Performance (`PERFORMANCE-AUDIT.md`): the P1/P2 findings (serial and uncached `search_vault` and `cachedRead`, `linkTargets` dedupe, `safeSource` re-stats, quota probe TTL, DOM rebuilds). Do **not** memoise per-path `realpath` results: that is the symlink guard, and a symlink changed outside Obsidian raises no vault event.

## Where knowledge is recorded

- Project: `AUDIT.md` (decisions, limits), `TESTING.md` (evidence), `CHANGELOG.md`, `RELEASE-NOTES.md`.
- Agentbrain vault: `Obsidian/OWLA Butler Plugin.md` → "Security audit and hardening — 2026-11-13", indexed in `Obsidian/Central Index.md`. Add the 3.1.2 release outcome there once the owner publishes.
