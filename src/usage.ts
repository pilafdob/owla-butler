import {record} from './validation';

export interface LimitWindow{usedPercent:number;windowDurationMins?:number|null;resetsAt?:number|null;}
export interface LimitBucket{limitId?:string|null;limitName?:string|null;normalModelSlug?:string|null;planType?:string|null;primary?:LimitWindow|null;secondary?:LimitWindow|null;credits?:{hasCredits:boolean;unlimited:boolean;balance?:string|null}|null;rateLimitReachedType?:string|null;}
export interface UsageSnapshot{rateLimits?:LimitBucket|null;rateLimitsByLimitId?:Record<string,LimitBucket>|null;rateLimitResetCredits?:{availableCount:number}|null;}
export function updateUsage(previous:UsageSnapshot|null,incoming:UsageSnapshot,replace=false):UsageSnapshot{
 if(replace)previous=null;
 const buckets={...previous?.rateLimitsByLimitId,...incoming.rateLimitsByLimitId};if(incoming.rateLimits){const key=incoming.rateLimits.limitId||'codex';buckets[key]={...buckets[key],...incoming.rateLimits};}
 return {...previous,...incoming,rateLimitsByLimitId:buckets};
}
export function usageWindows(data:UsageSnapshot|null){const rows:{bucket:string;window:string;used:number;remaining:number;resetsAt:number|null}[]=[];for(const [id,bucket]of Object.entries(data?.rateLimitsByLimitId??{})){for(const name of ['primary','secondary'] as const){const window=bucket[name];if(!window||typeof window.usedPercent!=='number'||!Number.isFinite(window.usedPercent))continue;const mins=window.windowDurationMins;const label=mins&&mins%1440===0?`${mins/1440}-day window`:mins&&mins%60===0?`${mins/60}-hour window`:mins?`${mins}-minute window`:name==='primary'?'Primary window':'Secondary window';rows.push({bucket:bucket.limitName||(bucket.limitId==='codex'?'Codex':bucket.limitId)||id,window:label,used:window.usedPercent,remaining:Math.max(0,100-window.usedPercent),resetsAt:typeof window.resetsAt==='number'?window.resetsAt:null});}}return rows;}

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
