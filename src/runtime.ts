import { spawn,execFile } from 'node:child_process';
import { existsSync,mkdirSync,openSync,closeSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { homedir } from 'node:os';
import {rotateLog} from './recovery';
export const DEFAULT_STORAGE=join(homedir(),'Library','Application Support','OWLA Butler');
import { localRequest } from './transport';
import { ButlerSettings,MemoryStatus } from './core';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function command(file:string,args:string[]):Promise<string>{return new Promise(resolve=>execFile(file,args,{timeout:2000},(err,out)=>resolve(err?'':out)));}
export async function memoryStatus():Promise<MemoryStatus>{
 if(process.platform!=='darwin')return {level:1,freePercent:100};
 const [level,free]=await Promise.all([command('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level']),command('/usr/bin/memory_pressure',['-Q'])]);
 const match=free.match(/free percentage:\s*(\d+)%/);
 const parsed=Number(level.trim());return {level:[1,2,4].includes(parsed)?parsed:4,freePercent:match?Number(match[1]):0};
}
export class LocalRuntime {
 private child:ReturnType<typeof spawn>|null=null;
 private loading:Promise<void>|null=null;
 async ensure(s:ButlerSettings):Promise<void>{
  if(this.loading)return this.loading;
  this.loading=this.start(s).finally(()=>this.loading=null);return this.loading;
 }
 private async start(s:ButlerSettings):Promise<void>{
  try{await localRequest(s.endpoint,s.provider==='ollama'?'/api/version':'/v1/models',undefined,AbortSignal.timeout(1200));return;}catch{}
  if(s.provider!=='ollama'||!s.manageOllama)throw Error('The local model service is unavailable. Enable automatic Ollama startup in OWLA Butler settings, or connect a running local server.');
  const executable=s.executable||[join(s.storageRoot||DEFAULT_STORAGE,'runtime','ollama'),join(homedir(),'Library','Application Support','Local Obsidian Agent','apps','ollama','ollama'),'/Applications/Ollama.app/Contents/Resources/ollama','/opt/homebrew/bin/ollama','/usr/local/bin/ollama'].find(p=>existsSync(p))||'';
  if(!executable||!existsSync(executable))throw Error('Ollama was not found. Choose its executable in OWLA Butler settings.');
  const host=new URL(s.endpoint);if(host.pathname!=='/'||!['127.0.0.1','localhost'].includes(host.hostname))throw Error('Automatic startup needs a plain localhost Ollama address.');
  const modelDir=join(s.storageRoot||DEFAULT_STORAGE,'models');
  const logDir=join(homedir(),'Library','Logs','OWLA Butler');mkdirSync(logDir,{recursive:true});const logPath=join(logDir,'ollama.log');rotateLog(logPath);const logFd=openSync(logPath,'a');
  this.child=spawn(executable,['serve'],{cwd:dirname(executable),env:{...process.env,OLLAMA_HOST:`127.0.0.1:${host.port||'11434'}`,OLLAMA_MODELS:modelDir,OLLAMA_NO_CLOUD:'1',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_MAX_QUEUE:'1',OLLAMA_CONTEXT_LENGTH:String(s.context),OLLAMA_KEEP_ALIVE:'0',OLLAMA_FLASH_ATTENTION:'1'},stdio:['ignore',logFd,logFd],windowsHide:true});closeSync(logFd);
  let failed:Error|undefined;this.child.on('error',e=>failed=e);
  // Watch the Obsidian process from outside it, including abnormal exits.
  if(process.platform==='darwin'){
   const serverPid=this.child.pid,parentPid=process.pid;
   if(serverPid){const watcher=spawn('/bin/sh',['-c',`while kill -0 ${parentPid} 2>/dev/null; do kill -0 ${serverPid} 2>/dev/null || exit 0; sleep 2; done; kill -TERM ${serverPid} 2>/dev/null`],{stdio:'ignore',detached:true});watcher.unref();}
  }
  for(let i=0;i<100;i++){if(failed)throw failed;try{await localRequest(s.endpoint,'/api/version',undefined,AbortSignal.timeout(400));return;}catch{await wait(100);}}
  this.stop();throw Error('Ollama did not start. Check the executable and endpoint in settings.');
 }
 async unload(s:ButlerSettings):Promise<void>{
  if(s.provider==='ollama')try{await localRequest(s.endpoint,'/api/generate',{model:s.model,keep_alive:0},AbortSignal.timeout(2500));}catch{}
 }
 stop():void{if(this.child){this.child.kill('SIGTERM');this.child=null;}}
}
