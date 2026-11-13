import {ChildProcessWithoutNullStreams, spawn as nativeSpawn} from 'node:child_process';
import {accessSync,constants,existsSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter,extname,isAbsolute,join,win32} from 'node:path';
import {clearTimeout as cancelTimeout,setTimeout as scheduleTimeout} from 'node:timers';
import spawn from 'cross-spawn';

const windowsExtensions=['.com','.exe','.bat','.cmd'];

export function isCliExecutable(file:string,platform:NodeJS.Platform=process.platform):boolean{
 const absolute=platform==='win32'?win32.isAbsolute:isAbsolute;
 if(!absolute(file))return false;
 if(platform==='win32'&&!windowsExtensions.includes(win32.extname(file).toLowerCase()))return false;
 try{
  if(!statSync(file).isFile())return false;
  if(platform!=='win32')accessSync(file,constants.X_OK);
  return true;
 }catch{return false;}
}

export function findCliExecutable(name:string,path:string,directories:string[]=[],platform:NodeJS.Platform=process.platform):string{
 // Windows PATH entries are ';'-separated and absolute with a drive letter. The
 // platform is a parameter so the Windows rules can be tested from any host.
 const separator=platform==='win32'?';':delimiter;
 const absolute=platform==='win32'?win32.isAbsolute:isAbsolute;
 const paths=[...new Set([...directories,...path.split(separator).map(value=>value.trim().replace(/^"(.*)"$/,'$1'))])]
  .filter(absolute);
 const extensions=platform==='win32'
  ?(extname(name)?['']:windowsExtensions)
  :[''];
 for(const directory of paths){
  for(const extension of extensions){
   const candidate=join(directory,name+extension);
   if(isCliExecutable(candidate,platform))return candidate;
  }
 }
 return '';
}

export function defaultCliDirectories(extra:string[]=[],platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):string[]{
 if(platform==='win32'){
  // npm's global shims, the Claude Code native installer and the per-user
  // package managers that install CLI tools on Windows.
  const dirs=[join(home,'.local','bin'),join(home,'.claude','local')];
  if(env.APPDATA)dirs.push(join(env.APPDATA,'npm'));
  if(env.LOCALAPPDATA){
   dirs.push(join(env.LOCALAPPDATA,'Programs','OpenCode'));
   dirs.push(join(env.LOCALAPPDATA,'pnpm'));
  }
  dirs.push(join(home,'scoop','shims'),join(home,'.volta','bin'),join(home,'.bun','bin'));
  return [...dirs,...extra];
 }
 return ['/usr/local/bin','/opt/homebrew/bin',join(home,'.local','bin'),...extra];
}

export function defaultStorageDirectory(platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):string{
 const path=platform==='win32'?win32:{join};
 if(platform==='win32')return path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'OWLA Butler');
 if(platform==='darwin')return path.join(home,'Library','Application Support','OWLA Butler');
 return path.join(env.XDG_DATA_HOME||path.join(home,'.local','share'),'OWLA Butler');
}

type CliSpawnOptions={cwd?:string;env?:NodeJS.ProcessEnv;detached?:boolean};

/**
 * Variables that change how a spawned assistant executes before its own code
 * runs: module preload hooks, library injection and disabled TLS checks. No
 * assistant needs them, so every provider drops them. Proxies and custom
 * certificate bundles stay, because enterprise setups need them to reach the
 * provider at all.
 */
export const UNSAFE_EXECUTION_ENV=[
 'NODE_OPTIONS','NODE_TLS_REJECT_UNAUTHORIZED','ELECTRON_RUN_AS_NODE',
 'DYLD_INSERT_LIBRARIES','LD_PRELOAD',
];

/**
 * API keys and endpoint overrides. Codex and Claude Code sign in with their
 * own subscription, so a key would switch them to API billing and an endpoint
 * override would send the conversation and the signed-in session somewhere
 * other than the provider the user chose. OpenCode is the exception: it reads
 * provider keys from the environment by design, so it keeps them.
 */
export const UNSAFE_CREDENTIAL_ENV=[
 'OPENAI_API_KEY','CODEX_API_KEY','AZURE_OPENAI_API_KEY',
 'OPENAI_BASE_URL','OPENAI_API_BASE','OPENAI_ORGANIZATION',
 'ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL',
];

/** The Windows system directory, as Windows itself records it. */
export function windowsSystemDirectory(env:NodeJS.ProcessEnv=process.env):string{
 return env.SystemRoot||env.windir||'C:\\Windows';
}
/** The system's own cmd.exe: the only interpreter OWLA lets run a Windows command shim. */
export function comSpecPath(env:NodeJS.ProcessEnv=process.env):string{
 return win32.join(windowsSystemDirectory(env),'System32','cmd.exe');
}
/** The system's own tool for terminating a whole process tree by PID. */
export function taskkillPath(env:NodeJS.ProcessEnv=process.env):string{
 return win32.join(windowsSystemDirectory(env),'System32','taskkill.exe');
}
/**
 * Whether Windows command shims (.cmd, .bat) can run safely. cross-spawn
 * interprets them with `process.env.comspec || 'cmd.exe'`, read from this
 * process's environment rather than the child's
 * (node_modules/cross-spawn/lib/parse.js), so a redirected ComSpec variable
 * would choose which program interprets an assistant. OWLA runs a shim only
 * when the variable names the system's own cmd.exe, or is unset.
 */
export function shimInterpreterTrusted(platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env):boolean{
 if(platform!=='win32')return true;
 const comspec=env.ComSpec||env.comspec||'';
 if(!comspec)return true;
 const normalize=(value:string)=>value.replace(/\//g,'\\').toLowerCase();
 return normalize(comspec)===normalize(comSpecPath(env));
}

/** The environment of a spawned assistant, without the variables above. */
export function sanitizedEnv(env:NodeJS.ProcessEnv=process.env,{keepCredentials=false,platform=process.platform}:{keepCredentials?:boolean;platform?:NodeJS.Platform}={}):NodeJS.ProcessEnv{
 const result:NodeJS.ProcessEnv={...env};
 for(const key of UNSAFE_EXECUTION_ENV)delete result[key];
 if(!keepCredentials)for(const key of UNSAFE_CREDENTIAL_ENV)delete result[key];
 if(platform==='win32'){
  // Command shims, and anything the assistant itself runs, interpret through
  // ComSpec; it is pinned to the system's own cmd.exe rather than inherited.
  delete result.comspec;
  delete result.ComSpec;
  result.ComSpec=comSpecPath(result);
 }
 return result;
}

export function spawnCli(file:string,args:string[],options:CliSpawnOptions={}):ChildProcessWithoutNullStreams{
 // A Windows command shim is interpreted by the program ComSpec names in this
 // process's environment; OWLA refuses a shim unless that is the system's own
 // cmd.exe (see shimInterpreterTrusted).
 if(process.platform==='win32'&&/\.(?:cmd|bat)$/i.test(file)&&!shimInterpreterTrusted())
  throw Error('OWLA cannot run this Windows command shim: the ComSpec variable names a program other than the system Command Prompt. Choose the program’s executable file in settings, or set ComSpec to the Windows cmd.exe.');
 return spawn(file,args,{...options,shell:false,windowsHide:true,stdio:'pipe'}) as ChildProcessWithoutNullStreams;
}

export function terminateProcessTree(child:ChildProcessWithoutNullStreams,signal:NodeJS.Signals,platform:NodeJS.Platform=process.platform):void{
 if(platform==='win32'){
  // The tree is terminated by PID. Windows reuses PIDs quickly, so an already
  // exited child is never targeted again: its PID may belong to another
  // process now. taskkill is resolved from the system directory and only
  // spawned when it is there; the direct child is the fallback.
  if(child.exitCode!==null||child.signalCode!==null)return;
  const pid=child.pid;
  if(pid){
   const taskkill=taskkillPath();
   if(existsSync(taskkill)){
    const killer=nativeSpawn(taskkill,['/PID',String(pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    const fallback=()=>{try{child.kill(signal);}catch{return;}};
    killer.on('error',fallback);
    killer.on('exit',code=>{if(code!==0)fallback();});
    return;
   }
  }
  try{child.kill(signal);}catch{return;}
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
