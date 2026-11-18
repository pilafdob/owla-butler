import {ChildProcessWithoutNullStreams, spawn as nativeSpawn} from 'node:child_process';
import {accessSync,constants,existsSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter,extname,isAbsolute,join,win32} from 'node:path';
import {clearTimeout as cancelTimeout,setTimeout as scheduleTimeout} from 'node:timers';
import spawn from 'cross-spawn';

const windowsExtensions=['.com','.exe','.bat','.cmd'];

export function isCliExecutable(file:string,platform:NodeJS.Platform=process.platform):boolean{
 const absolute=(value:string)=>platform==='win32'?win32.isAbsolute(value):isAbsolute(value);
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
 const absolute=(value:string)=>platform==='win32'?win32.isAbsolute(value):isAbsolute(value);
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
/**
 * The PATH handed to a provider child: the inherited PATH plus private bin
 * directories, joined with the host's separator. Windows uses ';', macOS and
 * Linux ':' (W3); the platform is a parameter so this is tested everywhere.
 */
export function extendedPath(pathValue:string|undefined,directories:string[],platform:NodeJS.Platform=process.platform):string{
 return [pathValue,...directories].filter(Boolean).join(platform==='win32'?';':':');
}
/**
 * Reads PATH from an environment regardless of key casing. Windows exposes the
 * variable as `Path` in a normal GUI/Explorer-launched process; spreading
 * `process.env` into a plain object keeps that casing, and a plain object is
 * case-sensitive, so `env.PATH` is then undefined. Node's process.env itself is
 * case-insensitive on Windows, but a copy of it is not. Every caller builds the
 * child PATH explicitly with extendedPath, so the inherited value must be found
 * by comparing lower-cased keys.
 */
export function envPath(env:NodeJS.ProcessEnv):string{
 for(const [key,value] of Object.entries(env))if(key.toLowerCase()==='path')return value??'';
 return '';
}

type CliSpawnOptions={cwd?:string;env?:NodeJS.ProcessEnv;detached?:boolean};

/**
 * Variables that change how a spawned assistant executes before its own code
 * runs: module preload hooks and search paths (Node, Bun, Python, Perl),
 * dynamic library injection and disabled TLS checks. No
 * assistant needs them, so every provider drops them. Proxies and custom
 * certificate bundles stay, because enterprise setups need them to reach the
 * provider at all.
 */
export const UNSAFE_EXECUTION_ENV=[
 'NODE_OPTIONS','NODE_PATH','NODE_MODULE_PATH','NODE_TLS_REJECT_UNAUTHORIZED',
 'ELECTRON_RUN_AS_NODE','BUN_OPTIONS','BUN_INSTALL',
 'DYLD_INSERT_LIBRARIES','DYLD_LIBRARY_PATH','DYLD_FRAMEWORK_PATH',
 'LD_PRELOAD','LD_LIBRARY_PATH','PYTHONPATH','PYTHONHOME','PYTHONSTARTUP',
 'PERL5LIB','PERL5OPT','RUBYOPT','RUBYLIB','BASH_ENV','ENV','ZDOTDIR',
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
/**
 * Unrelated service credentials stripped from subscription-only children on
 * every host. OpenCode's explicit keepCredentials path keeps provider keys.
 */
export const WINDOWS_CREDENTIAL_ENV=[
 'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_PROFILE',
 'GH_TOKEN','GITHUB_TOKEN','GITHUB_PAT',
 'NPM_TOKEN','NPM_CONFIG_TOKEN','NPM_CONFIG_AUTHTOKEN',
 'AZURE_CLIENT_SECRET','AZURE_STORAGE_KEY','GOOGLE_APPLICATION_CREDENTIALS',
 'CLOUDFLARE_API_TOKEN','DATABASE_URL','SLACK_TOKEN','DISCORD_TOKEN','TELEGRAM_BOT_TOKEN',
];

/** The Windows system directory, as Windows itself records it. */
export function windowsSystemDirectory(env:NodeJS.ProcessEnv=process.env):string{
 return env.SystemRoot||env.windir||'C:\\Windows';
}
/**
 * The environment-derived system directory, checked before it is used on a real
 * Windows host. A redirected SystemRoot/windir could otherwise choose both the
 * interpreter for a command shim and the tool that kills a process tree. The
 * value must be absolute, free of traversal and contain the system's own
 * cmd.exe; anything else falls back to the default Windows directory. Off
 * Windows the composition stays pure so the rules are testable on every host.
 */
export function trustedSystemDirectory(env:NodeJS.ProcessEnv=process.env):string{
 const configured=windowsSystemDirectory(env);
 if(process.platform!=='win32')return configured;
 const normalized=win32.normalize(configured);
 if(configured.split(/[\\/]+/).includes('..')||!win32.isAbsolute(normalized)||!existsSync(win32.join(normalized,'System32','cmd.exe')))
  return 'C:\\Windows';
 return normalized;
}
/** The system's own cmd.exe: the only interpreter OWLA lets run a Windows command shim. */
export function comSpecPath(env:NodeJS.ProcessEnv=process.env):string{
 return win32.join(windowsSystemDirectory(env),'System32','cmd.exe');
}
/** The validated system cmd.exe used at runtime. */
export function trustedComSpecPath(env:NodeJS.ProcessEnv=process.env):string{
 return win32.join(trustedSystemDirectory(env),'System32','cmd.exe');
}
/** The system's own tool for terminating a whole process tree by PID. */
export function taskkillPath(env:NodeJS.ProcessEnv=process.env):string{
 return win32.join(windowsSystemDirectory(env),'System32','taskkill.exe');
}
/** The validated system taskkill.exe used at runtime. */
export function trustedTaskkillPath(env:NodeJS.ProcessEnv=process.env):string{
 return win32.join(trustedSystemDirectory(env),'System32','taskkill.exe');
}
/**
 * Whether Windows command shims (.cmd, .bat) can run safely. cross-spawn
 * interprets them with `process.env.comspec || 'cmd.exe'`, read from this
 * process's environment rather than the child's
 * (node_modules/cross-spawn/lib/parse.js), so a redirected ComSpec variable
 * would choose which program interprets an assistant. OWLA runs a shim only
 * when the variable names the system's own cmd.exe, or is unset. The comparison
 * uses the validated system path so a redirected SystemRoot cannot make a
 * foreign interpreter look trusted.
 */
export function shimInterpreterTrusted(platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env):boolean{
 if(platform!=='win32')return true;
 const comspec=env.ComSpec||env.comspec||'';
 if(!comspec)return true;
 const normalize=(value:string)=>value.replace(/\//g,'\\').toLowerCase();
 return normalize(comspec)===normalize(trustedComSpecPath(env));
}

/** The environment of a spawned assistant, without the variables above. */
export function sanitizedEnv(env:NodeJS.ProcessEnv=process.env,{keepCredentials=false,platform=process.platform}:{keepCredentials?:boolean;platform?:NodeJS.Platform}={}):NodeJS.ProcessEnv{
 const result:NodeJS.ProcessEnv={...env};
 const blocked=new Set([
  ...UNSAFE_EXECUTION_ENV,
  ...(!keepCredentials?[...UNSAFE_CREDENTIAL_ENV,...WINDOWS_CREDENTIAL_ENV]:[]),
  ...(platform==='win32'?['COMSPEC']:[]),
 ].map(key=>key.toUpperCase()));
 // Windows treats environment names case-insensitively; a plain object does
 // not. Strip every spelling before Node picks which duplicate to forward.
 for(const key of Object.keys(result))if(blocked.has(key.toUpperCase()))delete result[key];
 if(platform==='win32'){
  // Command shims, and anything the assistant itself runs, interpret through
  // ComSpec; it is pinned to the validated system cmd.exe rather than inherited.
  result.ComSpec=trustedComSpecPath(result);
 }
 return result;
}

/**
 * cross-spawn reads `process.env.comspec` from THIS process when it picks the
 * interpreter for a `.cmd`/`.bat` shim (node_modules/cross-spawn/lib/parse.js).
 * When the variable is unset it falls back to a PATH-resolved `cmd.exe`, which
 * could select a different program. Pin the validated system interpreter for
 * the single synchronous spawn call, then restore the environment (W1). No-op
 * off Windows and when the parent already names an interpreter.
 */
export function withPinnedShimInterpreter<T>(run:()=>T):T{
 if(process.platform!=='win32'||process.env.comspec)return run();
 process.env.ComSpec=trustedComSpecPath();
 try{return run();}finally{delete process.env.ComSpec;}
}

export function spawnCli(file:string,args:string[],options:CliSpawnOptions={}):ChildProcessWithoutNullStreams{
 // A Windows command shim is interpreted by the program ComSpec names in this
 // process's environment; OWLA refuses a shim unless that is the system's own
 // cmd.exe (see shimInterpreterTrusted), and pins it if the variable is unset.
 const shim=process.platform==='win32'&&/\.(?:cmd|bat)$/i.test(file);
 if(shim&&!shimInterpreterTrusted())
  throw Error('OWLA cannot run this Windows command shim: the ComSpec variable names a program other than the system Command Prompt. Choose the program’s executable file in settings, or set ComSpec to the Windows cmd.exe.');
 const spawnChild=()=>spawn(file,args,{...options,shell:false,windowsHide:true,stdio:'pipe'}) as ChildProcessWithoutNullStreams;
 return shim?withPinnedShimInterpreter(spawnChild):spawnChild();
}

export function terminateProcessTree(child:ChildProcessWithoutNullStreams,signal:NodeJS.Signals,platform:NodeJS.Platform=process.platform):void{
 if(platform==='win32'){
  // The tree is terminated by PID. Windows reuses PIDs quickly, so an already
  // exited child is never targeted again: its PID may belong to another
  // process now. taskkill is resolved from the validated system directory and
  // only spawned when it is there; the direct child is the fallback.
  if(child.exitCode!==null||child.signalCode!==null)return;
  const pid=child.pid;
  if(pid){
   const taskkill=trustedTaskkillPath();
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
