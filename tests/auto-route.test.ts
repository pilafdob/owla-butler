import {test} from 'node:test';import assert from 'node:assert/strict';
import {autoEntries,autoFallbackRoute,classifyInstructions,decodeTaskClass,nearestEffort,pickRoute,remainingUsage,type ProviderOffer,type TaskClass} from '../src/auto-route';
import {currentModels,modelProfile} from '../src/model-profiles';
import {migrateSettings} from '../src/core';
import type {ProviderModel} from '../src/provider';

const efforts=(list:string)=>list.split('/').map(reasoningEffort=>({reasoningEffort,description:''}));
const model=(id:string,displayName:string,list='low/medium/high/xhigh/max',extra:Partial<ProviderModel>={}):ProviderModel=>({id,model:id,displayName,isDefault:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:efforts(list),inputModalities:['text','image'],...extra});
const free=(id:string,name:string,image=true)=>model(id,name,'low/high/max',{cost:{input:0,output:0},context:200000,inputModalities:image?['text','image']:['text']});
const now=1_000_000;
const usage=(remaining:number)=>({rateLimitsByLimitId:{main:{limitId:'main',primary:{usedPercent:100-remaining,windowDurationMins:300,resetsAt:now+3600}}}});

// Trimmed from the live catalogues seen on the test Mac.
const offers=(codexLeft=60,claudeLeft=90):ProviderOffer[]=>[
 {provider:'codex',plan:'plus',usage:usage(codexLeft),models:[model('gpt-6.1-sol','GPT-6.1-Sol'),model('gpt-6-astra','GPT-6-Astra'),model('gpt-6.1-terra','GPT-6.1 Terra'),model('gpt-6-luna','GPT-6-Luna'),model('gpt-6-sol','GPT-6-Sol','low/medium',{description:'Previous generation workhorse model.'})]},
 {provider:'opencode',plan:'',usage:null,models:[free('opencode/big-pickle','Big Pickle',false),free('opencode/deepseek-v4.1-flash-free','DeepSeek V4.1 Flash Free'),free('opencode/nemotron-3.5-super-vl-free','Nemotron 3.5 Super VL Free')]},
 {provider:'claude',plan:'Claude Pro',usage:usage(claudeLeft),models:[model('opus','Opus 5.5'),model('sonnet','Sonnet 5.5'),model('fable','Fable 5.2'),model('haiku','Haiku 5.5'),model('claude-opus-4-6','Opus 4.6')]},
];
const task=(difficulty:number,kind:TaskClass['kind'],tools=false,effort='medium'):TaskClass=>({difficulty,kind,tools,effort});
const route=(t:TaskClass,list=offers())=>pickRoute(autoEntries(list,false),list,t,'codex',now);

test('older generations are not offered to automatic selection',()=>{
 const [codex,,claude]=offers();
 assert.deepEqual(currentModels('codex',codex.models).map(m=>m.id),['gpt-6.1-sol','gpt-6-astra','gpt-6.1-terra','gpt-6-luna']);
 assert.deepEqual(currentModels('claude',claude.models).map(m=>m.id),['opus','sonnet','fable','haiku']);
 // Free first, then the most capable: the capable family ranks ahead of light variants.
 assert.equal(currentModels('opencode',offers()[1].models)[0].id,'opencode/nemotron-3.5-super-vl-free');
 assert.equal(autoEntries(offers(),true).some(entry=>entry.key==='opencode/big-pickle'),false);
});

test('profiles rate unknown free models from their own signals and paid tiers by family',()=>{
 // A plain unknown name with no capability signals stays unproven.
 assert.deepEqual(modelProfile('opencode',free('opencode/iceman-free','Iceman Free')).capability,2);
 assert.equal(modelProfile('opencode',free('x/nemotron-3.5-super-vl-free','Nemotron 3.5 Super VL Free')).capability,3);
 assert.equal(modelProfile('opencode',free('x','DeepSeek Flash')).cost,0);
 // A family OpenCode just added is inferred, not unproven: capable naming
 // or a large context window raises the capability.
 assert.equal(modelProfile('opencode',free('x/atlantis-r2-pro-free','Atlantis R2 Pro Free',false)).capability,3);
 assert.deepEqual(modelProfile('opencode',free('x/atlantis-r2-pro-free','Atlantis R2 Pro Free',false)).strong,['reasoning']);
 assert.equal(modelProfile('opencode',model('x/wide-context-free','Wide Context Free','low/medium',{cost:{input:0,output:0},context:500000})).capability,3);
 // Light variants stay light whatever the signals say.
 assert.equal(modelProfile('opencode',free('x/atlantis-flash-free','Atlantis Flash Free')).capability,2);
 assert.equal(modelProfile('claude',model('haiku','Haiku 5.5')).capability,2);
 assert.equal(modelProfile('codex',model('gpt-6-astra','GPT-6-Astra')).cost,5);
});

test('a newly added OpenCode family is offered to automatic selection ahead of light models',()=>{
 const models=[
  free('opencode/big-pickle','Big Pickle',false),
  free('opencode/atlas-nano-free','Atlas Nano Free'),
  free('opencode/brand-new-family-pro-free','Brand New Family Pro Free'),
  free('opencode/deepseek-v4.1-flash-free','DeepSeek V4.1 Flash Free'),
 ];
 // Free first, then capability: the unknown capable family outranks the
 // light variants instead of being crowded out by the shortlist limit.
 assert.equal(currentModels('opencode',models,2)[0].id,'opencode/brand-new-family-pro-free');
 assert.equal(currentModels('opencode',models,2).some(model=>model.id==='opencode/atlas-nano-free'),false);
});

test('simple questions use a free model; tool work avoids unproven models',()=>{
 assert.equal(route(task(1,'lookup',false,'low')).provider,'opencode');
 // Reading a note for a quick answer is fine on a free model; editing is not.
 assert.equal(route(task(1,'lookup',true,'low')).provider,'opencode');
 const edit=route(task(1,'edit',true,'low'));
 assert.notEqual(edit.provider,'opencode');
 assert.match(edit.model,/luna|haiku/);
});

test('harder work needs a capable model and avoids weak spots',()=>{
 assert.ok(['sonnet','gpt-6.1-sol'].includes(route(task(4,'synthesis',true)).model));
 assert.ok(['opus','fable','gpt-6-astra'].includes(route(task(5,'reasoning',false,'high')).model));
 // Terra is weak at synthesis even though it is capable enough for difficulty 3.
 assert.notEqual(route(task(3,'synthesis',true)).model,'gpt-6.1-terra');
});

test('remaining plan usage shifts the choice and nearly empty plans are avoided',()=>{
 assert.equal(route(task(2,'edit',true),offers(80,20)).provider,'codex');
 assert.equal(route(task(2,'edit',true),offers(20,80)).provider,'claude');
 assert.notEqual(route(task(2,'edit',true),offers(60,10)).provider,'claude');
 assert.equal(remainingUsage(usage(42),now)?.remaining,42);
 assert.equal(remainingUsage({rateLimitsByLimitId:{a:{primary:{usedPercent:100,resetsAt:now-1}}}},now),null);
});

test('the reason states the classification, the choice and the plan left',()=>{
 assert.match(route(task(2,'edit',true)).reason,/^difficulty 2 edit with tools → .+cost \d\/5, \d+% of the 5-hour window left$/);
});

test('classification output is validated and close kinds are mapped',()=>{
 assert.deepEqual(decodeTaskClass('{"difficulty":2,"kind":"summary","tools":true,"effort":"low"}'),{difficulty:2,kind:'lookup',tools:true,effort:'low'});
 assert.equal(decodeTaskClass('{"difficulty":3,"kind":"debugging","tools":false,"effort":"medium"}').kind,'reasoning');
 assert.equal(decodeTaskClass('{"difficulty":9,"kind":"multi-source synthesis","tools":false,"effort":"high"}').difficulty,5);
 assert.equal(decodeTaskClass('{"difficulty":2,"kind":"dance","tools":false,"effort":"low"}').kind,'lookup');
 assert.throws(()=>decodeTaskClass('{"kind":"edit","tools":false,"effort":"low"}'));
 assert.throws(()=>decodeTaskClass('{"difficulty":2,"kind":"edit","tools":false,"effort":"ultra"}'));
 assert.match(classifyInstructions(),/Classify this Obsidian request as data/);
});

test('efforts snap to what the chosen model supports',()=>{
 assert.equal(nearestEffort(model('a','A','low/high/max'),'medium'),'low');
 assert.equal(nearestEffort(model('a','A','low/high/max'),'xhigh'),'high');
 assert.equal(nearestEffort(model('a','A','default',{defaultReasoningEffort:'default'}),'high'),'default');
});

test('without Apple’s model the preferred provider and its chosen model are used',()=>{
 const list=offers();list[2].preferred={model:'sonnet',effort:'low'};
 assert.deepEqual(autoFallbackRoute(list,autoEntries(list,false),['claude','codex','opencode']),{provider:'claude',model:'sonnet',effort:'low',reason:'local selection unavailable'});
 assert.throws(()=>autoFallbackRoute([],[],['codex']));
});

test('the Automatic provider setting persists and defaults off',()=>{
 assert.equal(migrateSettings({}).automaticProvider,false);
 assert.equal(migrateSettings({schemaVersion:3,automaticProvider:true}).automaticProvider,true);
});

test('calibration keeps long writing from one source off frontier models and max effort',async()=>{
 const {calibrateTask}=await import('../src/auto-route');
 const ctx={attachments:[{kind:'pdf' as const,name:'Jamaica Reggae Präsentation.pdf'}],activeNote:true,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:true};
 const prompt='write a script to talk for 7+ minutes, for this presentation. add to current note.';
 // What Apple's model actually returned for this request before calibration.
 const task=calibrateTask({difficulty:5,kind:'writing',tools:false,effort:'max'},prompt,ctx);
 assert.deepEqual(task,{difficulty:4,kind:'writing',tools:true,effort:'high'});
 // With Claude 62% used, the talk script goes to Sonnet, not Opus.
 const list=offers(0,38).filter(offer=>offer.provider==='claude');
 assert.equal(pickRoute(autoEntries(list,false),list,task,'codex',now).model,'sonnet');
 // Effort follows the calibrated difficulty; only rigorous reasoning or research may use max.
 assert.equal(calibrateTask({difficulty:2,kind:'lookup',tools:false,effort:'max'},'describe this pdf').effort,'low');
 assert.equal(calibrateTask({difficulty:3,kind:'writing',tools:false,effort:'xhigh'},'x').effort,'medium');
 assert.equal(calibrateTask({difficulty:5,kind:'reasoning',tools:false,effort:'max'},'prove it').effort,'max');
 assert.equal(calibrateTask({difficulty:5,kind:'lookup',tools:false,effort:'high'},'x').difficulty,2);
 // Edit wording or a document attachment means tools are needed.
 assert.equal(calibrateTask({difficulty:1,kind:'edit',tools:false,effort:'low'},'Fix the typo in this note.').tools,true);
 assert.equal(calibrateTask({difficulty:1,kind:'lookup',tools:false,effort:'low'},'What is 2+2?').tools,false);
});

test('a drained plan makes its expensive tiers much dearer',()=>{
 const half=route(task(3,'writing',false),offers(0,50).filter(offer=>offer.provider==='claude'));
 assert.equal(half.model,'sonnet');
 assert.equal(decodeTaskClass('{"difficulty":2,"kind":"reading","tools":true,"effort":"low"}').kind,'lookup');
 // An unknown kind falls back by difficulty rather than failing the selection.
 assert.equal(decodeTaskClass('{"difficulty":4,"kind":"zzz","tools":true,"effort":"low"}').kind,'synthesis');
});
