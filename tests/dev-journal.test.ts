import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DevJournal} from '../src/dev-journal';
import {DEV_LIMITS,computeDevTotals,type DevSessionExport,type DevToolOutcome,type DevTurn,type DevTurnInput,type DevTurnOutcome,type SavedDevSessionMeta} from '../src/dev-types';

const input=(prompt:string):DevTurnInput=>({prompt,provider:'codex',model:'test-model',effort:'medium',automatic:false,web:false,contextChars:120,estimatedInputTokens:12});
const turnOutcome=(over:Partial<DevTurnOutcome>={}):DevTurnOutcome=>({ok:true,reply:'done',latencyMs:100,estimatedOutputTokens:20,provider:'codex',model:'test-model',effort:'medium',attempts:1,escalations:0,retries:0,...over});
const toolOutcome=(over:Partial<DevToolOutcome>={}):DevToolOutcome=>({ok:true,result:'ok',durationMs:5,...over});
const tempRoot=()=>mkdtempSync(join(tmpdir(),'owla-dev-journal-'));
const journalFile=(root:string)=>join(root,'developer','journal.json');
const sessionsDir=(root:string)=>join(root,'developer','sessions');

/** A minimal valid saved session with one turn, for persistence fixtures. */
function sessionFixture(savedAt:string,prompt:string):DevSessionExport{
 const turn:DevTurn={id:randomUUID(),chatId:randomUUID(),startedAt:savedAt,endedAt:savedAt,prompt,reply:'reply',provider:'codex',model:'m',effort:'medium',automatic:false,web:false,ok:true,error:null,latencyMs:10,estimatedInputTokens:5,estimatedOutputTokens:5,contextChars:50,attempts:1,escalations:0,retries:0,toolCalls:[{index:0,name:'read',args:'{}',startedAt:savedAt,durationMs:2,ok:true,result:'r'}]};
 const events=[{id:1,at:savedAt,kind:'turn-error' as const,chatId:turn.chatId,detail:'d'}];
 return {kind:'owla-developer-session',version:1,savedAt,chatId:turn.chatId,pluginVersion:'9.9.9',vaultName:'Vault',history:[{role:'user',content:prompt}],turns:[turn],events,totals:computeDevTotals([turn],events)};
}
/** Raw stored-shape turn/event for load-validation fixtures (ids need not be UUIDs). */
const rawTurn=(i:number)=>({id:'t'+i,chatId:'c',startedAt:'2026-01-01T00:00:00.000Z',endedAt:null,prompt:'p'+i,reply:null,provider:'codex',model:'m',effort:'medium',automatic:false,web:false,ok:null,error:null,latencyMs:null,estimatedInputTokens:1,estimatedOutputTokens:0,contextChars:1,attempts:1,escalations:0,retries:0,toolCalls:[]});
const rawEvent=(i:number)=>({id:i,at:'2026-01-01T00:00:00.000Z',kind:'turn-error',chatId:'c',detail:'d'+i});

test('disabled journal records nothing and exports/saves nothing',()=>{
 const root=tempRoot();
 try{
  const j=new DevJournal();
  assert.equal(j.enabled,false);
  const before=j.chatId;
  assert.equal(j.startTurn(input('hi')),null);
  assert.equal(j.toolStart('x','read',{}),null);
  j.toolEnd('x',0,toolOutcome());j.event('turn-error','d');j.endTurn('x',turnOutcome());
  assert.deepEqual(j.counts(),{turns:0,toolCalls:0,events:0});
  assert.equal(j.turns().length,0);assert.equal(j.events().length,0);
  assert.equal(j.exportSession({pluginVersion:'1',vaultName:'V',history:[]}),null);
  j.save(root);
  assert.equal(existsSync(join(root,'developer')),false);
  // newChat still rotates while disabled.
  j.newChat();assert.notEqual(j.chatId,before);assert.equal(j.enabled,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('turn ring drops oldest beyond maxTurns',()=>{
 const j=new DevJournal();j.enabled=true;
 const ids:string[]=[];
 for(let i=0;i<DEV_LIMITS.maxTurns+5;i++)ids.push(j.startTurn(input('prompt '+i))!);
 assert.equal(j.turns().length,DEV_LIMITS.maxTurns);
 assert.equal(j.turns()[0].prompt,'prompt 5');
 assert.equal(j.turns()[DEV_LIMITS.maxTurns-1].prompt,'prompt '+(DEV_LIMITS.maxTurns+4));
 assert.equal(j.turns().some(t=>t.id===ids[0]),false);
});

test('event ring drops oldest beyond maxEvents and ids increment',()=>{
 const j=new DevJournal();j.enabled=true;
 for(let i=0;i<DEV_LIMITS.maxEvents+10;i++)j.event('turn-error','detail '+i);
 assert.equal(j.events().length,DEV_LIMITS.maxEvents);
 assert.equal(j.events()[0].detail,'detail 10');
 const ids=j.events().map(e=>e.id);
 assert.deepEqual(ids,[...ids].sort((a,b)=>a-b));
 assert.equal(new Set(ids).size,ids.length);
});

test('per-turn tool calls: full tier, then compact tier, then a hard ceiling',()=>{
 const j=new DevJournal();j.enabled=true;
 const id=j.startTurn(input('hi'))!;
 for(let i=0;i<DEV_LIMITS.maxToolCallsPerTurn;i++)assert.equal(j.toolStart(id,'read',{i}),i);
 // Retries reset the provider budget per attempt, so calls beyond the full
 // tier stay visible compactly instead of vanishing (audit DM-03).
 const compact=j.toolStart(id,'read',{big:'x'.repeat(5000)})!;
 assert.equal(compact,DEV_LIMITS.maxToolCallsPerTurn);
 assert.ok(j.turns()[0].toolCalls[compact].args.length<=DEV_LIMITS.compactArgClip);
 j.toolEnd(id,compact,{ok:true,result:'r'.repeat(5000),durationMs:3});
 assert.equal(j.turns()[0].toolCalls[compact].result,undefined,'compact calls keep no result text');
 assert.equal(j.turns()[0].toolCalls[compact].ok,true);
 for(let i=DEV_LIMITS.maxToolCallsPerTurn+1;i<DEV_LIMITS.maxCompactToolCallsPerTurn;i++)assert.equal(j.toolStart(id,'read',{i}),i);
 assert.equal(j.toolStart(id,'read',{extra:true}),null);
 assert.equal(j.turns()[0].toolCalls.length,DEV_LIMITS.maxCompactToolCallsPerTurn);
 assert.equal(j.toolStart('unknown-turn','read',{}),null);
});

test('strings are clipped to their DEV_LIMITS caps',()=>{
 const j=new DevJournal();j.enabled=true;
 const id=j.startTurn(input('x'.repeat(DEV_LIMITS.promptClip+500)))!;
 assert.equal(j.turns()[0].prompt.length,DEV_LIMITS.promptClip);
 const idx=j.toolStart(id,'read','a'.repeat(DEV_LIMITS.argClip+500))!;
 assert.equal(j.turns()[0].toolCalls[idx].args.length,DEV_LIMITS.argClip);
 j.toolEnd(id,idx,toolOutcome({ok:false,result:'r'.repeat(DEV_LIMITS.resultClip+500),error:'e'.repeat(DEV_LIMITS.errorClip+500)}));
 const call=j.turns()[0].toolCalls[idx];
 assert.equal(call.result!.length,DEV_LIMITS.resultClip);
 assert.equal(call.error!.length,DEV_LIMITS.errorClip);
 j.event('turn-error','d'.repeat(DEV_LIMITS.detailClip+500));
 assert.equal(j.events()[0].detail.length,DEV_LIMITS.detailClip);
 j.endTurn(id,turnOutcome({ok:false,reply:'y'.repeat(DEV_LIMITS.replyClip+500),error:'e'.repeat(DEV_LIMITS.errorClip+500)}));
 assert.equal(j.turns()[0].reply!.length,DEV_LIMITS.replyClip);
 assert.equal(j.turns()[0].error!.length,DEV_LIMITS.errorClip);
});

test('safe args stringify never throws on circular or exotic values',()=>{
 const j=new DevJournal();j.enabled=true;
 const id=j.startTurn(input('hi'))!;
 const circular:Record<string,unknown>={};circular.self=circular;
 const exotic=Object.create(null) as Record<string,unknown>;exotic.toJSON=()=>{throw Error('nope');};
 const values:unknown[]=[circular,exotic,undefined,10n,()=>1,null,{a:1}];
 for(const value of values){
  const idx=j.toolStart(id,'read',value);
  assert.equal(typeof idx,'number');
  assert.equal(typeof j.turns()[0].toolCalls[idx!].args,'string');
 }
 assert.equal(j.turns()[0].toolCalls[1].args,'[unserializable args]');
});

test('toolEnd is idempotent — first outcome wins',()=>{
 const j=new DevJournal();j.enabled=true;
 const id=j.startTurn(input('hi'))!;
 const idx=j.toolStart(id,'read',{})!;
 j.toolEnd(id,idx,toolOutcome({ok:true,result:'first',durationMs:7}));
 j.toolEnd(id,idx,toolOutcome({ok:false,result:'second',error:'later',durationMs:99}));
 const call=j.turns()[0].toolCalls[idx];
 assert.equal(call.ok,true);assert.equal(call.result,'first');assert.equal(call.durationMs,7);
 assert.equal(call.error,undefined);
 j.toolEnd('unknown',0,toolOutcome());j.toolEnd(id,999,toolOutcome());
});

test('endTurn is idempotent — first end wins',()=>{
 const j=new DevJournal();j.enabled=true;
 const id=j.startTurn(input('hi'))!;
 j.endTurn(id,turnOutcome({ok:true,reply:'first',latencyMs:10}));
 j.endTurn(id,turnOutcome({ok:false,reply:'second',error:'later',latencyMs:99}));
 const turn=j.turns()[0];
 assert.equal(turn.ok,true);assert.equal(turn.reply,'first');assert.equal(turn.latencyMs,10);assert.equal(turn.error,null);
 j.endTurn('unknown',turnOutcome());
});

test('newChat rotates id and currentChat filters by it',()=>{
 const j=new DevJournal();j.enabled=true;
 const chatA=j.chatId;
 const a=j.startTurn(input('a'))!;j.event('turn-error','in-a',a);
 j.newChat();
 const chatB=j.chatId;assert.notEqual(chatA,chatB);
 const b=j.startTurn(input('b'))!;j.event('turn-error','in-b',b);
 assert.equal(j.turns().length,2);assert.equal(j.events().length,2);
 assert.deepEqual(j.currentChatTurns().map(t=>t.id),[b]);
 assert.deepEqual(j.currentChatEvents().map(e=>e.detail),['in-b']);
 assert.equal(j.currentChatTurns()[0].chatId,chatB);
 assert.deepEqual(j.counts(),{turns:2,toolCalls:0,events:2});
});

test('exportSession sanitizes image data URLs and computes totals for the current chat',()=>{
 const j=new DevJournal();j.enabled=true;
 const id=j.startTurn(input('hello'))!;
 const idx=j.toolStart(id,'read',{})!;
 j.toolEnd(id,idx,toolOutcome({ok:false,error:'boom',durationMs:4,guard:'soft'}));
 j.endTurn(id,turnOutcome({ok:true,reply:'answer',latencyMs:50,estimatedOutputTokens:30,escalations:1,retries:2}));
 j.event('tool-budget-soft','budget');j.event('provider-exhausted','out');
 const dataUrl='data:image/png;base64,'+'A'.repeat(200);
 const history=[{role:'user' as const,content:'hi',images:[dataUrl,'https://example.com/x.png']},{role:'assistant' as const,content:'reply'}];
 const session=j.exportSession({pluginVersion:'3.7.0',vaultName:'MyVault',history})!;
 assert.equal(session.kind,'owla-developer-session');assert.equal(session.version,1);
 assert.equal(session.chatId,j.chatId);
 assert.equal(session.history[0].images![0],`[image data omitted: ${dataUrl.length} chars]`);
 assert.equal(session.history[0].images![1],'https://example.com/x.png');
 assert.equal(session.history[1].images,undefined);
 assert.deepEqual(session.totals,computeDevTotals(j.currentChatTurns(),j.currentChatEvents()));
 assert.equal(session.totals.toolCalls,1);assert.equal(session.totals.toolErrors,1);
 assert.equal(session.totals.ruleEvents,1);assert.equal(session.totals.exhaustionEvents,1);
 assert.equal(session.totals.escalations,1);assert.equal(session.totals.retries,2);
 // No turns in the current chat → null; disabled → null.
 j.newChat();
 assert.equal(j.exportSession({pluginVersion:'1',vaultName:'V',history:[]}),null);
 j.enabled=false;
 assert.equal(j.exportSession({pluginVersion:'1',vaultName:'V',history}),null);
});

test('persistence roundtrip: save then load restores chatId, turns and events',()=>{
 const root=tempRoot();
 try{
  const j=new DevJournal();j.enabled=true;
  const id=j.startTurn(input('roundtrip'))!;
  const idx=j.toolStart(id,'read',{path:'Note.md'})!;
  j.toolEnd(id,idx,toolOutcome({ok:true,result:'content',durationMs:3,guard:'repeat'}));
  j.endTurn(id,turnOutcome({ok:true,reply:'final',latencyMs:42,estimatedOutputTokens:15}));
  j.event('quality-escalation','escalated',id);
  j.save(root);
  assert.equal(existsSync(journalFile(root)),true);
  if(process.platform!=='win32'){
   assert.equal(statSync(journalFile(root)).mode&0o777,0o600);
   assert.equal(statSync(join(root,'developer')).mode&0o777,0o700);
  }
  const restored=new DevJournal();
  restored.load(root);
  assert.equal(restored.chatId,j.chatId);
  assert.deepEqual(restored.turns(),j.turns());
  assert.deepEqual(restored.events(),j.events());
  assert.deepEqual(restored.counts(),j.counts());
  // A disabled instance still reports what load restored.
  assert.equal(restored.enabled,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('save is a no-op when empty and prunes an oversized journal to fit',()=>{
 const root=tempRoot();
 try{
  const empty=new DevJournal();empty.enabled=true;empty.save(root);
  assert.equal(existsSync(join(root,'developer')),false);
  const j=new DevJournal();j.enabled=true;
  for(let i=0;i<DEV_LIMITS.maxTurns;i++){
   const id=j.startTurn(input('x'.repeat(DEV_LIMITS.promptClip)))!;
   j.endTurn(id,turnOutcome({reply:'y'.repeat(DEV_LIMITS.replyClip)}));
  }
  assert.equal(j.turns().length,DEV_LIMITS.maxTurns);
  j.save(root);
  // The persisted copy drops oldest turns until it fits (audit F4/DM-12);
  // memory keeps the full ring.
  assert.ok(existsSync(journalFile(root)));
  assert.ok(statSync(journalFile(root)).size<=DEV_LIMITS.maxJournalBytes);
  const k=new DevJournal();k.load(root);
  assert.ok(k.turns().length>0&&k.turns().length<DEV_LIMITS.maxTurns);
  assert.equal(j.turns().length,DEV_LIMITS.maxTurns);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('load tolerates corrupt, oversized and missing journal files',()=>{
 const root=tempRoot();
 try{
  mkdirSync(join(root,'developer'),{recursive:true});
  const j=new DevJournal();
  writeFileSync(journalFile(root),'{not valid json');
  j.load(root);assert.deepEqual(j.counts(),{turns:0,toolCalls:0,events:0});
  writeFileSync(journalFile(root),'x'.repeat(DEV_LIMITS.maxJournalBytes+1));
  j.load(root);assert.equal(j.turns().length,0);
  rmSync(journalFile(root));
  j.load(root);assert.equal(j.turns().length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('load drops malformed entries, bounds rings, and keeps chatId unless valid',()=>{
 const root=tempRoot();
 try{
  mkdirSync(join(root,'developer'),{recursive:true});
  const j=new DevJournal();const original=j.chatId;
  const turns=[rawTurn(0),null,{bad:'entry'},42,rawTurn(1)];
  const events=[rawEvent(1),{id:2,at:'x',kind:'not-a-real-kind',chatId:'c',detail:'d'},null,rawEvent(3)];
  writeFileSync(journalFile(root),JSON.stringify({version:1,chatId:'not-a-uuid',turns,events}));
  j.load(root);
  assert.equal(j.chatId,original);
  assert.deepEqual(j.turns().map(t=>t.id),['t0','t1']);
  assert.deepEqual(j.events().map(e=>e.id),[1,3]);
  // Over-long rings are bounded to the newest entries.
  const manyTurns=Array.from({length:DEV_LIMITS.maxTurns+50},(_,i)=>rawTurn(i));
  const manyEvents=Array.from({length:DEV_LIMITS.maxEvents+50},(_,i)=>rawEvent(i+1));
  const validChat=randomUUID();
  writeFileSync(journalFile(root),JSON.stringify({version:1,chatId:validChat,turns:manyTurns,events:manyEvents}));
  j.load(root);
  assert.equal(j.chatId,validChat);
  assert.equal(j.turns().length,DEV_LIMITS.maxTurns);
  assert.equal(j.turns()[0].id,'t50');
  assert.equal(j.events().length,DEV_LIMITS.maxEvents);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('saveSession retains the newest maxSavedSessions and evicts the oldest',()=>{
 const root=tempRoot();
 try{
  const j=new DevJournal();
  const metas:SavedDevSessionMeta[]=[];
  for(let i=0;i<DEV_LIMITS.maxSavedSessions+1;i++){
   const savedAt=new Date(Date.UTC(2026,0,i+1)).toISOString();
   metas.push(j.saveSession(root,sessionFixture(savedAt,'session '+i)));
  }
  const listed=j.listSessions(root);
  assert.equal(listed.length,DEV_LIMITS.maxSavedSessions);
  assert.equal(listed.some(m=>m.id===metas[0].id),false);
  assert.equal(j.readSession(root,metas[0].id),null);
  assert.equal(listed[0].id,metas[metas.length-1].id);
  assert.equal(readdirSync(sessionsDir(root)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).length,DEV_LIMITS.maxSavedSessions);
  assert.equal(listed[0].title,'session 10');
  assert.equal(listed[0].turns,1);assert.equal(listed[0].toolCalls,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('saveSession refuses an oversized session',()=>{
 const root=tempRoot();
 try{
  const j=new DevJournal();
  const big=sessionFixture('2026-01-01T00:00:00.000Z','big');
  big.history=[{role:'user',content:'x'.repeat(DEV_LIMITS.maxSessionBytes+1000)}];
  assert.throws(()=>j.saveSession(root,big),/too large to save/);
  assert.equal(existsSync(sessionsDir(root)),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('listSessions skips malformed and oversized files, sorts newest first, missing dir is empty',()=>{
 const root=tempRoot();
 try{
  const j=new DevJournal();
  assert.deepEqual(j.listSessions(root),[]);
  const goodA=j.saveSession(root,sessionFixture('2026-02-01T00:00:00.000Z','older'));
  const goodB=j.saveSession(root,sessionFixture('2026-03-01T00:00:00.000Z','newer'));
  writeFileSync(join(sessionsDir(root),randomUUID()+'.json'),'{broken');
  writeFileSync(join(sessionsDir(root),randomUUID()+'.json'),JSON.stringify({kind:'wrong',version:1}));
  writeFileSync(join(sessionsDir(root),randomUUID()+'.json'),'x'.repeat(DEV_LIMITS.maxSessionBytes+1));
  writeFileSync(join(sessionsDir(root),'not-a-uuid.json'),JSON.stringify({kind:'owla-developer-session',version:1}));
  const listed=j.listSessions(root);
  assert.deepEqual(listed.map(m=>m.id),[goodB.id,goodA.id]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('readSession and removeSession validate the id and tolerate problems',()=>{
 const root=tempRoot();
 try{
  const j=new DevJournal();
  const meta=j.saveSession(root,sessionFixture('2026-01-01T00:00:00.000Z','read me'));
  const session=j.readSession(root,meta.id)!;
  assert.equal(session.kind,'owla-developer-session');assert.equal(session.version,1);
  assert.equal(session.chatId,meta.chatId);assert.equal(session.turns.length,1);
  assert.deepEqual(session.totals,computeDevTotals(session.turns,session.events));
  assert.equal(j.readSession(root,'../evil'),null);
  assert.equal(j.readSession(root,'not-a-uuid'),null);
  assert.equal(j.readSession(root,randomUUID()),null);
  assert.throws(()=>j.removeSession(root,'../evil'),/Invalid developer session/);
  assert.throws(()=>j.removeSession(root,'XYZ'),/Invalid developer session/);
  j.removeSession(root,meta.id);
  assert.equal(j.readSession(root,meta.id),null);
  j.removeSession(root,meta.id); // best-effort, no throw on missing
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('clear resets memory, removes journal and UUID session files, never touches others',()=>{
 const root=tempRoot();
 try{
  const j=new DevJournal();j.enabled=true;
  const id=j.startTurn(input('clear'))!;j.event('turn-error','d',id);
  j.save(root);
  j.saveSession(root,sessionFixture('2026-01-01T00:00:00.000Z','s1'));
  j.saveSession(root,sessionFixture('2026-02-01T00:00:00.000Z','s2'));
  const keep=join(sessionsDir(root),'keep.txt');
  writeFileSync(keep,'do not delete');
  const chatBefore=j.chatId;
  j.clear(root);
  assert.deepEqual(j.counts(),{turns:0,toolCalls:0,events:0});
  assert.equal(j.chatId,chatBefore);
  assert.equal(existsSync(journalFile(root)),false);
  assert.equal(readdirSync(sessionsDir(root)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).length,0);
  assert.equal(existsSync(keep),true);
  j.clear(root); // never throws when already gone
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('counts sums tool calls across turns and works while disabled',()=>{
 const root=tempRoot();
 try{
  const j=new DevJournal();j.enabled=true;
  const a=j.startTurn(input('a'))!;j.toolStart(a,'read',{});j.toolStart(a,'write',{});
  const b=j.startTurn(input('b'))!;j.toolStart(b,'read',{});
  j.event('turn-error','d');
  assert.deepEqual(j.counts(),{turns:2,toolCalls:3,events:1});
  j.save(root);
  const disabled=new DevJournal();disabled.load(root);
  assert.equal(disabled.enabled,false);
  assert.deepEqual(disabled.counts(),{turns:2,toolCalls:3,events:1});
 }finally{rmSync(root,{recursive:true,force:true});}
});

// ---------------------------------------------------------------- audit regressions

test('a turn recorded while enabled is closed even after disabling mid-turn (DM-01)',()=>{
 const j=new DevJournal();j.enabled=true;
 const id=j.startTurn(input('hi'))!;
 const call=j.toolStart(id,'read',{})!;
 j.enabled=false;
 j.toolEnd(id,call,toolOutcome({ok:false,error:'Stopped.'}));
 j.endTurn(id,turnOutcome({ok:false,error:'Stopped.'}));
 const turn=j.turns()[0];
 assert.equal(turn.endedAt!==null,true);
 assert.equal(turn.ok,false);
 assert.equal(turn.toolCalls[0].durationMs!==null,true);
 // Nothing NEW is recorded while disabled.
 assert.equal(j.startTurn(input('next')),null);
 j.event('turn-error','nope');
 assert.equal(j.events().length,0);
});

test('an event about a turn keeps that turn\'s chat after a rotation (DM-05)',()=>{
 const j=new DevJournal();j.enabled=true;
 const id=j.startTurn(input('hi'))!;
 const originalChat=j.chatId;
 j.newChat();
 j.event('turn-error','late failure',id);
 j.event('chat-cleared','no turn reference');
 const events=j.events();
 assert.equal(events[0].chatId,originalChat);
 assert.equal(events[0].turnId,id);
 assert.equal(events[1].chatId,j.chatId);
 assert.equal(j.currentChatEvents().length,1);
});

test('session export redacts credentials in errors and details (F5)',()=>{
 const secret='sk-'+'liveabcdef123456789';
 const j=new DevJournal();j.enabled=true;
 const id=j.startTurn(input('hi'))!;
 const call=j.toolStart(id,'read',{})!;
 j.toolEnd(id,call,toolOutcome({ok:false,error:'auth failed: '+secret}));
 j.endTurn(id,turnOutcome({ok:false,error:'Bearer abcdef123456789 leaked'}));
 j.event('turn-error','password="***"',id);
 const session=j.exportSession({pluginVersion:'1',vaultName:'V',history:[]})!;
 assert.ok(!JSON.stringify(session).includes(secret));
 assert.ok(!JSON.stringify(session).includes('abcdef123456789'));
 assert.ok(!JSON.stringify(session).includes('hunter2'));
 assert.ok(session.turns[0].toolCalls[0].error!.includes('[redacted]'));
 // The in-memory journal keeps the raw text; only the export is redacted.
 assert.ok(j.turns()[0].toolCalls[0].error!.includes(secret));
});

test('session retention stays bounded against a hostile directory (F3)',()=>{
 const root=tempRoot();
 try{
  const dir=sessionsDir(root);mkdirSync(dir,{recursive:true});
  for(let i=0;i<150;i++){
   writeFileSync(join(dir,randomUUID()+'.json'),JSON.stringify({kind:'owla-developer-session',version:1,savedAt:'2026-01-01T00:00:00.000Z'}));
  }
  const j=new DevJournal();
  const meta=j.saveSession(root,sessionFixture(new Date().toISOString(),'fresh'));
  const left=readdirSync(dir).filter(f=>/\.json$/.test(f));
  assert.ok(left.length<=DEV_LIMITS.maxSavedSessions,'retention enforced: '+left.length);
  assert.ok(left.includes(meta.id+'.json'),'the newest session survives');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('symlinked session files are skipped, never followed (F8)',()=>{
 const root=tempRoot();
 try{
  const dir=sessionsDir(root);mkdirSync(dir,{recursive:true});
  const outside=join(root,'outside.json');
  writeFileSync(outside,JSON.stringify(sessionFixture(new Date().toISOString(),'target')));
  const linkId=randomUUID();
  symlinkSync(outside,join(dir,linkId+'.json'));
  const j=new DevJournal();
  assert.equal(j.listSessions(root).length,0);
  assert.equal(j.readSession(root,linkId),null);
  j.saveSession(root,sessionFixture(new Date().toISOString(),'real'));
  assert.ok(existsSync(outside),'prune never touches a symlink target');
  assert.equal(j.readSession(root,linkId),null);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('session ids must be real UUIDs, not 36 dashes (F7)',()=>{
 const root=tempRoot();
 try{
  const j=new DevJournal();
  assert.equal(j.readSession(root,'-'.repeat(36)),null);
  assert.throws(()=>j.removeSession(root,'-'.repeat(36)),/Invalid developer session/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
