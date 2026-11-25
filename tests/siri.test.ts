import {test} from 'node:test';import assert from 'node:assert/strict';
import {ChatStreamReader,chatTools,parseSiriHealth,parseSiriQuota,siriExhaustion,siriSocketPath,siriSupported,SIRI_MODELS,SiriBridge} from '../src/siri';
import {disableAutomaticSelectionOutsideMac,migrateSettings,readSettings,writeSettings} from '../src/core';
import {PROVIDER_TAB_ORDER,prefixToolNames,toolName} from '../src/provider';
import {loadMain} from './helpers/load-main';

test('Siri AI exists only on macOS 27 with Apple’s fm tool',()=>{
 assert.equal(siriSupported('darwin','27.3.0',()=>true),true);
 assert.equal(siriSupported('darwin','26.4.0',()=>true),false);
 assert.equal(siriSupported('darwin','27.0.0',()=>false),false);
 assert.equal(siriSupported('win32','27.0.0',()=>true),false);
 assert.equal(siriSupported('linux','27.0.0',()=>true),false);
});

test('fm serve health: PCC refusal is kept with its reason, the on-device model stays usable',()=>{
 const health=parseSiriHealth({status:'fm serve is running',models:[{name:'system',available:true},{name:'pcc',available:false,reason:'Private Cloud Compute is not available in this context. Please use the Terminal app.'}]});
 assert.equal(health.system.available,true);
 assert.equal(health.pcc.available,false);
 assert.match(health.pcc.reason,/not available in this context/);
 assert.equal(parseSiriHealth(null).pcc.available,false);
 const bridge=new SiriBridge();
 bridge.models=SIRI_MODELS;bridge.health=health;
 assert.deepEqual(bridge.selectableModels.map(m=>m.id),['system']);
 assert.equal(bridge.resolveModel('pcc')?.id,'system');
 bridge.health={...health,pcc:{available:true,reason:''}};
 assert.equal(bridge.resolveModel('')?.id,'pcc');
});

test('PCC quota: percentages, counts and remaining shares become one usage window',()=>{
 assert.equal(parseSiriQuota('System: Not applicable (quota only applies to PCC)\nPCC: unavailable (Private Cloud Compute is not available in this context.)'),null);
 assert.equal(parseSiriQuota('PCC: 40% used')?.rateLimitsByLimitId?.siri?.primary?.usedPercent,40);
 assert.equal(parseSiriQuota('PCC: 25% remaining')?.rateLimitsByLimitId?.siri?.primary?.usedPercent,75);
 assert.equal(parseSiriQuota('PCC: 30 of 120 requests')?.rateLimitsByLimitId?.siri?.primary?.usedPercent,25);
 const now=Date.parse('2026-11-24T12:00:00Z');
 assert.equal(parseSiriQuota('PCC: 100% used, resets in 2 hours',now)?.rateLimitsByLimitId?.siri?.primary?.resetsAt,now/1000+7200);
 assert.equal(parseSiriQuota('nothing useful'),null);
});

test('a PCC quota error marks Siri AI exhausted for a bounded retry',()=>{
 const state=siriExhaustion(Error('Siri AI: quota exceeded'),1000);
 assert.equal(state?.exhausted,true);
 assert.equal(state?.resetsAt,1000+900);
 assert.equal(siriExhaustion(Error('connection refused')),null);
});

test('streamed replies: text deltas and tool calls split across chunks are reassembled',()=>{
 const seen:string[]=[];
 const reader=new ChatStreamReader(delta=>seen.push(delta));
 reader.push('data: {"choices":[{"delta":{"content":"Hel"},"index":0}]}\n\ndata: {"choices":[{"delta":{"con');
 reader.push('tent":"lo"},"index":0}]}\n\n');
 reader.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_note","arguments":"{\\"path\\":"}}]}}]}\n');
 reader.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.md\\"}"}}]},"finish_reason":"tool_calls"}]}\ndata: [DONE]\n');
 assert.deepEqual(seen,['Hel','lo']);
 assert.equal(reader.text,'Hello');
 assert.equal(reader.finish,'tool_calls');
 assert.deepEqual([...reader.calls.values()],[{id:'c1',name:'read_note',arguments:'{"path":"a.md"}'}]);
 assert.throws(()=>new ChatStreamReader(()=>{}).push('data: {"error":{"message":"quota exceeded"}}\n'),/Siri AI: quota exceeded/);
});

test('Siri AI reaches the vault only through OWLA’s tools, under their own names',()=>{
 assert.equal(toolName('siri','read_note'),'read_note');
 assert.equal(prefixToolNames('Use read_note.','siri'),'Use read_note.');
 assert.deepEqual(chatTools([{type:'function',name:'read_note',description:'Read',inputSchema:{type:'object'}}]),[{type:'function',function:{name:'read_note',description:'Read',parameters:{type:'object'}}}]);
});

test('the private fm socket path stays under the macOS socket length limit',()=>{
 assert.equal(siriSocketPath('/var/folders/ab/cd/T','12345678'),'/var/folders/ab/cd/T/owla-fm-12345678.sock');
 assert.equal(siriSocketPath('/'+'x'.repeat(120),'12345678'),'/tmp/owla-fm-12345678.sock');
});

test('settings: tab order, ordered fallbacks and provider switches migrate from 3.7',()=>{
 assert.deepEqual([...PROVIDER_TAB_ORDER],['codex','claude','opencode','hermes','siri']);
 const old=migrateSettings({schemaVersion:3,provider:'claude',fallback:'codex'});
 assert.deepEqual(old.fallbacks,['codex']);
 assert.equal(old.fallback,'codex');
 // Existing providers stay on; Siri AI is opt-in.
 assert.deepEqual(old.enabledProviders,{codex:true,opencode:true,claude:true,hermes:true,siri:false});
 const list=migrateSettings({schemaVersion:3,provider:'claude',fallbacks:['codex','claude','codex','nope','hermes'],enabledProviders:{opencode:false,siri:true},siriFallback:true});
 assert.deepEqual(list.fallbacks,['codex','hermes']);
 assert.equal(list.fallback,'codex');
 assert.equal(list.enabledProviders.opencode,false);
 assert.equal(list.enabledProviders.siri,true);
 assert.equal(list.siriFallback,true);
 // One Automatic switch: either old flag turns both on.
 const auto=migrateSettings({schemaVersion:3,automaticRouting:true});
 assert.equal(auto.automaticProvider,true);assert.equal(auto.automaticRouting,true);
 // Per platform: Windows never keeps Siri AI.
 const win=disableAutomaticSelectionOutsideMac(migrateSettings({schemaVersion:3,provider:'siri',fallbacks:['siri','codex'],enabledProviders:{siri:true},siriFallback:true}),'win32');
 assert.equal(win.provider,'codex');
 assert.deepEqual(win.fallbacks,['codex']);
 assert.equal(win.enabledProviders.siri,false);
 assert.equal(win.siriFallback,false);
 const saved=writeSettings(list,{},'mac');
 assert.deepEqual(readSettings(saved,'mac').fallbacks,['codex','hermes']);
 assert.deepEqual(readSettings(saved,'windows').fallbacks,[]);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fakeButler(prefs:Record<string,unknown>,exhausted:string[]){
 const {Butler}=await loadMain();
 const butler=Object.create(Butler.prototype);
 butler.prefs={...migrateSettings({schemaVersion:3,codexConnected:true,opencodeConnected:true,claudeConnected:true,hermesConnected:true,siriConnected:true}),...prefs};
 butler.fallbackProvider=null;
 butler.exhaustion={};
 butler.recordExhaustion=(id:string)=>(butler.exhaustion[id]={provider:id,exhausted:exhausted.includes(id),resetsAt:null,reason:'',scope:'provider'});
 return butler as any;
}

test('fallback chain: secondary, then third, skipping switched-off providers, then Siri AI last',async()=>{
 const butler=await fakeButler({provider:'codex',fallbacks:['claude','opencode']},['codex','claude']);
 assert.equal(butler.applyFallback(),'opencode');
 assert.equal(butler.activeProvider,'opencode');
 // The primary resets: back to it.
 const back=await fakeButler({provider:'codex',fallbacks:['claude']},[]);
 back.fallbackProvider='claude';
 assert.equal(back.applyFallback(),'codex');
 // A switched-off fallback is skipped.
 const off=await fakeButler({provider:'codex',fallbacks:['claude','opencode'],enabledProviders:{codex:true,claude:false,opencode:true,hermes:true,siri:false}},['codex']);
 assert.equal(off.applyFallback(),'opencode');
 // With Automatic on there is no fallback switch.
 const auto=await fakeButler({provider:'codex',fallbacks:['claude'],automaticProvider:true},['codex']);
 assert.equal(auto.applyFallback(),null);
 if(siriSupported()){
  const siri=await fakeButler({provider:'codex',fallbacks:['claude'],siriFallback:true,enabledProviders:{codex:true,claude:true,opencode:true,hermes:true,siri:true}},['codex','claude']);
  assert.equal(siri.applyFallback(),'siri');
 }
});

test('provider order keeps only switched-on providers and never repeats one',async()=>{
 const butler=await fakeButler({provider:'claude',fallbacks:['codex','hermes'],enabledProviders:{codex:true,claude:true,opencode:true,hermes:false,siri:false}},[]);
 assert.deepEqual(butler.providerOrder(),['claude','codex']);
 assert.equal(butler.isProviderEnabled('hermes'),false);
 assert.ok(!butler.availableProviders().includes('siri')||siriSupported());
});

test('fm schemas: a map with typed values becomes a free-form object, nothing else changes',async()=>{
 const {fmSchema}=await import('../src/siri');
 const schema={type:'object',properties:{set:{type:'object',additionalProperties:true},rename:{type:'object',additionalProperties:{type:'string'}},list:{type:'array',items:{type:'object',properties:{a:{type:'string'}},additionalProperties:false}}},additionalProperties:false};
 assert.deepEqual(fmSchema(schema),{type:'object',properties:{set:{type:'object',additionalProperties:true},rename:{type:'object',additionalProperties:true},list:{type:'array',items:{type:'object',properties:{a:{type:'string'}},additionalProperties:false}}},additionalProperties:false});
});

test('the on-device model gets the core note tools only; Private Cloud Compute gets all',async()=>{
 const {ON_DEVICE_TOOLS}=await import('../src/siri');
 const specs=['read_note','propose_edit','read_canvas','propose_organization','query_vault_graph'].map(name=>({type:'function' as const,name,description:'',inputSchema:{type:'object'}}));
 assert.deepEqual(chatTools(specs,'system').map(t=>t.function.name),['read_note','propose_edit']);
 assert.equal(chatTools(specs,'pcc').length,5);
 assert.ok(ON_DEVICE_TOOLS.has('search_vault'));
});

/** Feeds the bridge canned streamed replies instead of a running fm server. */
function scriptedBridge(replies:string[]){
 const bridge=new SiriBridge();
 bridge.models=SIRI_MODELS;
 bridge.health={pcc:{available:false,reason:'x'},system:{available:true,reason:''}};
 const sent:unknown[]=[];
 (bridge as any).http=async(_m:string,_p:string,body:unknown,_t:number,onData:(chunk:string)=>void)=>{sent.push(structuredClone(body));onData(replies.shift()??'data: [DONE]\n');return '';};
 return {bridge,sent};
}
const call=(name:string,args:string)=>'data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'c1',function:{name,arguments:args}}]},finish_reason:'tool_calls'}]})+'\n';
const text=(value:string)=>'data: '+JSON.stringify({choices:[{delta:{content:value},finish_reason:'stop'}]})+'\n';
const runOptions=(tool:(name:string,args:unknown)=>Promise<string>,signal=new AbortController().signal)=>({executable:'',cwd:'',model:'system',effort:'default',instructions:'I',text:'T',images:[],tools:[{type:'function' as const,name:'read_note',description:'',inputSchema:{type:'object'}}],web:false,signal,onText:()=>{},onActivity:()=>{},tool});

test('a refused tool call goes back to the model instead of ending the reply',async()=>{
 const {bridge,sent}=scriptedBridge([call('read_note','{"block":""}'),text('Done.')]);
 const result=await bridge.run(runOptions(async()=>{throw Error('Provide a block ID such as ^abc123.');}));
 assert.equal(result.text,'Done.');
 const second=sent[1] as {messages:{role:string;content:string}[]};
 assert.deepEqual(second.messages.at(-1),{role:'tool',tool_call_id:'c1',content:'Error: Provide a block ID such as ^abc123.'});
});

test('a stop still ends the reply',async()=>{
 const {bridge}=scriptedBridge([call('read_note','{}'),text('never')]);
 await assert.rejects(bridge.run(runOptions(async()=>{throw Error('Stopped.');})),/Stopped/);
});

test('the one-message override lists Siri AI when it is on and connected; Automatic does not pick it',async()=>{
 const butler=await fakeButler({enabledProviders:{codex:true,opencode:true,claude:true,hermes:true,siri:true}},[]);
 const supported=butler.availableProviders().includes('siri');
 assert.equal(butler.automaticCandidates().includes('siri'),false);
 assert.equal(butler.automaticCandidates(true).includes('siri'),supported);
});

test('a context-size error is not a usage limit',()=>{
 assert.equal(siriExhaustion(Error("Siri AI: The session's transcript exceeded the model's context size.")),null);
 assert.equal(siriExhaustion(Error('Siri AI: quota exceeded'))?.exhausted,true);
 assert.equal(siriExhaustion(Error('Siri AI: rate limit reached'))?.exhausted,true);
});

test('the on-device transcript stays bounded: long results shortened, earlier rounds collapsed',async()=>{
 const {compactTranscript,ON_DEVICE_TOOL_RESULT}=await import('../src/siri');
 const long='x'.repeat(5000);
 const messages=[{role:'system',content:'I'},{role:'user',content:'T'},{role:'assistant',content:null},{role:'tool',content:long},{role:'assistant',content:null},{role:'tool',content:long}];
 compactTranscript(messages,'system');
 assert.match(String(messages[3].content),/Earlier tool result omitted/);
 assert.ok(String(messages[5].content).length<ON_DEVICE_TOOL_RESULT+200);
 assert.match(String(messages[5].content),/Result shortened/);
 const pcc=[{role:'assistant',content:null},{role:'tool',content:long}];
 compactTranscript(pcc,'pcc');
 assert.equal(pcc[1].content,long);
});
