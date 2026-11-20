// Windows hardening (round 2): organization semantics on NTFS, exercised with
// unprivileged fixtures (junctions + hard links instead of file symlinks, which
// need Developer Mode). Also guards the round-1 pre-folded under() comparison
// (§4.8: security-sensitive) and the case-fold listing fallback.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {linkSync,mkdirSync,mkdtempSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {stubObsidian} from './helpers/load-main';
import {allowedPath} from '../src/core';

stubObsidian();

/* eslint-disable @typescript-eslint/no-explicit-any */
let obsidian:any,Organization:any;
let scratch:string,vault:string,outside:string;
before(async()=>{
 const stub=await import('obsidian' as string);
 obsidian=(stub as any).default??stub;
 ({Organization}=await import('../src/organization'));
 scratch=mkdtempSync(join(tmpdir(),'owla-win-tools-org-'));
 vault=join(scratch,'Vault');outside=join(scratch,'Outside');
 for(const dir of ['Notes','Archive','Links','Hard','Secret','Straße','Other'])mkdirSync(join(vault,dir),{recursive:true});
 mkdirSync(join(outside,'Secret'),{recursive:true});
 writeFileSync(join(vault,'Notes','a.md'),'a');
 writeFileSync(join(vault,'Other','b.md'),'b');
 writeFileSync(join(vault,'Secret','note.md'),'secret');
 writeFileSync(join(vault,'Straße','a.md'),'strasse');
 writeFileSync(join(outside,'Secret','s.md'),'outside secret');
 writeFileSync(join(outside,'target.md'),'outside');
 // Junction and hard link work without Developer Mode; on POSIX the junction
 // type argument is ignored and a regular symlink is created — same refusal.
 symlinkSync(join(outside,'Secret'),join(vault,'Links','junction'),'junction');
 symlinkSync(join(outside,'Secret'),join(vault,'Junction'),'junction');
 linkSync(join(outside,'target.md'),join(vault,'Hard','hard.md'));
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});

function makeApp(files:string[],folders:string[],resolvedLinks:Record<string,Record<string,number>>={}){
 const fileMap=new Map(files.map(path=>{const file=new obsidian.TFile(path);file.stat={size:1};return [path,file];}));
 const folderMap=new Map(folders.map(path=>[path,new obsidian.TFolder(path)]));
 const parentOf=(path:string)=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';
 for(const [path,folder] of folderMap){
  folder.children=[
   ...files.filter(file=>parentOf(file)===path).map(file=>fileMap.get(file)),
   ...folders.filter(child=>parentOf(child)===path).map(child=>folderMap.get(child)),
  ];
 }
 return {
  vault:{
   getMarkdownFiles:()=>[...fileMap.values()],getFiles:()=>[...fileMap.values()],getAllFolders:()=>[...folderMap.values()],
   getFolderByPath:(p:string)=>folderMap.get(p)??null,getFileByPath:(p:string)=>fileMap.get(p)??null,
   getAbstractFileByPath:(p:string)=>fileMap.get(p)??folderMap.get(p)??null,
   getRoot:()=>new obsidian.TFolder('',[...folderMap.values(),...fileMap.values()]),
   read:async()=>'',cachedRead:async()=>'',
  },
  workspace:{getLeavesOfType:()=>[]},
  metadataCache:{resolvedLinks,getFileCache:()=>({})},
 };
}
function makeOrg(app:any,excluded=''){
 return new Organization(app,()=>join(scratch,'storage'),()=>vault,(path:string)=>allowedPath(path,excluded,null),()=>excluded,()=>true,()=>true,async()=>'',async()=>{});
}
const aliasResolves=()=>!!statSync(join(vault,'notes'),{throwIfNoEntry:false});

test('organization refuses a source tree containing a junction',async()=>{
 const org=makeOrg(makeApp(['Notes/a.md'],['Notes','Links','Archive']));
 await assert.rejects(org.preview([{from:'Links',to:'Archive/Links'}],'move'),/symbolic-link/);
 await assert.rejects(org.previewRemoval('Links','tidy'),/symbolic-link/);
});

test('organization refuses a hardlinked file inside a moved or deleted tree',async()=>{
 const org=makeOrg(makeApp(['Notes/a.md'],['Notes','Hard','Archive']));
 await assert.rejects(org.preview([{from:'Hard',to:'Archive/Hard'}],'move'),/hardlinked/);
 await assert.rejects(org.previewRemoval('Hard','tidy'),/hardlinked/);
 // The clean control still passes.
 const ok=await org.preview([{from:'Notes/a.md',to:'Archive/a.md'}],'move');
 assert.deepEqual(ok.moves,[{from:'Notes/a.md',to:'Archive/a.md'}]);
});

test('organization refuses a destination whose ancestor is a junction',async()=>{
 const org=makeOrg(makeApp(['Notes/a.md'],['Notes','Archive']));
 // 'Junction' is a junction to an outside folder, unknown to Obsidian.
 await assert.rejects(org.preview([{from:'Notes/a.md',to:'Junction/a.md'}],'move'),/blocked or unsafe|outside the allowed/);
});

test('list resolves a case-fold alias only when the filesystem resolves it',()=>{
 const org=makeOrg(makeApp(['Notes/a.md'],['Notes','Archive']));
 assert.deepEqual(org.list('Notes',0).entries,[{path:'Notes/a.md',kind:'file'}]);
 if(aliasResolves()){
  // NTFS/APFS: the alias is the same folder; list the canonical spelling.
  assert.deepEqual(org.list('notes',0).entries,[{path:'Notes/a.md',kind:'file'}]);
  assert.deepEqual(org.list('NOTES',0).entries,[{path:'Notes/a.md',kind:'file'}]);
 }else{
  assert.throws(()=>org.list('notes',0),/allowed vault folder/);
 }
 assert.throws(()=>org.list('Missing',0),/allowed vault folder/);
});

test('list still refuses excluded folders through case and Unicode aliases',()=>{
 const org=makeOrg(makeApp(['Secret/note.md'],['Secret']),'Secret');
 assert.throws(()=>org.list('Secret',0),/allowed vault folder/);
 assert.throws(()=>org.list('secret',0),/allowed vault folder/);
 assert.throws(()=>org.list('ſecret',0),/allowed vault folder/);
});

test('list never falls back through a junction, and filters junction entries',()=>{
 const org=makeOrg(makeApp(['Notes/a.md'],['Notes','Links']));
 // A junction alias is not a directory to lstat — no fallback, refused.
 assert.throws(()=>org.list('junction',0),/allowed vault folder/);
 if(aliasResolves()){
  // The real folder lists, but its junction child is filtered out.
  const entries=org.list('links',0).entries as {path:string}[];
  assert.ok(entries.every(entry=>!entry.path.includes('junction')));
 }
});

test('preview refuses case-fold aliases of excluded destinations (Windows-runnable)',async()=>{
 const org=makeOrg(makeApp(['Notes/a.md'],['Notes','Secret','Archive']),'Secret');
 await assert.rejects(org.preview([{from:'Notes/a.md',to:'secret/a.md'}],'move'),/outside the allowed/);
 await assert.rejects(org.preview([{from:'Notes/a.md',to:'ſecret/a.md'}],'move'),/outside the allowed/);
 const sharp=makeOrg(makeApp(['Notes/a.md','Straße/a.md'],['Notes','Straße']),'Straße');
 // A case-only rename of the same file is refused as non-distinct; a move into
 // the excluded folder's alias is refused as outside the allowed paths.
 await assert.rejects(sharp.preview([{from:'Straße/a.md',to:'STRAẞE/a.md'}],'move'),/distinct|outside the allowed/);
 await assert.rejects(sharp.preview([{from:'Notes/a.md',to:'STRAẞE/a.md'}],'move'),/outside the allowed/);
 const ok=await org.preview([{from:'Notes/a.md',to:'Archive/a.md'}],'move');
 assert.deepEqual(ok.moves,[{from:'Notes/a.md',to:'Archive/a.md'}]);
});

test('the pre-folded move-root comparison catches case and Unicode link aliases',async()=>{
 // A link spelled as a case alias of the move root must still mark the note
 // affected — under() folds, and the round-1 pre-fold must fold identically.
 const org=makeOrg(makeApp(['Notes/a.md','Other/b.md'],['Notes','Other','Archive'],{'Other/b.md':{'NOTES/a.md':1}}));
 const review=await org.preview([{from:'Notes/a.md',to:'Archive/a.md'}],'move');
 assert.deepEqual(review.affected,['Notes/a.md','Other/b.md']);
 const control=makeOrg(makeApp(['Notes/a.md','Other/b.md'],['Notes','Other','Archive'],{'Other/b.md':{'Elsewhere/c.md':1}}));
 assert.deepEqual((await control.preview([{from:'Notes/a.md',to:'Archive/a.md'}],'move')).affected,['Notes/a.md']);
 const unicode=makeOrg(makeApp(['Straße/a.md','Other/b.md'],['Straße','Other','Archive'],{'Other/b.md':{'STRAẞE/a.md':1}}));
 assert.deepEqual((await unicode.preview([{from:'Straße/a.md',to:'Archive/a.md'}],'move')).affected,['Other/b.md','Straße/a.md']);
});

test('under() stays equality-or-prefix: sibling folders do not overlap',async()=>{
 const org=makeOrg(makeApp(['Notes/a.md'],['Notes','Archive']));
 // 'Notes2' shares the 'Notes' prefix but is not under it — no overlap error.
 const ok=await org.preview([{from:'Notes/a.md',to:'Notes2/a.md'}],'move');
 assert.deepEqual(ok.folders,['Notes2']);
 // A genuine containment (case-folded) is still refused as overlapping.
 await assert.rejects(org.preview([{from:'Notes',to:'Archive/X'},{from:'Notes/a.md',to:'Archive/Y'}],'move'),/overlapping/);
});
