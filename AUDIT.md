# OWLA Butler cumulative audit

## 3.7.0 RC — Windows hardening and independent follow-up (2026-11-20)

**Scope:** the Windows hardening working tree against `81540fb`, not a new
release or a certification of every provider/version. Eight original audit
areas and consolidation O1–O6 are indexed below; the follow-up independently
reruns gates and reviews the implementation rather than relying on the prior
agent verdict. The original area reports remain evidence snapshots.

| Area | Changes and audit coverage | Detailed evidence |
|---|---|---|
| Failure/process | Shim control-character refusal; copied-environment casing; validated Codex credential identity; journal stat/read-only behavior; best-effort rotation; exit-aware process termination | [Windows failure/process](audits/3.7.0-rc/windows-failure-process.md) |
| Streams/lifecycle | Bounded chat lock retries; failed-spawn timer/listener cleanup; handshake cleanup; CRLF splitting and process-tree probes | [Windows streams](audits/3.7.0-rc/windows-stream-leaks.md) |
| Security/privacy | Windows Hermes home discovery; credential-vault exclusion; hard-link and dangling-entry cleanup; filtered `.env`; Windows/UNC error redaction; canonical instruction refusal; validated reconnect rewrite gating | [Windows security](audits/3.7.0-rc/windows-security-leaks.md) |
| Routing/context | Non-quadratic history pruning; bounded history persistence; classifier basename privacy; context-selection trimming; CRLF cache keys; macOS-only routing gate | [Windows automatic mode](audits/3.7.0-rc/windows-auto-mode.md) |
| Providers/usage | Bounded OpenCode bind/startup retry with takeover protection; finite reset-time validation; shared rate-limit matching; CRLF JSON/fence parsing | [Windows providers](audits/3.7.0-rc/windows-providers-usage.md) |
| Vault tools | CRLF block/table/property handling; real graph-output budget; canonical case-alias scoping; hardlink/junction refusal; Canvas formatting preservation | [Windows tools/context](audits/3.7.0-rc/windows-tools-context.md) |
| Attachments/PDF | Editor-normalized inline diffs; BOM UTF-16/conservative Windows-1252 decoding; CRLF text budgets; PDF citations and leased document cache; Windows OCR no-op | [Windows attachments](audits/3.7.0-rc/windows-attachments-vision.md) |
| Main/UI integration | Coalesced review rebuilds and broadcasts; detached observer cleanup; normalized Markdown reads with raw-format write guards; redacted chat errors; Markdown-only property proposals | [Windows performance/main](audits/3.7.0-rc/windows-performance-main.md) |

Cross-file integration is recorded in
[the consolidation log](audits/3.7.0-rc/windows-consolidation-log.md): direct
Node launch for standard npm Claude shims, PDF cache/read retries, shared
case-alias and size guards, untrusted tool-output wrappers for all four
providers, catalogue context windows and literal fail-closed selection trims.
The prior independent review found six logic defects and two closing
suggestions; O5/O6 record their fixes and tests. Delimiters are defense in depth,
not an enforcement boundary against prompt injection.

**Independent follow-up review (2026-11-20):** three fresh read-only reviewers
traced the working diff and executed synthetic reproductions on Windows. Their
focused passing suites did not invalidate the additional defects they found;
every reported defect was fixed with a regression (key ones observed RED before
and GREEN after) and the tree was re-verified. No real credential contents,
shared-account logout or model turn was used.

| Finding | Fix and regression |
|---|---|
| Recovery journal read failure read as empty, so `clearPendingEdits` could delete an unread journal | Read I/O failures now throw and preserve the journal; tolerant JSON-decode recovery is unchanged. Deterministic EBUSY/EPERM/EACCES regression through the real clear path. |
| Claude npm-shim bare `node` fallback let a session `node.cmd` hijack launch | Resolve a validated absolute Node (bundled, current binary if Node, else PATH); otherwise keep the guarded shim. End-to-end cwd-hijack regression. |
| Stale copied Hermes `vault/` directory survived excluded-entry cleanup | `sweepExcludedPrivateEntries` removes user-data directories (credential vault, kanban, platforms, backups, …) on every connect; gateway-owned runtime dirs survive reconnect. Three sweep regressions. |
| Lone-CR `.env` assignments bypassed the filter | Split on LF/CRLF/CR like python-dotenv; blocked ComSpec/PATH after a CR are stripped. Regression. |
| System-directory trust rested on `cmd.exe` existence alone | Also require the core system DLLs; a cmd.exe-only planted folder falls back to default. Regression + exact-fallback assertion. |
| CRLF proposal offsets corrupted apply/rollback | Normalize both sides for plain-Markdown editor operations; structured formats keep byte-exact guards. Apply→decline regression. |
| Distinct external PDFs shared one cache entry | Stable per-object identity (WeakMap) keys external Files; two same-name/size/time attachments parse separately. Regression through `read_pdf`. |
| Byte-trimmed graph pages skipped notes | Recompute `nextOffset` to the first unreturned note and set `truncated`; non-paginated lists flagged too. Two regressions. |
| UTF-8 sample split mid-character triggered ANSI fallback | Streaming decode for a non-final sample; an incomplete final file stays refused. Regression covers both. |
| Case-alias reads missed unsaved editor content | `currentText`/`writeEdit` resolve the canonical path before view/target lookups. Alias regression returns unsaved text. |
| Per-reply unload closures retained observers/content | One view-level cleanup drains all observers; newChat test asserts a single registration. |
| Post-trim routing still offered smaller windows | Both automatic branches refilter by the post-trim estimate and the scorer enforces capacity. Four routing regressions. |
| History persistence fell back to an in-place write | Atomic rename only, bounded retry for transient sharing codes; a failed save leaves the old history intact. Fault-injected regressions. |
| PDF lease release left temporary overflow | Returning a lease evicts idle overflow immediately. Updated + added cache regressions. |

**Verification and limits:** final fresh command results and the remaining live
Windows release checklist are in `TESTING.md` under 3.7.0 RC (final suite:
**774 tests / 773 pass / 0 fail / 1 designed skip**). No commit, push,
tag, publication, shared account logout, credential inspection or real model
turn is implied. `src/ocr.ts`, `src/visual.ts` and `src/model-profiles.ts`
remain unchanged against the base; macOS-only functionality is preserved in
source and parameterized tests, not re-certified on macOS by this Windows run.
Remaining scoped risks and designs stay in
[the Windows handoff §5](audits/3.7.0-rc/REVIEW-windows-hardening-pass.md#5-deferred-backlog-risk-tiers-designs-in-the-per-agent-reports).


## macOS + Windows security audit — 2026-11-18 (released in 3.6.3)

Triggered by the School-vault debug bundle (`work/school-chat-debug-2026-11-18/`). The
transcript showed the assistant calling `mcp__owla__read_canvas`, being told the tool
did not exist, then running `find /`, `grep -rl "mcp__owla" /`, reading `~/.hermes/config.yaml`,
and finally writing `Kinematik.excalidraw` straight to the vault with `execute_code` —
outside OWLA's review flow. Four defects, all fixed and verified:

- **Hermes MCP requests were dropped (root cause of the missing tools).** `handleMcp`
  parsed the body with `list(body)`, which returns `[]` for a JSON-RPC *object*. Streamable
  HTTP sends one object per request, so `initialize` and `tools/list` were answered `202`
  with no result and Hermes discovered zero OWLA tools. Now a single object is dispatched
  and only an empty array is rejected. Verified with the real MCP Python SDK against the
  running endpoint: `INITIALIZE OK`, `TOOLS: ['read_canvas','read_excalidraw','propose_excalidraw']`.
- **The private Hermes home borrowed the user's live gateway (isolation escape).**
  `hermes acp` is a *viewer* of the gateway owning its `HERMES_HOME`
  (`acp_adapter/entry.py`), and the control socket resolves as `<home>/gateway.sock`
  (`hermes_cli/gateway_runtime_discovery.py::_socket_path`). `ensurePrivateHome` mirrored
  every non-denylisted entry, so `gateway.sock`, `gateway.pid`, `gateway.lock`,
  `gateway-connections.json`, `runtime`, `shared` and `projects.db` became symlinks into
  `~/.hermes`. OWLA's private config was therefore never read: the turn ran on the user's
  daemon with their shell/file tools, their MCP servers (adrafinil, node_repl) and their
  `state.db`. Confirmed on disk — the private `gateway.pid` named the user's PID 55507 with
  `hermes_home: ~/.hermes`. `hermesMirrorExcluded()` now refuses the
  gateway/runtime/state/locks families and the extra DB sidecars, and removes stale links.
- **Session MCP servers are renamed by the gateway.** Servers passed to `session/new`
  become `editor_owla_<hash>` (`gateway/session_local_mcp.py::_server_names`), so the model
  saw `mcp__editor_owla_<hash>__read_note` and every `mcp__owla__…` name in OWLA's
  instructions was uncallable. OWLA's server is now a **native** `mcp_servers.owla` entry
  in the private config with `mcp-owla` in `platform_toolsets.acp`, which keeps the plain
  `mcp__owla__<tool>` name. `session/new` sends `mcpServers: []` (the field is required).
- **An OWLA-owned daemon needs a default model.** With the user's config no longer in
  play, `session/new` failed `storage_unavailable`; the owner logged
  `invalid policy … not policy.model.strip()` (`gateway/session_policy.py:1038`).
  `hermesDefaultModel()` copies only `model.default` and `model.provider` as validated
  scalars — no keys, no toolsets, no plugins.

Verified live end-to-end against the installed Hermes (no model turn, so no inference
spent): a fresh OWLA-owned home starts its **own** control socket, `session/new` returns
`error: null` with a session id, and the owner logs
`MCP server 'owla' (HTTP): registered 5 tool(s): mcp__owla__read_canvas,
mcp__owla__read_excalidraw, mcp__owla__propose_excalidraw, mcp__owla__read_reference,
mcp__owla__search_vault`. Because `platform_toolsets.acp` lists only `mcp-owla` (plus `web`
when allowed), `terminal`, `execute_code`, `read_file`, `search_files` and `write_file` are
no longer offered — which also removes the `find /` / `grep -r /` battery, disk and
exfiltration surface. Probe homes and daemons were removed afterwards.

Child-environment hardening (`src/cli.ts`), applying to **both** macOS and Windows:

- Blocking was case-sensitive on a plain object, so `node_options`, `PyThOnPaTh` or a
  duplicate `cOmSpEc` survived into the child. Windows environment names are
  case-insensitive; every blocked name is now matched case-insensitively and exactly one
  pinned `ComSpec` remains.
- The denylist gained `PYTHONHOME`, `PYTHONSTARTUP`, `PERL5OPT`, `RUBYOPT`, `RUBYLIB`,
  `BASH_ENV`, `ENV`, `ZDOTDIR`.
- Unrelated service credentials (`GH_TOKEN`, `AWS_*`, `NPM_TOKEN`, …) were stripped only on
  Windows; they are now stripped on every host. OpenCode's explicit `keepCredentials`
  path still keeps provider keys, and proxies/CA bundles are untouched.

Model-unavailability memory (`src/opencode-availability.ts`, `src/core.ts`, `src/main.ts`):
plan/region refusals are persisted per platform in `modelUnavailability` and survive a
reload; only **Reset OWLA model unavailability memory** in settings clears them (a
disconnect no longer wipes them). Stored entries are bounded to 2048, deduplicated, and
limited to a provider id, a catalogue-safe model id (no `..`, no leading `/`) and a known
reason code — never provider error text. Rate limits, free-tier limits, balance and auth
failures stay in the timed layer and are never persisted. The two refusals the bundle
actually hit (`Thinking budget is not supported for this model.`,
`` `reasoning_format` is not supported with this model ``) are classified as a new `effort`
kind: the model stays selectable and OWLA sends it no reasoning setting afterwards,
instead of blacklisting a model that works without the parameter.

Gates on this Mac: `npm run check`, `npm run lint`, `npm test` (**335 pass, 0 fail**),
`npm run build`, `npm run guard:test`, `npm run check:release` all clean;
`npm audit --omit=dev` reports 0 advisories.

Not verified: no Windows host was available this session — the Windows rules are
parameterized tests run on macOS plus inspection, as in the 2026-11-13 pass. No live
Obsidian turn ran with the new Hermes wiring (the daily Nous allowance was exhausted);
the Excalidraw accept/decline review flow and the settings reset button were exercised by
unit tests and the protocol probe, not clicked in the app. The Canvas→Excalidraw guide was
rewritten to a bounded four-step route and mirrored into `assets/reference-pack.json`.

## Security and performance hardening — 2026-11-13 (unreleased)

A security audit of the three provider bridges and the vault path checks, and a performance audit (`audits/3.1.1/PERFORMANCE-AUDIT.md`), on 3.1.1. Fixed in the working tree, not released:

- **OpenCode ancestor discovery.** OpenCode loads `opencode.json`, `.opencode/opencode.json` and `.opencode/plugins/*.ts` from every directory above its working directory, including the home folder, so a plugin in `~/.opencode/plugins` would have run inside OWLA's session. OWLA now sets `OPENCODE_DISABLE_PROJECT_CONFIG=1` (and its alias) and writes its own configuration as the global config of the private config home, removing the old project `opencode.json`. Verified live with OpenCode 2.3.0: with a probe plugin and an `opencode.json` planted above the session folder, the bridge connected (43 models), `/api/config` listed only the private config, and the probe did not run; the same probe ran when the server was started without the switch.
- **OpenCode permissions.** OWLA tools are allowed by exact name (`owla_read_note`, …) instead of the `owla_*` wildcard, which another plugin or MCP server registering under `owla_` could also have used.
- **OpenCode tool callback.** Refuses tool names not offered in the current turn, compares the token in constant time, has header and request timeouts and a connection cap, and catches handler failures.
- **OpenCode event stream.** Opening it is bounded (20 s) and follows the cancel signal; a stream that closes before the turn ends fails the turn instead of leaving it waiting; replies and events are capped at 32 MiB.
- **Child environments.** Every provider drops `NODE_OPTIONS`, `NODE_TLS_REJECT_UNAUTHORIZED`, `ELECTRON_RUN_AS_NODE`, `LD_PRELOAD` and `DYLD_INSERT_LIBRARIES`. Codex and Claude Code also drop OpenAI and Anthropic keys and endpoint overrides. OpenCode keeps provider keys, which it reads from the environment by design. Proxies and certificate bundles stay.
- **Codex.** The configuration is re-read before every turn, and a turn is refused if an inherited integration, the shell tool, apps or telemetry came back on. Connecting is refused if an `AGENTS.md` or `AGENTS.override.md` sits between the session folder and the home folder.
- **Excluded folders** match regardless of case and Unicode normalization, as macOS and Windows resolve paths; `private/Note.md` no longer reaches around an exclusion of `Private`.
- **Performance.** The four provider stream readers use a shared splitter (`src/stream.ts`) that is linear for a long message arriving in many chunks (audits/3.1.1/PERFORMANCE-AUDIT.md finding 3; a 16 MiB line now reassembles in well under 250 ms in the test). The vault root is resolved once instead of on every path check, and the note picker checks the vault once per opening instead of per keystroke (findings 1 and 2). Each candidate path is still resolved on every check, because that is the symlink guard.

Known limits, not fixed: OpenCode keeps OWLA's sessions in its global `opencode.db` until the end-of-turn delete, and a crash leaves them there. Moving the database is not possible without losing sign-in, because OpenCode 2.3.0 stores credentials in the same database. No live model turn ran, because the free OpenCode models were exhausted, so the exact-name permission rule is covered by unit tests and the effective tool name `owla_<tool>`, not by a real tool call. The Claude Code bridge was not audited separately. TESTING.md line 17 describes the verification harness, which redirected all OpenCode folders; the shipped bridge redirects only the config folder.

Gates: 148 automated tests, strict TypeScript, source lint, build and the guard self-test.

## Windows parity hardening — 2026-11-13 (unreleased)

A Windows-specific review of the launcher layer (`src/cli.ts`) on the 3.1.2 tree, to bring the Windows paths to the standard the macOS paths were held to. No Windows machine was available this session; the Windows rules were parameterized so each of them is covered by automated tests that run on any host (see TESTING.md), and the rest was verified by inspection.

- **Command-shim interpreter.** On Windows, `.cmd`/`.bat` launchers run through the interpreter named by this process's `ComSpec` variable — cross-spawn reads it from the parent's environment (`node_modules/cross-spawn/lib/parse.js`), not the child's — so a redirected `ComSpec` chose which program interpreted an assistant, where macOS never involves a shell at all. Every assistant's environment now pins `ComSpec` to the system's own `cmd.exe` (`sanitizedEnv`), and `spawnCli` refuses a command shim when the variable names anything other than the system `cmd.exe` (`shimInterpreterTrusted`). The refusal names the remedy: choose the program's executable in settings, or set `ComSpec` back to the Windows `cmd.exe`.
- **Process-tree termination.** Windows reuses PIDs quickly and the tree was killed by external PID (`taskkill /PID … /T /F`), so a kill issued after a child had already exited could have hit an unrelated process that recycled the PID. `terminateProcessTree` now never targets an exited child on Windows, resolves `taskkill` from the system directory (SystemRoot, then windir, then the default) and spawns it only when it is present, with the direct child as the fallback. The POSIX branch is unchanged and still kills the group after the leader exits, which is deliberate: lingering group members.
- **Discovery.** Windows discovery also covers the standard per-user install locations now — npm's global shims (`%APPDATA%\npm`), pnpm, Scoop, Volta, Bun and the Claude Code native installer (`~\.local\bin`) — and no longer probes the Linux-only `~/.cache/opencode/bin` folder for OpenCode. `isCliExecutable`, `findCliExecutable` and `defaultCliDirectories` take the platform as a parameter, so the Windows rules (launcher-extension probing, `;`-separated quoted PATH entries, drive-letter paths) are tested on macOS and Linux too, not only on a Windows host; previously every Windows test early-returned off Windows.
- **Protocol line endings.** All four stream readers (Codex `receiveChunk`, the Claude Code handshake and turn readers, the OpenCode event reader) trim each record before `JSON.parse`, so CRLF output from a Windows CLI cannot break a connection. Verified by inspection; unchanged.
- **Performance.** The 2026-11-13 findings (the linear stream splitter, the once-per-open vault root, the once-per-opening note picker) are platform-neutral and cover Windows equally. The only Windows-specific path — one short-lived `taskkill` process at teardown — was not measured; no Windows machine was available.

Known limits: no live Windows verification this session — the Windows rules are parameterized tests on macOS plus inspection, and the Windows machine from the 2026-11-12 follow-up should re-run the suite; `mkdir`'s `0o700` mode is not an ACL on Windows, where `%LOCALAPPDATA%` is already per-user; PATH-based DLL planting against a CLI remains inherent to Windows and is not mitigated (the macOS equivalent, `DYLD_*` variables, is stripped); iWork and Quick Look attachment conversion remains macOS-only, with a plain notice on Windows.

Gates: strict TypeScript, source lint, build, guard self-test, and 144 automated tests on this Mac — 148 minus `tests/auto-route.test.ts`, which another agent had in flight with `src/model-profiles.ts` at verification time and which was left untouched per AGENTS.md.

## Windows compatibility audit — unreleased

A read-only audit of the Windows-specific functions found the gaps below. The
fixes are confined to Windows branches; macOS and Linux behavior is unchanged.

- **Unset ComSpec (W1).** cross-spawn reads `process.env.comspec` in *this*
  process when it interprets a `.cmd`/`.bat` shim and falls back to a
  PATH-resolved `cmd.exe` when the variable is absent. `withPinnedShimInterpreter`
  now pins the validated system `cmd.exe` for the single synchronous spawn and
  restores the variable afterwards. The child-environment pin protects
  grandchildren, not cross-spawn; this closes that gap.
- **Redirected SystemRoot (W2).** `trustedSystemDirectory` validates the
  environment-derived system directory (absolute, no traversal, contains the
  installed `cmd.exe`) before it locates the shim interpreter or `taskkill.exe`;
  invalid values fall back to `C:\Windows`. The pure `comSpecPath`/`taskkillPath`
  helpers are unchanged, so the rules remain testable on any host.
- **Hermes PATH separator (W3).** `extendedPath` joins a child's PATH with `;` on
  Windows and `:` elsewhere; Hermes previously used a hard-coded `:`.
- **Hermes PATH casing (W6).** Windows commonly stores PATH as `Path`. A spread
  of `process.env` into a plain object keeps that casing, so `env.PATH` was
  undefined and Hermes lost PATH-based discovery and the child's inherited PATH.
  `envPath` now finds the variable case-insensitively.
- **Hermes private home (W7).** Mirroring the user's auth/state into OWLA's
  private home used `symlinkSync`, which fails with EPERM on ordinary Windows
  (Developer Mode/elevation required) and was silently ignored. It now falls
  back to a bounded copy, so Hermes no longer appears signed out.
- **Unrelated credentials (W4).** Windows children also drop common tokens
  (`GH_TOKEN`, `AWS_*`, `NPM_TOKEN`, and similar). Other platforms are untouched;
  the universal OpenAI/Anthropic denylist and OpenCode's `keepCredentials`
  exception are unchanged.
- **Excluded folders with backslashes (W8).** The excluded-folders setting is
  now normalised from `\` to `/`, so a Windows-entered `Private\Sub` excludes the
  same notes as `Private/Sub`. Before this, such an exclusion silently failed.

**Canvas, Bases and Excalidraw were not broken on Windows.** The test vault had
OWLA 3.1.2 installed, which predates these features entirely (added in 3.5.0).
The live app was upgraded to 3.6.0, Plugin Interconnectivity enabled, and a test
canvas created; the pure file logic has 20 automated tests. Three audits of
`visual.ts`/`excalidraw.ts`/`canvas.ts` against the real Obsidian 1.15.1 `app.js`
found no Windows defect: `internalPlugins.plugins[id].enabled` is exactly what
Obsidian's own `getEnabledPluginById` reads. An attempted change to
`internalPlugins.config[id]` was reverted and a regression test now pins the
correct shape.

Known limits (not changed): (a) storage defaults to `%LOCALAPPDATA%\OWLA Butler`;
folder redirection to a network share writes saved chats there too; (b) `foldPath`
uses APFS-style Unicode folding on every platform, so on NTFS distinct folders
such as `Straße` and `Strasse` may both be excluded — the error is conservative
(over-exclusion, not a containment escape); (c) `isPathInside(root, file, platform)`
resolves non-`win32` branches with the host's `node:path`, so an explicit foreign
platform on Windows is mishandled — no production caller passes it.

Verified on Windows 11 / Obsidian 1.15.1: CLI suite 17/17; full suite 320 tests /
302 pass / 18 fail, the same 18 pre-existing `EPERM` symlink-*fixture* failures as
the unmodified tree (311 / 293 / 18) — they occur in test `before()` hooks before
any assertion and are unrelated to the product; strict TypeScript, source lint,
build, guard self-test and release check clean. The new tests
(`tests/visual-availability.test.ts`, envPath, backslash exclusion) all pass.

## 3.0.0 OpenCode provider — 2026-11-12

The provider choice is the first setting. Codex keeps its own connection, sign-in, executable, quota and model controls; OpenCode gets the same controls for its own state, and only one provider's section is shown at a time. Settings migrate from schema 2 to 3: the Codex model and reasoning effort move into a per-provider record, the provider defaults to Codex, and the exhaustion fallback is off until it is enabled.

The OpenCode path was built against the official app-server-equivalent HTTP API of OpenCode 2.2.7, which OWLA pins to the tested 2.2 line. The process is OWLA's own: it starts with a random password, listens only on the loopback interface, runs in a private per-vault working directory, and is torn down with the process group after the reply. OWLA's own vault tools replace OpenCode's shell, file editing, search and subagent tools for the session; the session rules deny everything that is not one of those tools; inherited MCP servers are removed; the bundled skills are registered with the same IDs the Codex path uses. The assistant therefore cannot reach the vault except through OWLA, and every note change is still proposed for review.

Two findings shaped the implementation and are recorded in TESTING.md. OpenCode fills its plugin and skill registry when a location's services boot, which happens on the first session in that directory, so OWLA starts the server and creates the session in the same directory. And OpenCode's free models share one global limit, so the exhaustion fallback cannot be assumed to succeed; OWLA reports every exhausted provider with its reset time instead.

Current gates: 128 automated tests, strict TypeScript, Community source lint with zero warnings and errors, build, and the three-file release metadata, licence and embedded-reference checks. The release is prepared, not published: no tag, no release and no Community submission were performed.

Claude Code runs as the installed CLI in headless mode with safe mode on and permissions set not to ask. `--allowedTools` admits only OWLA's tools (`mcp__owla__*`), served from a private in-process MCP server, so Claude Code cannot run commands, read files or write on its own; every note change is still proposed for review. The child process loses `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and the Bedrock and Vertex switches, so it uses the user's Claude login and never a separately billed key. Error reports and self-updates are off; the user's own telemetry choice is kept because Claude Code's telemetry switches also hide the live model list. When live web search is required and Claude Code did not run it, the reply fails instead of being shown as verified. Plan limits are read with Claude Code's `get_usage` control request, which runs no model turn, and are updated from the reports it sends during replies.

Known limits: OpenCode's HTTP API is documented as experimental and was tested against 2.2.7 only; no live model turn completed because the free models are currently exhausted on this machine; the exhaustion rules are covered against recorded provider reports rather than a real exhausted account; and OpenCode's provider packages may be installed by OpenCode itself when a custom provider is configured. No live Claude Code turn is recorded.

# OWLA Butler 1.0.0 final audit

## 1.0.1 review follow-up — 2026-11-05

The reported source lint checks are enabled and pass locally. Codex messages, model metadata, settings, saved chats, quota data and PDF input are typed or checked at their boundaries. The CLI is found in common install locations or PATH, or by explicit user selection; OWLA no longer runs a shell to discover it. It still launches the chosen Codex CLI directly, checks filesystem containment, stores local chats/backups, enumerates eligible Markdown for search, and handles explicit copy/paste. The corresponding behavior notices may remain. Details and observed limits are in README.md and TESTING.md.

Only the three supported assets are attached to future Community releases. ZIP and checksums are a separate workflow artifact. The 1.0.1 changes are locally tested and prepared, with no new release or Community review yet. The sections below document 1.0.0.


## Community preparation — 2026-11-04

The final three-file test-vault install passed live skill/math, context continuation, optional-telemetry isolation, searchable settings, actual quota rendering and automatic process shutdown checks. Current gates: 50 tests, strict TypeScript, Community-specific lint with zero warnings/errors, build and embedded-reference/licence checks. Production audit: zero advisories; the unbundled development lint toolchain reports 13 moderate advisories. See TESTING.md for exact methods, evidence and limits.

README/disclosures, changelog, notices, contribution guide, release metadata/checks and draft-release automation are prepared. The repository’s description/homepage/topics were updated. The preparation pass left the repository private and unpublished; remote Actions, release downloads and Community approval are not verified by that local preflight. Follow COMMUNITY-RELEASE.md for owner review, public repository, matching tag, verified draft assets and current Community-form submission.

## V1 performance and usage gate — 2026-11-04

The v1 lifecycle replaces the earlier idle timeout with immediate owned-process shutdown after each response. The next message transparently recreates the backend and replays bounded recent context. A graceful process-group shutdown is awaited, with a bounded force-stop fallback, so both the launcher and native server are covered. Disconnecting during discovery cannot launch a late background agent.

Actual two-message test: first response 6.03 s; second response 4.95 s. Both ended with **zero owned Codex processes**. The second answer correctly recalled the project code from the first message; four visible history messages remained, distinct backend PIDs were observed and the ready dot stayed green. No chat restart or manual reconnection was used. The initial 250 ms shutdown probe exposed a still-closing process group; shutdown was changed to await exit and the test repeated successfully.

Settings rendered **two actual Codex quota windows** from account/rateLimits/read, with the exact server-reported used percentages, remaining percentages and Unix reset times. Quota updates arrive during requests and are refreshed after responses, on opening settings or manually. No periodic idle polling or local usage estimation. Missing/partial/multiple-bucket/over-limit data has explicit deterministic coverage; no quota reset or purchase was invoked. Green means authenticated/ready, not that an idle agent is resident.

Streaming now batches plain-text DOM changes every 50 ms and appends only new text. A synthetic test used the real Obsidian rendering path with 2,000 chunks / 62,000 characters: 3 streaming text changes, 538 ms total, complete final answer and no inference process. This is a rendering stress test, not model latency.

Final checks: TypeScript/build, **49 automated tests**, whitespace validation and artifact agreement. The earlier nine real automatic capability scenarios, six live skill reads, 22 lifecycle/layout checks, math rendering and final source/edit regression remain relevant functional evidence; the v1-specific shutdown/continuity/quota gate was tested separately on the v1 build. The one-time history-shortening notice and streaming/shutdown changes do not remove any retained skills or file safeguards.


Attachment continuity was also checked through OWLA’s actual send/replay path with a deterministic backend: a follow-up received the prior PDF page text, exact page reference and image without reattachment. Raw images and attachment-context fields were absent from the saved-chat payload. This verifies transport/context retention separately from the earlier live image/PDF understanding tests. Sources & activity identifies replayed attachment context. Recent images are bounded to two, and text context to 64,000 characters; explicit saves remain plain text only.

V1 evidence: work/v1-lifecycle-result.txt, work/v1-stream-stress-result.txt, work/v1-unit-tests.log, plus the retained Codex capability evidence listed below. Account identifiers and opaque reset-credit IDs must be removed from shareable evidence. Candidate is prepared for v1 release review; no tag, public release or repository visibility change was made.


2026-11-04. Result: Codex-only candidate staged for local release review; not published.

- Removed local model providers, downloads, runtime control, native OCR inference and memory guards. Reused installed Codex and its ChatGPT login, with no API-key interface.
- Codex app-server uses private process pipes, compatible-version checks, dynamic model/effort catalog, ephemeral conversations, cancellation and automatic idle shutdown. Unexpected server operations are denied; configuration is verified after inherited integrations are disabled per entry.
- Codex decides when to read notes, use retained skills, interpret attachments, research online or prepare an edit. No modes, welcome section or suggestion cards. Replies say OWLA; green/red connection dot has tooltip/accessibility text.
- All writes still use reviewed exact proposals, private backup, YAML/freshness validation and guarded Undo. Read/search paths reject exclusions, hidden/configuration files, traversal and escaping symlinks.
- 49 automated tests; 22 lifecycle/layout checks; nine real scenarios; six live skill reads; actual cancel/reconnect and final source/edit regression passed. See TESTING.md and audits/1.0.0/CAPABILITY-CHECKLIST.md for scope and measured results.
- Current known footprint about 4.60 GB. Runtime removed; saved work hashes and original backups preserved. Measured Codex process-family peak about 208 MiB during final tasks, excluding Obsidian/OS memory.

Remaining limits: experimental upstream app-server fields may change; only CLI 0.162.1 was tested live. Account entitlement is established by successful turns, not catalog presence alone. Quotas/network/model behavior remain provider-dependent. Long documents, arbitrary handwriting, every math problem, all themes/accessibility and every model are not certified. No arbitrary shell or file move/rename/delete tools. No publication, visibility change or release tag was performed.
