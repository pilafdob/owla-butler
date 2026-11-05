# OWLA Butler 1.0.1 — patch candidate

The 1.0.1 patch fixes immediate composer clearing, sent-message copy and safe draft recovery. It addresses the 1.0.0 Community source findings, separates optional archives from release assets and fixes background PDF snapshot rendering. See TESTING.md for the final local checks. This patch is not published. The older 1.0.0 candidate evidence follows.

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


Staged 2026-11-04 for direct installation and review. Not published or tagged.

This candidate replaces local inference with the installed Codex CLI and existing ChatGPT authentication. The final user-requested UI is one automatic chat with model/reasoning controls, OWLA responder headings, a green/red connection dot and an empty welcome area.

Required: desktop Obsidian 1.14.5+, installed Codex 0.162.1+, signed in with ChatGPT and an account allowed to use the selected model. No API-key authentication or separate API-billing integration. The CLI is not bundled or automatically installed/updated.

Acceptance: 49 automated tests, 22 in-app lifecycle/layout checks, nine real capability scenarios, six live skill consultations, cancellation/reconnection and final source/edit regression passed. Checklist and report describe representative coverage and limits. Codex model catalogs are dynamic; only GPT-6.1 Sol / low was exercised across this matrix.

Packaging gate: ZIP integrity, version agreement, required assets, skill/reference licences, supplied Phosphor icon and installed-vs-packaged artifact hashes must match. Exclude data.json, credentials, user notes, model files, node_modules and work/. Publish only after reviewing this exact ZIP; publishing is a separate action.

See README.md, TESTING.md, AUDIT.md and CAPABILITY-CHECKLIST.md. Detailed evidence and checksum/build records accompany the candidate.
