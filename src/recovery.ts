import {mkdirSync,readFileSync,writeFileSync,readdirSync,statSync,unlinkSync,existsSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EditBatch,Proposal,allowedEditablePath} from './core';
import {record} from './validation';
export function backupEdit(root:string,edit:Proposal):void{
 const dir=join(root,'edit-backups');mkdirSync(dir,{recursive:true,mode:0o700});
 const data=JSON.stringify({created:new Date().toISOString(),path:edit.path,before:edit.before},null,2);if(Buffer.byteLength(data)>5_000_000)throw Error('This note is too large for a safe local edit backup. Edit a smaller note.');
 const file=join(dir,Date.now()+'-'+randomUUID()+'.json');writeFileSync(file,data,{mode:0o600,flag:'wx'});
 const files=readdirSync(dir).filter(f=>/^\d+-[a-f\d-]+\.json$/.test(f)).sort().reverse();let bytes=0;
 // Retention is best-effort: a locked, vanished or undeletable old backup must
 // not fail the edit itself — the new backup is already on disk.
 for(let i=0;i<files.length;i++){const p=join(dir,files[i]);try{bytes+=statSync(p).size;if(i>0&&(i>=20||bytes>5_000_000))unlinkSync(p);}catch{/* Skip this entry. */}}
}
export function rotateLog(path:string):void{if(existsSync(path)&&statSync(path).size>1_000_000){if(existsSync(path+'.previous'))unlinkSync(path+'.previous');renameSync(path,path+'.previous');}}


const MAX_PENDING_BYTES = 10_000_000;

/**
 * The raw entries of the pending edit record, unvalidated; [] when it is
 * missing or unreadable. An oversized record throws instead of returning []:
 * the recovery flow would otherwise delete a journal it never read, losing
 * the record of which notes carry unreviewed edits.
 */
export function readPendingRecord(root:string):unknown[] {
 const file = join(root, 'pending-edits.json');
 if (!existsSync(file)) return [];
 let size:number;
 try { size = statSync(file).size; } catch { return []; }
 if (size > MAX_PENDING_BYTES) throw Error('The pending edit record is too large to recover automatically. Move or delete '+file+' manually, then reload OWLA Butler.');
 try {
  const data:unknown = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(data) ? data : [];
 } catch { return []; }
}

export function removePendingRecord(root:string):void {
 const file = join(root, 'pending-edits.json');
 try {
  if (existsSync(file)) unlinkSync(file);
 } catch (e) {
  throw Error('Could not remove the pending edit record: '+(e instanceof Error?e.message:String(e)));
 }
}

/**
 * Loads the pending edit record. Every path is checked against the vault
 * rules and the current excluded folders, so a record written before a folder
 * was excluded (or edited by hand) cannot direct an edit into that folder.
 */
export function loadPendingEdits(root:string, excluded = ''):EditBatch[] {
 const file = join(root, 'pending-edits.json');
 if (!existsSync(file)) return [];
 if (statSync(file).size > MAX_PENDING_BYTES) throw Error('The pending edit record is too large.');
 let data:unknown;
 try { data = JSON.parse(readFileSync(file, 'utf8')); }
 catch (e) { throw Error('The pending edit record could not be read: '+(e instanceof Error?e.message:String(e))); }
 if (!Array.isArray(data)) throw Error('The pending edit record is invalid.');

 const edits:EditBatch[] = [];
 const paths = new Set<string>();
 for (const value of data as unknown[]) {
  const entry = record(value);
  const {path,before,after,reason,create} = record(entry.edit);
  const reasons:unknown[] = Array.isArray(entry.reasons) ? entry.reasons : [];
  if (typeof path !== 'string' || typeof before !== 'string' || typeof after !== 'string' ||
      typeof reason !== 'string' || !reasons.length || !reasons.every(item => typeof item === 'string') ||
      paths.has(path) || (entry.deferred!==undefined&&entry.deferred!==true) || (create!==undefined&&(create!==true||before!==''))) {
   throw Error('The pending edit record is invalid.');
  }
  if (!allowedEditablePath(path, excluded)) throw Error('A pending edit path is no longer allowed: ' + path);
  paths.add(path);
  edits.push({edit:{path,before,after,reason,...(create===true?{create:true as const}:{})},reasons,...(entry.deferred===true?{deferred:true as const}:{})});
 }
 return edits;
}

export function savePendingEdits(root:string, edits:EditBatch[]):void {
 const data = JSON.stringify(edits);
 if (Buffer.byteLength(data) > MAX_PENDING_BYTES) throw Error('There is too much pending edit text to save safely.');
 const file = join(root,'pending-edits.json');
 const temp = file+'.'+randomUUID()+'.tmp';
 try {
  mkdirSync(root, {recursive:true,mode:0o700});
  writeFileSync(temp,data,{mode:0o600,flag:'wx'});
  renameSync(temp,file);
 } catch (e) {
  throw Error('Could not save the pending edit record: '+(e instanceof Error?e.message:String(e)));
 } finally {
  try { if (existsSync(temp)) unlinkSync(temp); } catch {/* Best-effort cleanup; never mask the original error. */}
 }
}
