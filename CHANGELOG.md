# Changelog

## 0.1.0

- Initial Obsidian desktop sidebar chat with live current-note context, selection capture, image attachments and local vault tools.
- Local Ollama/OpenAI-compatible streaming, on-demand runtime management and macOS memory protection.
- Reviewable edits, exact-snapshot conflict checks and guarded Undo.
- Bundled the supplied Phosphor bird icon; no subtitle/tagline in the header.

### Local model connection

- Connect to a separately installed Ollama or OpenAI-compatible localhost service.
- Select an installed model without loading weights during discovery.
- Start an existing Ollama executable on demand when configured; the Community build does not install runtimes or models.
- Added OWLA instructions for notes, source handling and OCR, with explicit PDF/tool limits.

### Selected-page PDF attachments

- Attach a PDF page as extracted text or a rendered image using the PDF reader bundled with Obsidian.
- Carry filename and physical page references into chat; bound file/page context and release PDF resources.
- Added page validation and source-reference tests.
