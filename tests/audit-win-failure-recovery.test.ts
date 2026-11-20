// Windows failure-handling audit (win-failure): recovery journal and log fs
// behaviour under Windows lock/attribute semantics (EBUSY/EPERM, read-only
// targets), with the fail-closed guarantees of the failure-resilience pass.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,existsSync,mkdtempSync,mkdirSync,readdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadPendingEdits,readPendingRecord,rotateLog,savePendingEdits} from '../src/recovery';

const entry=(path:string)=>({edit:{path,before:'old',after:'new',reason:'r'},reasons:['r']});

test('log rotation never fails the runtime when the previous log is undeletable',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-log-'));
 try{
  const file=join(root,'log');
  writeFileSync(file,'x'.repeat(1_000_001));
  // A directory (or a Defender/OneDrive-locked file) in place of the previous
  // log: unlink/rename throw EPERM/EISDIR/EBUSY. Rotation stays best-effort.
  mkdirSync(file+'.previous');
  assert.doesNotThrow(()=>rotateLog(file));
  assert.equal(statSync(file).size,1_000_001,'the current log is preserved');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a missing journal reads as empty on every host',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-missing-'));
 try{
  assert.deepEqual(readPendingRecord(root),[]);
  assert.deepEqual(loadPendingEdits(root),[]);
  assert.deepEqual(readPendingRecord(join(root,'never-created')),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('an unreadable journal fails closed instead of reading as empty',()=>{
 // A stat failure other than ENOENT must throw: returning [] would let
 // clearPendingEdits delete a journal it never read (the oversized-record
 // data-loss class, via a Windows EBUSY/EPERM lock). On POSIX an unreadable
 // directory produces EACCES; the same branch covers the Windows lock codes.
 if(process.platform==='win32')return; // ACL denial is the Windows analogue
 const root=mkdtempSync(join(tmpdir(),'owla-win-unreadable-'));
 const file=join(root,'pending-edits.json');
 try{
  writeFileSync(file,JSON.stringify([entry('A.md')]));
  chmodSync(root,0o000);
  assert.throws(()=>readPendingRecord(root),/could not be read/);
  assert.throws(()=>loadPendingEdits(root),/could not be read/);
 }finally{
  chmodSync(root,0o700);
  assert.ok(existsSync(file),'the journal survives a read failure');
  rmSync(root,{recursive:true,force:true});
 }
});

test('a read-only journal is still replaced atomically',()=>{
 // Windows refuses to rename onto a read-only target (EPERM) — OneDrive and
 // sync tools set that attribute. The save clears it and retries once.
 const root=mkdtempSync(join(tmpdir(),'owla-win-readonly-'));
 try{
  savePendingEdits(root,[entry('A.md')] as never[]);
  const file=join(root,'pending-edits.json');
  chmodSync(file,0o444);
  savePendingEdits(root,[entry('B.md')] as never[]);
  assert.deepEqual(loadPendingEdits(root).map(batch=>batch.edit.path),['B.md']);
  assert.deepEqual(readdirSync(root).filter(name=>name.endsWith('.tmp')),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the oversized journal still fails closed and survives',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-big-'));
 try{
  const file=join(root,'pending-edits.json');
  writeFileSync(file,'["'+'x'.repeat(10_000_001)+'"]');
  assert.throws(()=>readPendingRecord(root),/too large to recover automatically/);
  assert.throws(()=>loadPendingEdits(root),/too large/);
  assert.ok(existsSync(file));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a journal locked against replacement keeps the cause and no temp file',()=>{
 // A directory in place of the journal cannot be renamed onto (EPERM on
 // Windows, EISDIR/ENOTEMPTY on POSIX); the error names the record.
 const root=mkdtempSync(join(tmpdir(),'owla-win-locked-'));
 try{
  mkdirSync(join(root,'pending-edits.json'));
  assert.throws(()=>savePendingEdits(root,[entry('A.md')] as never[]),/Could not save the pending edit record/);
  assert.deepEqual(readdirSync(root).filter(name=>name.endsWith('.tmp')),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
