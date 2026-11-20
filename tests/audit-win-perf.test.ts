// Windows perf pass (round 2): renderPendingEdits coalescing (performance audit 9,
// REVIEW §5.2) and reply sanitize-observer lifecycle (performance audit 8).
// Contract kept from security-main H2: the diff broadcast and split sync stay
// synchronous inside renderPendingEdits; composer state is set synchronously;
// only the card rebuild is coalesced (one microtask per tick) and skipped when
// the signature of everything it reads is unchanged. `pendingSignature=''`
// forces a rebuild (the H2 test resets it).
import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {loadMain} from './helpers/load-main';
import {h} from './helpers/mini-dom';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Butler:any,ButlerView:any,obsidian:any;

/** A controllable window: EventTarget for the diff broadcast plus manual timers. */
const win:any=new EventTarget();
const timers:{fn:()=>void;ms:number;cancelled:boolean}[]=[];
const frames:{fn:()=>void;cancelled:boolean}[]=[];
win.setTimeout=(fn:()=>void,ms:number)=>{timers.push({fn,ms,cancelled:false});return timers.length;};
win.clearTimeout=(id:number)=>{const t=timers[id-1];if(t)t.cancelled=true;};
win.requestAnimationFrame=(fn:()=>void)=>{frames.push({fn,cancelled:false});return frames.length;};
win.cancelAnimationFrame=(id:number)=>{const f=frames[id-1];if(f)f.cancelled=true;};
(globalThis as any).window=win;

/** MutationObserver stand-in: Node has none; callbacks are fired by the test. */
class FakeObserver{
 static all:FakeObserver[]=[];
 callback:()=>void;observed:{target:any;opts:any}[]=[];disconnected=0;
 constructor(callback:()=>void){this.callback=callback;FakeObserver.all.push(this);}
 observe(target:any,opts:any){this.observed.push({target,opts});}
 disconnect(){this.disconnected++;}
}
(globalThis as any).MutationObserver=FakeObserver;

before(async()=>{({Butler,ButlerView,obsidian}=await loadMain());});

/** A recording element: enough DOM for the review-area rebuild, with counters. */
function el(){
 const node:any={empties:0,removed:0,cards:0,children:[] as any[],appended:[] as any[],focused:false,
  empty(){node.empties++;node.children.length=0;},
  remove(){node.removed++;},
  append(...items:any[]){node.appended.push(...items);node.children.push(...items);},
  createDiv(opts?:any){const c=el();node.children.push(c);if(opts==='owla-edit-card'||opts?.cls==='owla-edit-card')node.cards++;return c;},
  createEl(tag:string,opts?:any){const c=el();c.tag=tag;node.children.push(c);return c;},
  querySelector(sel:string){return sel==='button'?{focus(){node.focused=true;}}:null;},
  scrollIntoView(){},
 };
 return node;
}
const batch=(path:string)=>({edit:{path,before:'alpha',after:'ALPHA',reason:'r'},reasons:['r']});
function makeButler(prefs:Record<string,unknown>={}){
 const app={vault:{adapter:{},getName:()=>'V',getMarkdownFiles:()=>[]},workspace:{getLeavesOfType:()=>[]},metadataCache:{resolvedLinks:{},unresolvedLinks:{}}};
 const butler=new Butler(app,{id:'owla-butler',version:'t'});
 butler.app=app;
 Object.assign(butler.prefs,prefs);
 butler.organization={blocked:false,review:undefined,progress:undefined,busy:false,loadError:''};
 return butler;
}
function makeView(butler:any){
 const view=new ButlerView({app:butler.app},butler);
 view.composer={disabled:false,placeholder:''};
 view.sendBtn={disabled:false};
 view.pendingArea=el();
 view.feed=el();
 return view;
}
const flush=()=>new Promise<void>(resolve=>queueMicrotask(resolve));
let broadcasts=0;
win.addEventListener('owla-diff-refresh',()=>{broadcasts++;});

test('coalescing: sequential renderPendingEdits calls rebuild once, composer state stays synchronous',async()=>{
 const butler=makeButler();butler.pending=[batch('A.md')];
 const view=makeView(butler);
 for(let i=0;i<5;i++)view.renderPendingEdits();
 assert.equal(view.composer.disabled,true,'composer is disabled synchronously');
 assert.equal(view.pendingArea.empties,0,'no rebuild before the microtask flush');
 await flush();
 assert.equal(view.pendingArea.empties,1,'five calls coalesce into one rebuild');
 assert.equal(view.pendingArea.cards,1);
});

test('dirty flag: unchanged state skips the rebuild and the editor-wide broadcast',async()=>{
 const butler=makeButler();butler.pending=[batch('A.md')];
 const view=makeView(butler);
 view.renderPendingEdits();await flush();
 const empties=view.pendingArea.empties,before=broadcasts;
 for(let i=0;i<3;i++)view.renderPendingEdits();
 await flush();
 assert.equal(view.pendingArea.empties,empties,'no redundant rebuild');
 assert.equal(broadcasts,before,'no redundant editor-wide diff refresh');
 butler.pending=[...butler.pending,batch('B.md')];
 view.renderPendingEdits();await flush();
 assert.equal(view.pendingArea.empties,empties+1,'a changed pending set rebuilds');
 assert.equal(broadcasts,before+1,'and broadcasts exactly once');
});

test('broadcast gating: a converting-only change rebuilds without waking every editor',async()=>{
 const butler=makeButler();
 const view=makeView(butler);
 view.renderPendingEdits();await flush();
 const before=broadcasts,empties=view.pendingArea.empties;
 view.converting=1;
 view.renderPendingEdits();
 assert.equal(view.composer.placeholder,'Preparing attachments…');
 await flush();
 assert.equal(view.pendingArea.empties,empties+1);
 assert.equal(broadcasts,before,'pending set unchanged: no broadcast');
 view.converting=0;view.renderPendingEdits();await flush();
 assert.equal(view.composer.disabled,false);
});

test('H2 contract: split sync and composer state are synchronous; highlights never syncs',async()=>{
 const butler=makeButler({diffView:'split'});butler.pending=[batch('A.md')];
 let synced=0;butler.syncSplitDiff=()=>{synced++;};
 let splitLeafOpen=false;
 butler.app.workspace.getLeavesOfType=(type:string)=>type==='owla-butler-diff'&&splitLeafOpen?[{}]:[];
 const view=makeView(butler);
 view.renderPendingEdits();
 assert.equal(synced,1,'syncSplitDiff ran synchronously');
 assert.equal(view.composer.disabled,true);
 await flush();
 splitLeafOpen=true;
 view.renderPendingEdits();await flush();
 assert.equal(synced,1,'unchanged pending set with an open split leaf does not re-render it');
 butler.prefs.diffView='highlights';view.pendingSignature='';
 view.renderPendingEdits();await flush();
 assert.equal(synced,1,'highlights mode does not touch the split view');
 assert.equal(view.pendingArea.empties,2,'the signature reset forced a rebuild');
});

test('a closed split leaf is reopened on the next render even without a pending change',async()=>{
 const butler=makeButler({diffView:'split'});butler.pending=[batch('A.md')];
 let synced=0;butler.syncSplitDiff=()=>{synced++;};
 let splitLeafOpen=true;
 butler.app.workspace.getLeavesOfType=(type:string)=>type==='owla-butler-diff'&&splitLeafOpen?[{}]:[];
 const view=makeView(butler);
 view.renderPendingEdits();await flush();
 assert.equal(synced,1);
 splitLeafOpen=false; // the user closed the split view
 view.renderPendingEdits();await flush();
 assert.equal(synced,2,'the missing leaf is restored');
});

test('the rebuild sees the state at flush time, not at queue time',async()=>{
 const butler=makeButler();butler.pending=[batch('A.md')];
 const view=makeView(butler);
 view.renderPendingEdits();
 assert.equal(view.composer.disabled,true);
 butler.pending=[]; // resolved before the microtask ran
 view.renderPendingEdits();
 assert.equal(view.composer.disabled,false,'composer state is synchronous per call');
 await flush();
 assert.equal(view.pendingArea.empties,1,'one rebuild');
 assert.equal(view.pendingArea.removed,1,'it sees the final empty state');
 assert.equal(view.relatedReview,undefined);
});

test('reviewLatest flushes the rebuild synchronously before focusing a plugin card',async()=>{
 const butler=makeButler();
 const view=makeView(butler);
 const change={plugin:'Pinup',label:'Option',path:'x.md',before:'a',after:'b',reason:'r'};
 view.pluginDrafts.set(change,()=>{});
 view.renderPendingEdits();
 assert.equal(view.pendingArea.empties,0,'still queued');
 view.reviewLatest();
 assert.equal(view.pendingArea.empties,1,'flushed synchronously');
 assert.equal(view.pendingArea.focused,true);
 await flush();
 assert.equal(view.pendingArea.empties,1,'the queued microtask does not rebuild twice');
});

test('a closed view never rebuilds',async()=>{
 const butler=makeButler();butler.pending=[batch('A.md')];
 const view=makeView(butler);
 view.closing=true;
 view.renderPendingEdits();await flush();
 assert.equal(view.pendingArea.empties,0);
});

// ---------------------------------------------------------------- reply sanitize observers

/** A view with the furniture newChat() touches, plus captured register cleanups. */
function replyView(){
 const butler=makeButler();
 const view=makeView(butler);
 const cleanups:(()=>void)[]=[];
 view.register=(cb:()=>void)=>{cleanups.push(cb);};
 view.automaticLabel={setText(){}};
 view.chips=el();
 view.status={setText(){}};
 view.feed.querySelector=()=>null;
 return {view,cleanups};
}
function replyContent(){
 const content:any=h('div');
 content.addEventListener=()=>{};
 content.on=()=>{};
 return content;
}
function inject(content:any,tag:string){
 const node=h(tag,{},'x');
 node.parentElement=content;
 content.children.push(node);
 return node;
}

test('renderReply coalesces late mutations into one sanitize pass per frame',async()=>{
 win.requestAnimationFrame=(fn:()=>void)=>{frames.push({fn,cancelled:false});return frames.length;};
 const {view}=replyView();
 const content=replyContent();
 await (view as any).renderReply(content,'hello');
 const observer=FakeObserver.all.at(-1)!;
 assert.equal(observer.observed.length,1);
 assert.deepEqual(observer.observed[0].opts,{childList:true,subtree:true,attributes:true,characterData:true});
 inject(content,'script'); // late MathJax/Mermaid-style injection
 const scheduled=frames.length;
 for(let i=0;i<5;i++)observer.callback();
 assert.equal(frames.length,scheduled+1,'five mutation batches schedule one frame');
 frames.at(-1)!.fn();
 assert.ok(!content.tags().includes('script'),'the coalesced pass sanitizes the late injection');
 inject(content,'iframe');
 observer.callback();
 assert.equal(frames.length,scheduled+2,'a later mutation is still caught');
 frames.at(-1)!.fn();
 assert.ok(!content.tags().includes('iframe'));
});

test('renderReply falls back to one window.setTimeout when rAF is unavailable',async()=>{
 const savedRaf=win.requestAnimationFrame;
 win.requestAnimationFrame=undefined;
 try{
  const {view,cleanups}=replyView();
  const content=replyContent();
  await (view as any).renderReply(content,'hello');
  const observer=FakeObserver.all.at(-1)!;
  inject(content,'script');
  const scheduled=timers.length;
  for(let i=0;i<4;i++)observer.callback();
  assert.equal(timers.length,scheduled+1,'one timer for four batches');
  assert.equal(timers.at(-1)!.ms,16);
  timers.at(-1)!.fn();
  assert.ok(!content.tags().includes('script'));
  // Unload cleanup cancels a pending timer and disconnects.
  inject(content,'iframe');
  observer.callback();
  const pending=timers.at(-1)!;
  for(const cleanup of cleanups)cleanup();
  assert.equal(pending.cancelled,true,'pending timer cancelled on unload');
  assert.ok(observer.disconnected>=1);
 }finally{win.requestAnimationFrame=savedRaf;}
});

test('newChat disconnects reply observers so detached reply DOM is not retained',async()=>{
 win.requestAnimationFrame=(fn:()=>void)=>{frames.push({fn,cancelled:false});return frames.length;};
 const {view,cleanups}=replyView();
 const first=replyContent(),second=replyContent();
 await (view as any).renderReply(first,'one');
 await (view as any).renderReply(second,'two');
 const observers=FakeObserver.all.slice(-2);
 assert.equal(view.replyStops.size,2);
 assert.equal(view.newChat(),true);
 assert.ok(observers.every(o=>o.disconnected>=1),'both observers disconnected on newChat');
 assert.equal(view.replyStops.size,0);
 // One view-level cleanup, not one closure per reply: a per-reply registration
 // would keep each stopObserving (and its observer + reply content) reachable
 // until the view closes, even after the feed was cleared and disconnected.
 assert.equal(cleanups.length,1,'a single view-level cleanup is registered');
 for(const cleanup of cleanups)cleanup();
 assert.ok(observers.every(o=>o.disconnected>=1),'the unload cleanup is idempotent after the discard');
});

test('unload cleanup cancels a pending animation frame and disconnects',async()=>{
 win.requestAnimationFrame=(fn:()=>void)=>{frames.push({fn,cancelled:false});return frames.length;};
 const {view,cleanups}=replyView();
 const content=replyContent();
 await (view as any).renderReply(content,'hello');
 const observer=FakeObserver.all.at(-1)!;
 inject(content,'script');
 observer.callback();
 const pending=frames.at(-1)!;
 for(const cleanup of cleanups)cleanup();
 assert.equal(pending.cancelled,true);
 assert.ok(observer.disconnected>=1);
 assert.equal(view.replyStops.size,0);
});
