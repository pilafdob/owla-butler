// Regression tests for main.ts (Butler / ButlerView) behaviour that 3.4.0 must keep:
// active-note capture (H1), split diff auto-open (H2) and search scoping (R1).
// main.ts and organization.ts Both import `obsidian` at runtime, so they are loaded through
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
 // Windows without Developer Mode refuses file symlinks (EPERM); a hard link
 // to the same outside file is the unprivileged alias with the same refusal.
 try{symlinkSync(join(vault,'Linked/Hard.md'),join(vault,'Notes/ToHard.md'));}
 catch{linkSync(join(outside,'target.md'),join(vault,'Notes/ToHard.md'));}
 // A directory link out of the vault: a junction on Windows, a symlink elsewhere.
 symlinkSync(outside,join(vault,'Linked','Out'),process.platform==='win32'?'junction':undefined);
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
 butler.prefs.diffView='highlights';view.pendingSignature='';
 assert.throws(()=>view.renderPendingEdits(),(e:unknown)=>e===stop);
 assert.equal(synced,1);
});

// ---------------------------------------------------------------- R1: search_vault scope

function searchView(){
 const files=['Notes/A.md','Notes/B.md','Projects/P.md','Projects/Sub/S.md','Private/Secret.md','Linked/Hard.md'];
 const texts:Record<string,string>={'Notes/A.md':'alpha bravo','Notes/B.md':'charlie bravo','Projects/P.md':'bravo project','Projects/Sub/S.md':'bravo sub','Private/Secret.md':'bravo secret','Linked/Hard.md':'bravo hard'};
 const app=makeApp({files,texts,folders:['Notes','Projects','Projects/Sub','Private','Linked']});
 const butler=makeButler(app,{excludedFolders:'Private'});
 const view=new ButlerView({app},butler);
 view.offeredToolNames=new Set(['search_vault','read_note']);
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
 // A junction (Windows) or symlink folder pointing outside the vault is not a
 // searchable folder either.
 await assert.rejects(search({query:'bravo',folder:'Linked/Out'}),/allowed vault folder/);
});

test('vault aliases to outside files are refused: the planted link and a junction folder',()=>{
 const butler=makeButler();
 assert.equal(butler.allowedVaultFile('Notes/ToHard.md'),false);
 assert.equal(butler.allowedVaultFile('Linked/Out'),false);
 assert.equal(butler.allowedVaultFile('Linked/Out/target.md'),false);
});


// ---------------------------------------------------------------- A8: the dispatcher runs only tools offered for the turn

test('A8: ButlerView.tool refuses a tool that was not offered, and every tool outside a turn',async()=>{
 const app=makeApp({files:['Notes/A.md'],texts:{'Notes/A.md':'alpha'},folders:['Notes']});
 const view=new ButlerView({app},makeButler(app));
 await assert.rejects(view.tool('search_vault',{query:'alpha'},fakeEl()),/not available in this mode/);
 view.offeredToolNames=new Set(['read_note']);
 await assert.rejects(view.tool('search_vault',{query:'alpha'},fakeEl()),/not available in this mode/);
 await assert.rejects(view.tool('propose_edit',{path:'Notes/A.md',oldText:'alpha',newText:'beta',reason:'r'},fakeEl()),/not available in this mode/);
});
