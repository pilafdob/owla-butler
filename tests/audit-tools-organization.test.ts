// RC hardening: previewing a deletion no longer double-reads closed notes; the
// unsaved-changes guard still fires for notes open in an editor.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stubObsidian} from './helpers/load-main';

stubObsidian();

async function setup(openLeaves:unknown[],editorText:string,savedText:string){
 const {Organization}=await import('../src/organization');
 const vault=await mkdtemp(join(tmpdir(),'owla-org-vault-'));
 const storage=await mkdtemp(join(tmpdir(),'owla-org-store-'));
 await writeFile(join(vault,'note.md'),savedText);
 const file={path:'note.md',name:'note.md',extension:'md'};
 let reads=0,vaultReads=0;
 const app={
  vault:{
   getAbstractFileByPath:(path:string)=>path==='note.md'?file:null,
   getFileByPath:(path:string)=>path==='note.md'?file:null,
   read:async()=>{vaultReads++;return savedText;},
  },
  workspace:{getLeavesOfType:(type:string)=>type==='markdown'?openLeaves:[]},
  metadataCache:{resolvedLinks:{}},
 };
 const org=new Organization(app as never,()=>storage,()=>vault,()=>true,()=>'',()=>true,()=>true,
  async()=>{reads++;return editorText;},async()=>{});
 return {org,counters:()=>({reads,vaultReads}),cleanup:async()=>{await rm(vault,{recursive:true,force:true});await rm(storage,{recursive:true,force:true});}};
}

test('organization: a closed note is not read at all when previewing deletion',async()=>{
 const s=await setup([],'saved','saved');
 try{
  const review=await s.org.previewRemoval('note.md','tidy');
  assert.equal(review.path,'note.md');
  assert.deepEqual(s.counters(),{reads:0,vaultReads:0});
 }finally{await s.cleanup();}
});

test('organization: an open note with unsaved changes still blocks deletion',async()=>{
 const s=await setup([{view:{file:{path:'note.md'}}}],'unsaved','saved');
 try{
  await assert.rejects(()=>s.org.previewRemoval('note.md','tidy'),/Save open changes/);
  assert.deepEqual(s.counters(),{reads:1,vaultReads:1});
 }finally{await s.cleanup();}
});

test('organization: an open note matching its saved text passes with one comparison',async()=>{
 const s=await setup([{view:{file:{path:'note.md'}}}],'saved','saved');
 try{
  await s.org.previewRemoval('note.md','tidy');
  assert.deepEqual(s.counters(),{reads:1,vaultReads:1});
 }finally{await s.cleanup();}
});
