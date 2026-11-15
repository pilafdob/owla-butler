// Opt-in real Codex 0.169.0 runtime regression (macOS/Linux):
// node --import tsx tests/fixtures/codex-hooks-runtime.mjs /absolute/path/to/codex
// Creates only disposable HOME/CODEX_HOME and touch sentinels. A loopback-only
// Responses stub completes parent/child turns without credentials or user data.
// Never reads the real Codex home. Not part of the default unit suite.
import assert from 'node:assert/strict';
import {CodexBridge,CAPABILITY_FEATURES,isolationReport} from '../../src/codex.ts';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'owla-hooks-proof-')),home=join(root,'home'),cwd=join(root,'cwd'),fired=join(root,'fired');
for(const d of [home,cwd,fired])mkdirSync(d);
const events=['SessionStart','UserPromptSubmit','Stop','SubagentStart','SubagentStop'];
writeFileSync(join(home,'hooks.json'),JSON.stringify({hooks:Object.fromEntries(events.map(e=>[e,[{hooks:[{type:'command',command:'/usr/bin/touch '+JSON.stringify(join(fired,e))}]}]]))}));
let requests=0,spawnSent=false,subagents=false;
const server=createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{requests++;assert.ok(req.url.startsWith('/v1/responses'));JSON.parse(body);res.writeHead(200,{'Content-Type':'text/event-stream'});const msg=subagents&&!spawnSent?(spawnSent=true,{type:'function_call',id:'fc_'+requests,call_id:'call_'+requests,name:'spawn_agent',namespace:'collaboration',arguments:JSON.stringify({message:'Reply briefly with fixture complete.',task_name:'sentinel_child'})}):{type:'message',id:'msg_'+requests,role:'assistant',status:'completed',content:[{type:'output_text',text:'sentinel probe complete'}]};const evs=[{type:'response.created',response:{id:'r_'+requests}},{type:'response.output_item.added',output_index:0,item:msg},{type:'response.output_item.done',output_index:0,item:msg},{type:'response.completed',response:{id:'r_'+requests,status:'completed',output:[msg],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];res.end(evs.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''));});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const provider=['model_provider="probe"','model_providers.probe.name="probe"','model_providers.probe.base_url="http://127.0.0.1:'+server.address().port+'/v1"','model_providers.probe.wire_api="responses"','model_providers.probe.requires_openai_auth=false','model_providers.probe.supports_websockets=false','model="gpt-5"'];
const owla=['analytics.enabled=false','feedback.enabled=false','otel.exporter="none"','otel.trace_exporter="none"','otel.metrics_exporter="none"','model_provider="openai"','forced_login_method="chatgpt"','sandbox_mode="read-only"','approval_policy="never"','notify=[]','project_doc_max_bytes=0',...CAPABILITY_FEATURES.map(k=>'features.'+k+'=false'),'web_search="disabled"'];
async function run(label,extra,turn=true){
 const beforeRequests=requests;
 const child=spawn(process.argv[2]||'/usr/local/bin/codex',['app-server','--listen','stdio://',...[...extra,...provider].flatMap(v=>['-c',v])],{cwd,env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:home}});
 let buf='',id=0,stderr='';const waits=new Map(),notes=[];child.stderr.on('data',d=>stderr+=d);child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line)continue;const m=JSON.parse(line);if(waits.has(m.id)){waits.get(m.id)(m);waits.delete(m.id);}else notes.push(m);}});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,t=setTimeout(()=>reject(Error('timeout '+method)),20000);waits.set(n,m=>{clearTimeout(t);resolve(m)});child.stdin.write(JSON.stringify({id:n,method,params})+'\n');});
 try{
 await rpc('initialize',{clientInfo:{name:'owla_probe',version:'0'},capabilities:{experimentalApi:true}});
 const config=(await rpc('config/read',{includeLayers:false})).result.config;
 const hooks=await rpc('hooks/list',{cwds:[cwd]});
 if(label==='owla'){
  assert.deepEqual(isolationReport(config),{disableFeatures:[]});
  const bridge=new CodexBridge();bridge.request=async(method,params)=>{const response=await rpc(method,params);if(response.error)throw Error(response.error.message);return response.result;};
  await bridge.assertHookInventory(config,cwd);
 }
 let thread,turnResult;
 if(turn){thread=await rpc('thread/start',{cwd,ephemeral:!subagents,environments:[],sandbox:'read-only',approvalPolicy:'never',baseInstructions:'Reply briefly.',developerInstructions:'Only a local fixture.',dynamicTools:[]});if(!thread.result)throw Error(JSON.stringify(thread));turnResult=await rpc('turn/start',{threadId:thread.result.thread.id,input:[{type:'text',text:'sentinel probe'}]});for(let i=0;i<100&&notes.filter(n=>n.method==='turn/completed').length<(subagents?2:1);i++)await new Promise(r=>setTimeout(r,100));}
 const result={label,featuresHooks:config.features.hooks,configHooks:config.hooks,hooks:hooks.result?.data?.flatMap(e=>e.hooks),turn:notes.find(n=>n.method==='turn/completed')?.params,hookEvents:notes.filter(n=>n.method?.startsWith('hook/')).map(n=>n.method),fired:readdirSync(fired),requests:requests-beforeRequests,completedTurns:notes.filter(n=>n.method==='turn/completed').map(n=>n.params.turn.status),stderr:stderr.slice(-1000)};
 return result;
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
}
try{
 const discovery=await run('discover',[],false);
 const hooks=discovery.hooks;
 writeFileSync(join(home,'config.toml'),hooks.map(h=>'[hooks.state.'+JSON.stringify(h.key)+']\ntrusted_hash='+JSON.stringify(h.currentHash)+'\n').join(''));
 const cases=[
  ['control-true',['features.hooks=true'],true,true],
  ['default',[],true,true],
  ['explicit-false',['features.hooks=false'],true,false],
  // Stress the hook gate with subagents deliberately enabled; this is not the
  // production configuration, which disables multi_agent and uses ephemeral threads.
  ['owla-subagent-stress',owla,true,false],
  ['owla',owla,false,false],
 ];
 for(const [label,extra,spawnChild,expectHooks] of cases){
  for(const f of readdirSync(fired))rmSync(join(fired,f));
  spawnSent=false;subagents=spawnChild;
  const args=spawnChild?[...extra,'features.multi_agent=true','features.multi_agent_v2=true']:extra;
  const result=await run(label,args);
  assert.deepEqual(result.completedTurns,spawnChild?['completed','completed']:['completed'],label);
  assert.deepEqual(result.fired.sort(),expectHooks?[...events].sort():[],label);
  assert.equal(result.stderr,'',label);
  if(!expectHooks){assert.equal(result.featuresHooks,false);assert.deepEqual(result.hooks,[]);assert.deepEqual(result.hookEvents,[]);}
  console.log(JSON.stringify({label,featuresHooks:result.featuresHooks,completedTurns:result.completedTurns,fired:result.fired,hookEvents:result.hookEvents.length,discoveredHooks:result.hooks.length,requests:result.requests}));
 }
}finally{server.close();rmSync(root,{recursive:true,force:true});}
