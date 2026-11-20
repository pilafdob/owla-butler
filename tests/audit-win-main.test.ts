// Windows perf/integration pass (round 2): CRLF note text in the read/propose/write
// pipeline, error redaction at the chat-store surfaces, and dispatch-level checks.
// Obsidian's editor normalizes line breaks to \n, but a closed note read from disk
// can still carry CRLF (common on Windows). Markdown reads are normalized so the
// model's LF oldText matches; drawings, canvases and bases keep their exact bytes;
// POSIX (LF-only) behaviour is unchanged. No file symlinks in fixtures (Windows
// without Developer Mode); plain files only.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Butler:any,ButlerView:any,obsidian:any;
let scratch:string,vault:string;
const notices:string[]=[];
const raw:Record<string,string>={
 'Notes/CRLF.md':'alpha\r\nbeta\r\ngamma\r\n',
 'Notes/LF.md':'alpha\nbeta\n',
 'Notes/Search.md':'delta\r\nepsilon\r\n',
 'Notes/D.canvas':'{"nodes":[]}\r\n',
 'Notes/Drawing.md':'---\r\nexcalidraw-plugin: parsed\r\n---\r\n# Drawing\r\n',
};

before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 // Notice stand-in records its text so redaction can be asserted.
 const OriginalNotice=obsidian.Notice;
 class SpyNotice extends OriginalNotice{constructor(...args:unknown[]){super(...args);notices.push(String(args[0]));}}
 obsidian.Notice=SpyNotice;
 // Minimal working YAML stand-ins so property staging exercises the real path.
 obsidian.parseYaml=(text:string)=>{const out:Record<string,unknown>={};for(const line of text.split(/\r?\n/)){const i=line.indexOf(':');if(i>0)out[line.slice(0,i).trim()]=line.slice(i+1).trim();}return out;};
 obsidian.stringifyYaml=(value:unknown)=>Object.entries(value as Record<string,unknown>).map(([k,v])=>k+': '+String(v)).join('\n')+'\n';
 scratch=mkdtempSync(join(tmpdir(),'owla-win-main-'));
 vault=join(scratch,'Vault');
 mkdirSync(join(vault,'Notes'),{recursive:true});
 for(const [path,text] of Object.entries(raw))writeFileSync(join(vault,path),text);
 (globalThis as any).window??=new EventTarget();
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});

function makeApp(leaves:any[]=[]):any{
 const files=Object.keys(raw).map(path=>{const f=new obsidian.TFile(path);f.stat={size:raw[path].length};return f;});
 const fileMap=new Map(files.map(f=>[f.path,f]));
 return {
  vault:{
   adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',
   getMarkdownFiles:()=>files.filter(f=>f.extension==='md'),
   getFileByPath:(p:string)=>fileMap.get(p)??null,
   getAbstractFileByPath:(p:string)=>fileMap.get(p)??null,
   getFolderByPath:(p:string)=>p==='Notes'?new obsidian.TFolder('Notes'):null,
   cachedRead:async(f:any)=>raw[f.path],read:async(f:any)=>raw[f.path],
   process:async(f:any,fn:(text:string)=>string)=>{raw[f.path]=fn(raw[f.path]);return raw[f.path];},
  },
  workspace:{getLeavesOfType:(type:string)=>type==='markdown'?leaves:[],getActiveViewOfType:()=>null,getActiveFile:()=>null},
  metadataCache:{resolvedLinks:{},unresolvedLinks:{},getFileCache:()=>null},
 };
}
function makeButler(app:any=makeApp()){
 const butler=new Butler(app,{id:'owla-butler',version:'t'});
 butler.app=app;
 Object.assign(butler.prefs,{storageRoot:join(scratch,'storage')});
 butler.organization={blocked:false,review:undefined,progress:undefined,busy:false,loadError:''};
 return butler;
}
const log={createDiv:()=>({})};

// ---------------------------------------------------------------- CRLF read pipeline

test('currentText normalizes CRLF Markdown reads (Windows)',async()=>{
 const butler=makeButler();
 assert.equal(await butler.currentText('Notes/CRLF.md'),'alpha\nbeta\ngamma\n');
});

test('currentText keeps LF Markdown byte-identical (POSIX unchanged)',async()=>{
 const butler=makeButler();
 assert.equal(await butler.currentText('Notes/LF.md'),'alpha\nbeta\n');
});

test('currentText normalizes lone CR the way the editor splits lines',async()=>{
 const butler=makeButler();
 raw['Notes/LF.md']='alpha\rbeta\r';
 try{assert.equal(await butler.currentText('Notes/LF.md'),'alpha\nbeta\n');}
 finally{raw['Notes/LF.md']='alpha\nbeta\n';}
});

test('currentText keeps canvas and Excalidraw bytes exact',async()=>{
 const butler=makeButler();
 assert.equal(await butler.currentText('Notes/D.canvas'),'{"nodes":[]}\r\n');
 assert.equal(await butler.currentText('Notes/Drawing.md'),raw['Notes/Drawing.md']);
});

test('read_note + propose_edit: LF oldText matches a CRLF note end to end',async()=>{
 const butler=makeButler();
 const view=new ButlerView({app:butler.app},butler);
 view.offeredToolNames=new Set(['read_note','propose_edit']);
 const batches=new Map();
 const read=await view.tool('read_note',{path:'Notes/CRLF.md'},log,batches);
 assert.ok(!read.includes('\r'),'the model sees LF text');
 assert.ok(read.includes('alpha\nbeta'));
 const result=await view.tool('propose_edit',{path:'Notes/CRLF.md',oldText:'alpha\nbeta',newText:'alpha\nBETA',reason:'r'},log,batches);
 assert.match(result,/Change queued/);
 const staged=batches.get('Notes/CRLF.md');
 assert.equal(staged.edit.before,'alpha\nbeta\ngamma\n','the snapshot is normalized');
 assert.ok(staged.edit.after.includes('alpha\nBETA'));
 assert.ok(!staged.edit.after.includes('\r'));
});

test('read_note on a CRLF note returns exact sections (no raw-offset cache slices)',async()=>{
 const app=makeApp();let cacheCalls=0;
 app.metadataCache.getFileCache=()=>{cacheCalls++;return {};};
 const butler=makeButler(app);
 const view=new ButlerView({app},butler);
 view.offeredToolNames=new Set(['read_note']);
 await view.tool('read_note',{path:'Notes/CRLF.md'},log);
 assert.equal(cacheCalls,0,'normalized text differs from the saved CRLF bytes: the raw-offset cache must not slice it');
 raw['Notes/Head.md']='# One\r\nalpha\r\n## Two\r\nbeta\r\n';
 writeFileSync(join(vault,'Notes/Head.md'),raw['Notes/Head.md']);
 try{
  const app2=makeApp();app2.metadataCache.getFileCache=()=>{cacheCalls++;return {};};
  const view2=new ButlerView({app:app2},makeButler(app2));
  view2.offeredToolNames=new Set(['read_note']);
  const section=await view2.tool('read_note',{path:'Notes/Head.md',heading:'Two'},log);
  assert.ok(String(section).includes('beta'),'the heading section must be exact');
  assert.ok(!String(section).includes('alpha'),'the previous section must not leak in');
  assert.equal(cacheCalls,0,'the CRLF heading read uses the CRLF-safe pure finder');
 }finally{delete raw['Notes/Head.md'];rmSync(join(vault,'Notes/Head.md'),{force:true});}
});

test('search_vault snapshots are normalized so propose_edit matches',async()=>{
 const butler=makeButler();
 const view=new ButlerView({app:butler.app},butler);
 view.offeredToolNames=new Set(['search_vault','read_note','propose_edit']);
 const batches=new Map();
 const found=JSON.parse(await view.tool('search_vault',{query:'epsilon'},log,batches));
 assert.deepEqual(found.matches,['Notes/Search.md']);
 assert.ok(!JSON.stringify(found.sources).includes('\\r'));
 const result=await view.tool('propose_edit',{path:'Notes/Search.md',oldText:'delta\nepsilon',newText:'delta\nEPSILON',reason:'r'},log,batches);
 assert.match(result,/Change queued/);
});

// ---------------------------------------------------------------- CRLF write pipeline

test('writeEdit accepts an LF snapshot against a CRLF file (closed note)',async()=>{
 const butler=makeButler();
 await butler.apply({path:'Notes/CRLF.md',before:'alpha\nbeta\ngamma\n',after:'alpha\nBETA\ngamma\n',reason:'r'});
 assert.equal(raw['Notes/CRLF.md'],'alpha\nBETA\ngamma\n');
 raw['Notes/CRLF.md']='alpha\r\nbeta\r\ngamma\r\n';
});

test('writeEdit still rejects a real content change despite normalization',async()=>{
 const butler=makeButler();
 raw['Notes/CRLF.md']='alpha\r\nGAMMA\r\n';
 await assert.rejects(
  butler.apply({path:'Notes/CRLF.md',before:'alpha\nbeta\n',after:'alpha\nBETA\n',reason:'r'}),
  /note changed/);
 raw['Notes/CRLF.md']='alpha\r\nbeta\r\ngamma\r\n';
});

test('writeEdit with an open editor keeps POSIX behaviour',async()=>{
 const file=new obsidian.TFile('Notes/LF.md');
 const view=new obsidian.MarkdownView({});
 view.file=file;
 const calls:any[]=[];
 view.editor={getValue:()=>'alpha\nbeta\n',replaceRange:(text:string,from:any,to:any)=>calls.push({text,from,to}),offsetToPos:(o:number)=>({line:0,ch:o})};
 const butler=makeButler(makeApp([{view}]));
 await butler.apply({path:'Notes/LF.md',before:'alpha\nbeta\n',after:'alpha\nBETA\n',reason:'r'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].text,'BETA');
 assert.equal(raw['Notes/LF.md'],'alpha\nbeta\n','the editor branch does not touch the disk');
});

test('writeEdit keeps canvas bytes exact through the freshness check',async()=>{
 const butler=makeButler();
 const text='{"nodes":[]}\r\n';
 await butler.apply({path:'Notes/D.canvas',before:text,after:text,reason:'r'});
 assert.equal(raw['Notes/D.canvas'],text);
});

// ---------------------------------------------------------------- error redaction

test('openSavedChat redacts bearer tokens and home paths in storage errors',()=>{
 const butler=makeButler();
 const view=new ButlerView({app:butler.app},butler);
 const secret='Bearer '+'abc123def';
 (view as any).chatStore=()=>({list:()=>{throw Error(secret+' failed at '+join(homedir(),'secret'));}});
 view.openSavedChat();
 const message=notices.at(-1)!;
 assert.ok(message.includes('[redacted]'),'the token is redacted');
 assert.ok(!message.includes('abc123def'));
 assert.ok(message.includes('~'),'the home path is redacted');
 assert.ok(!message.includes(homedir()));
});

// ---------------------------------------------------------------- dispatch checks

test('propose_properties refuses drawings, canvases and bases',async()=>{
 const butler=makeButler();
 const view=new ButlerView({app:butler.app},butler);
 view.offeredToolNames=new Set(['read_note','read_canvas','propose_properties']);
 const batches=new Map();
 await view.tool('read_note',{path:'Notes/Drawing.md'},log,batches);
 await assert.rejects(view.tool('propose_properties',{path:'Notes/Drawing.md',set:{tags:'x'},reason:'r'},log,batches),/plain Markdown notes/);
 await view.tool('read_canvas',{path:'Notes/D.canvas'},log,batches);
 await assert.rejects(view.tool('propose_properties',{path:'Notes/D.canvas',set:{tags:'x'},reason:'r'},log,batches),/plain Markdown notes/);
 const ok=await view.tool('read_note',{path:'Notes/LF.md'},log,batches);
 assert.ok(ok.includes('alpha'));
 const result=await view.tool('propose_properties',{path:'Notes/LF.md',set:{tags:'x'},reason:'r'},log,batches);
 assert.match(result,/Property changes queued/);
});

test('query_vault_graph runs inside the bounded pass path-check cache',async()=>{
 const butler=makeButler();
 const original=butler.allowedNote.bind(butler);
 let calls=0,cacheActive=false;
 butler.allowedNote=(path:string)=>{calls++;if((butler as any).pathCheckCache)cacheActive=true;return original(path);};
 const view=new ButlerView({app:butler.app},butler);
 view.offeredToolNames=new Set(['query_vault_graph']);
 const result=JSON.parse(await view.tool('query_vault_graph',{report:'tags'},log));
 assert.ok(result,'the graph query returns a result');
 assert.ok(calls>0,'notes were checked');
 assert.ok(cacheActive,'every check ran inside withPathCheckCache');
 assert.equal((butler as any).pathCheckCache,null,'the pass cache is released afterwards');
});
