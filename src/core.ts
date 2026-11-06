import {createHash} from 'node:crypto';
import {record} from './validation';
export interface ButlerSettings {schemaVersion:2;codexExecutable:string;model:string;reasoning:string;webSearch:boolean;storageRoot:string;excludedFolders:string;}
export const DEFAULTS:ButlerSettings={schemaVersion:2,codexExecutable:'',model:'',reasoning:'',webSearch:true,storageRoot:'',excludedFolders:''};
export function migrateSettings(value:unknown):ButlerSettings{
 const data=record(value);const string=(key:string)=>typeof data[key]==='string'?data[key]:'';
 return {...DEFAULTS,storageRoot:string('storageRoot'),excludedFolders:string('excludedFolders'),...(data.schemaVersion===2?{codexExecutable:string('codexExecutable'),model:string('model'),reasoning:string('reasoning'),webSearch:data.webSearch!==false}:{})};
}
export function allowedPath(path:string,excluded=''):boolean {
 if(!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')))return false;
 if(!path.toLowerCase().endsWith('.md'))return false;
 return !excluded.split('\n').map(s=>s.trim().replace(/^\/+|\/+$/g,'')).filter(Boolean).some(s=>path===s||path.startsWith(s+'/'));
}
export function clip(text:string,max:number):string {return text.length<=max?text:text.slice(0,max)+'\n[Context shortened. Read a specific passage if needed.]';}
export interface Proposal {path:string;before:string;after:string;reason:string;}
export function proposal(path:string,before:string,oldText:string,newText:string,reason:string,excluded=''):Proposal {
 if(!allowedPath(path,excluded))throw Error('This note is outside the allowed Markdown context.');
 if(newText.length>24000)throw Error('The proposed edit is too large. Make a smaller edit.');
 if(!oldText)return {path,before,after:before+(before.endsWith('\n')?'':'\n')+'\n'+newText,reason};
 const index=before.indexOf(oldText);
 if(index<0)throw Error('The original passage was not found. Read the note again.');
 if(before.indexOf(oldText,index+1)>=0)throw Error('The original passage occurs more than once. Include more surrounding text.');
 if(oldText===newText)throw Error('This edit does not change the note.');
 return {path,before,after:before.slice(0,index)+newText+before.slice(index+oldText.length),reason};
}
export interface EditBatch {
 edit: Proposal;
 reasons: string[];
}

function topHeading(markdown:string) {
 const body = markdown.replace(/^\uFEFF?---[ \t]*\r?\n(?:[^\n]*\n)*?---[ \t]*(?:\r?\n|$)/, '').replace(/^\uFEFF?(?:[ \t]*\r?\n)*/, '');
 const atx = body.match(/^ {0,3}(#{1,6})[ \t]+([^\r\n]+)/);
 if (atx) return {level:atx[1].length, title:atx[2].trim().replace(/[ \t]+#+$/, ''), source:atx[0]};
 const setext = body.match(/^ {0,3}([^\s#>`~][^\r\n]*)\r?\n {0,3}(=+|-+)[ \t]*(?=\r?\n|$)/);
 if (setext && !/^(?:[-+*]|\d+[.)])[ \t]/.test(setext[1])) {
  return {level:setext[2][0]==='=' ? 1 : 2, title:setext[1].trim(), source:setext[0]};
 }
}

export function assertNoteTitle(edit:Proposal, inlineTitle:boolean|undefined):void {
 if (inlineTitle===false) return;
 const before = topHeading(edit.before);
 const after = topHeading(edit.after);
 if (before?.source===after?.source) return;
 const normalize = (title:string) => title.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
 const filename = normalize(edit.path.slice(edit.path.lastIndexOf('/')+1,-3));
 const matchesFilename = (heading:ReturnType<typeof topHeading>) => heading && normalize(heading.title)===filename;
 if (matchesFilename(after)) {
  throw Error('Keep the filename out of the top Markdown heading. Revise the proposal to edit the note body.');
 }
 if (inlineTitle===undefined && (before?.level===1 || after?.level===1 || matchesFilename(before))) {
  throw Error('The inline title setting is unavailable. Preserve the top title and edit the note body.');
 }
}

export function stageProposal(
 snapshot: string,
 change: {path:string;oldText:string;newText:string;reason:string},
 pending?: EditBatch,
 excluded = ''
): EditBatch {
 const {path, oldText, newText, reason} = change;
 const next = proposal(path, pending?.edit.after ?? snapshot, oldText, newText, reason, excluded);
 return {
  edit: {...next, before:pending?.edit.before ?? snapshot},
  reasons: [...(pending?.reasons ?? []), reason]
 };
}

export function assertFresh(current:string,expected:string):void {if(current!==expected)throw Error('The note changed since this proposal. Ask for a fresh edit; your newer text was preserved.');}
export function stripFence(text:string):string {const match=text.trim().match(/^```(?:markdown|md|latex)?\n([\s\S]*?)\n```$/);return (match?match[1]:text.trim()).replace(/\$\$([^\n]*?)\$\$/g,(_all:string,body:string)=>'$$\n'+body.trim()+'\n$$');}
export function formatTranscription(text:string):string {
 return stripFence(text).split('\n').map(line=>{
  if(line.includes('$'))return line;
  const m=line.trim().match(/^(?:([^=:$]{1,40}:)\s*)?([a-zA-Z0-9.+\-*/^(){}[\] \\]+=[a-zA-Z0-9.+\-*/^(){}[\] \\]+)$/);
  if(!m)return line;const equation=m[2].trim();if((equation.match(/[A-Za-z]{5,}/g)??[]).length)return line;
  return (m[1]?m[1]+'\n\n':'')+'$$\n'+equation+'\n$$';
 }).join('\n');
}
export function displayMarkdown(text:string):string {return text.replace(/!\[/g,'[').replace(/<(?:img|iframe|video|audio|source|object|embed|link)\b[^>]*>/gi,'');}
export function insertion(path:string,before:string,content:string,start:number,end=start):Proposal {
 if(start<0||end<start||end>before.length)throw Error('The insertion position is no longer valid.');
 const frontmatter=before.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);if(frontmatter&&start<frontmatter[0].length)throw Error('Place the cursor in the note body, outside Properties, before inserting Markdown.');
 let markdown=stripFence(content);if(markdown.includes('\n')){if(start>0&&before[start-1]!=='\n')markdown='\n\n'+markdown;if(end<before.length&&before[end]!=='\n')markdown+='\n\n';}
 return {path,before,after:before.slice(0,start)+markdown+before.slice(end),reason:start===end?'Insert at the captured cursor':'Replace the captured selection'};
}
export function parseJsonLine(line:string):unknown {if(line.startsWith('data:'))line=line.slice(5).trim();if(!line||line==='[DONE]'||line.startsWith(':')||line.startsWith('event:')||line.startsWith('id:'))return null;return JSON.parse(line);}

export function vaultStorageKey(identity:string):string{return createHash('sha256').update(identity).digest('hex').slice(0,20);}

export function editWarnings(before:string,after:string):string[]{
 const warnings:string[]=[];const cite=(s:string)=>new Set([...s.matchAll(/(?<![\w@])@([A-Za-z0-9_:.#$%&+?<>~/-]+)/g)].map(m=>m[1]));const remaining=cite(after),removed=[...cite(before)].filter(key=>!remaining.has(key));if(removed.length)warnings.push('Citation keys removed: '+removed.join(', '));
 const properties=(s:string)=>s.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0]??'';if(properties(before)!==properties(after))warnings.push('Note properties are changed.');
 const links=[...before.matchAll(/!?\[\[[^\]]+\]\]/g)].map(m=>m[0]);if(links.some(link=>!after.includes(link)))warnings.push('One or more wikilinks or embeds are removed or changed.');return warnings;
}

/** An explicitly quoted replacement can be prepared without trusting model tool use. */
export function requestedReplacement(request:string):{oldText:string;newText:string}|null{const m=request.match(/replace exactly ["“]([^"”]+)["”] with ["“]([^"”]*)["”]/i);return m?{oldText:m[1],newText:m[2]}:null;}
