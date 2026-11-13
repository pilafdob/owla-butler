import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,readFileSync,existsSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpencodeBridge} from '../src/opencode';

const FAKE_SERVER=`
import {createServer} from 'node:http';
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('opencode v2.2.7');process.exit(0);}
const port=Number(args[args.indexOf('--port')+1]);
const password=process.env.OPENCODE_SERVER_PASSWORD||'';
const clients=[];
const models=[{id:'free-model',modelID:'free-model',providerID:'opencode',name:'Free Model',type:'chat',enabled:true,
 capabilities:{tools:true,input:['text','image'],output:['text']},variants:[{id:'low'},{id:'high'}],
 cost:[{input:0,output:0,cache:{read:0,write:0}}],limit:{context:128000}}];
function send(event){for(const client of clients)client.write('data: '+JSON.stringify(event)+'\\n\\n');}
const server=createServer((req,res)=>{
 const auth=req.headers.authorization||'';\n const expected='Basic '+Buffer.from('opencode:'+password).toString('base64');
 if(auth!==expected){res.writeHead(401);res.end();return;}
 let body='';
 req.on('data',chunk=>body+=chunk);
 req.on('end',async()=>{
  const url=req.url||'';
  if(url==='/api/info'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({version:'2.2.7',pid:process.pid}));return;}
  if(url==='/api/model'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({location:{directory:'/tmp'},data:models}));return;}
  if(url==='/api/experimental/usage/limits'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({location:{directory:'/tmp'},data:{workspace:{id:'w',usageURL:'https://example.com'},go:{rolling:{percent:12,limited:true,resetsAt:1800000000000},weekly:{percent:0,limited:false,resetsAt:0},monthly:{percent:0,limited:false,resetsAt:0}},budgets:[]}}));return;}
  if(url==='/api/event'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});clients.push(res);res.write('data: '+JSON.stringify({type:'server.connected'})+'\\n\\n');return;}
  if(url==='/api/session'&&req.method==='POST'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{id:'ses_test',location:{directory:'/tmp'}}}));return;}
  if(url.startsWith('/api/session/')&&url.endsWith('/prompt')){
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:{id:'msg_1'}}));
   let toolResult='';
   try{
    const response=await fetch(process.env.OWLA_TOOL_ENDPOINT+'/tool',{method:'POST',
     headers:{'content-type':'application/json',authorization:'Bearer '+process.env.OWLA_TOOL_TOKEN},
     body:JSON.stringify({tool:'read_note',args:{path:'Note.md'}})});
    const payload=await response.json();
    toolResult=payload.error?('ERROR '+payload.error):String(payload.text);
    const forged=await fetch(process.env.OWLA_TOOL_ENDPOINT+'/tool',{method:'POST',
     headers:{'content-type':'application/json',authorization:'Bearer '+process.env.OWLA_TOOL_TOKEN},
     body:JSON.stringify({tool:'propose_edit',args:{}})});
    toolResult+=' | forged: '+((await forged.json()).error||'ACCEPTED');
    const wrong=await fetch(process.env.OWLA_TOOL_ENDPOINT+'/tool',{method:'POST',
     headers:{'content-type':'application/json',authorization:'Bearer wrong'},
     body:JSON.stringify({tool:'read_note',args:{}})});
    toolResult+=' | wrong token: '+wrong.status;
   }catch(error){toolResult='CALLBACK FAILED '+String(error);}
   setTimeout(()=>{
    send({type:'session.tool.input.started',data:{sessionID:'ses_test',assistantMessageID:'msg_2',id:'call_1',name:'owla_read_note'}});
    send({type:'session.text.delta',data:{sessionID:'ses_test',assistantMessageID:'msg_2',ordinal:0,delta:'Tool said: '+toolResult}});
    send({type:'session.execution.succeeded',data:{sessionID:'ses_test'}});
   },10);
   return;}
  if(url.startsWith('/api/session/')&&req.method==='DELETE'){res.writeHead(200,{'content-type':'application/json'});res.end('true');return;}
  res.writeHead(404);res.end();
 });
});
server.listen(port,'127.0.0.1',()=>console.log('server listening on http://127.0.0.1:'+port));
`;

test('the OpenCode bridge starts a private server, runs a turn and calls back into OWLA',async()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-opencode-bridge-'));
 const workdir=join(root,'session');
 mkdirSync(workdir,{recursive:true});
 const serverFile=join(root,'fake-opencode.mjs');
 writeFileSync(serverFile,FAKE_SERVER);
 const executable=join(root,process.platform==='win32'?'opencode.cmd':'opencode');
 if(process.platform==='win32')writeFileSync(executable,'@echo off\r\n\"'+process.execPath+'\" \"'+serverFile+'\" %*\r\n');
 else{writeFileSync(executable,'#!/bin/sh\nexec "'+process.execPath+'" "'+serverFile+'" "$@"\n',{mode:0o700});chmodSync(executable,0o700);}
 const bridge=new OpencodeBridge();
 const calls:{name:string;args:unknown}[]=[];
 const seen:string[]=[];
 try{
  writeFileSync(join(workdir,'opencode.json'),'{"plugins":["stale"]}');
  await bridge.connect(executable,workdir,true,[{type:'function',name:'read_note',description:'Read a note',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}}]);
  assert.equal(bridge.models.length,1);
  assert.equal(bridge.models[0].id,'opencode/free-model');
  assert.match(bridge.version,/2\.2\.7/);
  // OWLA's config is the private global config; nothing is left for project discovery.
  assert.ok(existsSync(join(workdir,'config','opencode','opencode.json')));
  assert.equal(existsSync(join(workdir,'opencode.json')),false);
  assert.ok(existsSync(join(workdir,'plugins','owla','index.ts')));
  assert.ok(existsSync(join(workdir,'owla-tools.json')));
  assert.ok(existsSync(join(workdir,'owla-skills.json')));
  const tools=JSON.parse(readFileSync(join(workdir,'owla-tools.json'),'utf8'));
  assert.equal(tools[0].name,'read_note');
  const skills=JSON.parse(readFileSync(join(workdir,'owla-skills.json'),'utf8'));
  assert.ok(skills.some((skill:{id:string})=>skill.id==='owla-formatting'));
  const result=await bridge.run({
   executable,cwd:workdir,model:'opencode/free-model',effort:'low',instructions:'Read the note.',text:'Read Note.md',
   images:[],tools:[{type:'function',name:'read_note',description:'Read a note',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}}],
   web:true,signal:new AbortController().signal,
   onText:delta=>seen.push(delta),
   onActivity:()=>{},
   tool:async(name,args)=>{calls.push({name,args});return 'Note body';}
  });
  assert.match(result.text,/Tool said: Note body/);
  // A valid token does not unlock tools that were not offered in this turn.
  assert.match(result.text,/forged: OWLA did not offer that tool/);
  assert.match(result.text,/wrong token: 401/);
  assert.equal(seen.length,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'read_note');
  assert.deepEqual(calls[0].args,{path:'Note.md'});
  assert.ok(bridge.usage);
  assert.equal(bridge.usage?.rateLimitsByLimitId?.['opencode-go-rolling']?.primary?.usedPercent,12);
  assert.equal((bridge as unknown as {child: unknown}).child,null);
 }finally{
  bridge.disconnect();
   await (bridge as unknown as {closing:Promise<void>}).closing;
  rmSync(root,{recursive:true,force:true});
 }
});
