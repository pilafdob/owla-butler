/**
 * Developer mode: shared contract for the development journal (dev-journal.ts)
 * and the diagnostics report (dev-report.ts).
 *
 * Pure module — no Obsidian imports, renderer-safe. Everything recorded here
 * stays in OWLA's private vault storage on this device; nothing is sent to a
 * provider. Recording happens only while the user has Developer mode enabled.
 */
import type {ButlerSettings} from './core';
import type {ChatMessage,ProviderId} from './provider';
import type {UsageSnapshot} from './usage';
import type {ProviderExhaustion} from './exhaustion';
import type {SavedChat} from './chats';
import type {RoutingHistoryData} from './routing-history';

/** Hard bounds so recording can never grow without limit (memory or disk). */
export const DEV_LIMITS={
 /** Turns kept in the in-memory ring (oldest dropped first). */
 maxTurns:100,
 /** Tool calls kept per turn with full args/result; the hard tool budget is
  * 50 per attempt, so one attempt always fits with margin. */
 maxToolCallsPerTurn:60,
 /** Hard ceiling on recorded calls per turn: retries/escalations reset the
  * provider budget each attempt (up to ~5 attempts × 50). Calls beyond the
  * full tier are recorded compactly (name, short args, outcome — no result
  * text) so every command stays visible without unbounded memory. */
 maxCompactToolCallsPerTurn:250,
 /** Args/error clip for compact-tier calls. */
 compactArgClip:200,
 /** Events kept in the in-memory ring. */
 maxEvents:500,
 promptClip:6000,
 replyClip:6000,
 argClip:1500,
 resultClip:1500,
 errorClip:800,
 detailClip:300,
 /** Serialized journal.json byte cap; saves above it are skipped. */
 maxJournalBytes:1_000_000,
 /** One saved session file's byte cap. */
 maxSessionBytes:2_000_000,
 /** Saved session files retained (oldest removed first). */
 maxSavedSessions:10,
 /** Events included in a diagnostics report. */
 maxReportEvents:300,
} as const;

export type DevEventKind=
 |'developer-mode-enabled'|'developer-mode-disabled'
 |'chat-cleared'
 |'tool-budget-soft'|'tool-budget-hard'|'repeat-call'
 |'context-shortened'|'history-trimmed'|'selections-trimmed'
 |'quality-escalation'|'auto-retry'
 |'provider-exhausted'|'model-refusal'
 |'turn-error'|'empty-reply'
 |'proposal-rejected'|'edit-conflict'
 |'dev-session-saved'|'diagnostics-downloaded';

export interface DevEvent{
 id:number;
 /** ISO timestamp. */
 at:string;
 kind:DevEventKind;
 chatId:string;
 turnId?:string;
 /** Clipped to DEV_LIMITS.detailClip. */
 detail:string;
}

export interface DevToolCall{
 index:number;
 name:string;
 /** JSON.stringify(args), clipped; never throws on exotic args. */
 args:string;
 startedAt:string;
 durationMs:number|null;
 ok:boolean;
 /** Clipped tool result text (success path). */
 result?:string;
 /** Clipped error message (failure path). */
 error?:string;
 /** Which ToolGuard verdict ended the call, when one did. */
 guard?:'soft'|'hard'|'repeat';
}

export interface DevTurn{
 id:string;
 chatId:string;
 startedAt:string;
 endedAt:string|null;
 /** Clipped user prompt. */
 prompt:string;
 /** Clipped final reply; null until the turn ends. */
 reply:string|null;
 /** Final route (retries/escalations update it; events carry the history). */
 provider:ProviderId;
 model:string;
 effort:string;
 automatic:boolean;
 web:boolean;
 /** null while running, then true/false. */
 ok:boolean|null;
 error:string|null;
 /** Latency of the final attempt. */
 latencyMs:number|null;
 /** Estimates (~3.5 chars/token), never provider-reported exact counts. */
 estimatedInputTokens:number;
 estimatedOutputTokens:number;
 contextChars:number;
 attempts:number;
 escalations:number;
 retries:number;
 toolCalls:DevToolCall[];
}

export interface DevTurnInput{
 prompt:string;
 provider:ProviderId;
 model:string;
 effort:string;
 automatic:boolean;
 web:boolean;
 contextChars:number;
 estimatedInputTokens:number;
}

export interface DevToolOutcome{
 ok:boolean;
 result?:string;
 error?:string;
 durationMs:number;
 guard?:'soft'|'hard'|'repeat';
}

export interface DevTurnOutcome{
 ok:boolean;
 reply?:string;
 error?:string;
 latencyMs:number;
 estimatedOutputTokens:number;
 provider:ProviderId;
 model:string;
 effort:string;
 attempts:number;
 escalations:number;
 retries:number;
}

/** Aggregate counters shared by the session export and the diagnostics report. */
export interface DevTotals{
 turns:number;
 successfulTurns:number;
 failedTurns:number;
 toolCalls:number;
 toolErrors:number;
 /** Budget/repeat guard events (rule enforcement). */
 ruleEvents:number;
 escalations:number;
 retries:number;
 exhaustionEvents:number;
 contextShortened:number;
 historyTrimmed:number;
 selectionsTrimmed:number;
 estimatedInputTokens:number;
 estimatedOutputTokens:number;
 turnLatencyP50Ms:number|null;
 turnLatencyP95Ms:number|null;
 toolDurationP50Ms:number|null;
 toolDurationP95Ms:number|null;
}

/** One saved developer session: the full current chat plus its recorded turns. */
export interface DevSessionExport{
 kind:'owla-developer-session';
 version:1;
 savedAt:string;
 chatId:string;
 pluginVersion:string;
 vaultName:string;
 /**
  * Current chat history. Image data URLs are replaced by
  * `[image data omitted: N chars]` placeholders so exports stay bounded.
  */
 history:ChatMessage[];
 turns:DevTurn[];
 events:DevEvent[];
 totals:DevTotals;
}

export interface SavedDevSessionMeta{
 /** File stem, a UUID. */
 id:string;
 savedAt:string;
 chatId:string;
 /** First user prompt excerpt, for the settings list. */
 title:string;
 turns:number;
 toolCalls:number;
 bytes:number;
}

/** Per-provider facts collected by main.ts for the diagnostics report. */
export interface ProviderDiagnostics{
 id:ProviderId;
 name:string;
 connected:boolean;
 status:string;
 version:string;
 plan:string;
 accountType:string;
 executable:string;
 /** Where the provider keeps its own session store (full raw transcripts). */
 sessionDirectory:string;
 usage:UsageSnapshot|null;
 usageUpdatedAt:number;
 usageError:string;
 exhaustion:ProviderExhaustion;
 modelPrefs:{model:string;reasoning:string};
 offeredModels:number;
 selectableModels:number;
 ready:boolean;
 running:boolean;
 needsSignIn:boolean;
}

export interface DiagnosticsInput{
 generatedAt:string;
 pluginVersion:string;
 minAppVersion:string;
 obsidianVersion:string;
 platform:string;
 platformKey:string;
 vaultName:string;
 vaultStoragePath:string;
 storageRoot:string;
 settings:ButlerSettings;
 automaticSelectionAvailable:boolean;
 visualFeatures:{canvas:boolean;bases:boolean;excalidraw:boolean};
 providers:ProviderDiagnostics[];
 modelUnavailability:unknown[];
 routingHistory:RoutingHistoryData;
 savedChats:SavedChat[];
 journal:{chatId:string;turns:DevTurn[];events:DevEvent[]};
 pendingEdits:{path:string;create?:boolean}[];
 pendingLoadError:string;
 editBackupCount:number;
}

export interface RoutingHistoryRow{
 provider:ProviderId;
 model:string;
 kind:string;
 success:number;
 fail:number;
 p50LatencyMs:number|null;
 lastUsedAt:number|null;
}

export interface DevLatencyStats{
 p50:number|null;
 p95:number|null;
 max:number|null;
 samples:number;
}

export type ToolErrorClass=
 |'unoffered-tool'|'path-refused'|'stale-snapshot'|'title-rule'
 |'edit-too-large'|'budget'|'repeat'|'stopped'|'other';

export interface RuleViolationRow{
 at:string;
 kind:string;
 tool?:string;
 detail:string;
}

export interface DiagnosticsReport{
 kind:'owla-diagnostics';
 version:1;
 generatedAt:string;
 plugin:{version:string;minAppVersion:string;obsidianVersion:string;platform:string;platformKey:string};
 vault:{name:string;storageRoot:string;vaultStoragePath:string};
 settings:ButlerSettings;
 /** Feature name → enabled/disabled (or a short mode string). */
 features:Record<string,boolean|string>;
 providers:(ProviderDiagnostics&{usageWindows:{bucket:string;window:string;used:number;remaining:number;resetsAt:number|null}[]})[];
 modelUnavailability:unknown[];
 routingHistory:RoutingHistoryRow[];
 savedChats:SavedChat[];
 currentSession:{chatId:string;turns:DevTurn[];events:DevEvent[]};
 totals:DevTotals;
 performance:{turnLatency:DevLatencyStats;toolDuration:DevLatencyStats};
 ruleViolations:RuleViolationRow[];
 loss:{
  data:{editConflicts:number;proposalRejections:number;pendingEdits:number;pendingLoadError:string;editBackups:number};
  tokens:{contextShortened:number;historyTrimmed:number;selectionsTrimmed:number;estimatedInputTokens:number;estimatedOutputTokens:number;note:string};
  quality:{escalations:number;retries:number;emptyReplies:number;turnErrors:number};
 };
 /** Honest limitations of the report (estimates, where raw transcripts live…). */
 notes:string[];
}

/** Linear-interpolated percentile of an unsorted sample; null when empty. */
export function percentile(values:readonly number[],p:number):number|null{
 const sample=values.filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);
 if(!sample.length)return null;
 const rank=(Math.min(100,Math.max(0,p))/100)*(sample.length-1);
 const low=Math.floor(rank),high=Math.ceil(rank);
 return Math.round(sample[low]+(sample[high]-sample[low])*(rank-low));
}

function countKind(events:readonly DevEvent[],kind:DevEventKind):number{
 let n=0;for(const event of events)if(event.kind===kind)n++;return n;
}

/** Shared aggregation so the session export and the report agree. */
export function computeDevTotals(turns:readonly DevTurn[],events:readonly DevEvent[]):DevTotals{
 let toolCalls=0,toolErrors=0,escalations=0,retries=0,input=0,output=0,successful=0,failed=0;
 const turnLatencies:number[]=[],toolDurations:number[]=[];
 for(const turn of turns){
  toolCalls+=turn.toolCalls.length;
  escalations+=turn.escalations;
  retries+=turn.retries;
  input+=turn.estimatedInputTokens;
  output+=turn.estimatedOutputTokens;
  if(turn.ok===true)successful++;
  if(turn.ok===false)failed++;
  if(turn.latencyMs!==null)turnLatencies.push(turn.latencyMs);
  for(const call of turn.toolCalls){
   if(!call.ok)toolErrors++;
   if(call.durationMs!==null)toolDurations.push(call.durationMs);
  }
 }
 return {
  turns:turns.length,
  successfulTurns:successful,
  failedTurns:failed,
  toolCalls,
  toolErrors,
  ruleEvents:countKind(events,'tool-budget-soft')+countKind(events,'tool-budget-hard')+countKind(events,'repeat-call'),
  escalations,
  retries,
  exhaustionEvents:countKind(events,'provider-exhausted'),
  contextShortened:countKind(events,'context-shortened'),
  historyTrimmed:countKind(events,'history-trimmed'),
  selectionsTrimmed:countKind(events,'selections-trimmed'),
  estimatedInputTokens:input,
  estimatedOutputTokens:output,
  turnLatencyP50Ms:percentile(turnLatencies,50),
  turnLatencyP95Ms:percentile(turnLatencies,95),
  toolDurationP50Ms:percentile(toolDurations,50),
  toolDurationP95Ms:percentile(toolDurations,95),
 };
}