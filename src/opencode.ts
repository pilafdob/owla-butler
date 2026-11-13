import {ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer,IncomingMessage,Server,request as httpRequest} from 'node:http';
import {createServer as createSocketServer} from 'node:net';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {setTimeout,clearTimeout} from 'node:timers';
import {prefixToolNames,ProviderBridge,ProviderModel,ProviderRunOptions,ProviderRunResult,ToolOutput,ToolSpec} from './provider';
import {opencodeExhaustion,ProviderExhaustion} from './exhaustion';
import {UsageSnapshot,decodeOpencodeUsage} from './usage';
import {list,record} from './validation';
import {skillDefinitions} from './knowledge';
import {OPENCODE_PLUGIN_SOURCE} from './opencode-plugin';
import {defaultCliDirectories,defaultStorageDirectory,findCliExecutable,isCliExecutable,runCli,sanitizedEnv,spawnCli,terminateProcessTree} from './cli';
import {RecordSplitter} from './stream';

export const OPENCODE_TOOL_NAMESPACE='owla_';

/**
 * The environment for OWLA's own OpenCode server. OpenCode merges the user's
 * global configuration into every session, and a global plugin could add
 * tools that OWLA's plugin does not know about (verified with OpenCode 2.2.7:
 * a plugin under the global config directory loaded inside OWLA's session).
 * OWLA therefore points the config home at a private folder, as Claude Code
 * runs in safe mode and Codex runs without inherited plugins. Sign-ins live in
 * OpenCode's data folder and keep working.
 *
 * OpenCode also walks from the working directory up to the filesystem root and
 * loads every `opencode.json`, `.opencode/opencode.json` and
 * `.opencode/plugins/*.ts` it passes, including ones in the home folder
 * (verified with OpenCode 2.3.0: a plugin in an ancestor `.opencode/plugins`
 * ran inside OWLA's session). That project discovery is switched off, and
 * OWLA's own configuration lives in the private global config folder instead
 * (see `opencodeConfigPath`), which every supported version reads.
 *
 * Provider API keys stay, because OpenCode reads them from the environment by
 * design; only variables that change how the process executes are dropped.
 */
export function isolatedOpencodeEnv(env:NodeJS.ProcessEnv,directory:string):NodeJS.ProcessEnv{
 const result:NodeJS.ProcessEnv={...sanitizedEnv(env,{keepCredentials:true}),
  XDG_CONFIG_HOME:join(directory,'config'),
  OPENCODE_DISABLE_PROJECT_CONFIG:'1',
  OPENCODE_CONFIG_PROJECT_DISABLE:'1',
  // OpenCode otherwise reads Claude Code's skills and instructions from the home folder.
  OPENCODE_DISABLE_CLAUDE_CODE:'1',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS:'1',
  OPENCODE_DISABLE_AUTOUPDATE:'1',
 };
 for(const key of ['OPENCODE_CONFIG','OPENCODE_CONFIG_DIR','OPENCODE_CONFIG_CONTENT','OPENCODE_CLI_CONFIG_CONTENT','OPENCODE_PERMISSION'])delete result[key];
 return result;
}

/** OWLA's OpenCode configuration: the global config file of the private config home. */
export function opencodeConfigPath(directory:string):string{
 return join(directory,'config','opencode','opencode.json');
}

/** The bundled skills are registered under these IDs with OpenCode. */
export const OPENCODE_SKILL_IDS=skillDefinitions().map(skill=>skill.id);

// `~/.cache/opencode/bin` is the Linux installer's location; on Windows the
// per-user install folders in defaultCliDirectories cover it.
const defaultBinDirectories=()=>defaultCliDirectories(process.platform==='win32'?[]:[join(homedir(),'.cache','opencode','bin')]);
export function findOpencodeExecutable(path:string,directories=defaultBinDirectories()):string{
 return findCliExecutable('opencode',path,directories);
}
export function supportedOpencodeVersion(version:string):boolean{
 const match=version.match(/(\d+)\.(\d+)\.(\d+)/);
 if(!match)return false;
 const major=Number(match[1]),minor=Number(match[2]);
 if(major!==2)return false;
 return minor>2||(minor===2&&Number(match[3])>=0);
}/**
 * OpenCode refuses a model whose hosting region the workspace's privacy
 * settings do not allow, for example an OpenCode Go model hosted outside
 * Europe and the United States while only those regions are selected. The
 * user may not want to widen that setting, so OWLA remembers the model as
 * unusable and stops offering it instead of repeating the notice.
 */
export function opencodeRegionRestricted(error:unknown):boolean{
 const text=error instanceof Error?error.message:String(error);
 return /hosted outside/i.test(text);
}
export function friendlyOpencodeError(error:unknown):string{
 const text=error instanceof Error?error.message:String(error);
 if(/free-limit|Free usage limit/i.test(text))return 'OpenCode’s free models reached their shared usage limit. Wait for the reported reset time.';
 if(/429|quota|rate.limit/i.test(text))return 'OpenCode usage limit reached. Wait for the reported reset time.';
 if(/401|unauthorized|authentication|credential/i.test(text))return 'OpenCode needs you to sign in again. Check your OpenCode account.';
 if(opencodeRegionRestricted(text))
  return 'OpenCode hosts this model outside Europe and the United States, and your workspace’s privacy regions setting does not allow it. Choose another model, or select Global in the OpenCode console under Settings → Privacy → Regions.';
 return text.slice(0,800);
}

/** The skill text names OWLA tools; OpenCode exposes them under a namespace. */
export function adaptSkillContent(content:string):string{
 // One tool list for every provider, so a new OWLA tool is renamed everywhere.
 return prefixToolNames(content,'opencode');
}

export function decodeOpencodeModel(value:unknown):ProviderModel|null{
 const data=record(value);
 const providerID=typeof data.providerID==='string'?data.providerID:'';
 const modelID=typeof data.modelID==='string'?data.modelID:(typeof data.id==='string'?data.id:'');
 if(!providerID||!modelID)return null;
 if(data.enabled===false)return null;
 if(typeof data.type==='string'&&data.type!=='chat')return null;
 const efforts=list(data.variants).map(item=>record(item)).filter(item=>typeof item.id==='string')
  .map(item=>({reasoningEffort:item.id as string,description:''}));
 const supported=efforts.length?efforts:[{reasoningEffort:'default',description:''}];
 const capabilities=record(data.capabilities);
 const cost=list(data.cost)[0];
 const limit=record(data.limit);
 return {
  id:providerID+'/'+modelID,
  model:modelID,
  providerID,
  displayName:typeof data.name==='string'?data.name:modelID,
  description:typeof data.description==='string'?data.description:undefined,
  isDefault:false,
  defaultReasoningEffort:supported[0].reasoningEffort,
  supportedReasoningEfforts:supported,
  inputModalities:Array.isArray(capabilities.input)?capabilities.input.filter((item):item is string=>typeof item==='string'):undefined,
  cost:typeof record(cost).input==='number'?{input:Number(record(cost).input),output:typeof record(cost).output==='number'?Number(record(cost).output):0}:undefined,
  context:typeof limit.context==='number'?limit.context:undefined
 };
}

/**
 * The permission ruleset that keeps OpenCode inside OWLA's own tools. Each
 * OWLA tool is allowed by its exact name: a namespace wildcard would also allow
 * any other plugin or MCP server that registers a tool under `owla_`.
 */
export function opencodePermissions(web:boolean,tools:readonly string[]):{action:string;resource:string;effect:string}[]{
 return [
  {action:'*',resource:'*',effect:'deny'},
  ...[...new Set(tools)].map(name=>({action:OPENCODE_TOOL_NAMESPACE+name,resource:'*',effect:'allow'})),
  ...OPENCODE_SKILL_IDS.map(id=>({action:'skill',resource:id,effect:'allow'})),
  ...(web?[{action:'websearch',resource:'*',effect:'allow'}]:[])
 ];
}

type Reply={status:number;body:string};
/** OpenCode replies and events are bounded, so a faulty server cannot grow Obsidian without limit. */
const MAX_OPENCODE_BYTES=32*1024*1024;
/** Compares a presented secret without leaking its length or prefix through timing. */
function sameSecret(presented:string|undefined,expected:string):boolean{
 const left=Buffer.from(presented??'','utf8'),right=Buffer.from(expected,'utf8');
 return left.length===right.length&&timingSafeEqual(left,right);
}
function authorization(password:string){return 'Basic '+Buffer.from('opencode:'+password,'utf8').toString('base64');}
function call(options:{port:number;path:string;method?:string;password:string;body?:string;timeout?:number;signal?:AbortSignal}):Promise<Reply>{
 return new Promise((resolve,reject)=>{
  const request=httpRequest({
   host:'127.0.0.1',
   port:options.port,
   path:options.path,
   method:options.method??'GET',
   headers:{authorization:authorization(options.password),'content-type':'application/json',accept:'application/json'},
   signal:options.signal
  },response=>{
   const parts:string[]=[];let size=0;
   response.setEncoding('utf8');
   response.on('data',(chunk:string)=>{size+=chunk.length;if(size>MAX_OPENCODE_BYTES){request.destroy(new Error('OpenCode sent a reply that was too large.'));return;}parts.push(chunk);});
   response.on('end',()=>resolve({status:response.statusCode??0,body:parts.join('')}));
   response.on('error',reject);
  });
  request.setTimeout(options.timeout??20000,()=>{request.destroy(new Error('OpenCode timed out.'));});
  request.on('error',reject);
  if(options.body!==undefined)request.write(options.body);
  request.end();
 });
}
/**
 * The event stream stays open for the whole turn, so it has no idle timeout.
 * Opening it is bounded, though, and follows the turn's cancel signal: a server
 * that accepts the connection but never answers must not hang the turn.
 */
function openEventStream(options:{port:number;password:string;signal:AbortSignal;timeout?:number}):Promise<IncomingMessage>{
 return new Promise((resolve,reject)=>{
  const request=httpRequest({
   host:'127.0.0.1',
   port:options.port,
   path:'/api/event',
   method:'GET',
   headers:{authorization:authorization(options.password),accept:'text/event-stream'},
   signal:options.signal
  },response=>{
   clearTimeout(timer);
   if((response.statusCode??0)<200||(response.statusCode??0)>=300){response.destroy();reject(new Error('OpenCode did not open its event stream.'));return;}
   resolve(response);
  });
  const timer=setTimeout(()=>request.destroy(new Error('OpenCode did not open its event stream in time.')),options.timeout??20000);
  request.on('error',error=>{clearTimeout(timer);reject(error);});
  request.end();
 });
}
function freePort():Promise<number>{
 return new Promise((resolve,reject)=>{
  const probe=createSocketServer();
  probe.on('error',reject);
  probe.listen(0,'127.0.0.1',()=>{
   const address=probe.address();
   const port=typeof address==='object'&&address?address.port:0;
   probe.close(()=>port?resolve(port):reject(new Error('Could not reserve a local port.')));
  });
 });
}

/**
 * OpenCode reports meters only for an OpenCode Go plan and configured budgets.
 * Free models have one shared limit that OpenCode reports only when a request
 * reaches it, so "no limits" is stated plainly instead of as an error.
 */
export function opencodeNoLimitsMessage(exhaustion:ProviderExhaustion|null,now=Date.now()/1000):string{
 if(exhaustion?.exhausted&&exhaustion.resetsAt&&exhaustion.resetsAt>now)return 'The free models’ shared limit is reached. It resets '+new Date(exhaustion.resetsAt*1000).toLocaleString()+'.';
 if(exhaustion?.exhausted)return 'The free models’ shared limit is reached. OpenCode did not say when it resets.';
 return 'OpenCode reports no plan limits for your connected providers. Free models share one limit that OpenCode reports only when it is reached; it will appear here then.';
}

export class OpencodeBridge implements ProviderBridge{
 readonly id='opencode' as const;
 private child:ChildProcessWithoutNullStreams|null=null;
 private port=0;
 private password='';
 private holders=new Set<symbol>();
 private generation=0;
 private closing:Promise<void>=Promise.resolve();
 private connecting:Promise<void>|null=null;
 private active:{sessionId:string;controller:AbortController}|null=null;
 private callback:Server|null=null;
 private callbackPort=0;
 private callbackToken='';
 private toolHandler:((name:string,args:unknown)=>Promise<ToolOutput>)|null=null;
 /** The tools offered in the current turn; the callback refuses every other name. */
 private toolNames=new Set<string>();
 private toolsDigest='';
 private sessionId='';
 models:ProviderModel[]=[];
 /** Model ids OpenCode refused because their hosting region is outside the workspace's allowed privacy regions. */
 private regionRestrictedModels=new Set<string>();
 /** True when OpenCode refused this model id for its hosting region. */
 isRegionRestricted(model:string):boolean{return this.regionRestrictedModels.has(model);}
 /**
  * The models OWLA may choose on its own. A model refused for its hosting
  * region stays in the full catalogue for an explicit user choice, but is
  * dropped here until OWLA is reloaded, so automatic selection stops landing
  * on it. The set survives reconnects: the bridge rests between turns, and a
  * fresh connect would otherwise re-offer the same refused model.
  */
 get selectableModels():ProviderModel[]{return this.models.filter(model=>!this.regionRestrictedModels.has(model.id));}
 exhaustion:ProviderExhaustion|null=null;
 usage:UsageSnapshot|null=null;
 usageUpdatedAt=0;
 usageError='';
 onUsage:()=>void=()=>{};
 accountType='opencode';
 plan='';
 version='';
 status='Not connected';
 executable='';
 onStatus:(status:string)=>void=()=>{};

 get ready(){return !!this.child;}
 get running(){return !!this.child;}
 get needsSignIn(){return false;}
 get signInPending(){return false;}

 private setStatus(status:string){this.status=status;this.onStatus(status);}

 hold():()=>Promise<void>{
  const owner=Symbol();
  this.holders.add(owner);
  return async()=>{if(this.holders.delete(owner))await this.rest();};
 }

 resolveModel(preferred:string):ProviderModel|undefined{
  if(preferred)return this.models.find(model=>model.id===preferred||model.model===preferred);
  return this.models[0];
 }

 async signIn():Promise<void>{throw Error('OpenCode uses your existing OpenCode sign-in and needs no separate step.');}

 async connect(executable='',cwd='',web=false,tools:ToolSpec[]=[]):Promise<void>{
  const key=JSON.stringify([executable,cwd,web,this.digest(tools)]);
  if(this.connecting){
   if(this.connectionKey!==key)throw Error('Wait for the current OpenCode connection to finish.');
   return this.connecting;
  }
  if(this.child&&this.connectionKey===key)return;
  if(this.child&&(this.active||this.holders.size>1))throw Error('Wait for the current OpenCode operation to finish.');
  if(this.child)this.disconnect('Switching OpenCode mode…');
  this.connectionKey=key;
  const generation=this.generation;
  const starting=this.closing.then(()=>{
   if(generation!==this.generation)throw Error('OpenCode connection cancelled.');
   return this.start(executable,cwd,web,tools);
  });
  this.connecting=starting;
  try{await starting;}
  finally{if(this.connecting===starting)this.connecting=null;}
 }
 private connectionKey='';

 private digest(tools:ToolSpec[]):string{
  return JSON.stringify(tools.map(tool=>[tool.name,tool.description]));
 }

 private async start(executable:string,cwd:string,web:boolean,tools:ToolSpec[]):Promise<void>{
  const generation=this.generation;
  try{
   this.setStatus('Connecting…');
   const file=executable||findOpencodeExecutable(process.env.PATH??'');
   if(!file||!isCliExecutable(file))throw Error('OpenCode was not found. Install it, or choose its executable in settings.');
   this.version=await this.readVersion(file);
   if(!supportedOpencodeVersion(this.version))throw Error('OWLA needs OpenCode 2.2 or newer. Update OpenCode and reconnect.');
   if(generation!==this.generation)throw Error('OpenCode connection cancelled.');
   this.executable=file;
   const directory=cwd||defaultStorageDirectory();
   mkdirSync(directory,{recursive:true,mode:0o700});
   mkdirSync(join(directory,'config','opencode'),{recursive:true,mode:0o700});
   await this.ensureCallback();
   this.writeWorkspace(directory,tools);
   this.password=randomBytes(24).toString('hex');
   const port=await freePort();
   this.port=port;
   const child=spawnCli(file,['serve','--port',String(port),'--hostname','127.0.0.1'],{
    cwd:directory,
    env:{
     ...isolatedOpencodeEnv(process.env,directory),
     OPENCODE_SERVER_PASSWORD:this.password,
     OPENCODE_SERVER_USERNAME:'opencode',
     OWLA_TOOL_ENDPOINT:'http://127.0.0.1:'+String(this.callbackPort),
     OWLA_TOOL_TOKEN:this.callbackToken,
     OWLA_TOOLS_PATH:join(directory,'owla-tools.json'),
     OWLA_SKILLS_PATH:join(directory,'owla-skills.json'),
     OWLA_WEB_SEARCH:web?'1':'0'
    },
    detached:process.platform!=='win32'
   });
   this.child=child;
   child.stdout.setEncoding('utf8');
   child.stdout.on('data',()=>{});
   child.stderr.setEncoding('utf8');
   child.stderr.on('data',()=>{});
   child.on('error',error=>{if(this.child===child)this.fail(error);});
   child.on('exit',()=>{if(this.child===child)this.fail(Error('OpenCode disconnected. Your draft is preserved; reconnect to retry.'));});
   await this.waitUntilReady(port,this.password);
   if(generation!==this.generation)throw Error('OpenCode connection cancelled.');
   this.models=await this.readModels();
   if(!this.models.length)throw Error('OpenCode returned no usable models.');
   this.toolsDigest=this.digest(tools);
   this.setStatus('Connected to OpenCode');
  }catch(error){
   if(generation!==this.generation)throw Error('OpenCode connection cancelled.');
   this.disconnect(friendlyOpencodeError(error));
   throw error;
  }
 }

 private async readVersion(file:string):Promise<string>{
  return (await runCli(file,['--version'],{timeout:10000,maxBuffer:100000})).trim();
 }

 private writeWorkspace(directory:string,tools:ToolSpec[]):void{
  const digestHash=createHash('sha256').update(OPENCODE_PLUGIN_SOURCE).update(JSON.stringify({tools:tools.map(tool=>[tool.name,tool.description]),skills:skillDefinitions().map(skill=>[skill.id,skill.content])})).digest('hex');
  const digestFile=join(directory,'owla-workspace.sha256');
  try{if(readFileSync(digestFile,'utf8')===digestHash)return;}catch{/* Write the workspace below. */}
  const pluginDirectory=join(directory,'plugins','owla');
  mkdirSync(pluginDirectory,{recursive:true,mode:0o700});
  writeFileSync(join(pluginDirectory,'index.ts'),OPENCODE_PLUGIN_SOURCE,{mode:0o600});
  const skills=skillDefinitions().map(skill=>{
   const path=join(directory,'owla-skills',skill.id,'SKILL.md');
   mkdirSync(join(directory,'owla-skills',skill.id),{recursive:true,mode:0o700});
   const content=adaptSkillContent(skill.content);
   writeFileSync(path,content,{mode:0o600});
   return {id:skill.id,name:skill.name,description:skill.description,path,content};
  });
  writeFileSync(join(directory,'owla-skills.json'),JSON.stringify(skills),{mode:0o600});
  writeFileSync(join(directory,'owla-tools.json'),JSON.stringify(tools.map(tool=>({name:tool.name,description:tool.description,inputSchema:tool.inputSchema}))),{mode:0o600});
  const config={
   $schema:'https://opencode.ai/config.json',
   plugins:[pluginDirectory],
   permissions:[{action:'*',resource:'*',effect:'deny'}]
  };
  writeFileSync(opencodeConfigPath(directory),JSON.stringify(config,null,2),{mode:0o600});
  // Earlier versions wrote the same file as project config. Project discovery is
  // off now, but an OpenCode that ignores the switch would load the plugin twice.
  rmSync(join(directory,'opencode.json'),{force:true});
  writeFileSync(digestFile,digestHash,{mode:0o600});
 }

 private async ensureCallback():Promise<void>{
  if(this.callback)return;
  const token=randomBytes(24).toString('hex');
  const server=createServer((request,response)=>{
   this.handleCallback(request,response).catch(()=>{if(!response.headersSent){response.writeHead(500);}response.end();});
  });
  server.headersTimeout=10000;
  server.requestTimeout=60000;
  server.maxConnections=32;
  await new Promise<void>((resolve,reject)=>{
   server.on('error',reject);
   server.listen(0,'127.0.0.1',()=>resolve());
  });
  const address=server.address();
  this.callbackPort=typeof address==='object'&&address?address.port:0;
  this.callbackToken=token;
  this.callback=server;
 }

 private async handleCallback(request:IncomingMessage,response:import('node:http').ServerResponse):Promise<void>{
  const send=(code:number,body:string)=>{response.writeHead(code,{'content-type':'application/json'});response.end(body);};
  if(request.method!=='POST'||request.url!=='/tool'){send(404,JSON.stringify({error:'Not found.'}));return;}
  if(!sameSecret(request.headers.authorization,'Bearer '+this.callbackToken)){send(401,JSON.stringify({error:'Not authorized.'}));return;}
  const parts:string[]=[];let size=0;
  try{
   request.setEncoding('utf8');
   for await (const chunk of request as AsyncIterable<string>){size+=chunk.length;if(size>MAX_OPENCODE_BYTES)throw Error('The tool request was too large.');parts.push(chunk);}
  }catch(error){send(400,JSON.stringify({error:error instanceof Error?error.message:String(error)}));return;}
  try{
   const payload=record(JSON.parse(parts.join('')||'{}'));
   const handler=this.toolHandler;
   if(!handler)throw Error('OWLA is not ready for tool calls.');
   const name=typeof payload.tool==='string'?payload.tool:'';
   // Only the tools offered in this turn; the token alone must not reach the rest.
   if(!this.toolNames.has(name))throw Error('OWLA did not offer that tool in this turn.');
   const output=await handler(name,payload.args);
   if(typeof output==='string'){send(200,JSON.stringify({text:output}));return;}
   send(200,JSON.stringify({text:output.text,imageUrl:output.imageUrl}));
  }catch(error){
   send(200,JSON.stringify({error:error instanceof Error?error.message:String(error)}));
  }
 }

 private async waitUntilReady(port:number,password:string):Promise<void>{
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){
   try{
    const reply=await call({port,path:'/api/info',password,timeout:4000});
    if(reply.status>=200&&reply.status<300)return;
   }catch{ /* The server is still starting. */ }
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('OpenCode did not start in time. Reconnect to retry.');
 }

 private async readModels():Promise<ProviderModel[]>{
  const reply=await call({port:this.port,path:'/api/model',password:this.password,timeout:20000});
  if(reply.status<200||reply.status>=300)throw Error('OpenCode did not return its model catalogue.');
  const models=list(record(JSON.parse(reply.body)).data).map(decodeOpencodeModel).filter((model):model is ProviderModel=>!!model);
  return models;
 }

 async run(options:ProviderRunOptions):Promise<ProviderRunResult>{
  this.toolHandler=options.tool;
  this.toolNames=new Set(options.tools.map(tool=>tool.name));
  const digest=this.digest(options.tools);
  if(this.child&&this.toolsDigest&&this.toolsDigest!==digest){
   this.disconnect('Updating OpenCode tools…');
  }
  await this.connect(options.executable,options.cwd,options.web,options.tools);
  options.signal.throwIfAborted();
  if(this.active)throw Error('OpenCode is already responding.');
  const model=this.models.find(item=>item.id===options.model);
  if(!model)throw Error('The selected OpenCode model is unavailable. Choose a model and retry.');
  if(options.images.length&&model.inputModalities&&!model.inputModalities.includes('image'))throw Error('This model cannot read images. Choose an image-capable model.');
  const variant=model.supportedReasoningEfforts.some(effort=>effort.reasoningEffort===options.effort)?options.effort:'';
  const controller=new AbortController();
  const onAbort=()=>controller.abort();
  options.signal.addEventListener('abort',onAbort,{once:true});
  let sessionId='';
  try{
   const created=await call({
    port:this.port,
    path:'/api/session',
    method:'POST',
    password:this.password,
    timeout:30000,
    body:JSON.stringify({
     location:{directory:options.cwd},
     model:{providerID:model.providerID,id:model.model,...(variant&&variant!=='default'?{variant}:{})},
     permissions:opencodePermissions(options.web,options.tools.map(tool=>tool.name))
    })
   });
   if(created.status<200||created.status>=300)throw Error('OpenCode could not start a session.');
   const data=record(record(JSON.parse(created.body)).data);
   sessionId=typeof data.id==='string'?data.id:'';
   if(!sessionId)throw Error('OpenCode did not return a session ID.');
   this.sessionId=sessionId;
   this.active={sessionId,controller};
   const answer=await this.prompt(options,sessionId,controller,model);
   return answer;
  }finally{
   options.signal.removeEventListener('abort',onAbort);
   if(this.sessionId===sessionId){
    try{await call({port:this.port,path:'/api/session/'+sessionId,method:'DELETE',password:this.password,timeout:8000});}catch{/* The session is already gone. */}
   }
   this.sessionId='';
   this.active=null;
   this.toolHandler=null;
   this.toolNames=new Set();
   try{await this.readUsage(4000);}catch{/* A usage refresh must not erase a completed answer. */}
   await this.rest();
  }
 }

 private async prompt(options:ProviderRunOptions,sessionId:string,controller:AbortController,model:ProviderModel):Promise<ProviderRunResult>{
  let stream:IncomingMessage;
  try{stream=await openEventStream({port:this.port,password:this.password,signal:controller.signal});}
  catch(error){if(controller.signal.aborted)throw Error('Stopped.');throw error;}
  let text='';
  let usedWeb=false;
  const sources:{url:string;title:string}[]=[];
  let settled=false;
  let failure:Error|undefined;
  let resolveTurn:()=>void=()=>{};
  const finished=new Promise<void>(resolve=>{resolveTurn=resolve;});
  const handle=(event:Record<string,unknown>)=>{
   const type=typeof event.type==='string'?event.type:'';
   const data=record(event.data);
   if(typeof data.sessionID==='string'&&data.sessionID!==sessionId)return;
   if(type==='session.text.delta'){
    const delta=typeof data.delta==='string'?data.delta:'';
    if(delta){text+=delta;options.onText(delta);}
   }
   if(type==='session.tool.input.started'){
    const name=typeof data.name==='string'?data.name:'';
    if(name==='websearch'||name==='web_search')usedWeb=true;
    if(name)options.onActivity('Using '+name.replace(/_/g,' ').replace(/^owla_/,'')+'…');
   }
   if(type==='session.execution.succeeded'){
    if(!settled){settled=true;resolveTurn();}
   }
   if(type==='session.execution.failed'){
    const error=record(data.error);
    const message=typeof error.message==='string'?error.message:'OpenCode did not complete.';
    const retryAfterMs=typeof error.retryAfterMs==='number'?error.retryAfterMs:null;
    const resetsAt=retryAfterMs===null?null:Math.round((Date.now()+retryAfterMs)/1000);
    const state=opencodeExhaustion(message,resetsAt);
    this.exhaustion=state.exhausted?state:null;
    // A model refused for its hosting region is remembered so OWLA stops
    // offering it automatically; the raw notice is not repeated to the user.
    if(opencodeRegionRestricted(message))this.regionRestrictedModels.add(model.id);
    failure=new Error(friendlyOpencodeError(message));
    if(!settled){settled=true;resolveTurn();}
   }
  };
  stream.setEncoding('utf8');
  const blocks=new RecordSplitter('\n\n',MAX_OPENCODE_BYTES);
  const closed=(message:string)=>{if(!settled){settled=true;failure=new Error(message);resolveTurn();}};
  stream.on('data',(chunk:string)=>{
   for(const block of blocks.push(chunk)){
    for(const line of block.split('\n')){
     if(!line.startsWith('data:'))continue;
     const payload=line.slice(5).trim();
     if(!payload)continue;
     try{handle(record(JSON.parse(payload)));}catch{/* Ignore an event OWLA does not understand. */}
    }
   }
   if(blocks.overflow){closed('OpenCode sent an event that was too large.');stream.destroy();}
  });
  stream.on('error',()=>closed('The OpenCode event stream closed.'));
  // A stream that ends before the turn does would otherwise leave the turn waiting forever.
  stream.on('close',()=>closed('The OpenCode event stream closed.'));
  const stop=()=>{if(settled)return;settled=true;failure=new Error('Stopped.');resolveTurn();};
  controller.signal.addEventListener('abort',stop,{once:true});
  try{
   const files=options.images.map((image,index)=>({uri:image,name:'image-'+String(index+1)+'.png',description:'Attached image'}));
   const reply=await call({
    port:this.port,
    path:'/api/session/'+sessionId+'/prompt',
    method:'POST',
    password:this.password,
    timeout:60000,
    body:JSON.stringify({text:options.text,...(files.length?{files}:{})})
   });
   if(reply.status<200||reply.status>=300)throw Error('OpenCode rejected the request.');
   await finished;
  }finally{
   controller.signal.removeEventListener('abort',stop);
   stream.destroy();
  }
  if(failure)throw failure;
  this.exhaustion=null;
  if(options.requireWeb&&!usedWeb)throw Error('OpenCode did not run live web search. No online answer was verified.');
  for(const match of text.matchAll(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g)){
   if(sources.length>=20)break;
   if(!sources.some(source=>source.url===match[2]))sources.push({url:match[2],title:match[1]});
  }
  return {text,sources};
 }

 async readUsage(timeout=8000):Promise<UsageSnapshot|null>{
  try{
   const reply=await call({port:this.port,path:'/api/experimental/usage/limits',password:this.password,timeout});
   if(reply.status<200||reply.status>=300)throw Error('OpenCode did not return readable usage limits.');
   const payload=record(JSON.parse(reply.body));
   const usage=decodeOpencodeUsage(payload.data);
   if(!usage){
    this.usage=null;
    this.usageUpdatedAt=Date.now();
    this.usageError=opencodeNoLimitsMessage(this.exhaustion);
    this.onUsage();
    return null;
   }
   this.usage=usage;
   this.usageUpdatedAt=Date.now();
   this.usageError='';
   this.onUsage();
   return usage;
  }catch(error){
   this.usageError=friendlyOpencodeError(error);
   this.onUsage();
   throw error;
  }
 }

 async rest():Promise<void>{
  if(this.holders.size||this.active)return;
  if(!this.child&&!this.connecting)return;
  this.disconnect('Connected to OpenCode · resting until needed');
  const generation=this.generation;
  await this.closing;
  if(generation===this.generation&&!this.connecting&&!this.child)this.setStatus('Connected to OpenCode · resting until needed');
 }

 private fail(error:Error){this.disconnect(friendlyOpencodeError(error));}

 disconnect(status='Disconnected',keepStartup=false):void{
  this.generation++;
  if(!keepStartup)this.connecting=null;
  const child=this.child;
  this.child=null;
  this.port=0;
  this.password='';
  this.active=null;
  this.toolHandler=null;
  this.toolNames=new Set();
  this.toolsDigest='';
  if(this.callback){this.callback.close();this.callback=null;this.callbackPort=0;}
  if(child){
   const kill=(signal:NodeJS.Signals)=>terminateProcessTree(child,signal);
   if(child.exitCode!==null||child.signalCode!==null){kill('SIGTERM');this.closing=Promise.resolve();}
   else{
    this.closing=new Promise<void>(resolve=>{
     const force=setTimeout(()=>{kill('SIGKILL');setTimeout(resolve,100);},2000);
     child.once('exit',()=>{clearTimeout(force);resolve();});
    });
   }
   child.stdin.end();
   kill('SIGTERM');
  }
  this.setStatus(status);
 }
}
