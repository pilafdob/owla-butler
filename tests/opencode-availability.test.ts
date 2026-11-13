import {test} from 'node:test';import assert from 'node:assert/strict';
import {OpencodeAvailability,classifyOpencodeFailure,isOpencodeFreeModel,opencodePool} from '../src/opencode-availability';
import {autoEntries,scoreEntries,type ProviderOffer} from '../src/auto-route';
import type {ProviderModel} from '../src/provider';

const model=(id:string,cost:{input:number;output:number},name=id.split('/')[1]):ProviderModel=>({
 id,model:id.split('/')[1],providerID:id.split('/')[0],displayName:name,isDefault:false,defaultReasoningEffort:'medium',
 supportedReasoningEfforts:[{reasoningEffort:'low',description:''},{reasoningEffort:'medium',description:''},{reasoningEffort:'high',description:''}],
 inputModalities:['text'],cost
});
const NOW=1_000_000;
const zenPaid=model('opencode/claude-sonnet-5-5',{input:3,output:15},'Claude Sonnet 5.5');
const zenFree=model('opencode/big-pickle',{input:0,output:0},'Big Pickle');
const goPaid=model('opencode-go/glm-5.3',{input:1.4,output:4.4},'GLM-5.3');
const goFree=model('opencode-go/kimi-k3-free',{input:0.6,output:2.5},'Kimi K3 (free for a limited time)');
const copilotOpus=model('github-copilot/claude-opus-5.5',{input:0,output:0},'Claude Opus 5.5');
const copilotSonnet=model('github-copilot/claude-sonnet-5.5',{input:0,output:0},'Claude Sonnet 5.5');

test('OpenCode refusals are read by how far they reach',()=>{
 assert.equal(classifyOpencodeFailure('Model unavailable: github-copilot/claude-opus-5.5').scope,'model');
 assert.equal(classifyOpencodeFailure('Insufficient balance. Top up at https://opencode.ai/console/org_x/billing?credits=1.').kind,'balance');
 assert.equal(classifyOpencodeFailure('Free usage limit reached.').kind,'free-limit');
 assert.equal(classifyOpencodeFailure('429 Too Many Requests').kind,'usage-limit');
 assert.equal(classifyOpencodeFailure('This OpenCode Go model is hosted outside Europe and the United States.').kind,'region');
 assert.equal(classifyOpencodeFailure('socket hang up').scope,'none');
});

test('limited-time free models are free and sit in their own pool',()=>{
 assert.equal(isOpencodeFreeModel(goFree),true);
 assert.equal(isOpencodeFreeModel(goPaid),false);
 assert.equal(opencodePool(goFree),'free:opencode-go');
 assert.equal(opencodePool(goPaid),'paid:opencode-go');
});

test('a plan that lacks a model blocks only that model',()=>{
 const availability=new OpencodeAvailability();
 availability.recordFailure(copilotOpus,'Model unavailable: github-copilot/claude-opus-5.5',null,NOW);
 assert.equal(availability.available(copilotOpus,NOW),false);
 assert.equal(availability.available(copilotSonnet,NOW),true);
 // A plan refusal lasts until OWLA reloads.
 assert.equal(availability.available(copilotOpus,NOW+10*86400),false);
});

test('an empty console balance leaves the free models, OpenCode Go and other providers',()=>{
 const availability=new OpencodeAvailability();
 availability.recordFailure(zenPaid,'Insufficient balance. Top up at https://opencode.ai/console/org_x/billing?credits=1.',null,NOW);
 assert.equal(availability.available(zenPaid,NOW),false);
 for(const other of [zenFree,goPaid,goFree,copilotSonnet])assert.equal(availability.available(other,NOW),true,other.id);
 // The balance is checked again later, in case the user topped up.
 assert.equal(availability.available(zenPaid,NOW+31*60),true);
});

test('a depleted OpenCode Go plan leaves the console free models and Go’s limited-time free models',()=>{
 const availability=new OpencodeAvailability();
 availability.recordFailure(goPaid,'usage limit reached',NOW+3600,NOW);
 assert.equal(availability.available(goPaid,NOW),false);
 assert.equal(availability.available(zenFree,NOW),true);
 assert.equal(availability.available(goFree,NOW),true);
 assert.equal(availability.available(goPaid,NOW+3601),true);
});

test('a full Go meter blocks Go’s paid models before a turn is spent on them',()=>{
 const availability=new OpencodeAvailability();
 availability.applyUsage({rateLimitsByLimitId:{'opencode-go-weekly':{limitId:'opencode-go-weekly',primary:{usedPercent:100,resetsAt:NOW+7200}}}},NOW);
 assert.equal(availability.available(goPaid,NOW),false);
 assert.equal(availability.available(goFree,NOW),true);
 assert.equal(availability.nextReset([goPaid,goFree],NOW),NOW+7200);
 availability.applyUsage({rateLimitsByLimitId:{'opencode-go-weekly':{limitId:'opencode-go-weekly',primary:{usedPercent:20,resetsAt:NOW+7200}}}},NOW);
 assert.equal(availability.available(goPaid,NOW),true);
});

test('the free limit of the console does not block paid or Go models',()=>{
 const availability=new OpencodeAvailability();
 availability.recordFailure(zenFree,'Free usage limit reached.',NOW+600,NOW);
 assert.equal(availability.available(zenFree,NOW),false);
 assert.deepEqual(availability.freeLimit(NOW),{resetsAt:NOW+600});
 for(const other of [zenPaid,goPaid,goFree])assert.equal(availability.available(other,NOW),true,other.id);
});

test('a spent OpenCode Go meter does not rule out the free OpenCode models in automatic selection',()=>{
 const offers:ProviderOffer[]=[{provider:'opencode',plan:'',models:[zenFree,goPaid],
  usage:{rateLimitsByLimitId:{'opencode-go-weekly':{limitId:'opencode-go-weekly',primary:{usedPercent:95,resetsAt:NOW+7200}}}}}];
 const scored=scoreEntries(autoEntries(offers,false),offers,{difficulty:2,kind:'lookup',tools:false,effort:'low'},'opencode',NOW);
 const free=scored.find(item=>item.entry.key===zenFree.id);
 assert.ok(free?.eligible,'the free model stays eligible');
 assert.equal(free?.usage,null);
 assert.equal(scored.find(item=>item.entry.key===goPaid.id),undefined,'the nearly spent Go model is not eligible');
});
