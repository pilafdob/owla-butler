/**
 * Shared provider contract.
 *
 * OWLA talks to exactly one backend at a time. Codex and OpenCode differ in
 * transport, catalogue and error shapes, but they must look identical to the
 * rest of the plugin: the same model record, the same tool call, the same
 * streamed answer, the same usage snapshot.
 */

import type { UsageSnapshot } from './usage';

export type ProviderId = 'codex' | 'opencode' | 'claude';

/** Every provider, in the order the settings list them. */
export const PROVIDER_IDS: readonly ProviderId[] = ['codex', 'opencode', 'claude'];

/** The provider to use when the selected one runs out of usage. */
export type FallbackChoice = ProviderId | 'none';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  context?: string;
  images?: string[];
  sourcePath?: string;
};

export type ReasoningEffort = { reasoningEffort: string; description: string };

export type ProviderModel = {
  id: string;
  model: string;
  providerID?: string;
  displayName: string;
  description?: string;
  specialty?: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: ReasoningEffort[];
  inputModalities?: string[];
  cost?: { input: number; output: number };
  context?: number;
};

export type ToolOutput = string | { text: string; imageUrl: string };
export type ToolSpec = { type: 'function'; name: string; description: string; inputSchema: unknown };

export type ProviderRunOptions = {
  executable: string;
  cwd: string;
  model: string;
  effort: string;
  instructions: string;
  text: string;
  images: string[];
  tools: ToolSpec[];
  web: boolean;
  requireWeb?: boolean;
  signal: AbortSignal;
  onText: (delta: string) => void;
  onActivity: (text: string) => void;
  tool: (name: string, args: unknown) => Promise<ToolOutput>;
};

export type ProviderRunResult = { text: string; sources: { url: string; title: string }[] };

export interface ProviderBridge {
  readonly id: ProviderId;
  connect(executable: string, cwd: string, web: boolean, tools?: ToolSpec[]): Promise<void>;
  resolveModel(preferred: string): ProviderModel | undefined;
  run(options: ProviderRunOptions): Promise<ProviderRunResult>;
  signIn(open: (url: string) => void, complete: () => void): Promise<void>;
  readUsage(timeout?: number): Promise<UsageSnapshot | null>;
  hold(): () => Promise<void>;
  disconnect(status?: string, keepStartup?: boolean): void;
  models: ProviderModel[];
  /**
   * The models OWLA may choose on its own: the catalogue minus models the
   * provider has refused for this workspace (OpenCode blocks models hosted
   * outside the workspace's allowed privacy regions). A model the user picks
   * by name is resolved against the full catalogue instead.
   */
  readonly selectableModels: ProviderModel[];
  usage: UsageSnapshot | null;
  usageUpdatedAt: number;
  usageError: string;
  accountType: string | undefined;
  plan: string;
  version: string;
  status: string;
  executable: string;
  onStatus: (status: string) => void;
  onUsage: () => void;
  readonly ready: boolean;
  /** True while the provider's own process is running in the background. */
  readonly running: boolean;
  readonly needsSignIn: boolean;
  readonly signInPending: boolean;
}

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  codex: 'Codex',
  opencode: 'OpenCode',
  claude: 'Claude Code',
};

/** The name a tool carries inside the assistant's instruction text. */
export function toolName(provider: ProviderId, base: string): string {
  if (provider === 'opencode') return 'owla_' + base;
  // Claude Code exposes OWLA's in-process MCP server tools as mcp__owla__<name>.
  if (provider === 'claude') return 'mcp__owla__' + base;
  return base;
}

const OWLA_TOOL_NAMES = [
  'read_reference', 'read_pdf', 'propose_pdf_annotation', 'read_note', 'search_vault',
  'propose_edit', 'propose_note', 'propose_deletion', 'read_attachment',
  'list_vault_paths', 'propose_organization', 'query_vault_graph', 'propose_properties',
];

/**
 * Rewrites the tool names in the instruction text so the assistant calls the
 * names the active provider actually exposes.
 */
export function prefixToolNames(text: string, provider: ProviderId): string {
  if (provider === 'codex') return text;
  let result = text;
  for (const name of OWLA_TOOL_NAMES) {
    result = result.replace(new RegExp('(?<![A-Za-z0-9_])' + name + '(?![A-Za-z0-9_])', 'g'), toolName(provider, name));
  }
  return result;
}
