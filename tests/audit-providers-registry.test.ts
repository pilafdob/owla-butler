// Audit: the four provider bridges must present one identical contract.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {PROVIDER_IDS,PROVIDER_NAMES,toolName,prefixToolNames,type ProviderBridge,type ProviderId} from '../src/provider';
import {CodexBridge} from '../src/codex';
import {OpencodeBridge} from '../src/opencode';
import {ClaudeBridge} from '../src/claude';
import {HermesBridge} from '../src/hermes';
import {codexExhaustion,claudeExhaustion,opencodeExhaustion} from '../src/exhaustion';

const bridges:Record<ProviderId,ProviderBridge>={codex:new CodexBridge(),opencode:new OpencodeBridge(),claude:new ClaudeBridge(),hermes:new HermesBridge()};

test('every provider id has a name, a bridge and the shared tool-name shape',()=>{
 assert.deepEqual([...PROVIDER_IDS],['codex','opencode','claude','hermes']);
 for(const id of PROVIDER_IDS){
  assert.ok(PROVIDER_NAMES[id],id);
  const bridge=bridges[id];
  assert.equal(bridge.id,id);
  for(const method of ['connect','resolveModel','run','signIn','readUsage','hold','disconnect'] as const)assert.equal(typeof bridge[method],'function',id+'.'+method);
  assert.equal(toolName(id,'read_note'),id==='opencode'?'owla_read_note':id==='codex'?'read_note':'mcp__owla__read_note');
 }
});

test('every bridge starts disconnected with an empty, consistent registry',async()=>{
 for(const id of PROVIDER_IDS){
  const bridge=bridges[id];
  assert.equal(bridge.ready,false,id);
  assert.equal(bridge.running,false,id);
  assert.deepEqual(bridge.models,[],id);
  assert.deepEqual(bridge.selectableModels,[],id);
  assert.equal(bridge.usage,null,id);
  assert.equal(bridge.usageUpdatedAt,0,id);
  assert.equal(bridge.usageError,'',id);
  assert.equal(bridge.resolveModel(''),undefined,id);
  assert.equal(bridge.resolveModel('missing-model'),undefined,id);
  // A hold and its release are safe before any connection exists.
  const release=bridge.hold();
  await release();
  // Disconnect is idempotent and never throws on an unconnected bridge.
  bridge.disconnect();
  bridge.disconnect();
  assert.equal(bridge.ready,false,id);
  assert.equal(typeof bridge.status,'string',id);
 }
});

test('exhaustion starts unknown-not-exhausted for every provider',()=>{
 assert.equal(codexExhaustion(null).exhausted,false);
 assert.equal(claudeExhaustion(null).exhausted,false);
 assert.equal(opencodeExhaustion('network error',null).exhausted,false);
 // Hermes reports no meters of its own; its bridge carries no exhaustion until a limit error.
 assert.equal(bridges.hermes.usage,null);
 assert.equal((bridges.hermes as HermesBridge).exhaustion,null);
 // OpenCode with no catalogue is not exhausted (nothing is blocked yet).
 assert.equal((bridges.opencode as OpencodeBridge).exhaustion,null);
});

test('instruction tool names are rewritten once per provider and never double-prefixed',()=>{
 const tools=['read_reference','read_pdf','propose_pdf_annotation','read_note','search_vault','propose_edit','propose_note','propose_deletion','read_attachment','list_vault_paths','propose_organization','query_vault_graph','propose_properties','propose_outline','export_pdf','propose_page_breaks','read_canvas','propose_canvas','read_base','propose_base','read_excalidraw','propose_excalidraw'];
 const text='Use '+tools.join(', ')+'.';
 for(const id of PROVIDER_IDS){
  const once=prefixToolNames(text,id);
  assert.equal(prefixToolNames(once,id),once,'double prefix for '+id);
  if(id==='codex'){assert.equal(once,text);continue;}
  for(const name of tools){
   const shaped=toolName(id,name);
   assert.ok(once.includes(shaped),id+' missing '+shaped);
   assert.equal(once.includes(shaped+'_'+name),false);
  }
  // A name that already carries the provider shape is left alone.
  assert.equal(prefixToolNames(toolName(id,'read_note'),id),toolName(id,'read_note'));
 }
});

test('a mid-turn provider switch keeps each bridge state independent',async()=>{
 // Holding one provider never rests or disconnects another.
 const releases=PROVIDER_IDS.map(id=>bridges[id].hold());
 for(const id of PROVIDER_IDS)assert.equal(bridges[id].ready,false,id);
 for(const release of releases)await release();
 for(const id of PROVIDER_IDS){
  assert.equal(bridges[id].ready,false,id);
  assert.deepEqual(bridges[id].models,[],id);
 }
});
