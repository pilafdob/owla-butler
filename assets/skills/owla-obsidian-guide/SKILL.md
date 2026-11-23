---
name: OWLA Obsidian Guide
description: Improve how a note looks: image sizing and side-by-side placement, professional document structure, layout tricks, native-first policy. Use when the user asks for formatting help or a visual improvement.
---

# Obsidian visual formatting guide

## Behaviour rules

- Act only when the user asks for formatting help or a visual improvement (looks, layout). Never restyle a note the user did not ask for.
- Propose every change through the review flow; never silently rewrite. If the scope is unclear (selection vs whole note), ask or state your assumption.
- Prefer native syntax; suggest CSS snippets or plugins only when native cannot do the look, and name what must be installed.
- Live Preview vs Reading view: sizes, tables and Markdown images work in both; raw HTML renders only in Reading view.

## Images

Size a wiki embed inside the double brackets: `![[map.png|300]]` (width, pixels) or `![[map.png|300x200]]` (width x height). Height-only sizes are not supported.
Size a Markdown image between the alt text and the path: `![alt|300x200](map.png)`. Markdown images are inline (they flow with text and lists); wiki embeds are block-level (they start their own line).

### Place images side by side

1. Two embeds in one table row (both views). Escape the pipe inside the wikilink or the table splits:

| | |
|---|---|
| ![[left.png\|300]] | ![[right.png\|300]] |

2. Two inline Markdown images on one line: `![a|150](a.png) ![b|150](b.png)` — no table needed, and it also works inside list items.

### Captions

Obsidian has no native caption syntax. Put an italic line directly under the image: `![[map.png|400]]` followed by `*Figure 1: the plan.*`.

### Image grid via CSS snippet

For many images, set the frontmatter property `cssclasses: img-grid` and enable a snippet:

```css
.img-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
```

Snippets go under Settings → Appearance → CSS snippets. This is a snippet, not native syntax — use it only when a table or inline images do not fit.

### What does NOT work

- A wikilink inside a raw HTML block stays literal text (`<div>![[img.png]]</div>` renders the characters, not the image). Use `<img src="image.png" width="300">` inside HTML instead.
- Raw HTML layouts (e.g. a flex `<div>`) render only in Reading view; Live Preview shows the HTML as text. Prefer tables — they render in both views.
- Embeds and raw HTML do not mix: side-by-side placement must use one system or the other.

## Making a note look professional

- One H1 per note; descend one heading level at a time (## then ###). Headings form the outline shown in the Outline pane — treat it as the table of contents instead of hand-writing one.
- Keep one blank line between blocks, two-space list indentation, and consistent spacing — never double blank lines.
- Callouts draw the eye: `> [!tip]` for tips, `> [!warning]` for cautions, `> [!info]` for background.
- Tables need a header row, a `|---|` separator row, and `:---:`-style alignment; escape any literal pipe as `\|`.
- Structure long prose with nested lists, dividers `---` between parts, `==highlights==` used sparingly, and footnotes (`text[^1]`, then `[^1]: the note`).
- Keep frontmatter properties tidy: `title`, `tags`, `aliases`, `cssclasses`.
- Keep note names short, descriptive and consistent with the existing notes. Before/after example: a `# PROJECT X` title over a long unbroken paragraph becomes `# Project X` with a short `## Overview`, a `## Timeline` task list and a `## Notes` callout.

## Layout tricks

- Markdown has no columns. A table is the native stand-in; CSS snippets or a columns plugin are the plugin-level fix.
- Collapsible callouts: `> [!note]-` starts folded, `> [!note]+` starts open.
- Embed another note with `![[Some note]]` or one section with `![[Some note#Heading]]`. Embedded PDFs use `![[file.pdf#page=3]]`.
- Separate unrelated parts with `---` and navigate long notes with the Outline pane.

## Native first

Order of preference: native Markdown → core features (callouts, Outline, properties, embeds) → CSS snippet → community plugin. Only suggest plugins or snippets when native syntax cannot achieve the requested look, name the plugin, and note what must be installed or enabled. Sections are independent: read further passages when the section you need comes later.
