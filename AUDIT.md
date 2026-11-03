# OWLA Butler pre-final audit

Date: 2026-11-03. Result: **not ready for final acceptance**. The plugin mechanisms pass the checks below; the small model and memory behavior do not yet meet the overall reliability requirement.

| Requested area | Verified | Remaining limitation / gate |
| --- | --- | --- |
| Obsidian skills | Original Markdown, Bases and JSON Canvas packages, reference files and licence bundled; actual in-app reference-tool reads passed. | Reference availability does not prove the 0.8B model uses them correctly. Filesystem tools still edit Markdown only. |
| PDF skills | Local selected-page extraction and rendering through bundled PDF.js; exact filename/physical-page metadata; PDF guide accessible. | Full-document synthesis, automatic multi-page OCR, complex layout interpretation and password-protected input are unsupported or unverified. The PDF model-answer trial was refused by the guard. |
| Markdown understanding | YAML/wikilink preservation and exact passage edits passed; original Markdown reference available. | Broad model-generated Markdown quality is not established. |
| Math / Obsidian LaTeX | In-app MathJax rendered inline math, a fraction/root, a matrix and aligned steps with four math containers and no math error node. Reference contains correct literal LaTeX escapes. | This verifies syntax/rendering, not solving or mathematical correctness. Complex model reasoning is unverified. |
| OCR / images | Earlier real-model simple printed-equation OCR passed. Dedicated transcription mode, local resize, PDF-page image path and OCR guide implemented. | Handwriting, dense formulas, diagrams, tables and ambiguous symbols have not passed a representative real-model test set. |
| Editing / context | Actual in-app fixture apply/Undo, metadata/link preservation, stale rejection, denied configuration/traversal, and persistent pre-edit recovery passed. Requests/selections now precede bulk source text and old history is bounded. | Model semantic edit quality and instruction-injection resistance are not established. Context budgeting estimates characters, not exact tokenizer counts; source clipping is surfaced to the user. |
| Reliability / file, storage and chat management | Three mocked search/read/synthesis cycles passed. History bounded to six messages; reset clears transient attachments. File operations are conservative read/search/propose/apply/Undo. Recovery is capped at 20 snapshots / 5 MB; logs rotate. Measured installation remains below 10 GB. | The actual model missed a requested path citation and caused brief critical pressure. No saved-chat browser, rename/move/delete workflow or ongoing global 10 GB quota. Redundant previous installations/backups were retained. |
| UI / scaling | Real Obsidian CSS layout measured at 240×400, 280×600, 360×800 and 600×600; Send/composer stayed inside root with no horizontal root overflow. Header, narrow toolbar, tables/math and review actions adjusted. | Layout geometry is verified; a current full physical interaction/visual polish walkthrough is incomplete because native automation returned stale window state. Aesthetic quality is not an automated pass. |

## Evidence

- `npm run check`, `npm run build`, `npm test`: passed; **26 automated tests**.
- `work/final-audit-result.json`: **21 in-app API/layout checks passed**, including three mocked search/read/synthesis cycles. These mock responses are test fixtures, not evidence of model intelligence.
- `work/pdf-live-result.txt`: actual PDF.js extraction/render result for a fictional in-memory PDF.
- `work/final-live-model-result.json`: actual selected downloaded Qwen 3.5 0.8B Q8 model answered the current-note title correctly in **3.664 seconds** but omitted the requested exact path. The note remained unchanged. External samples saw pressure level 2 / 39% free at start and level 4 / 21% free at 2.11 seconds. This is a failed overall acceptance trial, despite the correct title.
- After that observation, guard admission was raised from 35% to **40%** reported headroom; sampling reduced to one second; unreadable pressure level fails closed. A pending old sample cannot stop a new turn. These changes passed automated checks; no new inference run was used to claim the pressure problem solved.
- Disk allocated sizes (`du -sk`) after audit, including current + earlier OWLA copies, legacy installation/backups, unused OpenCode, Obsidian itself, ~/.ollama, OWLA logs and source/dependencies: approximately **9.213 GB**. This is a snapshot, not an enforced quota. Shared unrelated caches excluded.
- Supplied Phosphor SVG matched by SHA-256 earlier; tagline removed.

## Final-stage gates

1. Real-model source citation, selected passage editing and representative OCR/PDF/math prompts must pass without critical or sustained memory pressure.
2. Check the physical UI in current light/dark themes, narrow sidebar, keyboard navigation, attachment picker, edit review, Apply and Undo. Geometry tests alone do not close this gate.
3. Decide whether temporary chat sessions and conservative Markdown-only file operations meet the intended product scope; otherwise implement explicit saved chats/file organization.
4. Keep total setup below 10 GB; do not assume further downloads remain within the measured budget. Cleanup should preserve original vault backups and user-selected data.

The plugin remains a development preview. No publication or final release approval is implied.
