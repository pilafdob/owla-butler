// Vault confinement regressions for 3.4.0 (Batch 1): case/Unicode folding,
// native realpath, hardlink denial, and no stale cross-turn path cache.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {linkSync,mkdirSync,mkdtempSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {allowedEditablePath,allowedPath,foldPath} from '../src/core';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Butler:any,obsidian:any,Organization:any;
let scratch:string,vault:string,outside:string;

before(async()=>{
 ({Butler,obsidian}=await loadMain());
 ({Organization}=await import('../src/organization'));
 scratch=mkdtempSync(join(tmpdir(),'owla-security-vault-'));
 vault=join(scratch,'Vault');outside=join(scratch,'Outside');
 for(const dir of ['Notes','Secret','Archive','Dr.'])mkdirSync(join(vault,dir),{recursive:true});
 mkdirSync(join(outside,'Notes'),{recursive:true});
 writeFileSync(join(vault,'Notes/ok.md'),'ok');
 writeFileSync(join(vault,'Notes/a.md'),'a');
 writeFileSync(join(vault,'Secret/note.md'),'secret');
 writeFileSync(join(vault,'Dr./notes.md'),'dr');
 writeFileSync(join(outside,'target.md'),'outside');
 writeFileSync(join(outside,'Notes/ok.md'),'outside ok');
 linkSync(join(outside,'target.md'),join(vault,'Notes/hard.md'));
 symlinkSync(join(vault,'Notes/hard.md'),join(vault,'Notes/sym-hard.md'));
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});

function makeApp(files:string[]=[],folders:string[]=[]){
 const fileMap=new Map(files.map(path=>[path,new obsidian.TFile(path)]));
 const folderMap=new Map(folders.map(path=>[path,new obsidian.TFolder(path)]));
 return {
  vault:{
   adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',
   getMarkdownFiles:()=>[...fileMap.values()],getFiles:()=>[...fileMap.values()],getAllFolders:()=>[...folderMap.values()],getFolderByPath:(p:string)=>folderMap.get(p)??null,getFileByPath:(p:string)=>fileMap.get(p)??null,
   getAbstractFileByPath:(p:string)=>fileMap.get(p)??folderMap.get(p)??null,read:async()=>'',cachedRead:async()=>'',
  },
  workspace:{getLeavesOfType:()=>[]},
  metadataCache:{resolvedLinks:{},getFileCache:()=>({})},
 };
}
function makeButler(app:any=makeApp(),excludedFolders=''){
 const butler=new Butler(app,{id:'owla-butler',version:'test'});
 butler.app=app;Object.assign(butler.prefs,{storageRoot:join(scratch,'storage'),excludedFolders});
 return butler;
}

test('allowedPath folds ſ, ς and ß the way the filesystem does',()=>{
 assert.equal(allowedPath('ſecret/x.md','Secret'),false);
 assert.equal(allowedPath('ςοφία/x.md','Σοφία'),false);
 assert.equal(allowedPath('Strasse/x.md','Straße'),false);
 assert.equal(allowedPath('Public/x.md','Secret'),true);
});

// SECURITY-AUDIT-3.6.2 H3: ẞ (U+1E9E) upper-cases to itself, so an upper-first
// fold left `STRAẞE` as `straße` while `Straße` folded to `strasse`.
test('allowedPath folds the capital sharp s ẞ like ß and ss',()=>{
 for(const [path,excluded] of [['STRAẞE/secret.md','Straße'],['Straße/secret.md','STRAẞE'],['Strasse/secret.md','STRAẞE'],['STRAẞE/secret.md','strasse'],['straße/secret.md','STRASSE']])
  assert.equal(allowedPath(path,excluded),false,path+' vs '+excluded);
 assert.equal(allowedEditablePath('STRAẞE/secret.md','Straße'),false);
 assert.equal(allowedEditablePath('STRAẞE/a.canvas','Straße'),false);
 assert.equal(foldPath('STRAẞE'),foldPath('Strasse'));
 assert.equal(allowedPath('Strand/x.md','Straße'),true);
});

test('allowedPath accepts trailing dots on POSIX and refuses them on Windows',()=>{
 assert.equal(allowedPath('Dr./notes.md','Private','md','darwin'),true);
 assert.equal(allowedPath('Dr./notes.md','Private','md','linux'),true);
 assert.equal(allowedPath('Dr./notes.md','Private','md','win32'),false);
 assert.equal(allowedPath('Space /notes.md','','md','win32'),false);
 assert.equal(allowedPath('Space /notes.md','','md','darwin'),true);
});

test('allowedPath refuses NUL, colons, control characters and ~ segments',()=>{
 for(const path of ['a\0b.md','C:/x.md','a:b.md','a\u0001b.md','a\nb.md','a\u007fb.md','~/x.md','Notes/~/x.md'])assert.equal(allowedPath(path),false,JSON.stringify(path));
 assert.equal(allowedPath('Notes/~draft.md'),true);
});

test('allowedVaultFile resolves the on-disk name, so a case-fold alias meets the exclusion',()=>{
 const butler=makeButler(makeApp(),'Secret');
 assert.equal(butler.allowedVaultFile('Secret/note.md'),false);
 assert.equal(butler.allowedVaultFile('ſecret/note.md'),false);
 assert.equal(butler.allowedVaultFile('Dr./notes.md'),true);
});

test('folders pass; hardlinked files and symlinks to them do not',()=>{
 const butler=makeButler();
 assert.equal(butler.allowedVaultFile('Notes'),true);
 assert.equal(butler.allowedVaultFile('Notes/ok.md'),true);
 assert.equal(butler.allowedNote('Notes/ok.md'),true);
 assert.equal(butler.allowedVaultFile('Notes/hard.md'),false);
 assert.equal(butler.allowedVaultFile('Notes/sym-hard.md'),false);
});

test('an external symlink swap is seen on the next check (no cross-turn cache)',()=>{
 const butler=makeButler();
 assert.equal(butler.allowedVaultFile('Notes/ok.md'),true);
 renameSync(join(vault,'Notes'),join(vault,'Notes-real'));
 symlinkSync(join(outside,'Notes'),join(vault,'Notes'));
 try{assert.equal(butler.allowedVaultFile('Notes/ok.md'),false);}
 finally{rmSync(join(vault,'Notes'));renameSync(join(vault,'Notes-real'),join(vault,'Notes'));}
 assert.equal(butler.allowedVaultFile('Notes/ok.md'),true);
});

test('withPathCheckCache scopes answers to one pass only',()=>{
 const butler=makeButler();
 const inside=butler.withPathCheckCache(()=>[butler.allowedNote('Notes/ok.md'),butler.allowedNote('Notes/ok.md')]);
 assert.deepEqual(inside,[true,true]);
 assert.equal(butler.pathCheckCache,null);
});

function organizationFor(butler:any){
 return new Organization(butler.app,()=>join(scratch,'org-storage'),()=>vault,(path:string)=>butler.allowedVaultFile(path),()=>butler.prefs.excludedFolders,()=>true,()=>true,async()=>'',async()=>{});
}

test('organization refuses a destination that is a case-fold alias of an excluded folder',async()=>{
 const butler=makeButler(makeApp(['Notes/a.md'],['Notes','Secret','Archive']),'Secret');
 const org=organizationFor(butler);
 await assert.rejects(org.preview([{from:'Notes/a.md',to:'ſecret/a.md'}],'move'));
 await assert.rejects(org.preview([{from:'Notes/a.md',to:'secret/a.md'}],'move'));
 const sharp=organizationFor(makeButler(makeApp(['Notes/a.md'],['Notes','Straße']),'Straße'));
 await assert.rejects(sharp.preview([{from:'Notes/a.md',to:'STRAẞE/a.md'}],'move'));
 const ok=await org.preview([{from:'Notes/a.md',to:'Archive/a.md'}],'move');
 assert.deepEqual(ok.moves,[{from:'Notes/a.md',to:'Archive/a.md'}]);
});

test('organization refuses to move a hardlinked file',async()=>{
 const butler=makeButler(makeApp(['Notes/a.md','Notes/hard.md'],['Notes','Archive']));
 const org=organizationFor(butler);
 await assert.rejects(org.preview([{from:'Notes/hard.md',to:'Archive/hard.md'}],'move'));
});
