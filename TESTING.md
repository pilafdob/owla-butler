# OWLA Butler verification

## 3.0.0 provider framework and OpenCode — 2026-11-12

The provider layer was built as one shared contract, so every assistant behaves the same and a new one only needs its own bridge. The OpenCode path was verified against the installed **OpenCode 2.2.7** binary and against a deterministic fake server. Every check ran with OpenCode's data, config, state and cache directories redirected into `/tmp`, so the machine's real OpenCode state was never read or written. No vault, note or user credential was touched.

**Live checks against the installed binary**

- OWLA started OpenCode with its own random password, waited for the API to answer, and read the catalogue: **12 models**, all reported with their price, accepted input modalities, context window and reasoning variants. The `opencode` provider models report zero cost and image input, which is what the automatic router weighs.
- The private session directory contained the configuration, the tool payload, the skill payload and the plugin. The configuration denied everything and pointed at the plugin directory.
- The bundled plugin **loaded** (`owla.butler` reported active in the plugin registry), and the bundled skill `owla-formatting` appeared in the registered skill list. The session rules applied: the agent's effective permissions contained the deny-all entry.
- The registry was empty until the location was activated. This was found during the check: OpenCode fills the plugin and skill registry when the location's services boot, which happens on the first session in that directory. OWLA creates the session in the same directory it starts the server in, so the tools and skills are in place before the first turn.

**Deterministic checks**

- **128 automated tests** pass, strict TypeScript passes, and the Community source lint rules report zero errors and zero warnings. New coverage: the OpenCode version gate, executable discovery, model decoding, the permission ruleset, skill adaptation, usage decoding, the exhaustion rules and the instruction text.
- The bridge test drives the real bridge code against a fake OpenCode server: it starts the process, writes the workspace, loads the catalogue, creates a session, streams the answer, **calls back into OWLA over the loopback endpoint**, returns the tool result to the model, reads the usage limits and tears the process down. The tool call and its arguments were observed on the OWLA side.
- A separate end-to-end check with a mock OpenAI-compatible provider confirmed the shape of the whole loop: the model was offered exactly the OWLA tool and the skill tool, the tool ran, and its result reached the answer.

**Limits, stated plainly**

- **No live model turn completed.** OpenCode's free models are currently exhausted on this machine and answer with `provider.free-limit`, a typed error that carries the reset time. The free limit is global across the free models, not per model; that was confirmed by trying three different models. The provider was therefore not able to answer, and OWLA reports that honestly rather than as a made-up quota.
- The exhaustion rules are covered by unit tests against recorded provider reports, not by a real exhausted account.
- **New Obsidian tools and the Automatic provider are covered by unit tests only.** `query_vault_graph`, `propose_properties`, link checks on proposals, block reads and the automatic provider decision have deterministic tests; none was exercised in a live Obsidian vault or with a live model turn in this record. The Codex **Verify connection** button and the settings dividers were checked by type-check, lint and build, not by opening settings.
- **Claude Code was not verified end to end in this record.** Unit tests cover the version gate, argument building, model decoding, tool naming, image and tool content, plan-limit decoding, exhaustion, cited web sources and error wording. A source comment records that with Claude Code 2.1.322 the telemetry switches hide the live model list, which is why OWLA no longer sets them; that observation is not otherwise evidenced here. A live headless turn with OWLA's tools has not been recorded.
- OpenCode's own API is documented as experimental. OWLA pins it to the tested 2.2 line and refuses anything older, so an upstream change surfaces as a clear message rather than a broken chat.
## 1.0.1 composer and Community review regression — 2026-11-05

The three runtime files were backed up and installed in a test vault via Obsidian CLI. Existing data.json was preserved. The School vault and the user’s clipboard were left untouched.

- **55 automated tests**, strict TypeScript, the reported Community source lint rules (zero errors/warnings), build and release metadata/licence/reference checks passed. New cases cover malformed persisted settings/chats, malformed quota data, unknown inherited integration config and executable discovery without a shell. No dependency versions changed.
- **15 in-app composer checks** passed against a controlled backend: immediate text/chip clearing, sent image and outbound attachment preservation, preserving a matching newer draft, Stop/error recovery, no overwrite on restore, New chat cancellation, sent and saved-chat copy, selectable text, and 240 px copy control. Copy used a clipboard test double in Obsidian; the real system clipboard was not overwritten.
- **10 live integration checks** passed on Codex CLI 0.162.1. A synthetic PDF was extracted as text and rendered with visible content while Obsidian was hidden. Display rendering stalled in the hidden window before the fix; the attachment snapshot now uses PDF.js print intent. A synthetic screenshot and PDF were sent together: immediate clearing, dynamic guide call, correct screenshot code and exact quote/page reference, shutdown, same-chat follow-up and actual provider quota decoding passed. Response samples were 12.15 s and 4.66 s.
- Release workflow config keeps attestations for the three runtime files and ZIP, stores ZIP/checksums separately, and attaches only main.js, manifest.json and styles.css to the GitHub release. The 1.0.1 remote workflow and new Community scan have not run; the patch is not published.

Local evidence: `work/review-unit-tests.log`, `work/review-draft-result.txt`, `work/review-live-result.txt` and `work/review-patch-install.json`. The sections below retain historical 1.0.0 evidence.


## Community preparation — 2026-11-04

The exact three-file Community installation (main.js, manifest.json, styles.css; existing data.json preserved) was loaded and tested in a test vault through Obsidian CLI. No assets folder or node_modules was installed. All six guide tools worked. A live Codex request consulted owla-math and correctly produced 17/12 in Obsidian display LaTeX; the follow-up recalled the supplied test code across backend shutdown. Responses took 11.23 s and 7.62 s in this sample. Both ended with the process sleeping; the final OS process check found zero OWLA-owned agents.

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


## Attachment conversion and PDF review local verification

65 automated tests pass with typecheck, lint, build and three-file release checks. Obsidian CLI tests used disposable fixtures and no screen automation.

Fourteen attachment/editor assertions covered real Word DOCX and Pages content, PowerPoint slide XML, spreadsheet shared strings, a 12 MB BMP, unsupported status, unrestricted file selection, text drops, grouped edits, editor overlays and Accept/Decline cleanup. Four more assertions verified cancellation within five seconds, no late attachments after reset, multiple documents and no horizontal overflow. Native Pages, Keynote and Numbers exports returned the expected codes, and hashes of all four original Office/iWork fixtures stayed unchanged. A real Codex answer correctly identified all four codes with file citations.

Fourteen PDF assertions covered all text pages, page wikilinks, scanned page rendering, grouping comments, zero writes before acceptance, the composer lock, accepted annotation objects in a separate copy, unchanged source hashes, Decline, stale-source rejection, excluded files, a PDF over 20 MB, the context menu and adding its actual page. No Obsidian errors were captured.

The first live scanned-PDF question returned an unclear result from a dynamic page image. Automatic scanned-page images were then prepared before inference. The final live answer correctly returned SCAN-314 on page 2 and END-982 on page 3 with citations. Automatic page images are capped at 12 per attachment batch. More pages can be selected explicitly. General handwriting and layout accuracy remains model-dependent.

Conversion bounds are explicit. Prepared text is capped at 64,000 characters per document, Office archive content at 32 MB, and non-PDF conversion inputs at 512 MB. Native conversions have timeouts and cancellation. Quick Look previews are labelled as partial. Office text extraction does not preserve every diagram or chart. Apple app export requires installed apps and may request Automation permission. Original iWork documents are copied before native opening.

The PDF page menu uses an Obsidian DOM menu with Add page, Copy page link and Copy selected text. PDF annotation proposals remain in memory until resolved or plugin unload. They use standard PDF text comments, with source freshness checks and a separate output file on acceptance. No OCR layer is written into the PDF. The experimental editor overlay is temporary, uses theme colors and is hidden on stale text. Tests cover the default theme on this Mac, rather than every theme and PDF layout.

Evidence is in work/attachments-live-result.txt, work/attachments-model-result.txt, work/attachment-final-qa-result.txt, work/pdf-live-qa-result.txt, work/pdf-model-result.txt and work/pdf-features-unit.log.

### Muted experimental diff styling

Removed the added/removed emoji widgets. Additions and removals now use 12% theme-green/theme-red backgrounds. Removed text uses the normal text color. Typecheck, lint, build and release checks passed. A live test-vaultain disposable-note check confirmed no diff emojis, both translucent colors, normal text color and preservation of the existing chat. The installed files and running stylesheet were updated without restarting the chat. Evidence is in work/muted-diff-live-result.txt and work/muted-diff-style-result.txt.

### Diff selector and normal workspace split

The Diff view setting offers Highlights in editor, None and Split diff view. Legacy enabled toggles migrate to highlights, disabled toggles to none. All 66 automated tests, typecheck, lint, build and release checks passed. Eight live test-vault assertions verified one normal workspace leaf to the right of the note, source Markdown rendering, exact match to the modal diff, mutually exclusive editor highlights, switching modes and Accept in chat closing the resolved pane. The initial acceptance check ran before the asynchronous UI update finished. Waiting for the composer to unlock verified the completed behavior. No Obsidian errors were captured. Evidence is in work/split-diff-qa-result.txt and work/split-diff-unit.log.

### 1.3.0 release build

The exact 1.3.0 build passed 66 automated tests, eight workspace split checks, fourteen PDF checks and a send-path regression check confirming that all three current image attachments reached the Codex bridge. No Obsidian errors were captured. Previous image history remains bounded separately from the current attachments. Evidence is in work/release-1.3.0-*.
