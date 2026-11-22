# Security policy

OWLA Butler runs AI providers (Codex, OpenCode, Claude Code, Hermes Agent) against your Obsidian vault. It confines them to OWLA's own tools, which check every path against the vault and your excluded folders, and every edit is a proposal you review before it is applied. A weakness in that confinement, or anything that lets data leave the vault unexpectedly, is a security issue.

## Supported versions

Only the latest stable release receives security fixes. Dev builds (`<version>-dev` prereleases) are for testing and are not supported.

| Version | Supported |
| --- | --- |
| Latest stable release (see [Releases](https://github.com/pilafdob/owla-butler/releases/latest)) | Yes |
| Older stable releases | No — update first |
| Dev prereleases | No |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/pilafdob/owla-butler/security/advisories/new)). Include:

- the OWLA Butler, Obsidian and provider versions, and your operating system;
- what an attacker can do, and the steps or a minimal proof of concept, using a disposable vault;
- any logs, with tokens, account identifiers, note text and local paths removed.

You can expect an acknowledgement within a week. Fixes are released as a patch version, and the advisory is published once a fixed release is available. Credit is given in the advisory unless you prefer otherwise.

## In scope

- An assistant reading, writing, moving or deleting files outside the vault or in excluded folders.
- Changes applied without the user's review, or a review showing something different from what is applied.
- Provider isolation failures: an assistant reaching shell, filesystem, MCP, plugin or other tools beyond OWLA's own.
- Credential, token or note-content exposure, including through logs, exports or saved chats.
- Instructions inside notes, PDFs, web pages or tool results causing actions the user did not ask for.

## Out of scope

- Vulnerabilities in Obsidian, Codex, OpenCode, Claude Code, Hermes Agent or the model services themselves. Report those to their maintainers.
- Issues that need an attacker who already controls your computer or your user account.
- Content a model produces that is wrong but stays inside a reviewed proposal.
