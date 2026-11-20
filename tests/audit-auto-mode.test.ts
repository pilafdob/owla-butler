// 3.7.0 RC auto-mode audit: token budgeting, context estimates, cache bounds,
// overflow handling and usage-aware per-provider selection. Every case is a
// deterministic fixture; no live model turns.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 autoEntries,
 autoFallbackRoute,
 classifyInstructions,
 clearRoutingCache,
 heuristicPerProviderRoute,
 heuristicTaskClass,
 pickRoute,
 quickPerProviderRoute,
 routeAcrossProviders,
 routingCacheSizeForTests,
 type ProviderOffer,
} from '../src/auto-route';
import {currentModels} from '../src/model-profiles';
import {
 buildRoutingContext,
 DEFAULT_ROUTING_TOKEN_BUDGET,
 estimateContextTokens,
 estimateTokens,
 ROUTING_CONTEXT_OVERHEAD_TOKENS,
 routeWithFoundationModels,
 setAskFoundationModelsForTests,
 setFoundationModelsCLIOverrideForTests,
 summarizeRoutingContext,
 type RoutingContext,
} from '../src/routing';
import {recordRoutingOutcome,type RoutingHistoryData} from '../src/routing-history';
import type {ProviderModel} from '../src/provider';

const efforts=(list:string)=>list.split('/').map(reasoningEffort=>({reasoningEffort,description:''}));
const model=(id:string,displayName:string,list='low/medium/high',extra:Partial<ProviderModel>={}):ProviderModel=>({id,model:id,displayName,isDefault:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:efforts(list),inputModalities:['text','image'],...extra});
const now=1_000_000;
const usage=(remaining:number)=>({rateLimitsByLimitId:{main:{limitId:'main',primary:{usedPercent:100-remaining,windowDurationMins:300,resetsAt:now+3600}}}});
const offers:ProviderOffer[]=[
 {provider:'codex',plan:'plus',usage:usage(70),models:[model('gpt-6-luna','GPT-6-Luna','low/medium')]},
 {provider:'claude',plan:'Pro',usage:usage(80),models:[model('haiku','Haiku 5.5','low/medium')]},
];
const baseCtx:RoutingContext={attachments:[],activeNote:false,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false};

test('the context estimate carries the fixed turn overhead, replayed images and size-weighted PDFs',()=>{
 // Instructions (~1.7k tokens) plus tool schemas (~3.2k) ride on every turn;
 // the estimate must reserve room for them or small windows overflow.
 assert.equal(estimateContextTokens({}),ROUTING_CONTEXT_OVERHEAD_TOKENS);
 assert.equal(estimateContextTokens({promptChars:350}),ROUTING_CONTEXT_OVERHEAD_TOKENS+100);
 assert.equal(estimateContextTokens({attachedImages:1,previousImages:2}),ROUTING_CONTEXT_OVERHEAD_TOKENS+3_000);
 assert.equal(estimateContextTokens({attachedPdfs:2,attachedPdfChars:48_000}),ROUTING_CONTEXT_OVERHEAD_TOKENS+Math.ceil(48_000/3.5));
 const base={prompt:'hi',selections:[],recentMessages:[],previousImages:0,previousPdfs:0,webSearch:false};
 const mixed=buildRoutingContext({...base,attachments:[{kind:'pdf',name:'big.pdf',sizeBucket:'large'},{kind:'pdf',name:'small.pdf',sizeBucket:'small'}]});
 assert.equal(mixed.estimatedTokens,ROUTING_CONTEXT_OVERHEAD_TOKENS+Math.ceil((2+24_000+4_000)/3.5));
 const smallOnly=buildRoutingContext({...base,attachments:[{kind:'pdf',name:'a.pdf',sizeBucket:'small'},{kind:'pdf',name:'b.pdf',sizeBucket:'small'}]});
 assert.equal(smallOnly.estimatedTokens,ROUTING_CONTEXT_OVERHEAD_TOKENS+Math.ceil((2+8_000)/3.5));
 assert.ok(mixed.estimatedTokens!>smallOnly.estimatedTokens!,'a large PDF weighs more than a small one');
 const replayed=buildRoutingContext({...base,attachments:[{kind:'image',name:'a.png'}],previousImages:2});
 assert.equal(replayed.estimatedTokens,ROUTING_CONTEXT_OVERHEAD_TOKENS+Math.ceil(2/3.5)+3_000);
});

test('a tiny inventory budget is enforced even without previews to trim',()=>{
 const ctx:RoutingContext={
  ...baseCtx,
  attachments:Array.from({length:12},(_,i)=>({kind:'pdf' as const,name:'Very Long Attachment Name Number '+i+' That Keeps Going.pdf',pages:40,sizeBucket:'large' as const})),
  activeNote:true,activeNoteChars:60_000,selectedChars:4_000,promptChars:11_000,
  recentMessageChars:50_000,recentMessageCount:6,attachedPdfs:12,attachedImages:1,
  previousProvider:'claude',previousModel:'sonnet',previousEffort:'medium',previousKind:'synthesis',
  thorough:true,estimatedTokens:40_000,
  complexityFeatures:{promptWords:1800,codeFences:0,questionMarks:2,imperativeVerbs:4,selectionRatio:0.06,attachmentCount:12,recentMessageCount:6},
 };
 const summary=summarizeRoutingContext(ctx,{budget:500,thorough:true});
 assert.ok(estimateTokens(JSON.stringify(summary))<=500,'the base inventory must fit the budget');
 assert.equal(summary.totals.pdf,12,'totals survive the trim');
 assert.equal(summary.items.length+summary.omittedItems,12);
 // Privacy mode gets the same guarantee.
 const priv=summarizeRoutingContext({...ctx,privacyMode:true},{budget:500,thorough:true,privacy:true});
 assert.ok(estimateTokens(JSON.stringify(priv))<=500);
 assert.doesNotMatch(JSON.stringify(priv),/Very Long Attachment/);
 // The default budget still holds with huge previews present.
 const huge=summarizeRoutingContext({...ctx,activeNotePreview:'x'.repeat(30_000),recentMessagePreview:'y'.repeat(30_000)});
 assert.ok(estimateTokens(JSON.stringify(huge))<=DEFAULT_ROUTING_TOKEN_BUDGET);
});

test('FM instructions budget their own overhead so request plus inventory fit the routing window',()=>{
 const prompt='p'.repeat(5_250); // 1500 tokens
 const ctx:RoutingContext={...baseCtx,promptChars:prompt.length,activeNote:true,activeNoteChars:30_000,
  activeNoteOutline:'# One | # Two',activeNotePreview:'x'.repeat(30_000),recentMessagePreview:'y'.repeat(30_000),
  recentTopics:['Alpha','Beta'],attachments:[{kind:'pdf',name:'doc.pdf',sizeBucket:'medium'}],attachedPdfs:1};
 const promptTokens=Math.ceil(prompt.length/3.5);
 const instructions=classifyInstructions(ctx);
 // Before the fix the inventory alone could spend 1500 tokens on top of the
 // instructions and the request, overshooting the 4k hardware window.
 assert.ok(estimateTokens(instructions)+promptTokens<=3_100,
  `classification call too large: ${estimateTokens(instructions)+promptTokens} tokens`);
});

test('single-provider FM selection budgets the catalog and instructions too',async()=>{
 const prompt='p'.repeat(5_250);
 const ctx:RoutingContext={...baseCtx,promptChars:prompt.length,activeNote:true,activeNoteChars:30_000,
  activeNotePreview:'x'.repeat(30_000),recentMessagePreview:'y'.repeat(30_000),attachments:[{kind:'pdf',name:'doc.pdf',sizeBucket:'medium'}],attachedPdfs:1};
 let seen='';
 setFoundationModelsCLIOverrideForTests(true);
 setAskFoundationModelsForTests(async instructions=>{seen=instructions;return '{"model":1,"effort":"low"}';});
 try{
  await routeWithFoundationModels(prompt,[model('gpt-6-luna','GPT-6-Luna','low/medium')],new AbortController().signal,ctx,'codex');
  const total=estimateTokens(seen)+Math.ceil(prompt.length/3.5);
  assert.ok(total<=3_100,`selection call too large: ${total} tokens`);
 }finally{
  setAskFoundationModelsForTests(null);
  setFoundationModelsCLIOverrideForTests(null);
 }
});

test('long clear-cut requests route locally; only the on-device path keeps the length guard',async()=>{
 const longEdit='Fix the typo in this note. '+'detail '.repeat(2_000); // >12k chars
 assert.ok(longEdit.length>12_000);
 clearRoutingCache();
 setFoundationModelsCLIOverrideForTests(false);
 try{
  // Without the FM CLI (Windows/Linux) a long edit used to throw instead of
  // using the heuristic that can classify it.
  const routed=await routeAcrossProviders(longEdit,offers,autoEntries(offers,false),'codex',new AbortController().signal,{...baseCtx,activeNote:true});
  assert.equal(routed.classifier,'heuristic');
  assert.equal(routed.task.kind,'edit');
 }finally{
  setFoundationModelsCLIOverrideForTests(null);
  clearRoutingCache();
 }
 // With the CLI present, the fast heuristic still settles it without an FM call.
 let fmCalls=0;
 setFoundationModelsCLIOverrideForTests(true);
 setAskFoundationModelsForTests(async()=>{fmCalls++;return '{"difficulty":1,"kind":"lookup","tools":false,"effort":"low"}';});
 clearRoutingCache();
 try{
  const routed=await routeAcrossProviders(longEdit,offers,autoEntries(offers,false),'codex',new AbortController().signal,{...baseCtx,activeNote:true});
  assert.equal(fmCalls,0);
  assert.equal(routed.task.kind,'edit');
  // A long request the heuristic cannot classify still reaches the length guard.
  const longNuanced='Consider the following material and reflect on it. '+'word '.repeat(3_000);
  assert.equal(heuristicTaskClass(longNuanced,baseCtx,false),null);
  await assert.rejects(
   routeAcrossProviders(longNuanced,offers,autoEntries(offers,false),'codex',new AbortController().signal,baseCtx),
   /too long for automatic selection/);
 }finally{
  setAskFoundationModelsForTests(null);
  setFoundationModelsCLIOverrideForTests(null);
  clearRoutingCache();
 }
});

test('a cached route is invalidated when new routing history changes the scoring',async()=>{
 // Close matchup: haiku beats luna by 0.1 at these plan levels; 10 recorded
 // failures (+0.4 personalization, +0.45 latency) flip it to luna. The cache
 // must not serve the pre-history route afterwards.
 let failures:RoutingHistoryData={};
 for(let i=0;i<10;i++)failures=recordRoutingOutcome(failures,{provider:'claude',model:'haiku',kind:'lookup',success:false,latencyMs:9000});
 const task={difficulty:1,kind:'lookup' as const,tools:false,effort:'low'};
 assert.equal(pickRoute(autoEntries(offers,false),offers,task,'codex',now).model,'haiku');
 assert.equal(pickRoute(autoEntries(offers,false),offers,task,'codex',now,undefined,'balance',failures).model,'gpt-6-luna');
 clearRoutingCache();
 setFoundationModelsCLIOverrideForTests(true);
 let fmCalls=0;
 setAskFoundationModelsForTests(async()=>{fmCalls++;return '{"rationale":"Quick fact.","difficulty":1,"kind":"lookup","tools":false,"effort":"low"}';});
 try{
  const ctx={...baseCtx,thorough:true};
  const first=await routeAcrossProviders('What is the capital of France?',offers,autoEntries(offers,false),'codex',new AbortController().signal,ctx,{nowMs:100_000});
  const second=await routeAcrossProviders('What is the capital of France?',offers,autoEntries(offers,false),'codex',new AbortController().signal,ctx,{history:failures,nowMs:120_000});
  assert.equal(first.model,'haiku');
  assert.equal(second.model,'gpt-6-luna');
  assert.equal(fmCalls,2);
 }finally{
  setAskFoundationModelsForTests(null);
  setFoundationModelsCLIOverrideForTests(null);
  clearRoutingCache();
 }
});

test('the route cache stays bounded and sweeps expired entries',async()=>{
 clearRoutingCache();
 setFoundationModelsCLIOverrideForTests(false);
 try{
  const entries=autoEntries(offers,false);
  for(let i=0;i<70;i++){
   await routeAcrossProviders('What is item number '+i+'?',offers,entries,'codex',new AbortController().signal,baseCtx,{nowMs:100_000+i*1_000});
  }
  assert.ok(routingCacheSizeForTests()<=64,`cache grew to ${routingCacheSizeForTests()}`);
  // One write past the TTL sweeps every expired entry.
  await routeAcrossProviders('What is the final item?',offers,entries,'codex',new AbortController().signal,baseCtx,{nowMs:100_000+70*1_000+5*60_000+1});
  assert.equal(routingCacheSizeForTests(),1);
 }finally{
  setFoundationModelsCLIOverrideForTests(null);
  clearRoutingCache();
 }
});

test('context overflow reports the estimate instead of a generic no-model error',async()=>{
 const ctx={...baseCtx,estimatedTokens:300_000};
 assert.equal(autoEntries(offers,false,300_000).length,0);
 await assert.rejects(
  routeAcrossProviders('Summarize this.',offers,[],'codex',new AbortController().signal,ctx),
  /context window large enough.*300000 tokens/);
 assert.throws(()=>autoFallbackRoute(offers,[],['codex','claude'],300_000),/context window large enough/);
 // Without offers or an estimate the original message remains.
 assert.throws(()=>autoFallbackRoute([],[],['codex']),/No connected provider has a compatible model/);
});

test('single-provider routes weigh the plan meters when the caller passes them',()=>{
 const goPaid=model('opencode-go/anthropic/claude-sonnet-5','Claude Sonnet 5','low/medium/high',{providerID:'opencode-go',cost:{input:3,output:15},context:200_000});
 const zenPaid=model('opencode/claude-sonnet-5','Claude Sonnet 5','low/medium/high',{providerID:'opencode',cost:{input:3,output:15},context:200_000});
 const models=[goPaid,zenPaid];
 const prompt='Compare these notes and combine them into a study plan.';
 const goUsage=(remaining:number)=>({rateLimitsByLimitId:{'opencode-go-rolling':{limitId:'opencode-go-rolling',primary:{usedPercent:100-remaining,windowDurationMins:10080,resetsAt:Date.now()/1000+3600}}}});
 // With Go nearly full its paid model is the cheaper choice; drained, the
 // console-paid twin takes over. Without usage the old blind behaviour stands.
 const full=quickPerProviderRoute(prompt,models,'opencode',baseCtx,undefined,goUsage(90));
 assert.equal(full?.model,'opencode-go/anthropic/claude-sonnet-5');
 const drained=quickPerProviderRoute(prompt,models,'opencode',baseCtx,undefined,goUsage(8));
 assert.equal(drained?.model,'opencode/claude-sonnet-5');
 const blind=quickPerProviderRoute(prompt,models,'opencode');
 assert.equal(blind?.model,'opencode-go/anthropic/claude-sonnet-5');
 const heurDrained=heuristicPerProviderRoute(prompt,models,'opencode',baseCtx,undefined,goUsage(8));
 assert.equal(heurDrained.model,'opencode/claude-sonnet-5');
});

test('Hermes colon-prefixed ids dedupe with their bare forms; OpenCode dedupe is unchanged',()=>{
 const namespaced=model('nous:anthropic/claude-sonnet-5','Claude Sonnet 5','default',{providerID:'nous'});
 const bare=model('nous:claude-sonnet-5','Claude Sonnet 5','default',{providerID:'nous'});
 assert.deepEqual(currentModels('hermes',[namespaced,bare]).map(m=>m.id),['nous:anthropic/claude-sonnet-5']);
 assert.deepEqual(currentModels('hermes',[bare]).map(m=>m.id),['nous:claude-sonnet-5']);
 const viaOpenrouter=model('openrouter/anthropic/claude-sonnet-5','Claude Sonnet 5','low/medium',{providerID:'openrouter',cost:{input:3,output:15}});
 const viaGo=model('opencode-go/anthropic/claude-sonnet-5','Claude Sonnet 5','low/medium',{providerID:'opencode-go',cost:{input:2,output:10}});
 assert.deepEqual(currentModels('opencode',[viaOpenrouter,viaGo]).map(m=>m.id),['opencode-go/anthropic/claude-sonnet-5']);
});

test('a plan whose window just reset is preferred over an unknown plan',()=>{
 // Before the fix an expired 100% window read as unknown usage (scarcity 1.3),
 // penalising the plan that had just reset.
 const reset:ProviderOffer[]=[
  {provider:'codex',plan:'plus',usage:{rateLimitsByLimitId:{main:{limitId:'main',primary:{usedPercent:100,windowDurationMins:300,resetsAt:now-1}}}},models:[model('gpt-6-luna','GPT-6-Luna','low/medium')]},
  {provider:'claude',plan:'Pro',usage:null,models:[model('haiku','Haiku 5.5','low/medium')]},
 ];
 const task={difficulty:2,kind:'edit' as const,tools:true,effort:'low'};
 const route=pickRoute(autoEntries(reset,false),reset,task,'claude',now);
 assert.equal(route.provider,'codex');
 assert.match(route.reason,/100% of the/);
});