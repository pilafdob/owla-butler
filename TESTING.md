# OWLA Butler verification

Date: 2026-11-03. Test host: Apple Silicon M2 Air, 8 GB RAM; Obsidian 1.14.5; Agentbrain vault. Development preview, not a community release. Installer-specific checks below describe a previous development build; the Community candidate requires separately installed Ollama and model weights.

## Checks

- TypeScript check and production build passed.
- 26 unit/localhost integration tests passed: path boundaries, stale edit/Undo, metadata preservation, insertion safety, image display restrictions, memory thresholds, streaming, cancellation, model-pull progress and failure handling.
- Earlier live-plugin API harness passed 13 checks: current-note capture, selected text/images sent, explicit edit proposal, apply/Undo, stale rejection, exclusions/traversal, and following a changed note. Apply/Undo were exercised through plugin methods, not a complete physical-button walkthrough.
- Fresh runtime bootstrap was executed in a disposable temporary directory: official Ollama v0.40.14 archive downloaded, SHA-256 verified, extracted, executable reported version 0.40.14. Temporary verification runtime removed afterward. No inference used.
- The setup modal was opened through the actual chat-header button in Obsidian. The user selected a temporary storage folder through the native macOS folder picker. Download model was clicked through native UI automation. The complete download finished with “Ready”; settings persisted `qwen3.5:0.8b-q8_0`, port 11435 and the selected external folder. Runtime and model were freshly downloaded there. Reload preserved the settings, reported no captured errors, and no `ollama serve` or `ollama runner` process remained. The existing Finder picker worked; an apparent missing dialog was an automation visibility limitation, confirmed by the user.
- Plugin reload reported no captured runtime errors. Supplied Phosphor bird is bundled and the previous tagline is removed.

## Model observations before the installer change

| Trial | Result |
| --- | --- |
| Qwen 3.5 2B, reduced context/batch | Two attempts stopped by memory guard, around 6.1 s and 4.1 s. Not accepted on this workload. |
| Qwen 3.5 0.8B Q8, active-note question | Correct title and note content; 5.725 s. Reported loaded model size approximately 1.03 GB. |
| 0.8B Q8, simple printed equation screenshot | Dedicated transcription mode read `Solve: 2x + 3 = 11` correctly; 4.209 s. Deterministic display-math formatting tested separately. |
| 0.8B Q8, generic image chat | Rejected: wandered into tools/explanation. Dedicated Image → Markdown mode addresses this workflow. |
| 0.8B Q8, vault-search trial | Memory guard stopped loading after 3.717 s. Reliable autonomous retrieval is not established. |

These are narrow observations, not proof of complex OCR, mathematical reasoning, sustained agent reliability, or three complete search/read/synthesis passes. The expanded OWLA instruction profile has not been quality-benchmarked. Memory guard remains enabled; pre-existing memory pressure from other apps affects admission. No exact RAM guarantee is made.

## Scope boundaries

Selected-page PDF upload/extraction and page-image rendering are implemented with Obsidian’s bundled PDF.js. Whole-document synthesis and automatic multi-page OCR are not implemented. Bases and Canvas instructions do not grant file tools for those formats. The Community candidate does not install a runtime or model weights. Cloud fallback is absent.

For setup, update and removal instructions see README.md. Updating the plugin preserves data.json. Separately installed models remain outside the plugin.

## Disk measurement after setup

Allocated sizes measured with `du -sk`: new selected runtime/model directory 1,589,920 KiB (1.628 GB); earlier OWLA storage 1,614,352 KiB; legacy local-agent installation including original vault backups 4,473,480 KiB; unused OpenCode app 424,468 KiB; development source/dependencies 56,700 KiB. Including Obsidian itself (540,864 KiB), OWLA logs (196 KiB) and the existing ~/.ollama directory (296,276 KiB), the measured total is 9.212 GB, below 10 GB. Shared unrelated system/package caches are not included. Earlier model copies and backups were retained; setup did not silently delete them. Changing storage does not migrate old copies. This is a measured snapshot, not a permanent disk-usage cap if further models are added.

Evidence: terminal test results; Obsidian eval setup status/persisted settings; native UI model-download action; runtime version/checksum test. Fresh runtime verification ran without loading a model. No new inference benchmark was run after the installer change.

## Selected-page PDF update

- Added Attach → PDF page selection, extracted text or rendered page image, physical page references, 20 MB input limit, bounded text, and document/render cleanup.
- Added unit checks for line boundaries, page-range validation and source filename escaping; 20 total tests pass.
- Actual in-app PDF.js parsed an in-memory fictional PDF and extracted `OWLA PDF test. A triangle has three sides.`. Render succeeded at 400 × 200 pixels; the text attachment API retained `OWLA PDF fixture.pdf, p. 1`. This checks the engine and attachment API; a complete physical page-picker button walkthrough was not established because UI automation returned stale state.
- A short question was submitted through the installed plugin using the user-selected runtime/model directory. Memory guard refused admission in 0.096 s; no model answer was generated and the disposable note remained unchanged. Do not describe this as a successful PDF model-answer test.
- PDF parsing and attachment do not load model weights. The existing memory guard and automatic runtime lifecycle remain enabled. No guard bypass or automatic heavier-model trial was attempted.

## Pre-final audit

See AUDIT.md for the requested eight-area matrix, final 21-check in-app audit and the failed real-model citation/resource acceptance trial. The current memory admission threshold is 40%, with one-second checks and fail-closed pressure-level detection. Earlier trial results above used earlier guard settings. No complete release acceptance is claimed.

## Community candidate

The installer was removed after the development audit to meet Obsidian Community policy. Typecheck, 23 remaining automated tests, and a production build passed on the revised source. A new native UI and real-model acceptance run has not passed, so this is not a public-release verification.
