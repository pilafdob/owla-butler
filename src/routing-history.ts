/**
 * Per-vault automatic routing history and latency tracking.
 *
 * Stored in the private OWLA vault storage folder (never inside the vault).
 * Tracks outcomes and rolling latencies per (provider, model, task kind) so
 * automatic selection can apply a bounded personalization adjustment (±0.4
 * once at least 3 turns are recorded) and a small latency tie-break penalty
 * when median latency exceeds 2,000 ms.
 */

import {existsSync,mkdirSync,readFileSync,renameSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ProviderId} from './provider';
import {PROVIDER_IDS} from './provider';
import {TASK_KINDS,type TaskKind} from './model-profiles';
import {record} from './validation';

export type TaskOutcomeStats={success:number;fail:number;latencyMs:number[]};
export type RoutingHistoryData=Partial<Record<ProviderId,Record<string,Partial<Record<TaskKind,TaskOutcomeStats>>>>>;

const HISTORY_FILE='routing-history.json';
const MAX_HISTORY_BYTES=1_000_000;
const MAX_LATENCY_SAMPLES=20;

export function loadRoutingHistory(root:string):RoutingHistoryData{
 const file=join(root,HISTORY_FILE);
 if(!existsSync(file))return {};
 try{
  if(statSync(file).size>MAX_HISTORY_BYTES)return {};
  const raw:unknown=JSON.parse(readFileSync(file,'utf8'));
  const top=record(raw);
  const result:RoutingHistoryData={};
  for(const provider of PROVIDER_IDS){
   const modelsObj=record(top[provider]);
   const providerMap:Record<string,Partial<Record<TaskKind,TaskOutcomeStats>>>={};
   for(const [modelKey,kindsVal] of Object.entries(modelsObj)){
    if(!modelKey||typeof kindsVal!=='object'||kindsVal===null)continue;
    const kindsObj=record(kindsVal);
    const kindMap:Partial<Record<TaskKind,TaskOutcomeStats>>={};
    for(const kind of TASK_KINDS){
     const statsVal=kindsObj[kind];
     if(!statsVal||typeof statsVal!=='object')continue;
     const stats=record(statsVal);
     const success=typeof stats.success==='number'&&Number.isFinite(stats.success)&&stats.success>=0?Math.floor(stats.success):0;
     const fail=typeof stats.fail==='number'&&Number.isFinite(stats.fail)&&stats.fail>=0?Math.floor(stats.fail):0;
     const latencyMs=Array.isArray(stats.latencyMs)
      ?stats.latencyMs.filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0).slice(-MAX_LATENCY_SAMPLES)
      :[];
     if(success>0||fail>0||latencyMs.length>0)kindMap[kind]={success,fail,latencyMs};
    }
    if(Object.keys(kindMap).length>0)providerMap[modelKey]=kindMap;
   }
   if(Object.keys(providerMap).length>0)result[provider]=providerMap;
  }
  return result;
 }catch{
  return {};
 }
}

export function saveRoutingHistory(root:string,history:RoutingHistoryData):void{
 const data=JSON.stringify(history);
 if(Buffer.byteLength(data)>MAX_HISTORY_BYTES)return;
 mkdirSync(root,{recursive:true,mode:0o700});
 const file=join(root,HISTORY_FILE);
 const temp=file+'.'+randomUUID()+'.tmp';
 try{
  writeFileSync(temp,data,{mode:0o600,flag:'wx'});
  renameSync(temp,file);
 }finally{
  if(existsSync(temp))unlinkSync(temp);
 }
}

export function clearRoutingHistory(root:string):void{
 const file=join(root,HISTORY_FILE);
 if(existsSync(file)){
  try{unlinkSync(file);}catch{/* Ignore missing file on race. */}
 }
}

export function recordRoutingOutcome(
 history:RoutingHistoryData,
 outcome:{provider:ProviderId;model:string;kind:TaskKind;success:boolean;latencyMs?:number}
):RoutingHistoryData{
 const {provider,model,kind,success,latencyMs}=outcome;
 const next:RoutingHistoryData={...history};
 const providerModels={...(next[provider]??{})};
 const modelKinds={...(providerModels[model]??{})};
 const current=modelKinds[kind]??{success:0,fail:0,latencyMs:[]};
 const latencies=typeof latencyMs==='number'&&Number.isFinite(latencyMs)&&latencyMs>=0
  ?[...current.latencyMs,Math.round(latencyMs)].slice(-MAX_LATENCY_SAMPLES)
  :[...current.latencyMs];
 modelKinds[kind]={
  success:current.success+(success?1:0),
  fail:current.fail+(success?0:1),
  latencyMs:latencies,
 };
 providerModels[model]=modelKinds;
 next[provider]=providerModels;
 return next;
}

/**
 * Score adjustment in [-0.4, +0.4] once at least 3 samples exist for (provider, model, kind).
 * Lower score is better: a high success rate yields a negative delta (bonus),
 * and a high failure rate yields a positive delta (penalty).
 */
export function personalizationScore(
 history:RoutingHistoryData|undefined,
 provider:ProviderId,
 model:string,
 kind:TaskKind
):number{
 const stats=history?.[provider]?.[model]?.[kind];
 if(!stats)return 0;
 const total=stats.success+stats.fail;
 if(total<3)return 0;
 const winRate=stats.success/total;
 const delta=(0.5-winRate)*0.8;
 return Math.max(-0.4,Math.min(0.4,Number(delta.toFixed(4))));
}

/** Rolling median (p50) latency in ms for a (provider, model) across recorded kinds. */
export function modelP50Latency(
 history:RoutingHistoryData|undefined,
 provider:ProviderId,
 model:string
):number|null{
 const modelKinds=history?.[provider]?.[model];
 if(!modelKinds)return null;
 const samples:number[]=[];
 for(const kind of TASK_KINDS){
  const list=modelKinds[kind]?.latencyMs;
  if(list?.length)samples.push(...list);
 }
 if(!samples.length)return null;
 const sorted=[...samples].sort((a,b)=>a-b);
 const mid=Math.floor(sorted.length/2);
 return sorted.length%2===1?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}

/**
 * Latency penalty: 0.05 * (p50 / 1000) capped at 0.5 when p50 > 2000ms.
 * Added to score (higher score = worse).
 */
export function latencyPenalty(
 history:RoutingHistoryData|undefined,
 provider:ProviderId,
 model:string
):number{
 const p50=modelP50Latency(history,provider,model);
 if(p50===null||p50<=2000)return 0;
 return Math.min(0.5,Number((0.05*(p50/1000)).toFixed(4)));
}
