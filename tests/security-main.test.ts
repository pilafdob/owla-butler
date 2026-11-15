// Regression tests for the 3.3.0 security fixes that live in main.ts (Butler / ButlerView)
// and organization.ts. Both import `obsidian` at runtime, so they are loaded through
// tests/helpers/load-main.ts, which stands in test-only stubs for `obsidian` and `electron`.
// Finding IDs refer to review-33.md, review-33-rereview.md and review-33-third.md.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {linkSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */

let Butler:any,ButlerView:any,obsidian:any,Organization:any;
let scratch:string,vault:string,outside:string;

/** A DOM stand-in: every property is a callable that returns another stand-in, and writes stick. */
function fakeEl():any{
 const store:Record<PropertyKey,unknown>={};
 const fn=()=>proxy;
 const proxy:any=new Proxy(fn,{
  get:(_t,key)=>key in store?store[key]:key===Symbol.toPrimitive?()=>'':key==='then'?undefined:fn,
  set:(_t,key,value)=>{store[key]=value;return true;},
 });
 return proxy;
}

before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 ({Organization}=await import('../src/organization'));
 scratch=mkdtempSync(join(tmpdir(),'owla-security-main-'));
 vault=join(scratch,'Vault');outside=join(scratch,'Outside');
 for(const dir of ['Notes','Projects/Sub','Archive','Private','Linked'])mkdirSync(join(vault,dir),{recursive:true});
 mkdirSync(outside);
 writeFileSync(join(vault,'Notes/A.md'),'alpha bravo');
 writeFileSync(join(vault,'Notes/B.md'),'charlie bravo');
 writeFileSync(join(vault,'Projects/P.md'),'bravo project');
 writeFileSync(join(vault,'Projects/Sub/S.md'),'sub');
 writeFileSync(join(vault,'Private/Secret.md'),'bravo secret');
 writeFileSync(join(outside,'target.md'),'outside');
 // A hard link into the vault aliases a file outside it.
 linkSync(join(outside,'target.md'),join(vault,'Linked/Hard.md'));
 // A symbolic link inside the vault whose target is that hard-linked file.
 symlinkSync(join(vault,'Linked/Hard.md'),join(vault,'Notes/ToHard.md'));
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});

function TFileOf(path:string,size=10){const file=new obsidian.TFile(path);file.stat={size};return file;}
function makeApp({files=[] as string[],texts={} as Record<string,string>,folders=[] as string[],leaves=[] as any[],active=null as any,activeFile=null as any}={}){
 const fileMap=new Map(files.map(path=>[path,TFileOf(path)]));
 const folderMap=new Map(folders.map(path=>[path,new obsidian.TFolder(path)]));
 return {
  vault:{
   adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',
   getMarkdownFiles:()=>[...fileMap.values()].filter(f=>f.extension==='md'),getFiles:()=>[...fileMap.values()],
   getAllFolders:()=>[...folderMap.values()],getFolderByPath:(p:string)=>folderMap.get(p)??null,getFileByPath:(p:string)=>fileMap.get(p)??null,
   getAbstractFileByPath:(p:string)=>fileMap.get(p)??folderMap.get(p)??null,
   cachedRead:async(f:any)=>texts[f.path]??'',read:async(f:any)=>texts[f.path]??'',
  },
  workspace:{getLeavesOfType:(type:string)=>type==='markdown'?leaves:[],getActiveViewOfType:()=>active,getActiveFile:()=>activeFile},
  metadataCache:{resolvedLinks:{},getFileCache:()=>({})},
 };
}
function makeButler(app:any=makeApp(),prefs:Record<string,unknown>={}){
 const butler=new Butler(app,{id:'owla-butler',version:'test'});
 butler.app=app;
 Object.assign(butler.prefs,{storageRoot:join(scratch,'storage'),...prefs});
 return butler;
}

// ---------------------------------------------------------------- C2 (+L4): nlink check

test('C2: vault folders pass the vault-file check and hard-linked files do not',()=>{
 const butler=makeButler(makeApp(),{excludedFolders:'Private'});
 for(const folder of ['Notes','Projects','Projects/Sub','Archive'])assert.equal(butler.allowedVaultFile(folder),true,folder);
 assert.equal(butler.allowedVaultFile('Notes/A.md','md'),true);
 assert.equal(butler.allowedNote('Notes/A.md'),true);
 assert.equal(butler.allowedNote('Linked/Hard.md'),false,'hard-linked file');
 assert.equal(butler.allowedVaultFile('Linked/Hard.md'),false,'hard-linked file without extension filter');
 // L4: the check follows symbolic links, so a link to a hard-linked file is refused too.
 assert.equal(butler.allowedNote('Notes/ToHard.md'),false,'symlink to hard-linked file');
 assert.equal(butler.allowedVaultFile('Private'),false,'excluded folder');
 assert.equal(butler.allowedNote('Private/Secret.md'),false,'excluded note');
});

function organizationFor(butler:any){
 const app=butler.app;
 return new Organization(app,()=>join(scratch,'org-storage'),()=>vault,(path:string)=>butler.allowedVaultFile(path),()=>butler.prefs.excludedFolders,()=>true,()=>true,async(path:string)=>app.vault.read(app.vault.getFileByPath(path)),async()=>{});
}
const orgApp=()=>makeApp({files:['Notes/A.md','Notes/B.md','Projects/P.md','Projects/Sub/S.md','Linked/Hard.md'],folders:['Notes','Projects','Projects/Sub','Archive','Linked']});

test('C2: organization moves of folders and normal files into existing folders are allowed',async()=>{
 const org=organizationFor(makeButler(orgApp()));
 const folderMove=await org.preview([{from:'Projects',to:'Archive/Projects'}],'Archive projects');
 assert.deepEqual(folderMove.moves,[{from:'Projects',to:'Archive/Projects'}]);
 const fileMove=await org.preview([{from:'Notes/A.md',to:'Archive/A.md'}],'Archive a note');
 assert.deepEqual(fileMove.moves,[{from:'Notes/A.md',to:'Archive/A.md'}]);
 const nested=await org.preview([{from:'Notes/B.md',to:'Projects/Sub/B.md'}],'Into a nested folder');
 assert.deepEqual(nested.folders,[]);
});

test('C2: organization still refuses to move a hard-linked file or a folder that contains one',async()=>{
 const org=organizationFor(makeButler(orgApp()));
 await assert.rejects(org.preview([{from:'Linked/Hard.md',to:'Archive/Hard.md'}],'move'),/excluded or uses a symbolic link/);
 await assert.rejects(org.preview([{from:'Linked',to:'Archive/Linked'}],'move'),/hard-linked/);
});

// ---------------------------------------------------------------- H1: capture() and the active note

function markdownLeaf(path:string,text:string){
 const view=new obsidian.MarkdownView({});
 view.file=new obsidian.TFile(path);
 view.editor={getValue:()=>text,getCursor:()=>({line:0,ch:0}),posToOffset:()=>0};
 return {view};
}

test('H1: the first capture() after the sidebar takes focus still returns the last active note',()=>{
 const leaf=markdownLeaf('Notes/A.md','alpha bravo');
 const app=makeApp({leaves:[leaf],active:null});
 const butler=makeButler(app);
 butler.last=leaf.view; // set by active-leaf-change before the OWLA sidebar took focus
 const captured=butler.capture();
 assert.equal(captured?.path,'Notes/A.md');
 assert.equal(captured?.text,'alpha bravo');
});

test('H1: capture() survives a layout change that adds a leaf',()=>{
 const first=markdownLeaf('Notes/A.md','alpha'),second=markdownLeaf('Notes/B.md','charlie');
 const leaves=[first];
 const butler=makeButler(makeApp({leaves,active:null}));
 butler.last=first.view;
 assert.equal(butler.capture()?.path,'Notes/A.md');
 leaves.push(second); // e.g. opening the OWLA sidebar or another note
 butler.last=second.view;
 assert.equal(butler.capture()?.path,'Notes/B.md');
});

test('H1: capture() falls back to the active file when the remembered view was closed',()=>{
 const open=markdownLeaf('Notes/B.md','charlie'),closed=markdownLeaf('Notes/A.md','alpha');
 const butler=makeButler(makeApp({leaves:[open],active:null,activeFile:{path:'Notes/B.md'}}));
 butler.last=closed.view;
 assert.equal(butler.capture()?.path,'Notes/B.md');
});

// ---------------------------------------------------------------- H2: split diff auto-open

const pendingBatch={edit:{path:'Notes/A.md',before:'alpha',after:'ALPHA',reason:'r'},reasons:['r']};

test('H2: syncSplitDiff opens the split diff view when a proposal arrives and none is open',async()=>{
 const target=markdownLeaf('Notes/A.md','alpha');
 const created:any[]=[];
 const app=makeApp({leaves:[target]});
 app.workspace.getLeavesOfType=(type:string)=>type==='markdown'?[target]:[];
 (app.workspace as any).createLeafBySplit=(from:any,direction:string)=>{
  const leaf={from,direction,state:null as any,view:{render:()=>{leaf.rendered=true;}},rendered:false,setViewState:async(state:any)=>{leaf.state=state;}};
  created.push(leaf);return leaf;
 };
 const butler=makeButler(app,{diffView:'split'});
 butler.pending=[pendingBatch];butler.last=target.view;
 butler.syncSplitDiff();
 await butler.splitSync;
 assert.equal(created.length,1);
 assert.equal(created[0].from,target);
 assert.equal(created[0].state.type,'owla-butler-diff');
 assert.equal(created[0].rendered,true);
});

test('H2: renderPendingEdits syncs the split view whenever Diff view is Split, even with no split leaf open',()=>{
 const butler=makeButler(makeApp(),{diffView:'split'});
 butler.pending=[pendingBatch];
 butler.organization={blocked:false,review:undefined,progress:undefined,busy:false};
 let synced=0;butler.syncSplitDiff=()=>{synced++;};
 const view=new ButlerView({app:butler.app},butler);
 const stop=Symbol('stop');
 // Everything after the sync call is DOM work; stop there.
 view.composer={set disabled(_v:boolean){throw stop;}};
 (globalThis as any).window??=new EventTarget();
 assert.throws(()=>view.renderPendingEdits(),(e:unknown)=>e===stop);
 assert.equal(synced,1);
 // Highlights mode does not touch the split view.
 butler.prefs.diffView='highlights';view.pendingEditsSignature='';
 assert.throws(()=>view.renderPendingEdits(),(e:unknown)=>e===stop);
 assert.equal(synced,1);
});

// ---------------------------------------------------------------- H3: web-search consent

function viewFor(prefs:Record<string,unknown>={}){
 const butler=makeButler(makeApp(),{webSearch:true,...prefs});
 butler.organization={blocked:false};
 const view=new ButlerView({app:butler.app},butler);
 return {butler,view};
}

test('H3: without a consent decision web search is off for the turn, whatever the context',()=>{
 const {view}=viewFor();
 assert.equal(view.effectiveWebSearch(),false);
 view.webSearchTurnConsent=true;               // Allow once
 assert.equal(view.effectiveWebSearch(),true);
 view.webSearchTurnConsent=false;view.webSearchChatConsent=true;  // Allow for chat
 assert.equal(view.effectiveWebSearch(),true);
 view.webSearchChatConsent=false;view.webSearchTurnConsent=true;  // Don't search wins over a stale once
 assert.equal(view.effectiveWebSearch(),false);
 const off=viewFor({webSearch:false}).view;off.webSearchChatConsent=true;off.webSearchTurnConsent=true;
 assert.equal(off.effectiveWebSearch(),false,'the setting stays the upper bound');
});

test('H3: the consent bar is shown whenever web search is on and no decision is made',()=>{
 const {view,butler}=viewFor();
 let hidden:boolean|undefined;
 view.webSearchConsentBar={toggleClass:(cls:string,value:boolean)=>{assert.equal(cls,'owla-hidden');hidden=value;}};
 view.renderWebSearchConsent();assert.equal(hidden,false);
 view.webSearchTurnConsent=true;view.renderWebSearchConsent();assert.equal(hidden,true,'Allow once hides the bar');
 view.webSearchTurnConsent=false;view.webSearchChatConsent=true;view.renderWebSearchConsent();assert.equal(hidden,true);
 view.webSearchChatConsent=false;view.renderWebSearchConsent();assert.equal(hidden,true);
 view.webSearchChatConsent=null;butler.prefs.webSearch=false;view.renderWebSearchConsent();assert.equal(hidden,true);
});

function domView(){
 const {view,butler}=viewFor();
 for(const key of ['feed','composer','status','automaticLabel','chips','pendingArea','sendBtn','modelLabel','effortSelect','connectButton'])view[key]=fakeEl();
 view.renderAttachments=()=>{};
 return {view,butler};
}

test('H3: a new chat resets the chat consent and any pending one-off consent',()=>{
 const {view}=domView();
 view.webSearchChatConsent=true;view.webSearchTurnConsent=true;
 assert.notEqual(view.newChat(),false);
 assert.equal(view.webSearchChatConsent,null);
 assert.equal(view.webSearchTurnConsent,false);
 assert.equal(view.effectiveWebSearch(),false);
});

test('H3: restoring a saved chat resets the chat consent',async()=>{
 const {view}=domView();
 const opened:any[]=[];
 const original=obsidian.FuzzySuggestModal.prototype.open;
 obsidian.FuzzySuggestModal.prototype.open=function(this:any){opened.push(this);};
 try{
  const chat={id:'c',title:'Saved',created:Date.now(),messages:[{role:'user',content:'hello'}]};
  view.chatStore=()=>({list:()=>[chat]});
  view.userMessage=()=>{};
  view.webSearchChatConsent=true;
  view.openSavedChat();
  assert.equal(opened.length,1);
  view.webSearchChatConsent=true; // granted again while the picker is open
  await opened[0].accept(chat);
  assert.equal(view.webSearchChatConsent,null);
  assert.equal(view.effectiveWebSearch(),false);
 }finally{obsidian.FuzzySuggestModal.prototype.open=original;}
});

// ---------------------------------------------------------------- H4: effective web flag reaches every connect

test('H4: Butler.connect and automaticOffers hand the effective web flag to the bridge, not the setting',async()=>{
 const butler=makeButler(makeApp(),{webSearch:true,codexConnected:true,opencodeConnected:true,claudeConnected:true,automaticProvider:true});
 const keys:{provider:string;web:boolean}[]=[];
 for(const provider of ['codex','opencode','claude']){
  const bridge=butler.bridgeFor(provider);
  bridge.connect=async(_exe:string,_dir:string,web:boolean)=>{keys.push({provider,web});};
  bridge.hold=()=>async()=>{};
  bridge.accountType='chatgpt';
  Object.defineProperty(bridge,'selectableModels',{value:[],configurable:true});
 }
 butler.automaticCandidates=()=>['codex','opencode'];
 butler.exhaustionOf=()=>({exhausted:false});
 await butler.connect({keepAlive:true,automatic:true,provider:'codex',tools:[],web:false});
 assert.deepEqual(keys,[{provider:'codex',web:false}]);
 keys.length=0;
 await butler.automaticOffers([],false);
 assert.deepEqual(keys.sort((a,b)=>a.provider.localeCompare(b.provider)),[{provider:'codex',web:false},{provider:'opencode',web:false}]);
});

function connectRecorder(view:any,butler:any){
 const calls:any[]=[];
 butler.connect=async(options:any)=>{calls.push(options);};
 return calls;
}

test('H4: the typing warm-up connects with the consent-adjusted web flag',async()=>{
 const {view,butler}=viewFor({codexConnected:true});
 const calls=connectRecorder(view,butler);
 Object.defineProperty(butler,'bridge',{value:{hold:()=>async()=>{}},configurable:true});
 const doc={activeElement:null as any};
 view.composer={value:'hello',ownerDocument:doc};doc.activeElement=view.composer;
 for(const [chat,once,expected] of [[null,false,false],[null,true,true],[true,false,true],[false,true,false]] as const){
  view.clearWarmup();calls.length=0;
  view.webSearchChatConsent=chat;view.webSearchTurnConsent=once;
  view.scheduleWarmup();
  await new Promise(resolve=>setTimeout(resolve,320));
  assert.equal(calls.length,1,`warm-up ran for ${chat}/${once}`);
  assert.equal(calls[0].web,expected,`warm-up web for ${chat}/${once}`);
 }
 view.clearWarmup();
});

test('H4: the Automatic-provider override picker collects offers with the effective web flag',async()=>{
 const {view,butler}=viewFor({automaticProvider:true});
 let offeredWeb:boolean|undefined;
 butler.buildToolSpecs=()=>({specs:[]});
 butler.automaticOffers=async(_specs:unknown,web:boolean)=>{offeredWeb=web;return {offers:[],failed:[]};};
 Object.defineProperty(butler,'automaticModels',{value:false,configurable:true}); // stop right after the offers
 await view.chooseNextRoute();
 assert.equal(offeredWeb,false);
 view.webSearchChatConsent=true;
 await view.chooseNextRoute();
 assert.equal(offeredWeb,true);
});

test('H4: a usage fallback connects the fallback provider with the effective web flag',async()=>{
 const {view,butler}=viewFor({fallback:'opencode',opencodeConnected:true});
 const calls=connectRecorder(view,butler);
 butler.recordExhaustion=(provider:string)=>({exhausted:provider==='codex'});
 butler.exhaustionOf=()=>({exhausted:false});
 const opencode=butler.bridgeFor('opencode');Object.defineProperty(opencode,'selectableModels',{value:[],configurable:true});
 const opts={provider:'codex',route:{model:'m',effort:'low'},choosesProvider:false,offers:[],task:undefined,candidates:[],home:'codex',needsImage:false,failed:[],specs:[],signal:new AbortController().signal};
 assert.equal(await view.pickRetryRoute(opts),null);
 assert.equal(calls.length,1);
 assert.equal(calls[0].provider,'opencode');
 assert.equal(calls[0].web,false);
 view.webSearchTurnConsent=true;calls.length=0;
 await view.pickRetryRoute(opts);
 assert.equal(calls[0].web,true);
});

test('H4 (static): every keep-alive connect in the send/escalation/retry path passes the turn web flag',()=>{
 // send() is not callable without the full view DOM, so its connects are checked in the source.
 const source=readFileSync(join(__dirname,'../src/main.ts'),'utf8');
 const start=source.indexOf('const baseWeb=this.butler.prefs.webSearch;');
 const end=source.indexOf(' private async pickRetryRoute(');
 assert.ok(start>0&&end>start,'send() markers moved; update this test');
 const send=source.slice(start,end);
 const connects=[...send.matchAll(/this\.butler\.connect\(\{([^}]*)\}\)/g)].map(m=>m[1]);
 assert.ok(connects.length>=5,'expected the turn, run, escalation and retry connects');
 for(const args of connects)assert.match(args,/(^|,)web(:|,|$)/,args);
 const offers=send.split('this.butler.automaticOffers(').length-1;
 assert.ok(offers>=1,'expected the Automatic-provider offers in send()');
 assert.equal(send.split('this.butler.automaticOffers(specs,this.effectiveWebSearch())').length-1,offers);
});

// ---------------------------------------------------------------- M2: pending-edit load failure and recovery

function writePending(butler:any,records:unknown[]){
 const dir=butler.vaultStorage();mkdirSync(dir,{recursive:true});
 const file=join(dir,'pending-edits.json');writeFileSync(file,JSON.stringify(records));return file;
}
const records=[
 {edit:{path:'Notes/A.md',before:'alpha',after:'ALPHA',reason:'r'},reasons:['r']},
 {edit:{path:'Private/Secret.md',before:'secret',after:'SECRET',reason:'r'},reasons:['r']},
];

test('M2: a pending record that cannot be loaded surfaces an error and blocks review',async()=>{
 const butler=makeButler(makeApp(),{excludedFolders:'Private'});
 const file=writePending(butler,records);
 // Run onload up to the view registration with the settings already in memory.
 const stop=Symbol('stop');
 Object.assign(butler,{loadData:async()=>({...butler.prefs}),saveData:async()=>{},registerEditorExtension:()=>{},registerView:()=>{throw stop;}});
 await assert.rejects(butler.onload(),(e:unknown)=>e===stop);
 assert.match(butler.pendingLoadError,/no longer allowed: Private\/Secret\.md/);
 assert.equal(butler.reviewBlocked,true);
 await assert.rejects(butler.applyProvisional({edit:{path:'Notes/B.md',before:'c',after:'d',reason:'r'},reasons:['r']}),/Resolve the pending changes/);
 const view=new ButlerView({app:butler.app},butler);
 assert.equal(view.awaitingReview,true);
 assert.ok(existsSync(file),'the record is kept until the user decides');
});

test('M2: clearing the pending record asks first and changes nothing when declined',async()=>{
 const butler=makeButler(makeApp(),{excludedFolders:'Private'});
 butler.organization={blocked:false};
 const file=writePending(butler,records);
 butler.pendingLoadError='A pending edit path is no longer allowed: Private/Secret.md';
 const restored:any[]=[];butler.restoreEdit=async(p:any)=>{restored.push(p);};
 const prompts:string[]=[];
 (globalThis as any).window??=new EventTarget();
 (globalThis as any).window.confirm=(message:string)=>{prompts.push(message);return false;};
 await butler.clearPendingEdits();
 assert.equal(prompts.length,1);
 assert.ok(existsSync(file));
 assert.equal(restored.length,0);
 assert.equal(butler.reviewBlocked,true);
});

// ---------------------------------------------------------------- R7: clear-record restore (real write path)

/** A Butler whose notes live in memory; restoreEdit/writeEdit run unmodified against them. */
function restoreFixture(texts:Record<string,string>,pending:unknown[]){
 const app=makeApp({files:Object.keys(texts),texts});
 const writes:{path:string;text:string}[]=[];
 (app.vault as any).process=async(file:any,change:(current:string)=>string)=>{const next=change(texts[file.path]);texts[file.path]=next;writes.push({path:file.path,text:next});return next;};
 const butler=makeButler(app,{excludedFolders:'Private'});
 butler.organization={blocked:false};
 const file=writePending(butler,pending);
 butler.pendingLoadError='A pending edit path is no longer allowed: Private/Secret.md';
 (globalThis as any).window??=new EventTarget();
 (globalThis as any).window.confirm=()=>true;
 return {butler,file,texts,writes};
}
const applied=(path:string,before:string,after:string,extra:Record<string,unknown>={})=>({edit:{path,before,after,reason:'r',...extra},reasons:['r']});

test('R7: confirming the clear restores a provisionally applied edit to its original text, exactly once',async()=>{
 const {butler,file,texts,writes}=restoreFixture({'Notes/A.md':'ALPHA (AI)','Notes/B.md':'CHARLIE (AI)'},[applied('Notes/A.md','alpha','ALPHA (AI)'),applied('Notes/B.md','charlie','CHARLIE (AI)')]);
 await butler.clearPendingEdits();
 assert.equal(texts['Notes/A.md'],'alpha');
 assert.equal(texts['Notes/B.md'],'charlie');
 assert.deepEqual(writes.map(w=>w.path).sort(),['Notes/A.md','Notes/B.md'],'each note written once');
 assert.equal(existsSync(file),false);
 assert.equal(butler.pendingLoadError,'');
 assert.equal(butler.reviewBlocked,false);
});

test('R7: a note already at its original text is left untouched, so unaccepted AI text is never written',async()=>{
 const {butler,file,texts,writes}=restoreFixture({'Notes/A.md':'alpha'},[applied('Notes/A.md','alpha','ALPHA (AI)')]);
 await butler.clearPendingEdits();
 assert.equal(texts['Notes/A.md'],'alpha');
 assert.deepEqual(writes,[]);
 assert.equal(existsSync(file),false);
 assert.equal(butler.reviewBlocked,false);
});

test('R7: deferred and new-note records were never applied and are not written',async()=>{
 const {butler,texts,writes}=restoreFixture({'Notes/A.md':'alpha','Notes/B.md':''},[{...applied('Notes/A.md','alpha','ALPHA (AI)'),deferred:true},applied('Notes/B.md','','new note (AI)',{create:true})]);
 await butler.clearPendingEdits();
 assert.equal(texts['Notes/A.md'],'alpha');
 assert.equal(texts['Notes/B.md'],'');
 assert.deepEqual(writes,[]);
});

test('R7: when a restore fails the record is kept and review stays blocked',async()=>{
 // The user edited the note after the proposal: neither the original nor the AI text is current.
 const {butler,file,texts,writes}=restoreFixture({'Notes/A.md':'user rewrote this','Notes/B.md':'CHARLIE (AI)'},[applied('Notes/A.md','alpha','ALPHA (AI)'),applied('Notes/B.md','charlie','CHARLIE (AI)')]);
 await butler.clearPendingEdits();
 assert.equal(texts['Notes/A.md'],'user rewrote this');
 assert.ok(existsSync(file),'record kept');
 const kept=JSON.parse(readFileSync(file,'utf8'));
 assert.deepEqual(kept.map((r:any)=>r.edit.path),['Notes/A.md']);
 assert.notEqual(butler.pendingLoadError,'');
 assert.equal(butler.reviewBlocked,true);
 assert.equal(texts['Notes/B.md'],'charlie','the restorable note is still restored');
 assert.deepEqual(writes.map(w=>w.path),['Notes/B.md']);
});

test('R7: excluded notes are not changed by the clear',async()=>{
 const {butler,texts,writes}=restoreFixture({'Notes/A.md':'ALPHA (AI)','Private/Secret.md':'SECRET (AI)'},[applied('Notes/A.md','alpha','ALPHA (AI)'),applied('Private/Secret.md','secret','SECRET (AI)')]);
 await butler.clearPendingEdits();
 assert.equal(texts['Private/Secret.md'],'SECRET (AI)');
 assert.deepEqual(writes.map(w=>w.path),['Notes/A.md']);
});

// ---------------------------------------------------------------- R1: search_vault scope

function searchView(){
 const files=['Notes/A.md','Notes/B.md','Projects/P.md','Projects/Sub/S.md','Private/Secret.md','Linked/Hard.md'];
 const texts:Record<string,string>={'Notes/A.md':'alpha bravo','Notes/B.md':'charlie bravo','Projects/P.md':'bravo project','Projects/Sub/S.md':'bravo sub','Private/Secret.md':'bravo secret','Linked/Hard.md':'bravo hard'};
 const app=makeApp({files,texts,folders:['Notes','Projects','Projects/Sub','Private','Linked']});
 const butler=makeButler(app,{excludedFolders:'Private'});
 const view=new ButlerView({app},butler);
 const tool=view.tool.bind(view);
 view.tool=async(name:string,args:unknown,...rest:unknown[])=>name==='read_note'?'text of '+(args as {path:string}).path:tool(name,args,...rest);
 return async(args:Record<string,unknown>)=>JSON.parse(await view.tool('search_vault',args,fakeEl())).matches.sort();
}

test('R1: search_vault without a folder searches every allowed note',async()=>{
 const search=searchView();
 assert.deepEqual(await search({query:'bravo'}),['Notes/A.md','Notes/B.md','Projects/P.md','Projects/Sub/S.md']);
 assert.deepEqual(await search({query:'bravo',folder:''}),['Notes/A.md','Notes/B.md','Projects/P.md','Projects/Sub/S.md']);
});

test('R1: search_vault with a folder stays inside that folder',async()=>{
 const search=searchView();
 assert.deepEqual(await search({query:'bravo',folder:'Notes'}),['Notes/A.md','Notes/B.md']);
 assert.deepEqual(await search({query:'bravo',folder:'Projects/Sub'}),['Projects/Sub/S.md']);
});

test('R1: excluded and hard-linked notes stay out of search results',async()=>{
 const search=searchView();
 const all=await search({query:'secret'});
 assert.deepEqual(all,[]);
 assert.ok(!(await search({query:'hard'})).includes('Linked/Hard.md'));
 await assert.rejects(search({query:'bravo',folder:'Private'}),/allowed vault folder/);
 await assert.rejects(search({query:'bravo',folder:'Missing'}),/allowed vault folder/);
});

// ---------------------------------------------------------------- H5: pre-send provider indicator

function indicatorView(prefs:Record<string,unknown>={}){
 const {view,butler}=domView();
 Object.assign(butler.prefs,{automaticProvider:false,automaticRouting:false,...prefs});
 const shown:string[]=[];
 view.providerIndicator={setText:(text:string)=>{shown.push(text);}};
 view.renderConnection=()=>{};
 butler.view=view;
 Object.assign(butler,{loadData:async()=>({}),saveData:async()=>{}});
 return {view,butler,shown,text:()=>shown.at(-1)};
}
const setAutomatic=(butler:any,value:boolean)=>Object.defineProperty(butler,'automaticModels',{value,configurable:true});

test('H5: in manual mode the indicator names the selected provider before Send',()=>{
 for(const [provider,name] of [['codex','Codex'],['opencode','OpenCode'],['claude','Claude Code']]){
  const {view,butler,text}=indicatorView({provider});
  setAutomatic(butler,false);
  view.refreshModel();
  assert.equal(text(),name);
 }
});

test('H5: the manual-mode indicator follows a provider change and an active fallback',async()=>{
 const {butler,text}=indicatorView({provider:'codex'});
 setAutomatic(butler,false);
 await butler.useProvider('opencode');
 assert.equal(text(),'OpenCode');
 butler.fallbackProvider='claude';
 butler.view.refreshModel();
 assert.equal(text(),'Claude Code');
});

test('H5: in automatic mode the indicator shows a one-message override, or that the route is chosen at send',()=>{
 const {view,butler,text}=indicatorView({automaticProvider:true});
 setAutomatic(butler,true);
 view.refreshModel();
 assert.equal(text(),'Automatic selection · choosing at send');
 view.nextRoute={provider:'opencode',model:'opencode/model-x',effort:'low'};
 view.refreshModel();
 assert.equal(text(),'OpenCode · opencode/model-x');
 // Showing lastAutomaticRoute as the upcoming route is a known, deferred Medium follow-up (review-33-fifth.md).
});


test('H5: after a new chat the manual-mode indicator still names the provider',()=>{
 const {view,butler,text}=indicatorView({provider:'opencode'});
 setAutomatic(butler,false);
 view.refreshModel();
 assert.equal(text(),'OpenCode');
 assert.notEqual(view.newChat(),false);
 assert.equal(text(),'OpenCode');
});

test('H5: after a new chat in automatic mode the indicator drops the old route',()=>{
 const {view,butler,text}=indicatorView({automaticProvider:true});
 setAutomatic(butler,true);
 view.nextRoute={provider:'opencode',model:'opencode/model-x',effort:'low'};
 view.refreshModel();
 assert.equal(text(),'OpenCode · opencode/model-x');
 view.newChat();
 assert.equal(text(),'Automatic selection · choosing at send');
});

test('H5: after restoring a saved chat the manual-mode indicator still names the provider',async()=>{
 const {view,butler,text}=indicatorView({provider:'claude'});
 setAutomatic(butler,false);
 view.refreshModel();
 assert.equal(text(),'Claude Code');
 const opened:any[]=[];
 const original=obsidian.FuzzySuggestModal.prototype.open;
 obsidian.FuzzySuggestModal.prototype.open=function(this:any){opened.push(this);};
 try{
  const chat={id:'c',title:'Saved',created:Date.now(),messages:[{role:'user',content:'hello'}]};
  view.chatStore=()=>({list:()=>[chat]});
  view.userMessage=()=>{};
  view.openSavedChat();
  await opened[0].accept(chat);
  assert.equal(text(),'Claude Code');
 }finally{obsidian.FuzzySuggestModal.prototype.open=original;}
});
