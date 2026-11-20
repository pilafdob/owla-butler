// Independent-review fix cycle (round 2): regressions for the six logic errors
// the fail-closed reviewer found, plus the redaction improvements.
// L1 $-pattern injection in the trim payload splice; L2 CRLF drawing freshness
// must fail safe in an open Markdown editor; L3 lock retry must work where
// Atomics.wait throws (Electron renderer main thread); L4 noteGraph alias
// fallback must not fire for linkless indexed notes; L5 2 MB caps must hold
// through case aliases; L6 findBlock odd blank-line runs keep old LF ranges.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {loadMain} from './helpers/load-main';
import {findBlock} from '../src/note-tools';
import {noteGraph} from '../src/vault-graph';
import {ChatStore} from '../src/chats';
import {redactErrorDetail} from '../src/validation';

/* eslint-disable @typescript-eslint/no-explicit-any */
const req=createRequire(import.meta.url);
let Butler:any,ButlerView:any,obsidian:any;
let scratch:string,vault:string;
const caseHost=process.platform==='win32'||process.platform==='darwin';

before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 scratch=mkdtempSync(join(tmpdir(),'owla-win-review-fixes-'));
 vault=join(scratch,'Vault');
 mkdirSync(vault,{recursive:true});
 writeFileSync(join(vault,'note.md'),'small real file');
 writeFileSync(join(vault,'Drawing.excalidraw.md'),'---\r\nexcalidraw-plugin: parsed\r\n---\r\n# Drawing\r\n');
 (globalThis as any).window??=new EventTarget();
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:50});});

function makeApp(extra:any={}){
 const file=new obsidian.TFile('note.md');file.stat={size:3_000_000,mtime:1};
 const drawing=new obsidian.TFile('Drawing.excalidraw.md');drawing.stat={size:60,mtime:1};
 const map=new Map([['note.md',file],['Drawing.excalidraw.md',drawing]]);
 return {
  vault:{adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',
   getMarkdownFiles:()=>[file],getFiles:()=>[file,drawing],getAllFolders:()=>[],
   getFileByPath:(p:string)=>map.get(p)??null,
   getAbstractFileByPath:(p:string)=>map.get(p)??null,
   getFolderByPath:()=>null,
   cachedRead:async(f:any)=>f.path==='note.md'?'x':'---\r\nexcalidraw-plugin: parsed\r\n---\r\n# Drawing\r\n',
   read:async(f:any)=>f.path==='note.md'?'x':'---\r\nexcalidraw-plugin: parsed\r\n---\r\n# Drawing\r\n',
   process:async(f:any,fn:(t:string)=>string)=>fn(f.path==='note.md'?'x':'---\r\nexcalidraw-plugin: parsed\r\n---\r\n# Drawing\r\n'),
   ...extra},
  workspace:{getLeavesOfType:(_t:string)=>[] as any[],getActiveViewOfType:()=>null,getActiveFile:()=>null},
  metadataCache:{resolvedLinks:{},unresolvedLinks:{},getFileCache:()=>null,getFirstLinkpathDest:()=>null},
 };
}
function makeButler(app:any=makeApp()){
 const butler=new Butler(app,{id:'owla-butler',version:'t'});
 butler.app=app;
 Object.assign(butler.prefs,{storageRoot:join(scratch,'storage')});
 return butler;
}
const log={createDiv:()=>({})};

// ---- L1: trim payload splice is literal and position-pinned ----------------

test('trimming a selection containing $&/$\'/$` never re-inserts the untrimmed payload',()=>{
 const butler=makeButler();
 const view=new ButlerView({app:butler.app},butler);
 const big='x'.repeat(2950)+'$&'+"$'"+'$`';
 const selected=[{path:'A.md',text:big}];
 const section='\nSELECTED TEXT from A.md\n'+big;
 const context='HEAD'+section;
 const rc:any={estimatedTokens:7300,selectedChars:big.length,selections:1};
 const out=(view as any).trimSelectionsForWindow(selected,rc,[{context:8192}],context,{createDiv:()=>{}},4);
 assert.ok(out.length<context.length,'the payload must shrink');
 assert.ok(!out.includes(big),'$& must not re-insert the untrimmed section');
 assert.ok(!out.includes('HEADHEAD'),"$` must not duplicate the prefix");
 assert.ok(rc.estimatedTokens<7300,'the estimate must reflect the trim');
 assert.ok(selected[0].text.length<big.length);
 assert.ok(rc.selectedChars===selected[0].text.length);
});

test('a decoy selection block inside the active note is not the replacement site',()=>{
 const butler=makeButler();
 const view=new ButlerView({app:butler.app},butler);
 const big='y'.repeat(2950);
 const selected=[{path:'A.md',text:big}];
 const section='\nSELECTED TEXT from A.md\n'+big;
 const decoy='ACTIVE NOTE quoting:'+section;
 const context=decoy+section;
 const rc:any={estimatedTokens:7300,selectedChars:big.length,selections:1};
 const out=(view as any).trimSelectionsForWindow(selected,rc,[{context:8192}],context,{createDiv:()=>{}},decoy.length);
 assert.ok(out.startsWith(decoy),'the decoy block must stay intact');
 assert.ok(!out.slice(decoy.length).includes(big),'the real section must be trimmed');
});

// ---- L2: raw-CRLF drawing proposals fail safe in an open Markdown editor ----

test('a CRLF drawing snapshot against an open LF Markdown editor fails safe (no offset shift)',async()=>{
 const raw='---\r\nexcalidraw-plugin: parsed\r\n---\r\n# Drawing\r\n';
 const app=makeApp();
 const mv=new obsidian.MarkdownView({app});
 mv.file={path:'Drawing.excalidraw.md'};
 const replaces:any[]=[];
 mv.editor={getValue:()=>raw.replace(/\r\n/g,'\n'),replaceRange:(...a:any[])=>replaces.push(a),offsetToPos:(o:number)=>({line:0,ch:o})};
 app.workspace.getLeavesOfType=(t:string)=>t==='markdown'?[{view:mv}]:[];
 const butler=makeButler(app);
 const view=new ButlerView({app},butler);
 const edit={path:'Drawing.excalidraw.md',before:raw,after:raw.replace('# Drawing','# Changed'),reason:'r'};
 await assert.rejects(()=>(butler as any).writeEdit(edit),/changed|fresh/i);
 assert.equal(replaces.length,0,'nothing may be applied at shifted offsets');
});

test('a closed CRLF drawing accepts its exact raw snapshot and keeps raw bytes',async()=>{
 const raw='---\r\nexcalidraw-plugin: parsed\r\n---\r\n# Drawing\r\n';
 const after=raw.replace('# Drawing','# Changed');
 let stored=raw;
 const app=makeApp({process:async(_f:any,fn:(t:string)=>string)=>{stored=fn(stored);return stored;}});
 const butler=makeButler(app);
 const view=new ButlerView({app},butler);
 await (butler as any).writeEdit({path:'Drawing.excalidraw.md',before:raw,after,reason:'r'});
 assert.equal(stored,after,'raw CRLF bytes must be preserved');
});

test('a closed CRLF plain note still accepts an LF snapshot (Markdown normalization kept)',async()=>{
 let stored='alpha\r\nbeta\r\n';
 const app=makeApp({process:async(_f:any,fn:(t:string)=>string)=>{stored=fn(stored);return stored;}});
 const butler=makeButler(app);
 const view=new ButlerView({app},butler);
 await (butler as any).writeEdit({path:'note.md',before:'alpha\nbeta\n',after:'alpha\nBETA\n',reason:'r'});
 // Accepted against the LF snapshot, written back in the note's own CRLF style.
 assert.equal(stored,'alpha\r\nBETA\r\n');
});

// ---- L3: lock retry works where Atomics.wait throws (Electron renderer) -----

test('chat save rides out a transient lock even when Atomics.wait throws (Electron main thread)',()=>{
 const fs=req('node:fs');
 const realRename=fs.renameSync,realWait=Atomics.wait;
 let attempts=0;
 fs.renameSync=(...a:any[])=>{attempts++;if(attempts<=2){const e:any=Error('resource busy');e.code='EBUSY';throw e;}return realRename(...a);};
 Atomics.wait=(()=>{throw new TypeError('Atomics.wait cannot be used on the main thread');}) as any;
 const dir=mkdtempSync(join(tmpdir(),'owla-win-chats-'));
 try{
  const store=new ChatStore(dir);
  const chat=store.save('t',[{role:'user',content:'hi'}]);
  assert.equal(attempts,3,'two transient failures, then success — without Atomics.wait');
  assert.equal(store.list().length,1);
  assert.equal(store.list()[0].id,chat.id);
 }finally{
  fs.renameSync=realRename;Atomics.wait=realWait;
  rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
 }
});

// ---- L4: noteGraph fallback only for unindexed spellings --------------------

test('a linkless indexed note keeps its own empty graph despite a case twin with links',()=>{
 const source:any={
  allowed:()=>true,
  notes:()=>['Note.md','note.md'],
  resolvedLinks:{'note.md':{'Other.md':1}},
  unresolvedLinks:{},
  tags:()=>[],properties:()=>({}),
 };
 const graph=noteGraph(source,'Note.md');
 assert.equal(graph.path,'Note.md');
 assert.deepEqual(graph.outgoing,[],'the twin\'s links must not leak into the linkless note');
});

test('an unindexed alias spelling still resolves to the canonical note',()=>{
 const source:any={
  allowed:()=>true,
  notes:()=>['Notes/A.md'],
  resolvedLinks:{'Notes/A.md':{'Notes/B.md':1}},
  unresolvedLinks:{},
  tags:()=>[],properties:()=>({}),
 };
 const graph=noteGraph(source,'notes/a.md');
 assert.equal(graph.path,'Notes/A.md');
 assert.deepEqual(graph.outgoing,['Notes/B.md']);
});

// ---- L5: the 2 MB read caps hold through case aliases -----------------------

test('read_note cannot bypass the 2 MB cap via a case alias',{skip:caseHost?false:'case-sensitive filesystem'},async()=>{
 const butler=makeButler();
 const view=new ButlerView({app:butler.app},butler);
 view.offeredToolNames=new Set(['read_note']);
 await assert.rejects(()=>view.tool('read_note',{path:'NOTE.MD'},log),/too large/);
 await assert.rejects(()=>view.tool('read_note',{path:'note.md'},log),/too large/);
});

// ---- L6: findBlock odd blank-line runs keep the old LF ranges ---------------

test('findBlock keeps lastIndexOf ranges on odd blank-line runs (LF and CRLF)',()=>{
 assert.deepEqual(findBlock('para\n\n\n^id','id'),{start:7,end:10});
 assert.deepEqual(findBlock('para\n\n^id','id'),{start:6,end:9});
 assert.deepEqual(findBlock('p\n\n\n\n\n^id','id'),{start:6,end:9});
 assert.deepEqual(findBlock('para\r\n\r\n\r\n^id','id'),{start:10,end:13});
 assert.deepEqual(findBlock('para\r\n\r\n^id','id'),{start:8,end:11});
 assert.deepEqual(findBlock('para\n\n^id\n\nrest','id'),{start:6,end:9});
 assert.deepEqual(findBlock('^id','id'),{start:0,end:3});
});

// ---- S1: redaction keeps URLs readable, catches access_token ----------------

test('redaction keeps http(s) URLs readable while UNC paths stay redacted',()=>{
 const out=redactErrorDetail('fetch https://example.com/path failed on \\\\server\\share\\file','C:\\Users\\filip','win32');
 assert.ok(out.includes('https://example.com/path'),'a URL is not a UNC path');
 assert.ok(out.includes('[redacted-path]'),'UNC paths must stay redacted');
 assert.ok(!out.includes('server\\share'));
});

test('redaction catches access_token and refresh-token assignments',()=>{
 const out=redactErrorDetail('access_token=abc123 refresh-token: xyz token=tok','C:\\Users\\filip','win32');
 assert.ok(out.includes('access_token=[redacted]'));
 assert.ok(out.includes('refresh-token=[redacted]'));
 assert.ok(!out.includes('abc123')&&!out.includes('xyz'));
});

test('a colon-adjacent backslash UNC path is still redacted (URL exemption is // -side only)',()=>{
 const out=redactErrorDetail('path:\\\\fileserv\\profiles\\filip\\x failed','C:\\Users\\filip','win32');
 assert.ok(out.includes('[redacted-path]'),'colon adjacency must not exempt a backslash UNC path');
 assert.ok(!out.includes('fileserv'));
 assert.ok(redactErrorDetail('see https://example.com/a','C:\\Users\\filip','win32').includes('https://example.com/a'));
});

test('a splice miss leaves payload, selections and estimate untouched (fail closed)',()=>{
 const butler=makeButler();
 const view=new ButlerView({app:butler.app},butler);
 const big='z'.repeat(2950);
 const selected=[{path:'A.md',text:big}];
 const rc:any={estimatedTokens:7300,selectedChars:big.length,selections:1};
 const out=(view as any).trimSelectionsForWindow(selected,rc,[{context:8192}],'NO SECTION HERE',{createDiv:()=>{}},0);
 assert.equal(out,'NO SECTION HERE','the payload must stay untouched');
 assert.equal(rc.estimatedTokens,7300,'the estimate must not claim a trim that did not land');
 assert.equal(selected[0].text,big);
 assert.equal(rc.selections,1);
});