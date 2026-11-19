import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter,join,win32,basename} from 'node:path';
import {defaultCliDirectories,defaultStorageDirectory,envPath,extendedPath,findCliExecutable,isCliExecutable,runCli,sanitizedEnv,spawnCli,shimInterpreterTrusted,terminateProcessTree,taskkillPath,trustedComSpecPath,trustedSystemDirectory,windowsSystemDirectory,comSpecPath,withPinnedShimInterpreter} from '../src/cli';

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
 // On a real Windows host the system directory is validated against the
 // installed cmd.exe, so use this machine's actual SystemRoot there.
 const systemRoot=process.platform==='win32'?(process.env.SystemRoot||'C:\\Windows'):'C:\\Win';
 const root={SystemRoot:systemRoot};
 const cmd=win32.join(systemRoot,'System32','cmd.exe');
 assert.equal(shimInterpreterTrusted('win32',root),true);
 assert.equal(shimInterpreterTrusted('win32',{...root,ComSpec:cmd.toUpperCase()}),true);
 assert.equal(shimInterpreterTrusted('win32',{...root,ComSpec:cmd.replace(/\\/g,'/')}),true);
 assert.equal(shimInterpreterTrusted('win32',{...root,ComSpec:'C:\\Tools\\shell.exe'}),false);
 assert.equal(shimInterpreterTrusted('win32',{...root,comspec:'C:\\Tools\\shell.exe'}),false);
 assert.equal(shimInterpreterTrusted('darwin',{ComSpec:'C:\\Tools\\shell.exe'}),true);
});

test('Windows child environments pin ComSpec to the system interpreter',()=>{
 const systemRoot=process.platform==='win32'?(process.env.SystemRoot||'C:\\Windows'):'C:\\Win';
 const env=sanitizedEnv({PATH:'C:\\bin',SystemRoot:systemRoot,ComSpec:'C:\\Tools\\other.exe',NODE_OPTIONS:'--require /x.js'},{platform:'win32'});
 assert.equal(env.ComSpec,win32.join(systemRoot,'System32','cmd.exe'));
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

// W2 — a redirected SystemRoot must not choose the shim interpreter or taskkill.

test('A redirected or traversal SystemRoot is never used to choose system tools',()=>{
 const fake={SystemRoot:'C:\\DefinitelyNotWindows',ComSpec:'C:\\DefinitelyNotWindows\\System32\\cmd.exe'};
 // The pure composition helpers stay unchanged on every host.
 assert.equal(comSpecPath(fake),win32.join('C:\\DefinitelyNotWindows','System32','cmd.exe'));
 assert.equal(taskkillPath(fake),win32.join('C:\\DefinitelyNotWindows','System32','taskkill.exe'));
 if(process.platform==='win32'){
  assert.equal(trustedSystemDirectory(fake),'C:\\Windows');
  assert.equal(trustedComSpecPath(fake),win32.join('C:\\Windows','System32','cmd.exe'));
  assert.equal(shimInterpreterTrusted('win32',fake),false);
  const traversal={SystemRoot:'C:\\Windows\\..\\Evil',ComSpec:'C:\\Evil\\System32\\cmd.exe'};
  assert.equal(trustedSystemDirectory(traversal),'C:\\Windows');
 }else{
  // Off Windows validation is a no-op so the same rules remain testable.
  assert.equal(trustedSystemDirectory(fake),'C:\\DefinitelyNotWindows');
 }
});

// W3 — the provider-child PATH uses the host separator.

test('Provider child PATH uses the host separator',()=>{
 assert.equal(extendedPath('C:\\bin',['C:\\a','C:\\b'],'win32'),'C:\\bin;C:\\a;C:\\b');
 assert.equal(extendedPath('/bin',['/a','/b'],'darwin'),'/bin:/a:/b');
 assert.equal(extendedPath(undefined,['/a'],'linux'),'/a');
});

// Unrelated service credentials are stripped consistently on Windows and macOS.

test('Subscription-only child environments drop unrelated credentials on every host',()=>{
 const source={GH_TOKEN:'token',AWS_SECRET_ACCESS_KEY:'secret',NPM_TOKEN:'token',OPENAI_API_KEY:'key'};
 const win=sanitizedEnv(source,{platform:'win32'});
 assert.equal(win.GH_TOKEN,undefined);
 assert.equal(win.AWS_SECRET_ACCESS_KEY,undefined);
 assert.equal(win.NPM_TOKEN,undefined);
 assert.equal(win.OPENAI_API_KEY,undefined);
 const other=sanitizedEnv(source,{platform:'darwin'});
 assert.equal(other.GH_TOKEN,undefined);
 assert.equal(other.AWS_SECRET_ACCESS_KEY,undefined);
 assert.equal(other.NPM_TOKEN,undefined);
 assert.equal(other.OPENAI_API_KEY,undefined); // the universal list still applies
});

// W1 — cross-spawn's interpreter is pinned for the duration of a shim spawn.

test('A shim spawn pins ComSpec to the system interpreter and restores it',()=>{
 if(process.platform!=='win32')return;
 const saved=process.env.comspec;
 delete process.env.comspec;
 try{
  let during='';
  withPinnedShimInterpreter(()=>{during=process.env.comspec||'';});
  assert.equal(during,trustedComSpecPath());
  assert.equal(process.env.comspec,undefined);
 }finally{
  if(saved!==undefined)process.env.ComSpec=saved;
 }
});

// W3 follow-up — a copied environment keeps whatever key casing the host used.

test('envPath finds PATH regardless of key casing on a plain object',()=>{
 assert.equal(envPath({Path:'C:\bin'}),'C:\bin');
 assert.equal(envPath({PATH:'/usr/bin'}),'/usr/bin');
 assert.equal(envPath({path:'C:\other'}),'C:\other');
 assert.equal(envPath({}),'');
 // The spread of a normal Windows-style env is where env.PATH would be undefined.
 assert.equal(envPath({...{Path:'C:\bin',ComSpec:'C:\Windows\System32\cmd.exe'}}),'C:\bin');
});

// Failure-resilience audit: runCli names the failing command, cancels and
// bounds its children, and a provider stream error can never crash the host.

test('runCli names the command in launch, exit and timeout errors',async()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-cli-fail-'));
 try{
  const missing=join(root,'missing-cli');
  await assert.rejects(runCli(missing,[],{timeout:5000,maxBuffer:1000}),/Could not start missing-cli/);
  const name=basename(process.execPath).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const fail=join(root,'fail.mjs');
  writeFileSync(fail,'process.exit(3);');
  await assert.rejects(runCli(process.execPath,[fail],{timeout:5000,maxBuffer:1000}),new RegExp(name+' exited with code 3'));
  const stderrFail=join(root,'stderr.mjs');
  writeFileSync(stderrFail,'console.error("the real cause");process.exit(2);');
  await assert.rejects(runCli(process.execPath,[stderrFail],{timeout:5000,maxBuffer:1000}),/the real cause/);
  const hang=join(root,'hang.mjs');
  writeFileSync(hang,'setTimeout(()=>{},30000);');
  await assert.rejects(runCli(process.execPath,[hang],{timeout:300,maxBuffer:1000}),new RegExp(name+' timed out after 300 ms'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('runCli abort kills the child and reports the cancel reason',async()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-cli-abort-'));
 try{
  const hang=join(root,'hang.mjs');
  writeFileSync(hang,'setTimeout(()=>{},30000);');
  const plain=new AbortController();
  const pending=runCli(process.execPath,[hang],{timeout:30000,maxBuffer:1000,signal:plain.signal});
  plain.abort();
  await assert.rejects(pending,/aborted/);
  const reasoned=new AbortController();
  const second=runCli(process.execPath,[hang],{timeout:30000,maxBuffer:1000,signal:reasoned.signal});
  reasoned.abort(Error('user stopped'));
  await assert.rejects(second,/user stopped/);
  // An already-aborted signal never spawns the command.
  const third=new AbortController();third.abort();
  await assert.rejects(runCli(process.execPath,[hang],{timeout:30000,maxBuffer:1000,signal:third.signal}),/aborted/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('runCli closes stdin so a command reading to EOF is not left waiting',async()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-cli-eof-'));
 try{
  const script=join(root,'eof.mjs');
  writeFileSync(script,'let n=0;process.stdin.on("data",c=>n+=c.length);process.stdin.on("end",()=>console.log("eof:"+n));');
  assert.equal((await runCli(process.execPath,[script],{timeout:5000,maxBuffer:1000})).trim(),'eof:0');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('runCli kills a command whose output exceeds the buffer limit',async()=>{
 await assert.rejects(runCli(process.execPath,['-e','process.stdout.write("x".repeat(5000));setTimeout(()=>{},30000);'],{timeout:5000,maxBuffer:1000}),/1000 byte limit/);
});

test('a provider child stream error never crashes the host and still reaches bridge listeners',async()=>{
 // The child never reads stdin and dies while a large write is in flight: the
 // pending write completes with EPIPE. Without spawnCli's default listener
 // that is an uncaught exception and takes the whole plugin host down.
 const child=spawnCli(process.execPath,['-e','setTimeout(()=>process.exit(0),60)']);
 let seen=false;
 child.stdin.on('error',()=>{seen=true;});
 child.stdin.write('x'.repeat(1024*1024));
 await new Promise(resolve=>setTimeout(resolve,400));
 assert.equal(seen,true);
});
