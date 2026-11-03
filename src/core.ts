export type Provider = 'ollama' | 'openai';
export interface ButlerSettings {
 provider: Provider; endpoint: string; model: string; context: number; maxTokens: number;
 storageRoot: string; manageOllama: boolean; executable: string; memoryGuard: boolean; excludedFolders: string;
}
export const DEFAULTS: ButlerSettings = {
 provider:'ollama',endpoint:'http://127.0.0.1:11434',model:'qwen3.5:0.8b-q8_0',context:2048,maxTokens:384,
 storageRoot:'',manageOllama:true,executable:'',memoryGuard:true,excludedFolders:''
};
export function endpoint(value:string):string {
 const u=new URL(value);
 if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('Use a localhost URL, such as http://127.0.0.1:11434.');
 return u.toString().replace(/\/$/,'');
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
export function assertFresh(current:string,expected:string):void {if(current!==expected)throw Error('The note changed since this proposal. Ask for a fresh edit; your newer text was preserved.');}
export function stripFence(text:string):string {const match=text.trim().match(/^```(?:markdown|md|latex)?\n([\s\S]*?)\n```$/);return (match?match[1]:text.trim()).replace(/\$\$([^\n]*?)\$\$/g,(_all,body)=>'$$\n'+body.trim()+'\n$$');}
export function formatTranscription(text:string):string {
 return stripFence(text).split('\n').map(line=>{
  if(line.includes('$'))return line;
  const m=line.trim().match(/^(?:([^=:$]{1,40}:)\s*)?([a-zA-Z0-9.+\-*\/\^(){}\[\] \\]+=[a-zA-Z0-9.+\-*\/\^(){}\[\] \\]+)$/);
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
export function parseJsonLine(line:string):any {if(line.startsWith('data:'))line=line.slice(5).trim();if(!line||line==='[DONE]'||line.startsWith(':')||line.startsWith('event:')||line.startsWith('id:'))return null;return JSON.parse(line);}

export interface MemoryStatus {level:number;freePercent:number;}
export function canStartModel(s:MemoryStatus):boolean{return s.level<4&&s.freePercent>=40;}
export function mustStopModel(s:MemoryStatus):boolean{return s.level>=4||s.freePercent<18;}

/** Character-based headroom estimate, not an exact tokenizer. Keep requests and source context ahead of history. */
export function turnBudget(contextTokens:number,maxTokens:number,request:string,history:{role:string;content:string}[]){
 const total=Math.max(600,Math.floor((contextTokens-maxTokens-900)*2.5));
 const bounded=(value:string,max:number)=>value.length<=max?value:value.slice(0,Math.max(0,max-13))+'… [shortened]';
 const prompt=bounded(request,Math.min(900,Math.floor(total*.35)));
 const recent=history.slice(-2).map(m=>({...m,content:bounded(m.content,Math.floor(total*.1))}));
 const contextChars=Math.max(200,total-prompt.length-recent.reduce((n,m)=>n+m.content.length,0));
 return {prompt,recent,contextChars};
}
