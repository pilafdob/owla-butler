---
name: OWLA Bases
description: Reading and changing Obsidian Bases (.base) with Obsidian's own Bases engine checking every proposal.
---
# Obsidian Bases in OWLA

A base is a YAML file with filters, formulas, properties, summaries and views. See the obsidian-bases reference for the syntax and functions.

## Read before you change
- `read_base` shows the base's structure, the errors Obsidian's Bases engine reports, the views, the number of results and the first rows of the shown view. Use the real rows to answer questions about what the base lists.
- Property names in filters and columns must match the notes' frontmatter. Check a few notes with read_note when a column comes back empty.

## Change by proposing the whole file
`propose_base` takes the complete YAML. Keep everything you are not changing exactly as it was. OWLA runs the proposal through the Bases engine before staging it:
- If the engine reports an error (for example an invalid formula or an unknown view type), fix that part and propose again.
- The reply shows how many notes the view will list and the first rows. Check that this matches what the user asked for.

## Conventions
- Quote strings inside expressions: `file.inFolder("Projects")`, `status == "done"`.
- Prefer `and`/`or`/`not` lists over long combined expressions.
- Name views for what they show ("Open tasks", "Reading list").
- Use `order` to choose and order the columns of table views.
