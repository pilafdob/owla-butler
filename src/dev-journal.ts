/**
 * Developer mode recording journal.
 *
 * Records turns, tool calls and guard events while Developer mode is enabled,
 * keeps them in bounded in-memory rings, and persists them to OWLA's private
 * vault storage (never inside the vault, never sent to a provider). Persistence
 * follows the same discipline as routing-history.ts: atomic temp-file + rename
 * publish, a bounded retry for transient Windows sharing locks, byte caps, and
 * tolerant loads that never throw on corrupt or oversized files.
 *
 * Pure module — no Obsidian imports, renderer-safe. The retry pause is a bounded
 * performance.now() spin, never Atomics.wait (unavailable on Electron's renderer
 * thread, where Obsidian plugins run).
 */
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {record,list,redactSensitive} from './validation';
import {DEV_LIMITS,computeDevTotals,type DevEvent,type DevEventKind,type DevToolCall,type DevTurn,type DevTurnInput,type DevToolOutcome,type DevTurnOutcome,type DevSessionExport,type SavedDevSessionMeta} from './dev-types';
import type {ChatMessage,ProviderId} from './provider';

const UUID_PATTERN=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SESSION_FILE_PATTERN=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/;
const EVENT_KINDS=new Set<string>([
 'developer-mode-enabled','developer-mode-disabled','chat-cleared',
 'tool-budget-soft','tool-budget-hard','repeat-call',
 'context-shortened','history-trimmed','selections-trimmed',
 'quality-escalation','auto-retry','provider-exhausted','model-refusal',
 'turn-error','empty-reply','proposal-rejected','edit-conflict',
 'dev-session-saved','diagnostics-downloaded',
]);

function clip(text:string,max:number):string{return text.length<=max?text:text.slice(0,max);}
function isProvider(value:unknown):value is ProviderId{
 return value==='codex'||value==='opencode'||value==='claude'||value==='hermes';
}
function str(value:unknown,max:number):string|null{return typeof value==='string'?clip(value,max):null;}
function num(value:unknown):number{return typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.floor(value):0;}
function nullableNum(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.floor(value):null;}
function nullableBool(value:unknown):boolean|null{return value===true?true:value===false?false:null;}

/** JSON.stringify never throws on circular/exotic args; fall back to String, then a marker. */
function safeArgs(args:unknown):string{
 let text:string|undefined;
 try{text=JSON.stringify(args);}catch{/* circular structure or a BigInt */}
 if(typeof text!=='string'){try{text=String(args);}catch{/* null-prototype object */text='[unserializable args]';}}
 return clip(text,DEV_LIMITS.argClip);
}

function validateToolCall(value:unknown):DevToolCall|null{
 const c=record(value);
 const name=str(c.name,200),startedAt=str(c.startedAt,64);
 if(name===null||startedAt===null)return null;
 const call:DevToolCall={index:num(c.index),name,args:str(c.args,DEV_LIMITS.argClip)??'',startedAt,durationMs:nullableNum(c.durationMs),ok:c.ok===true};
 const result=str(c.result,DEV_LIMITS.resultClip);if(result!==null)call.result=result;
 const error=str(c.error,DEV_LIMITS.errorClip);if(error!==null)call.error=error;
 if(c.guard==='soft'||c.guard==='hard'||c.guard==='repeat')call.guard=c.guard;
 return call;
}

function validateTurn(value:unknown):DevTurn|null{
 const t=record(value);
 const id=str(t.id,64),chatId=str(t.chatId,64),startedAt=str(t.startedAt,64);
 const provider=t.provider,model=str(t.model,256),effort=str(t.effort,64);
 if(!id||!chatId||!startedAt||!isProvider(provider)||model===null||effort===null)return null;
 const toolCalls=list(t.toolCalls).map(validateToolCall).filter((c):c is DevToolCall=>c!==null).slice(0,DEV_LIMITS.maxCompactToolCallsPerTurn);
 toolCalls.forEach((c,i)=>{c.index=i;});
 return {
  id,chatId,startedAt,
  endedAt:t.endedAt===null?null:str(t.endedAt,64),
  prompt:str(t.prompt,DEV_LIMITS.promptClip)??'',
  reply:t.reply===null?null:str(t.reply,DEV_LIMITS.replyClip),
  provider,model,effort,
  automatic:t.automatic===true,web:t.web===true,
  ok:nullableBool(t.ok),
  error:t.error===null?null:str(t.error,DEV_LIMITS.errorClip),
  latencyMs:nullableNum(t.latencyMs),
  estimatedInputTokens:num(t.estimatedInputTokens),
  estimatedOutputTokens:num(t.estimatedOutputTokens),
  contextChars:num(t.contextChars),
  attempts:Math.max(1,num(t.attempts)),
  escalations:num(t.escalations),retries:num(t.retries),
  toolCalls,
 };
}

function validateEvent(value:unknown):DevEvent|null{
 const e=record(value);
 const kind=e.kind,at=str(e.at,64),chatId=str(e.chatId,64);
 if(typeof kind!=='string'||!EVENT_KINDS.has(kind)||at===null||chatId===null)return null;
 const event:DevEvent={id:num(e.id),at,kind:kind as DevEventKind,chatId,detail:str(e.detail,DEV_LIMITS.detailClip)??''};
 const turnId=str(e.turnId,64);if(turnId!==null&&turnId!=='')event.turnId=turnId;
 return event;
}

function validateMessage(value:unknown):ChatMessage|null{
 const m=record(value);
 if((m.role!=='user'&&m.role!=='assistant')||typeof m.content!=='string')return null;
 const message:ChatMessage={role:m.role,content:clip(m.content,DEV_LIMITS.replyClip)};
 if(typeof m.context==='string')message.context=clip(m.context,DEV_LIMITS.promptClip);
 if(typeof m.sourcePath==='string')message.sourcePath=clip(m.sourcePath,1024);
 if(Array.isArray(m.images))message.images=m.images.filter((i):i is string=>typeof i==='string').map(i=>clip(i,DEV_LIMITS.argClip));
 return message;
}

/** Tolerant full validation of a saved session; recomputes totals so they always agree. */
function validateSession(raw:unknown):DevSessionExport|null{
 const top=record(raw);
 if(top.kind!=='owla-developer-session'||top.version!==1)return null;
 const savedAt=str(top.savedAt,64),chatId=str(top.chatId,64),pluginVersion=str(top.pluginVersion,64),vaultName=str(top.vaultName,256);
 if(savedAt===null||chatId===null||pluginVersion===null||vaultName===null)return null;
 const turns=list(top.turns).map(validateTurn).filter((t):t is DevTurn=>t!==null).slice(-DEV_LIMITS.maxTurns);
 const events=list(top.events).map(validateEvent).filter((e):e is DevEvent=>e!==null).slice(-DEV_LIMITS.maxEvents);
 const history=list(top.history).map(validateMessage).filter((m):m is ChatMessage=>m!==null);
 return {kind:'owla-developer-session',version:1,savedAt,chatId,pluginVersion,vaultName,history,turns,events,totals:computeDevTotals(turns,events)};
}

/** First user prompt excerpt for the settings list; control chars stripped, ≤80 chars. */
function sessionTitle(session:DevSessionExport):string{
 let text='';
 for(const turn of session.turns){if(turn.prompt){text=turn.prompt;break;}}
 if(!text){for(const message of session.history){if(message.role==='user'&&message.content){text=message.content;break;}}}
 return text.replace(/\p{Cc}/gu,' ').trim().slice(0,80)||'Developer session';
}

function toolCallCount(turns:readonly DevTurn[]):number{
 let n=0;for(const turn of turns)n+=turn.toolCalls.length;return n;
}

/**
 * Atomic publish: write a private temp file, then rename over the target. A
 * bounded retry rides out transient EPERM/EBUSY/EACCES sharing locks; any other
 * error propagates. The temp file is always cleaned up in finally.
 */
function writeAtomic(file:string,data:string):void{
 mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const temp=file+'.tmp-'+randomUUID().slice(0,8);
 try{
  writeFileSync(temp,data,{mode:0o600,flag:'wx'});
  for(let attempt=0;;attempt++){
   try{renameSync(temp,file);break;}
   catch(error){
    const code=record(error).code;
    if(attempt>=2||(code!=='EPERM'&&code!=='EBUSY'&&code!=='EACCES'))throw error;
    // Atomics.wait is unavailable on Electron's renderer thread; spin on a
    // monotonic clock for at most two 25 ms pauses, only on the lock path.
    const until=performance.now()+25;
    while(performance.now()<until){/* bounded spin */}
   }
  }
 }finally{
  try{if(existsSync(temp))unlinkSync(temp);}catch{/* A locked temp file is harmless; the next save uses a new name. */}
 }
}

export class DevJournal{
 enabled:boolean=false;
 chatId:string=randomUUID();
 private turnsList:DevTurn[]=[];
 private eventsList:DevEvent[]=[];
 private eventSeq=0;

 /** Rotates the chat id always, even when disabled; recorded data keeps its old chatId. */
 newChat():void{this.chatId=randomUUID();}

 startTurn(input:DevTurnInput):string|null{
  if(!this.enabled)return null;
  const turn:DevTurn={
   id:randomUUID(),chatId:this.chatId,startedAt:new Date().toISOString(),endedAt:null,
   prompt:clip(input.prompt,DEV_LIMITS.promptClip),reply:null,
   provider:input.provider,model:clip(input.model,256),effort:clip(input.effort,64),
   automatic:input.automatic,web:input.web,
   ok:null,error:null,latencyMs:null,
   estimatedInputTokens:num(input.estimatedInputTokens),estimatedOutputTokens:0,
   contextChars:num(input.contextChars),attempts:1,escalations:0,retries:0,toolCalls:[],
  };
  this.turnsList.push(turn);
  if(this.turnsList.length>DEV_LIMITS.maxTurns)this.turnsList.shift();
  return turn.id;
 }

 toolStart(turnId:string,name:string,args:unknown):number|null{
  if(!this.enabled)return null;
  const turn=this.turnsList.find(t=>t.id===turnId);
  if(!turn||turn.toolCalls.length>=DEV_LIMITS.maxCompactToolCallsPerTurn)return null;
  const index=turn.toolCalls.length;
  // Beyond the full tier (retries reset the provider budget per attempt),
  // record compactly: every command stays visible, memory stays bounded.
  const compact=index>=DEV_LIMITS.maxToolCallsPerTurn;
  const argsText=safeArgs(args);
  turn.toolCalls.push({index,name:clip(name,200),args:compact?clip(argsText,DEV_LIMITS.compactArgClip):argsText,startedAt:new Date().toISOString(),durationMs:null,ok:false});
  return index;
 }

 /** Idempotent: the first outcome wins; later calls for the same call are ignored.
  * Closing an already-recorded call is cleanup, not new recording, so it also
  * runs when Developer mode was switched off mid-turn (audit DM-01). */
 toolEnd(turnId:string,index:number,outcome:DevToolOutcome):void{
  const turn=this.turnsList.find(t=>t.id===turnId);
  const call=turn?.toolCalls[index];
  if(!call||call.durationMs!==null)return;
  const compact=index>=DEV_LIMITS.maxToolCallsPerTurn;
  call.ok=outcome.ok;
  call.durationMs=num(outcome.durationMs);
  if(!compact&&typeof outcome.result==='string')call.result=clip(outcome.result,DEV_LIMITS.resultClip);
  if(typeof outcome.error==='string')call.error=clip(outcome.error,compact?DEV_LIMITS.compactArgClip:DEV_LIMITS.errorClip);
  if(outcome.guard==='soft'||outcome.guard==='hard'||outcome.guard==='repeat')call.guard=outcome.guard;
 }

 event(kind:DevEventKind,detail:string,turnId?:string):void{
  if(!this.enabled)return;
  // An event about a turn belongs to that turn's chat, even if the user
  // started a new chat while the reply was still running (audit DM-05).
  let chatId=this.chatId;
  if(typeof turnId==='string'&&turnId!==''){
   const turn=this.turnsList.find(t=>t.id===turnId);
   if(turn)chatId=turn.chatId;
  }
  const event:DevEvent={id:++this.eventSeq,at:new Date().toISOString(),kind,chatId,detail:clip(detail,DEV_LIMITS.detailClip)};
  if(typeof turnId==='string'&&turnId!=='')event.turnId=turnId;
  this.eventsList.push(event);
  if(this.eventsList.length>DEV_LIMITS.maxEvents)this.eventsList.shift();
 }

 /** Idempotent: the first end wins. Like toolEnd, closing an already-recorded
  * turn also runs when Developer mode was switched off mid-turn (DM-01). */
 endTurn(turnId:string,outcome:DevTurnOutcome):void{
  const turn=this.turnsList.find(t=>t.id===turnId);
  if(!turn||turn.endedAt!==null)return;
  turn.endedAt=new Date().toISOString();
  turn.ok=outcome.ok;
  if(typeof outcome.reply==='string')turn.reply=clip(outcome.reply,DEV_LIMITS.replyClip);
  if(typeof outcome.error==='string')turn.error=clip(outcome.error,DEV_LIMITS.errorClip);
  turn.latencyMs=num(outcome.latencyMs);
  turn.estimatedOutputTokens=num(outcome.estimatedOutputTokens);
  if(isProvider(outcome.provider))turn.provider=outcome.provider;
  turn.model=clip(outcome.model,256);
  turn.effort=clip(outcome.effort,64);
  turn.attempts=Math.max(1,num(outcome.attempts));
  turn.escalations=num(outcome.escalations);
  turn.retries=num(outcome.retries);
 }

 turns():readonly DevTurn[]{return this.turnsList;}
 events():readonly DevEvent[]{return this.eventsList;}
 currentChatTurns():DevTurn[]{return this.turnsList.filter(t=>t.chatId===this.chatId);}
 currentChatEvents():DevEvent[]{return this.eventsList.filter(e=>e.chatId===this.chatId);}

 counts():{turns:number;toolCalls:number;events:number}{
  return {turns:this.turnsList.length,toolCalls:toolCallCount(this.turnsList),events:this.eventsList.length};
 }

 exportSession(meta:{pluginVersion:string;vaultName:string;history:ChatMessage[]}):DevSessionExport|null{
  if(!this.enabled)return null;
  const currentTurns=this.currentChatTurns();
  if(!currentTurns.length)return null;
  // Error/detail strings can carry provider credentials; redact them on the
  // way out (audit F5). The user's own prompt/reply/result text stays intact.
  const turns=currentTurns.map(turn=>({
   ...turn,
   error:turn.error===null?null:redactSensitive(turn.error),
   toolCalls:turn.toolCalls.map(call=>call.error===undefined?{...call}:{...call,error:redactSensitive(call.error)}),
  }));
  const events=this.currentChatEvents().map(event=>({...event,detail:redactSensitive(event.detail)}));
  const history=meta.history.map(message=>{
   const copy:ChatMessage={...message};
   if(Array.isArray(message.images))copy.images=message.images.map(image=>typeof image==='string'&&/^data:/i.test(image)?`[image data omitted: ${image.length} chars]`:image);
   return copy;
  });
  return {kind:'owla-developer-session',version:1,savedAt:new Date().toISOString(),chatId:this.chatId,pluginVersion:meta.pluginVersion,vaultName:meta.vaultName,history,turns,events,totals:computeDevTotals(turns,events)};
 }

 /** Restores {chatId,turns,events}; a missing/corrupt/oversized file leaves an empty journal, never throws. */
 load(root:string):void{
  this.turnsList=[];this.eventsList=[];this.eventSeq=0;
  const file=join(root,'developer','journal.json');
  let raw:unknown;
  try{
   if(!existsSync(file))return;
   // lstat, not stat: a symlinked journal is never followed (F8 parity with sessions).
   const stats=lstatSync(file);
   if(!stats.isFile()||stats.size>DEV_LIMITS.maxJournalBytes)return;
   raw=JSON.parse(readFileSync(file,'utf8'));
  }catch{return;}
  const top=record(raw);
  if(top.version!==1)return;
  if(typeof top.chatId==='string'&&UUID_PATTERN.test(top.chatId))this.chatId=top.chatId;
  this.turnsList=list(top.turns).map(validateTurn).filter((t):t is DevTurn=>t!==null).slice(-DEV_LIMITS.maxTurns);
  this.eventsList=list(top.events).map(validateEvent).filter((e):e is DevEvent=>e!==null).slice(-DEV_LIMITS.maxEvents);
  this.eventSeq=this.eventsList.reduce((max,e)=>Math.max(max,e.id),0);
 }

 /** No-op when disabled or empty. When the serialized journal exceeds the byte
  * cap, the persisted copy drops oldest turns (then oldest events) until it
  * fits — memory keeps the full rings, disk stays bounded (audit F4/DM-12). */
 save(root:string):void{
  if(!this.enabled||(!this.turnsList.length&&!this.eventsList.length))return;
  let turns=this.turnsList as DevTurn[];
  let events=this.eventsList as DevEvent[];
  const serialize=()=>JSON.stringify({version:1,chatId:this.chatId,turns,events});
  let data=serialize();
  if(Buffer.byteLength(data)>DEV_LIMITS.maxJournalBytes){
   // Per-turn cost measured once (linear), then one exact re-serialization —
   // the routing-history prune pattern; re-stringifying per drop was quadratic.
   const costs=turns.map(turn=>Buffer.byteLength(JSON.stringify(turn))+1);
   let bytes=Buffer.byteLength(data),drop=0;
   while(bytes>DEV_LIMITS.maxJournalBytes&&drop<turns.length-1){bytes-=costs[drop];drop++;}
   turns=turns.slice(drop);
   data=serialize();
   while(Buffer.byteLength(data)>DEV_LIMITS.maxJournalBytes&&events.length>0){
    events=events.slice(Math.ceil(events.length/2));
    data=serialize();
   }
   if(Buffer.byteLength(data)>DEV_LIMITS.maxJournalBytes)return;
  }
  writeAtomic(join(root,'developer','journal.json'),data);
 }

 saveSession(root:string,session:DevSessionExport):SavedDevSessionMeta{
  const data=JSON.stringify(session);
  const bytes=Buffer.byteLength(data);
  if(bytes>DEV_LIMITS.maxSessionBytes)throw Error('This developer session is too large to save.');
  const id=randomUUID();
  writeAtomic(join(root,'developer','sessions',id+'.json'),data);
  this.pruneSessions(join(root,'developer','sessions'),id);
  return {id,savedAt:session.savedAt,chatId:session.chatId,title:sessionTitle(session),turns:session.turns.length,toolCalls:toolCallCount(session.turns),bytes};
 }

 /** Keep the newest maxSavedSessions files by savedAt; unlink older ones
  * best-effort. Bounded against a hostile directory: at most 100 candidates
  * are examined, at most 30 files read, symlinks never followed (F3/F8).
  * The just-written session (keepId) is never evicted and is read first. */
 private pruneSessions(dir:string,keepId?:string):void{
  let files:string[];try{files=readdirSync(dir);}catch{return;}
  let candidates=files.filter(file=>SESSION_FILE_PATTERN.test(file));
  const keepFile=keepId?keepId+'.json':null;
  if(candidates.length>DEV_LIMITS.maxSavedSessions*10){
   // Far more files than retention could ever keep: evict the arbitrary
   // excess without reading anything, then bound the remaining scan.
   const evictable=candidates.filter(file=>file!==keepFile);
   for(const file of evictable.slice(DEV_LIMITS.maxSavedSessions*10)){
    try{unlinkSync(join(dir,file));}catch{/* Best-effort eviction. */}
   }
   candidates=evictable.slice(0,DEV_LIMITS.maxSavedSessions*10);
  }
  if(keepFile){
   // Always scan the just-written session first (the excess-eviction branch
   // above removed it from candidates).
   candidates=[keepFile,...candidates.filter(file=>file!==keepFile)];
  }
  const entries:{file:string;sortKey:number}[]=[];
  let reads=0;
  for(const file of candidates){
   const path=join(dir,file);
   let stats;try{stats=lstatSync(path);}catch{continue;}
   if(stats.isSymbolicLink())continue;
   let sortKey=stats.mtimeMs;
   if(reads<DEV_LIMITS.maxSavedSessions*3&&stats.size<=DEV_LIMITS.maxSessionBytes){
    reads++;
    try{
     const top=record(JSON.parse(readFileSync(path,'utf8')));
     if(typeof top.savedAt==='string'){
      const parsed=Date.parse(top.savedAt);
      if(Number.isFinite(parsed))sortKey=parsed;
     }
    }catch{/* Malformed files fall back to mtime and are evicted first. */}
   }
   entries.push({file:path,sortKey});
  }
  entries.sort((a,b)=>b.sortKey-a.sortKey);
  // The just-written session is kept unconditionally; the next newest fill
  // the remaining slots. An unread hostile file's fresh mtime must never
  // outrank it.
  const keepPath=keepFile?join(dir,keepFile):null;
  // Reserve its slot before sorting: a backwards clock (or future-dated
  // imported file) can put the protected session after every other entry.
  let kept=entries.some(entry=>entry.file===keepPath)?1:0;
  for(const entry of entries){
   if(entry.file===keepPath)continue;
   if(kept<DEV_LIMITS.maxSavedSessions){kept++;continue;}
   try{unlinkSync(entry.file);}catch{/* Best-effort eviction. */}
  }
 }

 listSessions(root:string):SavedDevSessionMeta[]{
  const dir=join(root,'developer','sessions');
  let files:string[];try{files=readdirSync(dir);}catch(error){if(record(error).code==='ENOENT')return [];throw error;}
  const metas:SavedDevSessionMeta[]=[];let reads=0;
  for(const file of files){
   if(!SESSION_FILE_PATTERN.test(file))continue;
   if(reads>=DEV_LIMITS.maxSavedSessions*3)break;
   const path=join(dir,file);
   try{
    const stats=lstatSync(path);
    if(stats.isSymbolicLink()||stats.size>DEV_LIMITS.maxSessionBytes)continue;
    reads++;
    const session=validateSession(JSON.parse(readFileSync(path,'utf8')));
    if(!session)continue;
    metas.push({id:file.slice(0,-5),savedAt:session.savedAt,chatId:session.chatId,title:sessionTitle(session),turns:session.turns.length,toolCalls:toolCallCount(session.turns),bytes:stats.size});
   }catch{/* Ignore malformed or unavailable sessions without blocking the rest. */}
  }
  return metas.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).slice(0,DEV_LIMITS.maxSavedSessions);
 }

 readSession(root:string,id:string):DevSessionExport|null{
  if(!UUID_PATTERN.test(id))return null;
  const path=join(root,'developer','sessions',id+'.json');
  try{
   const stats=lstatSync(path);
   if(stats.isSymbolicLink()||stats.size>DEV_LIMITS.maxSessionBytes)return null;
   return validateSession(JSON.parse(readFileSync(path,'utf8')));
  }catch{return null;}
 }

 removeSession(root:string,id:string):void{
  if(!UUID_PATTERN.test(id))throw Error('Invalid developer session.');
  try{unlinkSync(join(root,'developer','sessions',id+'.json'));}catch{/* Best-effort; a missing file is fine. */}
 }

 /** Resets memory (keeps chatId) and unlinks the journal plus UUID session files; never throws, never recursive. */
 clear(root:string):void{
  this.turnsList=[];this.eventsList=[];this.eventSeq=0;
  const dev=join(root,'developer');
  try{unlinkSync(join(dev,'journal.json'));}catch{/* Best-effort. */}
  const dir=join(dev,'sessions');
  let files:string[];try{files=readdirSync(dir);}catch{files=[];}
  for(const file of files){
   if(!SESSION_FILE_PATTERN.test(file))continue;
   try{unlinkSync(join(dir,file));}catch{/* Best-effort. */}
  }
 }
}
