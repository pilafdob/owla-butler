/**
 * The OpenCode server plugin OWLA runs inside its own OpenCode process.
 *
 * OpenCode ships a full coding agent: shell, file editing, search, subagents
 * and web fetch. OWLA replaces that surface with its own vault tools, so the
 * assistant can only reach the vault through Obsidian, exactly as with Codex.
 *
 * The source is embedded rather than shipped as a fourth file, because a
 * Community installation contains only main.js, manifest.json and styles.css.
 * OWLA writes this source into the private session directory before it starts
 * OpenCode, and passes the tool and skill payloads through the environment.
 */

export const OPENCODE_PLUGIN_SOURCE = `import { readFileSync } from "node:fs"
import { Plugin } from "@opencode/plugin"

// Built-in tools OWLA does not expose. The session permission ruleset denies
// them as well, so an inherited plugin cannot re-enable them.
const REMOVED = [
  "patch", "edit", "glob", "grep", "question", "read", "shell", "subagent",
  "write", "webfetch", "execute",
  "opencode_session_rename", "opencode_session_move",
  "opencode_worktree_create", "opencode_worktree_list", "opencode_worktree_remove",
  "opencode_models", "opencode_list_mcp_resources", "opencode_read_mcp_resource",
  "todowrite", "opencode_schedule_create", "opencode_schedule_list", "opencode_schedule_delete",
  "opencode_artifact_create", "opencode_artifact_list", "opencode_artifact_read",
  "opencode_image_generate",
]

function readJson(path) {
  if (!path) return []
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return []
  }
}

// OWLA mirrors its own web search setting, so the built-in search tool is only
// offered when the user allowed it.
if (process.env.OWLA_WEB_SEARCH !== "1") REMOVED.push("websearch")

export default Plugin.define({
  id: "owla.butler",
  async setup(ctx) {
    const endpoint = process.env.OWLA_TOOL_ENDPOINT
    const token = process.env.OWLA_TOOL_TOKEN
    const tools = readJson(process.env.OWLA_TOOLS_PATH)
    const skills = readJson(process.env.OWLA_SKILLS_PATH)

    await ctx.tool.transform((editor) => {
      for (const id of REMOVED) editor.remove(id)
      for (const tool of tools) {
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.inputSchema,
          options: { namespace: "owla", codemode: false },
          execute: async (args, context) => {
            const response = await fetch(endpoint + "/tool", {
              method: "POST",
              headers: { "content-type": "application/json", authorization: "Bearer " + token },
              body: JSON.stringify({ tool: tool.name, args: args || {} }),
              signal: context && context.signal ? context.signal : undefined,
            })
            if (!response.ok) throw new Error("OWLA rejected the tool call with status " + response.status)
            const payload = await response.json()
            if (payload.error) throw new Error(payload.error)
            if (payload.imageUrl) {
              return {
                content: [
                  { type: "text", text: payload.text },
                  { type: "image", imageUrl: payload.imageUrl },
                ],
              }
            }
            return { content: payload.text }
          },
        })
      }
    })

    await ctx.skill.transform((editor) => {
      for (const skill of skills) {
        editor.add({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          path: skill.path,
          content: skill.content,
        })
      }
    })

    // The user's own OpenCode configuration may define MCP servers. OWLA
    // removes them so an inherited server cannot widen the tool surface.
    try {
      await ctx.mcp.transform((editor) => {
        for (const entry of editor.list()) editor.remove(entry[0])
      })
    } catch {
      // A configuration without MCP support is not a problem.
    }
  },
})
`;
