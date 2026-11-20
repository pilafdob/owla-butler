import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {autoEntries,pickRoute,quickPerProviderRoute,heuristicTaskClass,type ProviderOffer} from '../src/auto-route';
import {bestContextWindow,trimSelectionsToWindow,type RoutingContext} from '../src/routing';
import type {ProviderModel} from '../src/provider';

const model=(id:string,context:number):ProviderModel=>({id,model:id,displayName:id,isDefault:false,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:''}],inputModalities:['text'],context});
const small=model('gpt-6-luna',8192),large=model('gpt-6',32000);
const offers:ProviderOffer[]=[{provider:'codex',plan:'plus',usage:null,models:[small,large]}];
function trimmedContext():RoutingContext{
 const selected=Array.from({length:40},(_,i)=>({path:i+'.md',text:'x'.repeat(3000)}));
 const trimmed=trimSelectionsToWindow(selected,40000,bestContextWindow([small,large]));
 assert.ok(trimmed.estimatedTokens>small.context!);
 assert.ok(trimmed.estimatedTokens*1.15<=large.context!);
 return {attachments:[],activeNote:false,selections:40,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false,estimatedTokens:trimmed.estimatedTokens};
}
test('per-provider quick selection never chooses a small window after trimming for the largest',()=>{
 const route=quickPerProviderRoute('What is 2+2?',[small,large],'codex',trimmedContext());
 assert.ok(route);
 assert.equal(route.model,large.id);
});
test('cross-provider heuristic selection reapplies the post-trim window budget',()=>{
 const context=trimmedContext();
 const route=pickRoute(autoEntries(offers,false),offers,heuristicTaskClass('What is 2+2?',context,true)!,'codex',Date.now()/1000,context);
 assert.equal(route.model,large.id);
});
test('heuristic routing refuses when even the largest window cannot fit the remaining context',()=>{
 const context={...trimmedContext(),estimatedTokens:40000};
 assert.throws(()=>quickPerProviderRoute('What is 2+2?',[small,large],'codex',context),/compatible|context/i);
});
test('both automatic send branches refilter after selection trimming before routing',()=>{
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');
 assert.match(source,/context=this\.trimSelectionsForWindow\(selected,routingContext,entries\.map[^;]+;\s*entries=entries\.filter\(entry=>routingModels\(\[entry\.model\],needsImg,routingContext\.estimatedTokens\)/);
 assert.match(source,/context=this\.trimSelectionsForWindow\(selected,routingContext,candidates[^;]+;\s*candidates=routingModels\(candidates,needsImg,routingContext\.estimatedTokens\)/);
});
