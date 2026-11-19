// Regression tests for the orchestrator's cross-file pass on src/hermes.ts
// (3.7.0 RC; converges stream-leaks U1/U2, failure P1 + the codex-F2 class,
// providers U5/U6/U8/U9, performance rank 1). Every test runs a fake `hermes`
// CLI speaking ACP JSON-RPC over stdio — no model turn, no real gateway.
// POSIX only: process-group kill semantics differ on Windows.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {HermesBridge} from '../src/hermes';
import type {ProviderRunOptions} from '../src/provider';

const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const readPid=(file:string):number|null=>{try{return Number(readFileSync(file,'utf8'))||null;}catch{return null;}};
const waitPid=async(file:string,ms=8000):Promise<number>=>{const until=Date.now()+ms;while(Date.now()<until){const pid=readPid(file);if(pid)return pid;await delay(25);}throw Error('The fake CLI never started.');};
const dead=(pid:number):boolean=>{try{process.kill(pid,0);return false;}catch{return true;}};
const waitDead=async(pid:number,ms:number):Promise<boolean>=>{const until=Date.now()+ms;while(Date.now()<until){if(dead(pid))return true;await delay(50);}return dead(pid);};

// One fake CLI, several behaviours. argv[2] selects the mode, argv[3] the pid
// file. --version answers the connect probe. The session catalogue repeats one
// model id so the dedup (providers U5) is exercised on every connect.
const fakeSource=`
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
const mode=process.argv[2],pidFile=process.argv[3];
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
if(process.argv.includes('--version')){process.stdout.write('0.1.0\\n');process.exit(0);}
if(pidFile)writeFileSync(pidFile,String(process.pid));
const drain=async chunk=>{if(!process.stdout.write(chunk))await new Promise(r=>process.stdout.once('drain',r));};
const flood=async()=>{const chunk='x'.repeat(65536);for(let i=0;i<272;i++)await drain(chunk);setInterval(()=>{},1000);};
const reply=(id,result)=>send({jsonrpc:'2.0',id,result});
const failRpc=(id,message)=>send({jsonrpc:'2.0',id,error:{code:-32602,message}});
for await(const line of createInterface({input:process.stdin})){
 if(!line.trim())continue;
 const m=JSON.parse(line);
 if(m.method==='initialize'){
  if(mode==='stderr-exit'){process.stderr.write('boom: config missing\\n');process.exit(3);}
  reply(m.id,{protocolVersion:1});continue;
 }
 if(m.method==='session/new'){
  if(mode==='session-refused'){send({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:'Internal error',data:{details:'state.db was replaced underneath the gateway'}}});continue;}
  reply(m.id,{sessionId:'s1',models:{availableModels:[{modelId:'nous:test',name:'Test'},{modelId:'nous:test',name:'Duplicate'}],currentModelId:'nous:test'}});continue;
 }
 if(m.method==='session/set_model'){
  if(mode==='set-model-refused')failRpc(m.id,'unknown model');else reply(m.id,{});
  continue;
 }
 if(m.method==='session/prompt'){
  if(mode==='oversize'){await flood();continue;}
  if(mode==='limit'){
   send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Provider said: HTTP 429: OpenCode Go usage limit reached (weekly).'}}}});
   send({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:'Internal error',data:{details:'admitted_turn_failed'}}});continue;
  }
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello'}}}});
  reply(m.id,{stopReason:'end_turn'});continue;
 }
 // session/cancel and anything else: ignore.
}
`;

function setup(mode:string){
 const folder=mkdtempSync(join(tmpdir(),'owla-audit-hermes-'));
 const fake=join(folder,'fake-hermes.mjs'),wrapper=join(folder,'hermes'),pidFile=join(folder,'pid');
 writeFileSync(fake,fakeSource);
 writeFileSync(wrapper,'#!/bin/sh\nexec "'+process.execPath+'" "'+fake+'" '+mode+' "'+pidFile+'" "$@"\n',{mode:0o700});
 return {folder,pidFile,wrapper,cleanup:()=>rmSync(folder,{recursive:true,force:true})};
}
// Keep the test off the real ~/.hermes mirror and the loopback MCP server:
// the fake CLI never dials the callback, and the private-home rules have
// their own dedicated tests (tests/hermes.test.ts, audit-security-rc).
function bridgeFor(folder:string){
 const bridge=new HermesBridge() as unknown as Record<string,unknown>;
 bridge.ensurePrivateHome=()=>{};
 bridge.ensureCallback=async()=>{};
 bridge.privateHomePath=()=>folder;
 return bridge as unknown as HermesBridge;
}
function options(wrapper:string,folder:string,signal:AbortSignal,extra:Partial<ProviderRunOptions>={}):ProviderRunOptions{
 return {executable:wrapper,cwd:folder,model:'nous:test',effort:'default',instructions:'',text:'hi',images:[],web:false,signal,
  onText:()=>{},onActivity:()=>{},tools:[{type:'function',name:'read_note',description:'',inputSchema:{type:'object'}}],
  tool:async()=>'note text',...extra};
}

test('a Hermes turn completes, dedups the catalogue and reaps its child on rest',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('normal');
 try{
  const bridge=bridgeFor(folder);
  const result=await bridge.run(options(wrapper,folder,new AbortController().signal));
  assert.equal(result.text,'hello');
  const pid=await waitPid(pidFile);
  // run() rests after the turn; rest() now awaits the real process exit (U9).
  assert.ok(await waitDead(pid,6000),'the child must exit after the turn');
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('a refused session/set_model fails the turn instead of running the default model',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('set-model-refused');
 try{
  const bridge=bridgeFor(folder);
  await assert.rejects(bridge.run(options(wrapper,folder,new AbortController().signal)),/could not select the chosen model/);
  assert.ok(await waitDead(await waitPid(pidFile),6000));
 }finally{cleanup();}
});

test('an oversized stdout message fails closed, names the cause and reaps the child',{timeout:30000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('oversize');
 try{
  const bridge=bridgeFor(folder);
  await assert.rejects(bridge.run(options(wrapper,folder,new AbortController().signal)),/disconnected|too large/);
  assert.match(bridge.status,/too large/,'the status must name the 16 MiB overflow');
  assert.ok(await waitDead(await waitPid(pidFile),8000),'the flooded child must be terminated');
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('a connect-time death surfaces the stderr cause, not a bare disconnect',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,wrapper,cleanup}=setup('stderr-exit');
 try{
  const bridge=bridgeFor(folder);
  await assert.rejects(bridge.connect(wrapper,folder),/Last error: boom: config missing/);
  assert.match(bridge.status,/Last error: boom/);
 }finally{cleanup();}
});

test('disconnect clears stale models and sign-in state',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('normal');
 try{
  const bridge=bridgeFor(folder);
  await bridge.connect(wrapper,folder);
  assert.equal(bridge.models.length,1);
  assert.equal(bridge.needsSignIn,false);
  bridge.disconnect();
  assert.deepEqual(bridge.models,[],'models must not survive a disconnect (U6)');
  assert.equal(bridge.needsSignIn,true);
  assert.ok(await waitDead(await waitPid(pidFile),6000));
 }finally{cleanup();}
});

test('rest awaits the process-tree exit instead of a fixed sleep',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('normal');
 try{
  const bridge=bridgeFor(folder);
  await bridge.connect(wrapper,folder);
  const pid=await waitPid(pidFile);
  await bridge.rest();
  // rest() resolved: the direct child must already be gone (closing promise),
  // not merely scheduled for a kill 100 ms later.
  assert.ok(dead(pid),'the child must be exited when rest() resolves');
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});
test('a turn Hermes fails with admitted_turn_failed reports the streamed cause and marks the limit',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('limit');
 try{
  const bridge=bridgeFor(folder);
  await assert.rejects(bridge.run(options(wrapper,folder,new AbortController().signal)),/429: OpenCode Go usage limit reached/);
  assert.equal(bridge.exhaustion?.exhausted,true,'a usage limit must hold Hermes back for automatic selection');
  assert.ok(await waitDead(await waitPid(pidFile),6000));
 }finally{cleanup();}
});

test('a refused session/new names the cause and leaves no half-connected child',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('session-refused');
 try{
  const bridge=bridgeFor(folder);
  await assert.rejects(bridge.connect(wrapper,folder),/state\.db was replaced/);
  assert.ok(await waitDead(await waitPid(pidFile),6000),'the child must be stopped');
  assert.equal(bridge.running,false,'the next connect must start fresh instead of returning early');
  await assert.rejects(bridge.connect(wrapper,folder),/state\.db was replaced/,'a second connect retries for real');
 }finally{cleanup();}
});
