import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeRoute,fallbackRoute,routingModels,summarizeRoutingContext} from '../src/routing';
import {migrateSettings} from '../src/core';
import type {CodexModel} from '../src/codex';

const models:CodexModel[]=[
 {id:'fast',model:'fast',displayName:'Fast',isDefault:false,defaultReasoningEffort:'low',
  supportedReasoningEfforts:[{reasoningEffort:'low',description:''}],inputModalities:['text']},
 {id:'general',model:'general',displayName:'General',isDefault:true,defaultReasoningEffort:'medium',
  supportedReasoningEfforts:[{reasoningEffort:'medium',description:''},{reasoningEffort:'high',description:''}],inputModalities:['text','image']}
];

test('routes must identify an available model and a reasoning effort it supports',()=>{
 assert.deepEqual(decodeRoute('{"model":2,"effort":"high"}',models),{model:'general',effort:'high'});
 for(const output of ['{"model":2,"effort":"low"}','{"model":999,"effort":"high"}','{"model":"2","effort":"high"}','rewrite this prompt']){
  assert.throws(()=>decodeRoute(output,models));
 }
});

test('automatic routing is opt-in and fallback preserves compatible manual selections',()=>{
 assert.equal(migrateSettings({schemaVersion:2}).automaticRouting,false);
 assert.equal(migrateSettings({schemaVersion:2,automaticRouting:true}).automaticRouting,true);
 const manual={model:'fast',effort:'low'};
 assert.deepEqual(fallbackRoute(routingModels(models,false),manual),manual);
 assert.deepEqual(fallbackRoute(routingModels(models,true),manual),{model:'general',effort:'medium'});
});


test('routing inventory keeps counts and selected pages while bounding attachment names',()=>{
 const inventory=summarizeRoutingContext({
  attachments:[
   {kind:'pdf',name:'Private folder/Study.pdf',page:9},
   ...Array.from({length:15},()=>({kind:'image' as const,name:'a'.repeat(100)+'\n.png'}))
  ],
  activeNote:true,selections:2,recentMessages:4,previousImages:1,previousPdfs:2,webSearch:false
 });
 assert.deepEqual(inventory.items[0],{kind:'pdf',name:'Study.pdf',page:9});
 assert.equal(inventory.items.length,12);
 assert.equal(inventory.totals.image,15);
 assert.equal(inventory.omittedItems,4);
 assert.equal(inventory.previousImages,1);
 assert.ok(inventory.items.every(item=>item.name.length<=72));
 assert.doesNotMatch(JSON.stringify(inventory),/Private folder/);
});

test('automatic routing only offers reasoning efforts compatible with OWLA’s single-agent session',()=>{
 const ultra={reasoningEffort:'ultra',description:''};
 const [candidate]=routingModels([{
  ...models[1],defaultReasoningEffort:'ultra',
  supportedReasoningEfforts:[ultra,...models[1].supportedReasoningEfforts]
 }],true);
 assert.deepEqual(candidate.supportedReasoningEfforts,models[1].supportedReasoningEfforts);
 assert.deepEqual(fallbackRoute([candidate],{model:'general',effort:'ultra'}),{model:'general',effort:'medium'});
 assert.throws(()=>decodeRoute('{"model":1,"effort":"ultra"}',[candidate]));
});
