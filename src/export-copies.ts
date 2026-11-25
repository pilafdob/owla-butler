/**
 * The record of OWLA's temporary PDF-export copies, kept in OWLA's private
 * vault storage. A copy normally lives for one export and is deleted at once;
 * if Obsidian quits or crashes mid-export, the record lets the next load
 * remove it. A copy is deleted only when its path is recorded and its text is
 * still exactly what OWLA wrote (SHA-256), never by matching a name pattern:
 * a note the user created, renamed or edited is kept.
 */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {retryLocked} from './fs-retry';
import {record} from './validation';

const FILE='export-copies.json';
const MAX_ENTRIES=50;
export type ExportCopyRecord={path:string;sha256:string};

export const textDigest=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');

export function loadExportCopies(root:string):ExportCopyRecord[]{
 let raw:unknown;
 try{raw=JSON.parse(readFileSync(join(root,FILE),'utf8'));}catch{return [];}
 if(!Array.isArray(raw))return [];
 return raw.flatMap(entry=>{
  const item=record(entry);
  return typeof item.path==='string'&&typeof item.sha256==='string'&&/^[a-f0-9]{64}$/.test(item.sha256)?[{path:item.path,sha256:item.sha256}]:[];
 }).slice(-MAX_ENTRIES);
}

function save(root:string,entries:ExportCopyRecord[]){
 const file=join(root,FILE);
 if(!entries.length){try{retryLocked(()=>{if(existsSync(file))unlinkSync(file);});}catch{/* The next load forgets missing entries. */}return;}
 mkdirSync(root,{recursive:true,mode:0o700});
 const temp=file+'.tmp-'+randomUUID().slice(0,8);
 try{
  writeFileSync(temp,JSON.stringify(entries.slice(-MAX_ENTRIES)),{mode:0o600,flag:'wx'});
  retryLocked(()=>renameSync(temp,file));
 }finally{try{if(existsSync(temp))unlinkSync(temp);}catch{/* A locked temp file is harmless. */}}
}

/** Records (or updates) the text OWLA wrote to an export copy. */
export function recordExportCopy(root:string,path:string,text:string):void{
 save(root,[...loadExportCopies(root).filter(entry=>entry.path!==path),{path,sha256:textDigest(text)}]);
}

/** Forgets an export copy once it is deleted. */
export function forgetExportCopy(root:string,path:string):void{
 const entries=loadExportCopies(root);
 if(entries.some(entry=>entry.path===path))save(root,entries.filter(entry=>entry.path!==path));
}

/**
 * Removes the recorded copies a previous session left behind. read returns a
 * file's current text (null when it is gone); remove deletes it. Every entry
 * is forgotten afterwards (deleted, already gone, or kept because it changed),
 * except an unchanged copy whose deletion failed, which the next load retries.
 * Returns the deleted paths.
 */
export async function sweepExportCopies(root:string,read:(path:string)=>Promise<string|null>,remove:(path:string)=>Promise<void>):Promise<string[]>{
 const entries=loadExportCopies(root),removed:string[]=[],retry:ExportCopyRecord[]=[];
 for(const entry of entries){
  let text:string|null;
  try{text=await read(entry.path);}catch{continue;}
  if(text===null||textDigest(text)!==entry.sha256)continue;
  try{await remove(entry.path);removed.push(entry.path);}catch{retry.push(entry);}
 }
 if(entries.length)save(root,retry);
 return removed;
}
