---
name: OWLA Canvas
description: Reading, seeing and changing Obsidian canvases through OWLA's reviewed canvas operations.
---
# Obsidian canvases in OWLA

A canvas holds cards (text, note/file, web link), groups and edges. See the json-canvas reference for the file format.

## Read before you change
- `read_canvas` lists every card with its id, type, position, size, colour and group, and every edge with its ends and label.
- `visual=true` adds a picture of the canvas as Obsidian draws it, including rendered Markdown, embedded notes and images. Use it when position, grouping, colour or embedded content carries meaning. If pictures are turned off, say so and work from the text.
- A file card shows another note: read that note with read_note when its content matters.

## Change with operations
`propose_canvas` stages operations for review: add_node, update_node, remove_node, add_edge, update_edge, remove_edge. Never edit canvas JSON with propose_edit.
- Give every card x, y, width and height. Text cards: 250–400 px wide, 60 px per short line. Note cards: about 400×400.
- Leave 40–80 px between cards. Put a group around related cards with 40 px padding; a group must enclose its cards completely.
- Colours "1"–"6" are red, orange, yellow, green, cyan and purple in Obsidian's palette; use them consistently for meaning.
- Connect cards from the side that faces the other card (right→left for left-to-right flow). Label an edge only when the relation is not obvious.
- File cards must point to existing vault paths; OWLA warns about missing ones.

## Check your work
After staging, read the canvas again with `visual=true` and fix overlaps, cards outside their groups, or tangled edges before finishing.
