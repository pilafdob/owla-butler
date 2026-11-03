export type Provider = 'ollama' | 'openai';
export interface ButlerSettings {
 provider: Provider; endpoint: string; model: string; context: number; maxTokens: number;
 manageOllama: boolean; executable: string; memoryGuard: boolean; excludedFolders: string;
}
export const DEFAULTS: ButlerSettings = {
 provider:'ollama',endpoint:'http://127.0.0.1:11434',model:'qwen3.5:2b-q4_K_M',context:4096,maxTokens:640,
 manageOllama:true,executable:'',memoryGuard:true,excludedFolders:''
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
export function stripFence(text:string):string {const match=text.trim().match(/^```(?:markdown|md|latex)?\n([\s\S]*?)\n```$/);return match?match[1]:text.trim();}
export function insertion(path:string,before:string,content:string,start:number,end=start):Proposal {
 if(start<0||end<start||end>before.length)throw Error('The insertion position is no longer valid.');
 return {path,before,after:before.slice(0,start)+stripFence(content)+before.slice(end),reason:start===end?'Insert at the captured cursor':'Replace the captured selection'};
}
export function parseJsonLine(line:string):any {if(line.startsWith('data:'))line=line.slice(5).trim();if(!line||line==='[DONE]')return null;return JSON.parse(line);}

export interface MemoryStatus {level:number;freePercent:number;}
export function canStartModel(s:MemoryStatus):boolean{return s.level<4&&s.freePercent>=35;}
export function mustStopModel(s:MemoryStatus):boolean{return s.level>=4||s.freePercent<18;}
