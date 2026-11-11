# OWLA Butler 1.6.0

## Automatic model and reasoning selection

Enable **Automatic model and reasoning effort (experimental)** in OWLA settings on a macOS 27 Mac with Apple’s on-device model available.

1. OWLA gets your available models, descriptions, and supported reasoning levels from Codex. It filters for image support when the request needs it.
2. OWLA sends your original prompt through standard input to Apple’s local `fm respond --model system` command, with routing instructions and a numbered model catalog. Note contents, attachment contents, and chat history are reserved for the Codex answer.
3. Apple’s model returns a model number and effort as JSON. OWLA checks that both are supported before passing them to Codex alongside your original prompt and usual chat context.
4. The sidebar shows the selected model and effort or the compatible fallback. Turn the setting off to return to your manual choices.

For example, a quick lookup can use `gpt-6.1-sol` at `low`, while a difficult proof can use `gpt-6-astra` at `ultra`. Selection happens on-device. Codex answers use your normal Codex allowance.

## Connection and vault changes

- Choose **Connect Codex** once per vault. OWLA saves the connection after verifying your ChatGPT login, starts Codex on demand across reloads, and shows only **Disconnect** while connected. Disconnect clears the saved choice.
- Change cards give you access to reviewed edits, drafts, moves, deletions, and annotated PDFs. New notes follow Obsidian’s configured location unless you specify a path. Review a deletion’s contents and known backlinks before moving it to Trash.
- OWLA includes additional guidance for Mermaid diagrams, colored highlights, and native Obsidian Markdown.

To install manually, replace `main.js`, `manifest.json`, and `styles.css` together and keep `data.json`. Vaults upgrading from earlier releases need one explicit connection.
