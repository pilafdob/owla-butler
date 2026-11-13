import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter,join,win32} from 'node:path';
import {defaultCliDirectories,defaultStorageDirectory,findCliExecutable,isCliExecutable,runCli,sanitizedEnv,spawnCli,shimInterpreterTrusted,terminateProcessTree,taskkillPath,windowsSystemDirectory,comSpecPath} from '../src/cli';

test('Windows storage defaults to local per-user application data',()=>{
 assert.equal(defaultStorageDirectory('win32','C:\\Users\\Ada',{LOCALAPPDATA:'C:\\Users\\Ada\\AppData\\Local'}),win32.join('C:\\Users\\Ada\\AppData\\Local','OWLA Butler'));
 assert.equal(defaultStorageDirectory('win32','C:\\Users\\Ada',{}),win32.join('C:\\Users\\Ada','AppData','Local','OWLA Butler'));
});

test('CLI discovery resolves Windows command shims from PATH',()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-cli-discovery-'));
 try{
  const bin=join(root,'bin');
  mkdirSync(bin);
  const shim=join(bin,'example.cmd');
  writeFileSync(shim,'@echo off\r\nexit /b 0\r\n');
  assert.equal(findCliExecutable('example',[bin].join(delimiter),[]),shim);
  assert.equal(isCliExecutable(shim),true);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Windows command shims preserve arguments without shell interpretation',async()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-cli-args-'));
 try{
  const script=join(root,'echo.mjs');
  const shim=join(root,'echo.cmd');
  writeFileSync(script,'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  writeFileSync(shim,'@echo off\r\n\"'+process.execPath+'\" \"'+script+'\" %*\r\n');
  const args=['space value','left&right','%PATH%','(group)'];
  assert.deepEqual(JSON.parse(await runCli(shim,args,{timeout:10000,maxBuffer:10000})),args);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('POSIX CLI discovery still requires an executable file',()=>{
 if(process.platform==='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-cli-posix-'));
 try{
  const bin=join(root,'bin');
  mkdirSync(bin);
  const notExecutable=join(bin,'example');
  writeFileSync(notExecutable,'not executable',{mode:0o600});
  assert.equal(findCliExecutable('example',bin,[]),'');
  writeFileSync(notExecutable,'#!/bin/sh\nexit 0\n',{mode:0o700});
  chmodSync(notExecutable,0o700);
  assert.equal(findCliExecutable('example',bin,[]),notExecutable);
 }finally{rmSync(root,{recursive:true,force:true});}
});

// The Windows rules below pass their platform as a parameter, so they are
// checked on every host: the same assertions run on Windows and in a
// simulated Windows environment on macOS or Linux.

test('Windows executable rules require an absolute path with a launcher extension',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-cli-win-'));
 try{
  const exe=join(root,'codex.exe'),bare=join(root,'codex'),shim=join(root,'claude.cmd');
  writeFileSync(exe,'exe');writeFileSync(bare,'bare');writeFileSync(shim,'shim');
  assert.equal(isCliExecutable(exe,'win32'),true);
  assert.equal(isCliExecutable(shim,'win32'),true);
  assert.equal(isCliExecutable(bare,'win32'),false);
  assert.equal(isCliExecutable(join(root,'missing.exe'),'win32'),false);
  assert.equal(isCliExecutable('codex.exe','win32'),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Windows discovery probes launcher extensions and the semicolon-separated PATH',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-cli-winpath-'));
 try{
  const bin=join(root,'bin'),other=join(root,'other');
  mkdirSync(bin);mkdirSync(other);
  writeFileSync(join(bin,'codex.exe'),'x');
  writeFileSync(join(other,'claude.cmd'),'x');
  assert.equal(findCliExecutable('codex','C:\\Nowhere',[bin],'win32'),join(bin,'codex.exe'));
  assert.equal(findCliExecutable('claude','"'+other+'";C:\\Nowhere',[],'win32'),join(other,'claude.cmd'));
  // A name that already carries an extension is probed as-is only.
  assert.equal(findCliExecutable('claude.exe',other,[],'win32'),'');
  assert.equal(findCliExecutable('codex',[bin,other].join(';'),[],'win32'),join(bin,'codex.exe'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Windows default directories cover the per-user install locations',()=>{
 const home='/Users/u',env={APPDATA:'/Users/u/AppData/Roaming',LOCALAPPDATA:'/Users/u/AppData/Local'};
 const dirs=defaultCliDirectories([],'win32',home,env);
 for(const expected of [join(home,'.local','bin'),join(home,'.claude','local'),join('/Users/u/AppData/Roaming','npm'),join('/Users/u/AppData/Local','Programs','OpenCode'),join('/Users/u/AppData/Local','pnpm'),join(home,'scoop','shims'),join(home,'.volta','bin'),join(home,'.bun','bin')])
  assert.ok(dirs.includes(expected),expected);
 assert.ok(!defaultCliDirectories([],'win32',home,{}).includes(join('/Users/u/AppData/Local','pnpm')));
 assert.ok(defaultCliDirectories([],'win32',home,{}).includes(join(home,'.bun','bin')));
});

test('Windows system tools resolve from SystemRoot with fallbacks',()=>{
 assert.equal(windowsSystemDirectory({SystemRoot:'C:\\Win'}),'C:\\Win');
 assert.equal(windowsSystemDirectory({windir:'C:\\Win'}),'C:\\Win');
 assert.equal(windowsSystemDirectory({}),'C:\\Windows');
 assert.equal(taskkillPath({SystemRoot:'C:\\Win'}),win32.join('C:\\Win','System32','taskkill.exe'));
 assert.equal(comSpecPath({windir:'C:\\Win'}),win32.join('C:\\Win','System32','cmd.exe'));
 assert.equal(taskkillPath({}),win32.join('C:\\Windows','System32','taskkill.exe'));
});

test('A Windows command shim runs only through the system interpreter',()=>{
 const root={SystemRoot:'C:\\Win'};
 assert.equal(shimInterpreterTrusted('win32',root),true);
 assert.equal(shimInterpreterTrusted('win32',{...root,ComSpec:'C:\\WIN\\system32\\CMD.EXE'}),true);
 assert.equal(shimInterpreterTrusted('win32',{...root,ComSpec:'C:/Win/System32/cmd.exe'}),true);
 assert.equal(shimInterpreterTrusted('win32',{...root,ComSpec:'C:\\Tools\\shell.exe'}),false);
 assert.equal(shimInterpreterTrusted('win32',{...root,comspec:'C:\\Tools\\shell.exe'}),false);
 assert.equal(shimInterpreterTrusted('darwin',{ComSpec:'C:\\Tools\\shell.exe'}),true);
});

test('Windows child environments pin ComSpec to the system interpreter',()=>{
 const env=sanitizedEnv({PATH:'C:\\bin',SystemRoot:'C:\\Win',ComSpec:'C:\\Tools\\other.exe',NODE_OPTIONS:'--require /x.js'},{platform:'win32'});
 assert.equal(env.ComSpec,win32.join('C:\\Win','System32','cmd.exe'));
 assert.equal(env.comspec,undefined);
 assert.equal(env.NODE_OPTIONS,undefined);
 assert.equal(sanitizedEnv({ComSpec:'C:\\Tools\\other.exe'},{platform:'darwin'}).ComSpec,'C:\\Tools\\other.exe');
});

test('Windows tree termination kills the child and never targets an exited one',async()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-cli-winkill-'));
 try{
  const script=join(root,'hold.mjs');
  writeFileSync(script,'setTimeout(()=>{},30000);\n');
  // On Windows taskkill terminates the tree; on other hosts the Windows
  // taskkill path does not exist and the direct child is the fallback.
  const child=spawnCli(process.execPath,[script]);
  assert.ok(child.pid);
  terminateProcessTree(child,'SIGKILL','win32');
  assert.equal(await new Promise<boolean>(resolve=>{child.once('exit',()=>resolve(true));setTimeout(()=>resolve(false),5000);}),true);
  const quick=spawnCli(process.execPath,['-e','']);
  await new Promise<void>(resolve=>quick.once('exit',resolve));
  // Windows may have reused the PID already; the call must be a safe no-op.
  terminateProcessTree(quick,'SIGKILL','win32');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('POSIX tree termination still kills the detached process group',async()=>{
 if(process.platform==='win32')return;
 const child=spawnCli('/bin/sh',['-c','sleep 30'],{detached:true});
 terminateProcessTree(child,'SIGKILL');
 assert.equal(await new Promise<boolean>(resolve=>{child.once('exit',()=>resolve(true));setTimeout(()=>resolve(false),5000);}),true);
});
