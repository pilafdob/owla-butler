---
name: OWLA Excalidraw
description: Reading, seeing and changing Excalidraw drawings (.excalidraw.md, .excalidraw and .md drawing notes) through OWLA's reviewed drawing operations.
---
# Excalidraw drawings in OWLA

## Canvas → Excalidraw: the short route
1. Use `read_reference` name `owla-excalidraw` (follow continuation offsets), then `read_canvas` with the source path and `visual: true` (a boolean, not a string).
2. Keep the original canvas unchanged. Choose one new destination beside it: `Topic.canvas` → `Topic.excalidraw.md`, unless the user specifies otherwise. If the destination exists, read it first; do not overwrite it silently.
3. Use `propose_excalidraw` with `path`, `reason` and `operations`: add the cards as shapes/text first, then `read_excalidraw` without a picture to get their actual generated ids. Add edges/frames in a second proposal to the SAME path. Both calls update one staged drawing; no acceptance is needed between them.
4. Check the finished drawing once with `read_excalidraw` and `visual: true`. Correct only concrete defects; report the reviewable path and any limits briefly.

Use OWLA tools only: no shell, filesystem searches, plugin/config discovery, scripts, raw scene JSON, manual compression or extra format copies. If required tools are missing, stop and report the unavailable tool; never bypass review.

## Read before you change
Drawings may be `.excalidraw.md`, `.excalidraw` (plain JSON) or `.md` notes with `excalidraw-plugin` frontmatter. Both drawing tools support all three; keep an existing file's exact path. OWLA handles encoding and compression.
- `read_excalidraw` lists elements, ids, positions, sizes, text, colours, frames and connections. Follow continuation offsets until all relevant elements are covered.
- Freehand ink (freedraw strokes) is listed as clusters — e.g. `ink cluster c1: 23 strokes at (-447,-270) 210×95`. Each cluster covers at most about 240×120 px, so clusters c1, c2, … (top to bottom) mark where each piece of handwriting is. Handwriting inside ink can only be read with `visual: true`; a text summary cannot read what ink says.
- Read an existing drawing before proposing edits. A new destination needs no read before creation.
- Use `visual: true` when meaning depends on layout, colours, handwriting, images or unbound arrows. Mark unclear content rather than guessing.

## Change with operations
`propose_excalidraw` stages operations for the user to accept or decline. Never edit the file text with propose_edit: the drawing data would be damaged.
- `add_shape` {shape, x, y, width, height, text?, style?} — text is centred in the shape.
- `add_text` {x, y, text, style?} — free text.
- `add_arrow` {from, to, label?, style?} — connects two existing or newly added element ids; it follows the shapes when they move in Excalidraw.
- `add_frame` {x, y, width, height, name, contains?}
- `update_text` {id, text} — the id of a text element or of a shape with text.
- `move` {id, x, y} or {id, dx, dy}; `resize` {id, width, height}; `set_style` {id, style}; `delete` {id} (removes its text and unbinds arrows).
- `delete_many` {ids} — removes several elements at once; every id must exist.
- `delete_cluster` {cluster} — removes every stroke of an ink cluster (`c1`, `c2`, …) from the read summary in one operation; `{cluster: "all"}` removes all freehand ink at once. A wrong name errors with the valid cluster names.
New elements get ids you cannot predict. To connect new shapes, add them in one proposal, read the drawing again (it shows the staged version), then add arrows in a second proposal.

## Replacing handwriting (ink)
- Read the drawing with `visual: true` to see what the ink says; the text listing cannot read handwriting.
- Remove ink with `delete_cluster` (`"all"` for a full cleanup, or `delete_many`), then rebuild the structure with `add_shape`/`add_text` at the ink cluster's position, so the layout is kept.
- If you cannot tell what a cluster says, say so and ask the user rather than guessing.

## Layout that reads well
- Leave at least 40 px between shapes and 80–120 px between rows or columns. Align centres on a grid rather than placing shapes ad hoc.
- Size a shape for its text: about 10 px per character at the default font size plus 40 px padding, and at least 60 px high.
- Keep one direction of flow (left→right or top→bottom). Avoid crossing arrows.
- Use colour for meaning and keep the palette small. Excalidraw's defaults: stroke `#1e1e1e`; fills `#ffc9c9` red, `#b2f2bb` green, `#a5d8ff` blue, `#ffec99` yellow, `#d0bfff` violet; strokes `#e03131`, `#2f9e44`, `#1971c2`, `#f08c00`, `#6741d9`.
- Keep the existing style of a drawing (roughness, font, stroke width) when adding to it.

## Check your work
After staging, call `read_excalidraw` with `visual=true` again. Fix overlaps, clipped text or wrong connections with another proposal before you finish. Tell the user what changed; they review the change in chat.
