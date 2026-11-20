// 3.7.0 RC Windows hardening (win-auto): FM-unavailable contract on win32,
// graceful selection trimming, real context-window consumption, Windows path
// basenames, CRLF cache/estimate behaviour, and routing-history fs resilience.
// Deterministic fixtures only; no live model turns, no fm spawn on any host.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,openSync,closeSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 bestContextWindow,
 buildRoutingContext,
 checkFoundationModelsHealth,
 estimateContextTokens,
 estimateTokens,
 foundationModelsLastUse,
 hasFoundationModelsCLI,
 prewarmFoundationModels,
 resetFoundationModelsWarmthForTests,
 routeWithFoundationModels,
 routingModels,
 SELECTION_TRIM_MIN_KEEP_CHARS,
 setAskFoundationModelsForTests,
 setFoundationModelsCLIOverrideForTests,
 summarizeRoutingContext,
 supportsAutomaticSelection,
 trimSelectionsToWindow,
 type RoutingContext,
} from '../src/routing';
import {
 autoEntries,
 clearRoutingCache,
 routeAcrossProviders,
 routingCacheSizeForTests,
 type ProviderOffer,
} from '../src/auto-route';
import {
 loadRoutingHistory,
 pruneRoutingHistory,
 saveRoutingHistory,
 type RoutingHistoryData,
} from '../src/routing-history';
import {clip} from '../src/core';
import type {ProviderModel} from '../src/provider';

const efforts=(list:string)=>list.split('/').map(reasoningEffort=>({reasoningEffort,description:''}));
const model=(id:string,displayName:string,list='low/medium/high',extra:Partial<ProviderModel>={}):ProviderModel=>({id,model:id,displayName,isDefault:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:efforts(list),inputModalities:['text','image'],...extra});
const offers:ProviderOffer[]=[
 {provider:'codex',plan:'plus',usage:null,models:[model('gpt-6-luna','GPT-6-Luna','low/medium')]},
 {provider:'claude',plan:'Pro',usage:null,models:[model('haiku','Haiku 5.5','low/medium')]},
];
const baseCtx:RoutingContext={attachments:[],activeNote:false,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false};
const BS=String.fromCharCode(92); // backslash, immune to transport escaping
const CR=String.fromCharCode(13);
const MARKER=clip('x',0);

test('FM stays macOS-only: win32/linux never see the CLI, and the gate is platform-parameterized',()=>{
 assert.equal(supportsAutomaticSelection('darwin'),true);
 assert.equal(supportsAutomaticSelection('win32'),false);
 assert.equal(supportsAutomaticSelection('linux'),false);
 // Parameterized gate holds on every host, including a Mac with fm installed.
 assert.equal(hasFoundationModelsCLI('win32'),false);
 assert.equal(hasFoundationModelsCLI('linux'),false);
 if(process.platform==='win32'){
  // On a real Windows host without test overrides nothing may reach /usr/bin/fm.
  assert.equal(hasFoundationModelsCLI(),false);
 }
});

test('with the CLI unavailable the routing paths never call fm and report cleanly',async()=>{
 resetFoundationModelsWarmthForTests();
 setFoundationModelsCLIOverrideForTests(false);
 let fmCalls=0;
 setAskFoundationModelsForTests(async()=>{fmCalls++;throw Error('fm must not be called');});
 try{
  await prewarmFoundationModels(1_000_000);
  assert.equal(foundationModelsLastUse(),0,'prewarm must not touch the model');
  const routed=await routeAcrossProviders('What is the capital of France?',offers,autoEntries(offers,false),'codex',new AbortController().signal,baseCtx);
  assert.equal(routed.classifier,'heuristic');
  assert.equal(fmCalls,0);
  await assert.rejects(
   routeWithFoundationModels('What is 2+2?',offers[0].models,new AbortController().signal,baseCtx,'codex'),
   /Foundation Models CLI is unavailable/);
  assert.equal(fmCalls,0);
  // The settings health check reports the platform reality without spawning.
  const win=await checkFoundationModelsHealth(undefined,'win32');
  assert.equal(win.available,false);
  assert.equal(win.routingOk,false);
  assert.equal(win.contextTokens,0);
  assert.match(win.message,/requires macOS/);
  const mac=await checkFoundationModelsHealth(undefined,'darwin');
  assert.equal(mac.available,false);
  assert.match(mac.message,/unavailable on this Mac/,'macOS wording is unchanged');
  assert.equal(fmCalls,0);
 }finally{
  setAskFoundationModelsForTests(null);
  setFoundationModelsCLIOverrideForTests(null);
  resetFoundationModelsWarmthForTests();
 }
});

test('the dead fm count-tokens helper stays removed until calibration wires it with tests',async()=>{
 // Round-1 §5.8 cleanup: zero callers; wiring it would change macOS budgets
 // without a live FM calibration. Reintroduce it together with its caller.
 const routing=await import('../src/routing');
 assert.equal('countFoundationModelTokens' in routing,false);
});

test('selections that fit the best window are left exactly as they are',()=>{
 const selections=[{path:'A.md',text:'x'.repeat(3000)},{path:'B.md',text:'short'}];
 for(const window of [200_000,0,-5,Number.NaN]){
  const trim=trimSelectionsToWindow(selections,20_000,window);
  assert.equal(trim.notice,null);
  assert.equal(trim.estimatedTokens,20_000);
  assert.deepEqual(trim.selections,selections);
  assert.equal(trim.shortened,0);
  assert.equal(trim.removed,0);
 }
 const none=trimSelectionsToWindow([],500_000,8_000);
 assert.equal(none.notice,null,'without selections there is nothing to trim');
 assert.equal(none.estimatedTokens,500_000);
});

test('overflow trims the largest selections first, keeps paths, order and a read_note marker',()=>{
 // 40 clipped selections (the capture cap) are the uncapped payload input:
 // 120k chars ≈ 37,293 tokens with the fixed overhead, over a 32k window.
 const selections=Array.from({length:40},(_,i)=>({path:'Note '+i+'.md',text:'x'.repeat(3000)}));
 const estimate=estimateContextTokens({promptChars:20,selectedChars:120_000});
 const trim=trimSelectionsToWindow(selections,estimate,32_000);
 const target=Math.floor(32_000/1.15);
 assert.ok(trim.notice,'the user must see that context was trimmed');
 assert.match(trim.notice,/32000 tokens/);
 assert.match(trim.notice,/read_note/);
 assert.equal(trim.shortened,13);
 assert.equal(trim.removed,0);
 assert.equal(trim.estimatedTokens,target,'the trimmed estimate lands at the window target');
 assert.equal(trim.selections.length,40);
 assert.ok(trim.selections.every((s,i)=>s.path==='Note '+i+'.md'),'original order and paths survive');
 for(const s of trim.selections){
  if(s.text.length<3000){
   assert.ok(s.text.endsWith(MARKER),'shortened selections carry the standard marker');
   assert.ok(s.text.length>=SELECTION_TRIM_MIN_KEEP_CHARS+MARKER.length,'a useful excerpt remains');
  }
 }
 // Deterministic: a second run produces the identical result.
 assert.deepEqual(trimSelectionsToWindow(selections,estimate,32_000),trim);
});

test('a partial excess shortens only the largest selection and leaves the rest untouched',()=>{
 const a={path:'A.md',text:'a'.repeat(10_000)};
 const b={path:'B.md',text:'b'.repeat(1000)};
 const c={path:'C.md',text:'c'.repeat(500)};
 const target=5_000;
 const estimate=target+1429; // excessChars = ceil(1429*3.5) = 5002
 const trim=trimSelectionsToWindow([a,b,c],estimate,Math.floor(target*1.15));
 assert.equal(trim.shortened,1);
 assert.equal(trim.removed,0);
 assert.equal(trim.selections[0].text.length,10_000-5002);
 assert.ok(trim.selections[0].text.endsWith(MARKER));
 assert.equal(trim.selections[1].text,b.text);
 assert.equal(trim.selections[2].text,c.text);
 assert.equal(trim.estimatedTokens,target);
});

test('when shortening cannot recover enough room, selections are dropped largest first',()=>{
 const selections=[
  {path:'small.md',text:'s'.repeat(400)},
  {path:'big.md',text:'b'.repeat(5000)},
  {path:'mid.md',text:'m'.repeat(2000)},
 ];
 // Excess far beyond what trimming to the floor can recover.
 const trim=trimSelectionsToWindow(selections,60_000,8_000);
 assert.ok(trim.removed>0);
 assert.match(trim.notice!,/removed/);
 // The biggest goes first; whatever survives keeps its path.
 assert.ok(!trim.selections.some(s=>s.path==='big.md')||trim.selections.some(s=>s.path==='small.md'));
 assert.ok(trim.estimatedTokens<60_000);
 // Selections too small to shorten are removed, not mangled below the floor.
 const tiny=Array.from({length:10},(_,i)=>({path:'T'+i,text:'y'.repeat(200)}));
 const tinyTrim=trimSelectionsToWindow(tiny,10_000,8_000);
 assert.equal(tinyTrim.shortened,0);
 assert.equal(tinyTrim.removed,10);
 assert.equal(tinyTrim.selections.length,0);
 // The rest of the payload still overflows: the estimate stays honest and the
 // estimate-aware overflow error downstream remains the backstop.
 assert.ok(tinyTrim.estimatedTokens>Math.floor(8_000/1.15));
});

test('the trimmed estimate never undershoots the recomputed payload estimate (CRLF included)',()=>{
 const fixtures=[
  {promptChars:500,selectedChars:90_000,text:'x'.repeat(3000)},
  {promptChars:200,selectedChars:60_000,text:('line'+CR+String.fromCharCode(10)).repeat(500)},
  {promptChars:5000,selectedChars:45_000,text:'äöü '.repeat(750)},
 ];
 for(const f of fixtures){
  const count=Math.round(f.selectedChars/f.text.length);
  const selections=Array.from({length:count},(_,i)=>({path:'N'+i+'.md',text:f.text}));
  const estimate=estimateContextTokens({promptChars:f.promptChars,selectedChars:f.selectedChars});
  for(const window of [8_000,32_000,128_000]){
   const trim=trimSelectionsToWindow(selections,estimate,window);
   const recomputed=estimateContextTokens({promptChars:f.promptChars,selectedChars:trim.selections.reduce((sum,s)=>sum+s.text.length,0)});
   assert.ok(trim.estimatedTokens>=recomputed,'conservative: returned estimate >= true estimate');
   const target=Math.floor(window/1.15);
   if(estimate>target&&trim.selections.length===0){
    // Nothing left to trim; the estimate must still be honest.
    assert.ok(trim.estimatedTokens>=recomputed);
   }else if(trim.notice){
    assert.ok(trim.estimatedTokens<=Math.max(target,recomputed),'trimmed to the target when selections could cover it');
   }
  }
 }
});

test('bestContextWindow reports the largest offered window with the 200k fallback',()=>{
 assert.equal(bestContextWindow([{context:8192},{context:128_000},{}]),200_000);
 assert.equal(bestContextWindow([{context:8192},{context:32_000}]),32_000);
 assert.equal(bestContextWindow([]),0);
 assert.equal(bestContextWindow([{context:Number.NaN},{context:16_000}]),16_000);
});

test('real catalogue context windows drive eligibility; unknown windows keep the safe fallback',()=>{
 // The Hermes-side accessor (proposed for hermes.ts) fills model.context from
 // models.dev limit.context; routing must consume small real windows strictly.
 const small=model('nous:beam-free','Beam Free','default',{context:8192});
 assert.equal(routingModels([small],false,10_000).length,0,'8k window cannot hold a 10k estimate');
 assert.equal(routingModels([small],false,5_000).length,1,'but a 5k estimate fits');
 const unknown=model('nous:mystery','Mystery','default');
 assert.equal(routingModels([unknown],false,100_000).length,1,'undefined context keeps the 200k assumption');
 assert.equal(routingModels([unknown],false,300_000).length,0);
});

test('Windows drive and UNC attachment names reduce to basenames; POSIX names are unchanged',()=>{
 const ctx=(name:string):RoutingContext=>({...baseCtx,attachments:[{kind:'pdf',name}]});
 const drive='C:'+BS+'Users'+BS+'filip'+BS+'OneDrive'+BS+'Documents'+BS+'My Vault'+BS+'Attachments'+BS+'scan.pdf';
 const unc=BS+BS+'server'+BS+'share'+BS+'docs'+BS+'scan.pdf';
 const posix='/Users/filip/Documents/My Vault/Attachments/scan.pdf';
 const posixBackslash='a'+BS+'b.md'; // legal POSIX filename — must NOT be split
 for(const name of [drive,unc,posix,'D:/mixed/slashes/note.md']){
  const summary=summarizeRoutingContext(ctx(name),{thorough:true});
  assert.equal(summary.items[0].name,name.endsWith('note.md')?'note.md':'scan.pdf');
  assert.equal(summary.items[0].ext,name.endsWith('note.md')?'md':'pdf');
 }
 assert.equal(summarizeRoutingContext(ctx(posixBackslash),{thorough:true}).items[0].name,posixBackslash);
 // The username and folder structure must not ride into the classifier inventory.
 assert.doesNotMatch(JSON.stringify(summarizeRoutingContext(ctx(drive),{thorough:true})),/filip|OneDrive/);
 // Privacy mode still withholds names entirely, Windows-shaped or not.
 const priv=summarizeRoutingContext(ctx(drive),{thorough:true,privacy:true});
 assert.doesNotMatch(JSON.stringify(priv),/scan\.pdf|filip/);
 // Control characters and the 72-char cap still apply to Windows basenames.
 const long='C:'+BS+'vault'+BS+'n'.repeat(120)+'.pdf';
 const capped=summarizeRoutingContext(ctx(long),{thorough:true}).items[0].name as string;
 assert.equal(capped.length,72);
 const ctrl='C:'+BS+'vault'+BS+'bad'+String.fromCharCode(7)+'name.pdf';
 assert.doesNotMatch(summarizeRoutingContext(ctx(ctrl),{thorough:true}).items[0].name as string,/[\x00-\x1f]/);
});

test('CRLF and lone-CR prompts share one cache entry with their LF twin',async()=>{
 clearRoutingCache();
 setFoundationModelsCLIOverrideForTests(true);
 let fmCalls=0;
 setAskFoundationModelsForTests(async()=>{fmCalls++;return '{"rationale":"Quick fact.","difficulty":1,"kind":"lookup","tools":false,"effort":"low"}';});
 try{
  const ctx={...baseCtx,thorough:true};
  const lf='What is the capital'+String.fromCharCode(10)+'of France?';
  const crlf='What is the capital'+CR+String.fromCharCode(10)+'of France?';
  const cr='What is the capital'+CR+'of France?';
  const signal=new AbortController().signal;
  const entries=autoEntries(offers,false);
  const first=await routeAcrossProviders(lf,offers,entries,'codex',signal,ctx,{nowMs:100_000});
  const second=await routeAcrossProviders(crlf,offers,entries,'codex',signal,ctx,{nowMs:110_000});
  const third=await routeAcrossProviders(cr,offers,entries,'codex',signal,ctx,{nowMs:120_000});
  assert.equal(fmCalls,1,'line endings must not split the cache');
  assert.equal(routingCacheSizeForTests(),1);
  assert.equal(second.model,first.model);
  assert.equal(third.model,first.model);
  // Distinct requests still get distinct entries (POSIX behaviour unchanged).
  await routeAcrossProviders('What is the capital of Germany?',offers,entries,'codex',signal,ctx,{nowMs:130_000});
  assert.equal(routingCacheSizeForTests(),2);
  assert.equal(fmCalls,2);
 }finally{
  setAskFoundationModelsForTests(null);
  setFoundationModelsCLIOverrideForTests(null);
  clearRoutingCache();
 }
});

test('CRLF note text inflates the estimate only conservatively, never the other way',()=>{
 const lines=Array.from({length:400},(_,i)=>'Line '+i+' of a Windows note with some content.');
 const lf=lines.join(String.fromCharCode(10));
 const crlf=lines.join(CR+String.fromCharCode(10));
 assert.ok(crlf.length>lf.length);
 const delta=estimateTokens(crlf)-estimateTokens(lf);
 assert.ok(delta>=0,'CRLF must never make the estimate optimistic');
 assert.ok(delta<=Math.ceil(lines.length/3.5),'the inflation is bounded by one char per line');
 assert.ok(estimateContextTokens({activeNoteChars:crlf.length})>=estimateContextTokens({activeNoteChars:lf.length}));
 // The heuristic classifier reads CRLF prompts exactly like LF ones.
 const ctx=buildRoutingContext({prompt:'Fix the typo in this note.'+CR+String.fromCharCode(10)+'More detail.',attachments:[],selections:[],recentMessages:[],previousImages:0,previousPdfs:0,webSearch:false});
 assert.equal(ctx.promptChars,('Fix the typo in this note.'+CR+String.fromCharCode(10)+'More detail.').length);
});

test('pruning a multi-megabyte history is linear, LRU-ordered and byte-exact',()=>{
 const kinds=['lookup','edit','writing','transcription','vision','synthesis','organisation','reasoning','research','coding'];
 const history:RoutingHistoryData={opencode:{}};
 for(let i=0;i<3000;i++){
  const km:Record<string,{success:number;fail:number;latencyMs:number[];lastUsedAt:number}>={};
  for(const k of kinds)km[k]={success:5,fail:1,latencyMs:Array.from({length:20},(_,j)=>1000+j*37),lastUsedAt:1700000000000+i};
  (history.opencode as Record<string,unknown>)['model-'+String(i).padStart(6,'0')]=km;
 }
 const bytes=Buffer.byteLength(JSON.stringify(history));
 assert.ok(bytes>4_000_000,'fixture must exceed the limit several times over');
 const start=Date.now();
 const pruned=pruneRoutingHistory(history);
 const elapsed=Date.now()-start;
 // Pre-fix this took ~35 s of blocked main thread (quadratic stringify+spread);
 // the bound is generous for parallel test load but fails the old behaviour.
 assert.ok(elapsed<5000,'prune took '+elapsed+' ms');
 const after=Buffer.byteLength(JSON.stringify(pruned));
 assert.ok(after<=1_000_000);
 const kept=Object.keys(pruned.opencode??{});
 assert.ok(kept.includes('model-002999'),'the newest model survives');
 assert.ok(!kept.includes('model-000000'),'the oldest model is pruned first');
 assert.deepEqual(pruneRoutingHistory(history),pruned,'deterministic');
 // Exotic keys (emoji, CRLF) still land under the limit exactly.
 const uni:RoutingHistoryData={codex:{}};
 for(let i=0;i<400;i++)(uni.codex as Record<string,unknown>)['🔑-model-'+i+'-'+CR+String.fromCharCode(10)]={lookup:{success:1,fail:0,latencyMs:[1,2,3],lastUsedAt:i}};
 const up=pruneRoutingHistory(uni,20_000);
 assert.ok(Buffer.byteLength(JSON.stringify(up))<=20_000);
});

test('a locked history file preserves the previous data and leaves no temp files',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-auto-'));
 try{
  const file=join(root,'routing-history.json');
  writeFileSync(file,'{"codex":{"old":{"lookup":{"success":1,"fail":0,"latencyMs":[10]}}}}');
  const next:RoutingHistoryData={claude:{haiku:{lookup:{success:2,fail:0,latencyMs:[120],lastUsedAt:1700000000000}}}};
  // An open handle simulates an indexer/OneDrive/Defender sharing lock.
  // Never truncate the previous history to work around a failed rename.
  const previous=readFileSync(file,'utf8');
  const handle=openSync(file,'r+');
  try{
   if(process.platform==='win32'){
    assert.throws(()=>saveRoutingHistory(root,next),/EPERM|EBUSY|EACCES/);
    assert.equal(readFileSync(file,'utf8'),previous,'all previous history survives the persistent lock');
   }else{
    saveRoutingHistory(root,next);
    assert.deepEqual(loadRoutingHistory(root),next,'POSIX atomic replacement succeeds with an open handle');
   }
  }finally{
   closeSync(handle);
  }
  assert.ok(!readdirSync(root).some(name=>name.includes('.tmp')),'no temp file is left behind');
  // A second save without the lock round-trips as well (atomic path intact).
  const again:RoutingHistoryData={codex:{'gpt-6-luna':{edit:{success:1,fail:0,latencyMs:[80],lastUsedAt:1700000000001}}}};
  saveRoutingHistory(root,again);
  assert.deepEqual(loadRoutingHistory(root),again);
  assert.ok(!readdirSync(root).some(name=>name.includes('.tmp')));
 }finally{
  rmSync(root,{recursive:true,force:true});
 }
});