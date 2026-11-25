// Windows hardening (round 2): OpenCode startup port reservation (M7).
// freePort() releases its probe before the child binds; another process, a
// second OWLA window, or a Windows excluded port range can take the port in
// between, and a command shim needs hundreds of milliseconds to reach the
// bind. The startup must retry with a fresh port, bounded, keeping the cause.
// Fake servers only — no model turn, no real CLI.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpencodeBridge} from '../src/opencode';

// The fake counts serve attempts in a marker file inside its cwd (the private
// storage directory). Mode FAKE_STARTUP_MODE:
//  race       — the first attempt dies with the Windows bind error (the port
//               was taken between OWLA's probe and the child's bind);
//  silent     — the first attempt dies without any stderr (OpenCode does not
//               print server logs to stderr unless --print-logs is set);
//  always-die — every attempt dies with a stderr cause;
//  ok         — healthy from the first attempt.
const FAKE=`
import {createServer} from 'node:http';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('opencode v2.2.7');process.exit(0);}
const port=Number(args[args.indexOf('--port')+1]);
const marker='startup-attempts.log';
const attempts=existsSync(marker)?Number(readFileSync(marker,'utf8')):0;
writeFileSync(marker,String(attempts+1));
const mode=process.env.FAKE_STARTUP_MODE||'race';
if(mode==='slow-die'&&attempts===0){
 // Stay alive but silent, then die: a window for a user disconnect mid-startup.
 await new Promise(r=>setTimeout(r,1500));
 process.stderr.write('listen tcp 127.0.0.1:'+port+': bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.'+String.fromCharCode(10));
 process.exit(1);
}
if(mode==='always-die'||(attempts===0&&mode!=='ok')){
 if(mode!=='silent')process.stderr.write('listen tcp 127.0.0.1:'+port+': bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.'+String.fromCharCode(10));
 process.exit(1);
}
const password=process.env.OPENCODE_SERVER_PASSWORD||'';
const clients=[];
const models=[{id:'m',modelID:'m',providerID:'opencode',name:'M',type:'chat',enabled:true,capabilities:{input:['text']},limit:{context:128000}}];
const send=e=>{for(const c of clients)c.write('data: '+JSON.stringify(e)+String.fromCharCode(10,10));};
const server=createServer((req,res)=>{
 const auth=req.headers.authorization||'';
 if(auth!=='Basic '+Buffer.from('opencode:'+password).toString('base64')){res.writeHead(401);res.end();return;}
 let body='';req.on('data',c=>body+=c);
 req.on('end',()=>{
  const url=req.url||'';
  if(url==='/api/info'){res.writeHead(200);res.end(JSON.stringify({version:'2.2.7',pid:process.pid}));return;}
  if(url==='/api/model'){res.writeHead(200);res.end(JSON.stringify({data:models}));return;}
  if(url==='/api/experimental/usage/limits'){res.writeHead(200);res.end(JSON.stringify({data:null}));return;}
  if(url==='/api/event'){res.writeHead(200,{'content-type':'text/event-stream'});clients.push(res);res.write('data: {"type":"server.connected"}'+String.fromCharCode(10,10));return;}
  if(url==='/api/session'&&req.method==='POST'){res.writeHead(200);res.end(JSON.stringify({data:{id:'ses_win'}}));return;}
  if(url.endsWith('/prompt')){
   res.writeHead(200);res.end(JSON.stringify({data:{id:'msg'}}));
   setTimeout(()=>{
    send({type:'session.text.delta',data:{sessionID:'ses_win',delta:'ok'}});
    send({type:'session.execution.succeeded',data:{sessionID:'ses_win'}});
   },10);
   return;
  }
  if(url.startsWith('/api/session/')&&req.method==='DELETE'){res.writeHead(200);res.end('true');return;}
  res.writeHead(404);res.end();
 });
});
server.listen(port,'127.0.0.1');
`;

function setup(mode:string){
 const root=mkdtempSync(join(tmpdir(),'owla-win-providers-'));
 const workdir=join(root,'session');mkdirSync(workdir,{recursive:true});
 const serverFile=join(root,'fake-opencode.mjs');writeFileSync(serverFile,FAKE);
 const executable=join(root,process.platform==='win32'?'opencode.cmd':'opencode');
 if(process.platform==='win32')writeFileSync(executable,'@echo off\r\nset FAKE_STARTUP_MODE='+mode+'\r\n"'+process.execPath+'" "'+serverFile+'" %*\r\n');
 else{writeFileSync(executable,'#!/bin/sh\nexport FAKE_STARTUP_MODE="'+mode+'"\nexec "'+process.execPath+'" "'+serverFile+'" "$@"\n',{mode:0o700});chmodSync(executable,0o700);}
 return {root,workdir,executable,
  attempts:()=>existsSync(join(workdir,'startup-attempts.log'))?Number(readFileSync(join(workdir,'startup-attempts.log'),'utf8')):0,
  // Windows: the bridge's taskkill /T runs detached, so under load the fake
  // server (a cmd.exe grandchild) can hold the folder for a few seconds after
  // the bridge closes. Wait for it, bounded; a temp folder still held after
  // that is left for the OS and is not a lifecycle failure.
  cleanup:async()=>{
   for(let attempt=0;;attempt++){
    try{rmSync(root,{recursive:true,force:true});return;}
    catch(error){
     const code=(error as NodeJS.ErrnoException).code;
     if(code!=='EPERM'&&code!=='EBUSY'&&code!=='ENOTEMPTY')throw error;
     if(attempt>=40){console.warn('left temporary folder '+root+' ('+code+')');return;}
     await new Promise(resolve=>setTimeout(resolve,250));
    }
   }
  }};
}
async function withBridge(mode:string,body:(bridge:OpencodeBridge,executable:string,workdir:string,attempts:()=>number)=>Promise<void>){
 const {workdir,executable,attempts,cleanup}=setup(mode);
 const bridge=new OpencodeBridge();
 try{await body(bridge,executable,workdir,attempts);}
 finally{
  bridge.disconnect();
  await (bridge as unknown as {closing:Promise<void>}).closing;
  await cleanup();
 }
}
const runOptions=(executable:string,workdir:string)=>({
 executable,cwd:workdir,model:'opencode/m',effort:'default',instructions:'',text:'hi',images:[],tools:[],web:false,
 signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},tool:async()=>'x'
});

test('a port taken between the probe and the child bind is retried with a fresh port',{timeout:30000},async()=>{
 await withBridge('race',async(bridge,executable,workdir,attempts)=>{
  await bridge.connect(executable,workdir,false,[]);
  assert.ok(bridge.ready);
  assert.equal(bridge.models.length,1);
  assert.equal(attempts(),2,'the dead first bind must be retried exactly once');
 });
});

test('a silent early death with no stderr cause is still retried',{timeout:30000},async()=>{
 await withBridge('silent',async(bridge,executable,workdir,attempts)=>{
  await bridge.connect(executable,workdir,false,[]);
  assert.ok(bridge.ready);
  assert.equal(attempts(),2,'a child that died before answering cannot serve; retry without a stderr signature');
 });
});

test('a persistent startup crash stays bounded and keeps its cause',{timeout:30000},async()=>{
 await withBridge('always-die',async(bridge,executable,workdir,attempts)=>{
  const started=Date.now();
  await assert.rejects(bridge.connect(executable,workdir,false,[]),/Last error: listen tcp 127\.0\.0\.1:\d+: bind/);
  assert.equal(attempts(),3,'the retry budget is bounded');
  assert.ok(Date.now()-started<15000,'each attempt fails fast; no 20 s polling of a dead port');
  assert.equal(bridge.ready,false);
 });
});

test('a healthy connect does not retry',{timeout:30000},async()=>{
 await withBridge('ok',async(bridge,executable,workdir,attempts)=>{
  await bridge.connect(executable,workdir,false,[]);
  assert.ok(bridge.ready);
  assert.equal(attempts(),1);
 });
});

test('a disconnect during a failing startup is not undone by the retry',{timeout:30000},async()=>{
 const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
 await withBridge('slow-die',async(bridge,executable,workdir,attempts)=>{
  const connecting=bridge.connect(executable,workdir,false,[]);
  // Wait until the first serve attempt is alive but silent, then disconnect.
  const deadline=Date.now()+8000;
  while(!existsSync(join(workdir,'startup-attempts.log'))&&Date.now()<deadline)await sleep(50);
  bridge.disconnect('User disconnected');
  await assert.rejects(connecting,/cancelled/);
  assert.equal(attempts(),1,'a user disconnect must not be retried into a fresh server');
  assert.equal(bridge.ready,false);
 });
});

test('two runs started together share the connect and the turn slot',{timeout:30000},async()=>{
 await withBridge('ok',async(bridge,executable,workdir)=>{
  // Both runs race the same slow Windows startup (command shim → node); the
  // connect is deduplicated and the turn slot is reserved synchronously.
  const first=bridge.run(runOptions(executable,workdir));
  const second=bridge.run(runOptions(executable,workdir));
  await assert.rejects(second,/already responding/);
  const result=await first;
  assert.equal(result.text,'ok');
  assert.equal((bridge as unknown as {active:unknown}).active,null);
  assert.equal(bridge.ready,false,'the server rests after the turn');
 });
});
