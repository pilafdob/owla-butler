import {test} from 'node:test';import assert from 'node:assert/strict';import {CodexBridge,assertSessionPrivacy,replayHistory,supportedVersion,friendlyError} from '../src/codex';import {migrateSettings} from '../src/core';
test('migration removes inference configuration while preserving user work locations and exclusions',()=>{const s=migrateSettings({model:'qwen3:0.6b',executable:'/old/ollama',provider:'ollama',storageRoot:'/private/work',excludedFolders:'Private'});assert.equal(s.models.codex.model,'');assert.equal(s.storageRoot,'/private/work');assert.equal(s.excludedFolders,'Private');assert.equal('models' in s,true);assert.equal(s.provider,'codex');assert.equal(migrateSettings({...s,schemaVersion:3,models:{codex:{model:'selected',reasoning:'high'},opencode:{model:'',reasoning:''}}}).models.codex.model,'selected');});
test('Codex version checks enforce the tested protocol baseline',()=>{assert.ok(supportedVersion('codex-cli 0.162.1'));assert.ok(supportedVersion('codex-cli 0.163.0'));assert.equal(supportedVersion('0.162.0'),false);assert.equal(supportedVersion('unknown'),false);});
test('restart replay is bounded and never includes tool calls',()=>{const input=Array.from({length:20},(_,i)=>({role:'user' as const,content:'x'.repeat(6000)+i}));const r=replayHistory(input);assert.ok(r.shortened);assert.ok(r.messages.length<=12);assert.ok(r.messages.reduce((n,m)=>n+m.content.length,0)<=64000);assert.equal(r.messages.at(-1)?.content,input.at(-1)?.content);});
test('usage and authentication errors have clear recovery messages',()=>{assert.match(friendlyError(Error('429 quota exceeded')),/allowance/);assert.match(friendlyError(Error('401 unauthorized')),/sign in/);});
test('unexpected Codex server requests are denied without executing tools',()=>{const b=new CodexBridge() as any;const writes:string[]=[];b.child={stdin:{write:(s:string)=>writes.push(s),end:()=>{}},kill:()=>{},exitCode:0,signalCode:null};b.receive({id:1,method:'item/permissions/requestApproval',params:{}});assert.equal(JSON.parse(writes[0]).error.code,-32601);b.child=null;});
test('read-only turns cannot invoke an unadvertised proposal tool',async()=>{const b=new CodexBridge() as any;let called=false;const writes:string[]=[];b.child={stdin:{write:(s:string)=>writes.push(s),end:()=>{}},kill:()=>{},exitCode:0,signalCode:null};b.active={threadId:'t',tool:async()=>{called=true;throw Error('not allowed');}};b.receive({id:3,method:'item/tool/call',params:{threadId:'wrong',tool:'propose_edit',arguments:{}}});assert.equal(called,false);assert.equal(JSON.parse(writes[0]).error.code,-32601);b.child=null;b.active=null;});

test('disconnect rejects pending work and never touches external processes',async()=>{const b=new CodexBridge() as any;const promise=b.request('metadata',{});await assert.rejects(promise,/disconnected/);b.disconnect();assert.equal(b.status,'Disconnected');});

test('live-turn interface limits tools and native environment, and rejects forged tool calls',async()=>{const b=new CodexBridge() as any;let executed=false;let start:any;const writes:string[]=[];b.child={stdin:{write:(s:string)=>writes.push(s),end:()=>{}},kill:()=>{},exitCode:0,signalCode:null};b.connect=async()=>{};b.readAccount=async()=>{b.accountType='chatgpt';};b.models=[{model:'test',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];b.request=async(method:string,params:any)=>{if(method==='thread/start'){start=params;return {thread:{id:'t'}};}if(method==='turn/start'){queueMicrotask(()=>{b.receive({id:4,method:'item/tool/call',params:{threadId:'t',tool:'propose_edit',arguments:{}}});setImmediate(()=>b.active.event('turn/completed',{threadId:'t',turn:{status:'completed'}}));});return {turn:{id:'turn'}};}return {};};const result=await b.run({executable:'',cwd:'/private/tmp',model:'test',effort:'low',instructions:'',text:'read only',images:[],tools:[],web:false,signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},tool:async()=>{executed=true;return '';}});await new Promise(r=>setImmediate(r));assert.equal(executed,false);assert.deepEqual(start.environments,[]);assert.equal(start.sandbox,'read-only');assert.equal(start.approvalPolicy,'never');assert.equal(start.config.web_search,'disabled');assert.equal(start.allowProviderModelFallback,false);assert.equal(JSON.parse(writes[0]).result.success,false);b.child=null;b.disconnect();});

function mockBridge(account:any={type:'chatgpt',planType:'plus'}){const b=new CodexBridge() as any;b.connect=async()=>{};b.models=[{model:'test',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];b.request=async(method:string)=>method==='account/read'?{account}:method==='thread/start'?{thread:{id:'t'}}:{turn:{id:'turn'}};return b;}
const options=()=>({executable:'',cwd:'/private/tmp',model:'test',effort:'low',instructions:'',text:'test',images:[],tools:[],web:false,signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},tool:async()=>''});
test('signed-out and API-key accounts cannot start inference',async()=>{for(const account of [null,{type:'apiKey'}])await assert.rejects(mockBridge(account).run(options()),/Sign in|ChatGPT/);});
test('unavailable models and unsupported reasoning never silently fall back',async()=>{const b=mockBridge();await assert.rejects(b.run({...options(),model:'missing'}),/unavailable/);await assert.rejects(b.run({...options(),effort:'ultra'}),/supported reasoning/);});
test('cancellation ends an active turn without waiting for model output',async()=>{const b=mockBridge(),controller=new AbortController();const pending=b.run({...options(),signal:controller.signal});await new Promise(r=>setImmediate(r));assert.ok(b.active);controller.abort();await assert.rejects(pending,/Stopped/);assert.equal(b.active,null);});
test('quota failure is returned instead of counted as a completed turn',async()=>{const b=mockBridge(),base=b.request;b.request=async(method:string)=>{if(method==='turn/start')throw Error('429 quota exceeded');return base(method)};await assert.rejects(b.run(options()),/429/);assert.equal(b.active,null);});
test('Search web cannot succeed without a real search event',async()=>{const b=mockBridge(),base=b.request;b.request=async(method:string)=>{const result=await base(method);if(method==='turn/start')queueMicrotask(()=>b.active.event('turn/completed',{threadId:'t',turn:{status:'completed'}}));return result};await assert.rejects(b.run({...options(),web:true,requireWeb:true}),/did not run live web search/);});

test('disconnect during connection discovery cannot start a background agent',async()=>{const {mkdtempSync,writeFileSync,existsSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');if(process.platform==='win32')return;const folder=mkdtempSync(join(tmpdir(),'owla-connect-cancel-')),file=join(folder,'codex'),marker=join(folder,'started');writeFileSync(file,'#!/bin/sh\nif [ "$1" = "--version" ]; then sleep 0.1; echo "codex-cli 0.162.1"; else touch "'+marker+'"; fi\n',{mode:0o700});const b=new CodexBridge();try{const pending=b.connect(file,folder);await new Promise(resolve=>setTimeout(resolve,20));b.disconnect();await assert.rejects(pending,/cancelled/);assert.equal(existsSync(marker),false);}finally{b.disconnect();rmSync(folder,{recursive:true,force:true});}});

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
 if(process.platform==='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-codex-discovery-'));
 try{const first=join(root,'first'),second=join(root,'second');mkdirSync(first);mkdirSync(second);writeFileSync(join(first,'codex'),'not executable',{mode:0o600});writeFileSync(join(second,'codex'),'#!/bin/sh\nexit 0\n',{mode:0o700});
 assert.equal(findCodexExecutable(['.',first,second].join(delimiter),[]),join(second,'codex'));chmodSync(join(second,'codex'),0o600);assert.equal(findCodexExecutable([first,second].join(delimiter),[]),'');
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
 assert.equal(bridge.buffer,'');
 assert.match(bridge.status,/16 MiB/);
});
