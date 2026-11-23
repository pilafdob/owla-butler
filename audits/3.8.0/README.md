# 3.8.0 handoffs

Source: `Change Proposal 3.8.0.md` (user's vault). Five handoffs, run in two waves.
The lead agent (Claude) reviews everything after the workers finish.

| # | Handoff | Wave | Main files |
|---|---------|------|------------|
| 1 | `01-excalidraw-robustness.md` | 1 | `src/excalidraw.ts`, excalidraw tool code in `src/main.ts`, `assets/skills/owla-excalidraw` |
| 2 | `02-obsidian-guide.md` | 1 | `assets/skills/*`, `assets/reference-pack.json`, `src/knowledge.ts` |
| 3 | `03-pdf-selection-context.md` | 1 | PDF menu code + attachments in `src/main.ts`, `src/attachments.ts`, `src/pdf.ts` |
| 4 | `04-note-context-and-properties.md` | 2 (after 1 and 3 report done) | `src/note-tools.ts`, context + propose tools in `src/main.ts` |
| 5 | `05-pdf-export.md` | 2 (after 4 reports done) | new `src/pdf-export.ts`, tool wiring in `src/main.ts` |
| 6 | `06-review.md` (Opus reviewer) | 3, after 1–5 report done | writes `REVIEW-3.8.0.md` |

## Rules for every worker (from `AGENTS.md`, restated)

- `git pull` first. Run `git status` before and after every edit; changes you did not make belong to another agent.
- NEVER run `git checkout --`, `restore`, `reset`, `clean`, `stash`, `commit`, or any `push`. Do not commit. Leave changes in the working tree.
- `src/main.ts` is shared and huge. Use small targeted `Edit`s, re-read the region right before editing, never rewrite the file.
- Stay inside your listed files. Need something outside them? Add a one-line note under "Handoff notes" in your own file and keep going.
- Do not bump the version or touch `CHANGELOG.md`/`RELEASE-NOTES.md`; the lead does that.
- Gates before you report: `npm run check`, `npm run lint`, `npm test`, `npm run build` (build only if you are the last worker active; otherwise skip and say so). Paste real results.
- Add unit tests under `tests/` for every behaviour you add (the earlier release skipped regression tests; do not).
- When done, fill the "Report" section at the bottom of your handoff file: files changed, what was verified and how, what was NOT verified, open questions.

## Suggested model tier per worker (Hermes Plus)

The exact Hermes Plus catalog was not verifiable from this repo, so pick the closest available model in each tier.

| # | Tier | Why |
|---|------|-----|
| 1 Excalidraw | strongest coder (Claude Opus/Sonnet class, or GPT-5 class) | clustering algorithm, op validation, revert correctness |
| 2 Obsidian guide | mid-tier (Sonnet/Haiku class) | mostly writing plus small registration code |
| 3 PDF selection | strong coder with good UI/Obsidian API knowledge | touches fragile `main.ts` menus and image routing |
| 4 Note context and properties | strongest coder | many wiring points across providers, diff/revert safety |
| 5 PDF export | strongest coder, high effort | feasibility research plus Electron/Obsidian internals |

Avoid free or small models (flash/nemotron class) for 1, 4, 5: the 3.7.2 session logs show them wasting turns on large drawings.
