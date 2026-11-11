import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeRoute,fallbackRoute,routingModels} from '../src/routing';
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
