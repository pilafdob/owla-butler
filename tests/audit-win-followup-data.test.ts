import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadMain} from './helpers/load-main';
import {convertFile,attachmentTextEncoding} from '../src/attachments';

test('UTF-8 detection tolerates a sample boundary inside a multibyte character',async()=>{
 const text='a'.repeat(8191)+'é tail';
 const result=await convertFile(new File([text],'sample.txt',{type:'text/plain'}),'',()=>{throw Error('not XML');});
 assert.equal(result.text,text);
 assert.equal(attachmentTextEncoding(new Uint8Array([0xc3,0x28]),'.bin',''),null,'real malformed UTF-8 stays refused');
 assert.equal(attachmentTextEncoding(new Uint8Array([0xc3]),'.bin',''),null,'an incomplete final file is malformed');
});
/* eslint-disable @typescript-eslint/no-explicit-any */
let Butler:any,ButlerView:any,obsidian:any,scratch:string;
before(async()=>{({Butler,ButlerView,obsidian}=await loadMain());scratch=mkdtempSync(join(tmpdir(),'owla-followup-data-'));});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});
function fixture(path='Notes/A.md',saved='alpha\r\nbeta\r\ngamma'){
 const root=join(scratch,String(Math.random()));mkdirSync(join(root,'Notes'),{recursive:true});writeFileSync(join(root,path),saved);
 const file=new obsidian.TFile(path);file.stat={size:saved.length,mtime:1};let text=saved.replace(/\r\n?|\n/g,'\n');
 const editor={getValue:()=>text,offsetToPos:(offset:number)=>{const lines=text.slice(0,offset).split('\n');return {line:lines.length-1,ch:lines.at(-1)!.length};},replaceRange:(insert:string,start:any,end:any)=>{const offset=(p:any)=>text.split('\n').slice(0,p.line).reduce((n:number,line:string)=>n+line.length+1,0)+p.ch;text=(text.slice(0,offset(start))+insert+text.slice(offset(end))).replace(/\r\n?/g,'\n');}};
 const markdown=Object.assign(new obsidian.MarkdownView(),{file,editor});const leaves:Record<string,any[]>={markdown:[{view:markdown}]};
 const app={vault:{adapter:new obsidian.FileSystemAdapter(root),getName:()=>'test',getFiles:()=>[file],getFileByPath:(p:string)=>p===path?file:null,getAbstractFileByPath:(p:string)=>p===path?file:null,cachedRead:async()=>saved,process:async()=>{throw Error('must use unsaved editor');}},workspace:{getLeavesOfType:(type:string)=>leaves[type]??[],getActiveViewOfType:()=>null,getActiveFile:()=>null}};
 const butler=new Butler(app,{id:'owla-butler',version:'test'});butler.app=app;butler.prefs.storageRoot=join(root,'storage');butler.organization={blocked:false,busy:false,loadError:''};
 return {butler,app,file,leaves,editor};
}
test('CRLF replacements apply and decline using normalized editor offsets',async()=>{
 const {butler,editor}=fixture();const edit={path:'Notes/A.md',before:'alpha\r\nbeta\r\ngamma',after:'alpha\r\nBETA\r\ngamma',reason:'test'};
 await butler.apply(edit);assert.equal(editor.getValue(),'alpha\nBETA\ngamma');
 await butler.restoreEdit(edit);assert.equal(editor.getValue(),'alpha\nbeta\ngamma');
});
