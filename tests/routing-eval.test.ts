import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
 autoEntries,
 calibrateTask,
 decodeTaskClass,
 heuristicTaskClass,
 pickRoute,
 type ProviderOffer,
} from '../src/auto-route';
import type {TaskKind} from '../src/model-profiles';
import type {ProviderModel} from '../src/provider';
import type {RoutingAttachment,RoutingContext} from '../src/routing';

type EvalFixture={
 id:string;
 prompt:string;
 context:{
  attachments:RoutingAttachment[];
  activeNote:boolean;
  selections?:number;
  webSearch?:boolean;
 };
 recordedFm:string;
 expected:{
  kind:TaskKind;
  minDifficulty:number;
  maxDifficulty:number;
  tools:boolean;
  families:string[];
 };
};

const efforts=(list:string)=>list.split('/').map(reasoningEffort=>({reasoningEffort,description:''}));
const model=(id:string,displayName:string,list='low/medium/high/xhigh/max',extra:Partial<ProviderModel>={}):ProviderModel=>({
 id,model:id,displayName,isDefault:false,defaultReasoningEffort:'medium',
 supportedReasoningEfforts:efforts(list),inputModalities:['text','image'],...extra
});
const free=(id:string,name:string,image=true)=>model(id,name,'low/high/max',{cost:{input:0,output:0},context:200000,inputModalities:image?['text','image']:['text']});
const now=1_000_000;
const usage=(remaining:number)=>({rateLimitsByLimitId:{main:{limitId:'main',primary:{usedPercent:100-remaining,windowDurationMins:300,resetsAt:now+3600}}}});

const evalOffers:ProviderOffer[]=[
 {provider:'codex',plan:'plus',usage:usage(70),models:[model('gpt-6.1-sol','GPT-6.1-Sol'),model('gpt-6-astra','GPT-6-Astra'),model('gpt-6.1-terra','GPT-6.1 Terra'),model('gpt-6-luna','GPT-6-Luna')]},
 {provider:'opencode',plan:'',usage:null,models:[free('opencode/nemotron-3.5-super-vl-free','Nemotron 3.5 Super VL Free'),free('opencode/deepseek-v4.1-flash-free','DeepSeek V4.1 Flash Free')]},
 {provider:'claude',plan:'Claude Pro',usage:usage(80),models:[model('opus','Opus 5.5'),model('sonnet','Sonnet 5.5'),model('fable','Fable 5.2'),model('haiku','Haiku 5.5')]},
];

test('routing evaluation fixture suite validates calibrated FM and heuristic accuracy across 30 prompts',()=>{
 const raw=readFileSync(join(process.cwd(),'tests','fixtures','routing-prompts.json'),'utf8');
 const fixtures=JSON.parse(raw) as EvalFixture[];
 assert.ok(fixtures.length>=30,`Expected at least 30 eval prompts, found ${fixtures.length}`);

 let fmKindMatches=0;
 let fmDifficultyMatches=0;
 let heuristicKindMatches=0;

 for(const item of fixtures){
  const ctx:RoutingContext={
   attachments:item.context.attachments,
   activeNote:item.context.activeNote,
   selections:item.context.selections??0,
   recentMessages:0,
   previousImages:0,
   previousPdfs:0,
   webSearch:item.context.webSearch??true,
  };
  const decoded=calibrateTask(decodeTaskClass(item.recordedFm),item.prompt,ctx);
  if(decoded.kind===item.expected.kind)fmKindMatches++;
  if(decoded.difficulty>=item.expected.minDifficulty&&decoded.difficulty<=item.expected.maxDifficulty){
   fmDifficultyMatches++;
  }
  assert.equal(decoded.tools,item.expected.tools,`Tools mismatch on ${item.id}`);

  const heur=heuristicTaskClass(item.prompt,ctx,true)!;
  if(heur.kind===item.expected.kind)heuristicKindMatches++;

  const entries=autoEntries(evalOffers,item.context.attachments.some(a=>a.kind==='image'));
  const routed=pickRoute(entries,evalOffers,decoded,'codex',now,ctx);
  const matchesFamily=item.expected.families.some(fam=>
   (fam==='free'&&routed.provider==='opencode')||routed.model.includes(fam)
  );
  assert.ok(matchesFamily,`Route ${routed.provider}:${routed.model} did not match expected families [${item.expected.families.join(', ')}] for ${item.id}`);
 }

 const fmAccuracy=fmKindMatches/fixtures.length;
 const heurAccuracy=heuristicKindMatches/fixtures.length;
 if(process.env.OWLA_ROUTING_EVAL==='1'){
  console.log(`Routing eval (${fixtures.length} prompts): FM kind=${(fmAccuracy*100).toFixed(1)}%, FM difficulty=${(fmDifficultyMatches/fixtures.length*100).toFixed(1)}%, heuristic kind=${(heurAccuracy*100).toFixed(1)}%`);
 }
 assert.ok(fmAccuracy>=0.95,`Expected >=95% calibrated FM kind accuracy, got ${(fmAccuracy*100).toFixed(1)}%`);
 assert.ok(heurAccuracy>=0.85,`Expected >=85% heuristic kind accuracy, got ${(heurAccuracy*100).toFixed(1)}%`);
});
