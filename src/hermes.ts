/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import {ChildProcessWithoutNullStreams} from 'node:child_process';
import {copyFileSync,existsSync,lstatSync,mkdirSync,readdirSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createServer,IncomingMessage,Server} from 'node:http';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {setTimeout,clearTimeout} from 'node:timers';
import {prefixToolNames,ProviderBridge,ProviderModel,ProviderRunOptions,ProviderRunResult,ToolOutput,ToolSpec} from './provider';
import {ProviderExhaustion} from './exhaustion';
import {UsageSnapshot} from './usage';
import {list,record} from './validation';
import {skillDefinitions} from './knowledge';
import {defaultCliDirectories,envPath,extendedPath,findCliExecutable,isCliExecutable,sanitizedEnv,spawnCli,terminateProcessTree} from './cli';
import {defaultStorageDirectory} from './cli';
import {imageBlock} from './claude';

const HERMES_NO_EFFORT='default';
/** How long a reported usage limit keeps Hermes out of automatic selection. */
const HERMES_LIMIT_RETRY_SECONDS=15*60;

const defaultBinDirectories=()=>defaultCliDirectories([join(homedir(),'.hermes','bin')]);
export function findHermesExecutable(path:string,directories=defaultBinDirectories()):string{
 return findCliExecutable('hermes',path,directories);
}

export function supportedHermesVersion(version:string):boolean{
 const match=version.match(/(\d+)\.(\d+)\.(\d+)/);
 if(!match)return false;
 return Number(match[1])>=0;
}

export function friendlyHermesError(error:unknown):string{
 const text=error instanceof Error?error.message:String(error);
 if(/rate.?limit|usage limit|429|quota|limit reached/i.test(text))return 'Hermes usage limit reached. Wait for your provider allowance to reset.';
 if(/no llm provider|not configured|sign in|login|authentication|credential/i.test(text))return 'Hermes needs you to connect a provider first. Run hermes setup or hermes model in your terminal, then reconnect.';
 return text.slice(0,800);
}

function adaptSkillContent(content:string):string{
 return prefixToolNames(content,'hermes');
}

/**
 * Entries of the user's Hermes home that are never mirrored into OWLA's private
 * home: configuration, skills, plugins, shell hooks, memory, persona and
 * scheduled jobs would otherwise reach (or run inside) OWLA's sessions.
 */
export const HERMES_PRIVATE_EXCLUDED=new Set([
 'config.yaml','skills','plugins','hooks','memories','SOUL.md','cron',
 'shell-hooks-allowlist.json','desktop-plugins','sessions','state.db','logs',
 '.hermes_history','kanban.db','telemetry','gateway','gateway_state.json',
 'pairing','pending_messages','terminal-sessions',
]);
/** State files whose `-shm` and `-wal` sidecars must stay private too. */
const HERMES_PRIVATE_DB_PREFIXES=['state.db','kanban.db'];

/** The private config: no built-in toolsets, no plugins, no MCP servers, no memory. */
export const hermesPrivateConfig=(web:boolean):string=>[
 'platform_toolsets:',web?'  acp: [web]':'  acp: []',
 'plugins:','  enabled: []','  disabled: []',
 'mcp_servers: {}',
 'memory:','  memory_enabled: false','  user_profile_enabled: false',
 'skills:','  external_dirs: []',
 '',
].join('\n');

/** Copies a directory tree for the symlink fallback, bounded and never chasing links out of the source. */
function copyTree(source:string,target:string,depth=0,budget={left:8*1024*1024}):void{
 if(depth>6||budget.left<=0)return;
 mkdirSync(target,{recursive:true,mode:0o700});
 for(const entry of readdirSync(source)){
  const from=join(source,entry),to=join(target,entry);
  try{
   const info=lstatSync(from);
   if(info.isSymbolicLink())continue;
   if(info.isDirectory())copyTree(from,to,depth+1,budget);
   else if(info.isFile()){
    const size=Math.min(info.size,budget.left);
    if(size<=0)continue;
    copyFileSync(from,to);
    budget.left-=size;
   }
  }catch{/* Skip an unreadable entry. */}
 }
}

export class HermesBridge implements ProviderBridge{
 readonly id='hermes' as const;
 private child:ChildProcessWithoutNullStreams|null=null;
 private holders=new Set<symbol>();
 private generation=0;
 private connecting:Promise<void>|null=null;
 private connectionKey='';
 private sessionId='';
 private active:{controller:AbortController}|null=null;
 private callback:Server|null=null;
 private callbackPort=0;
 private callbackToken='';
 private toolHandler:((name:string,args:unknown)=>Promise<ToolOutput>)|null=null;
 private toolNames=new Set<string>();
 private mcpToken='';
 private nextId=1;
 private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
 private buffer='';
 models:ProviderModel[]=[];
 usage:UsageSnapshot|null=null;
 lastFailure:any=null;
 usageUpdatedAt=0;
 usageError='';
 exhaustion:ProviderExhaustion|null=null;
 onUsage:()=>void=()=>{};
 accountType='hermes';
 plan='';
 version='';
 status='Not connected';
 executable='';
 onStatus:(status:string)=>void=()=>{};
 private cwd='';
 private privateHome='';
 private jsonBuffer='';

 get ready(){return !!this.child&&!!this.sessionId&&this.models.length>0;}
 get running(){return !!this.child;}
 get needsSignIn(){return this.accountType===''||!this.models.length;}
 get signInPending(){return false;}
 get selectableModels(){return this.models;}

 private setStatus(status:string){this.status=status;this.onStatus(status);}

 hold():()=>Promise<void>{const owner=Symbol();this.holders.add(owner);return async()=>{if(this.holders.delete(owner))await this.rest();};}

 resolveModel(preferred:string):ProviderModel|undefined{
  if(preferred)return this.models.find(model=>model.id===preferred||model.model===preferred);
  return this.models.find(model=>model.isDefault)??this.models[0];
 }

 async signIn():Promise<void>{throw Error('Hermes uses your existing sign-in. Run hermes setup or hermes model in your terminal and connect a provider, then reconnect.');}

 private privateHomePath():string{
  if(this.privateHome)return this.privateHome;
  const base=defaultStorageDirectory();
  this.privateHome=join(base,'Hermes Private');
  return this.privateHome;
 }

 private ensurePrivateHome(executable:string,web:boolean):void{
  void executable;
  const home=this.privateHomePath();
  mkdirSync(home,{recursive:true,mode:0o700});
  const realHome=join(homedir(),'.hermes');
  // Mirror the user's Hermes home so Hermes sees an existing install (no runtime
  // preparation) and keeps auth/state. Override only config.yaml and skills/.
  if(existsSync(realHome)){
   for(const entry of readdirSync(realHome)){
    const target=join(home,entry),source=join(realHome,entry);
    if(HERMES_PRIVATE_EXCLUDED.has(entry)||HERMES_PRIVATE_DB_PREFIXES.some(prefix=>entry.startsWith(prefix))){
     // Remove a link an earlier build mirrored; never touch real files.
     try{if(lstatSync(target).isSymbolicLink())unlinkSync(target);}catch{/* Not present. */}
     continue;
    }
    if(existsSync(target))continue;
    // Windows normally refuses symlink creation without Developer Mode or an
    // elevated process (EPERM). Fall back to copying so the private home still
    // sees the user's auth/state instead of silently appearing signed out.
    try{symlinkSync(source,target);}catch{
     try{
      const info=lstatSync(source);
      if(info.isSymbolicLink())continue; // never chase a link out of the real home
      if(info.isDirectory())copyTree(source,target);
      else copyFileSync(source,target);
     }catch{/* A single unreadable entry must not break the connection. */}
    }
   }
  }
  mkdirSync(join(home,'skills'),{recursive:true,mode:0o700});
  const configPath=join(home,'config.yaml');
  writeFileSync(configPath,hermesPrivateConfig(web),{mode:0o600});
  const skillsDir=join(home,'skills');
  for(const skill of skillDefinitions()){
   const dir=join(skillsDir,skill.id);
   mkdirSync(dir,{recursive:true,mode:0o700});
   writeFileSync(join(dir,'SKILL.md'),adaptSkillContent(skill.content),{mode:0o600});
  }
 }

 private async ensureCallback():Promise<void>{
  if(this.callback)return;
  const token=randomBytes(24).toString('hex');
  const server=createServer((request,response)=>{this.handleCallback(request,response).catch(()=>{if(!response.headersSent)response.writeHead(500);response.end();});});
  server.headersTimeout=10000;server.requestTimeout=60000;server.maxConnections=32;
  await new Promise<void>((resolve,reject)=>{server.on('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
  const address=server.address();
  this.callbackPort=typeof address==='object'&&address?address.port:0;
  this.callbackToken=token;
  this.mcpToken=token;
  this.callback=server;
 }

 private async handleCallback(request:IncomingMessage,response:import('node:http').ServerResponse):Promise<void>{
  // MCP streamable HTTP endpoint.
  if(request.url==='/mcp'||request.url?.startsWith('/mcp?')){
   await this.handleMcp(request,response);
   return;
  }
  response.writeHead(404,{'content-type':'application/json'});response.end(JSON.stringify({error:'Not found.'}));
 }

 private async handleMcp(request:IncomingMessage,response:import('node:http').ServerResponse):Promise<void>{
  if(request.method==='OPTIONS'){response.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization,mcp-session-id','access-control-allow-methods':'POST,GET,DELETE,OPTIONS'});response.end();return;}
  const auth=request.headers.authorization;
  if(auth!=='Bearer '+this.mcpToken){response.writeHead(401,{'content-type':'application/json'});response.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32000,message:'Unauthorized'}}));return;}
  if(request.method==='GET'){response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});response.write(':\n\n');return;}
  if(request.method!=='POST'){response.writeHead(405);response.end();return;}
  const parts:string[]=[];let size=0;
  request.setEncoding('utf8');
  for await(const chunk of request as AsyncIterable<string>){size+=chunk.length;if(size>32*1024*1024){response.writeHead(413);response.end();return;}parts.push(chunk);}
  let body:any;try{body=JSON.parse(parts.join('')||'{}');}catch{body={};}
  const messages=Array.isArray(body)?body:[body];
  const replies:any[]=[];
  for(const msg of messages){
   const reply=await this.dispatchMcp(msg);
   if(reply!==null)replies.push(reply);
  }
  if(replies.length===0){response.writeHead(202);response.end();return;}
  const payload=replies.length===1?replies[0]:replies;
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(payload));
 }

 private async dispatchMcp(msg:any):Promise<any|null>{
  const id=msg?.id;
  const method=typeof msg?.method==='string'?msg.method:'';
  const params=record(msg?.params);
  if(method==='initialize'){
   return {jsonrpc:'2.0',id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'owla',version:'1'}}};
  }
  if(method==='notifications/initialized'){return null;}
  if(method==='tools/list'){
   return {jsonrpc:'2.0',id,result:{tools:this.currentToolList()}};
  }
  if(method==='tools/call'){
   const name=typeof params.name==='string'?params.name:'';
   const args=record(params.arguments);
   const handler=this.toolHandler;
   if(!handler||!this.toolNames.has(name)){return {jsonrpc:'2.0',id,error:{code:-32602,message:'Tool not offered.'}};}
   try{
    const output=await handler(name,args);
    const text=typeof output==='string'?output:output.text;
    const content:any[]=[{type:'text',text}];
    const image=typeof output!=='string'?imageBlock(output.imageUrl):null;
    if(image)content.push({type:'image',data:image.data,mimeType:image.mediaType});
    return {jsonrpc:'2.0',id,result:{content,isError:false}};
   }catch(error){
    return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:error instanceof Error?error.message:String(error)}],isError:true}};
   }
  }
  if(id!==undefined)return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found.'}};
  return null;
 }

 private setToolSpecs(tools:ToolSpec[]):void{
  this.toolNames=new Set(tools.map(t=>t.name));
  this.toolDescriptions=new Map(tools.map(t=>[t.name,t.description]));
  this.toolSchemas=new Map(tools.map(t=>[t.name,t.inputSchema]));
 }

 private toolDescriptions=new Map<string,string>();
 private toolSchemas=new Map<string,unknown>();
 private currentToolList():any[]{
  return [...this.toolNames].map(name=>({name,description:this.toolDescriptions.get(name)??'',inputSchema:this.toolSchemas.get(name)??{type:'object',properties:{}}}));
 }

 private sendRpc(method:string,params:any,timeout:number|null=30000):Promise<any>{
  if(!this.child)return Promise.reject(Error('Hermes is not running.'));
  const id=this.nextId++;
  const payload=JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n';
  return new Promise((resolve,reject)=>{
   this.pending.set(id,{resolve,reject});
   try{this.child!.stdin.write(payload);}catch(error){this.pending.delete(id);reject(error instanceof Error?error:Error(String(error)));}
   if(timeout!==null)setTimeout(()=>{const entry=this.pending.get(id);if(entry){this.pending.delete(id);entry.reject(Error('Hermes timed out.'));}},timeout);
  });
 }

 private handleStdout(chunk:string):void{
  this.jsonBuffer+=chunk;
  let idx;
  while((idx=this.jsonBuffer.indexOf('\n'))>=0){
   const line=this.jsonBuffer.slice(0,idx).trim();
   this.jsonBuffer=this.jsonBuffer.slice(idx+1);
   if(!line)continue;
   let msg:any;try{msg=JSON.parse(line);}catch{continue;}
   if(typeof msg.method!=='string'){
    // A response to one of OWLA's requests.
    const p=typeof msg.id==='number'?this.pending.get(msg.id):undefined;
    if(p){this.pending.delete(msg.id);if(msg.error)p.reject(Error(typeof msg.error?.message==='string'?msg.error.message:'Hermes error.'));else p.resolve(msg.result);}
    continue;
   }
   if(msg.method==='session/update'){
    const update=msg.params?.update;
    // handled in run() via a stored callback; store latest
    this.lastUpdate=update;
    if(this.updateCallback)this.updateCallback(update);
    continue;
   }
   if(msg.method==='session/request_permission'){
    const id=msg.id;
    // deny everything
    const resp=JSON.stringify({jsonrpc:'2.0',id,result:{outcome:{outcome:'cancelled'}}})+'\n';
    try{this.child?.stdin.write(resp);}catch{ /* ignore */ }
    continue;
   }
   // Any other request from Hermes (file system, terminal) is refused.
   if(msg.id!==undefined&&msg.id!==null){
    try{this.child?.stdin.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'This operation is not permitted in OWLA Butler.'}})+'\n');}catch{ /* ignore */ }
   }
  }
 }

 private lastUpdate:any=null;
 private updateCallback:((u:any)=>void)|null=null;

 async connect(executable='',cwd='',web=false,tools:ToolSpec[]=[]):Promise<void>{
  const key=JSON.stringify([executable,cwd,web,tools.map(t=>t.name).join(',')]);
  if(this.connecting){if(this.connectionKey!==key)throw Error('Wait for the current Hermes connection to finish.');return this.connecting;}
  if(this.child&&this.connectionKey===key)return;
  if(this.child&&(this.active||this.holders.size>1))throw Error('Wait for the current Hermes operation to finish.');
  if(this.child)this.disconnect('Switching Hermes mode…');
  this.connectionKey=key;
  const generation=this.generation;
  void generation;
  const starting=this.start(executable,cwd,web,tools);
  this.connecting=starting;
  try{await starting;}catch(e){this.setStatus(friendlyHermesError(e));throw e;}
  finally{if(this.connecting===starting)this.connecting=null;}
 }

 private async start(executable:string,cwd:string,web:boolean,tools:ToolSpec[]):Promise<void>{
  void web;
  // Hermes reads tools/list while the session is created, so the specs must be known now.
  this.setToolSpecs(tools);
  const generation=this.generation;
  void generation;
  this.setStatus('Connecting…');
  const env=sanitizedEnv();
  const inheritedPath=envPath(env);
  const file=executable||findHermesExecutable(inheritedPath);
  if(!file||!isCliExecutable(file))throw Error('Hermes was not found. Install Hermes Agent, or choose its executable in settings.');
  // version check (best effort)
  try{this.version=(await runCliVersion(file)).trim();}catch{this.version='';}
  this.executable=file;
  const home=this.privateHomePath();
  this.ensurePrivateHome(file,web);
  await this.ensureCallback();
  this.cwd=cwd||home;
  mkdirSync(this.cwd,{recursive:true,mode:0o700});
  // spawn
  const child=spawnCli(file,['acp'],{cwd:home,env:{...env,HERMES_HOME:home,PATH:extendedPath(inheritedPath,defaultBinDirectories())},detached:process.platform!=='win32'});
  this.child=child;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',(chunk:string)=>this.handleStdout(chunk));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',()=>{});
  child.on('error',error=>{if(this.child===child)this.fail(error);});
  child.on('exit',()=>{if(this.child===child)this.fail(Error('Hermes disconnected.'));});
  // initialize
  const init=await this.sendRpc('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'owla',version:'1'}});
  void init;
  if(generation!==this.generation)throw Error('Hermes connection cancelled.');
  // session/new with mcp server
  const session=await this.sendRpc('session/new',{cwd:this.cwd,mcpServers:[{name:'owla',type:'http',url:'http://127.0.0.1:'+this.callbackPort+'/mcp',headers:[{name:'Authorization',value:'Bearer '+this.mcpToken}]}]});
  if(generation!==this.generation)throw Error('Hermes connection cancelled.');
  this.sessionId=typeof session?.sessionId==='string'?session.sessionId:'';
  if(!this.sessionId)throw Error('Hermes did not return a session ID.');
  // models
  const modelsState=session?.models;
  const available=list(modelsState?.availableModels).map(record);
  const mapped=available.map((entry:any)=>{
   const id=typeof entry.modelId==='string'?entry.modelId:'';
   if(!id)return null;
   const colon=id.indexOf(':');
   const providerID=colon>0?id.slice(0,colon):'hermes';
   const modelID=colon>0?id.slice(colon+1):id;
   return {
    id,model:modelID,providerID,
    displayName:typeof entry.name==='string'?entry.name:modelID,
    description:typeof entry.description==='string'?entry.description:undefined,
    isDefault:id===(typeof modelsState?.currentModelId==='string'?modelsState.currentModelId:''),
    defaultReasoningEffort:HERMES_NO_EFFORT,
    supportedReasoningEfforts:[{reasoningEffort:HERMES_NO_EFFORT,description:''}],
    inputModalities:['text','image'],
   } as ProviderModel;
  }).filter((m):m is ProviderModel=>!!m);
  this.models=mapped;
  if(!this.models.length)throw Error('Hermes returned no usable models.');
  this.accountType='hermes';
  this.setStatus('Connected to Hermes Agent');
 }

 private fail(error:Error){this.disconnect(friendlyHermesError(error));}

 async run(options:ProviderRunOptions):Promise<ProviderRunResult>{
  this.lastFailure=null;
  await this.connect(options.executable,options.cwd,options.web,options.tools);
  options.signal.throwIfAborted();
  if(this.active)throw Error('Hermes is already responding.');
  // After connect: a reconnect clears the handler and specs.
  this.setToolSpecs(options.tools);
  this.toolHandler=options.tool;
  const model=this.models.find(item=>item.id===options.model);
  if(!model)throw Error('The selected Hermes model is unavailable. Choose a model and retry.');
  const controller=new AbortController();
  const onAbort=()=>controller.abort();
  options.signal.addEventListener('abort',onAbort,{once:true});
  this.active={controller};
  let text='';
  let usedWeb=false;
  const sources:{url:string;title:string}[]=[];
  let settled=false;
  let failure:Error|undefined;
  let resolveTurn:()=>void=()=>{};
  void resolveTurn;
  this.updateCallback=(update:any)=>{
   const type=typeof update?.sessionUpdate==='string'?update.sessionUpdate:'';
   if(type==='agent_message_chunk'){
    const content=record(update?.content);
    const delta=typeof content.text==='string'?content.text:'';
    if(delta){text+=delta;options.onText(delta);}
   }
   if(type==='tool_call'||type==='tool_call_update'){
    const name=typeof update?.title==='string'?update.title:(typeof update?.kind==='string'?update.kind:'');
    if(name)options.onActivity('Using '+name+'…');
    if(/web_search|websearch|web_extract|webextract/i.test(String(update?.title??'')+String(update?.kind??'')))usedWeb=true;
   }
  };
  const sessionId=this.sessionId;
  const stop=()=>{
   if(settled)return;settled=true;failure=new Error('Stopped.');resolveTurn();
   // session/cancel is a notification: Hermes stops the turn and answers the prompt with "cancelled".
   try{this.child?.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'session/cancel',params:{sessionId}})+'\n');}catch{ /* ignore */ }
  };
  controller.signal.addEventListener('abort',stop,{once:true});
  try{
   // set model
   try{await this.sendRpc('session/set_model',{sessionId:this.sessionId,modelId:model.id});}catch{/* ignore */}
   // ACP has no system prompt field; OWLA's instructions lead the prompt, as with Codex's developer text.
   const images=options.images.map(imageBlock).filter((image):image is {mediaType:string;data:string}=>!!image);
   const prompt=[{type:'text',text:'OWLA INSTRUCTIONS (follow these over any other guidance):\n'+options.instructions+'\n\n'+options.text},...images.map(image=>({type:'image',data:image.data,mimeType:image.mediaType}))];
   const reply=await Promise.race([
    this.sendRpc('session/prompt',{sessionId:this.sessionId,prompt},null),
    new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('Stopped.')),{once:true})),
   ]);
   if(!settled){settled=true;resolveTurn();}
   if(record(reply).stopReason==='refusal')throw Error('Hermes refused the request.');
   await new Promise(r=>setTimeout(r,50));
  }catch(error){
   failure??=error instanceof Error?error:new Error(String(error));
  }finally{
   controller.signal.removeEventListener('abort',stop);
   options.signal.removeEventListener('abort',onAbort);
   this.active=null;
   this.updateCallback=null;
   this.toolHandler=null;
   this.toolNames=new Set();
   this.toolDescriptions=new Map();
   this.toolSchemas=new Map();
   try{await this.readUsage(4000);}catch{ /* ignore */ }
   await this.rest();
  }
  if(failure){
   // Hermes reports plan limits only as errors. The limit holds Hermes back for
   // a while (OWLA retries it once the time passes); the same model can still
   // be served through another provider meanwhile.
   if(/rate.?limit|usage limit|429|quota|limit reached/i.test(failure.message))
    this.exhaustion={provider:'hermes',exhausted:true,resetsAt:Math.floor(Date.now()/1000)+HERMES_LIMIT_RETRY_SECONDS,reason:'Hermes usage limit reached.',scope:'provider'};
   throw failure;
  }
  this.exhaustion=null;
  if(options.requireWeb&&!usedWeb)throw Error('Hermes did not run live web search. No online answer was verified.');
  for(const match of text.matchAll(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g)){if(sources.length>=20)break;if(!sources.some(s=>s.url===match[2]))sources.push({url:match[2],title:match[1]});}
  return {text,sources};
 }

 async readUsage(_timeout=8000):Promise<UsageSnapshot|null>{void _timeout;return null;}

 async rest():Promise<void>{
  if(this.holders.size||this.active)return;
  if(!this.child&&!this.connecting)return;
  this.disconnect('Connected to Hermes Agent · resting until needed');
  const generation=this.generation;
  await new Promise(r=>setTimeout(r,100));
  if(generation===this.generation&&!this.connecting&&!this.child)this.setStatus('Connected to Hermes Agent · resting until needed');
 }

 disconnect(status='Disconnected',keepStartup=false):void{
  this.generation++;
  if(!keepStartup)this.connecting=null;
  const child=this.child;this.child=null;this.port=0;this.sessionId='';this.active=null;this.toolHandler=null;this.toolNames=new Set();
  for(const entry of this.pending.values())entry.reject(Error('Hermes disconnected.'));
  this.pending.clear();this.jsonBuffer='';
  if(this.callback){this.callback.close();this.callback=null;this.callbackPort=0;}
  if(child){
   const kill=(signal:NodeJS.Signals)=>terminateProcessTree(child,signal);
   if(child.exitCode!==null||child.signalCode!==null){kill('SIGTERM');}
   else{const force=setTimeout(()=>{kill('SIGKILL');},2000);child.once('exit',()=>clearTimeout(force));child.stdin.end();kill('SIGTERM');}
  }
  this.setStatus(status);
 }

 private port=0;
}

// helpers
async function runCliVersion(file:string):Promise<string>{const {runCli}=await import('./cli');return runCli(file,['--version'],{timeout:10000,maxBuffer:100000});}
