// Windows failure-handling audit (win-failure): shim launch integrity,
// case-insensitive env resolution and process-kill safety. Pure rules are
// platform-parameterized so they run on every host; real-spawn rules are
// gated to Windows. POSIX behaviour is asserted unchanged where shared.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,win32} from 'node:path';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {findCliExecutable,runCli,sanitizedEnv,shimInterpreterTrusted,spawnCli,terminateProcessTree,trustedComSpecPath,windowsSystemDirectory} from '../src/cli';

const CRLF=String.fromCharCode(13,10);
/** Names the failing step and the interpreter variables, so a rare load-only failure is diagnosable. */
async function step<T>(name:string,run:()=>Promise<T>):Promise<T>{
 try{return await run();}
 catch(error){throw Error(name+': '+(error instanceof Error?error.message:String(error))+' (ComSpec='+JSON.stringify(process.env.ComSpec)+', SystemRoot='+JSON.stringify(process.env.SystemRoot)+')');}
}
function echoShim(root:string){
 const script=join(root,'echo.mjs');
 writeFileSync(script,'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
 const shim=join(root,'echo.cmd');
 writeFileSync(shim,'@echo off'+CRLF+'"'+process.execPath+'" "'+script+'" %*'+CRLF);
 return shim;
}

test('Windows system-directory and ComSpec rules read any key casing',()=>{
 // A spread copy of a Windows env keeps the host's casing (SYSTEMROOT,
 // COMSPEC on a normal install); indexing env.SystemRoot would miss it.
 assert.equal(windowsSystemDirectory({SYSTEMROOT:'D:\\WinNT'}),'D:\\WinNT');
 assert.equal(windowsSystemDirectory({Windir:'D:\\WinNT'}),'D:\\WinNT');
 assert.equal(windowsSystemDirectory({SYSTEMROOT:'D:\\WinNT',WINDIR:'C:\\Other'}),'D:\\WinNT');
 assert.equal(windowsSystemDirectory({}),'C:\\Windows');
 const systemRoot=process.platform==='win32'?(process.env.SystemRoot||'C:\\Windows'):'C:\\Win';
 const cmd=win32.join(systemRoot,'System32','cmd.exe');
 assert.equal(shimInterpreterTrusted('win32',{SYSTEMROOT:systemRoot,COMSPEC:cmd.toUpperCase()}),true);
 assert.equal(shimInterpreterTrusted('win32',{SYSTEMROOT:systemRoot,COMSPEC:'C:\\Tools\\shell.exe'}),false);
 assert.equal(shimInterpreterTrusted('win32',{SYSTEMROOT:systemRoot,ComSpec:''}),true);
 assert.equal(shimInterpreterTrusted('darwin',{COMSPEC:'C:\\Tools\\shell.exe'}),true);
});

test('a copied Windows environment still pins ComSpec to the real system interpreter',()=>{
 if(process.platform!=='win32')return;
 const env=sanitizedEnv({...process.env},{platform:'win32'});
 assert.equal(env.ComSpec,trustedComSpecPath(process.env));
 assert.deepEqual(Object.keys(env).filter(key=>key.toLowerCase()==='comspec'),['ComSpec']);
});

test('a Windows shim refuses control characters cmd.exe would misread',async()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-win-shim-chars-'));
 try{
  const shim=echoShim(root);
  // A CR/LF truncates the wrapped /c command line (probe-verified): the shim
  // would silently receive only the arguments before it. Fail closed instead.
  for(const bad of ['a\nb','a\rb','a\r\nb','a\u0000b','a\u001Fb'])
   assert.throws(()=>spawnCli(shim,[bad]),/control character/,JSON.stringify(bad));
  assert.throws(()=>spawnCli(join(root,'bad\nname.cmd'),[]),/control character/);
  // Tab is safe inside the quoted arguments; clean lists still round-trip.
  assert.deepEqual(JSON.parse(await runCli(shim,['a\tb','plain'],{timeout:10000,maxBuffer:10000})),['a\tb','plain']);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('runCli rejects, never throws synchronously, on a corrupted shim argument',async()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-win-shim-reject-'));
 try{
  const shim=echoShim(root);
  await assert.rejects(runCli(shim,['ok','bad\narg'],{timeout:5000,maxBuffer:1000}),/control character/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('POSIX arguments with newlines still pass through untouched',async()=>{
 if(process.platform==='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-posix-newline-'));
 try{
  const script=join(root,'echo.mjs');
  writeFileSync(script,'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const out=await runCli(process.execPath,[script,'a\nb'],{timeout:5000,maxBuffer:10000});
  assert.deepEqual(JSON.parse(out),['a\nb']);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('terminateProcessTree never targets an exited child, even via the fallback',()=>{
 const calls:string[]=[];
 const kill=(signal:string)=>{calls.push(signal);return true;};
 // The PID may already belong to another process: no taskkill, no kill.
 const exited={pid:12345,exitCode:0,signalCode:null,kill} as unknown as ChildProcessWithoutNullStreams;
 terminateProcessTree(exited,'SIGKILL','win32');
 const signaled={pid:12345,exitCode:null,signalCode:'SIGTERM',kill} as unknown as ChildProcessWithoutNullStreams;
 terminateProcessTree(signaled,'SIGKILL','win32');
 assert.deepEqual(calls,[]);
});

test('without a usable taskkill PID the direct child is the fallback',()=>{
 const calls:string[]=[];
 const live={pid:undefined,exitCode:null,signalCode:null,kill:(signal:string)=>{calls.push(signal);return true;}} as unknown as ChildProcessWithoutNullStreams;
 terminateProcessTree(live,'SIGTERM','win32');
 assert.deepEqual(calls,['SIGTERM']);
});

test('a hijacked ComSpec refuses the shim end-to-end; unset or empty is pinned',async()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-win-comspec-'));
 const saved=process.env.ComSpec;
 try{
  const shim=echoShim(root);
  process.env.ComSpec='C:\\Tools\\not-cmd.exe';
  assert.throws(()=>spawnCli(shim,['x']),/ComSpec/);
  await assert.rejects(runCli(shim,['x'],{timeout:5000,maxBuffer:1000}),/ComSpec/);
  delete process.env.ComSpec;
  assert.deepEqual(JSON.parse(await step('unset ComSpec',()=>runCli(shim,['pinned'],{timeout:10000,maxBuffer:10000}))),['pinned']);
  assert.equal(process.env.comspec,undefined,'the pin is restored after the spawn');
  process.env.ComSpec='';
  assert.deepEqual(JSON.parse(await step('empty ComSpec',()=>runCli(shim,['empty'],{timeout:10000,maxBuffer:10000}))),['empty']);
 }finally{
  if(saved===undefined)delete process.env.ComSpec;else process.env.ComSpec=saved;
  rmSync(root,{recursive:true,force:true});
 }
});

test('a hijacked PATHEXT neither redirects nor breaks shim discovery and launch',async()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-win-pathext-'));
 const saved=process.env.PATHEXT;
 try{
  const bin=join(root,'bin');mkdirSync(bin);
  const shim=echoShim(bin);
  process.env.PATHEXT='.EXE;.COM'; // no .CMD/.BAT
  // OWLA probes its own fixed launcher-extension list, not PATHEXT.
  assert.equal(findCliExecutable('echo',bin,[],'win32'),shim);
  // cross-spawn resolves the absolute shim even when PATHEXT omits .cmd.
  assert.deepEqual(JSON.parse(await runCli(shim,['pathext'],{timeout:10000,maxBuffer:10000})),['pathext']);
 }finally{
  if(saved===undefined)delete process.env.PATHEXT;else process.env.PATHEXT=saved;
  rmSync(root,{recursive:true,force:true});
 }
});
