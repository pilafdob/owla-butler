// Regression tests for the 3.3.0 security fixes that live in modules without an Obsidian
// runtime dependency. Finding IDs refer to review-33.md, review-33-rereview.md and
// review-33-third.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Workspace} from 'obsidian';
import {CodexBridge,isolationReport} from '../src/codex';
import {PROBE_0169_CONFIG,PROBE_0169_FEATURES_330_OVERRIDES,PROBE_0169_FEATURES_FINAL} from './helpers/codex-probe';
import {PluginTurn} from '../src/plugin-api';
import {loadPendingEdits,savePendingEdits} from '../src/recovery';
import type {ToolSpec} from '../src/provider';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- R3: Codex item allowlist

const isolatedConfig={config:{notify:[],hooks:{},sandbox_mode:'read-only',approval_policy:'never',features:{shell_tool:false,apps:false},analytics:{enabled:false},feedback:{enabled:false},otel:{exporter:'none',trace_exporter:'none',metrics_exporter:'none'}}};
const readNote:ToolSpec={type:'function',name:'read_note',description:'Read a note',inputSchema:{type:'object'}};

/** Runs one Codex turn in which the app server announces `item`, then completes the turn. */
async function turnWithItem(item:Record<string,unknown>,{web=false,tools=[readNote]}:{web?:boolean;tools?:ToolSpec[]}={}){
 const b=new CodexBridge() as any;
 b.connect=async()=>{};
 b.models=[{model:'test',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];
 const activity:string[]=[];
 b.request=async(method:string)=>{
  if(method==='config/read')return isolatedConfig;
  if(method==='account/read')return {account:{type:'chatgpt',planType:'plus'}};
  if(method==='thread/start')return {thread:{id:'t'}};
  if(method==='turn/start'){
   queueMicrotask(()=>{
    b.receive({method:'item/started',params:{threadId:'t',item}});
    b.receive({method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});
   });
   return {turn:{id:'turn'}};
  }
  return {};
 };
 const result=b.run({executable:'',cwd:'/private/tmp',model:'test',effort:'low',instructions:'',text:'q',images:[],tools,web,signal:new AbortController().signal,onText:()=>{},onActivity:(line:string)=>activity.push(line),tool:async()=>''});
 return {result,activity,bridge:b};
}

// Every ThreadItem type in the Codex 0.169.0 app-server schema (review-33-rereview R3).
const ALLOWED_ITEMS=['userMessage','agentMessage','reasoning','contextCompaction','plan','functionCallOutput'];
const DENIED_ITEMS=['commandExecution','fileChange','mcpToolCall','collabAgentToolCall','imageView','imageGeneration','hookPrompt','sleep','subAgentActivity','enteredReviewMode','exitedReviewMode'];

test('R3: conversational Codex items are allowed through a turn',async()=>{
 for(const type of ALLOWED_ITEMS){
  const {result}=await turnWithItem({type});
  await assert.doesNotReject(result,type);
 }
});

test('R3: commandExecution, fileChange, mcpToolCall and every other capability item stop the turn',async()=>{
 for(const type of DENIED_ITEMS){
  const {result,bridge}=await turnWithItem({type});
  await assert.rejects(result,/outside OWLA tools/,type);
  assert.equal(bridge.status,'Disconnected',type);
 }
});

test('R3: unknown Codex item types are denied by default',async()=>{
 for(const item of [{type:'someFutureItem'},{type:''},{}]){
  const {result}=await turnWithItem(item);
  await assert.rejects(result,/outside OWLA tools/,JSON.stringify(item));
 }
});

test('R3: a webSearch item is rejected when web search is off and accepted when it is on',async()=>{
 const off=await turnWithItem({type:'webSearch'},{web:false});
 await assert.rejects(off.result,/web search without consent/);
 assert.equal(off.bridge.status,'Disconnected');
 const on=await turnWithItem({type:'webSearch'},{web:true});
 await assert.doesNotReject(on.result);
 assert.ok(on.activity.includes('Searching the web…'));
});

test('R3: a dynamicToolCall for a tool that was not offered is rejected',async()=>{
 const offered=await turnWithItem({type:'dynamicToolCall',tool:'read_note'});
 await assert.doesNotReject(offered.result);
 for(const tool of ['propose_edit','shell']){
  const {result}=await turnWithItem({type:'dynamicToolCall',tool});
  await assert.rejects(result,/outside OWLA tools/,tool);
 }
 // A read-only turn that offers no tools cannot run any tool.
 const none=await turnWithItem({type:'dynamicToolCall',tool:'read_note'},{tools:[]});
 await assert.rejects(none.result,/outside OWLA tools/);
});

// ---------------------------------------------------------------- U2: Codex feature isolation (3.3.1)

/** Runs one Codex turn whose per-turn `config/read` returns `config`; reports whether thread/start was reached. */
async function turnWithConfig(config:Record<string,unknown>){
 const b=new CodexBridge() as any;
 b.connect=async()=>{};
 b.child={stdin:{write:()=>{},end:()=>{}},kill:()=>{},exitCode:0,signalCode:null,once:()=>{}};
 b.initialized=true;
 b.models=[{model:'test',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];
 let threadStarted=false;
 b.request=async(method:string)=>{
  if(method==='config/read')return {config};
  if(method==='account/read')return {account:{type:'chatgpt',planType:'plus'}};
  if(method==='thread/start'){threadStarted=true;return {thread:{id:'t'}};}
  if(method==='turn/start'){queueMicrotask(()=>b.receive({method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}}));return {turn:{id:'turn'}};}
  return {};
 };
 const result=b.run({executable:'',cwd:'/private/tmp',model:'test',effort:'low',instructions:'',text:'q',images:[],tools:[],web:false,signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},tool:async()=>''});
 return {result,bridge:b,started:()=>threadStarted};
}

test('U2: the stock Codex 0.169.0 config/read result (true defaults, nulls, hooks: null) passes start and every turn',async()=>{
 assert.equal(isolationReport({...PROBE_0169_CONFIG,features:PROBE_0169_FEATURES_330_OVERRIDES}).fatal,undefined);
 assert.deepEqual(isolationReport({...PROBE_0169_CONFIG,features:PROBE_0169_FEATURES_FINAL},'turn'),{disableFeatures:[]});
 const {result,started}=await turnWithConfig({...PROBE_0169_CONFIG,features:PROBE_0169_FEATURES_FINAL});
 await assert.doesNotReject(result);
 assert.equal(started(),true);
});

test('U2: a feature turned on, a non-boolean value or an unsafe key mid-session stops the turn before thread/start',async()=>{
 const cases:[Record<string,unknown>,RegExp][]=[
  [{fast_mode:true},/feature fast_mode was turned on while Codex was running\. Reconnect Codex/],
  [{multi_agent_v2:{x:1}},/feature multi_agent_v2 has an unsupported value/],
  [{'features.x':true},/feature name .* is not supported/],
 ];
 for(const [extra,message] of cases){
  const {result,bridge,started}=await turnWithConfig({...PROBE_0169_CONFIG,features:{...PROBE_0169_FEATURES_FINAL,...extra}});
  await assert.rejects(result,message,JSON.stringify(extra));
  assert.equal(started(),false,JSON.stringify(extra));
  // The process is stopped so that Reconnect probes the configuration again.
  assert.equal(bridge.child,null,JSON.stringify(extra));
 }
});

// ---------------------------------------------------------------- M5: companion plugin discovery

const request={plugin:'pinup',key:'pin',path:'Projects/Plan.md'};
const validApi=(extra:Record<string,unknown>={})=>({version:1,read:()=>null,prepare:()=>({}),...extra});
function workspace({replies=[] as unknown[],enabled,installed}:{replies?:unknown[];enabled?:string[];installed?:Record<string,unknown>}){
 const plugins=enabled?{enabledPlugins:new Set(enabled),getPlugin:(id:string)=>installed&&id in installed?{api:installed[id]}:null}:undefined;
 return {
  app:plugins?{plugins}:undefined,
  trigger:(event:string,reply:(api:unknown)=>void)=>{if(event==='pilafdob:pinup:api:v1')replies.forEach(reply);},
 } as unknown as Workspace;
}
const offers=(ws:Workspace)=>new PluginTurn(ws,()=>true,()=>true).specs.length>0;

test('M5: a companion that answers the API event but is not enabled is not used',()=>{
 assert.equal(offers(workspace({replies:[validApi()],enabled:[]})),false);
 assert.equal(offers(workspace({replies:[validApi()],enabled:['nicons']})),false);
 // Control: the same reply is accepted once pinup is enabled.
 assert.equal(offers(workspace({replies:[validApi()],enabled:['pinup']})),true);
});

test('M5: an API whose identity fields name another plugin is rejected',()=>{
 for(const extra of [{id:'nicons'},{pluginId:'evil'},{manifestId:'other'},{plugin:'other'},{manifest:{id:'nicons'}},{manifest:{pluginId:'x'}}]){
  assert.equal(offers(workspace({replies:[validApi(extra)],enabled:['pinup']})),false,JSON.stringify(extra));
 }
 assert.equal(offers(workspace({replies:[validApi({id:'pinup',manifest:{id:'pinup'}})],enabled:['pinup']})),true);
});

test('M5: several responders to the API event are rejected, so a spoofer cannot race the real plugin',()=>{
 assert.equal(offers(workspace({replies:[validApi(),validApi()],enabled:['pinup']})),false);
 assert.equal(offers(workspace({replies:[validApi(),{version:1}],enabled:['pinup']})),false);
});

test('M5: the installed plugin API wins over a spoofed event reply',()=>{
 let used='';
 const real=validApi({read:()=>{used='real';return null;}});
 const spoof=validApi({read:()=>{used='spoof';return null;}});
 const turn=new PluginTurn(workspace({replies:[spoof,real],enabled:['pinup'],installed:{pinup:real}}),()=>true,()=>true);
 turn.invoke('inspect_pilafdob_plugin',request);
 assert.equal(used,'real');
});

// ---------------------------------------------------------------- M2: pending-edit load failure

test('M2: a pending record for a now-excluded path fails the load instead of being dropped',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-pending-excluded-'));
 try{
  savePendingEdits(root,[
   {edit:{path:'Notes/A.md',before:'a',after:'b',reason:'r'},reasons:['r']},
   {edit:{path:'Private/B.md',before:'c',after:'d',reason:'r'},reasons:['r']},
  ]);
  assert.equal(loadPendingEdits(root).length,2);
  assert.throws(()=>loadPendingEdits(root,'Private'),/no longer allowed: Private\/B\.md/);
  // Case and Unicode spellings of the exclusion are treated the same way.
  assert.throws(()=>loadPendingEdits(root,'private'),/no longer allowed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('hooks: trusted state never bypasses runtime isolation before thread/start',async()=>{
 for(const active of [false,true]){
  const b=new CodexBridge() as any,methods:string[]=[];
  b.connect=async()=>{};
  b.models=[{model:'test',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];
  b.request=async(method:string,params:any)=>{
   methods.push(method);
   if(method==='account/read')return {account:{type:'chatgpt'}};
   if(method==='config/read')return {config:{...isolatedConfig.config,features:{...isolatedConfig.config.features,hooks:false},hooks:{Stop:[],state:{fixture:{enabled:true,trusted_hash:'sha256:fixture'}}}}};
   if(method==='hooks/list')return {data:[{cwd:params.cwds[0],hooks:active?[{eventName:'stop',enabled:true,trustStatus:'trusted'}]:[],warnings:[],errors:[]}]};
   if(method==='thread/start')return {thread:{id:'t'}};
   if(method==='turn/start'){
    queueMicrotask(()=>b.receive({method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}}));
    return {turn:{id:'turn'}};
   }
   return {};
  };
  const pending=b.run({executable:'',cwd:tmpdir(),model:'test',effort:'low',instructions:'',text:'fixture',images:[],tools:[],web:false,signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},tool:async()=>''});
  if(active){await assert.rejects(pending,/could not verify that hooks are disabled/);assert.ok(!methods.includes('thread/start'));}
  else{await pending;assert.ok(methods.indexOf('hooks/list')<methods.indexOf('thread/start'));}
 }
});
