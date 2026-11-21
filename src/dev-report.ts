/**
 * Developer mode: diagnostics report builder and Markdown renderer.
 *
 * Pure module — no filesystem, no Obsidian, renderer-safe. Assembles the
 * shared dev-types contract from the facts main.ts collects, redacts
 * credential shapes from error text and renders a bounded human-readable
 * summary. The report is a local file; nothing here is sent to a provider.
 */
import {DEV_LIMITS,computeDevTotals,percentile,type DevEvent,type DevEventKind,type DevLatencyStats,type DevToolCall,type DevTurn,type DiagnosticsInput,type DiagnosticsReport,type RuleViolationRow,type RoutingHistoryRow,type ToolErrorClass} from './dev-types';
import type {ButlerSettings} from './core';
import type {ProviderId} from './provider';
import {usageWindows} from './usage';
import {modelP50Latency} from './routing-history';
import {TASK_KINDS} from './model-profiles';
import {record,redactSensitive} from './validation';
import {exhaustionLabel} from './exhaustion';

// The shared redactor lives in validation.ts so the journal can redact its
// exports too; re-exported here for the report API's callers.
export {redactSensitive} from './validation';

/** Path/folder refusals from the vault guards (main.ts, core.ts, organization.ts). */
const PATH_REFUSED=/outside the allowed|excluded|allowed vault|allowed folder|allowed file|allowed path|vault-relative|no longer allowed|blocked or unsafe|symbolic link|This vault path is unavailable/i;

/** Maps OWLA's real guard messages onto the shared error classes. */
export function classifyToolError(message:string):ToolErrorClass{
 if(message.includes('This tool is not available in this mode.')||message.includes('OWLA did not offer that tool in this turn.')||message.includes('Unknown OWLA tool.'))return 'unoffered-tool';
 if(message.includes('The note changed since this proposal'))return 'stale-snapshot';
 if(message.includes('Keep the filename out of the top Markdown heading')||message.includes('The inline title setting is unavailable'))return 'title-rule';
 if(message.includes('The proposed edit is too large'))return 'edit-too-large';
 if(message.includes('This reply has used'))return 'budget';
 if(message.includes('This exact call already returned the same result'))return 'repeat';
 if(message.trim()==='Stopped.')return 'stopped';
 if(PATH_REFUSED.test(message))return 'path-refused';
 return 'other';
}

/** Defence in depth: settings hold no credentials today, but every string
 *  value (including nested ones) passes through redactSensitive anyway. */
function redactSettings(value:unknown):unknown{
 if(typeof value==='string')return redactSensitive(value);
 if(Array.isArray(value))return value.map(redactSettings);
 if(value!==null&&typeof value==='object'){
  const out:Record<string,unknown>={};
  for(const [key,item]of Object.entries(record(value)))out[key]=redactSettings(item);
  return out;
 }
 return value;
}

function countKind(events:readonly DevEvent[],kind:DevEventKind):number{
 let n=0;for(const event of events)if(event.kind===kind)n++;return n;
}

function latencyStats(values:readonly number[]):DevLatencyStats{
 const sample=values.filter(v=>Number.isFinite(v)&&v>=0);
 let max:number|null=null;
 for(const v of sample)if(max===null||v>max)max=v;
 return {p50:percentile(sample,50),p95:percentile(sample,95),max,samples:sample.length};
}

const RULE_EVENT_KINDS=new Set(['tool-budget-soft','tool-budget-hard','repeat-call']);
const VIOLATION_CLASSES=new Set<ToolErrorClass>(['unoffered-tool','path-refused','title-rule']);
const STALE_PHRASE='The note changed since this proposal';
const TOKEN_NOTE='Token counts are estimates (~3.5 characters per token). Providers do not report exact token counts to OWLA; plan usage percentages above are provider-reported.';

export function buildDiagnosticsReport(input:DiagnosticsInput):DiagnosticsReport{
 const {turns,events}=input.journal;
 const totals=computeDevTotals(turns,events);
 const settings=input.settings;
 const features:Record<string,boolean|string>={
  developerMode:settings.developerMode,
  webSearch:settings.webSearch,
  pluginInterconnectivity:settings.pluginInterconnectivity,
  visualScreenshots:settings.visualScreenshots,
  automaticProvider:settings.automaticProvider,
  automaticRouting:settings.automaticRouting,
  automaticSelectionAvailable:input.automaticSelectionAvailable,
  routingMode:settings.routingMode,
  routingPrivacyMode:settings.routingPrivacyMode,
  routingThorough:settings.routingThorough,
  showRoutingDetails:settings.showRoutingDetails,
  diffView:settings.diffView,
  fallback:settings.fallback,
  canvas:input.visualFeatures.canvas,
  bases:input.visualFeatures.bases,
  excalidraw:input.visualFeatures.excalidraw,
 };
 for(const provider of input.providers)features[provider.id+'Connected']=provider.connected;
 const providers=input.providers.map(provider=>({
  ...provider,
  // Bridge status/version/plan can carry raw CLI error text (audit F1):
  // friendlyClaudeError/friendlyOpencodeError fall through to the raw message.
  status:redactSensitive(provider.status),
  version:redactSensitive(provider.version),
  plan:redactSensitive(provider.plan),
  accountType:redactSensitive(provider.accountType),
  usageError:redactSensitive(provider.usageError),
  exhaustion:{...provider.exhaustion,reason:redactSensitive(provider.exhaustion.reason)},
  usageWindows:usageWindows(provider.usage),
 }));
 const routingHistory:RoutingHistoryRow[]=[];
 for(const [providerKey,models]of Object.entries(input.routingHistory)){
  if(!models)continue;
  const provider=providerKey as ProviderId;
  for(const [model,kinds]of Object.entries(models)){
   let lastUsedAt:number|null=null;
   for(const kind of TASK_KINDS){
    const at=kinds[kind]?.lastUsedAt;
    if(typeof at==='number'&&Number.isFinite(at)&&(lastUsedAt===null||at>lastUsedAt))lastUsedAt=at;
   }
   const p50=modelP50Latency(input.routingHistory,provider,model);
   for(const kind of TASK_KINDS){
    const stats=kinds[kind];
    if(!stats)continue;
    routingHistory.push({provider,model,kind,success:stats.success,fail:stats.fail,p50LatencyMs:p50,lastUsedAt});
   }
  }
 }
 // Turns keep the user's own prompt/reply/tool-result text untouched; only
 // error strings are redacted. Events are capped to the newest report window.
 const reportTurns=turns.map(turn=>{
  const next:DevTurn={...turn,toolCalls:turn.toolCalls.map(call=>{
   const copy:DevToolCall={...call};
   if(copy.error!==undefined)copy.error=redactSensitive(copy.error);
   return copy;
  })};
  if(next.error!==null)next.error=redactSensitive(next.error);
  return next;
 });
 const reportEvents=events.slice(-DEV_LIMITS.maxReportEvents).map(event=>({...event,detail:redactSensitive(event.detail)}));
 const turnLatencies:number[]=[],toolDurations:number[]=[];
 const violations:RuleViolationRow[]=[];
 let staleCalls=0,emptyFailedTurns=0;
 for(const event of events)if(RULE_EVENT_KINDS.has(event.kind))violations.push({at:event.at,kind:event.kind,detail:redactSensitive(event.detail)});
 for(const turn of turns){
  if(turn.latencyMs!==null)turnLatencies.push(turn.latencyMs);
  if(turn.ok===false&&turn.error!==null&&turn.error.includes('returned no answer'))emptyFailedTurns++;
  for(const call of turn.toolCalls){
   if(call.durationMs!==null)toolDurations.push(call.durationMs);
   if(call.ok)continue;
   const cls=classifyToolError(call.error??'');
   if(cls==='stale-snapshot')staleCalls++;
   if(VIOLATION_CLASSES.has(cls))violations.push({at:call.startedAt,kind:cls,tool:call.name,detail:redactSensitive(call.error??'')});
  }
 }
 violations.sort((a,b)=>a.at<b.at?1:a.at>b.at?-1:0);
 let staleRejections=0;
 for(const event of events)if(event.kind==='proposal-rejected'&&event.detail.includes(STALE_PHRASE))staleRejections++;
 return {
  kind:'owla-diagnostics',
  version:1,
  generatedAt:input.generatedAt,
  plugin:{version:input.pluginVersion,minAppVersion:input.minAppVersion,obsidianVersion:input.obsidianVersion,platform:input.platform,platformKey:input.platformKey},
  vault:{name:input.vaultName,storageRoot:input.storageRoot,vaultStoragePath:input.vaultStoragePath},
  settings:redactSettings(settings) as ButlerSettings,
  features,
  providers,
  modelUnavailability:input.modelUnavailability,
  routingHistory,
  savedChats:input.savedChats,
  currentSession:{chatId:input.journal.chatId,turns:reportTurns,events:reportEvents},
  totals,
  performance:{turnLatency:latencyStats(turnLatencies),toolDuration:latencyStats(toolDurations)},
  ruleViolations:violations.slice(0,200),
  loss:{
   data:{
    editConflicts:countKind(events,'edit-conflict')+staleCalls+staleRejections,
    proposalRejections:countKind(events,'proposal-rejected'),
    pendingEdits:input.pendingEdits.length,
    pendingLoadError:redactSensitive(input.pendingLoadError),
    editBackups:input.editBackupCount,
   },
   tokens:{
    contextShortened:totals.contextShortened,
    historyTrimmed:totals.historyTrimmed,
    selectionsTrimmed:totals.selectionsTrimmed,
    estimatedInputTokens:totals.estimatedInputTokens,
    estimatedOutputTokens:totals.estimatedOutputTokens,
    note:TOKEN_NOTE,
   },
   quality:{
    escalations:totals.escalations,
    retries:totals.retries,
    // One empty reply produces one failed turn AND one empty-reply event;
    // count the turn only so the same reply is not counted twice (DM-02).
    emptyReplies:emptyFailedTurns,
    turnErrors:totals.failedTurns,
   },
  },
  notes:[
   TOKEN_NOTE,
   "OWLA's assistants have no shell or file tools by design; the recorded tool calls are the commands they ran.",
   "Full raw transcripts live in each provider's session directory (listed per provider); OWLA records what passes through its own tool layer.",
   'Recording happens only while Developer mode is enabled; earlier turns are not captured.',
   'Saved chats hold only the last three exchanges (the existing ChatStore limit).',
   `The report includes the newest ${DEV_LIMITS.maxReportEvents} events; totals cover the full recorded journal.`,
  ],
 };
}

const MARKDOWN_LIMIT=19_500;
const clip=(text:string,max:number)=>text.length<=max?text:text.slice(0,max-1)+'…';
const line=(text:string)=>text.replace(/\s+/g,' ').trim();
const cell=(text:string)=>line(text).replace(/\|/g,'\\|');
const ms=(value:number|null)=>value===null?'n/a':`${Math.round(value)} ms`;
const reset=(value:number|null)=>value===null?'—':new Date(value*1000).toISOString();

/** Human-readable summary; every list is clipped so the file stays bounded. */
export function renderMarkdownReport(report:DiagnosticsReport):string{
 const out:string[]=[];
 out.push('# OWLA Butler diagnostics report','',`Generated: ${report.generatedAt}`,`Plugin: ${report.plugin.version} (min app ${report.plugin.minAppVersion}, Obsidian ${report.plugin.obsidianVersion}, ${report.plugin.platform})`,`Vault: ${report.vault.name}`,'');
 out.push('## Features','','| Feature | State |','| --- | --- |');
 for(const [name,state]of Object.entries(report.features))out.push(`| ${cell(name)} | ${typeof state==='boolean'?(state?'on':'off'):cell(state)} |`);
 out.push('','## Providers');
 for(const provider of report.providers){
  out.push('',`### ${line(provider.name)} (${provider.id})`,`- Status: ${clip(line(provider.status),160)||'—'}`,`- Plan: ${clip(line(provider.plan),80)||'—'} · Version: ${clip(line(provider.version),80)||'—'}`);
  if(provider.usageWindows.length){
   out.push('- Usage:');
   for(const w of provider.usageWindows)out.push(`  - ${cell(w.bucket)} · ${cell(w.window)}: ${w.used}% used, resets ${reset(w.resetsAt)}`);
  }else out.push('- Usage: no provider-reported windows');
  const exhaustion=exhaustionLabel(provider.exhaustion);
  out.push(`- Exhaustion: ${exhaustion?clip(line(exhaustion),200):'none'}`);
 }
 const t=report.totals;
 out.push('','## Session totals',`- Turns: ${t.turns} (${t.successfulTurns} ok, ${t.failedTurns} failed)`,`- Tool calls: ${t.toolCalls} (${t.toolErrors} errors)`,`- Estimated tokens: ~${t.estimatedInputTokens} in / ~${t.estimatedOutputTokens} out`);
 const perf=(label:string,s:DevLatencyStats)=>`- ${label}: p50 ${ms(s.p50)} · p95 ${ms(s.p95)} · max ${ms(s.max)} (${s.samples} samples)`;
 out.push('','## Performance',perf('Turn latency',report.performance.turnLatency),perf('Tool duration',report.performance.toolDuration));
 out.push('','## Rule violations',`${report.ruleViolations.length} recorded (newest first${report.ruleViolations.length>10?', showing 10':''}).`);
 for(const row of report.ruleViolations.slice(0,10))out.push(`- ${row.at} · ${row.kind}${row.tool?' · '+cell(row.tool):''} — ${clip(line(row.detail),120)}`);
 const {data,tokens,quality}=report.loss;
 out.push('','## Loss indicators',
  `- Data: ${data.editConflicts} edit conflicts, ${data.proposalRejections} proposal rejections, ${data.pendingEdits} pending edits, ${data.editBackups} edit backups${data.pendingLoadError?'; pending load error: '+clip(line(data.pendingLoadError),120):''}`,
  `- Tokens: ${tokens.contextShortened} context shortened, ${tokens.historyTrimmed} history trimmed, ${tokens.selectionsTrimmed} selections trimmed; ~${tokens.estimatedInputTokens} in / ~${tokens.estimatedOutputTokens} out (estimates)`,
  `- Quality: ${quality.escalations} escalations, ${quality.retries} retries, ${quality.emptyReplies} empty replies, ${quality.turnErrors} turn errors`);
 out.push('','## Saved chats');
 const chats=report.savedChats.slice(0,20);
 if(!chats.length)out.push('- none');
 for(const chat of chats)out.push(`- ${clip(line(chat.title),80)||'Untitled'} — ${chat.messages.length} messages`);
 out.push('','## Current session');
 const turns=report.currentSession.turns.slice(0,20);
 if(!turns.length)out.push('- no recorded turns');
 for(const turn of turns){
  const ok=turn.ok===null?'running':turn.ok?'ok':'failed';
  out.push(`- ${turn.startedAt.slice(0,19).replace('T',' ')} · ${turn.provider}/${clip(line(turn.model),60)} · ${ok} · ${turn.toolCalls.length} tool calls — ${clip(line(turn.prompt),60)}`);
 }
 out.push('','## Notes');
 for(const note of report.notes)out.push(`- ${line(note)}`);
 let text=out.join('\n');
 if(text.length>MARKDOWN_LIMIT)text=text.slice(0,MARKDOWN_LIMIT-20)+'\n…(report clipped)';
 return text;
}
