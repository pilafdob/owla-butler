import {mkdirSync,readFileSync,writeFileSync,readdirSync,statSync,unlinkSync,existsSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EditBatch,Proposal} from './core';
import {record} from './validation';
export function backupEdit(root:string,edit:Proposal):void{
 const dir=join(root,'edit-backups');mkdirSync(dir,{recursive:true,mode:0o700});
 const data=JSON.stringify({created:new Date().toISOString(),path:edit.path,before:edit.before},null,2);if(Buffer.byteLength(data)>5_000_000)throw Error('This note is too large for a safe local edit backup. Edit a smaller note.');
 const file=join(dir,Date.now()+'-'+randomUUID()+'.json');writeFileSync(file,data,{mode:0o600,flag:'wx'});
 const files=readdirSync(dir).filter(f=>/^\d+-[a-f\d-]+\.json$/.test(f)).sort().reverse();let bytes=0;
 for(let i=0;i<files.length;i++){const p=join(dir,files[i]);bytes+=statSync(p).size;if(i>0&&(i>=20||bytes>5_000_000))unlinkSync(p);}
}
export function rotateLog(path:string):void{if(existsSync(path)&&statSync(path).size>1_000_000){if(existsSync(path+'.previous'))unlinkSync(path+'.previous');renameSync(path,path+'.previous');}}


const MAX_PENDING_BYTES = 10_000_000;

export function loadPendingEdits(root:string):EditBatch[] {
 const file = join(root, 'pending-edits.json');
 if (!existsSync(file)) return [];
 if (statSync(file).size > MAX_PENDING_BYTES) throw Error('The pending edit record is too large.');
 const data:unknown = JSON.parse(readFileSync(file, 'utf8'));
 if (!Array.isArray(data)) throw Error('The pending edit record is invalid.');

 const edits:EditBatch[] = [];
 const paths = new Set<string>();
 for (const value of data as unknown[]) {
  const entry = record(value);
  const {path,before,after,reason} = record(entry.edit);
  const reasons:unknown[] = Array.isArray(entry.reasons) ? entry.reasons : [];
  if (typeof path !== 'string' || typeof before !== 'string' || typeof after !== 'string' ||
      typeof reason !== 'string' || !reasons.length || !reasons.every(item => typeof item === 'string') ||
      paths.has(path)) {
   throw Error('The pending edit record is invalid.');
  }
  paths.add(path);
  edits.push({edit:{path,before,after,reason},reasons});
 }
 return edits;
}

export function savePendingEdits(root:string, edits:EditBatch[]):void {
 const data = JSON.stringify(edits);
 if (Buffer.byteLength(data) > MAX_PENDING_BYTES) throw Error('There is too much pending edit text to save safely.');
 mkdirSync(root, {recursive:true,mode:0o700});
 const file = join(root,'pending-edits.json');
 const temp = file+'.'+randomUUID()+'.tmp';
 try {
  writeFileSync(temp,data,{mode:0o600,flag:'wx'});
  renameSync(temp,file);
 } finally {
  if (existsSync(temp)) unlinkSync(temp);
 }
}
