// Windows-focused Claude bridge lifecycle regressions (3.7.0-RC round 2,
// win-stream; audits/3.7.0-rc/windows-stream-leaks.md). On Windows the fake
// CLI is a claude.cmd npm-style shim interpreted by the system cmd.exe (the
// common install shape); on POSIX it is the round-1 sh wrapper. Every protocol
// line the fake emits is CRLF, so the parsers' CR handling is exercised on
// both hosts. No model turn: the fakes speak the stream-json control protocol
// only. Child reaping is verified by polling process.kill(pid,0) until ESRCH,
// for the direct child AND the node grandchild behind the shim.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ClaudeBridge} from '../src/claude';
import {shimInterpreterTrusted} from '../src/cli';
import type {ProviderRunOptions} from '../src/provider';

const req=createRequire(import.meta.url);
const win=process.platform==='win32';
// A redirected ComSpec would make spawnCli refuse the shim (by design); the
// process tests then cannot run on that host.
const shimOk=!win||shimInterpreterTrusted();
const processSkip=shimOk?false:'ComSpec names a program other than the system cmd.exe';
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const readPid=(file:string):number|null=>{try{return Number(readFileSync(file,'utf8'))||null;}catch{return null;}};
const waitPid=async(file:string,ms=8000):Promise<number>=>{const until=Date.now()+ms;while(Date.now()<until){const pid=readPid(file);if(pid)return pid;await delay(25);}throw Error('The fake CLI never started.');};
const dead=(pid:number):boolean=>{try{process.kill(pid,0);return false;}catch{return true;}};
const waitDead=async(pid:number,ms:number):Promise<boolean>=>{const until=Date.now()+ms;while(Date.now()<until){if(dead(pid))return true;await delay(50);}return dead(pid);};

// One fake CLI, several behaviours; argv[2] selects the mode, argv[3] the pid
// file. All output is CRLF. --version and auth status answer the connect probes.
const fakeSource=`
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
const mode=process.argv[2],pidFile=process.argv[3];
const send=v=>process.stdout.write(JSON.stringify(v)+'\\r\\n');
if(process.argv.includes('--version')){process.stdout.write('2.1.322 (Claude Code)\\r\\n');process.exit(0);}
if(process.argv.includes('auth')){process.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai'})+'\\r\\n');process.exit(0);}
if(pidFile)writeFileSync(pidFile,String(process.pid));
const drain=async chunk=>{if(!process.stdout.write(chunk))await new Promise(r=>process.stdout.once('drain',r));};
const flood=async()=>{const chunk='x'.repeat(65536);for(let i=0;i<272;i++)await drain(chunk);setInterval(()=>{},1000);};
const delta=text=>send({type:'stream_event',parent_tool_use_id:null,event:{type:'content_block_delta',delta:{type:'text_delta',text}}});
const mcp=(requestId,id)=>send({type:'control_request',request_id:requestId,request:{subtype:'mcp_message',server_name:'owla',message:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'read_note',arguments:{}}}}});
const initOk={type:'control_response',response:{subtype:'success',request_id:'owla-init',response:{models:[{value:'haiku',displayName:'Haiku',supportsEffort:false}],account:{subscriptionType:'pro'}}}};
const usageOk={type:'control_response',response:{subtype:'success',request_id:'owla-usage',response:{rate_limits:{five_hour:{utilization:10,resets_at:'2026-11-12T21:00:00+00:00'}}}}};
if(mode==='hang'){for await(const line of createInterface({input:process.stdin})){void line;}}
else if(mode==='die-stderr'){process.stderr.write('claude boom: broken settings\\r\\n');process.exit(1);}
else if(mode==='handshake-oversize'){
 for await(const line of createInterface({input:process.stdin})){
  const m=JSON.parse(line);
  if(m.type==='control_request'&&m.request_id==='owla-init'){await flood();break;}
 }
}else{
 for await(const line of createInterface({input:process.stdin})){
  const m=JSON.parse(line);
  if(m.type==='control_request'&&m.request_id==='owla-init'){send(initOk);continue;}
  if(m.type==='control_request'&&m.request_id==='owla-usage'){send(usageOk);continue;}
  if(m.type!=='user')continue;
  if(mode==='normal'){send({type:'result',subtype:'success',is_error:false,result:'done'});break;}
  if(mode==='echo-args'){const i=process.argv.indexOf('--system-prompt');send({type:'result',subtype:'success',is_error:false,result:process.argv[i+1]});break;}
  if(mode==='oversize'){await flood();break;}
  if(mode==='stubborn'){delta('ready');process.on('SIGTERM',()=>{});setInterval(()=>{},1000);break;}
  if(mode==='sources'){
   send({type:'assistant',message:{role:'assistant',content:[{type:'tool_use',id:'w1',name:'WebSearch',input:{query:'test'}}]}});
   const items=Array.from({length:600},(_,i)=>({title:'T'+i,url:'https://example.com/'+i}));
   send({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'w1',content:JSON.stringify(items)}]}});
   send({type:'result',subtype:'success',is_error:false,result:'See [link0](https://example.com/0) and [link599](https://example.com/599).'});
   break;
  }
  if(mode==='tools'){
   delta('before');mcp('mcp-1',7);
   setTimeout(()=>{delta('after');mcp('mcp-2',8);},300);
   setTimeout(()=>send({type:'result',subtype:'success',is_error:false,result:'late'}),600);
  }
 }
}
`;

function setup(mode:string){
 const folder=mkdtempSync(join(tmpdir(),'owla-win-stream-'));
 const fake=join(folder,'fake-claude.mjs'),pidFile=join(folder,'pid');
 writeFileSync(fake,fakeSource);
 const wrapper=win?join(folder,'claude.cmd'):join(folder,'claude');
 if(win)writeFileSync(wrapper,'@echo off\r\n"'+process.execPath+'" "'+fake+'" '+mode+' "'+pidFile+'" %*\r\n');
 else writeFileSync(wrapper,'#!/bin/sh\nexec "'+process.execPath+'" "'+fake+'" '+mode+' "'+pidFile+'" "$@"\n',{mode:0o700});
 // Windows can briefly hold the folder after the children die (Defender/the
 // indexer scanning the exited process's files): retry the removal like the
 // ChatStore rides out transient locks.
 const cleanup=()=>{for(let attempt=0;;attempt++){try{rmSync(folder,{recursive:true,force:true});return;}catch(e){const code=(e as NodeJS.ErrnoException).code;if(attempt>=5||(code!=='EPERM'&&code!=='EBUSY'&&code!=='EACCES'))throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}}};
 return {folder,pidFile,wrapper,cleanup};
}
function bridgeFor(wrapper:string){
 const bridge=new ClaudeBridge() as any;
 bridge.connect=async()=>{};bridge.executable=wrapper;
 return bridge;
}
// Capture every child the bridge tracks (instance override: module exports are
// immutable under the test loader). children[0].pid is the shim interpreter on
// Windows (cmd.exe), so tree reaping can be asserted for both levels.
function capture(bridge:any){
 const children:any[]=[];const track=bridge.track.bind(bridge);
 bridge.track=(child:any)=>{children.push(child);track(child);};
 return children;
}
function options(wrapper:string,folder:string,signal:AbortSignal,extra:Partial<ProviderRunOptions>={}):ProviderRunOptions{
 return {executable:wrapper,cwd:folder,model:'m',effort:'default',instructions:'',text:'hi',images:[],web:false,signal,
  onText:()=>{},onActivity:()=>{},tools:[{type:'function',name:'read_note',description:'',inputSchema:{type:'object'}}],
  tool:async()=>'note text',...extra};
}

test('a turn through the command shim completes with CRLF output and reaps the whole tree',{timeout:20000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('normal');
 try{
  const bridge=bridgeFor(wrapper);const children=capture(bridge);
  const result=await bridge.run(options(wrapper,folder,new AbortController().signal));
  assert.equal(result.text,'done');
  const pid=await waitPid(pidFile);
  assert.ok(await waitDead(pid,4000),'the node grandchild must exit after the result');
  assert.ok(await waitDead(children[0].pid,4000),'the shim interpreter must exit too');
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('connect runs the version/auth probes and the CRLF handshake through the shim',{timeout:25000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('normal');
 try{
  const bridge=new ClaudeBridge() as any;const children=capture(bridge);
  await bridge.connect(wrapper,folder);
  assert.equal(bridge.ready,true);
  assert.equal(bridge.version,'2.1.322 (Claude Code)');
  assert.equal(bridge.plan,'pro');
  assert.equal(bridge.accountType,'claude.ai');
  assert.ok(bridge.usage,'the get_usage handshake reports plan usage');
  const pid=await waitPid(pidFile);
  bridge.disconnect();
  assert.ok(await waitDead(pid,4000),'the handshake child is reaped on disconnect');
  assert.ok(await waitDead(children[0].pid,4000));
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('an oversized CRLF protocol line fails the turn closed and reaps the child',{timeout:20000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('oversize');
 try{
  const bridge=bridgeFor(wrapper);const children=capture(bridge);
  await assert.rejects(bridge.run(options(wrapper,folder,new AbortController().signal)),/too large/);
  const pid=await waitPid(pidFile);
  assert.ok(await waitDead(pid,6000),'the flooded child must be terminated');
  assert.ok(await waitDead(children[0].pid,4000));
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('an oversized handshake line fails readUsage closed and reaps the child',{timeout:20000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('handshake-oversize');
 try{
  const bridge=bridgeFor(wrapper);bridge.cwd=folder;
  await assert.rejects(bridge.readUsage(),/too large/);
  assert.ok(await waitDead(await waitPid(pidFile),6000));
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('abort stops later deltas and tool calls, and the tree is reaped',{timeout:20000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('tools');
 try{
  const bridge=bridgeFor(wrapper);const children=capture(bridge);
  const controller=new AbortController();
  const calls:string[]=[],texts:string[]=[];
  let toolStarted:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{toolStarted=resolve;});
  const running=bridge.run(options(wrapper,folder,controller.signal,{
   onText:(delta:string)=>texts.push(delta),
   tool:async(name:string)=>{calls.push(name);toolStarted();await delay(150);return 'note text';},
  }));
  await started;
  controller.abort();
  await assert.rejects(running,/Stopped/);
  await delay(700); // the fake keeps sending deltas and a second tool request
  assert.deepEqual(texts,['before'],'no delta may stream into a stopped turn');
  assert.deepEqual(calls,['read_note'],'no tool may start after the abort');
  const pid=await waitPid(pidFile);
  assert.ok(await waitDead(pid,6000));
  assert.ok(await waitDead(children[0].pid,4000));
 }finally{cleanup();}
});

test('a child ignoring the interrupt is terminated after the grace window',{timeout:25000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('stubborn');
 try{
  const bridge=bridgeFor(wrapper);
  const controller=new AbortController();
  let ready:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{ready=resolve;});
  const running=bridge.run(options(wrapper,folder,controller.signal,{onText:(delta:string)=>{if(delta==='ready')ready();}}));
  await started;
  controller.abort();
  await assert.rejects(running,/Stopped/);
  // 2 s grace, then the tree kill (taskkill /T /F on Windows, SIGTERM→SIGKILL
  // on POSIX). The escalation timer must not leak past the child's death.
  assert.ok(await waitDead(await waitPid(pidFile),8000),'the stubborn child must be terminated');
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('disconnect reaps a hanging handshake child and fails the connect',{timeout:20000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('hang');
 try{
  const bridge=new ClaudeBridge() as any;const children=capture(bridge);
  const connecting=bridge.connect(wrapper,folder);
  const pid=await waitPid(pidFile);
  bridge.disconnect();
  await assert.rejects(connecting,/exited during connection|cancelled/);
  assert.ok(await waitDead(pid,4000),'the handshake child must die on disconnect');
  assert.ok(await waitDead(children[0].pid,4000));
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('cmd metacharacters in the system prompt survive the shim intact',{timeout:20000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('echo-args');
 const bridge=bridgeFor(wrapper);const children=capture(bridge);
 try{
  const instructions='Say "hi" & stay <safe> 100% done';
  const result=await bridge.run(options(wrapper,folder,new AbortController().signal,{instructions}));
  assert.equal(result.text,instructions);
 }finally{
  // Windows locks a live process's cwd: reap before removing the folder.
  const pid=readPid(pidFile);if(pid)await waitDead(pid,4000);
  if(children[0])await waitDead(children[0].pid,4000);
  cleanup();
 }
});

test('multi-line instructions are never silently truncated by the Windows shim',{timeout:20000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('echo-args');
 const bridge=bridgeFor(wrapper);const children=capture(bridge);
 try{
  // main.ts appends \n guidance to the system prompt. cmd.exe truncates a /c
  // command line at an embedded LF (probe-verified), so the bridge must either
  // deliver the WHOLE prompt or refuse the shim — never run a truncated one.
  const instructions='line1\nline2';
  let text:string|null=null;
  try{text=(await bridge.run(options(wrapper,folder,new AbortController().signal,{instructions}))).text;}
  catch(e){assert.match((e as Error).message,/control character|shim|could not be started/i);}
  if(text!==null)assert.equal(text,instructions,'a delivered prompt must be complete');
 }finally{
  const pid=readPid(pidFile);if(pid)await waitDead(pid,4000);
  if(children[0])await waitDead(children[0].pid,4000);
  cleanup();
 }
});

test('web sources stay capped at 500 with CRLF tool results',{timeout:20000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('sources');
 const bridge=bridgeFor(wrapper);const children=capture(bridge);
 try{
  const result=await bridge.run(options(wrapper,folder,new AbortController().signal));
  // URL 0 is inside the 500-entry map (titled from the search results); URL
  // 599 was dropped by the cap and falls back to its link text.
  assert.deepEqual(result.sources,[
   {url:'https://example.com/0',title:'T0'},
   {url:'https://example.com/599',title:'link599'},
  ]);
 }finally{
  const pid=readPid(pidFile);if(pid)await waitDead(pid,4000);
  if(children[0])await waitDead(children[0].pid,4000);
  cleanup();
 }
});

test('a failed spawn rejects actionably and schedules no kill timer',{timeout:20000},async()=>{
 const timers=req('node:timers');
 const realSetTimeout=timers.setTimeout;const delays:number[]=[];
 timers.setTimeout=(fn:()=>void,ms:number,...rest:unknown[])=>{delays.push(ms);return realSetTimeout(fn,ms,...rest);};
 const folder=mkdtempSync(join(tmpdir(),'owla-win-stream-'));
 try{
  const missing=join(folder,win?'missing.exe':'missing');
  const bridge=bridgeFor(missing);
  await assert.rejects(bridge.run(options(missing,folder,new AbortController().signal)),/could not be started/);
  // A child that never spawned has no tree to stop: no 2 s grace/force timer
  // may linger (on POSIX a failed spawn never emits 'exit' to clear it).
  assert.equal(delays.includes(2000),false,'no kill timer for a never-spawned child: '+JSON.stringify(delays));
  assert.equal(bridge.running,false);
 }finally{timers.setTimeout=realSetTimeout;rmSync(folder,{recursive:true,force:true});}
});

test('handshake settle releases the stdout/stderr listeners and ends stdin',{timeout:25000,skip:processSkip},async()=>{
 const {folder,pidFile,wrapper,cleanup}=setup('normal');
 const bridge=new ClaudeBridge() as any;const children=capture(bridge);
 try{
  await bridge.connect(wrapper,folder);
  assert.equal(children.length,1);
  const child=children[0];
  assert.equal(child.stdout.listenerCount('data'),0,'no parser may keep reading a settled handshake');
  assert.equal(child.stderr.listenerCount('data'),0,'the stderr tail closure must be released');
  assert.ok(child.stdin.destroyed||child.stdin.writableEnded);
  bridge.disconnect();
 }finally{
  const pid=readPid(pidFile);if(pid)await waitDead(pid,4000);
  if(children[0])await waitDead(children[0].pid,4000);
  cleanup();
 }
});

test('a handshake death surfaces the CRLF stderr cause',{timeout:20000,skip:processSkip},async()=>{
 const {folder,wrapper,cleanup}=setup('die-stderr');
 try{
  const bridge=new ClaudeBridge();
  await assert.rejects(bridge.connect(wrapper,folder),/Last error: claude boom: broken settings/);
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('env() strips backend/model/config/telemetry redirectors regardless of key casing',{timeout:10000},async()=>{
 const bridge=new ClaudeBridge();
 // Lower-case spellings: Windows env names are case-insensitive, and env()
 // must strip every casing on a plain-object copy too (round-1 M4).
 const injected:Record<string,string>={anthropic_model:'redirected',claude_code_use_bedrock:'1',
  anthropic_foundry_workspace:'w',otel_exporter_otlp_endpoint:'http://otel.test',claude_config_dir:'/tmp/elsewhere',
  DISABLE_TELEMETRY:'1'};
 const saved:Record<string,string|undefined>={};
 for(const [key,value] of Object.entries(injected)){saved[key]=process.env[key];process.env[key]=value;}
 try{
  const env=(bridge as unknown as {env:()=>NodeJS.ProcessEnv}).env();
  for(const key of Object.keys(env)){
   const upper=key.toUpperCase();
   if(upper==='DISABLE_TELEMETRY')continue;
   assert.ok(!Object.keys(injected).some(injectedKey=>injectedKey.toUpperCase()===upper&&injectedKey!=='DISABLE_TELEMETRY'),key+' must not redirect the confined turn');
  }
  assert.equal(env.DISABLE_TELEMETRY,'1','the user’s own telemetry choice stays');
  assert.equal(env.DISABLE_ERROR_REPORTING,'1');
  assert.equal(env.DISABLE_AUTOUPDATER,'1');
 }finally{
  for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
