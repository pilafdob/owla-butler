import {createHash} from 'node:crypto';
import {diffLines} from 'diff';
import {isAbsolute,relative,sep,win32} from 'node:path';
import {record} from './validation';
import type {FallbackChoice,ProviderId} from './provider';
export type DiffView='highlights'|'none'|'split';
export type RoutingMode='cost'|'balance'|'intelligence';
export interface ProviderPrefs {model:string;reasoning:string;}
export interface ButlerSettings {
 schemaVersion:3;
 provider:ProviderId;
 /** OWLA picks the provider, model and effort per message; `provider` stays the preferred one. */
 automaticProvider:boolean;
 codexConnected:boolean;
 opencodeConnected:boolean;
 claudeConnected:boolean;
 codexExecutable:string;
 /** Provider that serves messages while the selected one is out of usage. */
 fallback:FallbackChoice;
 opencodeExecutable:string;
 claudeExecutable:string;
 models:Record<ProviderId,ProviderPrefs>;
 automaticRouting:boolean;
 routingMode:RoutingMode;
 routingPrivacyMode:boolean;
 routingThorough:boolean;
 showRoutingDetails:boolean;
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
 opencodeConnected:false,
 claudeConnected:false,
 codexExecutable:'',
 fallback:'none',
 opencodeExecutable:'',
 claudeExecutable:'',
 models:{codex:{model:'',reasoning:''},opencode:{model:'',reasoning:''},claude:{model:'',reasoning:''}},
 automaticRouting:false,
 routingMode:'balance',
 routingPrivacyMode:false,
 routingThorough:false,
 showRoutingDetails:false,
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
 const routingMode:RoutingMode=['cost','balance','intelligence'].includes(String(data.routingMode))?data.routingMode as RoutingMode:'balance';
 return {...DEFAULTS,
  diffView:['highlights','none','split'].includes(String(data.diffView))?data.diffView as DiffView:data.editingViewDiff===true?'highlights':'none',
  storageRoot:string('storageRoot'),
  excludedFolders:string('excludedFolders'),
  provider,
  routingMode,
  routingPrivacyMode:data.routingPrivacyMode===true,
  routingThorough:data.routingThorough===true,
  showRoutingDetails:data.showRoutingDetails===true,
  models:{
   codex:{model:typeof codex.model==='string'?codex.model:legacyModel,reasoning:typeof codex.reasoning==='string'?codex.reasoning:legacyReasoning},
   opencode:{model:typeof opencode.model==='string'?opencode.model:'',reasoning:typeof opencode.reasoning==='string'?opencode.reasoning:''},
   claude:{model:typeof claude.model==='string'?claude.model:'',reasoning:typeof claude.reasoning==='string'?claude.reasoning:''}
  },
  ...(modern?{
   codexConnected:data.codexConnected===true,
   opencodeConnected:data.opencodeConnected===true,
   claudeConnected:data.claudeConnected===true,
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
const PLATFORM_SETTINGS=['provider','automaticProvider','codexConnected','opencodeConnected','claudeConnected','codexExecutable','fallback','opencodeExecutable','claudeExecutable','models','automaticRouting','routingMode','routingPrivacyMode','routingThorough','showRoutingDetails','webSearch'] as const satisfies readonly (keyof ButlerSettings)[];
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
const foldPath=(value:string)=>value.normalize('NFC').toUpperCase().toLowerCase();
export {foldPath};
const excludedCache=new Map<string,string[]>();
export function allowedPath(path:string,excluded='',extension:string|null='md'):boolean {
 if(!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||(process.platform==='win32'&&(p.endsWith('.')||p.endsWith(' ')))||p==='~'||p.includes(':')||/[\p{Cc}]/u.test(p)))return false;
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
export function displayMarkdown(text:string):string {
 const nonce=Math.random().toString(36).slice(2);
 let out=text.replace(/!\[/g,'[');
 // Prevent backticks inside HTML tags from shielding attributes.
 out=out.replace(/<[^>]*>/g,m=>m.replace(/`/g,String.fromCharCode(1)));
 // Preserve code samples: sanitize only outside fenced and inline code.
 const fences:string[]=[];
 out=out.replace(/```[\s\S]*?```/g,m=>{fences.push(m);return '@@FENCE'+nonce+(fences.length-1)+'@@';});
 const inlines:string[]=[];
 out=out.replace(/`[^`\n]*`/g,m=>{inlines.push(m);return '@@INLINE'+nonce+(inlines.length-1)+'@@';});
 out=out.replace(new RegExp(String.fromCharCode(1),'g'),'`');
 out=out.replace(/<(script|style|svg|math|input|picture)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 out=out.replace(/<(script|style|svg|math|input|picture)\b[^>]*\/?>/gi,'');
 out=out.replace(/<(?:img|iframe|video|audio|source|object|embed|link)\b[^>]*>/gi,'');
 out=out.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,(_m:string,tag:string,attrs:string)=>{
  const name=tag.toLowerCase();
  let a=attrs;
  const removeAttr=(attr:string)=>{
   const re=new RegExp('(?<=[\\s/"\x27])'+attr+'\\s*=\\s*("[^"]*"|\x27[^\x27]*\x27|[^\\s>]+)','gi');
   a=a.replace(re,'');
  };
  removeAttr('style');
  removeAttr('on[a-z]+'.replace('on[a-z]+','on[a-zA-Z]+')? 'on[a-zA-Z]+' : 'on[a-zA-Z]+');
  // remove on* via regex
  a=a.replace(/(?<=[\s/"\x27])on[a-zA-Z]+\s*=\s*("[^"]*"|\x27[^\x27]*\x27|[^\s>]+)/gi,'');
  const forbidden=name==='a'
   ?['src','srcset','poster','background','ping','action','formaction']
   :['src','href','srcset','poster','background','ping','action','formaction'];
  for(const attr of forbidden) removeAttr(attr);
  if(name==='a'){
   a=a.replace(/(?<=[\s/"\x27])href\s*=\s*("[^"]*"|\x27[^\x27]*\x27|[^\s>]+)/gi,(mm:string)=>{
    const value=mm.match(/=(.*)/)?.[1]?.replace(/^['"]|['"]$/g,'').trim()??'';
    if(/^https?:/i.test(value)||/^obsidian:/i.test(value)||/^mailto:/i.test(value)||/^#/i.test(value))return mm;
    return '';
   });
  }
  return '<'+tag+a+'>';
 });
 out=out.replace(new RegExp('@@FENCE'+nonce+'(\\d+)@@','g'),(_m:string,i:string)=>fences[Number(i)]);
 out=out.replace(new RegExp('@@INLINE'+nonce+'(\\d+)@@','g'),(_m:string,i:string)=>inlines[Number(i)]);
 return out;
}

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

interface DiffHunk { before: string; after: string; }

export interface DiffBlock {
 changed: boolean;
 parts: { value: string; added?: boolean; removed?: boolean }[];
}

/** Shared grouping of `diff`'s line parts into contiguous changed/unchanged blocks. */
export function groupDiffLines(before: string, after: string): DiffBlock[] {
 const blocks: DiffBlock[] = [];
 let current: DiffBlock | null = null;
 for (const part of diffLines(before, after)) {
  const changed = Boolean(part.added || part.removed);
  if (!current || current.changed !== changed) {
   current = { changed, parts: [] };
   blocks.push(current);
  }
  current.parts.push(part);
 }
 if (!blocks.length) blocks.push({ changed: false, parts: [{ value: '' }] });
 return blocks;
}

export const groupDiffBlocks = groupDiffLines;
export const diffBlocks = groupDiffLines;
export const groupDiffParts = groupDiffLines;
export const groupDiff = groupDiffLines;

export function diffHunks(before: string, after: string): DiffHunk[] {
 const hunks: DiffHunk[] = [];
 for (const block of groupDiffLines(before, after)) {
  if (!block.changed) continue;
  let currentBefore = '';
  let currentAfter = '';
  for (const part of block.parts) {
   if (part.removed) currentBefore += part.value;
   if (part.added) currentAfter += part.value;
  }
  hunks.push({ before: currentBefore, after: currentAfter });
 }
 return hunks;
}

function parseHunkDecision(value: unknown): boolean {
 if (typeof value === 'boolean') return value;
 if (typeof value === 'string') {
  const normalized = value.trim().toLowerCase();
  return normalized === 'accept' || normalized === 'accepted' || normalized === 'keep' || normalized === 'true' || normalized === 'yes';
 }
 if (value && typeof value === 'object') {
  const record = value as Record<string, unknown>;
  if (typeof record.accepted === 'boolean') return record.accepted;
  if (typeof record.accept === 'boolean') return record.accept;
  if (typeof record.decision === 'string') return parseHunkDecision(record.decision);
  if (typeof record.keep === 'boolean') return record.keep;
 }
 return Boolean(value);
}

export function applyHunkDecisions(before: string, after: string, decisions: unknown): string {
 const blocks = groupDiffLines(before, after);
 // Count hunks and changed lines per hunk first, so flat global decision arrays
 // can be distributed deterministically.
 const hunkLineCounts: number[] = [];
 for (const block of blocks) {
  if (!block.changed) continue;
  let countingCount = 0;
  for (const part of block.parts) {
   if (part.added || part.removed) countingCount += splitChangedLines(part.value).length;
  }
  hunkLineCounts.push(countingCount);
 }

 let perHunk: unknown[];
 if (Array.isArray(decisions)) perHunk = [...(decisions as unknown[])];
 else perHunk = hunkLineCounts.map(() => decisions);
 const totalChangedLines = hunkLineCounts.reduce((sum, count) => sum + count, 0);
 const flatGlobal = Array.isArray(decisions)
  && decisions.length === totalChangedLines
  && totalChangedLines > 0
  && decisions.length !== hunkLineCounts.length
  && (decisions as unknown[]).every(item => !Array.isArray(item));
 if (flatGlobal) {
  let index = 0;
  perHunk = hunkLineCounts.map(count => {
   const slice = (decisions as unknown[]).slice(index, index + count);
   index += count;
   return slice;
  });
 }

 const normalizeSpec = (value: unknown): boolean | boolean[] | null => {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(parseHunkDecision);
  return parseHunkDecision(value);
 };
 const lineDecision = (spec: boolean | boolean[] | null, index: number): boolean => {
  if (Array.isArray(spec)) return index < spec.length ? spec[index] : false;
  if (spec === null) return false;
  return spec;
 };

 let result = '';
 let hunkIndex = -1;
 let inChanged = false;
 let currentSpec: boolean | boolean[] | null = null;
 let lineIndex = 0;
 for (const block of blocks) {
  if (block.changed) {
   if (!inChanged) {
    hunkIndex += 1;
    inChanged = true;
    lineIndex = 0;
    currentSpec = normalizeSpec(perHunk[hunkIndex]);
   }
   for (const part of block.parts) {
    if (!(part.added || part.removed)) continue;
    for (const line of splitChangedLines(part.value)) {
     const accepted = lineDecision(currentSpec, lineIndex);
     lineIndex += 1;
     if (part.added) {
      if (accepted) result += line;
     } else if (part.removed) {
      if (!accepted) result += line;
     }
    }
   }
  } else {
   inChanged = false;
   currentSpec = null;
   for (const part of block.parts) result += part.value;
  }
 }
 return result;
}

function splitChangedLines(value: string): string[] {
 return value.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

