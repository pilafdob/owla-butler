/**
 * Siri AI provider: Apple Foundation Models through the `fm` command-line tool
 * that ships with macOS 27.
 *
 * OWLA starts a private `fm serve` on a Unix socket only it can write to and
 * talks to it with the Chat Completions protocol. The `pcc` model runs on
 * Apple's Private Cloud Compute (account-level usage limits, larger context);
 * the `system` model runs on this Mac. The assistant reaches the vault only
 * through OWLA's own tools: `fm serve` has no file, shell or MCP access of its
 * own, and OWLA never passes `--tool`, `--model-provider` or a custom model, so
 * a model provider configured in `~/.fm/config.json` is never used.
 */

import {existsSync,rmSync} from 'node:fs';
import {request} from 'node:http';
import {release,tmpdir} from 'node:os';
import {posix} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as nodeTimeout,clearTimeout as clearNodeTimeout} from 'node:timers';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {runCli,sanitizedEnv,spawnCli,terminateProcessTree} from './cli';
import {LIMIT_ERROR,type ProviderExhaustion} from './exhaustion';
import type {ProviderBridge,ProviderModel,ProviderRunOptions,ProviderRunResult,ToolSpec} from './provider';
import type {UsageSnapshot} from './usage';
import {record,list,redactErrorDetail} from './validation';

export const FM_EXECUTABLE='/usr/bin/fm';
export const SIRI_NAME='Siri AI';
/** Tool rounds per reply before OWLA stops the model (matches the other bridges' hard cap). */
const MAX_TOOL_ROUNDS=50;
/** How long the private server keeps running after the last reply. */
const REST_MS=90_000;
/** Context windows. Apple does not publish them; the PCC figure is an estimate that has not been measured. */
const PCC_CONTEXT=32_768;
const SYSTEM_CONTEXT=4_096;
const EFFORTS=[{reasoningEffort:'default',description:'Apple chooses'}];

export const SIRI_MODELS:ProviderModel[]=[
 {id:'pcc',model:'pcc',displayName:'Siri AI · Private Cloud Compute',description:'Apple Foundation Model on Private Cloud Compute. Uses your Apple Account’s usage limits.',isDefault:true,defaultReasoningEffort:'default',supportedReasoningEfforts:EFFORTS,inputModalities:['text'],context:PCC_CONTEXT},
 {id:'system',model:'system',displayName:'Apple on-device model',description:'Apple Foundation Model on this Mac. No usage limits, small context window.',isDefault:false,defaultReasoningEffort:'default',supportedReasoningEfforts:EFFORTS,inputModalities:['text'],context:SYSTEM_CONTEXT},
];

/** Siri AI needs macOS 27 (Darwin 27) and Apple's `fm` tool. Never offered on Windows or Linux. */
export function siriSupported(platform:NodeJS.Platform=process.platform,kernel=release(),exists:(path:string)=>boolean=existsSync):boolean{
 if(platform!=='darwin')return false;
 const major=Number(kernel.split('.')[0]);
 return Number.isFinite(major)&&major>=27&&exists(FM_EXECUTABLE);
}

export type SiriModelState={available:boolean;reason:string};
/** Reads `GET /health`: which of `system` and `pcc` the server can serve, and why not. */
export function parseSiriHealth(value:unknown):Record<'pcc'|'system',SiriModelState>{
 const result={pcc:{available:false,reason:'Not reported.'},system:{available:false,reason:'Not reported.'}};
 for(const item of list(record(value).models)){
  const model=record(item),name=model.name;
  if(name!=='pcc'&&name!=='system')continue;
  result[name]={available:model.available===true,reason:typeof model.reason==='string'?model.reason.slice(0,300):''};
 }
 return result;
}

/**
 * Reads `fm quota-usage --model pcc`. Apple's wording for an available quota
 * has not been observed yet, so this accepts the common shapes: a percentage
 * (used, or remaining when the line says so), or "N of M" / "N/M" counts, plus
 * an optional reset time. An unavailable or unparsable report yields null.
 */
export function parseSiriQuota(text:string,now=Date.now()):UsageSnapshot|null{
 // eslint-disable-next-line no-control-regex -- terminal colour codes are stripped from the CLI output
 const clean=text.replace(/\u001b\[[0-9;]*m/g,'');
 const line=clean.split(/\r?\n/).find(row=>/^\s*pcc\b/i.test(row))??clean;
 if(/unavailable|not applicable|not available/i.test(line))return null;
 let used:number|null=null;
 const percent=/(\d+(?:\.\d+)?)\s*%/.exec(line);
 if(percent)used=/remain|left|available/i.test(line.slice(percent.index))?100-Number(percent[1]):Number(percent[1]);
 else{
  const count=/(\d+(?:\.\d+)?)\s*(?:of|\/)\s*(\d+(?:\.\d+)?)/.exec(line);
  if(count&&Number(count[2])>0){
   const share=Number(count[1])/Number(count[2])*100;
   used=/remain|left|available/i.test(line)?100-share:share;
  }
 }
 if(used===null||!Number.isFinite(used))return null;
 let resetsAt:number|null=null;
 const reset=/resets?\s+(?:at|on)?\s*([^,;()]+)/i.exec(line);
 if(reset){
  const relative=/in\s+(\d+)\s*(minute|min|hour|hr|day)s?/i.exec(reset[1]);
  if(relative){const unit=/^d/i.test(relative[2])?86_400:/^h/i.test(relative[2])?3_600:60;resetsAt=Math.round(now/1000)+Number(relative[1])*unit;}
  else{const parsed=Date.parse(reset[1].trim());if(Number.isFinite(parsed))resetsAt=Math.round(parsed/1000);}
 }
 return {rateLimitsByLimitId:{siri:{limitId:'siri',limitName:'Private Cloud Compute',primary:{usedPercent:Math.max(0,Math.min(100,used)),resetsAt,label:'Apple Account quota'}}}};
}

export const SIRI_CONTEXT_ERROR=/context (?:size|window|length)/i;
/** Longest tool result the on-device model receives in one piece. */
export const ON_DEVICE_TOOL_RESULT=1_500;
/**
 * Keeps the on-device transcript inside its small context: each tool result is
 * shortened, and results from earlier rounds are replaced by a one-line note
 * once the model has moved on. Private Cloud Compute keeps full results.
 */
export function compactTranscript(messages:{role:string;content?:unknown}[],model:string):void{
 if(model!=='system')return;
 const lastAssistant=messages.map(message=>message.role).lastIndexOf('assistant');
 messages.forEach((message,index)=>{
  if(message.role!=='tool'||typeof message.content!=='string')return;
  if(index<lastAssistant)message.content='[Earlier tool result omitted to fit the on-device model. Call the tool again if you still need it.]';
  else if(message.content.length>ON_DEVICE_TOOL_RESULT)message.content=message.content.slice(0,ON_DEVICE_TOOL_RESULT)+'\n[Result shortened for the on-device model. Read a specific heading or offset for more.]';
 });
}
/** A quota or rate-limit error from Private Cloud Compute. */
export function siriExhaustion(error:unknown,now=Date.now()/1000):ProviderExhaustion|null{
 const text=error instanceof Error?error.message:String(error);
 // "The session's transcript exceeded the model's context size" is not a usage limit.
 if(SIRI_CONTEXT_ERROR.test(text))return null;
 if(!LIMIT_ERROR.test(text)&&!/quota (?:is )?exceeded|exceeded (?:the |your )?quota/i.test(text))return null;
 // PCC reports no reset time in the error; try again after a bounded wait.
 return {provider:'siri',exhausted:true,resetsAt:now+15*60,reason:'Siri AI usage limit reached.',scope:'provider'};
}

/**
 * `fm serve` turns each object schema into a named type and cannot express a
 * map whose values have their own schema: `additionalProperties: {type:…}`
 * becomes an undefined reference and the whole request is refused (seen with
 * propose_properties' `rename`). Such maps are sent as free-form objects;
 * OWLA validates the values when the tool runs.
 */
export function fmSchema(schema:unknown):unknown{
 if(Array.isArray(schema))return schema.map(fmSchema);
 if(!schema||typeof schema!=='object')return schema;
 const result:Record<string,unknown>={};
 for(const [key,value] of Object.entries(schema as Record<string,unknown>))
  result[key]=key==='additionalProperties'&&value&&typeof value==='object'?true:fmSchema(value);
 return result;
}
/**
 * The tools the on-device model gets. Its context is small and every tool
 * schema costs prompt tokens (all of OWLA's tools came to about 4,200 tokens),
 * so it receives the core note tools only. Private Cloud Compute gets all.
 */
export const ON_DEVICE_TOOLS=new Set(['read_note','search_vault','list_vault_paths','read_attachment','read_pdf','read_reference','propose_edit','propose_note','propose_properties']);
/** OWLA's tools in Chat Completions form, shaped for `fm serve`. */
export function chatTools(specs:ToolSpec[],model='pcc'){
 return specs.filter(spec=>model!=='system'||ON_DEVICE_TOOLS.has(spec.name))
  .map(spec=>({type:'function',function:{name:spec.name,description:spec.description,parameters:fmSchema(spec.inputSchema)}}));
}

type ToolCall={id:string;name:string;arguments:string};
/** Accumulates one streamed reply: text deltas and tool calls split across chunks. */
export class ChatStreamReader{
 private buffer='';
 text='';
 finish='';
 readonly calls=new Map<number,ToolCall>();
 constructor(private onText:(delta:string)=>void){}
 push(chunk:string){
  this.buffer+=chunk;
  let end:number;
  while((end=this.buffer.indexOf('\n'))>=0){
   const line=this.buffer.slice(0,end).trim();
   this.buffer=this.buffer.slice(end+1);
   if(!line.startsWith('data:'))continue;
   const data=line.slice(5).trim();
   if(!data||data==='[DONE]')continue;
   let parsed:unknown;
   try{parsed=JSON.parse(data);}catch{continue;}
   const error=record(record(parsed).error);
   if(typeof error.message==='string')throw Error('Siri AI: '+error.message);
   for(const item of list(record(parsed).choices)){
    const choice=record(item),delta=record(choice.delta);
    if(typeof choice.finish_reason==='string')this.finish=choice.finish_reason;
    if(typeof delta.content==='string'&&delta.content){this.text+=delta.content;this.onText(delta.content);}
    for(const raw of list(delta.tool_calls)){
     const call=record(raw),fn=record(call.function),index=typeof call.index==='number'?call.index:this.calls.size;
     const current=this.calls.get(index)??{id:'',name:'',arguments:''};
     if(typeof call.id==='string')current.id=call.id;
     if(typeof fn.name==='string')current.name+=fn.name;
     if(typeof fn.arguments==='string')current.arguments+=fn.arguments;
     this.calls.set(index,current);
    }
   }
  }
 }
}

/** A short socket path: Unix sockets are limited to about 104 bytes on macOS. */
export function siriSocketPath(directory=tmpdir(),id=randomUUID().slice(0,8)):string{
 const preferred=posix.join(directory,'owla-fm-'+id+'.sock');
 return Buffer.byteLength(preferred)<100?preferred:posix.join('/tmp','owla-fm-'+id+'.sock');
}

function friendlySiriError(error:unknown):string{
 const text=redactErrorDetail(error instanceof Error?error.message:String(error)).slice(0,600);
 if(SIRI_CONTEXT_ERROR.test(text)&&/exceed/i.test(text))return 'Siri AI: this request no longer fits the model’s context window. Start a new chat, attach less, or use another provider for long notes.';
 return text.startsWith('Siri AI')?text:'Siri AI: '+text;
}

export class SiriBridge implements ProviderBridge{
 readonly id='siri' as const;
 private child:ChildProcessWithoutNullStreams|null=null;
 private socket='';
 private starting:Promise<void>|null=null;
 private holders=new Set<symbol>();
 private restTimer:ReturnType<typeof nodeTimeout>|undefined;
 health:Record<'pcc'|'system',SiriModelState>={pcc:{available:false,reason:''},system:{available:false,reason:''}};
 models:ProviderModel[]=[];
 usage:UsageSnapshot|null=null;
 usageUpdatedAt=0;
 usageError='';
 exhaustion:ProviderExhaustion|null=null;
 accountType:string|undefined='apple';
 plan='';
 version='';
 status='Not connected';
 executable=FM_EXECUTABLE;
 onStatus:(status:string)=>void=()=>{};
 onUsage:()=>void=()=>{};
 get ready(){return !!this.child&&this.models.length>0;}
 get running(){return !!this.child;}
 get needsSignIn(){return false;}
 get signInPending(){return false;}
 get selectableModels(){return this.models.filter(model=>this.health[model.id as 'pcc'|'system']?.available);}
 private setStatus(status:string){this.status=status;this.onStatus(status);}
 hold():()=>Promise<void>{
  const owner=Symbol();
  this.holders.add(owner);
  clearNodeTimeout(this.restTimer);
  return async()=>{
   if(!this.holders.delete(owner)||this.holders.size)return;
   clearNodeTimeout(this.restTimer);
   if(!this.child)return;
   this.restTimer=nodeTimeout(()=>{if(!this.holders.size&&this.child)this.disconnect('Connected to Siri AI · resting until needed');},REST_MS);
   this.restTimer.unref?.();
  };
 }
 resolveModel(preferred:string):ProviderModel|undefined{
  const usable=this.selectableModels;
  return usable.find(model=>model.id===preferred)??usable.find(model=>model.isDefault)??usable[0];
 }
 async connect(executable:string):Promise<void>{
  if(!siriSupported())throw Error('Siri AI needs macOS 27 or newer with Apple Intelligence turned on.');
  if(this.child&&this.models.length)return;
  if(this.starting)return this.starting;
  this.executable=executable||FM_EXECUTABLE;
  this.starting=this.start().finally(()=>{this.starting=null;});
  return this.starting;
 }
 private async start(){
  this.setStatus('Starting Siri AI…');
  const socket=siriSocketPath();
  rmSync(socket,{force:true});
  const env=sanitizedEnv(process.env);
  // `fm serve` binds the socket owner-writable only (srwxr-xr-x).
  const child=spawnCli(FM_EXECUTABLE,['serve','--socket',socket],{env,detached:true});
  this.child=child;this.socket=socket;
  let stderr='';
  child.stderr.on('data',(chunk:Buffer|string)=>{stderr=(stderr+chunk.toString()).slice(-2000);});
  child.on('exit',()=>{if(this.child===child){this.child=null;this.models=[];this.setStatus(stderr.trim()?friendlySiriError(stderr.trim()):'Siri AI stopped.');}});
  try{
   let health:unknown;
   for(let attempt=0;;attempt++){
    try{health=JSON.parse(await this.http('GET','/health',undefined,2000));break;}
    catch(error){
     if(attempt>=50||!this.child)throw Error(stderr.trim()||(error instanceof Error?error.message:String(error)));
     await new Promise(resolve=>nodeTimeout(resolve,150));
    }
   }
   this.health=parseSiriHealth(health);
   this.models=SIRI_MODELS;
   if(!this.health.pcc.available&&!this.health.system.available)throw Error(this.health.pcc.reason||this.health.system.reason||'Apple Foundation Models are unavailable.');
   this.setStatus(this.health.pcc.available
    ?'Connected to Siri AI · Private Cloud Compute'
    :'Connected to Siri AI · on-device model only. Private Cloud Compute: '+this.health.pcc.reason);
  }catch(error){
   this.disconnect(friendlySiriError(error));
   throw Error(friendlySiriError(error));
  }
 }
 private http(method:'GET'|'POST',path:string,body?:unknown,timeout=120_000,onData?:(chunk:string)=>void,signal?:AbortSignal):Promise<string>{
  return new Promise((resolve,reject)=>{
   if(!this.socket){reject(Error('Siri AI is not running.'));return;}
   const payload=body===undefined?undefined:JSON.stringify(body);
   const req=request({socketPath:this.socket,path,method,headers:payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{},timeout},res=>{
    let text='';
    res.setEncoding('utf8');
    res.on('data',(chunk:string)=>{
     if((res.statusCode??500)<400&&onData){try{onData(chunk);}catch(error){req.destroy(error as Error);}}
     else text=(text+chunk).slice(-1_000_000);
    });
    res.on('end',()=>{
     if((res.statusCode??500)>=400){
      const message=record(record((()=>{try{return JSON.parse(text) as unknown;}catch{return {};}})()).error).message;
      reject(Error(typeof message==='string'?message:'Siri AI returned HTTP '+String(res.statusCode)+'.'));
     }else resolve(text);
    });
    res.on('error',reject);
   });
   req.on('timeout',()=>req.destroy(Error('Siri AI did not answer in time.')));
   req.on('error',reject);
   const abort=()=>req.destroy(signal?.reason instanceof Error?signal.reason:Error('Stopped.'));
   if(signal){if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});req.on('close',()=>signal.removeEventListener('abort',abort));}
   req.end(payload);
  });
 }
 async run(options:ProviderRunOptions):Promise<ProviderRunResult>{
  const model=this.resolveModel(options.model);
  if(!model)throw Error('Siri AI: no Apple Foundation Model is available.');
  const messages:{role:string;content?:unknown;[key:string]:unknown}[]=[{role:'system',content:options.instructions},{role:'user',content:options.text}];
  if(options.images.length)options.onActivity('Siri AI does not read images; the attached images were not sent.');
  const offered=chatTools(options.tools,model.id);
  const tools=offered.length?offered:undefined;
  let answer='';
  try{
   for(let round=0;round<=MAX_TOOL_ROUNDS;round++){
    const reader=new ChatStreamReader(delta=>{answer+=delta;options.onText(delta);});
    await this.http('POST','/v1/chat/completions',{model:model.id,stream:true,messages,...(tools?{tools}:{})},600_000,chunk=>reader.push(chunk),options.signal);
    reader.push('\n');
    const calls=[...reader.calls.values()].filter(call=>call.name);
    if(!calls.length)break;
    if(round===MAX_TOOL_ROUNDS)throw Error('Siri AI made too many tool calls in one reply.');
    messages.push({role:'assistant',content:reader.text||null,tool_calls:calls.map((call,index)=>({id:call.id||'call_'+round+'_'+index,type:'function',function:{name:call.name,arguments:call.arguments||'{}'}}))});
    for(const [index,call] of calls.entries()){
     let args:unknown={};
     try{args=call.arguments?JSON.parse(call.arguments):{};}catch{args={};}
     // A refused call (bad arguments, a repeat, a missing heading) goes back to
     // the model as the tool's answer so it can correct itself, as with the
     // other providers; only a stop ends the reply.
     let content:string;
     try{const output=await options.tool(call.name,args);content=typeof output==='string'?output:output.text;}
     catch(error){
      if(options.signal.aborted||(error instanceof Error&&error.message==='Stopped.'))throw error;
      content='Error: '+(error instanceof Error?error.message:String(error));
     }
     messages.push({role:'tool',tool_call_id:call.id||'call_'+round+'_'+index,content});
    }
    compactTranscript(messages,model.id);
   }
  }catch(error){
   const limit=siriExhaustion(error);
   if(limit)this.exhaustion=limit;
   throw Error(friendlySiriError(error));
  }
  this.exhaustion=null;
  if(model.id==='pcc')void this.readUsage(5000).catch(()=>undefined);
  return {text:answer,sources:[]};
 }
 async signIn():Promise<void>{/* Siri AI uses the Mac's Apple Account. */}
 async readUsage(timeout=10_000):Promise<UsageSnapshot|null>{
  if(!siriSupported())return null;
  if(this.running&&!this.health.pcc.available){
   this.usage=null;
   this.usageError='Private Cloud Compute is unavailable here, so there is no quota to show. '+this.health.pcc.reason;
   this.usageUpdatedAt=Date.now();
   this.onUsage();
   return null;
  }
  try{
   const output=await runCli(FM_EXECUTABLE,['quota-usage','--model','pcc'],{env:{...sanitizedEnv(process.env),NO_COLOR:'1'},timeout,maxBuffer:100_000});
   this.usage=parseSiriQuota(output);
   this.usageError=this.usage?'':'Apple did not report a Private Cloud Compute quota for this context.';
   const used=this.usage?.rateLimitsByLimitId?.siri?.primary;
   this.exhaustion=used&&used.usedPercent>=100?{provider:'siri',exhausted:true,resetsAt:used.resetsAt??null,reason:'Siri AI usage limit reached.',scope:'provider'}:this.exhaustion;
  }catch(error){this.usageError=friendlySiriError(error);}
  this.usageUpdatedAt=Date.now();
  this.onUsage();
  return this.usage;
 }
 disconnect(status='Disconnected'):void{
  clearNodeTimeout(this.restTimer);
  const child=this.child,socket=this.socket;
  this.child=null;this.socket='';this.models=[];
  if(child)terminateProcessTree(child,'SIGTERM');
  if(socket)rmSync(socket,{force:true});
  this.setStatus(status);
 }
}
