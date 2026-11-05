# OWLA Butler 1.0.0 final audit

## 1.0.1 review follow-up — 2026-11-05

The reported source lint checks are enabled and pass locally. Codex messages, model metadata, settings, saved chats, quota data and PDF input are typed or checked at their boundaries. The CLI is found in common install locations or PATH, or by explicit user selection; OWLA no longer runs a shell to discover it. It still launches the chosen Codex CLI directly, checks filesystem containment, stores local chats/backups, enumerates eligible Markdown for search, and handles explicit copy/paste. The corresponding behavior notices may remain. Details and observed limits are in README.md and TESTING.md.

Only the three supported assets are attached to future Community releases. ZIP and checksums are a separate workflow artifact. The 1.0.1 changes are locally tested and prepared, with no new release or Community review yet. The sections below document 1.0.0.


## Community preparation — 2026-11-04

The final three-file Agentbrain install passed live skill/math, context continuation, optional-telemetry isolation, searchable settings, actual quota rendering and automatic process shutdown checks. Current gates: 50 tests, strict TypeScript, Community-specific lint with zero warnings/errors, build and embedded-reference/licence checks. Production audit: zero advisories; the unbundled development lint toolchain reports 13 moderate advisories. See TESTING.md for exact methods, evidence and limits.

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
- 49 automated tests; 22 lifecycle/layout checks; nine real scenarios; six live skill reads; actual cancel/reconnect and final source/edit regression passed. See TESTING.md and CAPABILITY-CHECKLIST.md for scope and measured results.
- Current known footprint about 4.60 GB. Runtime removed; saved work hashes and original backups preserved. Measured Codex process-family peak about 208 MiB during final tasks, excluding Obsidian/OS memory.

Remaining limits: experimental upstream app-server fields may change; only CLI 0.162.1 was tested live. Account entitlement is established by successful turns, not catalog presence alone. Quotas/network/model behavior remain provider-dependent. Long documents, arbitrary handwriting, every math problem, all themes/accessibility and every model are not certified. No arbitrary shell or file move/rename/delete tools. No publication, visibility change or release tag was performed.
