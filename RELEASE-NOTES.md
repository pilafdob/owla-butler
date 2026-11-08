# OWLA Butler 1.3.0

Drop files into chat and let OWLA prepare them locally. This release adds Word, PowerPoint, Excel, Pages, Keynote and Numbers extraction, larger image conversion, and clear status messages for previews or unsupported content. iWork conversion uses a temporary copy and requires the corresponding Apple app on macOS.

Whole PDFs now provide page-labelled text and scanned-page images. Use [[file.pdf#page=3]] links or right-click a PDF page and choose **Add page to OWLA**.

Suggested PDF comments are grouped for review. **Accept annotations** creates a separate annotated copy after a source freshness check. **Decline** writes nothing. Original PDFs and iWork files stay intact.

The **Diff view** setting offers **Highlights in editor**, **None** and **Split diff view**. Highlights use subtle green/red backgrounds without emojis. Split diff opens the Markdown source diff in a normal Obsidian pane to the right of the note. Accept and Decline remain in chat.

Conversion is bounded and reports shortened text or partial previews. Automatic scanned-page images are limited to 12 per batch. PDF annotations currently support text comments. See the README for supported formats and limits.

Update through Obsidian Community plugins or replace `main.js`, `manifest.json` and `styles.css` together. Keep `data.json` when updating manually.
