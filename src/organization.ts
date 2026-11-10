import {App,TFile,TFolder,parseLinktext} from 'obsidian';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {allowedPath} from './core';
import {record} from './validation';

export type PathMove={from:string;to:string};
export type OrganizationReview={
 moves:PathMove[];
 reason:string;
 folders:string[];
 affected:string[];
 fingerprint:string;
};
type Progress={
 completed:number;
 created:string[];
 before:Record<string,string>;
 checkpoint:string;
 error?:string;
};
type Journal={review:OrganizationReview;progress?:Progress};
const maxBytes=10_000_000;
const key=(path:string)=>path.normalize('NFC').toLowerCase();
const under=(path:string,root:string)=>key(path)===key(root)||key(path).startsWith(key(root)+'/');
const parent=(path:string)=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';
const short=(path:string)=>key(path.split('/').at(-1)??'').replace(/\.md$/,'');
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function decodeMoves(value:unknown):PathMove[]{
 if(!Array.isArray(value)||!value.length||value.length>100)throw Error('Provide between 1 and 100 path changes.');
 return (value as unknown[]).map(item=>{
  const {from,to}=record(item);
  if(typeof from!=='string'||typeof to!=='string'||!validPath(from)||!validPath(to)){
   throw Error('Use complete vault-relative source and destination paths.');
  }
  return {from,to};
 });
}

function validPath(path:string){
 return allowedPath(path,'',null)&&!/[\p{Cc}:*?"<>|]/u.test(path);
}

function strings(value:unknown):value is string[]{
 return Array.isArray(value)&&value.every(item=>typeof item==='string');
}

export class Organization {
 private journal:Journal|null=null;
 busy=false;
 loadError='';
 constructor(
  private app:App,
  private storage:()=>string,
  private base:()=>string|null,
  private allowed:(path:string)=>boolean,
  private excluded:()=>string,
  private linkUpdates:()=>boolean,
  private read:(path:string)=>Promise<string>,
  private restore:(path:string,expected:string,text:string)=>Promise<void>
 ){}
 get review(){return this.journal?.review;}
 get progress(){return this.journal?.progress;}
 get blocked(){return !!(this.journal||this.busy||this.loadError);}
 private file(){return join(this.storage(),'pending-organization.json');}

 load(){
  try{
   if(!existsSync(this.file()))return;
   if(statSync(this.file()).size>maxBytes)throw Error('Organization journal exceeds its storage limit.');
   const data=record(JSON.parse(readFileSync(this.file(),'utf8')));
   const {moves,reason,folders,affected,fingerprint}=record(data.review);
   if(typeof reason!=='string'||!strings(folders)||!strings(affected)||typeof fingerprint!=='string')throw Error('Invalid organization review.');
   const review={moves:decodeMoves(moves),reason,folders,affected,fingerprint};
   if(data.progress===undefined){this.journal={review};return;}
   const {completed,created,before,checkpoint,error}=record(data.progress);
   if(typeof completed!=='number'||!Number.isInteger(completed)||completed<0||completed>review.moves.length||!strings(created)||typeof checkpoint!=='string'){
    throw Error('Invalid organization progress.');
   }
   const originals=Object.entries(record(before));
   if(originals.some(([path,text])=>!affected.includes(path)||typeof text!=='string'))throw Error('Invalid organization backup.');
   this.journal={review,progress:{
    completed,created,before:Object.fromEntries(originals) as Record<string,string>,checkpoint,
    error:typeof error==='string'?error:'Organization was interrupted. Check the recorded paths before continuing.'
   }};
  }catch(error){this.loadError=error instanceof Error?error.message:String(error);}
 }

 private save(next:Journal|null){
  if(!next){
   rmSync(this.file(),{force:true});
   this.journal=null;
   return;
  }
  const data=JSON.stringify(next);
  if(Buffer.byteLength(data)>maxBytes)throw Error('This batch exceeds the organization journal limit. Review a smaller batch.');
  mkdirSync(this.storage(),{recursive:true,mode:0o700});
  const temporary=this.file()+'.'+randomUUID()+'.tmp';
  try{
   writeFileSync(temporary,data,{mode:0o600,flag:'wx'});
   renameSync(temporary,this.file());
   this.journal=next;
  }finally{rmSync(temporary,{force:true});}
 }

 list(folder:string,offset:number){
  if(folder&&(!this.allowed(folder)||!this.app.vault.getFolderByPath(folder)))throw Error('Choose an allowed vault folder.');
  if(!Number.isSafeInteger(offset)||offset<0)throw Error('Use a nonnegative listing offset.');
  const root=folder?this.app.vault.getFolderByPath(folder)!:this.app.vault.getRoot();
  const entries=root.children.filter(entry=>this.safeSource(entry.path))
   .map(entry=>({path:entry.path,kind:entry instanceof TFolder?'folder':'file'}))
   .sort((a,b)=>a.path.localeCompare(b.path));
  return {entries:entries.slice(offset,offset+50),nextOffset:offset+50<entries.length?offset+50:null};
 }

 private stat(path:string){
  const base=this.base();
  if(!base)throw Error('Organization requires a desktop vault.');
  return lstatSync(join(base,path),{throwIfNoEntry:false});
 }

 private safeSource(path:string){
  if(!this.allowed(path))return false;
  for(let current=path;current;current=parent(current)){
   if(this.stat(current)?.isSymbolicLink())return false;
  }
  return true;
 }

 private tree(path:string):string[][]{
  const result:string[][]=[];
  const base=this.base();
  if(!base)throw Error('Organization requires a desktop vault.');
  const visit=(current:string)=>{
   const stat=this.stat(current);
   if(result.length>=5000)throw Error('This folder has too many entries for one review.');
   if(!stat||stat.isSymbolicLink()||!this.allowed(current))throw Error('A source contains an excluded, missing or symbolic-link entry.');
   result.push([current,String(stat.dev),String(stat.ino),stat.isDirectory()?'folder':String(stat.size),stat.isDirectory()?'':String(stat.mtimeMs)]);
   if(stat.isDirectory())for(const child of readdirSync(join(base,current)).sort())visit(current+'/'+child);
  };
  visit(path);
  return result;
 }

 private assertAllowedDestination(path:string){
  if(!allowedPath(path,this.excluded(),null))throw Error('A destination is outside the allowed vault paths.');
  for(let folder=parent(path);folder;folder=parent(folder)){
   const stat=this.stat(folder);
   if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()||!this.allowed(folder)))throw Error('A destination folder is blocked or unsafe.');
  }
 }

 async preview(moves:PathMove[],reason:string):Promise<OrganizationReview>{
  const folders=new Set<string>();
  const sources:string[][]=[];
  const movedNames=new Set<string>();
  const occupied=new Set([...this.app.vault.getFiles(),...this.app.vault.getAllFolders()].map(entry=>key(entry.path)));
  for(const [index,move] of moves.entries()){
   const {from,to}=move;
   if(under(from,to)||under(to,from))throw Error('Source and destination paths must be distinct and cannot contain one another.');
   for(const other of moves.slice(0,index)){
    if([from,to].some(path=>[other.from,other.to].some(previous=>under(path,previous)||under(previous,path)))){
     throw Error('Split overlapping paths and dependent renames into separate proposals.');
    }
   }
   const file=this.app.vault.getAbstractFileByPath(from);
   if(!(file instanceof TFile||file instanceof TFolder)||!this.safeSource(from))throw Error('A source no longer exists, is excluded or uses a symbolic link.');
   if(file instanceof TFile&&shortExtension(from)!==shortExtension(to))throw Error('Preserve the original file extension.');
   this.assertAllowedDestination(to);
   if(this.stat(to)||occupied.has(key(to)))throw Error('A destination already exists: '+to);
   for(let folder=parent(to);folder&&!this.stat(folder);folder=parent(folder)){
    if(occupied.has(key(folder)))throw Error('A destination folder conflicts by capitalization: '+folder);
    folders.add(folder);
   }
   for(const entry of this.tree(from)){
    const path=entry[0],destination=to+path.slice(from.length);
    if(!allowedPath(destination,this.excluded(),null))throw Error('A descendant would move into an excluded path.');
    if(sources.length>=5000)throw Error('This batch has too many source entries for one review.');
    sources.push(entry);
    movedNames.add(short(path));
    movedNames.add(short(destination));
   }
  }
  const targetFolders=[...folders].sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b));
  if(new Set(targetFolders.map(key)).size!==targetFolders.length)throw Error('Destination folders conflict by capitalization.');
  const affected:string[]=[];
  const noteFingerprints:string[]=[];
  for(const note of this.app.vault.getMarkdownFiles().sort((a,b)=>a.path.localeCompare(b.path))){
   const cached=this.app.metadataCache.getFileCache(note);
   if(!cached&&note.stat.size)throw Error('Obsidian is still indexing notes. Retry the organization preview after indexing.');
   const references=[...(cached?.links??[]),...(cached?.embeds??[]),...(cached?.frontmatterLinks??[])];
   const resolved=this.app.metadataCache.resolvedLinks[note.path]??{};
   const potentiallyChanged=moves.some(move=>under(note.path,move.from)||Object.keys(resolved).some(target=>under(target,move.from)))
    ||references.some(reference=>movedNames.has(short(parseLinktext(reference.link).path)));
   if(!potentiallyChanged)continue;
   if(!this.safeSource(note.path))throw Error('Obsidian could update links in an excluded note or through a symbolic link. Review a smaller or different batch.');
   affected.push(note.path);
   const text=await this.read(note.path);
   if(text!==await this.app.vault.read(note))throw Error('Save open changes before reviewing organization: '+note.path);
   noteFingerprints.push(hash([text,references.map(ref=>ref.link),resolved]));
  }
  const fingerprint=hash([moves,sources,targetFolders,affected,noteFingerprints]);
  return {moves,reason,folders:targetFolders,affected,fingerprint};
 }

 stage(review:OrganizationReview){
  if(this.blocked)throw Error('Resolve the existing organization review first.');
  this.save({review});
 }
 async refresh(){
  const review=this.review;
  if(!review||this.progress||this.busy)throw Error('This proposal is no longer available.');
  const refreshed=await this.preview(review.moves,review.reason);
  if(this.review!==review||this.busy)throw Error('This proposal changed.');
  this.save({review:refreshed});
  return refreshed;
 }
 decline(){
  if(this.busy||this.progress)throw Error('Review the organization recovery record first.');
  this.save(null);
 }
 acknowledgeRecovery(){
  if(!this.progress||this.busy)return;
  renameSync(this.file(),join(this.storage(),'organization-recovery-'+randomUUID()+'.json'));
  this.journal=null;
 }

 private async checkpoint(review:OrganizationReview,completed:number){
  const applied=review.moves.slice(0,completed);
  const notes:Record<string,string>=Object.create(null) as Record<string,string>;
  for(const original of review.affected){
   const move=applied.find(item=>under(original,item.from));
   const current=move?move.to+original.slice(move.from.length):original;
   notes[current]=await this.read(current);
  }
  const paths=review.moves.map((move,index)=>{
   const current=index<completed?move.to:move.from;
   const unused=index<completed?move.from:move.to;
   return [this.tree(current),!!this.stat(unused)];
  });
  return {notes,digest:hash([notes,paths,review.folders.map(folder=>this.stat(folder)?.ino??null)])};
 }

 private async move(from:string,to:string){
  this.assertAllowedDestination(to);
  const source=this.app.vault.getAbstractFileByPath(from);
  if(!source||!this.safeSource(from)||this.stat(to)||this.app.vault.getAbstractFileByPath(to))throw Error('Source or destination changed: '+from+' → '+to);
  if(!this.linkUpdates())throw Error('Enable Automatically update internal links in Obsidian settings first.');
  await this.app.fileManager.renameFile(source,to);
  if(source.path!==to)throw Error('Obsidian did not complete the path change.');
 }

 async accept(review:OrganizationReview){
  if(this.review!==review||this.busy||this.progress)throw Error('Open the current organization preview before accepting.');
  this.busy=true;
  let progress:Progress|undefined;
  try{
   if(!this.linkUpdates())throw Error('Enable Automatically update internal links in Obsidian settings first.');
   const fresh=await this.preview(review.moves,review.reason);
   if(fresh.fingerprint!==review.fingerprint)throw Error('The vault changed. Open the review again to see the updated diff.');
   const initial=await this.checkpoint(review,0);
   // Record the original Markdown before any approved vault writes.
   progress={completed:0,created:[],before:initial.notes,checkpoint:initial.digest};
   this.save({review,progress});
   for(const folder of review.folders){
    this.assertAllowedDestination(folder);
    if(this.stat(folder))throw Error('A destination folder already exists: '+folder);
    await this.app.vault.createFolder(folder);
    progress.created.push(folder);
    progress.checkpoint=(await this.checkpoint(review,progress.completed)).digest;
    this.save({review,progress});
   }
   for(const {from,to} of review.moves){
    if((await this.checkpoint(review,progress.completed)).digest!==progress.checkpoint)throw Error('The vault changed during organization.');
    await this.move(from,to);
    progress.completed++;
    progress.checkpoint=(await this.checkpoint(review,progress.completed)).digest;
    this.save({review,progress});
   }
   this.save(null);
  }catch(error){
   if(!progress||!this.progress)throw error;
   try{
    await this.rollback(review,progress);
    this.save({review});
   }catch(recoveryError){
    progress.error='Automatic recovery paused. '+(recoveryError instanceof Error?recoveryError.message:String(recoveryError));
    this.save({review,progress});
    throw Error(progress.error);
   }
   throw Error('Organization failed and the recorded changes were reversed. '+(error instanceof Error?error.message:String(error)));
  }finally{this.busy=false;}
 }

 private async rollback(review:OrganizationReview,progress:Progress){
  if((await this.checkpoint(review,progress.completed)).digest!==progress.checkpoint)throw Error('Paths or note text changed after the last recorded step.');
  while(progress.completed){
   const move=review.moves[progress.completed-1];
   await this.move(move.to,move.from);
   progress.completed--;
   progress.checkpoint=(await this.checkpoint(review,progress.completed)).digest;
   this.save({review,progress});
  }
  const {notes}=await this.checkpoint(review,0);
  for(const [path,before] of Object.entries(progress.before)){
   if(notes[path]!==before)await this.restore(path,notes[path],before);
  }
  for(const path of [...progress.created].reverse()){
   const folder=this.app.vault.getFolderByPath(path);
   const base=this.base();
   if(!folder||!base||readdirSync(join(base,path)).length)throw Error('A created folder is no longer empty.');
   await this.app.fileManager.trashFile(folder);
  }
 }
}
function shortExtension(path:string){
 const name=path.split('/').at(-1)??'';
 const dot=name.lastIndexOf('.');
 return dot<0?'':name.slice(dot).toLowerCase();
}
