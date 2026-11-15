import {test} from 'node:test';import assert from 'node:assert/strict';import {CodexBridge,CodexIsolationError,CAPABILITY_FEATURES,MAX_FEATURE_OVERRIDES,assertSessionPrivacy,isolationReport,replayHistory,supportedVersion,friendlyError} from '../src/codex';import {setObsidianLanguageForTests} from '../src/i18n';import {PROBE_0169_CONFIG,PROBE_0169_FEATURES_330_OVERRIDES,PROBE_0169_FEATURES_FINAL} from './helpers/codex-probe';import {migrateSettings} from '../src/core';
// The configuration a correctly isolated Codex session reports for every turn.
const isolatedConfig={config:{notify:[],hooks:{},sandbox_mode:'read-only',approval_policy:'never',features:{shell_tool:false,apps:false,hooks:false,unified_exec:false,computer_use:false,browser_use:false,browser_use_full_cdp_access:false,in_app_browser:false,image_generation:false,tool_suggest:false,skill_search:false,sleep_tool:false,goals:false,memories:false,code_mode:false,js_repl:false,multi_agent:false,view_image:false,skill_mcp_dependency_install:false,plugins:false,remote_plugin:false,plugin_sharing:false,browser_use_external:false,browser_annotation_api:false,in_app_local_automation:false,workspace_dependencies:false,shell_snapshot:false,tool_call_mcp_elicitation:false,code_mode_host:false,api_key_model_discovery:false,api_key_cyber_access_programs:false,auth_elicitation:false,mentions_v2:false,network_proxy:null},analytics:{enabled:false},feedback:{enabled:false},otel:{exporter:'none',trace_exporter:'none',metrics_exporter:'none'}}};
test('migration removes inference configuration while preserving user work locations and exclusions',()=>{const s=migrateSettings({model:'qwen3:0.6b',executable:'/old/ollama',provider:'ollama',storageRoot:'/private/work',excludedFolders:'Private'});assert.equal(s.models.codex.model,'');assert.equal(s.storageRoot,'/private/work');assert.equal(s.excludedFolders,'Private');assert.equal('models' in s,true);assert.equal(s.provider,'codex');assert.equal(migrateSettings({...s,schemaVersion:3,models:{codex:{model:'selected',reasoning:'high'},opencode:{model:'',reasoning:''}}}).models.codex.model,'selected');});
test('Codex version checks enforce the tested protocol baseline',()=>{assert.ok(supportedVersion('codex-cli 0.162.1'));assert.ok(supportedVersion('codex-cli 0.163.0'));assert.equal(supportedVersion('0.162.0'),false);assert.equal(supportedVersion('unknown'),false);});
test('restart replay is bounded and never includes tool calls',()=>{const input=Array.from({length:20},(_,i)=>({role:'user' as const,content:'x'.repeat(6000)+i}));const r=replayHistory(input);assert.ok(r.shortened);assert.ok(r.messages.length<=12);assert.ok(r.messages.reduce((n,m)=>n+m.content.length,0)<=64000);assert.equal(r.messages.at(-1)?.content,input.at(-1)?.content);});
test('usage and authentication errors have clear recovery messages',()=>{assert.match(friendlyError(Error('429 quota exceeded')),/allowance/);assert.match(friendlyError(Error('401 unauthorized')),/sign in/);});
test('unexpected Codex server requests are denied without executing tools',()=>{const b=new CodexBridge() as any;const writes:string[]=[];b.child={stdin:{write:(s:string)=>writes.push(s),end:()=>{}},kill:()=>{},exitCode:0,signalCode:null};b.receive({id:1,method:'item/permissions/requestApproval',params:{}});assert.equal(JSON.parse(writes[0]).error.code,-32601);b.child=null;});
test('read-only turns cannot invoke an unadvertised proposal tool',async()=>{const b=new CodexBridge() as any;let called=false;const writes:string[]=[];b.child={stdin:{write:(s:string)=>writes.push(s),end:()=>{}},kill:()=>{},exitCode:0,signalCode:null};b.active={threadId:'t',tool:async()=>{called=true;throw Error('not allowed');}};b.receive({id:3,method:'item/tool/call',params:{threadId:'wrong',tool:'propose_edit',arguments:{}}});assert.equal(called,false);assert.equal(JSON.parse(writes[0]).error.code,-32601);b.child=null;b.active=null;});

test('disconnect rejects pending work and never touches external processes',async()=>{const b=new CodexBridge() as any;const promise=b.request('metadata',{});await assert.rejects(promise,/disconnected/);b.disconnect();assert.equal(b.status,'Disconnected');});

test('live-turn interface limits tools and native environment, and rejects forged tool calls',async()=>{const b=new CodexBridge() as any;let executed=false;let start:any;const writes:string[]=[];b.child={stdin:{write:(s:string)=>writes.push(s),end:()=>{}},kill:()=>{},exitCode:0,signalCode:null};b.connect=async()=>{};b.readAccount=async()=>{b.accountType='chatgpt';};b.models=[{model:'test',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];b.request=async(method:string,params:any)=>{if(method==='config/read')return isolatedConfig;if(method==='thread/start'){start=params;return {thread:{id:'t'}};}if(method==='turn/start'){queueMicrotask(()=>{b.receive({id:4,method:'item/tool/call',params:{threadId:'t',tool:'propose_edit',arguments:{}}});setImmediate(()=>b.active.event('turn/completed',{threadId:'t',turn:{status:'completed'}}));});return {turn:{id:'turn'}};}return {};};const result=await b.run({executable:'',cwd:'/private/tmp',model:'test',effort:'low',instructions:'',text:'read only',images:[],tools:[],web:false,signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},tool:async()=>{executed=true;return '';}});await new Promise(r=>setImmediate(r));assert.equal(executed,false);assert.deepEqual(start.environments,[]);assert.equal(start.sandbox,'read-only');assert.equal(start.approvalPolicy,'never');assert.equal(start.config.web_search,'disabled');assert.equal(start.allowProviderModelFallback,false);assert.equal(JSON.parse(writes[0]).result.success,false);b.child=null;b.disconnect();});

function mockBridge(account:any={type:'chatgpt',planType:'plus'}){const b=new CodexBridge() as any;b.connect=async()=>{};b.models=[{model:'test',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];b.request=async(method:string)=>method==='config/read'?isolatedConfig:method==='account/read'?{account}:method==='thread/start'?{thread:{id:'t'}}:{turn:{id:'turn'}};return b;}
const options=()=>({executable:'',cwd:'/private/tmp',model:'test',effort:'low',instructions:'',text:'test',images:[],tools:[],web:false,signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},tool:async()=>''});
test('signed-out and API-key accounts cannot start inference',async()=>{for(const account of [null,{type:'apiKey'}])await assert.rejects(mockBridge(account).run(options()),/Sign in|ChatGPT/);});
test('unavailable models and unsupported reasoning never silently fall back',async()=>{const b=mockBridge();await assert.rejects(b.run({...options(),model:'missing'}),/unavailable/);await assert.rejects(b.run({...options(),effort:'ultra'}),/supported reasoning/);});
test('cancellation ends an active turn without waiting for model output',async()=>{const b=mockBridge(),controller=new AbortController();const pending=b.run({...options(),signal:controller.signal});await new Promise(r=>setImmediate(r));assert.ok(b.active);controller.abort();await assert.rejects(pending,/Stopped/);assert.equal(b.active,null);});
test('quota failure is returned instead of counted as a completed turn',async()=>{const b=mockBridge(),base=b.request;b.request=async(method:string)=>{if(method==='turn/start')throw Error('429 quota exceeded');return base(method)};await assert.rejects(b.run(options()),/429/);assert.equal(b.active,null);});
test('Search web cannot succeed without a real search event',async()=>{const b=mockBridge(),base=b.request;b.request=async(method:string)=>{const result=await base(method);if(method==='turn/start')queueMicrotask(()=>b.active.event('turn/completed',{threadId:'t',turn:{status:'completed'}}));return result};await assert.rejects(b.run({...options(),web:true,requireWeb:true}),/did not run live web search/);});

test('disconnect during connection discovery cannot start a background agent',async()=>{
 const {mkdtempSync,writeFileSync,existsSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const folder=mkdtempSync(join(tmpdir(),'owla-connect-cancel-')),marker=join(folder,'started');
 const b=new CodexBridge();
 let file:string;
 if(process.platform==='win32'){
  const fake=join(folder,'fake-codex.mjs');file=join(folder,'codex.cmd');
  writeFileSync(fake,'import {writeFileSync} from \"node:fs\";if(process.argv[2]===\"--version\")setTimeout(()=>console.log(\"codex-cli 0.162.1\"),100);else writeFileSync('+JSON.stringify(marker)+',\"started\");');
  writeFileSync(file,'@echo off\r\n\"'+process.execPath+'\" \"'+fake+'\" %*\r\n');
 }else{
  file=join(folder,'codex');
  writeFileSync(file,'#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then sleep 0.1; echo \"codex-cli 0.162.1\"; else touch \"'+marker+'\"; fi\n',{mode:0o700});
 }
 try{const pending=b.connect(file,folder);await new Promise(resolve=>setTimeout(resolve,20));b.disconnect();await assert.rejects(pending,/cancelled/);assert.equal(existsSync(marker),false);}
 finally{b.disconnect();rmSync(folder,{recursive:true,force:true});}
});

test('integration overrides preserve dotted IDs without copying credentials to process arguments',async()=>{const {integrationOverrides}=await import('../src/codex');const args=integrationOverrides({mcp_servers:{'com.example.tool':{enabled:true,env:{SECRET:'private'}},disabled:{enabled:false}},plugins:{'tool@vendor.example':{enabled:true}}});assert.equal(args[0],'mcp_servers={"com.example.tool"={enabled=false}}');assert.equal(args[1],'plugins={"tool@vendor.example"={enabled=false}}');assert.equal(args.join('').includes('private'),false);});

test('a metadata refresh is allowed to finish before the shared process sleeps',async()=>{const b=new CodexBridge() as any;b.accountType='chatgpt';b.child={stdin:{write:()=>{},end:()=>{}},kill:()=>{},exitCode:0,signalCode:null};const request=b.request('account/rateLimits/read',{});const sleeping=b.rest();await new Promise(resolve=>setTimeout(resolve,20));assert.ok(b.child);b.receive({id:1,result:{rateLimits:null}});await request;await sleeping;assert.equal(b.child,null);assert.match(b.status,/resting/);});

test('ephemeral replay retains recent attachment context and image references within the text budget',()=>{const image='data:image/png;base64,fixture';const replay=replayHistory([{role:'user',content:'Read this page',context:'PDF SOURCE: Example.pdf, p. 1\nVisible text',images:[image]},{role:'assistant',content:'First answer'}]);assert.match(replay.messages[0].context??'',/Example.pdf/);assert.equal(replay.messages[0].images?.[0],image);assert.ok(replayHistory([{role:'user',content:'q',context:'x'.repeat(64001)}]).shortened);});


test('session privacy fails closed for inherited or missing analytics and exporters',()=>{
 const safe={analytics:{enabled:false},feedback:{enabled:false},otel:{exporter:'none',trace_exporter:'none',metrics_exporter:'none'}};
 assert.doesNotThrow(()=>assertSessionPrivacy(safe));
 assert.throws(()=>assertSessionPrivacy({}),/telemetry/);
 assert.throws(()=>assertSessionPrivacy({...safe,analytics:{enabled:true}}),/telemetry/);
 assert.throws(()=>assertSessionPrivacy({...safe,feedback:{enabled:true}}),/telemetry/);
 for(const key of ['exporter','trace_exporter','metrics_exporter'])assert.throws(()=>assertSessionPrivacy({...safe,otel:{...safe.otel,[key]:'otlp-http'}}),/telemetry/);
});

test('Codex discovery uses executable files in absolute directories',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join,delimiter}=await import('node:path');const {findCodexExecutable}=await import('../src/codex');
 const root=mkdtempSync(join(tmpdir(),'owla-codex-discovery-'));
 try{const first=join(root,'first'),second=join(root,'second');mkdirSync(first);mkdirSync(second);
 if(process.platform==='win32'){writeFileSync(join(first,'codex.txt'),'not executable');writeFileSync(join(second,'codex.cmd'),'@echo off\r\nexit /b 0\r\n');assert.equal(findCodexExecutable(['.',first,second].join(delimiter),[]),join(second,'codex.cmd'));rmSync(join(second,'codex.cmd'));assert.equal(findCodexExecutable([first,second].join(delimiter),[]),'');}
 else{writeFileSync(join(first,'codex'),'not executable',{mode:0o600});writeFileSync(join(second,'codex'),'#!/bin/sh\nexit 0\n',{mode:0o700});assert.equal(findCodexExecutable(['.',first,second].join(delimiter),[]),join(second,'codex'));chmodSync(join(second,'codex'),0o600);assert.equal(findCodexExecutable([first,second].join(delimiter),[]),'');}
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('unknown inherited integration config is rejected instead of treated as disabled',async()=>{
 const {integrationOverrides}=await import('../src/codex');assert.throws(()=>integrationOverrides({plugins:[{enabled:true}]}),/unsupported integration/);
});

test('warm startup and Send share a handshake and only the last owner stops the process', async()=>{
 const bridge=new CodexBridge();
 const internals=bridge as any;
 let complete!:()=>void;
 let starts=0;
 internals.start=async()=>{
  starts++;
  internals.child={stdin:{end:()=>{}},kill:()=>{},exitCode:0,signalCode:null};
  await new Promise<void>(resolve=>{complete=resolve;});
  internals.initialized=true;
  bridge.accountType='chatgpt';
 };
 const warm=bridge.hold();
 const ready=bridge.connect();
 await Promise.resolve();
 const reply=bridge.hold();
 const sent=bridge.connect();
 await warm();
 assert.equal(starts,1);
 assert.equal(bridge.ready,false);
 complete();
 await Promise.all([ready,sent]);
 assert.equal(bridge.ready,true);
 await reply();
 assert.equal(bridge.ready,false);
 assert.equal(internals.child,null);
});

test('Codex protocol applies its size limit per message, including messages split across chunks',()=>{
 const bridge=new CodexBridge() as any;
 const child={stdin:{end:()=>{}},kill:()=>{},exitCode:0,signalCode:null};
 bridge.child=child;
 const frames:unknown[]=[];
 bridge.receive=(value:unknown)=>frames.push(value);
 const line=JSON.stringify({value:'x'.repeat(8*1024*1024)});
 bridge.receiveChunk(child,line.slice(0,100));
 bridge.receiveChunk(child,line.slice(100)+'\n'+line+'\n');
 assert.equal(frames.length,2);
 assert.equal(bridge.child,child);
 bridge.receiveChunk(child,'x'.repeat(16*1024*1024)+'x\n');
 assert.equal(bridge.child,null);
 assert.equal(bridge.lines.overflow,false);
 assert.match(bridge.status,/16 MiB/);
});

test('a configuration change between turns that re-enables an inherited tool stops the next turn',async()=>{
 const b=mockBridge(),base=b.request;let started=false;
 b.request=async(method:string)=>{if(method==='config/read')return {config:{...isolatedConfig.config,features:{shell_tool:true,apps:false}}};if(method==='thread/start')started=true;return base(method);};
 await assert.rejects(b.run(options()),/could not isolate/);
 assert.equal(started,false);
 b.request=async(method:string)=>method==='config/read'?{config:{...isolatedConfig.config,mcp_servers:{fs:{enabled:true}}}}:base(method);
 await assert.rejects(b.run(options()),/could not isolate/);
});

test('project instructions are scanned up to the filesystem root, including the home folder',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {inheritedInstructions}=await import('../src/codex');
 const home=mkdtempSync(join(tmpdir(),'owla-home-'));
 try{
  const session=join(home,'shared','owla','session');mkdirSync(session,{recursive:true});
  writeFileSync(join(home,'AGENTS.md'),'global');
  assert.deepEqual(inheritedInstructions(session),[join(home,'AGENTS.md')]);
  writeFileSync(join(home,'shared','AGENTS.md'),'project');
  assert.deepEqual(inheritedInstructions(session),[join(home,'shared','AGENTS.md'),join(home,'AGENTS.md')]);
 }finally{rmSync(home,{recursive:true,force:true});}
});

// ---------------------------------------------------------------- U2: feature isolation without blocking stock Codex

const report=(features:Record<string,unknown>,extra:Record<string,unknown>={})=>isolationReport({...isolatedConfig.config,features:{...isolatedConfig.config.features,...features},...extra});

test('isolationReport: an all-false (or unset/null) feature set passes',()=>{
 assert.deepEqual(isolationReport(isolatedConfig.config),{disableFeatures:[]});
 assert.deepEqual(report({network_proxy:null,future_feature:null}),{disableFeatures:[]});
});

test('isolationReport: a feature set to true is turned off instead of blocking',()=>{
 assert.deepEqual(report({fast_mode:true}),{disableFeatures:['fast_mode']});
 assert.deepEqual(report({fast_mode:true,multi_agent_v2:true,network_proxy:null}).disableFeatures,['fast_mode','multi_agent_v2']);
});

test('isolationReport: non-boolean feature values and unsafe feature names are fatal',()=>{
 for(const value of [{a:1},'on',1,0,[]]){const r=report({x:value});assert.match(r.fatal??'',/feature x has an unsupported value/,JSON.stringify(value));assert.deepEqual(r.disableFeatures,[]);}
 for(const key of ['a.b','A','a-b','a b','"x"=true','']){const r=report({[key]:true});assert.match(r.fatal??'',/feature name .* is not supported/,key);}
 // An unsafe name is fatal even when its value is false: it could not be passed back through -c.
 assert.ok(report({'a.b':false}).fatal);
 // The key is shown, but quoted and shortened.
 assert.ok((report({['a.'+'x'.repeat(200)]:true}).fatal??'').length<400);
});

test('isolationReport: more than the cap of true features fails closed',()=>{
 const many=(n:number)=>Object.fromEntries(Array.from({length:n},(_,i)=>['extra_'+i,true]));
 assert.equal(report(many(MAX_FEATURE_OVERRIDES)).disableFeatures.length,64);
 assert.match(report(many(MAX_FEATURE_OVERRIDES+1)).fatal??'',/more than 64 Codex features/);
});

test('isolationReport: every existing non-feature condition is still fatal',()=>{
 const c=isolatedConfig.config;
 const cases:Record<string,unknown>[]=[
  {features:{...c.features,shell_tool:true}},{features:{...c.features,apps:true}},{features:{...c.features,shell_tool:undefined}},{features:{...c.features,apps:null}},
  {mcp_servers:{fs:{enabled:true}}},{plugins:{'tool@vendor':{}}},{notify:['say']},{notify:'say'},{hooks:{pre:[{}]}},{hooks:[]},
  {sandbox_mode:'workspace-write'},{approval_policy:'on-request'},{features:'all'},
 ];
 for(const extra of cases)assert.match(isolationReport({...c,...extra}).fatal??'',/could not isolate/,JSON.stringify(extra));
 assert.match(isolationReport({...c,plugins:[{enabled:true}]}).fatal??'',/unsupported integration/);
 for(const extra of [{analytics:{enabled:true}},{feedback:{}},{otel:{...c.otel,exporter:'otlp-http'}}])assert.match(isolationReport({...c,...extra}).fatal??'',/telemetry/,JSON.stringify(extra));
 // null notify and hooks mean unset.
 assert.deepEqual(isolationReport({...c,notify:null,hooks:null}),{disableFeatures:[]});
 assert.match(isolationReport({...c,sandbox_mode:'danger-full-access'},'turn').fatal??'',/Reconnect to retry/);
});

test('isolationReport: German messages keep the feature key',()=>{
 setObsidianLanguageForTests('de');
 try{assert.match(report({x:'on'}).fatal??'',/Funktion x/);}finally{setObsidianLanguageForTests(null);}
});

test('isolation errors are shown verbatim, even when a key looks like a quota or sign-in word',()=>{
 const e=new CodexIsolationError('Codex could not isolate OWLA tools: feature usage_limit_429 is enforced by managed Codex settings.');
 assert.equal(friendlyError(e),e.message);
});

test('U2 regression: the stock Codex 0.169.0 config/read result is never blocked',()=>{
 // With the 3.3.0 override list, the stock result has true defaults and nulls; all true keys are pre-disabled now.
 const before=isolationReport({...PROBE_0169_CONFIG,features:PROBE_0169_FEATURES_330_OVERRIDES});
 assert.equal(before.fatal,undefined);
 assert.deepEqual(before.disableFeatures.sort(),['api_key_cyber_access_programs','api_key_model_discovery','auth_elicitation','mentions_v2','remote_plugin']);
 for(const key of before.disableFeatures)assert.ok(CAPABILITY_FEATURES.includes(key),key);
 // With the final override list, the real Codex response needs no restart.
 assert.deepEqual(isolationReport({...PROBE_0169_CONFIG,features:PROBE_0169_FEATURES_FINAL}),{disableFeatures:[]});
 assert.deepEqual(isolationReport({...PROBE_0169_CONFIG,features:PROBE_0169_FEATURES_FINAL},'turn'),{disableFeatures:[]});
});

test('the proactive list turns off the capability features that Codex enables by default',()=>{
 for(const key of ['plugins','remote_plugin','plugin_sharing','browser_use_external','browser_annotation_api','in_app_local_automation','workspace_dependencies','shell_snapshot','tool_call_mcp_elicitation','code_mode_host','shell_tool','apps','hooks','unified_exec'])assert.ok(CAPABILITY_FEATURES.includes(key),key);
 for(const [key,value] of Object.entries(PROBE_0169_FEATURES_330_OVERRIDES))if(value===true)assert.ok(CAPABILITY_FEATURES.includes(key),key);
 assert.ok(CAPABILITY_FEATURES.every(key=>/^[a-z0-9_]+$/.test(key)));
});

// A fake `codex` (tests/fixtures/fake-codex.mjs) that applies -c feature overrides the way Codex 0.169.0 does.
async function fakeCodex(scenario:{defaults?:Record<string,unknown>;pinned?:Record<string,unknown>;hooks?:unknown;hookInventory?:unknown;hookInventoryError?:boolean}){
 const {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');
 const folder=mkdtempSync(join(tmpdir(),'owla-fake-codex-')),fixture=resolve('tests/fixtures/fake-codex.mjs');
 const set=(next:typeof scenario)=>writeFileSync(join(folder,'scenario.json'),JSON.stringify(next));
 set(scenario);
 let file:string;
 if(process.platform==='win32'){file=join(folder,'codex.cmd');writeFileSync(file,'@echo off\r\n"'+process.execPath+'" "'+fixture+'" "'+folder+'" %*\r\n');}
 else{file=join(folder,'codex');writeFileSync(file,'#!/bin/sh\nexec "'+process.execPath+'" "'+fixture+'" "'+folder+'" "$@"\n',{mode:0o700});}
 const spawns=()=>existsSync(join(folder,'spawns.jsonl'))?readFileSync(join(folder,'spawns.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as string[]):[];
 const bridge=new CodexBridge();
 const cwd=join(folder,'session');
 const cleanup=async()=>{bridge.disconnect();await (bridge as any).closing;rmSync(folder,{recursive:true,force:true});};
 const requests=()=>existsSync(join(folder,'requests.jsonl'))?readFileSync(join(folder,'requests.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as {method:string;params:any}):[];
 return {file,cwd,bridge,set,spawns,requests,cleanup};
}
const disables=(argv:string[],key:string)=>argv.some((arg,i)=>argv[i-1]==='-c'&&arg==='features.'+key+'=false');

test('U2: stock Codex 0.169.0 connects with one app-server start',async()=>{
 const fake=await fakeCodex({defaults:PROBE_0169_FEATURES_330_OVERRIDES});
 try{
  await fake.bridge.connect(fake.file,fake.cwd);
  assert.equal(fake.bridge.ready,true);
  assert.equal(fake.spawns().length,1);
  assert.ok(disables(fake.spawns()[0],'api_key_model_discovery'));
 }finally{await fake.cleanup();}
});

test('U2: a user-enabled feature is turned off with one restart, and the connect succeeds',async()=>{
 const fake=await fakeCodex({defaults:{...PROBE_0169_FEATURES_330_OVERRIDES,multi_agent_v2:true}});
 try{
  await fake.bridge.connect(fake.file,fake.cwd);
  assert.equal(fake.bridge.ready,true);
  const [first,second]=fake.spawns();
  assert.equal(fake.spawns().length,2);
  assert.equal(disables(first,'multi_agent_v2'),false);
  assert.ok(disables(second,'multi_agent_v2'));
 }finally{await fake.cleanup();}
});

test('U2: a feature that stays on after the restart is enforced by managed settings and fails closed',async()=>{
 const fake=await fakeCodex({defaults:{multi_agent_v2:true},pinned:{multi_agent_v2:true}});
 try{
  await assert.rejects(fake.bridge.connect(fake.file,fake.cwd),/feature multi_agent_v2 is enforced by managed Codex settings/);
  assert.equal(fake.spawns().length,2);
  assert.equal(fake.bridge.running,false);
  assert.match(fake.bridge.status,/managed Codex settings/);
 }finally{await fake.cleanup();}
 // A pinned feature that OWLA already turned off fails without a pointless restart.
 const pinned=await fakeCodex({pinned:{api_key_model_discovery:true}});
 try{
  await assert.rejects(pinned.bridge.connect(pinned.file,pinned.cwd),/feature api_key_model_discovery is enforced by managed/);
  assert.equal(pinned.spawns().length,1);
 }finally{await pinned.cleanup();}
});

test('U2: a non-boolean feature value fails closed on connect and names the key',async()=>{
 const fake=await fakeCodex({defaults:{multi_agent_v2:{x:1}}});
 try{
  await assert.rejects(fake.bridge.connect(fake.file,fake.cwd),/feature multi_agent_v2 has an unsupported value/);
  assert.equal(fake.spawns().length,1);
  assert.equal(fake.bridge.running,false);
 }finally{await fake.cleanup();}
});

test('U2: a web re-key reuses the learned overrides; explicit Disconnect and Verify clear them',async()=>{
 const fake=await fakeCodex({defaults:{multi_agent_v2:true}});
 try{
  await fake.bridge.connect(fake.file,fake.cwd,false);
  assert.equal(fake.spawns().length,2);
  await fake.bridge.connect(fake.file,fake.cwd,true);
  assert.equal(fake.spawns().length,3,'one start, not two');
  const third=fake.spawns()[2];
  assert.ok(disables(third,'multi_agent_v2'));
  assert.ok(third.includes('web_search="live"'));
  // Explicit Disconnect, then Connect: a clean probe without the learned override.
  fake.bridge.disconnect();await (fake.bridge as any).closing;
  await fake.bridge.connect(fake.file,fake.cwd,false);
  assert.equal(fake.spawns().length,5);
  assert.equal(disables(fake.spawns()[3],'multi_agent_v2'),false);
  // Verify (recheck) also forgets them; the user removed the flag, so no restart is needed.
  fake.set({defaults:{}});
  fake.bridge.recheck();
  await fake.bridge.connect(fake.file,fake.cwd,true);
  assert.equal(fake.spawns().length,6);
  assert.equal(disables(fake.spawns()[5],'multi_agent_v2'),false);
 }finally{await fake.cleanup();}
});

test('U2: a feature turned on mid-session stops the next turn before thread/start; reconnecting applies the isolation',async()=>{
 const fake=await fakeCodex({defaults:PROBE_0169_FEATURES_330_OVERRIDES});
 try{
  await fake.bridge.connect(fake.file,fake.cwd);
  fake.set({defaults:PROBE_0169_FEATURES_330_OVERRIDES,pinned:{fast_mode:true}});
  // The fake rejects thread/start, so reaching it would fail with a different message.
  await assert.rejects(fake.bridge.run({...options(),executable:fake.file,cwd:fake.cwd,model:'fake'}),/feature fast_mode was turned on while Codex was running\. Reconnect Codex to apply OWLA's isolation/);
  assert.equal(fake.bridge.running,false,'the process rests after the stopped turn');
  fake.set({defaults:{...PROBE_0169_FEATURES_330_OVERRIDES,fast_mode:true}});
  await fake.bridge.connect(fake.file,fake.cwd);
  assert.equal(fake.bridge.ready,true);
  assert.ok(disables(fake.spawns().at(-1)!,'fast_mode'));
 }finally{await fake.cleanup();}
});

test('assertIsolation: a true feature mid-session stops the turn; a null feature does not',async()=>{
 const b=mockBridge(),base=b.request;let started=false;
 b.request=async(method:string)=>{if(method==='config/read')return {config:{...isolatedConfig.config,features:{...isolatedConfig.config.features,multi_agent_v2:true}}};if(method==='thread/start')started=true;return base(method);};
 await assert.rejects(b.run(options()),/feature multi_agent_v2 was turned on while Codex was running\. Reconnect Codex/);
 assert.equal(started,false);
 b.request=async(method:string)=>{if(method==='config/read')return {config:{...isolatedConfig.config,features:{...isolatedConfig.config.features,x:'on'}}};if(method==='thread/start')started=true;return base(method);};
 await assert.rejects(b.run(options()),/feature x has an unsupported value/);
 assert.equal(started,false);
 const ok=mockBridge(),okBase=ok.request,controller=new AbortController();
 ok.request=async(method:string)=>{if(method==='config/read')return {config:{...PROBE_0169_CONFIG,features:PROBE_0169_FEATURES_FINAL}};if(method==='thread/start')started=true;return okBase(method);};
 const pending=ok.run({...options(),signal:controller.signal});
 await new Promise(r=>setImmediate(r));
 assert.equal(started,true);
 controller.abort();await assert.rejects(pending,/Stopped/);
});

const hookMetadata={
 ...Object.fromEntries(['PreModelRequest','PostModelRequest','PreToolUse','PermissionRequest','PostToolUse','PreCompact','PostCompact','SessionStart','SessionEnd','UserPromptSubmit','SubagentStart','SubagentStop','Stop','Interrupt'].map(event=>[event,[]])),
 state:Object.fromEntries(Array.from({length:8},(_,i)=>['/fixture/hooks.json:event:'+i,{trusted_hash:'sha256:'+String(i).repeat(64)}])),
};
test('hooks: 14 empty event arrays and eight trusted state entries require an explicitly false feature',()=>{
 for(const phase of ['start','turn'] as const){
  assert.deepEqual(isolationReport({...isolatedConfig.config,hooks:hookMetadata},phase),{disableFeatures:[]});
  for(const hooks of [undefined,null,true])assert.ok(isolationReport({...isolatedConfig.config,hooks:hookMetadata,features:{...isolatedConfig.config.features,hooks}},phase).fatal);
 }
});
test('hooks: active declarations, unknown events and malformed trust state fail closed',()=>{
 for(const hooks of [[],true,'off',{Stop:[{hooks:[{type:'command',command:'do not run'}]}]},{Stop:null},{FutureEvent:[]},{state:null},{state:[]},{state:{x:[]}}, {state:{x:null}},{state:{x:{enabled:'false'}}},{state:{x:{trusted_hash:{}}}},{state:{x:{command:'do not run'}}}]){
  for(const phase of ['start','turn'] as const)assert.ok(isolationReport({...isolatedConfig.config,hooks},phase).fatal,JSON.stringify(hooks));
 }
 assert.deepEqual(isolationReport({...isolatedConfig.config,hooks:{state:{x:{enabled:true,trusted_hash:'hash',trusted_content_hash:'content'},y:{enabled:null,trusted_hash:null}}}}),{disableFeatures:[]});
});
test('hooks: trusted metadata connects only after an empty runtime inventory, and is rechecked before turns',async()=>{
 const fake=await fakeCodex({hooks:hookMetadata});
 try{
  await fake.bridge.connect(fake.file,fake.cwd);
  assert.equal(fake.bridge.ready,true);
  const methods=fake.requests().map(r=>r.method);
  assert.ok(methods.indexOf('hooks/list')<methods.indexOf('account/read'));
  assert.ok(disables(fake.spawns()[0],'hooks'));
  // No commands are returned in config/read, but a now-active hooks.json entry
  // in runtime discovery must still stop the turn before thread/start.
  fake.set({hooks:hookMetadata,hookInventory:{data:[{cwd:fake.cwd,hooks:[{eventName:'stop',enabled:true,trustStatus:'trusted'}],errors:[],warnings:[]}]}});
  await assert.rejects(fake.bridge.run({...options(),executable:fake.file,cwd:fake.cwd,model:'fake'}),/could not verify that hooks are disabled/);
  assert.equal(fake.bridge.running,false);
  assert.equal(fake.requests().filter(r=>r.method==='hooks/list').length,2);
  assert.ok(!fake.requests().some(r=>r.method==='thread/start'));
 }finally{await fake.cleanup();}
});
test('hooks: missing, malformed, mismatched or nonempty runtime inventories cannot connect',async()=>{
 const bad=[{}, {data:[]},{data:[{}]},{data:[{cwd:'/wrong',hooks:[],errors:[],warnings:[]}]},
  ...[{hooks:[{enabled:false}]},{hooks:{}},{errors:[{message:'discovery failed'}]},{warnings:['unreadable hooks']},{warnings:null}].map(fields=>({fields}))];
 for(const value of bad){
  const fake=await fakeCodex({hooks:hookMetadata});
  try{
   const {realpathSync}=await import('node:fs');
   // connect creates cwd before discovery; use its canonical parent here.
   const {dirname,basename,join}=await import('node:path');
   const directory=join(realpathSync(dirname(fake.cwd)),basename(fake.cwd));
   const hookInventory='fields' in value?{data:[{cwd:directory,hooks:[],errors:[],warnings:[],...value.fields}]}:value;
   fake.set({hooks:hookMetadata,hookInventory});
   await assert.rejects(fake.bridge.connect(fake.file,fake.cwd),/could not verify that hooks are disabled/);
   assert.equal(fake.bridge.running,false);
   assert.ok(!fake.requests().some(r=>r.method==='account/read'||r.method==='thread/start'));
  }finally{await fake.cleanup();}
 }
});

test('hooks: unsupported runtime discovery fails closed without exposing raw server errors',async()=>{
 const fake=await fakeCodex({hooks:hookMetadata,hookInventoryError:true});
 try{
  await assert.rejects(fake.bridge.connect(fake.file,fake.cwd),/could not verify that hooks are disabled/);
  assert.equal(fake.bridge.running,false);
  assert.ok(!fake.requests().some(r=>r.method==='account/read'||r.method==='thread/start'));
 }finally{await fake.cleanup();}
});
