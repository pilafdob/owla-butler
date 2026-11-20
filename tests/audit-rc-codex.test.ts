// Regression tests for the orchestrator's cross-file pass on src/codex.ts
// (3.7.0 RC; providers U1/U4/U5, security L15). Fault-injecting fake codex
// app-server — no model turn.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {CodexBridge,friendlyError} from '../src/codex';

const FAKE=`import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [mode,dir,...args]=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex-cli 0.169.0');process.exit(0);}
let buffer='';let page=0;
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
 buffer+=chunk;let index;
 while((index=buffer.indexOf('\\n'))>=0){
  const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
  if(!line.trim())continue;
  const message=JSON.parse(line);
  if(message.id===undefined)continue;
  let result={};
  if(message.method==='config/read')result={config:{notify:[],hooks:null,sandbox_mode:'read-only',approval_policy:'never',features:{shell_tool:false,apps:false},analytics:{enabled:false},feedback:{enabled:false},otel:{exporter:'none',trace_exporter:'none',metrics_exporter:'none'}}};
  else if(message.method==='account/read')result={account:{type:'chatgpt',planType:'plus'}};
  else if(message.method==='thread/start')result={thread:{id:'t1'}};
  else if(message.method==='model/list'){
   page++;
   result={data:[{id:'fake',model:'fake',displayName:'Fake',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:''}]}],nextCursor:mode==='dup-models'&&page===1?'p2':null};
  }
  else if(message.method==='turn/start'){
   if(mode==='start-limit'){process.stdout.write(JSON.stringify({id:message.id,error:{code:-32000,message:'usage limit reached'}})+'\\n');continue;}
   let turns=0;try{turns=Number(readFileSync(join(dir,'turns.txt'),'utf8'))||0;}catch{}
   turns++;writeFileSync(join(dir,'turns.txt'),String(turns));
   process.stdout.write(JSON.stringify({id:message.id,result:{turn:{id:'turn1'}}})+'\\n');
   const failed=mode==='turn-limit'||(mode==='limit-then-ok'&&turns===1);
   setTimeout(()=>{
    process.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:'t1',turn:{id:'turn1',status:failed?'failed':'completed',error:failed?{message:'rate_limit_exceeded: weekly limit'}:null}}})+'\\n');
   },30);
   continue;
  }
  process.stdout.write(JSON.stringify({id:message.id,result})+'\\n');
 }
});
`;

async function fakeCodex(mode:string){
 const folder=mkdtempSync(join(tmpdir(),'owla-audit-rc-codex-'));
 const script=join(folder,'fake.mjs');
 writeFileSync(script,FAKE);
 let file:string;
 if(process.platform==='win32'){
  // A .cmd shim, like npm's global codex shim: the real Windows launch path.
  file=join(folder,'codex.cmd');
  writeFileSync(file,'@echo off\r\n"'+process.execPath+'" "'+script+'" '+mode+' "'+folder+'" %*\r\n');
 }else{
  file=join(folder,'codex');
  writeFileSync(file,'#!/bin/sh\nexec "'+process.execPath+'" "'+script+'" '+mode+' "'+folder+'" "$@"\n',{mode:0o700});
 }
 const bridge=new CodexBridge();
 const cwd=join(folder,'session');
 const cleanup=async()=>{bridge.disconnect();await (bridge as unknown as {closing:Promise<void>}).closing;rmSync(folder,{recursive:true,force:true});};
 return {folder,file,cwd,bridge,cleanup};
}
const runOptions=(file:string,cwd:string)=>({executable:file,cwd,model:'fake',effort:'low',instructions:'',text:'hello',images:[],tools:[],web:false,signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},tool:async()=>''});

test('a failed turn with a limit error records exhaustion with a bounded retry',async()=>{
 const fake=await fakeCodex('turn-limit');
 try{
  await assert.rejects(fake.bridge.run(runOptions(fake.file,fake.cwd)),/rate_limit_exceeded/);
  const state=fake.bridge.exhaustion;
  assert.ok(state?.exhausted,'the limit error must record exhaustion even without full meters');
  assert.equal(state?.provider,'codex');
  const retry=(state?.resetsAt??0)-Date.now()/1000;
  assert.ok(retry>800&&retry<=900,'a meter-less limit holds Codex back for ~15 minutes, not forever');
 }finally{await fake.cleanup();}
});

test('a rejected turn/start with a limit error records exhaustion too',async()=>{
 const fake=await fakeCodex('start-limit');
 try{
  await assert.rejects(fake.bridge.run(runOptions(fake.file,fake.cwd)),/usage limit reached/);
  assert.ok(fake.bridge.exhaustion?.exhausted);
 }finally{await fake.cleanup();}
});

test('a completed turn clears the recorded limit exhaustion',async()=>{
 const fake=await fakeCodex('limit-then-ok');
 try{
  await assert.rejects(fake.bridge.run(runOptions(fake.file,fake.cwd)),/rate_limit_exceeded/);
  assert.ok(fake.bridge.exhaustion?.exhausted);
  const result=await fake.bridge.run(runOptions(fake.file,fake.cwd));
  assert.equal(result.text,'');
  assert.equal(fake.bridge.exhaustion,null,'a successful turn must clear the limit state');
 }finally{await fake.cleanup();}
});

test('a model repeated across catalog pages is offered once',async()=>{
 const fake=await fakeCodex('dup-models');
 try{
  await fake.bridge.connect(fake.file,fake.cwd);
  assert.equal(fake.bridge.models.length,1);
 }finally{await fake.cleanup();}
});

test('friendlyError redacts tokens, credential assignments and home paths',()=>{
 const bearer='Bearer abc.def-123';
 const assignment='token='+'supersecret';
 const raw='request failed: '+bearer+' '+assignment+' at '+homedir()+'/notes';
 const out=friendlyError(Error(raw));
 assert.ok(!out.includes('abc.def-123'),'bearer token must not reach chat/status');
 assert.ok(!out.includes('supersecret'),'credential assignment must not reach chat/status');
 assert.ok(!out.includes(homedir()),'the home path must be shortened to ~');
 assert.match(out,/Bearer \[redacted\]/);
 assert.match(out,/token=\[redacted\]/);
 // Provider-worded pass-throughs are redacted too, not remapped to Codex.
 const hermes=friendlyError(Error('Hermes gateway rejected '+bearer));
 assert.match(hermes,/^Hermes gateway rejected Bearer \[redacted\]/);
});