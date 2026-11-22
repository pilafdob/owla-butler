# Accessibility

OWLA Butler aims to be usable by everyone who uses Obsidian, including people who rely on a keyboard, a screen reader, zoom or high-contrast themes.

## Supported environments

- Desktop Obsidian 1.14.5 or newer on macOS or Windows. Linux and mobile are not supported yet.
- OWLA uses Obsidian's own theme variables for colours and spacing, so it follows the light, dark and community theme you have chosen.

## What is in place

- Commands in the command palette for the main actions (for example **Open chat**, **Add selection to chat**, **Add table to chat** and **Review latest suggested edit**), so they can be run and bound to hotkeys without a mouse.
- Accessible names (`aria-label`) on icon-only buttons. The chat is a polite live region (`role="log"`), so screen readers announce new messages.
- Visible focus outlines on OWLA's own controls (`:focus-visible`).
- Reduced animation when the operating system asks for reduced motion.
- Layouts that fit sidebar widths from 240 to 600 px.

## Known limitations

- OWLA has not yet been tested end to end with a screen reader (VoiceOver or NVDA). Some views, such as the reviewed-edit diff and PDF annotation previews, may be hard to follow without sight.
- Canvas and drawing previews are pictures. Their text is available to the assistant, but there is no separate text alternative in the interface.
- Replies are written by AI models. Their structure, such as headings, lists and tables, depends on the model.

## Reporting a barrier

If something in OWLA is hard or impossible to use with your setup, please [open an issue](https://github.com/pilafdob/owla-butler/issues/new) and mention "accessibility" in the title. Say which assistive technology, operating system and Obsidian version you use, what you tried and what happened. Accessibility problems are treated as bugs.
