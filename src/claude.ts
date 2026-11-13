/**
 * Claude Code provider.
 *
 * OWLA runs the Claude Code CLI in print mode with the stream-json protocol,
 * one process per turn. The OWLA vault tools are offered as an in-process
 * ("sdk") MCP server: Claude Code sends each MCP message to OWLA over stdio
 * as a control request, so no port or extra file is needed.
 *
 * Isolation mirrors the Codex bridge:
 *  - `--safe-mode` drops the user's CLAUDE.md, skills, plugins, hooks and MCP
 *    servers; `--strict-mcp-config` and `--setting-sources ""` keep it that way.
 *  - `--tools ""` removes every built-in tool (shell, file edits, subagents).
 *    Only `WebSearch` is added back when web search is allowed.
 *  - `--no-session-persistence` keeps the conversation out of Claude Code's
 *    resumable history, and API keys are removed from the environment so the
 *    user's Claude subscription login is used, as Codex uses ChatGPT.
 *
 * Verified against Claude Code 2.1.322 (claude.ai login, haiku probes).
 */

import {ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter,join} from 'node:path';
import {setTimeout,clearTimeout} from 'node:timers';
import {ProviderBridge,ProviderModel,ProviderRunOptions,ProviderRunResult,ToolOutput,ToolSpec} from './provider';
import {claudeExhaustion,ProviderExhaustion} from './exhaustion';
import {UsageSnapshot,decodeClaudeRateLimit,decodeClaudeUsage,updateUsage} from './usage';
import {list,record} from './validation';
import {RecordSplitter} from './stream';
import {defaultCliDirectories,findCliExecutable,isCliExecutable,runCli,sanitizedEnv,spawnCli,terminateProcessTree} from './cli';

export const CLAUDE_MCP_SERVER='owla';
export const CLAUDE_TOOL_PREFIX='mcp__'+CLAUDE_MCP_SERVER+'__';
/** Models without an effort parameter carry this placeholder effort. */
export const CLAUDE_NO_EFFORT='default';

const defaultBinDirectories=()=>defaultCliDirectories([join(homedir(),'.claude','local')]);
export function findClaudeExecutable(path:string,directories=defaultBinDirectories()):string{
 return findCliExecutable('claude',path,directories);
}

/** OWLA needs the stream-json control protocol with in-process MCP servers and safe mode. */
export function supportedClaudeVersion(version:string):boolean{
 const match=version.match(/(\d+)\.(\d+)\.(\d+)/);
 if(!match)return false;
 const [major,minor,patch]=[Number(match[1]),Number(match[2]),Number(match[3])];
 if(major!==2)return major>2;
 return minor>1||(minor===1&&patch>=322);
}

export function friendlyClaudeError(error:unknown):string{
 const text=error instanceof Error?error.message:String(error);
 if(/rate.?limit|usage limit|429|quota|limit reached/i.test(text))return 'Claude usage limit reached. Wait for your plan allowance to reset.';
 if(/401|unauthorized|not logged in|login|authentication|oauth/i.test(text))return 'Claude Code needs you to sign in again. Run claude in your terminal and sign in.';
 return text.slice(0,800);
}

/** Decodes the model catalogue from Claude Code's initialize response. */
export function decodeClaudeModels(value:unknown):ProviderModel[]{
 const entries=list(value).map(record);
 const defaultResolved=entries.find(entry=>entry.value==='default')?.resolvedModel;
 const seen=new Set<string>();
 const models:ProviderModel[]=[];
 for(const entry of entries){
  const id=typeof entry.value==='string'?entry.value:'';
  // "default" is an alias of another listed model. OWLA lists the concrete model instead.
  if(!id||id==='default'||seen.has(id))continue;
  seen.add(id);
  const levels=list(entry.supportedEffortLevels).filter((level):level is string=>typeof level==='string');
  const efforts=entry.supportsEffort===true&&levels.length?levels:[CLAUDE_NO_EFFORT];
  const defaultEffort=efforts.includes('medium')?'medium':efforts[0];
  const resolved=typeof entry.resolvedModel==='string'?entry.resolvedModel:id;
  models.push({
   id,model:id,
   displayName:typeof entry.displayName==='string'?entry.displayName:id,
   description:typeof entry.description==='string'?entry.description:undefined,
   isDefault:resolved===defaultResolved&&id!==resolved,
   defaultReasoningEffort:defaultEffort,
   supportedReasoningEfforts:efforts.map(reasoningEffort=>({reasoningEffort,description:''})),
   inputModalities:['text','image'],
  });
 }
 if(!models.some(model=>model.isDefault)&&models.length)models[0].isDefault=true;
 return models;
}

/** Splits a data URL into an MCP or Anthropic image block. */
export function imageBlock(url:string):{mediaType:string;data:string}|null{
 const match=url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
 return match?{mediaType:match[1],data:match[2]}:null;
}

export function toolContent(output:ToolOutput){
 if(typeof output==='string')return [{type:'text',text:output}];
 const image=imageBlock(output.imageUrl);
 return [{type:'text',text:output.text},...(image?[{type:'image',data:image.data,mimeType:image.mediaType}]:[])];
}

/** The command line for one turn. Exported for tests. */
export function claudeArguments(model:string,effort:string,instructions:string,tools:ToolSpec[],web:boolean):string[]{
 const allowed=tools.map(tool=>CLAUDE_TOOL_PREFIX+tool.name);
 return [
  '-p','--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages',
  '--no-session-persistence','--safe-mode','--disable-slash-commands','--setting-sources','',
  '--strict-mcp-config','--mcp-config',JSON.stringify({mcpServers:{[CLAUDE_MCP_SERVER]:{type:'sdk',name:CLAUDE_MCP_SERVER}}}),
  '--tools',web?'WebSearch':'',
  '--permission-mode','dontAsk','--allowedTools',[...allowed,...(web?['WebSearch']:[])].join(','),
  '--model',model,
  ...(effort&&effort!==CLAUDE_NO_EFFORT?['--effort',effort]:[]),
  '--system-prompt',instructions,
 ];
}

type Message=Record<string,unknown>;

/**
 * Sources are the links the reply cites, as with Codex. Search results that
 * the reply does not cite are left out; if it cites none, the first few
 * results stand in so the answer stays traceable.
 */
export function webSources(text:string,results:Map<string,string>):{url:string;title:string}[]{
 const sources:{url:string;title:string}[]=[];
 const add=(url:string,title:string)=>{if(sources.length<20&&!sources.some(source=>source.url===url))sources.push({url,title:results.get(url)??title});};
 for(const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g))add(match[2],match[1]);
 if(!sources.length)for(const [url,title] of [...results].slice(0,5))add(url,title);
 return sources;
}

export class ClaudeBridge implements ProviderBridge{
 readonly id='claude' as const;
 models:ProviderModel[]=[];
 usage:UsageSnapshot|null=null;usageUpdatedAt=0;usageError='';
 accountType:string|undefined;plan='';version='';status='Not connected';executable='';private cwd='';
 onStatus:(status:string)=>void=()=>{};onUsage:()=>void=()=>{};
 /** The latest usage-limit failure, for the fallback decision. */
 exhaustion:ProviderExhaustion|null=null;
 private loggedIn=false;private connectionKey='';private connecting:Promise<void>|null=null;
 private children=new Set<ChildProcessWithoutNullStreams>();private generation=0;

 get ready(){return this.loggedIn&&this.models.length>0;}
 /** Claude Code has no resident process; it runs only while a reply or check is under way. */
 get running(){return this.children.size>0;}
 get selectableModels(){return this.models;}
 private track(child:ChildProcessWithoutNullStreams){this.children.add(child);this.onStatus(this.status);}
 private untrack(child:ChildProcessWithoutNullStreams){if(this.children.delete(child))this.onStatus(this.status);}
 get needsSignIn(){return this.accountType==='';}
 get signInPending(){return false;}

 private env():NodeJS.ProcessEnv{
  const env:NodeJS.ProcessEnv={...sanitizedEnv(),PATH:[process.env.PATH,...defaultBinDirectories()].filter(Boolean).join(delimiter),
   // DISABLE_TELEMETRY and CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC also hide the live model
   // catalogue (verified with 2.1.322: Fable 5.2 and pinned versions disappear), so OWLA keeps the
   // user's own Claude Code telemetry choice and turns off only error reports and self-updates.
   DISABLE_ERROR_REPORTING:'1',DISABLE_AUTOUPDATER:'1'};
  for(const key of ['CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX'])delete env[key];
  return env;
 }
 private setStatus(status:string){this.status=status;this.onStatus(status);}

 hold():()=>Promise<void>{return async()=>{};}

 resolveModel(preferred:string):ProviderModel|undefined{
  if(preferred)return this.models.find(model=>model.id===preferred);
  return this.models.find(model=>model.isDefault)??this.models[0];
 }

 /** Makes the next connect run the full check again, without stopping a reply in progress. */
 recheck(){if(!this.connecting)this.connectionKey='';}

 async connect(executable='',cwd=''):Promise<void>{
  const key=JSON.stringify([executable,cwd]);
  if(this.connecting)return this.connecting;
  if(this.ready&&this.connectionKey===key)return;
  this.connectionKey=key;
  const starting=this.start(executable,cwd);
  this.connecting=starting;
  try{await starting;}
  catch(e){this.setStatus(friendlyClaudeError(e));throw e;}
  finally{if(this.connecting===starting)this.connecting=null;}
 }

 private async start(executable:string,cwd:string){
  const generation=this.generation;
  this.setStatus('Connecting…');
  const env=this.env(),file=executable||findClaudeExecutable(env.PATH??'');
  if(!file||!isCliExecutable(file))throw Error('Claude Code was not found. Install Claude Code or choose its executable in settings.');
  const run=(args:string[])=>runCli(file,args,{env,timeout:15000,maxBuffer:200000});
  this.version=(await run(['--version'])).trim();
  if(!supportedClaudeVersion(this.version))throw Error('Update Claude Code to version 2.1.322 or newer (claude update), then reconnect.');
  const auth=record(JSON.parse(await run(['auth','status'])));
  if(generation!==this.generation)throw Error('Claude Code connection cancelled.');
  this.executable=file;
  if(auth.loggedIn!==true){this.loggedIn=false;this.accountType='';throw Error('Sign in to Claude Code first: run claude in your terminal and log in, then reconnect.');}
  if(cwd)mkdirSync(cwd,{recursive:true,mode:0o700});
  // The initialize handshake lists models and the plan without sending a prompt.
  const [init,usage]=await this.handshake(file,cwd||homedir(),env,true);
  if(generation!==this.generation)throw Error('Claude Code connection cancelled.');
  this.cwd=cwd||homedir();
  this.acceptUsage(usage);
  this.models=decodeClaudeModels(init.models);
  if(!this.models.length)throw Error('Claude Code did not report any models.');
  const account=record(init.account);
  this.loggedIn=true;
  this.accountType=typeof auth.authMethod==='string'?auth.authMethod:'claude.ai';
  this.plan=typeof account.subscriptionType==='string'?account.subscriptionType:'';
  this.setStatus('Connected to Claude Code'+(this.plan?' · '+this.plan:''));
 }

 /**
  * Starts Claude Code without a prompt and sends control requests: initialize
  * (models and plan) and, optionally, get_usage (plan limits). No model turn
  * runs, so neither request uses the plan.
  */
 private handshake(file:string,cwd:string,env:NodeJS.ProcessEnv,withUsage=false):Promise<[Message,Message|null]>{
  return new Promise((resolve,reject)=>{
   let init:Message|null=null;
   const child=spawnCli(file,['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--no-session-persistence','--safe-mode','--disable-slash-commands','--setting-sources','','--strict-mcp-config','--tools',''],{cwd,env});
   this.track(child);
   const lines=new RecordSplitter('\n');let done=false;
   const finish=(error:Error|null,usage:Message|null=null)=>{if(done)return;done=true;clearTimeout(timer);this.untrack(child);child.stdin.end();terminateProcessTree(child,'SIGTERM');error||!init?reject(error??Error('Claude Code refused the connection.')):resolve([init,usage]);};
   const timer=setTimeout(()=>finish(Error('Claude Code did not respond. Check that it runs in your terminal.')),30000);
   child.stdout.setEncoding('utf8');
   child.stdout.on('data',(chunk:string)=>{
    for(const raw of lines.push(chunk)){
     const line=raw.trim();
     if(!line)continue;
     let message:Message;try{message=record(JSON.parse(line));}catch{continue;}
     const response=record(message.response);
     if(message.type==='control_response'&&response.request_id==='owla-init'){
      if(response.subtype!=='success'){finish(Error(typeof response.error==='string'?response.error:'Claude Code refused the connection.'));continue;}
      init=record(response.response);
      if(!withUsage)finish(null);
      else child.stdin.write(JSON.stringify({type:'control_request',request_id:'owla-usage',request:{subtype:'get_usage'}})+'\n');
     }
     // Older Claude Code versions may not know get_usage; the connection still succeeds.
     if(message.type==='control_response'&&response.request_id==='owla-usage')finish(null,response.subtype==='success'?record(response.response):null);
    }
   });
   child.stderr.on('data',()=>{});
   child.on('error',error=>finish(error));
   child.on('exit',()=>finish(Error('Claude Code exited during connection.')));
   child.stdin.on('error',()=>{});
   child.stdin.write(JSON.stringify({type:'control_request',request_id:'owla-init',request:{subtype:'initialize'}})+'\n');
  });
 }

 private acceptRateLimit(info:unknown){
  const snapshot=decodeClaudeRateLimit(info);
  if(!snapshot)return;
  this.usage=updateUsage(this.usage,snapshot,true);
  this.usageUpdatedAt=Date.now();this.usageError='';
  this.exhaustion=claudeExhaustion(this.usage);
  this.onUsage();
 }

 async run(options:ProviderRunOptions):Promise<ProviderRunResult>{
  await this.connect(options.executable,options.cwd);
  options.signal.throwIfAborted();
  const env=this.env(),generation=this.generation;
  const child=spawnCli(this.executable,claudeArguments(options.model,options.effort,options.instructions,options.tools,options.web),{cwd:options.cwd||homedir(),env,detached:process.platform!=='win32'});
  this.track(child);
  const send=(value:unknown)=>{if(!child.stdin.destroyed)child.stdin.write(JSON.stringify(value)+'\n');};
  const sources=new Map<string,string>();
  let streamed='',lastAssistant='',stderr='',usedWeb=false;
  this.exhaustion=null;
  try{
   return await new Promise<ProviderRunResult>((resolve,reject)=>{
    const lines=new RecordSplitter('\n');let settled=false;
    const finish=(error:Error|null,result?:ProviderRunResult)=>{if(settled)return;settled=true;options.signal.removeEventListener('abort',abort);error?reject(error):resolve(result!);};
    const abort=()=>{
     send({type:'control_request',request_id:'owla-interrupt',request:{subtype:'interrupt'}});
     finish(Error('Stopped.'));
    };
    options.signal.addEventListener('abort',abort,{once:true});
    const answerMcp=async(requestId:string,message:Message)=>{
     const id=message.id,method=message.method,params=record(message.params);
     let result:unknown={};
     try{
      if(method==='initialize')result={protocolVersion:typeof params.protocolVersion==='string'?params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:CLAUDE_MCP_SERVER,version:'1'}};
      else if(method==='tools/list')result={tools:options.tools.map(tool=>({name:tool.name,description:tool.description,inputSchema:tool.inputSchema}))};
      else if(method==='tools/call'){
       const name=typeof params.name==='string'?params.name:'';
       try{result={content:toolContent(await options.tool(name,params.arguments??{}))};}
       catch(error){result={content:[{type:'text',text:error instanceof Error?error.message:String(error)}],isError:true};}
      }
     }finally{
      send({type:'control_response',response:{subtype:'success',request_id:requestId,response:{mcp_response:id===undefined?{}:{jsonrpc:'2.0',id,result}}}});
     }
    };
    const handle=(message:Message)=>{
     const type=message.type;
     if(type==='control_request'){
      const request=record(message.request),requestId=typeof message.request_id==='string'?message.request_id:'';
      if(request.subtype==='mcp_message')void answerMcp(requestId,record(request.message));
      // OWLA allows tools up front; anything else that asks is denied.
      else if(request.subtype==='can_use_tool')send({type:'control_response',response:{subtype:'success',request_id:requestId,response:{behavior:'deny',message:'Not available in OWLA.'}}});
      else send({type:'control_response',response:{subtype:'error',request_id:requestId,error:'Unsupported by OWLA.'}});
      return;
     }
     if(type==='control_response'){
      const response=record(message.response);
      if(response.request_id==='owla-init'){
       if(response.subtype!=='success'){finish(Error(typeof response.error==='string'?response.error:'Claude Code refused the session.'));return;}
       const images=options.images.flatMap(url=>{const image=imageBlock(url);return image?[{type:'image',source:{type:'base64',media_type:image.mediaType,data:image.data}}]:[];});
       send({type:'user',message:{role:'user',content:[{type:'text',text:options.text},...images]},parent_tool_use_id:null,session_id:''});
      }
      return;
     }
     if(type==='stream_event'){
      const event=record(message.event),delta=record(event.delta);
      if(message.parent_tool_use_id==null&&event.type==='content_block_delta'&&delta.type==='text_delta'&&typeof delta.text==='string'){streamed+=delta.text;options.onText(delta.text);}
      return;
     }
     if(type==='assistant'){
      const content=list(record(message.message).content).map(record);
      const text=content.filter(block=>block.type==='text').map(block=>String(block.text??'')).join('');
      if(text)lastAssistant=text;
      for(const block of content)if(block.type==='tool_use'||block.type==='server_tool_use'){
       const name=String(block.name??'').replace(CLAUDE_TOOL_PREFIX,'');
       if(name==='WebSearch'||name==='web_search'){usedWeb=true;const query=record(block.input).query;options.onActivity('Searched the web'+(typeof query==='string'?': '+query:''));}
      }
      return;
     }
     if(type==='user'){
      // WebSearch results arrive as tool results; collect the links as sources.
      for(const block of list(record(message.message).content).map(record)){
       if(block.type!=='tool_result')continue;
       const collect=(value:unknown)=>{
        if(!value||typeof value!=='object')return;
        if(Array.isArray(value)){for(const item of value)collect(item);return;}
        const recordValue=value as Record<string,unknown>;
        const title=recordValue.title,url=recordValue.url;
        if(typeof title==='string'&&typeof url==='string'&&/^https?:\/\//.test(url))sources.set(url,title.slice(0,200));
        for(const key of Object.keys(recordValue))collect(recordValue[key]);
       };
       if(typeof block.content==='string'){try{collect(JSON.parse(block.content));}catch{for(const match of block.content.matchAll(/"title":"([^"]{1,200})","url":"(https?:\/\/[^"]+)"/g))sources.set(match[2],match[1]);}}else collect(block.content);
      }
      return;
     }
     if(type==='rate_limit_event'){this.acceptRateLimit(message.rate_limit_info);return;}
     if(type==='result'){
      if(message.is_error===true||message.subtype!=='success'){
       const errors=list(message.errors).filter((item):item is string=>typeof item==='string');
       const detail=[typeof message.result==='string'?message.result:'',...errors,typeof message.api_error_status==='number'?'HTTP '+message.api_error_status:''].filter(Boolean).join(' ')||'Claude Code could not complete the reply.';
       this.exhaustion=this.exhaustion?.exhausted?this.exhaustion:claudeExhaustion(this.usage,detail);
       finish(Error(friendlyClaudeError(detail)));
       return;
      }
      const text=typeof message.result==='string'&&message.result?message.result:(lastAssistant||streamed);
      if(options.requireWeb&&!usedWeb){finish(Error('Claude Code did not run live web search. No online answer was verified.'));return;}
      finish(null,{text,sources:usedWeb?webSources(text,sources):[]});
     }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{
     for(const raw of lines.push(chunk)){
      const line=raw.trim();
      if(!line)continue;
      let message:Message;try{message=record(JSON.parse(line));}catch{continue;}
      try{handle(message);}catch(error){finish(error instanceof Error?error:Error(String(error)));}
     }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data',(chunk:string)=>{stderr=(stderr+chunk).slice(-4000);});
    child.on('error',error=>finish(error));
    child.on('exit',()=>{
     if(generation!==this.generation){finish(Error('Claude Code disconnected.'));return;}
     const detail=stderr.trim();
     if(detail)this.exhaustion=this.exhaustion?.exhausted?this.exhaustion:claudeExhaustion(this.usage,detail);
     finish(Error(detail?friendlyClaudeError(detail):'Claude Code exited before replying. Your draft is preserved; try again.'));
    });
    child.stdin.on('error',()=>{});
    send({type:'control_request',request_id:'owla-init',request:{subtype:'initialize',sdkMcpServers:[CLAUDE_MCP_SERVER]}});
   });
  }finally{
   this.untrack(child);
   if(!child.stdin.destroyed)child.stdin.end();
   const timer=setTimeout(()=>{if(child.exitCode===null)this.kill(child);},2000);
   child.once('exit',()=>clearTimeout(timer));
  }
 }

 async signIn():Promise<void>{throw Error('Claude Code uses your existing sign-in. Run claude in your terminal and log in, then reconnect.');}

 /**
  * Claude Code reports usage only while a reply runs. OWLA keeps the last
  * report and treats a window as reset once its reset time has passed.
  */
 async readUsage():Promise<UsageSnapshot|null>{
  if(this.executable){
   try{const [,usage]=await this.handshake(this.executable,this.cwd||homedir(),this.env(),true);this.acceptUsage(usage);}
   catch(e){if(!this.usage){this.usageError=friendlyClaudeError(e);throw e;}}
  }
  if(this.usage){this.exhaustion=claudeExhaustion(this.usage);return this.usage;}
  this.usageError='Claude Code did not report plan usage. Connect Claude Code, then refresh.';
  throw Error(this.usageError);
 }

 private acceptUsage(response:Message|null){
  const snapshot=response&&decodeClaudeUsage(response);
  if(!snapshot)return;
  this.usage=updateUsage(this.usage,snapshot,true);
  this.usageUpdatedAt=Date.now();this.usageError='';
  this.exhaustion=claudeExhaustion(this.usage);
  this.onUsage();
 }

 private kill(child:ChildProcessWithoutNullStreams){
  terminateProcessTree(child,'SIGTERM');
 }

 disconnect(status='Not connected'):void{
  this.generation++;
  for(const child of this.children)this.kill(child);
  this.children.clear();
  this.loggedIn=false;this.models=[];this.connectionKey='';this.connecting=null;
  this.setStatus(status);
 }
}
