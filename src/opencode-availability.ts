/**
 * Which OpenCode models can serve a turn right now.
 *
 * OpenCode bundles several independent billing sources behind one server:
 *
 *  - OpenCode Zen (`opencode/…`): paid models draw on the console balance;
 *    free models share one free-tier limit.
 *  - OpenCode Go (`opencode-go/…`): paid models draw on the Go subscription's
 *    rolling, weekly and monthly meters; limited-time free models do not.
 *  - Every other provider signed in to OpenCode (`github-copilot/…`,
 *    `anthropic/…` and so on) has its own plan, which may not include every
 *    model its catalogue lists.
 *
 * One source running dry leaves the others usable: an empty Zen balance or a
 * depleted Go plan still leaves the free models, and a Copilot plan without
 * Opus still leaves its other models. So a failure blocks only the pool it
 * belongs to, or only the model when the refusal is model-specific, and
 * OpenCode as a whole counts as exhausted only once every model is blocked.
 */

import type {ProviderId,ProviderModel} from './provider';
import type {UsageSnapshot} from './usage';

/** How far a failure reaches. */
export type OpencodeBlockScope='model'|'pool'|'account'|'none';
export type OpencodeFailure={scope:OpencodeBlockScope;reason:string;kind:'unavailable'|'balance'|'free-limit'|'usage-limit'|'auth'|'region'|'other'};

/** A block without a reported reset is retried after this long. */
export const OPENCODE_RETRY_AFTER_SECONDS=30*60;

const FREE_NAME=/(^|[-_\s/(])free([-_\s)]|$)/i;
/**
 * Free models: priced at zero in the catalogue, or named free. OpenCode Go's
 * limited-time free models are free by either signal.
 */
export function isOpencodeFreeModel(model:ProviderModel):boolean{
 if(model.cost&&model.cost.input===0&&model.cost.output===0)return true;
 return FREE_NAME.test(model.id)||FREE_NAME.test(model.displayName);
}

/** The OpenCode provider a model comes from: `opencode`, `opencode-go`, `github-copilot`… */
export function opencodeSource(model:ProviderModel):string{
 return model.providerID||model.id.split('/')[0]||'opencode';
}

/** The billing pool a model draws on. Free models of a source share one pool. */
export function opencodePool(model:ProviderModel):string{
 return (isOpencodeFreeModel(model)?'free:':'paid:')+opencodeSource(model);
}

/** Reads an OpenCode failure message and decides how far it reaches. */
export function classifyOpencodeFailure(message:string):OpencodeFailure{
 if(/hosted outside/i.test(message))return {scope:'model',kind:'region',reason:'not allowed in your workspace’s privacy regions'};
 if(/free-limit|free usage limit/i.test(message))return {scope:'pool',kind:'free-limit',reason:'free models’ shared limit reached'};
 if(/insufficient (balance|credit|fund)|top up|out of credits|no credits|payment required|\b402\b|billing/i.test(message))
  return {scope:'pool',kind:'balance',reason:'no credit balance'};
 if(/model[^.]{0,40}(unavailable|not (available|supported|found|enabled|allowed|included))|unsupported model|model_not_supported|not (included|available) (in|on|with) your (plan|subscription)|does not have access|no access to|not entitled|\b403\b|forbidden/i.test(message))
  return {scope:'model',kind:'unavailable',reason:'not available on your plan'};
 if(/usage limit|rate.?limit|quota|\b429\b|too many requests/i.test(message))return {scope:'pool',kind:'usage-limit',reason:'usage limit reached'};
 if(/\b401\b|unauthori[sz]ed|authentication|credential|sign in/i.test(message))return {scope:'account',kind:'auth',reason:'sign-in refused'};
 return {scope:'none',kind:'other',reason:''};
}

type Block={until:number;reason:string;kind:OpencodeFailure['kind']};

export class OpencodeAvailability{
 private models=new Map<string,Block>();
 private pools=new Map<string,Block>();
 private accounts=new Map<string,Block>();

 private static live(map:Map<string,Block>,key:string,now:number):Block|undefined{
  const block=map.get(key);
  if(block&&block.until<=now){map.delete(key);return undefined;}
  return block;
 }

 /** Why a model cannot be used now, or undefined when it can. */
 blockOf(model:ProviderModel,now=Date.now()/1000):Block|undefined{
  return OpencodeAvailability.live(this.models,model.id,now)
   ??OpencodeAvailability.live(this.pools,opencodePool(model),now)
   ??OpencodeAvailability.live(this.accounts,opencodeSource(model),now);
 }
 available(model:ProviderModel,now=Date.now()/1000):boolean{return !this.blockOf(model,now);}
 isRegionRestricted(id:string,now=Date.now()/1000):boolean{return OpencodeAvailability.live(this.models,id,now)?.kind==='region';}

 /**
  * Records a failed turn. Region and plan refusals last until OWLA reloads;
  * limits last until the reported reset, or a fixed wait when none is given.
  */
 recordFailure(model:ProviderModel,message:string,resetsAt:number|null,now=Date.now()/1000):OpencodeFailure{
  const failure=classifyOpencodeFailure(message);
  const timed=resetsAt!==null&&resetsAt>now?resetsAt:now+OPENCODE_RETRY_AFTER_SECONDS;
  const block={reason:failure.reason,kind:failure.kind};
  if(failure.scope==='model')this.models.set(model.id,{...block,until:Number.POSITIVE_INFINITY});
  else if(failure.scope==='pool')this.pools.set(opencodePool(model),{...block,until:timed});
  else if(failure.scope==='account')this.accounts.set(opencodeSource(model),{...block,until:timed});
  return failure;
 }

 /** A model answered, so its pool and account are usable again. */
 recordSuccess(model:ProviderModel):void{
  this.models.delete(model.id);
  this.pools.delete(opencodePool(model));
  this.accounts.delete(opencodeSource(model));
 }

 /**
  * OpenCode Go reports its meters. A full meter blocks Go's paid models until
  * it resets, before a turn is spent finding out; free Go models stay usable.
  */
 applyUsage(usage:UsageSnapshot|null,now=Date.now()/1000):void{
  let full:number|null=null,any=false;
  for(const [id,bucket] of Object.entries(usage?.rateLimitsByLimitId??{})){
   if(!id.startsWith('opencode-go-'))continue;
   const window=bucket.primary;
   if(!window||window.usedPercent<100)continue;
   const reset=typeof window.resetsAt==='number'?window.resetsAt:null;
   if(reset!==null&&reset<=now)continue;
   any=true;
   const until=reset??now+OPENCODE_RETRY_AFTER_SECONDS;
   if(full===null||until>full)full=until;
  }
  const current=this.pools.get('paid:opencode-go');
  if(any&&full!==null)this.pools.set('paid:opencode-go',{until:full,reason:'OpenCode Go usage limit reached',kind:'usage-limit'});
  // A meter that is no longer full lifts a block that came from the meters.
  else if(current?.reason==='OpenCode Go usage limit reached')this.pools.delete('paid:opencode-go');
 }

 /** The shared free-tier limit of OpenCode Zen, for the usage panel. */
 freeLimit(now=Date.now()/1000):{resetsAt:number|null}|null{
  const block=OpencodeAvailability.live(this.pools,'free:opencode',now);
  if(!block||block.kind!=='free-limit')return null;
  return {resetsAt:Number.isFinite(block.until)?block.until:null};
 }

 /** The earliest moment a blocked model becomes usable again, or null when none will. */
 nextReset(models:ProviderModel[],now=Date.now()/1000):number|null{
  let earliest:number|null=null;
  for(const model of models){
   const block=this.blockOf(model,now);
   if(!block||!Number.isFinite(block.until))continue;
   if(earliest===null||block.until<earliest)earliest=block.until;
  }
  return earliest;
 }
}

/**
 * Session-scoped model availability cache across all providers (Codex, OpenCode, Claude).
 * When a model is refused because of region restrictions, plan entitlement, or unsupported
 * model status, it is marked unavailable for the remainder of the session.
 */
export class SessionModelAvailability{
 private refused=new Map<string,{reason:string;kind:'region'|'unavailable'}>();
 private static key(provider:ProviderId,model:string):string{return provider+':'+model;}

 recordFailure(provider:ProviderId,model:string,message:string):{refused:boolean;reason:string}{
  const classified=classifyOpencodeFailure(message);
  if(classified.scope==='model'&&(classified.kind==='region'||classified.kind==='unavailable')){
   this.refused.set(SessionModelAvailability.key(provider,model),{reason:classified.reason,kind:classified.kind});
   return {refused:true,reason:classified.reason};
  }
  return {refused:false,reason:''};
 }

 available(provider:ProviderId,model:string):boolean{
  return !this.refused.has(SessionModelAvailability.key(provider,model));
 }

 reasonOf(provider:ProviderId,model:string):string|undefined{
  return this.refused.get(SessionModelAvailability.key(provider,model))?.reason;
 }

 isRegionRestricted(provider:ProviderId,model:string):boolean{
  return this.refused.get(SessionModelAvailability.key(provider,model))?.kind==='region';
 }

 clear():void{
  this.refused.clear();
 }
}
