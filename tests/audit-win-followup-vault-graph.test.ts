// Independent-follow-up regressions (2026-11-20): vault-graph byte-budget
// pagination must not skip notes, and a case-alias read must see unsaved editor
// content. Fixtures only; no live vault or provider turn.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {queryGraph,type GraphSource} from '../src/vault-graph';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */

function taggedSource(paths:string[]):GraphSource{
 return {
  resolvedLinks:{},unresolvedLinks:{},
  notes:()=>paths.slice(),
  tags:()=>['#t'],
  properties:()=>({}),
  allowed:(path:string)=>!path.startsWith('Excluded/'),
 };
}

test('a byte-trimmed page resumes at the first unreturned note instead of skipping it',()=>{
 // ~700-character paths × 100 notes exceed the 60 KB result budget, so the page
 // is halved. The continuation must point at the 50th source note, not the old
 // page boundary (which the trim removed), or notes 50..99 become unreachable.
 const paths=Array.from({length:100},(_,i)=>'x'.repeat(690)+'/'+String(i).padStart(3,'0')+'.md');
 const source=taggedSource(paths);
 const first:any=queryGraph(source,{tag:'t'});
 assert.equal(first.total,100);
 assert.equal(first.items.length,50,'the page was trimmed to fit the budget');
 assert.equal(first.truncated,true,'the caller must know data was omitted');
 assert.equal(first.nextOffset,50,'continuation resumes at the first unreturned note');
 const second:any=queryGraph(source,{tag:'t',offset:50});
 assert.equal(second.items.length,50);
 assert.equal(second.nextOffset,undefined,'no more notes after the resumed tail');
});

test('noteGraph marks non-paginated results truncated when the budget bites',()=>{
 // A hundred long outgoing-link paths exceed the result budget; the list is
 // halved and flagged so the caller knows links were omitted.
 const links:Record<string,number>={};
 for(let i=0;i<100;i++)links['x'.repeat(690)+'/'+String(i).padStart(3,'0')+'.md']=1;
 const source:GraphSource={
  resolvedLinks:{A:links},unresolvedLinks:{},notes:()=>['A'],
  tags:()=>[],properties:()=>({}),allowed:()=>true,
 };
 const out:any=queryGraph(source,{path:'A'});
 assert.ok(JSON.stringify(out).length<=60_000,'the hard bound holds');
 assert.equal(out.truncated,true);
 assert.equal(out.outgoing.length,50,'the non-paginated list was shrunk to fit');
});

let Butler:any,obsidian:any;
test('a case alias reads the open editor unsaved content, not the saved copy',{skip:!(process.platform==='win32'||process.platform==='darwin')},async()=>{
 ({Butler,obsidian}=await loadMain());
 const root=mkdtempSync(join(tmpdir(),'owla-win-alias-'));
 try{
  mkdirSync(join(root,'Notes'),{recursive:true});
  writeFileSync(join(root,'Notes/Note.md'),'saved old version');
  const file=new obsidian.TFile('Notes/Note.md');file.stat={size:16,mtime:1};
  const editor={getValue:()=>'unsaved new version',offsetToPos:(o:number)=>({line:0,ch:o}),replaceRange:()=>{}};
  const markdown=Object.assign(new obsidian.MarkdownView(),{file,editor});
  const app:any={vault:{adapter:new obsidian.FileSystemAdapter(root),getName:()=>'test',
    getFiles:()=>[file],getFileByPath:(p:string)=>p==='Notes/Note.md'?file:null,
    getAbstractFileByPath:(p:string)=>p==='Notes/Note.md'?file:null,cachedRead:async()=>'saved old version'},
   workspace:{getLeavesOfType:(t:string)=>t==='markdown'?[{view:markdown}]:[],getActiveViewOfType:()=>null,getActiveFile:()=>null}};
  const butler=new Butler(app,{id:'owla-butler',version:'test'});
  butler.app=app;butler.prefs.storageRoot=join(root,'storage');
  butler.organization={blocked:false,busy:false,loadError:''};
  assert.equal(await butler.currentText('notes/note.md'),'unsaved new version','the alias must resolve before the open-view lookup');
 }finally{rmSync(root,{recursive:true,force:true});}
});
