import {test} from 'node:test';import assert from 'node:assert/strict';
import {currentModels,modelProfile,isFreeModel} from '../src/model-profiles';
import {opencodeExhaustion} from '../src/exhaustion';
import type {ProviderModel} from '../src/provider';

const efforts=(list:string)=>list.split('/').map(reasoningEffort=>({reasoningEffort,description:''}));
const model=(id:string,displayName:string,list='low/medium/high/xhigh/max',extra:Partial<ProviderModel>={}):ProviderModel=>({id,model:id,displayName,isDefault:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:efforts(list),inputModalities:['text','image'],...extra});
const free=(id:string,name:string,image=true)=>model(id,name,'low/high/max',{cost:{input:0,output:0},context:200000,inputModalities:image?['text','image']:['text']});

test('OpenCode Go and other providers are rated by their native family',()=>{
 assert.equal(modelProfile('opencode',model('opencode-go/claude-opus-5-5','Claude Opus 5.5','low/medium/high/xhigh/max',{cost:{input:4,output:20}})).capability,5);
 assert.equal(modelProfile('opencode',model('opencode/gpt-6-luna','GPT-6 Luna','low/medium/high/xhigh/max',{cost:{input:0.1,output:0.5}})).capability,2);
 assert.equal(modelProfile('opencode',model('opencode-go/gemini-4-argon','Gemini 4 Argon','low/medium/high/xhigh/max',{cost:{input:2,output:10}})).strong.includes('vision'),true);
});

test('paid OpenCode models are tiered by price',()=>{
 assert.equal(modelProfile('opencode',model('x/claude-haiku-5-5','Claude Haiku 5.5','low/medium/high/xhigh/max',{cost:{input:0.1,output:0.5}})).cost,1);
 assert.equal(modelProfile('opencode',model('x/claude-sonnet-5-5','Claude Sonnet 5.5','low/medium/high/xhigh/max',{cost:{input:2,output:10}})).cost,2);
 assert.equal(modelProfile('opencode',model('x/claude-opus-5-5','Claude Opus 5.5','low/medium/high/xhigh/max',{cost:{input:4,output:20}})).cost,3);
 assert.equal(modelProfile('opencode',model('x/gpt-6-astra','GPT-6 Astra','low/medium/high/xhigh/max',{cost:{input:10,output:50}})).cost,4);
 assert.equal(modelProfile('opencode',free('x/iceman-free','Iceman Free')).cost,0);
});

test('the same model offered by two providers is offered once, cheaper first',()=>{
 const models=[
  model('opencode/glm-5.3','GLM-5.3','low/medium/high/xhigh/max',{cost:{input:1.4,output:4.4}}),
  model('opencode-go/glm-5.3','GLM-5.3','low/medium/high/xhigh/max',{cost:{input:1.4,output:4.4}}),
 ];
 const ids=currentModels('opencode',models,4).map(m=>m.id);
 assert.equal(ids.length,1);
 assert.equal(ids[0],'opencode-go/glm-5.3');
});

test('paid models keep half of the OpenCode pool so hard tasks are not forced onto free models',()=>{
 const models=[
  free('opencode/big-pickle','Big Pickle',false),
  free('opencode/iceman-free','Iceman Free'),
  free('opencode/beam-free','Beam Free'),
  free('opencode/flint-40b-free','Flint 40B Free'),
  model('opencode-go/claude-opus-5-5','Claude Opus 5.5','low/medium/high/xhigh/max',{cost:{input:4,output:20}}),
  model('opencode-go/gpt-6-astra','GPT-6 Astra','low/medium/high/xhigh/max',{cost:{input:10,output:50}}),
 ];
 const ids=currentModels('opencode',models,4);
 assert.ok(ids.some(id=>id.id.startsWith('opencode-go/')),'a paid model must be in the pool');
 assert.ok(ids.filter(id=>isFreeModel(id)).length<=2,'free models must not fill every slot');
});

test('a free-tier limit is scoped to free models, a real limit to the whole provider',()=>{
 const free=opencodeExhaustion('Free usage limit reached.',2000000000);
 const paid=opencodeExhaustion('rate limit exceeded',2000000000);
 assert.equal(free.scope,'free models');
 assert.equal(free.exhausted,true);
 assert.equal(paid.scope,'provider');
 assert.equal(opencodeExhaustion('network error',null).exhausted,false);
});