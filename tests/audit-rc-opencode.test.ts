// Regression tests for the orchestrator's cross-file pass on src/opencode.ts
// (3.7.0 RC; failure P2 + the codex-F2 class, security L1/L12). Fake OpenCode
// servers only — no model turn, no real CLI.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {OpencodeBridge,isolatedOpencodeEnv} from '../src/opencode';

test('inherited OPENCODE_* behaviour variables are stripped; OWLA’s own isolation stays',{timeout:10000},async()=>{
 const directory=mkdtempSync(join(tmpdir(),'owla-audit-oc-env-'));
 try{
  const env=isolatedOpencodeEnv({
   PATH:'/usr/bin',
   OPENCODE_PTY_HANDOFF:'1',OPENCODE_SIMULATE:'1',OPENCODE_MODELS_URL:'https://example.test',
   OPENCODE_MODELS_PATH:'/tmp/models.json',OPENCODE_GIT_BASH_PATH:'/bin/bash',OPENCODE_CLIENT:'desktop',
   OPENCODE_CONFIG:'/tmp/evil.json',OPENCODE_CONFIG_CONTENT:'{}',OPENCODE_PERMISSION:'ask',
   OPENCODE_DISABLE_AUTOUPDATE:'0',
   ANTHROPIC_API_KEY:'sk-'+'test',
   OPENCODE_API_KEY:'oc-'+'key',
  },directory);
  for(const key of ['OPENCODE_PTY_HANDOFF','OPENCODE_SIMULATE','OPENCODE_MODELS_URL','OPENCODE_MODELS_PATH','OPENCODE_GIT_BASH_PATH','OPENCODE_CLIENT','OPENCODE_CONFIG','OPENCODE_CONFIG_CONTENT','OPENCODE_PERMISSION'])
   assert.equal(env[key],undefined,key+' must not reach the isolated server');
  assert.equal(env.OPENCODE_DISABLE_AUTOUPDATE,'1','OWLA’s switch wins over an inherited value');
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG,'1');
  assert.equal(env.XDG_CONFIG_HOME,join(directory,'config'));
  assert.equal(env.ANTHROPIC_API_KEY,'sk-'+'test','provider sign-ins stay');
  assert.equal(env.OPENCODE_API_KEY,'oc-'+'key','OpenCode provider credentials stay');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

// One fake server, two behaviours: argv[2] selects the mode. `die` crashes at
// startup with a stderr cause; `gate` emits foreign and unscoped session events
// before the real ones.
const FAKE=`
import {createServer} from 'node:http';
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('opencode v2.3.0');process.exit(0);}
if(args[0]==='die'){process.stderr.write('opencode boom: port conflict\\n');process.exit(1);}
const port=Number(args[args.indexOf('--port')+1]);
const password=process.env.OPENCODE_SERVER_PASSWORD||'';
const clients=[];
const send=e=>{for(const c of clients)c.write('data: '+JSON.stringify(e)+'\\n\\n');};
const models=[{id:'m',modelID:'m',providerID:'opencode',name:'M',type:'chat',enabled:true,capabilities:{input:['text']},limit:{context:128000}}];
const server=createServer((req,res)=>{
 const auth=req.headers.authorization||'';
 if(auth!=='Basic '+Buffer.from('opencode:'+password).toString('base64')){res.writeHead(401);res.end();return;}
 let body='';req.on('data',c=>body+=c);
 req.on('end',()=>{
  const url=req.url||'';
  if(url==='/api/info'){res.writeHead(200);res.end(JSON.stringify({version:'2.3.0'}));return;}
  if(url==='/api/model'){res.writeHead(200);res.end(JSON.stringify({data:models}));return;}
  if(url==='/api/experimental/usage/limits'){res.writeHead(200);res.end(JSON.stringify({data:null}));return;}
  if(url==='/api/event'){res.writeHead(200,{'content-type':'text/event-stream'});clients.push(res);res.write('data: {"type":"server.connected"}'+String.fromCharCode(10,10));return;}
  if(url==='/api/session'&&req.method==='POST'){res.writeHead(200);res.end(JSON.stringify({data:{id:'ses_mine'}}));return;}
  if(url.endsWith('/prompt')){
   res.writeHead(200);res.end(JSON.stringify({data:{id:'msg'}}));
   setTimeout(()=>{
    send({type:'session.text.delta',data:{sessionID:'ses_other',delta:'FOREIGN '}});
    send({type:'session.text.delta',data:{delta:'UNSCOPED '}});
    send({type:'session.execution.succeeded',data:{sessionID:'ses_other'}});
    send({type:'session.execution.succeeded',data:{}});
    setTimeout(()=>{
     send({type:'session.text.delta',data:{sessionID:'ses_mine',delta:'mine'}});
     send({type:'session.execution.succeeded',data:{sessionID:'ses_mine'}});
    },150);
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
 const root=mkdtempSync(join(tmpdir(),'owla-audit-opencode-'));
 const workdir=join(root,'session');mkdirSync(workdir,{recursive:true});
 const serverFile=join(root,'fake-opencode.mjs');writeFileSync(serverFile,FAKE);
 const executable=join(root,process.platform==='win32'?'opencode.cmd':'opencode');
 if(process.platform==='win32')writeFileSync(executable,'@echo off\r\n"'+process.execPath+'" "'+serverFile+'" '+mode+' %*\r\n');
 else{writeFileSync(executable,'#!/bin/sh\nexec "'+process.execPath+'" "'+serverFile+'" '+mode+' "$@"\n',{mode:0o700});chmodSync(executable,0o700);}
 return {root,workdir,executable,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const tools=[{type:'function' as const,name:'read_note',description:'',inputSchema:{type:'object'}}];

test('a startup crash surfaces the stderr cause promptly, not "cancelled" after 20 s',{timeout:20000},async()=>{
 const {workdir,executable,cleanup}=setup('die');
 try{
  const bridge=new OpencodeBridge();
  const started=Date.now();
  await assert.rejects(bridge.connect(executable,workdir,false,tools),/Last error: opencode boom: port conflict/);
  assert.ok(Date.now()-started<10000,'the dead child must not be polled for the full startup budget');
 }finally{cleanup();}
});

test('foreign and unscoped session events cannot stream text or settle the turn',{timeout:30000},async()=>{
 const {workdir,executable,cleanup}=setup('gate');
 try{
  const bridge=new OpencodeBridge();
  const seen:string[]=[];
  const result=await bridge.run({executable,cwd:workdir,model:'opencode/m',effort:'default',instructions:'',text:'hi',images:[],web:false,
   signal:new AbortController().signal,onText:(delta)=>seen.push(delta),onActivity:()=>{},tools,tool:async()=>'x'});
  assert.equal(result.text,'mine','only this session’s deltas may reach the answer');
  assert.deepEqual(seen,['mine']);
 }finally{cleanup();}
});