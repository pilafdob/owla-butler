import {createHash} from 'node:crypto';
import {diffLines} from 'diff';
import {posix,win32} from 'node:path';
import {record} from './validation';
import type {FallbackChoice,ProviderId} from './provider';
import {sanitizeModelUnavailability,type ModelUnavailabilityEntry} from './opencode-availability';
import {pdfSelectionChipLabel,type SelectionItem} from './pdf-selection';
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
 hermesConnected:boolean;
 siriConnected:boolean;
 /** The per-provider switch at the top of each provider tab. A switched-off provider is never started, warmed up, offered to Automatic selection or used as a fallback. */
 enabledProviders:Record<ProviderId,boolean>;
 codexExecutable:string;
 hermesExecutable:string;
 /** Provider that serves messages while the selected one is out of usage (the first of `fallbacks`). */
 fallback:FallbackChoice;
 /** Second, third, … providers, tried in order while the ones before them are out of usage. */
 fallbacks:ProviderId[];
 /** Siri AI serves messages when every other enabled provider is out of usage (macOS 27 only). */
 siriFallback:boolean;
 opencodeExecutable:string;
 claudeExecutable:string;
 models:Record<ProviderId,ProviderPrefs>;
 modelUnavailability:ModelUnavailabilityEntry[];
 automaticRouting:boolean;
 routingMode:RoutingMode;
 routingPrivacyMode:boolean;
 routingThorough:boolean;
 showRoutingDetails:boolean;
 webSearch:boolean;
 pluginInterconnectivity:boolean;
 /** Canvas pictures are taken by laying the canvas over the window for a moment; off keeps Canvas text-only. */
 visualScreenshots:boolean;
 diffView:DiffView;
 storageRoot:string;
 excludedFolders:string;
 /** Developer mode: record chats, tool calls and events locally and unlock diagnostics downloads. */
 developerMode:boolean;
}
export const DEFAULTS:ButlerSettings={
 schemaVersion:3,
 provider:'codex',
 automaticProvider:false,
 codexConnected:false,
 opencodeConnected:false,
 claudeConnected:false,
 hermesConnected:false,
 siriConnected:false,
 enabledProviders:{codex:true,opencode:true,claude:true,hermes:true,siri:false},
 codexExecutable:'',
 fallback:'none',
 fallbacks:[],
 siriFallback:false,
 opencodeExecutable:'',
 claudeExecutable:'',
 hermesExecutable:'',
 models:{codex:{model:'',reasoning:''},opencode:{model:'',reasoning:''},claude:{model:'',reasoning:''},hermes:{model:'',reasoning:''},siri:{model:'',reasoning:''}},
 modelUnavailability:[],
 automaticRouting:false,
 routingMode:'balance',
 routingPrivacyMode:false,
 routingThorough:false,
 showRoutingDetails:false,
 webSearch:true,
 pluginInterconnectivity:false,
 visualScreenshots:true,
 diffView:'none',
 storageRoot:'',
 excludedFolders:'',
 developerMode:false
};
export function migrateSettings(value:unknown):ButlerSettings{
 const data=record(value);
 const string=(key:string)=>typeof data[key]==='string'?data[key]:'';
 // Any schema from 2 on keeps the modern fields; a newer version's saved
 // values must survive a read by this build instead of resetting to defaults.
 const version=typeof data.schemaVersion==='number'?data.schemaVersion:Number(data.schemaVersion);
 const modern=Number.isFinite(version)&&version>=2;
 // The v2 top-level model/reasoning are the Codex fallback. Older local-inference
 // settings (no schema version) named models OWLA no longer serves, so they stay
 // out of the Codex record (tests/codex.test.ts migration contract).
 const legacyModel=modern?string('model'):'',legacyReasoning=modern?string('reasoning'):'';
 const models=record(data.models),codex=record(models.codex),opencode=record(models.opencode),claude=record(models.claude),hermes=record(models.hermes),siri=record(models.siri);
 const providers:ProviderId[]=['codex','opencode','claude','hermes','siri'];
 const provider:ProviderId=providers.find(id=>id===data.provider)??'codex';
 // The fallback replaces the earlier Codex-only "switch to OpenCode" toggle.
 const storedFallback=['none',...providers].find(id=>id===data.fallback) as FallbackChoice|undefined;
 const fallback:FallbackChoice=storedFallback??(data.codexAutoFallback===true&&provider==='codex'?'opencode':'none');
 // The ordered fallback list replaces the single fallback; an older file seeds it from `fallback`.
 const storedList=Array.isArray(data.fallbacks)?data.fallbacks.filter((id):id is ProviderId=>providers.includes(id as ProviderId)):fallback!=='none'?[fallback]:[];
 const fallbacks=storedList.filter((id,index)=>id!==provider&&storedList.indexOf(id)===index);
 const enabled=record(data.enabledProviders);
 const enabledProviders=Object.fromEntries(providers.map(id=>[id,typeof enabled[id]==='boolean'?enabled[id]:DEFAULTS.enabledProviders[id]])) as Record<ProviderId,boolean>;
 // "Automatic model and reasoning effort" and the Automatic provider are one switch now.
 const automatic=data.automaticProvider===true||data.automaticRouting===true;
 const routingMode:RoutingMode=['cost','balance','intelligence'].includes(String(data.routingMode))?data.routingMode as RoutingMode:'balance';
 return {...DEFAULTS,
  developerMode:data.developerMode===true,
  diffView:['highlights','none','split'].includes(String(data.diffView))?data.diffView as DiffView:data.editingViewDiff===true?'highlights':'none',
  storageRoot:string('storageRoot'),
  excludedFolders:string('excludedFolders'),
  visualScreenshots:data.visualScreenshots!==false,
  provider,
  routingMode,
  routingPrivacyMode:data.routingPrivacyMode===true,
  routingThorough:data.routingThorough===true,
  showRoutingDetails:data.showRoutingDetails===true,
  modelUnavailability:sanitizeModelUnavailability(data.modelUnavailability),
  models:{
   codex:{model:typeof codex.model==='string'?codex.model:legacyModel,reasoning:typeof codex.reasoning==='string'?codex.reasoning:legacyReasoning},
   opencode:{model:typeof opencode.model==='string'?opencode.model:'',reasoning:typeof opencode.reasoning==='string'?opencode.reasoning:''},
   claude:{model:typeof claude.model==='string'?claude.model:'',reasoning:typeof claude.reasoning==='string'?claude.reasoning:''},
   hermes:{model:typeof hermes.model==='string'?hermes.model:'',reasoning:typeof hermes.reasoning==='string'?hermes.reasoning:''},
   siri:{model:typeof siri.model==='string'?siri.model:'',reasoning:typeof siri.reasoning==='string'?siri.reasoning:''}
  },
  ...(modern?{
   codexConnected:data.codexConnected===true,
   opencodeConnected:data.opencodeConnected===true,
   claudeConnected:data.claudeConnected===true,
   hermesConnected:data.hermesConnected===true,
   siriConnected:data.siriConnected===true,
   enabledProviders,
   fallbacks,
   siriFallback:data.siriFallback===true,
   codexExecutable:string('codexExecutable'),
   fallback:fallbacks[0]??'none',
   opencodeExecutable:string('opencodeExecutable'),
   claudeExecutable:string('claudeExecutable'),
   hermesExecutable:string('hermesExecutable'),
   automaticProvider:automatic,
   automaticRouting:automatic,
   webSearch:data.webSearch!==false,
   pluginInterconnectivity:data.pluginInterconnectivity===true
  }:{})};
}
export function disableAutomaticSelectionOutsideMac(settings:ButlerSettings,platform=process.platform):ButlerSettings{
  if(platform==='darwin')return settings;
  // Siri AI exists only on macOS 27; another platform never selects, enables or falls back to it.
  const fallbacks=settings.fallbacks.filter(id=>id!=='siri');
  return {...settings,automaticProvider:false,automaticRouting:false,siriFallback:false,
   provider:settings.provider==='siri'?'codex':settings.provider,
   enabledProviders:{...settings.enabledProviders,siri:false},
   fallbacks,fallback:fallbacks[0]??'none'};
}
/**
 * AI settings are kept per operating system, so a vault synced between a Mac
 * and a Windows PC keeps each machine's provider, models and modes apart. The
 * remaining settings (vault folders, review view) stay shared.
 */
export const PLATFORM_SETTINGS=['provider','automaticProvider','codexConnected','opencodeConnected','claudeConnected','hermesConnected','siriConnected','enabledProviders','codexExecutable','fallback','fallbacks','siriFallback','opencodeExecutable','claudeExecutable','hermesExecutable','models','modelUnavailability','automaticRouting','routingMode','routingPrivacyMode','routingThorough','showRoutingDetails','webSearch'] as const satisfies readonly (keyof ButlerSettings)[];
export const platformKey=():string=>process.platform==='darwin'?'mac':process.platform==='win32'?'windows':process.platform;
/** Settings for this platform: its own AI settings, seeded from the shared top level until it has saved once. */
export function readSettings(value:unknown,platform=platformKey()):ButlerSettings{
 const data=record(value),own=record(record(data.platforms)[platform]);
 // A platforms block is only ever written by schema 3+, so its presence keeps
 // the modern fields readable even when the top-level version was lost in sync.
 const schemaVersion=data.schemaVersion??(Object.keys(record(data.platforms)).length?3:undefined);
 return migrateSettings({...data,...own,schemaVersion});
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
// Lower-case first: `ẞ` (U+1E9E) upper-cases to itself but lower-cases to `ß`,
// which then upper-cases to `SS`. Upper-first left `STRAẞE` as `straße` while
// `Straße` became `strasse`, so a capital sharp s reached an excluded folder.
const foldPath=(value:string)=>value.normalize('NFC').toLowerCase().toUpperCase().toLowerCase();
export {foldPath};
const excludedCache=new Map<string,string[]>();
/**
 * A vault-relative path is refused when it contains a NUL, a colon, a control
 * character or a `~` segment. Trailing dots and spaces are refused only on
 * Windows, where the filesystem drops them; `Dr.` is a valid folder elsewhere.
 */
// eslint-disable-next-line no-control-regex -- control characters must be detected in a vault path so the path can be refused
const CONTROL=/[\u0000-\u001f\u007f]/;
export function allowedPath(path:string,excluded='',extension:string|null='md',platform:string=process.platform):boolean {
 if(!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || CONTROL.test(path))return false;
 if(path.split('/').some(p=>!p||p==='.'||p==='..'||p==='~'||p.startsWith('.')||(platform==='win32'&&(p.endsWith('.')||p.endsWith(' ')))))return false;
 if(extension!==null&&!path.toLowerCase().endsWith('.'+extension))return false;
 const target=foldPath(path);
 const cacheKey=excluded;
 let roots=excludedCache.get(cacheKey);
 if(!roots){
  roots=excluded.split('\n').map(s=>s.trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'')).filter(Boolean).map(foldPath);
  // Bounded FIFO: the cache only grows when the exclusion setting changes.
  if(excludedCache.size>=32){const oldest=excludedCache.keys().next().value;if(oldest!==undefined)excludedCache.delete(oldest);}
  excludedCache.set(cacheKey,roots);
 }
 return !roots.some(root=>target===root||target.startsWith(root+'/'));
}
/** File types OWLA can propose, review and apply: Markdown (including Excalidraw drawings), `.excalidraw`, Canvas and Bases. */
export const EDITABLE_FILE=/\.(md|excalidraw|canvas|base)$/i;
/** A vault path OWLA may propose an edit to: an allowed path with an editable extension. */
export function allowedEditablePath(path:string,excluded=''):boolean{return EDITABLE_FILE.test(path)&&allowedPath(path,excluded,null);}
export function isPathInside(root:string,file:string,platform=process.platform):boolean {
 const path=platform==='win32'?win32:posix;
 const relativePath=path.relative(root,file);
 return !!relativePath&&relativePath!=='..'&&!relativePath.startsWith('..'+path.sep)&&!path.isAbsolute(relativePath);
}
export function clip(text:string,max:number):string {return text.length<=max?text:text.slice(0,max)+'\n[Context shortened. Read a specific passage if needed.]';}
/** One-line preview of selected text, so a sent selection reads as the excerpt it carries. */
export function selectionExcerpt(text:string,max=140):string {
 const one=text.replace(/\s+/g,' ').trim();
 if(!one)return '';
 return one.length<=max?one:one.slice(0,max).trimEnd()+'…';
}
export interface SentCard {label:string;icon:string;detail?:string;tooltip?:string;}
/**
 * The cards a sent message shows. A selection is listed like an attached
 * file, with the excerpt it carries, so it is visible that it went with the
 * prompt instead of only living in the composer.
 */
export function sentCards(selections:readonly SelectionItem[],folders:readonly string[],files:readonly string[]):SentCard[] {
 return [
  ...selections.map(selection=>selection.pdf
   ?{label:pdfSelectionChipLabel(selection.path,selection.pdf.page,selection.text),icon:'text-select',detail:selectionExcerpt(selection.text),tooltip:selectionExcerpt(selection.text,600)}
   :{label:'Selection · '+selection.path,icon:'text-select',detail:selectionExcerpt(selection.text),tooltip:selectionExcerpt(selection.text,600)}),
  ...folders.map(path=>({label:path,icon:'folder'})),
  ...files.map(path=>({label:path,icon:'file-text'})),
 ];
}
export interface Proposal {path:string;before:string;after:string;reason:string;create?:true;}
export function proposal(path:string,before:string,oldText:string,newText:string,reason:string,excluded=''):Proposal {
 if(!allowedEditablePath(path,excluded))throw Error('This note is outside the allowed Markdown context.');
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
export function stripFence(text:string):string {const match=text.trim().match(/^```(?:markdown|md|latex)?\r?\n([\s\S]*?)\r?\n```$/);return (match?match[1]:text.trim()).replace(/\$\$([^\n]*?)\$\$/g,(_all:string,body:string)=>'$$\n'+body.trim()+'\n$$');}
export function formatTranscription(text:string):string {
 return stripFence(text).split('\n').map(line=>{
  if(line.includes('$'))return line;
  const m=line.trim().match(/^(?:([^=:$]{1,40}:)\s*)?([a-zA-Z0-9.+\-*/^(){}[\] \\]+=[a-zA-Z0-9.+\-*/^(){}[\] \\]+)$/);
  if(!m)return line;const equation=m[2].trim();if((equation.match(/[A-Za-z]{5,}/g)??[]).length)return line;
  return (m[1]?m[1]+'\n\n':'')+'$$\n'+equation+'\n$$';
 }).join('\n');
}
/** Raw HTML in a reply is sanitized on the rendered DOM; see render-sanitize.ts. */
export {displayMarkdown} from './render-sanitize';
export function insertion(path:string,before:string,content:string,start:number,end=start):Proposal {
 if(start<0||end<start||end>before.length)throw Error('The insertion position is no longer valid.');
 const frontmatter=before.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);if(frontmatter&&start<frontmatter[0].length)throw Error('Place the cursor in the note body, outside Properties, before inserting Markdown.');
 let markdown=stripFence(content);if(markdown.includes('\n')){if(start>0&&before[start-1]!=='\n')markdown='\n\n'+markdown;if(end<before.length&&before[end]!=='\n')markdown+='\n\n';}
 return {path,before,after:before.slice(0,start)+markdown+before.slice(end),reason:start===end?'Insert at the captured cursor':'Replace the captured selection'};
}
export function parseJsonLine(line:string):unknown {line=line.trim();if(line.startsWith('data:'))line=line.slice(5).trim();if(!line||line==='[DONE]'||line.startsWith(':')||line.startsWith('event:')||line.startsWith('id:'))return null;return JSON.parse(line);}

export function vaultStorageKey(identity:string):string{return createHash('sha256').update(identity).digest('hex').slice(0,20);}

export function editWarnings(before:string,after:string):string[]{
 const warnings:string[]=[];const cite=(s:string)=>new Set([...s.matchAll(/(?<![\w@])@([A-Za-z0-9_:.#$%&+?<>~/-]+)/g)].map(m=>m[1]));const remaining=cite(after),removed=[...cite(before)].filter(key=>!remaining.has(key));if(removed.length)warnings.push('Citation keys removed: '+removed.join(', '));
 const properties=(s:string)=>s.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0]??'';if(properties(before)!==properties(after))warnings.push('Note properties are changed.');
 const links=[...before.matchAll(/!?\[\[[^\]]+\]\]/g)].map(m=>m[0]);if(links.some(link=>!after.includes(link)))warnings.push('One or more wikilinks or embeds are removed or changed.');return warnings;
}

/** An explicitly quoted replacement can be prepared without trusting model tool use. */
export function requestedReplacement(request:string):{oldText:string;newText:string}|null{const m=request.match(/replace exactly ["“]([^"”]+)["”] with ["“]([^"”]*)["”]/i);return m?{oldText:m[1],newText:m[2]}:null;}

export interface DiffHunk { before: string; after: string; }

export function diffHunks(before: string, after: string): DiffHunk[] {
 const hunks: DiffHunk[] = [];
 let currentBefore = '';
 let currentAfter = '';
 let inHunk = false;
 for (const part of diffLines(before, after)) {
  if (part.added || part.removed) {
   inHunk = true;
   if (part.removed) currentBefore += part.value;
   if (part.added) currentAfter += part.value;
  } else {
   if (inHunk) {
    hunks.push({before: currentBefore, after: currentAfter});
    currentBefore = '';
    currentAfter = '';
    inHunk = false;
   }
  }
 }
 if (inHunk) hunks.push({before: currentBefore, after: currentAfter});
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
 const parts = diffLines(before, after);
 // Count hunks and changed lines per hunk first, so flat global decision arrays
 // can be distributed deterministically.
 const hunkLineCounts: number[] = [];
 let countingChanged = false;
 let countingCount = 0;
 for (const part of parts) {
  if (part.added || part.removed) {
   if (!countingChanged) { countingChanged = true; countingCount = 0; }
   countingCount += splitChangedLines(part.value).length;
  } else {
   if (countingChanged) { hunkLineCounts.push(countingCount); countingChanged = false; }
  }
 }
 if (countingChanged) hunkLineCounts.push(countingCount);

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
 for (const part of parts) {
  if (part.added || part.removed) {
   if (!inChanged) {
    hunkIndex += 1;
    inChanged = true;
    lineIndex = 0;
    currentSpec = normalizeSpec(perHunk[hunkIndex]);
   }
   for (const line of splitChangedLines(part.value)) {
    const accepted = lineDecision(currentSpec, lineIndex);
    lineIndex += 1;
    if (part.added) {
     if (accepted) result += line;
    } else if (part.removed) {
     if (!accepted) result += line;
    }
   }
  } else {
   inChanged = false;
   currentSpec = null;
   result += part.value;
  }
 }
 return result;
}

function splitChangedLines(value: string): string[] {
 return value.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

export const applyDiffDecisions = applyHunkDecisions;
export const applyHunkDecision = applyHunkDecisions;
export const applyDecisions = applyHunkDecisions;
export const mergeHunkDecisions = applyHunkDecisions;
export const mergeDiffDecisions = applyHunkDecisions;
export const mergeDecisions = applyHunkDecisions;
export const resolveHunks = applyHunkDecisions;
export const applyLineDecisions = applyHunkDecisions;
export const computeMergedText = applyHunkDecisions;

/** One displayed diff line and where it sits in the original (`before`) and proposed (`after`) text, as 0-based line numbers. */
export interface DiffLine { text:string; kind:'added'|'removed'|'unchanged'; beforeLine:number; afterLine:number; }

/**
 * The diff as single lines, each mapped to a line in both versions, so a click
 * in the diff can scroll the note to that place whichever version it shows.
 * A removed line maps to the point in `after` where it was removed; an added
 * line to the point in `before` where it is inserted.
 */
export function diffLineMap(before:string,after:string):DiffLine[]{
 const lines:DiffLine[]=[];
 let b=0,a=0;
 for(const part of diffLines(before,after)){
  const kind=part.added?'added':part.removed?'removed':'unchanged';
  for(const text of part.value.match(/[^\n]*\n|[^\n]+/g)??[]){
   lines.push({text,kind,beforeLine:b,afterLine:a});
   if(kind!=='added')b++;
   if(kind!=='removed')a++;
  }
 }
 return lines;
}
