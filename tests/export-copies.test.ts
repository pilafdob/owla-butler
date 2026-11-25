// A PDF-export copy left behind by a crash or quit is removed on the next load,
// but only when its path is recorded and its text is exactly what OWLA wrote.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {forgetExportCopy,loadExportCopies,recordExportCopy,sweepExportCopies,textDigest} from '../src/export-copies';

const temp=()=>mkdtempSync(join(tmpdir(),'owla-export-copies-'));

test('the record keeps one entry per path with the latest text and forgets on request',()=>{
 const root=temp();
 try{
  recordExportCopy(root,'A (OWLA PDF export).md','one');
  recordExportCopy(root,'A (OWLA PDF export).md','two');
  recordExportCopy(root,'B (OWLA PDF export).md','b');
  assert.deepEqual(loadExportCopies(root),[{path:'A (OWLA PDF export).md',sha256:textDigest('two')},{path:'B (OWLA PDF export).md',sha256:textDigest('b')}]);
  forgetExportCopy(root,'A (OWLA PDF export).md');
  forgetExportCopy(root,'B (OWLA PDF export).md');
  assert.deepEqual(loadExportCopies(root),[]);
  assert.deepEqual(readdirSync(root),[],'an empty record leaves no file');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a damaged record reads as empty and never deletes anything',async()=>{
 const root=temp();
 try{
  writeFileSync(join(root,'export-copies.json'),'{not json');
  assert.deepEqual(loadExportCopies(root),[]);
  writeFileSync(join(root,'export-copies.json'),JSON.stringify([{path:'x.md',sha256:'short'},{path:3,sha256:textDigest('a')}]));
  const removed:string[]=[];
  assert.deepEqual(await sweepExportCopies(root,async()=>'a',async path=>{removed.push(path);}),[]);
  assert.deepEqual(removed,[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the sweep deletes only unchanged recorded copies, keeps edited or replaced notes, and retries a failed delete',async()=>{
 const root=temp();
 try{
  const files:Record<string,string>={'Same (OWLA PDF export).md':'copy','Edited (OWLA PDF export).md':'user edited this','Locked (OWLA PDF export).md':'locked copy','Unrecorded (OWLA PDF export).md':'copy'};
  recordExportCopy(root,'Same (OWLA PDF export).md','copy');
  recordExportCopy(root,'Edited (OWLA PDF export).md','copy');
  recordExportCopy(root,'Gone (OWLA PDF export).md','copy');
  recordExportCopy(root,'Locked (OWLA PDF export).md','locked copy');
  const read=async(path:string)=>files[path]??null;
  const remove=async(path:string)=>{if(path.startsWith('Locked'))throw Object.assign(Error('locked'),{code:'EBUSY'});delete files[path];};
  assert.deepEqual(await sweepExportCopies(root,read,remove),['Same (OWLA PDF export).md']);
  assert.deepEqual(Object.keys(files).sort(),['Edited (OWLA PDF export).md','Locked (OWLA PDF export).md','Unrecorded (OWLA PDF export).md'],'edited and unrecorded notes are kept');
  assert.deepEqual(loadExportCopies(root).map(entry=>entry.path),['Locked (OWLA PDF export).md'],'only the failed delete is retried');
  assert.deepEqual(await sweepExportCopies(root,read,async path=>{delete files[path];}),['Locked (OWLA PDF export).md']);
  assert.deepEqual(loadExportCopies(root),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
