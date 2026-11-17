---
name: OWLA Excalidraw
description: Reading, seeing and changing Excalidraw drawings (.excalidraw.md, .excalidraw and .md drawing notes) through OWLA's reviewed drawing operations.
---
# Excalidraw drawings in OWLA

A drawing is a scene of elements: shapes (rectangle, ellipse, diamond), text, arrows and lines, frames, images and freehand strokes. Each element has an id, a position (x, y = top-left corner, in scene pixels; y grows downward) and a size. Text inside a shape belongs to that shape. An arrow records which elements it connects.

Drawings come in three file forms, and read_excalidraw and propose_excalidraw work with all of them: `.excalidraw.md`, `.excalidraw` (the scene as plain JSON) and any `.md` note with `excalidraw-plugin` frontmatter. Never mind the form; use the path the user gives.

## Read before you change
- `read_excalidraw` lists every element with its id, position, size, text, colours, frame and connections. Use the ids exactly as listed.
- Use `visual=true` whenever meaning depends on the picture: layout, grouping by position, colour coding, handwriting, sketches, or arrows that are not bound to shapes. The text list cannot show freehand strokes or what an image depicts.
- Describe what the picture shows and what the element list says. Mark anything you cannot read as unclear rather than guessing.

## Change with operations
`propose_excalidraw` stages operations for the user to accept or decline. Never edit the file text with propose_edit: the drawing data would be damaged.
- `add_shape` {shape, x, y, width, height, text?, style?} — text is centred in the shape.
- `add_text` {x, y, text, style?} — free text.
- `add_arrow` {from, to, label?, style?} — connects two existing or newly added element ids; it follows the shapes when they move in Excalidraw.
- `add_frame` {x, y, width, height, name, contains?}
- `update_text` {id, text} — the id of a text element or of a shape with text.
- `move` {id, x, y} or {id, dx, dy}; `resize` {id, width, height}; `set_style` {id, style}; `delete` {id} (removes its text and unbinds arrows).
New elements get ids you cannot predict. To connect new shapes, add them in one proposal, read the drawing again (it shows the staged version), then add arrows in a second proposal.

## Layout that reads well
- Leave at least 40 px between shapes and 80–120 px between rows or columns. Align centres on a grid rather than placing shapes ad hoc.
- Size a shape for its text: about 10 px per character at the default font size plus 40 px padding, and at least 60 px high.
- Keep one direction of flow (left→right or top→bottom). Avoid crossing arrows.
- Use colour for meaning and keep the palette small. Excalidraw's defaults: stroke `#1e1e1e`; fills `#ffc9c9` red, `#b2f2bb` green, `#a5d8ff` blue, `#ffec99` yellow, `#d0bfff` violet; strokes `#e03131`, `#2f9e44`, `#1971c2`, `#f08c00`, `#6741d9`.
- Keep the existing style of a drawing (roughness, font, stroke width) when adding to it.

## Check your work
After staging, call `read_excalidraw` with `visual=true` again. Fix overlaps, clipped text or wrong connections with another proposal before you finish. Tell the user what changed; they review the change in chat.
