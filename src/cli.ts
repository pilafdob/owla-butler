import {ChildProcessWithoutNullStreams, spawn as nativeSpawn} from 'node:child_process';
import {accessSync,constants,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter,extname,isAbsolute,join,win32} from 'node:path';
import {clearTimeout as cancelTimeout,setTimeout as scheduleTimeout} from 'node:timers';
import spawn from 'cross-spawn';

const windowsExtensions=['.com','.exe','.bat','.cmd'];

export function isCliExecutable(file:string,platform=process.platform):boolean{
 if(!isAbsolute(file))return false;
 if(platform==='win32'&&!windowsExtensions.includes(extname(file).toLowerCase()))return false;
 try{
  if(!statSync(file).isFile())return false;
  if(platform!=='win32')accessSync(file,constants.X_OK);
  return true;
 }catch{return false;}
}

export function findCliExecutable(name:string,path:string,directories:string[]=[]):string{
 const paths=[...new Set([...directories,...path.split(delimiter).map(value=>value.trim().replace(/^"(.*)"$/,'$1'))])]
  .filter(isAbsolute);
 const extensions=process.platform==='win32'
  ?(extname(name)?['']:windowsExtensions)
  :[''];
 for(const directory of paths){
  for(const extension of extensions){
   const candidate=join(directory,name+extension);
   if(isCliExecutable(candidate))return candidate;
  }
 }
 return '';
}

export function defaultCliDirectories(extra:string[]=[]):string[]{
 if(process.platform==='win32'){
  const dirs=[join(homedir(),'.local','bin'),join(homedir(),'.claude','local')];
  if(process.env.APPDATA)dirs.push(join(process.env.APPDATA,'npm'));
  if(process.env.LOCALAPPDATA)dirs.push(join(process.env.LOCALAPPDATA,'Programs','OpenCode'));
  return [...dirs,...extra];
 }
 return ['/usr/local/bin','/opt/homebrew/bin',join(homedir(),'.local','bin'),...extra];
}

export function defaultStorageDirectory(platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):string{
 const path=platform==='win32'?win32:{join};
 if(platform==='win32')return path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'OWLA Butler');
 if(platform==='darwin')return path.join(home,'Library','Application Support','OWLA Butler');
 return path.join(env.XDG_DATA_HOME||path.join(home,'.local','share'),'OWLA Butler');
}

type CliSpawnOptions={cwd?:string;env?:NodeJS.ProcessEnv;detached?:boolean};

export function spawnCli(file:string,args:string[],options:CliSpawnOptions={}):ChildProcessWithoutNullStreams{
 return spawn(file,args,{...options,shell:false,windowsHide:true,stdio:'pipe'}) as ChildProcessWithoutNullStreams;
}

export function terminateProcessTree(child:ChildProcessWithoutNullStreams,signal:NodeJS.Signals):void{
 if(process.platform==='win32'&&child.pid){
  const args=['/PID',String(child.pid),'/T','/F'];
  const taskkill=join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
  const killer=nativeSpawn(taskkill,args,{stdio:'ignore',windowsHide:true});
  const fallback=()=>{try{child.kill(signal);}catch{return;}};
  killer.on('error',fallback);
  killer.on('exit',code=>{if(code!==0)fallback();});
  return;
 }
 try{
  if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);
  else child.kill(signal);
 }catch{
  try{child.kill(signal);}catch{return;}
 }
}

export function runCli(file:string,args:string[],options:CliSpawnOptions&{
 signal?:AbortSignal;timeout:number;maxBuffer:number
}):Promise<string>{
 options.signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const {signal,timeout,maxBuffer,...spawnOptions}=options;
  const child=spawnCli(file,args,spawnOptions);
  let stdout='',stderr='',settled=false;
  const finish=(error?:Error)=>{
   if(settled)return;
   settled=true;
   cancelTimeout(timer);
   signal?.removeEventListener('abort',abort);
   error?reject(error):resolve(stdout);
  };
  const abort=()=>{
   terminateProcessTree(child,'SIGKILL');
   finish(signal?.reason instanceof Error?signal.reason:Error('The command was cancelled.'));
  };
  const timer=scheduleTimeout(()=>{
   terminateProcessTree(child,'SIGKILL');
   finish(Error('The command timed out after '+timeout+' ms.'));
  },timeout);
  const collect=(current:string,chunk:Buffer|string)=>{
   const next=current+chunk.toString();
   if(Buffer.byteLength(next)>maxBuffer){
    terminateProcessTree(child,'SIGKILL');
    finish(Error('Command output exceeded the '+maxBuffer+' byte limit.'));
    return current;
   }
   return next;
  };
  child.stdout.on('data',(chunk:Buffer|string)=>{stdout=collect(stdout,chunk);});
  child.stderr.on('data',(chunk:Buffer|string)=>{stderr=collect(stderr,chunk);});
  child.on('error',error=>finish(error));
  child.on('close',(code,signal)=>{
   if(code===0)finish();
   else finish(Error(stderr.trim()||'The command exited '+(signal?'after '+signal:'with code '+String(code))+'.'));
  });
  if(signal?.aborted)abort();
  else signal?.addEventListener('abort',abort,{once:true});
 });
}
