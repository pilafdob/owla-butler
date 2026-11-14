import {test} from 'node:test';import assert from 'node:assert/strict';
import {autoEntries,autoFallbackRoute,classifyInstructions,decodeTaskClass,nearestEffort,offeredEntries,pickRoute,remainingUsage,scoreEntries,type ProviderOffer,type TaskClass} from '../src/auto-route';
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

test('the manual override lists every model automatic selection curates away',()=>{
 const list=offers();
 // Automatic selection offers current generations and Claude aliases only.
 assert.equal(autoEntries(list,false).some(entry=>entry.key==='gpt-6-sol'),false);
 assert.equal(autoEntries(list,false).some(entry=>entry.key==='claude-opus-4-6'),false);
 // The hand-picked override shows the previous generation and the pinned version.
 assert.equal(offeredEntries(list,false).some(entry=>entry.key==='gpt-6-sol'),true);
 assert.equal(offeredEntries(list,false).some(entry=>entry.key==='claude-opus-4-6'),true);
 // No shortlist limit either: every OpenCode model is listed.
 const wide:ProviderOffer={provider:'opencode',plan:'',usage:null,
  models:Array.from({length:8},(_,index)=>free('opencode/model-'+index,'Model '+index))};
 assert.equal(autoEntries([wide],false).length,6);
 assert.equal(offeredEntries([wide],false).length,8);
 // Genuine compatibility still applies: text-only models drop off when images need reading.
 assert.equal(offeredEntries(list,true).some(entry=>entry.key==='opencode/big-pickle'),false);
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
 assert.deepEqual(task,{difficulty:4,kind:'writing',tools:true,effort:'high',writes:true});
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

test('continuity favours the previous model only on the provider that served it',()=>{
 // The same model id on two providers: only the previous provider's entry gets the model bonus.
 const list:ProviderOffer[]=[
  {provider:'codex',plan:'plus',usage:null,models:[model('shared-id','Shared')]},
  {provider:'opencode',plan:'',usage:null,models:[model('shared-id','Shared')]},
 ];
 const entries=offeredEntries(list,false),t=task(1,'lookup');
 const scores=(ctx?:Parameters<typeof scoreEntries>[5])=>new Map(scoreEntries(entries,list,t,'claude',now,ctx).map(item=>[item.entry.provider,item.score]));
 const base=scores();
 const ctx={attachments:[],activeNote:false,selections:0,recentMessages:2,previousImages:0,previousPdfs:0,webSearch:false,previousProvider:'opencode',previousModel:'shared-id'};
 const next=scores(ctx);
 assert.equal(Number((base.get('opencode')!-next.get('opencode')!).toFixed(2)),0.35);
 assert.equal(base.get('codex'),next.get('codex'));
 // B10: continuity bonus is not applied when task kind changes or sameTaskAsPrevious is false.
 const changedKindCtx={...ctx,previousKind:'coding'};
 assert.equal(scores(changedKindCtx).get('opencode'),base.get('opencode'));
 const explicitFalseCtx={...ctx,sameTaskAsPrevious:false};
 assert.equal(scores(explicitFalseCtx).get('opencode'),base.get('opencode'));
});

test('instructions include few-shot Examples and outline preference, and thorough mode adds rationale',async()=>{
 const {autoSchemaFields}=await import('../src/auto-route');
 const instructions=classifyInstructions();
 assert.match(instructions,/Examples:/);
 assert.match(instructions,/Prefer activeNoteOutline over activeNotePreview/);
 assert.deepEqual(Object.keys(autoSchemaFields(false)),['difficulty','kind','tools','effort']);
 assert.deepEqual(Object.keys(autoSchemaFields(true)),['rationale','difficulty','kind','tools','effort']);
 assert.deepEqual(
  decodeTaskClass('{"rationale":"Simple factual lookup.","difficulty":1,"kind":"lookup","tools":false,"effort":"low"}',true),
  {difficulty:1,kind:'lookup',tools:false,effort:'low'}
 );
 assert.throws(()=>decodeTaskClass('{"difficulty":1,"kind":"lookup","tools":false,"effort":"low"}',true),/incomplete thorough/);
});

test('nearestEffort prefers defaultReasoningEffort when within one step of an unsupported effort',()=>{
 const m=model('x','X','low/high',{defaultReasoningEffort:'high'});
 // 'medium' is 1 step from 'low' and 1 step from 'high'; defaultReasoningEffort ('high') wins.
 assert.equal(nearestEffort(m,'medium'),'high');
});

test('optimization modes (cost, balance, intelligence) shift candidate scoring and selection',()=>{
 const list=offers(70,70);
 const entries=autoEntries(list,false);
 // A difficulty-3 coding task where free OpenCode (capability 3) competes with Sonnet/Sol (capability 4).
 const t=task(3,'coding',false,'medium');
 const costChoice=pickRoute(entries,list,t,'codex',now,undefined,'cost');
 const intelChoice=pickRoute(entries,list,t,'codex',now,undefined,'intelligence');
 assert.equal(costChoice.provider,'opencode');
 // Intelligence mode raises the capability floor to 4, selecting a higher-capability paid model.
 assert.notEqual(intelChoice.provider,'opencode');
 assert.ok(['sonnet','gpt-6.1-sol','opus','gpt-6-astra'].includes(intelChoice.model));
});

test('heuristicTaskClass classifies README example prompts without calling FM',async()=>{
 const {heuristicTaskClass}=await import('../src/auto-route');
 const compare=heuristicTaskClass('Compare my biology notes with Exam Plan; cite the exact paths and separate evidence from your suggested schedule.');
 assert.equal(compare?.kind,'synthesis');
 assert.equal(compare?.tools,true);

 const missing=heuristicTaskClass('What information is missing from this note? Don’t invent it.',{
  attachments:[],activeNote:true,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false
 });
 assert.equal(missing?.kind,'lookup');
 assert.equal(missing?.tools,true);

 const improve=heuristicTaskClass('Improve this paragraph without changing its citation keys, links or meaning.');
 assert.equal(improve?.kind,'edit');
 assert.equal(improve?.tools,true);

 const transcribe=heuristicTaskClass('Transcribe this faithfully and prepare an insertion below Worked example.',{
  attachments:[{kind:'image',name:'eq.png'}],activeNote:true,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false
 });
 assert.equal(transcribe?.kind,'transcription');
 assert.equal(transcribe?.tools,true);

 const summarizePdf=heuristicTaskClass('Summarise this page with its filename and page reference.',{
  attachments:[{kind:'pdf',name:'Study.pdf',page:3}],activeNote:false,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false
 });
 assert.equal(summarizePdf?.kind,'lookup');
 assert.equal(summarizePdf?.tools,true);

 const docs=heuristicTaskClass('Check the official documentation for current Obsidian callout syntax and link the source.');
 assert.equal(docs?.kind,'research');
});

test('heuristic fallback varies selection by task when Foundation Models CLI is unavailable',async()=>{
 const {routeAcrossProviders,clearRoutingCache}=await import('../src/auto-route');
 const {setFoundationModelsCLIOverrideForTests}=await import('../src/routing');
 setFoundationModelsCLIOverrideForTests(false);
 clearRoutingCache();
 try{
  const list=offers(80,80);
  const entries=autoEntries(list,false);
  const controller=new AbortController();
  const simple=await routeAcrossProviders('What is 2+2?',list,entries,'codex',controller.signal);
  const editNote=await routeAcrossProviders('Fix the typo in this note.',list,entries,'codex',controller.signal);
  const proof=await routeAcrossProviders('Provide a rigorous proof by mathematical induction that this invariant holds.',list,entries,'codex',controller.signal);
  assert.equal(simple.provider,'opencode');
  assert.notEqual(editNote.provider,'opencode');
  assert.notEqual(simple.model,editNote.model);
  assert.ok(['opus','fable','gpt-6-astra','sonnet','gpt-6.1-sol'].includes(proof.model));
 }finally{
  setFoundationModelsCLIOverrideForTests(null);
  clearRoutingCache();
 }
});

test('routing decision cache returns cached route without calling FM a second time and invalidates on >5% usage shift',async()=>{
 const {routeAcrossProviders,clearRoutingCache}=await import('../src/auto-route');
 const {setFoundationModelsCLIOverrideForTests,setAskFoundationModelsForTests}=await import('../src/routing');
 setFoundationModelsCLIOverrideForTests(true);
 clearRoutingCache();
 let fmCalls=0;
 setAskFoundationModelsForTests(async()=>{
  fmCalls++;
  return '{"rationale":"Needs careful multi-step analysis.","difficulty":4,"kind":"synthesis","tools":true,"effort":"high"}';
 });
 try{
  const list=offers(80,80);
  const entries=autoEntries(list,false);
  const signal=new AbortController().signal;
  const ctx={attachments:[],activeNote:true,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:true,thorough:true};
  const first=await routeAcrossProviders('Nuanced ambiguous synthesis request.',list,entries,'codex',signal,ctx,{nowMs:100_000});
  const second=await routeAcrossProviders('Nuanced ambiguous synthesis request.',list,entries,'codex',signal,ctx,{nowMs:120_000});
  assert.equal(fmCalls,1);
  assert.equal(second.model,first.model);

  // A usage change of >5% invalidates the cache and triggers a fresh FM call.
  const shifted=offers(80,60);
  await routeAcrossProviders('Nuanced ambiguous synthesis request.',shifted,entries,'codex',signal,ctx,{nowMs:130_000});
  assert.equal(fmCalls,2);
 }finally{
  setAskFoundationModelsForTests(null);
  setFoundationModelsCLIOverrideForTests(null);
  clearRoutingCache();
 }
});

test('quality escalation triggers on thin or uncertain replies only when no tools were used and mode is not cost',async()=>{
 const {shouldEscalateQuality,pickEscalationRoute}=await import('../src/auto-route');
 assert.equal(shouldEscalateQuality({text:'Short reply.',toolsUsed:false,mode:'balance'}),true);
 assert.equal(shouldEscalateQuality({text:'I am not sure about the exact formula in your vault, even though this sentence is over one hundred and twenty characters long in total.',toolsUsed:false,mode:'balance'}),true);
 assert.equal(shouldEscalateQuality({text:'Short reply after editing.',toolsUsed:true,mode:'balance'}),false);
 assert.equal(shouldEscalateQuality({text:'Short reply.',toolsUsed:false,mode:'cost'}),false);
 assert.equal(shouldEscalateQuality({text:'Short reply.',toolsUsed:false,mode:'balance',escalations:1}),false);
 assert.equal(shouldEscalateQuality({text:'A comprehensive, detailed explanation that answers the question thoroughly without uncertainty markers and exceeds the minimum length threshold easily.',toolsUsed:false,mode:'balance'}),false);

 const list=offers(80,80);
 const entries=autoEntries(list,false);
 const escalated=pickEscalationRoute({
  entries,
  offers:list,
  task:task(2,'edit',true,'low'),
  exclude:[{provider:'claude',model:'haiku'},{provider:'codex',model:'gpt-6-luna'}],
  home:'codex',
  now,
 });
 assert.ok(escalated);
 assert.ok(!['haiku','gpt-6-luna'].includes(escalated.model));
});

test('personalization history round-trips on disk and applies bounded bonus/penalty and latency penalty',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {
  loadRoutingHistory,
  saveRoutingHistory,
  clearRoutingHistory,
  recordRoutingOutcome,
  personalizationScore,
  latencyPenalty,
 }=await import('../src/routing-history');

 const dir=mkdtempSync(join(tmpdir(),'owla-hist-test-'));
 try{
  let hist=loadRoutingHistory(dir);
  assert.deepEqual(hist,{});
  // Fewer than 3 samples: no personalization adjustment.
  hist=recordRoutingOutcome(hist,{provider:'claude',model:'sonnet',kind:'writing',success:true,latencyMs:1200});
  hist=recordRoutingOutcome(hist,{provider:'claude',model:'sonnet',kind:'writing',success:true,latencyMs:1400});
  assert.equal(personalizationScore(hist,'claude','sonnet','writing'),0);

  // 3rd sample activates the bonus (-0.4 for 100% win rate).
  hist=recordRoutingOutcome(hist,{provider:'claude',model:'sonnet',kind:'writing',success:true,latencyMs:1300});
  assert.equal(personalizationScore(hist,'claude','sonnet','writing'),-0.4);

  // A slow model with failures gets a positive penalty (+0.4) and latency penalty.
  for(let i=0;i<3;i++){
   hist=recordRoutingOutcome(hist,{provider:'codex',model:'gpt-6.1-sol',kind:'writing',success:false,latencyMs:6000});
  }
  assert.equal(personalizationScore(hist,'codex','gpt-6.1-sol','writing'),0.4);
  assert.equal(latencyPenalty(hist,'codex','gpt-6.1-sol'),0.3);
  assert.equal(latencyPenalty(hist,'claude','sonnet'),0);

  saveRoutingHistory(dir,hist);
  const reloaded=loadRoutingHistory(dir);
  assert.equal(personalizationScore(reloaded,'claude','sonnet','writing'),-0.4);
  assert.equal(latencyPenalty(reloaded,'codex','gpt-6.1-sol'),0.3);

  // Verify scoreEntries reflects history and latency.
  const list=offers(80,80);
  const entries=autoEntries(list,false);
  const t=task(3,'writing',false,'medium');
  const withoutHist=new Map(scoreEntries(entries,list,t,'codex',now).map(i=>[i.entry.key,i.score]));
  const withHist=new Map(scoreEntries(entries,list,t,'codex',now,undefined,'balance',reloaded).map(i=>[i.entry.key,i.score]));
  assert.ok(withHist.get('sonnet')!<withoutHist.get('sonnet')!);
  assert.ok(withHist.get('gpt-6.1-sol')!>withoutHist.get('gpt-6.1-sol')!);

  clearRoutingHistory(dir);
  assert.deepEqual(loadRoutingHistory(dir),{});
 }finally{
  rmSync(dir,{recursive:true,force:true});
 }
});

test('calibration loads defaults when file is missing and applies overrides when present',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {KIND_CEILING,reloadRoutingCalibration,resetRoutingCalibration,calibrateTask}=await import('../src/auto-route');

 const missing=reloadRoutingCalibration('/nonexistent/path/routing-calibration.json');
 assert.equal(missing.kindCeiling.lookup,2);
 assert.equal(KIND_CEILING.lookup,2);

 const dir=mkdtempSync(join(tmpdir(),'owla-cal-test-'));
 try{
  const customFile=join(dir,'custom-calibration.json');
  writeFileSync(customFile,JSON.stringify({
   kindCeiling:{lookup:3},
   editVerbs:['tweak'],
   editTargets:['canvas'],
  }));
  reloadRoutingCalibration(customFile);
  assert.equal(KIND_CEILING.lookup,3);
  assert.equal(calibrateTask({difficulty:4,kind:'lookup',tools:false,effort:'medium'},'tweak this canvas').difficulty,3);
  assert.equal(calibrateTask({difficulty:4,kind:'lookup',tools:false,effort:'medium'},'tweak this canvas').tools,true);
 }finally{
  resetRoutingCalibration();
  rmSync(dir,{recursive:true,force:true});
 }
 assert.equal(KIND_CEILING.lookup,2);
});

test('explainability stores bounded decisions in memory and renders collapsible routing details when enabled',async()=>{
 const {clearRoutingDecisions,getRoutingDecisions,renderRoutingDetails}=await import('../src/auto-route');
 clearRoutingDecisions();
 const list=offers(80,80);
 const entries=autoEntries(list,false);
 for(let i=0;i<55;i++){
  pickRoute(entries,list,task(2,'edit',true,'low'),'codex',now);
 }
 const decisions=getRoutingDecisions();
 assert.equal(decisions.length,50);

 const created:{tag:string;text?:string;cls?:string}[]=[];
 const makeContainer=()=>{
  const node={
   createEl:(tag:string,opts?:{text?:string;cls?:string})=>{
    created.push({tag,...opts});
    return makeContainer();
   },
   createDiv:(opts?:string|{text?:string;cls?:string})=>{
    created.push({tag:'div',...(typeof opts==='string'?{cls:opts}:opts)});
    return makeContainer();
   },
  };
  return node;
 };
 assert.equal(renderRoutingDetails(makeContainer() as never,decisions.at(-1)!,false),null);
 assert.equal(created.length,0);
 assert.ok(renderRoutingDetails(makeContainer() as never,decisions.at(-1)!,true));
 assert.ok(created.some(item=>item.tag==='details'&&item.cls==='owla-routing-details'));
 assert.ok(created.some(item=>item.tag==='summary'&&item.text==='Routing details'));
});

test('SessionModelAvailability gates refused models across Codex, Claude and OpenCode for the session',async()=>{
 const {SessionModelAvailability}=await import('../src/opencode-availability');
 const gate=new SessionModelAvailability();
 assert.equal(gate.available('claude','opus'),true);
 const res=gate.recordFailure('claude','opus','Model opus is not included in your subscription plan.');
 assert.equal(res.refused,true);
 assert.equal(gate.available('claude','opus'),false);
 assert.equal(gate.available('claude','sonnet'),true);

 gate.recordFailure('codex','gpt-6-astra','Model hosted outside your workspace privacy regions.');
 assert.equal(gate.available('codex','gpt-6-astra'),false);
 assert.equal(gate.isRegionRestricted('codex','gpt-6-astra'),true);
 gate.clear();
 assert.equal(gate.available('claude','opus'),true);
});

test('calibration corrects what Apple’s model returned in live runs',async()=>{
 const {calibrateTask,decodeTaskClass}=await import('../src/auto-route');
 const ctx=(attachments:{kind:'image'|'pdf'|'note';name:string}[]=[])=>({attachments,activeNote:false,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:true});
 const live=(json:string,prompt:string,c=ctx())=>calibrateTask(decodeTaskClass(json),prompt,c);
 // fm said tools:true for 29 of 30 prompts; a proof, a chart reading or a web check needs no vault tools.
 assert.equal(live('{"difficulty":5,"kind":"research","tools":true,"effort":"max"}','Provide a rigorous proof by mathematical induction that the red-black tree height invariant holds after deletion.').tools,false);
 assert.equal(live('{"difficulty":2,"kind":"vision","tools":true,"effort":"medium"}','Explain what this chart shows about seasonal temperature anomalies.',ctx([{kind:'image',name:'chart.png'}])).tools,false);
 assert.equal(live('{"difficulty":1,"kind":"coding","tools":true,"effort":"low"}','Write a Dataview query to list all notes tagged #project sorted by due date.').kind,'coding');
 // Requests that point into the vault keep the tools.
 assert.equal(live('{"difficulty":2,"kind":"lookup","tools":true,"effort":"low"}','What information is missing from this note?').tools,true);
 assert.equal(live('{"difficulty":3,"kind":"synthesis","tools":true,"effort":"medium"}','Compare my biology notes with the exam plan.').tools,true);
 // Kinds fm confuses.
 const proof=live('{"difficulty":5,"kind":"research","tools":true,"effort":"max"}','Find a counterexample or prove that every connected graph with even degree has an Eulerian circuit.');
 assert.equal(proof.kind,'reasoning');
 assert.equal(proof.difficulty,5);
 const web=live('{"difficulty":1,"kind":"lookup","tools":true,"effort":"low"}','Search the web to verify the latest Obsidian desktop release version.');
 assert.equal(web.kind,'research');
 assert.equal(web.difficulty,2);
 const scan=live('{"difficulty":3,"kind":"writing","tools":true,"effort":"medium"}','Transcribe these handwritten lecture equations into LaTeX.',ctx([{kind:'image',name:'scan1.png'}]));
 assert.equal(scan.kind,'transcription');
 assert.equal(scan.difficulty,2);
 assert.equal(scan.effort,'low');
});

test('heuristic sends image questions to vision and talk scripts to writing',async()=>{
 const {heuristicTaskClass}=await import('../src/auto-route');
 const withImage={attachments:[{kind:'image' as const,name:'chart.png'}],activeNote:false,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false};
 assert.equal(heuristicTaskClass('Explain what this chart shows about seasonal temperature anomalies.',withImage)?.kind,'vision');
 assert.equal(heuristicTaskClass('Describe what this architecture diagram image shows.',withImage)?.kind,'vision');
 // Without an image, "explain" stays a lookup.
 assert.equal(heuristicTaskClass('Explain what entropy is.')?.kind,'lookup');
 const pdf={attachments:[{kind:'pdf' as const,name:'Jamaica.pdf'}],activeNote:true,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false};
 const script=heuristicTaskClass('write a script to talk for 7+ minutes, for this presentation. add to current note.',pdf);
 assert.equal(script?.kind,'writing');
 assert.equal(script?.tools,true);
 // A real script is still coding.
 assert.equal(heuristicTaskClass('Write a script that renames every file in a folder.')?.kind,'coding');
});

test('a short answer to a simple question is not escalated',async()=>{
 const {shouldEscalateQuality}=await import('../src/auto-route');
 assert.equal(shouldEscalateQuality({text:'4',toolsUsed:false,difficulty:1}),false);
 assert.equal(shouldEscalateQuality({text:'Paris.',toolsUsed:false,difficulty:2}),false);
 assert.equal(shouldEscalateQuality({text:'Here is a plan.',toolsUsed:false,difficulty:3}),true);
 assert.equal(shouldEscalateQuality({text:'',toolsUsed:false,difficulty:1}),true);
 assert.equal(shouldEscalateQuality({text:'I cannot determine that.',toolsUsed:false,difficulty:1}),true);
 // A hedge inside a long answer does not rerun the whole turn.
 assert.equal(shouldEscalateQuality({text:'I am not sure which edition you use, so '+'here is the full derivation step by step. '.repeat(12),toolsUsed:false,difficulty:3}),false);
});

test('a free model rounds an unsupported effort up, a paid model down',()=>{
 const paid=model('a','A','low/high/max');
 // As OpenCode lists Nemotron Free: a default of medium it does not support.
 const free=model('f','F','low/high/max',{cost:{input:0,output:0}});
 assert.equal(nearestEffort(paid,'medium'),'low');
 assert.equal(nearestEffort(free,'medium'),'high');
 // routingModels rewrites the unsupported default to the first option, low; the tie still rounds up.
 assert.equal(nearestEffort({...free,defaultReasoningEffort:'low'},'medium'),'high');
 assert.equal(nearestEffort({...free,defaultReasoningEffort:'low'},'low'),'low');
});

test('multi-source wording without a listed verb is not mistaken for a quick lookup',async()=>{
 const {heuristicTaskClass}=await import('../src/auto-route');
 // Short prompts used to fall through to a difficulty-1 lookup, with and without Apple's model.
 assert.equal(heuristicTaskClass('Weave these readings into one argument about heat islands.'),null);
 assert.equal(heuristicTaskClass('Weave these readings into one argument about heat islands.',undefined,true)?.kind,'synthesis');
 assert.equal(heuristicTaskClass('Go through this week and connect ideas to last semester.',undefined,true)?.kind,'synthesis');
 assert.equal(heuristicTaskClass('What is 2+2?')?.kind,'lookup');
});

test('note-changing work avoids models with unproven OWLA tools unless the paid plan is scarce or the mode is Cost',async()=>{
 const {calibrateTask}=await import('../src/auto-route');
 const ctx={attachments:[{kind:'pdf' as const,name:'Jamaica.pdf'}],activeNote:true,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:true};
 // What live fm returns for the talk-script request: difficulty 3 writing.
 const write=calibrateTask({difficulty:3,kind:'writing',tools:true,effort:'medium'},'write a script to talk for 7+ minutes, for this presentation. add to current note.',ctx);
 assert.equal(write.writes,true);
 const read=calibrateTask({difficulty:3,kind:'writing',tools:true,effort:'medium'},'write a script to talk for 7+ minutes from this presentation.',ctx);
 assert.equal(read.writes,false);
 // Reading the note is not writing it.
 assert.equal(calibrateTask({difficulty:2,kind:'lookup',tools:true,effort:'low'},'What information is missing from this note?').writes,false);
 assert.equal(calibrateTask({difficulty:3,kind:'synthesis',tools:true,effort:'medium'},'Compare these lecture PDFs and combine their key theorems into a revision note.').writes,true);
 const list=offers(70,80);
 const entries=autoEntries(list,false);
 assert.notEqual(pickRoute(entries,list,write,'codex',now,undefined,'balance').provider,'opencode');
 assert.equal(pickRoute(entries,list,write,'codex',now,undefined,'cost').provider,'opencode');
 // An answer in chat may still use the free model.
 assert.equal(pickRoute(entries,list,read,'codex',now,undefined,'balance').provider,'opencode');
 // Nearly drained paid plans hand note edits back to the free model.
 const scarce=offers(20,20);
 assert.equal(pickRoute(autoEntries(scarce,false),scarce,write,'codex',now,undefined,'balance').provider,'opencode');
});

test('privacy mode still gives Apple’s model the request, and distinct requests are not served one cached route',async()=>{
 const {routeAcrossProviders,clearRoutingCache}=await import('../src/auto-route');
 const {setAskFoundationModelsForTests,setFoundationModelsCLIOverrideForTests,buildRoutingContext}=await import('../src/routing');
 const seen:string[]=[];
 setFoundationModelsCLIOverrideForTests(true);
 setAskFoundationModelsForTests(async(instructions,prompt)=>{
  seen.push(prompt);
  assert.doesNotMatch(instructions,/Secret Folder|Patient/);
  return '{"difficulty":3,"kind":"synthesis","tools":true,"effort":"medium"}';
 });
 clearRoutingCache();
 try{
  const list=offers(80,80);
  const entries=autoEntries(list,false);
  const ctx=(prompt:string)=>buildRoutingContext({prompt,attachments:[{kind:'folder',name:'Secret Folder'}],activeNoteText:'# Patient\nbody',selections:[],recentMessages:[],previousImages:0,previousPdfs:0,webSearch:false,privacyMode:true});
  const first='Go through these and tell me how they hang together for the exam.';
  const second='Go through these and tell me which ones I can archive now.';
  await routeAcrossProviders(first,list,entries,'codex',new AbortController().signal,ctx(first));
  await routeAcrossProviders(second,list,entries,'codex',new AbortController().signal,ctx(second));
  assert.deepEqual(seen,[first,second]);
 }finally{
  setAskFoundationModelsForTests(null);
  setFoundationModelsCLIOverrideForTests(null);
  clearRoutingCache();
 }
});

test('single-provider selection settles clear requests locally and leaves the rest to Apple’s model',async()=>{
 const {quickPerProviderRoute}=await import('../src/auto-route');
 const claude=offers(80,80).find(offer=>offer.provider==='claude')!.models;
 const quick=quickPerProviderRoute('Fix the typo in this note.',claude,'claude');
 assert.ok(quick);
 assert.equal(quick.task.kind,'edit');
 assert.equal(quickPerProviderRoute('Go through these and tell me how they hang together for the exam, then plan my week around it.',claude,'claude',{attachments:[{kind:'folder',name:'W7'}],activeNote:false,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false}),null);
 // Thorough selection always asks Apple's model.
 assert.equal(quickPerProviderRoute('Fix the typo in this note.',claude,'claude',{attachments:[],activeNote:true,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false,thorough:true}),null);
});

test('the on-device warm-up runs at most once per warm window',async()=>{
 const {prewarmFoundationModels,foundationModelsLastUse,resetFoundationModelsWarmthForTests,setAskFoundationModelsForTests,setFoundationModelsCLIOverrideForTests,FOUNDATION_MODELS_WARM_MS}=await import('../src/routing');
 setFoundationModelsCLIOverrideForTests(true);
 setAskFoundationModelsForTests(async()=>'{}');
 resetFoundationModelsWarmthForTests();
 try{
  await prewarmFoundationModels(1_000_000);
  assert.equal(foundationModelsLastUse(),1_000_000);
  await prewarmFoundationModels(1_000_000+FOUNDATION_MODELS_WARM_MS-1);
  assert.equal(foundationModelsLastUse(),1_000_000);
  await prewarmFoundationModels(1_000_000+FOUNDATION_MODELS_WARM_MS);
  assert.equal(foundationModelsLastUse(),1_000_000+FOUNDATION_MODELS_WARM_MS);
  setFoundationModelsCLIOverrideForTests(false);
  await prewarmFoundationModels(9_000_000);
  assert.equal(foundationModelsLastUse(),1_000_000+FOUNDATION_MODELS_WARM_MS);
 }finally{
  setAskFoundationModelsForTests(null);
  setFoundationModelsCLIOverrideForTests(null);
  resetFoundationModelsWarmthForTests();
 }
});
