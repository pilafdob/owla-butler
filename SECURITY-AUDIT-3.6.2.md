# OWLA Butler 3.6.2 — agent-confinement security audit

Date: 2026-11-18. Scope: strict, in-depth audit of "agents staying within their limits" —
provider-process isolation (Codex, OpenCode, Claude Code, Hermes), vault path confinement,
per-turn tool allowlists, and the review flow. Trigger: the 3.6.2 Hermes containment escape.

Method: five parallel read-only audit agents (Hermes, Codex, OpenCode, Claude, shared
launcher/vault-guard layer) plus parent-level independent verification. The OpenCode audit
agent was refused by its model provider mid-run; that bridge was audited directly in the
parent session against the installed OpenCode 2.3.0 bundle. Every high-impact finding below
was re-verified by the parent with its own probes or source reads; child self-reports were
not accepted as fact. No repo file was modified by the audit except this report. All probes
lived in `~/.hermes/cache/scratch/audit-*`. No live model turns, no gateway connections, no
credential contents read (file/key NAMES only), no signals to user processes.

Installed versions audited against: Codex CLI 0.169.0 (`/usr/local/bin/codex`), OpenCode
2.3.0 (`/opt/homebrew/bin/opencode`, Mach-O bun bundle), Claude Code 2.1.326
(`~/.local/share/claude/versions/2.1.326`), Hermes source checkout
`~/.hermes/hermes-agent` (live home `~/.hermes`, 79 entries).

Baseline gates on the current shared worktree (another agent's in-progress fixes included):
`npm test` **335/335 pass**, `npm run check` clean, `npm run lint` clean. The worktree was a
moving target during the audit (src/hermes.ts grew 519→586 lines, src/main.ts and AUDIT.md
also changed); findings are pinned to the state described per item.

---

## 1. The 3.6.2 incident — mechanism confirmed, worktree fix verified

Two shipped defects combined into a full containment escape for the Hermes provider.
Observed symptom (School debug bundle, recorded in the Agentbrain vault note): OWLA's
Hermes agent lost every `mcp__owla__*` tool, then ran `find /` / `grep -r /` and wrote a
drawing straight into the vault without review.

1. **Borrowed daemon.** OWLA mirrors the user's `~/.hermes` into a private `HERMES_HOME`
   via symlinks. 3.6.2 excluded the `gateway` *directory* and `gateway_state.json` but not
   `gateway.lock`, `gateway.sock`, `gateway.pid`, `gateway-connections.json`,
   `gateway-starts.log`. Hermes' ACP adapter is a pure *viewer* of a gateway daemon
   (`acp_adapter/entry.py`, `server.py: HermesACPAgent.__new__ → GatewayACPAgent`).
   `gateway_runtime.gateway_profile_home → _overlay_owner_home` treats a home whose
   `gateway.lock` is a **symlink** as a private *overlay* and resolves the owner to the
   lock target's home (`hermes_cli/gateway_runtime.py:69-104`). The mirrored lock therefore
   pointed OWLA at `~/.hermes`; the viewer attached to the user's running daemon
   (`profile_id` matched the resolved owner), and the turn ran with the user's config,
   shell/file tools, MCP servers and session database. The private config was never read.
   Socket discovery itself (`gateway_runtime_discovery._socket_path`) also accepts
   `<home>/gateway.sock` or a `gateway.sock.path` pointer into a home-hash tmp dir.
2. **Zero OWLA tools.** The MCP HTTP handler did `list(body)` on a single JSON-RPC object;
   `list()` returns `[]` for non-arrays, so `initialize` and `tools/list` were answered 202
   with no result. Hermes discovered no OWLA tools and fell back to its own built-ins.

**Worktree status: both fixed, verified.** `HERMES_PRIVATE_LIVE_PREFIXES
['gateway','runtime','state','locks']` (case-folded, `name===prefix` or `prefix+'.'/'-'/'_'`)
plus DB prefixes `projects.db`/`spawn-ledger.json` cover **every** live-daemon/state artifact
the installed Hermes creates (probe against all 79 real home entries: 39 excluded, including
`gateway.sock/.lock/.pid/.sock.path`, `runtime/`, `state/` loop-tick sockets, `locks/`, all
sqlite sidecars/locks). Stale symlinks for excluded entries are unlinked on every
`ensurePrivateHome`. The MCP handler now wraps single objects (`Array.isArray(body)?list(body):[body]`,
400 on empty batch); a 30-request loopback battery against the real `HermesBridge` confirmed
initialize/tools/list/tools/call semantics and the per-turn allowlist (terminal, execute_code,
search_files, write_file, mcp__user__tool, '' and trailing-space names all refused -32602).
`tests/hermes.test.ts` harness passes. Defense-in-depth in the installed Hermes also helps:
symlinked control sockets are refused by lstat, peer uid is authenticated, `served_profiles`
must match, launchd labels and tmp socket dirs are home-hash scoped, and OWLA-owned daemons
start with `idle_exit=True`.

**The fix is not complete.** Residual findings H1–H3, M1–M3, M8–M9 below.

---

## 2. Confirmed unfixed findings

Severity reflects exploitability under the stated threat model (prompt-injected note
content, malicious vault files, local same-user attacker, inherited/parent environment,
cross-product and cross-vault leakage, stock-CLI version drift). "Latent" = mechanism
verified, trigger condition absent on this host today.

### HIGH

> **Status (3.6.3):** H1, H2 and H3 are fixed in 3.6.3. H1: `.env` is now a filtered copy
> without `HERMES_*` keys, inherited `HERMES_*` variables are dropped at spawn
> (`hermesFilteredEnv`, `hermesChildEnv`). H2: Codex runs in a private `CODEX_HOME` holding
> only `auth.json`/lock links, with `skills.include_instructions=false`
> (`ensureCodexPrivateHome`). Verified with a loopback Responses stub on Codex 0.169.0: a
> global `AGENTS.md` in `CODEX_HOME` reaches the request (control), skill descriptions are
> removed by the override, and a live `CodexBridge.connect` through the private home signs
> in as ChatGPT with the isolation checks passing. H3: `foldPath` folds lower→upper→lower,
> with ẞ/ß/ss regression tests. From MEDIUM, case-insensitive Hermes exclusion and
> dangling-link write-through for `config.yaml`/`.env`/`skills` are fixed. The remaining
> MEDIUM and LOW items stay open.

**H1. Mirrored `.env` can re-attach OWLA's Hermes to a foreign gateway (latent).**
`hermes_cli/gateway_client.py:345`: `connect_gateway` reads
`os.environ.get("HERMES_TUI_GATEWAY_URL")` and, when set, dials that ws/wss URL directly —
bypassing home socket discovery and the private daemon entirely. `acp_adapter/entry.py
_load_env()` loads `<HERMES_HOME>/.env` before the agent starts, and
`hermes_cli/env_loader.py` loads it with `override=True` (beats shell exports). Only
`HERMES_HOME` and `HERMES_MANAGED_DIR` are launch-only keys
(`hermes_constants.LAUNCH_ONLY_ENV_KEYS:874`); `HERMES_TUI_GATEWAY_URL` is not. OWLA
mirrors `~/.hermes/.env` as a symlink (tests assert it stays mirrored), and `sanitizedEnv`
does not strip `HERMES_*` from the inherited Obsidian environment. Any such line in the
user's `.env` (a documented remote-TUI setup) — or in the parent env — re-opens the exact
3.6.2 escape class against an arbitrary endpoint. Same vector for
`HERMES_ACP_AUTH_METHOD`/`HERMES_ACP_AUTO_APPROVE` and provider-routing keys.
*This host:* `.env` key names enumerated (values never read): BROWSERBASE_*, BROWSER_*,
IMAGE_TOOLS_DEBUG, MOA_TOOLS_DEBUG, OPENCODE_GO_API_KEY, TERMINAL_*, VISION_TOOLS_DEBUG,
WEB_TOOLS_DEBUG — no gateway-URL key today, but behavioral/debug keys do ride into OWLA's
child with override semantics.
*Fix:* copy `.env` through a key filter (drop gateway/approval/routing/behavioral keys)
instead of symlinking; explicitly unset `HERMES_TUI_GATEWAY_URL` and `HERMES_ACP_*` in the
spawn env; strip `HERMES_*` from the inherited env except `HERMES_HOME` which OWLA sets.
Evidence: child probe + parent source verification (gateway_client.py, env_loader.py,
hermes_constants.py, entry.py).

**H2. Codex has no private CODEX_HOME; the user's global instructions and skills ride into
every OWLA turn (active on this host).**
`CODEX_HOME` appears in `src/codex.ts` only in a comment (line 43); it is never set or
pinned. Isolation is override-and-verify: `-c` session flags outrank user config for all
pinned keys (child probe with real app-server `config/read`: shell_tool, memories,
analytics, notify, sandbox_mode=danger-full-access, approval_policy all stayed overridden),
and per-turn re-verification is fail-closed. But instruction sources are not covered:
- The native binary loads `CODEX_HOME/AGENTS.md` globally ("Failed to read global AGENTS.md
  instructions from"; `project_doc_max_bytes` "limit applies only to project files" —
  binary strings verified). A loopback Responses stub captured the real model request:
  a planted `~/.codex/AGENTS.md` marker **was present** in a developer message; cwd/ancestor
  markers were absent (project_doc_max_bytes=0 works for project files only).
  `inheritedInstructions` (src/codex.ts:108-121) walks session-cwd ancestors and stops
  below home — it never inspects `CODEX_HOME/AGENTS.md`, and per-turn `assertIsolation`
  does not re-scan instructions. **`~/.codex/AGENTS.md` exists on this machine (6,790 bytes),
  so every OWLA Codex turn currently receives the user's global Codex instructions.**
- User skills' frontmatter descriptions are injected too (stub probe: skill description
  marker present; body not loaded). Codex also auto-writes `skills/.system/*` into the
  user's home. No config key in OWLA's override list disables skill instruction loading.
- OWLA's Codex child writes state DBs (goals/logs/memories/queue/state sqlite) into the
  user's `~/.codex` (shared with the user's own Codex). No turn persistence in the session
  dir was observed (ephemeral threads).
Impact: cross-product prompt-injection persistence — a prompt-injected note in the user's
*own unconfined* Codex session, or any local writer of `~/.codex`, can plant instructions
that ride into every confined OWLA turn. Vault content itself cannot write there (no
shell/file tools — runtime-verified). An inherited `CODEX_HOME` env var would redirect the
whole home unchecked.
*Fix:* per-vault private `CODEX_HOME` seeded only with auth (copy/symlink `auth.json`), or
suppress global instructions/skills for OWLA threads and add both to per-turn verification;
pin or strip `CODEX_HOME` in the child env.
Evidence: child stub probes (scratch/audit-codex/probe2-turn.mts, probe3-skills.mts),
parent grep of src/codex.ts + binary strings + on-disk file check.

**H3. `foldPath` capital-sharp-s (ẞ U+1E9E) alias bypasses excluded folders on APFS
(probe-verified by parent).**
`src/core.ts:141` folds via `NFC.toUpperCase().toLowerCase()`. That is not a full Unicode
case fold and is non-transitive for sharp s: `ß.toUpperCase()='SS'` but
`ẞ.toUpperCase()='ẞ'→'ß'`. Parent probe results:
```
foldPath('STRAẞE')='straße'  foldPath('Straße')=foldPath('Strasse')='strasse'
allowedPath('STRAẞE/secret.md','Straße')      = true   (MISS)
allowedPath('Straße/secret.md','STRAẞE')      = true   (MISS)
allowedPath('Strasse/secret.md','STRAẞE')     = true   (MISS)
allowedEditablePath('STRAẞE/secret.md','Straße') = true (MISS)
allowedPath('Straße/secret.md','Straße')      = false  (control OK)
APFS: statSync('STRAẞE/secret.md') resolves inside the on-disk 'Straße' folder = true
```
Consumed by `allowedPath:151`, `allowedEditablePath:167`, `Butler.checkVaultFile`
(main.ts:513-521), `Organization.assertAllowedDestination` (organization.ts:174-182).
With an on-disk folder spelled `STRAẞE` and an exclusion of `Straße` (or reverse), a
prompt-injected tool argument reaches the excluded folder for read, edit, new-note and
organization move (child probe: move preview ACCEPTED). The realpath re-check misses too
because the on-disk name is the ẞ variant. This defeats the exact alias class 3.4.0's
folding was built to catch; the existing test covers ſ/ς/ß but not ẞ.
*Fix:* true full fold — `normalize('NFC').toLowerCase().toUpperCase().toLowerCase()`
(lower-first closes ẞ→ß→SS→ss) or explicit ß/ẞ→'ss' mapping; add ẞ↔ß↔ss regression tests
including on-disk-ẞ organization/new-note cases. Primarily macOS/APFS (NTFS upcase tables
may differ; conservative over-exclusion is acceptable, under-exclusion is not).

### MEDIUM

**M1. Hermes private home is machine-global and predictable — cross-vault takeover.**
`privateHomePath()` = `defaultStorageDirectory()` + fixed `'Hermes Private'`
(src/hermes.ts:196; cli.ts:56-60) — no vault identifier, no randomness. Two vaults running
OWLA concurrently share one home: `ensurePrivateHome` rewrites `config.yaml` with the latest
callback port+token, so a session created in vault A after vault B connected reads vault B's
MCP endpoint — **vault A's model can drive vault B's OWLA tools**; both vaults' sessions
accumulate in one private `state.db`; `gateway.sock`/`lock` are contested. The predictable
path also enables pre-planting symlinks before first connect (M3). *Fix:* per-vault home
(hash of vault path, like `vaultStorageKey`) plus a random suffix; serialize concurrent
connects.

**M2. Mirror exclusion Set is case-sensitive → case-alias clobber of the user's real
config/skills/sessions (probe-verified).**
`HERMES_PRIVATE_EXCLUDED.has(entry)` is exact-case while the DB/live prefix checks are
case-folded. Parent probe: `hermesMirrorExcluded('Config.yaml'/'CONFIG.YAML'/'Skills'/
'soul.md'/'Sessions') = false` (canonical forms true; `GATEWAY.SOCK` true — the daemon
vector IS closed for case aliases). On case-insensitive APFS/NTFS a differently-cased real
home entry (unusual spelling, sync conflict copy, local plant) is mirrored as a symlink and
alias-resolves: child's scratch APFS demo showed `writeFileSync(private/config.yaml)`
following a `Config.yaml` alias and **overwriting the user's real config** — destroying it
and leaking OWLA's loopback MCP bearer token into a synced/backed-up file. `Skills`/
`Sessions` aliases likewise write OWLA content into the user's real dirs. Breaks the
"never touch real files" invariant. *Fix:* test Set membership on the lowercased name;
lstat config/skills targets before writing and refuse symlinks.

**M3. Symlink write-through in the private home (same-user attacker; attack verified).**
Child probe against a scratch private home: a **dangling** symlink planted at a mirrored
entry (`ui-preferences.json → victim`) makes `existsSync(target)` false, `symlinkSync`
throw EEXIST, and the `copyFileSync` fallback write the real file's contents **through the
link to the attacker-chosen path** (victim created byte-identical). Refuted attacks:
planted `config.yaml`/`skills` symlinks ARE cleaned by the excluded-entry stale-link
removal before OWLA writes. Not covered: nested paths (`skills/<id>/SKILL.md` writes
follow a planted subdir symlink), and any planted **valid** symlink on a mirrored entry is
skipped by `existsSync` and read through (e.g. `auth.json → attacker file` feeds
attacker-controlled credentials). Mirrored entries are themselves symlinks into the real
home, so Hermes' own writes (auth refresh, caches, processes.json, scratch) write back
into the user's real home (M9). Requires write access to the 0700 user-owned home — no
privilege escalation. *Fix:* lstat before every write (O_NOFOLLOW semantics), recursive
excluded-entry cleanup, stop mirroring writable state, randomize the home path (M1).

**M4. Claude child env keeps 13 provider/auth/telemetry redirectors (probe-verified by
parent; latent).**
Parent probe of worktree `sanitizedEnv`: survivors include `CLAUDE_CODE_USE_FOUNDRY`,
`CLAUDE_CODE_USE_MANTLE`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `CLAUDE_CODE_USE_GATEWAY`,
`ANTHROPIC_FOUNDRY_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_MODEL`,
`CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_ENABLE_TELEMETRY`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_LOG_USER_PROMPTS`, `AWS_CONFIG_FILE`
(`NODE_OPTIONS`/`ANTHROPIC_API_KEY` correctly stripped). The installed CLI reads all of
these (apiProvider enum firstParty/bedrock/vertex/foundry/anthropicAws/…; OTel prompt
logging; OAuth token; custom headers). Impact if set in the parent env: redirect the API
backend/credentials, inject headers, move config/auth dir, or **export vault prompt content
to an attacker OTLP endpoint** (`OTEL_LOG_USER_PROMPTS=1` + `CLAUDE_CODE_ENABLE_TELEMETRY=1`).
None are set in the current real environment (child probe booleans all false).
`src/claude.ts:156` drops only USE_BEDROCK/USE_VERTEX. *Fix:* strip all `CLAUDE_CODE_USE_*`,
`ANTHROPIC_FOUNDRY_*`/`BEDROCK_BASE_URL`/`VERTEX_*`/`CUSTOM_HEADERS`/`MODEL`/`DEFAULT_*_MODEL`,
`CLAUDE_CODE_OAUTH_TOKEN*`, `CLAUDE_CONFIG_DIR`, telemetry+`OTEL_*`,
`AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE`/`CLOUD_ML_REGION` in `ClaudeBridge.env()`.

**M5. Claude admin/managed tier overrides containment (conditional; absent on this host).**
Installed CLI 2.1.326: `enabledSources` always adds `flagSettings`+`policySettings`;
safe-mode help admits "Admin-managed (policy) settings and the hooks of managed plugins
still apply"; `managed-mcp.json` has **exclusive control** and drops OWLA's `--mcp-config`
servers; `disableSideloadFlags` can forbid `--mcp-config` outright; server-managed org
settings "reach every session". No OWLA flag can override this (none exists). A malicious
or compromised enterprise policy could run hooks inside the "isolated" session or replace
OWLA's MCP server. Verified absent here: `/Library/Application Support/ClaudeCode`, MDM
domain `com.anthropic.claude-code`, `/etc/claude-code`. *Fix:* detect managed settings at
connect and warn or refuse the Claude provider on managed machines; document the boundary.

**M6. OpenCode accepts any 2.x ≥ 2.2 with no runtime isolation assertion (version drift).**
`supportedOpencodeVersion` (src/opencode.ts:91-96) has no upper bound. Containment rests on
`OPENCODE_DISABLE_PROJECT_CONFIG`/alias, `XDG_CONFIG_HOME` redirection and
`OPENCODE_DISABLE_CLAUDE_CODE*` — verified against the installed **2.3.0 bundle** (serve
command config block; `opencode.config.instruction` AGENTS.md chain gated by the same
project flag; skill/compatibility discovery from private config only; MCP removed by the
plugin; deny-all + exact-name session permissions). A future minor renaming a switch or
adding a config source would silently re-open ancestor plugin execution — the same
silent-drift class as the Hermes incident. Unlike Codex (per-turn `config/read`
re-verification), OpenCode never asserts the *effective* config at runtime. *Fix:* at
connect, GET `/api/config` and assert only private sources/plugins are loaded (refuse
otherwise), and/or pin the tested minor line; keep the 2.3.0 probe-plugin regression in
TESTING.md as a release gate.

**M7. OpenCode `freePort()` bind race.**
`freePort()` (src/opencode.ts:223-233) reserves an ephemeral port, **closes the probe**,
then spawns the server which binds later — a window of hundreds of ms (process startup).
A local process that wins the race impersonates the server: OWLA sends it the Basic
password, prompts and tool traffic, and `waitUntilReady` accepts any 2xx on `/api/info`.
*Fix:* spawn with `--port 0` and parse the actual bound URL from stdout ("server listening
on http://127.0.0.1:PORT" — verified in the 2.3.0 bundle), or re-verify server identity
after bind.

**M8. `hermesDefaultModel` misses scalar-form model config (post-fix functional gap).**
The worktree's new `hermesDefaultModel` (src/hermes.ts:81) copies only `model.default`/
`model.model` + `model.provider` from the user's real config through a strict identifier
regex (injection values rejected — child probe). But Hermes accepts scalar `model: <id>`
(normalized to `{default}` by `present_sections`); the block regex returns '' for that
form, and the installed gateway rejects an empty-model policy
(`gateway/session_policy.py:1038` → 'invalid policy'/'storage_unavailable' on
`session/new`). Users with scalar-form or absent model config cannot connect after the
daemon-borrow fix (3.6.2 masked this by borrowing the user's configured daemon). *Fix:*
handle the scalar form; fall back to the first authenticated model from `session/new`.

**M9. Mirrored writable/state entries: write-back into the user's real home and
cross-daemon interference.**
Parent probe: 40 of 79 real home entries still mirrored. Security-relevant survivors:
- `processes.json`(+lock): the background-process crash-recovery checkpoint
  (`tools/process_registry.py:54` resolves it under `get_hermes_home()`).
  `recover_from_checkpoint` adopts **live host PIDs whose start time matches** as detached
  sessions ("the registry is process-global, so every profile's checkpoint carries every
  live process"). An OWLA-owned gateway recovering the mirrored checkpoint would adopt the
  user's live background processes; gateway-reset protection could then signal them. The
  PID-reuse guard does not help — these are the original processes. *Caveat:* the recovery
  trigger at private-gateway startup was code-verified, not live-exercised.
- `.hermes-update-in-progress.lock` + `hermes-agent` checkout link: an interrupted user
  update makes OWLA's launch run `_early_recovery.restore_interrupted_pull` (entry.py:25-28)
  — a git-restore against the user's **real checkout**; `_update_fenced` can also refuse
  OWLA startup while the user updates.
- `cache/` (incl. `cache/scratch`, terminal-output, browser-use profiles/cookies),
  `audio_cache`, `image_cache`: Hermes' runtime writes land in the user's real dirs
  through the symlinks (OWLA artifacts → user scratch; user data readable inside the
  "private" home).
- `bot_relay` (roster/outbox/replies), `platforms/pairing`: live messaging state, dormant
  while platform toolsets are off but shared.
- `backups/config`, `.curator_backups`: user config/skill backups inside the private home.
- `.skills_prompt_snapshot.json`: reuse is manifest-gated (child verified user skills are
  NOT injected) but OWLA's atomic write overwrites the user's snapshot through the link.
- `auth.lock`, `.env.lock`, `.mcp-discovery.lock`, `*.lock`: flock on the **same inodes**
  as the user's processes (contention).
- `shared/nous_auth.json`, `auth.json`, `installs`, `hermes-agent`, `tools`, model caches:
  intentional (sign-in/install reuse).
*Fix:* exclude state/cache/lock entries; keep only auth, filtered `.env` (H1), shared,
installs, checkout, tools and model caches.

### LOW

- **L1.** Hermes `runCliVersion` (src/hermes.ts:586) and OpenCode `readVersion`
  (src/opencode.ts:400) run `--version` with the **full unsanitized inherited env** and no
  private cwd; Codex/Claude pass `sanitizedEnv()`. Execution-hijack vars in the parent env
  fire in the probe child before sanitization applies. Code-verified.
- **L2.** Hermes MCP callback hardening: token compare is plain `!==` (not constant-time);
  `GET /mcp` opens a never-ending SSE and `disconnect()` calls `server.close()` without
  `closeAllConnections()` (child probe: connection held after disconnect, 'close' event
  delayed — resource leak, no tool execution); malformed/scalar JSON bodies answer 202
  instead of 400/-32700; nested batch arrays silently dropped; size cap counts UTF-16 code
  units; an in-flight `tools/call` can finish after disconnect (review-gated tools only).
- **L3.** Claude connect probes (`--version`, `auth status`, src/claude.ts:188-191) run
  without isolation flags and inherit Obsidian's cwd; settings schema exposes
  command-executing helpers (`apiKeyHelper`, `proxyAuthHelper`, …). Whether `auth status`
  executes them could not be fully traced in the minified auth code — partially verified.
- **L4.** Claude teardown is SIGTERM-only with no SIGKILL escalation and no turn wall-clock
  cap (src/claude.ts:378-383,411-421); a child ignoring SIGTERM (e.g. a managed-policy hook
  subprocess, M5) lingers. Tool budget caps calls, not time.
- **L5.** Codex per-turn verification blind spots: `isolationReport` does not assert
  `project_doc_max_bytes===0`, instruction fields, or managed
  `additional_developer_instructions`; `inheritedInstructions` runs only at launch.
  Exploitation needs a managed/policy layer (root/MDM) pinning values above the session
  flags — child probe confirmed user config cannot outrank `-c`.
- **L6.** Codex `hooks/list` inventory check is vacuous while `features.hooks=false`
  (discovery itself is gated — fixture: `discoveredHooks=0`). The real guarantee is the
  pinned+verified feature flag. **Parent re-ran `tests/fixtures/codex-hooks-runtime.mjs`
  against real Codex 0.169.0:** control-true/default fired all 5 trusted hooks
  (SessionStart/Stop/SubagentStart/SubagentStop/UserPromptSubmit, 10 events);
  explicit-false, owla and owla-subagent-stress fired **zero**. Recommend promoting this
  opt-in fixture to a release gate to catch stock-CLI semantic drift (the U2 failure mode).
- **L7.** Codex POSIX process-group kill has no PID-reuse guard (the win32 branch does):
  `close()` signals an already-exited child's group (src/codex.ts:407, cli.ts:224-250).
  Small window, same-UID only.
- **L8.** Vault check→write TOCTOU: write-time rechecks catch a symlink swap performed
  before the call (child probe), but the final check and Obsidian's path-string adapter
  write are not atomic (no O_NOFOLLOW/openat). Inherent to the adapter API; per-check
  `realpathSync.native`, no cross-turn cache, and hardlink refusal shrink the window.
- **L9.** Residual inherited env vars: `GIT_CONFIG_COUNT/KEY_*/VALUE_*`, `GIT_SSH_COMMAND`,
  `GIT_EXEC_PATH`, `GIT_TEMPLATE_DIR`, `GIT_PAGER`, `PAGER`/`EDITOR`/`VISUAL`, `UV_PYTHON`,
  `VIRTUAL_ENV`, `TMPDIR` redirection. Mostly theoretical for the actual children
  (node/compiled binaries/python `-I`; shell/file tools disabled), but OpenCode/Hermes
  internals could shell git. JVM/.NET/Bun/Deno/Ruby vars are theoretical for this provider
  set. `keepCredentials=true` (OpenCode) still strips every execution-override var
  (probe-verified). Cheap hardening: add the git/PAGER/UV keys; consider pinning TMPDIR.
- **L10.** POSIX discovery: `isCliExecutable` follows symlinks, checks X_OK only — no
  ownership/world-writable check; a shebang script re-introduces a PATH-resolved
  interpreter (`#!/usr/bin/env node`); discovery dirs precede PATH; `/opt/homebrew/bin` is
  admin-writable. Standard install-location planting risk (child probe confirmed all
  behaviors); win32 shim path is well-guarded by contrast.
- **L11.** win32 `trustedSystemDirectory` verifies `cmd.exe` **existence**, not
  authenticity: redirected `SystemRoot` + planted `System32\cmd.exe` passes the gate
  (pure-rule probe from darwin; no Windows host available). Prefer `GetSystemDirectory`.
- **L12.** OpenCode: inherited `OPENCODE_*` behavior vars not stripped
  (`OPENCODE_PTY_HANDOFF`, `OPENCODE_SIMULATE`, `OPENCODE_MODELS_URL/PATH`,
  `OPENCODE_GIT_BASH_PATH`, `OPENCODE_CLIENT` — seen in the 2.3.0 bundle); event handling
  processes events **lacking** `sessionID` (a server-wide `session.execution.succeeded`
  could end a turn early; the server is OWLA's own child, so low). Strip all `OPENCODE_*`
  except the ones OWLA sets; require matching sessionID for session-scoped event types.
- **L13.** Hermes stale cleanup removes only symlinks; real files copied by the Windows
  EPERM fallback persist (a copied non-symlink `gateway.lock` does NOT redirect discovery —
  `_overlay_owner_home` requires `is_symlink` — so no re-attach, but user session state
  leaks into the private home). Windows path code-verified, not run.
- **L14.** Version gates: Claude accepts 2.1.322+ and **any major>2**
  (src/claude.ts:44-50); Codex floor 0.162.1 code-reviewed only; OpenCode see M6. Flag
  semantics verified only on the installed versions. Re-verify containment per new minor.
- **L15.** Hermes hygiene: orphaned `acp` child if disconnect races `start()` before
  `this.child` is assigned (generation check throws, no cleanup kill);
  `friendlyHermesError` surfaces up to 800 chars of gateway error detail (can include
  user-home paths) into chat/status.

---

## 3. Verified controls (what holds)

- **Per-turn tool allowlist at five independent layers:** main.ts `offeredToolNames`
  dispatcher gate; Codex `active.tool` + router rejection of unoffered dynamic tools;
  Claude `tools/call` membership + `can_use_tool` deny; OpenCode callback `toolNames`;
  Hermes `dispatchMcp` `toolNames`. Child probe: no-turn refuses; read-only turn refuses
  propose/search/unknown; after-turn cleared refuses. **Correction:** `tool-guard.ts` is
  only the call budget (40 soft/50 hard) + identical-result repeat detector, not the name
  allowlist.
- **Vault path validation is consistent across every path-taking tool** (note
  read/propose/properties, search, list, organization, deletion, PDF + annotation,
  canvas/base/excalidraw, vault-graph, plugin-turn tools): same `allowedPath` /
  `allowedEditablePath` / `checkVaultFile` gates; realpath per check; hardlink refusal
  (nlink>1); excluded-folder recheck on pending-record load; no review-flow bypass found
  (organization moves/deletions need preview+accept; PDF annotation writes a copy after
  confirmation; temp/backup files stay in private 0700 storage). The ẞ alias (H3) is the
  one verified under-exclusion.
- **Codex runtime containment (real 0.169.0):** shell/apply_patch attempts router-rejected
  with no execution (sentinel-verified); trusted hooks provably do not fire under OWLA
  overrides (fixture re-run by parent, incl. subagent stress); per-turn config re-read is
  real (disk) and fail-closed; sandbox read-only + approval never pinned at launch and
  thread/start; built-in `openai` provider cannot be hijacked via user config (reserved-ID
  refusal, zero requests reached an exfil stub); AGENTS.md ancestor refusal below home;
  project docs truncated (project_doc_max_bytes=0); no project-layer config/hooks/skills
  loaded even with .git + trust markers; item allowlist stops+disconnects on
  commandExecution/fileChange/mcpToolCall/unknown.
- **Claude per-turn containment (installed 2.1.326):** `--safe-mode --setting-sources ''
  --strict-mcp-config --tools '' --permission-mode dontAsk --allowedTools mcp__owla__*
  --disable-slash-commands --no-session-persistence` + inline sdk `--mcp-config`. Every
  user/project/local config, CLAUDE.md chain, .mcp.json chain, plugin, hook, skill,
  output-style and agent source blocked (CLI strings + help verified). `--allowedTools` is
  a PRE-APPROVAL list, not a denylist — containment rests on `--tools ''` hard removal
  (plugin tool registration refused) + strict MCP + dontAsk + OWLA's deny. Built-ins do
  not exist in the session. Transcripts/private history empirically absent for OWLA cwds
  (~/.claude/projects, ~/.claude.json inspected, names only). Only the managed tier
  escapes (M5).
- **OpenCode isolation (2.3.0 bundle-verified):** private XDG_CONFIG_HOME global config;
  project discovery off — which also gates the AGENTS.md ancestor chain
  (`opencode.config.instruction`: project sources require the project flag AND cwd inside
  project); Claude-compat off; skills discovered from private config only; plugin REMOVED
  list + deny-all session permissions + exact `owla_<tool>` allows (no namespace wildcard)
  + skill-id allows + websearch gated three ways; inherited MCP servers removed;
  loopback-only server, 192-bit random password, constant-time callback token
  (`timingSafeEqual`), 32 MiB caps, header/request timeouts, maxConnections 32, per-turn
  allowlist, session DELETE in finally, process-group SIGTERM→SIGKILL. Data home has no
  config/plugin dirs (names verified). Known accepted limit: sessions live in the user's
  shared opencode.db until end-of-turn delete; a crash leaves them.
- **Hermes private config vs the real installed schema:** every key verified in the
  loader — `platform_toolsets.acp` explicit list is authoritative (empty = zero toolsets,
  no MCP merge); `plugins.enabled: []` loads nothing opt-in; `mcp_servers.owla`
  url/headers/timeouts/lazy are real keys; memory/user_profile false are real keys
  (defaults true); `skills.external_dirs: []` real; SOUL.md/hooks/cron/memories/sessions
  excluded at mirror level; native server keeps `mcp__owla__<tool>` (editor-server hashed
  rename avoided via `mcpServers:[]`). **No runtime re-enablement path for the model** in
  this install: tool_search/tool_call bridge is session-scoped to enabled toolsets; no
  terminal/file/skill-manage tools; slash commands cannot fire (OWLA prepends
  instructions); ACP permission requests always denied; fs/terminal client capabilities
  false. Caveat: fail-open drift via `_RECENTLY_SHIPPED_TOOLSETS`/default-on plugin
  toolsets in future versions — write explicit decline lists
  (`agent.disabled_toolsets`) as belt-and-braces.
- **Worktree env hardening complete and green:** case-insensitive stripping of every
  spelling; expanded execution-override list (PYTHONHOME/PYTHONSTARTUP/PERL5OPT/RUBYOPT/
  RUBYLIB/BASH_ENV/ENV/ZDOTDIR); service credentials stripped on ALL hosts; exactly one
  pinned `ComSpec` validated against the system dir; shim interpreter trust +
  `withPinnedShimInterpreter`; taskkill from validated system dir with PID-reuse guard.
  Probes + tests/cli-security-audit.test.ts pass. Residuals: L1, L9, M4, H1 (HERMES_*),
  L12 (OPENCODE_*), CODEX_* (H2).
- **Inert former session guard:** `scripts/vault-guard/` referenced only by
  guard/guard:test scripts + CI self-test; nothing in src/ loads it; `opencode.json`
  contains only publishing permissions (deny git push, ask git commit).

---

## 4. Cross-cutting recommendations (priority order)

1. **Close the instruction/input surfaces** (H2, H1, M9): private CODEX_HOME or global
   instruction/skill suppression + per-turn re-scan; filtered `.env` copy + explicit
   `HERMES_TUI_GATEWAY_URL`/`HERMES_ACP_*` unset; stop mirroring writable Hermes state.
2. **Full Unicode case folding** (H3) + case-folded mirror exclusion Set (M2) + ẞ/alias
   regression tests.
3. **Per-vault, unpredictable private homes** for Hermes (M1) with no-follow writes (M3).
4. **Runtime isolation assertions per provider** (M6, L5, L14): Codex's per-turn
   config/read is the model; add effective-config checks for OpenCode/Claude/Hermes and
   promote the real-CLI sentinel fixtures (codex-hooks-runtime, OpenCode probe-plugin,
   Claude fake-CLI allowlist) to release gates. Version drift is the incident class that
   already bit once.
5. **Env completeness** (M4, L1, L9, L12): strip provider-specific redirectors
   (CLAUDE_*/OTEL_*, HERMES_*, OPENCODE_*, CODEX_*), sanitize the version probes, add
   git/PAGER/UV keys.
6. **Managed-tier detection for Claude** (M5) and documented boundaries (L8 TOCTOU, L10
   PATH planting, shared opencode.db).
7. Teardown parity: SIGKILL escalation for Claude (L4), POSIX PID-reuse guard (L7),
   Hermes disconnect-race cleanup (L15), MCP constant-time compare + connection cleanup
   (L2), OpenCode port-race fix (M7).

## 5. Not verified (honest gaps)

- No live model turns or gateway/daemon connections anywhere in the audit (forbidden by
  the audit mandate); turn-level evidence uses loopback stubs, real app-server
  control-plane probes, the real-Codex hooks fixture, and installed-source/bundle reads.
- Hermes end-to-end `session/new` acceptance with the generated private config against a
  real OWLA-owned daemon was NOT run by this audit; M8's failure mode is source-verified
  only. (The concurrent fix effort recorded a live protocol probe in the Agentbrain vault
  note: own control socket, `session/new` error null, 5 `mcp__owla__*` tools registered —
  that covers the block-form model config, not the scalar form.)
- Windows behavior: pure rules probed from darwin + platform-parameterized tests; no
  Windows host (L11, L13, ComSpec/taskkill runtime).
- Claude managed tier (M5) code-evidenced, not live-demonstrated (absent on this host);
  `auth status` helper execution (L3) partially traced.
- processes.json recovery trigger at private-gateway startup (M9) code-verified, not
  live-exercised.
- Credential contents never read; `.env` key NAMES only. Whether other machines' `.env`
  files set HERMES_TUI_GATEWAY_URL is unknown (H1 is conditional per install).
- The shared worktree moved during the audit (another agent's fixes); the report reflects
  the state at the final gate run (335/335, check/lint clean). Probe artifacts:
  `~/.hermes/cache/scratch/audit-{hermes,codex,claude,guard,parent}/`.
