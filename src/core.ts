import {createHash} from 'node:crypto';
import {isAbsolute,relative,sep,win32} from 'node:path';
import {record} from './validation';
import type {FallbackChoice,ProviderId} from './provider';
export type DiffView='highlights'|'none'|'split';
export interface ProviderPrefs {model:string;reasoning:string;}
export interface ButlerSettings {
 schemaVersion:3;
 provider:ProviderId;
 /** OWLA picks the provider, model and effort per message; `provider` stays the preferred one. */
 automaticProvider:boolean;
 codexConnected:boolean;
 codexExecutable:string;
 /** Provider that serves messages while the selected one is out of usage. */
 fallback:FallbackChoice;
 opencodeExecutable:string;
 claudeExecutable:string;
 models:Record<ProviderId,ProviderPrefs>;
 automaticRouting:boolean;
 webSearch:boolean;
 pluginInterconnectivity:boolean;
 diffView:DiffView;
 storageRoot:string;
 excludedFolders:string;
}
export const DEFAULTS:ButlerSettings={
 schemaVersion:3,
 provider:'codex',
 automaticProvider:false,
 codexConnected:false,
 codexExecutable:'',
 fallback:'none',
 opencodeExecutable:'',
 claudeExecutable:'',
 models:{codex:{model:'',reasoning:''},opencode:{model:'',reasoning:''},claude:{model:'',reasoning:''}},
 automaticRouting:false,
 webSearch:true,
 pluginInterconnectivity:false,
 diffView:'none',
 storageRoot:'',
 excludedFolders:''
};
export function migrateSettings(value:unknown):ButlerSettings{
 const data=record(value);
 const string=(key:string)=>typeof data[key]==='string'?data[key]:'';
 const modern=data.schemaVersion===2||data.schemaVersion===3;
 const legacyModel=modern?string('model'):'',legacyReasoning=modern?string('reasoning'):'';
 const models=record(data.models),codex=record(models.codex),opencode=record(models.opencode),claude=record(models.claude);
 const providers:ProviderId[]=['codex','opencode','claude'];
 const provider:ProviderId=providers.find(id=>id===data.provider)??'codex';
 // The fallback replaces the earlier Codex-only "switch to OpenCode" toggle.
 const storedFallback=['none',...providers].find(id=>id===data.fallback) as FallbackChoice|undefined;
 const fallback:FallbackChoice=storedFallback??(data.codexAutoFallback===true&&provider==='codex'?'opencode':'none');
 return {...DEFAULTS,
  diffView:['highlights','none','split'].includes(String(data.diffView))?data.diffView as DiffView:data.editingViewDiff===true?'highlights':'none',
  storageRoot:string('storageRoot'),
  excludedFolders:string('excludedFolders'),
  provider,
  models:{
   codex:{model:typeof codex.model==='string'?codex.model:legacyModel,reasoning:typeof codex.reasoning==='string'?codex.reasoning:legacyReasoning},
   opencode:{model:typeof opencode.model==='string'?opencode.model:'',reasoning:typeof opencode.reasoning==='string'?opencode.reasoning:''},
   claude:{model:typeof claude.model==='string'?claude.model:'',reasoning:typeof claude.reasoning==='string'?claude.reasoning:''}
  },
  ...(modern?{
   codexConnected:data.codexConnected===true,
   codexExecutable:string('codexExecutable'),
   fallback:fallback===provider?'none':fallback,
   opencodeExecutable:string('opencodeExecutable'),
   claudeExecutable:string('claudeExecutable'),
   automaticProvider:data.automaticProvider===true,
   automaticRouting:data.automaticRouting===true,
   webSearch:data.webSearch!==false,
   pluginInterconnectivity:data.pluginInterconnectivity===true
  }:{})};
}
export function disableAutomaticSelectionOutsideMac(settings:ButlerSettings,platform=process.platform):ButlerSettings{
  return platform==='darwin'?settings:{...settings,automaticProvider:false,automaticRouting:false};
}
/**
 * AI settings are kept per operating system, so a vault synced between a Mac
 * and a Windows PC keeps each machine's provider, models and modes apart. The
 * remaining settings (vault folders, review view) stay shared.
 */
export const PLATFORM_SETTINGS=['provider','automaticProvider','codexConnected','codexExecutable','fallback','opencodeExecutable','claudeExecutable','models','automaticRouting','webSearch'] as const satisfies readonly (keyof ButlerSettings)[];
export const platformKey=():string=>process.platform==='darwin'?'mac':process.platform==='win32'?'windows':process.platform;
/** Settings for this platform: its own AI settings, seeded from the shared top level until it has saved once. */
export function readSettings(value:unknown,platform=platformKey()):ButlerSettings{
 const data=record(value),own=record(record(data.platforms)[platform]);
 return migrateSettings({...data,...own,schemaVersion:data.schemaVersion});
}
/** Stored form: shared settings at the top level, this platform's AI settings under `platforms`, other platforms untouched. */
export function writeSettings(prefs:ButlerSettings,stored:unknown,platform=platformKey()):Record<string,unknown>{
 const data=record(stored),seed:Record<string,unknown>={...migrateSettings(data)};
 const shared:Record<string,unknown>={...prefs},own:Record<string,unknown>={};
 for(const key of PLATFORM_SETTINGS){own[key]=structuredClone(prefs[key]);shared[key]=seed[key];}
 return {...shared,schemaVersion:3,platforms:{...record(data.platforms),[platform]:own}};
}
/**
 * Vault paths are compared the way the filesystem compares them. macOS and
 * Windows resolve `Private` and `private` to the same folder, so an excluded
 * folder must match the same way; a different spelling must not reach around
 * an exclusion the user set. Unicode is compared in the normalized form that
 * APFS stores, so `café` and `café` are one folder.
 */
const foldPath=(value:string)=>value.normalize('NFC').toLowerCase();
export {foldPath};
const excludedCache=new Map<string,string[]>();
export function allowedPath(path:string,excluded='',extension:string|null='md'):boolean {
 if(!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')))return false;
 if(extension!==null&&!path.toLowerCase().endsWith('.'+extension))return false;
 const target=foldPath(path);
 const cacheKey=excluded;
 let roots=excludedCache.get(cacheKey);
 if(!roots){
  roots=excluded.split('\n').map(s=>s.trim().replace(/^\/+|\/+$/g,'')).filter(Boolean).map(foldPath);
  excludedCache.set(cacheKey,roots);
 }
 return !roots.some(root=>target===root||target.startsWith(root+'/'));
}
export function isPathInside(root:string,file:string,platform=process.platform):boolean {
 const path=platform==='win32'?win32:{relative,isAbsolute,sep};
 const relativePath=path.relative(root,file);
 return !!relativePath&&relativePath!=='..'&&!relativePath.startsWith('..'+path.sep)&&!path.isAbsolute(relativePath);
}
export function clip(text:string,max:number):string {return text.length<=max?text:text.slice(0,max)+'\n[Context shortened. Read a specific passage if needed.]';}
export interface Proposal {path:string;before:string;after:string;reason:string;create?:true;}
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
 deferred?:true;
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
