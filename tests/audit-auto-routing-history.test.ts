// 3.7.0 RC auto-mode audit: routing-history growth and persistence.
// Before the fix, a history past 1 MB was silently never saved again, and the
// next load discarded it whole. These cases pin the LRU prune and salvage.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 clearRoutingHistory,
 loadRoutingHistory,
 personalizationScore,
 pruneRoutingHistory,
 recordRoutingOutcome,
 saveRoutingHistory,
 type RoutingHistoryData,
} from '../src/routing-history';
import {TASK_KINDS} from '../src/model-profiles';

/** ~1.2 MB of history: 800 churned model ids, every kind, full latency rings. */
function oversizedHistory():RoutingHistoryData{
 const models:Record<string,Record<string,{success:number;fail:number;latencyMs:number[];lastUsedAt:number}>>={};
 for(let i=0;i<800;i++){
  const kinds:Record<string,{success:number;fail:number;latencyMs:number[];lastUsedAt:number}>={};
  for(const kind of TASK_KINDS)kinds[kind]={success:14,fail:6,latencyMs:Array.from({length:20},(_,j)=>1000+j),lastUsedAt:i};
  models['openrouter/model-'+i]=kinds;
 }
 return {opencode:models};
}

test('an oversized history is pruned and saved instead of silently dropped',()=>{
 const dir=mkdtempSync(join(tmpdir(),'owla-audit-hist-'));
 try{
  const hist=oversizedHistory();
  assert.ok(Buffer.byteLength(JSON.stringify(hist))>1_000_000);
  saveRoutingHistory(dir,hist);
  const file=join(dir,'routing-history.json');
  assert.ok(existsSync(file),'the save must not be skipped');
  assert.ok(statSync(file).size<=1_000_000);
  const reloaded=loadRoutingHistory(dir);
  const models=reloaded.opencode??{};
  assert.ok(Object.keys(models).length>0,'personalization survives');
  // Most recently used entries stay; the oldest churned ids are pruned first.
  assert.ok(models['openrouter/model-799']);
  assert.equal(models['openrouter/model-0'],undefined);
  assert.equal(personalizationScore(reloaded,'opencode','openrouter/model-799','lookup'),Number(((0.5-14/20)*0.8).toFixed(4)));
 }finally{
  rmSync(dir,{recursive:true,force:true});
 }
});

test('a legacy oversized file is salvaged on load, not discarded whole',()=>{
 const dir=mkdtempSync(join(tmpdir(),'owla-audit-hist-'));
 try{
  const hist=oversizedHistory();
  writeFileSync(join(dir,'routing-history.json'),JSON.stringify(hist));
  const loaded=loadRoutingHistory(dir);
  assert.ok(Object.keys(loaded.opencode??{}).length>0);
  assert.ok(Buffer.byteLength(JSON.stringify(loaded))<=1_000_000);
  assert.ok(loaded.opencode?.['openrouter/model-799']);
  // And the next save persists the salvaged state.
  saveRoutingHistory(dir,loaded);
  assert.ok(statSync(join(dir,'routing-history.json')).size<=1_000_000);
 }finally{
  rmSync(dir,{recursive:true,force:true});
 }
});

test('pruning is least-recently-used first, with deterministic ties',()=>{
 const stats=(lastUsedAt:number,success:number)=>({success,fail:0,latencyMs:[1000],lastUsedAt});
 const hist:RoutingHistoryData={codex:{
  'old-but-busy':{lookup:stats(100,50)},
  'recent':{lookup:stats(300,1)},
  'middle':{lookup:stats(200,1)},
 }};
 const small=pruneRoutingHistory(hist,Buffer.byteLength(JSON.stringify({codex:{recent:hist.codex!.recent}}))+40);
 assert.deepEqual(Object.keys(small.codex??{}),['recent']);
 // Equal lastUsedAt: fewer samples is dropped first; then the key order decides.
 const tied:RoutingHistoryData={codex:{
  'a-heavy':{lookup:stats(100,50)},
  'z-light':{lookup:stats(100,1)},
  'a-light':{lookup:stats(100,1)},
 }};
 const one=pruneRoutingHistory(tied,Buffer.byteLength(JSON.stringify({codex:{'a-heavy':tied.codex!['a-heavy']}}))+40);
 assert.deepEqual(Object.keys(one.codex??{}),['a-heavy']);
 // A history that already fits is returned unchanged.
 assert.equal(pruneRoutingHistory(tied),tied);
});

test('recordRoutingOutcome stamps lastUsedAt and legacy entries without it still load',()=>{
 let hist=recordRoutingOutcome({}, {provider:'claude',model:'sonnet',kind:'writing',success:true,latencyMs:1200},1234);
 assert.equal(hist.claude?.sonnet?.writing?.lastUsedAt,1234);
 hist=recordRoutingOutcome(hist,{provider:'claude',model:'sonnet',kind:'writing',success:true,latencyMs:1300},5678);
 assert.equal(hist.claude?.sonnet?.writing?.lastUsedAt,5678);
 assert.equal(hist.claude?.sonnet?.writing?.success,2);
 const dir=mkdtempSync(join(tmpdir(),'owla-audit-hist-'));
 try{
  writeFileSync(join(dir,'routing-history.json'),JSON.stringify({claude:{haiku:{lookup:{success:3,fail:0,latencyMs:[900,950,1000]}}}}));
  const loaded=loadRoutingHistory(dir);
  assert.equal(personalizationScore(loaded,'claude','haiku','lookup'),-0.4);
  assert.equal(loaded.claude?.haiku?.lookup?.lastUsedAt,undefined);
 }finally{
  rmSync(dir,{recursive:true,force:true});
 }
});

test('model keys are bounded on load and malformed entries stay rejected',()=>{
 const dir=mkdtempSync(join(tmpdir(),'owla-audit-hist-'));
 try{
  const longKey='x'.repeat(300);
  writeFileSync(join(dir,'routing-history.json'),JSON.stringify({
   opencode:{[longKey]:{lookup:{success:9,fail:0,latencyMs:[]}},'ok/model':{lookup:{success:1,fail:0,latencyMs:[]}}},
   'not-a-provider':{'m':{lookup:{success:9,fail:0,latencyMs:[]}}},
  }));
  const loaded=loadRoutingHistory(dir);
  assert.deepEqual(Object.keys(loaded.opencode??{}),['ok/model']);
  assert.equal(loaded['not-a-provider' as never],undefined);
  clearRoutingHistory(dir);
  assert.deepEqual(loadRoutingHistory(dir),{});
 }finally{
  rmSync(dir,{recursive:true,force:true});
 }
});