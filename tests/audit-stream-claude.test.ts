// Regression tests for the 3.7.0-RC stream-leak audit (audits/3.7.0-rc/stream-leaks.md).
// Every test runs a fake `claude` CLI (no model turn) and verifies the bridge
// reaps the child and stops streaming/tool work on each exit path. POSIX only:
// the process-group kill semantics under test differ on Windows.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ClaudeBridge} from '../src/claude';
import type {ProviderRunOptions} from '../src/provider';

const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const readPid=(file:string):number|null=>{try{return Number(readFileSync(file,'utf8'))||null;}catch{return null;}};
const waitPid=async(file:string,ms=8000):Promise<number>=>{const until=Date.now()+ms;while(Date.now()<until){const pid=readPid(file);if(pid)return pid;await delay(25);}throw Error('The fake CLI never started.');};
const dead=(pid:number):boolean=>{try{process.kill(pid,0);return false;}catch{return true;}};
const waitDead=async(pid:number,ms:number):Promise<boolean>=>{const until=Date.now()+ms;while(Date.now()<until){if(dead(pid))return true;await delay(50);}return dead(pid);};

// One fake CLI, several behaviours. argv[2] selects the mode, argv[3] is the
// pid file. --version and auth status answer the connect probes without a turn.
const fakeSource=`
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
const mode=process.argv[2],pidFile=process.argv[3];
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
if(process.argv.includes('--version')){process.stdout.write('2.1.322 (Claude Code)\\n');}
else if(process.argv.includes('auth')){process.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai'})+'\\n');}
else{
if(pidFile)writeFileSync(pidFile,String(process.pid));
const drain=async chunk=>{if(!process.stdout.write(chunk))await new Promise(r=>process.stdout.once('drain',r));};
const flood=async()=>{const chunk='x'.repeat(65536);for(let i=0;i<272;i++)await drain(chunk);setInterval(()=>{},1000);};
const delta=text=>send({type:'stream_event',parent_tool_use_id:null,event:{type:'content_block_delta',delta:{type:'text_delta',text}}});
const mcp=(requestId,id)=>send({type:'control_request',request_id:requestId,request:{subtype:'mcp_message',server_name:'owla',message:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'read_note',arguments:{}}}}});
if(mode==='hang'){for await(const line of createInterface({input:process.stdin})){void line;}}
else if(mode==='handshake-oversize'){
 for await(const line of createInterface({input:process.stdin})){
  const m=JSON.parse(line);
  if(m.type==='control_request'&&m.request_id==='owla-init'){await flood();break;}
 }
}else{
 for await(const line of createInterface({input:process.stdin})){
  const m=JSON.parse(line);
  if(m.type==='control_request'&&m.request_id==='owla-init'){send({type:'control_response',response:{subtype:'success',request_id:'owla-init',response:{}}});continue;}
  if(m.type!=='user')continue;
  if(mode==='normal'){send({type:'result',subtype:'success',is_error:false,result:'done'});break;}
  if(mode==='utf8'){
   const buf=Buffer.from(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'héllo 世界 🎉 café'})+'\\n','utf8');
   for(let i=0;i<buf.length;i+=3){await drain(buf.subarray(i,i+3));await new Promise(r=>setTimeout(r,1));}
   break;
  }
  if(mode==='oversize'){await flood();break;}
  if(mode==='stubborn'){delta('ready');process.on('SIGTERM',()=>{});setInterval(()=>{},1000);break;}
  if(mode==='tools'){
   delta('before');mcp('mcp-1',7);
   setTimeout(()=>{delta('after');mcp('mcp-2',8);},300);
   setTimeout(()=>send({type:'result',subtype:'success',is_error:false,result:'late'}),600);
  }
 }
}
}
`;

function setup(mode:string){
 const folder=mkdtempSync(join(tmpdir(),'owla-audit-stream-'));
 const fake=join(folder,'fake-claude.mjs'),wrapper=join(folder,'claude'),pidFile=join(folder,'pid');
 writeFileSync(fake,fakeSource);
 writeFileSync(wrapper,'#!/bin/sh\nexec "'+process.execPath+'" "'+fake+'" '+mode+' "'+pidFile+'" "$@"\n',{mode:0o700});
 return {folder,pidFile,wrapper,cleanup:()=>rmSync(folder,{recursive:true,force:true})};
}
function bridgeFor(wrapper:string){
 const bridge=new ClaudeBridge() as any;
 bridge.connect=async()=>{};bridge.executable=wrapper;
 return bridge;
}
function options(wrapper:string,folder:string,signal:AbortSignal,extra:Partial<ProviderRunOptions>={}):ProviderRunOptions{
 return {executable:wrapper,cwd:folder,model:'m',effort:'default',instructions:'',text:'hi',images:[],web:false,signal,
  onText:()=>{},onActivity:()=>{},tools:[{type:'function',name:'read_note',description:'',inputSchema:{type:'object'}}],
  tool:async()=> 'note text',...extra};
}

test('a turn reaps its child after a normal result',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('normal');
 try{
  const bridge=bridgeFor(wrapper);
  const result=await bridge.run(options(wrapper,folder,new AbortController().signal));
  assert.equal(result.text,'done');
  const pid=await waitPid(pidFile);
  assert.ok(await waitDead(pid,4000),'the child must exit after the result');
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('multi-byte UTF-8 split across pipe chunks arrives intact',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('utf8');
 try{
  const bridge=bridgeFor(wrapper);
  const result=await bridge.run(options(wrapper,folder,new AbortController().signal));
  assert.equal(result.text,'héllo 世界 🎉 café');
  assert.ok(await waitDead(await waitPid(pidFile),4000));
 }finally{cleanup();}
});

test('an oversized protocol line fails the turn and reaps the child',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('oversize');
 try{
  const bridge=bridgeFor(wrapper);
  await assert.rejects(bridge.run(options(wrapper,folder,new AbortController().signal)),/too large/);
  assert.ok(await waitDead(await waitPid(pidFile),6000),'the flooded child must be terminated');
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('an oversized handshake line fails readUsage and reaps the child',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('handshake-oversize');
 try{
  const bridge=bridgeFor(wrapper);bridge.cwd=folder;
  await assert.rejects(bridge.readUsage(),/too large/);
  assert.ok(await waitDead(await waitPid(pidFile),4000));
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('abort stops later deltas and tool calls, and reaps the child',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('tools');
 try{
  const bridge=bridgeFor(wrapper);
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
  assert.ok(await waitDead(await waitPid(pidFile),4000));
 }finally{cleanup();}
});

test('a SIGTERM-ignoring child is SIGKILLed after abort instead of orphaned',{timeout:25000},async()=>{
 if(process.platform==='win32')return;
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
  // 2 s grace, then SIGTERM (ignored), then SIGKILL 2 s later.
  assert.ok(await waitDead(await waitPid(pidFile),8000),'the stubborn child must be SIGKILLed');
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('disconnect reaps a hanging handshake child and fails the connect',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,pidFile,wrapper,cleanup}=setup('hang');
 try{
  const bridge=new ClaudeBridge() as any;
  const connecting=bridge.connect(wrapper,folder);
  const pid=await waitPid(pidFile);
  bridge.disconnect();
  await assert.rejects(connecting,/exited during connection|cancelled/);
  assert.ok(await waitDead(pid,4000),'the handshake child must die on disconnect');
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});
