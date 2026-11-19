// Audit: OpenCode resident-server lifecycle — dedup, turn races, abort,
// rest/connect races, stale-server detection and verify-connection restarts.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpencodeBridge} from '../src/opencode';
import type {ToolSpec} from '../src/provider';

const FAKE_SERVER=`
import {createServer} from 'node:http';
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('opencode v2.2.7');process.exit(0);}
const port=Number(args[args.indexOf('--port')+1]);
const password=process.env.OPENCODE_SERVER_PASSWORD||'';
const env=process.env;
const clients=[];
const base={id:'free-model',modelID:'free-model',providerID:'opencode',name:'Free Model',type:'chat',enabled:true,
 capabilities:{tools:true,input:['text','image'],output:['text']},variants:[{id:'low'},{id:'high'}],
 cost:[{input:0,output:0}],limit:{context:128000}};
const models=env.FAKE_DUP==='1'?[base,JSON.parse(JSON.stringify(base))]:[base];
function send(event){for(const client of clients)client.write('data: '+JSON.stringify(event)+'\\n\\n');}
let infoCalls=0;
const server=createServer((req,res)=>{
 const auth=req.headers.authorization||'';
 const expected='Basic '+Buffer.from('opencode:'+password).toString('base64');
 if(auth!==expected){res.writeHead(401);res.end();return;}
 let body='';
 req.on('data',chunk=>body+=chunk);
 req.on('end',()=>{
  const url=req.url||'';
  if(url==='/api/info'){
   infoCalls++;
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({version:'2.2.7',pid:process.pid}));
   return;
  }
  if(url==='/api/model'){
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:models}));
   if(env.FAKE_KILL_HTTP==='1')setTimeout(()=>{server.close();if(server.closeIdleConnections)server.closeIdleConnections();},100);
   return;
  }
  if(url==='/api/experimental/usage/limits'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{}}));return;}
  if(url==='/api/event'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});clients.push(res);res.write('data: '+JSON.stringify({type:'server.connected'})+'\\n\\n');return;}
  if(url==='/api/session'&&req.method==='POST'){
   const delay=Number(env.FAKE_SESSION_DELAY_MS||'0');
   setTimeout(()=>{
    if(res.destroyed)return;
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{id:'ses_test'}}));
   },delay);
   return;
  }
  if(url.startsWith('/api/session/')&&url.endsWith('/prompt')){
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{id:'msg_1'}}));
   setTimeout(async()=>{
    let toolResult='no-tool';
    if(env.FAKE_CALL_TOOL==='1'){
     try{
      const response=await fetch(env.OWLA_TOOL_ENDPOINT+'/tool',{method:'POST',
       headers:{'content-type':'application/json',authorization:'Bearer '+env.OWLA_TOOL_TOKEN},
       body:JSON.stringify({tool:'read_note',args:{path:'Note.md'}})});
      const payload=await response.json();
      toolResult=payload.error?('ERROR '+payload.error):String(payload.text);
     }catch(error){toolResult='CALLBACK FAILED '+String(error);}
    }
    send({type:'session.text.delta',data:{sessionID:'ses_test',delta:'Tool said: '+toolResult}});
    send({type:'session.execution.succeeded',data:{sessionID:'ses_test'}});
   },10);
   return;
  }
  if(url.startsWith('/api/session/')&&req.method==='DELETE'){res.writeHead(200);res.end('true');return;}
  res.writeHead(404);res.end();
 });
});
server.listen(port,'127.0.0.1',()=>console.log('listening'));
if(env.FAKE_KILL_HTTP==='1')setInterval(()=>{},1000);
`;

const READ_NOTE:ToolSpec={type:'function',name:'read_note',description:'Read a note',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function makeFake(root:string,env:Record<string,string>={}):string{
 const serverFile=join(root,'fake-opencode.mjs');
 writeFileSync(serverFile,FAKE_SERVER);
 const executable=join(root,process.platform==='win32'?'opencode.cmd':'opencode');
 if(process.platform==='win32'){
  const sets=Object.entries(env).map(([key,value])=>'set '+key+'='+value).join('\r\n');
  writeFileSync(executable,'@echo off\r\n'+sets+'\r\n"'+process.execPath+'" "'+serverFile+'" %*\r\n');
 }else{
  const exports=Object.entries(env).map(([key,value])=>'export '+key+'="'+value+'"').join('\n');
  writeFileSync(executable,'#!/bin/sh\n'+exports+'\nexec "'+process.execPath+'" "'+serverFile+'" "$@"\n',{mode:0o700});
  chmodSync(executable,0o700);
 }
 return executable;
}

async function withBridge(env:Record<string,string>,body:(bridge:OpencodeBridge,executable:string,workdir:string)=>Promise<void>){
 const root=mkdtempSync(join(tmpdir(),'owla-audit-opencode-'));
 const workdir=join(root,'session');
 mkdirSync(workdir,{recursive:true});
 const executable=makeFake(root,env);
 const bridge=new OpencodeBridge();
 try{await body(bridge,executable,workdir);}
 finally{
  bridge.disconnect();
  await (bridge as unknown as {closing:Promise<void>}).closing;
  rmSync(root,{recursive:true,force:true});
 }
}

const runOptions=(executable:string,workdir:string,extra:Partial<Parameters<OpencodeBridge['run']>[0]>={})=>({
 executable,cwd:workdir,model:'opencode/free-model',effort:'low',instructions:'Answer.',text:'Hello',
 images:[],tools:[READ_NOTE],web:false,signal:new AbortController().signal,
 onText:()=>{},onActivity:()=>{},tool:async()=>'' as string,...extra
});

test('a duplicated catalogue entry is offered once',async()=>{
 await withBridge({FAKE_DUP:'1'},async(bridge,executable,workdir)=>{
  await bridge.connect(executable,workdir,false,[READ_NOTE]);
  assert.equal(bridge.models.length,1);
  assert.equal(bridge.selectableModels.length,1);
  assert.equal(bridge.models[0].id,'opencode/free-model');
 });
});

test('a second concurrent run is refused without disturbing the first turn',async()=>{
 await withBridge({FAKE_SESSION_DELAY_MS:'400',FAKE_CALL_TOOL:'1'},async(bridge,executable,workdir)=>{
  await bridge.connect(executable,workdir,false,[READ_NOTE]);
  const calls:{name:string;args:unknown}[]=[];
  const first=bridge.run(runOptions(executable,workdir,{tool:async(name,args)=>{calls.push({name,args});return 'Note body';}}));
  await sleep(100);
  // The first turn is still creating its session; the second must not race it.
  await assert.rejects(bridge.run(runOptions(executable,workdir)),/already responding/);
  const result=await first;
  assert.match(result.text,/Tool said: Note body/);
  assert.deepEqual(calls,[{name:'read_note',args:{path:'Note.md'}}]);
  assert.equal((bridge as unknown as {active:unknown}).active,null);
 });
});

test('stopping during session creation ends the turn promptly',async()=>{
 await withBridge({FAKE_SESSION_DELAY_MS:'5000'},async(bridge,executable,workdir)=>{
  await bridge.connect(executable,workdir,false,[READ_NOTE]);
  const controller=new AbortController();
  const pending=bridge.run(runOptions(executable,workdir,{signal:controller.signal}));
  await sleep(150);
  controller.abort();
  const start=Date.now();
  await assert.rejects(pending,/Stopped/);
  assert.ok(Date.now()-start<2000,'the abort must not wait for the 30s session timeout');
  assert.equal((bridge as unknown as {active:unknown}).active,null);
 });
});

test('a rest waits for an in-flight connect instead of cancelling it',async()=>{
 await withBridge({},async(bridge,executable,workdir)=>{
  const release=bridge.hold();
  const connecting=bridge.connect(executable,workdir,false,[READ_NOTE]);
  const resting=release();
  await connecting;
  await resting;
  assert.equal(bridge.ready,false,'the server rests once the connect it waited for completes');
  assert.match(bridge.status,/resting/);
 });
});

test('a resident server that stopped answering is detected and restarted',async()=>{
 await withBridge({FAKE_KILL_HTTP:'1'},async(bridge,executable,workdir)=>{
  await bridge.connect(executable,workdir,false,[READ_NOTE]);
  assert.ok(bridge.ready);
  const first=(bridge as unknown as {child:{pid:number}}).child;
  await sleep(400);
  // The process lives but its HTTP endpoint is gone: the stale state.
  assert.ok(bridge.ready);
  await bridge.connect(executable,workdir,false,[READ_NOTE]);
  assert.ok(bridge.ready);
  const second=(bridge as unknown as {child:{pid:number}}).child;
  assert.notEqual(first.pid,second.pid,'the stale server must be replaced');
  assert.equal(bridge.models.length,1);
 });
});

test('verify connection restarts a healthy resident server',async()=>{
 await withBridge({},async(bridge,executable,workdir)=>{
  await bridge.connect(executable,workdir,false,[READ_NOTE]);
  const first=(bridge as unknown as {child:{pid:number}}).child;
  bridge.recheck();
  await bridge.connect(executable,workdir,false,[READ_NOTE]);
  const second=(bridge as unknown as {child:{pid:number}}).child;
  assert.notEqual(first.pid,second.pid);
  assert.ok(bridge.ready);
 });
});

test('concurrent connects share one server and a different mode waits',async()=>{
 await withBridge({},async(bridge,executable,workdir)=>{
  const a=bridge.connect(executable,workdir,false,[READ_NOTE]);
  const b=bridge.connect(executable,workdir,false,[READ_NOTE]);
  const other=bridge.connect(executable,workdir,true,[READ_NOTE]);
  await assert.rejects(other,/Wait for the current OpenCode connection/);
  await Promise.all([a,b]);
  assert.ok(bridge.ready);
  assert.equal(bridge.models.length,1);
 });
});

test('the last holder resting the server leaves it stopped until needed',async()=>{
 await withBridge({},async(bridge,executable,workdir)=>{
  await bridge.connect(executable,workdir,false,[READ_NOTE]);
  const first=bridge.hold(),second=bridge.hold();
  await first();
  assert.ok(bridge.ready,'one holder still keeps the server');
  await second();
  assert.equal(bridge.ready,false);
  assert.match(bridge.status,/resting/);
 });
});

test('a turn with changed tools reconnects with the new tool set',async()=>{
 await withBridge({FAKE_CALL_TOOL:'1'},async(bridge,executable,workdir)=>{
  const first=await bridge.run(runOptions(executable,workdir,{tool:async()=>'Note body'}));
  assert.match(first.text,/Tool said: Note body/);
  const extra:ToolSpec={type:'function',name:'propose_edit',description:'Edit',inputSchema:{type:'object',properties:{}}};
  const second=await bridge.run(runOptions(executable,workdir,{tools:[READ_NOTE,extra],tool:async()=>'Note body'}));
  assert.match(second.text,/Tool said: Note body/);
  const tools=JSON.parse((await import('node:fs')).readFileSync(join(workdir,'owla-tools.json'),'utf8')) as {name:string}[];
  assert.deepEqual(tools.map(tool=>tool.name),['read_note','propose_edit']);
 });
});
