import {mkdirSync,writeFileSync,readdirSync,statSync,unlinkSync,existsSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Proposal} from './core';
export function backupEdit(root:string,edit:Proposal):void{
 const dir=join(root,'edit-backups');mkdirSync(dir,{recursive:true,mode:0o700});
 const data=JSON.stringify({created:new Date().toISOString(),path:edit.path,before:edit.before},null,2);if(Buffer.byteLength(data)>5_000_000)throw Error('This note is too large for a safe local edit backup. Edit a smaller note.');
 const file=join(dir,Date.now()+'-'+randomUUID()+'.json');writeFileSync(file,data,{mode:0o600,flag:'wx'});
 const files=readdirSync(dir).filter(f=>/^\d+-[a-f\d-]+\.json$/.test(f)).sort().reverse();let bytes=0;
 for(let i=0;i<files.length;i++){const p=join(dir,files[i]);bytes+=statSync(p).size;if(i>0&&(i>=20||bytes>5_000_000))unlinkSync(p);}
}
export function rotateLog(path:string):void{if(existsSync(path)&&statSync(path).size>1_000_000){if(existsSync(path+'.previous'))unlinkSync(path+'.previous');renameSync(path,path+'.previous');}}
