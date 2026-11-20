// Orchestrator wiring regressions (round 2) for win-tools proposals P1/P2/P4/P5
// applied to main.ts: case-alias resolution (NTFS/APFS only, filesystem-gated),
// search_vault folder normalization + canonical scoping, 2 MB read-size caps,
// and organization/deletion reason caps. Exclusion semantics stay fold-based.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Butler:any,ButlerView:any,obsidian:any;
let scratch:string,vault:string;
const raw:Record<string,string>={
 'Notes/A.md':'# Head\r\nalpha\r\n',
 'Other/B.md':'# Other\r\nbeta\r\n',
};
const caseHost=process.platform==='win32'||process.platform==='darwin';

before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 scratch=mkdtempSync(join(tmpdir(),'owla-win-tools-wiring-'));
 vault=join(scratch,'Vault');
 mkdirSync(join(vault,'Notes'),{recursive:true});
 mkdirSync(join(vault,'Other'),{recursive:true});
 for(const [path,text] of Object.entries(raw))writeFileSync(join(vault,path),text);
 (globalThis as any).window??=new EventTarget();
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:50});});

function makeApp(){
 const files=Object.keys(raw).map(path=>{const f=new obsidian.TFile(path);f.stat={size:raw[path].length,mtime:1};return f;});
 const fileMap=new Map(files.map(f=>[f.path,f]));
 const folders=[new obsidian.TFolder('Notes'),new obsidian.TFolder('Other')];
 return {
  vault:{adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',
   getMarkdownFiles:()=>files.filter(f=>f.extension==='md'),
   getFiles:()=>files,
   getAllFolders:()=>folders,
   getFileByPath:(p:string)=>fileMap.get(p)??null,
   getAbstractFileByPath:(p:string)=>fileMap.get(p)??null,
   getFolderByPath:(p:string)=>folders.find(f=>f.path===p)??null,
   cachedRead:async(f:any)=>raw[f.path],read:async(f:any)=>raw[f.path]},
  workspace:{getLeavesOfType:()=>[],getActiveViewOfType:()=>null,getActiveFile:()=>null},
  metadataCache:{resolvedLinks:{},unresolvedLinks:{},getFileCache:()=>null,getFirstLinkpathDest:()=>null},
 };
}
function makeButler(app:any=makeApp(),excluded=''){
 const butler=new Butler(app,{id:'owla-butler',version:'t'});
 butler.app=app;
 Object.assign(butler.prefs,{storageRoot:join(scratch,'storage'),excludedFolders:excluded});
 return butler;
}
function makeView(butler:any,tools:string[]){
 const view=new ButlerView({app:butler.app},butler);
 view.offeredToolNames=new Set(tools);
 return view;
}
const log={createDiv:()=>({})};

test('currentText resolves a case-fold alias to the canonical file (case-insensitive hosts)',{skip:caseHost?false:'case-sensitive filesystem'},async()=>{
 const butler=makeButler();
 assert.equal(await butler.currentText('notes/a.md'),'# Head\nalpha\n');
});

test('currentText still refuses an excluded folder through a case alias',async()=>{
 const butler=makeButler(makeApp(),'Notes');
 await assert.rejects(()=>butler.currentText('notes/a.md'),/excluded/);
});

test('search_vault explains forward slashes for a backslash folder argument',async()=>{
 const view=makeView(makeButler(),['search_vault']);
 await assert.rejects(()=>view.tool('search_vault',{query:'alpha',folder:'Notes\\'},log),/forward slashes/);
});

test('search_vault scopes by the canonical spelling of a case-fold folder alias',{skip:caseHost?false:'case-sensitive filesystem'},async()=>{
 const view=makeView(makeButler(),['search_vault']);
 const result=JSON.parse(await view.tool('search_vault',{query:'alpha',folder:'notes'},log));
 assert.deepEqual(result.matches,['Notes/A.md']);
});

test('search_vault refuses an excluded folder through a case alias',async()=>{
 const view=makeView(makeButler(makeApp(),'Notes'),['search_vault']);
 await assert.rejects(()=>view.tool('search_vault',{query:'alpha',folder:'notes'},log),/allowed vault folder/);
});

test('read_note refuses a note over the 2 MB read cap',async()=>{
 const app=makeApp();
 const big=new obsidian.TFile('Notes/A.md');big.stat={size:3_000_000,mtime:1};
 app.vault.getFileByPath=(p:string)=>p==='Notes/A.md'?big:null;
 app.vault.getAbstractFileByPath=(p:string)=>p==='Notes/A.md'?big:null;
 app.vault.getFiles=()=>[big];
 const view=makeView(makeButler(app),['read_note']);
 await assert.rejects(()=>view.tool('read_note',{path:'Notes/A.md'},log),/too large/);
});

test('read_canvas refuses a canvas over the 2 MB read cap',async()=>{
 writeFileSync(join(vault,'Big.canvas'),'{"nodes":[]}');
 const app=makeApp();
 const big=new obsidian.TFile('Big.canvas');big.stat={size:3_000_000,mtime:1};
 app.vault.getFileByPath=(p:string)=>p==='Big.canvas'?big:null;
 app.vault.getAbstractFileByPath=(p:string)=>p==='Big.canvas'?big:null;
 app.vault.getFiles=()=>[big];
 const view=makeView(makeButler(app),['read_canvas']);
 try{await assert.rejects(()=>view.tool('read_canvas',{path:'Big.canvas'},log),/too large/);}
 finally{rmSync(join(vault,'Big.canvas'),{force:true});}
});

test('propose_organization refuses an overlong reason',async()=>{
 const view=makeView(makeButler(),['propose_organization']);
 await assert.rejects(()=>view.tool('propose_organization',{moves:[],reason:'x'.repeat(301)},log,new Map(),{review:undefined}),/up to 300/);
});

test('propose_deletion refuses an overlong reason',async()=>{
 const view=makeView(makeButler(),['propose_deletion']);
 await assert.rejects(()=>view.tool('propose_deletion',{path:'Notes/A.md',reason:'x'.repeat(301)},log,new Map(),{review:undefined}),/up to 300/);
});