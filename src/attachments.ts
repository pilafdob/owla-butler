import {unzip} from 'fflate';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm,readdir,copyFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';

const execute = promisify(execFile);
export interface ConvertedAttachment {text:string;image?:Uint8Array;notice?:string;}
const textLimit = 64000;
function bounded(text:string):string {
 return text.length>textLimit ? text.slice(0,textLimit)+'\n[Document shortened to 64,000 characters.]' : text;
}
export async function archiveParts(data:Uint8Array):Promise<Record<string,Uint8Array>> {
 let total = 0;
 return new Promise((resolve,reject) => unzip(data,{filter:entry => {
  const wanted = /^(word\/(document|footnotes|endnotes)|ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)|xl\/(sharedStrings|worksheets\/sheet\d+)|content|index)\.xml$/.test(entry.name)
   || /(?:^|\/)(?:preview|thumbnail)\.(?:jpg|jpeg|png|pdf)$/i.test(entry.name);
  if (!wanted) return false;
  total += entry.originalSize;
  if (total>32*1024*1024) return false;
  return true;
 }},(error,parts) => {
  if (error) reject(error);
  else if (total>32*1024*1024) reject(Error('Document contents exceed the conversion budget. Export a smaller section as PDF.'));
  else resolve(parts);
 }));
}
export function officeText(parts:Record<string,Uint8Array>,parse:(xml:string)=>Document):string {
 const names = Object.keys(parts).filter(name=>name.endsWith('.xml')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const shared:string[] = [];
 const sharedXml = parts['xl/sharedStrings.xml'];
 if (sharedXml) {
  const document = parse(new TextDecoder().decode(sharedXml));
  for (const item of Array.from(document.getElementsByTagName('si'))) shared.push(item.textContent??'');
 }
 return bounded(names.filter(name=>name!=='xl/sharedStrings.xml').map(name=>{
  const doc = parse(new TextDecoder().decode(parts[name]));
  if (doc.querySelector('parsererror')) throw Error('The document contains invalid XML.');
  const paragraphs = Array.from(doc.getElementsByTagName('*')).filter(el=>['p','row'].includes(el.localName));
  const lines = paragraphs.map(p=>{
   if (p.localName==='row') return Array.from(p.children).map(cell=>{
    const value = cell.getElementsByTagName('v')[0]?.textContent??cell.textContent??'';
    return cell.getAttribute('t')==='s' ? shared[Number(value)]??value : value;
   }).join('\t');
   if(name==='content.xml')return p.textContent??'';
   return Array.from(p.getElementsByTagName('*')).map(el=>el.localName==='t' ? el.textContent??'' : ['br','tab'].includes(el.localName)?' ':'').join('');
  });
  return '['+name+']\n'+(lines.length?lines.join('\n'):doc.documentElement.textContent??'');
 }).join('\n\n'));
}
async function iworkOffice(file:File,sourcePath:string,signal?:AbortSignal):Promise<Uint8Array> {
 const extension=extname(file.name).toLowerCase();
 const appName=extension==='.pages'?'Pages':extension==='.key'?'Keynote':'Numbers';
 let application='';
 for(const candidate of ['/Applications/'+appName+'.app','/Applications/'+appName+' Creator Studio.app']){
  try {await access(candidate);application=candidate;break;} catch {continue;}
 }
 if(!application)throw Error('Install '+appName+' to extract the full document.');
 const directory=await mkdtemp(join(tmpdir(),'owla-iwork-'));
 try {
  const input=join(directory,'attachment'+extension);
  if(sourcePath)await copyFile(sourcePath,input);else await writeFile(input,new Uint8Array(await file.arrayBuffer()));
  const output=join(directory,extension==='.pages'?'export.docx':extension==='.key'?'export.pptx':'export.xlsx');
  const format=extension==='.pages'?'Microsoft Word':extension==='.key'?'Microsoft PowerPoint':'Microsoft Excel';
  const script='function run(args){const app=Application(args[0]);const doc=app.open(Path(args[1]));try{app.export(doc,{to:Path(args[2]),as:args[3]});}finally{app.close(doc,{saving:"no"});}}';
  await execute('/usr/bin/osascript',['-l','JavaScript','-e',script,application,input,output,format],{signal,timeout:60000,maxBuffer:1024*1024});
  return await readFile(output);
 } finally {await rm(directory,{recursive:true,force:true});}
}
export async function convertFile(file:File,sourcePath:string,parse:(xml:string)=>Document,signal?:AbortSignal):Promise<ConvertedAttachment> {
 signal?.throwIfAborted();
 if(file.size>512*1024*1024)return {text:'This file exceeds the 512 MB conversion budget. Export a smaller section for analysis.',notice:'Content unavailable'};
 const extension = extname(file.name).toLowerCase();
 if(process.platform==='darwin' && /^\.(pages|key|numbers)$/.test(extension)){
  try {const parts=await archiveParts(await iworkOffice(file,sourcePath,signal));const text=officeText(parts,parse);if(text.trim())return {text};}catch { /* Try an embedded or Quick Look preview when native export is unavailable. */ }
 }
 if (/^\.(docx|pptx|xlsx|odt|odp|ods|pages|key|numbers)$/.test(extension)) {
  try {
   const parts = await archiveParts(new Uint8Array(await file.arrayBuffer()));
   if (!/^\.(pages|key|numbers)$/.test(extension)) {
    const text = officeText(parts,parse);
    if (text.trim()) return {text};
   }
   const preview = Object.keys(parts).find(name=>/\.(jpg|jpeg|png)$/i.test(name));
   if (preview) return {text:'Embedded document preview only. Full document text is unavailable.',image:parts[preview],notice:'Preview only'};
  } catch (error) {
   if (!/^\.(pages|key|numbers)$/.test(extension)) throw error;
  }
 }
 // Inspect a bounded sample before decoding text. Binary input goes to native conversion.
 const sample = new Uint8Array(await file.slice(0,8192).arrayBuffer());
 if (!file.type.startsWith('image/') && !sample.includes(0) && !new TextDecoder('utf-8',{fatal:false}).decode(sample).includes('\uFFFD') && !/^\.(doc|ppt|xls|rtf|pages|key|numbers|heic|heif|tiff?|bmp|gif|avif|png|jpe?g|webp)$/.test(extension)) {
  return {text:bounded(await file.slice(0,256000).text())+(file.size>256000?'\n[Only the first 256 KB were read.]':'')};
 }
 if (process.platform!=='darwin') return {text:'This binary file could not be converted on this platform.',notice:'Content unavailable'};
 const directory = await mkdtemp(join(tmpdir(),'owla-convert-'));
 try {
  const input = join(directory,'attachment'+extension);
  if (sourcePath) await copyFile(sourcePath,input);
  else await writeFile(input,new Uint8Array(await file.arrayBuffer()));
  if (/^\.(doc|rtf|rtfd|html?)$/.test(extension)) {
   const result = await execute('/usr/bin/textutil',['-convert','txt','-stdout',input],{signal,timeout:60000,maxBuffer:4*1024*1024});
   return {text:bounded(result.stdout)};
  }
  if (file.type.startsWith('image/') || /^\.(heic|heif|tiff?|bmp|gif|avif|png|jpe?g|webp)$/.test(extension)) {
   const output = join(directory,'image.png');
   try {
    await execute('/usr/bin/sips',['-s','format','png','-Z','2048',input,'--out',output],{signal,timeout:60000,maxBuffer:1024*1024});
    return {text:'Image converted locally to PNG.',image:await readFile(output)};
   } catch {signal?.throwIfAborted();}

  }
  await execute('/usr/bin/qlmanage',['-t','-s','2048','-o',directory,input],{signal,timeout:15000,maxBuffer:1024*1024});
  const preview = (await readdir(directory)).find(name=>name.endsWith('.png'));
  if (preview) return {text:'Quick Look preview only. Other pages and underlying data have not been read.',image:await readFile(join(directory,preview)),notice:'Preview only'};
  return {text:'No readable preview or text is available for this file.',notice:'Content unavailable'};
 } catch {
  return {text:'This file was attached, but local conversion could not read its contents. Export it as PDF, text or an image for analysis.',notice:'Content unavailable'};
 } finally {
  await rm(directory,{recursive:true,force:true});
 }
}
