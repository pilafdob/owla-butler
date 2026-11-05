# OWLA Butler verification

## 1.0.1 composer and Community review regression — 2026-11-05

The three runtime files were backed up and installed in Agentbrain via Obsidian CLI. Existing data.json was preserved. The School vault and the user’s clipboard were left untouched.

- **55 automated tests**, strict TypeScript, the reported Community source lint rules (zero errors/warnings), build and release metadata/licence/reference checks passed. New cases cover malformed persisted settings/chats, malformed quota data, unknown inherited integration config and executable discovery without a shell. No dependency versions changed.
- **15 in-app composer checks** passed against a controlled backend: immediate text/chip clearing, sent image and outbound attachment preservation, preserving a matching newer draft, Stop/error recovery, no overwrite on restore, New chat cancellation, sent and saved-chat copy, selectable text, and 240 px copy control. Copy used a clipboard test double in Obsidian; the real system clipboard was not overwritten.
- **10 live integration checks** passed on Codex CLI 0.162.1. A synthetic PDF was extracted as text and rendered with visible content while Obsidian was hidden. Display rendering stalled in the hidden window before the fix; the attachment snapshot now uses PDF.js print intent. A synthetic screenshot and PDF were sent together: immediate clearing, dynamic guide call, correct screenshot code and exact quote/page reference, shutdown, same-chat follow-up and actual provider quota decoding passed. Response samples were 12.15 s and 4.66 s.
- Release workflow config keeps attestations for the three runtime files and ZIP, stores ZIP/checksums separately, and attaches only main.js, manifest.json and styles.css to the GitHub release. The 1.0.1 remote workflow and new Community scan have not run; the patch is not published.

Local evidence: `work/review-unit-tests.log`, `work/review-draft-result.txt`, `work/review-live-result.txt` and `work/review-patch-install.json`. The sections below retain historical 1.0.0 evidence.


## Community preparation — 2026-11-04

The exact three-file Community installation (main.js, manifest.json, styles.css; existing data.json preserved) was loaded and tested in Agentbrain through Obsidian CLI. No assets folder or node_modules was installed. All six guide tools worked. A live Codex request consulted owla-math and correctly produced 17/12 in Obsidian display LaTeX; the follow-up recalled the supplied test code across backend shutdown. Responses took 11.23 s and 7.62 s in this sample. Both ended with the process sleeping; the final OS process check found zero OWLA-owned agents.

Effective child configuration confirmed analytics and feedback disabled, all three OTEL exporters disabled, shell disabled and connectors disabled. The model catalog and existing ChatGPT login worked. Seven searchable setting definitions rendered through Obsidian’s native settings renderer, with Connect/Sign in/Disconnect/executable/usage controls and two real quota cards. Opening/refreshing settings also returned to sleep. No Obsidian errors were captured. One test-harness attempt could not import the Obsidian host module from CLI eval; it was corrected to use the host’s own settings renderer and the full smoke test was repeated successfully.

Current gates: **50 automated tests**, strict TypeScript, Community-specific ESLint (zero errors and warnings), build, full embedded-reference/licence checks and ZIP checks. Production dependency audit: zero known advisories. The lint-only development dependency tree currently reports 13 moderate advisories through its toolchain; those packages are not bundled or installed with the plugin. This is recorded separately from production dependencies rather than applying incompatible forced overrides.

README, changelog, release notes, package/manifest metadata, notices, contribution guide and COMMUNITY-RELEASE.md now describe the Codex-only product, separate CLI/account requirements, possible provider payments, network/context processing and outside-vault files. The build embeds complete OWLA/Phosphor/Obsidian-skills/jsdiff redistribution notices in main.js. Release automation checks metadata/assets, supplies checksums and notes, attests assets and creates a draft. Remote Actions, public release downloads and Community review have not been run by this local preflight.

At preparation time, the repository description/homepage/topics were updated while the repository remained private with no release published. Owner actions remain: review and commit the prepared source, make it public, tag 1.0.0, verify the built draft assets, publish, link the owner’s GitHub account at community.obsidian.md and submit through the current Community form. Optional payment is the proposed listing category for the external Codex service. See COMMUNITY-RELEASE.md for official policy links and the exact checklist.

Evidence: work/community-smoke-result.txt, work/community-unit-tests.log and work/community-production-audit.json. Public summaries omit raw account identifiers and private vault content. This supplements the broader representative capability matrix below; it does not claim that every previous scenario was re-run for documentation-only changes.


## V1 performance and usage gate — 2026-11-04

The v1 lifecycle replaces the earlier idle timeout with immediate owned-process shutdown after each response. The next message transparently recreates the backend and replays bounded recent context. A graceful process-group shutdown is awaited, with a bounded force-stop fallback, so both the launcher and native server are covered. Disconnecting during discovery cannot launch a late background agent.

Actual two-message test: first response 6.03 s; second response 4.95 s. Both ended with **zero owned Codex processes**. The second answer correctly recalled the project code from the first message; four visible history messages remained, distinct backend PIDs were observed and the ready dot stayed green. No chat restart or manual reconnection was used. The initial 250 ms shutdown probe exposed a still-closing process group; shutdown was changed to await exit and the test repeated successfully.

Settings rendered **two actual Codex quota windows** from account/rateLimits/read, with the exact server-reported used percentages, remaining percentages and Unix reset times. Quota updates arrive during requests and are refreshed after responses, on opening settings or manually. No periodic idle polling or local usage estimation. Missing/partial/multiple-bucket/over-limit data has explicit deterministic coverage; no quota reset or purchase was invoked. Green means authenticated/ready, not that an idle agent is resident.

Streaming now batches plain-text DOM changes every 50 ms and appends only new text. A synthetic test used the real Obsidian rendering path with 2,000 chunks / 62,000 characters: 3 streaming text changes, 538 ms total, complete final answer and no inference process. This is a rendering stress test, not model latency.

Final checks: TypeScript/build, **49 automated tests**, whitespace validation and artifact agreement. The earlier nine real automatic capability scenarios, six live skill reads, 22 lifecycle/layout checks, math rendering and final source/edit regression remain relevant functional evidence; the v1-specific shutdown/continuity/quota gate was tested separately on the v1 build. The one-time history-shortening notice and streaming/shutdown changes do not remove any retained skills or file safeguards.


Attachment continuity was also checked through OWLA’s actual send/replay path with a deterministic backend: a follow-up received the prior PDF page text, exact page reference and image without reattachment. Raw images and attachment-context fields were absent from the saved-chat payload. This verifies transport/context retention separately from the earlier live image/PDF understanding tests. Sources & activity identifies replayed attachment context. Recent images are bounded to two, and text context to 64,000 characters; explicit saves remain plain text only.

V1 evidence: work/v1-lifecycle-result.txt, work/v1-stream-stress-result.txt, work/v1-unit-tests.log, plus the retained Codex capability evidence listed below. Account identifiers and opaque reset-credit IDs must be removed from shareable evidence. Candidate is prepared for v1 release review; no tag, public release or repository visibility change was made.


Date: 2026-11-04. Test vault: disposable vault. Obsidian 1.14.5, Codex CLI 0.162.1, ChatGPT login, GPT-6.1 Sol / low reasoning. No API key or local inference. Native screen automation was not used.

## Checks

TypeScript, production build and 49 automated tests pass. Tests cover exact/stale edits, YAML insertion boundaries, citations/links, private bounded recovery/chats, skills/reference integrity, source search, CLI version/migration, model/effort validation, denied RPC requests, cancellation, quota/authentication errors and web-search truthfulness. Dependency audit and artifact hashes are recorded separately.

22/22 actual Obsidian lifecycle/layout assertions pass: reference access, excluded-open-note refusal, invalid YAML/CRLF refusal, exact apply/metadata preservation/Undo/stale refusal, recovery files, chat roundtrip/image stripping, absence of local setup/modes, four responsive sizes and fixture restoration. Additional filesystem testing denied an outside-vault symlink and its read. Final new-chat DOM is empty, with no welcome cards or modes.

## Real model scenarios, automatic tool choice

| Scenario | Seconds | Result |
| --- | ---: | --- |
| compare | 14.60 | Pass |
| science | 4.97 | Pass |
| missing | 5.09 | Pass |
| math | 5.12 | Pass |
| edit | 9.53 | Pass |
| pdf | 4.34 | Pass |
| image | 3.69 | Pass |
| web | 14.56 | Pass |
| boundary | 9.64 | Pass |

All nine cases returned without plugin errors and left fixture notes unchanged. Human checks confirmed exact source paths and citation key preservation; correct revision dates with proposals separated from evidence; correct axial-tilt explanation; missing email admitted; 17/12 plus quadratic roots 2 and 3; the intended active-recall replacement; Triangle.pdf p. 1 citation; faithful printed-equation transcription; actual web-search activity and linked official callout guidance; and denied hidden/outside paths and shell access.

Codex separately read all six retained skill packages through actual read_reference calls, then produced valid Markdown/YAML/wikilink/citation/math content. Its real fraction/quadratic answer rendered using OWLA’s Obsidian rendering path: four math containers, zero MathJax errors. Rendering was tested separately using the captured actual answer, not counted as another inference benchmark.

Live cancellation of a started turn preserved the draft, stopped the owned process and allowed automatic reconnection. The OWLA heading, green connected dot, red disconnected dot and absence of modes were verified. Signed-out/API-key/quota handling was simulated deterministically; shared account logout or actual quota exhaustion was not induced.

## Final regression and resources

After filesystem-boundary protection, the exact candidate repeated real source comparison and edit proposal tasks successfully. The process family was sampled each second during those tasks: peak 207.78 MiB; no critical memory-pressure sample. This excludes Obsidian/shared OS memory and is a sample, not a hard RAM guarantee. No local model weights are loaded.

Known allocated installation footprint: 4,599,787,520 bytes (about 4.60 GB), including preserved original vault backups, Obsidian, existing Codex CLI, source/dependencies, logs and current external storage. The verified OWLA runtime removal freed 633,782,272 allocated bytes; the model directory was already absent. All 19 preserved chat/recovery files matched hashes across cleanup. Original vault backups were untouched.

## Corrections and limits

Initial Codex tests exposed inherited integration configuration, disabled native web search, a restrictive web instruction and narrow-pane layout problems; these were corrected and the affected scenarios repeated. Failed intermediate records are kept locally, not counted as passes. The earlier 0.1 tiny-local-model failures remain historical; the 0.2 source/skill/image/math results are new Codex tests.

Skills are instructions rather than training. These are representative tests, not guarantees for every scientific claim, mathematical proof, handwriting or complex layout. PDF handling is selected-page only. Markdown file updates are reviewed; arbitrary rename/move/delete and Base/Canvas file editing are unsupported. Additional Codex versions/models, other platforms, exhaustive accessibility/themes and long-term quota/network behavior have not all been certified.

Evidence in source work/: codex-auto-qa-results.json, codex-skills-qa-results.json, codex-lifecycle-result.json, codex-cancel-reconnect-result.txt, codex-math-render-result.json, codex-final-regression-results.json, codex-final-resources.json, codex-final-storage.json, codex-cleanup-record.json and codex-unit-tests.log. Sanitized user-facing evidence and checksums accompany the ZIP. Real-model tests preceded the final one-time history-shortening notice; that UI-only addition passed the final build/check/test run.
