import {PROVIDER_NAMES,type ProviderId} from './provider';
import {UsageSnapshot} from './usage';

export interface ProviderExhaustion {
  provider: ProviderId;
  exhausted: boolean;
  /** Unix seconds when the provider reports that it becomes usable again. */
  resetsAt: number | null;
  reason: string;
  /** Which models the limit covers. OpenCode's free tier shares one limit, so
   *  a free-tier limit leaves paid models (such as OpenCode Go's) usable. */
  scope: 'provider' | 'free models';
}

const OK = (provider: ProviderId): ProviderExhaustion => ({ provider, exhausted: false, resetsAt: null, reason: '', scope: 'provider' });

/** How long a limit error without a readable window keeps Codex out of selection. */
const CODEX_LIMIT_RETRY_SECONDS = 15 * 60;
/** The limit-error wordings every Codex reader agrees on (providers audit P9). */
export const LIMIT_ERROR = /rate.?limit|usage limit|limit reached|\b429\b|quota|too many requests/i;
/**
 * Codex reports a percentage per usage window. A window that reached 100 per
 * cent is exhausted until it resets; a window whose reset time has passed no
 * longer blocks, and with several full windows the latest reset decides. A
 * limit error without a readable window holds Codex back for a bounded retry,
 * as Claude Code's does.
 */
export function codexExhaustion(usage: UsageSnapshot | null, error?: string, now = Date.now() / 1000): ProviderExhaustion {
  let resetsAt: number | null = null;
  let exhausted = false;
  const buckets = [usage?.rateLimits, ...Object.values(usage?.rateLimitsByLimitId ?? {})];
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const window of [bucket.primary, bucket.secondary]) {
      if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent) || window.usedPercent < 100) continue;
      const reset = typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) ? window.resetsAt : null;
      if (reset !== null && reset <= now) continue;
      exhausted = true;
      if (reset !== null && (resetsAt === null || reset > resetsAt)) resetsAt = reset;
    }
  }
  if (!exhausted && error && LIMIT_ERROR.test(error)) {
    exhausted = true;
    resetsAt = now + CODEX_LIMIT_RETRY_SECONDS;
  }
  return exhausted
    ? { provider: 'codex', exhausted: true, resetsAt, reason: 'Codex usage limit reached.', scope: 'provider' }
    : OK('codex');
}

/**
 * OpenCode reports exhaustion as a provider error that carries the moment the
 * limit resets.
 */
export function opencodeExhaustion(error: unknown, resetsAt: number | null): ProviderExhaustion {
  const text = error instanceof Error ? error.message : String(error);
  const free = /free-limit|free usage limit/i.test(text);
  if (!free && !LIMIT_ERROR.test(text)) return OK('opencode');
  return {
    provider: 'opencode',
    exhausted: true,
    resetsAt,
    reason: free ? 'The OpenCode free models’ shared limit is reached.' : 'OpenCode usage limit reached.',
    scope: free ? 'free models' : 'provider',
  };
}

/**
 * Claude Code reports each plan window with a reset time. A full or rejected
 * window is exhausted until that time passes; a usage-limit error without a
 * readable window is exhausted until the next report.
 */
export function claudeExhaustion(usage: UsageSnapshot | null, error?: string, now = Date.now() / 1000): ProviderExhaustion {
  let resetsAt: number | null = null;
  let exhausted = false;
  for (const bucket of Object.values(usage?.rateLimitsByLimitId ?? {})) {
    for (const window of [bucket.primary, bucket.secondary]) {
      if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent) || window.usedPercent < 100) continue;
      const reset = typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) ? window.resetsAt : null;
      if (reset !== null && reset <= now) continue;
      exhausted = true;
      if (reset !== null && (resetsAt === null || reset > resetsAt)) resetsAt = reset;
    }
  }
  if (!exhausted && error && LIMIT_ERROR.test(error)) exhausted = true;
  return exhausted
    ? { provider: 'claude', exhausted: true, resetsAt, reason: 'Claude usage limit reached.', scope: 'provider' }
    : OK('claude');
}

export function exhaustionLabel(state: ProviderExhaustion): string {
  if (!state.exhausted) return '';
  const reset = state.resetsAt ? ' It resets ' + new Date(state.resetsAt * 1000).toLocaleString() + '.' : '';
  return state.reason + reset;
}

/** A short description of every connected provider, for the in-chat notice. */
export function describeProviders(states: ProviderExhaustion[]): string {
  return states
    .map(state => {
      const name = PROVIDER_NAMES[state.provider];
      const reset = state.resetsAt ? ' Resets ' + new Date(state.resetsAt * 1000).toLocaleString() + '.' : '';
      return name + ' — usage exhausted.' + reset;
    })
    .join('\n');
}
