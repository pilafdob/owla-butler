import {record,list} from './validation';

export interface LimitWindow{usedPercent:number;windowDurationMins?:number|null;resetsAt?:number|null;label?:string;}
export interface LimitBucket{limitId?:string|null;limitName?:string|null;normalModelSlug?:string|null;planType?:string|null;primary?:LimitWindow|null;secondary?:LimitWindow|null;credits?:{hasCredits:boolean;unlimited:boolean;balance?:string|null}|null;rateLimitReachedType?:string|null;}
export interface UsageSnapshot{rateLimits?:LimitBucket|null;rateLimitsByLimitId?:Record<string,LimitBucket>|null;rateLimitResetCredits?:{availableCount:number}|null;}
export function updateUsage(previous:UsageSnapshot|null,incoming:UsageSnapshot,replace=false):UsageSnapshot{
 if(replace)previous=null;
 const buckets={...previous?.rateLimitsByLimitId,...incoming.rateLimitsByLimitId};if(incoming.rateLimits){const key=incoming.rateLimits.limitId||'codex';buckets[key]={...buckets[key],...incoming.rateLimits};}
 return {...previous,...incoming,rateLimitsByLimitId:buckets};
}
export function usageWindows(data:UsageSnapshot|null){const rows:{bucket:string;window:string;used:number;remaining:number;resetsAt:number|null}[]=[];for(const [id,bucket]of Object.entries(data?.rateLimitsByLimitId??{})){for(const name of ['primary','secondary'] as const){const window=bucket[name];if(!window||typeof window.usedPercent!=='number'||!Number.isFinite(window.usedPercent))continue;const mins=window.windowDurationMins;const label=window.label??(mins&&mins%1440===0?`${mins/1440}-day window`:mins&&mins%60===0?`${mins/60}-hour window`:mins?`${mins}-minute window`:name==='primary'?'Primary window':'Secondary window');rows.push({bucket:bucket.limitName||(bucket.limitId==='codex'?'Codex':bucket.limitId)||id,window:label,used:window.usedPercent,remaining:Math.max(0,100-window.usedPercent),resetsAt:typeof window.resetsAt==='number'?window.resetsAt:null});}}return rows;}

function decodeWindow(value:unknown):LimitWindow|null|undefined{
 if(value===null)return null;
 const {usedPercent,windowDurationMins,resetsAt}=record(value);
 if(typeof usedPercent!=='number'||!Number.isFinite(usedPercent))return undefined;
 return {usedPercent,windowDurationMins:typeof windowDurationMins==='number'?windowDurationMins:null,resetsAt:typeof resetsAt==='number'?resetsAt:null};
}
function decodeBucket(value:unknown):LimitBucket|null|undefined{
 if(value===null)return null;
 if(typeof value!=='object'||Array.isArray(value))return undefined;
 const data=record(value),bucket:LimitBucket={};
 for(const key of ['limitId','limitName','normalModelSlug','planType','rateLimitReachedType'] as const){const field=data[key];if(field===null||typeof field==='string')bucket[key]=field;}
 for(const key of ['primary','secondary'] as const){const window=decodeWindow(data[key]);if(window!==undefined)bucket[key]=window;}
 const credits=record(data.credits);if(typeof credits.hasCredits==='boolean'&&typeof credits.unlimited==='boolean')bucket.credits={hasCredits:credits.hasCredits,unlimited:credits.unlimited,balance:typeof credits.balance==='string'?credits.balance:null};
 return bucket;
}
export function decodeUsage(value:unknown):UsageSnapshot|null{
 const data=record(value),snapshot:UsageSnapshot={};
 const limits=decodeBucket(data.rateLimits);if(limits!==undefined)snapshot.rateLimits=limits;
 if(data.rateLimitsByLimitId===null)snapshot.rateLimitsByLimitId=null;
 else if(typeof data.rateLimitsByLimitId==='object'&&!Array.isArray(data.rateLimitsByLimitId))snapshot.rateLimitsByLimitId=Object.fromEntries(Object.entries(record(data.rateLimitsByLimitId)).flatMap(([id,value])=>{const bucket=decodeBucket(value);return bucket?[[id,bucket]]:[];}));
 const {availableCount}=record(data.rateLimitResetCredits);if(typeof availableCount==='number'&&Number.isSafeInteger(availableCount)&&availableCount>=0)snapshot.rateLimitResetCredits={availableCount};else if(data.rateLimitResetCredits===null)snapshot.rateLimitResetCredits=null;
 return Object.keys(snapshot).length?snapshot:null;
}

// OpenCode reports its own plan meters and optional spending budgets. The
// meters are already percentages; the budgets are converted into the same
// percentage shape so both providers render through one panel.
function decodeMeter(value:unknown,label:string):LimitWindow|null{
 const data=record(value);
 if(typeof data.percent!=='number'||!Number.isFinite(data.percent))return null;
 if(data.limited===false)return null;
 return {usedPercent:Math.min(100,Math.max(0,data.percent)),resetsAt:typeof data.resetsAt==='number'?Math.round(data.resetsAt/1000):null,label};
}
export function decodeOpencodeUsage(value:unknown):UsageSnapshot|null{
 const data=record(value);
 if(data==null||Object.keys(data).length===0)return null;
 const buckets:Record<string,LimitBucket>={};
 const go=record(data.go);
 for(const [key,label] of [['rolling','Rolling window'],['weekly','Weekly window'],['monthly','Monthly window']] as const){
  const window=decodeMeter(go[key],label);
  if(window)buckets['opencode-go-'+key]={limitId:'opencode-go-'+key,limitName:'OpenCode Go',primary:window};
 }
 for(const value of list(data.budgets)){
  const budget=record(value);
  const id=typeof budget.id==='string'?budget.id:'';
  const limit=typeof budget.limit==='number'&&Number.isFinite(budget.limit)?budget.limit:0;
  const spent=typeof budget.spent==='number'&&Number.isFinite(budget.spent)?budget.spent:0;
  if(!id||limit<=0)continue;
  const used=Math.min(100,Math.max(0,(spent/limit)*100));
  buckets['opencode-budget-'+id]={limitId:'opencode-budget-'+id,limitName:'OpenCode budget · '+id,primary:{usedPercent:used,label:'Budget used'}};
 }
 if(!Object.keys(buckets).length)return null;
 return {rateLimitsByLimitId:buckets};
}

// Claude Code reports plan usage in a rate_limit_event while a reply runs.
// Utilisation is a fraction of each window. A rejected window counts as full.
const CLAUDE_WINDOWS:Record<string,{label:string;mins:number|null}>={
 five_hour:{label:'5-hour window',mins:300},
 seven_day:{label:'Weekly window',mins:10080},
 seven_day_opus:{label:'Weekly Opus window',mins:10080},
 seven_day_sonnet:{label:'Weekly Sonnet window',mins:10080},
};
function claudeWindow(name:string,value:unknown):LimitWindow|null{
 const data=record(value);
 const utilization=typeof data.utilization==='number'&&Number.isFinite(data.utilization)?data.utilization:null;
 const rejected=data.status==='rejected';
 if(utilization===null&&!rejected)return null;
 const known=CLAUDE_WINDOWS[name];
 const used=rejected?100:Math.round(Math.min(1,Math.max(0,utilization??0))*1000)/10;
 return {usedPercent:used,windowDurationMins:known?.mins??null,resetsAt:typeof data.resetsAt==='number'?data.resetsAt:null,label:known?.label??name.replace(/_/g,' ')};
}
/**
 * Decodes Claude Code's get_usage control response, which reports plan limits
 * without a prompt: utilization is a percentage and resets_at an ISO time.
 */
export function decodeClaudeUsage(value:unknown):UsageSnapshot|null{
 const limits=record(record(value).rate_limits);
 const windows:Record<string,unknown>={};
 for(const [name,raw] of Object.entries(limits)){
  const data=record(raw);
  if(typeof data.utilization!=='number'||!Number.isFinite(data.utilization))continue;
  const resets=typeof data.resets_at==='string'?Date.parse(data.resets_at):NaN;
  windows[name]={utilization:data.utilization/100,resetsAt:Number.isFinite(resets)?Math.floor(resets/1000):undefined,status:data.locked_reason?'rejected':undefined};
 }
 return decodeClaudeRateLimit({unifiedWindows:windows});
}
export function decodeClaudeRateLimit(value:unknown):UsageSnapshot|null{
 const info=record(value);
 const windows:Record<string,unknown>={...record(info.unifiedWindows)};
 // Older reports carry only the window that triggered the event.
 if(!Object.keys(windows).length&&typeof info.rateLimitType==='string')windows[info.rateLimitType]={utilization:info.utilization,resetsAt:info.resetsAt,status:info.status};
 const buckets:Record<string,LimitBucket>={};
 const main:LimitBucket={limitId:'claude',limitName:'Claude'};
 for(const [name,raw] of Object.entries(windows)){
  const window=claudeWindow(name,raw);
  if(!window)continue;
  if(name==='five_hour')main.primary=window;
  else if(name==='seven_day')main.secondary=window;
  else buckets['claude-'+name]={limitId:'claude-'+name,limitName:'Claude',primary:window};
 }
 if(info.status==='rejected')main.rateLimitReachedType=typeof info.rateLimitType==='string'?info.rateLimitType:'rejected';
 if(main.primary||main.secondary)buckets.claude=main;
 if(!Object.keys(buckets).length)return null;
 return {rateLimitsByLimitId:buckets};
}
