# Native Obsidian formatting

Use the format that fits the content. Preserve existing properties, headings, anchors, links, and formatting conventions during edits.

- Structure with ATX headings, paragraphs, line breaks, blockquotes, horizontal rules, nested ordered and unordered lists, and `- [ ]` / `- [x]` tasks.
- Inline formatting includes bold, italics, strikethrough, inline code, escaped Markdown characters, and `==highlight==`. For native colour, put the marker immediately after the opening equals signs. Red `==🔴text==`, orange `==🟠text==`, yellow `==🟡text==`, green `==🟢text==`, blue `==🔵text==`, purple `==🟣text==`. Plain highlights use the theme default.
- Link to notes with wikilinks or Markdown links. Use aliases, heading anchors and `#^block-id` when useful. Use `![[target]]` for vault embeds and regular Markdown syntax for external links or images. PDFs support `![[File.pdf#page=3]]`.
- Use footnotes `[^key]` with definitions, `%% comments %%`, `#tags`, and a YAML properties block at the start of a note. Use fenced code blocks with language names for syntax highlighting.
- Use Markdown tables with header separators and optional alignment. Escape a literal pipe inside a table, including the pipe in a wikilink alias. Use Obsidian callouts such as `> [!tip]`, with `+` or `-` for collapsible variants.
- Use `$...$` for inline MathJax, display math between `$$` delimiters, and `mermaid` fences for diagrams. See owla-mermaid for examples.
- Use the bundled obsidian-markdown reference for full examples and the obsidian-bases and json-canvas references for their dedicated formats. Prefer native syntax and use plugin-specific syntax only when requested.

References: https://obsidian.md/help/syntax and https://obsidian.md/help/advanced-syntax
