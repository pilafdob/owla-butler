// Failure-resilience audit: real-process failure paths of the Codex bridge.
// A fault-injecting fake `codex` exercises spawn/exit/protocol failures without
// ever contacting a model. Modes:
//   exit-stderr  app-server prints a panic to stderr, then exits non-zero
//   silent-exit  app-server exits 0 without answering the handshake
//   bad-json     app-server answers initialize with a non-JSON line
//   model-loop   model/list returns a fresh cursor on every page, forever
//   turn-exit    app-server dies mid-turn, with a stderr cause
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexBridge,MAX_MODEL_PAGES} from '../src/codex';

const FAKE=`import {appendFileSync} from 'node:fs';
import {join} from 'node:path';
const [mode,dir,...args]=process.argv.slice(2);
if(args[0]==='--version'){console.log('codex-cli 0.169.0');process.exit(0);}
if(mode==='exit-stderr'){console.error("thread 'main' panicked at src/config.rs:42");setTimeout(()=>process.exit(1),80);}
else if(mode==='silent-exit'){setTimeout(()=>process.exit(0),80);}
else{
 let buffer='';let page=0;
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{
  buffer+=chunk;let index;
  while((index=buffer.indexOf('\\n'))>=0){
   const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
   if(!line.trim())continue;
   const message=JSON.parse(line);
   if(message.id===undefined)continue;
   if(mode==='bad-json'&&message.method==='initialize'){process.stdout.write('this is not json\\n');continue;}
   let result={};
   if(message.method==='config/read')result={config:{notify:[],hooks:null,sandbox_mode:'read-only',approval_policy:'never',features:{shell_tool:false,apps:false},analytics:{enabled:false},feedback:{enabled:false},otel:{exporter:'none',trace_exporter:'none',metrics_exporter:'none'}}};
   else if(message.method==='account/read')result={account:{type:'chatgpt',planType:'plus'}};
   else if(message.method==='thread/start')result={thread:{id:'t1'}};
   else if(message.method==='model/list'){
    page++;
    if(mode==='model-loop')appendFileSync(join(dir,'pages.txt'),'page '+page+'\\n');
    result={data:[{id:'fake',model:'fake',displayName:'Fake',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:''}]}],nextCursor:mode==='model-loop'?'page-'+page:null};
   }
   else if(message.method==='turn/start'){
    process.stdout.write(JSON.stringify({id:message.id,result:{turn:{id:'turn1'}}})+'\\n');
    if(mode==='turn-exit'){console.error('turn worker panicked');setTimeout(()=>process.exit(1),60);}
    continue;
   }
   process.stdout.write(JSON.stringify({id:message.id,result})+'\\n');
  }
 });
}
`;

async function fakeCodex(mode:string){
 const folder=mkdtempSync(join(tmpdir(),'owla-audit-codex-'));
 const script=join(folder,'fake.mjs');
 writeFileSync(script,FAKE);
 let file:string;
 if(process.platform==='win32'){
  file=join(folder,'codex.cmd');
  writeFileSync(file,'@echo off\r\n"'+process.execPath+'" "'+script+'" '+mode+' "'+folder+'" %*\r\n');
 }else{
  file=join(folder,'codex');
  writeFileSync(file,'#!/bin/sh\nexec "'+process.execPath+'" "'+script+'" '+mode+' "'+folder+'" "$@"\n',{mode:0o700});
 }
 const bridge=new CodexBridge();
 const cwd=join(folder,'session');
 const cleanup=async()=>{bridge.disconnect();await (bridge as any).closing;rmSync(folder,{recursive:true,force:true});};
 return {folder,file,cwd,bridge,cleanup};
}

const runOptions=(file:string,cwd:string)=>({executable:file,cwd,model:'fake',effort:'low',instructions:'',text:'hello',images:[],tools:[],web:false,signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},tool:async()=>''});

test('an unexpected app-server exit surfaces the stderr cause, not a generic disconnect',async()=>{
 const fake=await fakeCodex('exit-stderr');
 try{
  await assert.rejects(fake.bridge.connect(fake.file,fake.cwd),/disconnected/);
  assert.match(fake.bridge.status,/Last error: .*panicked at src\/config\.rs:42/);
  assert.equal(fake.bridge.running,false);
 }finally{await fake.cleanup();}
});

test('a silent app-server exit still rejects the pending handshake promptly',async()=>{
 const fake=await fakeCodex('silent-exit');
 try{
  await assert.rejects(fake.bridge.connect(fake.file,fake.cwd),/disconnected/);
  assert.doesNotMatch(fake.bridge.status,/Last error/);
  assert.equal(fake.bridge.running,false);
 }finally{await fake.cleanup();}
});

test('malformed protocol output disconnects with a quoted snippet of the bad line',async()=>{
 const fake=await fakeCodex('bad-json');
 try{
  await assert.rejects(fake.bridge.connect(fake.file,fake.cwd),/invalid protocol message/);
  assert.match(fake.bridge.status,/this is not json/);
  assert.equal(fake.bridge.running,false);
 }finally{await fake.cleanup();}
});

test('a looping model catalog is capped instead of holding the connection forever',async()=>{
 const fake=await fakeCodex('model-loop');
 try{
  await assert.rejects(fake.bridge.connect(fake.file,fake.cwd),/too many model catalog pages/);
  assert.equal(fake.bridge.running,false);
  const pages=readFileSync(join(fake.folder,'pages.txt'),'utf8').trim().split('\n');
  assert.equal(pages.length,MAX_MODEL_PAGES);
 }finally{await fake.cleanup();}
});

test('a disconnect mid-turn rejects the reply with the stderr cause and stops the process',async()=>{
 const fake=await fakeCodex('turn-exit');
 try{
  await assert.rejects(fake.bridge.run(runOptions(fake.file,fake.cwd)),/disconnected/);
  assert.match(fake.bridge.status,/Last error: turn worker panicked/);
  assert.equal(fake.bridge.running,false);
  assert.equal((fake.bridge as any).active,null);
 }finally{await fake.cleanup();}
});